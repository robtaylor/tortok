# TorTok Video Reels MVP Specification

A decentralized TikTok-like platform where video reels are streamed via P2P and metadata is federated.

## Vision

**"TikTok meets BitTorrent"** - Short-form vertical video reels distributed peer-to-peer, with no centralized video hosting costs.

## MVP Objectives

1. **Prove P2P Video Streaming**: Demonstrate HLS + P2P works for short videos on iOS
2. **Validate UX**: Test if users accept P2P video loading times
3. **Test Battery Impact**: Measure real-world battery usage while streaming/seeding
4. **Build Foundation**: Create reusable open source components for decentralized video

## Scope Definition

### In Scope (Video Reels MVP)

✅ **User Features:**
- User registration and authentication
- Record or upload short videos (15-60 seconds)
- Vertical video feed (TikTok-style infinite scroll)
- Like videos
- Follow/unfollow creators
- Basic profile page with video grid
- Swipe between videos

✅ **Technical Features:**
- Video recording with camera (front/back)
- Video encoding to HLS format (multiple qualities)
- BitTorrent + WebRTC for P2P streaming
- Adaptive bitrate streaming (auto-quality switching)
- Preloading next video for smooth experience
- Foreground seeding while watching
- Local video caching

✅ **Video Specifications:**
- Format: MP4 (H.264/H.265)
- Aspect ratio: 9:16 (vertical)
- Duration: 15-60 seconds
- Resolution: 720p, 480p, 360p (adaptive)
- Frame rate: 30 FPS

✅ **Infrastructure:**
- Single metadata instance (no federation in MVP)
- HLS encoding server or on-device encoding
- PostgreSQL database
- S3-compatible storage (thumbnails + HTTP fallback)

### Out of Scope (Post-MVP)

❌ **Deferred Features:**
- Photo posts (focus on video only)
- Comments
- Stories/ephemeral content
- Direct messages
- Sound library (use device audio)
- Video effects/filters
- Duets/stitching
- Federation between instances
- Android app
- Advanced video editing

## Why Video Reels Over Photos?

**Advantages:**
1. **More Engaging**: Video is the dominant content format
2. **P2P Benefits**: Video files are larger, so P2P savings are more significant
3. **Market Fit**: TikTok/Reels proven format
4. **Differentiation**: Decentralized TikTok is more compelling than decentralized Instagram

**Challenges:**
1. **Encoding Complexity**: Need HLS creation pipeline
2. **Larger Files**: More bandwidth, storage, seeding time
3. **Battery Drain**: Video playback + seeding is intensive
4. **Smooth UX**: Users expect instant video playback

## Architecture

```
┌──────────────────────────────────────────────────┐
│   iOS App (Swift + SwiftUI + AVFoundation)       │
│   • Video recording (AVCaptureSession)           │
│   • HLS encoding (AVAssetExportSession)          │
│   • Video player (AVPlayer + P2P loader)         │
│   • Torrent creation & seeding                   │
│   • Vertical feed UI (LazyVStack + paging)       │
└──────────────────────────────────────────────────┘
           ↕ (HTTPS API + WebSocket)
┌──────────────────────────────────────────────────┐
│   Metadata Server (TypeScript/Go)                │
│   • REST API for posts                           │
│   • WebSocket for real-time feed updates         │
│   • PostgreSQL (video metadata)                  │
│   • Optional: Server-side HLS encoding           │
└──────────────────────────────────────────────────┘
           ↕ (fallback CDN)
┌──────────────────────────────────────────────────┐
│   Object Storage (S3/R2)                         │
│   • Thumbnails (always)                          │
│   • HLS playlists + segments (HTTP fallback)     │
└──────────────────────────────────────────────────┘

Meanwhile, P2P video streaming:
iOS App A ←─── HLS via WebRTC + BitTorrent ───→ iOS App B
      ↕                                             ↕
  P2P Media Loader + DHT + STUN/TURN
```

## Video Processing Pipeline

### Recording Flow

```
1. User records video (AVCaptureSession)
   ↓
2. Save to temporary file (MOV format)
   ↓
3. Generate thumbnail from first frame
   ↓
4. Encode to HLS (on-device or upload for server encoding)
   ↓
   ├─ 720p quality (master.m3u8)
   ├─ 480p quality
   └─ 360p quality
   ↓
5. Create torrent from HLS directory
   ↓
6. Generate magnet link
   ↓
7. Start seeding HLS segments
   ↓
8. Upload thumbnail + metadata to API
   ↓
9. Post appears in feed
```

### Playback Flow

```
1. User scrolls to video in feed
   ↓
2. App parses magnet link from metadata
   ↓
3. P2P Media Loader initializes
   ↓
4. Query DHT for peers seeding this video
   ↓
5. Connect to peers via WebRTC
   ↓
6. Download HLS manifest (master.m3u8)
   ↓
7. Select quality based on network speed
   ↓
8. Download segments (prioritize first 5 seconds)
   ↓
9. Begin playback as soon as enough buffered
   ↓
10. Continue downloading remaining segments
   ↓
11. App becomes seeder for this video
   ↓
12. Cache segments locally (LRU eviction)
   ↓
13. Preload next video in feed
```

## iOS Implementation

### Project Structure

```
TorTok/
├── TorTokApp.swift
├── Models/
│   ├── User.swift
│   ├── Video.swift
│   ├── TorrentInfo.swift
│   └── CoreData/
│       └── TorTok.xcdatamodeld
├── Views/
│   ├── Auth/
│   │   ├── LoginView.swift
│   │   └── RegisterView.swift
│   ├── Feed/
│   │   ├── VideoFeedView.swift                # Main vertical feed
│   │   ├── VideoPlayerView.swift              # Single video player
│   │   ├── VideoOverlayView.swift             # Like button, caption, etc.
│   │   └── FeedViewModel.swift
│   ├── Record/
│   │   ├── RecordVideoView.swift              # Camera UI
│   │   ├── CameraPreview.swift
│   │   ├── RecordButton.swift
│   │   └── RecordViewModel.swift
│   ├── Upload/
│   │   ├── ProcessingView.swift               # Encoding progress
│   │   ├── PostDetailsView.swift              # Add caption, hashtags
│   │   └── UploadViewModel.swift
│   └── Profile/
│       ├── ProfileView.swift
│       ├── VideoGridView.swift                # User's videos
│       └── ProfileViewModel.swift
├── Services/
│   ├── Video/
│   │   ├── VideoRecorder.swift                # AVCaptureSession wrapper
│   │   ├── VideoEncoder.swift                 # HLS encoding
│   │   ├── ThumbnailGenerator.swift
│   │   └── VideoCompressor.swift
│   ├── Player/
│   │   ├── P2PVideoPlayer.swift               # AVPlayer + P2P
│   │   ├── P2PMediaLoader.swift               # Custom resource loader
│   │   └── VideoCache.swift
│   ├── Torrent/
│   │   ├── TorrentEngine.swift                # LibTorrent wrapper
│   │   ├── SeedingManager.swift
│   │   └── LibTorrentBridge.h/mm
│   ├── API/
│   │   ├── APIClient.swift
│   │   ├── VideoService.swift
│   │   └── UserService.swift
│   └── Battery/
│       └── BatteryMonitor.swift
└── Utilities/
    ├── Extensions/
    └── Constants.swift
```

### 1. Video Recording

