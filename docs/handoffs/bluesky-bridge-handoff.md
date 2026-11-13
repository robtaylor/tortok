# Handoff — Bluesky bridge (2.5D steps 15–21 shipped and on in production; step 22 next)

**Created:** 2026-11-13
**Working tree:** clean (untracked `.DS_Store`, `.idea/`, `backend/.expo/` are not ours to touch)
**Branch:** main

<!--
Reminder: a handoff is ephemeral. At resolution, every load-bearing piece
below migrates into a docs/architecture/ (area doc, decision, spike) or
docs/plans/ home, and this file is then `git rm`'d in the same commit as the migration.

See docs/handoff-discipline.md for the migration table.
-->

## Goal & next-up

**Goal of this session:** build the Bluesky bridge of
[plan 2.5D](../plans/phase-3-atproto.md) (Decisions 0010 and 0023), steps
15–21: load measurement, schema, firehose, engagement poller, the feed's
HLS items, the client, and the boot. All landed and deployed.

**Next session should pick up:**

1. **Check the bridge is healthy in production.** It was switched on
   2026-11-13 (`BRIDGE_ENABLED = "true"` in `backend/fly.toml`, PR #49):
   there are no users yet, so bridged posts reaching the feed affects
   nobody. Look for `[poller] checked=…` lines and qualified posts in the
   feed (see follow-up 1).
2. **Step 22, tests**, then 2.5E (steps 18–21 of that section).

**Verification command:**

```sh
git log --oneline -3   # the PR #49 commit on top of fbeda5e (step 21)
curl -s https://appview.tortok.app/health | grep -o '"sha":"[0-9a-f]*"'
# Expect: the PR #49 commit's sha
fly logs -a tortok-api --no-tail | grep -E '\[(bridge|poller)\]' | tail -3
# Expect: [bridge] Jetstream connected / [poller] checked=… lines, not "off"
(cd backend && npx jest) # Expect: 118 passed
```

## Done this session

| Commit | Subject | Notes |
|---|---|---|
| `ab15f25` | Bluesky bridge firehose, on a shared Jetstream subscription [step 17] | step 15's measurement and step 16's schema landed before it |
| `6ba43ed` | under Jest, the db pool has no dev-database default | a static import in a test had truncated the dev DB |
| `f0b009f` | Bluesky bridge engagement poller [step 18] | |
| `9e5b896` | the feed serves qualified bridged posts as HLS [step 19] | |
| `8d6ed43` | the app plays bridged Bluesky posts over HLS [step 20] | PR #45; drops the unused `posts.hls_url` (prod had 0 bridged rows) |
| `d9d29a2` | the AppView field saves the text its return key submits | PR #47; root cause of the iOS "switches to another AppView" flake |
| `fbeda5e` | boot the Bluesky bridge behind BRIDGE_ENABLED [step 21] | PR #46; deployed with the flag unset |
| (PR #49) | switch the Bluesky bridge on in production | `BRIDGE_ENABLED = "true"` in `fly.toml`; no users yet |

## Open follow-ups (priority-ordered)

### 1. Watch the bridge in production (ongoing, small)

Switched on 2026-11-13, decided because there are no users yet (PR #49).
Watch `fly logs` for `[bridge]` and `[poller]` lines and the machine's CPU;
step 15 measured about 2% of a shared core. A local 90 s run against live
Bluesky indexed 29 posts, dropped 4 as NSFW, and qualified 2, so bridged
posts should reach the feed within the hour. Off switch: `BRIDGE_ENABLED =
"false"` in `backend/fly.toml`, then deploy.

### 2. Step 22: integration tests (~half day)

The plan lists: NSFW drop at index time and on re-label, opt-out signals
(`!no-unauthenticated`, `#nobridge`; `release-plan.md` makes opt-out tested
in CI a Beta criterion), thresholds, and Bluesky-side deletion. Much is
already covered by `backend/src/__tests__/bskyFirehose.test.ts` and
`bskyEngagementPoller.test.ts` (stubbed Jetstream via `helpers/fakeSocket.ts`,
stubbed AppView). Start by auditing those files against that list, then fill
the gaps rather than writing a new suite.

### 3. 2.5E final checks (~half day)

Plan 2.5E: clean end-to-end run with the bridge on, `auth-signup.md` and
`federation.md` written in full, the `unit-2.5-attempt-1` tag decision,
and the phase status in `CLAUDE.md`.

## Critical context

- **Local iOS Detox doesn't build on this Mac**: the Pods are out of step with
  the lockfile (`RNReanimated`/`RNWorklets` sources missing). It needs
  `npx expo prebuild` in `tortok/`, not yet run. CI's Detox is the
  authoritative run meanwhile. `npm ci` was run in the repo root and
  `tortok/`, and `tortok/ios/.xcode.env.local` now points at
  `/opt/homebrew/bin/node`.
- **Reading the production database**: there's no `psql` in the image; this
  works from `backend/`:
  `fly ssh console -a tortok-api -C "node -e \"…new (require('pg').Pool)({connectionString:process.env.DATABASE_URL}).query('…')…\""`.
  Bridged rows are those with `video_cid IS NOT NULL` (there's no `source`
  column).
- **Backend tests that touch the DB must import `../db` dynamically, after
  `createTestDb()`**. A static import once truncated the dev DB; the Jest
  guard in `db/index.ts` now fails such a test instead.
- **Submit handlers read the event's text**, not component state
  (`e.nativeEvent.text`): Detox's `replaceText` + `tapReturnKey` beats the
  re-render. `tortok/e2e/helpers.ts` `fill` says so.

## References

- [`phase-3-atproto.md`](../plans/phase-3-atproto.md) — plan 2.5D and 2.5E
- [`backend.md`](../architecture/backend.md) — the bridge as built, `BRIDGE_ENABLED`
- [`client.md`](../architecture/client.md) — HLS playback, the badge, watch history
- [Decision 0023](../architecture/decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md), [Decision 0010](../architecture/decisions/0010-bluesky-video-bridge.md)

## Migration note

- Follow-up 1 → already in `backend.md` and the CHANGELOG (PR #49); drop it
  once the bridge has run cleanly for a while.
- Follow-up 2 → plan step 22 marked ✅; `backend.md` Constraints › Tests.
- Critical context: the iOS Pods note goes when prebuild is run; the
  production-DB recipe → `backend.md` Deployment and configuration; the
  others are already in code comments.
- Then `git rm docs/handoffs/bluesky-bridge-handoff.md` in the 2.5E commit.
