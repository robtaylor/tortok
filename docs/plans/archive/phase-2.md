# Phase 2 — Cross-platform P2P (status)

**Status:** Implemented — Phase 2 closed 2026-04-29 (two-simulator P2P measured 89–91% offload; see [`../../architecture/decisions/spikes/phase-2-p2p-offload.md`](../../architecture/decisions/spikes/phase-2-p2p-offload.md)).

Scope: Decision 0006 Phase 2 ("Cross-platform P2P").

## Completed

### Unit 0 — Poster-first feed
- `VideoItem` renders poster behind video layer, hidden once first
  frame renders (`playingChange` event).
- Display state machine (`poster → playing → paused → error`) is the
  single source of truth for what the user sees.
- `Image.prefetch` warms neighbors at `activeIndex ± 2`.
- Inactive cells skip `useVideoPlayer` entirely.

### Unit 1 — Local HTTP bridge spike
- `tortok/app/spike-bridge.tsx` validated the approach.
- Bridge serves torrent bytes over `http://127.0.0.1:<port>` to
  AVPlayer/ExoPlayer. iOS ATS allows loopback without Info.plist.

### Unit 2 — WebTorrent wired into VideoItem
- `EXPO_PUBLIC_USE_P2P=1` flag gates P2P.
- `tortok/lib/webtorrent/client.ts` — singleton client, refcounted
  torrent lifecycle, memory-chunk-store.
- `tortok/lib/webtorrent/bridge.ts` — local HTTP server serving
  Range requests from torrent file streams.
- `tortok/lib/webtorrent/useP2PUrl.ts` — hook resolving magnet →
  bridge URL with cleanup on unmount.
- P2P source selection: resolves via .torrent buffer (<1s).
  Webseed (BEP-19) provides HTTP fallback transparently.

### Unit 4 — Three-platform validation
- iOS simulator: P2P end-to-end via bridge.
- Android emulator: P2P init with defensive polyfills + expo-crypto
  fallback for Nitro timing race.
- Expo web: bridge.web.ts stub (SW streamer deferred).
- Results recorded in Decision 0009.

### Additional work (not in original plan)
- **Inline .torrent metadata**: `torrentFileUrl` field in DB/API,
  fetched as buffer and passed to `client.add()` for instant
  resolution (eliminates 6s magnet round-trip).
- **Display state machine**: `displayState` is primary state, events
  drive transitions. Replaces scattered `isPaused`/`hasPlayed`/`status`.
- **Poster rename**: `thumbnail_url` → `poster_url` across DB, API,
  client, seeder. It's a full-res still frame, not a thumbnail.
- **Android polyfills**: Defensive null checks on RTCPeerConnection
  and QuickCrypto, expo-crypto fallback when Nitro fails.

### Unit 3 — Webseed-only (HLS dropped)
- Added `urlList` (BEP-19 webseed) to torrent creation in both
  `backend/src/services/seeder.ts` and `test-content/seeder.mjs`.
- Removed HLS fallback from client: `hlsURL` field, `lockedUrl`
  state, `P2P_TIMEOUT_MS` timer all deleted.
- Removed `hlsUrl` from validation schemas and API responses.
- `hls_url` DB column kept nullable (vestigial).
- Removed standalone `seeder/` service (webseed makes it redundant).
- Recorded as Decision 0009 amendment.

### Unit 6 — Cleanup gate
- Deleted `tortok/app/spike.tsx`, `tortok/app/spike-bridge.tsx`.
- Removed spike auth-guard exemption in `tortok/app/_layout.tsx`.
- Flipped `EXPO_PUBLIC_USE_P2P` default to enabled (opt-out via `'0'`).

### Unit 5 — Client seeding policy (Decision 0009)
- `seedPolicy.ts` — core engine: refcount-based holds on recently-watched
  torrents, eviction by TTL (30 min), count (5 mobile / unlimited desktop),
  and byte budget (150 MB mobile / 500 MB desktop).
- `deviceConditions.{native,web}.ts` — platform-specific battery + network
  checks. Mobile: battery > 30% AND Wi-Fi. Desktop: charging OR > 80%.
- `useSeedPolicy.ts` — React hook wiring policy into FeedScreen lifecycle
  (AppState background → stopAll, condition changes → pause/resume).
- Two-line integration in `FeedScreen`: `useSeedPolicy(activeVideo)`.
- Dependencies: `expo-battery`, `expo-network`.

## Not in scope (future phases)
- Recording / upload UX — separate concern
- PDS / atproto integration — Phase 3
- AppView cutover — Phase 4
- Moderation — Phase 3
- Rigorous swarm simulation — deferred to post-launch
