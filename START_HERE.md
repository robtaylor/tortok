# Welcome to TorTok! 🎬

```
████████╗ ██████╗ ██████╗ ████████╗ ██████╗ ██╗  ██╗
╚══██╔══╝██╔═══██╗██╔══██╗╚══██╔══╝██╔═══██╗██║ ██╔╝
   ██║   ██║   ██║██████╔╝   ██║   ██║   ██║█████╔╝
   ██║   ██║   ██║██╔══██╗   ██║   ██║   ██║██╔═██╗
   ██║   ╚██████╔╝██║  ██║   ██║   ╚██████╔╝██║  ██╗
   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝

        "TikTok meets BitTorrent"
    Decentralized Video Reels Platform
```

## 🎯 You're 1 Command Away from Running TorTok!

### Quick Start (Recommended)

```bash
./run-demo.sh
```

This will open the TorTok demo in Xcode. Just follow the on-screen instructions!

## 📚 Documentation

| File | Description |
|------|-------------|
| **READY_TO_RUN.md** | ✅ What's ready and working |
| **HOW_TO_RUN.md** | 📖 Complete run instructions |
| **QUICK_START.md** | 🚀 Step-by-step Xcode setup |
| **BUILD_STATUS.md** | 📊 Project progress and roadmap |

## 🎬 What's Ready

✅ **Beautiful UI** - Purple/pink gradient, TikTok-style
✅ **Login Screen** - Full auth flow UI
✅ **Video Feed** - Swipeable video cards
✅ **Profile View** - User stats and info
✅ **Tab Navigation** - Home, Record, Profile
✅ **Demo Mode** - See it all working without backend

## 🛠️ Project Structure

```
TorTok/
├── TorTokApp.swift         ← Main app (SwiftUI)
├── Models/                 ← User, Video, TorrentInfo
├── Services/
│   ├── API/                ← Alamofire HTTP client
│   └── Torrent/            ← P2P engine (stubbed)
└── Views/
    ├── Auth/               ← Login/Register UI
    ├── Feed/               ← Video feed
    └── Profile/            ← User profile
```

## 🎨 Design Highlights

- 💜 **Purple/pink gradient** theme
- 🎥 **Vertical video reels** (TikTok-style)
- 🌙 **Dark mode** interface
- ⚡ **SwiftUI** declarative UI
- 🎯 **Tab navigation** for easy browsing

## 🚀 Two Ways to Run

### 1. Quick Demo (No Dependencies)

```bash
./run-demo.sh
```

- ✅ Runs in ~2 minutes
- ✅ No setup needed
- ✅ Full UI demo
- ⚠️ No real functionality (demo mode only)

### 2. Full Project (With Dependencies)

```bash
./create-and-run.sh
```

- ✅ Full codebase
- ✅ Ready for development
- ⚠️ Requires Xcode setup (~10 min)
- ⚠️ Needs Swift Package dependencies

## 📖 Next Steps

1. **Run the demo** (./run-demo.sh)
2. **Explore the UI** - See the design and navigation
3. **Review the code** - Check out the SwiftUI views
4. **Plan features** - Video recording, P2P streaming, etc.

## 🏗️ Development Roadmap

### Completed ✅
- Project structure
- Models and data types
- API client (Alamofire)
- Auth manager (JWT)
- Beautiful UI design
- Login/Feed/Profile views
- Demo application

### Next Up 🚧
1. Video recording (AVCaptureSession)
2. HLS encoding pipeline
3. LibTorrent compilation for iOS
4. P2P video player
5. Backend metadata server

### Future 🔮
- Real-time feed updates
- Push notifications
- Federation protocol
- Instance moderation
- Advanced P2P features

## 🎯 Ready to Run?

Open your terminal and run:

```bash
cd /Users/roberttaylor/Code/tortok
./run-demo.sh
```

You'll see TorTok running in your simulator in about 2 minutes! 🎉

---

**Need help?** Check the documentation files above or just run the scripts - they include instructions!

**Want to contribute?** This is open source! Check out BUILD_STATUS.md for the roadmap.

**Questions?** All documentation is in `/docs` - comprehensive guides, architecture, and technical specs.

---

Made with ❤️ for the decentralized web
License: MIT
