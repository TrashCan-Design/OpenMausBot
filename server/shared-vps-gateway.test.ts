import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerControl } from "./computer-control.ts";
import { TurnResources } from "./turn-resources.ts";
import { SharedVpsSeat } from "./shared-vps-seat.ts";
import { SharedVpsJournal } from "./shared-vps-journal.ts";
import { SharedVpsGateway, type SharedVpsBackend } from "./shared-vps-gateway.ts";
import { sharedVpsResource } from "./shared-vps.ts";

const target = { alias: "gcp", container: "a".repeat(64) };
const resource = sharedVpsResource(target.alias);
const screen = { content: [{ type: "image", data: "fixture", mimeType: "image/png" }] };
const dirs: string[] = [];
const gateways: SharedVpsGateway[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(gateways.splice(0).map(gateway => gateway.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(call?: SharedVpsBackend["call"], file?: string) {
  const resources = new TurnResources(), seat = new SharedVpsSeat(resources, new ComputerControl(), () => {}, new SharedVpsJournal(file));
  const calls: string[] = [];
  const backend: SharedVpsBackend = {
    tools: async () => [{ name: "click", inputSchema: { type: "object", additionalProperties: false } }, { name: "get_desktop_state", inputSchema: { type: "object", additionalProperties: false } }],
    call: async (method, params, signal, timeout) => {
      calls.push((params as { name: string }).name);
      return call ? call(method, params, signal, timeout) : { content: [{ type: "image", data: "fixture", mimeType: "image/png" }] };
    }, close: async () => {},
  };
  const gateway = new SharedVpsGateway(seat, () => backend); gateways.push(gateway);
  const owner = (id: string) => {
    const record = { threadId: id, generation: "turn" }; let active = true;
    return { record, stop: () => { active = false; resources.release(record); }, caller: {
      owner: `${id}:turn`, active: () => active, claim: async () => { if (!resources.claim(resource, record)) throw new Error("Busy"); },
    } };
  };
  const rpc = (caller: ReturnType<typeof owner>["caller"], name: string, id: string | number = 1) => gateway.rpc(target, caller, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
  return { gateway, seat, resources, owner, rpc, calls };
}

describe("server-owned shared desktop", () => {
  it("isolates a failed observation transport from an active writer", async () => {
    const resources = new TurnResources(), seat = new SharedVpsSeat(resources, new ComputerControl());
    const closed: number[] = []; let index = 0, reads = 0, complete!: (value: unknown) => void;
    const gateway = new SharedVpsGateway(seat, () => {
      const client = index++;
      return { tools: async () => [{ name: "click", inputSchema: { type: "object" } }], close: async () => { closed.push(client); },
        call: async (_method, params) => {
          if ((params as { name: string }).name === "get_desktop_state") { if (++reads > 1) throw new Error("Read channel disconnected"); return screen; }
          return new Promise(resolve => { complete = resolve; });
        } };
    }); gateways.push(gateway);
    const record = { threadId: "a", generation: "turn" };
    resources.claim(resource, record);
    const caller = { owner: "a:turn", active: () => true, claim: async () => {} };
    await gateway.observe(target, caller);
    const action = gateway.rpc(target, caller, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "click" } });
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    await expect(gateway.observe(target)).rejects.toThrow("Read channel");
    expect(closed).toEqual([0]); expect(seat.unresolved("gcp")).toHaveLength(1);
    complete({ content: [] }); await expect(action).resolves.toEqual({ content: [] });
    expect(seat.recovering("gcp")).toBe(false);
  });
  it("refuses overlapping writes from the same owner while allowing observation", async () => {
    let complete!: (value: unknown) => void;
    const f = fixture(async (_method, params) => (params as { name: string }).name === "click" ? new Promise(resolve => { complete = resolve; }) : screen);
    const a = f.owner("a"); await a.caller.claim(); await f.rpc(a.caller, "get_desktop_state");
    const first = f.rpc(a.caller, "click", "one"); await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    expect(await f.rpc(a.caller, "click", "two")).toHaveProperty("isError", true);
    await f.rpc(a.caller, "get_desktop_state"); expect(f.calls.filter(name => name === "click")).toHaveLength(1);
    complete({ content: [] }); await first;
  });
  it("never dispatches malformed arguments even with a live owner and fresh screen", async () => {
    const f = fixture(), a = f.owner("a"); await a.caller.claim(); await f.rpc(a.caller, "get_desktop_state");
    expect(await f.gateway.rpc(target, a.caller, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "click", arguments: { extra: true } } })).toHaveProperty("isError", true);
    expect(f.calls).toEqual(["get_desktop_state"]); expect(f.seat.unresolved("gcp")).toHaveLength(0);
  });
  it("coalesces observers, and their reads cannot invalidate the controller", async () => {
    const f = fixture(), a = f.owner("a"), b = f.owner("b");
    await a.caller.claim();
    await Promise.all([f.rpc(a.caller, "get_desktop_state"), f.rpc(b.caller, "get_desktop_state")]);
    expect(f.calls).toEqual(["get_desktop_state"]);
    expect(f.resources.waiting(resource)).toHaveLength(0);
    await expect(f.rpc(a.caller, "click")).resolves.toHaveProperty("content");
    expect(f.calls).toEqual(["get_desktop_state", "click"]);
  });
  it("requires inspection after acquisition, not the prior unowned observation", async () => {
    const f = fixture(), a = f.owner("a");
    await f.rpc(a.caller, "get_desktop_state");
    expect(await f.rpc(a.caller, "click")).toMatchObject({ isError: true });
    expect(f.calls).toEqual(["get_desktop_state"]);
    await f.rpc(a.caller, "get_desktop_state");
    await f.rpc(a.caller, "click");
    expect(f.calls).toEqual(["get_desktop_state", "get_desktop_state", "click"]);
  });
  it("does not let the next owner overlap an admitted action", async () => {
    let complete!: (value: unknown) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    const f = fixture(async (_method, params) => (params as { name: string }).name === "click" ? pending : screen);
    const a = f.owner("a"), b = f.owner("b"); await a.caller.claim(); await f.rpc(a.caller, "get_desktop_state");
    const action = f.rpc(a.caller, "click"); await new Promise(resolve => setTimeout(resolve, 0));
    a.stop(); expect(f.seat.recovering("gcp")).toBe(true);
    await expect(b.caller.claim()).rejects.toThrow("Busy");
    complete({ content: [] }); await expect(action).rejects.toThrow();
    expect(f.seat.unresolved("gcp")).toHaveLength(0);
    expect(f.seat.recovering("gcp")).toBe(false);
    await expect(b.caller.claim()).resolves.toBeUndefined();
  });
  it("persists unknown outcomes through restart and only clears after verified stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openbot-ops-")); dirs.push(dir); const file = join(dir, "ops.json");
    const f = fixture(async (_method, params) => { if ((params as { name: string }).name === "click") throw new Error("SSH lost"); return screen; }, file);
    const a = f.owner("a"); await a.caller.claim(); await f.rpc(a.caller, "get_desktop_state");
    await expect(f.rpc(a.caller, "click")).rejects.toThrow("unknown"); a.stop();
    expect(JSON.parse(readFileSync(file, "utf8")).operations).toHaveLength(1);
    const restarted = fixture(undefined, file);
    await expect(restarted.owner("b").caller.claim()).rejects.toThrow("Busy");
    await expect(restarted.gateway.recover(target, async () => { throw new Error("stop failed"); })).rejects.toThrow("stop failed");
    expect(restarted.seat.recovering("gcp")).toBe(true);
    await restarted.gateway.recover(target, async () => {});
    expect(restarted.seat.unresolved("gcp")).toHaveLength(0);
    await expect(restarted.owner("b").caller.claim()).resolves.toBeUndefined();
  });
  it("does not acknowledge operations from forged phase notifications or RPC notifications", async () => {
    const f = fixture(), a = f.owner("a");
    await expect(f.gateway.rpc(target, a.caller, { jsonrpc: "2.0", id: 1, method: "phase=end" })).rejects.toThrow("Unsupported");
    await expect(f.gateway.rpc(target, a.caller, { jsonrpc: "2.0", method: "tools/call", params: { name: "click" } })).rejects.toThrow("Unsupported");
    expect(f.calls).toHaveLength(0);
  });
  it("does not return observations to a turn revoked during capture", async () => {
    let finish!: (value: unknown) => void;
    const f = fixture(() => new Promise(resolve => { finish = resolve; })), a = f.owner("a");
    const observation = f.rpc(a.caller, "get_desktop_state"); await new Promise(resolve => setTimeout(resolve, 0));
    a.stop(); finish(screen); await expect(observation).rejects.toThrow("ended");
  });
  it("rejects a corrupt journal rather than opening an unsafe desktop", () => {
    const dir = mkdtempSync(join(tmpdir(), "openbot-ops-bad-")); dirs.push(dir); const file = join(dir, "ops.json"); writeFileSync(file, "broken");
    expect(() => new SharedVpsJournal(file)).toThrow();
  });
  it("counts unique operations and ignores duplicate acknowledgements", () => {
    const f = fixture(), a = f.owner("a"); f.resources.claim(resource, a.record); f.seat.note("gcp", a.caller.owner);
    expect(f.seat.admit("gcp", a.caller.owner, "one")).toBe("ok"); expect(f.seat.admit("gcp", a.caller.owner, "two")).toBe("ok");
    f.seat.finish("gcp", a.caller.owner, "one"); f.seat.finish("gcp", a.caller.owner, "one"); a.stop();
    expect(f.seat.recovering("gcp")).toBe(true); expect(f.seat.unresolved("gcp")).toHaveLength(1);
    f.seat.finish("gcp", a.caller.owner, "two"); expect(f.seat.unresolved("gcp")).toHaveLength(0);
  });
});
