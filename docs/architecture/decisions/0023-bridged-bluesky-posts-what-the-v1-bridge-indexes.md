# Decision 0023 — Bridged Bluesky posts: what the v1 bridge indexes

**Status:** Proposed. Revises, for bridged posts in v1, [Decision 0010](0010-bluesky-video-bridge.md) items 5 (opt-out) and 6 (labelers), and [Decision 0013](0013-moderation-strategy.md) items 1, 4 and 11 (labels annotate; the default labeler set; NSFW visibility). Both stay Accepted for everything else.

**Current architecture:** [Federation](../federation.md).

**TL;DR.** In the context of the 2.5D bridge, facing Bluesky video where about a fifth to over a quarter of posts are NSFW and a client with no label preferences or age gate, we chose to drop NSFW-labelled and opted-out bridged posts at the AppView while storing every label we see in a general `labels` table, to keep bridged supply safe now without closing off per-user label filtering and other labelers later, accepting that dropped posts can't be shown even if a user later opts in.

## Context

What the code did on 2026-11-12: the AppView indexes only `app.tortok.video.post` records. `posts` already has the bridge's columns (`collection`, `video_cid`, `hls_url`), but nothing writes `app.bsky.feed.post` rows, and the feed serves only rows with a magnet. The client plays only torrents. It has no label handling, no NSFW setting and no age verification.

Decision 0010 committed the bridge to honour opt-out "via the same self-labeling conventions used by existing atproto bridges (e.g., the Bridgy Fed `!no-bridge` pattern)" and to subscribe to Bluesky's default labeler set. Decision 0013 made labels annotations, which clients hide or show per the user's preferences, with NSFW hidden by default and unhidable in the UK without age verification. Unit 2.5's first attempt (tag `unit-2.5-attempt-1`) instead dropped NSFW bridged posts at the AppView. It used record self-labels at index time and the labels on Bluesky's `getPosts` responses every 30 minutes, it recorded only a status per post, and it never built opt-out.

The [spike on labels](spikes/bluesky-labels-on-bridged-video-posts.md) (2026-11-12) sampled 3,000 video posts from one and three days earlier. It found:

- **NSFW share:** 18% (day-old) and 28% (three days old) of video posts were NSFW, nearly all adult content.
  - Only about a quarter of it carried a self-label on the record itself, which is all a bridge sees at index time.
  - Bluesky's moderation labeler supplied most of the rest, after posting.
  - Among posts passing the first attempt's engagement thresholds, NSFW rose to 29% and 43%.
- **Labeler coverage:** Bluesky's labeler was the only one that appeared. The public AppView applied it with or without the `atproto-accept-labelers` header.
- **Opt-out:** there is no `!no-bridge` label.
  - About 10% of posts came from accounts with the `!no-unauthenticated` self-label. Bluesky asks atproto apps to honour it wherever they show content to logged-out users, and tortok's feed serves logged-out users.
  - Bridgy Fed's convention is opt-in, plus `#nobridge` in the bio or display name.
- **Supply:** after every filter, about 60–210 posts an hour remained.

## Decision

1. **NSFW bridged posts are not indexed in v1.**
   - **At index time:** a bridged post whose record carries a label in the configured NSFW set is not written to `posts`.
   - **Labelled later, or by its author's profile:** these labels arrive with the engagement poller (item 3), which deletes such posts. The feed serves a bridged post only after the poller has checked it, so neither kind is ever served.
   - **The set:** `porn`, `sexual`, `nudity`, `graphic-media`, `gore`, plus `!hide` and `!takedown`. It is configuration, not code.
   - **How long:** this holds until the client has label preferences and Decision 0013's age gate. It doesn't apply to native posts, which no labeler covers yet.
2. **Every label the AppView sees is stored, whatever happens to the post.**
   - **The table:** a `labels` table keyed by subject URI, labeler DID and value, with the negation flag and the label's timestamp.
   - **What it holds:** labels on bridged posts and on their authors, and later labels from any other source.
   - **Policy on top:** dropping NSFW (item 1) is a policy over this table, so a later client-side filter is a policy change plus a `labels` field in the feed, not a data-model change.
3. **Labels for bridged posts come from two places:**
   - each record's self-labels, read from Jetstream at index time;
   - the post and author labels on `app.bsky.feed.getPosts` responses, which the engagement poller re-reads periodically.
   No labeler subscription is run in v1. The label source sits behind the same `labels` writes as any later source. A `com.atproto.label.subscribeLabels` client for tortok's own labeler (Decision 0013 item 5), or for third-party labelers, adds another writer. Other labelers on bridged posts may come through `atproto-accept-labelers` instead; that is unverified.
