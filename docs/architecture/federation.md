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
  ([client](client.md#authentication)); and `scripts/atproto-smoke-test.mjs`,
  which round-trips one record against `bsky.social` with an app password.
- **Not built:** AppView ingest and the `posts` table (Phase 3 Unit 2.5A),
  publishing from the app (Unit 3), and the Bluesky bridge (Unit 2.5D). See the
  [Phase 3 plan](../plans/phase-3-atproto.md). This doc is written in full after
  Unit 2.5.

## Decisions behind this

- [Decision 0002 — Federation protocol is AT Protocol](decisions/0002-atproto-federation.md)
- [Decision 0003 — Identity uses DIDs](decisions/0003-identity-dids.md)
- [Decision 0010 — Bridge Bluesky video posts into the feed](decisions/0010-bluesky-video-bridge.md)
- [Decision 0012 — Lexicon namespace governance](decisions/0012-lexicon-namespace.md)
