# TorTok — Working instructions for Claude

This file tells future Claude sessions where the current architecture
lives, where the decisions behind it live, where the unresolved
questions live, what phase of development we're in, and when to stop
and check in with the user rather than pushing forward on your own.

## Docs discipline

This project follows the [Claude Project
Discipline](https://robtaylor.github.io/claude-project-discipline/):
five kinds of document, each with one home and one lifecycle, plus one
tortok-specific extension (`open-problems/`).

| Kind | Lives in | Lifetime | Answers |
|---|---|---|---|
| **Architecture reference** | `docs/architecture/<area>.md` | Living; edited in place as the code moves | *What* does the code do now? |
| **Decision** | `docs/architecture/decisions/NNNN-*.md` | Forever; immutable; superseded ones move to `decisions/archive/` | *Why* did we choose this? |
| **Spike** | `docs/architecture/decisions/spikes/<topic>.md` | Forever, marked Resolved | *Did this idea work?* |
| **Plan** | `docs/plans/<topic>.md` | Updated as work lands; finished ones move to `plans/archive/` | *What's next, in what order?* |
| **Handoff** | `docs/handoffs/<topic>-handoff.md` | Ephemeral; folded into the others, then deleted | *What's in flight right now?* |
| **Open problem** *(tortok extension)* | `docs/architecture/open-problems/<name>.md` | Until the forcing phase decides it; then becomes a decision and is deleted | *What must we decide, by which phase?* |

The load-bearing rule: **information has exactly one home, and the
handoff is the only doc that gets deleted.** Everything that survives a
session migrates from the handoff into an area doc / decision / spike /
plan / open-problem / `CHANGELOG.md` *before* the handoff is removed.

## Read these first

Before doing any non-trivial work, read (in this order):

1. **`docs/architecture/README.md`** — the architecture map: each area →
   its current-state reference doc → the decisions behind it. **Start
   here.** (Some area docs are stubs pending a verified backfill; the
   decisions remain authoritative for their design until then.)
2. **`docs/architecture/decisions/README.md`** — the decision index and
   conventions. Decisions live at `decisions/NNNN-*.md` and are
   immutable past-tense records of *why*. If a choice is recorded here,
   it is the decision; do not re-litigate without a reason.
3. **`docs/architecture/open-problems/`** — tortok extension: things we
   have deliberately *not* decided yet, each with a `Must resolve by:`
   header naming the phase that forces it. Index at
   `open-problems/README.md`.
4. **`docs/plans/<phase>.md`** — the active phase plan with units,
   status, and exit criteria. Currently `docs/plans/phase-3-atproto.md`;
   finished plans are in `docs/plans/archive/`.
5. **`docs/handoffs/`** — in-flight working memory (about one file per
   active thread). See `docs/handoff-discipline.md` for the rules.

If you find architectural intent living somewhere other than these,
the map is missing something — tell the user so we can fix it.

**Tooling.** `docs/scripts/doctool.py` (stdlib, run with `uv run`):
`lint` checks links, the decision index, archive placement, forward-links,
spike/plan statuses, and handoff count — **run it before committing doc
changes**; `archive <file.md>` moves a finished plan or superseded
decision to `archive/` and repoints every reference (never move these by
hand); `new decision|spike|plan|handoff|area "<title>"` scaffolds a new doc.

## Where things go

| If you're about to write… | It belongs in… |
|---|---|
| "X does Y" (present tense, true today) | the area doc in `docs/architecture/` |
| "We chose X over Y because Z" | a new decision record (past tense) |
| "X is decided but not built yet" | the area doc's `## Implementation status`, plus a plan |
| "Validate assumption A before accepting Decision NNNN" | a new spike, time-boxed |
| "We must decide X, forced by phase N; here are the candidates" | an `open-problems/<name>.md` file (tortok extension) |
| "What's in flight on thread T and what's next" | `docs/handoffs/<t>-handoff.md` |
| "What shipped in this version" | `CHANGELOG.md` `[Unreleased]` |

## Decisions are immutable

A decision record is written in past tense, as the state at decision
time, and its body is **never edited after acceptance**. Only the
`**Status:**` line and the `**Current architecture:**` forward-link
change. When the *code* moves, edit the area doc. When a *decision*
changes, write a new record that supersedes it (or revises one aspect of
it — see Decision 0015 revising the tier-3 vendor choice of Decision
0014) and move any fully-superseded record to `decisions/archive/` with
`doctool.py archive`. **No dated `## Amendment` blocks.** A Status line
is a claim about the code — verify it against the implementation before
setting it.

## Handoffs

This project treats handoffs as ephemeral working memory, not
historical record. When you write one, follow
`docs/handoff-discipline.md` — markdown at
`docs/handoffs/<topic>-handoff.md`, sibling to (not inside)
`docs/plans/`. At resolution, fold the content into decision records /
area docs / plans / open-problems / code comments, then delete the
handoff file. Resolved handoffs are removed, not archived; the
`git log -- docs/handoffs/` history is the audit trail.

Skill activations for `create_handoff` / `resume_handoff` from external
Claude Code toolkits will sometimes default to YAML under
`thoughts/shared/handoffs/` with database indexing — that doesn't apply
here. Override and follow the project convention.

## Phases of development

From Decision 0006. Phases 0a, 0b, 1, 2, and 5 are **complete** (Phase 5
was executed early since the project was never released — Swift codebase
deleted 2026-04-14). Phase 2 closed out 2026-04-29 with a two-sim P2P
test measuring 89–91% offload. We are in **Phase 3**.

| Phase | Name | What it delivers | Blocks |
|-------|------|------------------|--------|
| **0a** | Clean house | Fix B1–B6, address S1–S4, delete libtorrent stubs, commit WebTorrent seeder wiring with B4 fixed, clean docs | — |
| **0b** | Extract seeder infra | Own trackers (L3) and R2 content origin (L1) delivered. The standalone seeder (L2) was deployed and then destroyed on 2026-11-04 after the webseed-only spike; no self-hosting guide (L4) exists | seeding-policy.md (server side) |
| **1** | Expo skeleton | Expo app logs in against existing backend, vertical feed with `expo-video`, feature parity with Swift prototype minus P2P | — |
| **2** | Cross-platform P2P | WebTorrent integrated in Expo client, tested on iOS / Android / web simulators, P2P offload measured, Hermes WebRTC validated | ~~seeding-policy.md (client side)~~ resolved in Decision 0009; execution risks #1 and #3 (see the [Phase-2 spike](docs/architecture/decisions/spikes/phase-2-p2p-offload.md)) |
| **3** | atproto integration | atproto OAuth login against user's existing PDS (typically bsky.social), `app.tortok.video.post` Lexicon live, client publishes via `@atproto/api`, legacy email/password backend retired | ~~moderation.md~~ resolved in Decision 0013 (launch criteria gate signup-beyond-team); cross-deployment-transport.md (runtime video sources must ship before Unit 3 publishes real records); own-pds.md (parked, not blocking) |
| **4** | AppView cutover | AppView at scale: ingest hardening, view counting, feed ranking. The ingest itself (relay/Jetstream, Decision 0017) and the feed's move off the legacy backend land early, in Phase 3 Unit 2.5 | view-counting.md (if ranking on views) |
| **5** | Retire Swift | Swift codebase deleted (done early 2026-04-14) | — |

The Phase-0 punch list that drove phase 0a is archived at
[`docs/plans/archive/phase-0-punch-list.md`](docs/plans/archive/phase-0-punch-list.md).

**How to use this table.** Before starting a unit of work, identify
which phase it belongs to. Before *finishing* a phase, check whether any
open-problem is listed under the **Blocks** column — if so, those are
forced decisions, and the next phase should not start until they are
resolved in a new decision record.

## When to stop and ask the user

Most changes don't need a checkpoint. These do:

1. **Before starting a phase.** Confirm scope with the user — phases
   drift, and the user may have reprioritized. A one-line "starting
   Phase 4, scope is the AppView ingest + feed cutover, anything else?"
   is enough.
2. **When an open problem in `open-problems/` becomes blocking.** If the
   work in front of you can't proceed without resolving
   `view-counting.md`, `cross-deployment-transport.md`, `seeding-policy.md`, or `monetization.md` —
   **stop and tell the user**. Do not pick a policy silently. Offer the
   candidate options from the open-problem file and let the user pick.
   The resolution becomes a new decision record.
3. **When you would contradict an existing decision.** If a task seems
   to require undoing a decision (e.g., "just use libtorrent for this
   one thing"), stop. Decisions are reversible but only deliberately —
   via a superseding record, not a silent edit. Raise the conflict; the
   user decides whether to supersede the decision or re-scope the task.
4. **Before committing uncommitted architectural changes.** In-flight
   changes that alter the shape of the system (new services, new public
   endpoints, schema changes) get a review before landing. Routine work
   inside a scoped phase does not.

## When *not* to stop

- Routine bug fixes inside an already-scoped phase
- Refactors contained within a single module
- Doc updates that reflect decisions already made
- Adding tests, fixing types, addressing lint

## Keeping the map in sync

When you make an architectural decision or learn something that changes
one:

- **New decision** → `uv run docs/scripts/doctool.py new decision
  "<title>"` (scaffolds the next number + index row). Fill in Status,
  Context, Decision, Consequences, Alternatives ruled out, and a
  `**Current architecture:**` link to the area doc it shapes. Add a
  back-link from that area doc's "Decisions behind this" section.
- **The code moved** → edit the relevant **area doc**
  (`docs/architecture/<area>.md`), present tense. Do *not* edit the
  decision record — its body is frozen.
- **Supersede / revise a decision** → write a new record; for a full
  replacement set the old one's Status to `Superseded by Decision NNNN`
  and `doctool.py archive` it; for a partial revision (one aspect), keep
  the old record Accepted and cross-link (as 0015 ↔ 0014 do). Never a
  dated amendment.
- **Open problem resolved** → write the decision record, then *delete*
  the `open-problems/<name>.md` file and update
  `open-problems/README.md`.
- **New open problem** → add `open-problems/<name>.md` with the standard
  header (Status, Must resolve by, Blocks, Related decisions) and a
  bullet in `open-problems/README.md`.
- **Phase complete** → update Decision 0006's phase status, this
  CLAUDE.md's phases table, and the active plan in `docs/plans/`.
- Then **run `uv run docs/scripts/doctool.py lint`** and clear it before
  committing.

## Decisions are revisitable (not frozen)

Immutable does not mean unchangeable. If you find a real reason to
revisit a decision, say so: "Decision 0004 assumed X; we now know Y;
here's what changes" is a valid move. The rule is that the change is
deliberate and written down — as a *new* superseding or revising record,
with current state landing in the area doc — never a silent edit of an
accepted record.
