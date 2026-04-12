# Phase 0a Handoff

Scope: Appendix A of `docs/architecture/decisions.md` (Phase 0a punch
list) plus the docs consolidation that preceded it. Authored as an
unattended session; this file is the summary the human should read
first when picking the work back up.

## What landed

Commits, newest at top, all on `main`, **not pushed**:

| SHA | Subject | Category |
|-----|---------|----------|
| `63cc808` | chore(ios): delete libtorrent stubs, drop cxx17 bridge from Package.swift | libtorrent cleanup |
| `63023ac` | fix(player): report per-torrent stats in P2PResourceLoader (B6) | B6 |
| `05062ce` | fix(torrent): JSON-encode WebView JS arguments to block injection (B5) | B5 |
| `5bb5121` | fix(backend): add jest/ts-jest so `npm test` actually runs (S4) | S4 |
| `4bdd1ce` | fix(validation): strengthen register password policy (S3) | S3 |
| `183e712` | fix(validation): require https for hlsUrl / thumbnailUrl (S2) | S2 |
| `2a12cef` | fix(auth): require JWT_SECRET at startup, drop insecure default (S1) | S1 |
| `8650982` | fix(videos): stop like counter drifting on repeat likes/unlikes (B3) | B3 |
| `ba1d01e` | fix(auth): stop pretending there is a refresh token (B2) | B2 |
| `1c9f0cd` | fix(auth): mount authenticateJWT on /auth/me route directly (B1) | B1 |
| `836c881` | backend: wire WebTorrent seeder and owner-check PATCH /videos/:id/urls | seeder + B4 |
| `52eec6b` | docs: consolidate architecture into decisions.md + open-problems/ | docs |

Every Phase 0a punch list item from Appendix A is covered:

- **B1** auth middleware order → `1c9f0cd`
- **B2** refresh-token fiction (backend + Swift client) → `ba1d01e`
- **B3** like counter drift → `8650982`
- **B4** PATCH /videos/:id/urls ownership → bundled into `836c881`
- **B5** magnet URI JS injection → `05062ce`
- **B6** per-torrent stats in P2PResourceLoader → `63023ac`
- **S1** JWT_SECRET required at startup → `2a12cef`
- **S2** hlsUrl / thumbnailUrl https-only → `183e712`
- **S3** password policy raised (min 10 + common password deny-list) → `4bdd1ce`
- **S4** jest / ts-jest in devDependencies → `5bb5121`
- libtorrent Swift stubs + Package.swift target deleted → `63cc808`
- docs consolidation (CLAUDE.md + decisions.md + open-problems/) → `52eec6b` (from the prior session, landed at the start)

## Backend build & test status

At the tip of `main`:

```
cd backend
JWT_SECRET=dummy npm run build   # clean
JWT_SECRET=dummy npm test        # 1 test passes (placeholder smoke test)
```

`JWT_SECRET` is now **mandatory** — `npm run build` compiles without
it, but `npm start` / running the server will throw at import time
with a clear message pointing at `.env.example`.

## iOS build status

**Not verified.** No `xcodebuild` run was attempted because the Xcode
project file still references three deleted files and a deleted
target (see next section). The backend changes, the B5 JS-escaping
fix in `WebTorrentBridge.swift`, and the B6 per-torrent stats fix in
`P2PResourceLoader.swift` are all source-only and should compile
once the project file is cleaned up.

## Required human-in-the-loop step (Xcode)

`TorTok.xcodeproj/project.pbxproj` still contains references to the
three files deleted in `63cc808`:

- `TorTok/Services/Torrent/TorrentEngine.swift`
- `TorTok/Models/TorrentInfo.swift`
- `TorTok/TorTokDemo.swift`

And to the `LibTorrentBridge` target that no longer exists in
`Package.swift`.

Editing the pbxproj by hand is fragile (sort keys, build phase IDs,
etc.) and I deliberately did not attempt it. **In Xcode:**

