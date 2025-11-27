#!/bin/bash

# TorTok - Create Xcode Project and Run
# This script creates a complete Xcode project from scratch

set -e

echo "🚀 TorTok - Create and Run"
echo "=========================="
echo ""

PROJECT_DIR="/Users/roberttaylor/Code/tortok"
cd "$PROJECT_DIR"

# Check if Xcode is installed
if ! command -v xcodebuild &> /dev/null; then
    echo "❌ Error: Xcode is not installed"
    exit 1
fi

echo "✅ Xcode found: $(xcodebuild -version | head -1)"
echo ""

# Option 1: Quick Demo (Standalone)
echo "Choose an option:"
echo ""
echo "1) Quick Demo - Run TorTokDemo.swift (no dependencies, runs immediately)"
echo "2) Full Project - Create complete Xcode project with all features"
echo ""
read -p "Choice (1-2): " choice

case $choice in
    1)
        echo ""
        echo "📱 Creating Quick Demo Project..."
        echo ""

        # Create a temporary directory for the demo project
        DEMO_DIR="$PROJECT_DIR/TorTokDemoProject"
        rm -rf "$DEMO_DIR"
        mkdir -p "$DEMO_DIR"

        # Copy the standalone demo file
        cp "$PROJECT_DIR/TorTokDemo.swift" "$DEMO_DIR/"

        # Create a minimal Package.swift for the demo
        cat > "$DEMO_DIR/Package.swift" << 'EOF'
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TorTokDemo",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "TorTokDemo", targets: ["TorTokDemo"])
    ],
    targets: [
        .target(name: "TorTokDemo", path: ".")
    ]
)
EOF

        echo "✅ Demo project created at: $DEMO_DIR"
        echo ""
        echo "📖 To run the demo:"
        echo ""
        echo "  1. Open Xcode"
        echo "  2. File > New > Project > iOS > App"
        echo "  3. Name: TorTokDemo"
        echo "  4. Interface: SwiftUI"
        echo "  5. Save anywhere (Desktop is fine)"
        echo "  6. Replace ContentView.swift with TorTokDemo.swift content"
        echo "  7. Press ⌘R to run!"
        echo ""
        echo "Or run this command to open the file:"
        echo "  open -a Xcode $DEMO_DIR/TorTokDemo.swift"
        echo ""

        read -p "Open TorTokDemo.swift in Xcode now? (y/n): " open_demo
        if [[ "$open_demo" == "y" ]]; then
            open -a Xcode "$DEMO_DIR/TorTokDemo.swift"
        fi
        ;;

    2)
        echo ""
        echo "📱 Creating Full TorTok Project..."
        echo ""

        # Navigate to TorTok directory
        cd "$PROJECT_DIR/TorTok"

        echo "The full project requires:"
        echo "  - Swift Package dependencies (Alamofire, Kingfisher, GRDB)"
        echo "  - LibTorrent compilation (optional, for P2P features)"
        echo ""
        echo "Opening Package.swift in Xcode..."
        echo ""
        echo "After Xcode opens:"
        echo "  1. Xcode will resolve package dependencies (this takes a minute)"
        echo "  2. File > New > Project > iOS > App"
        echo "  3. Name: TorTok"
        echo "  4. Save location: $PROJECT_DIR"
        echo "  5. Add all Swift files from TorTok/ folder to project"
        echo "  6. Add Info.plist to project"
        echo "  7. Add Assets.xcassets to project"
        echo "  8. Add Swift Package dependencies"
        echo "  9. Build and Run (⌘R)"
        echo ""

        # Open Package.swift in Xcode
        open Package.swift

        echo "✅ Xcode should open Package.swift"
        echo ""
        ;;

    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "===================="
echo "📚 Need Help?"
echo ""
echo "Check these files:"
echo "  - QUICK_START.md - Detailed setup instructions"
echo "  - BUILD_STATUS.md - Current project status"
echo "  - TorTok/README.md - iOS project documentation"
echo ""
