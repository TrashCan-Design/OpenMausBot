import { randomUUID } from "node:crypto";
import type { SharedVpsSeat } from "./shared-vps-seat.ts";
import { SHARED_FRESH_OBSERVATION } from "./shared-vps.ts";
import { compileToolSchema } from "./mcp-schema-validator.ts";

type Json = Record<string, unknown>;
export interface SharedVpsTarget { alias: string; container: string }
export interface SharedVpsBackend {
  tools(signal: AbortSignal): Promise<unknown[]>;
  call(method: string, params: unknown, signal: AbortSignal, timeout: number): Promise<unknown>;
  close(): Promise<void>;
}
export interface SharedVpsCaller {
  owner: string;
  active(): boolean;
  claim(): Promise<void>;
}
type Connection = { key: string; backend: SharedVpsBackend; tools: Promise<unknown[]>; timer?: ReturnType<typeof setTimeout> };
type Frame = { result: Json; at: number; epoch: number; owner: string | null };
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const failure = (text: string): Json => ({ isError: true, content: [{ type: "text", text }] });

/** Only the server dispatches shared actions and acknowledges their results. Agent callbacks cannot release a writer. */
export class SharedVpsGateway {
  private readonly seat: SharedVpsSeat;
  private readonly connect: (target: SharedVpsTarget) => SharedVpsBackend;
  private readonly connections = new Map<string, Connection>();
  private readonly captures = new Map<string, Promise<Frame>>();
  private readonly cached = new Map<string, Frame>();
  private readonly recovery = new Set<string>();
  private readonly writing = new Set<string>();
  private activeCalls = 0;
  private readers = 0;
  private closed = false;
  constructor(seat: SharedVpsSeat, connect: (target: SharedVpsTarget) => SharedVpsBackend) { this.seat = seat; this.connect = connect; }

