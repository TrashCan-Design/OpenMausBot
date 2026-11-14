# OpenBot Comprehensive Architectural Research & Implementation Plan

> **Document Status:** Planning & Research (Read-Only Analysis)  
> **Target Branch:** `codex/windows-installer`  
> **Date:** November 12, 2026  
> **Invariant:** No code modifications will be executed until explicit user approval.

---

## Executive Summary

This document provides detailed research, architectural verification, and execution plans covering four core domains for **OpenBot**:
1. **Model Providers & Compute Constraints:** Deep analysis of why Groq cannot handle computer use/desktop frames due to token-per-minute (TPM) throttling, and comparative options for free tiers, OpenCode/Codex Go tier, and Gemini Pro tier.
2. **Mobile Companion & Android APK Release:** The end-to-end connection flow (pairing, networking, security invariants) and the blueprint for automating Android APK generation and publishing directly into GitHub Releases.
3. **Upstream Review (`milind-soni/OpenMausBot` v0.1.139–v0.1.154):** Comprehensive tabular analysis of releases, isolating valuable improvements from banned vendor/cloud features (Boat VMs, cloud queues, relay tunnels, paid login gates).
4. **Cloud VM Execution, 24/7 Routines & Remote Relay:** How OpenBot functions headlessly on a custom cloud server (VPS/Docker), executing routines and tasks autonomously while your laptop is offline, with remote control from mobile or secondary laptops.

---

# Section 1: Model Provider Verification & Compute Capabilities

## 1.1 The Architecture of "Compute" (Computer Use) in OpenBot

In OpenBot, "compute" refers to agentic computer and browser interaction (`server/drivers/openai-chat.ts`, `server/drivers/chat-mcp-tools.ts`, `server/vps-computer.ts`, `server/local-computer.ts`). When an engine or provider has `computerUse: true`:
1. **MCP Tool Mounting:** The server mounts the high-privilege `computer` tool (mouse clicks, typing, key combinations, drags, screenshot captures) and the `browser` tool (CDP browser navigation, clicking elements, filling forms).
2. **Visual Feedback Loop:** Every turn receives raw base64 desktop/browser frame captures (`chatImage`, up to 32MB buffer ceiling via `this.frameBytes = 32 * 1024 * 1024`).
3. **Turn Expansion:** Multiple screenshots are fed back into the context window across iterative tool execution loops.

When a provider has `computerUse: false` (or undefined):
- Computer and browser tools are stripped from the tool catalog during `mountChatTools()`.
- User turn images are converted to `textOnly(userTurn.text)` to prevent payload rejections.

---

## 1.2 Why Groq Cannot Handle Compute

In `server/drivers/groq.ts`:
```typescript
return createOpenAIChatRuntime({
  input, driverKind: "groq", apiKey, apiUrl: config.url,
  tools: config.tools, models: () => catalog, refreshModels, reasoning: true,
  reasoningReplayField: "reasoning",
  computerUse: false,        // Explicitly disabled
  imageInput: () => false,   // Vision disabled
  ...
});
```

### The Technical Reasons:
1. **Severe Tokens-Per-Minute (TPM) Limitations on Groq Free Tier:**
   - Groq's free tier imposes strict rate limits:
     - `llama-3.3-70b-versatile`: **6,000 TPM** (Tokens Per Minute), **30 RPM**, **100,000 TPD**.
     - `llama-3.1-8b-instant`: **20,000 TPM**, **30 RPM**.
   - A single desktop screenshot captured at 1280×1280 resolution converted into vision tokens consumes between **1,600 and 2,500 tokens**.
   - When combined with the system prompt, tool definitions (~2,000 tokens for computer MCP schemas), and chat history, **Turn 1 consumes ~5,000 tokens**. On Turn 2 (the subsequent action verification screenshot), the total tokens in that 60-second window reach 10,000+, triggering an immediate HTTP 429:
     ```json
     {"error": {"message": "Rate limit reached for model `llama-3.3-70b-versatile` in organization `...` on tokens per minute (TPM): Limit 6000, Used 8420, Requested 2100. Please try again in 45s.", "type": "tokens"}}
     ```
