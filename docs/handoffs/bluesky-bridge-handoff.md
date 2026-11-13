# Handoff — Bluesky bridge (2.5D done and on in production; deploy PR #50, then 2.5E)

**Created:** 2026-11-13
**Working tree:** clean (untracked `.DS_Store`, `.idea/`, `backend/.expo/` are not ours to touch)
**Branch:** `test/bridge-integration-step-22` (PR #50) until it merges, then `main`

<!--
Reminder: a handoff is ephemeral. At resolution, every load-bearing piece
below migrates into a docs/architecture/ (area doc, decision, spike) or
docs/plans/ home, and this file is then `git rm`'d in the same commit as the migration.

See docs/handoff-discipline.md for the migration table.
-->

## Goal & next-up

**Goal of this session:** check the bridge in production after its
switch-on, and do step 22 of [plan 2.5D](../plans/phase-3-atproto.md), the
integration tests. Both done; step 22 also fixed a gap in opt-out.

**Next session should pick up:**

1. **Merge PR #50 once CI is green, then deploy it** (follow-up 1).
2. **Decide when the bridge re-reads an author** (follow-up 2).
3. **2.5E** (follow-up 4).

**Verification command:**

```sh
git log --oneline -3   # the PR #50 commit on top of 98d32d1
curl -s https://appview.tortok.app/health | grep -o '"sha":"[0-9a-f]*"'
# Expect: the PR #50 commit's sha once deployed; 94e6d8a (PR #49) until then
fly logs -a tortok-api --no-tail | grep -E '\[(bridge|poller)\]' | tail -3
# Expect: [poller] checked=… lines every 15 s or so
(cd backend && npx jest) # Expect: 143 passed
```

## Done this session

| Commit | Subject | Notes |
|---|---|---|
| (PR #50) | the Bluesky bridge end to end; an excluded author loses every post [step 22] | `bskyBridge.test.ts`; the poller and firehose now delete every bridged row of an excluded author |

## Open follow-ups (priority-ordered)

### 1. Deploy PR #50 (small)

Production runs the old behaviour until `npm run deploy:backend` is run on
`main` after the merge. The smoke workflow also fails once a backend commit
has sat on `main` undeployed for a day. Nothing needs cleaning up first: a
read of production on 2026-11-13 found no bridged row by an author already
known to be excluded.

### 2. Decide when the bridge re-reads an author (a decision, then ~half day)

The note under step 22 in the plan lists three consequences of reading an
author's profile only when one of their posts is due: opting out is
one-way, an opt-out goes unseen once all of an author's posts are past the
recheck age, and a backdated post is never re-read. It also names a fix
for each. Not decided. Opt-out is a Beta criterion, so settle it before
Beta.

### 3. Watch the bridge in production (ongoing, small)

About an hour after switch-on (2026-11-13): 795 bridged rows, 73 of them
served, about 170 qualifying an hour, which is inside Decision 0023's
estimate of 60–210. The machine was idle with 300 MB free. The feed's
first page is all bridged posts, because the feed is chronological and the
five native test clips are older. Off switch: `BRIDGE_ENABLED = "false"` in
`backend/fly.toml`, then deploy. Drop this item once the bridge has run
cleanly for a while.

### 4. 2.5E final checks (~half day)

Plan 2.5E: clean end-to-end run with the bridge on, `auth-signup.md` and
`federation.md` written in full, the `unit-2.5-attempt-1` tag decision,
and the phase status in `CLAUDE.md`. Decision 0023's Status is still
Proposed although it is built and running; set it then.

## Critical context

- **Local iOS Detox doesn't build on this Mac**: the Pods are out of step with
  the lockfile (`RNReanimated`/`RNWorklets` sources missing). It needs
  `npx expo prebuild` in `tortok/`, not yet run. CI's Detox is the
  authoritative run meanwhile. `npm ci` was run in the repo root and
  `tortok/`, and `tortok/ios/.xcode.env.local` now points at
  `/opt/homebrew/bin/node`.
- **Backend tests that touch the DB must import `../db` dynamically, after
  `createTestDb()`**. A static import once truncated the dev DB; the Jest
  guard in `db/index.ts` now fails such a test instead.
- **Submit handlers read the event's text**, not component state
  (`e.nativeEvent.text`): Detox's `replaceText` + `tapReturnKey` beats the
  re-render. `tortok/e2e/helpers.ts` `fill` says so.

## References

- [`phase-3-atproto.md`](../plans/phase-3-atproto.md) — plan 2.5D (step 22 and its open note) and 2.5E
- [`backend.md`](../architecture/backend.md) — the bridge as built, its tests, reading the production database
- [`client.md`](../architecture/client.md) — HLS playback, the badge, watch history
- [Decision 0023](../architecture/decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md), [Decision 0010](../architecture/decisions/0010-bluesky-video-bridge.md)

## Migration note

- Follow-up 1 → nothing to migrate; it ends with the deploy.
- Follow-up 2 → a decision record revising Decision 0023 item 4 if the
  behaviour changes, then the plan's open note and `backend.md`'s Deferred
  row are updated or removed.
- Follow-up 3 → already in `backend.md` and the CHANGELOG; drop it.
- Critical context: the iOS Pods note goes when prebuild is run; the others
  are already in code comments.
- Then `git rm docs/handoffs/bluesky-bridge-handoff.md` in the 2.5E commit.
