import { fitsOnOneLine } from "./bot-profile.ts";
import { validateBotCwd } from "./bot-cwd.ts";
import { checkedGroupResponder } from "./routes/groups.ts";
import { parseConversationTurnTimeout } from "./room-turn-timeout.ts";
import type { GroupRecord, Store } from "./store.ts";

type MemberCheck = { ok: true; memberIds: string[] } | { ok: false; error: string };
type RoutineList = {
  listRoutines(): Array<{ enabled: boolean; target: string; groupId?: string; botId: string }>;
  listRuns(): Array<{ target: string; groupId?: string; status: string; botId: string }>;
};

export interface ChannelUpdateDeps {
  group(id: string): GroupRecord | null | undefined;
  patchGroup(id: string, patch: Parameters<Store["patchGroup"]>[1]): GroupRecord | null;
  secretBusy(id: string): boolean;
  blocked(group: GroupRecord): boolean;
  members(value: unknown): MemberCheck;
  audienceConflict(memberIds: readonly string[], existing: readonly string[]): string | null;
  routines(): RoutineList;
  audienceChanged(): void;
}

export function applyChannelUpdate(groupId: string, value: unknown, deps: ChannelUpdateDeps): GroupRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("body must be a JSON object"), { status: 400 });
  }
  const body = value as Record<string, unknown>;
  const existing = deps.group(groupId);
  if (!existing) throw Object.assign(new Error("no such room"), { status: 404 });
  if (body.memberIds !== undefined && deps.secretBusy(existing.id)) {
    throw Object.assign(new Error("this channel is securely saving a credential — try again when it finishes"), { status: 409 });
  }
  if (deps.blocked(existing) && (body.memberIds !== undefined || body.defaultResponder !== undefined || body.bulletin !== undefined)) {
    throw Object.assign(new Error("this channel is working or waiting on you — finish that turn first"), { status: 409 });
  }
  const patch: Parameters<Store["patchGroup"]>[1] = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string") throw Object.assign(new Error("room name must be a string"), { status: 400 });
    const name = body.name.trim();
    if (!name) throw Object.assign(new Error("room name must not be empty"), { status: 400 });
    if (name.length > 100) throw Object.assign(new Error("room name must be at most 100 characters"), { status: 400 });
    if (!fitsOnOneLine(name)) throw Object.assign(new Error("room name must fit on one line"), { status: 400 });
    patch.name = name;
  }
  if (body.bulletin !== undefined) {
    if (typeof body.bulletin !== "string") throw Object.assign(new Error("bulletin must be a string"), { status: 400 });
    if (body.bulletin.length > 12_000) throw Object.assign(new Error("bulletin must be at most 12000 characters"), { status: 400 });
    patch.bulletin = body.bulletin;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") throw Object.assign(new Error("description must be a string"), { status: 400 });
    const trimmed = body.description.trim();
    if (!trimmed) patch.description = undefined;
    else if (/[\n\r]/.test(trimmed)) throw Object.assign(new Error("description must be a single line"), { status: 400 });
    else if (trimmed.length > 120) throw Object.assign(new Error("description must be at most 120 characters"), { status: 400 });
    else patch.description = trimmed;
  }
  if (body.unread !== undefined) {
    if (typeof body.unread !== "boolean") throw Object.assign(new Error("unread must be true or false"), { status: 400 });
    patch.unread = body.unread;
  }
  if (body.memberIds !== undefined) {
    if (existing.dm) throw Object.assign(new Error("direct-message channels cannot change members"), { status: 400 });
    const roster = deps.members(body.memberIds);
    if (!roster.ok) throw Object.assign(new Error(roster.error.replace("channel", "room")), { status: 400 });
    const audienceConflict = deps.audienceConflict(roster.memberIds, existing.memberIds);
    if (audienceConflict) throw Object.assign(new Error(audienceConflict), { status: 400 });
    const routines = deps.routines();
    const removedGoalLead = routines.listRoutines().some((routine) =>
      routine.enabled && routine.target === "room-goal" && routine.groupId === existing.id && !roster.memberIds.includes(routine.botId),
    ) || routines.listRuns().some((run) =>
      run.target === "room-goal" && run.groupId === existing.id && ["queued", "running", "waiting"].includes(run.status) && !roster.memberIds.includes(run.botId),
    );
    if (removedGoalLead) {
      throw Object.assign(new Error("pause or reassign this room's team-goal routine before removing its lead"), { status: 409 });
    }
    patch.memberIds = roster.memberIds;
  }
  if (body.defaultResponder !== undefined) {
    const memberIds = patch.memberIds ?? existing.memberIds;
    const responder = checkedGroupResponder(body.defaultResponder, memberIds);
    if (!responder) throw Object.assign(new Error("invalid default responder"), { status: 400 });
    patch.defaultResponder = responder;
  }
  if (Object.prototype.hasOwnProperty.call(body, "turnTimeoutMinutes")) {
    if (!existing.dm) throw Object.assign(new Error("set the turn limit on that conversation"), { status: 400 });
    const parsed = parseConversationTurnTimeout(body.turnTimeoutMinutes);
    if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });
    patch.turnTimeoutMinutes = parsed.minutes;
  }
  if (body.cwd !== undefined) {
    if (existing.dm) throw Object.assign(new Error("direct-message channels cannot have a working folder"), { status: 400 });
    if (existing.pinnedCwd !== undefined) {
      throw Object.assign(new Error("the room's working folder is fixed after its first turn"), { status: 409 });
    }
    const checked = validateBotCwd(body.cwd);
    if (!checked.ok) throw Object.assign(new Error(checked.error), { status: 400 });
    patch.cwd = checked.cwd ?? undefined;
  }
  if (body.pinnedMessageId !== undefined) {
    if (body.pinnedMessageId === null || body.pinnedMessageId === "") patch.pinnedMessageId = undefined;
    else if (typeof body.pinnedMessageId === "string" && /^[\w-]+$/.test(body.pinnedMessageId)) patch.pinnedMessageId = body.pinnedMessageId;
    else throw Object.assign(new Error("pinnedMessageId must be a message id"), { status: 400 });
  }
  if (body.section !== undefined) {
    if (body.section === null) patch.section = undefined;
    else if (typeof body.section !== "string") throw Object.assign(new Error("section must be a string"), { status: 400 });
    else {
      const trimmed = body.section.trim();
      if (!trimmed) patch.section = undefined;
      else if (trimmed.length > 60) throw Object.assign(new Error("section must be at most 60 characters"), { status: 400 });
      else patch.section = trimmed;
    }
  }
  // Admin-only, and the only way a room's floor widens; a Chief's PATCH never has it.
  const resetAudience = body.resetAudience !== undefined;
  if (resetAudience) {
    if (body.resetAudience !== true) throw Object.assign(new Error("resetAudience must be true"), { status: 400 });
    patch.audienceFloor = undefined;
  }
  const group = deps.patchGroup(groupId, patch);
  if (resetAudience) deps.audienceChanged();
  if (!group) throw Object.assign(new Error("no such room"), { status: 404 });
  return group;
}
