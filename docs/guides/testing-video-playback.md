# Testing Video Playback in TorTok

## Overview

The TorTok video player is now implemented with:
- ✅ AVPlayer-based HLS streaming
- ✅ P2P resource loader (architecture in place)
- ✅ TikTok-style swipeable feed
- ✅ Like/Share interactions
- ✅ Buffering indicators
- ✅ P2P statistics overlay

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| VideoPlayer service | ✅ Complete | AVPlayer wrapper with P2P support |
| P2PResourceLoader | 🚧 Stubbed | Architecture ready, needs LibTorrent integration |
| VideoPlayerView | ✅ Complete | SwiftUI component with controls |
| VideoFeedView | ✅ Complete | Swipeable TikTok-style feed |
| HLS Playback (HTTP) | ✅ Working | Uses standard HLS streams |
| P2P Playback | ⚠️ Fallback only | Falls back to HTTP (LibTorrent needed) |

## Test HLS Streams

The app is configured to use publicly available test streams. Here are good options:

### 1. Mux Test Stream (Currently Used)
```
URL: https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
Duration: ~60 seconds
Quality: Multiple bitrates (adaptive)
Format: HLS with multiple quality levels
```

### 2. Apple Sample Streams
```
Bipbop Stream:
https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8

Advanced Stream (4K):
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8
```

### 3. Big Buck Bunny (Open Source)
```
URL: https://test-streams.mux.dev/test_001/stream.m3u8
Duration: Full movie
Quality: Multiple bitrates
```

## Running the App with Test Videos

### Option 1: Use Built-in Demo Video

The app automatically loads a demo video from Mux if the API call fails:

```swift
// In VideoFeedView.swift FeedViewModel
private func createDemoVideos() -> [Video] {
    return [
        Video(
            id: UUID(),
            user: demoUser,
            caption: "Testing P2P video streaming with HLS! 🚀",
            magnetLink: "",
            hlsURL: URL(string: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"),
            thumbnailURL: URL(string: "https://picsum.photos/1080/1920")!,
            durationSeconds: 30,
            width: 1080,
            height: 1920,
            hashtags: ["p2p", "decentralized", "tortok"],
            likeCount: 1234,
            isLiked: false,
            createdAt: Date()
        )
    ]
}
```

**To test**: Just run the app! Since there's no backend yet, it will automatically load the demo video.

### Option 2: Add More Test Videos

Edit `VideoFeedView.swift` and add more videos to the `createDemoVideos()` function:

```swift
private func createDemoVideos() -> [Video] {
    let demoUser = User(...)

    return [
        // Video 1: Mux test stream
        Video(
            id: UUID(),
            user: demoUser,
            caption: "Short test video 🎥",
            magnetLink: "",
            hlsURL: URL(string: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"),
            thumbnailURL: URL(string: "https://picsum.photos/1080/1920?random=1")!,
            durationSeconds: 60,
            width: 1080,
            height: 1920,
            hashtags: ["test", "hls"],
            likeCount: 100,
            isLiked: false,
            createdAt: Date()
        ),

        // Video 2: Apple Bipbop
        Video(
            id: UUID(),
            user: demoUser,
            caption: "Apple's test stream 🍎",
            magnetLink: "",
            hlsURL: URL(string: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8"),
            thumbnailURL: URL(string: "https://picsum.photos/1080/1920?random=2")!,
            durationSeconds: 120,
            width: 1080,
            height: 1920,
            hashtags: ["apple", "hls"],
            likeCount: 250,
            isLiked: false,
            createdAt: Date()
        ),

        // Video 3: Big Buck Bunny
        Video(
            id: UUID(),
            user: demoUser,
            caption: "Big Buck Bunny - Open source movie 🐰",
            magnetLink: "",
            hlsURL: URL(string: "https://test-streams.mux.dev/test_001/stream.m3u8"),
            thumbnailURL: URL(string: "https://picsum.photos/1080/1920?random=3")!,
            durationSeconds: 600,
            width: 1080,
            height: 1920,
            hashtags: ["movie", "opensource"],
            likeCount: 5000,
            isLiked: true,
            createdAt: Date()
        )
    ]
}
```

### Option 3: Use Your Own Video

To test with your own video file:

#### Step 1: Convert to HLS

You'll need FFmpeg to convert a video to HLS format:

```bash
# Install FFmpeg (macOS)
brew install ffmpeg

# Convert video to HLS with 3 quality levels
ffmpeg -i input.mp4 \
  -vf scale=720:-2 -c:v libx264 -b:v 2M -c:a aac -b:a 128k -hls_time 4 -hls_playlist_type vod -hls_segment_filename "720p_%03d.ts" 720p.m3u8 \
  -vf scale=480:-2 -c:v libx264 -b:v 1M -c:a aac -b:a 96k -hls_time 4 -hls_playlist_type vod -hls_segment_filename "480p_%03d.ts" 480p.m3u8 \
  -vf scale=360:-2 -c:v libx264 -b:v 500k -c:a aac -b:a 64k -hls_time 4 -hls_playlist_type vod -hls_segment_filename "360p_%03d.ts" 360p.m3u8

# Create master playlist
cat > master.m3u8 << 'EOF'
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
360p.m3u8
EOF
```

#### Step 2: Host the HLS Files

Option A: Use a local web server:
```bash
# Serve files locally
cd /path/to/hls/files
python3 -m http.server 8000

# Use in app: http://localhost:8000/master.m3u8
```

Option B: Upload to a CDN (Cloudflare R2, AWS S3, etc.)

#### Step 3: Update Demo Video

