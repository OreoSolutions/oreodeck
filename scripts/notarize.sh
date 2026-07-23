#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${NOTARY_PROFILE:-${OREODECK_NOTARY_PROFILE:-oreodeck-notary}}"
APP="$ROOT/dist/OreoDeck.app"
UPLOAD="$ROOT/dist/OreoDeck-notarization.zip"
[[ -d "$APP" ]] || { echo "Missing $APP; build and sign first." >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$APP"
rm -f "$UPLOAD"
ditto -c -k --keepParent "$APP" "$UPLOAD"
xcrun notarytool submit "$UPLOAD" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=4 "$APP"
echo "Notarized and stapled $APP"
