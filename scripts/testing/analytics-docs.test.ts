// docs/analytics.md is the promise of what the app sends, and the docs site shows the same page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8").replace(/\r\n/g, "\n");

describe("docs/analytics.md", () => {
  it("is the page the docs site shows", () => {
    const docs = read("docs/analytics.md");
    const site = read("apps/docs/content/docs/security/analytics.mdx");
    expect(site.slice(site.indexOf("\n---\n", 3) + "\n---\n".length)).toBe(docs.slice(docs.indexOf("\n") + 1));
  });
});
