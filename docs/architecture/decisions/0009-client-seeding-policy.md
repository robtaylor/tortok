# Decision 0009: Phase 2 client seeding scope and policy

**Current architecture:** [P2P & torrent engine](../p2p-torrent.md)

**Status:** Accepted (2026-04-14). The 2026-04-19 "Drop HLS, webseed-only" amendment below is restated in [Decision 0018](0018-content-origin-mp4-webseeds.md) (proposed).

**Context.** Phase 2 integrates WebTorrent into the Expo client and
measures P2P offload for the first time. Two things have to be
decided before the spike starts: (a) what platforms the spike has
to work on to count as a pass, and (b) what client seeding
behaviour ships with the prototype. These were listed in
`open-problems/seeding-policy.md` (sub-problem B) and as execution
risks #1 (WebTorrent on Hermes) and #3 (offload ratio) above.

A third related question — what to do if WebTorrent on Hermes
turns out to be unviable — is deferred until we have spike results,
not decided here.

**Decision.**

1. **Spike scope: simulators only.** Phase 2 passes when WebTorrent
   runs in the Expo client on iOS simulator, Android emulator, and
   Expo web, with measurable P2P traffic between two clients in the
   same local swarm. Real-device validation is deferred — simulators
   are sufficient to answer "does WebTorrent run on Hermes and
   produce measurable offload," which is the risk we're buying down.
   Real-device testing moves into the phase where battery and
   carrier-network behaviour actually matter.

2. **Client seeding policy: scroll-back window (policy 2 from
   `seeding-policy.md`), Wi-Fi only on mobile.** The prototype
   seeds the last 5 watched videos for 30 minutes post-view, seeds
   only while the app is in foreground, stops seeding below 30%
   battery, and **does not seed over cellular** — only when the
   device reports a Wi-Fi connection. Desktop/web clients default
   to the more aggressive battery-gated policy 3 described in the
   open-problem file (no network-type gate, since they're assumed
   wired/Wi-Fi).

   The Wi-Fi gate is a preemptive cost control, not a battery
   concession. WebRTC on mobile requires TURN relay for any peer
   behind symmetric NAT, which is common on carrier networks.
   TURN relay bytes cost us money on our coturn box (deployed Phase
   0b); if 20–40% of cellular peers end up relayed, the Decision 0008
   "~50% P2P offload" envelope collapses because the swarm's
   "free" bytes become paid relay bytes. Gating seeding to Wi-Fi
   keeps relay load bounded to home-router NAT (mostly cone NAT,
   direct-peer connectable) where it belongs.

   The starting numbers (N=5, M=30, battery=30%) are guesses
   calibrated against the 2024-era libtorrent battery table in
   `seeding-policy.md`. Validate during the spike: if policy 2
   costs more than ~5%/hour in practice, degrade to policy 1
   (on-demand only) and record it as a new decision record.

3. **Fallback if WebTorrent on Hermes fails: defer.** We have
   candidate fallbacks (desktop/web-only P2P with mobile as pure
   consumers; drop P2P entirely and serve all bytes from R2 +
   regional seeders). Neither is cheap to commit to blind. If the
   spike shows Hermes WebRTC is unusable for seeding, we pick a
   fallback then based on measured cost impact, not now based on
   guesses.

**Consequences.**
- Phase 2 has a concrete pass/fail bar: two simulator peers swap
  bytes through WebTorrent on Hermes, offload ratio measured.
- The prototype has a defensible default seeding policy users can
  live with on mobile.
- Decision 0008's "~50% P2P offload" cost-envelope number stays
  provisional until Phase 2 produces a measurement; nothing in
  this decision commits us to hitting that number.
- `open-problems/seeding-policy.md` sub-problem B is now resolved
  — the open-problem file can be trimmed to server-side content
  (or deleted if server-side is also considered resolved).
- The fallback question is left explicitly deferred rather than
  silently ignored; a future decision record picks a direction if the spike
  forces one.

