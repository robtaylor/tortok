# Open problem: In-app video editor (trim + captions)

**Status:** Designed, not scheduled. Architecture and model choices
are settled; what remains is committing the work to a phase. When
that happens, promote this file to a new ADR (likely ADR-014) and
delete it.

**Must resolve by:** Whenever in-app editing enters the phase plan.
Not currently on the Phase 3 / 4 / 5 roadmap. Plausible homes are
Phase 3.5 (between atproto integration and AppView cutover) or a
post-launch v1.1, depending on how much friction users hit posting
raw clips on Phase 3.

**Blocks:** Nothing currently. Phase 3 (atproto integration) ships
posting with whatever clip the user provides — record, gallery
import, or external editor — so this design is forward-looking, not
gating.

**Related ADRs:** ADR-004 (Expo + RN + TS), ADR-006 (phase plan),
ADR-010 (bridged Bluesky posts mirror filter stack — relevant
because in-app captions need to round-trip through atproto records
in a way the filter stack will see).

## Why this exists

Phase 3 will ship posting from a raw clip — record or gallery
import, no editing surface beyond what the OS picker provides. That
is fine for a closed beta and probably for first launch. But the
short-form video genre expects in-app trim and captions; users who
are willing to leave the app to edit in CapCut / VN are a small
fraction of the addressable market. We worked through what an
in-app editor would look like on 2026-05-02 to lock the design
*before* it becomes urgent, so when scheduling pressure arrives
(post-launch retention data showing high abandonment between record
and post, or beta feedback) the design is ready and we don't
re-litigate it under time pressure.

## Scope

The editor is intentionally narrow:

- **Trim** — set in/out points on a single clip
- **Captions** — auto-transcribe, render as overlay, allow per-line
  text edits, fixed position and style (no font/color picker)
- **Post** — export to local mp4, hand off to the existing post flow
  (atproto record + seeder)

Out of scope for v1: multi-track, music/audio mixing, transitions,
filters, color correction, stickers, draggable text, speed control,
reverse, drafts, undo/redo, multi-clip projects.

## Decisions

1. **Aspect ratio: 9:16 enforced.** Crop on import; no other
   aspect supported in v1. Massively simplifies preview and export.
   Matches the feed (which is portrait-first per ADR-010 mention).

2. **Single caption style: TikTok Sans, bold white, drop shadow,
   bottom third.** TikTok Sans is SIL OFL 1.1 (verify before
   shipping). One opinionated style, no picker. The only knobs the
   user gets are *text content* (per-caption inline edit) and
   *vertical position nudge*.

3. **No filters in v1.** Adds Skia shader work for marginal value
   on top of the trim+captions core. Revisit when the rest is
   stable and telemetry justifies it.

4. **Caption transcription: on-device Whisper via whisper.cpp.**
   - iOS uses the Core ML mlmodelc bundle alongside GGML weights;
     whisper.cpp picks up ANE acceleration automatically on A14+
     (any iPhone 12 or newer, i.e. the realistic install base).
   - Android uses GGML quantized (q5_0) with NEON. CPU-only is fast
     enough for ≤60s clips on Snapdragon 7 Gen 1+ / equivalent.
   - No NPU acceleration on Android in v1. The Hexagon (QNN) and
     MediaTek (NeuroPilot) paths require per-SoC builds and vendor
     SDKs and aren't worth the QA matrix for clip lengths this
     short. v2 escape hatch if telemetry shows real pain.

5. **Model download on first use, not bundled.** R2-hosted under
   `tortok-models/whisper-*/`. Validate by SHA-256, cache in app
   support dir. App-binary size stays clean; bundle complexity
   stays manageable.

