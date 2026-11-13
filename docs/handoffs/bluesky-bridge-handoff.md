# Handoff — Bluesky bridge (2.5D done and on in production; deploy PR #50, fix the smoke check, finish 2.5E)

**Created:** 2026-11-13
**Working tree:** clean (untracked `.DS_Store`, `.idea/`, `backend/.expo/` are not ours to touch)
**Branch:** `main`

<!--
Reminder: a handoff is ephemeral. At resolution, every load-bearing piece
below migrates into a docs/architecture/ (area doc, decision, spike) or
docs/plans/ home, and this file is then `git rm`'d in the same commit as the migration.

See docs/handoff-discipline.md for the migration table.
-->

## Goal & next-up

**Goal of this session:** check the bridge in production after its
switch-on, do step 22 of [plan 2.5D](../plans/phase-3-atproto.md), the
integration tests, and start 2.5E. Step 22 is merged (PR #50) and also
fixed a gap in opt-out. 2.5E steps 18 (the end-to-end run) and 19 (the
two area docs) are done.

**Next session should pick up:**

1. **Deploy PR #50** (follow-up 1).
2. **Get the scheduled smoke check passing again** (follow-up 2).
3. **Decide when the bridge re-reads an author** (follow-up 3).
4. **The rest of 2.5E** (follow-up 5).

**Verification command:**

```sh
git log --oneline -4   # PR #50's two commits on top of 98d32d1, then the area docs
curl -s https://appview.tortok.app/health | grep -o '"sha":"[0-9a-f]*"'
# Expect: the PR #50 commit's sha once deployed; 94e6d8a (PR #49) until then
fly logs -a tortok-api --no-tail | grep -E '\[(bridge|poller)\]' | tail -3
# Expect: [poller] checked=… lines every 15 s or so
(cd backend && npx jest) # Expect: 143 passed
```

## Done this session

| Commit | Subject | Notes |
|---|---|---|
| `250e025` (PR #50) | the Bluesky bridge end to end; an excluded author loses every post [step 22] | `bskyBridge.test.ts`; the poller and firehose now delete every bridged row of an excluded author |
| (PR #51) | `federation.md` and `auth-signup.md` written in full [2.5E step 19] | each claim checked against the code |
| (PR #51) | the end-to-end run [2.5E step 18] | recorded under step 18 in the plan; no code change |

## Open follow-ups (priority-ordered)

### 1. Deploy PR #50 (small)

PR #50 merged on 2026-11-13. Production runs the old behaviour until
`npm run deploy:backend` is run on `main`. Nothing needs cleaning up first:
a read of production that day found no bridged row by an author already
known to be excluded.

### 2. The scheduled smoke check has failed since 2026-11-12 (small, needs Cloudflare)

Every run of `.github/workflows/smoke.yml` since 2026-11-12 18:33 UTC has
failed: 86 in a row by 16:06 UTC the next day. That was the first run after
2.5C step 14 pointed it at `https://appview.tortok.app`. From GitHub's
runners every request gets `HTTP 403, not JSON`. The same URLs answer 200
from a laptop and from the Fly machine, both through Cloudflare, so
Cloudflare is refusing GitHub's runners in particular. Production is fine;
the monitor is blind, and each run emails the repository owner. Cloudflare's
Security Events for the zone will name the rule. Two ways out: let the
runners through at Cloudflare, or point the workflow back at
`https://tortok-api.fly.dev`, which checks the origin but not the public
hostname. Once it runs again it will also fail if PR #50 has sat undeployed
for a day.

### 3. Decide when the bridge re-reads an author (a decision, then ~half day)

The note under step 22 in the plan lists three consequences of reading an
author's profile only when one of their posts is due: opting out is
one-way, an opt-out goes unseen once all of an author's posts are past the
recheck age, and a backdated post is never re-read. It also names a fix
for each. Not decided. Opt-out is a Beta criterion, so settle it before
Beta.

### 4. Watch the bridge in production (ongoing, small)

About an hour after switch-on (2026-11-13): 795 bridged rows, 73 of them
served, about 170 qualifying an hour, which is inside Decision 0023's
estimate of 60–210. The machine was idle with 300 MB free. The feed's
first page is all bridged posts, because the feed is chronological and the
five native test clips are older. Off switch: `BRIDGE_ENABLED = "false"` in
`backend/fly.toml`, then deploy. Drop this item once the bridge has run
cleanly for a while.

### 5. The rest of 2.5E (~half hour, after two decisions)

Steps 18 and 19 are done. Left in plan 2.5E: step 20, whether the
`unit-2.5-attempt-1` tag stays; and step 21, the phase status in
`CLAUDE.md` and the plan. Decision 0023's Status is still Proposed although
it is built and running; set it then. This handoff is deleted in that
commit.

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

- [`phase-3-atproto.md`](../plans/phase-3-atproto.md) — plan 2.5D (step 22 and its open note) and 2.5E
- [`backend.md`](../architecture/backend.md) — the bridge as built, its tests, reading the production database
- [`client.md`](../architecture/client.md) — HLS playback, the badge, watch history
- [Decision 0023](../architecture/decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md), [Decision 0010](../architecture/decisions/0010-bluesky-video-bridge.md)

## Migration note

- Follow-up 1 → nothing to migrate; it ends with the deploy.
- Follow-up 2 → `backend.md` Deployment and configuration, if the smoke
  check's target or its way through Cloudflare changes.
- Follow-up 3 → a decision record revising Decision 0023 item 4 if the
  behaviour changes, then the plan's open note and `backend.md`'s Deferred
  row are updated or removed.
- Follow-up 4 → already in `backend.md` and the CHANGELOG; drop it.
- Critical context: the iOS Pods note goes when prebuild is run; the others
  are already in code comments.
- Then `git rm docs/handoffs/bluesky-bridge-handoff.md` in the 2.5E commit.