```swift
// Services/Video/VideoRecorder.swift
import AVFoundation
import UIKit

class VideoRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var recordedDuration: TimeInterval = 0

    private var captureSession: AVCaptureSession?
    private var videoOutput: AVCaptureMovieFileOutput?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    private var outputURL: URL?
    private let maxDuration: TimeInterval = 60.0 // 60 seconds max

    func setupCamera(position: AVCaptureDevice.Position = .back) throws {
        captureSession = AVCaptureSession()
        captureSession?.sessionPreset = .hd1280x720 // 720p

        // Video input
        guard let videoDevice = AVCaptureDevice.default(.builtInWideAngleCamera,
                                                        for: .video,
                                                        position: position) else {
            throw RecorderError.deviceNotFound
        }

        let videoInput = try AVCaptureDeviceInput(device: videoDevice)
        captureSession?.addInput(videoInput)

        // Audio input
        guard let audioDevice = AVCaptureDevice.default(for: .audio) else {
            throw RecorderError.audioNotAvailable
        }

        let audioInput = try AVCaptureDeviceInput(device: audioDevice)
        captureSession?.addInput(audioInput)

        // Video output
        videoOutput = AVCaptureMovieFileOutput()
        if let maxDuration = CMTime(seconds: maxDuration, preferredTimescale: 600) {
            videoOutput?.maxRecordedDuration = maxDuration
        }
        captureSession?.addOutput(videoOutput!)

        // Configure for vertical video
        if let connection = videoOutput?.connection(with: .video) {
            connection.videoOrientation = .portrait
        }
    }

    func getPreviewLayer() -> AVCaptureVideoPreviewLayer {
        let layer = AVCaptureVideoPreviewLayer(session: captureSession!)
        layer.videoGravity = .resizeAspectFill
        return layer
    }

    func startSession() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession?.startRunning()
        }
    }

    func stopSession() {
        captureSession?.stopRunning()
    }

    func startRecording() throws {
        guard let videoOutput = videoOutput else {
            throw RecorderError.outputNotConfigured
        }

        // Create output URL
        let fileName = "video_\(Date().timeIntervalSince1970).mov"
        outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(fileName)

        videoOutput.startRecording(to: outputURL!, recordingDelegate: self)
        isRecording = true
    }

    func stopRecording() {
        videoOutput?.stopRecording()
        isRecording = false
    }

    func flipCamera() throws {
        guard let currentInput = captureSession?.inputs.first as? AVCaptureDeviceInput else {
            return
        }

        let newPosition: AVCaptureDevice.Position = currentInput.device.position == .back ? .front : .back

        captureSession?.beginConfiguration()
        captureSession?.removeInput(currentInput)

        guard let newDevice = AVCaptureDevice.default(.builtInWideAngleCamera,
                                                      for: .video,
                                                      position: newPosition) else {
            throw RecorderError.deviceNotFound
        }

        let newInput = try AVCaptureDeviceInput(device: newDevice)
        captureSession?.addInput(newInput)
        captureSession?.commitConfiguration()
    }
}

extension VideoRecorder: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(_ output: AVCaptureFileOutput,
                   didFinishRecordingTo outputFileURL: URL,
                   from connections: [AVCaptureConnection],
                   error: Error?) {
        if let error = error {
            print("Recording error: \(error)")
            return
        }

        // Post notification with recorded file URL
        NotificationCenter.default.post(
            name: .videoRecordingFinished,
            object: nil,
            userInfo: ["url": outputFileURL]
        )
    }
}

enum RecorderError: LocalizedError {
    case deviceNotFound
    case audioNotAvailable
    case outputNotConfigured

    var errorDescription: String? {
        switch self {
        case .deviceNotFound: return "Camera device not found"
        case .audioNotAvailable: return "Microphone not available"
        case .outputNotConfigured: return "Video output not configured"
        }
    }
}

extension Notification.Name {
    static let videoRecordingFinished = Notification.Name("videoRecordingFinished")
}
```

### 2. HLS Encoding

