# Handoff — Backfill the stub area docs (adoption follow-up 1)

**Created:** 2026-11-04 · **Updated:** 2026-11-13
**Branch:** start a `docs/area-backfill-<area>` branch per area, from `main`

## Goal & next-up

**Goal:** replace the stub architecture area docs with full, present-tense
reference docs, each claim verified against the current code. This executes
follow-up 1 in [`docs/architecture/README.md`](../architecture/README.md#follow-ups),
which also records which docs wait for Phase 3 Unit 2.5.

**Next session should pick up:** `monetization.md`, then `moderation.md`. Both
are mostly unbuilt, so they stay thin and say so. One area per branch and PR.

**Verification command:**
```sh
uv run docs/scripts/doctool.py lint   # expect 0 error(s), 0 warning(s)
```
A backfilled doc must keep its `## Implementation status` and
`## Decisions behind this` headings (A001) and keep linking the decisions it
covers (A002).

## Done

| Doc | Landed |
|---|---|
| `backend.md` | PR #3 (2026-11-04) |
| `client.md` | PR #8 (2026-11-09) |
| `federation.md`, `auth-signup.md` | Phase 3 Unit 2.5E step 19 (2026-11-13) |

## Method

1. Model the depth, present tense and file references on
   [`p2p-torrent.md`](../architecture/p2p-torrent.md); start from
   [`_template.md`](../architecture/_template.md).
2. Verify every sentence against the code before writing it. Read the file; don't
   infer from a decision record.
3. Decision bodies stay frozen. Move a decision's current-state claims into the
   area doc and link the decision.
4. Run `doctool.py lint` before committing.

## Remaining areas

### `monetization.md` (Decision 0011)

No monetization code exists (no payout or pool code in `backend/src` or
`tortok`; `lexicons/` holds only `app/tortok/video/post.json`). State that the
interface-first direction is set and nothing is built. Link
[`open-problems/monetization.md`](../architecture/open-problems/monetization.md)
for the open questions rather than repeating them.

### `moderation.md` (Decision 0013)

No labeler, CSAM-hashing, DMCA or age-gate code exists. The stub already says
so (audit PR #12). Strategy is set; implementation is launch-blocking per
[`release-plan.md`](../plans/release-plan.md).

---

**Resume in a new session with:**
```
/resume_handoff docs/handoffs/area-doc-backfill-handoff.md
```
