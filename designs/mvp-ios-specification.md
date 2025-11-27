# TorTok iOS MVP Specification

This document outlines the iOS-focused Minimum Viable Product (MVP) for TorTok.

## MVP Objectives

1. **Prove P2P on iOS**: Demonstrate BitTorrent-based photo sharing works on iOS
2. **Test iOS Constraints**: Validate battery impact and background limitations
3. **Gather Feedback**: Learn from early users about iOS-specific UX
4. **Open Source Foundation**: Build reusable components for community

## Scope Definition

### In Scope (iOS MVP)

✅ **User Features:**
- User registration and authentication
- Post photos (camera or library)
- View feed of photos from followed users
- Follow/unfollow users
- Like posts
- Basic profile page

✅ **Technical Features:**
- BitTorrent-based photo sharing (iOS 16+)
- Simple metadata server (no federation in v1)
- Local caching with Core Data
- Battery-aware foreground seeding
- WebRTC for NAT traversal

✅ **Infrastructure:**
- Single metadata instance
- Docker deployment
- PostgreSQL database
- S3-compatible object storage (MinIO/R2)

### Out of Scope (Post-MVP)

❌ **Deferred Features:**
- Video support
- Federation between instances
- Comments
- Stories/ephemeral content
- Direct messages
- Advanced search
- Android app (later)
- Background seeding (iOS limitations)

## iOS-Specific Considerations

### iOS Limitations

**Background Execution:**
- iOS severely restricts background network activity
- No continuous background torrent seeding (unlike Android)
- Limited to:
  - Background URLSession (up to 30 seconds)
  - Background fetch (opportunistic, system-controlled)
  - Background processing tasks (not suitable for network)

**Solution:**
- **Foreground seeding only**: Seed while app is active
- **Extended foreground**: Use `beginBackgroundTask` for up to 30 seconds
- **Share via API**: Upload to instance storage as fallback
- **Optional**: Users can keep app open to seed

**Battery Considerations:**
- iOS users expect minimal battery drain
- Apple reviews reject battery-intensive apps
- Must be transparent about seeding activity

**Solution:**
- Battery status monitoring
- Automatic pause when battery low
- User toggle for seeding participation
- Clear UI showing seeding status

### Open Source Libraries to Use

**1. LibTorrent (C++) - Boost Software License**
- Source: https://github.com/arvidn/libtorrent
- License: BSD/Boost (compatible with App Store)
- Usage: Core torrent engine
- Integration: Via Swift C++ interop or wrapper

**2. iTorrent (GPL v3) - Reference Only**
- Source: https://github.com/XITRIX/iTorrent
- License: GPL v3 (NOT App Store compatible)
- Usage: Reference implementation, architecture patterns
- **Cannot use code directly** - use as reference for our own implementation

**3. WebRTC (BSD License)**
- Source: https://webrtc.googlesource.com/src
- License: BSD (App Store compatible)
- Usage: NAT traversal, peer connections
- Integration: Via GoogleWebRTC CocoaPod or build from source

**4. Alamofire (MIT License)**
- Source: https://github.com/Alamofire/Alamofire
- License: MIT
- Usage: HTTP networking for API calls

**5. Kingfisher (MIT License)**
- Source: https://github.com/onevcat/Kingfisher
- License: MIT
- Usage: Async image loading and caching

**6. GRDB.swift (MIT License)**
- Source: https://github.com/groue/GRDB.swift
- License: MIT
- Usage: SQLite wrapper for local caching

## Architecture (iOS MVP)

