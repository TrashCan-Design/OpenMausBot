import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./config.ts";
import { ComputerControl } from "./computer-control.ts";
import { TurnResources } from "./turn-resources.ts";
import { SharedVpsJournal } from "./shared-vps-journal.ts";
import { SharedVpsSeat } from "./shared-vps-seat.ts";
import { SharedVpsGateway } from "./shared-vps-gateway.ts";
import { recoverSharedVps } from "./shared-vps-host.ts";
const fake = vi.hoisted(() => ({ status: vi.fn(), action: vi.fn(), runner: vi.fn() }));
vi.mock("./vps-computer.ts", async importOriginal => ({ ...await importOriginal<typeof import("./vps-computer.ts")>(), vpsComputerStatus: fake.status, vpsComputerAction: fake.action, defaultRunner: fake.runner }));
const container = "a".repeat(64), alias = "gcp";
const config = { vps: { sshAlias: alias } } as AppConfig;
const gateways: SharedVpsGateway[] = [];
beforeEach(() => {
  let running = true;
  fake.status.mockImplementation(async () => ({ container_id: container, managed: true, ready: running, container: running ? "running" : "stopped" }));
  fake.runner.mockResolvedValue({ stdout: "", stderr: "" });
  fake.action.mockImplementation(async (action, _cfg, _owner, runner) => {
    await runner(["-H", `ssh://${alias}`, action, container], {});
    running = action !== "stop"; return fake.status();
  });
});
afterEach(async () => { await Promise.all(gateways.splice(0).map(gateway => gateway.close())); vi.resetAllMocks(); });
function fixture(target = container) {
  const journal = new SharedVpsJournal(); journal.add({ id: "abandoned", alias, owner: "bot:old-turn", target });
  const seat = new SharedVpsSeat(new TurnResources(), new ComputerControl(), () => {}, journal);
  const gateway = new SharedVpsGateway(seat, () => { throw new Error("Recovery must not dispatch tools"); }); gateways.push(gateway);
  return { seat, gateway };
}
describe("shared desktop recovery lifecycle", () => {
  it("stops and starts the same managed container without deleting files or publishing ports", async () => {
    const f = fixture(); await recoverSharedVps(f.gateway, f.seat, config, alias);
    expect(fake.runner.mock.calls.map(([args]) => args)).toEqual([["-H", "ssh://gcp", "stop", container], ["-H", "ssh://gcp", "start", container]]);
    expect(f.seat.unresolved(alias)).toEqual([]); expect(f.seat.recovering(alias)).toBe(false);
  });
  it("keeps the journal blocked if SSH fails before stop is confirmed", async () => {
    const f = fixture(); fake.runner.mockRejectedValue(new Error("SSH lost"));
    await expect(recoverSharedVps(f.gateway, f.seat, config, alias)).rejects.toThrow("SSH lost");
    expect(fake.runner).toHaveBeenCalledTimes(1); expect(f.seat.recovering(alias)).toBe(true); expect(f.seat.unresolved(alias).length).toBeGreaterThan(0);
  });
  it("refuses recovery of an identity different from the abandoned action", async () => {
    const f = fixture("b".repeat(64));
    await expect(recoverSharedVps(f.gateway, f.seat, config, alias)).rejects.toThrow("different container");
    expect(fake.runner).not.toHaveBeenCalled(); expect(f.seat.recovering(alias)).toBe(true);
  });
  it("rechecks identity before sending any lifecycle command", async () => {
    const f = fixture(); fake.status.mockResolvedValueOnce({ container_id: container, managed: true, ready: true, container: "running" }).mockResolvedValue({ container_id: "b".repeat(64), managed: true, ready: true, container: "running" });
    await expect(recoverSharedVps(f.gateway, f.seat, config, alias)).rejects.toThrow("identity changed");
    expect(fake.runner).not.toHaveBeenCalled(); expect(f.seat.recovering(alias)).toBe(true);
  });
});
