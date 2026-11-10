# P2P & torrent engine

What tortok's peer-to-peer video delivery does today: the torrent engine, the
content origin, the trackers and TURN server it signals through, the client-side
seeding policy, and how the whole thing is tested on devices. Present tense,
tracking the code; the *why* is in the [decisions behind this](#decisions-behind-this).

## Torrent engine

tortok uses **WebTorrent end to end** (Decision 0001) — the same WebRTC/BitTorrent
stack on the client and the origin, no libtorrent anywhere. The client wraps it
in a platform-split bridge. On native, `tortok/lib/webtorrent/bridge.native.ts`
serves torrents to the player over a local HTTP server. On web,
`bridge.web.ts` is a stub that rejects, because no Service Worker streamer is
built; `useP2PUrl.ts` plays the magnet's webseed URL directly, and the browser
does no P2P. `client.ts` holds the shared refcounted torrent manager and
`types.ts` the shared surface. Playback URLs are
resolved through `useP2PUrl.ts`, and `usePrefetch.ts` warms upcoming feed items.

On Hermes the WebRTC surface needs the polyfills in `polyfills.native.ts`,
notably a `self` shim and `AbortSignal.timeout`. Without them, BEP-19 webseed
fetches fall back to a slow WebRTC path. `metro.config.js` wires the matching module
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
domain `content.tortok.net` behind Cloudflare's cache, and a local content
server (`http://localhost:8090`) in dev, set by `CONTENT_ORIGIN_URL`
(Decision 0008's R2-origin layer). The bucket's `r2.dev` URL is not used; the
reasons for the custom domain are in
[`cross-deployment-transport.md`](open-problems/cross-deployment-transport.md).
The origin URL is baked into every magnet and `.torrent` file, so the content
hostname is effectively permanent. A webseed on R2 is sufficient on its own: with no
seeder, tracker or DHT, a client downloads complete, verified content from R2
([webseed-only spike](decisions/spikes/webseed-only-origin.md)). For a directory
(multi-file) torrent the webseed URL is the *parent* of the torrent directory,
because WebTorrent appends `<name>/<file>`; for a single-file torrent it is the
file's URL.

A seeded **file** is never renamed with `seed()`'s `name:` option: the default
fs-chunk-store resolves pieces by torrent name, so a name that differs from the
file's basename makes every piece read fail with ENOENT. The spike seeder seeds
files by path alone for this reason, and so does `SeederService`.

## Trackers and TURN

tortok runs its **own WebSocket tracker** (`tracker/server.js`, deployed on
Fly.io via `tracker/fly.toml`) and announces to no public tracker (Decision
0008's L3; the [Phase 2 spike](decisions/spikes/phase-2-p2p-offload.md) records
why). It also runs its **own TURN server** (`coturn/`, a coturn image on Fly.io)
for WebRTC ICE when peers are behind NAT. Device-testing tier 3 is planned to
use the same TURN server.

## Client seeding policy

The client seeds back the content it has recently watched, bounded by
Decision 0009's policy and implemented in `tortok/lib/webtorrent/seedPolicy.ts`
on top of `client.ts`'s refcount holds. The starting numbers: on mobile, at most
5 held torrents, a 150 MB byte budget, and a 30-minute TTL; on desktop/web the
seed count is unbounded and the budget is 500 MB. Eviction runs on a 60-second
interval. Seeding is **battery- and network-gated** by
`deviceConditions.native.ts`, which uses `expo-battery` and `expo-network`: a
phone below 30% battery or off Wi-Fi doesn't seed, and the network is polled
every 30 seconds. `useSeedPolicy.ts` also stops seeding when the app leaves the
foreground (`AppState`). These numbers are starting guesses pending the
offload validation (see the [Phase 2 spike](decisions/spikes/phase-2-p2p-offload.md)).

## Device testing

No device-testing rig exists yet. The plan is three tiers (Decision 0014): tier
1 self-hosted emulators as the CI gate, tier 2 a single real device for playback
tuning, and tier 3 real-device P2P on LambdaTest/TestMu (Decision 0015). Tier 1
is the primary regression gate (Decision 0016). The only device tests today are
the hand-run Detox suite described in [client](client.md#testing).

## Implementation status

- **Built:** WebTorrent client bridge on native (web plays the webseed over
  HTTP; the web bridge is a stub), refcounted torrent manager,
  Hermes polyfills, client seeding policy with battery/network gating, the
  backend `SeederService` with R2 webseed, the own tracker, and the coturn TURN
  server. Two-simulator P2P offload measured at 89–91% in the Phase 2 spike.
- **Pending:** There is no standalone seeder deployment: the `tortok-seeder` Fly
  app was destroyed on 2026-11-04 after the webseed-only spike, and the only
  origin seeder is the backend's in-process `SeederService`. Phase 3 Unit 2.5C
  removes it ([`phase-3-atproto.md`](../plans/phase-3-atproto.md)); whether
  tortok runs an always-on peer at all is part of the transport open problem.
  None of the three device-testing tiers is stood up yet; they begin once
  Phase 3 work clears, tiers 1 and 2 before the tier-3 rig (Decision 0014).
- **Open:** where bytes come from once several deployments serve the same
  posts, and how clients learn sources beyond the magnet; see
  [`open-problems/cross-deployment-transport.md`](open-problems/cross-deployment-transport.md).
- **Unvalidated on real devices:** the 89–91% offload was two simulators on
  one machine. Whether phones seed reliably over WebRTC behind real NAT, the
  real offload ratio, and the battery cost of Decision 0009's starting numbers
  are all measured by the real-device tiers, which haven't run. The only
  battery figures are pre-tortok operator reports for libtorrent clients:
  15–25% per seeding hour uncontrolled, 5–8% gated on battery above 50%, and
  2–3% seeding only the playing video. If the scroll-back window costs more
  than about 5% an hour, Decision 0009 itself names the fallback: seed only
  the playing video, in a superseding record.

## Decisions behind this

- [Decision 0001](decisions/0001-webtorrent-end-to-end.md) — torrent engine is WebTorrent, end to end.
- [Decision 0008](decisions/0008-seeder-storage-cdn.md) — seeder, storage, and CDN infrastructure (R2 origin, four layers).
- [Decision 0009](decisions/0009-client-seeding-policy.md) — Phase 2 client seeding scope and policy.
- [Decision 0018](decisions/0018-content-origin-mp4-webseeds.md) _(proposed)_ — one MP4 per video on R2 as the webseed; no origin seeder.
- [Decision 0014](decisions/0014-device-testing-strategy.md) — device testing strategy (three tiers).
- [Decision 0015](decisions/0015-tier3-p2p-testing-lambdatest.md) — tier-3 real-device P2P testing on LambdaTest/TestMu.
- [Decision 0016](decisions/0016-testing-strategy-where-each-kind-of-test-lives.md) — testing strategy: tier 1 as the primary regression gate, integration tests for new backend code, no legacy-backend backfill.