```swift
// Services/Video/VideoEncoder.swift
import AVFoundation
import UIKit

class VideoEncoder {
    enum Quality {
        case high    // 720p
        case medium  // 480p
        case low     // 360p

        var resolution: CGSize {
            switch self {
            case .high: return CGSize(width: 720, height: 1280)
            case .medium: return CGSize(width: 480, height: 854)
            case .low: return CGSize(width: 360, height: 640)
            }
        }

        var bitrate: Int {
            switch self {
            case .high: return 2_500_000    // 2.5 Mbps
            case .medium: return 1_000_000  // 1 Mbps
            case .low: return 500_000       // 500 Kbps
            }
        }
    }

    func encodeToHLS(inputURL: URL,
                    outputDirectory: URL,
                    qualities: [Quality] = [.high, .medium, .low]) async throws -> URL {
        // Create output directory
        try FileManager.default.createDirectory(at: outputDirectory,
                                               withIntermediateDirectories: true)

        let asset = AVURLAsset(url: inputURL)

        // Encode each quality
        for quality in qualities {
            try await encodeQuality(asset: asset,
                                   quality: quality,
                                   outputDirectory: outputDirectory)
        }

        // Create master playlist
        let masterPlaylistURL = try createMasterPlaylist(qualities: qualities,
                                                         outputDirectory: outputDirectory)

        return masterPlaylistURL
    }

    private func encodeQuality(asset: AVURLAsset,
                              quality: Quality,
                              outputDirectory: URL) async throws {
        let qualityName = "\(Int(quality.resolution.height))p"
        let outputURL = outputDirectory
            .appendingPathComponent("\(qualityName)")
            .appendingPathExtension("m3u8")

        guard let exportSession = AVAssetExportSession(asset: asset,
                                                       presetName: AVAssetExportPresetHEVCHighestQuality) else {
            throw EncoderError.exportSessionFailed
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m3u8 // HLS

        // Video composition for resizing
        let videoTrack = try await asset.loadTracks(withMediaType: .video).first
        guard let videoTrack = videoTrack else {
            throw EncoderError.noVideoTrack
        }

        let composition = AVMutableVideoComposition(asset: asset) { request in
            // Scale to target resolution
            let transform = CGAffineTransform(scaleX: quality.resolution.width / request.sourceImage.extent.width,
                                             y: quality.resolution.height / request.sourceImage.extent.height)
            let output = request.sourceImage.transformed(by: transform)
            request.finish(with: output, context: nil)
        }

        composition.renderSize = quality.resolution
        composition.frameDuration = CMTime(value: 1, timescale: 30) // 30 FPS

        exportSession.videoComposition = composition

        // Export
        await exportSession.export()

        if exportSession.status != .completed {
            throw EncoderError.encodingFailed(exportSession.error)
        }
    }

    private func createMasterPlaylist(qualities: [Quality],
                                     outputDirectory: URL) throws -> URL {
        var playlist = "#EXTM3U\n"
        playlist += "#EXT-X-VERSION:6\n\n"

        for quality in qualities.sorted(by: { $0.bitrate > $1.bitrate }) {
            let qualityName = "\(Int(quality.resolution.height))p"
            let resolution = quality.resolution

            playlist += "#EXT-X-STREAM-INF:BANDWIDTH=\(quality.bitrate),"
            playlist += "RESOLUTION=\(Int(resolution.width))x\(Int(resolution.height))\n"
            playlist += "\(qualityName).m3u8\n"
        }

        let masterURL = outputDirectory.appendingPathComponent("master.m3u8")
        try playlist.write(to: masterURL, atomically: true, encoding: .utf8)

        return masterURL
    }
}

enum EncoderError: LocalizedError {
    case exportSessionFailed
    case noVideoTrack
    case encodingFailed(Error?)

    var errorDescription: String? {
        switch self {
        case .exportSessionFailed: return "Failed to create export session"
        case .noVideoTrack: return "Video has no video track"
        case .encodingFailed(let error): return "Encoding failed: \(error?.localizedDescription ?? "unknown")"
        }
    }
}
```

### 3. P2P Video Player

