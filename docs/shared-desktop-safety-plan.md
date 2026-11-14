# Shared desktop safety implementation

Approved scope: fix the 7 November review findings while preserving the local
Windows installation and existing per-bot VPS mode. No EXE or live deployment.

1. Make the server own shared Cua execution and completion. Replace agent-reported
   lifecycle events with a capability-bound RPC proxy and a persistent operation
   journal. Unknown outcomes survive restart; only verified container stop can
   resolve abandoned operations. Never delete the container to recover.
2. Bind fresh observations to control ownership epochs. Coalesce equivalent
   captures, bound observer traffic, and prevent readers changing writer state.
3. Reconcile UI leases with server status; cancel hidden/unmounted requests and
   distinguish queue tickets belonging to other sessions.
4. Publish token files without replacement races; revoke failed connect sessions;
   retain execution uncertainty independently of response promises.
5. Adapt upstream folder isolation and MCP schema compatibility fixes without
   restoring vendor services or weakening argument validation.
6. Verify isolated concurrency, crash/restart, malformed RPC, disconnect and
   compatibility scenarios; run lint, types, builds and focused regressions.
   Review and classify fresh CI. Keep the PR draft if verification is incomplete.

Manual VM activity outside OpenBot cannot be fenced by an application-only lock.
Recovering a desktop stops running processes and may lose unsaved application
state; the explicit recovery UI must explain that. Desktop files remain in the
existing container. Windows/GCP results must be reported only when exercised.

## Implemented files

| Area | Files |
| --- | --- |
| Trusted execution, recovery journal and SSH lifecycle adapter | `server/shared-vps-gateway.ts`, `server/shared-vps-journal.ts`, `server/shared-vps-host.ts` |
| Capability-only agent transport | `server/shared-vps-proxy.ts`, `server/vps-container-mcp.ts`, `server/mcp-bridge.ts` |
| Ownership, queue, viewer drain and HTTP integration | `server/shared-vps-seat.ts`, `server/shared-vps.ts`, `server/routes/desktop-viewer.ts`, `server/index.ts` |
| One UI lease, cancellation, queue position and recovery confirmation | `src/components/computer-takeover.ts`, `src/components/SharedVpsDesktopControls.tsx`, `src/components/ComputerPanel.tsx` |
| Failed credential publication and session rollback | `server/headless/connect.ts` |
| Pending-call uncertainty and strict schema compatibility | `server/drivers/chat-mcp-tools.ts`, `server/mcp-schema-validator.ts` |
| OpenCode same-folder process isolation | `server/drivers/acp/core.ts`, `server/drivers/acp/host.ts` |
| Existing workflow safety gate | `.github/workflows/ci.yml`, `scripts/ci-workflow.test.ts` |
| New regression suites | `server/shared-vps-gateway.test.ts`, `server/shared-vps-host.test.ts`, `server/shared-vps-proxy.test.ts`, `server/mcp-schema-validator.test.ts`, `src/components/SharedVpsDesktopControls.test.ts` |
| Updated regression suites | `server/shared-vps-seat.test.ts`, `server/vps-routing.test.ts`, `server/mcp-bridge.test.ts`, `server/headless/connect.test.ts`, `server/routes/desktop-viewer.test.ts`, `server/drivers/chat-mcp-tools.test.ts`, `server/drivers/acp/host.test.ts`, `server/drivers/acp/shared-process.test.ts` |
| Verification and failure records | `docs/verification/shared-vps-desktop.md`, `docs/ci-failure-audit.md`, `docs/upstream-sync.md`, this file |

## Verification and remaining work

On Node v24.22.1/Linux, the combined focused safety, UI, routing, CI, documentation
and size-gate run passed 164 tests across 15 files. Later ownership/journal guard
changes passed 33/33. The Chat MCP suite passed 82 and skipped three real-tree
checks only after its environment capability probe failed. Its protocol fixtures
use an explicit known-leaf cleanup adapter; this does not certify production
process-tree cleanup. Three targeted OpenCode folder/pooling/admission fixtures
passed. The lifecycle/viewer integration run passed 81/81. Counts overlap.

Client and server TypeScript, lint and locale validation passed. The production
UI build passed with existing dependency annotation and chunk-size warnings.
The server bundle and isolated packaged-server smoke passed, including the
13 proxy paths. An initial parallel build attempt exited 137; sequential
checks passed. No EXE was built, and no actual GCP/Windows desktop was tested.
See `ci-failure-audit.md` for wider failures and the unchanged-base comparison.

The locking boundary is OpenBot's managed requests in one local installation,
not every process or side effect on the VM. Closing viewer connections is not
an application-level fence for earlier VNC input, browser loading, downloads or
background jobs. Direct SSH and other installs are outside the lock. Testing
these boundaries on a disposable GCP desktop, qualifying Windows SSH and process
cleanup, and diagnosing the remaining retained-feature CI failures are required
before describing the complete product as production-ready or merging/releasing.

No optional upstream feature selection was implemented. Vendor Cloud, Boat and
Admin integrations were not restored. Per-bot mode remains the default and its
SSH overrides and raw transport are preserved. The shared container is never
deleted during recovery or as a consequence of deleting an individual bot.
