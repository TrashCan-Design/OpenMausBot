import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { ReconnectingMcp } from "./mcp-reconnect.ts";
import { killCliTree, spawnCli } from "./procs.ts";

const fixtures: Array<{ dir: string; transport: ReconnectingMcp }> = [];
const server = `
const fs = require('node:fs');
const readline = require('node:readline');
const dir = process.env.MCP_FIXTURE;
const starts = fs.readFileSync(dir + '/starts', 'utf8').length + 1;
fs.appendFileSync(dir + '/starts', 'x');
if (starts === 1 && process.env.SPAWN_DESCENDANT) {
  require('node:child_process').spawn(process.execPath, ['-e', "const fs=require('node:fs');setInterval(()=>fs.appendFileSync(process.argv[1],'x'),20)", dir + '/heartbeat'], {stdio:'ignore'});
}
readline.createInterface({input:process.stdin}).on('line', line => {
  const frame = JSON.parse(line);
  fs.appendFileSync(dir + '/calls', JSON.stringify({start:starts,...frame}) + '\\n');
  if (frame.method === 'initialize') {
    if (starts === 1 && process.env.DROP_INIT) process.exit(42);
    if (starts > 1 && process.env.IGNORE_INIT) return;
    const protocolVersion = starts > 1 && process.env.BAD_VERSION ? 'wrong' : '2024-11-05';
    console.log(JSON.stringify({jsonrpc:'2.0',id:frame.id,result:{protocolVersion,serverInfo:{name:'fixture',version:'1'}}}));
  } else if (frame.id === 'lost') {
    if (process.env.PARTIAL_FRAME) process.stdout.write('{"jsonrpc":');
    process.exit(42);
  }
  else if (frame.id !== undefined) {
    if (frame.params?.name === 'type_text') fs.writeFileSync(dir + '/desktop-state', frame.params.arguments.text);
    const text = frame.params?.name === 'get_window_state' && fs.existsSync(dir + '/desktop-state') ? fs.readFileSync(dir + '/desktop-state','utf8') : 'done';
    console.log(JSON.stringify({jsonrpc:'2.0',id:frame.id,result:{content:[{type:'text',text}]}}));
  }
});
`;

async function until(probe: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error("MCP fixture timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const stopLeaf: typeof killCliTree = async child => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    child.once("close", () => { clearTimeout(timer); resolve(true); });
    child.kill("SIGTERM");
  });
};

