import type { Message } from "@/state/store";
import { formatElapsed } from "@/lib/working-time";
import { t } from "@/lib/i18n";
import { failedTurnCause } from "../../shared/failed-turn";
import { isStoppedTurnName } from "../../shared/client-cancel";
import { localDay } from "@/lib/transcript-derivations";

export type ActivityTranscriptItem =
  | { kind: "message"; message: Message }
  | { kind: "run"; id: string; messages: Message[] };

export type TranscriptItem =
  | ActivityTranscriptItem
  | { kind: "turn"; id: string; turnId: string; label: string; messages: Message[] };

export function statusActivity(message: Message): { kind: "recovery" | "notice" | "stopped"; text: string } | null {
  const name = message.kind === "activity" ? message.tool?.name : undefined;
  if (name?.startsWith("recovery:")) return { kind: "recovery", text: name.slice("recovery:".length).trim() };
  if (name?.startsWith("notice:")) return { kind: "notice", text: name.slice("notice:".length).trim() };
  if (name && isStoppedTurnName(name)) return { kind: "stopped", text: name.slice("stopped:".length).trim() };
  return null;
}

export function isRecoveryActivity(message: Message): boolean {
  return statusActivity(message)?.kind === "recovery";
}

export function isStatusActivity(message: Message): boolean {
  return statusActivity(message) !== null;
}

export function isToolStep(message: Message): message is Message & { tool: NonNullable<Message["tool"]> } {
  const tool = message.tool;
  if (message.kind !== "activity" || !tool) return false;
  if (message.comm || message.threadRef || message.relay || message.dataResult || isStatusActivity(message)) return false;
  return failedTurnCause(tool.name) === null;
}

function foldable(message: Message): boolean {
  return isToolStep(message) && message.tool.ok === true;
}

type TurnFold = Extract<TranscriptItem, { kind: "turn" }>;

const keptVisible = (message: Message) => Boolean(
  message.attachments?.length || message.publishedPage || message.png || message.card || message.signIn || message.secret
  || message.connector || message.widget || message.app || message.helperIntro || message.helperFollowup
  || message.setupSuggestion || message.setupOffer || message.setupRequest,
);

const isNarration = (message: Message, turnId: string) =>
  message.role === "bot" && message.kind === "text" && message.turnId === turnId && !message.turnTerminal && !keptVisible(message);

/** A turn starts with the person's last message before its first row, or with that row when nobody wrote first. */
function turnStartedAt(messages: readonly Message[], firstIndex: number, fallback: number): number {
  for (let i = firstIndex - 1; i >= 0; i -= 1) if (messages[i]!.role === "user") return messages[i]!.at;
  return messages[firstIndex]?.at ?? fallback;
}

/** "Worked for 29s", or plain "Worked" for a turn under a second. */
export function workedLabel(elapsed: number): string {
  return elapsed >= 1_000 ? t("chat.run.workedFor", { elapsed: formatElapsed(elapsed) }) : t("chat.run.worked");
}

function thoughtLabel(elapsed: number, live: boolean): string {
  if (live) return t("chat.thinking");
  return elapsed >= 1_000 ? t("chat.thoughtFor", { elapsed: formatElapsed(elapsed) }) : t("chat.thought");
}

function answerTails(messages: readonly Message[]): Map<string, Set<string>> {
  const pending = new Map<string, Message[]>();
  const terminal = new Map<string, string[]>();
  for (const message of messages) {
    const turnId = message.turnId;
    if (!turnId) continue;
    if (message.role === "bot" && message.kind === "text") {
      const list = pending.get(turnId);
      if (list) list.push(message);
      else pending.set(turnId, [message]);
      if (message.turnTerminal) {
        const ids = terminal.get(turnId);
        if (ids) ids.push(message.id);
        else terminal.set(turnId, [message.id]);
      }
      continue;
    }
    if (message.kind === "activity" && message.tool && !isStatusActivity(message)) pending.set(turnId, []);
  }
  const tails = new Map<string, Set<string>>();
  for (const [turnId, list] of pending) {
    const tail = new Set(list.map((message) => message.id));
    for (const id of terminal.get(turnId) ?? []) tail.add(id);
    tails.set(turnId, tail);
  }
  return tails;
}

function progressRow(message: Message, turnId: string, tail: Set<string>): boolean {
  if (message.turnId !== turnId || tail.has(message.id)) return false;
  return isNarration(message, turnId) || foldable(message);
}

/** How long each finished turn took, keyed by its answer's id: from its start to the answer. */
export function turnDurations(messages: readonly Message[]): Map<string, number> {
  const firstIndex = new Map<string, number>();
  const durations = new Map<string, number>();
  messages.forEach((message, index) => {
    if (!message.turnId) return;
    if (!firstIndex.has(message.turnId)) firstIndex.set(message.turnId, index);
    if (message.role !== "bot" || message.kind !== "text" || !message.turnTerminal) return;
    durations.set(message.id, Math.max(0, message.at - turnStartedAt(messages, firstIndex.get(message.turnId)!, message.at)));
  });
  return durations;
}

