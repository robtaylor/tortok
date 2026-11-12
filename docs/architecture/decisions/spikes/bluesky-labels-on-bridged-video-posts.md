# Spike — Bluesky labels on bridged video posts

**Status:** Resolved (2026-11-12) — PARTIAL; self-labels plus periodic `getPosts` labels cover moderation without a labeler subscription, but NSFW policy, opt-out and stream load still need a decision and a measurement.

## Question

Can the 2.5D bridge decide what to index from signals it already gets (each record's self-labels on Jetstream, and the labels on Bluesky's public AppView responses), without subscribing to labelers itself?

## Why this is in question

[Decision 0010](../0010-bluesky-video-bridge.md) item 6 and [Decision 0013](../0013-moderation-strategy.md) item 4 commit tortok to Bluesky's default labeler set. Unit 2.5's first attempt (tag `unit-2.5-attempt-1`, commit `150dd96`) never subscribed to a labeler. It read self-labels at index time and, every 30 minutes, the labels in `app.bsky.feed.getPosts` responses. It also dropped NSFW posts instead of labelling them, which Decision 0013 items 1 and 11 don't allow: there, labels annotate and the client hides or shows. Its cleanup pass found 2,669 of 14,060 bridged posts (19%) NSFW. Before writing the decision that 2.5D needs, we need to know:

- what those two sources catch, and from which labelers;
- what opt-out signal creators actually use;
- whether the first attempt's engagement thresholds leave a usable feed;
- how big the stream is, for the production machine.

## Approach

- **Q1. What labels do video posts carry, and from whom?**
  - `scripts/bsky-label-sampler.mjs` replays Jetstream's `app.bsky.feed.post` stream from 24 h and from 72 h ago, keeps the video posts (`app.bsky.embed.video`, alone or in `recordWithMedia`), and records each record's self-labels.
  - For the same posts it calls `app.bsky.feed.getPosts`, once plain and once with `atproto-accept-labelers` naming Bluesky's moderation labeler, and `app.bsky.actor.getProfiles` for the authors.
  - It tallies labels by value and by source (the post's own author, Bluesky's labeler, or any other), and NSFW coverage by source. "NSFW" here is two sets: adult (`porn`, `sexual`, `nudity`) and graphic (`graphic-media`, `gore`, which Bluesky files under violence). `!hide` and `!takedown` count as hidden.
  - `--summarize <file>` re-derives every figure below from a saved sample.
- **Q2. What opt-out signal do creators use?** Desk research on Bridgy Fed, the `!no-unauthenticated` self-label and atproto's data-reuse proposals, checked against what the sample's profiles carry.
- **Q3. Do the first attempt's thresholds leave enough?** 50 likes, 10 reposts or 5,000 author followers, measured on posts at least a day old.
- **Q4. How heavy is the stream, and is the HLS URL derivable?** Bytes and video posts per hour, and whether each post view's `playlist` is `https://video.bsky.app/watch/<did>/<video cid>/playlist.m3u8`.

## Decision matrix

| Outcome | Means | Action |
|---|---|---|
| Self-labels plus `getPosts` labels catch NSFW reliably | No labeler subscription is needed for v1 | A new decision revises 0010 item 6 and 0013 item 4 for bridged posts |
| `getPosts` misses a labeler that matters | Bluesky's AppView doesn't carry the default set for us | 2.5D subscribes to that labeler (`com.atproto.label.subscribeLabels`) |
| Thresholds leave too few posts | Cold-start supply is thin | Lower them; record the values in the decision |

## Findings

Two samples, taken on 2026-11-12 with `scripts/bsky-label-sampler.mjs`. Each covers about 31 minutes of network time:

- **Day-old sample:** 2,000 video posts, from posts made about 24 h before.
- **Three-day-old sample:** 1,000 video posts, from about 72 h before.

The raw data stayed outside the repo; only the aggregates below are recorded. The two windows fall at different times of day, so the differences between them mix the age of the posts with the daily pattern.

