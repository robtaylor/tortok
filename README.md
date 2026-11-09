# tortok

tortok is a short-form video app that delivers video peer to peer with
WebTorrent and publishes posts as AT Protocol records on each user's own PDS.
It is pre-release and in development Phase 3 (atproto integration); see
[`CLAUDE.md`](CLAUDE.md) for the phases and the project's working rules.

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
`npm run adb:ports` (run by `npm run android`).

## Docs

Start with [`docs/architecture/README.md`](docs/architecture/README.md): each
area of the system, its current-state reference, and the decisions behind it.
