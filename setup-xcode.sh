#!/bin/bash

# TorTok Xcode Project Setup Script
# This script helps set up the Xcode project for first-time running

set -e

echo "🚀 TorTok Xcode Setup"
echo "===================="
echo ""

# Check if Xcode is installed
if ! command -v xcodebuild &> /dev/null; then
    echo "❌ Error: Xcode is not installed or xcode-select is not configured"
    echo "   Install Xcode from the App Store and run: sudo xcode-select --switch /Applications/Xcode.app"
    exit 1
fi

echo "✅ Xcode found: $(xcodebuild -version | head -1)"
echo ""

# Navigate to project directory
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

echo "📁 Project directory: $PROJECT_DIR"
echo ""

# Check if TorTok directory exists
if [ ! -d "TorTok" ]; then
    echo "❌ Error: TorTok directory not found"
    exit 1
fi

echo "Creating Xcode project..."
echo ""

# Create Xcode project using xcodebuild
# Note: We'll create a minimal project that can be opened

cat > create-project.txt << 'EOF'

MANUAL SETUP INSTRUCTIONS:
==========================

Since we have a Swift Package Manager setup, follow these steps:

1. Open Xcode
2. File > New > Project
3. Select "iOS" > "App"
4. Click "Next"

5. Fill in:
   Product Name: TorTok
   Team: Your Apple ID
   Organization Identifier: com.tortok
   Bundle Identifier: com.tortok.TorTok
   Interface: SwiftUI
   Language: Swift
   ✓ Include Tests

6. Click "Next"
7. Save in: /Users/roberttaylor/Code/tortok
8. Click "Create"

9. After project is created:
   - Delete the default ContentView.swift (we have our own)
   - Drag all files from TorTok/ folder into project navigator
   - Add Swift Package Dependencies:
     * Alamofire: https://github.com/Alamofire/Alamofire
     * Kingfisher: https://github.com/onevcat/Kingfisher
     * GRDB: https://github.com/groue/GRDB.swift

10. Replace Info.plist with our custom one
11. Build and Run!

EOF

cat create-project.txt

echo ""
echo "=========================================="
echo ""
echo "ALTERNATIVE: Quick SPM Project Open"
echo ""
echo "Run this command to open the Swift package in Xcode:"
echo ""
echo "  cd TorTok && open Package.swift"
echo ""
echo "Note: This works for development but won't create a runnable iOS app"
echo "For a runnable app, follow the manual instructions above."
echo ""

# Ask user what they want to do
echo "What would you like to do?"
echo "1) Open Package.swift in Xcode (quick, for code editing)"
echo "2) Show manual project creation steps again"
echo "3) Exit"
echo ""
read -p "Choice (1-3): " choice

case $choice in
    1)
        echo "Opening Package.swift in Xcode..."
        cd TorTok && open Package.swift
        ;;
    2)
        cat create-project.txt
        ;;
    3)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac
