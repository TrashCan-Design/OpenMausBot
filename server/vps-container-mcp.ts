// Stdio bridge to the Cua MCP server in a VPS container; auth is the user's SSH config and agent, and nothing is stored here.
import { runSharedVpsProxy } from "./shared-vps-proxy.ts";
import { runMcpBridge } from "./mcp-bridge.ts";
import { vpsContainerMcpArgs, vpsDockerArgs } from "./vps-computer.ts";
import { DATA_DIR } from "./config.ts";
import { augmentedPath } from "./env-path.ts";
import { prepareVpsSsh } from "./vps-ssh.ts";
import { annotateSandboxInputResult, foregroundSandboxInput } from "./sandbox-desktop-input.ts";

const [alias, containerName] = process.argv.slice(2);
const sshAlias = alias ?? "";
let args: string[];
try {
  args = vpsContainerMcpArgs(sshAlias, containerName ?? "");
} catch {
  process.stderr.write("invalid VPS MCP connection\n");
  process.exit(2);
}

// The driving pair rides in env, not argv: argv is world-readable through `ps`.
const controlUrl = process.env.OMB_CONTROL_URL ?? "";
const controlToken = process.env.OMB_CONTROL_TOKEN ?? "";

if (process.env.OMB_VPS_RECONNECT === "1") {
  if (!controlUrl || !controlToken) throw new Error("Shared desktop capability is missing");
  runSharedVpsProxy(controlUrl.replace("/computer-control", "/shared-vps/mcp"), controlToken);
} else runMcpBridge({
  command: "docker",
  args,
  env: { ...process.env, PATH: prepareVpsSsh(DATA_DIR, augmentedPath()).path },
  label: "VPS Cua Driver",
  reconnect: process.env.OMB_VPS_RECONNECT === "1",
  // Probe the transport, not the driver: a busy desktop mid-tool-call must never look dead.
  liveness: { command: "docker", args: vpsDockerArgs(sshAlias, ["version", "--format", "{{.Server.Version}}"]) },
  ...(controlUrl && controlToken ? { gate: { url: controlUrl, token: controlToken, describe: (frame: unknown): Record<string, string> => {
    const params = frame && typeof frame === "object" ? (frame as { params?: { name?: unknown } }).params : undefined;
    return typeof params?.name === "string" ? { tool: params.name } : {};
  } } } : {}),
  prepareLine: foregroundSandboxInput,
  rewriteResponse: annotateSandboxInputResult,
});