4. **Opt-out replaces Decision 0010 item 5's convention.** A bridged author is excluded, and their indexed posts deleted, when either holds:
   - their profile carries a non-negated `!no-unauthenticated` self-label;
   - their bio or display name contains `#nobridge`.
   The check repeats with the poller, because both signals can be added after posting. An `app.bsky.actor.contentVisibilityDeclaration` with `hideFromAlgorithmicRecommendations` keeps an author out of any ranked feed, but not out of chronological or author views. Opt-out is tested in CI, as `release-plan.md` requires for Beta.
5. **Curation.** A bridged post reaches the feed only once it passes engagement thresholds: initially 50 likes, 10 reposts, or an author with 5,000 followers, as in the first attempt. A post that hasn't qualified within 7 days is dropped. The thresholds are configuration, and they apply after the NSFW and opt-out filters, never instead of them.

## Alternatives considered

- **Index NSFW and label it, with the client hiding it (Decision 0013 as written)** — rejected for v1. The client has no label preferences or age gate, so building them would come first. More than a quarter of bridged posts would then rely on client-side hiding working on every platform, and one rendering bug would show adult content to every user.
- **Subscribe to Bluesky's labelers directly** — rejected for v1. The spike found Bluesky's moderation labeler to be the only one present, and `getPosts` already carries its labels. A subscription adds a second long-lived stream on a small machine for no extra coverage today. It remains the route for native posts.
- **Keep only a status per post, as the first attempt did** — rejected because a later move to label-based filtering, or a policy change, would then mean re-fetching every label.
- **Honour only Bridgy Fed's conventions** — rejected because `#nobridge` appeared on none of about 2,700 sampled authors, while `!no-unauthenticated` covers about 10% of posts and is the signal Bluesky asks apps to respect.

## Consequences

- **Safe supply:** the bridged feed contains no labelled NSFW, and creators who asked not to be shown off Bluesky aren't shown. About 60–210 posts an hour remain, which fills a cold-start feed.
- **No catch-up:** dropped posts are gone. If users can later opt in to NSFW, only posts indexed after that change can be shown, because Jetstream replays only a few days.
- **A window of exposure:** NSFW that no one has labelled yet can reach the feed between indexing and the next poll. Applying the thresholds first narrows this, because a post needs time to gather engagement, and by then Bluesky's labeler has usually acted.
- **Reusable for native posts:** the `labels` table and the separate label source carry over to native posts and tortok's own labeler, but `getPosts` doesn't: Bluesky's AppView doesn't index `app.tortok.video.post`.
- **A gap for native takedowns:** the blob route on `appview.tortok.app` is cached by Cloudflare for a year, so a takedown or label on a native post needs a cache purge as well. Bridged posts don't need one, because their thumbnails and video come from Bluesky's CDN.
- **Corrected documentation:** Decision 0010's `!no-bridge` example was wrong. This record names the conventions to use.

## Walk-back options

- **When the client has label preferences and the age gate:** stop dropping, serve each post's labels in the feed, and let the client hide by preference, per Decision 0013. The stored labels make this a policy change.
- **If a labeler other than Bluesky's matters:** add it through `atproto-accept-labelers` if Bluesky's AppView carries it, or through `subscribeLabels`, as another writer to `labels`.
- **If the thresholds leave too little supply, or too much NSFW gets through before labelling:** change the thresholds, or hold new bridged posts back for a minimum age before they're shown.
- **If atproto standardises a bridging or data-reuse consent record:** honour it in addition to item 4.

## Links

- [Spike: Bluesky labels on bridged video posts](spikes/bluesky-labels-on-bridged-video-posts.md) — the measurements this rests on.
- [Decision 0010](0010-bluesky-video-bridge.md) — the bridge; items 5 and 6 revised here.
- [Decision 0013](0013-moderation-strategy.md) — moderation; items 1, 4 and 11 revised here for bridged posts in v1.
- [Decision 0017](0017-appview-postgres-is-a-rebuildable-index.md) — `posts` and `labels` are a rebuildable index.
- [`release-plan.md`](../../plans/release-plan.md) — Beta requires the bridge live with opt-out tested in CI.
