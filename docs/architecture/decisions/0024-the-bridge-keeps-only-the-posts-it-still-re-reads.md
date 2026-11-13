# Decision 0024 — The bridge keeps only the posts it still re-reads

**Status:** Proposed. Would revise how the opt-out check repeats in item 4 of [Decision 0023](0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md), and settle what the ages in its item 5 count from. Adds a limit on how long a bridged post is kept. 0023 stays Accepted (partial) for everything else.

**Current architecture:** [Federation](../federation.md#bluesky-bridge); the poller's mechanics are in [backend](../backend.md#engagement-poller).

**TL;DR.** In the context of the Bluesky bridge's repeat checks, facing opt-outs and labels that went unseen once a post was 30 days old and exclusions that never lifted, we chose to delete a bridged post when its checks end, count its age from when the bridge indexed it, and re-read an excluded author when they next post, to honour an opt-out for as long as a post is served without a second schedule, accepting that bridged posts older than 30 days leave the feed.

## Context

What the code did on 2026-11-13: the engagement poller re-read each bridged post on a schedule that slowed from every 15 minutes to once a day. It re-read an author's profile at most once a day, and only while checking one of their posts. Once a served post's `createdAt` was more than 30 days old (`BRIDGE_RECHECK_DAYS`), the poller stopped checking it, and the post stayed in `posts` and in the feed. The firehose indexed nothing by an author it held as excluded.

Decision 0023 item 4 says the opt-out check "repeats with the poller, because both signals can be added after posting". Its item 1 has the poller delete posts that are labelled NSFW after indexing. Writing the bridge's integration tests (Phase 3 plan, 2.5D step 22) showed three places where the code stopped short of that:

- After 30 days nothing was re-read. An author who opted out once all their posts had passed that age stayed in the feed until they posted another video. A label that Bluesky's moderation put on a post after day 30 never reached it.
- A backdated post skipped its checks. `createdAt` is whatever the author's client wrote. A post dated more than 30 days back, from an author with 5,000 followers, qualified on its first check and was never checked again.
- Exclusion was one-way. Nothing re-read an excluded author, so one who removed `#nobridge` or `!no-unauthenticated` stayed out.

Production on 2026-11-13, five hours after the bridge was switched on:

- 7,639 bridged posts were indexed, by 5,554 authors. 963 of them were served, by 645 authors. `bridge_authors` held 6,929 authors.
- About 190 posts qualified an hour, so the served set was growing by about 4,600 posts a day.
- No post was past either age limit yet. Two were dated more than a day before the bridge indexed them.

[`release-plan.md`](../../plans/release-plan.md) makes opt-out, tested in CI, a criterion for Beta.

## Decision

1. **A bridged post is deleted when its checks end.** The bridge keeps a post for 30 days (`BRIDGE_RECHECK_DAYS`, still configuration), checks it at least once a day for all of that time, and deletes it at the first check after it. No bridged post stays in `posts` without a check due.
   - Every author with a post in the feed is therefore re-read about once a day, by the profile refresh that already goes with a post's check. An opt-out or a label added at any time takes the post out within a day or two.
2. **A post's age counts from when the bridge indexed it,** not from the record's `createdAt`. That holds for the check schedule, for the 7 days a post has to qualify (Decision 0023 item 5), and for the 30 days of item 1. The feed still sorts by `createdAt`.
3. **An excluded author is re-read when they next post a video,** at most once a day. If the bridge's last read of that author is more than a day old, the firehose indexes the new post as an unserved candidate, like any other author's. The poller's first check re-reads the author, then deletes the post or lets it carry on.
   - Posts deleted when the author was excluded don't come back.
4. **Authors get no schedule of their own.** A `bridge_authors` row is refreshed only through a post's check, as before.

## Alternatives considered

- **Re-read authors on their own schedule**, a second queue over `bridge_authors`, as the plan's note first suggested — rejected because the table only grows (6,929 authors in five hours), and the work with it. It would also leave a post's own labels unread after day 30.
- **Never stop checking a served post** — rejected because it gives the result of item 1 at a cost that grows by about 4,600 posts a day for good. Those checks would go on posts about 140,000 places down a chronological feed.
- **Re-read excluded authors on a timer** — rejected because excluded authors accumulate too (about 10% of posts in the spike came from `!no-unauthenticated` accounts), and a re-read changes nothing until the author posts again, since their earlier posts are gone.
- **Restore an author's earlier posts when they opt back in** — rejected for v1. The rows are deleted and Jetstream replays only a few days, so it needs a backfill from each author's repo.
- **Leave the gap and document it** — rejected because item 4 of Decision 0023 promises a check that repeats, and opt-out is a Beta criterion. A late opt-out is the case that promise covers.

## Consequences

- An opt-out holds for as long as a post is served. A late opt-out, account label or post label is seen within a day or two, whatever the post's age.
- Bridged posts older than 30 days leave the feed, and `GET /videos/:id` answers 404 for them. At the rate measured above, a 30-day-old post is about 140,000 posts down the feed.
- `posts` stops growing. It levels off at about 30 days of served posts plus up to 7 days of candidates. Without the limit it would grow by about 1.7 million served rows a year. These figures come from five hours of production.
- A post dated in the past gets the same checks as any other, so `createdAt` can't be used to skip them. A backdated post still sorts by its `createdAt`, deep in the feed.
- An excluded author who posts often costs one write and one delete a day.
- An edit restarts a post's clock, because re-indexing a changed record resets `indexed_at`. Bluesky has no edits yet.
- A label that a labeler withdraws still keeps an author out. The poller only adds labeler labels. If Bluesky's AppView drops a withdrawn label from its responses without sending a negation, the stored label stays live. That behaviour hasn't been checked.
- The bridge's tests gain cases for a post reaching 30 days, an opt-out late in a post's life, a backdated post, and an author who opts back in.
- On deploy, one statement gives every bridged row a check date again. Production had none without one on 2026-11-13.

## Walk-back options

- **If 30 days proves too short**, because people look for older bridged posts or supply runs thin: raise `BRIDGE_RECHECK_DAYS`. Each kept post costs one check a day.
- **If old bridged posts have to stay**, for example once users can like or save them: keep them on a slower schedule, weekly for example. Never keep one with no schedule.
- **If withdrawn account labels keep authors out wrongly:** on a re-read, drop the stored labels of the labelers the AppView applies when its response no longer carries them.
- **If re-reading on the next post is too slow for authors who opt back in:** re-read excluded authors on a timer, for a bounded time after their exclusion.

## Links

- [Decision 0023](0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md) — what the bridge indexes; its item 4's repeat check is revised here, and the ages in item 5 settled.
- [Decision 0010](0010-bluesky-video-bridge.md) — the bridge.
- [Decision 0017](0017-appview-postgres-is-a-rebuildable-index.md) — `posts` is a rebuildable index.
- [Phase 3 plan](../../plans/phase-3-atproto.md) — the open note under 2.5D step 22, which this answers.
- [`release-plan.md`](../../plans/release-plan.md) — Beta requires opt-out tested in CI.