1. Open `TorTok/TorTok.xcodeproj` in Xcode.
2. In the Project Navigator, find and remove the three red (missing)
   file references listed above — choose "Remove Reference" (NOT
   "Move to Trash", the files are already deleted on disk).
3. Find the `LibTorrentBridge` package product / target reference if
   it surfaces, and remove it.
4. Build (⌘B). Resolve any remaining import / symbol errors — expect
   maybe one or two leftover `TorrentEngine()` / `TorrentInfo`
   references that the Swift compiler will flag directly (I already
   cleaned up `TorTokApp.swift`, but there may be a strays I missed).
5. Commit the pbxproj delta as a follow-up, something like:
   `chore(ios): remove libtorrent file refs from xcodeproj`.

## Not done / deliberately out of scope

These were noticed during the work but not touched, because they
weren't in the approved scope:

- **Stale root-level status docs.** There are six Markdown files at
  the repo root that predate the WebTorrent transition and still
  describe the libtorrent plan — `BUILD_STATUS.md`,
  `READY_TO_RUN.md`, `XCODE_SETUP_COMPLETE.md`, `HOW_TO_RUN.md`,
  `QUICK_START.md`, `START_HERE.md`. `tldr search TorrentEngine`
  shows stale hits in several of them. Suggest a single "purge
  brownfield status docs" commit.
- **README.md beyond two lines.** I updated the two lines that still
  claimed libtorrent was the torrent engine, but the README's
  filesystem tree and many sections still describe the Swift-only
  iOS-first pre-Expo era and need a real refresh (probably after
  Phase 1).
- **test-content/update-video-url.mjs.** A throwaway helper script
  left uncommitted. Hardcodes a production Cloud Run URL and a
  specific video UUID — not suitable for repo inclusion as-is.
  Left in the working tree, untracked.
- **.tldr/ and .tldrignore.** `.tldr/` is runtime state (daemon pid,
  stats) and should be in `.gitignore`. `.tldrignore` is the config
  and is worth committing eventually. Both currently untracked.
- **Unrelated xcscheme change.** `TorTokUITests.xcscheme` had a
  pre-existing uncommitted modification (buildForProfiling YES,
  parallelizable removed) from before this session. Left as-is.
- **`backend/.claude/` dir.** Untracked, ignore.
- **ADR-005 refresh token flow.** The B2 fix deletes the refresh
  token fiction but does not design the real one. ADR-005 still
  mentions JWT, so it is technically consistent with "single
  access token, no refresh", but a follow-up ADR on session
  lifecycle / key rotation is worth queuing before we take real
  users.

## Things that would benefit from real tests

The smoke test in `backend/src/__tests__/smoke.test.ts` exists purely
to make `npm test` exit zero. Phase 0b or 1 should grow proper
coverage around at least:

- **B3 regression**: double-like / double-unlike against a real
  Postgres — the transactional rowCount check is easy to regress.
- **B4 regression**: owner-only PATCH /videos/:id/urls with
  non-owner returns 403, not 200/404.
- **S1 startup**: boot with no JWT_SECRET → throws, with one → ok.
- **S2 / S3 validation**: assertion for each rejected scheme and
  each deny-listed password.

## Starting Phase 0b

Per ADR-006 and `CLAUDE.md` the next phase is 0b: extract seeder
infra. That requires a fresh stop-and-check-in with the user before
I begin — both to confirm scope (which of L1–L4 comes first) and to
resolve the server-side half of `open-problems/seeding-policy.md`,
which 0b is supposed to force a decision on.

## Final state

```
$ git status
On branch main
Changes not staged for commit:
  (see "Not done / out of scope" above)
	modified:   TorTok/TorTok.xcodeproj/xcshareddata/xcschemes/TorTokUITests.xcscheme

Untracked files:
	.claude/
	.tldr/
	.tldrignore
	test-content/update-video-url.mjs
```

12 commits ahead of `origin/main`. Not pushed — per the approval
scope, pushing is explicitly the human's job.
