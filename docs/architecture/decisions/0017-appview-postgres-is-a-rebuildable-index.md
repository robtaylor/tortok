# Decision 0017 — The AppView's Postgres is a rebuildable index, one of many

**Status:** Proposed.

**Current architecture:** [Backend](../backend.md).

**TL;DR.** In the context of moving tortok onto AT Protocol, where users' records live in their own repos, facing a backend whose Postgres is still the only copy of accounts, videos and likes, we chose to make the AppView's Postgres a derived index that anyone can rebuild and anyone can run, with a short named list of data only one operator holds. Clients choose their AppView at runtime. This keeps federation real (no tortok server is the source of truth) at the cost of building AppView selection into the client and keeping a separate backup for the small amount of data that can't be rebuilt.

## Context

Today (2026-11-09) the backend's Postgres is the source of truth for everything: `users` with password hashes, `videos`, `likes`, `follows` and `views`. Nothing exists outside it. The Phase 3 plan says "Postgres pivots, doesn't retire" ([`phase-3-atproto.md`](../../plans/phase-3-atproto.md), framing point 4): `users` goes, `videos` becomes a read-side index of `app.tortok.video.post` records, and `views` and `hashtags` stay. That was a planning note. No decision recorded it.

In AT Protocol the source of truth is the record in the author's repo, signed by their DID and hosted on their PDS ([Decision 0002](0002-atproto-federation.md)). An AppView reads the network's event stream, indexes the records it cares about and serves views of them. Several AppViews can index the same records independently. They never talk to each other.

Three things in the repository disagreed with that model:

- [Decision 0005](0005-backend-node-appview.md) said tortok would host its own PDS and that the v1 AppView would subscribe "primarily to our own PDS's repo events". The 2026-04-29 amendments to Decisions 0003, 0006 and 0007 moved v1 onto users' existing PDSes (mostly `bsky.social`), and [`own-pds.md`](../open-problems/own-pds.md) parked an own PDS. So the AppView has to read the wider network, which 0005's body still doesn't say.
- The client fixes its backend at build time. `tortok/lib/api.ts` reads `EXPO_PUBLIC_API_URL` and otherwise uses `https://tortok-api.fly.dev`. A user of the store build can't choose another AppView.
- The backend serves `/.well-known/tortok` (`backend/src/index.ts`), a per-server "instance" description with `registrationOpen` and `federationEnabled: false`. That is the server-federation model AT Protocol replaces.

Hosting, as checked on 2026-11-09: `tortok-db` is an unmanaged Fly Postgres app (`flyio/postgres-flex:17.2`, one 256 MB machine in `lhr`) on a 1 GB encrypted volume. Fly takes daily volume snapshots and keeps 5. There is no logical dump and no copy outside Fly. The schema is `backend/src/db/schema.sql`, append-only and idempotent, applied on every boot.

## Decision

1. **Postgres is an index, never the source of truth.** Everything a user creates (posts, likes, follows, profile data) lives as records in their own repo. The AppView's tables for those are derived from the network and can be rebuilt from it. This includes bridged Bluesky posts ([Decision 0010](0010-bluesky-video-bridge.md)).
2. **Data only one AppView holds is a short, named list.** Each entry is a point of control, held deliberately:
   - view counts, until [`view-counting.md`](../open-problems/view-counting.md) resolves (possibly into signed records);
   - the moderation decisions this AppView applies (labels it subscribes to, records it refuses to index);
   - rate-limit and spam state;
   - ingest state: the stream cursor and the list of known accounts, which a rebuild needs.

   Adding to this list needs a stated reason in the change that adds it.
