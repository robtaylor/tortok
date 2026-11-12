# Handoff — Phase 3 Unit 2.5: 2.5C nearly done, 2.5D next

**Created:** 2026-11-12 (rewritten at the end of the 2.5C session)
**Working tree:** clean
**Branch:** main

<!--
Reminder: a handoff is ephemeral. At resolution, every load-bearing piece
below migrates into a docs/architecture/ (area doc, decision, spike) or
docs/plans/ home, and this file is then `git rm`'d in the same commit as the migration.

See docs/handoff-discipline.md for the migration table.
-->

## Goal & next-up

**Goal of this session:** finish Unit 2.5C (retire the legacy native flow)
per [`phase-3-atproto.md` § 2.5C](../plans/phase-3-atproto.md#25c--retire-the-legacy-native-flow-1-day).

**Next session should pick up:**

1. If #30 and #32 aren't merged yet, they are waiting on the user's review
   (#30 drops production tables on deploy). Once both are merged, deploy:
   `npm run deploy:backend` from a clean `origin/main`. It smoke-checks
   `https://appview.tortok.app` afterwards. Then 2.5C is done: mark it ✅ in
   the plan and fold this handoff (see "Fold at resolution").
2. Then Unit 2.5D, the Bluesky bridge.

**Verification command:**

```sh
gh pr list --state open                                     # #30, #32 until merged
curl -s https://appview.tortok.app/health | jq -r .sha      # the deployed main
npm run smoke -- https://appview.tortok.app                 # expect: smoke: all checks passed
(cd backend && npx jest --ci)                               # 67 passed once #30 is in (needs local Postgres)
(cd tortok && npm test -- --ci)                             # 25 passed
npm run test:scripts                                        # 14 passed
uv run docs/scripts/doctool.py lint                         # 0 errors
```

## Done this session

| PR | What |
|---|---|
| #29 | Only `main` writes Gradle's cache; a `prune-gradle-cache` job keeps the newest entry of each type. Usage went from 10.6 GB to about 6.4 GB |
| #31 | 2.5C step 11: the app's legacy sign-in, sign-up and dead Comment/Share buttons are gone; `npm test` and a CI `client` job run the unit tests |
| #33 | 2.5C step 13: Profile's AppView setting (MMKV, feed probe before saving); release builds default to `https://appview.tortok.app` |
| #30 (open) | 2.5C steps 8–10: the backend has no auth, write routes or seeder; legacy tables, `views` included, are dropped on boot, guarded by shape; `upload-test-clips.mjs` keeps the R2 upload |
| #32 (open, stacked on #30) | 2.5C step 14 config: `PUBLIC_BASE_URL`, the scheduled smoke check and `deploy-backend.sh` move to `appview.tortok.app` |

Done outside git: the Fly certificate for `appview.tortok.app`; the Cloudflare
records (proxied `appview` CNAME, `_acme-challenge.appview` CNAME,
`_fly-ownership.appview` TXT); a Cache Rule caching `/blob/*` on that host.
#32 records them in `backend.md`. Also deleted: the CI cache entries of the
merged PRs #25 and #27.

User decisions this session, all recorded in the plan: `views` is dropped
too; `fly.toml` stays always-on, because ingest runs in the process.

## Open follow-ups (priority-ordered)

### 1. Deploy and close 2.5C

See next-up. After the deploy, check `/health` reports the new SHA and the feed's
`posterURL`s start with `https://appview.tortok.app/blob/`.

### 2. `test-content/` leftovers (small)

Listed in the plan's 2.5C removal checklist: `seeder.mjs` still writes
`bbb-0?.magnet.txt`/`.torrent` files and serves posters and `.torrent` files
nothing reads, beside tracked legacy files (`magnet.txt`, `poster.jpg`,
`test_video.mp4`). Deleting tracked files needs the user's go-ahead. Having
`seeder.mjs` seed `buildClipTorrent`'s output would leave one torrent
builder.

### 3. Small items

- Find out why Gradle's transforms entry changes on every run
  (`GRADLE_BUILD_ACTION_CACHE_DEBUG_ENABLED` for two `main` runs, diff the file
  lists). If it's project-local artifacts from `expo prebuild`,
  `gradle-home-cache-excludes: caches/transforms-4` might be cheaper; measure.
- Try Gradle's build cache (`org.gradle.caching=true`); measure it alone.
- Upstream the `bittorrent-tracker` `window.location?.protocol` fix
  (`tortok/patches/`). That's a PR to someone else's repository: ask first.
- `CLOUDFLARE_ZONE_TOKEN` can now edit cache rules. Some of the token rows
  the user showed covered every zone in the account; narrowing them to
  `tortok.app` is the user's call.

## Fold at resolution

When 2.5C closes, these go to their homes, then this file is deleted:

- `client.md` § Testing: Detox on the hosted iOS simulator sometimes loses a
  tap (the app logs no state change); `tapVideoUntil()` resends it, and CI
  logs say `tapping again`. Release-build JS logs are in Detox's
  `device.log` artifact under `com.facebook.react.log`, for failing tests
  only. Running the stack locally needs `npm ci` in the repo root,
  `backend/`, `test-content/` and `test-network/`.
- `backend.md` § Deployment: merging a feed-shape change without deploying
  makes the scheduled smoke check fail every 15 minutes.
- The plan's 2.5C heading gets ✅, and the status line moves to 2.5D.

## Critical context

- **Deploying:** `npm run deploy:backend` only from a clean checkout at
  `origin/main`. Rollback is in `scripts/deploy-backend.sh`'s header.
- **Cloudflare cache rules API:** `PUT …/rulesets/phases/http_request_cache_settings/entrypoint`
  replaces the zone's whole cache ruleset. Read it first; today it holds only
  the `/blob/` rule.
- **Shell:** zsh treats `path` as `PATH` and `?` in an unquoted URL as a
  glob. Quote URLs, and don't name variables `path`.
