#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-$(bun -e 'console.log((await Bun.file("package.json").json()).version)')}"
ARCH="${OREODECK_RELEASE_ARCH:-$(uname -m)}"
NAME="oreodeck-$VERSION-macos-$ARCH"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for item in dist/oreodeck dist/ord dist/OreoDeck.app; do
  [[ -e "$item" ]] || { echo "Missing $item; build, sign and notarize first." >&2; exit 1; }
done
mkdir -p "$STAGE/$NAME/dist"
install -m 755 dist/oreodeck "$STAGE/$NAME/dist/oreodeck"
install -m 755 dist/ord "$STAGE/$NAME/dist/ord"
ditto dist/OreoDeck.app "$STAGE/$NAME/dist/OreoDeck.app"
cp install.sh install.command README.md LICENSE NOTICE THIRD_PARTY_NOTICES.md TRADEMARKS.md "$STAGE/$NAME/"
cp -R LICENSES "$STAGE/$NAME/LICENSES"
rm -f "dist/$NAME.zip" "dist/$NAME.zip.sha256"
ditto -c -k --sequesterRsrc --keepParent "$STAGE/$NAME" "dist/$NAME.zip"
(cd dist && shasum -a 256 "$NAME.zip" > "$NAME.zip.sha256")
cp "dist/$NAME.zip" "dist/oreodeck-macos-$ARCH.zip"
(cd dist && shasum -a 256 "oreodeck-macos-$ARCH.zip" > "oreodeck-macos-$ARCH.zip.sha256")
echo "Created versioned and stable release ZIPs in dist/."
