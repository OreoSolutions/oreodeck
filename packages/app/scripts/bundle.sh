#!/usr/bin/env bash
# One command from a clean checkout to a runnable OreoDeck.app.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
BUNDLE="${1:-$ROOT_DIR/dist/OreoDeck.app}"
VERSION="$(cd "$ROOT_DIR" && bun -e 'console.log((await Bun.file("package.json").json()).version)')"

"$APP_DIR/scripts/generate.sh"

cd "$APP_DIR"
swift build -c release

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$APP_DIR/.build/release/CcmApp" "$BUNDLE/Contents/MacOS/OreoDeck"
cp "$APP_DIR/Resources/OreoDeck.icns" "$BUNDLE/Contents/Resources/OreoDeck.icns"
cp "$APP_DIR/../../LICENSE" "$BUNDLE/Contents/Resources/LICENSE.txt"
cp "$APP_DIR/../../NOTICE" "$BUNDLE/Contents/Resources/NOTICE.txt"
cp "$APP_DIR/../../THIRD_PARTY_NOTICES.md" "$BUNDLE/Contents/Resources/THIRD_PARTY_NOTICES.md"
mkdir -p "$BUNDLE/Contents/Resources/LICENSES"
cp "$APP_DIR/../../LICENSES/"*.txt "$BUNDLE/Contents/Resources/LICENSES/"

cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>OreoDeck</string>
    <key>CFBundleDisplayName</key>
    <string>OreoDeck</string>
    <key>CFBundleIdentifier</key>
    <string>com.oreo.oreodeck</string>
    <key>CFBundleExecutable</key>
    <string>OreoDeck</string>
    <key>CFBundleIconFile</key>
    <string>OreoDeck</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>LSMinimumSystemVersion</key>
    <string>15.0</string>
    <!-- Menu-bar agent: no Dock icon, no App Switcher entry. -->
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

echo "bundle: $BUNDLE"
