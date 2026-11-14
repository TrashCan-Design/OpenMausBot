import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import type { McpServerSpec } from "../contracts.ts";
import type { AppConfig } from "../config.ts";
import { MCP_RESTART_ENV, mcpServerConfigHash } from "../mcp-app-catalog.ts";
import { claimedNotice, createMcpServersHost } from "./mcp-servers-host.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const IRIS = { id: "iris", name: "Iris" }, PAUL = { id: "paul", name: "Paul" }, ROSA = { id: "rosa", name: "Rosa", mcpServers: [] as string[] };
const commandEnv = (server: McpServerSpec | undefined): Record<string, string> => {
  if (!server || !("command" in server)) throw new Error("expected a command server");
  return server.env;
};
const NOTES_ONLY = { id: "nina", name: "Nina", toolScope: { allow: ["mcp:notes:*"] } }, NO_SERVERS = { id: "otto", name: "Otto" };

function script(data: string, ...parts: string[]): string {
  const path = join(data, ...parts);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "import mcp\n");
  return path;
}

function setup(options: { boxed?: boolean; data?: string; bots?: Array<{ id: string; name: string; mcpServers?: string[]; toolScope?: unknown }> } = {}) {
  const data = options.data ?? mkdtempSync(join(tmpdir(), "omb-mcp-host-"));
  if (!options.data) dirs.push(data);
  const cfg: AppConfig = {
    mcpServers: {
      "sketch-suite": { command: "/usr/bin/python3", args: [script(data, "task-workspaces", "iris", "t1", "native-sketch", "server.py")], enabled: true },
      blender: { command: "/usr/bin/python3", args: [script(data, "task-workspaces", "iris", "t2", "blender-mcp", "server.py")], enabled: true },
      "blender-own": { command: "/usr/bin/python3", args: [script(data, "workspaces", "iris", "tools", "blender-mcp", "server.py")], enabled: true },
      notes: { command: "npx", args: ["-y", "@x/notes-mcp"], enabled: true },
      broken: { command: "/usr/bin/false", args: [], enabled: true },
    },
  } as AppConfig;
  const told: Array<{ text: string; about: string }> = [];
  const started: string[] = [];
  const host = createMcpServersHost({
    dataDir: data,
    cfg: () => cfg,
    persist: (next) => { cfg.mcpServers = next; },
    bots: () => options.bots ?? [IRIS, PAUL, ROSA, NOTES_ONLY, NO_SERVERS],
    startsServers: (botId) => botId !== NO_SERVERS.id,
    boxed: () => options.boxed ?? true,
    policy: (servers) => servers,
    tell: (text, about) => told.push({ text, about: about.id }),
    // The image's python has no `mcp` module: these start only in Iris's own box, where it is installed.
    start: async (name, server, botId) => {
      started.push(`${name}:${botId}`);
      if (name === "broken") return { ok: false, error: "The server stopped before the MCP handshake finished." };
      return server.command === "/usr/bin/python3" && botId !== "iris" ? { ok: false, error: "No module named 'mcp'" } : { ok: true };
    },
  });
  return { cfg, host, told, started, data };
}

it("moves servers in one bot's folders to that bot once, says so once, and keeps them out of every other bot's turns", async () => {
  const { cfg, host, told, started, data } = setup();
  host.boot();
  await host.health.settled();
  expect(told).toEqual([
    { text: "The Blender, Blender-own and Sketch-suite tools only work for Iris, so they're off for your other bots.", about: "iris" },
    { text: "The Broken tool doesn't start, so it's off for now. It comes back on its own once it starts.", about: "iris" },
  ]);
  expect((cfg.mcpServers!.blender as { args: string[] }).args).toEqual([join(data, "workspaces", "iris", "tools", "blender-mcp-2", "server.py")]);
  expect(Object.keys(host.mounted(IRIS)).sort()).toEqual(["blender", "blender-own", "notes", "sketch-suite"]);
  expect(Object.keys(host.mounted(PAUL)).sort()).toEqual(["notes"]);
  expect(host.mounted(ROSA), "a bot given no servers gets none").toEqual({});
  expect(started.sort(), "Iris's own servers are started for Iris only, every bot's once for all").toEqual(["blender-own:iris", "blender:iris", "broken:iris", "notes:iris", "sketch-suite:iris"]);
  expect(host.off(PAUL)).toEqual([{ name: "broken", error: "The server stopped before the MCP handshake finished." }]);
  expect(host.off(NOTES_ONLY), "a bot whose tool selection never reaches it is not told about it").toEqual([]);
  expect(host.health.offFor("broken"), "nor a bot whose AI starts no servers").toEqual(["iris", "paul"]);

  host.boot();
  await host.health.settled();
  expect(told, "a second start says nothing new").toHaveLength(2);
  host.botDeleted("iris");
  expect(Object.keys(cfg.mcpServers!).sort()).toEqual(["broken", "notes"]);
});

