# Decision 0004: Client is Expo + React Native + TypeScript

**Status:** Accepted

**Context.** The current Swift/SwiftUI prototype is iOS-only. Cross-platform
reach (iOS, Android, web) is now an explicit requirement, and the atproto
client SDK is TypeScript-first. Choosing the client language locks in the
codebases we maintain for years.

**Decision.** Rewrite the client in Expo (React Native) with TypeScript.
Targets: iOS, Android, and web via React Native Web / Expo Router.

**Why.**
- Cross-platform is a hard requirement. Swift cannot target Android or web.
- `@atproto/api` is the reference implementation of the AT Protocol client;
  using it in its native language is materially simpler than wrapping XRPC
  by hand in Swift + Kotlin + JS.
- WebTorrent is a JavaScript library. Running it in the same JS runtime as
  the app removes the `WKWebView` bridge entirely. The current Swift
  `P2PResourceLoader.swift` + `WebTorrentBridge.swift` (~1000 lines)
  disappears rather than being ported.
- The backend is already TypeScript (Decision 0005). One language across the stack
  means shared types, shared validation, and a single hiring pool.
- Expo gives us OTA updates, a managed workflow for the 80% case, and
  ejection to bare React Native when we need native modules.

**Why not the alternatives.**
- **Stay in Swift, add Kotlin for Android.** 2–3x engineering cost, no
  shared business logic, and still no web story. Rejected.
- **Flutter.** Excellent UI kit, but the Dart ecosystem for atproto and
  WebTorrent is near-zero. We would be rebuilding both.
- **PWA only.** iOS Safari's PWA sandbox is too weak for a short-form video
  app: background restrictions, HLS-only via native controls, no serious
  push story.
- **Capacitor / Tauri wrapping a web app.** Viable, but Expo gives us the
  same cross-platform story with better access to native modules (camera,
  file system, secure store) and a more mature OTA update pipeline.
- **Hybrid: Swift player + TS networking via JavaScriptCore.** Clever,
  ultimately worse — still one codebase per platform, plus a JS bridge.

**Consequences.**
- We throw away ~3500 LOC of Swift. The WebTorrent bridge, AVFoundation
  player, and UI tests are lost. Most of it was prototype quality.
- React Native video playback for a TikTok-style vertically-scrolling feed
  needs care. This is the single biggest execution risk in the rewrite and
  must be prototyped before committing to full feature parity.
- We gain: one codebase, three platforms, a first-class atproto client,
  a simpler P2P stack, shared types with the backend, and a much larger
  contributor pool.
