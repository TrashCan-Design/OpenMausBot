# Windows installer and in-app updates

The branch used by the previous successful fork installer build is
`codex/windows-installer` (run 41248641661). Its old `fork-windows.yml` checked
`repo: OpenBot`, predating the repository rename. The maintained
`.github/workflows/package-win.yml` already checks `TrashCan-Design/OpenBot`
and the browser, CUA, private updater metadata and packaged server resources.
A push to that installer branch now triggers that existing workflow.

The build is based on the current Shared VPS Desktop implementation plus the
recorded route/OpenCode regression corrections. Version 0.1.138 is newer than both the published 0.1.136 and the
artifact-only 0.1.137 installer. The old installer branch's
history is preserved as a merge parent; its obsolete application tree and old
workflow are replaced by the current reviewed source tree. No force-push or
merge into main is needed.

The job builds on windows-latest with a 6 GiB Node heap and a 60-minute deadline.
It first runs targeted shared-desktop and phone-credential regression tests on
Windows. It preserves existing browser/server/resource verification, starts the packaged
server in an isolated home, then uploads windows-installer containing:

- OpenBot-0.1.138-setup.exe
- its .exe.blockmap and latest.yml
- SHA256SUMS.txt with filenames relative to the extracted artifact
- SOURCE_COMMIT.txt identifying the exact build commit

Download the artifact from its GitHub Actions run, extract it, and compare:

```powershell
Get-FileHash .\OpenBot-0.1.138-setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
Get-Content .\SOURCE_COMMIT.txt
```

Run the EXE to install. A successful package/resource smoke is not a live GCP
or desktop-interaction qualification. The installer retains the existing signing
configuration; this workflow does not invent a signing identity.

## Release publication

Pushes to `codex/windows-installer` now publish the verified Windows artifact
as a stable GitHub Release after the build and smoke checks pass. A separate
publication job alone has a write token; dependency installation and packaging
keep a read-only token. Both release workflows share one concurrency group.
Manual builds of arbitrary refs remain artifact-only.

The publication helper checks the exact source commit, stable version,
installer/feed hashes and sizes, blockmap, checksum file, tag target, and the
uploaded assets' GitHub SHA-256 digests. It uploads into a draft first, then
publishes as latest only when all assets match. It verifies the public
`releases/latest/download/latest.yml` and the downloadable EXE and blockmap
without authentication, with bounded retries for GitHub propagation. A failure
fails the job instead of reporting an artifact as an available update.

Every new released build must bump package.json to a new stable version.
A version/tag belonging to another commit is never overwritten, and an older
version cannot replace a newer stable release. Re-running the same commit can
resume its draft or verify its already-published release. The main branch's
`openbot-windows-release.yml` uses the same publication helper.

The former 0.1.137 artifact-only build could not appear in Check for updates:
the updater reads published Releases, not workflow artifacts. Publication of a
newer release fixes discovery for existing installations without changing their
saved data or updater repository.

Full Vitest matrix failures remain recorded in ci-failure-audit.md; a successful
installer build must not be described as a completely green project. Public
feed verification does not prove Windows GUI installation or a live GCP session.
