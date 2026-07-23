#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p dist
bun run build:cli
bash packages/app/scripts/bundle.sh "$ROOT/dist/OreoDeck.app"
echo "Built: dist/oreodeck, dist/ord, dist/OreoDeck.app"
