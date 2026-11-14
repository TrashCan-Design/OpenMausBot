import { existsSync, readFileSync, openSync, fsyncSync, closeSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const operation = z.object({ id: z.string().min(1).max(512), alias: z.string().min(1).max(256), owner: z.string().min(1).max(1024), target: z.string().regex(/^(?:[0-9a-f]{64})?$/) });
const journal = z.object({ version: z.literal(1), operations: z.array(operation).max(1_024) });
export type DesktopOperation = z.infer<typeof operation>;

/** Admission is durable before dispatch. A transport error never acknowledges remote completion. */
export class SharedVpsJournal {
  private rows = new Map<string, DesktopOperation>();
  constructor(privatePath?: string) {
    this.file = privatePath;
    if (!privatePath || !existsSync(privatePath)) return;
    const saved = journal.parse(JSON.parse(readFileSync(privatePath, "utf8")));
    for (const row of saved.operations) {
      if (this.rows.has(row.id)) throw new Error("Duplicate desktop operation identity in journal");
      this.rows.set(row.id, row);
    }
  }
  private readonly file: string | undefined;
  list(alias?: string): DesktopOperation[] { return [...this.rows.values()].filter(row => alias === undefined || row.alias === alias); }
  add(row: DesktopOperation): boolean {
    const previous = this.rows.get(row.id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("Desktop operation identity conflict");
      return false;
    }
    if (this.rows.size >= 1_024) throw new Error("Too many unresolved desktop operations");
    this.rows.set(row.id, row);
    try { this.save(); } catch (error) { this.rows.delete(row.id); throw error; }
    return true;
  }
  finish(id: string, alias: string, owner: string): boolean {
    const row = this.rows.get(id);
    if (!row || row.alias !== alias || row.owner !== owner) return false;
    this.rows.delete(id);
    try { this.save(); } catch (error) { this.rows.set(id, row); throw error; }
    return true;
  }
  private save(): void {
    if (!this.file) return;
    writeFileAtomic(this.file, JSON.stringify({ version: 1, operations: this.list() }), { mode: 0o600 });
    if (process.platform !== "win32") {
      const fd = openSync(dirname(this.file), "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    }
  }
}
