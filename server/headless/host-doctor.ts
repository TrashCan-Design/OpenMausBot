// `doctor --host` only looks. It reads files under /proc and /sys, asks docker, podman and timedatectl for their
// versions, and reads sockets that are already listening. It does not install packages, change sysctl, or open a firewall.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statfsSync } from "node:fs";
import { arch, cpus, homedir, release, totalmem } from "node:os";
import { dirname, join, posix, resolve } from "node:path";

import { EXIT, flag, usageError } from "./args.ts";
import type { VerbContext, VerbOutcome } from "./context.ts";

export type HostStatus = "ok" | "warn" | "FAIL";
export type HostRole = "server" | "desktop" | "windows-app" | "other";

export interface HostCheck {
  id: string;
  status: HostStatus;
  message: string;
  fix?: string;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  missing: boolean;
}

export interface HostProbe {
  platform: NodeJS.Platform;
  arch: string;
  kernel: string;
  cpus: number;
  memoryBytes: number;
  read(path: string): string | null;
  list(path: string): string[];
  run(command: string, args: string[]): Promise<CommandResult>;
  freeBytes(path: string): number | null;
  serverAnswers(port: number): Promise<boolean>;
}

export interface HostOptions {
  dataDir: string;
  port: number;
  domain?: string;
  role: HostRole;
  /** Set only when the person passed --time-url. Nothing is contacted otherwise. */
  timeUrl?: string;
}

const GB = 1_000_000_000;
const SIGNED_REQUEST_SKEW_S = 300;

const ok = (id: string, message: string): HostCheck => ({ id, status: "ok", message });
const warn = (id: string, message: string, fix?: string): HostCheck => ({ id, status: "warn", message, ...(fix ? { fix } : {}) });
const fail = (id: string, message: string, fix: string): HostCheck => ({ id, status: "FAIL", message, fix });

function osRelease(probe: HostProbe): Record<string, string> {
  const text = probe.read("/etc/os-release") ?? probe.read("/usr/lib/os-release") ?? "";
  return Object.fromEntries(text.split("\n").map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim())).filter((match) => match !== null)
    .map((match) => [match[1]!, match[2]!.replace(/^"(.*)"$/, "$1")]));
}

function systemCheck(probe: HostProbe): HostCheck {
  const os = osRelease(probe);
  const name = os.PRETTY_NAME || "An unknown Linux";
  const tested = (os.ID === "ubuntu" && ["22.04", "24.04"].includes(os.VERSION_ID ?? "")) || (os.ID === "debian" && os.VERSION_ID === "12");
  const line = `${name}, kernel ${probe.kernel}`;
  return tested ? ok("system", line) : warn("system", `${line}: not a system we test (Ubuntu 24.04 or 22.04, or Debian 12)`);
}

function archCheck(probe: HostProbe, role: HostRole): HostCheck {
  if (probe.arch === "x64" || probe.arch === "arm64") return ok("arch", probe.arch === "x64" ? "x86_64" : "arm64");
  return fail("arch", `${probe.arch}: OpenBot is built for x86_64 and arm64`, role === "desktop" ? "use an x86_64 or arm64 desktop VM" : "use an x86_64 or arm64 server");
}

async function containerCheck(probe: HostProbe, role: HostRole): Promise<HostCheck> {
  const docker = await probe.run("docker", ["version", "--format", "{{.Server.Version}}"]);
  const what = role === "desktop" ? "the remote desktop container" : "the bot sandbox";
  if (docker.ok && docker.stdout.trim()) return ok("containers", `Docker ${docker.stdout.trim()} (${what})`);
  if (!docker.missing) {
    return /permission denied/i.test(docker.stderr)
      ? fail("containers", "Docker is installed, but this user cannot reach its daemon", "run as root, or add the user to the docker group: sudo usermod -aG docker $USER")
      : fail("containers", "Docker is installed, but its daemon is not running", "sudo systemctl enable --now docker");
  }
  if (role === "desktop") {
    return fail("containers", "Docker is not installed, so the remote desktop container cannot run", "install Docker yourself. This check does not install it, and Google Cloud CLI is not required");
  }
  const podman = await probe.run("podman", ["version", "--format", "{{.Version}}"]);
  if (podman.ok && podman.stdout.trim()) return ok("containers", `Podman ${podman.stdout.trim()} (${what})`);
  if (!podman.missing) return fail("containers", "Podman is installed, but does not answer", "podman info names the problem; for a rootless Podman, check /etc/subuid");
  return fail("containers", "Neither Docker nor Podman is installed", "install Docker or Podman yourself. This check does not install it");
}

