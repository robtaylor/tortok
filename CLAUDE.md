# TorTok — Working instructions for Claude

This file tells future Claude sessions where the authoritative
architecture decisions live, where the unresolved questions live,
what phase of development we're in, and when to stop and check in
with the user rather than pushing forward on your own.

## Read these first

Before doing any non-trivial work, read (in this order):

1. **`docs/architecture/decisions.md`** — Index of all ADRs.
   Each ADR lives as its own file at `docs/architecture/adr/NNNN-*.md`.
   The index also collects "Unresolved design problems",
   "Execution risks", "Deferred decisions", and Appendix A. If a
   decision is recorded under `adr/`, it is the decision; do not
   re-litigate without a reason.
2. **`docs/architecture/open-problems/`** — Things we have
   deliberately *not* decided yet. Each file has a `Must resolve by:`
   header stating which phase forces the decision.
3. **`docs/plans/<phase>.md`** — The active phase plan with units,
   status annotations, and exit criteria. Currently
   `docs/plans/phase-3-atproto.md`.
4. **`docs/handoffs/`** — In-flight working memory (zero or one
   file). See `docs/handoff-discipline.md` for the rules.

These four locations are the whole map. If you find yourself looking
elsewhere for architectural intent, something is missing from the
map — tell the user so we can fix it.

## Handoffs

This project treats handoffs as ephemeral working memory, not
historical record. When you write one, follow
`docs/handoff-discipline.md` — markdown at
`docs/handoffs/<topic>-handoff.md`, sibling to (not inside)
`docs/plans/`. At resolution, fold the content into ADRs / plan docs
/ open-problems / code comments, then delete the handoff file.
Exactly one handoff exists at a time; resolved ones are removed,
not archived. The `git log -- docs/handoffs/` history is the audit
trail.

Skill activations for `create_handoff` / `resume_handoff` from
external Claude Code toolkits will sometimes default to YAML under
`thoughts/shared/handoffs/` with database indexing — that doesn't
apply here. Override and follow the project convention.

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
| **3** | atproto integration | atproto OAuth login against user's existing PDS (typically bsky.social), `app.tortok.video.post` Lexicon live, client publishes via `@atproto/api`, legacy email/password backend retired | ~~moderation.md~~ resolved in ADR-013 (launch criteria gate signup-beyond-team); own-pds.md (parked, not blocking) |
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
   `view-counting.md`, `seeding-policy.md`, or `monetization.md` —
   **stop and tell the user**. Do not pick a policy silently. Offer
   the candidate options from the open-problem file and let the user
   pick. The resolution becomes a new ADR.
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

- **New decision** → add a new file at
  `docs/architecture/adr/NNNN-slug.md` (number sequentially after the
  highest existing). Include Status, Context, Decision, Consequences,
  Alternatives ruled out. Add a row to the ADR table in
  `decisions.md`.
- **Amend an existing ADR** → edit that ADR's file directly with a
  dated Amendment block. Update the Status line in both the ADR and
  the index row in `decisions.md`.
- **Supersede an ADR** → write a new ADR with `Supersedes: ADR-NNN`
  in the Status line. Mark the old ADR's Status as `Superseded by
  ADR-MMM`.
- **Open problem resolved** → write the ADR (per above), then
  *delete* the file in `open-problems/` (don't leave a stale stub).
  Update the "Unresolved design problems" section in `decisions.md`
  to mark it resolved.
- **New open problem** → add a file in `open-problems/` with the
  standard header (Status, Must resolve by, Blocks, Related ADRs)
  and add a bullet in the "Unresolved design problems" section of
  `decisions.md`.
- **Phase complete** → update ADR-006's phase status, this CLAUDE.md's
  "currently entering" line, and the active plan in
  `docs/plans/<phase>.md`.

## ADRs are not frozen

If you find a real reason to revisit a decision, say so. "ADR-004
assumed X; we now know Y; here's what changes" is a valid move. The
rule is that changes are deliberate and written down (as Amendments
or new superseding ADRs), not silent.
