import { DATA_DIR, type AppConfig } from "./config.ts";
import { augmentedPath } from "./env-path.ts";
import { ChatMcpClient } from "./drivers/chat-mcp-tools.ts";
import { prepareVpsSsh } from "./vps-ssh.ts";
import { SharedVpsGateway, type SharedVpsTarget } from "./shared-vps-gateway.ts";
import type { SharedVpsSeat } from "./shared-vps-seat.ts";
import { sharedVpsOwnerId } from "./shared-vps.ts";
import * as vps from "./vps-computer.ts";
import type { BotRecord } from "./store.ts";

export async function drainSharedVpsViewers(alias: string, bots: readonly BotRecord[], aliasFor: (bot: BotRecord) => string | null, viewer: { drainForTarget(id: string): Promise<void> }): Promise<void> {
  await Promise.all(bots.filter(bot => bot.cloudBackend === "vps" && bot.vpsDesktopMode === "shared" && aliasFor(bot) === alias).map(bot => viewer.drainForTarget(`vps/${bot.id}`)));
  vps.stopDesktopTunnel(sharedVpsOwnerId(alias));
}

export function createSharedVpsGateway(seat: SharedVpsSeat): SharedVpsGateway {
  return new SharedVpsGateway(seat, target => {
    const ssh = prepareVpsSsh(DATA_DIR, augmentedPath());
    return new ChatMcpClient({ command: "docker", args: vps.vpsContainerMcpArgs(target.alias, target.container), env: { PATH: ssh.path } }, true);
  });
}

export function executeSharedVpsRpc(gateway: SharedVpsGateway, capability: { threadId: string; generation: string; sharedVps?: SharedVpsTarget }, body: unknown, active: () => boolean, claim: () => Promise<void>): Promise<unknown> {
  if (!capability.sharedVps) throw Object.assign(new Error("No shared desktop capability"), { status: 403 });
  return gateway.rpc(capability.sharedVps, { owner: `${capability.threadId}:${capability.generation}`, active, claim }, body);
}

export async function sharedVpsPreview(gateway: SharedVpsGateway, target: SharedVpsTarget, active: () => boolean = () => true) {
  const frame = await gateway.observe(target);
  if (!active()) throw Object.assign(new Error("Viewer access ended"), { status: 401 });
  const content = frame.result.content as Array<{ type?: string; data?: string; mimeType?: string }>;
  const image = content.find(part => part.type === "image" && typeof part.data === "string" && /^image\/(png|jpeg)$/.test(part.mimeType ?? ""));
  if (!image) throw new Error("Cua returned no desktop image");
  return { png: image.data!, format: image.mimeType === "image/jpeg" ? "jpeg" : "png", capturedAt: frame.at, epoch: frame.epoch, inputPermitted: false };
}

export async function recoverSharedVps(gateway: SharedVpsGateway, seat: SharedVpsSeat, cfg: AppConfig, alias: string): Promise<void> {
  const config = { ...cfg, vps: { sshAlias: alias } }, owner = sharedVpsOwnerId(alias);
  const status = await vps.vpsComputerStatus(config, owner);
  const container = status.container_id;
  if (!container || !status.managed) throw new Error("The managed desktop identity could not be verified");
  if (seat.unresolved(alias).some(row => row.target && row.target !== container)) throw new Error("The unresolved action names a different container; reconcile it before recovery");
  const pinnedRunner: vps.VpsCommandRunner = (args, options) => {
    const action = args[2];
    if ((action === "stop" || action === "start") && args[3] !== container) throw new Error("The desktop identity changed during recovery");
    return vps.defaultRunner(args, options);
  };
  await gateway.recover({ alias, container }, async () => {
    const current = await vps.vpsComputerStatus(config, owner, pinnedRunner);
    if (current.container_id !== container) throw new Error("The desktop identity changed during recovery");
    const stopped = current.container === "stopped" ? current : await vps.vpsComputerAction("stop", config, owner, pinnedRunner);
    if (stopped.container_id !== container || stopped.container !== "stopped") throw new Error("The old desktop was not confirmed stopped");
    const started = await vps.vpsComputerAction("start", config, owner, pinnedRunner);
    if (started.container_id !== container || !started.ready) throw new Error("The desktop did not reconnect; recovery remains blocked");
  });
}