/** Once a turn has its answer, the rows `folded` picks go behind one "Worked for 29s" chip at the first of them. */
function settledTurnFolds(messages: Message[], folded: (message: Message, turnId: string) => boolean, labelFor: (elapsed: number) => string = workedLabel): {
  byAnchorId: Map<string, TurnFold>;
  hiddenIds: Set<string>;
} {
  const byAnchorId = new Map<string, TurnFold>();
  const hiddenIds = new Set<string>();

  messages.forEach((terminal, terminalIndex) => {
    if (
      terminal.role !== "bot" ||
      terminal.kind !== "text" ||
      !terminal.turnId ||
      !terminal.turnTerminal
    ) return;
    const turnId = terminal.turnId;
    const before = messages.slice(0, terminalIndex);
    const rows = before.filter((message) => folded(message, turnId));
    if (!rows.length) return;

    const firstIndex = before.findIndex((message) => message.turnId === turnId);
    const startedAt = turnStartedAt(messages, firstIndex, rows[0].at);
    const label = labelFor(Math.max(0, terminal.at - startedAt));
    byAnchorId.set(rows[0].id, { kind: "turn", id: `turn:${turnId}`, turnId, label, messages: rows });
    for (const message of rows) hiddenIds.add(message.id);
  });

  return { byAnchorId, hiddenIds };
}

/** A room shows a member's answer, not its working notes. */
function assistantTurnFolds(messages: Message[]) {
  return settledTurnFolds(messages, isNarration);
}

function openTurnFolds(messages: Message[], live: boolean, tails: Map<string, Set<string>>): { byAnchorId: Map<string, TurnFold>; hiddenIds: Set<string> } {
  const byAnchorId = new Map<string, TurnFold>();
  const hiddenIds = new Set<string>();
  const seen = new Set<string>();
  let lastTurnId: string | undefined;
  for (const message of messages) if (message.turnId) lastTurnId = message.turnId;
  for (const message of messages) {
    const turnId = message.turnId;
    if (!turnId || seen.has(turnId)) continue;
    seen.add(turnId);
    if (messages.some((row) => row.turnId === turnId && row.role === "bot" && row.kind === "text" && row.turnTerminal)) continue;
    const closed = messages.some((row) => row.turnId === turnId && isStatusActivity(row));
    const working = live && turnId === lastTurnId && !closed;
    const rows = messages.filter((row) => progressRow(row, turnId, working ? new Set() : tails.get(turnId) ?? new Set()));
    if (!rows.length) continue;
    byAnchorId.set(rows[0]!.id, { kind: "turn", id: `turn:${turnId}`, turnId, label: thoughtLabel(0, working), messages: rows });
    for (const row of rows) hiddenIds.add(row.id);
  }
  return { byAnchorId, hiddenIds };
}

/** A direct conversation folds narration and finished tool steps. The answer, including several final segments, stays out. */
function conversationFolds(messages: Message[], live: boolean): { byAnchorId: Map<string, TurnFold>; hiddenIds: Set<string> } {
  const tails = answerTails(messages);
  const settled = settledTurnFolds(
    messages,
    (message, turnId) => progressRow(message, turnId, tails.get(turnId) ?? new Set()),
    (elapsed) => thoughtLabel(elapsed, false),
  );
  const open = openTurnFolds(messages, live, tails);
  return {
    byAnchorId: new Map([...open.byAnchorId, ...settled.byAnchorId]),
    hiddenIds: new Set([...open.hiddenIds, ...settled.hiddenIds]),
  };
}

export function roomTurnFolds(messages: Message[]): {
  byTerminalId: Map<string, TurnFold>;
  hiddenIds: Set<string>;
} {
  const { byAnchorId, hiddenIds } = assistantTurnFolds(messages);
  const terminals = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "bot" && message.kind === "text" && message.turnId && message.turnTerminal) terminals.set(message.turnId, message.id);
  }
  const byTerminalId = new Map<string, TurnFold>();
  for (const fold of byAnchorId.values()) {
    const terminalId = terminals.get(fold.turnId);
    if (terminalId) byTerminalId.set(terminalId, fold);
  }
  return { byTerminalId, hiddenIds };
}

function group(messages: Message[], foldAssistantTurns: boolean, live = true): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const folds = foldAssistantTurns
    ? conversationFolds(messages, live)
    : { byAnchorId: new Map<string, TurnFold>(), hiddenIds: new Set<string>() };
  let run: Message[] = [];
  const flush = () => {
    if (run.length > 1) items.push({ kind: "run", id: `run:${run[0].id}`, messages: run });
    else for (const message of run) items.push({ kind: "message", message });
    run = [];
  };
  for (const message of messages) {
    const turn = folds.byAnchorId.get(message.id);
    if (turn) {
      flush();
      items.push(turn);
      continue;
    }
    if (folds.hiddenIds.has(message.id) || message.reaction) continue;
    if (foldable(message)) {
      const first = run[0];
      if (
        first &&
        (first.role !== message.role ||
          first.from?.botId !== message.from?.botId ||
          localDay(first.at) !== localDay(message.at))
      ) {
        flush();
      }
      run.push(message);
      continue;
    }
    flush();
    items.push({ kind: "message", message });
  }
  flush();
  return items;
}

export function groupActivityRuns(messages: Message[]): ActivityTranscriptItem[] {
  return group(messages, false) as ActivityTranscriptItem[];
}

export function groupTranscript(messages: Message[], live = true): TranscriptItem[] {
  return group(messages, true, live);
}

const MAX_NAMES = 3;

export function describeRun(messages: Message[], label: (tool: NonNullable<Message["tool"]>) => string = (tool) => tool.name): string {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const name = message.tool ? label(message.tool) : "";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  const shown = names.slice(0, MAX_NAMES).join(", ");
  const rest = names.length > MAX_NAMES ? ` ${t("chat.run.more", { count: names.length - MAX_NAMES })}` : "";
  return t("chat.run.steps", { count: messages.length, tools: `${shown}${rest}` });
}