```swift
// Services/Player/P2PVideoPlayer.swift
import AVFoundation
import AVKit
import Combine

class P2PVideoPlayer: ObservableObject {
    @Published var player: AVPlayer?
    @Published var isPlaying = false
    @Published var isBuffering = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0

    private var torrentEngine: TorrentEngine
    private var videoCache: VideoCache
    private var timeObserver: Any?
    private var cancellables = Set<AnyCancellable>()

    init(torrentEngine: TorrentEngine, videoCache: VideoCache) {
        self.torrentEngine = torrentEngine
        self.videoCache = videoCache
    }

    func loadVideo(magnetLink: String) async throws {
        // Check cache first
        if let cachedURL = videoCache.getCachedVideo(for: magnetLink) {
            setupPlayer(with: cachedURL)
            return
        }

        // Download via P2P
        isBuffering = true

        do {
            // Add torrent
            try torrentEngine.download(magnetLink: magnetLink)

            // Wait for initial segments to download
            let videoURL = try await waitForPlayableContent(magnetLink: magnetLink)

            // Cache it
            videoCache.cacheVideo(at: videoURL, for: magnetLink)

            // Setup player
            await MainActor.run {
                setupPlayer(with: videoURL)
                isBuffering = false
            }
        } catch {
            await MainActor.run {
                isBuffering = false
            }
            throw error
        }
    }

    private func waitForPlayableContent(magnetLink: String) async throws -> URL {
        // Poll for master.m3u8 to be available
        let infoHash = extractInfoHash(from: magnetLink)

        for _ in 0..<30 { // Try for 15 seconds
            if let status = torrentEngine.status(for: infoHash),
               status.progress > 0.1 { // 10% downloaded

                // Look for master.m3u8
                let torrentPath = torrentEngine.getCacheDirectory()
                    .appendingPathComponent(infoHash)
                let masterURL = torrentPath.appendingPathComponent("master.m3u8")

                if FileManager.default.fileExists(atPath: masterURL.path) {
                    return masterURL
                }
            }

            try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        }

        throw PlayerError.downloadTimeout
    }

    private func setupPlayer(with url: URL) {
        let playerItem = AVPlayerItem(url: url)

        // Observe buffer status
        playerItem.publisher(for: \.isPlaybackLikelyToKeepUp)
            .sink { [weak self] isReady in
                self?.isBuffering = !isReady
            }
            .store(in: &cancellables)

        player = AVPlayer(playerItem: playerItem)
        player?.actionAtItemEnd = .pause

        // Observe playback time
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval,
                                                       queue: .main) { [weak self] time in
            self?.currentTime = time.seconds
        }

        // Get duration
        Task {
            if let duration = try? await playerItem.asset.load(.duration) {
                await MainActor.run {
                    self.duration = duration.seconds
                }
            }
        }
    }

    func play() {
        player?.play()
        isPlaying = true
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    func seek(to time: TimeInterval) {
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: cmTime)
    }

    deinit {
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
        }
    }

    private func extractInfoHash(from magnetLink: String) -> String {
        guard let range = magnetLink.range(of: "xt=urn:btih:") else {
            return ""
        }

        let hashStart = magnetLink[range.upperBound...]
        if let ampersand = hashStart.firstIndex(of: "&") {
            return String(hashStart[..<ampersand])
        } else {
            return String(hashStart)
        }
    }
}

enum PlayerError: LocalizedError {
    case downloadTimeout
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .downloadTimeout: return "Video download timed out"
        case .invalidURL: return "Invalid video URL"
        }
    }
}
```

### 4. Vertical Video Feed UI