```
┌─────────────────────────────────────┐
│   iOS App (Swift + SwiftUI)         │
│   • Photo capture/upload            │
│   • Torrent creation                │
│   • Foreground seeding only         │
│   • Feed viewing                    │
│   • P2P download via WebRTC         │
│   • Core Data local cache           │
└─────────────────────────────────────┘
           ↕ (HTTPS API)
┌─────────────────────────────────────┐
│   Metadata Server (TypeScript)      │
│   • REST API                        │
│   • PostgreSQL database             │
│   • S3-compatible storage           │
│   • No federation (single instance) │
└─────────────────────────────────────┘
           ↕ (optional fallback)
┌─────────────────────────────────────┐
│   Object Storage (S3/R2/MinIO)      │
│   • Thumbnails (always)             │
│   • Full images (fallback only)     │
└─────────────────────────────────────┘

Meanwhile, media P2P (foreground only):
iOS App A ←── WebRTC + BitTorrent ──→ iOS App B
      ↕                                   ↕
  DHT + STUN/TURN
```

## iOS Project Structure

```
TorTok/
├── TorTok.xcodeproj
├── TorTok/
│   ├── TorTokApp.swift              # App entry point
│   ├── Models/
│   │   ├── User.swift
│   │   ├── Post.swift
│   │   ├── TorrentInfo.swift
│   │   └── CoreData/
│   │       ├── TorTok.xcdatamodeld
│   │       └── PersistenceController.swift
│   ├── Views/
│   │   ├── Auth/
│   │   │   ├── LoginView.swift
│   │   │   └── RegisterView.swift
│   │   ├── Feed/
│   │   │   ├── FeedView.swift
│   │   │   ├── PostCardView.swift
│   │   │   └── FeedViewModel.swift
│   │   ├── Post/
│   │   │   ├── CreatePostView.swift
│   │   │   ├── PhotoPickerView.swift
│   │   │   └── CreatePostViewModel.swift
│   │   ├── Profile/
│   │   │   ├── ProfileView.swift
│   │   │   └── ProfileViewModel.swift
│   │   └── ImageViewer/
│   │       └── FullImageView.swift
│   ├── Services/
│   │   ├── API/
│   │   │   ├── APIClient.swift
│   │   │   ├── AuthService.swift
│   │   │   ├── PostService.swift
│   │   │   └── UserService.swift
│   │   ├── Torrent/
│   │   │   ├── TorrentEngine.swift      # LibTorrent wrapper
│   │   │   ├── TorrentManager.swift      # High-level management
│   │   │   ├── SeedingManager.swift      # Foreground seeding
│   │   │   └── LibTorrentBridge.h/mm     # C++ bridge
│   │   ├── WebRTC/
│   │   │   ├── WebRTCClient.swift
│   │   │   └── SignalingClient.swift
│   │   ├── Cache/
│   │   │   └── ImageCacheManager.swift
│   │   └── Battery/
│   │       └── BatteryMonitor.swift
│   ├── Utilities/
│   │   ├── Extensions/
│   │   │   ├── Color+Extensions.swift
│   │   │   ├── View+Extensions.swift
│   │   │   └── Image+Extensions.swift
│   │   └── Constants.swift
│   └── Resources/
│       ├── Assets.xcassets
│       └── Info.plist
├── TorTokTests/
│   ├── TorrentEngineTests.swift
│   ├── APIClientTests.swift
│   └── MockData.swift
└── TorTokUITests/
    └── FeedFlowTests.swift

Package.swift (Swift Package Manager)
```

## Key iOS Implementations

### 1. LibTorrent Integration

**Approach: Swift C++ Interop (iOS 17+) or Objective-C++ Bridge**

**LibTorrentBridge.h:**
```objc
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface LibTorrentSession : NSObject

- (instancetype)init;
- (void)start;
- (void)stop;

// Create torrent from file
- (NSString *)createTorrentFromFile:(NSString *)filePath
                        trackers:(NSArray<NSString *> *)trackers
                           error:(NSError **)error;

// Add torrent by magnet link
- (BOOL)addMagnetLink:(NSString *)magnetLink
           savePath:(NSString *)savePath
              error:(NSError **)error;

// Download status
- (NSDictionary *)downloadStatusForHash:(NSString *)infoHash;

// Seeding
- (void)pauseAll;
- (void)resumeAll;
- (NSArray<NSDictionary *> *)activeTorrents;

@end

NS_ASSUME_NONNULL_END
```

