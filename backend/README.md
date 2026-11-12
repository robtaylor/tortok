# tortok backend

The Node + TypeScript Express AppView behind the tortok client, deployed on
Fly.io as `tortok-api`. It indexes `app.tortok.video.post` records from the
atproto network, serves them as a read-only feed with their blobs, and issues
TURN credentials. It has no accounts and no write routes.

What it does, route by route, is in the area doc
[`docs/architecture/backend.md`](../docs/architecture/backend.md). This README
covers running and deploying it.

## Local development

You need Node 22 and a Postgres server on `localhost:5432` with a `tortok`
database (`createdb tortok`).

The usual way is the repo-level `scripts/dev-up.sh`, which creates the dev
secrets (`scripts/init-dev-secrets.sh`) and starts this backend on `:8080`
alongside the local tracker and content server. To run the backend alone:

```bash
npm install
cp .env.example .env   # then edit as needed
npm run dev            # applies src/db/schema.sql on boot, serves :8080
```

`npm test` runs the Jest suite in `src/__tests__/`. The ingest and feed tests
create a throwaway database on the local Postgres server (`TEST_PG_ADMIN_URL`).

## Deployment (Fly.io)

```bash
fly secrets set -a tortok-api DATABASE_URL=... TURN_SECRET=...   # once
npm run deploy:backend   # from the repo root, on a clean origin/main
```

`deploy:backend` passes the commit's SHA to the image and smoke-checks
production afterwards. `fly.toml` sets the non-secret production config. It
never auto-stops the machine (`auto_stop_machines = "off"`), because atproto
ingest runs in this process and a stopped machine misses Jetstream events.
Shutdown is graceful on SIGTERM and SIGINT within `kill_timeout`.

Logs and status: `fly logs -a tortok-api`, `fly status -a tortok-api`.

## Environment variables

`.env.example` documents each variable.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL connection string; SSL follows its `sslmode` | `postgresql://localhost:5432/tortok` outside production; required in production |
| `INSTANCE_DOMAIN` | Reported by `/health` | `localhost` |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | `*` |
| `TRACKER_URLS` | Extra trackers on every feed item (comma-separated) | `ws://localhost:8000` (dev); required in production, set in `fly.toml` |
| `JETSTREAM_URL` | Jetstream subscribe endpoint | `wss://jetstream2.us-east.bsky.network/subscribe` |
| `INGEST_SEED_DIDS` | DIDs backfilled on boot (comma-separated) | none |
| `PLC_DIRECTORY_URL` | Where `did:plc` documents come from | `https://plc.directory` |
| `PUBLIC_BASE_URL` | Origin of the feed's blob URLs | the request's host |
| `TURN_SECRET` | coturn shared secret for `/turn/credentials` | unset → STUN only |
