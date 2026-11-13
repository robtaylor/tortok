#!/usr/bin/env bash
#
# make-hls-fixture.sh
#
# The end-to-end stack's stand-in for a bridged Bluesky video (Decision
# 0010): clips/bbb-05.mp4 as an HLS stream with a thumbnail, the way Bluesky's
# video service serves one. seeder.mjs serves it under /hls/, and e2e-up.sh
# points the backend's BRIDGE_VIDEO_BASE there. Idempotent; needs ffmpeg.
#
# Output: test-content/hls/playlist.m3u8, segment-*.ts, thumbnail.jpg
# (remuxed, not re-encoded, so the bytes are the clip's).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC="$SCRIPT_DIR/clips/bbb-05.mp4"
OUT="$SCRIPT_DIR/hls"

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg not found on PATH. Install: brew install ffmpeg" >&2; exit 1; }
mkdir -p "$OUT"

ffmpeg -nostdin -hide_banner -loglevel warning -i "$SRC" \
  -c copy -bsf:v h264_mp4toannexb \
  -f hls -hls_time 4 -hls_playlist_type vod \
  -hls_segment_filename "$OUT/segment-%02d.ts" \
  -y "$OUT/playlist.m3u8"
ffmpeg -nostdin -hide_banner -loglevel warning -ss 2 -i "$SRC" -frames:v 1 -update 1 -q:v 4 -y "$OUT/thumbnail.jpg"

echo "done:"
ls -lh "$OUT"
