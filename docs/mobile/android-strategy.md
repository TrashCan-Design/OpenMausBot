# OpenBot Android Mobile Application Strategy & Architecture

## 1. Overview & Dual-Surface Strategy

OpenBot provides full mobile feature parity across two complementary deployment surfaces:

1. **Native Android Companion (`android/`)**: A Kotlin & Jetpack Compose application designed for deep OS integration, background connectivity, hardware-accelerated remote desktop control, duplex WebRTC audio, and home screen widgets.
2. **Progressive Web App (PWA)**: A zero-install mobile web application served directly from OpenBot (`public/manifest.webmanifest`), suitable for quick interaction from Chrome for Android.

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

---

## 2. Feature Parity Matrix

| Feature | OpenBot Desktop / Server | Native Android Companion (`android/`) | Android PWA |
| :--- | :--- | :--- | :--- |
| **Chat & Streaming** | Full token delta & markdown streaming | Real-time SSE streaming via `:core:SseClient` | Real-time SSE streaming via Fetch |
| **Thinking & Reasoning** | Expandable live turn progress & thinking | `ReasoningBlock` & `LiveTurnStatus` | `TurnNarrationRun` component |
| **Approvals & Questions** | Interactive cards (Allow / Deny / Always) | Native Material 3 Approval & Question cards | React Card components |
| **Mid-Turn Steer & Aside** | `/steer` aside injection | Deep-link & action bar steer composer | In-chat steer input |
| **Remote Computer Touch** | Full mouse & keyboard control | `RemoteGestures.kt` (Direct & Trackpad modes) | View-only screen stream |
| **Live Call (Duplex Audio)** | WebRTC audio bridge | `WebRtcLiveCallTransport.kt` & Audio routing | WebRTC web audio API |
| **Voice Notes & Dictation** | Audio playback & Whisper/native STT | `VoiceNotePlayer.kt` & `SpeechDictation.kt` | MediaRecorder / Web Speech API |
| **Background Connectivity** | Always active daemon | `AlwaysOnConnectionService` (connected device) | Dependent on browser wake locks |
| **Push Notifications** | OS desktop notifications | Local notifications for approvals & turns | Web Push (when HTTPS configured) |
| **Pairing & Discovery** | QR Code & Bonjour advertising | QR scanner (`CameraX`), NSD/mDNS, PIN | URL manual input |
| **Home Screen Widgets** | N/A | `NeedsYouWidget`, `UpdatesDigestWidget` | Standard web shortcut |
| **Share Sheet Receiver** | N/A | `ShareReceiveActivity` (files, URLs, text) | Web Share Target API |

---

## 3. Native Architecture (`android/`)

### 3.1 Module Breakdown

- **`:core`**: Protocol, cryptographic, and network engine (Kotlin Multiplatform-compatible architecture).
  - `SseClient.kt`: Event-stream parser handling token deltas, tool progress, and turn completion.
  - `PairingClient.kt`: High-entropy QR token exchange, 6-digit PIN fallback, and token persistence.
  - `RemoteGestures.kt`: Pure touch-to-intent engine converting touch points to normalised coordinates (0..1) for remote mouse moves, clicks, scrolls, and drag-and-drop.
  - `LiveCallTransport.kt`: WebRTC audio session state machine.
  - `Hpke.kt`: RFC 9180 hybrid public key encryption for zero-knowledge credential relay.
- **`:app`**: Jetpack Compose user interface and Android platform services.
  - `ui/`: Material 3 design system with dynamic light/dark theming and custom mascot rendering.
  - `audio/LiveCallManager.kt`: Manages audio routing (`MODE_IN_COMMUNICATION`), earpiece vs speakerphone switching, and proximity sensor integration.
  - `lifecycle/AlwaysOnConnectionService.kt`: Android 14/15/16-compliant foreground service (`FOREGROUND_SERVICE_CONNECTED_DEVICE`) maintaining connection to the companion sidecar without battery drain.
  - `notifications/LocalNotificationPoster.kt`: Heads-up notification channels for blocking approval requests and completed tasks.
  - `discovery/NsdDiscovery.kt`: Network Service Discovery for automatic zero-configuration detection of local OpenBot instances (`_openbot._tcp`).

### 3.2 Security Model

The native application pairs with OpenBot's `companion` sidecar process (port 8810):
- **Origin Refusal**: The companion sidecar strictly drops requests containing an `Origin` header. Because the native app issues direct HTTP/SSE requests without an `Origin` header, malicious browsers on the same local network cannot spoof mobile requests.
- **Token Authorization**: Every command carries a device token hashed as SHA-256 on the companion sidecar.
- **Single-Use Pairing**: Pairing codes (QR or 6-digit PIN) expire after 2 minutes and are single-use.
- **Network Boundaries**:
  - Over Tailscale: End-to-end encrypted WireGuard transport.
  - Over Hosted HTTPS: TLS certificate validation.
  - Over LAN: Local network communication with optional Bonjour discovery.

---

## 4. Build, Test & Release Pipeline

### Prerequisites
- JDK 17+
- Android SDK (API Level 37 compileSdk, API Level 26 minSdk)

### Build Commands
```sh
cd android

# Run unit tests across :core and :app
./gradlew :core:test :app:testDebugUnitTest

# Build debug APK
./gradlew :app:assembleDebug

# Build preview APK (installs alongside release with separate data)
./gradlew :app:assemblePreview

# Build production release APK/AAB
./gradlew :app:assembleRelease :app:bundleRelease
```

### Signing Configuration
Set the following environment variables (or provide `android/keystore.properties`):
- `OPENMAUSBOT_KEYSTORE_FILE`
- `OPENMAUSBOT_KEYSTORE_PASSWORD`
- `OPENMAUSBOT_KEY_ALIAS`
- `OPENMAUSBOT_KEY_PASSWORD` (optional, defaults to store password)

When signing variables are omitted, Gradle generates unsigned artifacts (`app-release-unsigned.apk`) for local verification.
