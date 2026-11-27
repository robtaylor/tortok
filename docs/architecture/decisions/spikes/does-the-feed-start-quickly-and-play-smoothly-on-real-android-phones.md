# Spike — Does the feed start quickly and play smoothly on real Android phones?

**Status:** Open. Time-box: one month of rented phones from the first session; the first run is three phones, about 35 videos each.

<!--
At resolution, update Status to one of:
  Resolved (YYYY-MM-DD) — YES; <one-line outcome>
  Resolved (YYYY-MM-DD) — NO; <one-line outcome>
  Resolved (YYYY-MM-DD) — PARTIAL; <one-line outcome>
And fill in the Outcome section below. A resolved spike is never deleted
or archived; the decision that follows from it cites it.
-->

## Question

On real Android phones, from low-end to recent, does a feed video start quickly and then play without stalling, for both kinds of playback: a bridged post's HLS stream and a native post's torrent?

## Why this is in question

No real Android phone has run the app. It has run on the Android emulator and the iOS simulator, and Phase 2's offload measurement used two iOS simulators ([the Phase-2 spike](phase-2-p2p-offload.md)).

The torrent path is the one to worry about. WebTorrent runs on the app's JavaScript thread and hands the video to the player through a local TCP bridge ([p2p-torrent](../../p2p-torrent.md#torrent-engine)), so on a slow phone it competes with the interface for that thread. Phase 3 Unit 3 lets people publish native posts, and a published record can't be changed, so a problem with torrent playback is cheaper to find before then.

## Approach

- **The build.** `npm run perf:apk` makes a release build for phones (arm64) that opens the feed without sign-in, since nobody can sign in on a rented phone. It reads production and loads the 30 newest posts with production's five test clips mixed in, one after every second post. Without that the run would hold no native posts: the newest posts are all bridged. [Client, Testing](../../client.md#testing) describes it.
- **The measurement.** The app logs one `[playback]` record for each video watched: the time from the video becoming the active item to a playing picture, each stall after that and how long it lasted, and the longest the app was held up. `npm run playback:report -- <device log>` turns a phone's log into figures for each kind.
- **The phones.** Rented by the month from TestMu AI (formerly LambdaTest), on its plan for manual sessions on real devices, which records frame rate, CPU and memory during a session and keeps the device's log. Three to start: a low-end phone, a mid-range one and a recent one.

Sub-questions, cheapest first:

- **Q1.** Does the build install, open the feed and play both kinds on each phone?
- **Q2.** How long do videos take to start, and how often do they stall, on the rental's own network? Swipe through all 35 videos, leaving each to play for about ten seconds, then press Home: a video's record is written when it is left or the app leaves the foreground.
- **Q3.** The same on a connection throttled to something like 4G, if a single-device session can be throttled. The rental's network is a data centre's, so Q2 is the best case.

What this can't show:

- **Dropped video frames.** The player doesn't report them, and the rental's frame rate counts the interface's frames, not the video's. The session recording is the only evidence.
- **Peers on home networks.** Phones in a data centre say nothing about WebRTC between phones behind home routers.

## Decision matrix

The bar, proposed 2026-11-27 and not yet agreed: on each phone and for each kind, half of videos start within 1 second and nine in ten within 2.5 seconds; stalls take under 1% of the time spent playing; no video fails.

| Outcome | Means | Action |
|---|---|---|
| Q1 fails on a phone | The app doesn't run there | Fix it before anything else |
| Both kinds meet the bar on all three phones | Playback is good enough to build on | Unit 3 goes ahead |
| HLS meets the bar, torrents don't | The torrent engine on a phone is the problem | Find where the time goes from the records (`urlMs`, `readyMs`, stalls, hold-ups) and fix or re-plan it before Unit 3 publishes anything |
| Neither meets the bar | The feed or the player is the problem, whatever the source | Fix the player before Unit 3 |
| Q2 meets the bar, Q3 doesn't | It works on a fast connection only | Decide what a slow connection should get (a lower rendition, more prefetch) before public release, not before Unit 3 |

## Findings

(Filled in as the spike runs. Terse — these are evidence, not narrative.)

- 2026-11-27: the build and the report work end to end on the Android emulator (API 35, arm64, on a Mac). The feed opened signed out from production with the test clips mixed in, and the report read the records out of `adb logcat`. The emulator had been up for five days and was barely responding, so its figures say nothing about a phone. One thing to watch for: the one torrent clip it played stalled twice, for 5 seconds of 13.

## Outcome

(Single short paragraph at resolution. The conclusion sentence becomes the Status line.)