6. **Locale-aware model selection at first launch.**

   | Device locale | Model | Approx download |
   |---|---|---|
   | `ja-*` | **kotoba-whisper-v2.0** (q5 GGML, distilled from large-v3, ReazonSpeech-trained) | ~250–400 MB |
   | `en-*` | `whisper-base.en` (q5 GGML) | ~150 MB |
   | anything else (incl. `es-*`) | `whisper-base` multilingual (q5 GGML) | ~150 MB |

   Three model files, one whisper.cpp runtime, locale picks at
   first launch. User can override in settings.

   Spanish on vanilla multilingual is fine — Spanish is well
   represented in Whisper's training data and community fine-tunes
   show only marginal improvements. Japanese is the language where
   a fine-tune (kotoba-whisper) materially outperforms vanilla and
   is therefore worth a dedicated bundle.

7. **Language autodetection, no language picker UI in v1.**
   Whisper's first-window detection is sub-100ms and right >95% of
   the time on clean audio. Add a "wrong language?" override only
   if support load justifies it.

## Architecture

```
EDITOR SCREEN  (React, Zustand for edit doc)
  PreviewSurface — react-native-skia <Canvas>
    • <Video useVideo(src)>           ← decoded frames
    • Caption overlays (SkText)        ← time-gated by playhead
    • User overlays (later, not v1)
  TrimStrip — react-native-video-trim showEditor (v0)
                or Reanimated handles + thumbnail strip (v1 polish)

EDIT DOCUMENT  (Zustand store, pure JSON)
  { sourceUri, durationMs,
    trim: { inMs, outMs },
    captions: [{ text, startMs, endMs, style, x, y }],
    aspectRatio: "9:16" }
  ← The only contract between JS preview and native export.

NATIVE MODULE: TortokExport
  iOS  (Swift, ~300 LOC)
    AVMutableComposition (insert source[in..out])
      + AVMutableVideoComposition
        + AVVideoCompositionCoreAnimationTool
            ← CALayer tree built from edit doc
              (CATextLayer per caption + CAKeyframeAnim
               for time-gated visibility)
      + AVAssetExportSession (preset 1080p, .mp4)

  Android  (Kotlin, ~500 LOC)
    MediaExtractor → MediaCodec (decode) → GLES surface
      ↳ Renders frame + caption overlay quads (text baked
        to bitmap textures via Canvas + Paint)
      ↳ MediaCodec (encode H.264) → MediaMuxer → .mp4

TRANSCRIPTION (parallel, on import; not blocking trim UI)
  AVAssetReader / MediaExtractor (audio-only, 16kHz mono PCM)
    → whisper.cpp via mybigday/whisper.rn
    → captions[] hydrated into edit doc
```

### Why this shape

- **Skia previews, native exports.** Two render paths is the right
  call here — the alternative (driving AVAssetWriter live for
  preview) is much more code for marginal gain. Skia gives us a
  cheap WYSIWYG preview without re-implementing AVMutableComposition
  in JS.
- **Edit doc is the only contract.** Pure JSON. JS builds it;
  native consumes it. Native module stays dumb; JS side stays
  testable. Adds drafts / undo / cloud sync later without touching
  native.
- **react-native-video-trim is v0, not v1.** Ship its `showEditor`
  for the first cut to skip writing a slider, then replace with
  Reanimated handles for UX polish (custom thumbnails, 60fps
  scrubbing) when it matters.
- **No FFmpeg.** Tempting because OSS examples lean on it, but
  ffmpeg-kit-react-native upstream was archived in early 2025 and
  the LGPL/GPL boundaries are fiddly. AVFoundation + MediaCodec do
  the job without licensing complexity.

## Stack components

| Layer | Choice | License |
|---|---|---|
| Playback (feed + editor preview) | `expo-video` | MIT |
| Trim UI (v0) | `react-native-video-trim` | MIT |
| Overlay rendering | `@shopify/react-native-skia` | MIT |
| STT runtime | `whisper.cpp` via `mybigday/whisper.rn` | MIT (whisper.cpp), MIT (whisper.rn) |
| Caption font | TikTok Sans | SIL OFL 1.1 (verify) |
| Final export | First-party RN native module wrapping AVFoundation (iOS) / MediaCodec + MediaMuxer (Android) | First-party |

