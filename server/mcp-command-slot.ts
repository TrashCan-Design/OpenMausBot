// One command MCP process for a spec. A restart swaps it only after the process we started is confirmed stopped,
// and a call already in flight is not run again.
import type { ChildProcess, StdioOptions } from "node:child_process";

import { killCliTree, spawnCli } from "./procs.ts";

const specKey = (spec: { command: string; args: string[]; env?: NodeJS.ProcessEnv }) => JSON.stringify([spec.command, spec.args, spec.env]);

export class CommandSlot {
  private child: ChildProcess | null = null;
  private key = "";
  private calls = 0;
  private pending: { command: string; args: string[]; env?: NodeJS.ProcessEnv } | null = null;
  private replacing: Promise<void> | null = null;

  pid(): number | undefined {
    return this.child?.pid;
  }

  stop(timeoutMs = 1_000): Promise<boolean> {
    const old = this.child;
    this.child = null;
    this.key = "";
    return old ? killCliTree(old, timeoutMs) : Promise.resolve(true);
  }

  start(spec: { command: string; args: string[]; env?: NodeJS.ProcessEnv }, stdio: StdioOptions = ["ignore", "ignore", "ignore"], owner: "bot" | "openmausbot" = "openmausbot"): ChildProcess {
    if (this.child) throw new Error("a command process is already running");
    this.owner = owner;
    return this.spawn(spec, stdio);
  }

  beginCall(): void {
    this.calls += 1;
  }

  async endCall(): Promise<void> {
    this.calls = Math.max(0, this.calls - 1);
    if (this.calls === 0 && this.pending) {
      const next = this.pending;
      this.pending = null;
      await this.replaceNow(next);
    }
  }

  /** Same spec keeps the process. A different spec replaces it, or waits out the call in flight. */
  async replace(spec: { command: string; args: string[]; env?: NodeJS.ProcessEnv }): Promise<"kept" | "replaced" | "deferred"> {
    if (this.child && specKey(spec) === this.key) return "kept";
    if (this.calls > 0) {
      this.pending = spec;
      return "deferred";
    }
    await this.replaceNow(spec);
    return "replaced";
  }

  private async replaceNow(spec: { command: string; args: string[]; env?: NodeJS.ProcessEnv }): Promise<void> {
    if (this.replacing) return this.replacing;
    const run = (async () => {
      const old = this.child;
      this.child = null;
      this.key = "";
      if (old) {
        const stopped = await killCliTree(old, 1_000);
        if (!stopped) throw new Error("could not confirm the old MCP process stopped");
      }
      this.spawn(spec, this.stdio);
    })();
    this.replacing = run;
    try {
      await run;
    } finally {
      if (this.replacing === run) this.replacing = null;
    }
  }

  private stdio: StdioOptions = ["ignore", "ignore", "ignore"];
  private owner: "bot" | "openmausbot" = "openmausbot";

  private spawn(spec: { command: string; args: string[]; env?: NodeJS.ProcessEnv }, stdio: StdioOptions): ChildProcess {
    this.stdio = stdio;
    const child = spawnCli(spec.command, spec.args, { stdio, env: spec.env ?? process.env }, this.owner);
    this.child = child;
    this.key = specKey(spec);
    return child;
  }
}
