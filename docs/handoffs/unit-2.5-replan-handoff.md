# Handoff — Unit 2.5 (v2) replan, ready to start Phase 0 cleanup

**Created:** 2026-05-02
**Working tree:** clean
**Branch:** main (at `8399caf`, pushed = no)

## Goal & next-up

**Goal of this session:** Replan Phase 3 Unit 2.5 after attempt 1
landed an architecture (`bridged_posts` sidecar table + `source`
discriminator) that turned out to be a defensive kludge against the
end-state. Reset main, preserve attempt 1 on a tag, write the new
plan, and adopt Jacquard-style ADR/plan/handoff structure to make
the next round of work easier to navigate.

**Next session should pick up:** **Unit 2.5 (v2) Phase 0 — Cleanup**
(see `docs/plans/phase-3-atproto.md` § Phase 0 — Cleanup). Concretely:

1. New migration `backend/src/db/migrations/0xx_drop_bridged_posts.sql`
   with `DROP TABLE IF EXISTS bridged_posts; DROP TABLE IF EXISTS
   bridge_cursor;` (idempotent SQL — dev DBs still carry the tables
   from attempt 1 even though main is reset).
2. R2 `bridged/` prefix cleanup (~2,669 mirrored objects from the
   NSFW cleanup pass + everything else accumulated). Use `wrangler r2
   object delete` or whichever helper script in `scripts/` is fastest.
3. Confirm no leftover attempt-1 background services running:
   `ps -ef | grep -E "tsx|node.*backend" | grep -v grep` should show
   only the ts-node-dev for `670061a`'s services.
4. Smoke check: `npm run dev` (backend) + iOS sim → feed loads native
   videos at sub-second cold-start (matches the bisect baseline of
   ~413ms for big-buck-bunny clip).

**Verification command:**

```sh
git log --oneline -5
# Expect: 8399caf docs: introduce handoff discipline
#         a5a6a98 docs: move Phase 3 plan into repo
#         40e9eb7 docs: split decisions.md into per-ADR files
#         670061a feat(tortok): pre-fill last-used handle + iOS autofill hints
#         72b32d5 feat(tortok): atproto OAuth login [Phase 3 Unit 2]

git tag -l | grep unit
# Expect: unit-2.5-attempt-1

ls docs/architecture/adr/ | wc -l
# Expect: 13

ls docs/handoffs/
# Expect: this file + .gitkeep
```

## Done this session

| Commit | Subject | Notes |
|---|---|---|
| `8399caf` | docs: introduce handoff discipline | This file's home, plus `docs/handoff-discipline.md` and CLAUDE.md updates |
| `a5a6a98` | docs: move Phase 3 plan into repo | `~/.claude/plans/squishy-stargazing-hopcroft.md` → `docs/plans/phase-3-atproto.md`; user-global file replaced with one-line pointer |
| `40e9eb7` | docs: split decisions.md into per-ADR files | 13 ADRs each at `docs/architecture/adr/NNNN-slug.md`; index in `decisions.md` |

**Pre-existing (this session reset to here, not authored here):**

| Tag | Subject | Notes |
|---|---|---|
| `unit-2.5-attempt-1` (= `25a2ef7`) | Tip of attempt 1 | ~30 commits with `bridged_posts` table, source discriminator, HLS→MP4 ffmpeg pipeline, NSFW filter, listener leak fixes, lazy-init OAuth, per-segment URL encoding. Cherry-pick byte-level fixes from here in Phase D. |
| `670061a` | feat(tortok): pre-fill last-used handle + iOS autofill hints | Pre-Unit-2.5 baseline. Native feed cold-starts in ~413ms here vs ~2.9s on attempt-1 tip — confirmed by bisect. |

## Open follow-ups (priority-ordered)

### 1. Phase 0 — Cleanup (~1h)

Detail in plan doc § Phase 0. **Do this first** before any new code.
The cleanup is gated by user approval per CLAUDE.md ("Never rm
without asking") because R2 deletion is destructive. Surface the
exact `wrangler r2 object delete` command list before running it.

### 2. Phase A — Atproto-native ingestion (~1.5–2 days)

Plan doc § Phase A. Creates `posts` table + `atprotoIngest` worker
+ `seed-fixtures.mjs`. Phase A populates `posts` from test PDS
fixtures BEFORE Phase B flips the feed read path — that ordering
is load-bearing to avoid an empty feed during cutover.

### 3. Phase B → E

Plan doc § Phase B–E. Don't run them ahead of order; each phase has
load-bearing prereqs from the prior one.

## Critical context

- **The bisect result is the architectural anchor.** Main at
  `670061a` plays native big-buck-bunny in ~413ms. Attempt-1 tip
  played the same content in ~2.9s with frequent R2 429s on
  `.torrent` fetches. Earlier framing ("the bridge is slow") was
  wrong — the WebTorrent + bridge.native.ts infrastructure is
  healthy; the slowness was data-shape problems specific to bridged
  content. Phase D ports the byte-level fixes back without the
  table architecture.

- **The unified `posts` table uses at-uri's collection segment as
  discriminator.** No `source` column. The collection field stored
  alongside is a denormalized index helper, not a source of truth —
  the at-uri itself is the SoT. (Plan doc § Phase A schema for the
  exact shape.)

- **`mirror_state` is a sidecar, not part of the feed query.** Only
  the bridge orchestration code reads/writes it. Feed query reads
  `posts` only. This was the architectural takeaway from attempt 1:
  bridged-content state belongs out of the feed query path.

- **R2 `.torrent` files must be served by the backend in Phase D, not
  from `pub-*.r2.dev` directly.** The public R2 hostname has
  aggressive rate limits that produced 429s under scroll load in
  attempt 1. New `backend/src/routes/torrents.ts` with in-memory or
  on-disk cache fixes this.

- **Test PDS rate limit.** `tortok-dev.bsky.social` is 10 logins/day
  (memory `bsky-test-account.md`). `seed-fixtures.mjs` should use one
  app-password session and cache it.

- **HLS → MP4 ffmpeg recipe (Phase D port-forward):**
  `-c copy -bsf:a aac_adtstoasc -movflags +faststart`. Strip
  query strings from playlist segments before passing to ffmpeg
  (HLS demuxer rejects them). 16KB piece size for first-piece
  latency. All preserved on `unit-2.5-attempt-1` tag.

- **NSFW filter set:** `porn|sexual|nudity|graphic-media|gore` self-labels
  + Bluesky default labeler aggregation. Live first pass on
  attempt 1 demoted ~19% of indexed posts (2,669 of 14,060). Same
  filter applies in Phase D.

## References

- [`docs/plans/phase-3-atproto.md`](../plans/phase-3-atproto.md) —
  active phase plan; § "Replanned Unit 2.5" is the ground truth
  for the next several sessions
- [`docs/architecture/adr/0010-bluesky-video-bridge.md`](../architecture/adr/0010-bluesky-video-bridge.md) —
  ADR-010 + Path-2 amendment 2026-05-02
- [`docs/handoff-discipline.md`](../handoff-discipline.md) — the
  rules of engagement for this file

---

**Resume in a new session with:**

```
/resume_handoff docs/handoffs/unit-2.5-replan-handoff.md
```
