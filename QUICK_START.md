# Quick Start: Run TorTok in 5 Minutes

## Option 1: Create New Xcode Project (Recommended)

### Step 1: Create Project in Xcode

1. **Open Xcode**
2. **File > New > Project**
3. Select **iOS** > **App**
4. Click **Next**

**Project Settings:**
```
Product Name: TorTok
Team: [Your Apple ID]
Organization Identifier: com.tortok
Bundle Identifier: com.tortok.TorTok
Interface: SwiftUI
Language: Swift
☑ Include Tests
```

5. **Save location**: `/Users/roberttaylor/Code/tortok`
6. Click **Create**

### Step 2: Replace Generated Files

Xcode created some default files. Replace them with ours:

```bash
cd /Users/roberttaylor/Code/tortok

# Xcode created a project at tortok/TorTok/
# We have our files at tortok/TorTok/

# Delete Xcode's generated files
rm TorTok/TorTok/ContentView.swift
rm TorTok/TorTok/TorTokApp.swift  # We'll use ours

# Copy our files into the Xcode project
cp -r TorTok/* TorTok/TorTok/
```

### Step 3: Add Dependencies

In Xcode:

1. **Select project** in navigator (top level "TorTok")
2. **Select TorTok target**
3. **General tab** > scroll to **Frameworks, Libraries, and Embedded Content**
4. Click **+ button**
5. Click **Add Other...** > **Add Package Dependency...**

Add these packages:

```
Alamofire:
URL: https://github.com/Alamofire/Alamofire
Version: 5.8.0 (Up to Next Major)

Kingfisher:
URL: https://github.com/onevcat/Kingfisher
Version: 7.0.0 (Up to Next Major)

GRDB.swift:
URL: https://github.com/groue/GRDB.swift
Version: 6.0.0 (Up to Next Major)
```

### Step 4: Run!

1. **Select a simulator** (iPhone 15 recommended)
2. Press **⌘R** or click **Play button**
3. App should launch! 🎉

---

## Option 2: Super Quick Demo (No Dependencies)

Want to see something run immediately? Let me create a standalone demo:

```bash
cd /Users/roberttaylor/Code/tortok
chmod +x create-demo.sh
./create-demo.sh
```

This will create a minimal TorTok demo app that runs without any external dependencies.

---

## What You'll See

When the app launches:

✅ **Purple/Pink gradient login screen**
✅ **TorTok logo with "TikTok meets BitTorrent" tagline**
✅ **Email & password fields**
✅ **Sign In / Sign Up buttons**

**Note**: Login won't work yet (no backend server), but you'll see the beautiful UI!

---

## Troubleshooting

### "Library not loaded: @rpath/Alamofire"

**Solution**: Make sure you added the Swift packages in Step 3

### "No such module 'Alamofire'"

**Solution**:
1. Select project
2. Build Settings
3. Search for "Swift Compiler - Search Paths"
4. Clean build folder (⌘⇧K)
5. Build again (⌘B)

### "Cannot find 'LibTorrentSession' in scope"

**Expected**: This is fine! LibTorrent bridge isn't compiled yet. The app will run without it, torrent features just won't work.

**In TorrentEngine.swift**: We have stubbed implementations with `// TODO` comments

### Code Signing Error

**Solution**:
1. Select project > Target > Signing & Capabilities
2. Select your Apple ID under "Team"
3. Change Bundle Identifier if needed: `com.yourname.TorTok`

---

## Next Steps After It Runs

Once you see the app running:

1. **Explore the UI** - Login screen, tab navigation layout
2. **Check the code** - See how SwiftUI views are structured
3. **Plan next features**:
   - Mock API responses to test full flow
   - Add video recording (next priority)
   - Compile LibTorrent for P2P functionality

---

## Current App Status

**✅ Working**:
- Beautiful login UI
- Tab navigation structure
- SwiftUI views
- Models defined
- API client configured

**⚠️ Stubbed** (shows placeholders):
- Video feed (shows "No videos yet")
- Profile (shows user info structure)
- Torrent engine (stubs, needs LibTorrent)

**❌ Not Implemented** (coming next):
- Video recording
- P2P streaming
- Backend server

---

## Want to See it Now?

Run this command and I'll help you through it:

```bash
cd /Users/roberttaylor/Code/tortok
./setup-xcode.sh
```

Or just:

```bash
# Open Xcode manually
open -a Xcode

# Then: File > New > Project and follow steps above
```

---

**Need help?** Check BUILD_STATUS.md for detailed progress, or ask me!
