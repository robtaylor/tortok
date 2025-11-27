# iOS Development Guide

Complete guide for building the TorTok iOS app from scratch.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Compiling LibTorrent for iOS](#compiling-libtorrent-for-ios)
3. [Project Setup](#project-setup)
4. [Integrating LibTorrent](#integrating-libtorrent)
5. [Building Core Features](#building-core-features)
6. [Testing Strategy](#testing-strategy)
7. [App Store Preparation](#app-store-preparation)

## Prerequisites

### Development Environment

**Required:**
- macOS Ventura (13.0) or later
- Xcode 15.0 or later
- iOS 16.0+ deployment target
- Swift 5.9+
- CocoaPods or Swift Package Manager

**Install Xcode:**
```bash
# Install from App Store or
xcode-select --install
```

**Install HomeBrew (for dependencies):**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Install Build Tools:**
```bash
brew install cmake
brew install boost
brew install openssl@3
```

### iOS Developer Account

- Free account: Can test on device for 7 days
- Paid account ($99/year): Required for App Store and TestFlight

## Compiling LibTorrent for iOS

LibTorrent is a C++ library, so we need to compile it for iOS architectures.

### Option 1: Using Pre-built Framework (Easiest)

Check if someone has already built LibTorrent for iOS:

```bash
# Check CocoaPods
pod search libtorrent

# Or use a community build if available
# Note: Verify the source before using
```

### Option 2: Compile from Source (Recommended for Production)

**1. Clone LibTorrent:**

```bash
cd ~/Developer
git clone --recurse-submodules https://github.com/arvidn/libtorrent.git
cd libtorrent
git checkout v2.0.10  # Latest stable
```

**2. Create Build Script:**

Create `build-ios.sh`:

```bash
#!/bin/bash

# Configuration
LIBTORRENT_ROOT=$(pwd)
BUILD_DIR="${LIBTORRENT_ROOT}/build-ios"
INSTALL_DIR="${LIBTORRENT_ROOT}/ios-build"
BOOST_ROOT="/opt/homebrew/opt/boost"
OPENSSL_ROOT="/opt/homebrew/opt/openssl@3"

# iOS architectures
ARCHS=("arm64" "arm64-simulator" "x86_64")
SDK=("iphoneos" "iphonesimulator" "iphonesimulator")

# Clean previous build
rm -rf "${BUILD_DIR}"
rm -rf "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"

# Build for each architecture
for i in "${!ARCHS[@]}"; do
    ARCH="${ARCHS[$i]}"
    SDK_NAME="${SDK[$i]}"

    echo "Building for ${ARCH} (${SDK_NAME})..."

    mkdir -p "${BUILD_DIR}/${ARCH}"
    cd "${BUILD_DIR}/${ARCH}"

    cmake "${LIBTORRENT_ROOT}" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_SYSTEM_NAME=iOS \
        -DCMAKE_OSX_SYSROOT=$(xcrun --sdk ${SDK_NAME} --show-sdk-path) \
        -DCMAKE_OSX_ARCHITECTURES=${ARCH} \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0 \
        -DCMAKE_INSTALL_PREFIX="${INSTALL_DIR}/${ARCH}" \
        -DCMAKE_PREFIX_PATH="${BOOST_ROOT};${OPENSSL_ROOT}" \
        -DBUILD_SHARED_LIBS=OFF \
        -Ddeprecated-functions=OFF \
        -DCMAKE_CXX_STANDARD=17 \
        -DCMAKE_CXX_FLAGS="-fembed-bitcode"

    cmake --build . --config Release -j$(sysctl -n hw.ncpu)
    cmake --install .

    cd "${LIBTORRENT_ROOT}"
done

echo "Creating XCFramework..."

# Create XCFramework (universal binary)
xcodebuild -create-xcframework \
    -library "${INSTALL_DIR}/arm64/lib/libtorrent-rasterbar.a" \
    -headers "${INSTALL_DIR}/arm64/include" \
    -library "${INSTALL_DIR}/arm64-simulator/lib/libtorrent-rasterbar.a" \
    -headers "${INSTALL_DIR}/arm64-simulator/include" \
    -library "${INSTALL_DIR}/x86_64/lib/libtorrent-rasterbar.a" \
    -headers "${INSTALL_DIR}/x86_64/include" \
    -output "${INSTALL_DIR}/libtorrent.xcframework"

echo "Build complete! XCFramework at: ${INSTALL_DIR}/libtorrent.xcframework"
```

**3. Run Build:**

```bash
chmod +x build-ios.sh
./build-ios.sh
```

This will take 15-30 minutes. Result: `ios-build/libtorrent.xcframework`

**4. Alternative: Use Build System Directly**

If the script fails, try iTorrent's approach (reference only, GPL code):
- https://github.com/XITRIX/iTorrent/tree/master/LibTorrent/build-ios

### Option 3: Use Rust-Based Alternative (Future Consideration)

Consider Rust torrent libraries with better Swift interop:
- https://github.com/greatest-ape/aquatic (BitTorrent tracker in Rust)
- SwiftUI + Rust via UniFFI (experimental)

**For MVP: Recommend Option 2 (compile LibTorrent)**

## Project Setup

### 1. Create Xcode Project

```bash
# Create project directory
mkdir -p ~/Developer/tortok-ios
cd ~/Developer/tortok-ios

# Option A: Use Xcode GUI
# File > New > Project > iOS > App
# Name: TorTok
# Interface: SwiftUI
# Language: Swift
# Include Tests: Yes

# Option B: Use command line
xcodegen generate
```

**Project Structure:**
```
TorTok.xcodeproj
TorTok/
├── TorTokApp.swift
├── ContentView.swift
├── Assets.xcassets/
└── Info.plist
```

### 2. Configure Package Dependencies

**Edit Project Settings:**
- Target > General > Minimum Deployments: iOS 16.0
- Target > Build Settings > Swift Language Version: Swift 5

**Add Swift Package Dependencies:**

In Xcode:
1. File > Add Package Dependencies
2. Add each package:

```
Alamofire: https://github.com/Alamofire/Alamofire
Kingfisher: https://github.com/onevcat/Kingfisher
GRDB: https://github.com/groue/GRDB.swift
```

Or use `Package.swift`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TorTok",
    platforms: [.iOS(.v16)],
    dependencies: [
        .package(url: "https://github.com/Alamofire/Alamofire", from: "5.8.0"),
        .package(url: "https://github.com/onevcat/Kingfisher", from: "7.0.0"),
        .package(url: "https://github.com/groue/GRDB.swift", from: "6.0.0"),
    ],
    targets: [
        .target(
            name: "TorTok",
            dependencies: [
                "Alamofire",
                "Kingfisher",
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        )
    ]
)
```

### 3. Add LibTorrent XCFramework

**In Xcode:**
1. Select project in navigator
2. Select target
3. General tab > Frameworks, Libraries, and Embedded Content
4. Click + > Add Other > Add Files
5. Navigate to `libtorrent.xcframework`
6. Select "Embed & Sign"

**Verify:**
- Build Settings > Framework Search Paths includes XCFramework location

### 4. Create Bridging Header for C++

**File: TorTok-Bridging-Header.h**

```objc
//
//  Use this file to import your target's public headers that you would like to expose to Swift.
//

#import "LibTorrentBridge.h"
```

**Configure in Build Settings:**
- Objective-C Bridging Header: `TorTok/TorTok-Bridging-Header.h`

## Integrating LibTorrent

### 1. Create Objective-C++ Bridge

**LibTorrentBridge.h:**

```objc
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class TorrentHandle;
@class TorrentStatus;

@interface LibTorrentSession : NSObject

// Session management
- (instancetype)init;
- (void)start;
- (void)stop;
- (void)pause;
- (void)resume;

// Torrent creation
- (nullable NSString *)createTorrentFromFile:(NSString *)filePath
                                  trackers:(NSArray<NSString *> *)trackers
                                     error:(NSError **)error;

// Torrent management
- (BOOL)addMagnetLink:(NSString *)magnetLink
           savePath:(NSString *)savePath
              error:(NSError **)error;

- (BOOL)removeTorrent:(NSString *)infoHash
        deleteFiles:(BOOL)deleteFiles
              error:(NSError **)error;

// Status
- (nullable NSDictionary *)statusForTorrent:(NSString *)infoHash;
- (NSArray<NSDictionary *> *)allTorrents;

// Stats
- (int64_t)totalDownloadRate;
- (int64_t)totalUploadRate;
- (NSInteger)connectedPeers;

@end

NS_ASSUME_NONNULL_END
```

**LibTorrentBridge.mm:**

```objc
#import "LibTorrentBridge.h"
#include <libtorrent/session.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/bencode.hpp>
#include <libtorrent/sha1_hash.hpp>

using namespace libtorrent;

@interface LibTorrentSession()
@property (nonatomic) session *ltSession;
@property (nonatomic) dispatch_queue_t alertQueue;
@end

@implementation LibTorrentSession

- (instancetype)init {
    self = [super init];
    if (self) {
        // Create alert queue
        _alertQueue = dispatch_queue_create("com.tortok.libtorrent.alerts",
                                            DISPATCH_QUEUE_SERIAL);

        // Create session
        settings_pack settings;
        settings.set_int(settings_pack::alert_mask,
                        alert::error_notification |
                        alert::storage_notification |
                        alert::status_notification |
                        alert::peer_notification);

        // iOS-specific settings
        settings.set_bool(settings_pack::enable_dht, true);
        settings.set_bool(settings_pack::enable_lsd, false); // Local Service Discovery off
        settings.set_int(settings_pack::max_retry_port_bind, 10);
        settings.set_str(settings_pack::user_agent, "TorTok/1.0 (iOS)");

        // Optimize for mobile
        settings.set_int(settings_pack::connections_limit, 50); // Lower connection limit
        settings.set_int(settings_pack::active_downloads, 3);
        settings.set_int(settings_pack::active_seeds, 2);

        _ltSession = new session(settings);

        // Start alert processing
        [self startAlertProcessing];
    }
    return self;
}

- (void)dealloc {
    if (_ltSession) {
        delete _ltSession;
        _ltSession = nullptr;
    }
}

- (void)start {
    // Add DHT routers
    _ltSession->add_dht_router({"router.bittorrent.com", 6881});
    _ltSession->add_dht_router({"dht.transmissionbt.com", 6881});
    _ltSession->add_dht_router({"router.utorrent.com", 6881});

    NSLog(@"LibTorrent session started");
}

- (void)stop {
    _ltSession->pause();
    NSLog(@"LibTorrent session stopped");
}

- (void)pause {
    _ltSession->pause();
}

- (void)resume {
    _ltSession->resume();
}

- (NSString *)createTorrentFromFile:(NSString *)filePath
                          trackers:(NSArray<NSString *> *)trackers
                             error:(NSError **)error {
    @try {
        file_storage fs;
        std::string path = [filePath UTF8String];

        // Add file to storage
        add_files(fs, path);

        if (fs.num_files() == 0) {
            if (error) {
                *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                             code:1
                                         userInfo:@{NSLocalizedDescriptionKey: @"No files to add"}];
            }
            return nil;
        }

        create_torrent ct(fs);

        // Add trackers
        for (NSString *tracker in trackers) {
            ct.add_tracker([tracker UTF8String]);
        }

        // Set metadata
        ct.set_creator("TorTok iOS");
        ct.set_comment("Photo shared via TorTok");

        // Generate pieces
        std::string parentPath = [[filePath stringByDeletingLastPathComponent] UTF8String];
        set_piece_hashes(ct, parentPath);

        // Create torrent
        std::vector<char> torrent_data;
        bencode(std::back_inserter(torrent_data), ct.generate());

        // Generate magnet link
        torrent_info ti(torrent_data);
        std::string magnetLink = make_magnet_uri(ti);

        NSLog(@"Created torrent: %s", magnetLink.c_str());

        return [NSString stringWithUTF8String:magnetLink.c_str()];
    }
    @catch (std::exception& e) {
        if (error) {
            NSString *errorMsg = [NSString stringWithUTF8String:e.what()];
            *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                         code:2
                                     userInfo:@{NSLocalizedDescriptionKey: errorMsg}];
        }
        return nil;
    }
}

- (BOOL)addMagnetLink:(NSString *)magnetLink
           savePath:(NSString *)savePath
              error:(NSError **)error {
    @try {
        add_torrent_params params = parse_magnet_uri([magnetLink UTF8String]);
        params.save_path = [savePath UTF8String];

        // Add to session
        torrent_handle handle = _ltSession->add_torrent(params);

        if (!handle.is_valid()) {
            if (error) {
                *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                             code:3
                                         userInfo:@{NSLocalizedDescriptionKey: @"Invalid torrent handle"}];
            }
            return NO;
        }

        NSLog(@"Added torrent: %@", magnetLink);
        return YES;
    }
    @catch (std::exception& e) {
        if (error) {
            NSString *errorMsg = [NSString stringWithUTF8String:e.what()];
            *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                         code:4
                                     userInfo:@{NSLocalizedDescriptionKey: errorMsg}];
        }
        return NO;
    }
}

- (BOOL)removeTorrent:(NSString *)infoHash
        deleteFiles:(BOOL)deleteFiles
              error:(NSError **)error {
    @try {
        sha1_hash hash;
        from_hex(infoHash.UTF8String, hash.data());

        torrent_handle handle = _ltSession->find_torrent(hash);
        if (!handle.is_valid()) {
            if (error) {
                *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                             code:5
                                         userInfo:@{NSLocalizedDescriptionKey: @"Torrent not found"}];
            }
            return NO;
        }

        _ltSession->remove_torrent(handle, deleteFiles ? session::delete_files : 0);
        return YES;
    }
    @catch (std::exception& e) {
        if (error) {
            NSString *errorMsg = [NSString stringWithUTF8String:e.what()];
            *error = [NSError errorWithDomain:@"com.tortok.libtorrent"
                                         code:6
                                         userInfo:@{NSLocalizedDescriptionKey: errorMsg}];
        }
        return NO;
    }
}

- (NSDictionary *)statusForTorrent:(NSString *)infoHash {
    sha1_hash hash;
    from_hex(infoHash.UTF8String, hash.data());

    torrent_handle handle = _ltSession->find_torrent(hash);
    if (!handle.is_valid()) {
        return nil;
    }

    torrent_status status = handle.status();

    return @{
        @"name": [NSString stringWithUTF8String:status.name.c_str()],
        @"progress": @(status.progress),
        @"downloadRate": @(status.download_rate),
        @"uploadRate": @(status.upload_rate),
        @"numPeers": @(status.num_peers),
        @"numSeeds": @(status.num_seeds),
        @"state": @(status.state),
        @"totalDownload": @(status.total_download),
        @"totalUpload": @(status.total_upload),
    };
}

- (NSArray<NSDictionary *> *)allTorrents {
    std::vector<torrent_handle> torrents = _ltSession->get_torrents();
    NSMutableArray *result = [NSMutableArray array];

    for (const auto& handle : torrents) {
        if (!handle.is_valid()) continue;

        torrent_status status = handle.status();
        std::string hash_str = aux::to_hex(status.info_hashes.v1);

        [result addObject:@{
            @"infoHash": [NSString stringWithUTF8String:hash_str.c_str()],
            @"name": [NSString stringWithUTF8String:status.name.c_str()],
            @"progress": @(status.progress),
            @"downloadRate": @(status.download_rate),
            @"uploadRate": @(status.upload_rate),
            @"numPeers": @(status.num_peers),
        }];
    }

    return result;
}

- (int64_t)totalDownloadRate {
    session_status status = _ltSession->status();
    return status.download_rate;
}

- (int64_t)totalUploadRate {
    session_status status = _ltSession->status();
    return status.upload_rate;
}

- (NSInteger)connectedPeers {
    session_status status = _ltSession->status();
    return status.num_peers;
}

- (void)startAlertProcessing {
    dispatch_async(_alertQueue, ^{
        while (true) {
            if (!self->_ltSession) break;

            self->_ltSession->wait_for_alert(seconds(1));

            std::vector<alert*> alerts;
            self->_ltSession->pop_alerts(&alerts);

            for (alert* a : alerts) {
                [self handleAlert:a];
            }
        }
    });
}

- (void)handleAlert:(libtorrent::alert*)alert {
    // Handle specific alert types
    NSLog(@"Alert: %s", alert->message().c_str());

    // You can dispatch notifications here for Swift to observe
    // [[NSNotificationCenter defaultCenter] postNotificationName:...];
}

@end
```

**Add to Xcode:**
1. New File > Objective-C++ File
2. Name: LibTorrentBridge.mm
3. Create bridging header when prompted

### 2. Swift Wrapper

**TorrentEngine.swift:**

```swift
import Foundation
import Combine

class TorrentEngine: ObservableObject {
    private let session: LibTorrentSession
    private let fileManager = FileManager.default

    @Published var activeTorrents: [TorrentInfo] = []
    @Published var downloadRate: Int64 = 0
    @Published var uploadRate: Int64 = 0
    @Published var isActive: Bool = false

    struct TorrentInfo: Identifiable {
        let id: String // infoHash
        let name: String
        let progress: Double
        let downloadRate: Int64
        let uploadRate: Int64
        let numPeers: Int
    }

    init() {
        self.session = LibTorrentSession()
        self.session.start()
        self.isActive = true

        // Start monitoring
        startMonitoring()
    }

    deinit {
        session.stop()
    }

    // MARK: - Torrent Operations

    func createTorrent(from fileURL: URL) throws -> String {
        let trackers = [
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://tracker.openbittorrent.com:6969/announce",
            "udp://open.demonii.com:1337/announce"
        ]

        var error: NSError?
        guard let magnetLink = session.createTorrent(fromFile: fileURL.path,
                                                     trackers: trackers,
                                                     error: &error) else {
            throw error ?? TorrentError.creationFailed
        }

        return magnetLink
    }

    func download(magnetLink: String) throws {
        let savePath = getCacheDirectory()

        var error: NSError?
        let success = session.addMagnetLink(magnetLink,
                                           savePath: savePath.path,
                                           error: &error)

        if !success {
            throw error ?? TorrentError.downloadFailed
        }
    }

    func remove(infoHash: String, deleteFiles: Bool = true) throws {
        var error: NSError?
        let success = session.removeTorrent(infoHash,
                                           deleteFiles: deleteFiles,
                                           error: &error)

        if !success {
            throw error ?? TorrentError.removalFailed
        }
    }

    // MARK: - Status

    func status(for infoHash: String) -> TorrentInfo? {
        guard let statusDict = session.status(forTorrent: infoHash) else {
            return nil
        }

        return parseTorrentInfo(from: statusDict)
    }

    // MARK: - Control

    func pause() {
        session.pause()
        isActive = false
    }

    func resume() {
        session.resume()
        isActive = true
    }

    // MARK: - Private

    private func startMonitoring() {
        Timer.publish(every: 1.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.updateStats()
            }
            .store(in: &cancellables)
    }

    private func updateStats() {
        downloadRate = session.totalDownloadRate()
        uploadRate = session.totalUploadRate()

        let torrentsData = session.allTorrents()
        activeTorrents = torrentsData.compactMap { parseTorrentInfo(from: $0) }
    }

    private func parseTorrentInfo(from dict: [String: Any]) -> TorrentInfo? {
        guard let infoHash = dict["infoHash"] as? String,
              let name = dict["name"] as? String,
              let progress = dict["progress"] as? Double,
              let downloadRate = dict["downloadRate"] as? Int64,
              let uploadRate = dict["uploadRate"] as? Int64,
              let numPeers = dict["numPeers"] as? Int else {
            return nil
        }

        return TorrentInfo(
            id: infoHash,
            name: name,
            progress: progress,
            downloadRate: downloadRate,
            uploadRate: uploadRate,
            numPeers: numPeers
        )
    }

    private func getCacheDirectory() -> URL {
        fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Torrents", isDirectory: true)
    }

    private var cancellables = Set<AnyCancellable>()
}

enum TorrentError: LocalizedError {
    case creationFailed
    case downloadFailed
    case removalFailed
    case notFound

    var errorDescription: String? {
        switch self {
        case .creationFailed: return "Failed to create torrent"
        case .downloadFailed: return "Failed to download torrent"
        case .removalFailed: return "Failed to remove torrent"
        case .notFound: return "Torrent not found"
        }
    }
}
```

## Testing Strategy

### Unit Tests

```swift
import XCTest
@testable import TorTok

final class TorrentEngineTests: XCTestCase {
    var engine: TorrentEngine!

    override func setUp() {
        super.setUp()
        engine = TorrentEngine()
    }

    override func tearDown() {
        engine = nil
        super.tearDown()
    }

    func testCreateTorrent() throws {
        // Create test file
        let testData = Data("Test content".utf8)
        let testURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("test.txt")
        try testData.write(to: testURL)

        // Create torrent
        let magnetLink = try engine.createTorrent(from: testURL)

        // Verify magnet link format
        XCTAssertTrue(magnetLink.hasPrefix("magnet:?xt=urn:btih:"))
    }

    func testDownloadTorrent() {
        // Test with known good magnet link
        let magnetLink = "magnet:?xt=urn:btih:..."

        XCTAssertNoThrow(try engine.download(magnetLink: magnetLink))
    }
}
```

### UI Tests

```swift
import XCUITest

final class TorTokUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launch()
    }

    func testLoginFlow() {
        // Tap login button
        app.buttons["Login"].tap()

        // Enter credentials
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText("test@example.com")

        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("password123")

        // Submit
        app.buttons["Sign In"].tap()

        // Verify feed appears
        XCTAssertTrue(app.navigationBars["TorTok"].exists)
    }
}
```

## App Store Preparation

### 1. Configure App Info

**Info.plist additions:**

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>TorTok needs access to your photos to share them on the network.</string>

<key>NSCameraUsageDescription</key>
<string>TorTok needs camera access to capture photos.</string>

<key>NSLocalNetworkUsageDescription</key>
<string>TorTok uses local network for peer-to-peer photo sharing.</string>

<key>UIBackgroundModes</key>
<array>
    <string>processing</string>
</array>
```

