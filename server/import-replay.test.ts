import { afterEach, describe, expect, it, vi } from "vitest";
import { importIdempotencyKey, importStillPresent, recallImport, rememberImport } from "./import-replay.ts";

const key = "123e4567-e89b-12d3-a456-426614174000";

describe("import replay", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts only a UUID and returns a finished import until its bots are gone", () => {
    expect(importIdempotencyKey(undefined)).toBeNull();
    expect(importIdempotencyKey("not-a-uuid")).toBe("");
    expect(importIdempotencyKey(key)).toBe(key);
    const body = { bots: [{ id: "bot-1" }] };
    rememberImport(key, 201, body);
    expect(recallImport(key)).toEqual({ status: 201, body });
    expect(importStillPresent(body, (id) => id === "bot-1")).toBe(true);
    expect(importStillPresent(body, () => false)).toBe(false);
    rememberImport(key, 400, { error: "no" });
    expect(recallImport(key)?.status).toBe(201);
  });

  it("forgets an import after ten minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    const aged = "123e4567-e89b-12d3-a456-426614174001";
    rememberImport(aged, 201, { bots: [{ id: "bot-2" }] });
    vi.setSystemTime(new Date("2026-11-07T12:10:01Z"));
    expect(recallImport(aged)).toBeNull();
  });
});