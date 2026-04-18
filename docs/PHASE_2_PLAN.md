# Phase 2 — Cross-platform P2P (status)

Scope: ADR-006 Phase 2 ("Cross-platform P2P").

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
- P2P-first source selection: waits for P2P (<1s with .torrent
  buffer), falls back to HLS after 3s timeout. Source locked once
  chosen — no mid-playback restart.

### Unit 4 — Three-platform validation
- iOS simulator: P2P end-to-end via bridge.
- Android emulator: P2P init with defensive polyfills + expo-crypto
  fallback for Nitro timing race.
- Expo web: HLS fallback via bridge.web.ts stub.
- Results recorded in ADR-009.

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

## Remaining

### Unit 3 — Webseed-only (HLS dropped)
- Added `urlList` (BEP-19 webseed) to torrent creation in both
  `backend/src/services/seeder.ts` and `test-content/seeder.mjs`.
- Removed HLS fallback from client: `hlsURL` field, `lockedUrl`
  state, `P2P_TIMEOUT_MS` timer all deleted.
- Removed `hlsUrl` from validation schemas and API responses.
- `hls_url` DB column kept nullable (vestigial).
- Recorded as ADR-009 amendment.

### Unit 5 — Client seeding policy (ADR-009)
- Mobile: seed N most-recently-watched videos (scroll-back window).
- Desktop/web: battery-gated aggressive seeding.
- Files: seeding-policy hooks in `tortok/lib/webtorrent/`, battery
  detection via `expo-battery` (native) / `navigator.getBattery()` (web).

### Unit 6 — Cleanup gate
- Delete `tortok/app/spike.tsx`, `tortok/app/spike-bridge.tsx`.
- Remove spike auth-guard exemption in `tortok/app/_layout.tsx`.
- Flip `EXPO_PUBLIC_USE_P2P` default to `1` in development.
- Write `docs/PHASE_2_HANDOFF.md`.

## Not in scope (future phases)
- Recording / upload UX — separate concern
- PDS / atproto integration — Phase 3
- AppView cutover — Phase 4
- Moderation — Phase 3
- Rigorous swarm simulation — deferred to post-launch
