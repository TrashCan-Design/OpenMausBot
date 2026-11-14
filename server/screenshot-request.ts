/** A person asked for the picture in this turn. Ordinary computer work does not. */
export function screenshotWasRequested(messages: readonly { role?: string; kind?: string; text?: string }[]): boolean {
  let text = "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && (message.kind === undefined || message.kind === "text") && message.text?.trim()) {
      text = message.text;
      break;
    }
  }
  if (!text) return false;
  if (/\b(?:do not|don't|dont|without)\b[^.?\n]{0,48}\bscreenshots?\b/i.test(text)) return false;
  return /\bscreenshots?\b|\bscreen\s*shots?\b/i.test(text);
}