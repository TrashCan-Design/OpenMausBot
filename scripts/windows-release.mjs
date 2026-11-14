import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const REPO = "TrashCan-Design/OpenBot";
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const hash = (data, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(data).digest(encoding);
const newer = (a, b) => {
  const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
};

export function validateWindowsBundle(directory, version) {
  if (!stable.test(version)) throw new Error("Expected a stable semantic version");
  const exe = `OpenBot-${version}-setup.exe`;
  const installer = readFileSync(join(directory, exe));
  const feedBytes = readFileSync(join(directory, "latest.yml"));
  const feed = parse(feedBytes.toString("utf8"));
  const digest = hash(installer, "sha512", "base64");
  const entry = feed?.files?.find(item => item.url === exe);
  if (!installer.length || feed.version !== version || feed.files?.length !== 1 || !entry || entry.size !== installer.length ||
    entry.sha512 !== digest || feed.path !== exe || feed.sha512 !== digest) {
    throw new Error("The updater feed does not match the installer");
  }
  if (!statSync(join(directory, `${exe}.blockmap`)).size) throw new Error("The installer blockmap is empty");
  return { exe, feedBytes, size: installer.length, sha256: hash(installer) };
}

export async function verifyPublicWindowsRelease({ version, bundle, fetchImpl = fetch }) {
  const base = `https://github.com/${REPO}/releases/latest/download/`;
  const feed = await fetchImpl(`${base}latest.yml`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!feed.ok || hash(Buffer.from(await feed.arrayBuffer())) !== hash(bundle.feedBytes)) {
    throw new Error(`Public latest.yml does not match v${version}`);
  }
  for (const file of [bundle.exe, `${bundle.exe}.blockmap`]) {
    const response = await fetchImpl(`${base}${file}`, { method: "HEAD", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const size = Number(response.headers.get("content-length"));
    if (!response.ok || !Number.isSafeInteger(size) || size <= 0 || (file === bundle.exe && size !== bundle.size)) {
      throw new Error(`Public installer asset is unavailable or has the wrong size: ${file}`);
    }
  }
}

export async function publishWindowsRelease({ directory, version, sha, repository, gh = args => execFileSync("gh", args, { encoding: "utf8" }),
  verifyPublic = verifyPublicWindowsRelease, sleep = ms => new Promise(r => setTimeout(r, ms)), attempts = 12 }) {
  if (repository !== REPO || !/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Unexpected release repository or source commit");
  const bundle = validateWindowsBundle(directory, version);
  if (readFileSync(join(directory, "SOURCE_COMMIT.txt"), "utf8").trim() !== sha) throw new Error("Installer source does not match this workflow commit");
  const checksum = readFileSync(join(directory, "SHA256SUMS.txt"), "utf8").trim();
  if (![`${bundle.sha256}  ${bundle.exe}`, `${bundle.sha256} *${bundle.exe}`].includes(checksum)) throw new Error("Installer SHA256SUMS.txt does not match");
  const tag = `v${version}`;
  const releases = JSON.parse(gh(["release", "list", "--repo", REPO, "--limit", "100", "--json", "tagName,isDraft,isPrerelease"]));
  for (const release of releases) {
    const existing = release.tagName.replace(/^v/, "");
    if (!release.isDraft && !release.isPrerelease && stable.test(existing) && newer(existing, version)) {
      throw new Error(`Refusing to replace newer release ${release.tagName} with ${tag}`);
    }
  }
  const existing = releases.find(release => release.tagName === tag);
  const assets = [bundle.exe, `${bundle.exe}.blockmap`, "latest.yml", "SHA256SUMS.txt", "SOURCE_COMMIT.txt"];
  const api = path => JSON.parse(gh(["api", `repos/${REPO}/${path}`]));
  if (existing) {
    const info = JSON.parse(gh(["release", "view", tag, "--repo", REPO, "--json", "targetCommitish"]));
    if (existing.isPrerelease || (existing.isDraft && info.targetCommitish !== sha)) {
      throw new Error(`${tag} already belongs to another build; bump package.json version before releasing`);
    }
  }
  const refs = api(`git/matching-refs/tags/${tag}`);
  if (refs.some(ref => ref.ref === `refs/tags/${tag}`)) {
    if (api(`commits/${tag}`).sha !== sha) throw new Error(`${tag} already belongs to another build; bump package.json version before releasing`);
  } else if (existing && !existing.isDraft) throw new Error("Published release tag is missing");
  else gh(["api", `repos/${REPO}/git/refs`, "--method", "POST", "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`]);
  if (existing) {
    if (existing.isDraft) gh(["release", "upload", tag, ...assets.map(file => join(directory, file)), "--repo", REPO, "--clobber"]);
  } else {
    gh(["release", "create", tag, ...assets.map(file => join(directory, file)), "--repo", REPO, "--target", sha,
      "--title", `OpenBot ${version}`, "--notes", "Windows installer and in-app update. Build and targeted Windows safety checks passed. Full-suite and live VPS verification remain outstanding; see docs/ci-failure-audit.md and docs/verification/shared-vps-desktop.md at the tagged source commit.", "--draft"]);
  }
  if (api(`commits/${tag}`).sha !== sha) throw new Error("Release tag does not point at the tested source commit");
  const location = JSON.parse(gh(["release", "view", tag, "--repo", REPO, "--json", "apiUrl"]));
  if (!location.apiUrl?.startsWith(`https://api.github.com/repos/${REPO}/releases/`)) throw new Error("Unexpected release API location");
  const remote = JSON.parse(gh(["api", location.apiUrl]));
  for (const name of assets) {
    const asset = remote.assets?.find(item => item.name === name);
    const bytes = readFileSync(join(directory, name));
    if (!asset || asset.size !== bytes.length || asset.digest !== `sha256:${hash(bytes)}`) throw new Error(`Uploaded release asset does not match: ${name}`);
  }
  if (!existing || existing.isDraft) gh(["release", "edit", tag, "--repo", REPO, "--draft=false", "--latest"]);
  let failure;
  for (let i = 0; i < attempts; i++) {
    try {
      await verifyPublic({ version, bundle });
      return `https://github.com/${REPO}/releases/tag/${tag}`;
    } catch (error) {
      failure = error;
      if (i + 1 < attempts) await sleep(10_000);
    }
  }
  throw new Error(`Release exists, but public updater verification failed: ${failure?.message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, directory = "release"] = process.argv.slice(2);
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  try {
    if (mode === "validate") validateWindowsBundle(directory, version);
    else if (mode === "publish") {
      const url = await publishWindowsRelease({ directory, version, sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY });
      console.log(`Updater release verified: ${url}`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Windows update published and publicly verified: [v${version}](${url})\n`);
    } else throw new Error("Usage: node scripts/windows-release.mjs validate|publish [directory]");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
