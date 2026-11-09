# tortok backend

The Node + TypeScript Express API behind the tortok client, deployed on Fly.io
as `tortok-api`. Today it serves the **legacy** email/password API (JWT auth,
video metadata, the feed, likes and views), hosts the origin WebTorrent seeder
in-process, and issues TURN credentials. Phase 3 Unit 2.5 turns it into an
atproto AppView and retires the legacy auth and write routes
([`docs/plans/phase-3-atproto.md`](../docs/plans/phase-3-atproto.md)).

What it does, route by route, is in the area doc
[`docs/architecture/backend.md`](../docs/architecture/backend.md). This README
covers running and deploying it.

## Local development

You need Node and a Postgres server on `localhost:5432` with a `tortok`
database (`createdb tortok`).

The usual way is the repo-level `scripts/dev-up.sh`, which creates the dev
secrets (`scripts/init-dev-secrets.sh`) and starts this backend on `:8080`
alongside the local tracker and content server. To run the backend alone:

```bash
npm install
cp .env.example .env   # then edit DATABASE_URL and secrets as needed
npm run dev            # applies src/db/schema.sql on boot, serves :8080
```

`npm test` runs the Jest suite in `src/__tests__/`, which today holds one
placeholder test.

## Deployment (Fly.io)

```bash
fly auth login
fly secrets set -a tortok-api JWT_SECRET=... DATABASE_URL=... TURN_SECRET=...
fly deploy
```

`fly.toml` sets the non-secret production config: `PORT`,
`CONTENT_ORIGIN_URL` and `TRACKER_URLS`. It never auto-stops the machine
(`auto_stop_machines = "off"`), because the origin seeder runs in this process
and stops seeding if the machine idles out. Shutdown is graceful on SIGTERM and
SIGINT within `kill_timeout`.

Logs and status: `fly logs -a tortok-api`, `fly status -a tortok-api`.

## Environment variables

`.env.example` documents each variable.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL connection string; SSL follows its `sslmode` | `postgresql://localhost:5432/tortok` outside production; required in production |
| `JWT_SECRET` | Secret for signing JWTs | Required |
| `JWT_EXPIRES_IN` | Token expiration | `7d` |
| `INSTANCE_DOMAIN` | Instance domain name | `localhost` |
| `INSTANCE_NAME` | Display name | `TorTok Instance` |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | `*` |
| `CONTENT_ORIGIN_URL` | BEP-19 webseed origin | `http://localhost:8090` (dev); required in production, set in `fly.toml` |
| `TRACKER_URLS` | Trackers the seeder announces to (comma-separated) | `ws://localhost:8000` (dev); required in production, set in `fly.toml` |
| `TURN_SECRET` | coturn shared secret for `/turn/credentials` | unset → STUN only |