2. **Lack of Coordinate Fine-Tuning:**
   - Groq's open-weights models (Llama 3.3, Qwen) on Groq Cloud are served without Anthropic-style coordinate prediction fine-tuning, resulting in hallucinated bounding boxes and failed mouse drags.
3. **Payload Buffering Rejection:**
   - Groq Cloud HTTP endpoints reject large multipart base64 image requests exceeding standard text API request bodies.

---

## 1.3 Detailed Provider Analysis: Free Tiers, Go Tiers, and Pro Tiers

| Provider / Tier | Compute / Vision? | Context Window | Free Tier Allowances & Rate Limits | Recommended Usage in OpenBot |
| :--- | :---: | :---: | :--- | :--- |
| **Groq (Free Tier)** | ❌ No (`computerUse: false`) | 128K | • 6,000 TPM (70B)<br>• 20,000 TPM (8B)<br>• 30 RPM, 100K TPD | **Text-only Chat & Quick Reasoning.** Ideal as a subagent router or fast summarizer. Must NOT be assigned to computer/browser agents. |
| **Google Gemini (Free Tier via AI Studio)** | ✅ Yes | 1M – 2M tokens | • 15 RPM<br>• 1,000,000 TPM<br>• 1,500 RPD (Requests Per Day) | **High-Efficiency Compute.** Can ingest hundreds of high-res screenshots without exceeding context or TPM limits. |
| **Google Gemini (Pro Tier / Antigravity)** | ✅ Yes | 2M tokens | • Paid / Subscription (AI Pro / AI Ultra)<br>• 360+ RPM, 4,000,000 TPM | **Top-Tier Compute & Vision.** Best-in-class multi-modal tool calling and long-horizon desktop tasks via `gemini-3.8-flash` / `gemini-2.5-pro`. |
| **OpenCode Go Tier (`opencodeGo`)** | ✅ Yes | 128K – 200K | • Generous daily subscription quota<br>• Dedicated inference endpoints (`glm-5.3`, `minimax-m3.1`, `qwen3.8-flash`) | **Coding & File Agent.** Native tool calling over ACP protocol. Reliable code execution and repository management. |
| **Codex (ChatGPT Plan / Plus / Pro)** | ✅ Yes | 128K – 200K | • Quota tied to ChatGPT subscription<br>• Uses `wire_api="responses"` with official models (`gpt-5.6-sol`, `gpt-5.4`) | **Deep Autonomous Planning.** Excellent tool reasoning, multi-turn tool calling, and file generation. |
| **Cerebras (Free Tier)** | ⚠️ Limited | 8K (Free) / 128K (Paid) | • 30 RPM, 60,000 TPM<br>• Hard context ceiling at 8,192 tokens | **Fast Chat Only.** Context limit of 8K is too small for desktop screenshots (`server/drivers/cerebras.ts` notes: "The account tier is unknown: use the shared free-tier limit, not paid 128K"). |
| **OpenRouter (Free Tier `<model>:free`)** | ⚠️ Text Only | 8K – 32K | • 20 RPM, 200 RPD<br>• Variable availability | **Backup Chat.** Tool support is inconsistent on free tiers; vision frames are frequently stripped. |
| **Mistral (Free / Experiment Tier)** | ⚠️ Text & Tools | 32K – 128K | • 1 RPS, monthly credit grants | **General Tasks.** Solid tool calling for web search and APIs, but currently unconfigured for OS screen control. |
| **Anthropic Claude (API / Pro Tier)** | ✅ Yes (Native) | 200K | • Metered API / Paid Pro | **Gold Standard Computer Use.** Specifically trained on native coordinate manipulation and screen verification. |

### Architectural Recommendations for Provider Configuration:
1. **Default Routing for Compute Tasks:** Automatically route any bot requiring `localComputer`, `vpsComputer`, or `browser` to **Gemini Pro (Antigravity)**, **Claude**, or **Codex**; prevent assignment of Groq or Cerebras free tier to computer tasks.
2. **Two-Tier Engine Assignment:**
   - **T1 (Fast / Free Router):** Groq `llama-3.3-70b-versatile` or `llama-3.1-8b-instant` for text chat, question routing, and prompt drafting.
   - **T2 (Heavy / Vision / Compute):** Gemini 3.8 Flash / Pro (via Antigravity or API) for routines, web browser interaction, and visual desktop control.

---

# Section 2: Mobile Companion App & Android APK Release