```swift
// Views/Feed/VideoFeedView.swift
import SwiftUI
import AVKit

struct VideoFeedView: View {
    @StateObject private var viewModel = FeedViewModel()
    @State private var currentIndex = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $currentIndex) {
                ForEach(Array(viewModel.videos.enumerated()), id: \.element.id) { index, video in
                    VideoPlayerView(video: video,
                                  isActive: index == currentIndex)
                        .tag(index)
                        .onAppear {
                            // Preload next video
                            if index == viewModel.videos.count - 2 {
                                Task {
                                    await viewModel.loadMore()
                                }
                            }

                            // Preload next video's content
                            if index < viewModel.videos.count - 1 {
                                viewModel.preloadVideo(at: index + 1)
                            }
                        }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .indexViewStyle(.page(backgroundDisplayMode: .never))
            .ignoresSafeArea()

            // Top bar
            VStack {
                HStack {
                    Spacer()

                    Button {
                        // Show camera
                    } label: {
                        Image(systemName: "camera.fill")
                            .font(.title2)
                            .foregroundColor(.white)
                            .padding()
                    }
                }

                Spacer()
            }
        }
        .onAppear {
            Task {
                await viewModel.loadInitialVideos()
            }
        }
    }
}

struct VideoPlayerView: View {
    let video: Video
    let isActive: Bool

    @StateObject private var player: P2PVideoPlayer
    @State private var showControls = false

    init(video: Video, isActive: Bool) {
        self.video = video
        self.isActive = isActive

        // Inject dependencies
        let torrentEngine = TorrentEngine()
        let videoCache = VideoCache()
        _player = StateObject(wrappedValue: P2PVideoPlayer(torrentEngine: torrentEngine,
                                                           videoCache: videoCache))
    }

    var body: some View {
        ZStack {
            // Video player
            if let avPlayer = player.player {
                VideoPlayer(player: avPlayer)
                    .disabled(true)
                    .ignoresSafeArea()
            } else {
                Color.black
            }

            // Loading indicator
            if player.isBuffering {
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.5)
            }

            // Overlay UI
            VideoOverlayView(video: video, player: player)
        }
        .onAppear {
            if isActive {
                Task {
                    try? await player.loadVideo(magnetLink: video.magnetLink)
                    player.play()
                }
            }
        }
        .onChange(of: isActive) { newValue in
            if newValue {
                player.play()
            } else {
                player.pause()
            }
        }
    }
}

struct VideoOverlayView: View {
    let video: Video
    @ObservedObject var player: P2PVideoPlayer
    @State private var isLiked = false

    var body: some View {
        VStack {
            Spacer()

            HStack(alignment: .bottom) {
                // Video info (left side)
                VStack(alignment: .leading, spacing: 12) {
                    // User info
                    HStack(spacing: 8) {
                        AsyncImage(url: video.user.avatarURL) { image in
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } placeholder: {
                            Circle().fill(Color.gray.opacity(0.3))
                        }
                        .frame(width: 40, height: 40)
                        .clipShape(Circle())

                        Text("@\(video.user.username)")
                            .font(.headline)
                            .foregroundColor(.white)
                    }

                    // Caption
                    Text(video.caption)
                        .font(.body)
                        .foregroundColor(.white)
                        .lineLimit(3)

                    // Hashtags
                    if !video.hashtags.isEmpty {
                        Text(video.hashtags.map { "#\($0)" }.joined(separator: " "))
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
                .padding(.leading)

                Spacer()

                // Actions (right side)
                VStack(spacing: 24) {
                    // Like
                    Button {
                        isLiked.toggle()
                        // API call to like/unlike
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: isLiked ? "heart.fill" : "heart")
                                .font(.title)
                                .foregroundColor(isLiked ? .red : .white)

                            Text("\(video.likeCount + (isLiked ? 1 : 0))")
                                .font(.caption)
                                .foregroundColor(.white)
                        }
                    }

                    // Profile
                    Button {
                        // Navigate to profile
                    } label: {
                        Image(systemName: "person.circle")
                            .font(.title)
                            .foregroundColor(.white)
                    }

                    // Share
                    Button {
                        // Share video
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.title2)
                            .foregroundColor(.white)
                    }
                }
                .padding(.trailing)
            }
            .padding(.bottom, 100)
        }
    }
}
```