All open-source or platform-provided. No vendor SDKs.

## Effort estimate

| Slice | Effort |
|---|---|
| Skia preview + edit doc + Zustand wiring | ~3 days |
| `react-native-video-trim` integration (v0) | ~1 day |
| iOS export module | ~3–4 days |
| Android export module | ~5–7 days |
| `whisper.rn` integration + locale-aware bundle fetch | ~2 days |
| Caption inline editor UI | ~2 days |
| Codec / aspect / HDR edge-case buffer | ~3 days |
| **Total** | **~3–4 weeks for one engineer** |

Android is the long pole. iOS-only first cut is ~2 weeks if Android
defers to v1.1.

## Deferred sub-questions

These are not blocking and don't need answers until the editor is
phase-scheduled:

1. **Model size: tiny vs base.** Base is ~2× the bundle and a small
   quality bump. Default proposal is base; revisit if the JP bundle
   (kotoba-whisper, ~300 MB) feels too heavy and we want a smaller
   default.
2. **Drafts and undo/redo.** Edit doc is pure JSON, so adding both
   later is mechanical. Out of scope for v1.
3. **Language override UI.** Add only if telemetry shows misdetection
   complaints. Whisper autodetect is right >95% on clean audio.
4. **Live caption preview during filming.** v2. Requires continuous
   inference and is where NPU acceleration would actually pay off.
5. **Mandarin quality.** If JP-quality captions for ZH become
   important, swap whisper.cpp for **Sherpa-onnx + Paraformer** for
   the `zh-*` locale bundle. Same architecture, different runtime
   for one bundle.
6. **NPU acceleration on Android (Hexagon QNN, MediaTek NeuroPilot).**
   v2 trigger is multilingual `whisper-base` running >5s on a
   Snapdragon 6-class device, or a battery complaint thread. Not
   before.

## Ruled out (with rationale)

- **Vendor SDKs (img.ly, Banuba).** Quote-based pricing, indie-hostile,
  bundle-heavy. Conflicts with the OSS-or-platform preference.
- **FFmpeg / FFmpeg-Kit.** Upstream archived early 2025;
  LGPL/GPL boundary complexity; bundle cost. AVFoundation + MediaCodec
  cover the export job without it.
- **Forking an existing OSS RN editor.** Surveyed
  (OpenCut, Vesper, vibecut, video-editing-suite, MostWantIT,
  rahulmewada65, anday013, usman965). Either wrong runtime
  (Flutter, web, native Android-Kotlin), abandoned, or vapor.
  Closest reference is the `react-native-video-trim` example app
  and Shopify's Skia `useVideo` samples — read these, don't fork.
- **OpenCut Rust core via UniFFI/JSI.** Technically credible —
  `uniffi-bindgen-react-native` is real — but no one is publicly
  shipping a video pipeline through it, and OpenCut's compositor
  assumes browser MediaSource for decode. Wrong constraint set for
  v1. Revisit only if Skia overlay compositing on the JS thread
  becomes a profiled bottleneck.
- **Distil-Whisper at mobile size.** Distil-Whisper's multilingual
  variant only exists at large-v3 size (~750 MB+ quantized), too
  big for an app download. The smaller distil variants are
  English-only.
- **Sherpa-onnx as default runtime.** Same NPU story as whisper.cpp
  on Android (CPU is the realistic path for both). Worth keeping
  in the back pocket for Mandarin (Paraformer); not the default.

## What a resolved version looks like

- This file deleted.
- A new ADR (likely ADR-014) committing the decisions above.
- Editor work scheduled in a phase (Phase 3.5 most plausible if
  post-launch retention data justifies it).
- A `lexicons/app/tortok/video/post.json` revision if the caption
  format needs to round-trip through the atproto record (current
  Lexicon has a `caption` string; per-segment captions with timing
  would need a new field — possibly `captionTrack` referencing a
  separate WebVTT blob, decided at ADR time).
