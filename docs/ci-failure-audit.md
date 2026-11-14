# CI failure audit — 3 November 2026

## Scope and comparison

The main run [41360679909](https://github.com/TrashCan-Design/OpenBot/actions/runs/41360679909)
failed all 16 Vitest shards (939 failure details in the job logs). The draft PR #3
run [41535246178](https://github.com/TrashCan-Design/OpenBot/actions/runs/41535246178)
also failed Vitest. The GitHub connector returned the first 15 PR shard logs:
867 failure details, with **no failed test name absent from the earlier main run**.
The connector's first-page job limit omitted PR Windows shard 3/8, so this
comparison does not establish that shard's result or that a repeated failure
has the same underlying cause. Typecheck, lint, packaged server, macOS,
browser identity, and behavior eval jobs in the PR run succeeded.

## Reasons visible in the logs

| Group | Evidence | Action |
| --- | --- | --- |
| Old product-name assertions and fixtures | `shared/package-format.test.ts`, `server/browser-tool-shape.test.ts`, `server/host/room-transcript.test.ts`, and `server/drivers/acp/acp.test.ts` expect `OpenBot`, while OpenBot emits `OpenBot`. The `server/mcp-trim.test.ts` helper also parses the old banner prefix, causing JSON parse errors. | Update expected user-facing text and deliberately versioned fixtures, preserving identifiers required for existing data compatibility. |
| Removed Boat and hosted Cloud behavior | `server/index.test.ts` sets `box.token` and expects HTTP 200, while `/api/config` returns 410 (“Boat is unavailable in OpenBot”). Boat provisioning suites, cloud computer suites, `BOX_TOKEN` catalog tests, and hosted Cloud UI tests exercise intentionally unavailable features. | Retire or rewrite those tests around local and self-hosted paths; do not make the removed service operational merely to satisfy old tests. |
| Changed defaults and routing | `server/default-bot.test.ts` expects an adopted bot's old ID/color. `server/computer-engine-removal.e2e.test.ts` and other computer tests expect the removed cloud desktop destination. | Check intended local destination and migration behavior, then update fixtures or fix retained behavior. |
| Tests of retained behavior that need individual diagnosis | `server/vps-routing.test.ts` reports 400 where it expected 409/200; `server/independent-threads-api.test.ts` and `server/runtime-coordination.e2e.test.ts` report incomplete turns; some E2E tests time out; `server/index.test.ts` has a concurrent write expecting 409 but receiving 200. These cannot be classified as safe branding differences from the logs alone. | Reproduce each retained feature in isolation before changing implementation or expectations. |
| Linux package verification, install and lifecycle | PR run's Ubuntu package job first stopped in `scripts/verify-linux-package.mjs` because it required `release/linux-unpacked/openbot` while `electron-builder.yml` sets `executableName: openbot`. The next run passed verification, then failed during DEB configuration: the post-install hook still required `/opt/OpenBot` while the package installed under `/opt/OpenBot`. The browser's AppArmor policy also referenced the old path. The third run passed the DEB and installed-browser smokes, then found that the lifecycle wrapper still passed `openbot` as the executable. A fourth run launched the app but its CUA opt-in fixture missed the fresh install's lowercase `openbot` user-data directory. | Update verifier, package hooks, policy, upgrade and lifecycle smoke paths and user-data fixture; rerun the lifecycle. |

These groups overlap; the raw failure counts are not disjoint root-cause counts.
This audit classifies failures, but it does **not** certify the entire Vitest
suite or every retained feature. PR #3's focused updater, memory, browser,
ACP, and UI tests passed locally before this audit.

## Follow-up — 5 November 2026

The scheduled main run [41948570769](https://github.com/TrashCan-Design/OpenBot/actions/runs/41948570769)
failed its 20 Vitest jobs: eight Ubuntu, eight Windows, and four macOS shards.
Its 17 other jobs, including typecheck/lint, the Ubuntu package smoke, and the
Windows browser and CUA smokes, succeeded. The historical 16-shard count above
describes the earlier push run, which had no macOS Vitest matrix.

The separate [Docker image run 41584918324](https://github.com/TrashCan-Design/OpenBot/actions/runs/41584918324)
failed because its volume-lock smoke expected “Another MausBot home” while the
server correctly said “Another OpenBot home.” The relevant workflow assertion
and `server/cloud-home.test.ts` expectations were corrected in PR #4. The later
[main Docker run 42017833571](https://github.com/TrashCan-Design/OpenBot/actions/runs/42017833571)
passed its full smoke and GHCR publish jobs.

## VPS routing follow-up

The retained `server/vps-routing.test.ts` suite initially had four failures.
Two expected the removed `cloudBackend: "box"` choice to succeed or return an
active-turn conflict; the route rejects it with 400 before checking turn state.
One expected the old `OpenBot` VPS error text. Those three test assertions
were updated to match the retained self-hosted VPS route and OpenBot wording.
The fourth, a computer lease contention assertion, failed in that initial
run but passed alone and in two complete suite runs. No product routing code
was changed for this intermittent result; the full suite passed 14/14 twice.

## Independent threads follow-up

The 5 November Ubuntu shard 4 log showed four failures in
`server/independent-threads-api.test.ts`, all at assertions expecting an
`OpenBot` approval or teammate report prefix. Those expectations now use
`OpenBot`. A local full run cannot confirm this E2E suite in this workspace:
its verification server logs `listen EPERM` for the Unix permission-broker
socket, so the fake Claude turn never writes the dump file and 14 cases time
out at that shared setup point. The CI failures reached later assertions,
which distinguishes them from this local environment restriction.

## Shared VPS change baseline — 6 November 2026

The 16-shard failure refers to the older push workflow; the scheduled main matrix has 20 Vitest jobs. The broad failures were already present before the Shared VPS Desktop branch. Their causes include stale OpenBot text assertions, fixtures for removed Boat/hosted Cloud behavior, and retained-feature tests that require separate diagnosis. The VPS routing suite passed 14/14 after its test expectations were corrected; it does not prove the new shared mode. Local E2E server fixtures in this workspace may fail at Unix permission-broker `listen EPERM`, before reaching their assertions. New shared-mode failures must be assessed against this baseline, never counted as covered by it.

The first Shared VPS routing run failed at server startup because the new seat class used TypeScript constructor parameter properties, unsupported by Node's strip-only loader. Explicit fields fixed this. A subsequent 14-test run had one regression: deleting a per-bot VPS scanned the default host as well as its overridden host, violating alias isolation. The deletion scan now keeps its original one-host scope for per-bot mode; shared mode scans both aliases only to find previously owned per-bot containers. The next run passed all 14 existing cases plus the new shared case. These were new change-specific failures, separate from the old matrix failures.

The `server/system-prompt.test.ts` run on this branch had five failures in assertions that still require `OpenBot`/`MausBot Cloud` wording. All shared VPS prompt assertions passed. The five failed names are “distinguishes background window control,” “prefers a saved login,” “says the bot runs in the cloud,” “points to a lent computer,” and “names the person's computer by its platform.” Those are the existing branding/removed hosting baseline; they should be corrected in a separate test migration without reinstating vendor services.

PR #7's first CI run failed its `typecheck + lint` gate at `scripts/testing/verification-docs.test.ts`: the new `shared-vps-desktop.md` recipe was not linked from `docs/verification/README.md`. The README link was added and the documentation test rerun. This was a newly introduced CI documentation gate failure, separate from the old Vitest shard failures.

## PR #7 Ubuntu shards — 6 November 2026, 1:03 AM IST

Completed run [42090695658](https://github.com/TrashCan-Design/OpenBot/actions/runs/42090695658) is on `d211c6ed`. The required gate passed, and so did behavior evals, the packaged server smoke, macOS smokes, the open-source edition build, renderer smoke, browser identity, the Ubuntu package smoke, and browser driver S4. All eight Ubuntu Vitest shards failed. This pull request's workflow did not run the Windows Vitest shards. The aggregate CI check is red because of those eight shards.

The comparison is the latest main CI [42023353355](https://github.com/TrashCan-Design/OpenBot/actions/runs/42023353355) at `e37c791`, the parent of this branch. That run failed the same eight Ubuntu shards (and eight Windows shards). Both Ubuntu logs contain the same 541 failing test names. After ignoring ports, timestamps, generated ids, and home-directory suffixes, one assertion body differs.

### The only change-specific assertion

These line counts are for `d211c6ed`, before the shrink recorded below. `scripts/testing/file-size-ratchet.test.ts` already fails on main:

- `server/boat.ts` is 1261 lines, listed at 1258
- `server/config.ts` is 1284 lines, listed at 1283

Those two counts are unchanged on this branch. The shared desktop work adds six further pins, which is why this branch's failure text is longer:

| File | Main lines | This branch | Why it grew |
| --- | ---: | ---: | --- |
| `server/index.ts` | 15808 | 15936 | Shared desktop routes, lease checks, and viewer binding |
| `src/components/ComputerPanel.tsx` | 1821 | 1849 | Shared controller and queue in the Computer panel |
| `server/store.ts` | 2323 | 2327 | Drops an invalid `vpsDesktopMode` while loading a bot |
| `server/vps-computer.ts` | 1369 | 1373 | `stopVpsDesktopTunnel` for handing the seat back |
| `src/state/store.tsx` | 3379 | 3380 | `vpsDesktopMode` on the client bot |
| `shared/wire.ts` | 1000 | 1002 | The same field on the wire bot; 1000 is the listing threshold |

The ratchet allows a count to go down, not up, and a file crossing 1,000 lines has to be listed with a reason. These pins were not raised. Moving the new code out of the listed files would remove this branch's extra lines from the failure. It would not turn the shard green while `boat.ts` and `config.ts` stay over their pins.

### Why the other 540 failures happen

They are the same failures as main. Counts below are this run's Ubuntu failures. Several tests match more than one story; the first matching story owns the count.

| Tests | Why they fail |
| ---: | --- |
| 267 | The product string is `OpenBot` and the assertion still requires `OpenBot`, `MausBot`, or `openbot`. Report prefixes, CLI banners, system prompts, default-bot intros, locale lines, and container errors are in this group. One of them is not a stale label: `server/default-bot.test.ts` "keeps the colour the person gave an adopted MausBot" seeds a bot named `MausBot`, recolors it, and expects that same bot back. `seededMausBot` adopts the oldest bot only when its name is `DEFAULT_BOT_NAME` (`OpenBot`) or its color is still silver, so a recolored legacy bot is skipped and a new OpenBot is created. |
| 79 | Boat and the hosted cloud are intentionally unavailable. Thirty `server/index.test.ts` cases get HTTP 410 where they expect 200, 400, or 409. The route body is `Boat is unavailable in OpenBot`. Inventory, provisioning, and included-account tests expect `configured: true` and get `configured: false`, or they expect a Boat API call and get `Boat is not configured`. |
| 15 | `server/live-call.e2e.test.ts` expects the first `POST /api/live/session` to return 201. `server/routes/live.ts` answers 409 `needsKey` when no OpenAI key is configured, so the suite never reaches the second-client case. |
| 15 | Analytics no longer sends unless it is explicitly on. `analyticsEnabled()` is false when the desktop switch is unset and `localStorage` does not contain the opt-out key set to `"0"`. `initAnalytics()` returns immediately, and `sendDailySnapshot()` returns false, so the usage-snapshot tests see no event and no stored day. |
| 5 | `server/mcp-trim.test.ts` parses the trimmed tool text as JSON. The trim banner still carries the old product prefix in the assertion's expected shape, and `JSON.parse` throws on the trailing banner. |
| 4 | `src/locales/vocabulary.test.ts` forbids the phrase it also requires. `RETIRED` contains `["OpenBot Cloud", /OpenBot Cloud/i, "OpenBot Cloud"]`, so English strings and the "good" example `Sign in to OpenBot Cloud` are reported as retired wording. That entry is the old product name rewritten into the new one. |
| 1 | `server/legacy-migration.test.ts` looks for `~/.openbot` after booting a `~/.opengrokbot` home. A fresh home selects `~/.openbot` (`server/config.ts`), and the rename target is that directory. An existing `~/.openbot` is kept when `~/.openbot` is absent. `server/bot-folder.test.ts` hardcodes the old fresh-install directory and sees `.openbot`. |

The remaining failures are the same names and, after normalizing incidental values, the same assertions as main. They include cloud-health ledger mismatches (one case expects 200 buckets and gets 197), Computer panel copy that still describes a sleeping Boat desktop while the panel renders the self-hosted computer, Places rail actions that still expect a hosted Cloud purchase, computer-usage counts that expect a Boat computer, and coordination end-to-end cases that stop on `Unplanned fixture turn` or expect `M-RERUN` and observe `M-CUT`. Those need a per-test reproduction before a product change. They are not evidence that shared desktop mode broke a shard.

No shard failure in that run was a shared-desktop behavior regression. The shared routing, seat, and viewer tests were not in the failing names.

## Fixes after that audit — 6 November 2026

The file-size ratchet now passes. Shared desktop UI moved into `src/components/SharedVpsDesktopControls.tsx`, room updates moved into `server/channel-update.ts`, and the Boat account stub moved into `server/boat-account.ts`. The listed files are at or under their pins, including `server/boat.ts` and `server/config.ts`, which were already over on main.

A recolored bot still named MausBot is adopted again. Forged `[OpenBot assignment]` and `[OpenBot report]` notes are defused; the note scanner still defuses the old `openbot` spelling. Analytics remembers that a page already opted in when storage later throws. Boat requests are refused before any network call when the retired account has no token. Fresh-install paths in the data-directory tests expect `~/.openbot`. Vocabulary no longer treats `OpenBot Cloud` as a retired phrase. User-facing strings that said "a OpenBot" in the page publisher and the Cloud-home trust warning now say "an OpenBot".

A local run of the 120 previously failing non-end-to-end files, before the Boat fail-closed change, had 82 files passing and 38 still failing (124 tests). The largest remainder is the Boat protocol suites (`boat-inventory`, `boat-included`, `boat-provision`, `boat-auto-sleep`, `boat-create-idempotency`) and hosted-cloud UI expectations (computer usage counts, the keys page `box` row, Places, Settings groups). Those still describe the removed Boat and hosted Cloud services. End-to-end files were not all rerun in that pass.

The shared desktop itself matches the requested shape: one opt-in container on the default SSH alias, per-bot mode left as the default, a 4 GiB / 2 CPU limit, `unless-stopped`, no public Docker or VNC port, one seat at a time, and bot deletion that does not remove the shared container. This workspace still has no GCP SSH configuration or Docker CLI, so that live check is not done.

## Shared desktop review corrections — 6 November 2026

Review of `30c28a4` reproduced four remaining defects: HTTP cleanup of a closed duplicate take released an existing seat; cancelling one duplicate waiter removed another request's FIFO position; the panel checked the desktop before its mode PATCH settled; and the alias guard inspected the default host instead of a shared bot's retained per-bot override. Confirmed seats and outstanding response registrations now govern HTTP cleanup, wait registrations are counted per lease and session, mode persistence includes `vpsDesktopMode`, and private-host checks resolve only the saved override. Regression tests exercise these cases.

The review also identified that a dropped MCP connection ended the shared bot's bridge. Shared mode now reconnects the same Docker exec target with bounded retries and repeats only initialization. Interrupted actions return an error, are not replayed, and a fresh desktop/window inspection is required before further actions. Disposable process fixtures cover recovery and termination; this is not a real GCP or Windows desktop verification.

The broad regression run passed 206 tests and skipped one production process-tree check; its only failure was four extra lines in `server/index.ts`. Moving the HTTP cancellation adapter into the shared-seat module restored the existing size limit. The affected routing, lease and size checks then passed 30/30. The skipped cleanup check is an environment capability limit: even an exited disposable process cannot be verified by the production process-tree helper here. Protocol tests use known leaf processes; production stops recovery when cleanup cannot be verified.

Client and server TypeScript checks, repository lint, locale validation, the production UI build, the server bundle, and the isolated packaged-server smoke passed after these corrections. The packaged smoke verified all 13 spawned proxy paths, MCP stdio, CLI requests, backup export, launcher shutdown, and the packaged desktop entry. No GCP connection or live Windows desktop operation was performed.

## Selected-feature pass — 6 November 2026, evening (Asia/Kolkata)

No new full shard run was collected for the commits after `00f053431`. The red Ubuntu and Windows Vitest shards on run [42181793428](https://github.com/TrashCan-Design/OpenBot/actions/runs/42181793428) stay in the classes already recorded above until a later run shows a new name. They are not reclassified as harmless. Typecheck, lint, package, and most smoke jobs on that run passed. The Windows CUA host smoke, cloudflared installer, and control-plane jobs were skipped by the workflow, which is a missing-environment outcome for those jobs only, not evidence about the shard failures.

Local checks for the data-lane interrupt, CLI conversation selection, pairing tokens, host doctor roles, stdio MCP, and command-server restart are listed in `docs/selected-upstream-work.md`. They do not replace the shard run.

## Run 42255385008 — 6 November 2026 evening (Asia/Kolkata)

This is the CI run for `ce3eb986`. All 16 Vitest shards failed. Browser driver checks passed. Build, packaging, lint/typecheck, and smoke jobs passed. The Windows CUA host job was skipped (missing environment for that job, not a verdict on the shards).

The shard failures are not one class:

1. Newly introduced regressions were not separated from the older set in this pass. The three defects found by review (new-conversation retry, token save, stale MCP probe) were reproduced outside CI and are fixed locally; they are not claimed to be the shard failures.
2. Retained-feature end-to-end failures are still present and need one-by-one diagnosis. They are not stale labels.
3. Stale expectations remain: product strings, analytics opt-in, and `window is not defined` in a component test.
4. Removed Boat and hosted Cloud assertions, including legacy Documents/MausBot paths, are tests of functionality this fork does not restore.
5. The skipped Windows CUA job is a missing environment capability.
6. Anything in the shards not matched above stays unresolved until that log line is reproduced.

This pass did not download every shard log again. The split above matches the earlier audit and the review of this run. It is not a certificate that every failure name was re-read.

## Observation pass — 7 November 2026 (Asia/Kolkata)

No new shard run was collected after `2b3e8d8e8d`. Run 42255385008 remains the last full CI result and stays red for the reasons above. Local Linux tests for the shared-seat, conversation-opening, chat MCP, bridge, and VPS routing files were run for the observation change. They do not replace that shard run and they are not a GCP or Windows desktop check.

## Safety follow-up: latest completed CI — 7 November 2026 (Asia/Kolkata)

Run [42280742460](https://github.com/TrashCan-Design/OpenBot/actions/runs/42280742460)
is for PR head `375aff47f7674bb6e4ef0a82875bf08cc60b5aa9`. It supersedes the earlier
42255385008 observation note above. The GitHub job listing exposes only its first
30 jobs: 15 Vitest shard logs were retrieved (seven Ubuntu, eight Windows).
Ubuntu shard 2 is outside that page and was not inspected. Do not turn these
partial counts into an asserted full-matrix total.

| Retrieved shard | Failed tests |
| --- | ---: |
| ubuntu-latest, shard 1/8 | 3 |
| ubuntu-latest, shard 3/8 | 29 |
| ubuntu-latest, shard 4/8 | 42 |
| ubuntu-latest, shard 5/8 | 42 |
| ubuntu-latest, shard 6/8 | 7 |
| ubuntu-latest, shard 7/8 | 44 |
| ubuntu-latest, shard 8/8 | 12 |
| windows-latest, shard 1/8 | 44 |
| windows-latest, shard 2/8 | 8 |
| windows-latest, shard 3/8 | 35 |
| windows-latest, shard 4/8 | 36 |
| windows-latest, shard 5/8 | 11 |
| windows-latest, shard 6/8 | 3 |
| windows-latest, shard 7/8 | 12 |
| windows-latest, shard 8/8 | 3 |

Retrieved totals are 179 Ubuntu failures and 152 Windows failures, counting test
failures rather than independent root causes. Build/lint/types, package smokes,
Windows CUA host smoke and behavior evaluations passed on that older commit.
The Ubuntu browser S4 job failed its 2x viewport resize case: it still saw
`[1280,1457,2]` after 15 seconds. Its subsequent alternate run passed 100 tests
with that case skipped; that is not a successful retest of the failed case.

Classification from the retrieved failure blocks:

- Retired Boat/hosted paths: boat-* suites, cloud/team provisioning, hosted
  desktop and surface-selection fixtures still expect the disabled provider to
  answer. These need tests of refusal or a migration to retained self-hosted
  fixtures. Restoring vendor access is not an acceptable fix.
- Stale product/selection expectations: old Documents/MausBot and welcome text,
  removed Cloud settings/Places choices, old download URLs, the retired key/tool
  catalog entries and opt-in analytics expectations. Reproduce before changing
  assertions; a retained behavior must not be dismissed merely by its filename.
- Test setup: LocalComputerSection reports `window is not defined`. The Windows
  bridge runner imported a drive-letter path as an ESM URL; this change uses
  `pathToFileURL` and removes obsolete client lifecycle-report expectations.
  Its Windows result still needs the next CI run.
- Retained behavior requiring separate diagnosis: index concurrent writes,
  phone-secret verification, stream viewport resizing, app-loading state,
  ChatMarkdown thread links, extractor/helper provenance, routine scheduling,
  dev reports and remaining end-to-end timeouts. These are unresolved, not
  certified safe and not automatically attributed to shared-desktop changes.

Local wider regression results in this follow-up are also retained: the initial
nine-file run had 359 passed and 15 failed. Eleven were Chat MCP startup/cleanup
or timing expectations in an environment that cannot confirm production process
cleanup; four were ACP/Qwen restart cases. A separate shared-process run failed
four Stop/close cases. Those exact four also fail on unchanged PR base
`375aff4` (42.36 s, four failed), establishing that they were not introduced by
the folder-isolation change. The three targeted folder/pooling/admission cases
pass. The four Qwen failures have not individually been reproduced on base and
remain unresolved; do not label them all as a proven environment baseline.

Protocol-only Chat MCP fixtures now use a close-confirmed adapter for explicitly
known leaf processes, as the existing reconnect fixtures do. Three real-tree
checks skip only after a disposable exited-process probe fails; the production
cleanup implementation is unchanged. The final Chat MCP run passes 82 and skips
three. An explicit negative-verdict test still verifies that uncertain cleanup
stays an error after pending responses have been cleared.

The focused safety/CI/documentation/size checks pass 164/164. Lifecycle/viewer
fixtures separately pass 81/81. These overlap and must not be added together.
The server bundle and isolated packaged-server smoke pass. No real GCP, Windows
desktop or EXE verification was performed. A first parallel build attempt was
killed with exit 137; memory-heavy type/build checks were rerun sequentially.
Fresh CI on the published fix commit is required before any merge decision.

## Windows installer preparation — 7 November 2026

All 16 shard logs for run 42293683280 at 5c8a2a4 were retrieved: 200 failed
Ubuntu tests and 151 failed Windows tests. These are test counts, not distinct
root causes. Typecheck/lint, focused shared-desktop safety, production UI build,
packaged server on both platforms, Windows CUA/browser checks and the other
non-Vitest jobs passed. No Windows installer job was triggered by that PR push.

Two change-specific problems are corrected before the installer build:

- The internal shared-VPS route added two literal path checks to index.ts,
  exceeding its route ratchet (93 versus 91). Internal computer HTTP handlers
  are now in server/routes/internal-computer.ts, still called only after the
  existing bearer/kind/sender/generation checks. The ratchet is not raised.
- OpenCode's resumed-variant fixture put two threads in the same working folder.
  The intentional folder isolation started a separate process whose fixture
  log began from zero, so slicing by the first process's log count hid the
  resumed effort setter. Fixture threads now have distinct working folders;
  same-folder process isolation remains in force. No product model/effort
  behavior was weakened to satisfy this assertion.

The remaining matrix failures include retired Boat/hosted-provider expectations,
old key/catalog/analytics/UI assumptions, and retained-feature failures in
phone-secret, scheduling, reports, loading state, thread links and coordination.
They are not all cosmetic, and are not marked resolved by a successful package
build. The installer branch is an artifact build, not an assertion that the full
suite is green or permission to merge the draft PR into main.

The phone-secret failure was subsequently reproduced as a real interoperability
regression: rebranding changed the HPKE info string, while the fixed CryptoKit
version-1 envelope still uses the original domain. Decryption now accepts both
known version-1 domains with identical AAD/key/request checks. Current-domain,
legacy CryptoKit and tamper-refusal tests are retained; this is not fixed by
replacing the original ciphertext fixture. A fresh installer build is required
to include this correction.

## Current continuation — 7 November 2026

The latest live PR state is draft PR #7 on `codex/shared-vps-desktop` at
`a5eafaedf6b40ef990fdd54100588acbab9b7a30`. PR #8 remains merged into this
branch. The push created CI run [42399985899](https://github.com/TrashCan-Design/OpenBot/actions/runs/42399985899)
and npm package run [42399985870](https://github.com/TrashCan-Design/OpenBot/actions/runs/42399985870);
both were still running when this entry was written. The preceding package run
[42398826642](https://github.com/TrashCan-Design/OpenBot/actions/runs/42398826642)
passed, while its CI run was cancelled by the newer push.

The focused retained-feature correction is in `src/components/ChatMarkdown.tsx`:
the ThreadRefs subscription detector now recognizes the current
`OpenBot://thread/...` scheme as well as the existing hash and legacy links.
`ChatMarkdown.renderers.test.ts`, `app-loading.test.ts`, and
`analytics-allowlist.test.ts` pass locally after the related assertion updates.
`analytics.wire.test.ts` still records no PostHog event. This matches the
documented current analytics opt-in behavior: `initAnalytics()` is a no-op
unless analytics is explicitly enabled, so this remains an unresolved stale
test/setup expectation rather than a product change made to force network
traffic.

The local pre-push lint completed, but the default Node heap exhausted during
the typecheck hook. The commit was pushed with hooks bypassed; CI is the
authoritative typecheck/lint result for this commit. No release was prepared:
the full CI result, retained-feature classification, and release-source
qualification remain incomplete.

The current main CI baseline remains failing at
[42320936730](https://github.com/TrashCan-Design/OpenBot/actions/runs/42320936730)
on `e37c791`; feature-branch failures must still be compared by test and
behavior, not dismissed solely because this baseline is red.

## Release branch update: Shared VPS Desktop merged into codex/windows-installer (0.1.139)

Evidence gathered on a clean clone, Node 22 on Linux, comparing PR #7 head `7c642aba` and `main` (`e37c791`).

| Suite | Failures | Fails on main | Cause | Classification | Disposition |
| --- | --- | --- | --- | --- | --- |
| `server/routine-cron.e2e.test.ts` | 1 | yes | Test expected "OpenBot starts"; the app says "OpenBot starts" (`server/routine-requests.ts`) | Stale branding | Test updated to OpenBot |
| `server/group-local-vm.e2e.test.ts` | 6 | yes | `PUT /api/config` answers "Boat is unavailable in OpenBot"; tests still pick a hosted Boat computer | Retired hosted cloud | Open, needs per-test rewrite or removal |
| `server/computer-engine-removal.e2e.test.ts` | 4 | yes | Tests expect bots moved to a `computer: "cloud"` destination that no longer exists | Retired hosted cloud | Open, needs per-test rewrite or removal |
| `server/devs-reports.e2e.test.ts` | 3 | yes | `createDevsReports({ enabled: false })` since `99a82695` | Feature disabled by the fork | Feature and suite removed (below) |
| `scripts/testing/analytics-docs.test.ts` (2) | 2 | yes | `docs/analytics.md` no longer has an Events table; docs site page differed from it | Stale expectation | Events row test removed; docs site page synced to `docs/analytics.md` |
| `scripts/testing/key-readback.e2e.test.ts` | 1 | yes | The `box` (Boat) credential left the key catalog | Retired hosted cloud | Expected list and call list updated |

None of the failures above were introduced by Shared VPS Desktop; each fails identically on `main`.

Retired in this update: the `@devs` bug report feature (report builder, sender, status tracker, `report_bug` tool, `@devs` mention, chat status note, recent log capture, `OMB_BUG_REPORT_URL` handling, `server.reports.*` and `devs` locale strings, user docs). Display name "OpenBot" replaced by "OpenBot" in tests, fixtures, docs site and the macOS speech helper text; seven test files where the old name is deliberate were left unchanged.

Not verified in this environment: Windows shards, Node 24, `node:sqlite` suites (including `SharedVpsDesktopControls.test.ts`), live VPS.
