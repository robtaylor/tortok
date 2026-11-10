# Decision 0008: Seeder, storage, and CDN infrastructure

**Current architecture:** [P2P & torrent engine](../p2p-torrent.md)

**Status:** Accepted. A revision of L1's stored format, L2 and L4 is proposed in [Decision 0018](0018-content-origin-mp4-webseeds.md).

**Context.** Decision 0005 extracts the WebTorrent seeder from the Express
process but does not specify where it runs, how origin storage is
hosted, or how users can contribute to the swarm. Cost, geographic
diversity, and community runnability are explicit goals: the
infrastructure must be cheap enough to self-fund, geographically
distributed enough to serve a global audience without embarrassing
latency, and runnable on the same software stack whether we deploy it
or a user does.

### The streaming model (the mental foundation for every decision below)

Every video is published simultaneously three ways:

1. **HLS playlist + segments** stored in origin storage (L1)
2. **Magnet link** referencing those same HLS files as a WebTorrent
3. **HTTP webseed URL** (BEP-19) embedded in the magnet, pointing back
   at the origin storage

When a client plays a video, WebTorrent fetches pieces **in parallel,
per piece**, from two sources:

- The WebRTC peer swarm (other clients currently seeding)
- The HTTP webseed (our origin storage, served via CDN)

There is no sequential CDN→P2P switchover. Peers are preferred when
they have a piece; the webseed fills any gap. A brand-new video with
zero peers plays entirely from the webseed and looks identical to
pure CDN streaming. As peers accumulate, the P2P offload ratio
increases automatically and origin egress declines — no code changes,
no cache tuning.

This means origin storage must hold the **full catalog**, not a
preview window. Origin egress is bounded above by pure-CDN cost and
below by (1 − P2P offload ratio) × total bytes viewed.

### Decision — four infrastructure layers

**L1 — Origin storage: Cloudflare R2 + Cloudflare CDN.**

All HLS playlists and segments live in R2. Cloudflare's network
(300+ PoPs) fronts R2 with free egress on the CF network. Storage
cost is $0.015/GB/month; egress is zero. R2 is S3-compatible so a
future migration to Bunny Storage, Backblaze B2, or Wasabi is a
config change rather than a rewrite.

The webseed URL in every magnet link points at the R2-backed
Cloudflare endpoint.

**L2 — Seeder compute: Fly.io, starting with one region.**

The standalone seeder service extracted in Phase 0b is packaged as a
Docker image and deployed to Fly.io. Initial deployment is **`lhr`
(London) only** — we start with Europe/UK where early users are, and
expand to `iad`, `fra`, `nrt` once traffic justifies it. Each region
runs one or more seeder instances with a persistent volume for the
local content cache. Content is pulled from R2 on first request and
cached locally on the Fly volume, so we don't duplicate the full
catalog into every region — only what that region's peers actually
ask for.

Fly's anycast routing means WebTorrent peers connect to the nearest
seeder without any client-side routing logic. Cost at initial scale:
roughly $5/month for a single region.

**L3 — Tracker infrastructure: our own WSS trackers, critical path.**

WebTorrent's peer discovery is entirely tracker-based — there is no
traditional DHT, just a WebRTC-over-WSS lookup against a tracker
list. Community trackers (`openwebtorrent.com`, `btorrent.xyz`,
`tracker.webtorrent.dev`) are a soft dependency that can vanish
without warning; when they go down, P2P peer discovery dies and the
app silently degrades to CDN-only streaming. That is a product-level
failure in an app whose value proposition is P2P.

We run our own `bittorrent-tracker` instances on Fly.io in two
regions (`iad`, `fra`) from v1. Client tracker list: our trackers
first, community trackers as fallback. Cost: ~$5/month.

**L4 — Community seeder contribution: Docker image in Phase 0.**

The standalone seeder from L2 is the same Docker image shipped to
users. A self-hosting guide covers: bare Docker, Unraid, Synology
DSM, TrueNAS SCALE, Umbrel, and Start9. Users running on these
platforms are exactly the population most likely to actually
contribute bandwidth, and the self-hosting ecosystems have
established conventions for one-click app installation.

Post-v1: a Tauri desktop app wraps the same seeder for
non-technical users who want to contribute from a laptop. v2: a
contributor-recognition system using the Decision 0007 labeler framework
to label seeders by their contribution level.

**Supporting: STUN/TURN relay for WebRTC NAT traversal.**

