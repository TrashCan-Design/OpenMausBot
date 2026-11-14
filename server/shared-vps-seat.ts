import { SharedVpsJournal } from "./shared-vps-journal.ts";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { ComputerControl } from "./computer-control.ts";
import { sharedAliasFromResource, sharedVpsControlKey, sharedVpsResource } from "./shared-vps.ts";
import { TurnResources, type TurnOwner } from "./turn-resources.ts";

const TAKE_TIMEOUT_MS = 120_000;
const LEASE_IDLE_MS = 10 * 60_000;

type Seat = { operationId: string; owner: TurnOwner; session: string; confirmed: boolean; timer: ReturnType<typeof setTimeout> };

/** Shared VPS person control participates in the same FIFO desktop queue as bot turns. */
export class SharedVpsSeat {
  private readonly seats = new Map<string, Seat>();
  private readonly waitRequests = new Map<string, number>();
  private readonly responses = new Map<string, number>();
  private readonly journal: SharedVpsJournal;
  private readonly draining = new Set<string>();
  private readonly epoch = new Map<string, number>();
  private readonly seen = new Map<string, Map<string, number>>();
  private readonly resources: TurnResources;
  private readonly control: ComputerControl;
  private readonly onRelease: (alias: string) => void | Promise<void>;

  constructor(resources: TurnResources, control: ComputerControl, onRelease: (alias: string) => void | Promise<void> = () => {}, journal = new SharedVpsJournal()) {
    this.journal = journal;
    this.resources = resources;
    this.control = control;
    this.onRelease = onRelease;
    resources.onRelease((resource, owner) => this.afterResourceRelease(resource, owner));
    resources.onClaim((resource) => { const alias = sharedAliasFromResource(resource); if (alias) this.advance(alias); });
    for (const row of journal.list()) { this.draining.add(row.alias); resources.hold(sharedVpsResource(row.alias), this.recoveryOwner(row.alias)); }
  }

  private owner(alias: string, lease: string, session: string): TurnOwner {
    return { threadId: `shared-vps-person:${alias}:${session}`, generation: lease };
  }

  private requestKey(alias: string, lease: string, session: string): string {
    return JSON.stringify([alias, lease, session]);
  }

  owns(alias: string, lease: string, session?: string): boolean {
    if (session && this.seats.get(alias)?.session !== session) return false;
    const ownerSession = session ?? this.seats.get(alias)?.session;
    return Boolean(ownerSession && this.resources.owns(sharedVpsResource(alias), this.owner(alias, lease, ownerSession))) &&
      this.control.ownsLease(sharedVpsControlKey(alias), lease);
  }

  allows(alias: string, session: string): boolean {
    const seat = this.seats.get(alias);
    return Boolean(seat && seat.session === session && this.owns(alias, seat.owner.generation));
  }

  touch(alias: string, lease: string, session?: string): void {
    if (!this.owns(alias, lease, session)) return;
    const seat = this.seats.get(alias);
    if (!seat) return;
    clearTimeout(seat.timer);
    seat.timer = setTimeout(() => this.release(alias, lease), LEASE_IDLE_MS);
    seat.timer.unref?.();
  }

  touchCurrent(alias: string): void {
    const seat = this.seats.get(alias);
    if (seat) this.touch(alias, seat.owner.generation);
  }

