#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Usage: ./scripts/release.sh X.Y.Z [--publish]" >&2; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] || { echo "Release must run from main." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree must be clean." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && { echo "Tag v$VERSION already exists." >&2; exit 1; }
PUBLISH=false
[[ "${2:-}" == "--publish" ]] && PUBLISH=true
[[ -z "${2:-}" || "$PUBLISH" == true ]] || { echo "Unknown option: ${2:-}" >&2; exit 1; }
if [[ "$PUBLISH" == true ]]; then
  command -v gh >/dev/null || { echo "gh CLI is required to publish." >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "GitHub CLI is not authenticated. Run: gh auth login" >&2; exit 1; }
fi
NOTES_FILE="$(mktemp)"
cleanup() { rm -f "$NOTES_FILE"; }
trap cleanup EXIT
CURRENT="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
if [[ "$CURRENT" != "$VERSION" ]]; then
  python3 - "$CURRENT" "$VERSION" <<'PY'
import sys
current = tuple(map(int, sys.argv[1].split(".")))
requested = tuple(map(int, sys.argv[2].split(".")))
if requested <= current:
    raise SystemExit(f"Requested version {sys.argv[2]} must be newer than {sys.argv[1]}.")
PY
  python3 scripts/bump-version.py "$VERSION"
fi
python3 scripts/roll-changelog.py "$VERSION" > "$NOTES_FILE"
bun install
./scripts/build.sh
./scripts/sign.sh
./scripts/notarize.sh
./scripts/package-release.sh "$VERSION"
git add \
  package.json bun.lock \
  packages/cli/package.json packages/cli/src/version.ts \
  packages/core/package.json packages/contract-fixtures/package.json \
  packages/core-rs/Cargo.toml packages/core-rs/Cargo.lock \
  packages/app/Sources/CcmUI/AppModel.swift CHANGELOG.md
if ! git diff --cached --quiet; then
  git commit -m "release: $VERSION"
fi
if [[ "$PUBLISH" == true ]]; then
  ARCH="${OREODECK_RELEASE_ARCH:-$(uname -m)}"
  git tag "v$VERSION"
  git push origin "v$VERSION"
  gh release create "v$VERSION" \
    "dist/oreodeck-$VERSION-macos-$ARCH.zip" \
    "dist/oreodeck-$VERSION-macos-$ARCH.zip.sha256" \
    "dist/oreodeck-macos-$ARCH.zip" \
    "dist/oreodeck-macos-$ARCH.zip.sha256" \
    "dist/oreodeck-version.txt" \
    --title "OreoDeck $VERSION" --notes-file "$NOTES_FILE"
  git push origin HEAD:main
else
  echo "Artifacts and release commit are ready. Re-run with --publish after reviewing them."
fi
