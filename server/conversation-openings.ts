// A send id that opens a conversation is the same id that submits the message, and it is remembered on disk.
// A retry whose first answer was lost, or a second caller still in flight, gets that conversation instead of a new one.
// A record is kept for 7 days, and the book keeps at most 2000. After that, a retry may open a new conversation.
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";
import { parseSendId } from "./send-idempotency.ts";

export type OpeningOwner = "bot" | "channel";

export interface Opening {
  sendId: string;
  owner: OpeningOwner;
  ownerId: string;
  threadId: string;
  title: string;
  createdAt: number;
}

const RETAIN_MS = 7 * 24 * 3_600_000;

type Claim =
  | { ok: true; threadId: string; replayed: boolean }
  | { ok: false; status: number; error: string };

const MAX_OPENINGS = 2_000;

export class OpeningBook {
  private readonly rows = new Map<string, Opening>();
  private readonly flight = new Map<string, Promise<Opening>>();
  private readonly file: string;
  private readonly write: (path: string, data: string) => void;
  private readonly now: () => number;

  constructor(file: string, write?: (path: string, data: string) => void, now: () => number = Date.now) {
    this.file = file;
    this.write = write ?? ((path, data) => writeFileAtomic(path, data, { mode: 0o600 }));
    this.now = now;
    this.load();
  }

  async claim(
    input: { sendId: string; owner: OpeningOwner; ownerId: string; title: string },
    create: () => Promise<{ threadId: string } | null> | { threadId: string } | null,
    alive: (threadId: string) => boolean,
  ): Promise<Claim> {
    const ready = this.ready(input, alive);
    if (ready) return ready;
    const pending = this.flight.get(input.sendId);
    if (pending) return this.after(input, alive, pending);
    const work = this.create(input, create);
    this.flight.set(input.sendId, work);
    try {
      await work;
      return { ok: true, threadId: (await work).threadId, replayed: false };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status) return { ok: false, status, error: error instanceof Error ? error.message : "couldn't create that task" };
      throw error;
    } finally {
      if (this.flight.get(input.sendId) === work) this.flight.delete(input.sendId);
    }
  }

  private async after(input: { sendId: string; owner: OpeningOwner; ownerId: string; title: string }, alive: (threadId: string) => boolean, pending: Promise<Opening>): Promise<Claim> {
    try {
      await pending;
    } catch {
      return this.ready(input, alive) ?? { ok: false, status: 500, error: "couldn't create that task" };
    }
    return this.ready(input, alive) ?? { ok: false, status: 500, error: "couldn't create that task" };
  }

  private ready(input: { sendId: string; owner: OpeningOwner; ownerId: string; title: string }, alive: (threadId: string) => boolean): Claim | undefined {
    const found = this.rows.get(input.sendId);
    if (!found) return undefined;
    if (this.now() - found.createdAt > RETAIN_MS) {
      this.rows.delete(input.sendId);
      return undefined;
    }
    if (found.owner !== input.owner || found.ownerId !== input.ownerId || found.title !== input.title) {
      return { ok: false, status: 409, error: "sendId already belongs to another conversation" };
    }
    if (!found.threadId) return this.flight.has(input.sendId) ? undefined : { ok: false, status: 409, error: "that send id's conversation was not saved durably; choose a new send id" };
    if (!alive(found.threadId)) return { ok: false, status: 409, error: "that conversation was removed; choose a new send id" };
    return { ok: true, threadId: found.threadId, replayed: true };
  }

  private save(): void {
    while (this.rows.size > MAX_OPENINGS) {
      const oldest = this.rows.keys().next().value;
      if (oldest === undefined) break;
      this.rows.delete(oldest);
    }
    this.write(this.file, JSON.stringify({ version: 1, openings: [...this.rows.values()] }));
  }

  private async create(input: { sendId: string; owner: OpeningOwner; ownerId: string; title: string }, create: () => Promise<{ threadId: string } | null> | { threadId: string } | null): Promise<Opening> {
    const again = this.rows.get(input.sendId);
    if (again?.threadId) return again;
    if (again && !again.threadId) throw Object.assign(new Error("that send id's conversation was not saved durably; choose a new send id"), { status: 409 });
    const pending: Opening = { ...input, threadId: "", createdAt: this.now() };
    this.rows.set(input.sendId, pending);
    try { this.save(); }
    catch (error) {
      this.rows.delete(input.sendId);
      throw Object.assign(new Error("could not save the conversation retry record"), { status: 500, cause: error });
    }
    const task = await create();
    if (!task) {
      this.rows.delete(input.sendId);
      try { this.save(); } catch { /* the in-memory reservation is already gone */ }
      throw Object.assign(new Error("couldn't create that task"), { status: 500 });
    }
    const opening: Opening = { ...pending, threadId: task.threadId };
    this.rows.set(input.sendId, opening);
    try { this.save(); }
    catch (error) {
      this.rows.set(input.sendId, pending);
      throw Object.assign(new Error("the conversation exists but its retry record was not saved; choose a new send id"), { status: 500, cause: error });
    }
    return opening;
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { openings?: Opening[] };
      for (const opening of parsed.openings ?? []) {
        if (opening && typeof opening.sendId === "string" && typeof opening.threadId === "string") {
          const createdAt = typeof opening.createdAt === "number" ? opening.createdAt : this.now();
          if (this.now() - createdAt <= RETAIN_MS) this.rows.set(opening.sendId, { ...opening, createdAt });
        }
      }
    } catch {
      // A missing file is the first run. A torn file must not block conversations that name no send id.
    }
  }
}

const books = new Map<string, OpeningBook>();

export function openingBook(file: string): OpeningBook {
  const existing = books.get(file);
  if (existing) return existing;
  const book = new OpeningBook(file);
  books.set(file, book);
  return book;
}

export function readOpeningSendId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw Object.assign(new Error("sendId must be a client-generated id"), { status: 400 });
  return parseSendId(value);
}
