# Release process

Lightweight by design. tortok is an application, not a published package: an Expo (React Native) client for iOS / Android / web, a Node + TypeScript backend evolving into an atproto AppView, and tracker and TURN infrastructure on Fly.io. A "release" is a client build submitted to the app stores (and the web deploy) together with the backend/infra deploy that supports it, tagged with a `CHANGELOG` entry — not a crates.io / npm / PyPI publication. The operational launch plan and its gating criteria live in [`docs/plans/release-plan.md`](plans/release-plan.md).

## When to release

Cut a release when:

- A user-visible feature or fix lands that you want consumers to be able to pin against.
- Schema or Command-Line Interface (CLI) changes happened and consumers need a stable reference point.
- A meaningful chunk of work in `docs/plans/` is closed (e.g. a phase exits all criteria).

There is no fixed cadence.

## Versioning

[Semantic Versioning (SemVer)](https://semver.org/), starting once the first numbered release ships. Pre-1.0 versions (`0.x.0`) carry the standard SemVer caveat: minor bumps may include breaking changes; specific stable contracts are documented in their own decision records and follow stricter rules.

Stable contracts (additive-only; breaking changes require a major bump and a deprecation window):

- The `app.tortok.video.*` Lexicon namespace — `lexicons/`, governed by Decision 0012 (namespace governance) and Decision 0002 (atproto federation). Records published to users' PDSes are the durable external contract.

Internal HTTP routes, log formats, and human-readable outputs are **not** stable parseable contracts; federating consumers should rely on the Lexicon records above.

## Release notes

Write the notes in the `[Unreleased]` section of [`CHANGELOG.md`](../CHANGELOG.md) as work lands. Open them with a short **"What this means for you"** block: a few benefit-framed bullets saying what a user can now *do*, before the technical `### Added` / `### Changed` detail. That block becomes the release intro.

## Steps

For maintainers cutting a release:

1. **Verify the checks pass.** There is no CI yet (no `.github/`); Decision 0016 and the [environments plan](plans/environments-staging-production-and-their-checks.md) set it up. Until then, run the backend and client unit tests and the Detox suite by hand.

2. **Roll the `[Unreleased]` section in [`CHANGELOG.md`](../CHANGELOG.md) into a numbered version block.** Format follows [Keep a Changelog](https://keepachangelog.com/). Update the link references at the bottom. Leave a fresh empty `[Unreleased]` section.

3. **Bump `version`** in `tortok/package.json`, `tortok/app.json` (`expo.version`) and `backend/package.json`, then run `npm install` in each to update the lockfiles.

4. **Commit:** `chore: release v<X.Y.Z>` with whatever attribution conventions your project uses.

5. **Tag:** `git tag -a v<X.Y.Z> -m "v<X.Y.Z>"` then `git push --tags`.

6. **Create a GitHub release** from the tag. Body = the CHANGELOG section for that version.

7. **Deploy.** Backend: `fly deploy` from `backend/`; before public release this goes straight to production (Decision 0016, commitment 12), afterwards it promotes the image staging passed. Web: `npm run deploy:web` from the repo root. App-store builds are not set up yet: there is no `eas.json`.

## Release candidates (optional)

During the RC window, `main` **is** the candidate. It stays at `X.Y.Z-rc.N` with the notes still under `[Unreleased]`; each new RC is a `main` commit bumped to the next `-rc.N` and tagged `vX.Y.Z-rc.N`. Publish RCs as prereleases, never marked "Latest", and validate the documented install commands against them.

**Don't roll `main` to the final version before the RC validates.** Only promotion rolls `[Unreleased]` into a dated `[X.Y.Z]` block (step 2 above) and bumps to `X.Y.Z`. Rolling first leaves `main` claiming a version that has no release.

## What does NOT need to change at release time

- Area docs in `docs/architecture/` (unless the release changes the design they describe).
- `LICENSE` (unless re-licensing).

## Pre-release checklist (one-time, before the first numbered release)

These items block the first release. As they land, they're checked off in the same Pull Request (PR) that landed them.

- [ ] Launch criteria in [`docs/plans/release-plan.md`](plans/release-plan.md) met (signup/spam gate, moderation floor per Decision 0013, etc.).
- [ ] All Continuous Integration (CI) jobs green on `main`.
- [x] License chosen and a root `LICENSE` file added: Apache-2.0 (2026-11-10), declared in every `package.json`.
- [ ] No GPL or AGPL code in the shipped app, because copyleft terms conflict with App Store distribution; GPL projects such as iTorrent are reference only. `NOTICE` file in place if vendoring third-party code.
- [ ] End-to-end test exercising the headline feature.
- [ ] User-facing docs cover the install path.

## Cross-references

- [`CHANGELOG.md`](../CHANGELOG.md) — release log.
- [`docs/plans/release-plan.md`](plans/release-plan.md) — operational launch plan and gating criteria.
- [`docs/architecture/decisions/0012-lexicon-namespace.md`](architecture/decisions/0012-lexicon-namespace.md) — stability contract for the Lexicon namespace.
