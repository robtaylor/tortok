# How to Run TorTok

## 🚀 Quick Start (2 Minutes)

The **fastest way** to see TorTok running is to use the standalone demo:

```bash
cd /Users/roberttaylor/Code/tortok
./run-demo.sh
```

This will:
1. Open `TorTokDemo.swift` in Xcode
2. Show you simple instructions to create a new iOS project
3. You can see the full UI running in ~2 minutes

## 📱 What You'll See

When the demo runs, you'll see:

- **Login Screen**: Purple/pink gradient with TorTok logo
- **Beautiful UI**: "TikTok meets BitTorrent" tagline
- **Tab Navigation**: Home feed, Record button, Profile
- **Demo Videos**: Sample video cards with likes, captions
- **Working Interactions**: Like button, profile navigation

## 🎯 Two Options to Run

### Option 1: Quick Demo (Recommended for First Run)

**Best for**: Just seeing the UI and design

**No dependencies needed** - runs immediately!

```bash
./run-demo.sh
```

Then in Xcode:
1. File > New > Project > iOS > App
2. Name: `TorTokDemo`, Interface: SwiftUI
3. Save anywhere (Desktop is fine)
4. Delete `ContentView.swift` from the new project
5. Drag `TorTokDemo.swift` from Finder into project navigator
6. Select iPhone 15 simulator
7. Press ⌘R

**Demo Limitations**:
- No real API calls
- No video recording
- No P2P streaming
- Just the UI and navigation

### Option 2: Full Project (For Development)

**Best for**: Actual development and adding features

**Requires**: Swift Package dependencies

**Steps**:

1. **Run the interactive script**:
   ```bash
   ./create-and-run.sh
   ```
   Choose option 2 for the full project

2. **Or manually**:
   ```bash
   cd TorTok
   open Package.swift
   ```

3. **In Xcode, create a new iOS App project**:
   - File > New > Project > iOS > App
   - Name: `TorTok`
   - Interface: SwiftUI
   - Save location: `/Users/roberttaylor/Code/tortok`

4. **Add Swift Package Dependencies**:
   - Select project > Package Dependencies > +
   - Add:
     - `https://github.com/Alamofire/Alamofire` (v5.8.0+)
     - `https://github.com/onevcat/Kingfisher` (v7.0.0+)
     - `https://github.com/groue/GRDB.swift` (v6.0.0+)

5. **Add source files to project**:
   - Delete default `ContentView.swift`
   - Drag all files from `TorTok/` into project:
     - `TorTokApp.swift` (main entry point)
     - `Models/` folder
     - `Services/` folder
     - `Views/` folder
     - `Info.plist`
     - `Resources/Assets.xcassets`

6. **Build and Run** (⌘R)

**Full Project Features**:
- ✅ API client ready (needs backend)
- ✅ Authentication flow
- ✅ Video models and data structures
- ⚠️ Torrent engine (stubbed, needs LibTorrent)
- ⚠️ Video recording (not implemented yet)
- ⚠️ P2P streaming (not implemented yet)

## 🔧 Troubleshooting

### "Cannot find 'Alamofire' in scope"

**Fix**: Make sure you added the Swift Package dependencies in step 4

### "No such module 'LibTorrentBridge'"

**Expected**: This is fine! LibTorrent hasn't been compiled yet. The app will run, P2P features just won't work.

### "Code signing error"

**Fix**:
1. Select project > Target > Signing & Capabilities
2. Select your Apple ID under "Team"
3. Change Bundle Identifier: `com.yourname.TorTok`

### "The operation couldn't be completed"

**Fix**: Make sure you're running on iOS 16.0+ simulator

## 📊 Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| UI/UX Design | ✅ Complete | Purple/pink gradient, TikTok-style |
| Login/Auth Views | ✅ Complete | Login, register, profile |
| Navigation | ✅ Complete | Tab bar with Home/Record/Profile |
| Models | ✅ Complete | User, Video, TorrentInfo |
| API Client | ✅ Complete | Alamofire-based, async/await |
| Auth Manager | ✅ Complete | JWT token management |
| Assets | ✅ Complete | AppIcon placeholder |
| Info.plist | ✅ Complete | Camera, mic, network permissions |
| Video Feed | 🚧 Partial | Placeholder view |
| Torrent Engine | ⚠️ Stubbed | Needs LibTorrent compilation |
| Video Recording | ❌ Not started | AVFoundation implementation needed |
| P2P Streaming | ❌ Not started | Needs torrent engine |
| Backend | ❌ Not started | No server yet |

## 🎬 Next Steps After Running

Once you see the app running:

1. **Explore the demo UI** - See the design and navigation
2. **Review the code** - Check out the SwiftUI views and structure
3. **Plan next features**:
   - Implement video recording with AVCaptureSession
   - Build HLS encoding pipeline
   - Compile LibTorrent for iOS
   - Create P2P video player

## 📚 Additional Documentation

- **QUICK_START.md** - Detailed step-by-step Xcode setup
- **BUILD_STATUS.md** - Complete project progress tracker
- **TorTok/README.md** - iOS project documentation
- **designs/mvp-video-reels-specification.md** - Full technical spec
- **docs/guides/ios-development.md** - iOS development guide

## ⚡ TL;DR - Run It Now!

```bash
cd /Users/roberttaylor/Code/tortok
./run-demo.sh
```

Then follow the on-screen instructions. You'll see TorTok running in ~2 minutes!

---

**Need help?** All scripts have built-in instructions. Just run them and follow along!
