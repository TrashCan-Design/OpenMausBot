import { describe, expect, it, vi } from "vitest";
import {
  PER_BOT_VPS_MEMORY,
  SHARED_DESKTOP_HEADROOM_BYTES,
  SHARED_DESKTOP_MEMORY,
  SHARED_DESKTOP_MEMORY_BYTES,
  considerSharedDesktopMemory,
  sharedDesktopMemoryPlan,
  vpsContainerMemory,
} from "./container-limits.ts";

const GiB = 1024 * 1024 * 1024;

describe("shared desktop memory", () => {
  it("keeps per-bot desktops at 4 GiB and asks the shared desktop for 6 GiB", () => {
    expect(vpsContainerMemory("bot-1")).toBe(PER_BOT_VPS_MEMORY);
    expect(vpsContainerMemory("openbot-shared-desktop:production")).toBe(SHARED_DESKTOP_MEMORY);
    expect(PER_BOT_VPS_MEMORY).toBe("4g");
    expect(SHARED_DESKTOP_MEMORY).toBe("6g");
  });

  it("raises only when the measured host keeps 1.5 GiB after 6 GiB", () => {
    expect(sharedDesktopMemoryPlan(4 * GiB, 8 * GiB)).toBe("raise");
    expect(sharedDesktopMemoryPlan(4 * GiB, SHARED_DESKTOP_MEMORY_BYTES + SHARED_DESKTOP_HEADROOM_BYTES)).toBe("raise");
    expect(sharedDesktopMemoryPlan(4 * GiB, 7 * GiB)).toBe("defer");
    expect(sharedDesktopMemoryPlan(6 * GiB, 8 * GiB)).toBe("keep");
    expect(sharedDesktopMemoryPlan(0, 8 * GiB)).toBe("keep");
    expect(sharedDesktopMemoryPlan(8 * GiB, 8 * GiB)).toBe("keep");
    expect(sharedDesktopMemoryPlan(4 * GiB, null)).toBe("unmeasured");
  });

  it("updates a 4 GiB shared desktop in place after reading the host, and skips a tight host", async () => {
    const calls: string[][] = [];
    const docker = async (args: string[]) => {
      calls.push(args);
      return { stdout: args[0] === "info" ? `${8 * GiB}\n` : "" };
    };
    const roomy = { container_id: "c".repeat(64), memoryBytes: 4 * GiB };
    await considerSharedDesktopMemory(roomy, docker);
    await considerSharedDesktopMemory(roomy, docker);
    const tight: { container_id: string; memoryBytes: number; memoryHostBytes?: number; memoryDeferred?: boolean } = { container_id: "d".repeat(64), memoryBytes: 4 * GiB };
    const tightDocker = async (args: string[]) => {
      calls.push(args);
      return { stdout: `${7 * GiB}\n` };
    };
    await considerSharedDesktopMemory(tight, tightDocker);
    expect(tight.memoryDeferred).toBe(true);
    expect(tight.memoryHostBytes).toBe(7 * GiB);
    expect(calls).toEqual([
      ["info", "--format", "{{.MemTotal}}"],
      ["update", "--memory", "6g", "--memory-swap", "6g", "c".repeat(64)],
      ["info", "--format", "{{.MemTotal}}"],
    ]);
  });

  it("does not latch a failed host read, and retries an update whose reply was lost", async () => {
    const calls: string[][] = [];
    let failUpdate = true;
    const docker = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "update" && failUpdate) throw new Error("ssh timed out");
      return { stdout: args[0] === "info" ? `${8 * GiB}\n` : "" };
    };
    const status = { container_id: "f".repeat(64), memoryBytes: 4 * GiB };
    await considerSharedDesktopMemory(status, docker);
    failUpdate = false;
    await considerSharedDesktopMemory(status, docker);
    expect(calls.filter((args) => args[0] === "update")).toHaveLength(2);
  });

  it("waits a minute before rereading a host that did not answer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    let reads = 0;
    const docker = async (args: string[]) => {
      if (args[0] === "info") {
        reads += 1;
        throw new Error("ssh timed out");
      }
      return { stdout: "" };
    };
    const status = { container_id: "e".repeat(64), memoryBytes: 4 * GiB };
    try {
      await considerSharedDesktopMemory(status, docker);
      await considerSharedDesktopMemory(status, docker);
      expect(reads).toBe(1);
      vi.setSystemTime(new Date("2026-11-07T12:01:01Z"));
      await considerSharedDesktopMemory(status, docker);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});