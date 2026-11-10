# Decision 0005: Backend stays Node + TypeScript; evolves into an AppView

**Current architecture:** [Backend / AppView](../backend.md)

**Status:** Accepted (partial). Own-PDS hosting and the own-PDS firehose source revised by [Decision 0017](0017-appview-postgres-is-a-rebuildable-index.md) (2026-11-09); the AppView and seeder-worker direction is unchanged.

**Context.** The existing backend (`backend/`) is Node/Express/Postgres
running on Cloud Run, with a WebTorrent seeder glued into the same process.
The review flagged that the seeder-in-Cloud-Run is architecturally wrong
(stateless container + stateful torrent engine), and the `/auth/me`, refresh
token, and like-counter bugs need fixing regardless.

**Decision.** Keep Node/TypeScript. Evolve the backend in two directions:

1. **AppView.** Subscribe to the AT Protocol firehose (via a relay),
   filter for `app.tortok.video.post` records, index them in Postgres, and
   serve feed endpoints to the client. Use `@atproto/api` and
   `@atproto/sync` for the heavy lifting.
2. **Seeder worker.** Move the WebTorrent seeder out of the Cloud Run
   container into a separate long-lived worker (Cloud Run jobs, a VM,
   or a persistent container platform). The AppView talks to the seeder
   over an internal API, not in-process.

**v1: host our own PDS.** We run a TorTok-branded PDS from day 1. This
reverses my earlier instinct to defer PDS hosting. The reason is UX: the
only way to keep atproto plumbing invisible to users (Decision 0007) is to
own the signup surface ourselves. Users do not pick a PDS, never see
"atproto" or "Bluesky", and never need to know what a DID is. TorTok
looks and feels like a normal short-form video app.

**PDS implementation.** Fork the reference PDS from
`bluesky-social/atproto`. It is Node/TypeScript, which matches our
stack. Strip what we don't need (e.g., Bluesky-specific lexicons we're
not using) rather than reinvent. A ground-up build-from-spec is on the
table only if the fork becomes more painful than the rewrite.

**AppView in v1** subscribes primarily to our own PDS's repo events —
we control the source, so we don't need to drink from the wider atproto
firehose on day 1. Third-party firehose subscription becomes a post-v1
feature if and when we want to cross-federate with other PDSes.

**Consequences.**
- Reuses existing backend code and deployment pipeline.
- Forces us to fix the seeder-in-Cloud-Run bug as part of this
  migration, which is correct.
- We take on a new stateful service: the PDS. This means running
  persistent storage, operating custodial key material, handling
  password-reset flows, and becoming a compliance target for user data.
  Non-trivial, and should not be minimized.
- In exchange, we own the UX end-to-end. That is the whole point.
- If cross-federation with other atproto apps later becomes a priority,
  we extend the AppView to subscribe to third-party firehoses. Our
  records are already valid atproto records, so they're visible to
  anyone who wants to index them.
