# Selected upstream work

Checked upstream `8d56ad4ef8440057e101f8c8f1dd4d7389a43c29` on 6 November 2026 (Asia/Kolkata). No newer commit was on upstream `HEAD`. Status below is what this fork actually runs, not a plan.

| ID | Status | What landed |
| --- | --- | --- |
| 1 | Implemented, retry corrected | `send --task new`, `--task current`, and `--task ID` choose the conversation and the reply names it. The send id is reserved on disk before the conversation is created. If that write fails, nothing is created and the call returns an error. If the conversation is created and the receipt write fails, a retry does not create another one; it asks for a new send id. Records are kept for 7 days and at most 2000. After that, a retry may open a new conversation. |
| 2 | Implemented, save corrected | `openbot pair --ttl` keeps a one-time code open for up to a day (default remains five minutes). `token create` writes the secret by renaming a temp file. If that write fails, the new session is revoked. If revocation also fails, the error says the session is still active. On Windows the file is locked down with `icacls` for the current user; POSIX mode `0600` is what other systems check. |
| 3 | Implemented | `doctor --host` only reads. Linux without `--desktop` is checked as a host for OpenBot and the bot sandbox. `--desktop` checks a VPS that only runs the remote desktop container and does not require user namespaces, seccomp, or cgroup v2. Windows reports the local app and does not require those prerequisites. Nothing is installed, no sysctl or firewall is changed, and Google Cloud CLI is not used. A time comparison happens only when `--time-url` is an https address the operator supplies. |
| 4 | Implemented | A command MCP entry may say `"type": "stdio"`. The type is not stored. `stdio` with a URL, `http` with only a command, and an unknown type are rejected. Existing command and URL shapes still work. |
| 5 | Implemented, health corrected | `PATCH /api/mcp/servers/:name` with `{ "restart": true }` bumps the next turn's spec and leaves saved keys, sign-in, apps, and bot ownership in place. A check already running is not a second probe; its result is dropped if a restart arrived, and one fresh check runs after it settles. Chat Completions MCP processes are started and stopped by `CommandSlot`. A replacement waits until the process it started is confirmed stopped, and a call already in flight is not run again. Claude, Codex, and Pi still start their own processes; this pass did not re-prove those engines. |
| 6 | Not started | Command Code as an optional ACP engine. |
| 9 | Not started | OpenAI Responses fallback when Chat Completions rejects tools. |
| 10 | Not started | Recovery of tool calls that a local model emits as text. |
| 13 | Not started | Copying files between a bot's working folder and its SSH VPS desktop. |
| 14 | Not started | Background commands on the existing SSH VPS tools. |
| 15 | Not started | Map data in folder-page publishing, and the skipped-file reporting fix. |
| 16 | Held | Optional self-hosted HTTPS and tunnel support. Not implemented. Upstream's version depends on the hosted cloud-home path. |
| 18 | Held | Optional server-management connector. Not implemented. Upstream's version talks to its Admin service. |

Excluded and not implemented: 7 Brazilian Portuguese, 8 automatic larger Ollama context, 11 the new encrypted phone connection, 12 MausBot Relay, 17 SMTP email sign-in.

## Bug fix in this pass

`Lane.interrupt()` now keeps delivering the interrupt until the statement settles, including when it arrives before DuckDB has dispatched the query. Close uses that path. An abort that arrives early already did. The regression is `cancels a statement whose interrupt landed before it dispatched` in `server/data/engine.test.ts`.

## Verification in this pass

Focused Vitest files were run on Linux. They are not a Windows run and not a GCP desktop run.

- `server/data/engine.test.ts` filtered to the interrupt cases, and the send tests: passed (the interrupt cases were in the first combined run; the send file then passed 6/6).
- `server/headless/token.test.ts`, `server/headless/args.test.ts`, `server/sessions.test.ts`, `server/cli-pair.test.ts`, `server/cli.test.ts`: 113 passed.
- `server/mcp-registry.test.ts`, `server/routes/mcp-servers.test.ts`, `server/host/mcp-servers-host.test.ts`: 49 passed.
- `server/headless/host-doctor.test.ts`: 5 passed.

A later pass corrected three defects: a new-conversation retry now shares one send id, a failed token save revokes the session, and an MCP restart does not keep a probe that was already running. Linux Vitest for those paths passed, including a real process start/stop for `CommandSlot`. Windows ACL behavior is the `icacls` command in `windowsTokenAcl`; this machine did not run that command. No live GCP SSH or Windows desktop check was performed. No Windows EXE was built.

## Shared desktop observation — 7 November 2026 (Asia/Kolkata)

One authorized bot or person can control the shared desktop. Other authorized bots can read `get_desktop_state` and the existing screenshot preview without taking the queue or renewing the lease. Clicks, typing, shell, browser, and every other computer tool still need the current owner, and a new owner must take a fresh `get_desktop_state` before a mutation. A second person joins the same FIFO queue. Session revocation releases that session's seat. A mutation still in flight keeps the next owner out until its result is reported; if that result never arrives, writes stay blocked for the life of this process. Restarting OpenBot clears that in-memory latch and does not prove the remote command stopped. The shared container is not deleted to resolve that. Hands on the VM outside OpenBot are outside this lock. Observers use screenshots, not the VNC socket. The panel's screenshot capture stays one shared operation; separate bot `get_desktop_state` calls are still separate Cua calls. This is not a live GCP or Windows desktop verification, and it is not a claim that the desktop is production-ready.

Features 6, 9, 10, 13, 14, and 15 are still not implemented. Features 16 and 18 stay held.