**Alternatives ruled out.**
- **Spike on real devices from the start.** More thorough, but
  doubles the setup cost (test devices, fastlane, USB debugging)
  for a risk (Hermes WebRTC doesn't work at all) that the
  simulator catches just as well. Revisit once simulators are
  green.
- **Policy 1 (on-demand only) as the default.** Lowest battery
  cost but also lowest P2P contribution — would likely invalidate
  Decision 0008's offload thesis before we even measure it. Keep as the
  fallback if policy 2 is measurably too expensive.
- **Policy 3 (battery-gated aggressive) on mobile.** Better for
  the swarm, but the 15–25%/hour battery cost in the "seed while
  open" mode will drive users away faster than we can apologise.
  Policy 3 is the desktop/web default, not the mobile default.
- **Allowing mobile seeding over cellular.** Maximises theoretical
  swarm contribution, but symmetric NAT on cellular networks
  forces bidirectional TURN relay. That shifts the bytes from
  "free peer" to "paid coturn," undoing the cost model. Block
  cellular seeding at the client, lift if future measurements
  show carrier-NAT behaviour has changed.
- **Decide the WebTorrent-fails fallback now.** Tempting for
  completeness, but we'd be choosing between two bad options
  without the measurement that tells us which is less bad.
  Deliberate "decide later" is cheaper than a premature decision record we
  then supersede.

**Spike implementation notes (Hermes + web quirks, 2026-04-14).**
All three simulator targets (iOS, Android emulator, Expo web in
headless Chrome) are now green: peers handshake over WebRTC
datachannels and exchange BitTorrent protocol traffic end to end.
On iOS and Android the spike measured `Downloaded > 0` against the
local seeder; on web the same magnet reaches the seeder, completes
the metadata exchange, and the browser uploads ~200 KB of bitfield
/ wire-protocol traffic to the four other peers (seeder + 2 iOS +
Android). The web client doesn't pull file pieces because no
consumer (`torrent.files[0].appendTo()` etc.) is wired up in the
spike — that's a feed-integration concern, not a transport-layer
one. Getting there surfaced eight Hermes compat gaps and three
additional web-only ones. They are not architectural decisions —
they live here rather than in a README because anyone re-deriving
the stack (future RN upgrade, new engine, web framework swap) will
hit the same list.

Runtime globals — `tortok/lib/webtorrent/polyfills.native.ts`
on Hermes, `polyfills.web.ts` on web (Metro picks the platform
extension automatically):

1. **`globalThis.crypto` with `getRandomValues`.** `uint8-util`
   reads `self.crypto.getRandomValues` at module-init time; Hermes
   has no `crypto` global. Install `react-native-quick-crypto` as
   `globalThis.crypto` before any webtorrent code runs. Metro's
   `crypto`→quick-crypto alias does **not** cover this — the alias
   only rewrites `import/require 'crypto'`, not dynamic reads off
   the global scope.
2. **`process.browser = true`.** `bittorrent-discovery` and
   `bittorrent-tracker` branch on `process.browser` to skip
   Node-only code paths (binding TCP ports, etc.). Hermes isn't a
   browser but behaviourally matches one — no TCP/UDP sockets
   available — so set it truthy.
3. **RTC globals on `globalThis`.** `webrtc-polyfill`'s browser
   entry reads `RTCPeerConnection`, `RTCSessionDescription`,
   `RTCIceCandidate`, `MediaStream`, `MediaStreamTrack`,
   `RTCRtpReceiver`, `RTCRtpSender` off the global scope. Populate
   them from `react-native-webrtc` before webtorrent loads.

Module-resolution — `tortok/metro.config.js`:

4. **Node-core shims via `extraNodeModules`.** crypto →
   react-native-quick-crypto, stream → readable-stream, rest
   (buffer, events, process, path, util, url, os, querystring,
   assert) → their respective browserify packages. net, dns, tls,
   fs, http, https are stubbed to an empty module since the
   WebRTC-only transport never hits them on mobile.
5. **`unstable_enablePackageExports` + `unstable_conditionNames =
   ['require', 'browser']`.** Forces Metro to pick `webrtc-polyfill`'s
   `browser` conditional-export entry, which reads globals from
   globalThis, instead of its Node entry which imports
   `node:stream`.

ESM/CJS interop — `tortok/app/spike.tsx` (and any future
consumer):

6. **Unwrap `require('webtorrent').default`.** webtorrent is
   `"type": "module"` with `export default class WebTorrent`. Metro's
   ESM→CJS interop returns `{ default: WebTorrent, __esModule: true }`,
   so `require('webtorrent')` is not callable as a constructor.

WebCrypto / WebRTC shim patches — in `polyfills.ts`:

7. **`RTCPeerConnection.prototype.getStats` arity patch.**
   `@thaunknown/simple-peer` branches on `pc.getStats.length` to
   choose Promise vs. callback style. `react-native-webrtc`
   declares `getStats(selector?)` — arity 1 — so simple-peer takes
   the callback branch and passes its callback as the `selector`
   argument, producing "Invalid selector: could not find matching
   sender / receiver" on every stats poll. Wrap the prototype to
   arity 0; the inner call still passes no selector and returns
   the full Map.
8. **Case-insensitive `subtle.digest`.** QuickCrypto's SubtleCrypto
   does **strict uppercase** matching against `SUPPORTED_ALGORITHMS`
   (`'SHA-1'`), but `uint8-util.hash` and `bittorrent-protocol`
   pass `'sha-1'` lowercase. BitTorrent piece hashing fails with
   `NotSupportedError: Unrecognized algorithm name: sha-1` the
   moment the first piece arrives. Wrap `digest` to uppercase the
   algorithm name before delegating (the WebCrypto spec explicitly
   says algorithm names are case-insensitive — this is a QuickCrypto
   spec-compliance gap we compensate for, not a webtorrent bug).

Web-only quirks (resolved 2026-04-14):

9. **Pin `webrtc-polyfill` to its `browser.js` entry on every
   platform via `resolveRequest`.** Its conditional-export `node`
   entry pulls in `lib/Blob.js`, which uses top-level await. The
   Expo static-renderer SSG path runs Node-target bundling whose
   minifier (SWC) cannot parse TLA, so SSG bundling fails before
   it ever reaches our lazy `import()`. The browser entry is a
   thin shim that just reads `RTCPeerConnection` etc. off
   `globalThis` — exactly what we want, since the polyfill module
   populates them on Hermes and the browser already has them.
10. **Per-platform `crypto` resolution.** `extraNodeModules.crypto =
    react-native-quick-crypto` is the right answer on Hermes but
    blows up on web because rn-quick-crypto pulls in JSI bindings
    that don't exist there. Move the alias into `resolveRequest`
    and only apply it when `platform !== 'web'`. On web, webtorrent's
    own `"crypto": false` browser-field stub now wins, and uint8-util
    reads the browser's native `crypto` global.
11. **Inject a `process` shim into `globalThis` *before* the bundle
    script tag executes — `app/+html.tsx`.** Metro's web bundle
    preamble does `var process = globalThis.process || {}`, which
    captures the empty object at script-load time. Modules like
    `end-of-stream` then read bare `process.nextTick` from that
    captured local, so installing `globalThis.process` later from
    `polyfills.web.ts` is too late — the local var has already
    snapshotted. The Expo Router custom-HTML hook
    (`app/+html.tsx`) lets us stick a tiny inline `<script>` in
    `<head>` that populates `globalThis.process` (with a real
    `nextTick`, an `env`, `browser=true`, etc.) before the entry
    bundle ever runs. On Hermes this isn't needed because the RN
    runtime supplies a `process` global before the bundle loads.

Polyfill split: `polyfills.native.ts` carries the full Hermes
compat layer (rn-webrtc imports, getStats arity patch, subtle.digest
case wrapper, QuickCrypto install, Buffer/process/nextTick install).
`polyfills.web.ts` is a much smaller shim that just installs Buffer
and re-asserts `process.browser = true` — browsers ship native
crypto, RTCPeerConnection, etc., so the heavy lifting falls away.
Metro picks the right file via its platform-extension resolution
(`.native.ts` / `.web.ts`); TypeScript needs a `polyfills.d.ts`
declaration to see the platform-less import path.

The simulator-only pass/fail from decision (1) above is the bar
being chased here, not real-device support. When Phase 2 extends
to real iOS/Android hardware, expect another round of quirks (most
likely around TURN credentials, NetInfo-driven Wi-Fi gating, and
NAT traversal across cellular networks — neither simulators nor
the local-network emulator setup exercise those paths).

**Deferred optimizations (identified during Unit 2 integration,
2026-04-17).**

The production integration confirmed that P2P playback works
end-to-end on iOS simulator: WebTorrent init → tracker → WebRTC
handshake → TcpSocket HTTP bridge → expo-video plays via bridge URL.
HLS fallback also works cleanly when P2P takes too long. Three
optimizations are deferred until after three-platform validation:

1. **Inline .torrent metadata.** Magnet-only resolution takes ~6s
   because WebTorrent must do a WebRTC handshake just to fetch the
   torrent info dict from the seeder. Serving the .torrent file
   (or its info dict as base64) in the feed API response would let
   `client.add(torrentBuffer)` resolve instantly — no tracker or
   peer connection needed for metadata. Requires: `torrent_file_url`
   column in the DB, .torrent files hosted on R2/CDN, client fetches
   the buffer and passes it to `client.add()`.

2. **Wider pre-fetch window.** Currently `useP2PUrl` fires for
   `isActive || isAdjacent` (±1 video). With instant metadata
   resolution, widen torrent pre-resolution to ±2 or ±3 while
   keeping player creation at ±1. Adjacent torrents resolve before
   the user scrolls to them — the `managed` map fast path returns
   the cached bridge URL immediately.

3. ~~**P2P-primary source selection.**~~ Implemented and then
   superseded — see amendment below.

Combined effect: first video in a session may start via HLS (cold
torrent), but every subsequent scroll uses a pre-resolved P2P bridge
URL with zero delay. The HLS fallback becomes a rare cold-start
path rather than the default.

**Amendment (2026-04-19): Drop HLS, webseed-only.**

Optimizations #1 and #3 are now implemented. With inline .torrent
metadata resolving in <1s, the 3-second HLS fallback timer fires
rarely. More importantly, HLS viewers are "leeches" — the native
player fetches segments directly from R2 via its own HTTP stack,
bypassing the WebTorrent swarm entirely. Those bytes are never
re-shared to peers.

Webseed (BEP-19) solves this: the torrent metadata includes an
`urlList` pointing at the raw MP4 on R2. When no peers are
available, WebTorrent fetches pieces from that HTTP origin — but
downloaded pieces are re-shared to the swarm like any other peer
data. Every viewer participates in P2P regardless of how they got
their first bytes.

Changes:
- `hlsURL` removed from Video type, API responses, and validation
- `hls_url` DB column kept nullable (vestigial, no migration needed)
- `lockedUrl` state and `P2P_TIMEOUT_MS` timer removed from client
- `urlList` added to torrent creation in both production seeder and
  test-content seeder
- Source selection simplified: `videoUrl = p2pUrl` directly

Requires raw MP4 uploaded to R2 at the webseed URL. The existing
HLS segments in R2 remain for the standalone seeder service (which
downloads them for its own torrent seeding).
