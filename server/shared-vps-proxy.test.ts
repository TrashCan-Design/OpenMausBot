import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
let child: ChildProcessWithoutNullStreams | undefined, server: Server | undefined, dir: string | undefined;
afterEach(async () => {
  if (child) { const stopped = new Promise<void>(resolve => child!.once("close", () => resolve())); child.kill(); await stopped; child = undefined; }
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  if (dir) rmSync(dir, { recursive: true, force: true });
});
describe("shared desktop production stdio proxy", () => {
  it("keeps numeric and string IDs distinct, handles out-of-order replies, and never retries a failed action", async () => {
    const requests: Array<{ id: unknown; method: string }> = [];
    server = createServer(async (req, res) => {
      expect(req.headers.authorization).toBe("Bearer fixture-turn-capability");
      let raw = ""; for await (const chunk of req) raw += chunk;
      const frame = JSON.parse(raw); requests.push(frame);
      if (frame.id === 1) await new Promise(resolve => setTimeout(resolve, 80));
      res.setHeader("content-type", "application/json");
      if (frame.method === "fail") { res.statusCode = 409; res.end(JSON.stringify({ error: "Recovery required" })); }
      else res.end(JSON.stringify({ result: { echo: frame.id } }));
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
    dir = mkdtempSync(join(tmpdir(), "openbot-proxy-"));
    const script = join(dir, "proxy.mjs");
    writeFileSync(script, `import { runSharedVpsProxy } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "server/shared-vps-proxy.ts")).href)}; runSharedVpsProxy(${JSON.stringify(`http://127.0.0.1:${address.port}/mcp`)}, "fixture-turn-capability");`);
    child = spawn(process.execPath, ["--experimental-strip-types", script], { stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.resume();
    for (const frame of [{ id: 1, method: "ping" }, { id: "1", method: "ping" }, { id: 2, method: "fail" }]) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\n");
    await vi.waitFor(() => expect(output.trim().split("\n")).toHaveLength(3), { timeout: 10_000 });
    const replies = output.trim().split("\n").map(line => JSON.parse(line));
    expect(replies.find(frame => frame.id === 1).result).toEqual({ echo: 1 });
    expect(replies.find(frame => frame.id === "1").result).toEqual({ echo: "1" });
    expect(replies.find(frame => frame.id === 2).error.message).toBe("Recovery required");
    expect(requests).toHaveLength(3);
  });
});
