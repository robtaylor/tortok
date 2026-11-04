# Spike — Webseed-only origin

**Status:** Resolved (2026-11-04) — YES; a BEP-19 webseed on R2 alone delivers complete, byte-identical torrent content with no seeder, tracker, DHT or LSD. On-device confirmation is left to Decision 0014 tier 1.

## Question

Does a torrent whose only source is a BEP-19 webseed pointing at R2 download completely and correctly, with no origin seeder running?

## Why this is in question

[Decision 0008](../0008-seeder-storage-cdn.md) layer L2 put an always-on origin seeder on Fly.io (`tortok-seeder`). Commit `a5d5ddf` (2026-04-19) deleted that seeder's code on the grounds that webseed made it unnecessary, but recorded no decision, and the Fly app kept running. The backend also runs an in-process `SeederService`, and the backend Fly app was being made always-on to keep it alive. Whether any origin seeder is needed depends on webseed alone being sufficient.

## Approach

- **Q1.** Does a webseed-only download from R2 complete and verify?
  - Mirror an R2 video directory (`videos/test-video-2/`: `playlist.m3u8`, `seg_000.ts`) locally.
  - Build a torrent from the mirror with `announce: []` and a `urlList`, then destroy the seeding client.
  - Download it in a fresh WebTorrent client with `dht`, `tracker`, `lsd`, `utp` and `utPex` all off, so R2 is the only possible source. Compare the output byte for byte.
  - Repeatable with `node scripts/webseed-only-test.mjs <mirror> <webseed-url> <new-out-dir>`.
- **Q2.** Which `urlList` shape does WebTorrent expect for directory (multi-file) and single-file torrents?

## Decision matrix

| Outcome | Means | Action |
|---|---|---|
| Q1 fails | Peers or a seeder are required for first fetch | Keep Decision 0008 L2; resurrect the standalone seeder from git (`a5d5ddf^`) |
| Q1 passes | R2 alone can serve any torrent | Destroy `tortok-seeder`; decide separately whether an always-on peer is still worth running |

## Findings

- 2026-11-04: Production feed (`tortok-api`, image from 2026-04-12) serves one video whose magnet has no `tr=` and no `ws=`; the current client adds no trackers, so `tortok-seeder` was unreachable from today's client regardless.
- 2026-11-04: Multi-file torrent, `urlList = <R2>/videos` → **DONE** in ~0.4–0.6 s, 5 pieces / 75,317 bytes, one wire of type `webSeed`, byte-identical.
- 2026-11-04: Multi-file torrent, `urlList = <R2>/videos/test-video-2` → stalls at 0% (30 s timeout). WebTorrent (`lib/webconn.js`) appends each file's `path`, which already begins with the torrent name, so the name is doubled.
- 2026-11-04: Single-file torrent, `urlList = <R2>/videos/test-video-2/seg_000.ts` → **DONE**, byte-identical; single-file torrents use the URL as-is.
- 2026-11-04: Consequence: `backend/src/services/seeder.ts` used `${origin}/videos/<name>` for its directory torrents, so its webseed never worked. Corrected to `${origin}/videos`.
- 2026-11-04: `tortok-seeder` Fly app destroyed (its volume held only a pull-through cache of R2).

## Outcome

Webseed alone is sufficient to deliver content: with no seeder and every peer-discovery mechanism disabled, R2 served the whole torrent, verified, in under a second. The `urlList` must be the parent of the torrent directory for multi-file torrents and the file URL for single-file ones. The orphaned `tortok-seeder` app is destroyed. Whether tortok still wants an always-on origin *peer* (for offload measurement or swarm warmth), and so whether `SeederService` and Decision 0008 L2 stay, is a separate decision. This spike was run in Node against the production R2 bucket; playback on Hermes is confirmed by the Decision 0014 tier-1 rig, not here.