  async take(alias: string, lease: string, signal?: AbortSignal, session = "loopback", provisional = false): Promise<{ held: boolean; owned: boolean; acquired: boolean }> {
    if (this.owns(alias, lease, session)) {
      if (!provisional) this.seats.get(alias)!.confirmed = true;
      this.touch(alias, lease);
      return { held: true, owned: true, acquired: false };
    }
    const resource = sharedVpsResource(alias);
    const owner = this.owner(alias, lease, session);
    const requestKey = this.requestKey(alias, lease, session);
    const deadline = Date.now() + TAKE_TIMEOUT_MS;
    this.waitRequests.set(requestKey, (this.waitRequests.get(requestKey) ?? 0) + 1);
    this.resources.startWaiting(resource, owner);
    // Release only a claim this attempt made and did not keep. Another take of this lease matches by id, not by this object.
    let releaseClaim = false;
    try {
      while (Date.now() < deadline && !signal?.aborted) {
        if (this.owns(alias, lease, session)) {
          if (!provisional) this.seats.get(alias)!.confirmed = true;
          return { held: true, owned: true, acquired: false };
        }
        const blocked = this.draining.has(alias) || this.pending(alias) > 0;
        if (!blocked && this.resources.claim(resource, owner)) {
          releaseClaim = true;
          const stillBlocked = signal?.aborted || this.draining.has(alias) || this.pending(alias) > 0;
          const acquired = stillBlocked ? { owned: false, acquired: false } : this.control.acquireLease(sharedVpsControlKey(alias), lease);
          if (!acquired.owned) {
            this.resources.releaseOne(resource, owner);
            releaseClaim = false;
          } else {
            const operationId = randomUUID();
            try { this.journal.add({ id: operationId, alias, owner: `${owner.threadId}:${owner.generation}`, target: "" }); }
            catch (error) { this.control.releaseLease(sharedVpsControlKey(alias), lease); throw error; }
            const timer = setTimeout(() => this.release(alias, lease), LEASE_IDLE_MS);
            timer.unref?.();
            this.seats.set(alias, { operationId, owner, session, confirmed: !provisional, timer });
            releaseClaim = false;
            return { held: true, owned: true, acquired: acquired.acquired };
          }
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 100);
          const aborted = () => { clearTimeout(timer); done(); };
          function done() { signal?.removeEventListener("abort", aborted); resolve(); }
          signal?.addEventListener("abort", aborted, { once: true });
        });
      }
      throw Object.assign(new Error(signal?.aborted ? "Desktop control request cancelled" : "Timed out waiting for the shared desktop"), { status: signal?.aborted ? 499 : 409 });
    } finally {
      const requests = (this.waitRequests.get(requestKey) ?? 1) - 1;
      if (requests) this.waitRequests.set(requestKey, requests);
      else {
        this.waitRequests.delete(requestKey);
        this.resources.stopWaiting(resource, owner);
      }
      if (releaseClaim) this.resources.releaseOne(resource, owner);
    }
  }

  async respond(alias: string, action: string, lease: string | undefined, session: string, changing: boolean, closed: () => boolean, signal: AbortSignal, valid: () => boolean = () => true): Promise<{ status: number; body: Record<string, unknown> } | null> {
    const key = sharedVpsControlKey(alias);
    if (action === "take") {
      if (!lease) return { status: 400, body: { error: "Shared desktop control requires a control lease" } };
      if (changing) return { status: 409, body: { error: "The shared VPS desktop is being changed; wait before taking control" } };
      const requestKey = this.requestKey(alias, lease, session);
      this.responses.set(requestKey, (this.responses.get(requestKey) ?? 0) + 1);
      try {
        const result = await this.take(alias, lease, signal, session, true);
        if (signal.aborted || closed()) return null;
        if (!valid()) return { status: 409, body: { error: "The shared desktop selection or session changed while waiting" } };
        if (!this.owns(alias, lease, session)) return { status: 409, body: { error: "This desktop control request was superseded" } };
        this.seats.get(alias)!.confirmed = true;
        return { status: 200, body: { ...this.control.snapshot(key), ...result } };
      } finally {
        const pending = (this.responses.get(requestKey) ?? 1) - 1;
        if (pending) this.responses.set(requestKey, pending);
        else {
          this.responses.delete(requestKey);
          const seat = this.seats.get(alias);
          if (seat && !seat.confirmed && seat.session === session && seat.owner.generation === lease) this.release(alias, lease, session);
        }
      }
    }
    if (action === "release") {
      const released = this.release(alias, lease, session);
      return { status: 200, body: { ...this.control.snapshot(key), released } };
    }
    if (action === "check" && lease) {
      this.touch(alias, lease, session);
      return { status: 200, body: { ...this.control.snapshot(key), owned: this.owns(alias, lease, session), queuePosition: this.resources.waitPosition(sharedVpsResource(alias), this.owner(alias, lease, session)) ?? null } };
    }
    return { status: 400, body: { error: "action must be take, release, or check" } };
  }

  async respondHttp(res: ServerResponse, input: {
    alias: string; action: string; lease?: string; session: string; changing: boolean; valid: () => boolean;
  }): Promise<{ status: number; body: Record<string, unknown> } | null> {
    const cancelled = new AbortController();
    const onClose = () => cancelled.abort();
    if (input.action === "take") res.once("close", onClose);
    try {
      return await this.respond(input.alias, input.action, input.lease, input.session, input.changing,
        () => cancelled.signal.aborted || res.destroyed, cancelled.signal, input.valid);
    } finally { if (input.action === "take") res.off("close", onClose); }
  }

  release(alias: string, lease?: string, session?: string): boolean {
    const seat = this.seats.get(alias);
    if (!seat || (lease && seat.owner.generation !== lease) || (session && seat.session !== session)) return false;
    if (this.draining.has(alias)) return true;
    this.draining.add(alias);
    clearTimeout(seat.timer);
    this.control.releaseLease(sharedVpsControlKey(alias), seat.owner.generation);
    const finish = () => {
      if (this.seats.get(alias) !== seat || !this.journal.finish(seat.operationId, alias, `${seat.owner.threadId}:${seat.owner.generation}`)) return;
      if (this.pending(alias) === 0) this.finishDrain(alias);
    };
    const closing = this.onRelease(alias);
    if (closing && typeof closing.then === "function") void Promise.resolve(closing).finally(finish).catch(() => {});
    else finish();
    return true;
  }

  /** A mutation was allowed onto the desktop. finish must name the same owner once that call's result is known. */
  admit(alias: string, owner: string, id: string, target = ""): "ok" | "recovering" | "stale" {
    if (this.recovering(alias) || this.currentOwner(alias) !== owner) return "recovering";
    if (this.seen.get(alias)?.get(owner) !== this.version(alias)) return "stale";
    return this.journal.add({ id, alias, owner, target }) ? "ok" : "recovering";
  }

  currentOwner(alias: string): string | null {
    const holder = this.resources.holder(sharedVpsResource(alias));
    return holder ? `${holder.threadId}:${holder.generation}` : null;
  }

  version(alias: string): number { return this.epoch.get(alias) ?? 0; }

  /** A successful desktop look is remembered per owner; another owner's look does not replace it. */
  note(alias: string, owner: string, epoch = this.version(alias)): void {
    if (epoch !== this.version(alias) || this.recovering(alias)) return;
    let owners = this.seen.get(alias);
    if (!owners) this.seen.set(alias, owners = new Map());
    owners.set(owner, epoch);
  }

  finish(alias: string, owner: string, id: string): void {
    if (!this.journal.finish(id, alias, owner) || this.pending(alias)) return;
    const recovery = this.recoveryOwner(alias);
    if (this.resources.owns(sharedVpsResource(alias), recovery)) {
      this.draining.delete(alias);
      this.resources.releaseOne(sharedVpsResource(alias), recovery);
      this.advance(alias);
    } else if (this.draining.has(alias)) this.finishDrain(alias);
  }

  unresolved(alias: string) { return this.journal.list(alias); }
  block(alias: string): void { this.draining.add(alias); }

  async recover(alias: string, stop: () => Promise<void>): Promise<void> {
    if (!this.recovering(alias)) throw new Error("The desktop is not awaiting recovery");
    const target = this.journal.list(alias).find(row => row.target)?.target ?? "";
    this.journal.add({ id: `recover:${alias}`, alias, owner: "recovery", target });
    await stop();
    for (const row of this.journal.list(alias)) this.finish(alias, row.owner, row.id);
    if (!this.pending(alias)) { this.draining.delete(alias); this.finishDrain(alias); }
  }

  releaseSession(sessionId: string): void {
    for (const [alias, seat] of this.seats) {
      if (seat.session === sessionId) this.release(alias, seat.owner.generation, sessionId);
    }
  }

  /** What an observer may read. It does not take, renew, or queue for control. */
  recovering(alias: string): boolean {
    return this.draining.has(alias) || this.resources.owns(sharedVpsResource(alias), this.recoveryOwner(alias));
  }

  frame(alias: string): { epoch: number; inputPermitted: false; recovering: boolean; controller: "person" | "bot" | null } {
    const seat = this.seats.get(alias);
    const person = Boolean(seat && !this.draining.has(alias) && this.control.snapshot(sharedVpsControlKey(alias)).held);
    const holder = this.resources.holder(sharedVpsResource(alias));
    const bot = Boolean(holder && !holder.threadId.startsWith("shared-vps-person:") && !holder.threadId.startsWith("shared-vps-recovery:"));
    return {
      epoch: this.epoch.get(alias) ?? 0,
      inputPermitted: false,
      recovering: this.recovering(alias),
      controller: person ? "person" : bot ? "bot" : null,
    };
  }

  private pending(alias: string): number {
    return this.journal.list(alias).length;
  }

  private recoveryOwner(alias: string): TurnOwner {
    return { threadId: `shared-vps-recovery:${alias}`, generation: "recovering" };
  }

  private advance(alias: string): void {
    this.epoch.set(alias, (this.epoch.get(alias) ?? 0) + 1);
    this.seen.delete(alias);
  }

  private afterResourceRelease(resource: string, owner: TurnOwner): void {
    if (owner.threadId.startsWith("shared-vps-recovery:")) return;
    const alias = sharedAliasFromResource(resource);
    if (!alias) return;
    if (this.pending(alias) > 0) {
      this.draining.add(alias);
      this.resources.hold(resource, this.recoveryOwner(alias));
      return;
    }
    this.advance(alias);
  }

  private finishDrain(alias: string): void {
    if (this.pending(alias) > 0) return;
    const seat = this.seats.get(alias);
    this.seats.delete(alias);
    this.draining.delete(alias);
    if (seat) {
      clearTimeout(seat.timer);
      this.control.releaseLease(sharedVpsControlKey(alias), seat.owner.generation);
      this.resources.releaseOne(sharedVpsResource(alias), seat.owner);
    } else {
      this.advance(alias);
    }
  }

  close(): void {
    for (const alias of this.seats.keys()) this.release(alias);
  }
}
