# TorTok — Working instructions for Claude

This file tells future Claude sessions where the authoritative
architecture decisions live, where the unresolved questions live,
what phase of development we're in, and when to stop and check in
with the user rather than pushing forward on your own.

## Read these first

Before doing any non-trivial work, read (in this order):

1. **`docs/architecture/decisions.md`** — The source of truth for
   every architectural decision. Nine ADRs + a Phase 0 punch list
   appendix + an "Unresolved design problems" section + an
   "Execution risks" section, each with resolve-by phases. If a
   decision is recorded here, it is the decision; do not re-litigate
   it without a reason.
2. **`docs/architecture/open-problems/`** — Things we have
   deliberately *not* decided yet. Four files (`moderation.md`,
   `view-counting.md`, `seeding-policy.md`, `monetization.md`), each
   with a `Must resolve by:` header stating which phase forces the
   decision.
3. **Appendix A in `decisions.md`** — The Phase 0 punch list: bugs
   (B1–B6), security footguns (S1–S4), libtorrent cleanup, doc
   cleanup. This is the concrete work Phase 0a consumes.

These four locations are the whole map. If you find yourself looking
elsewhere for architectural intent, something is missing from the
map — tell the user so we can fix it.

## Phases of development

From ADR-006. Phases 0a, 0b, 1, 2, and 5 are **complete** (Phase 5
was executed early since the project was never released — Swift
codebase deleted 2026-04-14). Phase 2 closed out 2026-04-29 with a
two-sim P2P test measuring 89–91% offload. We are entering **Phase 3**.

| Phase | Name | What it delivers | Blocks |
|-------|------|------------------|--------|
| **0a** | Clean house | Fix B1–B6, address S1–S4, delete libtorrent stubs, commit WebTorrent seeder wiring with B4 fixed, clean docs | — |
| **0b** | Extract seeder infra | Standalone seeder Docker image, Fly.io deploy (L2), own trackers (L3), R2 content origin (L1), self-hosting guide (L4) | seeding-policy.md (server side) |
| **1** | Expo skeleton | Expo app logs in against existing backend, vertical feed with react-native-video, feature parity with Swift prototype minus P2P | — |
| **2** | Cross-platform P2P | WebTorrent integrated in Expo client, tested on iOS / Android / web simulators, P2P offload measured, Hermes WebRTC validated | ~~seeding-policy.md (client side)~~ resolved in ADR-009; execution risks #1 and #3 |
| **3** | atproto integration | atproto OAuth login against user's existing PDS (typically bsky.social), `tortok.video.post` Lexicon live, client publishes via `@atproto/api`, legacy email/password backend retired | moderation.md; own-pds.md (parked, not blocking) |
| **4** | AppView cutover | Own AppView subscribes to own PDS, indexes records, feed endpoint moves off legacy backend | view-counting.md (if ranking on views); open Q #4 |
| **5** | Retire Swift | Swift codebase deleted (done early 2026-04-14) | — |

**How to use this table.** Before starting a unit of work, identify
which phase it belongs to. Before *finishing* a phase, check whether
any open-problem file is listed under the **Blocks** column — if so,
those are forced decisions, and the next phase should not start
until they are resolved in a new ADR.

## When to stop and ask the user

Most changes don't need a checkpoint. These do:

1. **Before starting any phase listed above.** Even Phase 0a. Confirm
   scope with the user — phases drift, and the user may have
   reprioritized. One-line "starting Phase 0a, scope is Appendix A
   items 1–6 plus the libtorrent delete, anything else?" is enough.
2. **When an open problem in `open-problems/` becomes blocking.** If
   the work in front of you can't proceed without resolving
   `moderation.md`, `view-counting.md`, `seeding-policy.md`, or
   `monetization.md` — **stop and tell the user**. Do not pick a
   policy silently. Offer the candidate options from the open-problem
   file and let the user pick. The resolution becomes a new ADR.
3. **When you would contradict an existing ADR.** If a task seems to
   require undoing a decision (e.g., "just use libtorrent for this
   one thing"), stop. ADRs are reversible but only deliberately.
   Raise the conflict; the user decides whether to amend the ADR or
   re-scope the task.
4. **Before committing uncommitted architectural changes.** The
   `backend/src/services/seeder.ts` work and the PATCH endpoint in
   `videos.ts` are examples of in-flight architectural changes that
   need review before landing. Any new work of that shape gets the
   same treatment.
5. **Before touching a file listed in Appendix A's "files to
   delete".** Those files are scheduled for deletion in Phase 0a.
   Editing them is wasted work; confirm with the user that the file
   is still live.

## When *not* to stop

- Routine bug fixes inside an already-scoped phase
- Refactors contained within a single module
- Doc updates that reflect decisions already made
- Adding tests, fixing types, addressing lint

## Keeping the map in sync

When you make an architectural decision or learn something that
changes one:

- **New decision** → add an ADR to `decisions.md`. Number it
  sequentially. Include Status, Context, Decision, Consequences,
  Alternatives ruled out.
- **Open problem resolved** → write the ADR, then *delete* the file
  in `open-problems/` (don't leave a stale stub). Update the Open
  questions list in `decisions.md` to mark it resolved.
- **New open problem** → add a file in `open-problems/` with the
  standard header (Status, Must resolve by, Blocks, Related ADRs)
  and add a pointer in the Open questions section of `decisions.md`.
- **Phase complete** → update ADR-006's phase status and this
  CLAUDE.md's "currently entering" line.

## The decisions doc is not frozen

If you find a real reason to revisit a decision, say so. "ADR-004
assumed X; we now know Y; here's what changes" is a valid move. The
rule is that changes are deliberate and written down, not silent.
