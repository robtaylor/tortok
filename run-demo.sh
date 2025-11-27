#!/bin/bash

# TorTok Quick Demo Launcher
# Opens the standalone demo in Xcode

echo "🚀 TorTok Quick Demo"
echo "===================="
echo ""

echo "Opening TorTokDemo.swift in Xcode..."
echo ""

open -a Xcode /Users/roberttaylor/Code/tortok/TorTokDemo.swift

echo "✅ TorTokDemo.swift opened in Xcode"
echo ""
echo "📖 To run the demo:"
echo ""
echo "  1. In Xcode: File > New > Project > iOS > App"
echo "  2. Name: TorTokDemo, Interface: SwiftUI"
echo "  3. Click Next > Create (save anywhere)"
echo "  4. In the new project, delete ContentView.swift"
echo "  5. Drag TorTokDemo.swift from Finder into the project navigator"
echo "  6. Select any iPhone simulator (iPhone 15 recommended)"
echo "  7. Press ⌘R to build and run!"
echo ""
echo "✨ You should see:"
echo "  - Purple/pink gradient login screen"
echo "  - TorTok logo with tagline"
echo "  - Working UI with tabs (Home, Record, Profile)"
echo "  - Demo videos in the feed"
echo ""
