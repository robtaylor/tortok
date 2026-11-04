# Decision 0010: Bridge Bluesky video posts into the tortok feed (inbound federation)

**Current architecture:** [Federation](../federation.md)

**Status:** Accepted — 2026-04-17

**Context.** The chicken-and-egg problem at launch is severe: a new
short-form video app shipping with an empty feed dies on day one.
The release research informing `docs/release-plan.md` is unambiguous
— TikTok solved the empty feed with the For You Page, Instagram by
hand-curating supply, Bluesky (badly, late) with Starter Packs. None
survived showing a new user a blank follow feed. We have no ad
budget for the TikTok approach and no team to scale the Instagram
approach beyond its absolute Halo tier.

Decision 0002 commits us to AT Protocol. Bluesky added native video posts
in late 2024 (`app.bsky.embed.video`), and they federate over the
standard atproto firehose like every other record. The data is open
by design.

The current Decision 0006 phase plan defers all federation work to Phase 3
(PDS standoff). That ordering is correct for the *outbound* direction
— publishing signed `app.tortok.video.post` records requires our own PDS.
But the *inbound* direction — consuming and rendering existing
Bluesky video posts in the tortok feed — needs none of that
infrastructure. It can run as a read-only firehose subscriber,
parallel to the Phase 2 P2P client work, with no dependencies on
Phases 3–4.

This decision pulls inbound federation forward and treats it as the
cold-start solution for the open beta launch.

**Decision.**

1. **Subscribe to the atproto firehose, filter for video posts.** Use
   `@atproto/sync` against a public relay to consume `com.atproto.sync.subscribeRepos`,
   filter commits for `app.bsky.feed.post` records whose embed is
   `app.bsky.embed.video`, and index matched records in Postgres
   alongside the existing video schema.

2. **Render bridged posts in the tortok vertical feed alongside
   native `app.tortok.video.post` content.** Bridged posts are
   first-class feed items, not segregated into a separate "explore
   Bluesky" tab. The federation pitch — "same network, different
   lens" — only works if the experience is genuinely unified.

3. **Display-only in v1. Engagement stays on Bluesky.** Bridged
   posts surface a "via Bluesky" affordance and a one-tap link back
   to the original post. Likes, replies, and follows on bridged
   content are Bluesky-side actions; we do not mirror or proxy them.
   This keeps the trust model simple (we are a renderer, not an
   actor) and avoids duplicating Bluesky's social graph.

4. **Bytes come from Bluesky's video CDN.** v1 does not re-host
   bridged content on tortok seeders. The P2P story (Decision 0008) does
   not apply to bridged content — it is the lure, not the conversion.
   Bandwidth for bridged content is Bluesky's cost, not ours.

5. **Honor opt-out signals.** Creators who do not want their posts
   bridged can opt out via the same self-labeling conventions used
   by existing atproto bridges (e.g., the Bridgy Fed `!no-bridge`
   pattern). The bridge filters out posts from authors carrying
   these labels at index time. Revisit label semantics if atproto
   formalizes a bridging-consent convention later.

6. **Inherit moderation via labelers.** Subscribe to the same default
   labeler set Bluesky's first-party app uses, plus our first-party
   labeler (Decision 0013). Bridged posts carry their labels into the
   tortok client and are filtered/hidden according to user moderation
   preferences.

