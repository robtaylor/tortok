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
- 2026-11-27, first two phones (TestMu AI; Moto G54 5G, Android 15, Dimensity 7020; Pixel 8, Android 14; build `ecea959`, reading production):
  - **Q1 passes for bridged posts.** The build installed and opened the feed signed out on both. On the Pixel 8 a bridged post started in 2.3 s as the first video after launch and in 1.1 s on a second visit, played 32 s and 9 s, and stalled once for 10 ms. The longest hold-up on either phone was 59 ms; the emulator's were 1 to 2 s.
  - **Q1 fails for torrents, on both phones.** The player gets HTTP 500 for the bridge's address within seconds and shows "Failed to load video". On the Pixel the address was ready 9 ms after the clip became active, so the torrent had already been added. On the Moto, WebTorrent logged the whole clip fetched from the webseed (3.4 MB, 1 peer). The bridge has no code that answers 500. Neither phone has a Wi-Fi proxy (`dumpsys wifi` says "Proxy settings: NONE" for every network, and `dumpsys connectivity` names none). The same APK plays these clips on the emulator.
  - **The cause is the rental's network, and it shows a gap in the app.** A second build logged the bridge's port, each request it got and each answer, and asked a failed source what it says. On the Pixel 8 the bridge listened and got no request at all. The app's own prefetch `fetch` of the bridge's address came back HTTP 500 in 75 ms, and the body of the 500 was `dial tcp 127.0.0.1:39073: connect: connection refused`: the wording of a Go program that tried to connect to that address from somewhere that isn't the phone. So the phones send the app's HTTP requests through a proxy, loopback included, although no Wi-Fi proxy is set. Torrents can't be measured on these phones until requests to the bridge skip the proxy, and a phone whose VPN or network sets a proxy would fail the same way.
  - **With requests to the bridge skipping the proxy, torrents play on both ends of the range.** The player's HTTP client now connects straight to loopback addresses, and prefetch reads the torrent without a request ([p2p-torrent](../../p2p-torrent.md#torrent-engine)). Same day, same production feed, one swipe every 10 s, on the rental's network:

    | Phone | Kind | Videos | Start: median | 90th percentile | Stalls | Longest hold-up |
    |---|---|---|---|---|---|---|
    | Pixel 8, Android 14 | bridged (HLS) | 12 | 1.2 s | 1.7 s | none | 959 ms |
    | Pixel 8, Android 14 | torrent | 5 | 0.8 s | 1.0 s | none | 1.2 s |
    | Moto G22, Android 12 | bridged (HLS) | 13 of 15 (two swiped past) | 1.4 s | 2.3 s | none | 1.3 s (the first video; 141 ms after it) |
    | Moto G22, Android 12 | torrent | 5 | 3.0 s | 3.4 s | none | 3.8 s |

  - **Against the proposed bar:** nothing stalled and nothing failed. Bridged posts start a little over the 1 s median on both phones. Torrents beat bridged posts on the Pixel and miss the bar by a wide margin on the Moto G22.
  - **The torrent path holds the app up, and on a slow phone that is the start time.** With a torrent clip active the app's timers ran 0.9 to 1.2 s late on the Pixel 8 and 3.0 to 3.8 s late on the Moto G22, every time; with a bridged post, 18 to 141 ms. On the Moto the playback address was ready within 35 ms of the clip becoming active (it had been prefetched), yet the player took 2.3 to 3.3 s to be ready, about as long as the hold-up. Swipes made during it landed late: the torrent clips stayed up 13 to 19 s on a 10 s clock, and the next post was twice swiped past within a second or so.
  - **A lead on why:** the player asked the bridge for the whole file four times in five seconds on the Pixel (`no range → 200 OK, 2917841 bytes` each), and the bridge passes every byte through the JavaScript thread. Not yet examined.
  - **Most of the bridged posts seen didn't play, and it wasn't the phone.** Six of the seven bridged posts the two sessions reached were one Bluesky account's (`did:plc:i4kc2u5tmcitzuufubhsp62l`, the account behind that morning's smoke failures), and Bluesky answered 404 for each video. Their captions carry adult hashtags. So few bridged starts were measured.
  - **The rental's tools.** A session has a live device log with a text filter, which shows lines that arrive after the filter is set, and a restricted `adb shell`: `input`, `dumpsys`, `getprop` and `grep` run; `logcat` and `settings` are refused. The profiling switch isn't offered until TestMu's support enables it for the account. A swipe on the streamed screen needs pointer events in steps; a single drag is ignored.
  - **Seen in passing:** a release build logs `rn-webrtc` debug lines, dozens for each peer connection. The root layout drops them in development only.

## Outcome

(Single short paragraph at resolution. The conclusion sentence becomes the Status line.)
