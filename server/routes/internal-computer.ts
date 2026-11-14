import { PASS, type RouteContext } from "./table.ts";
import { controlRefusal, type ControlState } from "../control-client.ts";
import { executeSharedVpsRpc } from "../shared-vps-host.ts";
import type { SharedVpsGateway, SharedVpsTarget } from "../shared-vps-gateway.ts";

export const SHARED_VPS_MCP_PATH = "/api/internal/shared-vps/mcp";
type Capability = { threadId: string; generation: string; sharedVps?: SharedVpsTarget };

/** Called only after the internal bearer, service kind, sender and generation have been validated. */
export function createInternalComputerRoutes<C extends Capability>(deps: {
  gateway: SharedVpsGateway;
  botExists(id: string): boolean;
  active(capability: C): boolean;
  checked(capability: C): void;
  gate(capability: C, signal?: AbortSignal, query?: URLSearchParams): Promise<ControlState>;
}) {
  return async (ctx: RouteContext & { capability: C; readInternalBody(): Promise<unknown> }) => {
    const { method, path, capability, res, json, url } = ctx;
    if (path === SHARED_VPS_MCP_PATH && method === "POST") {
      return json(res, 200, { result: await executeSharedVpsRpc(deps.gateway, capability, await ctx.readInternalBody(),
        () => deps.active(capability), async () => {
          const state = await deps.gate(capability);
          if (state.held) throw new Error(controlRefusal(state));
        }) });
    }
    if (path !== "/api/internal/computer-control") return PASS;
    if (!deps.botExists(url.searchParams.get("botId") ?? "")) return json(res, 404, { error: "no such bot" });
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    deps.checked(capability);
    const abort = new AbortController();
    res.once("close", () => { if (!res.writableEnded) abort.abort(); });
    return json(res, 200, await deps.gate(capability, abort.signal, url.searchParams));
  };
}
