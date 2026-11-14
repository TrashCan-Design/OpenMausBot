import { StringDecoder } from "node:string_decoder";

/** The agent has only a turn capability; SSH and Cua lifecycle state remain in the server. */
export function runSharedVpsProxy(url: string, token: string): void {
  const pending = new Set<string>();
  const decoder = new StringDecoder("utf8");
  let active = 0, buffer = "", discarding = false;
  const reply = (id: string | number, body: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...body as object }) + "\n");
  const dispatch = (line: string) => {
    let frame: { id?: string | number; jsonrpc?: string; method?: string };
    try { frame = JSON.parse(line); } catch { return; }
    if (!frame || typeof frame !== "object" || frame.jsonrpc !== "2.0" || typeof frame.method !== "string" ||
        (frame.id !== undefined && typeof frame.id !== "string" && typeof frame.id !== "number")) return;
    const id = frame.id, key = JSON.stringify(id);
    if (id !== undefined && pending.has(key)) return;
    if (active >= 32) { if (id !== undefined) reply(id, { error: { code: -32000, message: "Too many desktop requests" } }); return; }
    active++;
    if (id !== undefined) pending.add(key);
    void (async () => {
      try {
        const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: line, redirect: "error", signal: AbortSignal.timeout(330_000) });
        const body = await response.json() as { result?: unknown; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Desktop request refused");
        if (id !== undefined) reply(id, { result: body.result });
      } catch (error) {
        if (id !== undefined) reply(id, { error: { code: -32000, message: error instanceof Error ? error.message : "Desktop unavailable" } });
      } finally { active--; if (id !== undefined) pending.delete(key); }
    })();
  };
  process.stdin.on("data", (chunk: Buffer) => {
    const parts = decoder.write(chunk).split("\n");
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      if (!discarding) {
        if (Buffer.byteLength(buffer) + Buffer.byteLength(part) > 1024 * 1024) { buffer = ""; discarding = true; }
        else buffer += part;
      }
      if (index < parts.length - 1) {
        if (!discarding && buffer.trim()) dispatch(buffer);
        buffer = ""; discarding = false;
      }
    }
  });
}
