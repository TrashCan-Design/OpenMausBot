# Upstream review

| Date (UTC) | Upstream main | Fork base | Review |
| --- | --- | --- | --- |
| 2026-11-01 | `cdbf1495d3f1b6951bfa702d20663a11a3bf67f4` | `007f92a317a5e4deca0a3553f8396036668f3503` | 38 upstream commits reviewed for applicable fixes before the OpenBot refactor. |
| 2026-11-01 (later) | `ac08cf72a70f4d334ea39e9044ecc514c0c1056c` | `007f92a317a5e4deca0a3553f8396036668f3503` | One additional sidebar fix (`1f35a3449`) ported: Simple mode now shows threads awaiting the person. |
| 2026-11-02 (Asia/Kolkata) | `6e32504b9d08674834bef034d76787751f39d9a3` | `007f92a317a5e4deca0a3553f8396036668f3503` | Reviewed 11 new upstream fixes. Ported coordination, key-engine hints, active remote notifications, Cursor MCP repeat detection, and Windows lease fixes. The rail wording fix has no matching key or UI in this fork. |
| 2026-11-03 (Asia/Kolkata) | `f52effc1a5871e4e54b3d2c699336a28c6cb1f97` | `35d74856cbc555b2224ca7b424f4cb5da0e77479` | Reviewed 71 subsequent commits (including merges), porting applicable memory writes, capture flushing, Windows test timing, completion notices, self-hosted pairing, remote computer UI, browser fake-IP rules, IME input, bubble wrapping, ACP provider errors and 429 handling, local-model tool budget, mascot scheduling, and initial page titles. Adapted updater tests to the local-only bridge and isolated their state per test. |
| 2026-11-06 (Asia/Kolkata) | `aede7d817df9bc4142ab569128d4462dcdee1b31` | `e37c79138006d659723436d4e64875b3f9f8f590` | Reviewed commits since the 5 November upstream check `e7317a7`. Ported the retained turn-watchdog sleep correction (`e39d9b0`) with a focused regression test. The remaining new fixes concern removed hosted accounts, unrelated integrations or UI, and Mac Docker discovery; they do not alter the Windows self-hosted VPS path in this change. |
| 2026-11-06 (Asia/Kolkata, later) | `dd64479da27bc43812615b83907df38e1f9e805b` | `e37c79138006d659723436d4e64875b3f9f8f590` | Two first-parent merges landed after `aede7d817` (00:06 and 00:40 IST). Neither is ported. |
| 2026-11-06 (Asia/Kolkata, 3:05 AM) | `a51e2abba3d13ca3a1eee1c5a57a96a530d40deb` | `e37c79138006d659723436d4e64875b3f9f8f590` | Five first-parent merges after `dd64479`. The locale fallback and per-person language fixes sit on Portuguese catalog and hosted-cloud code this fork does not share. The 0.1.142 release bump and the two train merges are not bug fixes for the retained VPS path. None ported. |
| 2026-11-06 (Asia/Kolkata, 9:58 PM) | `8d56ad4ef8440057e101f8c8f1dd4d7389a43c29` | `00f053431a9b9b4c605cf6a286e6b39da8881f78` | Upstream `HEAD` is still `8d56ad4` (merge of #4635, 9:08 PM IST). Nothing newer. From the range since `a51e2ab`, ported: data-lane interrupt redelivery (`b400065`), CLI send conversation selection (#4577), pairing TTL and CI tokens (#4579), `doctor --host` adapted for the Windows app and a desktop-only VM (#4580), explicit stdio MCP (#4574), and command-MCP restart without rewriting saved keys (`57b4fb0`, `6d25919`). Not ported: Brazilian Portuguese, larger Ollama context, the encrypted phone connection (#4561), MausBot Relay (#4565, #4575), SMTP sign-in (#4582), Command Code (#4624), Responses fallback (#4184), local-model text tool calls (#4180), Boat file copy and background exec (#4553, #4567), page map data (#4563), hosted HTTPS/tunnel (#4617, #4626), and the Admin connector (#4609, #4621, #4625, #4635). Those connector and tunnel commits require upstream's Admin or cloud-home deploy path. |
| 2026-11-07 (Asia/Kolkata) | `a149c8735be6f40b4db79e4315958495ae5678a8` | `2b3e8d8e8db3dce7e390e17c5c12511313c0b3a2` | First-parent commits since `8d56ad4`: team sleep (#4642), no send cap (#4676), rail local workspace (#4677), release v0.1.144 (#4685), signed-in ends hold (#4681), cloud local MCP (#4640), box install (#4622), box launcher (#4589), stuck states (#4648), Antigravity cloud sign-in (#4678), room pages view-only (#4612), email providers (#4696), OpenCode model refresh (#4698). None are ported in the shared-desktop observation change. They are hosted-cloud, box/admin, release, locale-unrelated UI, or engine-catalog work. |
| 2026-11-07 (Asia/Kolkata, later) | `1bc4749aa8307d7d6998bf86de4ef6478460dd93` | `375aff47f7674bb6e4ef0a82875bf08cc60b5aa9` | First-parent commits since `a149c873`: voice-note parking (#4700, #4711, #4712), OpenCode discovery and thread capability (#4706, #4699), chat-engine tool mounting (#4701), cloud-computer start errors (#4709), phone routes (#4695, #4724), engine self-update (#4713), relay usage (#4689), workspace rail (#4718, #4727), HighLevel removal (#4637), releases 0.1.145 and 0.1.146. None ported. The OpenCode capability fix is that engine's shared process, not this fork's desktop viewer. Screenshot delivery, sandbox typing, Thinking, the Windows overlay, and Grok import are implemented from this fork's own paths. The shared desktop asks for 6 GiB only after Docker reports that container as ours and `docker info` shows at least 1.5 GiB left on the host; a higher or unlimited cap is left alone and the container is not recreated. |
| 2026-11-11 (UTC) | `6199598` | `1ef9616956622a69550f5d7869f93270deb371cc` | Reviewed upstream releases v0.1.147 through v0.1.152 (HEAD `6199598`). Candidate bug fixes identified for porting: OpenRouter reasoning token limit stalling long turns, connected app connection error isolation so whole turn does not crash, Codex model provider startup, linked files >25MB save disclosure, and host sandbox isolation hardening. Excluded/skipped: Meeting Notes guest bot integration, MausBot Cloud queue optimizations and Starter tier bot limits, Relay/phone connections, auto-updating engine binaries, and vendor engine connectors (Kiro, ModelGo). |

The fork retains local and self-hosted features. Upstream changes that require
MausBot-hosted accounts, billing, or Boat computers are not ported.

The 6 November follow-up is upstream `dd64479da`. Pull request #4549 only
collapses one optimistic-message call in `src/state/store.tsx` and rebuilds
`shared/app-frame/app-host.html`. This fork's store does not have that call.
Pull request #4504 adds Brazilian Portuguese across 626 files, including
hosted-cloud copy. It also lazy-loads `undici` from
`server/drivers/openai-chat-fetch.ts`, a module this fork does not have. The
locale itself is not a bug fix for a retained path, so it stays upstream.

The Claude account-config fix (`785be84`) changes a module absent from this fork.
The engine startup cache change (`3a2d563`) depends on upstream performance
refactors not present here. Larger Ollama context, Responses API, and local-model
tool-call changes (`9022b06`, `5bfb0f0`, `6371611`) require separate integration
and regression work; they were not included in this scoped bug-fix pass.

## Shared-desktop safety follow-up — 7 November 2026 (Asia/Kolkata)

Checked official upstream `07d5e152a90ac8c21cb8fe79001cca43f2e8748d` against
PR #7 head `375aff47f7674bb6e4ef0a82875bf08cc60b5aa9` before this follow-up.
Adapted `469583b47b13ef2c73ed15273d85ca49cc081d7e`: OpenCode's process pool
must not share a working folder between different threads, even after an old
session closes, because the native process retains that folder's MCP registration.
Other folders and repeated turns of the same thread keep their existing pooling.

Adapted only the strict schema compatibility portion of `f6af8a06`: schemas
without `$schema` may use 2020-12 keywords; compilation tries strict draft-07,
then strict 2020-12. Unsupported constraints/references still refuse that tool.
A tool with an unsupported schema no longer removes its valid neighbors. The
existing 128-tool limit, per-turn selection and approval checks remain in place.
No large-catalog or lenient-validation feature was ported.

The latest Boat-start changes do not apply to the removed provider. No vendor
Admin, hosted cloud-home deployment, relay, or billing path was restored. The
selected optional features listed in `selected-upstream-work.md` remain pending;
this follow-up does not authorize or implement them.

## Windows build preparation — 7 November 2026 (Asia/Kolkata)

Fetched official main 1bc4749aa8307d7d6998bf86de4ef6478460dd93 and reviewed
the ten-commit range after 07d5e152 against the retained fork before editing.
The two upstream version bumps do not set this fork's version. Relay metrics,
Cloud rail/place/phone routing and removal of the hosted HighLevel integration
are not imported into this Windows artifact build. Engine self-updating is a
new behavior and is not selected. Attachment/voice-note fixes change newer
shared driver/attachment contracts and need a separate compatibility review;
they are not blindly cherry-picked or claimed implemented here.

This build uses the fork's current shared-desktop code and corrects its two
observed route-ratchet/OpenCode-fixture regressions. It restores the existing
installer branch's build trigger using package-win.yml instead of copying the
obsolete fork-windows.yml repository-name checks.

## Windows updater publication — 7 November 2026 (UTC)

Rechecked official upstream main before editing: it remains
`1bc4749aa8307d7d6998bf86de4ef6478460dd93`, already reviewed above. No new
upstream fixes are pending in that range. This scoped correction connects the
fork's successful installer branch to its own GitHub Release feed, shares
publication validation with the existing main-branch release workflow, and
adds regression tests. No application feature or vendor service is added.

## Upstream sync — 11 November 2026 (UTC)

Checked official upstream `milind-soni/OpenMausBot` releases `v0.1.139` through `v0.1.153`
(`6f226f15d`) against fork base `1ef9616956622a69550f5d7869f93270deb371cc`
(`codex/windows-installer`).

Ported bug fixes:
1. Unified 100 MB upload / attachment limit (`66ccb6da6`): `shared/upload-limits.ts`, `server/message-file.ts`, `server/attachments.ts`, `server/bot-attachment.ts`, and `src/lib/composer-attachments.ts`. Prevents 25 MB size failures when attaching large bot-generated files and videos, keeping 25 MB `PREVIEW_MAX_BYTES` strictly for in-memory streaming players.
2. Browser CDP detached session hang fix (`6656cb410`): `server/browser/cdp/connection.ts` immediately rejects `waitFor()` on detached sessions rather than timing out after 30 seconds.
3. Browser CDP command cleanup on transport failure (`780faf821`): `server/browser/cdp/connection.ts` cleans up pending commands and clears timers when transport send throws.
4. Browser CDP prompt cleanup on renderer detach (`41204110d`): `server/browser/cdp/auth.ts` and `server/browser/cdp/dialogs.ts` clear pending dialogs/challenges when renderer detaches.
5. Browser CDP document lifecycle stale event filter (`661e62ff6`): `server/browser/cdp/wait.ts` ignores lifecycle events from older documents during navigation.
6. Shared VPS Desktop recovery lease cleanup: `server/shared-vps-seat.ts` clears timer and releases control lease during `finishDrain` on recovery.

Banned upstream features skipped per fork policy:
- MausBot Cloud queue balancing, Starter tier bot limits, and hosted infrastructure (`#5358`, `#5340`).
- Boat cloud VM integrations, provisioned remote cloud machines, and billing routes.
- MausBot Relay tunnels (`serve --relay`, `#5353`, `#5357`).
- External guest meeting bots (Google Meet / Teams / Jitsi).
- Runtime engine binary auto-updates and vendor engine additions (ModelGo, Kiro).