WebTorrent uses WebRTC data channels for peer-to-peer transfer, which
in turn needs STUN (for candidate discovery) and sometimes TURN (for
relayed traffic when both peers are behind symmetric NATs).
Empirically, roughly 70% of mobile users are behind a NAT that blocks
direct hole-punching, and 15–30% of WebRTC connections fall back to
TURN relay. At 1k DAU this is ~60 GB/month of relayed video bytes —
not free, and not optional.

**Decision.** Self-host `coturn` on a single Fly.io machine alongside
the L3 trackers. Public STUN servers (Google's `stun.l.google.com`)
are fine as the STUN-only fallback. Cost: ~$10/month. Managed
alternatives (Twilio, Xirsys) cost ~$24/month at 1k DAU and scale
linearly; we'll revisit if self-hosted relay becomes an operational
burden.

### Rough cost envelope

| Scale | L1 storage | L1 egress | L2 compute | L3 trackers | TURN relay | Monthly |
|-------|------------|-----------|------------|-------------|------------|---------|
| 1k DAU, 50% P2P offload | ~$1 | $0 | ~$15 | ~$5 | ~$10 | **~$31** |
| 10k DAU, 50% P2P offload | ~$10 | $0 | ~$40 | ~$5 | ~$25 | **~$80** |
| 100k DAU, 60% P2P offload | ~$100 | $0 | ~$200 | ~$15 | ~$150 | **~$465** |

Caveats: (a) assumes P2P offload actually works; degraded fallback
with 0% offload is roughly the same numbers because R2 egress is
free on CF network; (b) the L2 compute line is the biggest guess
because it depends on catalog warmth and cache hit rate.

### Consequences

- **Cost is bounded and predictable** at launch scale. R2's free
  egress is the single most important infrastructure decision for a
  video app; it removes the "viral video deletes the monthly budget"
  failure mode.
- **Geographic diversity comes for free** from Cloudflare's edge
  network (L1) and Fly.io's region set (L2, L3).
- **Community runnability is a v1 deliverable**, not a roadmap
  item. The same software runs on production and on a home server.
- **Vendor lock-in is low**: every layer has a documented
  alternative (Bunny for L1, Hetzner for L2/L3, bare Docker for L4).
- **Fly.io is a conscious reliability bet.** Fly has had publicized
  incidents in 2023-2024 and is "cool" more than "boring." We
  accept this for convenience and reserve the right to migrate L2
  and L3 to Hetzner VPSes if incidents justify it.

### Execution risks

- **WebTorrent on React Native's Hermes runtime.** If
  `react-native-webrtc` doesn't expose a WebRTC surface compatible
  with WebTorrent, P2P offload collapses to zero and we serve every
  byte from R2. Degraded UX + higher compute, but still a viable
  architecture thanks to R2's free egress. Spike in Phase 2.
- **P2P offload ratio in practice.** The 50% offload assumption in
  the cost envelope is a guess. We need real measurements during
  Phase 2 prototyping to validate or revise.
- **R2 reliability.** Cloudflare R2 had several visible incidents in
  2024-2025. It is generally reliable but not perfect. Consider a
  weekly backup to Backblaze B2 (~$5/month) once the catalog grows
  past a few hundred videos.

### Alternatives ruled out

- **AWS S3 / GCS / Azure Blob for L1.** Egress costs dominate
  at video scale. A single viral video can delete a month's budget.
- **Cloudflare Stream / Mux for L1+L2.** Excellent managed video
  services, but they hide the origin, which makes BEP-19 webseed
  fallback impossible. Rules them out for TorTok specifically.
- **Bunny CDN for L1.** Solid competitor; video-specialized features
  like per-video analytics. Starts with per-byte egress costs that
  R2 avoids. Documented as the migration path if R2 causes problems.
- **Hetzner VPSes for L2/L3.** Cheaper (~$15/month all-in) and
  simpler, but no anycast and no one-command multi-region deploy.
  Documented as the fallback if Fly.io causes problems.
- **Cloud Run for L2.** The whole reason we're extracting in Phase 0
  is that Cloud Run is stateless and the seeder needs persistent
  state. Unsuitable.
- **IPFS for content addressing.** Philosophically aligned but adds
  a second P2P protocol to the stack. BitTorrent already works;
  don't diversify in v1.
- **Pure P2P with no origin.** Unacceptable cold-start: new videos
  with no viewers have no peers to seed from.