## 2.1 How the Mobile App Connects to OpenBot

The OpenBot mobile architecture comprises two complementary clients:
1. **Native Android Companion (`android/`)**: Built with Kotlin and Jetpack Compose. Supports real-time Server-Sent Events (SSE), background notifications, WebRTC duplex audio live calls, remote desktop gesture control (`RemoteGestures.kt`), and local device discovery.
2. **Progressive Web App (PWA)**: Mobile browser interface served directly from OpenBot (`manifest.webmanifest`).

```
┌────────────────────────────────────────────────────────┐
│                   Android Device                       │
│  ┌─────────────────────────┐  ┌─────────────────────┐  │
│  │ Native Android App      │  │ PWA Mobile Web      │  │
│  │ (Jetpack Compose)       │  │ (Chrome Standalone) │  │
│  └────────────┬────────────┘  └──────────┬──────────┘  │
└───────────────┼──────────────────────────┼─────────────┘
                │ token auth, no Origin    │ HTTPS web link
                ▼                          ▼
      ┌──────────────────┐       ┌──────────────────┐
      │ companion :8810  │       │ OpenBot :8799    │
      │ (sidecar daemon) │       │ (desktop/server) │
      └─────────┬────────┘       └──────────────────┘
                │ loopback trusted
                ▼
      ┌──────────────────┐
      │ OpenBot :8799    │
      │ (harness core)   │
      └──────────────────┘
```

### Connection & Pairing Protocol:
1. **Network Discovery:**
   - **LAN / Local Wi-Fi:** Android app uses Network Service Discovery (NSD/mDNS) to locate `_openbot._tcp` announcements.
   - **Remote / WAN:** Connects via Tailscale (MagicDNS IP `100.x.y.z`), Cloudflare Tunnel, or a reverse proxy domain (`https://bot.mycloud.com`).
2. **Pairing Handshake (`server/cli-pairing.ts` & `android/core/PairingClient.kt`):**
   - The user opens OpenBot Desktop -> Settings -> "Pair device" (or runs `openbot pair` in the terminal).
   - This generates a single-use, high-entropy 6-digit code or QR code containing `openmausbot://pair?code=...&server=...`.
   - In the Android app, the user scans the QR code (via CameraX) or manually enters the Server Address and Pairing Code.
   - The server validates the single-use code (`POST /api/auth/pair`) and exchanges it for a persistent session token (`omb_sess_...`).
3. **Security Invariants:**
   - **Origin Header Protection:** The companion daemon (`:8810`) strictly rejects requests containing an `Origin` header. Since native Android HTTP requests do not send an `Origin` header, malicious browsers on the same local network cannot impersonate the mobile companion.
   - **Local Storage:** The session token is stored in Android's hardware-backed EncryptedSharedPreferences (`KeystoreTokenStore.kt`).

---

## 2.2 Android APK Generation & Release Blueprint

### Current Status on `codex/windows-installer`:
- The complete native Android companion source code is preserved in `android/` (`:core` and `:app` modules).
- However, `.github/workflows/package-win.yml` currently packages **only the Windows NSIS installer** (`OpenBot-<version>-setup.exe`).
- There is currently no active CI workflow that compiles and publishes the Android APK to GitHub Releases.

### Implementation Blueprint:
We can add an Android release packaging workflow (or add an `android` job to the release workflow) with the following specifications:

```yaml
  android-release:
    name: Build Android Companion APK
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
          cache: gradle

      - name: Build Android Release & Preview APKs
        run: |
          cd android
          chmod +x gradlew
          # Build both debug-signed preview APK (installs immediately without keys)
          # and release APK
          ./gradlew --no-daemon :core:test :app:assemblePreview :app:assembleRelease

      - name: Package Release APK
        run: |
          VERSION=$(node -p "require('./package.json').version")
          mkdir -p release-android
          # If keystore is not provided, preview APK is signed with debug key and immediately usable:
          cp android/app/build/outputs/apk/preview/app-preview.apk release-android/OpenBot-${VERSION}-android-preview.apk
          # Unsigned production APK:
          if [ -f android/app/build/outputs/apk/release/app-release.apk ]; then
            cp android/app/build/outputs/apk/release/app-release.apk release-android/OpenBot-${VERSION}-android.apk
          else
            cp android/app/build/outputs/apk/release/app-release-unsigned.apk release-android/OpenBot-${VERSION}-android-unsigned.apk
          fi

      - name: Upload Android Release Artifacts to GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          VERSION=$(node -p "require('./package.json').version")
          gh release upload "v${VERSION}" release-android/* --repo TrashCan-Design/OpenBot --clobber
```

