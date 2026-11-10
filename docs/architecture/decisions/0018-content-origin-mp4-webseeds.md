# Decision 0018 — Content origin is one MP4 per video on R2, served as a webseed; no origin seeder

**Status:** Proposed. Would revise layers L1 (stored format), L2 and L4 of [Decision 0008](0008-seeder-storage-cdn.md), and replace the 2026-04-19 "Drop HLS, webseed-only" amendment written into [Decision 0009](0009-client-seeding-policy.md).

**Current architecture:** [P2P & torrent engine](../p2p-torrent.md).

**TL;DR.** In the context of delivering tortok video over WebTorrent, facing an origin seeder that the webseed made redundant and a community-seeder plan nobody had built, we chose a single MP4 per video on R2, reached as a BEP-19 webseed, with no always-on origin peer and no community seeder in v1, to achieve the simplest origin that still lets every viewer join the swarm, accepting that a video nobody is watching lives only in R2.

## Context

What the code did on 2026-11-10: native clients play each video through WebTorrent, with the torrent's webseed pointing at a single MP4 under `content.tortok.net`, the R2 bucket's custom domain. Web clients play the same MP4 over plain HTTP. The backend still runs an in-process `SeederService`, and `backend/fly.toml` keeps its machine always on (`auto_stop_machines = "off"`) so that seeder stays alive.

Decision 0008 set four layers before any of this was built:

- **L1:** HLS playlists and segments in R2, with the magnet referencing those files and a webseed pointing back at R2.
- **L2:** a standalone seeder image on Fly.io, starting in `lhr`.
- **L3:** our own WSS trackers.
- **L4:** the L2 image shipped to users, with a self-hosting guide for Docker, Unraid, Synology, TrueNAS, Umbrel and Start9.

The design moved away from three of those without a record saying so:

- On 2026-04-19 the client dropped HLS. HLS viewers fetched segments through the native player and never re-shared them, while webseed bytes enter the swarm like any other piece. That change was written into Decision 0009's body as an amendment, which the docs discipline no longer allows.
- The same day, commit `a5d5ddf` deleted the standalone seeder's code. The `tortok-seeder` Fly app kept running until 2026-11-04.
- The [webseed-only spike](spikes/webseed-only-origin.md) (resolved 2026-11-04) showed that a torrent whose only source is the R2 webseed downloads completely and correctly, with no seeder, tracker, DHT or LSD. It left open whether tortok still wanted an always-on origin peer, calling that "a separate decision". This is that decision.
- No L4 image or self-hosting guide was ever written.

R2 egress is free (Decision 0008), so an origin peer saves request costs at most, not bandwidth. Phones and browsers reach peers only over WebRTC, so a server-side peer must be reachable over UDP. On Fly that means `fly-global-services` and probably a dedicated IPv4, which tortok had never tested.

On 2026-11-09 the user chose, in the Phase 3 Unit 2.5 rescope, to remove `SeederService` and to keep [Decision 0010](0010-bluesky-video-bridge.md)'s plan of playing bridged Bluesky posts from Bluesky's own HLS rather than re-hosting them.

## Decision

1. **One MP4 per video in R2.** Each tortok video is stored as a single MP4 file, served from `content.tortok.net` behind Cloudflare's cache. tortok encodes no HLS ladder for its own content. Bridged Bluesky posts still play from Bluesky's HLS (Decision 0010); that is playback of someone else's origin, not a tortok format.
2. **The MP4 is the torrent's webseed.** Every torrent carries the R2 URL in its `urlList` (BEP-19): the file URL for a single-file torrent, the parent directory for a multi-file one. A video with no peers plays entirely from the webseed.
3. **No always-on origin peer.** The standalone seeder (L2) is not rebuilt, and the backend's `SeederService` is removed in Phase 3 Unit 2.5C. The swarm is the viewers seeding under Decision 0009's policy.
4. **No community seeder in v1.** No seeder image or self-hosting guide ships (L4). Whether tortok later runs seeders, accepts volunteer seeders or adds HTTP mirrors is the [cross-deployment transport open problem](../open-problems/cross-deployment-transport.md).
5. **Unchanged:** R2 with Cloudflare as the origin and CDN (L1's provider choice), our own WSS trackers (L3), and the self-hosted TURN relay.

## Alternatives considered

- **Keep `SeederService` as an always-on origin peer** — rejected because the spike showed it adds nothing to delivery, egress is free, and it pins the backend machine on. Its only remaining use, a warm peer for offload measurement, doesn't justify a process in the API server.
- **Rebuild the standalone Fly seeder (L2)** — rejected for v1 because it needs UDP reachability on Fly, which is unproven and needs a spike, to beat a webseed that already serves everything at no egress cost.
- **Keep HLS alongside the webseed** — rejected because HLS viewers bypass the swarm, which is the reason the client dropped it in April.
- **Ship the community seeder (L4) now** — rejected because a volunteer re-hosting arbitrary video is exposed to whatever it contains. It needs labeler-driven drop lists (Decision 0013) and opt-in scope first, which the transport open problem tracks.

## Consequences

- One stored file per video, with no transcoding to a segment ladder and no seeder fleet to run.
- P2P offload comes only from viewers. A cold video is served entirely by R2, so durability is R2's durability, and the transport open problem's mirror and seeder candidates are the way to change that.
- Once `SeederService` is gone, nothing in the backend needs the machine always on, so `auto_stop_machines` can be revisited.
- The self-hosted-seeder story from Decision 0008 L4 is out of v1, along with its draw for the self-hosting community.
- Piece size is now a webseed cost: every piece is an HTTP range request. It's tracked in the transport open problem, because changing it changes the infohash.

## Walk-back options

- **If R2 request costs or request latency hurt playback,** add HTTP mirrors or larger pieces through the transport open problem. Neither needs an origin peer.
- **If offload is too low for thin swarms,** spike a WebRTC seeder on Fly (candidate 2 in the transport open problem) and supersede item 3.
- **If the moderation tooling lands and volunteers ask to seed,** revisit item 4 through the transport open problem.

## Links

- [`spikes/webseed-only-origin.md`](spikes/webseed-only-origin.md) — webseed alone delivers complete content.
- [Decision 0008](0008-seeder-storage-cdn.md) — the four infrastructure layers this revises.
- [Decision 0009](0009-client-seeding-policy.md) — the client seeding policy, and the April amendment this replaces.
- [Decision 0010](0010-bluesky-video-bridge.md) — bridged posts keep Bluesky's HLS.
- [`open-problems/cross-deployment-transport.md`](../open-problems/cross-deployment-transport.md) — mirrors, seeders and runtime sources.