function userNamespaceCheck(probe: HostProbe): HostCheck {
  const sysctl = (name: string) => probe.read(`/proc/sys/${name.replaceAll(".", "/")}`)?.trim();
  const keep = (setting: string) => `sudo sysctl -w ${setting}   (and put it in /etc/sysctl.d/ to keep it after a reboot). This check does not change it`;
  if (!probe.list("/proc/self/ns").includes("user")) {
    return fail("userns", "Bot sandbox: this kernel has no user namespaces", "use a stock Ubuntu or Debian kernel (CONFIG_USER_NS)");
  }
  if (sysctl("kernel.apparmor_restrict_unprivileged_userns") === "1") {
    return fail("userns", "Bot sandbox: AppArmor blocks unprivileged user namespaces", keep("kernel.apparmor_restrict_unprivileged_userns=0"));
  }
  if (sysctl("kernel.unprivileged_userns_clone") === "0") {
    return fail("userns", "Bot sandbox: unprivileged user namespaces are turned off", keep("kernel.unprivileged_userns_clone=1"));
  }
  if (sysctl("user.max_user_namespaces") === "0") {
    return fail("userns", "Bot sandbox: user namespaces are limited to none", keep("user.max_user_namespaces=15000"));
  }
  return ok("userns", "Unprivileged user namespaces are allowed");
}

function seccompCheck(probe: HostProbe): HostCheck {
  return /^Seccomp:\s*\d/m.test(probe.read("/proc/self/status") ?? "")
    ? ok("seccomp", "seccomp is available")
    : fail("seccomp", "Bot sandbox: this kernel has no seccomp", "use a stock Ubuntu or Debian kernel (CONFIG_SECCOMP_FILTER)");
}

function cgroupCheck(probe: HostProbe): HostCheck {
  return probe.read("/sys/fs/cgroup/cgroup.controllers") !== null
    ? ok("cgroup", "cgroup v2")
    : fail("cgroup", "Only cgroup v1 is mounted; the bot box needs cgroup v2", "boot with systemd.unified_cgroup_hierarchy=1 (the default since Ubuntu 21.10 and Debian 11)");
}

function diskCheck(probe: HostProbe, dataDir: string, role: HostRole): HostCheck {
  const free = probe.freeBytes(dataDir);
  if (free === null) return warn("disk", `Could not read the free space for ${dataDir}`);
  const shown = `${Math.floor(free / GB)} GB free for ${dataDir}`;
  if (role === "desktop") {
    if (free < 5 * GB) return fail("disk", `${shown}; the desktop container needs at least 5 GB`, "free space on that disk");
    if (free < 20 * GB) return warn("disk", `${shown}; leave room for the desktop image`);
    return ok("disk", shown);
  }
  if (free < 10 * GB) return fail("disk", `${shown}; the server needs at least 10 GB`, "free space on that disk, or pass --data-dir on a larger one");
  if (free < 100 * GB) return warn("disk", `${shown}; a Team server needs 100 GB`, "grow the disk before a team moves in");
  return ok("disk", shown);
}

function encryptedCheck(probe: HostProbe, dataDir: string): HostCheck {
  const mounts = (probe.read("/proc/self/mountinfo") ?? "").split("\n").map((line) => line.split(" ")).filter((fields) => fields.length > 4);
  const path = posix.resolve(dataDir);
  const mount = mounts.filter(([, , , , point]) => path === point || path.startsWith(point === "/" ? "/" : `${point}/`))
    .sort((a, b) => b[4]!.length - a[4]!.length)[0];
  if (!mount || mount[2]!.startsWith("0:")) return warn("encryption", `Could not tell whether ${dataDir} is on an encrypted disk`);
  const seen = new Set<string>();
  const encrypted = (device: string): boolean => {
    if (seen.has(device)) return false;
    seen.add(device);
    if ((probe.read(`/sys/dev/block/${device}/dm/uuid`) ?? "").startsWith("CRYPT-")) return true;
    return probe.list(`/sys/dev/block/${device}/slaves`).some((slave) => {
      const dev = probe.read(`/sys/class/block/${slave}/dev`)?.trim();
      return dev ? encrypted(dev) : false;
    });
  };
  return encrypted(mount[2]!)
    ? ok("encryption", `${dataDir} is on an encrypted disk`)
    : warn("encryption", `${dataDir} is not on an encrypted disk`, "use LUKS full-disk encryption, unless your provider encrypts the disk at rest");
}

