# Federation (atproto)

*Reference: the current design as it stands in the code. The why lives in the decision records linked from each section; the not-yet-built work is under [Implementation status](#implementation-status). Present tense means "true today". If a claim here is stale, the code moved and this doc didn't.*

tortok is an AT Protocol application ([Decision 0002](decisions/0002-atproto-federation.md)). A video post is a record in its author's own repo, on the PDS they already use. tortok's AppView indexes those records from the network and serves them as the feed. It also brings Bluesky's own video posts into that feed. This doc maps how the parts speak atproto. The mechanics of each part are in [backend](backend.md) and [client](client.md), and this doc links to them rather than repeating them.

## Identity

An account is a DID, either `did:plc` or `did:web` ([Decision 0003](decisions/0003-identity-dids.md)). tortok creates no DIDs and holds no keys: a user signs in with the atproto account they already have ([Decision 0019](decisions/0019-v1-uses-existing-pds-via-oauth.md), [auth-signup](auth-signup.md)).

The client and the AppView each resolve identity for themselves.

- The client resolves the handle a user types through `https://bsky.social`, to find the DID and PDS that OAuth needs (`tortok/lib/atproto/oauth.ts`).
- The AppView resolves an author's DID from its own sources, not from Bluesky's AppView (`backend/src/atproto/identity.ts`). The DID document comes from the PLC directory, or for `did:web` from the domain's `/.well-known/did.json`. It gives the PDS endpoint and the handle the account claims. The handle is kept only if it points back at the same DID, through its `_atproto` DNS TXT record or its `/.well-known/atproto-did` file. A handle that doesn't verify is served as `null`, and the client shows the display name instead.

The feed names every post by its AT-URI and every author by their DID.

## Lexicon

tortok's record types live under `app.tortok.*`, the reverse-DNS namespace of `tortok.app` ([Decision 0012](decisions/0012-lexicon-namespace.md)). One exists: `app.tortok.video.post`, defined in `lexicons/app/tortok/video/post.json`, with a TID record key. A record carries:

- `magnetUri` and `infoHash`, both required. They address the video's bytes, which are not in the repo ([p2p-torrent](p2p-torrent.md)).
- `durationMs` (up to 10 minutes) and `createdAt`, both required.
- `aspectRatio`, in the shape of Bluesky's `app.bsky.embed.defs#aspectRatio`.
- `caption`, up to 300 graphemes, and up to 20 `hashtags`.
- `thumbnailBlob`, the poster, a JPEG, PNG or WebP of at most 1 MB on the author's PDS.
- `torrentBlob`, the post's `.torrent` file, at most 1 MB ([Decision 0020](decisions/0020-torrent-metadata-as-pds-blob.md)).

The schema file in the repo is the only copy. Nothing publishes it to the network, and nothing resolves it at runtime. The AppView checks records with a hand-written validator (`backend/src/atproto/videoPost.ts`), and a test fails if the validator's required fields and limits drift from the schema file (`backend/src/__tests__/videoPost.test.ts`).

## Publishing

The app doesn't publish records. Its Record tab is a placeholder.

The records that exist come from `scripts/seed-fixtures.mjs` (`npm run seed:fixtures`). It writes the five test clips into the dev account's repo with an app-password session, and uploads each clip's poster and `.torrent` to the PDS as blobs. The e2e stack runs the same script against its own throwaway PDS ([client](client.md#testing)).

The namespace is public. Any atproto client can write an `app.tortok.video.post` record into its user's repo, and the AppView indexes every valid one it sees.

## AppView

The AppView reads the network, not one PDS ([Decision 0017](decisions/0017-appview-postgres-is-a-rebuildable-index.md)). It subscribes to Jetstream for `app.tortok.video.post` commits from every PDS on the relay, validates each record, resolves its author, and writes a row to `posts` keyed by AT-URI. On boot it re-lists the records of every account it knows from that account's PDS. The details are in [backend](backend.md#atproto-ingest).

Its Postgres is an index. Everything in it can be rebuilt from the network except the Jetstream cursors and the list of known accounts.

Blobs stay on the author's PDS. The AppView's blob route fetches a poster, avatar or `.torrent` from there, checks the bytes against the CID, and serves them as immutable ([backend](backend.md#videos-and-feed)).

A client picks its AppView by URL. A release build defaults to tortok's, `https://appview.tortok.app`, and a user can enter another in Profile ([client](client.md#api-client)). The app calls the AppView's HTTP API directly and without a session: the API is public and read-only, and requests don't go through the user's PDS.

## Bluesky bridge

The bridge is inbound only ([Decision 0010](decisions/0010-bluesky-video-bridge.md)). It indexes Bluesky's square and portrait video posts, `app.bsky.feed.post` records with a video embed, from a second Jetstream subscription. What it keeps and drops is [Decision 0023](decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md), how long it keeps a post is [Decision 0024](decisions/0024-the-bridge-keeps-only-the-posts-it-still-re-reads.md), and how it does both is in [backend](backend.md#bluesky-bridge).

Bridged posts live in `posts` beside native ones. The collection NSID in the row, and in the AT-URI the feed serves as `id`, tells them apart: `app.bsky.feed.post` or `app.tortok.video.post`. There is no separate table and no source column.

- A bridged post reaches the feed only after the engagement poller has checked it against Bluesky's AppView and it has met a threshold of likes, reposts or author followers.
- A post labelled NSFW, or by an author who opted out with the `!no-unauthenticated` profile label or `#nobridge`, is not indexed, and is deleted if the label or opt-out comes later.
- A bridged post is kept for 30 days, re-checked at least daily, and then deleted. A label or opt-out added at any time in between takes it out within a day or two.
- An author who opts back in is bridged again from their next video post. Their earlier posts don't come back.
- Every label the bridge sees is stored in `labels`, whatever happens to the post.
- The video plays from Bluesky's HLS playlist on `video.bsky.app`. tortok doesn't copy or re-host it, and it gets no P2P.
- The app marks a bridged post with a "via Bluesky" badge that opens the post on bsky.app (`tortok/app/(tabs)/index.tsx`).

Nothing flows the other way. tortok writes no `app.bsky.*` records, and the app offers no likes, replies or follows on any post. The badge is the way to the post on Bluesky.

## Outside services

tortok runs no relay, no PLC directory and no PDS. It depends on these, each behind a setting:

| Service | Used for | Setting |
|---|---|---|
| Bluesky's Jetstream, `jetstream2.us-east.bsky.network` | Both subscriptions: tortok's records and the bridge's video posts | `JETSTREAM_URL` |
| The PLC directory, `plc.directory` | `did:plc` documents | `PLC_DIRECTORY_URL` |
| Each author's PDS | Backfill, the profile record, blobs | from the DID document |
| `bsky.social` | Resolving a handle at sign-in | fixed in the client |
| Bluesky's AppView, `public.api.bsky.app` | The bridge's engagement, labels and profiles | `BRIDGE_APPVIEW_URL` |
| Bluesky's video service, `video.bsky.app` | Bridged posts' playlists and thumbnails | `BRIDGE_VIDEO_BASE` |

## Constraints

- The AppView accepts only `did:plc` and `did:web` DIDs.
- A record that fails the validator is not indexed, and an edit that makes a record invalid removes it from the index.
- There is one Jetstream subscriber per subscription. If it is down for longer than Jetstream's replay window, records posted in the gap by accounts the AppView doesn't yet know are missed ([backend](backend.md#deployment-and-configuration)).
- The feed is read-only. Phase 3 ships no likes or follows.

## Implementation status

**Implemented:**

| Part | Where |
|---|---|
| The `app.tortok.video.post` Lexicon | `lexicons/app/tortok/video/post.json` |
| Record validation, held to the Lexicon by a test | `backend/src/atproto/videoPost.ts`, `backend/src/__tests__/videoPost.test.ts` |
| Identity resolution with two-way handle verification | `backend/src/atproto/identity.ts` |
| Ingest of native records from Jetstream, with backfill | `backend/src/services/atprotoIngest.ts`, `backend/src/services/jetstream.ts` |
| The inbound Bluesky bridge | `backend/src/services/bskyBridge.ts` and the files [backend](backend.md#implementation-status) lists |
| Publishing the test clips as records | `scripts/seed-fixtures.mjs` |
| Sign-in with an existing atproto account | `tortok/lib/atproto/oauth.ts` ([auth-signup](auth-signup.md)) |
| Choosing an AppView by URL | `tortok/stores/appview.ts` |
| A throwaway PLC and PDS for end-to-end tests | `test-network/start.mjs` |

**Deferred:**

| Part | Gap | Tracking |
|---|---|---|
| Publishing from the app | The app writes no records; recording and upload aren't built. | [Phase 3 plan](../plans/phase-3-atproto.md), Unit 3 |
| Social graph | No follows or likes. They will be Bluesky's `app.bsky.graph.follow` and `app.bsky.feed.like` records (Decision 0012 item 3). | Later phase |
| Payout Lexicons | `app.tortok.payout.destination` and `app.tortok.payout.pool` (Decision 0012 item 1) aren't written. | [monetization](monetization.md) |
| AppView by service DID | The app takes an AppView URL. Naming one by its service DID and proxying through the PDS (Decision 0017 item 4) isn't built. | [Phase 3 plan](../plans/phase-3-atproto.md), decision 4 of Unit 2.5 |
| AppView discovery and self-hosting | No declaration records (Decision 0017 item 6) and no self-hosting guide (item 5). | Phase 4 or later |
| Labeler subscriptions | The bridge reads labels from `getPosts` and self-labels only. No labeler is subscribed to, and tortok runs none (Decisions 0013 and 0023). | [moderation](moderation.md) |
| Account events | Jetstream `account` events (takedown, deactivation) are ignored. | Phase 4 |
| `did:web` setup guide | Decision 0019 item 4 says tortok documents the DNS setup. No such guide exists. | None yet |
| Own PDS | tortok runs no PDS. | [`open-problems/own-pds.md`](open-problems/own-pds.md) |

## Decisions behind this

- [Decision 0002 — Federation protocol is AT Protocol](decisions/0002-atproto-federation.md)
- [Decision 0003 — Identity uses DIDs](decisions/0003-identity-dids.md)
- [Decision 0010 — Bridge Bluesky video posts into the feed](decisions/0010-bluesky-video-bridge.md)
- [Decision 0012 — Lexicon namespace governance](decisions/0012-lexicon-namespace.md)
- [Decision 0017 — The AppView's Postgres is a rebuildable index, one of many](decisions/0017-appview-postgres-is-a-rebuildable-index.md)
- [Decision 0019 — v1 uses each user's existing PDS through atproto OAuth](decisions/0019-v1-uses-existing-pds-via-oauth.md)
- [Decision 0020 — Video posts carry their torrent metadata as a PDS blob](decisions/0020-torrent-metadata-as-pds-blob.md)
- [Decision 0023 — What the v1 bridge indexes](decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md), based on the [labels spike](decisions/spikes/bluesky-labels-on-bridged-video-posts.md)
- [Decision 0024 — The bridge keeps only the posts it still re-reads](decisions/0024-the-bridge-keeps-only-the-posts-it-still-re-reads.md)
