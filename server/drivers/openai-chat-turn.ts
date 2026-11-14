const ACTION = "(?:execute|send|type|press|launch|open|check|inspect|read|fetch|run|create|write|verify|pull|look|search|navigate|load)";
const LEAD = new RegExp(`^(?:let me(?! know\\b)|i['\\u2019]ll|i will|i(?:['\\u2019]m| am) going to)\\s+(?:now\\s+)?${ACTION}\\b`, "i");
const GERUND = /^(?:checking|opening|pulling|looking|searching|navigating|reading|fetching|loading|now (?:i'll|let me|opening|checking|pulling|reading))\b/i;
const AND_WILL = /^i(?:['\u2019]m| am)\b[^.!?\n]*\band (?:i )?will\s+(?:launch|open|check|pull|look|search|navigate|read|fetch|load|run|inspect)\b/i;
const TAIL = new RegExp(`^(?:let me|i['\\u2019]ll|i will|i(?:['\\u2019]m| am) going to)\\s+(?:now\\s+)?${ACTION}\\b`, "i");

function unfinished(reply: string): boolean {
  return !/[.!?]/.test(reply) || /(?:[:\u2014\u2013]|\.\.\.|\u2026)\s*$/.test(reply);
}

export function announcesAction(text: string): boolean {
  const reply = text.trim();
  if (!reply || reply.length > 4_000 || reply.includes("?")) return false;
  if (reply.length > 400) {
    const tail = reply.split(/\n\s*\n/).at(-1)!.trim();
    return tail.length <= 400 && TAIL.test(tail);
  }
  return LEAD.test(reply) || AND_WILL.test(reply) || (GERUND.test(reply) && unfinished(reply));
}

const SHOT = "Screenshot result from tool call ";

export function dropStaleScreenshots(messages: readonly { role: string; content: unknown }[]): void {
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    const first = message.content[0] as { type?: string; text?: string } | undefined;
    if (first?.type !== "text" || typeof first.text !== "string" || !first.text.startsWith(SHOT)) continue;
    (message as { content: unknown }).content = [{ type: "text", text: `${first.text} [earlier screenshot omitted]` }];
  }
}

/** The call was refused or changed nothing. A timeout is not this: its outcome is unknown. */
export function unperformedToolResult(text: string): boolean {
  return /this accessibility action changed nothing|was not performed/i.test(text)
    && !/outcome is unknown|do not repeat/i.test(text);
}