function sizeCheck(probe: HostProbe, role: HostRole): HostCheck {
  const memory = Math.round(probe.memoryBytes / 2 ** 30);
  const line = `${probe.cpus} CPUs, ${memory} GB memory`;
  if (role === "desktop") return ok("size", `${line}. This VM is desktop compute only; OpenBot itself is not installed here`);
  if (probe.memoryBytes < 2 * 2 ** 30) return fail("size", `${line}; the server needs at least 2 GB`, "use a larger server");
  if (probe.cpus < 4 || probe.memoryBytes < 7.5 * 2 ** 30) return warn("size", `${line}; a Team server needs at least 4 CPUs and 8 GB`, "use a larger server for a team");
  return ok("size", line);
}

export function listeningPorts(probe: HostProbe): Set<number> {
  const ports = new Set<number>();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    for (const line of (probe.read(table) ?? "").split("\n").slice(1)) {
      const [, local, , state] = line.trim().split(/\s+/);
      if (state === "0A" && local) ports.add(Number.parseInt(local.split(":").at(-1)!, 16));
    }
  }
  return ports;
}

async function portChecks(probe: HostProbe, options: HostOptions): Promise<HostCheck[]> {
  const taken = listeningPorts(probe);
  const ours = taken.has(options.port) && await probe.serverAnswers(options.port);
  const server = !taken.has(options.port) ? ok("port", `Port ${options.port} is free for the server`)
    : ours ? ok("port", `OpenBot already answers on port ${options.port}`)
      : fail("port", `Port ${options.port} is taken by another program`, `stop it, or run the server with --port N`);
  const web = [80, 443].filter((port) => taken.has(port));
  if (!web.length) return [server, ok("web-ports", "Ports 80 and 443 are free")];
  const which = web.length === 2 ? "Ports 80 and 443 are" : `Port ${web[0]} is`;
  if (ours) return [server, warn("web-ports", `${which} in use: by this server if it serves --domain, else by another program`)];
  return [server, options.domain
    ? fail("web-ports", `${which} taken, and --domain ${options.domain} needs 80 and 443`, "stop that program, or reach the server through a tunnel you run yourself")
    : warn("web-ports", `${which} taken: serving on your own domain needs 80 and 443`)];
}

async function clockCheck(probe: HostProbe, timeUrl?: string): Promise<HostCheck> {
  const ntp = await probe.run("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]);
  const synced = ntp.ok ? ntp.stdout.trim() === "yes" : null;
  if (!timeUrl) {
    return synced ? ok("clock", "Clock is kept synchronised. No time server was contacted")
      : warn("clock", "Clock was not compared with a time server. Pass --time-url https://… only for a server you operate");
  }
  let offset: number | null = null;
  try {
    const before = Date.now();
    const response = await fetch(timeUrl, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5_000) });
    const after = Date.now();
    const date = Date.parse(response.headers.get("date") ?? "");
    offset = Number.isFinite(date) ? (before + after) / 2 - (date + 500) : null;
  } catch {
    offset = null;
  }
  if (offset === null) return warn("clock", `Could not read the time from ${timeUrl}`);
  const seconds = Math.abs(offset) / 1_000;
  const off = seconds < 1.5 ? "within 1 s of the time server" : `${Math.round(seconds)} s ${offset > 0 ? "ahead of" : "behind"} the time server`;
  if (seconds > SIGNED_REQUEST_SKEW_S) return fail("clock", `Clock is ${off}`, "correct the clock. This check does not change it");
  if (seconds > 30 || synced === false) return warn("clock", `Clock is ${off}${synced === false ? ", and not kept synchronised" : ""}`);
  return ok("clock", `Clock is ${off}`);
}

function localApp(platform: NodeJS.Platform): HostCheck[] {
  if (platform === "win32") {
    return [ok("role", "This is the OpenBot Windows app. OpenBot, its engines and its agents stay on this computer. A Linux VPS that only hosts the remote desktop is checked there with doctor --host --desktop. The Windows app does not need the Linux server prerequisites, and Google Cloud CLI is not required.")];
  }
  const name = platform === "darwin" ? "macOS" : platform;
  return [warn("role", `doctor --host checks a Linux machine. This is ${name}. The Windows app is the local installation; a desktop-only VPS is checked on that machine with --desktop.`)];
}

