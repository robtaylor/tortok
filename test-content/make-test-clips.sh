#!/usr/bin/env bash
#
# make-test-clips.sh
#
# Produce 5 × 20s portrait-oriented test clips for TorTok from Big Buck Bunny
# (© Blender Foundation, CC-BY 3.0). Idempotent — re-run to regenerate.
#
# Output: test-content/clips/bbb-01.mp4 … bbb-05.mp4 (608×1080, H.264, faststart)
#
# Phase 0b note: these clips live in-repo for spike convenience. Production
# seeding will serve from R2 (Decision 0006 Phase 0b L1), at which point this script
# can graduate into a CI step that uploads the results.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_URL="https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_1080p_h264.mov"
SRC_FILE="/tmp/claude/bbb-1080p.mov"
OUT_DIR="$SCRIPT_DIR/clips"

mkdir -p /tmp/claude "$OUT_DIR"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH. Install: brew install ffmpeg" >&2
  exit 1
fi

if [[ ! -f "$SRC_FILE" ]]; then
  echo "Downloading Big Buck Bunny 1080p (~692 MB)…"
  curl -fL --progress-bar -o "$SRC_FILE.partial" "$SRC_URL"
  mv "$SRC_FILE.partial" "$SRC_FILE"
fi

# Five windows spaced across the 9:56 runtime. Each starts clean of the
# opening/closing title cards (which are 16:9 letterboxed text that would
# look weird cropped to portrait).
starts=("00:00:42" "00:02:05" "00:03:45" "00:05:30" "00:07:20")

for i in "${!starts[@]}"; do
  n=$(printf "%02d" $((i + 1)))
  start="${starts[$i]}"
  out="$OUT_DIR/bbb-${n}.mp4"

  echo "encoding bbb-${n}.mp4 (start=$start, 20s portrait crop)…"
  # crop=ih*9/16:ih → take centered 9:16 slice, full height.
  # 1080p source → 608×1080 output (both even, h264-safe).
  # +faststart → moov atom up front so HTTP range seek works instantly.
  ffmpeg -nostdin -hide_banner -loglevel warning \
    -ss "$start" -i "$SRC_FILE" -t 20 \
    -vf "crop=ih*9/16:ih" \
    -c:v libx264 -preset fast -crf 23 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    -y "$out"
done

echo ""
echo "done. clips:"
ls -lh "$OUT_DIR"/*.mp4
