# Handoff — Bluesky bridge (Unit 2.5 done; two stalls fixed; the poller and the database next)

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

Production then stopped the bridge twice, and both causes are fixed and
deployed (follow-up 3 has the detail):

- From 2026-11-19 Jetstream left the bridge's connection open and silent
  for 26 hours. PR #57.
- From 2026-11-22 one Bluesky post with a NUL in its text held the stream
  for 36 hours. PR #58.

**Next session should pick up:**

1. **The poller, where one failure still fails a whole batch**
   (follow-up 1): the one cause found is fixed; the shape wants a design.
2. **The database's growth** (follow-up 2): resized on 2026-11-24, which
   buys months; the design that stops the growth is still to do.
3. **Watch the bridge** (follow-up 3).
4. **The sign-up button**: one real sign-up, then Decision 0026
   (follow-up 4).
5. **Unit 3**. The plan lists what to settle before the first real
   record.

**Verification command:**

```sh
curl -s https://appview.tortok.app/health
# Expect: "ingest":"ok","bridge":"ok", and sha 455e0a2… or a later backend commit
fly logs -a tortok-api --no-tail | grep -E '\[(bridge|poller)\]' | tail -3
# Expect: [poller] checked=… lines every 15 s or so; no "stalled". One
# "resyncing" is a failure the stream recovered from; a run of them isn't.
# A "skipped" line names an event that kept failing: read why
gh run list --workflow smoke.yml --limit 3
# Expect: success
(cd backend && npx jest) # Expect: 187 passed
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
| `08dcaec` (PR #58) | one event that can't be handled no longer holds a Jetstream stream | an event that fails three times running with the database up is skipped; NULs dropped where network JSON is parsed; reconnects back off unless the socket worked. Deployed 2026-11-24 |
| `455e0a2` (PR #60) | the poller's AppView requests are sized to fit | a full batch of long addresses got 414 every time and blocked every other check; deleting the post a failing batch fails on was tried first and dropped (follow-up 1). Deployed 2026-11-24 |
| (no commit) | Bot Fight Mode switched off for `tortok.app` | it challenged GitHub's runners, so every scheduled smoke run failed; a manual run passed afterwards. `backend.md` Constraints says why it stays off |

## Open follow-ups (priority-ordered)

### 1. The poller: one failure still fails a whole batch (a design, medium)

The poller takes the 25 longest-due posts, and a batch that throws stays
due. One that fails every time is retried for ever, and no post behind it
is checked again. `/health` says `stalled` after four failures and the
feed drops the unchecked posts within two days, but unlike the stream's
case nothing ages the cause out (`backend.md`, Deferred).

The one cause found is fixed in PR #60: Bluesky's AppView answers 414 to
a request URL past about 8,000 characters, and 25 posts with
512-character record keys make one of 14,780. The requests are now sized
to fit. No such post was in production.

What is left is the shape, not a known trigger:

- A failed `getProfiles`, or one author's row the database refuses, fails
  the whole batch.
- No post has a retry time of its own, so whatever fails stays at the
  head of the queue.

Tried on 2026-11-24 and dropped: checking a failing batch in halves and
deleting the post that fails alone. Review ran it, and it deletes good
posts:

- With `getProfiles` failing and `getPosts` working, the posts of authors
  due a re-read fail alone, and go.
- Against an AppView failing 30% of its requests it deleted seven good
  posts in twelve simulated hours, with `/health` saying ok.
- A deleted post doesn't come back. Decision 0025 turned down deleting
  unread posts for the same reason.

The direction that review pointed to, not built:

- A retry time per post, in its own column, that orders the queue and
  doubles with each failure. `bridge_next_check_at` stays as it is, so
  the feed's rule (Decision 0025) still holds, and a post is only ever
  deleted by age.
- `refreshAuthors` taking a failure per author: those authors stay
  unread and their posts unchecked this round, and everyone else is
  checked.

It changes the queue's order and adds a column, so it wants a plan entry
before code. Two smaller things of the same kind: native ingest's
backfill stops at a record whose insert fails, so that account's
backfill stops there at every boot; and a subscription with no saved
cursor doesn't retry a failed event, because it reconnects at the live
end.

One more for the same design, found on 2026-11-27: the bridge qualifies
posts whose video Bluesky doesn't serve, because the AppView returns
them like any other. One account had 134 qualified posts and none of
that day's sampled ones played (`backend.md`, Deferred). The poller
already visits every post, so fetching the playlist there, or before a
post qualifies, is where a check would go. It is a request to
`video.bsky.app` per post, so it wants the same plan entry.

### 2. The database grows with the bridge (resized; a design left)

`backend.md` (Constraints) has the facts. In short:

- `tortok-db` was resized on 2026-11-24, from 256 MB and a 1 GB volume to
  512 MB and 3 GB. The database (302 MB) now fits in memory, and the
  volume is 15% full. Before, Fly's health check for it failed on I/O
  wait a few times an hour, and the volume was filling at about 20 MB a
  day towards the 90% at which Fly Postgres turns read-only.
- That buys months. `posts` levels off 30 days after switch-on
  (2026-12-13); `bridge_authors` and `labels` never do.
- The cause of most of the writing: every check rewrites the whole
  `posts` row and an entry in each of its indexes, because
  `bridge_next_check_at` is indexed. 2.8 million such updates in eight
  days.

What to look at: `fly ssh console -a tortok-db -C "df -m /data"` now and
then (415 MB used on 2026-11-24), and `fly checks list -a tortok-db`.

Left to build: a narrow table for the poller's queue, so a check stops
rewriting the `posts` row; and pruning `bridge_authors` rows with no
posts and `labels` for subjects no longer held. It belongs with
follow-up 1's retry time per post: both change the poller's queue.

### 3. Watch the bridge in production (ongoing, small)

What happened, in order. `backend.md` (atproto ingest) and the CHANGELOG
hold what lasts of it.

The silent connection, 2026-11-19 and 20:

- Jetstream closed the bridge's socket at 16:10 UTC on the 19th. The
  client reconnected, got its 5-second rewind, and then nothing: the
  connection stayed open and silent for 26 hours. Native ingest, on its
  own socket, was fine.
- The first restart replayed the gap faster than the bridge could take
  it. The client reconnected every two seconds and lost 25 to 45 percent
  of the events it replayed, so the bridge was switched off on the
  machine for an hour (`fly machine update --env BRIDGE_ENABLED=false`).
- With PR #57 deployed, the cursor was put back to the stall point and
  the gap replayed again: 29 hours of posts in 2 hours 7 minutes, with
  no queue overflow. The hours that had been missing now hold what the
  same hours held on the three days before (17:00 on the 19th: 1,784,
  against 1,562, 1,847 and 1,735; the first replay had left 1,026).
- The replay left 35,000 posts waiting for their first check, and the
  feed ran hours behind until the poller had worked through them, two
  hours after the replay ended.

The post that couldn't be stored, 2026-11-22 to 24:

- At 12:18 UTC on the 22nd a Bluesky post with a NUL in its text made
  Postgres refuse the insert. The bridge tried that one event 83,615
  times, a connection every second and a half, and indexed nothing.
- At 00:30 UTC on the 24th Jetstream no longer held the event, and the
  bridge went on by itself. It replayed the 36 hours in 47 minutes. The
  12 minutes that had aged out with the event (12:18 to 12:30 on the
  22nd) are lost.
- The smoke check failed all 139 runs in that stretch with `bridge is
  stalled`. Nothing acted on it: the alert was an email to the repository
  owner, and no session was running. Since 2026-11-24 a failing check
  opens one issue labelled `smoke-failure`, and that starts a Claude Code
  scheduled task ("tortok production watch", in the owner's claude.ai
  account) which looks into it and comments on the issue. The same task
  runs daily at 07:00 UTC. It has no access to Fly.
- PR #58 fixed it on the 24th.

What to look at, and what isn't covered yet:

- **Old logs.** `fly logs` shows only the last 100 lines. Fly's Grafana
  (`fly-metrics.net`, Explore, the VictoriaLogs source) keeps days of
  them, searchable; that is where the NUL was found.
- A `skipped` line in the log names an event the stream gave up on after
  three failures. More than 20 in an hour and the stream stops and says
  `stalled`: then the fault is in the service.
- `/health` reports `ingest` and `bridge`, and the smoke check fails when
  either is `stalled`. It passes `bridge: off`: nothing compares the
  machine's `BRIDGE_ENABLED` with `fly.toml`. A deploy resets it from
  `fly.toml`.
- Jetstream holds about 36 hours of events (36.3 measured on 2026-11-20;
  the second stall outlasted it by 12 minutes). A stall left longer
  loses posts for good.
- A `Query read timeout` or `connection timeout` in the log. One query
  timed out during the first replay and four connection attempts in the
  35 hours after it; each cost the stream about 2 s. They go with the
  database's I/O pressure (follow-up 2).
- On 2026-11-24 the bridge held 224,740 posts, 41,000 of them served,
  and about 26,000 from each day.
- Off switch: `BRIDGE_ENABLED = "false"` in `backend/fly.toml`, then
  deploy.

Drop this item once the bridge has run cleanly for a while.

### 4. A "Create a Bluesky account" button (a spike step, then a decision)

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

- Follow-up 1 → `backend.md` has it under Deferred, with why deleting
  was dropped; the design wants a plan entry in the Phase 3 plan.
- Follow-up 2 → `backend.md` (Constraints and Deferred) has the facts
  and the resize. The design part wants a plan entry, or a decision if
  the queue moves to its own table.
- Follow-up 3 → both incidents and their fixes are in `backend.md` and
  the CHANGELOG; the counts are a snapshot and go with the handoff.
- Follow-up 4 → the spike record and Decision 0026 hold it; once the
  decision is accepted, the Phase 3 plan gets the build as a unit.
- Critical context: the two iOS notes go when prebuild is run; the test
  notes are already in code comments.
- Then `git rm docs/handoffs/bluesky-bridge-handoff.md`, once the bridge
  has run cleanly for a few days and the sign-up step is done or
  rescheduled.
