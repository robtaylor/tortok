# Phase 0 punch list (completed)

**Status:** Implemented — Phase 0a/0b complete (archived 2026-11-04).

Historical record of the concrete work identified in the April 2026 code review,
executed in Phase 0 of Decision 0006 before the rewrite began. Preserved for
provenance; file:line references reflect the tree as of commit `af092d5` (the
WebTorrent bridge commit) and point at Swift-era code that has since been
deleted. Current architecture lives in the [area docs](../../architecture/README.md);
this is `git log`-grade history, not a live plan.

## A.1 Bugs fixed

**B1. `/auth/me` middleware order** — `backend/src/index.ts`. `authenticateJWT`
was wired onto `/auth/me` after the auth router mounted, so the middleware never
ran and valid tokens returned 401. Fixed by wiring the middleware before the
router. Downstream, the `AuthManager.swift` `// TODO: Validate token` workaround
was removed.

**B2. Refresh-token fiction** — `backend/src/routes/auth.ts:63,124`. Register and
login returned `refreshToken: token` (the same JWT), and the client called a
non-existent `/auth/refresh`. The refresh-token concept was deleted from both
sides; session JWTs are long-lived for v1.

**B3. Like-counter drift** — `backend/src/routes/videos.ts:167-189`.
`INSERT ... ON CONFLICT DO NOTHING` followed by an unconditional
`UPDATE ... like_count + 1` double-counted re-likes. Fixed by gating the counter
update on the insert's row count.

**B4. `PATCH /videos/:id/urls` ownership check** — the "admin" endpoint only
required `authenticateJWT`, letting any authenticated user rewrite any video's
HLS URL and magnet. Fixed with an ownership check before the bridge commit
landed.

**B5. Magnet URI JS injection** — `WebTorrentBridge.swift:158` (Swift era, since
deleted). Magnet URI was interpolated into a JS string literal with only
single-quote escaping. Fixed for the reference app before the Swift codebase was
removed.

**B6. `P2PResourceLoader` stats subscription** — `P2PResourceLoader.swift` (Swift
era, since deleted). Subscribed to bridge-wide totals instead of per-torrent
stats. Fixed in the reference app.

## A.2 Security footguns fixed

**S1. JWT secret default** — `backend/src/middleware/auth.ts`. A
`development-secret-change-in-production` default let forged JWTs through if
`JWT_SECRET` was unset. Now throws at startup if missing or equal to the default.

**S2. HLS URL scheme validation** — `backend/src/middleware/validate.ts`.
`Joi.string().uri()` accepted any scheme (SSRF risk). Restricted to `https`.

**S3. Password policy** — raised the minimum and added a small common-password
blocklist as an interim measure before atproto OAuth takes over auth in Phase 3.

**S4. `jest` missing from devDependencies** — `backend/package.json`. `npm test`
failed on a clean install; resolved.

## A.3 Libtorrent cleanup

Deleted the libtorrent stub targets and the dead `TorrentEngine.swift` /
`TorrentInfo.swift` / `TorTokDemo.swift`, removed the `LibTorrentBridge` target
and `cxxLanguageStandard` from `Package.swift`, and dropped the `torrentEngine`
wiring from `TorTokApp.swift`. All moot now that the Swift client is gone
(Phase 5, 2026-04-14).

## A.4 Documentation cleanup

Deleted the pre-Opus architecture/guides/deployment docs (ActivityPub +
libtorrent + Swift-era), folding salvageable content into the decision records
and `open-problems/`. Created `open-problems/` and the root `CLAUDE.md` with
read-order and phase-aware stop-and-ask rules. The `designs/mvp-*.md`
specifications were kept as historical product intent. Stale root status docs
(`BUILD_STATUS.md`, `READY_TO_RUN.md`, etc.) were cleared from the repo root.

## A.5–A.6 Uncommitted state and seeder acceleration

The WebTorrent-bridge follow-up work (static HLS route, seeder init,
`/seeder/stats`, graceful shutdown, `SeederService`) was committed on a clean
base with B4 fixed. The seeder-in-Cloud-Run coupling flagged in Decision 0005
was noted as more acute (two stateful concerns in a stateless runtime) and
prioritised; seeder extraction landed in Phase 0b per Decision 0008.