async function fixture(env: NodeJS.ProcessEnv = {}, handshakeMs = 2_000, stop = stopLeaf) {
  const dir = await mkdtemp(join(tmpdir(), "openbot-reconnect-"));
  await writeFile(join(dir, "starts"), ""); await writeFile(join(dir, "calls"), "");
  const transport = new ReconnectingMcp(process.execPath, ["-e", server], { ...process.env, ...env, MCP_FIXTURE: dir }, { delays: [20, 20], handshakeMs, stop });
  fixtures.push({ dir, transport });
  const replies: any[] = [];
  let stderr = "";
  let closed = false;
  transport.stderr.on("data", chunk => { stderr += chunk; });
  transport.on("close", () => { closed = true; });
  createInterface({ input: transport.stdout }).on("line", line => replies.push(JSON.parse(line)));
  const send = (id: string, name: string, args: Record<string, unknown> = {}) => transport.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  const reply = async (id: string) => { await until(() => replies.some(frame => frame.id === id)); return replies.find(frame => frame.id === id); };
  const calls = async () => (await readFile(join(dir, "calls"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  transport.stdin.write('{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}\n');
  await reply("init");
  transport.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  return { transport, dir, replies, send, reply, calls, diagnostics: () => ({ stderr, closed, replies }) };
}

afterEach(async () => {
  for (const { dir, transport } of fixtures.splice(0)) {
    if (!transport.stdin.destroyed) {
      const closed = new Promise<void>(resolve => transport.once("close", () => resolve()));
      transport.kill();
      await closed;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("VPS MCP reconnection", () => {
  it("retries the side-effect-free initial handshake without losing its client id", async () => {
    const f = await fixture({ DROP_INIT: "1" });
    expect(f.replies.find(frame => frame.id === "init").result.protocolVersion).toBe("2024-11-05");
    expect((await readFile(join(f.dir, "starts"), "utf8")).length).toBeGreaterThanOrEqual(2);
  });
  it("reinitializes after a drop, never replays actions, and requires a fresh observation", async () => {
    const f = await fixture();
    f.send("save", "type_text", { text: "shared-desktop-state" });
    await f.reply("save");
    f.send("lost", "click");
    expect((await f.reply("lost")).result).toMatchObject({ isError: true });
    f.send("during-reconnect", "click");
    expect((await f.reply("during-reconnect")).result.isError).toBe(true);
    await until(async () => (await f.calls()).some(frame => frame.start > 1 && frame.method === "notifications/initialized"));
    f.send("stale", "click");
    expect((await f.reply("stale")).result.content[0].text).toContain("Read get_desktop_state");
    f.send("inspect", "get_window_state");
    expect((await f.reply("inspect")).result.isError).toBeUndefined();
    expect((await f.reply("inspect")).result.content[0].text).toBe("shared-desktop-state");
    f.send("fresh", "click");
    expect((await f.reply("fresh")).result.isError).toBeUndefined();
    const calls = await f.calls();
    expect(calls.filter(frame => frame.id === "lost")).toHaveLength(1);
    expect(calls.some(frame => frame.id === "stale" || frame.id === "during-reconnect")).toBe(false);
    expect(calls.some(frame => frame.start > 1 && frame.id === "fresh")).toBe(true);
  });

  it.each(["BAD_VERSION", "IGNORE_INIT"])("bounds recovery when the replacement driver has %s", async flag => {
    const f = await fixture({ [flag]: "1" }, 1_000);
    f.send("lost", "click");
    await f.reply("lost");
    await until(async () => (await readFile(join(f.dir, "starts"), "utf8")).length === 3);
    await new Promise(resolve => setTimeout(resolve, 250));
    expect((await readFile(join(f.dir, "starts"), "utf8")).length).toBe(3);
    expect((await f.calls()).filter(frame => frame.method === "tools/call")).toHaveLength(1);
  });

  it("cancels recovery when the bridge shuts down", async () => {
    const f = await fixture();
    f.send("lost", "click");
    await f.reply("lost");
    const closed = new Promise<void>(resolve => f.transport.once("close", () => resolve()));
    f.transport.kill();
    await closed;
    fixtures.splice(fixtures.findIndex(item => item.transport === f.transport), 1);
    const starts = await readFile(join(f.dir, "starts"), "utf8");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await readFile(join(f.dir, "starts"), "utf8")).toBe(starts);
    await rm(f.dir, { recursive: true, force: true });
  });

  it("discards a truncated response before reconnecting", async () => {
    const f = await fixture({ PARTIAL_FRAME: "1" });
    f.send("lost", "click");
    expect((await f.reply("lost")).result.isError).toBe(true);
    try { await until(async () => (await f.calls()).some(frame => frame.start > 1 && frame.method === "notifications/initialized")); }
    catch { throw new Error(JSON.stringify({ calls: await f.calls(), ...f.diagnostics() })); }
    expect(f.replies.filter(frame => frame.id === "lost")).toHaveLength(1);
  });

  it("stops the old transport's child processes before replacing it", async ({ skip }) => {
    const probe = spawnCli(process.execPath, ["-e", "process.exit(0)"], { stdio: ["pipe", "pipe", "pipe"] });
    await new Promise(resolve => probe.once("close", resolve));
    if (!(await killCliTree(probe, 100))) skip();
    const f = await fixture({ SPAWN_DESCENDANT: "1" }, 2_000, killCliTree);
    await until(async () => (await readFile(join(f.dir, "heartbeat"), "utf8").catch(() => "")).length > 0);
    f.transport.reconnect();
    await until(async () => (await f.calls()).some(frame => frame.start > 1 && frame.method === "notifications/initialized"));
    const heartbeat = await readFile(join(f.dir, "heartbeat"), "utf8");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await readFile(join(f.dir, "heartbeat"), "utf8")).toBe(heartbeat);
  });

  it("does not start a replacement if process cleanup cannot be verified", async () => {
    const f = await fixture({}, 1_000, async child => { await stopLeaf(child, 1_000); return false; });
    const closed = new Promise<void>(resolve => f.transport.once("close", () => resolve()));
    f.send("lost", "click");
    await closed;
    expect((await readFile(join(f.dir, "starts"), "utf8")).length).toBe(1);
  });
});
