# Decision 0020 — Video posts carry their torrent metadata as a PDS blob

**Status:** Accepted (partial) (2026-11-10). The Lexicon, the fixture records and the AppView's index carry `torrentBlob`; clients don't use it until Phase 3 Unit 2.5B.

**Current architecture:** [P2P & torrent engine](../p2p-torrent.md).

**TL;DR.** In the context of `app.tortok.video.post` records, facing magnets that can't start on a phone once no origin seeder exists, we chose to add an optional `torrentBlob` field holding the `.torrent` file as a blob on the author's PDS, and to drop the unused `hlsFallbackUrl`, to achieve posts that play cold from any AppView, accepting one extra blob per post and an image-style fetch before playback.

## Context

What the code did on 2026-11-10: the legacy feed returns a `torrent_file_url` for each video, pointing at a `.torrent` file on R2. When it's present, the client fetches it and passes the bytes to `client.add()` (`tortok/lib/webtorrent/client.ts`), so the torrent starts with no peer. Without it, the client adds the magnet and waits for some peer to send the torrent's metadata. The backend's `SeederService` is always online as that peer.

A magnet carries only the infohash. Before downloading, a client needs the info dictionary: the file list, piece size and piece hashes. That comes from a `.torrent` file or from a peer, through the `ut_metadata` extension. A BEP-19 webseed serves file bytes only, never metadata. The [webseed-only spike](spikes/webseed-only-origin.md) passed the `.torrent` file directly (`leech.add(torrentFile)` in `scripts/webseed-only-test.mjs`), which is why it worked with no peers.

The `app.tortok.video.post` Lexicon had no field for torrent metadata or a link to it. Phase 3 Unit 2.5C removes `SeederService` ([Decision 0018](0018-content-origin-mp4-webseeds.md), proposed). After that, a magnet-only post with no other viewer online couldn't start on a phone. Web clients were unaffected, because they play the webseed URL directly.

The Lexicon also had an optional `hlsFallbackUrl`, left from the Swift-era HLS design. Nothing produced it after the client dropped HLS in April 2026, and the [cross-deployment transport open problem](../open-problems/cross-deployment-transport.md) asked for it to be dropped or redefined before real records were published. The only record carrying it was a 2026-04-30 smoke test in the `tortok-dev.bsky.social` repo, which Phase 3 Unit 2.5A's fixture script deletes.

[Decision 0012](0012-lexicon-namespace.md) item 5 requires a new NSID for a schema-incompatible change. atproto records may carry fields their schema doesn't define, so removing an optional field and adding a new optional one leave every existing record valid.

## Decision

1. **Add `torrentBlob` to `app.tortok.video.post`.** It's an optional blob holding the post's `.torrent` file, with MIME type `application/x-bittorrent` and a 1 MB size limit. tortok's own publishing path (the fixture script now, Unit 3 later) always sets it.
2. **Clients verify it.** A client computes the infohash of the blob's info dictionary and uses the blob only if it matches the record's `infoHash`. A wrong blob is ignored, and the client falls back to the magnet.
3. **AppViews serve it like a thumbnail.** tortok's AppView stores the blob's CID and hands clients a URL on its content-addressed blob route, cached by Cloudflare (Phase 3 Unit 2.5B). A post without `torrentBlob` is still indexed and falls back to the magnet.
4. **Remove `hlsFallbackUrl`.** Records that still carry it stay valid; nothing reads it.
5. **Both changes stay on the existing NSID,** because neither invalidates an existing record (Decision 0012, item 5).

## Alternatives considered

- **A `torrentUrl` field pointing at R2** — rejected because every post would depend for ever on whoever hosts that URL, which is the permanence problem the transport open problem describes for webseeds. A blob lives with the post on the author's PDS.
- **Derive the `.torrent` URL from the webseed by convention** (`<webseed>.torrent`) — rejected because the rule is implicit, breaks if the origin's layout changes, and still depends on the origin staying up.
- **Keep an always-on origin peer to answer `ut_metadata`** — rejected because Decision 0018 removes the origin seeder, and a peer for metadata alone would bring back the UDP-on-Fly problem.
- **Make `torrentBlob` required** — rejected because Decision 0012 would then need a new NSID, and a post without it can still play from peers or on web.

## Consequences

- A post plays cold on a phone from any AppView, with no peer, as long as the author's PDS or an AppView's blob cache serves the blob.
- The info dictionary can't be tampered with in transit, since its hash is the infohash the record already carries.
- Each post stores one more blob on the author's PDS, about 4 KB for a 3 MB clip at 16 KB pieces, growing with the piece count.
- Playback starts with one small HTTP fetch, as it does today with `torrent_file_url`.
- The Lexicon now has a field that only a torrent-aware client uses; other atproto apps ignore it.

## Walk-back options

- **If PDSes refuse or rewrite `application/x-bittorrent` blobs,** accept `application/octet-stream` in the Lexicon as well and rely on the infohash check.
- **If piece sizes grow large enough that the blob exceeds 1 MB,** raise the limit with a compatible Lexicon change.

## Links

- [`spikes/webseed-only-origin.md`](spikes/webseed-only-origin.md) — webseed-only delivery needs the `.torrent` file.
- [Decision 0002](0002-atproto-federation.md) and [Decision 0012](0012-lexicon-namespace.md) — the Lexicon and its versioning rule.
- [Decision 0018](0018-content-origin-mp4-webseeds.md) — removing the origin seeder.
- [`open-problems/cross-deployment-transport.md`](../open-problems/cross-deployment-transport.md) — `hlsFallbackUrl`, piece size and runtime sources.
