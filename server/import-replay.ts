const WINDOW_MS = 10 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Saved = { at: number; status: number; body: unknown };
const saved = new Map<string, Saved>();

/** A UUID idempotency key, null when the header is absent, and "" when it is present but not a UUID. */
export function importIdempotencyKey(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value === "") return null;
  return UUID.test(value) ? value.toLowerCase() : "";
}

export function recallImport(key: string): { status: number; body: unknown } | null {
  const found = saved.get(key);
  if (!found) return null;
  if (Date.now() - found.at > WINDOW_MS) {
    saved.delete(key);
    return null;
  }
  return { status: found.status, body: found.body };
}

export function rememberImport(key: string, status: number, body: unknown): void {
  if (status < 200 || status >= 300) return;
  saved.set(key, { at: Date.now(), status, body });
}

/** True when every imported bot is still in the store. A deleted bot may be imported again. */
export function importStillPresent(body: unknown, has: (id: string) => boolean): boolean {
  if (!body || typeof body !== "object") return false;
  const bots = (body as { bots?: unknown }).bots;
  if (!Array.isArray(bots)) return false;
  return bots.every((bot) => {
    const id = bot && typeof bot === "object" ? (bot as { id?: unknown }).id : undefined;
    return typeof id === "string" && has(id);
  });
}