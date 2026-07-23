#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDENTITY="${CODESIGN_ID:-${OREODECK_SIGN_IDENTITY:-}}"
[[ -n "$IDENTITY" ]] || { echo "Set CODESIGN_ID to a Developer ID Application identity." >&2; exit 1; }
for binary in "$ROOT/dist/oreodeck" "$ROOT/dist/ord"; do
  [[ -x "$binary" ]] || { echo "Missing $binary; run ./scripts/build.sh first." >&2; exit 1; }
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$binary"
  codesign --verify --strict --verbose=2 "$binary"
done
APP="$ROOT/dist/OreoDeck.app"
[[ -d "$APP" ]] || { echo "Missing $APP; run ./scripts/build.sh first." >&2; exit 1; }
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "Signed and verified dist artifacts."
