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

Phase 1 shipped against the legacy email/password backend; Phase 3 moves signin
to atproto OAuth and retires the `users` table (see the
[Phase 3 plan](../plans/phase-3-atproto.md)). Verified current-state write-up is
part of the adoption follow-up.

## Decisions behind this

- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md)
