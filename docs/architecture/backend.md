# Backend / AppView

*Reference doc — **stub.** The full present-tense write-up of the backend (HTTP
routes, auth middleware, Postgres schema, the seeder service, and its evolution
into an atproto AppView) is pending the post-migration area-doc backfill, which
checks every claim against the code. The decision record below is authoritative
for the design.*

This area covers the Node + TypeScript backend (`backend/src/`) and its planned
evolution into an AppView that subscribes to PDSes, indexes `app.tortok.video.*`
records, and serves the feed. The origin WebTorrent seeder currently lives here
and is documented in [p2p-torrent](p2p-torrent.md).

## Implementation status

The Express backend is live (auth, videos, seeder wiring). The AppView ingest and
feed-generation path is Phase 3/4 work; the seeder is slated to extract into a
standalone deployable (see [p2p-torrent](p2p-torrent.md) implementation status).
Verified current-state write-up is part of the adoption follow-up.

## Decisions behind this

- [Decision 0005 — Backend stays Node + TypeScript; evolves into an AppView](decisions/0005-backend-node-appview.md)