3. **The AppView reads the network, not one PDS.** It consumes a relay's event stream (or Jetstream) filtered to tortok's collections plus the bridge's video posts. This revises the PDS and firehose parts of Decision 0005. An own PDS stays parked per `own-pds.md`; if it returns, its storage is user data under a separate decision, not this index.
4. **Clients choose their AppView at runtime.** The default is tortok's. A user can set another AppView by its service DID, and requests go through the user's PDS with the `atproto-proxy` header where the PDS supports it, as Bluesky clients do. This lands with Phase 3's Phase C. Before atproto login there is no account to carry to another AppView.
5. **Anyone can run the AppView.** The repository carries a self-hosting guide for it, alongside the seeder guide of Decision 0008's L4.
6. **AppViews are discovered through records.** An operator publishes a declaration record in their own repo naming the AppView's service DID, its moderation choices and its region. Every AppView indexes these like any other record, so the in-app picker can't be gated by one operator. This is deferred to Phase 4 or later, and the record's schema is its own Lexicon work under [Decision 0012](0012-lexicon-namespace.md). `/.well-known/tortok` is retired with the legacy backend in Phase C, and Decision 0016's smoke check stops asserting it then.
7. **Hosting stays on unmanaged Fly Postgres for now, with backups matched to the data.** The rebuildable tables rely on the daily volume snapshots. The operator-local tables in item 2 also get a daily logical dump (`pg_dump` of those tables) stored outside Fly, in a private R2 bucket. That starts before Phase 4, when view counts first matter.
8. **Schema changes stay in append-only `schema.sql` applied at boot,** rehearsed against a restored production backup per Decision 0016's commitment 10. This is revisited at the first destructive change once real users exist.

## Alternatives considered

- **Keep Postgres as the source of truth, as the legacy backend does** — rejected because tortok would then be the single point of control that AT Protocol is meant to remove. Leaving tortok would mean losing your posts.
- **Fly Managed Postgres** — rejected for now because it adds cost and a migration for 1 GB of data that is mostly rebuildable. Revisit at public release, when uptime starts to matter more than cost.
- **No backups beyond snapshots, since the index is rebuildable** — rejected because the operator-local data in item 2 can't be rebuilt. A full rebuild also needs the known-account list, because relays keep only a short replay window.
- **Per-server discovery through `/.well-known/tortok`** — rejected because it belongs to the instance model, where accounts belong to a server. In AT Protocol the account belongs to the user, and services are found by DID.
- **A curated AppView list shipped in the app** — rejected because it makes tortok the gatekeeper. It stays useful as the default and as a fallback.

## Consequences

- Losing tortok's database costs rebuild time, not user data. Users of a failed AppView switch AppView and keep their posts and likes.
- The known-account list and the operator-local tables need their own backup and restore path, which doesn't exist yet.
- The client needs an AppView setting and request routing through the PDS, built in Phase C alongside atproto login.
- Every item added to the operator-local list is a trust cost that other AppViews and users can see. View counts are the largest one.
- When this decision is accepted, Decision 0005's Status line gets a pointer saying its PDS and firehose parts were revised here, as 0014's does for 0015.

## Walk-back options

- **If a full rebuild proves too slow or too costly** — back up the derived tables too (a full logical dump), and treat rebuild as disaster recovery only.
- **If an own PDS returns** (`own-pds.md` triggers) — its storage is the source of truth for those users and gets its own decision; this index is unchanged.
- **If no one else runs an AppView** — keep discovery (item 6) deferred. Items 1 to 4 still hold, because they're what lets users leave.

## Links

- [Decision 0002](0002-atproto-federation.md) — AT Protocol; client → PDS → firehose → AppView.
- [Decision 0005](0005-backend-node-appview.md) — the backend becomes an AppView; its PDS and firehose parts are revised here.
- [Decision 0010](0010-bluesky-video-bridge.md) — bridged posts are indexed alongside native ones.
- [Decision 0012](0012-lexicon-namespace.md) — namespace for the declaration record.
- [Decision 0016](0016-testing-strategy-where-each-kind-of-test-lives.md) — schema rehearsal and the smoke check.
- [`open-problems/cross-deployment-transport.md`](../open-problems/cross-deployment-transport.md) — where video bytes come from when several AppViews serve the same posts.
- [`open-problems/own-pds.md`](../open-problems/own-pds.md), [`open-problems/view-counting.md`](../open-problems/view-counting.md).
