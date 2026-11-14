import { describe, expect, it } from "vitest";

import { CommandSlot } from "./mcp-command-slot.ts";

const spec = (env: Record<string, string>) => ({
  command: process.execPath,
  args: ["-e", "setInterval(() => {}, 1000)"],
  env,
});

const alive = (pid: number | undefined) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("command MCP process replacement", () => {
  it("stops the old process before starting the next one", async () => {
    const slot = new CommandSlot();
    const first = slot.start(spec({ OMB_MCP_RESTART: "1" })).pid!;
    expect(alive(first)).toBe(true);
    expect(await slot.replace(spec({ OMB_MCP_RESTART: "2" }))).toBe("replaced");
    const second = slot.pid();
    expect(second).not.toBe(first);
    expect(alive(first)).toBe(false);
    expect(alive(second)).toBe(true);
    expect(await slot.replace(spec({}))).toBe("replaced");
    expect(alive(second)).toBe(false);
    await slot.stop();
  });

  it("waits out a call that is already running and does not run it again", async () => {
    const slot = new CommandSlot();
    const first = slot.start(spec({})).pid!;
    let ran = 0;
    slot.beginCall();
    ran += 1;
    expect(await slot.replace(spec({ OMB_MCP_RESTART: "1" }))).toBe("deferred");
    expect(slot.pid()).toBe(first);
    expect(alive(first)).toBe(true);
    await slot.endCall();
    expect(ran).toBe(1);
    expect(alive(first)).toBe(false);
    expect(alive(slot.pid())).toBe(true);
    expect(slot.pid()).not.toBe(first);
    await slot.stop();
    expect(alive(slot.pid())).toBe(false);
  });
});
