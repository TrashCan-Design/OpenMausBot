import type { BotRecord } from "./store.ts";
import type { TurnOwner } from "./turn-resources.ts";

// An installation-owned Docker name, deliberately outside the bot ID namespace.
// Keeping the historic VPS name format preserves inventory and ownership checks.
export const SHARED_VPS_OWNER_ID = "openbot-shared-desktop";

export function sharedVpsOwnerId(alias: string): string {
  return `${SHARED_VPS_OWNER_ID}:${alias}`;
}

export function vpsDesktopOwnerId(bot: Pick<BotRecord, "id" | "vpsDesktopMode">, alias: string | null): string {
  return bot.vpsDesktopMode === "shared" ? sharedVpsOwnerId(alias ?? "unconfigured") : bot.id;
}

export function sharedVpsResource(alias: string): string {
  return `computer:vps:${alias}:${sharedVpsOwnerId(alias)}`;
}

export function sharedAliasFromResource(resource: string): string | null {
  const prefix = "computer:vps:";
  if (!resource.startsWith(prefix)) return null;
  const rest = resource.slice(prefix.length);
  const marker = `:${SHARED_VPS_OWNER_ID}:`;
  const at = rest.indexOf(marker);
  if (at < 0) return null;
  const alias = rest.slice(0, at);
  return resource === sharedVpsResource(alias) ? alias : null;
}

export function sharedVpsControlKey(alias: string): string {
  return `shared_vps_${alias}`;
}

/** The one Cua call this product already uses to photograph the desktop. Anything else needs control. */
export const SHARED_OBSERVATION_TOOL = "get_desktop_state";

/** A view from before this turn owned the desktop is not a target for a later click. */
export const SHARED_FRESH_OBSERVATION =
  "Take a fresh get_desktop_state for this turn before changing the shared desktop. This call was not performed.";

// Hands on the VM that do not go through OpenBot are outside this lock.

export function sharedObservationTool(name: string | null | undefined): boolean {
  return name === SHARED_OBSERVATION_TOOL;
}

export function describeSharedDesktop(input: {
  alias: string | null;
  holder: TurnOwner | null;
  waiting: readonly TurnOwner[];
  personControls: boolean;
  recovering?: boolean;
  botFor(owner: TurnOwner): { id: string; name: string } | null;
}) {
  if (!input.alias) return { mode: "shared" as const, activeBot: null, controller: null, recovering: false, waitingQueue: [] as Array<{ id: string; name: string }> };
  const recovery = input.holder?.threadId.startsWith("shared-vps-recovery:") === true;
  const active = input.holder && !recovery && !input.holder.threadId.startsWith("shared-vps-person:") ? input.botFor(input.holder) : null;
  return {
    mode: "shared" as const,
    activeBot: active,
    recovering: input.recovering === true || recovery,
    controller: input.personControls ? "person" as const : active ? "bot" as const : null,
    waitingQueue: input.waiting.map(owner => {
      if (owner.threadId.startsWith("shared-vps-person:")) return { id: "person", name: "Person" };
      const bot = input.botFor(owner);
      return { id: bot?.id ?? owner.threadId, name: bot?.name ?? "Bot" };
    }),
  };
}