export async function checkHost(probe: HostProbe, options: HostOptions): Promise<HostCheck[]> {
  if (options.role === "windows-app" || options.role === "other") return localApp(probe.platform);
  if (probe.platform !== "linux") return localApp(probe.platform);
  if (options.role === "desktop") {
    return [
      ok("role", "This Linux machine hosts the remote desktop container only. OpenBot and its agents are not installed here and are not required."),
      ok("cloud-cli", "Google Cloud CLI is not required and was not used."),
      ok("sandbox", "The bot sandbox is not required on a desktop-only VM. User namespaces, seccomp and cgroup v2 were not required."),
      systemCheck(probe),
      archCheck(probe, "desktop"),
      await containerCheck(probe, "desktop"),
      diskCheck(probe, options.dataDir, "desktop"),
      sizeCheck(probe, "desktop"),
      await clockCheck(probe, options.timeUrl),
    ];
  }
  const [containers, ports, clock] = await Promise.all([
    containerCheck(probe, "server"), portChecks(probe, options), clockCheck(probe, options.timeUrl),
  ]);
  return [
    ok("role", "This Linux machine is checked as a host for OpenBot and the bot sandbox."),
    systemCheck(probe), archCheck(probe, "server"), containers, userNamespaceCheck(probe), seccompCheck(probe), cgroupCheck(probe),
    diskCheck(probe, options.dataDir, "server"), encryptedCheck(probe, options.dataDir), sizeCheck(probe, "server"), ...ports, clock,
  ];
}

export function hostReport(checks: readonly HostCheck[], role: HostRole): { result: Record<string, unknown>; exitCode: number; human: string[] } {
  const problems = checks.filter((check) => check.status === "FAIL").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return {
    result: { ok: problems === 0, role, problems, warnings, checks },
    exitCode: problems ? EXIT.hostMissing : EXIT.done,
    human: [
      ...checks.flatMap((check) => [`${check.status.padEnd(6)}${check.message}`, ...(check.fix && check.status !== "ok" ? [`      fix: ${check.fix}`] : [])]),
      problems ? `${plural(problems, "problem")}${warnings ? `, ${plural(warnings, "warning")}` : ""}.` : `Ready${warnings ? `, with ${plural(warnings, "warning")}` : ""}.`,
    ],
  };
}

function run(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((done) => {
    execFile(command, args, { timeout: 10_000, env: { ...process.env, LC_ALL: "C" } }, (error, stdout, stderr) => {
      done({ ok: !error, stdout: String(stdout), stderr: String(stderr), missing: (error as NodeJS.ErrnoException | null)?.code === "ENOENT" });
    });
  });
}

export function systemProbe(): HostProbe {
  const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return null; } };
  return {
    platform: process.platform, arch: arch(), kernel: release(), cpus: cpus().length, memoryBytes: totalmem(),
    read,
    list: (path) => { try { return readdirSync(path); } catch { return []; } },
    run,
    freeBytes(path) {
      let at = resolve(path);
      while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
      try {
        const stats = statfsSync(at);
        return Number(stats.bavail) * Number(stats.bsize);
      } catch {
        return null;
      }
    },
    async serverAnswers(port) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
        return ((await response.json()) as { app?: unknown }).app === "openmausbot";
      } catch {
        return false;
      }
    },
  };
}

export function hostRole(platform: NodeJS.Platform, desktop: boolean): HostRole {
  if (platform === "win32") return "windows-app";
  if (platform !== "linux") return "other";
  return desktop ? "desktop" : "server";
}

export async function hostDoctor(ctx: VerbContext, probe: HostProbe = systemProbe()): Promise<VerbOutcome> {
  const rawPort = flag(ctx.flags, "port") ?? ctx.env.OMB_PORT ?? "8799";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw usageError("--port must be 1-65535");
  const timeUrl = flag(ctx.flags, "time-url")?.trim();
  if (timeUrl !== undefined && !timeUrl.startsWith("https://")) throw usageError("--time-url must be an https address you operate");
  const dataDir = posix.resolve(flag(ctx.flags, "data-dir") ?? ctx.env.OMB_DATA_DIR ?? join(homedir(), ".openbot"));
  const domain = flag(ctx.flags, "domain")?.trim().toLowerCase();
  const role = hostRole(probe.platform, ctx.flags.desktop === true);
  const report = hostReport(await checkHost(probe, { dataDir, port, role, ...(domain ? { domain } : {}), ...(timeUrl ? { timeUrl } : {}) }), role);
  return { result: report.result, exitCode: report.exitCode, human: report.human };
}