**LibTorrentBridge.mm:**
```objc
#import "LibTorrentBridge.h"
#include <libtorrent/session.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/magnet_uri.hpp>

@interface LibTorrentSession()
@property (nonatomic) lt::session *session;
@end

@implementation LibTorrentSession

- (instancetype)init {
    self = [super init];
    if (self) {
        _session = new lt::session();

        // Configure session
        lt::settings_pack settings;
        settings.set_int(lt::settings_pack::alert_mask,
                        lt::alert::error_notification |
                        lt::alert::storage_notification |
                        lt::alert::status_notification);
        _session->apply_settings(settings);
    }
    return self;
}

- (void)dealloc {
    delete _session;
}

- (void)start {
    // Add DHT routers
    _session->add_dht_router({"router.bittorrent.com", 6881});
    _session->add_dht_router({"dht.transmissionbt.com", 6881});

    // Start DHT
    _session->apply_settings({
        {lt::settings_pack::enable_dht, true}
    });
}

- (void)stop {
    _session->pause();
}

- (NSString *)createTorrentFromFile:(NSString *)filePath
                        trackers:(NSArray<NSString *> *)trackers
                           error:(NSError **)error {
    @try {
        lt::file_storage fs;
        std::string path = [filePath UTF8String];
        lt::add_files(fs, path);

        lt::create_torrent ct(fs);

        // Add trackers
        for (NSString *tracker in trackers) {
            ct.add_tracker([tracker UTF8String]);
        }

        // Set creator and creation date
        ct.set_creator("TorTok iOS");

        // Generate pieces
        lt::set_piece_hashes(ct, [[filePath stringByDeletingLastPathComponent] UTF8String]);

        // Get magnet link
        std::vector<char> buf;
        lt::bencode(std::back_inserter(buf), ct.generate());
        lt::torrent_info ti(buf);

        std::string magnetLink = lt::make_magnet_uri(ti);

        return [NSString stringWithUTF8String:magnetLink.c_str()];
    }
    @catch (NSException *exception) {
        if (error) {
            *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: exception.reason}];
        }
        return nil;
    }
}

- (BOOL)addMagnetLink:(NSString *)magnetLink
           savePath:(NSString *)savePath
              error:(NSError **)error {
    @try {
        lt::add_torrent_params params;
        params.save_path = [savePath UTF8String];
        params.url = [magnetLink UTF8String];

        _session->async_add_torrent(params);
        return YES;
    }
    @catch (NSException *exception) {
        if (error) {
            *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                         code:-2
                                     userInfo:@{NSLocalizedDescriptionKey: exception.reason}];
        }
        return NO;
    }
}

- (NSDictionary *)downloadStatusForHash:(NSString *)infoHash {
    // Implementation to get torrent status
    // Returns: progress, download rate, upload rate, peers
    return @{};
}

- (void)pauseAll {
    _session->pause();
}

- (void)resumeAll {
    _session->resume();
}

- (NSArray<NSDictionary *> *)activeTorrents {
    std::vector<lt::torrent_handle> torrents = _session->get_torrents();
    NSMutableArray *result = [NSMutableArray array];

    for (const auto& handle : torrents) {
        lt::torrent_status status = handle.status();

        [result addObject:@{
            @"name": [NSString stringWithUTF8String:status.name.c_str()],
            @"progress": @(status.progress),
            @"downloadRate": @(status.download_rate),
            @"uploadRate": @(status.upload_rate),
            @"numPeers": @(status.num_peers)
        }];
    }

    return result;
}

@end
```

