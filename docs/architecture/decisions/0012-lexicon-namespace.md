# Decision 0012: Lexicon namespace governance

**Status:** Accepted — 2026-04-29

**Context.** Decision 0002 commits us to AT Protocol and references a
video-post Lexicon. Decision 0011 references `payout.destination` and
`payout.pool` Lexicons. Phase 3 is the first phase that actually
publishes records under our namespace, which forces a small cluster of
decisions:

1. Where do our schema files live, and how are they versioned?
2. What's our NSID? atproto's NSID convention is reverse-DNS-based and
   the first segment is the TLD of an authority domain. Earlier decision record
   drafts wrote `tortok.video.post` as a shorthand, which doesn't
   conform.
3. How do we relate to schemas owned by Bluesky (`app.bsky.*`)?
4. What happens if a formal Lexicon registry / governance process
   emerges later?

This decision is deliberately small — we are not deciding the registry or
the migration mechanism here. We are committing to a namespace, a
layout, and a stance on reuse.

**Decision.**

1. **Namespace.** TorTok's canonical domain is `tortok.app`, so NSIDs
   follow the strict reverse-DNS form rooted there. Records currently
   in scope: `app.tortok.video.post`, `app.tortok.payout.destination`
   (Decision 0011 Sub-problem A, ships in Phase 3 alongside this work),
   `app.tortok.payout.pool` (Decision 0011 Sub-problem B, deferred to V2).
   Future schemas extend `app.tortok.*` along domain segments
   (`app.tortok.video.*`, `app.tortok.payout.*`, etc.). This matches
   the convention used by `app.bsky.*`, `chat.bsky.*`, `com.atproto.*`,
   etc.

2. **Repo layout.** Schemas live in
   `lexicons/<segment>/<segment>/<segment>/<segment>.json`, mirroring
   the NSID. `app.tortok.video.post` is
   `lexicons/app/tortok/video/post.json` — the same convention used by
   `bluesky-social/atproto` for `app.bsky.*`. The repo is the source
   of truth; CI may publish them to a static URL later, but resolution
   at runtime does not depend on a hosted endpoint (atproto Lexicons
   are validated by code that already knows the schema).

3. **Reuse Bluesky lexicons for the social graph.** When follows and
   likes ship in a later phase, use `app.bsky.graph.follow` and
   `app.bsky.feed.like` (the latter's generic `strongRef` subject
   points at `app.tortok.video.post` records natively). We do not
   define `app.tortok.graph.*`. Confirmed in the 2026-04-29 Phase 3
   going-in answers.

4. **Reuse Bluesky shapes inside our records where they exist.**
   `app.tortok.video.post` uses the Bluesky-shaped `aspectRatio`
   (`{width: int, height: int}`, matching
   `app.bsky.embed.defs#aspectRatio`) so that Decision 0010's inbound bridge
   does not have to translate between shapes. Reuse is a per-field
   decision, not a blanket rule — we still own the schema; we copy
   shape only where interop matters.

5. **Versioning.** No version segment in the NSID. Schema-incompatible
   changes mint a new NSID (e.g., `app.tortok.video.postV2`).
   Schema-compatible additions go on the existing schema. Matches the
   atproto convention.

6. **Governance posture.** No formal cross-app Lexicon registry exists
   yet. We follow whatever process atproto formalizes if and when one
   lands. Until then, we treat the repo and this decision as the canonical
   source of `app.tortok.*` definitions.

**Consequences.**

- Decision 0002's coupling caveat (Lexicon namespace governance is unsettled)
  is now explicit, recorded, and bounded. We mitigated it by running
  our own AppView; this decision pins the rest.
- Reuse of `app.bsky.*` for the social graph and selective shape
  reuse for embed metadata is intentional cross-pollination, not
  accident. We benefit from Bluesky's existing graph; we accept that
  Bluesky owns those schemas and could change them. Lexicon stability
  is a stated Bluesky value, so the practical risk is small.
- We do not host a Lexicon resolution endpoint in v1. If atproto
  tooling ever requires one, we add static publishing to CI and the
  natural home is `https://tortok.app/.well-known/...`.
- A future canonical-domain switch (e.g., to `tortok.org`) is
  mechanical but not free: rename schema files, bump records to the
  new `$type` at write time, deprecation window in the AppView. Worth
  flagging during Phase 3 implementation so engineers do not bake the
  namespace into too many places.

**Alternatives ruled out.**

- **Use `app.bsky.feed.post` for video records.** Decision 0002 ruled this
  out: we want our own schema for the magnet URI, info hash, and HLS
  fallback. Bluesky's video embed is a different shape with different
  goals.
- **Wait for an atproto Lexicon registry before declaring our
  namespace.** No registry is on the roadmap. Waiting is indefinite.
- **Use a non-reverse-DNS NSID like `tortok.video.post`.** Tempting
  shorthand and what Decision 0002 originally drafted, but it conflicts
  with the atproto NSID spec (first segment is the TLD of the
  authority domain). Rejected — `tortok.app` is locked in, no reason
  to ship a non-conforming NSID.
- **Define `app.tortok.graph.*` for follows/likes.** Would fragment
  the social graph (TorTok follows would not be visible to Bluesky
  AppViews and vice versa). Going-in answer #2 from the Phase 3 plan
  rejected this in favour of reuse.
