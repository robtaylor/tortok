# Open problem: How does a user's feed adapt to them?

**Status:** Unresolved. Raised 2026-11-12, after Decision 0023 settled what the bridge indexes.
**Must resolve by:** Ramp graduation in [`release-plan.md`](../../plans/release-plan.md). Beta can ship the curated feed that is the same for everyone, but keeping engine creators' audiences coming back needs some personalisation. The decision about which signals the client records should come sooner, in Unit 2.5D, so the data exists when ranking arrives.
**Blocks:** any personalised or ranked feed; the client's local signal store; predictive prefetch.
**Related decision records:** Decision 0010 (the bridge), Decision 0013 (moderation), Decision 0017 (the AppView's database is a rebuildable index), Decision 0022 (clients learn sources from their AppView), Decision 0023 (what the bridge indexes).
**Related open problems:** `view-counting.md` (the signals, and what tortok may hold); `signed-out-feed.md` (what signed-out users get).

## The problem

Today's feed is the same for everyone: every indexed post, newest first (`backend/src/services/feedView.ts`). 2.5D adds bridged Bluesky posts that pass engagement thresholds, which is curation by popularity, not personalisation. Decision 0006's Phase 4 names "feed ranking" without saying what it is, and no decision says how a user's feed should respond to what they watch.

Short-video apps keep people through ranking. TikTok is widely reported to rank on watch time and completion, re-watches, shares (DMs above likes), saves, comment depth, follows after watching and profile visits, plus video metadata and the user's language, country and device. A 2025 short, "I Reverse Engineered TikTok's Algorithm" (The AI Race; unverified claims), describes the other side:

- **What it says the phone sends:** on-device models read motion sensors, battery, charging, brightness, mute and "over 50 other variables", and send them to the server with every request.
- **What it says the models do with it:** predict when the user is about to skip everything, then fetch an "emergency batch" and fall back to live video. They also detect that the user has dozed off, and predict the next app open so the app can start in the background.

That is ranking optimised for time spent, using context the user never sees leave the phone. tortok wants the benefit, a feed that fits the person, without that model. Its pitch is to creators who feel buried by opaque algorithms (`release-plan.md`), and `view-counting.md` already says per-user watch history is not data tortok wants to hold.

## Constraints

Any candidate must meet these.

1. **Everything personal stays on the device.** Behaviour (watch time, loops, skips, likes) and context (time of day, motion state, charging, network, headphones) may be used, but only on the phone. None of it is sent to the AppView or anyone else.
   - **Consequence:** ranking, filtering and prefetch for a user run on the device. The AppView serves candidates that are the same for everyone.
2. **Requests don't leak context.** The client fetches candidates in the same way whatever mode the user is in, so request timing and parameters reveal no state.
3. **Moderation comes first.** Decision 0023's rules (and later labels) are applied at the AppView before candidates are served. Local ranking can narrow what's shown, never widen it.
4. **No retention tactics:**
   - no rescue batches when the user seems to be losing interest;
   - no bait content as a last resort;
   - no sleep detection to keep playing.
   Where the app notices the user has stopped watching, it stops autoplay.
5. **Explainable.** Every ranked item can say why it's there, in terms the user recognises.
6. **Always an alternative.** A feed with no personalisation, chronological or Following, is always one tap away.

## Signals and where they live

| Signal | Source |
|---|---|
| Watch time, completion, loops, skips | The client only; the player observes them |
| Likes, reposts, replies, follows | Public atproto records (`app.bsky.feed.like`, `app.bsky.graph.follow`, …); any AppView can count them, and the client knows its own |
| Shares, profile visits | The client only. `app.bsky.feed.sendInteractions` has events for them, but sending them breaks constraint 1 unless they're aggregated anonymously (see `view-counting.md`) |
| Saves | No atproto record yet. Bluesky's bookmarks are private to its own AppView. tortok would keep its own locally |
| Comment depth | Public reply records |
| Caption, hashtags, language | The record (`text`, hashtags, `langs`) |
| Context: time, day, charging, network, headphones | The device, with no permission prompt |
| Context: activity (still, walking, in a vehicle) | The device, behind an OS permission (Motion & Fitness on iOS, `ACTIVITY_RECOGNITION` on Android), so opt-in |

## Candidate approaches

1. **Global curation (today).** Newest first plus popularity thresholds, the same for everyone. No behaviour data. Fails the goal of fitting the person; stays as the always-available alternative of constraint 6.
2. **A Following feed** from the user's atproto follows. They're public records the AppView already sees on Jetstream. Cheap and not algorithmic; a good second tab whatever else is chosen.
3. **A personalised feed ranked by the AppView** from signals the client reports. This is what centralised apps do. It breaks constraint 1.
4. **Choice of feed generators.** The client lists several atproto feed generators, tortok's and third parties', and the user picks. Rankers on a server still need the user's signals, so under constraint 1 they can only supply candidates.
5. **Ranking on the device.** The AppView serves a candidate pool: a few hundred recent and popular posts, already moderated, each with features (hashtags, author, duration, language, public counts). The client ranks them with its local history and context. Collaborative signals ("people like you…") are limited to what public counts and anonymous aggregates give.
6. **Ranking on the device, driven by a recipe in a small language.** Like 5, but the ranking is a program the user can read, edit, swap and share.

## Current leaning (2026-11-12)

Not a decision. **Approach 6, with approach 2 beside it.**

- **The recipe is data in a bounded language.** It has no loops, network access or side effects, and runs in milliseconds on Hermes. An existing language such as CEL or JSONLogic is preferable to inventing one; the choice needs a spike.
  - The language's vocabulary is the privacy policy: it exposes only the signals in the table above, so a recipe can't use anything else.
- **Modes are part of the language,** e.g. "in bed: calmer, longer videos"; "commuting on a workday: short, sound-off friendly". The user defines them, and context signals can detect them, opt-in.
  - A mode's definition ("after 11pm, lying still, charging") describes a person's habits, so it stays local even when the recipe is shared.
- **A default recipe that tunes itself.** It has weights the app adjusts from the user's behaviour. The user can see, edit or freeze them, or switch recipe. Tuning changes weights, never structure, so the recipe stays readable.
- **Shareable recipes.** A recipe, without learned weights or mode definitions, can be published as an atproto record (e.g. `app.tortok.feed.recipe`) for others to use or fork. A feed generator can then be one more candidate source. Shared recipes need labels like any other content, and moderation (constraint 3) applies before any recipe runs.
- **Explanations come from the trace:** the rules that fired for an item, e.g. "+3 because #indiemusic; ranked up because you're in bed mode and it's a long video; −1 because you skipped this creator twice".
- **Prefetch spends a data budget on the ranking's top candidates.** The client starts the first pieces of the likely next videos from peers and webseeds before the swipe, shortening time to first frame. The budget is a setting (Wi-Fi only, a cap in MB), not part of the language.
  - Prefetch is visible to the network: peers and the tracker see the infohash, and R2 sees webseed fetches. That's inherent to P2P, but prefetch shouldn't follow a context-driven schedule that reveals more.

Before ranking exists, **2.5D's client should start recording** watch time, completion, loops and skips locally (MMKV, never sent), so the default recipe has history to start from.

## Open questions

- **Which bounded language?** CEL (`cel-js`) or JSONLogic, or a small purpose-built one? Speed on Hermes, size, and whether recipes stay readable when written by hand.
- **How big a candidate pool?** Bandwidth per refresh against the ranker's real choice. How often is it refreshed, and is that uniform enough for constraint 2?
- **A new phone starts cold.** atproto has no private records yet, so local history can't sync through the PDS. Should there be an encrypted backup?
- **What does the default recipe optimise for?** Satisfaction signals and explicit "more or less like this" rather than time spent. How are smaller creators kept from being buried?
- **What do signed-out users get?** Probably the default recipe with no history, plus the same context modes (see `signed-out-feed.md`).

## Prior art to study

None of these has been evaluated yet.

- **SkyFeed** and **Graze**: Bluesky feed builders that compose inputs, filters and sorts into feed generators. Close to recipes, but they run on a server.
- **NewsBlur's intelligence trainer:** thumbs up or down on authors, tags and title words, with every filtering decision traceable to a visible rule.
- **Gobo** (MIT/UMass): sliders for what a feed shows, with each hidden post saying which slider hid it.
- **Ad-blocker filter lists** (EasyList, uBlock Origin): a small rule language, curated defaults that update themselves, the user's own rules on top, and subscriptions to other people's lists.
- **Sieve** (RFC 5228): a deliberately non-Turing-complete language for filters that users write and servers run.
- **CEL** and **JSONLogic:** bounded, side-effect-free expression languages with JavaScript implementations.
- **Bluesky's custom feeds** (`app.bsky.feed.generator`, `getFeedSkeleton`) and `sendInteractions`.
- **EU Digital Services Act:** reportedly requires very large platforms to offer a recommender not based on profiling. Not binding on tortok, but in line with constraint 6.
