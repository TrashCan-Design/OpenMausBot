import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { publishWindowsRelease, validateWindowsBundle, verifyPublicWindowsRelease } from "./windows-release.mjs";

const SHA = "a".repeat(40), OTHER = "b".repeat(40), VERSION = "0.1.137", REPO = "TrashCan-Design/OpenBot";
const directories: string[] = [];
const digest = (data: Buffer | string, algorithm = "sha256", encoding: "hex" | "base64" = "hex") => createHash(algorithm).update(data).digest(encoding);
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "openbot-release-")); directories.push(directory);
  const exe = `OpenBot-${VERSION}-setup.exe`, bytes = Buffer.from("synthetic installer");
  const sha512 = digest(bytes, "sha512", "base64");
  const feed = { version: VERSION, files: [{ url: exe, sha512, size: bytes.length }], path: exe, sha512 };
  const feedBytes = Buffer.from(stringify(feed));
  for (const [file, data] of Object.entries({ [exe]: bytes, [`${exe}.blockmap`]: "blockmap", "latest.yml": feedBytes,
    "SHA256SUMS.txt": `${digest(bytes)}  ${exe}\n`, "SOURCE_COMMIT.txt": `${SHA}\n` })) writeFileSync(join(directory, file), data);
  return { directory, exe, bytes, feed, feedBytes };
}

function github(directory: string, releases: Array<{ tagName: string; isDraft?: boolean; isPrerelease?: boolean }> = []) {
  const calls: string[][] = [];
  let tagSha = SHA, corrupt = "", tagExists = true;
  const gh = (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") {
      if (args[1].includes("/git/matching-refs/")) return JSON.stringify(tagExists ? [{ ref: `refs/tags/v${VERSION}` }] : []);
      if (args[1].endsWith("/git/refs")) { tagExists = true; return "{}"; }
      if (args[1].includes("/commits/")) return JSON.stringify({ sha: tagSha });
      const files = [`OpenBot-${VERSION}-setup.exe`, `OpenBot-${VERSION}-setup.exe.blockmap`, "latest.yml", "SHA256SUMS.txt", "SOURCE_COMMIT.txt"];
      return JSON.stringify({ assets: files.map(name => ({ name, size: readFileSync(join(directory, name)).length,
        digest: `sha256:${name === corrupt ? "0".repeat(64) : digest(readFileSync(join(directory, name)))}` })) });
    }
    if (args[1] === "view") return JSON.stringify({ apiUrl: `https://api.github.com/repos/${REPO}/releases/123`, targetCommitish: tagSha });
    return args[1] === "list" ? JSON.stringify(releases) : "";
  };
  return { calls, gh, noTag: () => { tagExists = false; }, wrongTag: () => { tagSha = OTHER; }, corruptAsset: (name: string) => { corrupt = name; } };
}

