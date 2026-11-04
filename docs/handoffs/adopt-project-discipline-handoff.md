# Handoff — Adopt current claude-project-discipline (PR open, two follow-ups queued)

**Created:** 2026-11-04
**Working tree:** clean
**Branch:** `docs/adopt-project-discipline` (pushed; PR #1 open against `main`)

## Goal & next-up

**Goal of this session:** bring tortok's docs discipline onto the current
[claude-project-discipline](https://robtaylor.github.io/claude-project-discipline/)
(architecture-reference + immutable-decision model + `doctool.py`), via the
upstream "Migrating from the `docs/adr/` layout" recipe. Done; migration is in
**PR #1**.

**Next session should pick up:** get PR #1 reviewed and merged. After merge, the
two follow-ups below. Nothing is mid-edit — the branch is complete and lints
clean.

**Verification command:**
```sh
uv run docs/scripts/doctool.py lint --strict
# Expect: 0 error(s), 1 warning(s)
#   — the sole warning is A002 on decisions/0006-migration-from-swift.md
#     (migration/phasing has no area doc; intentional).
```

## Done this session

| Commit | Subject | Notes |
|---|---|---|
| `6fd4350` | scaffold layout (tooling + templates) | vendored doctool.py, decisions/+archive/+spikes/, plans/archive/, CHANGELOG, prose-style, release-process |
| `63c6581` | move ADRs adr/→decisions/, rebuild index | 14 IDs preserved; extra index sections → open-problems/README.md + plans/archive/phase-0-punch-list.md |
| `abd30a0` | rename ADR→Decision, reconcile to immutable | docs + source comments; handoff-discipline reconciled |
| `d67447d` | architecture-reference layer | p2p-torrent.md full; 6 stubs; Current-architecture forward-links |
| `1abdcde` | convert 0014 amendment → Decision 0015 | 0014 reverted to 2026-07-01 record + forward-note |
| `bd706ee` | Phase-2 spike; archive/relocate plans | spike resolved; PHASE_2_PLAN→plans/archive/phase-2.md; release-plan→plans/ |
| `ad2d12f` | remove resolved Phase-0a handoff | record in git log + plans/archive/phase-0-punch-list.md |
| `798b68a` | rewrite CLAUDE.md onto the new model | kept phases table, stop-and-ask, open-problems extension |

## Open follow-ups (priority-ordered)

### 1. Merge PR #1 (blocked on review)

https://github.com/robtaylor/tortok/pull/1 — no CI in this repo (no
`.github/workflows/`), so merge is review-gated only. Rebase-merge per repo
convention.

### 2. Verified area-doc backfill (medium)

Replace the six **stub** area docs with full present-tense write-ups, each
checked against the current code (claim-verification): `federation.md`,
`client.md`, `backend.md`, `auth-signup.md`, `monetization.md`, `moderation.md`.
As each decision's current-state claims move into its area doc, the decision
record stays frozen. This also clears the Decision 0006 A002 warning if 0006 is
given a home (or it stays an accepted exception). Use
`docs/architecture/p2p-torrent.md` as the model for depth and file-referencing.

### 3. Propose `open-problem` kind upstream (small)

tortok keeps `docs/architecture/open-problems/` as an extension (phase-gated
"Must resolve by" forced-decision tracker) because stock claude-project-discipline
has no equivalent. Pitch it upstream (local clone at
`/Users/roberttaylor/Code/claude-project-discipline`) — either as a first-class
sixth kind, or document the stock way to express a phase-gated forced decision.

## Critical context

- **Immutable-decision model is now in force.** Never edit an accepted decision
  record's body or add a dated `## Amendment` block — `doctool.py lint` flags the
  latter (D004). Current state goes in the area doc; a changed decision gets a new
  superseding/revising record (see Decision 0015 revising 0014's tier-3 vendor
  choice — a *partial* revision: 0014 stays Accepted, cross-linked, not archived).
- **`doctool.py` requires each accepted decision to have a `**Current
  architecture:**` forward-link (D005, error) and each area doc to have
  `## Implementation status` + `## Decisions behind this` (A001, warning).** That's
  why the stubs exist — link-only but lint-clean.
- **Decision 0006's A002 warning is intentional** (migration/phasing is not an
  area). Leave it unless the backfill gives 0006 a home.
- `open-problems/` is not in doctool's Layout, so its own links are still
  lint-checked (it's under `docs/`) but it is not treated as a decision/area.

## References

- [`CLAUDE.md`](../../CLAUDE.md) — rewritten; the new read-order and rules.
- [`docs/architecture/README.md`](../architecture/README.md) — the area map (entry point).
- [`docs/architecture/decisions/README.md`](../architecture/decisions/README.md) — decision conventions + index.
- Upstream recipe: `claude-project-discipline/src/adopting.md` §"Migrating from the `docs/adr/` layout".