| | Day-old | Three days old |
|---|---|---|
| Video posts per hour of network time | 3,899 | 1,957 |
| Share of all created posts with a video | 2.2% | 1.9% |
| Deleted since (missing from `getPosts`) | 0.9% | 1.6% |
| Adult self-label on the record (Jetstream) | 4.2% | 7.1% |
| Adult label in the `getPosts` view (self or labeler) | 16.9% | 26.9% |
| … from Bluesky's labeler only, with no self-label on post or profile | 11.3% | 13.4% |
| Adult by any source, author's profile labels included | 17.6% | 27.5% |
| Graphic by any source | 0.9% | 1.7% |
| NSFW (adult or graphic) by any source | 17.9% | 27.6% |
| NSFW among posts passing the first attempt's thresholds | 28.8% | 42.9% |
| `!hide` or `!takedown` | 3 posts | none |
| Author has `!no-unauthenticated` (or `#nobridge`) | 9.4% | 10.0% |
| Portrait or square | 53.9% | 52.7% |
| Passes the first attempt's thresholds | 15.6% | 13.3% |
| `playlist` equals `https://video.bsky.app/watch/<percent-encoded did>/<video cid>/playlist.m3u8` | all 1,981 surviving | all 984 surviving |

- **Q1. Labels come from two places only:**
  - creators' own self-labels;
  - Bluesky's moderation labeler (`did:plc:ar7c4by46qjdydhdevvrndac`), mostly `porn` and `sexual`, plus `!hide` on 3 posts.
  - Asking `getPosts` with or without `atproto-accept-labelers` naming that labeler returned identical labels for every post, so the public AppView applies it by default. No label from any other labeler appeared on any post or profile. Whether Bluesky's default set holds others is unverified.
  - Record self-labels alone miss most adult content. Bluesky's labeler, together with self-labels on the author's profile, raises the share four-fold, and the share is higher in the older sample.
  - NSFW is concentrated among popular posts, so the engagement thresholds raise its share instead of lowering it.
- **Q2. Opt-out signals.**
  - There is no `!no-bridge` label; Decision 0010's name for the convention is wrong.
  - Bridgy Fed is opt-in for Bluesky users (follow `@ap.brid.gy`; block it to opt out). A `#nobridge` hashtag in the bio or display name always blocks bridging ([docs](https://fed.brid.gy/docs), `models.py`). None of the 2,700 authors sampled had it.
  - The signal creators actually use is `!no-unauthenticated`, an account-wide self-label on the profile record. Bluesky's docs recommend that atproto apps respect it wherever they show content to logged-out users ([visibility preferences](https://bsky.network/docs/about-bluesky-content/visibility-preferences/)), and Bluesky's own embeds refuse such posts. About 10% of posts came from such accounts.
  - `app.bsky.actor.contentVisibilityDeclaration` (`hideFromAlgorithmicRecommendations`) asks to be left out of ranked feeds.
  - Atproto's "User Intents" proposal (0008) is an undeployed draft.
- **Q3.**
  - Every filter together (still exists, not opted out, not NSFW or hidden, portrait or square, passes the thresholds) leaves about 210 posts per hour in the day-old sample and about 60 per hour in the three-day-old one. That is roughly 1,500 to 5,000 posts a day.
  - Without the thresholds, the same filters leave about 680 to 1,630 posts per hour.
- **Q4.**
  - The stream's JSON comes to about 96–162 MB and 110,000–190,000 events per hour, for every `app.bsky.feed.post` event. The bridge parses all of it to find the 2% with video. CPU on the production machine is still unmeasured.
  - The HLS URL can be built from the DID and the video blob's CID, as `posts.video_cid` assumes.

## Outcome

**PARTIAL.** For moderation, the bridge needs no labeler subscription of its own: record self-labels at index time, plus the labels on periodic `getPosts` calls, cover the only labeler that appears, Bluesky's. The periodic re-check is required, not optional: only about a quarter of the adult content carries a self-label on its record, which is all the bridge sees at index time. Most of the rest is labelled by Bluesky's labeler, which acts after the post is made, and the share is higher in the older sample.

What remains for the decision that 2.5D needs:

- **Drop or label NSFW.** Whether bridged NSFW is dropped at the AppView, or indexed and labelled for the client to hide per [Decision 0013](../0013-moderation-strategy.md).
- **Opt-out.** Honour `!no-unauthenticated` and `#nobridge` (author labels come with `getPosts` and `getProfiles`, and profile records are on Jetstream), and `contentVisibilityDeclaration` in ranked feeds.
- **Thresholds.** The first attempt's numbers leave enough supply, but they concentrate NSFW, so labelling must be applied before ranking.
- **Load.** The CPU cost of parsing the full post stream on the production machine is still to measure.
