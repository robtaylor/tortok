# Phase 2 Plan — Cross-platform P2P

Scope: ADR-006 Phase 2 ("Cross-platform P2P"). Blockers (seeding
policy client-side, Hermes WebRTC) already resolved in ADR-009 +
the WebTorrent spike (`app/spike.tsx`, commits `a2dc987` / `f482b90`).

This plan is concise by design — each unit is a discrete commit,
each commit ends with a measurable outcome. Decision points are
flagged explicitly; pause for sign-off there.

## Guiding decisions (locked with user, 2026-04-15)

1. **Stay on RN/Expo.** Capacitor considered and declined — switching
   cost outweighs the WebTorrent-playback relief; see conversation
   log for the full trade-off. Native playback path = local HTTP
   bridge; web path = Service Worker streamer (lift pattern from
   `kuttydevil/webtorrent-player`, reimplement — GPL-3.0 prevents
   direct incorporation).
2. **Poster-first feed.** Every cell shows `thumbnailURL` immediately;
   video layer mounts on `isActive` and swaps in on `readyToPlay`.
   Inactive cells don't instantiate `useVideoPlayer`. Decouples
   scroll feel from WebTorrent latency on every platform.
3. **Measurement rigor: directional, not defensible.** Two real
   clients (iOS sim + Chrome web) sharing the dev seeder on LAN.
   Report peer-vs-webseed byte ratio. Updates ADR-008's cost
   envelope from "~50%" guess to a measured number. Rigorous swarm
   modeling deferred to post-launch when real traffic calibrates
   better than any simulator would.
4. **Webseed fallback enabled at the seeder.** ~2-line change to
   `backend/src/services/seeder.ts` to add `urlList` on torrent
   creation. WebTorrent's BEP-19 handles peer-miss transparently —
   no client-side fallback logic needed.
5. **Cleanup gate.** Delete `app/spike.tsx` and the `isSpike` branch
   in `_layout.tsx` once all units land. Already flagged with TODOs.

## Work units

Unit 0 is always-win and unlocks later work. Unit 1 is the
load-bearing spike — its outcome determines whether later units
proceed as planned or whether we reopen Q3b.

### Unit 0 — Poster layer (always-win, unblocks later feed work)

- **Scope:** `VideoItem` renders `<Image source={{ uri: video.thumbnailURL }}>`
  behind the player. Image hidden only when
  `status === 'readyToPlay' && isActive && !isPaused`. Inactive cells
  skip `useVideoPlayer` entirely — defer player creation until
  `isActive` or `isAdjacent` (±1 of active index).
- **Files:** `tortok/app/(tabs)/index.tsx` only.
- **Prefetch:** `Image.prefetch(video.thumbnailURL)` for `activeIndex ± 2`.
- **Success:** opening the feed on a slow network shows posters
  immediately; only the active cell has an active video player;
  scroll jank against HLS-only baseline is no worse.
- **No P2P, no bridge, no backend.** Purely consumes a field the
  API already returns. Lands independent of Unit 1.

### Unit 1 — Local HTTP bridge spike (the decision unit)

- **Scope:** standalone dev-branch spike, not production code yet.
  Stand up `@dr.pogodin/react-native-static-server` or equivalent,
  load `webtorrent-hybrid` via the ADR-009 polyfill stack, start a
  server bound to `127.0.0.1:<ephemeral>` that serves bytes from a
  given torrent's file stream to HTTP Range requests. Point one
  `VideoView` at the bridge URL against a pre-seeded test magnet.
- **Files:** `tortok/app/spike-bridge.tsx` (new, dev-only, will be
  deleted at the cleanup gate like `spike.tsx`); `tortok/lib/` may
  gain a `webtorrent-bridge.ts` helper to be extracted if the spike
  works.
- **Measurements to capture** (reported in the commit body):
  - First-frame latency cold (empty swarm, webseed only)
  - First-frame latency warm (piece 0 cached)
  - Swipe-past cancelation behavior (does WebTorrent reprioritize?)
  - Peer count maintained during 10-swipe burst
  - iOS ATS: verify `http://127.0.0.1` plays without Info.plist
    changes (should work; record the fact)
- **Sign-off gate.** After Unit 1, pause and share the measurements.
  Three possible outcomes:
  - (a) Feels good → proceed to Unit 2 as planned.
  - (b) Fixable with piece-priority discipline → add remediation as
    Unit 2a before wiring into the real feed.
  - (c) Genuinely bad → reopen ADR-003, reconsider wrapper choice.
    Budget for this outcome: 1 day of discussion, not "rewrite
    immediately."

### Unit 2 — Wire WebTorrent into `VideoItem` behind a flag

- **Depends on:** Unit 0, Unit 1 sign-off.
- **Scope:** introduce `EXPO_PUBLIC_USE_P2P=1` runtime flag. When
  set, `VideoItem` uses the bridge URL (native) / Service Worker
  URL (web) built from `video.magnetLink`; otherwise uses
  `video.hlsURL` as today. One WebTorrent client shared across the
  whole feed; piece selection keyed to `activeIndex ± 1`.
- **Files:** `tortok/lib/webtorrent.ts` (new, singleton client +
  platform-conditional URL builder), `tortok/app/(tabs)/index.tsx`
  (consume URL from helper), `tortok/lib/webtorrent.web.ts` (web
  variant using the SW streamer).
- **Success:** with flag on, active video plays via P2P on iOS
  sim + Chrome web; with flag off, behavior is byte-identical to
  today. No regression in Unit 0's poster behavior.

### Unit 3 — Seeder webseed wiring

