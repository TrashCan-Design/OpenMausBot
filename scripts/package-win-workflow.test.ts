import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
const workflow = parse(readFileSync(new URL("../.github/workflows/package-win.yml", import.meta.url), "utf8"));
describe("OpenBot Windows build and updater release", () => {
  it("builds the existing installer branch on Windows with a read-only build token", () => {
    expect(workflow.on.push.branches).toEqual(["codex/windows-installer"]);
    expect(workflow.on.workflow_dispatch.inputs.ref.required).toBe(false);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.package["runs-on"]).toBe("windows-latest");
    expect(workflow.jobs.package.env.NODE_OPTIONS).toBe("--max-old-space-size=6144");
    expect(workflow.jobs.package.steps.some((step: { run?: string }) => step.run === "pnpm package:win")).toBe(true);
    expect(JSON.stringify(workflow)).not.toContain("gh release");
    expect(workflow.jobs.package.steps[0].with).toEqual({ ref: "${{ inputs.ref || github.sha }}", "persist-credentials": false });
  });
  it("publishes only a successful installer-branch push and serializes stable releases", () => {
    expect(workflow.concurrency).toEqual({ group: "openbot-windows-release", "cancel-in-progress": false });
    const publish = workflow.jobs.publish;
    expect(publish.needs).toBe("package");
    expect(publish.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/codex/windows-installer' && github.repository == 'TrashCan-Design/OpenBot'");
    expect(publish.permissions).toEqual({ contents: "write" });
    expect(publish.steps[0].with).toEqual({ ref: "${{ github.sha }}", "persist-credentials": false });
    expect(publish.steps.find((s: { uses?: string }) => s.uses?.startsWith("actions/download-artifact@"))?.with).toEqual({ name: "windows-installer", path: "release" });
    expect(publish.steps.at(-1).run).toBe("node scripts/windows-release.mjs publish release");
    const main = parse(readFileSync(new URL("../.github/workflows/openbot-windows-release.yml", import.meta.url), "utf8"));
    expect(main.concurrency).toEqual(workflow.concurrency);
    expect(main.jobs.package.if).toContain("refs/heads/main");
    expect(main.jobs.package.steps.at(-1).run).toContain("node scripts/windows-release.mjs publish release");
    expect(workflow.jobs.package.steps.find((s: { name?: string }) => s.name === "Verify updater metadata matches the installer")?.run).toBe("node scripts/windows-release.mjs validate release");
  });
  it("keeps the resource, browser, server and fork updater checks", () => {
    const steps = workflow.jobs.package.steps as Array<{ name?: string; run?: string }>;
    expect(steps.some(step => step.run?.includes("smoke-browser-bundle.mjs"))).toBe(true);
    expect(steps.some(step => step.run?.includes("smoke-packaged-server.mjs"))).toBe(true);
    expect(steps.some(step => step.name === "start the packaged server")).toBe(true);
    expect(steps.find(step => step.name === "Verify Windows shared desktop and credential safety")?.run).toContain("server/phone-secret.test.ts");
    const verify = steps.find(step => step.name === "verify the packaged tree")!.run!;
    expect(verify).toContain("repo: OpenBot"); expect(verify).toContain("owner: TrashCan-Design");
    expect(verify).toContain("publisherName");
  });
  it("uploads the exe, updater metadata, checksum and exact source commit together", () => {
    const artifact = workflow.jobs.package.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact@"));
    for (const path of ["release/*.exe", "release/*.exe.blockmap", "release/latest.yml", "release/SHA256SUMS.txt", "release/SOURCE_COMMIT.txt"]) expect(artifact.with.path).toContain(path);
    const record = workflow.jobs.package.steps.find((step: { name?: string }) => step.name === "Record installer checksums and source");
    expect(record.run).toContain("cd release\nsha256sum *.exe");
  });
});
