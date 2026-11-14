import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { OpeningBook } from "./conversation-openings.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SEND = "cli-retry-same-id";

function book() {
  const dir = mkdtempSync(join(tmpdir(), "omb-openings-"));
  dirs.push(dir);
  const file = join(dir, "conversation-openings.json");
  return { openings: new OpeningBook(file), file };
}

describe("conversation openings", () => {
  it("returns the same conversation for a sequential retry and a lost response", async () => {
    const { openings, file } = book();
    let made = 0;
    const create = () => ({ threadId: `t${++made}` });
    const alive = () => true;
    const input = { sendId: SEND, owner: "bot" as const, ownerId: "lead", title: "Plan" };
    const first = await openings.claim(input, create, alive);
    expect(first).toEqual({ ok: true, threadId: "t1", replayed: false });
    const lost = await openings.claim(input, create, alive);
    expect(lost).toEqual({ ok: true, threadId: "t1", replayed: true });
    expect(made).toBe(1);
    const reloaded = new OpeningBook(file);
    expect(await reloaded.claim(input, create, alive)).toEqual({ ok: true, threadId: "t1", replayed: true });
    expect(made).toBe(1);
  });

  it("keeps one conversation when two retries are in flight, and refuses a different message", async () => {
    const { openings } = book();
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let made = 0;
    const create = async () => {
      made += 1;
      await gate;
      return { threadId: "only" };
    };
    const input = { sendId: SEND, owner: "channel" as const, ownerId: "room", title: "Plan" };
    const first = openings.claim(input, create, () => true);
    const second = openings.claim(input, create, () => true);
    const other = openings.claim({ ...input, title: "Other" }, create, () => true);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, threadId: "only", replayed: false },
      { ok: true, threadId: "only", replayed: true },
    ]);
    await expect(other).resolves.toMatchObject({ ok: false, status: 409 });
    expect(made).toBe(1);
  });

  it("does not create a conversation when the retry record cannot be saved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-openings-"));
    dirs.push(dir);
    const openings = new OpeningBook(join(dir, "conversation-openings.json"), () => { throw new Error("disk full"); });
    let made = 0;
    const result = await openings.claim({ sendId: SEND, owner: "bot", ownerId: "lead", title: "Plan" }, () => { made += 1; return { threadId: "t1" }; }, () => true);
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(made).toBe(0);
  });

  it("does not open a second conversation when the process dies between creation and the receipt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-openings-"));
    dirs.push(dir);
    let writes = 0;
    const openings = new OpeningBook(join(dir, "conversation-openings.json"), () => {
      writes += 1;
      if (writes >= 2) throw new Error("crash before the receipt");
    });
    let made = 0;
    const input = { sendId: SEND, owner: "bot" as const, ownerId: "lead", title: "Plan" };
    const first = await openings.claim(input, () => { made += 1; return { threadId: "created" }; }, () => true);
    expect(first).toMatchObject({ ok: false, status: 500 });
    expect(made).toBe(1);
    const retry = await openings.claim(input, () => { made += 1; return { threadId: "again" }; }, () => true);
    expect(retry).toMatchObject({ ok: false, status: 409 });
    expect(made).toBe(1);
  });

  it("may open a new conversation after the retry record expires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-openings-"));
    dirs.push(dir);
    let now = 0;
    const openings = new OpeningBook(join(dir, "conversation-openings.json"), () => {}, () => now);
    const input = { sendId: SEND, owner: "bot" as const, ownerId: "lead", title: "Plan" };
    let made = 0;
    const create = () => ({ threadId: `t${++made}` });
    expect(await openings.claim(input, create, () => true)).toMatchObject({ threadId: "t1", replayed: false });
    now = 7 * 24 * 3_600_000 + 1;
    expect(await openings.claim(input, create, () => true)).toMatchObject({ threadId: "t2", replayed: false });
    expect(made).toBe(2);
  });

  it("does not open a replacement after the conversation was removed", async () => {
    const { openings } = book();
    await openings.claim({ sendId: SEND, owner: "bot", ownerId: "lead", title: "Plan" }, () => ({ threadId: "gone" }), () => true);
    const retry = await openings.claim({ sendId: SEND, owner: "bot", ownerId: "lead", title: "Plan" }, () => ({ threadId: "new" }), () => false);
    expect(retry).toMatchObject({ ok: false, status: 409 });
  });
});