- **Scope:** `backend/src/services/seeder.ts` adds `urlList` to the
  torrent creation options pointing at the R2 content origin. New
  videos include the webseed; re-seeding existing content picks up
  the new URL. No client-side change — WebTorrent consumes
  `url-list` automatically.
- **Files:** `backend/src/services/seeder.ts`, one-line config for
  the R2 content origin URL.
- **Success:** a fresh magnet inspected with e.g. `webtorrent
  magnet:?...` shows `url-list` populated; a cold-swarm client
  streams bytes from R2 with zero peers connected.

### Unit 4 — Three-platform validation + offload measurement

- **Scope:** validate feed P2P playback on iOS sim, Android
  emulator, and Expo web (Chrome). Then run the two-client
  measurement: iOS sim + Chrome web both pointed at the dev
  seeder, both scrolled through the same 3-video feed. Record
  peer-vs-webseed byte ratio per video from WebTorrent's
  `torrent.downloaded` / `torrent.downloadedFromWebseed`.
- **Files:** `docs/ADR-008-CALIBRATION.md` (new, appends measured
  offload to the cost envelope; may become an amendment to
  ADR-008 itself if the number moves the envelope materially).
- **Success:** all three platforms play. Measured offload ratio
  recorded. Cost model in ADR-008 updated or confirmed.

### Unit 5 — ADR-009 client seeding policy implementation

- **Scope:** implement the mobile policy (scroll-back window —
  seed the N most-recently-watched videos) and the desktop/web
  policy (battery-gated aggressive — seed whatever swarm needs
  when plugged in or battery > threshold). ADR-009 starting numbers
  (exact N, battery threshold) are validated here against real
  behavior and adjusted if needed.
- **Files:** `tortok/lib/webtorrent.ts` seeding-policy hooks;
  `tortok/lib/battery.ts` or similar (web side uses
  `navigator.getBattery()`, native uses `expo-battery`).
- **Success:** seeding active on mobile for recent videos only,
  stops when app backgrounded per ADR-009; desktop/web aggressive
  when charging; verified via logs + dev-seeder peer counts.

### Unit 6 — Cleanup gate

- **Scope:** delete `tortok/app/spike.tsx`, `tortok/app/spike-bridge.tsx`
  (from Unit 1 if not already), and the `isSpike` / spike-bridge
  branches in `tortok/app/_layout.tsx`. Flip `EXPO_PUBLIC_USE_P2P`
  default to true in development. Write `docs/PHASE_2_HANDOFF.md`
  mirroring the 0a handoff structure.
- **Files:** as above plus `tortok/app/_layout.tsx` auth guard.
- **Success:** `grep -r spike tortok/` returns no results; Phase 2
  complete per ADR-006.

## E2E test recipes

The Detox suite (`tortok/e2e/`) covers the feed/auth golden paths
from Phase 1. Phase 2 adds two recipes:

- **P2P playback smoke** (added in Unit 2): with dev seeder
  running, sign in, scroll feed, assert first video reaches
  `readyToPlay` within 8s cold / 3s warm.
- **Bridge lifecycle** (added in Unit 2): app backgrounded → bridge
  tears down cleanly; foregrounded → bridge restarts.

Manual verification during Units 1 and 4:
- iOS sim: `bun run ios` in `tortok/`, open feed, confirm posters
  render instantly, active video plays, scroll feels responsive.
- Android emulator: same, via `bun run android`.
- Web: `bun run web` in Chrome, open feed, confirm Service Worker
  registration, confirm posters + video + peer count visible in
  dev overlay.

## Decision points and sign-off checkpoints

1. **After Unit 1** — share bridge spike measurements before Unit 2
   starts. Possible outcome: reopen wrapper choice (low probability,
   but budgeted).
2. **After Unit 4** — share offload measurement before updating
   ADR-008. If the number is far from ~50% (either direction), the
   cost envelope may need an amendment that deserves its own review.
3. **Before Unit 6 cleanup** — confirm all three platforms validated
   and no open defects before deleting spike code. Once deleted,
   reverting is a git-revert, not a disaster, but don't delete
   prematurely.

No sign-off needed between Units 0↔3 ↔5 — routine work within an
agreed scope.

## Not in this plan

- Recording / upload UX (Record tab stub) — separate concern.
- PDS / atproto integration — Phase 3.
- AppView cutover — Phase 4.
- Moderation — Phase 3.
- Cost envelope revisions beyond the offload-ratio input — Phase 4
  when AppView costs enter the model.
- Rigorous swarm simulation — deferred (THE ONE is wrong category,
  netem doesn't model swarms, no good WebTorrent-specific tooling).
  Revisit post-launch with real traffic.

## Risk register (what could force a replan mid-Phase)

- **Unit 1 outcome (c):** wrapper choice reopens. Plan would be
  paused; no sunk cost beyond the spike branch (which is disposable
  by design) and Unit 0 (which is wrapper-agnostic anyway).
- **`webtorrent-hybrid` under Hermes.** Node-shaped WebTorrent may
  need more polyfilling than the browser-shape used in the
  ADR-009 spike. If so, Unit 1 surfaces it; remediation is library
  selection, not architecture.
- **Seeder needs a real content origin URL for Unit 3.** If R2
  isn't live yet (Phase 0b deliverable — verify), Unit 3 either
  stubs to a local path during dev or blocks on Phase 0b closure.
  Check before starting Unit 3.
- **ATS surprise on iOS.** Low probability; if `http://127.0.0.1`
  doesn't play out of the box, one-time Info.plist patch via app
  config. Captured in Unit 1 measurement.