```swift
hlsURL: URL(string: "http://localhost:8000/master.m3u8"),
```

## What to Test

### Basic Playback
- ✅ Video loads and starts playing
- ✅ Autoplay works
- ✅ Video plays smooth without stuttering
- ✅ Adaptive bitrate switching (watch resolution change on slow network)

### Controls
- ✅ Tap to show/hide controls
- ✅ Play/pause button works
- ✅ Seek slider works
- ✅ Time displays correctly

### Feed Navigation
- ✅ Swipe up/down to change videos
- ✅ Next video preloads
- ✅ Previous video works
- ✅ Video pauses when scrolled away

### Interactions
- ✅ Like button toggles
- ✅ Like count updates
- ✅ Share button responds (logs for now)

### P2P Statistics (Currently Shows Zeros)
- ⚠️ Download speed: 0 (P2P not implemented yet)
- ⚠️ Upload speed: 0 (P2P not implemented yet)
- ⚠️ Peer count: 0 (P2P not implemented yet)
- ⚠️ P2P ratio: 0% (All from HTTP for now)

Toggle stats overlay by tapping the chart icon in top-right corner.

## Testing P2P Playback (Future)

Once LibTorrent is integrated, P2P playback will work like this:

### 1. Create Torrent from HLS

```swift
// Convert HLS directory to torrent
let hlsDirectory = URL(fileURLWithPath: "/path/to/hls/")
let magnetLink = try torrentEngine.createTorrent(from: hlsDirectory)
```

### 2. Use Magnet Link

```swift
Video(
    ...
    magnetLink: "magnet:?xt=urn:btih:...",
    hlsURL: URL(string: "https://cdn.example.com/video/master.m3u8"), // HTTP fallback
    ...
)
```

### 3. Watch P2P Stats

The P2PResourceLoader will:
1. Try to fetch HLS segments from P2P swarm first
2. Fall back to HTTP if no peers available
3. Update statistics in real-time
4. Show download/upload speeds and peer count

## Network Simulation

Test different network conditions in Xcode:

1. **Open Network Link Conditioner**:
   - Xcode > Open Developer Tool > More Developer Tools...
   - Download "Additional Tools for Xcode"
   - Open Network Link Conditioner.prefPane

2. **Select Profile**:
   - 3G (slower, see quality switching)
   - LTE (normal mobile)
   - WiFi (fast)
   - 100% Loss (test HTTP fallback)

3. **Watch Adaptive Streaming**:
   - Video should automatically switch quality based on network
   - You'll see resolution change in player

## Common Issues

### "Cannot load video"

**Symptom**: Black screen, no video loads

**Fixes**:
1. Check console for error messages
2. Verify HLS URL is accessible in browser
3. Check Info.plist has `NSAppTransportSecurity` settings
4. Ensure simulator has internet connection

### "Video stutters/buffers frequently"

**Symptom**: Video stops and buffers every few seconds

**Fixes**:
1. Use a higher quality test stream
2. Check network conditions (simulator is slow)
3. Reduce simulator graphics performance load
4. Test on real device (simulator video is slower)

### "P2P stats always show 0"

**Expected**: P2P is not implemented yet. All playback goes through HTTP fallback.

**Fix**: This will work once LibTorrent is integrated.

### "Simulator video performance is bad"

**Expected**: iOS simulator has poor video decoding performance.

**Fix**: Test on a real iPhone for best results.

## Performance Tips

### For Simulator Testing
- Use lower resolution test streams (360p/480p)
- Close other apps to free CPU
- Use iPhone 15 simulator (newer is faster)

### For Device Testing
- Use TestFlight for deployment
- Enable Hardware Acceleration (on by default)
- Test on iPhone 12 or newer for best experience

## Next Steps

### To Enable P2P Playback:

1. **Compile LibTorrent** (see `/docs/guides/ios-development.md`)
   ```bash
   git clone --recurse-submodules https://github.com/arvidn/libtorrent.git
   cd libtorrent
   # Follow iOS compilation steps
   ```

2. **Create Objective-C++ Bridge** (`LibTorrentBridge.mm`)
   - Wrap LibTorrent session
   - Expose torrent add/remove/stats

3. **Integrate with P2PResourceLoader**
   - Replace stubbed `fetchViaP2P()` method
   - Map HLS segments to torrent pieces
   - Implement piece prioritization

4. **Test Multi-Device P2P**
   - Deploy to 2+ devices
   - Both watch same video
   - See peers connect and share data

### To Add Video Recording:

See next guide: `/docs/guides/video-recording.md` (coming soon)

## Demo Playback Commands

Quick commands to test:

```bash
# Run the app
cd /Users/roberttaylor/Code/tortok
./run-demo.sh

# Or open full project
cd TorTok
open Package.swift
```

In Xcode:
1. Select iPhone 15 simulator
2. Press ⌘R to run
3. Tap "Sign In (Demo)" on login screen
4. Go to Home tab
5. Video should start playing automatically!

## Expected Behavior

When working correctly, you should see:

1. **Login screen** appears
2. Tap "Sign In" -> goes to main app
3. **Home tab** shows video feed
4. Video **auto-plays** immediately
5. **Swipe up** to see next video (if you added more)
6. **Tap video** to show/hide controls
7. **Tap chart icon** to toggle P2P stats
8. **Tap heart** to like video

The video player should feel smooth and responsive, just like TikTok!

---

**Last Updated**: 2025-11-27
**Status**: HTTP/HLS playback working, P2P infrastructure ready
**Next**: Integrate LibTorrent for actual P2P streaming
