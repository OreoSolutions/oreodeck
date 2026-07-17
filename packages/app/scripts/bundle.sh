#!/usr/bin/env bash
# One command from a clean checkout to a runnable ccm.app.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$APP_DIR/scripts/generate.sh"

cd "$APP_DIR"
swift build -c release

BUNDLE="$APP_DIR/ccm.app"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$APP_DIR/.build/release/CcmApp" "$BUNDLE/Contents/MacOS/ccm"
cp "$APP_DIR/Resources/ccm.icns" "$BUNDLE/Contents/Resources/ccm.icns"

cat > "$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>ccm</string>
    <key>CFBundleDisplayName</key>
    <string>ccm</string>
    <key>CFBundleIdentifier</key>
    <string>com.oreo.ccm</string>
    <key>CFBundleExecutable</key>
    <string>ccm</string>
    <key>CFBundleIconFile</key>
    <string>ccm</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>15.0</string>
    <!-- Menu-bar agent: no Dock icon, no App Switcher entry. -->
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

echo "bundle: $BUNDLE"
