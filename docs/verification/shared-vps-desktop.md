# Shared VPS Desktop

OpenBot's AI engines and agent processes continue running on the local computer. The default VPS SSH config alias identifies the Linux host with Docker. No Google Cloud CLI, published Docker daemon, or public VNC port is needed. OpenBot uses Docker's SSH transport and forwards the desktop viewer through a local SSH tunnel.

In a bot's Computer panel, select Cloud Computer → Self-hosted VPS, then choose **Shared VPS Desktop**. All bots using this mode and the same OpenBot installation connect to one installation-owned container on the default SSH host. **Per-Bot VPS** remains the default for existing and new bots. Per-bot SSH alias overrides are retained for that mode; shared mode always uses the default alias so the desktop remains discoverable after individual bots are deleted.

The container keeps its writable filesystem, browser profile, and installed applications while it is stopped or while OpenBot restarts. Docker's existing `unless-stopped` policy starts it again after a VPS reboot unless it was deliberately stopped. Removing or replacing the container erases its writable filesystem. Keep irreplaceable files in durable storage. The existing managed image limits the container to 4 GiB of the 8 GiB VM and 2 CPUs.

Bot computer calls claim a single turn resource. Waiting turns use the existing FIFO queue, cancellation and wait timeout; unrelated work on other bots does not claim that desktop. A person's **Take Control** joins the same queue and holds a session-bound lease. Duplicate requests share their queue position, while cancellation removes only the cancelling request's registration. A closed retry cannot release a confirmed seat. Handing back control closes and drains the viewer before releasing the person's seat; a viewer heartbeat refreshes the lease, and an abandoned seat expires after ten minutes without a viewer/check. Viewer WebSockets and the SSH tunnel close on release.

Shared-mode MCP actions are dispatched and acknowledged by the local server.
Dropped read connections are recreated on the next request. An interrupted write
is never replayed: it remains journaled and blocks subsequent writes across app
restarts until its real reply arrives or explicit recovery verifies a stop/start
of the same container. After acquiring control, the bot must successfully read
an empty-argument `get_desktop_state` before acting; `get_window_state` does not
authorize writes. Per-bot mode keeps its existing transport behavior.

Verification in an isolated fixture:

```sh
node_modules/.bin/vitest run server/shared-vps-seat.test.ts server/vps-routing.test.ts server/vps-computer.test.ts server/vps-inventory.test.ts server/vps-hosts.test.ts server/turn-watchdog.test.ts server/mcp-reconnect.test.ts server/mcp-bridge.test.ts src/components/ComputerPanel.takeover.test.ts
NODE_OPTIONS=--max-old-space-size=6144 node_modules/.bin/tsc -b
NODE_OPTIONS=--max-old-space-size=6144 node_modules/.bin/tsc -p tsconfig.server.json
NODE_OPTIONS=--max-old-space-size=6144 node_modules/.bin/vite build
```

The routing fixture starts a disposable OpenBot server with fake Docker, SSH, and agent engines. It tests shared identity, two distinct bots contending through their real turn capabilities, cancellation of a queued person, interruption and hand-off, SSH inspection failure/retry, mode isolation, retained per-bot alias guards, and bot deletion. The MCP recovery fixture uses disposable real processes to check handshake recovery, unknown action outcomes without replay, simulated desktop state retained through reconnect, fresh-inspection enforcement, invalid protocol versions, handshake timeouts, truncated responses, and shutdown. Renderer tests delay the mode PATCH and require it to settle before a status or provision request.

Protocol recovery tests use a cleanup adapter for their known leaf processes. A separate process-tree test uses the production cleanup helper and skips only when a disposable exited-process probe cannot verify cleanup in the test environment. Production recovery stops if process-tree cleanup cannot be verified; it never starts a replacement on that failure. The fixture also tests this refusal explicitly.

These fixtures cannot prove that a particular GCP VM is reachable or that a real Cua desktop/browser works there. A real check requires an SSH alias and Docker CLI in the local OpenBot environment, then two authorized bots taking turns in the same browser session, a controlled SSH disconnect/reconnect, an OpenBot restart with the desktop kept, and confirmation that the viewer tunnel and leases close. Never run that check against the user's live OpenBot data; use an isolated OpenBot data directory and test accounts.

## Server-owned control and durable recovery

The shared proxy now forwards capability-bound JSON-RPC to the local server.
It has no raw Docker transport. The server pins the SSH alias and immutable
container ID, validates arguments, and records each admitted write before
sending it. Client `seen`/`end` reports are refused. Actual Cua replies settle
only their own operation IDs, including replies that arrive after a turn ends.
A lost or invalid reply leaves a persistent recovery barrier in
`shared-vps-operations.json`; restarting OpenBot does not clear it. Corrupt or
duplicate journal identities fail closed. POSIX directory metadata is fsynced;
Windows uses the existing flushed-file/atomic-rename path. Sudden machine power
loss and Windows filesystem behavior still require platform qualification.

Only empty-argument `get_desktop_state` is admitted without control. Authorized
observers share a capture in flight and a 500 ms cache, and cannot refresh the
writer's ownership epoch. Capture-start timestamps are conservative, rather
than timestamps invented when HTTP responses are delivered. Preview frames and
bot observations share this capture path. A separate read transport prevents
an observation timeout from closing an active write transport. Idle transports
expire after ten minutes; connection and write admission counts are bounded.
Concurrent writes from the same owner are refused while one is still running.

The status line and live viewer use one control lease. Unmount, Cancel, page
close and stale grants release that exact lease; a lease check removes stale
input authority. Queue position is specific to that request, and other people
are labeled Person. Shared loopback joins also use the authenticated viewer
proxy. Handoff waits for both viewer proxy sockets to close before releasing
the persistent person barrier. This is connection closure, not proof that all
application work caused by an earlier input has finished.

Explicit recovery stops and starts the same inspected, managed container. It
never removes/recreates it. Recovery is serialized with lifecycle operations,
and fails closed if identity changes, SSH fails, stop is unconfirmed, or startup
is not ready. Stop the active bot turn first. The confirmation explains that
running work and unsaved application state can be lost; container files remain.
A maintenance journal entry prevents a late operation reply clearing recovery
while stop/start is in progress.

The `Shared desktop safety regression` step in the existing CI workflow runs
these isolated checks before the full shard matrix. Reproduce it with the exact
`pnpm exec vitest run ...` command in `.github/workflows/ci.yml`. Additional
fixtures are `server/drivers/chat-mcp-tools.test.ts` and the same-folder cases
in `server/drivers/acp/shared-process.test.ts`.

All results here are fixtures. There is no GCP SSH configuration or Docker CLI
in this workspace and no Windows desktop was exercised. No Windows EXE was
built. Real browser session/file persistence, Windows SSH/process cleanup, Cua
read/write concurrency and physical VM interruption/restart remain unverified.
The lock coordinates one local OpenBot installation using its configured SSH
alias. Other installations, direct SSH, manual VM access and arbitrary commands
outside this gateway are not fenced. Applications, downloads and background
jobs can continue after an acknowledged input; this is not an OS sandbox or a
transaction boundary for every resulting application side effect.
