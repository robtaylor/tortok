# Decision 0001: Torrent engine is WebTorrent, end to end

**Current architecture:** [P2P & torrent engine](../p2p-torrent.md)

**Status:** Accepted

**Context.** The current tree has two torrent engines: a stubbed libtorrent
C++ bridge (`TorTok/Services/Torrent/TorrentEngine.swift`, never implemented)
and a working WebTorrent bridge running in a hidden `WKWebView`
(`TorTok/Services/Torrent/WebTorrentBridge.swift` + `webtorrent-bridge.html`).
The backend seeder is also WebTorrent. The libtorrent path was aspirational
and never functioned.

**Decision.** Use WebTorrent exclusively across client and server. Delete the
libtorrent stubs. In the new client (see Decision 0004) WebTorrent will run in the
host JavaScript runtime directly — no `WKWebView` bridge, no
`AVAssetResourceLoaderDelegate` plumbing.

**Consequences.**
- One engine across client seeders, viewers, and the backend origin seeder.
- Peering is limited to WebTorrent-compatible peers (WebRTC transport). We
  cannot swarm with classic libtorrent peers over TCP/uTP.
- Mitigation: every video has an HTTP webseed fallback served from the
  backend so new videos can be streamed while the swarm warms up.
- ~1000 lines of Swift bridging code (`WebTorrentBridge.swift`,
  `P2PResourceLoader.swift`, parts of `VideoPlayer.swift`) are deleted, not
  rewritten, because WebTorrent in a JS runtime streams to `<video>` natively
  via MediaSource.

**Alternatives ruled out.**
- **libtorrent (C++ via iTorrent / Rasterbar).** Native swarm compatibility,
  but requires a C++ toolchain and platform-specific bridge per target. No
  viable browser story. Cost dominates benefit for our use case.
- **Pure HLS/DASH over a CDN.** Defeats the purpose of TorTok.
- **Hybrid libtorrent + WebTorrent.** Two engines, two bug surfaces. We would
  be the smallest project in the world trying to maintain both.

**Tuning parameters (starting defaults).**
- `httpDownloadProbability: 0.1` — probability the client fetches a piece
  from the HTTP webseed rather than a peer, even when peers are available.
  This is PeerTube's production default and keeps the webseed warm so it
  doesn't fall off Cloudflare edge caches; revisit once we have real P2P
  offload numbers in Phase 2.
- Client-side seeding policy (when and how much the Expo app seeds on
  behalf of other peers) is unresolved — see
  `docs/architecture/open-problems/seeding-policy.md`.
