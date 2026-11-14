import { describe, expect, it } from "vitest";

import type { HeadlessIo } from "./output.ts";
import { runHeadless } from "./main.ts";
import { checkHost, hostReport, type HostProbe, type HostRole } from "./host-doctor.ts";

const GB = 1_000_000_000;

function probe(over: Partial<HostProbe> & { commands?: string[] } = {}): HostProbe & { commands: string[] } {
  const commands: string[] = over.commands ?? [];
  return {
    platform: "linux", arch: "x64", kernel: "6.8.0", cpus: 2, memoryBytes: 8 * 2 ** 30,
    read: (path) => path === "/etc/os-release" ? "PRETTY_NAME=\"Ubuntu 24.04\"\nID=ubuntu\nVERSION_ID=\"24.04\"\n" : null,
    list: () => [],
    run: async (command) => {
      commands.push(command);
      return { ok: false, stdout: "", stderr: "", missing: true };
    },
    freeBytes: () => 30 * GB,
    serverAnswers: async () => false,
    ...over,
    commands,
  };
}

async function report(role: HostRole, host: HostProbe) {
  const checks = await checkHost(host, { dataDir: "/var/lib/openbot", port: 8799, role });
  return { checks, ...hostReport(checks, role) };
}

describe("doctor --host", () => {
  it("reports the Windows app without Linux server requirements or any command", async () => {
    const host = probe({ platform: "win32" });
    const result = await report("windows-app", host);
    expect(result.exitCode).toBe(0);
    expect(result.result).toMatchObject({ ok: true, role: "windows-app" });
    expect(result.human.join("\n")).toMatch(/Windows app/);
    expect(result.human.join("\n")).toMatch(/Google Cloud CLI is not required/);
    expect(host.commands).toEqual([]);
    expect(result.checks.map((check) => check.id)).toEqual(["role"]);
  });

  it("checks a desktop-only VM for Docker and does not require the bot sandbox", async () => {
    const host = probe({
      run: async (command) => {
        host.commands.push(command);
        return command === "docker"
          ? { ok: true, stdout: "27.0.0\n", stderr: "", missing: false }
          : { ok: false, stdout: "", stderr: "", missing: true };
      },
    });
    const result = await report("desktop", host);
    expect(result.exitCode).toBe(0);
    expect(result.checks.map((check) => check.id)).toEqual(["role", "cloud-cli", "sandbox", "system", "arch", "containers", "disk", "size", "clock"]);
    expect(result.checks.find((check) => check.id === "sandbox")?.message).toMatch(/not required/);
    expect(result.checks.find((check) => check.id === "containers")?.status).toBe("ok");
    expect(host.commands).not.toContain("gcloud");
    expect(result.checks.map((check) => check.id)).not.toContain("userns");
  });

  it("fails a desktop VM that has no Docker, and still does not install anything", async () => {
    const host = probe();
    const result = await report("desktop", host);
    expect(result.exitCode).toBe(7);
    const containers = result.checks.find((check) => check.id === "containers");
    expect(containers?.status).toBe("FAIL");
    expect(containers?.fix).toMatch(/does not install/);
    expect(host.commands).toEqual(["docker", "timedatectl"]);
    expect(host.commands).not.toContain("gcloud");
  });

  it("requires the bot sandbox only when this machine would host OpenBot", async () => {
    const host = probe({ list: (path) => path === "/proc/self/ns" ? ["user"] : [] });
    const result = await report("server", host);
    expect(result.exitCode).toBe(7);
    expect(result.checks.find((check) => check.id === "role")?.message).toMatch(/OpenBot and the bot sandbox/);
    expect(result.checks.find((check) => check.id === "userns")?.status).toBe("ok");
    expect(result.checks.find((check) => check.id === "containers")?.status).toBe("FAIL");
    expect(host.commands).not.toContain("gcloud");
  });

  it("rejects doctor --host combined with --wait, and --desktop without --host", async () => {
    const io: HeadlessIo = { out: () => undefined, err: () => undefined, readStdin: async () => "" };
    expect(await runHeadless(["doctor", "--host", "--wait", "1s"], { io, env: {} })).toBe(2);
    expect(await runHeadless(["doctor", "--desktop"], { io, env: {} })).toBe(2);
    expect(await runHeadless(["doctor", "--host", "--time-url", "http://time.example"], { io, env: {} })).toBe(2);
  });
});
