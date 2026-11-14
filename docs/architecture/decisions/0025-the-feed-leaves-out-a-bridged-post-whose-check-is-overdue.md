# Decision 0025 — The feed leaves out a bridged post whose check is overdue

**Status:** Accepted (2026-11-14). Adds a rule for what the feed serves while the bridge's checks aren't happening. [Decision 0023](0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md) and [Decision 0024](0024-the-bridge-keeps-only-the-posts-it-still-re-reads.md) stay in force.

**Current architecture:** [Federation](../federation.md#bluesky-bridge); the feed's rule is in [backend](../backend.md#videos-and-feed).

**TL;DR.** In the context of the Bluesky bridge's posts in the feed, facing posts that stayed served while nothing re-read them, with the bridge switched off or its poller failing, we chose to leave a bridged post out of the feed once its check is more than a day overdue, so that no post is served more than two days after the bridge last read it, whatever state the poller is in, accepting that bridged posts drain out of the feed when the poller stops for a day or more.

## Context

What the code did on 2026-11-14: the feed served a bridged post when its `bridge_qualified_at` was set, and looked at nothing else. The engagement poller re-read each bridged post on a schedule, half the post's age, between 15 minutes and a day. Each row carried the time its next check was due, `bridge_next_check_at`. On a label, a deletion or an opt-out, the poller deleted the row (Decisions 0023 and 0024). It read an author's profile, where `#nobridge` is found, at most once a day, at one of their posts' checks.

Decision 0024's first consequence says "An opt-out holds for as long as a post is served". That assumed a running poller. Review of its build (2026-11-13) found two cases without one:

- The bridge was switched off. `BRIDGE_ENABLED=false` stopped the firehose and the poller, and was the documented off switch. Posts already qualified stayed in `posts` and in the feed.
- The poller was failing, because Bluesky's AppView was unreachable or refusing its requests, or through a fault of its own. It retried with a backoff of up to 30 minutes, and the posts stayed served meanwhile.

In both, an author who opted out stayed in the feed until the poller next ran, however long that took. So did a post Bluesky labelled NSFW.

Production on 2026-11-13 held 8,023 bridged posts and served 1,001 of them, with the poller running. [`release-plan.md`](../../plans/release-plan.md) makes opt-out, tested in CI, a criterion for Beta.

## Decision

1. **The feed serves a bridged post only while its check is less than a day overdue.** It compares the row's `bridge_next_check_at` with the time of the request. A post whose check fell due more than 24 hours earlier is left out of `GET /videos/feed`, and `GET /videos/:id` answers 404 for it.
   - A served post has therefore been read from Bluesky within its check interval plus a day. That is two days at most, and about a day for a post in its first hours.
   - Labels come with every read of a post, `!no-unauthenticated` among them, so they share that bound. `#nobridge` comes from the profile, which can be a day older than the post's last read, so its bound is three days.
   - The day is a constant in the feed's code, not configuration.
2. **The row stays.** This rule deletes nothing. When the poller reads the post again it sets a new check date, and the post is served again. If that read finds a label, a deletion or an opt-out, the poller deletes it as before.
3. **The rule reads the row, not the settings.** It doesn't look at `BRIDGE_ENABLED`, or at whether a poller is running. A bridged row with no check date isn't served.

## Alternatives considered

- **Leave bridged posts out whenever `BRIDGE_ENABLED` is false** — rejected because it covers the switch and nothing else. A poller that is on and failing leaves the same gap. It also ties what the feed serves to a setting: the end-to-end stack serves a seeded bridged post with no bridge running.
- **Serve only posts read in the last two days**, by `bridge_checked_at` — rejected because that window has to be kept longer than the slowest step of the check schedule, by hand. Decision 0024's walk-back to weekly checks would empty the feed between checks. It also gives the newest posts the full two days, and late labels land on the newest posts.
- **Delete a post whose check is overdue** — rejected because a day's outage at Bluesky's AppView would cost the bridge everything it serves. Jetstream replays only a few days, so most of it wouldn't come back.
- **Accept the gap and document it** — rejected because opt-out is a Beta criterion, and the off switch is what an operator reaches for when bridged content has gone wrong. It left that content up.

## Consequences

- A label, a deletion or a `!no-unauthenticated` opt-out goes unseen for two days at most, whether or not the poller runs, and `#nobridge` for three. Decision 0024's first consequence no longer assumes a running poller.
- Switching the bridge off takes bridged posts out of the feed between one and two days later, the newest first, because their checks come round soonest. It isn't immediate. Deleting the bridged rows is: `posts` is a rebuildable index (Decision 0017), though only the last few days of them would come back.
- An outage of under a day changes nothing a viewer sees. After a day the feed thins, newest posts first. On 2026-11-14 the first pages of the feed were all bridged posts, so they would fall back to the five native test clips. When the poller catches up, the posts return.
- Every feed read carries one more condition. The feed's index can't hold it, because it moves with the clock. Review measured it on a laptop running Postgres 18, with 140,000 served posts and 250,000 candidates, the size Decision 0024 expects:
  - While the poller runs, nearly every row passes, and a page costs about 0.5 ms, as before.
  - Once every bridged post is overdue, a page has to pass over all of them and costs 40 to 160 ms.
- The feed compares against the AppView process's clock, which is also the clock the poller writes check dates from.
- At boot, a bridged row with no check date gets one at the epoch, not at the time of the boot, so it waits for the poller unserved. Production had no such row on 2026-11-13.
- The end-to-end stack runs no poller, so its seeded bridged post has a check date of `infinity`.
- A local database with bridged rows, run with the bridge off, shows none of them after two days.
- The bridge's tests gain a stopped poller: posts that leave the feed within two days, and return once read unless their author opted out meanwhile. The feed and the bridge share one clock in those tests. Another test holds the two-day bound to the constants behind it.

## Walk-back options

- **If posts drop out of the feed while the poller is only behind:** lengthen the day, or scale it with the queue's delay.
- **If the off switch has to act at once:** also leave bridged rows out when `BRIDGE_ENABLED` is false, and give the end-to-end stack another way to serve its seeded post.
- **If three days is too long for `#nobridge`:** have a post's check read its author again whenever that read would lapse before the post's next check.
- **If a day is too long for the newest posts:** scale the allowance with the post's check interval, so a post checked every 15 minutes leaves within the hour.
- **If feed reads are slow while the poller is stopped:** put the check date in the feed's index as an expression key, so the condition is answered from the index (7 to 9 ms in the same measurement). Or clear `bridge_qualified_at` on rows overdue by a week, which takes them out of the index.

## Links

- [Decision 0024](0024-the-bridge-keeps-only-the-posts-it-still-re-reads.md) — every bridged post has a check due; this record says what the feed does when that check doesn't happen.
- [Decision 0023](0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md) — what the bridge indexes, and opt-out.
- [Decision 0010](0010-bluesky-video-bridge.md) — the bridge.
- [Decision 0017](0017-appview-postgres-is-a-rebuildable-index.md) — `posts` is a rebuildable index.
- [`release-plan.md`](../../plans/release-plan.md) — Beta requires opt-out tested in CI.