describe("Windows updater release validation", () => {
  it("accepts the matching updater metadata and rejects stale hashes, size, version, path and missing blockmap", () => {
    const f = fixture();
    expect(validateWindowsBundle(f.directory, VERSION).sha256).toBe(digest(f.bytes));
    const badFeeds = [
      { ...f.feed, version: "0.1.136" }, { ...f.feed, path: "../wrong.exe" }, { ...f.feed, sha512: "wrong" },
      { ...f.feed, files: [{ ...f.feed.files[0], size: 999 }] },
      { ...f.feed, files: [{ ...f.feed.files[0], sha512: "wrong" }] },
      { ...f.feed, files: [{ ...f.feed.files[0], url: "https://other.example/setup.exe" }] },
      { ...f.feed, files: [...f.feed.files, ...f.feed.files] },
    ];
    for (const feed of badFeeds) {
      writeFileSync(join(f.directory, "latest.yml"), stringify(feed));
      expect(() => validateWindowsBundle(f.directory, VERSION)).toThrow("does not match");
    }
    writeFileSync(join(f.directory, "latest.yml"), f.feedBytes);
    rmSync(join(f.directory, `${f.exe}.blockmap`));
    expect(() => validateWindowsBundle(f.directory, VERSION)).toThrow();
    expect(() => validateWindowsBundle(f.directory, "0.1.138-beta.1")).toThrow("stable");
  });

  it("publishes all assets as a draft before making it latest and checking the anonymous public feed", async () => {
    const f = fixture(), g = github(f.directory); let verified = 0;
    g.noTag();
    writeFileSync(join(f.directory, "SHA256SUMS.txt"), `${digest(f.bytes)} *${f.exe}\r\n`);
    const url = await publishWindowsRelease({ ...f, version: VERSION, sha: SHA, repository: REPO, gh: g.gh,
      verifyPublic: async () => { verified++; } });
    expect(url).toContain(`/releases/tag/v${VERSION}`);
    const create = g.calls.find(args => args[1] === "create")!;
    expect(create).toContain("--draft"); expect(create).toContain(SHA);
    expect(g.calls.findIndex(args => args[1]?.endsWith("/git/refs"))).toBeLessThan(g.calls.indexOf(create));
    for (const name of [f.exe, `${f.exe}.blockmap`, "latest.yml", "SOURCE_COMMIT.txt", "SHA256SUMS.txt"]) expect(create).toContain(join(f.directory, name));
    const edit = g.calls.findIndex(args => args[1] === "edit");
    expect(g.calls[edit]).toContain("--latest");
    expect(g.calls.findIndex(args => args[1]?.includes("releases/123"))).toBeLessThan(edit);
    expect(verified).toBe(1);
  });

  it("rejects wrong source, repository, checksums, reused versions and downgrades without publishing", async () => {
    for (const reason of ["source", "repo", "checksum", "version", "downgrade"]) {
      const f = fixture(), g = github(f.directory, reason === "version" ? [{ tagName: `v${VERSION}` }] : reason === "downgrade" ? [{ tagName: "v0.1.138" }] : []);
      if (reason === "source") writeFileSync(join(f.directory, "SOURCE_COMMIT.txt"), OTHER);
      if (reason === "checksum") writeFileSync(join(f.directory, "SHA256SUMS.txt"), "wrong");
      if (reason === "version") g.wrongTag();
      await expect(publishWindowsRelease({ ...f, version: VERSION, sha: SHA, repository: reason === "repo" ? "other/repo" : REPO,
        gh: g.gh, verifyPublic: async () => {} })).rejects.toThrow();
      expect(g.calls.some(args => ["create", "edit", "upload"].includes(args[1]))).toBe(false);
    }
  });

  it("keeps incomplete or corrupt uploads in draft and refuses a mismatched tag", async () => {
    for (const tagMismatch of [false, true]) {
      const f = fixture(), g = github(f.directory);
      if (tagMismatch) g.wrongTag(); else g.corruptAsset("latest.yml");
      await expect(publishWindowsRelease({ ...f, version: VERSION, sha: SHA, repository: REPO, gh: g.gh })).rejects.toThrow();
      expect(g.calls.some(args => args[1] === "edit")).toBe(false);
    }
  });

  it("resumes a draft of the same commit, and re-verifies a published release without overwriting it", async () => {
    for (const draft of [true, false]) {
      const f = fixture(), g = github(f.directory, [{ tagName: `v${VERSION}`, isDraft: draft }]);
      await publishWindowsRelease({ ...f, version: VERSION, sha: SHA, repository: REPO, gh: g.gh, verifyPublic: async () => {} });
      expect(g.calls.some(args => args[1] === "create")).toBe(false);
      expect(g.calls.some(args => args[1] === "upload")).toBe(draft);
      expect(g.calls.some(args => args[1] === "edit")).toBe(draft);
    }
  });

  it("retries propagation failures and fails visibly if public latest never becomes available", async () => {
    const f = fixture(), g = github(f.directory); let checks = 0, waits = 0;
    await publishWindowsRelease({ ...f, version: VERSION, sha: SHA, repository: REPO, gh: g.gh, attempts: 3,
      sleep: async () => { waits++; }, verifyPublic: async () => { if (++checks < 3) throw new Error("not propagated"); } });
    expect(checks).toBe(3); expect(waits).toBe(2);
    await expect(publishWindowsRelease({ ...f, version: VERSION, sha: SHA, repository: REPO, gh: g.gh, attempts: 2,
      sleep: async () => {}, verifyPublic: async () => { throw new Error("not propagated"); } })).rejects.toThrow("public updater verification failed");
  });

  it("checks public feed bytes and downloadable installer/blockmap without authentication", async () => {
    const f = fixture(), bundle = validateWindowsBundle(f.directory, VERSION);
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("latest.yml")) return new Response(f.feedBytes);
      return new Response(null, { headers: { "content-length": String(url.endsWith(".blockmap") ? 8 : f.bytes.length) } });
    };
    await verifyPublicWindowsRelease({ version: VERSION, bundle, fetchImpl });
    expect(requests).toHaveLength(3);
    expect(requests.every(r => r.url.startsWith(`https://github.com/${REPO}/releases/latest/download/`) && !r.init.headers)).toBe(true);
    await expect(verifyPublicWindowsRelease({ version: VERSION, bundle, fetchImpl: async () => new Response("stale") })).rejects.toThrow("latest.yml");
    await expect(verifyPublicWindowsRelease({ version: VERSION, bundle, fetchImpl: async (url: string) =>
      url.endsWith("latest.yml") ? new Response(f.feedBytes) : new Response(null, { status: 404 }) })).rejects.toThrow("unavailable");
  });
});