## Database Schema

```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Videos
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT,
    magnet_link TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    duration_seconds INT NOT NULL,
    width INT DEFAULT 720,
    height INT DEFAULT 1280,
    hashtags TEXT[],
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_videos_user_id ON videos(user_id);
CREATE INDEX idx_videos_created_at ON videos(created_at DESC);
CREATE INDEX idx_videos_hashtags ON videos USING GIN(hashtags);

-- Likes
CREATE TABLE likes (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

-- Follows
CREATE TABLE follows (
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

-- Video views (for analytics)
CREATE TABLE video_views (
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    watched_seconds INT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

```typescript
// Video upload
POST /api/v1/videos
Content-Type: multipart/form-data
Authorization: Bearer <token>

Body:
{
  "caption": "Check out this sunset!",
  "magnetLink": "magnet:?xt=urn:btih:...",
  "thumbnail": <file>,
  "durationSeconds": 45,
  "hashtags": ["sunset", "nature"]
}

// Get feed (personalized)
GET /api/v1/feed?limit=10&cursor=<timestamp>
Authorization: Bearer <token>

Response:
{
  "videos": [...],
  "nextCursor": "2025-01-23T10:00:00Z",
  "hasMore": true
}

// Like video
POST /api/v1/videos/:id/like
Authorization: Bearer <token>

// Unlike video
DELETE /api/v1/videos/:id/like
Authorization: Bearer <token>
```

## Success Metrics

### Technical
- [ ] P2P video streaming success rate >70%
- [ ] Video start time <3 seconds (P2P)
- [ ] Smooth playback (no buffering after initial load)
- [ ] Battery drain <10%/hour while watching
- [ ] Encoding time <30 seconds for 60-second video

### User Experience
- [ ] 50+ beta testers
- [ ] 500+ videos posted
- [ ] Average watch time >30 seconds per video
- [ ] Users successfully stream via P2P (>70% P2P ratio)
- [ ] Positive feedback on video quality and speed

## Development Timeline

### Week 1-2: Video Infrastructure
- [ ] Compile LibTorrent for iOS
- [ ] Build video recorder
- [ ] Implement HLS encoding
- [ ] Deploy metadata server

### Week 3-4: P2P Streaming
- [ ] Integrate torrent creation for HLS
- [ ] Build P2P video player
- [ ] Test P2P streaming
- [ ] Implement video caching

### Week 5-6: Feed UI
- [ ] Vertical video feed
- [ ] Swipe navigation
- [ ] Video preloading
- [ ] Like/follow functionality

### Week 7-8: Recording & Upload
- [ ] Camera UI
- [ ] Video recording
- [ ] Post-recording flow (trim, caption)
- [ ] Upload pipeline

### Week 9: Polish & Testing
- [ ] Battery optimization
- [ ] UI/UX refinement
- [ ] P2P connectivity testing
- [ ] Bug fixes

### Week 10: Beta Release
- [ ] TestFlight deployment
- [ ] Beta testing
- [ ] Feedback gathering
- [ ] Iteration

## Open Source Components

**To Build:**
1. iOS P2P video streaming library (MIT License)
2. HLS encoding utilities (MIT License)
3. Vertical video feed component (MIT License)
4. Metadata server (MIT License)

**To Reference:**
- iTorrent (GPL - architecture reference only)
- PeerTube (AGPL - P2P patterns reference)

## Next Steps

1. Review this specification
2. Set up iOS project
3. Compile LibTorrent for iOS
4. Build video recorder prototype
5. Test HLS encoding on device
6. Implement P2P streaming

See [iOS Development Guide](../docs/guides/ios-development.md) and upcoming [Video Encoding Guide](../docs/guides/ios-video-encoding.md) for implementation details.

---

**This is ambitious but achievable!** The combination of vertical video reels + P2P delivery + decentralization is unique and compelling.
