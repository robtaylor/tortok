# Handoff — Bluesky bridge (Unit 2.5 done; author re-reading is open)

**Created:** 2026-11-13
**Working tree:** clean (untracked `.DS_Store`, `.idea/`, `backend/.expo/` are not ours to touch)
**Branch:** `main`; Decision 0024 is on `docs/decision-bridge-keeps-what-it-rereads` until its PR merges

<!--
Reminder: a handoff is ephemeral. At resolution, every load-bearing piece
below migrates into a docs/architecture/ (area doc, decision, spike) or
docs/plans/ home, and this file is then `git rm`'d in the same commit as the migration.

See docs/handoff-discipline.md for the migration table.
-->

## Goal & next-up

**Goal of this session:** check the bridge in production after its
switch-on, do step 22 of [plan 2.5D](../plans/phase-3-atproto.md), the
integration tests, and finish 2.5E. All done: Unit 2.5 is closed, and
PR #50 (step 22, with a fix to opt-out) is deployed. The scheduled smoke
check, which had failed since 2026-11-12, passes again.

**Next session should pick up:**

1. **Get Decision 0024 accepted, then build it** (follow-up 1).
2. **Unit 3**. The plan lists what to settle before the first real
   record.

**Verification command:**

```sh
curl -s https://appview.tortok.app/health | grep -o '"sha":"[0-9a-f]*"'
# Expect: aee7ae2… (PR #50), or a later backend commit
fly logs -a tortok-api --no-tail | grep -E '\[(bridge|poller)\]' | tail -3
# Expect: [poller] checked=… lines every 15 s or so
gh run list --workflow smoke.yml --limit 3
# Expect: success
(cd backend && npx jest) # Expect: 143 passed
```

## Done this session

| Commit | Subject | Notes |
|---|---|---|
| `250e025` (PR #50) | the Bluesky bridge end to end; an excluded author loses every post [step 22] | `bskyBridge.test.ts`; the poller and firehose now delete every bridged row of an excluded author. Deployed 2026-11-13 |
| (PR #51) | `federation.md` and `auth-signup.md` written in full [2.5E step 19] | each claim checked against the code |
| (PR #51) | the end-to-end run [2.5E step 18] | recorded under step 18 in the plan; no code change |
| (PR #51) | Unit 2.5 closed [2.5E steps 20 and 21] | the `unit-2.5-attempt-1` tag stays; Decision 0023 is Accepted (partial); phase status in `CLAUDE.md` and the plan |
| (no commit) | Bot Fight Mode switched off for `tortok.app` | it challenged GitHub's runners, so every scheduled smoke run failed; a manual run passed afterwards. `backend.md` Constraints says why it stays off |

## Open follow-ups (priority-ordered)

### 1. Decision 0024: the bridge keeps only posts it still re-reads (review, then ~half day)

The note under step 22 in the plan lists three gaps in how the bridge
repeats its checks: opting out is one-way, an opt-out goes unseen once all
of an author's posts are past the recheck age, and a backdated post is
never re-read. [Decision 0024](../architecture/decisions/0024-the-bridge-keeps-only-the-posts-it-still-re-reads.md)
proposes a fix for each. It is Proposed and nothing is built. Opt-out is a
Beta criterion, so settle it before Beta.

Once it is accepted: delete at the recheck age instead of clearing
`bridge_next_check_at` (`bskyEngagementPoller.ts`), take a post's age from
`indexed_at`, let the firehose index a post by an excluded author whose
`bridge_authors.refreshed_at` is over a day old, and add the four test
cases the record lists to `bskyBridge.test.ts`. On deploy, give every
bridged row with no check date one. Then update `backend.md`, the plan's
note, and the Status of Decisions 0023 and 0024.

### 2. Watch the bridge in production (ongoing, small)

About an hour after switch-on (2026-11-13): 795 bridged rows, 73 of them
served, about 170 qualifying an hour, which is inside Decision 0023's
estimate of 60–210. The machine was idle with 300 MB free. The feed's
first page is all bridged posts, because the feed is chronological and the
five native test clips are older. Off switch: `BRIDGE_ENABLED = "false"` in
`backend/fly.toml`, then deploy. Drop this item once the bridge has run
cleanly for a while.

## Critical context

- **Local iOS Detox doesn't build on this Mac**: the Pods are out of step with
  the lockfile (`RNReanimated`/`RNWorklets` sources missing). It needs
  `npx expo prebuild` in `tortok/`, not yet run. CI's Detox is the
  authoritative run meanwhile. `npm ci` was run in the repo root and
  `tortok/`, and `tortok/ios/.xcode.env.local` now points at
  `/opt/homebrew/bin/node`.
- **The e2e build installed on the iPhone 17 Pro simulator is stale.** It
  was built 2026-11-13 01:24, a minute before that `npm ci` re-applied the
  `bittorrent-tracker` patch, so it crashes (`Cannot read property
  'protocol' of undefined`) when it first adds a torrent with a `ws://`
  tracker, which is the local backend's default. Start the backend with
  `TRACKER_URLS=wss://tortok-tracker.fly.dev` to use that build, or rebuild.
- **Backend tests that touch the DB must import `../db` dynamically, after
  `createTestDb()`**. A static import once truncated the dev DB; the Jest
  guard in `db/index.ts` now fails such a test instead.
- **Submit handlers read the event's text**, not component state
  (`e.nativeEvent.text`): Detox's `replaceText` + `tapReturnKey` beats the
  re-render. `tortok/e2e/helpers.ts` `fill` says so.

## References

- [`phase-3-atproto.md`](../plans/phase-3-atproto.md) — Unit 2.5 (the open note under step 22) and Unit 3
- [`backend.md`](../architecture/backend.md) — the bridge as built, its tests, the public domain and the smoke check
- [`federation.md`](../architecture/federation.md), [`auth-signup.md`](../architecture/auth-signup.md) — written in full this session
- [Decision 0023](../architecture/decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md), [Decision 0010](../architecture/decisions/0010-bluesky-video-bridge.md)

## Migration note

- Follow-up 1 → Decision 0024 holds the reasoning. When it is built,
  `backend.md`'s poller section and Deferred row, `federation.md`'s
  Deferred row, the plan's open note, and the Status of Decisions 0023 and
  0024 change.
- Follow-up 2 → already in `backend.md` and the CHANGELOG; drop it.
- Critical context: the two iOS notes go when prebuild is run; the test
  notes are already in code comments.
- Then `git rm docs/handoffs/bluesky-bridge-handoff.md`, once follow-up 1
  is settled.