**Swift Wrapper:**
```swift
// Services/Torrent/TorrentEngine.swift
import Foundation

enum TorrentError: Error {
    case creationFailed(String)
    case downloadFailed(String)
    case notFound
}

class TorrentEngine: ObservableObject {
    private let session: LibTorrentSession
    private let fileManager = FileManager.default

    @Published var activeTorrents: [TorrentInfo] = []
    @Published var isSeeding: Bool = false

    init() {
        self.session = LibTorrentSession()
        self.session.start()
    }

    deinit {
        session.stop()
    }

    // Create torrent from image
    func createTorrent(from imageURL: URL) async throws -> String {
        let trackers = [
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://tracker.openbittorrent.com:6969/announce"
        ]

        var error: NSError?
        let magnetLink = session.createTorrent(fromFile: imageURL.path,
                                               trackers: trackers,
                                               error: &error)

        if let error = error {
            throw TorrentError.creationFailed(error.localizedDescription)
        }

        guard let magnetLink = magnetLink else {
            throw TorrentError.creationFailed("Failed to generate magnet link")
        }

        return magnetLink
    }

    // Download image via torrent
    func downloadImage(magnetLink: String) async throws -> URL {
        let savePath = getCacheDirectory()

        var error: NSError?
        let success = session.addMagnetLink(magnetLink,
                                           savePath: savePath.path,
                                           error: &error)

        if let error = error {
            throw TorrentError.downloadFailed(error.localizedDescription)
        }

        guard success else {
            throw TorrentError.downloadFailed("Failed to add torrent")
        }

        // Wait for download to complete
        return try await waitForDownload(magnetLink: magnetLink)
    }

    // Monitor download progress
    private func waitForDownload(magnetLink: String) async throws -> URL {
        // Extract info hash from magnet link
        let infoHash = extractInfoHash(from: magnetLink)

        // Poll for completion
        while true {
            let status = session.downloadStatus(forHash: infoHash)

            if let progress = status["progress"] as? Double, progress >= 1.0 {
                // Download complete
                let fileName = status["name"] as? String ?? "download"
                return getCacheDirectory().appendingPathComponent(fileName)
            }

            try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        }
    }

    private func extractInfoHash(from magnetLink: String) -> String {
        // Parse magnet link to extract info hash
        // Format: magnet:?xt=urn:btih:<hash>
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

    private func getCacheDirectory() -> URL {
        fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Torrents")
    }
}
```

### 2. Battery-Aware Seeding

```swift
// Services/Battery/BatteryMonitor.swift
import UIKit
import Combine

class BatteryMonitor: ObservableObject {
    @Published var batteryLevel: Float = 1.0
    @Published var batteryState: UIDevice.BatteryState = .unknown
    @Published var shouldSeed: Bool = true

    private var cancellables = Set<AnyCancellable>()

    enum SeedingPolicy {
        case always
        case chargingOnly
        case highBattery  // >50%
        case never
    }

    @AppStorage("seedingPolicy") var seedingPolicy: SeedingPolicy = .highBattery

    init() {
        UIDevice.current.isBatteryMonitoringEnabled = true

        // Observe battery level changes
        NotificationCenter.default.publisher(for: UIDevice.batteryLevelDidChangeNotification)
            .sink { [weak self] _ in
                self?.updateBatteryStatus()
            }
            .store(in: &cancellables)

        // Observe battery state changes
        NotificationCenter.default.publisher(for: UIDevice.batteryStateDidChangeNotification)
            .sink { [weak self] _ in
                self?.updateBatteryStatus()
            }
            .store(in: &cancellables)

        updateBatteryStatus()
    }

    private func updateBatteryStatus() {
        batteryLevel = UIDevice.current.batteryLevel
        batteryState = UIDevice.current.batteryState

        shouldSeed = evaluateSeedingPolicy()
    }

    private func evaluateSeedingPolicy() -> Bool {
        switch seedingPolicy {
        case .always:
            return true

        case .chargingOnly:
            return batteryState == .charging || batteryState == .full

        case .highBattery:
            return batteryLevel > 0.5 || batteryState == .charging

        case .never:
            return false
        }
    }
}
```

### 3. Foreground Seeding Manager

