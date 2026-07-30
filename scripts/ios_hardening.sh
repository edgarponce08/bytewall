#!/usr/bin/env bash
set -euo pipefail

echo "iOS hardening helper"
# Archive release
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive -archivePath ./build/App.xcarchive

# Export IPA (requires exportOptions.plist configured for your signing)
xcodebuild -exportArchive -archivePath ./build/App.xcarchive -exportOptionsPlist exportOptions.plist -exportPath ./build

echo "Reminder: Ensure code signing identities and entitlements are configured in CI. Use bitcode/off as appropriate and enable symbol stripping."