it("where every bot reaches every folder (a desktop), keeps such servers every bot's and says nothing about them", async () => {
  const { cfg, host, told, data } = setup({ boxed: false });
  host.boot();
  await host.health.settled();
  expect(Object.values(cfg.mcpServers!).some((server) => "bot" in (server as object))).toBe(false);
  expect((cfg.mcpServers!.blender as { args: string[] }).args[0], "nothing moved").toBe(join(data, "task-workspaces", "iris", "t2", "blender-mcp", "server.py"));
  expect(told.map((entry) => entry.text)).toEqual(["The Broken tool doesn't start, so it's off for now. It comes back on its own once it starts."]);
  expect(existsSync(join(data, "mcp-bot-servers.json")), "a later boxed start still moves them over").toBe(false);
});

it("moves servers over once: a server added in Settings afterwards stays every bot's across restarts", () => {
  const first = setup();
  first.host.boot();
  first.cfg.mcpServers!.shared = { command: "/usr/bin/python3", args: [script(first.data, "workspaces", "iris", "tools", "shared", "server.py")], enabled: true };
  const again = createMcpServersHost({
    dataDir: first.data, cfg: () => first.cfg, persist: (next) => { first.cfg.mcpServers = next; }, bots: () => [IRIS, PAUL], policy: (servers) => servers,
    tell: () => {}, startsServers: () => true, boxed: () => true, start: async () => ({ ok: true }),
  });
  again.boot();
  expect(first.cfg.mcpServers!.shared).not.toHaveProperty("bot");
  expect(Object.keys(again.mounted(PAUL))).toContain("shared");
});

it("never makes a server the own of a deleted bot whose folder was left behind", () => {
  const { cfg, host } = setup({ bots: [PAUL, ROSA] });
  host.boot();
  expect(Object.values(cfg.mcpServers!).some((server) => "bot" in (server as object)), "Iris is gone").toBe(false);
});

it("restarts a command server in the next turn's spec and leaves its saved keys, apps and owner alone", async () => {
  const { cfg, host, started } = setup({ boxed: false });
  const notes = cfg.mcpServers!.notes as { command: string; args: string[]; env: Record<string, string>; enabled: boolean };
  notes.env = { TOKEN: "saved-secret" };
  host.boot();
  await host.health.settled();
  const savedNotes = JSON.stringify(notes);
  const first = commandEnv(host.mounted(IRIS).notes);
  expect(first.TOKEN).toBe("saved-secret");
  expect(first[MCP_RESTART_ENV]).toBeUndefined();
  expect(host.restart("notes")).toEqual({ ok: true });
  expect(host.restart("missing")).toMatchObject({ ok: false, status: 404 });
  cfg.mcpServers!.remote = { type: "http", url: "https://notes.example/mcp", headers: { Authorization: "saved-secret" }, enabled: true };
  expect(host.restart("remote")).toMatchObject({ ok: false, status: 400 });
  notes.enabled = false;
  expect(host.restart("notes")).toMatchObject({ ok: false, status: 409 });
  notes.enabled = true;
  expect(JSON.stringify(notes)).toBe(savedNotes);
  const again = host.mounted(IRIS).notes;
  if (!again || !("command" in again)) throw new Error("expected a command server");
  expect(again.env).toMatchObject({ TOKEN: "saved-secret", [MCP_RESTART_ENV]: "1" });
  expect(mcpServerConfigHash({ ...again, env: first })).toBe(mcpServerConfigHash(again));
  expect(host.restart("notes")).toEqual({ ok: true });
  expect(commandEnv(host.mounted(IRIS).notes)[MCP_RESTART_ENV]).toBe("2");
  host.forgetRestart("notes");
  expect(commandEnv(host.mounted(IRIS).notes)[MCP_RESTART_ENV]).toBeUndefined();
  expect(started.filter((line) => line.startsWith("notes:")).length).toBeGreaterThan(0);
});

it("one restart check runs while an earlier check of that server is still starting", async () => {
  const data = mkdtempSync(join(tmpdir(), "omb-mcp-restart-"));
  dirs.push(data);
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  let starts = 0;
  const cfg = { mcpServers: { notes: { command: "npx", args: ["-y", "notes"], env: {}, enabled: true } } } as AppConfig;
  const host = createMcpServersHost({
    dataDir: data, cfg: () => cfg, persist: () => {}, bots: () => [IRIS], policy: (servers) => servers,
    tell: () => {}, startsServers: () => true, boxed: () => false,
    start: async () => { starts += 1; await gate; return { ok: true }; },
  });
  expect(host.restart("notes")).toEqual({ ok: true });
  expect(host.restart("notes")).toEqual({ ok: true });
  await new Promise((done) => setTimeout(done, 20));
  expect(starts).toBe(1);
  release();
  await host.health.settled();
  expect(starts, "the pending failure is discarded and one fresh check runs after it").toBe(2);
  expect(commandEnv(host.mounted(IRIS).notes)[MCP_RESTART_ENV]).toBe("2");
});

it("says it in one plain line per bot", () => {
  expect(claimedNotice("Iris", ["blender"])).toBe("The Blender tool only works for Iris, so it's off for your other bots.");
});
