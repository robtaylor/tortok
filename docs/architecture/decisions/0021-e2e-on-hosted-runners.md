# Decision 0021 — End-to-end tests run on GitHub-hosted runners against a throwaway local stack

**Status:** Accepted (partial) (2026-11-10). Revises where tier 1 of [Decision 0014](0014-device-testing-strategy.md) runs, and [Decision 0016](0016-testing-strategy-where-each-kind-of-test-lives.md)'s commitment 3 (self-hosted Android emulators) and commitment 6 (e2e login through atproto OAuth). Detox runs on both platforms in CI; the two-emulator P2P offload check of tier 1 is not built yet.

**Current architecture:** [Client](../client.md).

**TL;DR.** In the context of end-to-end tests for the Expo app, facing no CI at all, a test account limited to about 10 logins a day, and a Detox suite that couldn't sign in, we chose to run Detox on GitHub-hosted runners (an iOS simulator on macOS, an Android emulator on Linux) against a throwaway local stack that includes its own atproto PDS, signing in with an app password through a form compiled only into e2e builds, to get both platforms tested on every pull request at no cost, accepting that the real OAuth sign-in isn't covered and the runners' network isn't ours.

## Context

What the code did on 2026-11-10, before this change: the Detox suite in `tortok/e2e/` targeted the iOS simulator only, was run by hand, and couldn't sign in, because its `login()` helper filled email and password fields that the atproto OAuth login had replaced. Nothing ran in CI. The app's feed was also unreachable after an OAuth sign-in, because the feed query waited for a legacy token that OAuth never creates.

Decision 0014 put tier 1 (P2P logic and regression on emulators) on self-hosted emulators in our own network, for full network control. Decision 0016 made tier 1 the primary regression gate, with two self-hosted Android emulators (commitment 3), and planned for the Detox login to move to the atproto OAuth flow against a test account (commitment 6).

Three things changed the picture:

- On 2026-11-10 the repository became public, which makes GitHub-hosted Actions runners free, including macOS. Self-hosting would have covered Android only: iOS simulators need macOS hardware, and EC2 Mac instances bill a 24-hour minimum.
- The real test account, `tortok-dev.bsky.social`, allows about 10 logins a day. A suite that installs the app fresh per test file, on two platforms, on every pull request, would exhaust that in a day. Detox also can't drive the system browser that OAuth opens.
- The [test-PDS spike](spikes/test-pds-in-ci.md) showed that Bluesky's `@atproto/dev-env` runs a PLC directory and a PDS inside a CI job in under a second, with unlimited app-password logins.

## Decision

1. **Detox runs in CI on GitHub-hosted runners, on every pull request:** the iOS simulator on `macos-26` and the Android emulator on `ubuntu-latest` with KVM (`.github/workflows/e2e.yml`). Both run release builds, so no Metro server is involved.
2. **Each job starts its own stack** with `scripts/e2e-up.sh`: a throwaway PLC and PDS with a test account (`test-network/start.mjs`), the backend with its own Postgres database, the local tracker, and the content server that seeds and serves the test clips. Nothing touches production or `bsky.social`, which keeps Decision 0016's rule that end-to-end tests never run against production.
3. **E2e builds sign in with an app password against that PDS,** through a form on the login screen that exists only when the bundle is built with `EXPO_PUBLIC_E2E=1` (`tortok/lib/atproto/devSignIn.ts`). This replaces Decision 0016's commitment 6 for routine runs.
4. **The real OAuth sign-in gets its own small suite later,** run rarely and by hand against a real account, rather than on every pull request.
5. **Unchanged from 0014 and 0016:** what tier 1 must eventually check (two emulators peering, offload accounted), tier 2 and tier 3 on real devices, and the staging and smoke-check commitments.

## Alternatives considered

- **Self-hosted emulators (0014 as written)** — rejected for now because they cover Android only, cost money and upkeep, and hosted runners are free for a public repository. The network-control argument still matters for the two-emulator P2P check, and is revisited there.
- **A device farm's virtual devices (TestMu Virtual Automation Cloud, $139 a month billed annually)** — rejected because it costs money that hosted runners don't, and its Detox support was unverified.
- **A dev-only button that sets the test DID without contacting any PDS** — rejected because it exercises no sign-in at all. The throwaway PDS gives a real app-password login at no extra cost.
- **Passing tokens from one real `bsky.social` login into every launch** — rejected because it still depends on someone else's production service and the account's limits.

## Consequences

- Every pull request runs the main UX on both platforms: sign-in, the feed loading the test clips, playback over WebTorrent, pause and resume, swiping between clips, tabs, profile, session persistence and sign-out.
- Release builds are now tested. The first run found a crash that debug builds hide: `bittorrent-tracker` read `window.location.protocol`, which React Native lacks outside development, for any `ws://` tracker. Since magnets come from public records, one post could crash every release build. It's patched with `patch-package` (`tortok/patches/`).
- The app carries a test sign-in form in e2e builds, gated by a build-time flag that user builds never set.
- The real OAuth flow isn't covered on every pull request.
- The runners' network belongs to GitHub, so the two-emulator P2P offload check may need a different home when it's built.
- CI time: each job builds the app from scratch, around 20–30 minutes per platform without caching.

## Walk-back options

- **If hosted-runner emulators prove too flaky or slow for P2P checks,** run that one check on self-hosted emulators per Decision 0014, and keep the rest here.
- **If the repository goes private again,** macOS minutes become expensive; move iOS to a self-hosted Mac runner.
- **If OAuth regressions slip through,** promote the OAuth suite to run on a schedule.

## Links

- [`spikes/test-pds-in-ci.md`](spikes/test-pds-in-ci.md) — the throwaway PDS on hosted runners.
- [Decision 0014](0014-device-testing-strategy.md) and [Decision 0016](0016-testing-strategy-where-each-kind-of-test-lives.md) — the testing tiers and commitments this revises.
