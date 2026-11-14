import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { inflateSync } = require("node:zlib");
const { normalizeUnreadCount, parseWindowState, resolveWindowState, unreadOverlayPng } = require("./window-state.cjs");

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const left = { x: -1600, y: 0, width: 1600, height: 900 };

describe("desktop window state", () => {
  it("rejects corrupt and incomplete saved state", () => {
    expect(parseWindowState("not json")).toBeNull();
    expect(parseWindowState({ bounds: { x: 1, y: 2, width: 0, height: 700 } })).toBeNull();
    expect(parseWindowState({ bounds: { x: 1, y: 2, width: 1000 } })).toBeNull();
  });

  it("restores a reachable window on the display where it was saved", () => {
    expect(
      resolveWindowState(
        { bounds: { x: -1500, y: 40, width: 1200, height: 760 }, maximized: true },
        [primary, left],
      ),
    ).toEqual({ bounds: { x: -1500, y: 40, width: 1200, height: 760 }, maximized: true });
  });

  it("centers an off-screen window on the primary display and clamps its size", () => {
    expect(
      resolveWindowState(
        { bounds: { x: 7000, y: 7000, width: 4000, height: 200 }, maximized: false },
        [primary, left],
      ),
    ).toEqual({ bounds: { x: 0, y: 230, width: 1920, height: 620 }, maximized: false });
  });

  it("uses safe default dimensions when there is no saved state", () => {
    expect(resolveWindowState(null, [primary])).toEqual({
      bounds: { width: 1040, height: 760 },
      maximized: false,
    });
  });

  it("uses a blue dot for the Windows unread overlay", () => {
    const png = unreadOverlayPng();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.toString("utf8")).not.toContain("openbot");
    const idatAt = png.indexOf("IDAT");
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + png.readUInt32BE(idatAt - 4)));
    const center = 8 * (1 + 16 * 4) + 1 + 8 * 4;
    expect([...raw.subarray(center, center + 3)]).toEqual([37, 99, 235]);
    expect(raw[4]).toBe(0);
    const large = unreadOverlayPng(32);
    expect(large.readUInt32BE(16)).toBe(32);
    expect(large.readUInt32BE(20)).toBe(32);
    const largeIdat = large.indexOf("IDAT");
    const largeRaw = inflateSync(large.subarray(largeIdat + 4, largeIdat + 4 + large.readUInt32BE(largeIdat - 4)));
    let ring = false;
    for (let y = 0; y < 32 && !ring; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const at = y * (1 + 32 * 4) + 1 + x * 4;
        if (largeRaw[at] === 255 && largeRaw[at + 1] === 255 && largeRaw[at + 2] === 255 && largeRaw[at + 3] === 255) ring = true;
      }
    }
    expect(ring).toBe(true);
  });

  it("bounds native unread counts", () => {
    expect(normalizeUnreadCount(-4)).toBe(0);
    expect(normalizeUnreadCount(3.9)).toBe(3);
    expect(normalizeUnreadCount(10_000)).toBe(999);
    expect(normalizeUnreadCount("3")).toBe(0);
  });
});
