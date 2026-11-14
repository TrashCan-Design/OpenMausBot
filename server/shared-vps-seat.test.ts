import { describe, expect, it, vi } from "vitest";
import { ComputerControl } from "./computer-control.ts";
import { sharedVpsControlKey, sharedVpsOwnerId, sharedVpsResource, vpsDesktopOwnerId } from "./shared-vps.ts";
import { SharedVpsSeat } from "./shared-vps-seat.ts";
import { TurnResources } from "./turn-resources.ts";

const alias = "gcp-desktop";
const resource = sharedVpsResource(alias);
const person = "a".repeat(20);

describe("shared VPS desktop ownership", () => {
  it("a late viewer-close result cannot release a new person after recovery", async () => {
    let drained!: () => void;
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl(), () => new Promise<void>(resolve => { drained = resolve; }));
    await seat.take(alias, person);
    seat.release(alias, person);
    await seat.recover(alias, async () => {});
    await seat.take(alias, "new-person-lease");
    drained(); await Promise.resolve();
    expect(seat.owns(alias, "new-person-lease")).toBe(true);
    seat.close();
  });

  it("recovers drain state even when viewer release rejects", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl(), () => Promise.reject(new Error("viewer failed")));
    await seat.take(alias, person);
    expect(seat.recovering(alias)).toBe(false);
    seat.release(alias, person);
    await Promise.resolve();
    await Promise.resolve();
    expect(seat.recovering(alias)).toBe(false);
    await expect(seat.take(alias, "another-person")).resolves.toMatchObject({ held: true, owned: true });
    seat.close();
  });

  it("recovers a seat held by a person and allows a new lease to take control", async () => {
    const resources = new TurnResources();
    const control = new ComputerControl();
    const seat = new SharedVpsSeat(resources, control);
    await seat.take(alias, person);
    expect(seat.owns(alias, person)).toBe(true);
    seat.block(alias);
    await seat.recover(alias, async () => {});
    expect(seat.owns(alias, person)).toBe(false);
    expect(control.snapshot(sharedVpsControlKey(alias)).held).toBe(false);
    await expect(seat.take(alias, "new-person-lease")).resolves.toMatchObject({ held: true, owned: true });
    expect(seat.owns(alias, "new-person-lease")).toBe(true);
    seat.close();
  });

  it("uses one stable per-host container for multiple bots and preserves per-bot names", () => {
    const alpha = { id: "alpha", vpsDesktopMode: "shared" as const };
    const beta = { id: "beta", vpsDesktopMode: "shared" as const };
    expect(vpsDesktopOwnerId(alpha, alias)).toBe(sharedVpsOwnerId(alias));
    expect(vpsDesktopOwnerId(beta, alias)).toBe(vpsDesktopOwnerId(alpha, alias));
    expect(vpsDesktopOwnerId(alpha, "another-host")).not.toBe(vpsDesktopOwnerId(alpha, alias));
    expect(vpsDesktopOwnerId({ id: "alpha" }, alias)).toBe("alpha");
  });

  it("queues a person behind an active bot and ahead of the next bot", async () => {
    const resources = new TurnResources();
    const control = new ComputerControl();
    const seat = new SharedVpsSeat(resources, control);
    const alpha = { threadId: "alpha", generation: "one" };
    const beta = { threadId: "beta", generation: "two" };
    expect(resources.claim(resource, alpha)).toBe(true);
    const take = seat.take(alias, person);
    expect(resources.waiting(resource)).toHaveLength(1);
    expect(resources.startWaiting(resource, beta)).toBe(2);
    expect(resources.claim(resource, beta)).toBe(false);
    resources.release(alpha);
    expect(await take).toMatchObject({ held: true, owned: true });
    expect(resources.claim(resource, beta)).toBe(false);
    expect(seat.owns(alias, person)).toBe(true);
    expect(seat.release(alias, "wrong")).toBe(false);
    expect(seat.release(alias, person)).toBe(true);
    expect(resources.claim(resource, beta)).toBe(true);
    resources.release(beta);
    seat.close();
  });

  it("cancels a queued request without leaving a stale waiter", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const bot = { threadId: "alpha", generation: "one" };
    resources.claim(resource, bot);
    const cancellation = new AbortController();
    const take = seat.take(alias, person, cancellation.signal);
    expect(resources.waiting(resource)).toHaveLength(1);
    cancellation.abort();
    await expect(take).rejects.toThrow(/cancelled/);
    expect(resources.waiting(resource)).toHaveLength(0);
    resources.release(bot);
    expect(resources.claim(resource, { threadId: "beta", generation: "two" })).toBe(true);
    seat.close();
  });

  it("expires an abandoned human lease and releases its viewer", async () => {
    vi.useFakeTimers();
    const resources = new TurnResources();
    const released: string[] = [];
    const seat = new SharedVpsSeat(resources, new ComputerControl(), value => { released.push(value); });
    try {
      await seat.take(alias, person);
      expect(seat.owns(alias, person)).toBe(true);
      vi.advanceTimersByTime(9 * 60_000);
      seat.touchCurrent(alias);
      vi.advanceTimersByTime(9 * 60_000);
      expect(seat.owns(alias, person)).toBe(true);
      vi.advanceTimersByTime(60_001);
      expect(seat.owns(alias, person)).toBe(false);
      expect(resources.holder(resource)).toBeUndefined();
      expect(released).toEqual([alias]);
    } finally {
      seat.close();
      vi.useRealTimers();
    }
  });

  it("keeps the seat when a second take of the same lease was already waiting", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const bot = { threadId: "alpha", generation: "one" };
    resources.claim(resource, bot);
    const first = seat.take(alias, person, undefined, "session-one");
    const second = seat.take(alias, person, undefined, "session-one");
    expect(resources.waiting(resource)).toHaveLength(1);
    resources.release(bot);
    await expect(first).resolves.toMatchObject({ held: true, owned: true });
    await expect(second).resolves.toMatchObject({ held: true, owned: true, acquired: false });
    expect(seat.owns(alias, person, "session-one")).toBe(true);
    expect(resources.holder(resource)?.generation).toBe(person);
    expect(seat.release(alias, person, "session-one")).toBe(true);
    expect(resources.holder(resource)).toBeUndefined();
    seat.close();
  });

  it("does not let a different session's waiter drop the lease the first session won", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const bot = { threadId: "alpha", generation: "one" };
    resources.claim(resource, bot);
    const winner = seat.take(alias, person, undefined, "session-one");
    const other = seat.take(alias, person, undefined, "session-two");
    resources.release(bot);
    await expect(winner).resolves.toMatchObject({ held: true, owned: true });
    expect(seat.allows(alias, "session-two")).toBe(false);
    expect(seat.release(alias, person, "session-two")).toBe(false);
    expect(resources.holder(resource)?.generation).toBe(person);
    expect(seat.release(alias, person, "session-one")).toBe(true);
    await expect(other).resolves.toMatchObject({ held: true, owned: true });
    expect(seat.allows(alias, "session-two")).toBe(true);
    expect(seat.release(alias, person, "session-two")).toBe(true);
    seat.close();
  });

  it("does not let a different signed-in session release or view the current seat", async () => {
    const seat = new SharedVpsSeat(new TurnResources(), new ComputerControl());
    await seat.take(alias, person, undefined, "session-one");
    expect(seat.allows(alias, "session-one")).toBe(true);
    expect(seat.allows(alias, "session-two")).toBe(false);
    expect(seat.release(alias, person, "session-two")).toBe(false);
    expect(seat.owns(alias, person, "session-one")).toBe(true);
    expect(await seat.take(alias, person, undefined, "session-one")).toMatchObject({ held: true, owned: true, acquired: false });
    expect(seat.release(alias, person, "session-one")).toBe(true);
    seat.close();
  });

  it("keeps a confirmed seat when a retry's HTTP response closes", async () => {
    const seat = new SharedVpsSeat(new TurnResources(), new ComputerControl());
    await seat.take(alias, person, undefined, "one");
    expect(await seat.respond(alias, "take", person, "one", false, () => true, new AbortController().signal)).toBeNull();
    expect(seat.owns(alias, person, "one")).toBe(true);
    seat.close();
  });

  it("releases a newly acquired seat when nobody received its HTTP response", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    expect(await seat.respond(alias, "take", person, "one", false, () => true, new AbortController().signal)).toBeNull();
    expect(resources.holder(resource)).toBeUndefined();
    seat.close();
  });

  it("handles a hand-back before the take response settles", async () => {
    const seat = new SharedVpsSeat(new TurnResources(), new ComputerControl());
    const response = seat.respond(alias, "take", person, "one", false, () => false, new AbortController().signal);
    seat.release(alias, person, "one");
    expect((await response)?.status).toBe(409);
    expect(seat.owns(alias, person, "one")).toBe(false);
    seat.close();
  });

  it("does not leave a seat behind if the bot is reconfigured or its session revoked while waiting", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const bot = { threadId: "alpha", generation: "one" };
    resources.claim(resource, bot);
    let valid = true;
    const response = seat.respond(alias, "take", person, "one", false, () => false, new AbortController().signal, () => valid);
    valid = false;
    resources.release(bot);
    expect((await response)?.status).toBe(409);
    expect(resources.holder(resource)).toBeUndefined();
    seat.close();
  });

  it("keeps a successful duplicate response when the acquiring response closes", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const bot = { threadId: "alpha", generation: "one" };
    resources.claim(resource, bot);
    const first = seat.respond(alias, "take", person, "one", false, () => true, new AbortController().signal);
    const second = seat.respond(alias, "take", person, "one", false, () => false, new AbortController().signal);
    resources.release(bot);
    expect(await first).toBeNull();
    expect((await second)?.body.owned).toBe(true);
    expect(seat.owns(alias, person, "one")).toBe(true);
    seat.close();
  });

  it("preserves FIFO when one duplicate waiter is cancelled", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const alpha = { threadId: "alpha", generation: "one" };
    const beta = { threadId: "beta", generation: "two" };
    resources.claim(resource, alpha);
    const cancel = new AbortController();
    const first = seat.take(alias, person, cancel.signal, "one");
    const second = seat.take(alias, person, undefined, "one");
    resources.startWaiting(resource, beta);
    cancel.abort();
    await expect(first).rejects.toThrow(/cancelled/);
    expect(resources.waiting(resource)).toHaveLength(2);
    resources.release(alpha);
    expect(resources.claim(resource, beta)).toBe(false);
    await second;
    seat.release(alias, person, "one");
    expect(resources.claim(resource, beta)).toBe(true);
    resources.release(beta);
    seat.close();
  });

  it("reads a frame without taking, queueing, or renewing control", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    await seat.take(alias, person, undefined, "session-one");
    const epoch = seat.frame(alias).epoch;
    seat.note(alias, "observer:turn");
    expect(seat.frame(alias)).toEqual({ epoch, inputPermitted: false, recovering: false, controller: "person" });
    expect(resources.waiting(resource)).toHaveLength(0);
    expect(seat.owns(alias, person, "session-one")).toBe(true);
    expect(seat.admit(alias, "observer:turn", "operation")).toBe("recovering");
    expect(seat.frame(alias).recovering).toBe(false);
    expect(seat.owns(alias, person, "session-one")).toBe(true);
    seat.close();
  });

  it("rejects a mutation until this owner has a fresh observation, including one from the previous epoch", () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const first = { threadId: "alpha", generation: "one" };
    const second = { threadId: "beta", generation: "two" };
    resources.claim(resource, first);
    seat.note(alias, "alpha:one");
    expect(seat.admit(alias, "beta:two", "operation")).toBe("recovering");
    expect(seat.admit(alias, "alpha:one", "operation")).toBe("ok");
    seat.finish(alias, "alpha:one", "operation");
    resources.release(first);
    resources.claim(resource, second);
    expect(seat.admit(alias, "alpha:one", "operation")).toBe("recovering");
    expect(seat.admit(alias, "beta:two", "operation")).toBe("stale");
    seat.note(alias, "beta:two");
    expect(seat.admit(alias, "beta:two", "operation")).toBe("ok");
    seat.finish(alias, "beta:two", "operation");
    resources.release(second);
    seat.close();
  });

  it("does not hand the desktop to the next owner while a mutation is still out", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    const alpha = { threadId: "alpha", generation: "one" };
    resources.claim(resource, alpha);
    seat.note(alias, "alpha:one");
    expect(seat.admit(alias, "alpha:one", "operation")).toBe("ok");
    let settled = false;
    const next = seat.take(alias, person).then((result) => { settled = true; return result; });
    resources.release(alpha);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(seat.recovering(alias)).toBe(true);
    expect(resources.holder(resource)?.threadId).toBe(`shared-vps-recovery:${alias}`);
    expect(seat.finish(alias, "other:turn", "operation")).toBeUndefined();
    expect(seat.recovering(alias)).toBe(true);
    expect(settled).toBe(false);
    seat.finish(alias, "alpha:one", "operation");
    await expect(next).resolves.toMatchObject({ held: true, owned: true });
    expect(seat.recovering(alias)).toBe(false);
    seat.close();
  });

  it("keeps each owner's look and retains unknown-operation recovery barriers", async () => {
    vi.useFakeTimers();
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    try {
      const alpha = { threadId: "alpha", generation: "one" };
      const beta = { threadId: "beta", generation: "two" };
      resources.claim(resource, alpha);
      seat.note(alias, "alpha:one");
      seat.note(alias, "beta:two");
      expect(seat.admit(alias, "alpha:one", "operation-alpha")).toBe("ok");
      resources.release(alpha);
      expect(seat.recovering(alias)).toBe(true);
      vi.advanceTimersByTime(45_000);
      // A timed-out reply is still an unknown outcome; only explicit recovery may clear its journal barrier.
      expect(seat.recovering(alias)).toBe(true);
      await seat.recover(alias, async () => {});
      expect(seat.recovering(alias)).toBe(false);
      resources.claim(resource, beta);
      expect(seat.admit(alias, "beta:two", "operation-beta")).toBe("stale");
      seat.note(alias, "beta:two");
      expect(seat.admit(alias, "beta:two", "operation-beta-2")).toBe("ok");
      seat.finish(alias, "beta:two", "operation-beta-2");
      resources.release(beta);
    } finally {
      seat.close();
      vi.useRealTimers();
    }
  });

  it("releases only the revoked session's seat", async () => {
    const resources = new TurnResources();
    const seat = new SharedVpsSeat(resources, new ComputerControl());
    await seat.take(alias, person, undefined, "session-one");
    seat.releaseSession("session-two");
    expect(seat.owns(alias, person, "session-one")).toBe(true);
    seat.releaseSession("session-one");
    expect(seat.owns(alias, person, "session-one")).toBe(false);
    expect(resources.holder(resource)).toBeUndefined();
    seat.close();
  });
});
