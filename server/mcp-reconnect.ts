import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { killCliTree, spawnCli } from "./procs.ts";

type Frame = { id?: string | number | null; method?: string; params?: unknown; result?: { protocolVersion?: string; isError?: boolean }; error?: unknown };
const OBSERVATIONS = new Set(["get_desktop_state", "get_window_state"]);
const PROCESS_STOP_MS = 5_000;

export interface McpProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export class ReconnectingMcp extends EventEmitter implements McpProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private child: ReturnType<typeof spawnCli> | null = null;
  private readonly pending = new Map<string, Frame>();
  private initialize: Frame | null = null;
  private protocolVersion: string | undefined;
  private initialized = false;
  private notified = false;
  private ready = true;
  private ending = false;
  private ended = false;
  private needsObservation = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeId: string | null = null;
  private readonly command: string;
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly delays: readonly number[];
  private readonly handshakeMs: number;
  private readonly stop: typeof killCliTree;

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, options: { delays?: readonly number[]; handshakeMs?: number; stop?: typeof killCliTree } = {}) {
    super();
    this.command = command; this.args = args; this.env = env;
    this.delays = options.delays ?? [250, 1_000, 2_000];
    this.handshakeMs = options.handshakeMs ?? 10_000;
    this.stop = options.stop ?? killCliTree;
    const input = createInterface({ input: this.stdin, crlfDelay: Infinity });
    input.on("line", line => this.send(line));
    input.on("close", () => {
      this.ending = true;
      clearTimeout(this.retryTimer);
      if (this.child) this.child.stdin.end();
      else this.finish(0);
    });
    this.connect(false);
  }

  private answer(frame: Frame, text: string): void {
    if (frame.id === undefined) return;
    this.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...(frame.method === "tools/call"
      ? { result: { isError: true, content: [{ type: "text", text }] } }
      : { error: { code: -32000, message: text } }) }) + "\n");
  }

  private send(line: string): void {
    let frame: Frame;
    try { frame = JSON.parse(line); } catch { if (this.ready) this.child?.stdin.write(line + "\n"); return; }
    if (!frame || typeof frame !== "object") return;
    if (frame.method === "notifications/initialized") this.notified = true;
    if (!this.ready || !this.child) {
      if (!this.child && !this.retryTimer && !this.ending && this.initialized) { this.retry = 0; this.schedule(); }
      this.answer(frame, "The VPS desktop transport is reconnecting. This request was not performed. Retry with a fresh desktop inspection once it reconnects.");
      return;
    }
    const name = (frame.params as { name?: string } | undefined)?.name;
    if (frame.method === "tools/call" && this.needsObservation && !OBSERVATIONS.has(name ?? "")) {
      this.answer(frame, "The VPS desktop reconnected. This call was not performed. Read get_desktop_state or get_window_state before acting again; an earlier interrupted action may have completed.");
      return;
    }
    if (frame.method === "initialize") this.initialize = frame;
    if (frame.id !== undefined && frame.method) this.pending.set(JSON.stringify(frame.id), frame);
    this.child.stdin.write(line + "\n");
  }

  private connect(recovering: boolean): void {
    if (this.ending || this.ended) return;
    this.retryTimer = undefined;
    let child: ReturnType<typeof spawnCli>;
    try { child = spawnCli(this.command, this.args, { shell: false, env: this.env, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) {
      this.ready = false;
      this.stderr.write(`VPS desktop transport could not start: ${error instanceof Error ? error.message : String(error)}\n`);
      queueMicrotask(() => { if (this.initialized || this.initialize) this.schedule(); else this.finish(1); });
      return;
    }
    this.child = child;
    this.ready = !recovering;
    child.stdin.on("error", () => {});
    child.stderr.pipe(this.stderr, { end: false });
    const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    output.on("line", line => {
      if (this.child !== child || this.ended || (!this.ready && !this.handshakeId)) return;
      let frame: Frame;
      try { frame = JSON.parse(line); } catch { this.reconnect(); return; }
      if (!frame || typeof frame !== "object") return;
      if (this.handshakeId && frame.id === this.handshakeId) {
        clearTimeout(this.handshakeTimer);
        this.handshakeId = null;
        if (frame.error || !frame.result || typeof frame.result.protocolVersion !== "string" || (this.initialized && frame.result.protocolVersion !== this.protocolVersion)) { this.reconnect(); return; }
        if (!this.initialized) {
          this.initialized = true;
          this.protocolVersion = frame.result.protocolVersion;
          this.pending.delete(JSON.stringify(this.initialize!.id));
          this.stdout.write(JSON.stringify({ ...frame, id: this.initialize!.id }) + "\n");
        }
        if (this.notified) child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
        this.ready = true;
        this.retry = 0;
        return;
      }
      const request = this.pending.get(JSON.stringify(frame.id));
      if (request) {
        this.pending.delete(JSON.stringify(frame.id));
        if (request.method === "initialize" && frame.result && !frame.error) {
          this.initialized = true;
          this.protocolVersion = frame.result.protocolVersion;
        }
        const name = (request.params as { name?: string } | undefined)?.name;
        if (request.method === "tools/call" && OBSERVATIONS.has(name ?? "") && frame.result && !frame.result.isError && !frame.error) this.needsObservation = false;
      }
      this.stdout.write(line + "\n");
    });
    child.on("error", error => { if (!this.ended) this.stderr.write(`VPS desktop transport: ${error.message}\n`); });
    child.on("close", async (code, signal) => {
      if (this.child !== child) return;
      child.stderr.unpipe(this.stderr);
      clearTimeout(this.handshakeTimer);
      this.ready = false; this.handshakeId = null;
      const retryInitialize = !this.initialized && this.initialize !== null && !this.ending;
      this.failPending(retryInitialize);
      const stopped = await this.stop(child, PROCESS_STOP_MS).catch(() => false);
      if (this.child !== child || this.ended) return;
      this.child = null;
      if (!stopped) this.stderr.write("VPS desktop process cleanup could not be verified; recovery stopped.\n");
      if (!stopped || this.ending || (!this.initialized && !retryInitialize)) this.finish(stopped ? code ?? 1 : 1, signal);
      else { this.needsObservation = true; this.schedule(); }
    });
    if (recovering && this.initialize) {
      this.handshakeId = `openbot-reconnect-${randomUUID()}`;
      child.stdin.write(JSON.stringify({ ...this.initialize, id: this.handshakeId }) + "\n");
      this.handshakeTimer = setTimeout(() => this.reconnect(), this.handshakeMs);
    }
  }

  private failPending(keepInitialize = false): void {
    for (const [id, frame] of this.pending) {
      if (keepInitialize && frame.method === "initialize") continue;
      this.answer(frame, "The VPS desktop connection was interrupted. This request will not be replayed; its outcome is unknown. Wait for reconnection and inspect the desktop before continuing.");
      this.pending.delete(id);
    }
  }

  private schedule(): void {
    if (this.ending || this.ended || this.retryTimer) return;
    if (this.retry >= this.delays.length) {
      if (!this.initialized) { this.failPending(); this.finish(1); }
      return;
    }
    this.retryTimer = setTimeout(() => this.connect(true), this.delays[this.retry++]!);
  }

  reconnect(): void {
    if (this.ending || this.ended) return;
    this.ready = false; this.needsObservation = true;
    this.handshakeId = null; clearTimeout(this.handshakeTimer);
    this.failPending(!this.initialized && this.initialize !== null);
    if (this.child) this.stopChild(this.child);
    else this.schedule();
  }

  private stopChild(child: ReturnType<typeof spawnCli>): void {
    void this.stop(child, PROCESS_STOP_MS).catch(() => false).then(stopped => {
      if (stopped || this.child !== child || this.ended) return;
      this.stderr.write("VPS desktop process cleanup could not be verified; recovery stopped.\n");
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      this.child = null;
      this.finish(1);
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.ending = true;
    this.ready = false; this.handshakeId = null;
    clearTimeout(this.retryTimer); clearTimeout(this.handshakeTimer);
    if (!this.child) { this.finish(0, signal); return true; }
    this.stopChild(this.child);
    return true;
  }

  private finish(code: number, signal: NodeJS.Signals | null = null): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.retryTimer); clearTimeout(this.handshakeTimer);
    this.failPending();
    this.stdin.destroy(); this.stdout.end(); this.stderr.end();
    this.emit("close", code, signal);
  }
}
