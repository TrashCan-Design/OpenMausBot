const KEY_TOOLS = new Set(["type_text", "press_key", "hotkey", "scroll"]);
const POINTER_TOOLS = new Set(["click", "double_click", "right_click", "drag"]);

const NOTE = "OpenBot desktop input:";
const inputCalls = new Set<string>();

function argumentsOf(params: { arguments?: unknown } | undefined): Record<string, unknown> {
  const current = params?.arguments;
  return current && typeof current === "object" && !Array.isArray(current) ? { ...current as Record<string, unknown> } : {};
}

function targetsPixels(name: string, args: Record<string, unknown>): boolean {
  if (KEY_TOOLS.has(name) || name === "drag") return true;
  return typeof args.x === "number" && typeof args.y === "number";
}

/** The Linux sandbox has no background keyboard. Foreground stays inside that desktop. */
export function foregroundSandboxInput(line: string): string {
  let frame: { id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
  try {
    frame = JSON.parse(line) as typeof frame;
  } catch {
    return line;
  }
  const name = frame.params?.name;
  if (frame.method !== "tools/call" || typeof name !== "string" || (!KEY_TOOLS.has(name) && !POINTER_TOOLS.has(name))) return line;
  if (frame.id !== undefined && frame.id !== null) {
    if (inputCalls.size > 200) inputCalls.clear();
    inputCalls.add(String(frame.id));
  }
  const args = argumentsOf(frame.params);
  if (!targetsPixels(name, args) || args.delivery_mode === "foreground") return line;
  args.delivery_mode = "foreground";
  frame.params = { ...frame.params, arguments: args };
  return JSON.stringify(frame);
}

/** A confirmed no-op may be recovered once. A timeout may already have landed, so it is not replayed. */
export function annotateSandboxInputResult(line: string): string {
  let frame: { id?: unknown; result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> } };
  try {
    frame = JSON.parse(line) as typeof frame;
  } catch {
    return line;
  }
  if (frame.id === undefined || frame.id === null || !inputCalls.delete(String(frame.id))) return line;
  const content = frame.result?.content;
  if (!Array.isArray(content)) return line;
  const text = content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
  if (!text || text.includes(NOTE)) return line;
  const timeout = /timed out|timeout|deadline exceeded|unknown whether|not confirmed/i.test(text);
  const noAction = frame.result?.isError === true && /did not (?:change|type|accept)|performed no action|not supported|no effect|0 char|unchanged|cannot (?:type|edit)|not editable|isn't accepting|is not accepting/i.test(text);
  if (!timeout && !noAction) return line;
  const note = timeout
    ? `${NOTE} this call's outcome is unknown. Do not repeat the typing, click, key, or navigation.`
    : `${NOTE} this accessibility action changed nothing. Read the window again with get_window_state on this connection, then type with delivery_mode foreground. A browser search may use Firefox's address bar. Do not repeat a call whose outcome is unknown.`;
  let noted = false;
  frame.result = {
    ...frame.result,
    content: content.map((part) => {
      if (noted || part?.type !== "text" || typeof part.text !== "string") return part;
      noted = true;
      return { ...part, text: `${part.text}\n${note}` };
    }),
  };
  return JSON.stringify(frame);
}