```swift
// Services/Torrent/SeedingManager.swift
import UIKit
import Combine

class SeedingManager: ObservableObject {
    private let torrentEngine: TorrentEngine
    private let batteryMonitor: BatteryMonitor
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var cancellables = Set<AnyCancellable>()

    @Published var activeSeedCount: Int = 0
    @Published var uploadRate: Int64 = 0

    init(torrentEngine: TorrentEngine, batteryMonitor: BatteryMonitor) {
        self.torrentEngine = torrentEngine
        self.batteryMonitor = batteryMonitor

        setupObservers()
    }

    private func setupObservers() {
        // Monitor app lifecycle
        NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)
            .sink { [weak self] _ in
                self?.handleEnterBackground()
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
            .sink { [weak self] _ in
                self?.handleEnterForeground()
            }
            .store(in: &cancellables)

        // Monitor battery status
        batteryMonitor.$shouldSeed
            .sink { [weak self] shouldSeed in
                self?.updateSeedingState(shouldSeed: shouldSeed)
            }
            .store(in: &cancellables)
    }

    private func handleEnterBackground() {
        // Request extended background time (up to 30 seconds)
        backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self] in
            self?.endBackgroundSeeding()
        }

        // Continue seeding for a bit
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
            self?.endBackgroundSeeding()
        }
    }

    private func endBackgroundSeeding() {
        torrentEngine.session.pauseAll()

        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
    }

    private func handleEnterForeground() {
        if batteryMonitor.shouldSeed {
            torrentEngine.session.resumeAll()
        }
    }

    private func updateSeedingState(shouldSeed: Bool) {
        if shouldSeed {
            torrentEngine.session.resumeAll()
        } else {
            torrentEngine.session.pauseAll()
        }
    }

    // Seed for a specific duration (e.g., after posting)
    func seedForDuration(_ duration: TimeInterval, magnetLink: String) {
        // Start seeding
        torrentEngine.session.resumeAll()

        // Schedule stop
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak self] in
            if let self = self, !self.batteryMonitor.shouldSeed {
                self.torrentEngine.session.pauseAll()
            }
        }
    }
}
```

### 4. SwiftUI Feed View

```swift
// Views/Feed/FeedView.swift
import SwiftUI

struct FeedView: View {
    @StateObject private var viewModel = FeedViewModel()
    @State private var showingCreatePost = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(viewModel.posts) { post in
                        PostCardView(post: post)
                            .onAppear {
                                // Load more when near end
                                if post == viewModel.posts.last {
                                    Task {
                                        await viewModel.loadMore()
                                    }
                                }
                            }
                    }

                    if viewModel.isLoading {
                        ProgressView()
                            .padding()
                    }
                }
                .padding(.horizontal)
            }
            .refreshable {
                await viewModel.refresh()
            }
            .navigationTitle("TorTok")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showingCreatePost = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .sheet(isPresented: $showingCreatePost) {
                CreatePostView()
            }
        }
    }
}

struct PostCardView: View {
    let post: Post
    @State private var fullImageURL: URL?
    @State private var showingFullImage = false
    @StateObject private var imageDownloader = ImageDownloader()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // User header
            HStack(spacing: 8) {
                AsyncImage(url: post.user.avatarURL) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                }
                .frame(width: 40, height: 40)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(post.user.displayName)
                        .font(.headline)
                    Text("@\(post.user.username)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }

            // Thumbnail image
            AsyncImage(url: post.thumbnailURL) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Rectangle()
                    .fill(Color.gray.opacity(0.2))
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(CGFloat(post.imageWidth) / CGFloat(post.imageHeight), contentMode: .fit)
            .clipped()
            .onTapGesture {
                Task {
                    fullImageURL = try? await imageDownloader.download(magnetLink: post.magnetLink)
                    showingFullImage = true
                }
            }

            // Actions
            HStack(spacing: 16) {
                Button {
                    // Toggle like
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: post.isLiked ? "heart.fill" : "heart")
                            .foregroundColor(post.isLiked ? .red : .primary)
                        Text("\(post.likeCount)")
                            .font(.caption)
                    }
                }

                Spacer()
            }

            // Caption
            if !post.caption.isEmpty {
                Text(post.caption)
                    .font(.body)
            }

            // Timestamp
            Text(post.createdAt, style: .relative)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(radius: 2)
        .fullScreenCover(isPresented: $showingFullImage) {
            if let imageURL = fullImageURL {
                FullImageView(imageURL: imageURL)
            }
        }
    }
}
```

