#!/bin/bash

# TorTok - Create Xcode Project
# This script creates a proper Xcode iOS project for TorTok

set -e

echo "🚀 Setting up TorTok Xcode Project"
echo "=================================="
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

# Create TorTok.xcodeproj if it doesn't exist
if [ -d "TorTok/TorTok.xcodeproj" ]; then
    echo "⚠️  TorTok.xcodeproj already exists. Remove it? (y/n)"
    read -r response
    if [[ "$response" == "y" ]]; then
        rm -rf "TorTok/TorTok.xcodeproj"
        echo "✅ Removed existing project"
    else
        echo "Keeping existing project"
        exit 0
    fi
fi

# Create a temporary directory for the template project
TEMP_DIR=$(mktemp -d)
echo "📁 Creating project in temp directory: $TEMP_DIR"

cd "$TEMP_DIR"

# Use xcodegen to create project (if available) or fall back to manual creation
if command -v xcodegen &> /dev/null; then
    echo "✅ Using xcodegen to create project"

    # Create project.yml for xcodegen
    cat > project.yml << 'EOF'
name: TorTok
options:
  bundleIdPrefix: com.tortok
  deploymentTarget:
    iOS: 16.0

packages:
  Alamofire:
    url: https://github.com/Alamofire/Alamofire
    from: 5.8.0
  Kingfisher:
    url: https://github.com/onevcat/Kingfisher
    from: 7.0.0
  GRDB:
    url: https://github.com/groue/GRDB.swift
    from: 6.0.0

targets:
  TorTok:
    type: application
    platform: iOS
    deploymentTarget: "16.0"
    sources:
      - path: .
        excludes:
          - "*.md"
          - "Package.swift"
          - "Resources"
    resources:
      - Resources/Assets.xcassets
    info:
      path: Info.plist
      properties:
        CFBundleDisplayName: TorTok
        UILaunchScreen: {}
    dependencies:
      - package: Alamofire
      - package: Kingfisher
      - package: GRDB
        product: GRDB
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: com.tortok.TorTok
      DEVELOPMENT_TEAM: ""
      MARKETING_VERSION: "1.0"
      CURRENT_PROJECT_VERSION: "1"
      INFOPLIST_KEY_UIApplicationSceneManifest_Generation: YES
      INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents: YES
      INFOPLIST_KEY_UILaunchScreen_Generation: YES
      INFOPLIST_KEY_UISupportedInterfaceOrientations: UIInterfaceOrientationPortrait
      INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad: "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"
      SWIFT_VERSION: "5.9"
EOF

    # Generate project
    cd "$PROJECT_DIR/TorTok"
    xcodegen generate

    echo "✅ Project generated with xcodegen"

else
    echo "⚠️  xcodegen not found. Using manual project creation..."
    echo ""
    echo "Please install xcodegen for automatic project generation:"
    echo "  brew install xcodegen"
    echo ""
    echo "Or create the project manually:"
    echo "1. Open Xcode"
    echo "2. File > New > Project"
    echo "3. Choose iOS > App"
    echo "4. Product Name: TorTok"
    echo "5. Organization Identifier: com.tortok"
    echo "6. Interface: SwiftUI"
    echo "7. Language: Swift"
    echo "8. Save in: $PROJECT_DIR/TorTok"
    echo ""
    echo "Then run this script to configure the project."
    exit 1
fi

# Open the project in Xcode
if [ -f "$PROJECT_DIR/TorTok/TorTok.xcodeproj/project.pbxproj" ]; then
    echo ""
    echo "✅ Project created successfully!"
    echo ""
    echo "Opening in Xcode..."
    open "$PROJECT_DIR/TorTok/TorTok.xcodeproj"

    echo ""
    echo "📝 Next steps:"
    echo "1. Select your development team in Signing & Capabilities"
    echo "2. Choose an iPhone simulator"
    echo "3. Press ⌘R to build and run!"
    echo ""
else
    echo "❌ Failed to create project"
    exit 1
fi
