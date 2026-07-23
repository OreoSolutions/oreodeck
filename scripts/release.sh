#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Usage: ./scripts/release.sh X.Y.Z [--publish]" >&2; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] || { echo "Release must run from main." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree must be clean." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && { echo "Tag v$VERSION already exists." >&2; exit 1; }
NOTES_FILE="docs/releases/v$VERSION.md"
[[ -f "$NOTES_FILE" ]] || NOTES_FILE="CHANGELOG.md"
[[ -f "$NOTES_FILE" ]] || { echo "Missing release notes and CHANGELOG.md." >&2; exit 1; }
CURRENT="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
[[ "$CURRENT" == "$VERSION" ]] || { echo "package.json version $CURRENT does not match $VERSION." >&2; exit 1; }
bun install --frozen-lockfile
./scripts/build.sh
./scripts/sign.sh
./scripts/notarize.sh
./scripts/package-release.sh "$VERSION"
if [[ "${2:-}" == "--publish" ]]; then
  command -v gh >/dev/null || { echo "gh CLI is required to publish." >&2; exit 1; }
  ARCH="${OREODECK_RELEASE_ARCH:-$(uname -m)}"
  git tag "v$VERSION"
  git push origin "v$VERSION"
  gh release create "v$VERSION" \
    "dist/oreodeck-$VERSION-macos-$ARCH.zip" \
    "dist/oreodeck-$VERSION-macos-$ARCH.zip.sha256" \
    "dist/oreodeck-macos-$ARCH.zip" \
    "dist/oreodeck-macos-$ARCH.zip.sha256" \
    --title "OreoDeck $VERSION" --notes-file "$NOTES_FILE"
else
  echo "Artifacts ready. Re-run with --publish after reviewing them."
fi