## Development Timeline

### Week 1-2: Project Setup & Core Infrastructure
- [ ] Set up Xcode project with Swift Package Manager
- [ ] Integrate LibTorrent (C++ bridge)
- [ ] Build basic API client
- [ ] Set up Core Data models
- [ ] Deploy metadata server

### Week 3-4: Authentication & Basic UI
- [ ] Login/Register screens
- [ ] Token-based authentication
- [ ] Tab bar navigation
- [ ] Profile screen
- [ ] Settings screen

### Week 5-6: Photo Posting & P2P
- [ ] Photo picker integration
- [ ] Image compression
- [ ] Torrent creation
- [ ] Upload to API
- [ ] Foreground seeding

### Week 7-8: Feed & Download
- [ ] Feed view with timeline
- [ ] P2P image download
- [ ] Image caching
- [ ] Like/follow functionality
- [ ] Pull-to-refresh

### Week 9: Testing & Polish
- [ ] Battery optimization testing
- [ ] P2P connectivity testing
- [ ] UI/UX refinement
- [ ] Bug fixes
- [ ] TestFlight beta

### Week 10: Beta Release
- [ ] Deploy to TestFlight
- [ ] Gather feedback
- [ ] Iterate based on usage

## Open Source License

**Recommended: MIT License**

Reasons:
- Maximum permissiveness
- App Store compatible
- Allows commercial use
- Simple and well-understood
- Used by Alamofire, Kingfisher, GRDB

**Alternative: Apache 2.0**
- Patent grant protection
- App Store compatible
- More formal

**NOT GPL:**
- GPL conflicts with App Store ToS
- Can reference iTorrent (GPL) but must implement separately

## Dependencies (Package.swift)

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TorTok",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "TorTok", targets: ["TorTok"])
    ],
    dependencies: [
        .package(url: "https://github.com/Alamofire/Alamofire", from: "5.8.0"),
        .package(url: "https://github.com/onevcat/Kingfisher", from: "7.0.0"),
        .package(url: "https://github.com/groue/GRDB.swift", from: "6.0.0"),
        // LibTorrent will be integrated as system library or custom target
    ],
    targets: [
        .target(
            name: "TorTok",
            dependencies: [
                "Alamofire",
                "Kingfisher",
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
        .target(
            name: "LibTorrentBridge",
            dependencies: [],
            cSettings: [
                .headerSearchPath("libtorrent/include")
            ],
            cxxSettings: [
                .headerSearchPath("libtorrent/include")
            ],
            linkerSettings: [
                .linkedLibrary("torrent-rasterbar")
            ]
        ),
        .testTarget(
            name: "TorTokTests",
            dependencies: ["TorTok"]
        )
    ]
)
```

## Success Metrics

### Technical
- [ ] P2P download success rate >70%
- [ ] Average photo load time <3s (P2P)
- [ ] Battery drain <7%/hour while active
- [ ] App Store approval on first submission

### User
- [ ] 20+ TestFlight beta testers
- [ ] 100+ posts created
- [ ] Average session length >5 minutes
- [ ] Positive feedback on P2P performance
- [ ] Users successfully connect P2P

## Next Steps

1. **Set up Xcode project**
2. **Compile LibTorrent for iOS**
3. **Build C++ bridge**
4. **Deploy metadata server**
5. **Start UI development**

See [iOS Development Guide](../docs/guides/ios-development.md) for detailed setup instructions.
