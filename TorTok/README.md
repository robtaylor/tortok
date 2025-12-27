# TorTok iOS App

Native iOS app for TorTok - decentralized video reels with P2P streaming.

## Project Status

✅ **Initial project structure created**
✅ **Core models and services implemented**
✅ **Basic UI views (Login, Feed, Profile)**
⚠️ **LibTorrent bridge pending** (needs compilation)
⚠️ **Video recording pending**
⚠️ **P2P video player pending**

## Project Structure

```
TorTok/
├── Package.swift                  # Swift Package Manager manifest
├── TorTokApp.swift               # App entry point
├── Models/
│   ├── User.swift                # User model
│   ├── Video.swift               # Video model
│   └── TorrentInfo.swift         # Torrent status model
├── Views/
│   ├── Auth/
│   │   └── LoginView.swift       # Login & register UI
│   ├── Feed/
│   │   └── VideoFeedView.swift   # Main video feed
│   ├── Profile/
│   │   └── ProfileView.swift     # User profile
│   ├── Record/                   # TODO: Video recording
│   └── Upload/                   # TODO: Upload flow
├── Services/
│   ├── API/
│   │   ├── APIClient.swift       # HTTP client (Alamofire)
│   │   └── AuthManager.swift     # Authentication
│   ├── Torrent/
│   │   ├── TorrentEngine.swift   # Swift wrapper (stub)
│   │   └── Bridge/               # TODO: Obj-C++ bridge
│   ├── Video/                    # TODO: Recording/encoding
│   ├── Player/                   # TODO: P2P player
│   └── Battery/                  # TODO: Battery monitoring
└── Resources/
    └── Assets.xcassets           # Images, colors, etc.
```

## Dependencies

### Managed via Swift Package Manager

- **Alamofire** (5.8+): HTTP networking
- **Kingfisher** (7.0+): Image loading and caching
- **GRDB.swift** (6.0+): SQLite database wrapper

### External (Manual Integration)

- **LibTorrent**: C++ torrent library (needs compilation)
  - See: `/docs/guides/ios-development.md` for build instructions

## Getting Started

### Prerequisites

- macOS 13.0+
- Xcode 15.0+
- iOS 16.0+ device (for P2P testing)

### Setup Steps

**1. Clone the repository:**
```bash
cd /Users/roberttaylor/Code/tortok
```

**2. Compile LibTorrent for iOS:**

Follow the guide in `/docs/guides/ios-development.md`:
```bash
# This will take 15-30 minutes
cd ~/Developer
git clone --recurse-submodules https://github.com/arvidn/libtorrent.git
cd libtorrent
./build-ios.sh
```

**3. Add LibTorrent XCFramework:**

In Xcode:
- Open `TorTok.xcodeproj` (once created)
- Target > General > Frameworks
- Add `libtorrent.xcframework`
- Select "Embed & Sign"

**4. Create Xcode Project:**

```bash
# Create Xcode project from Package.swift
swift package generate-xcodeproj

# Or open in Xcode directly
open Package.swift
```

**5. Configure Signing:**

- Select project in Xcode
- Target > Signing & Capabilities
- Select your team
- Bundle ID: `com.tortok.ios`

**6. Build & Run:**

```bash
# Command line
xcodebuild -scheme TorTok -destination 'platform=iOS Simulator,name=iPhone 15'

# Or in Xcode: ⌘R
```

## Configuration

### API Endpoint

Edit `Services/API/APIClient.swift`:
```swift
init(baseURL: String = "https://api.tortok.app") {
    // Change to your local server during development:
    // "http://localhost:3000"
}
```

### App Settings

Edit `Info.plist` (create if needed):
```xml
<key>NSCameraUsageDescription</key>
<string>TorTok needs camera access to record videos</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>TorTok needs photo library access to select videos</string>

<key>NSMicrophoneUsageDescription</key>
<string>TorTok needs microphone access for video audio</string>

<key>NSLocalNetworkUsageDescription</key>
<string>TorTok uses local network for P2P video streaming</string>
```

## Next Steps

### Immediate Tasks

1. **Compile LibTorrent** for iOS
   - Follow `/docs/guides/ios-development.md`
   - Create XCFramework
   - Integrate into project

2. **Implement LibTorrent Bridge**
   - Create `LibTorrentBridge.h`
   - Implement `LibTorrentBridge.mm`
   - Update `TorrentEngine.swift` to use bridge

3. **Video Recording**
   - Implement `VideoRecorder.swift` (AVFoundation)
   - Create camera UI
   - Add recording controls

4. **HLS Encoding**
   - Implement `VideoEncoder.swift`
   - Generate multiple quality levels
   - Create `.m3u8` playlists

5. **P2P Video Player**
   - Implement `P2PVideoPlayer.swift`
   - Integrate AVPlayer with custom resource loader
   - Handle torrent downloads during playback

6. **Video Feed UI**
   - Implement swipeable vertical feed
   - Add video preloading
   - Optimize for smooth scrolling

### Future Enhancements

- [ ] Background seeding (iOS limitations)
- [ ] Video trimming/editing
- [ ] Hashtag suggestions
- [ ] Push notifications
- [ ] Video effects/filters
- [ ] Sound library
- [ ] Duets/stitching
- [ ] Live streaming

## Testing

### Unit Tests

```bash
swift test
```

### UI Tests

In Xcode:
- ⌘U to run all tests
- Or select individual test files

### Device Testing

**Important:** P2P functionality requires real device testing (not simulator)

1. Connect iOS device via USB
2. Select device in Xcode
3. Build & Run (⌘R)
4. Test P2P connections between 2+ devices

## Debugging

### Common Issues

**"Library not loaded: @rpath/libtorrent-rasterbar"**
- Solution: Ensure XCFramework is embedded & signed

**"Cannot find LibTorrentSession in scope"**
- Solution: Compile LibTorrent bridge first

**"Camera permission denied"**
- Solution: Add `NSCameraUsageDescription` to Info.plist

**"P2P connections failing"**
- Solution: Check STUN/TURN server configuration
- Ensure both devices on different networks for NAT testing

### Logging

Enable verbose logging:
```swift
// In TorgramApp.swift init()
#if DEBUG
UserDefaults.standard.set(true, forKey: "TORTOK_DEBUG_LOGGING")
#endif
```

## Performance

### Target Metrics

- App launch: <2 seconds
- Video start time: <3 seconds (P2P)
- Feed scroll: 60 FPS
- Battery drain: <10%/hour while watching

### Optimization Tips

- Use Instruments to profile
- Monitor memory usage (large video cache)
- Test on older devices (iPhone 12/13)
- Measure P2P vs HTTP fallback ratio

## Contributing

See main project README at `/README.md`

Key areas needing work:
1. LibTorrent bridge implementation
2. Video recording & encoding
3. P2P video player
4. Vertical feed UI
5. Battery optimization

## License

MIT License - See `/LICENSE`

## Resources

- [Main Documentation](/docs/)
- [iOS Development Guide](/docs/guides/ios-development.md)
- [Video Reels MVP Spec](/designs/mvp-video-reels-specification.md)
- [Technical Challenges](/docs/guides/technical-challenges.md)

## Contact

- GitHub Issues: https://github.com/tortok/tortok-ios
- Discussions: https://github.com/tortok/tortok-ios/discussions

---

**Status**: 🚧 In Development

Built with ❤️ using Swift, SwiftUI, and LibTorrent
