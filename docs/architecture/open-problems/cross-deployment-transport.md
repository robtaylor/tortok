# Open problem: Where video bytes come from across deployments

**Status:** Unresolved. Problem statement, candidate approaches, and one requirement that Phase 3 must meet.
**Must resolve by:** Phase 3 for the runtime-source requirement below, because the first real records are published then and their magnets can't be changed afterwards. Phase 4 for choosing between seeders and mirrors.
**Blocks:** publishing `app.tortok.video.post` records with production URLs (Phase 3); any third-party AppView serving tortok video reliably.
**Related decision records:** Decision 0001 (WebTorrent end to end), Decision 0002 (AT Protocol), Decision 0008 (R2 origin and CDN), Decision 0010 (Bluesky bridge), Decision 0017 (the AppView's Postgres is a rebuildable index).
**Related open problems:** `own-pds.md`.

## The problem

A tortok post's video is reached through the magnet URI in its signed record. The magnet names a tracker and a BEP-19 webseed. Both were fixed by whoever published the post, and the record can't be edited without the author re-signing it.

That works while there is one deployment. Once anyone can run an AppView (Decision 0017), the magnet causes four problems.

- The publishing deployment pays for its posts' bytes forever, including when users of another AppView watch them. R2 egress is free (Decision 0008), so the cost is storage and requests, but the dependency is permanent.
- If a deployment shuts down, every post it published loses its webseed. Anyone still holding the pieces can keep it alive, but phones hold a video for at most 30 minutes (Decision 0009).
- A deployment with its own tracker splits the swarm. Its peers can't find ours, and the DHT is off in our client.
- Durability is R2's durability. A video nobody is watching exists only in R2, so Decision 0010's "P2P-backed durability" pitch overstates what P2P provides. P2P cuts cost; R2 keeps content alive.

## The requirement Phase 3 must meet

**Clients learn extra sources at runtime.** The magnet's tracker and webseed are hints, not the only options. A client also asks for more sources for an infohash, either from its AppView or from published records. Piece hashes in the torrent verify every byte, so an extra source can't serve wrong data, only slow or missing data.

If Phase 3 ships a client that uses only the magnet's sources, each candidate below means changing the client, and every record published in the meantime stays tied to its original origin. With runtime sources from the start, every candidate becomes something added at deploy time.

## Candidate approaches

### 1. HTTP mirrors

A mirror is any HTTP host holding the same file. BEP-19 allows several webseeds, and a client given extra URLs fetches pieces from them in the same way. Mirrors need no WebRTC, no UDP and no long-running process.

Pros: cheapest by far; covers durability and independence from Cloudflare.
Cons: still needs the runtime-source mechanism; someone has to pay for each mirror's storage.

### 2. Seeders we run

An always-on WebTorrent peer, as the backend's `SeederService` is today and the removed `tortok-seeder` app was. Most of the code exists.

Pros: a fast, always-present peer in every swarm.
Cons: phones and browsers only connect over WebRTC, so the seeder must be reachable over UDP. On Fly that means binding to `fly-global-services` and probably a dedicated IPv4, which has never been shown to work. It needs a spike first. With R2 egress free, a seeder rarely beats the webseed.

### 3. Seeders anyone can run

Volunteers or other deployments seed content they choose.

Pros: the only option that lets the network keep content alive without any single origin.
Cons: a volunteer re-hosting arbitrary video is exposed to whatever it contains. It needs labeler-driven drop lists (Decision 0013), clear opt-in scope and per-source offload accounting.

## Constraints that apply whichever approach wins

- **The content domain is permanent.** Production content is served from `content.tortok.net` (since 2026-11-08), the R2 bucket's custom domain behind Cloudflare's cache. It replaced the bucket's `r2.dev` URL, which Cloudflare rate-limits, doesn't cache, and describes as for development only. It is deliberately not on `tortok.app`, so that a blocklisting caused by uploaded content can't take down the app, API, OAuth or the Lexicon domain. All three tortok domains auto-renew at Gandi. A lapsed content domain would break every old post, and whoever registered it next would control those URLs.
- **Key real content by infohash,** e.g. `/v/<infohash>/<file>`, so a mirror can copy the bucket path for path. The test clips use `test-content/<name>.mp4`.
- **No retention or deletion policy exists.** R2 storage grows without limit, and deleting a post's record doesn't delete its R2 objects. See also the deferred "R2 reliability and backup strategy" item in [`README.md`](README.md).
- **The Lexicon still has `hlsFallbackUrl`.** `app.tortok.video.post` carries an optional HLS fallback URL from the Swift-era design, which encoded an HLS ladder. Playback is now a single-file MP4 with webseeds, so the field has no producer. Drop it or redefine it before real records are published, since published records can't be changed.
- **Piece size is a webseed cost.** create-torrent's default gives 16 KB pieces for 3 MB clips, about 180 HTTP requests per clip, and request latency dominates webseed speed. Larger pieces cut that, but changing piece size changes the infohash, so it should be settled before real records are published.

## Spikes this needs

- WebRTC seeder on Fly (UDP, ICE) — only if candidate 2 is chosen.
- Runtime source discovery in the client: does WebTorrent accept webseeds and trackers added after `add()`, on both the Hermes and browser builds?

## What would resolve it

A decision record that sets how clients learn extra sources (AppView-supplied, record-published, or both) and which of mirrors and seeders tortok runs at launch. The record also sets the content key layout and piece size for real uploads.