### 2. App Store Review Considerations

**Potential Rejection Risks:**
- BitTorrent usage (explain it's for photo sharing)
- Battery usage (show it's controlled)
- Background activity (limited on iOS anyway)

**Mitigation:**
- Clear App Review notes explaining P2P usage
- Demonstrate battery controls in app
- Emphasize this is for decentralized social networking
- Reference PeerTube as similar approved app

### 3. TestFlight Beta

```bash
# Archive build
Product > Archive

# In Organizer:
# 1. Distribute App
# 2. TestFlight & App Store
# 3. Upload

# Once uploaded:
# App Store Connect > TestFlight
# Add internal/external testers
```

## Next Steps

1. **Set up project** following this guide
2. **Build LibTorrent** for iOS
3. **Implement core torrent** functionality
4. **Build UI** with SwiftUI
5. **Test on device** (required for P2P)
6. **Beta release** via TestFlight

## Resources

- [LibTorrent Documentation](https://www.libtorrent.org/reference.html)
- [iTorrent Source Code](https://github.com/XITRIX/iTorrent) (GPL - reference only)
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [Swift.org](https://swift.org/documentation/)

## Troubleshooting

### LibTorrent Won't Compile

**Issue:** CMake errors during iOS build

**Solution:**
```bash
# Clean and retry
rm -rf build-ios ios-build
./build-ios.sh

# Check Boost and OpenSSL paths
brew info boost
brew info openssl@3
```

### "Library not loaded" at Runtime

**Issue:** XCFramework not embedded

**Solution:**
- Xcode > Target > General > Frameworks
- Ensure "Embed & Sign" is selected

### P2P Not Working on Device

**Issue:** No peers connecting

**Solution:**
- Check device isn't on restrictive network
- Verify DHT is enabled in session settings
- Test with known good magnet link
- Check STUN/TURN server connectivity

---

Happy coding! Join the discussion at https://github.com/tortok/tortok-ios
