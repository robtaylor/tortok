#!/usr/bin/env bash
# Build the Android app for measuring playback on a real device
# (docs/architecture/client.md, Testing): a release build bundled with
# EXPO_PUBLIC_PERF=1, which opens the feed without sign-in and mixes the
# pinned posts into it. Prints the APK's path on its last line.
#
#   npm run perf:apk
#
# Expects `npm ci` to have run in tortok/, and Java and the Android SDK.
#
# Env: PERF_PINS     AT-URIs to pin, comma-separated (default: the five test
#                    clips production's dev account publishes, the only
#                    native posts there)
#      PERF_APPVIEW  the AppView the build reads (default: production's)
#      PERF_ARCH     ABI to build (default arm64-v8a, which phones run; the
#                    emulator on an Intel host wants x86_64)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIPS=at://did:plc:teqobv6pqer5nw7roqrgi55v/app.tortok.video.post

export EXPO_PUBLIC_PERF=1
export EXPO_PUBLIC_PERF_PINS="${PERF_PINS-$CLIPS/3mzxkueeat623,$CLIPS/3mzxkufnwst2q,$CLIPS/3mzxkuhhdqi2b,$CLIPS/3mzxkuio7ug23,$CLIPS/3mzxkukblgl2b}"
# Set even at their defaults: a developer's tortok/.env.local can hold other
# values (a local backend, P2P off), and Expo reads that file when it bundles.
# What the shell sets wins.
export EXPO_PUBLIC_API_URL="${PERF_APPVIEW:-https://appview.tortok.app}"
export EXPO_PUBLIC_USE_P2P=1

cd "$REPO_ROOT/tortok"
npx expo prebuild --platform android

# Expo inlines EXPO_PUBLIC_* into the bundle, and neither Gradle nor Metro
# counts them as an input. So the bundle is made again whatever Gradle thinks
# of it, and from a Metro cache (it lives in the temp directory) that no build
# with other settings shares.
export TMPDIR="$REPO_ROOT/tortok/android/build/perf-tmp"
mkdir -p "$TMPDIR"

cd android
./gradlew :app:createBundleReleaseJsAndAssets --rerun :app:assembleRelease \
  -PreactNativeArchitectures="${PERF_ARCH:-arm64-v8a}"

APK="$PWD/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "perf-apk: the build left no $APK" >&2; exit 1; }
echo "$APK"
