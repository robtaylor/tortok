# P2P & torrent engine

What tortok's peer-to-peer video delivery does today: the torrent engine, the
content origin, the trackers and TURN server it signals through, the client-side
seeding policy, and how the whole thing is tested on devices. Present tense,
tracking the code; the *why* is in the [decisions behind this](#decisions-behind-this).

## Torrent engine

tortok uses **WebTorrent end to end** (Decision 0001) — the same WebRTC/BitTorrent
stack on the client and the origin, no libtorrent anywhere. The client wraps it
in a platform-split bridge: `tortok/lib/webtorrent/bridge.native.ts` (Hermes /
React Native) serves torrents to the player over a local HTTP server, while
`bridge.web.ts` is a stub that rejects (a Service Worker streamer is not built),
so on web `useP2PUrl.ts` plays the magnet's webseed URL directly and the browser
does no P2P. `client.ts` holds the shared
refcounted torrent manager and `types.ts` the shared surface. Playback URLs are
resolved through `useP2PUrl.ts`, and `usePrefetch.ts` warms upcoming feed items.

On Hermes the WebRTC surface needs polyfills (`polyfills.native.ts`) — notably a
`self` shim and `AbortSignal.timeout` — without which BEP-19 webseed fetches fall
back to a slow WebRTC path. `metro.config.js` wires the matching module
resolution, and `polyfills.web.ts` is the lighter browser equivalent.

## Content origin and webseed

The origin seeder runs today inside the backend as `SeederService`
(`backend/src/services/seeder.ts`; process-level detail in
[backend](backend.md#seeder)): it seeds the directories under
`backend/content/` over WebTorrent and embeds a BEP-19 **webseed** URL in each
torrent so the client can pull pieces over HTTP when no peers are available. In
local development the feed's magnets come instead from the spike seeder
(`test-content/seeder.mjs`, seeding `test-content/clips/*.mp4`). The webseed
origin is Cloudflare **R2** in production, served through the bucket's custom
domain `content.tortok.net` behind Cloudflare's cache (the bucket's `r2.dev` URL
is rate-limited and is not used), and a local content server
(`http://localhost:8090`) in dev, set by `CONTENT_ORIGIN_URL`
(Decision 0008's R2-origin layer). The origin URL is baked into every magnet and
`.torrent` file, so the content hostname is effectively permanent. A webseed on R2 is sufficient on its own: with no
seeder, tracker or DHT, a client downloads complete, verified content from R2
([webseed-only spike](decisions/spikes/webseed-only-origin.md)). For a directory
(multi-file) torrent the webseed URL is the *parent* of the torrent directory,
because WebTorrent appends `<name>/<file>`; for a single-file torrent it is the
file's URL.

A seeded **file** is never renamed with `seed()`'s `name:` option: the default
fs-chunk-store resolves pieces by torrent name, so a name that differs from the
file's basename makes every piece read fail with ENOENT. The spike seeder seeds
files by path alone for this reason. `SeederService` passes `name:` equal to the
seeded directory's own name, which is the default anyway and is harmless.

## Trackers and TURN

tortok runs its **own WebSocket tracker** (`tracker/server.js`, deployed on
Fly.io via `tracker/fly.toml`) rather than relying on public `wss://` trackers,
which leak phantom peers from prior sessions. It also runs its **own TURN
server** (`coturn/`, a coturn image on Fly.io) for WebRTC ICE when peers are
behind NAT — this is the TURN that the device-testing tier 3 (below) also uses.

## Client seeding policy

The client seeds back the content it has recently watched, bounded by
Decision 0009's policy and implemented in `tortok/lib/webtorrent/seedPolicy.ts`
on top of `client.ts`'s refcount holds. The starting numbers: on mobile, at most
5 held torrents, a 150 MB byte budget, and a 30-minute TTL; on desktop/web the
seed count is unbounded and the budget is 500 MB. Eviction runs on a 60-second
interval. Seeding is **battery- and network-gated** via
`deviceConditions.native.ts` (NetInfo + battery), so a backgrounded or
low-battery phone stops seeding. These numbers are starting guesses pending the
offload validation (see the [Phase 2 spike](decisions/spikes/phase-2-p2p-offload.md)).

## Device testing

Device testing is split into three tiers by what each question needs
(Decision 0014), with the tier-3 vendor revised to LambdaTest/TestMu by
Decision 0015:

- **Tier 1 — CI gate: self-hosted emulators** in our own VPC. P2P connection
  logic, offload accounting, and regression smoke, cheaply and with full network
  control.
- **Tier 2 — video playback tuning: a single real device** on a cheap farm, fed
  from CDN/webseed. Decode, FPS, jank, thermal, and startup — no P2P networking
  needed, since playback is independent of where the bytes come from.
- **Tier 3 — P2P × real-device composition: LambdaTest/TestMu**, two parallel
  Appium sessions connecting over a TURN-relayed ICE path using our own TURN
  server, signaling through our tracker (reached via their Tunnel). Offload is
  measured app-side, since their `appProfiling` network metric is aggregate-only.
  AWS Device Farm + VPC-ENI is the documented fallback.

## Implementation status

- **Built:** WebTorrent client bridge on native (web plays the webseed over
  HTTP; the web bridge is a stub), refcounted torrent manager,
  Hermes polyfills, client seeding policy with battery/network gating, the
  backend `SeederService` with R2 webseed, the own tracker, and the coturn TURN
  server. Two-simulator P2P offload measured at 89–91% in the Phase 2 spike.
- **Pending:** There is no standalone seeder deployment: the `tortok-seeder` Fly
  app was destroyed on 2026-11-04 after the webseed-only spike, and the only
  origin seeder is the backend's in-process `SeederService`. Whether an
  always-on origin peer is still wanted, given that webseed suffices, is
  undecided; unifying the dev-spike and backend seeders waits on that. None of
  the three device-testing tiers is stood up yet; they begin once Phase 3 work
  clears, tiers 1 and 2 before the tier-3 rig (Decision 0014).
- **Open:** where bytes come from once several deployments serve the same
  posts, and how clients learn sources beyond the magnet; see
  [`open-problems/cross-deployment-transport.md`](open-problems/cross-deployment-transport.md).
- **Open:** real-device offload ratio and the client policy's starting numbers
  are validated by the real-device tiers, not yet run; see
  [`open-problems/seeding-policy.md`](open-problems/seeding-policy.md).

## Decisions behind this

- [Decision 0001](decisions/0001-webtorrent-end-to-end.md) — torrent engine is WebTorrent, end to end.
- [Decision 0008](decisions/0008-seeder-storage-cdn.md) — seeder, storage, and CDN infrastructure (R2 origin, four layers).
- [Decision 0009](decisions/0009-client-seeding-policy.md) — Phase 2 client seeding scope and policy.
- [Decision 0014](decisions/0014-device-testing-strategy.md) — device testing strategy (three tiers).
- [Decision 0015](decisions/0015-tier3-p2p-testing-lambdatest.md) — tier-3 real-device P2P testing on LambdaTest/TestMu.
- [Decision 0016](decisions/0016-testing-strategy-where-each-kind-of-test-lives.md) — testing strategy: tier 1 as the primary regression gate, integration tests for new backend code, no legacy-backend backfill.
