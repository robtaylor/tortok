# Handoff — Bluesky bridge (Unit 2.5 done; Decisions 0024 and 0025 deployed; a stall fixed)

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
integration tests, and finish 2.5E. All done: Unit 2.5 is closed, and the
Decision 0024 and 0025 builds are deployed (2026-11-20).

The deploy found the bridge's firehose stalled: Jetstream had left its
connection open and silent since 2026-11-19 16:10 UTC, and nothing had
noticed. PR #57 fixed the client and made a stall visible; it is deployed
too, and the missed stretch was replayed (follow-up 1).

**Next session should pick up:**

1. **Watch the bridge** for a few days (follow-up 1).
2. **The sign-up button**: one real sign-up, then Decision 0026
   (follow-up 2).
3. **Unit 3**. The plan lists what to settle before the first real
   record.

**Verification command:**

```sh
curl -s https://appview.tortok.app/health
# Expect: "ingest":"ok","bridge":"ok", and sha d73593a… or a later backend commit
fly logs -a tortok-api --no-tail | grep -E '\[(bridge|poller)\]' | tail -3
# Expect: [poller] checked=… lines every 15 s or so; no "stalled". One
# "resyncing" is a failure the stream recovered from; a run of them isn't
gh run list --workflow smoke.yml --limit 3
# Expect: success
(cd backend && npx jest) # Expect: 165 passed
```

## Done this session

| Commit | Subject | Notes |
|---|---|---|
| `250e025` (PR #50) | the Bluesky bridge end to end; an excluded author loses every post [step 22] | `bskyBridge.test.ts`; the poller and firehose now delete every bridged row of an excluded author. Deployed 2026-11-13 |
| (PR #51) | `federation.md` and `auth-signup.md` written in full [2.5E step 19] | each claim checked against the code |
| (PR #51) | the end-to-end run [2.5E step 18] | recorded under step 18 in the plan; no code change |
| (PR #51) | Unit 2.5 closed [2.5E steps 20 and 21] | the `unit-2.5-attempt-1` tag stays; Decision 0023 is Accepted (partial); phase status in `CLAUDE.md` and the plan |
| `f13e034` (PR #54; decided in PR #52) | Decision 0024: the bridge keeps only posts it still re-reads | a bridged post is deleted at 30 days, ages count from indexing, an excluded author is re-read at their next post. Deployed 2026-11-20 |
| `a211f48` (PR #55) | Decision 0025: the feed leaves out a bridged post whose check is overdue | a post is served only while its check is under a day late, so a stopped poller or the off switch empties the feed of bridged posts within two days. Deployed 2026-11-20 |
| `a57b1a0` (PR #56) | Decision 0026 proposed, with its spike | a "Create a Bluesky account" button; one spike step left (follow-up 2) |
| `d73593a` (PR #57) | a silent or flooding Jetstream socket no longer stalls the stream or loses events | found by the deploy; see follow-up 1. Deployed 2026-11-20 |
| (no commit) | Bot Fight Mode switched off for `tortok.app` | it challenged GitHub's runners, so every scheduled smoke run failed; a manual run passed afterwards. `backend.md` Constraints says why it stays off |

## Open follow-ups (priority-ordered)

### 1. Watch the bridge in production (ongoing, small)

What happened on 2026-11-19 and 20. `backend.md` (atproto ingest) and the
CHANGELOG hold what lasts of it:

- Jetstream closed the bridge's socket at 16:10 UTC on the 19th. The
  client reconnected, got its 5-second rewind, and then nothing: the
  connection stayed open and silent for 26 hours. Native ingest, on its
  own socket, was fine.
- The first restart replayed the gap faster than the bridge could take
  it. The client reconnected every two seconds and lost 25 to 45 percent
  of the events it replayed, so the bridge was switched off on the
  machine for an hour (`fly machine update --env BRIDGE_ENABLED=false`).
- With PR #57 deployed, the cursor was put back to the stall point and
  the gap replayed again: 29 hours of posts in 2 hours 7 minutes
  (19:34 to 21:40 UTC), one connection at a time, with no queue overflow.
  The hours that had been missing now hold what the same hours held on
  the three days before (17:00 on the 19th: 1,784, against 1,562, 1,847
  and 1,735; the first replay had left 1,026).
- The replay was interrupted about 40 times and resumed from its cursor
  within 2 s each time. All but one were Jetstream closing the connection
  (code 1006), which it does to a subscriber that reads slowly
  (`backend.md`, Cursor). The other was a `Query read timeout` at
  20:46:37 UTC: one `SELECT` on `labels` got no answer for 30 s while the
  poller's queries on the same pool were answered. Its cause wasn't
  found.
- The replay left 35,000 posts waiting for their first check. The poller
  worked through them by 23:48 UTC, two hours after the replay ended, and
  the feed's newest Bluesky post was under a minute old again. Until then
  the feed ran hours behind: a post is served only after its first check,
  and the checks are taken oldest first.

What to look at, and what isn't covered yet:

- `/health` reports `ingest` and `bridge`, and the smoke check fails when
  either is `stalled`. It passes `bridge: off`: nothing compares the
  machine's `BRIDGE_ENABLED` with `fly.toml`. A deploy resets it from
  `fly.toml`.
- Jetstream held about 36 hours of events on 2026-11-20. A stall left
  longer than that loses Bluesky posts for good.
- A `Query read timeout` in the log at the live rate. One during a replay
  costs 2 s. If they come when the machine is idle, look at the database
  (`tortok-db`) and the pool before anything else.
- About an hour after switch-on (2026-11-13) the bridge held 795 rows,
  73 of them served, with about 170 qualifying an hour. On 2026-11-20 it
  held about 160,000 rows, 23,000 of them served, and indexed about 1,500
  candidates an hour.
- Off switch: `BRIDGE_ENABLED = "false"` in `backend/fly.toml`, then
  deploy.

Drop this item once the bridge has run cleanly for a while.

### 2. A "Create a Bluesky account" button (a spike step, then a decision)

[Decision 0026](../architecture/decisions/0026-the-sign-in-screen-offers-to-create-a-bluesky-account.md)
is Proposed: the login screen opens Bluesky's sign-up inside the OAuth
flow (`prompt=create`) and the person comes back signed in. Its
[spike](../architecture/decisions/spikes/creating-a-bluesky-account-inside-the-sign-in-flow.md)
is Open with one step left, Q3b: a real sign-up on `bsky.social`, which a
person has to type.

```sh
SPIKE_OPEN=1 node scripts/oauth-signup-spike.mjs loopback
# Opens Bluesky's sign-up in the browser. Finish it there.
# Expect: "signed in: did=… handle=….bsky.social"
```

Then: record the result in the spike, resolve it, accept or rewrite
Decision 0026, and add the build to the Phase 3 plan. When it is built
(before Beta or after Unit 3) is not decided.

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

- Follow-up 1 → the incident and the fix are in `backend.md` and the
  CHANGELOG; the row counts are a snapshot and go with the handoff.
- Follow-up 2 → the spike record and Decision 0026 hold it; once the
  decision is accepted, the Phase 3 plan gets the build as a unit.
- Critical context: the two iOS notes go when prebuild is run; the test
  notes are already in code comments.
- Then `git rm docs/handoffs/bluesky-bridge-handoff.md`, once the bridge
  has run cleanly for a few days and the sign-up step is done or
  rescheduled.
