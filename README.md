# tortok

**Your videos. Your followers. Yours to take anywhere.**

tortok is a short-form video app for iOS, Android and the web. It is designed
so that no company sits between creators and their audiences:

- You sign in with the Bluesky (AT Protocol) account you already have.
- Your posts live in your own repository on your PDS, not in a tortok
  database.
- Video plays peer to peer. Viewers help deliver it to the next viewer, so
  the app gets cheaper to run as it grows.

## Why tortok exists

A few platforms dominate short-form video. They own the creator's audience,
decide who sees what, and take a cut of what creators earn. A creator who
leaves loses their followers. tortok aims to change that default.

- **Creators own their audience.** Identity and the follow graph live in
  AT Protocol, so an account, its followers and its posts go with the creator
  to any PDS and any app that speaks the protocol. tortok runs no accounts of
  its own.
  ([Decision 0002](docs/architecture/decisions/0002-atproto-federation.md),
  [Decision 0003](docs/architecture/decisions/0003-identity-dids.md))
- **No one controls the index.** tortok's server is an AppView, an index
  built from the public record stream that anyone can rebuild. Anyone can run
  their own AppView with their own moderation and ranking, and the app is
  meant to let users choose which one they use.
  ([Decision 0017](docs/architecture/decisions/0017-appview-postgres-is-a-rebuildable-index.md))
- **Video gets cheaper as the audience grows.** On phones, a viewer seeds the
  videos it has just watched to other viewers over WebTorrent. It does this
  only while the app is open, on Wi-Fi, with enough battery. In a
  two-simulator test, peers delivered 89–91% of the bytes. A new or unpopular
  video still starts at once, from an HTTP copy on Cloudflare R2, which
  charges nothing for egress.
  ([Decision 0001](docs/architecture/decisions/0001-webtorrent-end-to-end.md),
  [Decision 0009](docs/architecture/decisions/0009-client-seeding-policy.md))
- **tortok doesn't profit from creators' money.** The planned model is a
  fan-allocated pool: a fan pays one monthly amount and splits it across the
  creators they choose. tortok takes no cut and holds no permanent balance of
  creator earnings.
  ([Decision 0011](docs/architecture/decisions/0011-monetization-architecture.md))
- **The feed won't be empty on day one.** Video posts from Bluesky will be
  bridged into the feed, so a new user arrives to a living community rather
  than a blank page.
  ([Decision 0010](docs/architecture/decisions/0010-bluesky-video-bridge.md))

## How it fits together

```
 client (Expo: iOS, Android, web)
   │  sign in with atproto OAuth ──────────────► user's PDS (e.g. bsky.social)
   │  publish post records ────────────────────► user's PDS
   │  read the feed ◄── AppView ◄── relay ◄───── every PDS
   │
   └─ play video: WebTorrent swarm of other viewers
                  + HTTP webseed on R2 (content.tortok.net)
                  + tortok's tracker and TURN relay
```

A post is a signed `app.tortok.video.post` record in the creator's repo,
carrying a magnet link. Every piece of the torrent is hash-checked. A bad peer
or mirror can slow delivery down, but it can't serve the wrong video.

## Where it is today

tortok is pre-release, in development Phase 3 (atproto integration).

- **Working:** sign-in with atproto OAuth, the vertical feed, and WebTorrent
  playback, prefetch and seeding on iOS and Android. Web plays over plain
  HTTP. tortok's own tracker, TURN relay and R2 content origin run on Fly.io
  and Cloudflare.
- **In progress (Phase 3 Unit 2.5):** moving the feed off the legacy backend
  and onto atproto records, so the app works end to end after sign-in.
- **Not built yet:** recording and upload, publishing posts, choosing an
  AppView, the Bluesky bridge, moderation, and monetization.

[`CLAUDE.md`](CLAUDE.md) has the development phases and the project's working
rules. [`docs/plans/phase-3-atproto.md`](docs/plans/phase-3-atproto.md) has
the current plan.

## Layout

| Path | What it is |
|---|---|
| `tortok/` | Expo + React Native client (iOS, Android, web) |
| `backend/` | Node + TypeScript API on Fly.io, becoming the AppView |
| `tracker/`, `coturn/` | tortok's own WebSocket tracker and TURN server, on Fly.io |
| `web/` | Static site for `tortok.app` (OAuth client metadata, callback) |
| `lexicons/` | The `app.tortok.*` Lexicon definitions |
| `test-content/` | Test clips, the local tracker and the dev content server |
| `scripts/` | Dev, deploy and test scripts |
| `docs/` | Architecture, decisions, open problems, plans |

## Quickstart (local development)

You need Node and a Postgres server on `localhost:5432`.

```sh
scripts/dev-up.sh        # backend :8080, tracker :8000, content server :8090
cd tortok && npm start   # Metro; then open iOS, Android or web
scripts/dev-down.sh      # stop the background services
```

`dev-up.sh` creates the dev secrets it needs (`scripts/init-dev-secrets.sh`)
and writes logs to `/tmp/tortok-dev/`. The Android emulator also needs
`npm run adb:ports`, which `npm run android` runs for you.

## Docs

Start with [`docs/architecture/README.md`](docs/architecture/README.md). It
lists each area of the system with its current-state reference and the
decisions behind it. Questions not yet decided live in
[`docs/architecture/open-problems/`](docs/architecture/open-problems/README.md),
such as how to count views that can be trusted without tracking viewers.
