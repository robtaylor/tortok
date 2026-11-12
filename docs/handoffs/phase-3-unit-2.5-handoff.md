# Handoff — Phase 3 Unit 2.5: 2.5A and 2.5B shipped, 2.5C next

**Created:** 2026-11-12
**Working tree:** clean
**Branch:** main

<!--
Reminder: a handoff is ephemeral. At resolution, every load-bearing piece
below migrates into a docs/architecture/ (area doc, decision, spike) or
docs/plans/ home, and this file is then `git rm`'d in the same commit as the migration.

See docs/handoff-discipline.md for the migration table.
-->

## Goal & next-up

**Goal of this session:** ground the code in tests (CI, Detox on both
platforms, production smoke checks), then land Phase 3 Units 2.5A (ingest)
and 2.5B (feed cutover) in production.

**Next session should pick up:** Unit 2.5C, retire the legacy native flow,
as listed in [`phase-3-atproto.md` § 2.5C](../plans/phase-3-atproto.md#25c--retire-the-legacy-native-flow-1-day).
Its removal list was corrected this session: `TRACKER_URLS` stays (the
feed's `sources` use it); `CONTENT_ORIGIN_URL` goes with the seeder.

**Verification command:**

```sh
curl -s https://tortok-api.fly.dev/health | jq -r .sha     # expect a15da53… (or a later main)
npm run smoke -- https://tortok-api.fly.dev                 # expect: smoke: all checks passed
(cd backend && npx jest --ci)                               # expect 66 passed (needs local Postgres)
npm run test:scripts                                        # expect 14 passed
uv run docs/scripts/doctool.py lint                         # expect 0 errors
```

## Done this session

| PR | What |
|---|---|
| #19, #20, #21 | Backend CI on Node 22; the test-PDS spike (resolved yes) |
| #22 | Detox on iOS and Android in CI against a local stack with its own PDS (Decision 0021); simslim, ccache as Xcode's compiler launcher, PR build caches with one entry per ref |
| #17 | 2.5A ingest; deployed |
| #24 | Smoke check (`scripts/smoke.mjs`), every 15 min in CI, plus a staleness check; deployed SHA in `/health`; blue-green deploys; `npm run deploy:backend` |
| #25 | Dependencies' native compiler warnings silenced at prebuild |
| #23, #26 | Open problem `signed-out-feed.md`; Decision 0022 (AppView-supplied runtime sources) |
| #27 | 2.5B: feed reads `posts`, blob route `GET /blob/:did/:cid` with CID check and cache, `sources` in WebTorrent, no Like; e2e stack publishes fixtures to its PDS and ingest indexes them. Deployed as `a15da53` |

## Open follow-ups (priority-ordered)

### 1. Unit 2.5C (about a day)

Per the plan. Also delete with it, now that nothing uses them:
`test-content/seed-db.mjs` (e2e stopped calling it in #27) and
`scripts/webseed-only-test.mjs` (the plan kept it "until WS2's smoke script
generalises"; `scripts/smoke.mjs` now does). Serving the API as
`appview.tortok.app` behind Cloudflare means changing `PUBLIC_BASE_URL` in
`backend/fly.toml`, and lets Cloudflare cache the blob route.

### 2. Watch CI caches (a few minutes, after some pushes)

`gh api repos/robtaylor/tortok/actions/cache/usage` was 5.5 of 10 GB. If
Gradle's `dependencies`/`transforms` entries get new hashes on every push
(about 2 GB each time), make the e2e cleanup step drop entries the newest
`gradle-home` doesn't reference, or go back to main-only Gradle writes.

### 3. Small items

- Upstream the `bittorrent-tracker` `window.location?.protocol` fix
  (`tortok/patches/`).
- Try Gradle's build cache (`org.gradle.caching=true`); every Android task
  still executes. Measure it as its own change.
- `tortok/stores/auth.test.ts` exists but nothing runs it.

## Critical context

- **Deploying:** `npm run deploy:backend` from a clean checkout at
  `origin/main` only; it smoke-checks production afterwards. Rollback:
  `fly releases -a tortok-api --image`, then `fly deploy --image <image>`
  from `backend/`. Merging a feed-shape change without deploying makes the
  scheduled smoke fail every 15 min.
- **Detox on the hosted iOS simulator** sometimes loses a tap: the app logs
  no state change at all. `tapVideoUntil()` in `tortok/e2e/helpers.ts`
  resends it; grep CI logs for `tapping again` to see how often.
- **Release-build JS logs** are in Detox's `device.log` artifact under
  `com.facebook.react.log` (only for failing tests).
- **Running the e2e stack locally** needs `npm ci` in the repo root,
  `backend/`, `test-content/` and `test-network/`; then
  `scripts/e2e-up.sh` and `scripts/e2e-down.sh`.
- **Shell gotchas from this session:** the Bash tool runs zsh, which doesn't
  word-split `$ids` in `for id in $ids`; use `while read`. `gh run list
  --commit` wants the full SHA.
- **History rewrites on PR branches** were refused by auto mode's classifier
  once. `~/.claude/settings.json` now has an `autoMode.allow` rule for them
  (and denies force-pushes to main); it hasn't been exercised yet.
