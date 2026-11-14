# Decision 0022 — Clients learn extra video sources from their AppView

**Status:** Accepted (2026-11-14). Built in Phase 3 Unit 2.5B (2026-11-11) and in production. Resolves the Phase 3 requirement of the open problem [`cross-deployment-transport.md`](../open-problems/cross-deployment-transport.md) (how clients learn extra sources). Choosing mirrors or seeders, the content key layout and piece size stay open there.

**Current architecture:** [P2P & torrent engine](../p2p-torrent.md).

**TL;DR.** In the context of `app.tortok.video.post` records whose magnets are signed and can't change, facing deployments that will want to add mirrors, seeders or their own trackers after a post is published, we chose to have each AppView list extra webseeds and trackers for every feed item, merged by the client into WebTorrent alongside the magnet's own, to make every future source a deploy-time change, accepting that a client only learns the sources its own AppView knows about.

## Context

What the code did on 2026-11-11: the client plays each video through WebTorrent from the feed item's magnet and, when present, its `.torrent` URL. It uses only the trackers and webseeds those name. The feed is still served from the legacy `videos` table; Phase 3 Unit 2.5B moves it to the ingested `posts` table.

The open problem `cross-deployment-transport.md` set one requirement that Phase 3 had to meet: clients learn extra sources at runtime, because the first real records (Unit 3) fix their magnets for good. Without it, adding a mirror, a seeder or a second deployment's tracker would mean changing the client, and every record published before then would stay tied to the origin and tracker it named. It left open where the extra sources come from: the AppView, published records, or both.

Two facts made the AppView the cheap place:

- WebTorrent 2.8.5's `add(torrent, { urlList, announce })` concatenates both options onto the torrent's own webseeds and trackers, deduplicating webseeds (`lib/torrent.js`). No client-side merging code or WebTorrent change is needed.
- Every byte is checked against the torrent's piece hashes, so an extra source can serve slow or missing data but never wrong data. A client doesn't need to trust its AppView's sources.

## Decision

1. **Each feed item carries `sources: { webseeds: string[], trackers: string[] }`** next to its magnet. The client passes them to WebTorrent's `add()` as `urlList` and `announce`, on top of the magnet's and the `.torrent`'s own.
2. **The AppView always lists its own trackers** (`TRACKER_URLS`), so its clients find each other even when a post's magnet names another deployment's tracker.
3. **It lists a webseed only where it knows a copy exists.** In 2026-11 that's none beyond the magnet's own: tortok has no mirrors yet, so `webseeds` is empty in production. When mirrors or other copies exist, the AppView adds their URLs here, with no client or Lexicon change.
4. **Records stay as published.** The Lexicon gains no sources field.

## Alternatives considered

- **Record-published sources** (a Lexicon field listing mirrors, updated by rewriting records) — rejected because every new mirror would need the author to rewrite their records, and it adds a Lexicon field nobody would fill yet. A field can still be added later as an optional extra; AppView-supplied sources don't preclude it.
- **Both now** — rejected for the same reason: the record half is speculative until someone runs a mirror.
- **Magnet only** — rejected because it fails the Phase 3 requirement: each later source would need a client release, and old records would stay tied to their origin.

## Consequences

- Mirrors, seeders and extra trackers become changes to an AppView's configuration. Old posts benefit as soon as a source is added.
- A client learns only what its own AppView lists. A user of a third-party AppView gets that AppView's sources, not tortok's.
- Every feed item grows by two short arrays.
- The feed response changes shape in 2.5B anyway, so `sources` arrives with that change and costs no extra client release.

## Walk-back options

- **If authors need mirrors independent of any AppView**, add an optional sources field to the Lexicon as well, and have AppViews merge it into `sources`.
- **If listing trackers per item proves wasteful**, move them to a per-AppView endpoint the client fetches once; the per-item field stays for webseeds.

## Links

- [`open-problems/cross-deployment-transport.md`](../open-problems/cross-deployment-transport.md) — the requirement this meets, and the questions it leaves open.
- [Decision 0018](0018-content-origin-mp4-webseeds.md) — the single-MP4 webseed origin these sources add to.
- [Decision 0020](0020-torrent-metadata-as-pds-blob.md) — the `.torrent` blob that lets a post start from webseeds with no peer.
