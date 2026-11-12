# Federation (atproto)

*Reference doc — **stub.** The full present-tense write-up of tortok's atproto
federation (identity, Lexicon, the AppView's publish/ingest paths, the Bluesky
video bridge) is pending the post-migration area-doc backfill, which checks every
claim against the code. Until then, the decision records below are authoritative
for the design, and the [Phase 3 plan](../plans/phase-3-atproto.md) tracks what
is being built now.*

This area covers how tortok speaks AT Protocol: DID-based identity, the
`app.tortok.video.*` Lexicon namespace, publishing records to users' existing
PDSes, the AppView that indexes them, and the inbound Bluesky-video bridge.

## Implementation status

- **Built:** the `app.tortok.video.post` Lexicon
  (`lexicons/app/tortok/video/post.json`); atproto OAuth login in the client
  ([client](client.md#authentication)); AppView ingest of
  `app.tortok.video.post` records into `posts`
  ([backend](backend.md#atproto-ingest)); the feed reading `posts`; and
  `scripts/seed-fixtures.mjs`, which publishes the test clips as records
  from the dev account.
- **Not built:** publishing from the app (Unit 3), and the Bluesky bridge
  (Unit 2.5D), whose indexing rules are Decision 0023. See the
  [Phase 3 plan](../plans/phase-3-atproto.md). This doc is written in full after
  Unit 2.5.

## Decisions behind this

- [Decision 0002 — Federation protocol is AT Protocol](decisions/0002-atproto-federation.md)
- [Decision 0003 — Identity uses DIDs](decisions/0003-identity-dids.md)
- [Decision 0019 — v1 uses each user's existing PDS through atproto OAuth](decisions/0019-v1-uses-existing-pds-via-oauth.md)
- [Decision 0010 — Bridge Bluesky video posts into the feed](decisions/0010-bluesky-video-bridge.md)
- [Decision 0023 — What the v1 bridge indexes](decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md): drops NSFW and opted-out posts and stores every label; based on the [labels spike](decisions/spikes/bluesky-labels-on-bridged-video-posts.md)
- [Decision 0012 — Lexicon namespace governance](decisions/0012-lexicon-namespace.md)