7. **Native upgrade path is the conversion funnel.** Once Phase 3's
   PDS is live, bridged posts include a creator-facing affordance
   ("post natively to tortok for P2P-backed durability and
   portability") that lands them in the native posting flow. Until
   then, the affordance is a "notify when available" capture.

8. **Phase placement.** This work runs as a parallel track alongside
   Phase 2 P2P client work. Neither blocks the other. The bridge
   must be live before the open beta launch in `docs/release-plan.md`
   Phase A. Treat it as a Phase 2.5 milestone if linearity matters.

**Consequences.**

- The empty-feed problem is solved on day one of open beta. A new
  user opens tortok and sees real video from real creators, possibly
  including accounts they already follow on Bluesky.
- The federation thesis becomes provable, not asserted. "Your
  followers come with you" is demonstrated by the *content* coming
  with you, not just claimed on a marketing page.
- Creator-outreach economics shift. We are not asking creators to
  *move* — we are showing them their content already plays in tortok,
  and the ask becomes "post natively when you want the durability
  upgrade." Smaller commitment, higher expected conversion.
- We become a downstream consumer of the Bluesky firehose. Bluesky
  PBC could throttle, block, or change firehose access policies.
  Mitigation: multiple public relays exist; document a fallback list
  and confirm we can switch with config, not code.
- Bandwidth asymmetry. v1 ships Bluesky's bytes through our app
  without contributing to their costs. This is protocol-allowed
  behaviour — the firehose and video CDN are public — but it is
  worth being honest about. If bridged consumption at scale becomes
  a point of friction, we can offer to mirror bridged content to our
  seeders (with creator consent) and contribute upload bandwidth
  back into the swarm.
- Moderation surface area grows. We are now responsible for filtering
  bridged content according to our own policy *plus* inheriting
  Bluesky's labeler signals. The default labeler subscription set
  becomes a launch-blocking decision, formalized by Decision 0013 and
  raised in urgency by this decision.
- Opt-out must work flawlessly from launch. Creators who self-label
  as no-bridge and find their content bridged anyway is the kind of
  trust failure that lights up Bluesky within hours. Opt-out
  correctness is a launch criterion, not a polish item.
- Decision 0006's Phase 3 ordering is unaffected for *outbound* federation
  (publishing signed `app.tortok.video.post` records still requires the
  PDS). Inbound is decoupled from that timeline. Decision 0005's AppView
  effectively starts here in pull-only mode — Phase 3/4 work then
  extends it to subscribe to our own PDS as well.

**Alternatives ruled out.**

- **Wait for Phase 3 to do all federation work together.** Cleaner
  conceptually but leaves the cold-start problem unsolved during the
  open beta window. The launch dies and Phase 3 ships into a
  graveyard.
- **Scrape TikTok / Instagram and rehost.** Legally hostile,
  creator-hostile, contradicts the wedge. Ruled out in release-plan
  discussion regardless of Decision 0010.
- **Show bridged content in a separate "explore Bluesky" tab.**
  Defeats the federation pitch. The whole point is that the network
  is shared — segregating bridged content into a side surface
  implies it's a different network.
- **Bridge bytes as well as records — auto-mirror Bluesky video to
  tortok seeders.** Higher contribution back to the open web, but
  consent-fraught (republishing Bluesky's CDN bytes via P2P is a
  different act from rendering them). v2 feature, gated on creator
  opt-in, not v1.
- **Bridge engagement (likes, replies) bidirectionally.** Doubles
  the trust model, requires write authority on Bluesky (which we
  don't have without per-user OAuth), and risks fragmenting
  conversation. Display-only is the right v1 scope.
- **Build our own atproto relay.** Saves us from depending on
  Bluesky/third-party relays but is significant infrastructure for
  a v1 feature. Subscribe to existing relays; reconsider if any
  prove unreliable or hostile.

**Implementation notes.**

- Add a `source` column on the video records table to distinguish
  `native` vs `bridged_bluesky`. Bridged records carry the
  originating DID, post URI, and CDN URL; they do not carry a
  magnet URI.
- The player must handle both magnet-URI playback (native) and
  direct HLS playback from Bluesky CDN (bridged) without UI
  difference.
- Firehose subscription is a long-lived process — fits in the
  AppView service plan from Decision 0005, started early in pull-only
  mode here.
- Cost: one persistent WebSocket plus a small Postgres write rate.
  Negligible at v1 scale; revisit if the index outgrows the existing
  Postgres instance.
- Opt-out test: include at least one no-bridge-labeled author in
  CI fixtures. The bridge must filter them out at index time, not
  just at render time.
