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

Being built in Phase 3 (atproto OAuth login, `app.tortok.video.post` publishing,
legacy backend retirement). See the [Phase 3 plan](../plans/phase-3-atproto.md)
for unit-level status; this doc is backfilled with verified current state as part
of the adoption follow-up.

## Decisions behind this

- [Decision 0002 — Federation protocol is AT Protocol](decisions/0002-atproto-federation.md)
- [Decision 0003 — Identity uses DIDs](decisions/0003-identity-dids.md)
- [Decision 0010 — Bridge Bluesky video posts into the feed](decisions/0010-bluesky-video-bridge.md)
- [Decision 0012 — Lexicon namespace governance](decisions/0012-lexicon-namespace.md)
