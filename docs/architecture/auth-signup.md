# Auth & signup

*Reference doc — **stub.** The full present-tense write-up of authentication and
signup (atproto OAuth against users' existing PDSes, session handling, spam
prevention) is pending the post-migration area-doc backfill, which checks every
claim against the code. The decision record below is authoritative for the
design.*

This area covers how users sign in and how tortok resists spam: v1 uses atproto
OAuth against the user's existing PDS (typically `bsky.social`), retiring the
legacy email/password backend in Phase 3.

## Implementation status

Sign-in is atproto OAuth, built in Phase 3 Unit 2 (2026-05-02) and described in
[client](client.md#authentication). The legacy email/password routes and the
`users` table still exist on the backend; Phase 3 Unit 2.5C retires them (see the
[Phase 3 plan](../plans/phase-3-atproto.md)). This doc is written in full after
that cutover.

## Decisions behind this

- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md)
