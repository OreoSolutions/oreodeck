#!/usr/bin/env bash
set -euo pipefail

readonly app_png="packages/app/Resources/OreoDeck.png"
readonly app_icns="packages/app/Resources/OreoDeck.icns"
readonly transparent_mark="assets/brand/generated/oreodeck-mark-transparent-1024.png"
readonly social_image="assets/brand/generated/oreodeck-social-1200x630.png"

for file in "$app_png" "$app_icns" "$transparent_mark" "$social_image"; do
  test -f "$file"
done

test "$(sips -g pixelWidth -g pixelHeight "$app_png" | awk '/pixel/{print $2}' | tr '\n' ' ')" = "1024 1024 "
test "$(magick identify -format '%wx%h' "$transparent_mark")" = "1024x1024"
test "$(magick identify -format '%wx%h' "$social_image")" = "1200x630"

iconset_dir="$(mktemp -d)/OreoDeck.iconset"
trap 'rm -rf "${iconset_dir%/OreoDeck.iconset}"' EXIT
iconutil -c iconset "$app_icns" -o "$iconset_dir"

for file in \
  icon_16x16.png icon_16x16@2x.png icon_32x32.png icon_32x32@2x.png \
  icon_128x128.png icon_128x128@2x.png icon_256x256.png icon_256x256@2x.png \
  icon_512x512.png icon_512x512@2x.png; do
  test -f "$iconset_dir/$file"
done

for readme in README.md README.vi.md README.zh-CN.md; do
  rg -q 'assets/brand/generated/oreodeck-mark-transparent-1024.png' "$readme"
  ! rg -q 'packages/app/Resources/OreoDeck.png' "$readme"
done
rg -q 'A companion for Claude Code' docs/brand/website-handoff.md

echo "Brand asset contract passed."
