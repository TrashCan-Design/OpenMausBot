# OpenBot fork security review (2026-11-02)

Scope: static review of the fork at `007f92a317a5e4deca0a3553f8396036668f3503`
plus the local OpenBot refactor, official upstream through
`6e32504b9d08674834bef034d76787751f39d9a3`, package and workflow
configuration, Electron main/preload, server routes and service integrations,
renderer entry points, and outbound-service defaults. This is a source review,
not an assertion that dependencies, native binaries, or a future installer are
malware-free. No Windows installer was executed in this review.

## Outbound paths

| Path | When it can make an outbound request | Current fork behavior |
| --- | --- | --- |
| AI model CLIs and APIs (`server/drivers/`, `server/config.ts`) | A person configures and uses a provider | Intended bot operation. The provider receives prompts and relevant tool results. |
| Composio (`server/composio-project.ts`, `server/composio-session.ts`) | A person supplies a project key and connects an app | Third-party app access. The managed broker's built-in origin is blank in this fork; a custom one must be configured. |
| PostHog (`src/lib/analytics.ts`) | Explicit analytics opt-in | `us.i.posthog.com` is the hard-coded collector. Autocapture and pageview capture are disabled; the default is now off. |
| HighLevel relay (`server/highlevel/relay.ts`) | An explicit relay URL is provided | No built-in relay URL. |
| Hosted Cloud (`electron/cloud-account.mjs`, `electron/main.mjs`) | Formerly account sign-in, checkout and management | The client constructor is no longer invoked, `ensureCloudAccount()` rejects, offers are off, and the renderer preload no longer exposes the Cloud account/plan bridges. Hosted account source modules and some dormant IPC/routes remain and should be removed in a subsequent cleanup before describing source removal as complete. |
| Boat (`server/boat.ts`, `server/included-services.ts`) | Formerly a Boat key/managed computer | `boatAccount()` has no account, the UI no longer exposes a key or provider choice, and config mutation rejects Boat. Legacy service implementation remains in the tree. |
| Self-hosted pairing and tunnel (`server/`, `electron/`) | A person pairs another device or configures HTTPS/Tailscale/Cloudflare | Intended remote access; inspect the host and network boundary before exposing it publicly. |
| GitHub releases (`electron/updater.mjs`, `electron-builder.yml`) | Installed desktop checks for a newer version | The updater feed points to `TrashCan-Design/OpenBot`. Releases must be public and contain matching `latest.yml` and EXE. |
| Native packaging downloads (`scripts/prepare-browser.mjs`, `server/browser-engine-release.ts`, `scripts/prepare-cua-win.mjs`) | Building an installer | Pinned and hash-checked upstream binaries are downloaded. The Windows browser engine is still hosted under `milind-soni/OpenMausBot`; rehosting a verified copy is needed to eliminate this build-time dependency. |

## Code execution and trust

The app deliberately runs AI agent CLIs, browser automation and native computer-use
helpers. Those capabilities can act on local files and accounts according to the
chosen permissions and bot instructions. They are not by themselves evidence of a
backdoor, but a malicious model response, connected tool, prompt injection, or
compromised dependency can have real effects. Keep computer access and integrations
scoped to what a bot needs.

I did not find an unexplained startup exfiltration destination in the reviewed
entry points. I did find original product services, analytics, feedback and
third-party integrations; the changes above disable their automatic paths or
place them behind explicit configuration. The legacy Cloud and Boat sources still
contain service URLs. A source-only string search will therefore still find them.

The Windows release workflow builds on GitHub Actions, validates the embedded
server and browser resource, and checks the installer against `latest.yml` before
publishing. It does not sign the EXE. Updater SHA-512 metadata detects a corrupted
asset relative to the feed, but an attacker who can replace both the public feed
and the unsigned installer can still serve malicious bytes. Restrict release
permissions and add code signing before treating unattended updates as strongly
authenticated.

## Verification and limitations

The renderer/server build, TypeScript check, locale validation, contrast check,
Electron preload/data-path checks, updater UI tests, and targeted components are
run during the refactor. The full Vitest suite in this workspace has many socket
fixture failures (`listen EPERM`) because this execution environment blocks Unix
socket binding; old Boat and Cloud tests also describe intentionally removed
features. A passing static check cannot establish that every third-party package
or future release artifact is benign. Do not distribute an installer until the
Windows runner smoke tests and its generated hashes are reviewed.