  private key(target: SharedVpsTarget): string { return JSON.stringify([target.alias, target.container]); }
  private connection(target: SharedVpsTarget, observing = false): Connection {
    if (this.closed) throw new Error("Shared desktop gateway is stopping");
    const key = this.key(target) + (observing ? ":observe" : ":control");
    const found = this.connections.get(key);
    if (found) { this.touch(target, found); return found; }
    if (this.connections.size >= 32) throw new Error("Too many shared desktop connections");
    const backend = this.connect(target);
    const entry = { key, backend, tools: backend.tools(AbortSignal.timeout(30_000)) };
    this.connections.set(key, entry);
    this.touch(target, entry);
    void entry.tools.catch(() => this.retire(target, entry));
    return entry;
  }
  private touch(target: SharedVpsTarget, entry: Connection): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (this.writing.has(target.alias) || this.captures.has(this.key(target))) this.touch(target, entry);
      else void this.retire(target, entry);
    }, 10 * 60_000);
    entry.timer.unref?.();
  }
  private async retire(target: SharedVpsTarget, entry: Connection): Promise<void> {
    const key = entry.key;
    if (this.connections.get(key) !== entry) return;
    clearTimeout(this.connections.get(key)?.timer);
    this.connections.delete(key);
    this.cached.delete(this.key(target));
    await entry.backend.close().catch(() => {});
  }
  private async capture(target: SharedVpsTarget): Promise<Frame> {
    if (this.closed) throw new Error("Shared desktop gateway is stopping");
    const key = this.key(target);
    const cached = this.cached.get(key);
    if (cached && Date.now() - cached.at < 500 && cached.epoch === this.seat.version(target.alias)) return cached;
    const pending = this.captures.get(key);
    if (pending) return pending;
    const epoch = this.seat.version(target.alias), owner = this.seat.currentOwner(target.alias);
    const entry = this.connection(target, true);
    const work = (async () => {
      await entry.tools;
      const at = Date.now();
      const result = await entry.backend.call("tools/call", { name: "get_desktop_state", arguments: {} }, AbortSignal.timeout(15_000), 15_000);
      if (!object(result) || result.isError === true || !Array.isArray(result.content) ||
          !result.content.some(part => object(part) && part.type === "image" && typeof part.data === "string" && part.data.length > 0 && /^image\/(png|jpeg)$/.test(String(part.mimeType)))) throw new Error("The shared desktop observation returned no screen image");
      const frame = { result, at, epoch, owner };
      this.cached.set(key, frame);
      return frame;
    })();
    this.captures.set(key, work);
    try { return await work; }
    catch (error) { await this.retire(target, entry); throw error; }
    finally { if (this.captures.get(key) === work) this.captures.delete(key); }
  }
  async observe(target: SharedVpsTarget, caller?: SharedVpsCaller): Promise<Frame> {
    if (caller && !caller.active()) throw new Error("This bot turn ended");
    if (this.readers >= 128) throw new Error("Too many desktop observers; try again shortly");
    this.readers++;
    try {
      const frame = await this.capture(target);
      if (caller) {
        if (!caller.active()) throw new Error("This bot turn ended");
        if (frame.owner === caller.owner) this.seat.note(target.alias, caller.owner, frame.epoch);
      }
      return frame;
    } finally { this.readers--; }
  }

  async rpc(target: SharedVpsTarget, caller: SharedVpsCaller, raw: unknown): Promise<unknown> {
    if (!caller.active()) throw new Error("This bot turn ended");
    if (!object(raw) || raw.jsonrpc !== "2.0" || typeof raw.method !== "string" ||
        (raw.id !== undefined && typeof raw.id !== "number" && typeof raw.id !== "string") || (typeof raw.id === "number" && !Number.isFinite(raw.id))) throw new Error("Invalid shared desktop RPC");
    if (raw.method === "initialize") return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "OpenBot shared desktop", version: "1" } };
    if (raw.method === "notifications/initialized" || raw.method === "notifications/cancelled") return {};
    if (raw.method === "ping") return {};
    if (raw.method === "tools/list") {
      const tools = await this.connection(target).tools;
      if (!caller.active()) throw new Error("This bot turn ended");
      return { tools };
    }
    if (raw.method !== "tools/call" || raw.id === undefined || !object(raw.params) || typeof raw.params.name !== "string" ||
        !object(raw.params.arguments ?? {})) throw new Error("Unsupported shared desktop RPC");
    const name = raw.params.name, args = raw.params.arguments ?? {};
    if (name === "get_desktop_state" && Object.keys(args).length === 0) return (await this.observe(target, caller)).result;
    if (this.recovery.has(target.alias) || this.seat.recovering(target.alias)) return failure("The shared desktop needs recovery before further changes.");
    if (this.activeCalls >= 32) return failure("Too many shared desktop requests. Retry after current work settles.");
    this.activeCalls += 1;
    let writing = false;
    try {
      await caller.claim();
      if (!caller.active()) throw new Error("This bot turn ended");
      const entry = this.connection(target);
      const tools = await entry.tools;
      if (!caller.active()) throw new Error("This bot turn ended");
      const tool = tools.find(tool => object(tool) && tool.name === name);
      if (!object(tool) || !object(tool.inputSchema)) return failure("Unknown shared desktop tool");
      try { if (!compileToolSchema(tool.inputSchema)(args)) return failure("Invalid shared desktop tool arguments"); }
      catch { return failure("The shared desktop tool schema could not be validated"); }
      if (this.writing.has(target.alias)) return failure("Another desktop action is still running. Wait for its result before making a change.");
      const id = randomUUID();
      const admitted = this.seat.admit(target.alias, caller.owner, id, target.container);
      if (admitted !== "ok") return failure(admitted === "stale" ? SHARED_FRESH_OBSERVATION : "The shared desktop is recovering.");
      this.writing.add(target.alias); writing = true;
      let result: unknown;
      try {
        result = await entry.backend.call("tools/call", { name, arguments: args }, AbortSignal.timeout(300_000), 300_000);
        if (!object(result) || !Array.isArray(result.content)) throw new Error("Invalid desktop action result");
        this.seat.finish(target.alias, caller.owner, id);
        this.cached.delete(this.key(target));
      } catch (error) {
        this.seat.block(target.alias);
        await this.retire(target, entry);
        throw new Error(`The desktop action outcome may be unknown. It will not be replayed. ${error instanceof Error ? error.message : "Transport failed"}`);
      }
      if (!caller.active()) throw new Error("This bot turn ended after its action completed");
      return result;
    } finally { this.activeCalls -= 1; if (writing) this.writing.delete(target.alias); }
  }
  async recover(target: SharedVpsTarget, stopAndStart: () => Promise<void>): Promise<void> {
    if (this.recovery.has(target.alias)) throw new Error("Recovery is already running");
    const owner = this.seat.currentOwner(target.alias);
    if (owner && !owner.startsWith("shared-vps-recovery:") && !owner.startsWith("shared-vps-person:")) throw new Error("Stop the active bot turn before recovering its desktop");
    this.recovery.add(target.alias);
    try {
      for (const entry of this.connections.values()) if (entry.key.startsWith(this.key(target) + ":")) await this.retire(target, entry);
      this.cached.delete(this.key(target));
      this.captures.delete(this.key(target));
      await this.seat.recover(target.alias, stopAndStart);
    } finally { this.recovery.delete(target.alias); }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.connections.values()) clearTimeout(entry.timer);
    await Promise.allSettled([...this.connections.values()].map(entry => entry.backend.close()));
    this.connections.clear(); this.cached.clear(); this.captures.clear();
  }
}