### Result:
Whenever a new version (e.g. `v0.1.141`) is released:
- Windows users receive `OpenBot-0.1.141-setup.exe`.
- Android users receive `OpenBot-0.1.141-android-preview.apk` (directly installable on any Android device by tapping download).

---

# Section 3: Upstream `OpenMausBot` Release Audit (v0.1.139 – v0.1.154)

The table below audits every release of upstream `milind-soni/OpenMausBot` from `v0.1.139` to the latest `v0.1.154`. Each feature and fix is classified as **Retain / Port** or **Banned / Exclude** based on our architecture rules.

| Upstream Version | Key Changes & Additions | Classification | Decision & Rationale |
| :--- | :--- | :---: | :--- |
| **v0.1.140** | • Chat spoiler tag support (`~~spoiler~~`)<br>• Palette IME candidate navigation fix<br>• Account menu: current user display and Sign out<br>• Local Podman machine startup timeout grace | **Port** | Safe UI, parser, and local container stability improvements. |
| **v0.1.141** | • Stop command cascade: terminating teammates on routine stop<br>• Restarted MCP servers retain connected app states<br>• Windows Chrome orphan process cleanup | **Port** | Essential lifecycle hygiene and MCP connection reliability. |
| **v0.1.142** | • Complete Portuguese (pt-BR) localization pack<br>• Fallback to English for missing locale keys guard<br>• Language consistency across menus, tray, and dialogs | **Port** | Localization and UI consistency; clean fallback guards. |
| **v0.1.143** | • Command Code added as built-in ACP engine (`server/drivers/acp/`)<br>• HighLevel secret exclusion from requirements | **Port (Partial)** | Port Command Code ACP engine; exclude vendor-specific HighLevel relay secrets. |
| **v0.1.144** | • "Send on your behalf" approval mode with no daily limit<br>• "This Mac" desktop switcher on navigation rail<br>• Ed25519 box channel and yamux streams for own server | **Port** | Excellent self-hosting and approval management capabilities. |
| **v0.1.145** | • Voice notes persistence on turn settle; speech synthesis on failed turns<br>• OpenCode 1 catalog lock cleanup on discovery | **Port** | Fixes catalog hang during OpenCode discovery and preserves voice notes. |
| **v0.1.146** | • Webhook retry secret revalidation<br>• Routine run failure state rollback (`put a run back when write fails`)<br>• Browser profile erasure concurrency guards | **Port** | Critical data integrity fixes for routines and browser session lifecycles. |
| **v0.1.147** | • Browser CDP session detachment recovery<br>• Dialog prompt challenge cancellation on renderer disconnect<br>• Stale loader ID filtering in CDP wait | **Ported** | *Already ported to OpenBot in v0.1.140 (`codex/windows-installer`).* |
| **v0.1.148** | • Unified 100 MB file upload limit across bots and composer<br>• Audio/video preview bounding to 25 MB with 100 MB download | **Ported** | *Already ported to OpenBot in v0.1.140 (`codex/windows-installer`).* |
| **v0.1.149** | • Upgraded bundled Cua Driver to 0.41.3<br>• Linux Hyprland plugin support for "This computer"<br>• Starter fleet concurrency: 2 simultaneous turns, 5 awake bots | **Port** | Significant performance enhancement for local and Linux desktop control. |
| **v0.1.150** | • Card secrets Vault: save and reuse secrets without re-entering<br>• Simple Mode: fold everyday advanced settings into clean simple view<br>• Instruction history and global rules across all bots | **Port** | Major UI simplification and credential vault UX improvement. |
| **v0.1.151** | • Move from Grok Bot import wizard in Settings<br>• Secret Vault dedicated management page<br>• Encrypted desktop store for all AI provider keys | **Port** | Enhanced key security and settings accessibility. |
| **v0.1.151–152** | • MausBot Relay switch on every computer (`serve --relay`)<br>• ModelGo sponsored AI provider connector<br>• Composio managed cloud broker integration | **BANNED** | **REJECT.** Violates vendor-independence and no-hosted-relay rules. OpenBot uses direct Tailscale or self-hosted Caddy tunnels instead. |
| **v0.1.152** | • Sandboxed engine spawns: npm and git execute isolated from `$HOME`<br>• Bot box runs engine model reads inside sandbox | **Port** | Hardens execution security by preventing engines from polluting user directory. |
| **v0.1.153** | • Hermes ACP `/steer` mid-turn injection<br>• Automatic orphan file cleanup for deleted bots and conversations<br>• Team Clouds subscription tiers | **Port (Partial)** | Port Hermes `/steer` and file garbage collection; **REJECT Team Clouds** vendor multi-tenancy. |
| **v0.1.154** | • Chat: bot reply appears progressively as it streams<br>• UI rendering engine optimization: 1 commit per paint, selector subscriptions<br>• Self-hosted Publish to Netlify (bots deploy web apps to user's Netlify account)<br>• Stale read message tracking fix<br>• Boat Cloud trial hours / cloud queue counters | **Port (Partial)** | **Port:** Streaming chat responsiveness, UI selector performance, and user-owned Netlify deployment.<br>**REJECT:** Boat Cloud trial hours and cloud queue counters. |

---

# Section 4: Cloud VM Execution, 24/7 Routines & Remote Relay

## 4.1 Running OpenBot on a Cloud VM (24/7 Headless Server)

The user asks:
> *"Also look up if in project, any task like routine or normal execution focusing on any remote server that can be ran in cloud that is on my custom vm machine on cloud. if there is such functionality. The functionality will just be a sort of a relay maybe that is if my laptop is offline it will run the routine or task that i give via mobile or say another laptop."*

### Yes, this functionality is natively architected into OpenBot!
OpenBot is decoupled into a headless server core (`server/`) and client presentation layers. The server does not require an active display or Electron shell to operate.

```
                     ┌──────────────────────────────────────────────┐
                     │          Custom Cloud VM (Linux VPS)         │
                     │  AWS EC2 / Hetzner / Oracle Cloud / GCP / DO  │
                     │                                              │
                     │   ┌──────────────────────────────────────┐   │
                     │   │   OpenBot 24/7 Daemon (`openbot`)    │   │
                     │   │   • Autonomous Routine Scheduler     │   │
                     │   │   • Bot Coordination & Multi-Agent   │   │
                     │   │   • Headless Browser (Chrome)        │   │
                     │   │   • BYO Docker / VPS Containers      │   │
                     │   │   • Web & API Server (:8799)         │   │
                     │   │   • Companion Daemon (:8810)         │   │
                     │   └──────────────────▲───────────────────┘   │
                     │                      │                       │
                     │   ┌──────────────────┴───────────────────┐   │
                     │   │ Caddy TLS Reverse Proxy / Tailscale  │   │
                     │   └──────────────────▲───────────────────┘   │
                     └──────────────────────┼───────────────────────┘
                                            │ Encrypted WAN
                     ┌──────────────────────┴───────────────────────┐
                     │                                              │
         ┌───────────▼───────────┐                      ┌───────────▼───────────┐
         │     Mobile Phone      │                      │   Secondary Laptop    │
         │  (Android Companion)  │                      │   (Browser / App)     │
         │  • Give task on go    │                      │  • Connect anytime    │
         │  • Approve alerts     │                      │  • Laptop 1 offline   │
         └───────────────────────┘                      └───────────────────────┘
```

---

## 4.2 How Offline Routines & Tasks Execute

1. **Autonomous Server-Side Scheduling (`server/routines.ts` & `server/scheduler.ts`):**
   - Routines are stored on disk under `~/.openmausbot/routines/` (or `/data/routines/` in Docker).
   - The scheduling engine runs inside Node.js event timers (`setInterval` / `setTimeout` with due calculations in `server/routine-due.ts`).
   - **Laptop State Independence:** When a routine is due (e.g., "Run hourly market analysis", "Check database every morning at 8:00 AM", "Scrape website daily"):
     - The cloud VM wakes the routine's assigned bot.
     - The bot executes its turn via its configured AI provider (e.g. Gemini, Codex, Claude).
     - If the task requires browsing, the server uses its own installed Chrome instance (`npx openmausbot browser install`).
     - If the task requires bash/code execution, it runs inside the bot's configured workspace or container.
     - The entire turn log, outputs, and artifacts are written to the SQLite/JSON store on the cloud VM.
     - **Your personal laptop can be completely shut down or offline; the routine executes uninterrupted.**

2. **The "Relay" & Remote Command Flow:**
   - When you are away from your primary laptop, your **Android phone** or **secondary laptop** connects to the cloud VM over Tailscale or HTTPS.
   - You can:
     - View all completed routine results and conversation transcripts.
     - Dispatch new tasks or steer running turns.
     - Receive push notifications / local alerts on your phone when an approval card or question is waiting.
     - Approve actions (e.g., Allow API execution, approve deployment) directly from your phone.
   - When you later open your primary laptop, it connects to the same cloud VM and instantly syncs the entire session state.

---

## 4.3 Deployment Options for Custom Cloud VM

The codebase already ships with production deployment manifests in `deploy/`:

### Option A: Docker Compose with Automatic HTTPS (Recommended)
Located in [`deploy/docker-compose.yml`](file:///workspaces/OpenBot/deploy/docker-compose.yml) and [`deploy/Caddyfile`](file:///workspaces/OpenBot/deploy/Caddyfile):
```sh
# On your Cloud VM (e.g. Ubuntu 24.04):
git clone https://github.com/TrashCan-Design/OpenBot.git
cd OpenBot/deploy
cp .env.example .env
# Set DOMAIN=bot.yourdomain.com in .env
docker compose up -d
```
- Caddy automatically requests and renews Let's Encrypt TLS certificates.
- OpenBot runs securely in loopback mode behind Caddy.
- All bot memory, engine sign-ins, routines, and chat history persist in the Docker volume `data:/data`.

### Option B: Tailscale (Zero Open Ports, Private Mesh)
If you do not own a domain or do not want to expose port 80/443:
```sh
# On your Cloud VM:
tailscale up
npx openmausbot serve --tailscale
```
- The server binds to your private Tailscale MagicDNS name (`https://my-vps.your-tailnet.ts.net`).
- Only your authenticated devices (phone, laptop) on your Tailscale tailnet can reach the server.
- No public ports are opened to the internet.

### Option C: Bare-Metal Node.js Service (systemd)
```sh
# On Ubuntu 24.04 VM with Node 24:
pnpm build:server && pnpm build
node server/dev-server.ts  # or openbot serve via systemd
```

---

# Section 5: Step-by-Step Implementation Plan

When ready and upon user approval, the following work will be executed in order:

### Phase 1: Provider Tier Matrix & Validation
1. Verify `groq.ts` retains `computerUse: false` and document model recommendations in settings.
2. Add capability indicators in the model selector UI distinguishing text/tool-only models from vision/compute-enabled models.
3. Test Gemini Pro and Codex Go ACP integrations for extended multi-screenshot routine runs.

### Phase 2: Android APK Release Automation
1. Create `.github/workflows/package-android.yml` (or extend `package-win.yml`).
2. Configure Gradle assemble steps for `:app:assemblePreview` and `:app:assembleRelease`.
3. Automate artifact packaging: upload `OpenBot-<version>-android-preview.apk` directly to GitHub Releases alongside `OpenBot-<version>-setup.exe`.
4. Document the pairing steps in `docs/mobile/pairing-guide.md`.

### Phase 3: Upstream Features Porting (v0.1.154)
1. Port UI streaming responsiveness improvements (`6c95a78a1` & `b692f4709`).
2. Port self-hosted Publish to Netlify (`b38a8217e` & `11b0208f4`).
3. Port Card secrets Vault (`afdc12c9a` & `078492945`).
4. Port Cua Driver 0.41.3 (`18eefe9e4`).
5. Ensure all banned vendor features (Boat VM, MausBot relay tunnels, multi-tenant cloud) remain strictly excluded.

### Phase 4: Headless Cloud VM Verification
1. Validate `deploy/docker-compose.yml` with headless routine execution.
2. Verify remote pairing between the Android Companion APK and the headless Cloud VM instance.
3. Confirm routine dispatch and notification delivery while client devices are disconnected.
