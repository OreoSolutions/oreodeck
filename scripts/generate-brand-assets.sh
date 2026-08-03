#!/usr/bin/env bash
set -euo pipefail

readonly root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly brand_dir="$root_dir/assets/brand"
readonly generated_dir="$brand_dir/generated"
readonly resources_dir="$root_dir/packages/app/Resources"
readonly mark_svg="$brand_dir/oreodeck-layered-bloom-mark.svg"
readonly lockup_svg="$brand_dir/oreodeck-layered-bloom-lockup.svg"

for tool in rsvg-convert magick iconutil; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

mkdir -p "$generated_dir"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

mark_png="$generated_dir/oreodeck-mark-1024.png"
app_png="$resources_dir/OreoDeck.png"
lockup_png="$work_dir/oreodeck-lockup.png"
iconset_dir="$work_dir/OreoDeck.iconset"

rsvg-convert "$mark_svg" --width 1024 --height 1024 --output "$mark_png"
cp "$mark_png" "$app_png"

rsvg-convert "$lockup_svg" --width 1024 --height 320 --output "$lockup_png"
magick -size 1200x630 xc:'#292321' "$lockup_png" -gravity center -compose over -composite "$generated_dir/oreodeck-social-1200x630.png"

mkdir -p "$iconset_dir"
render_icon() {
  local pixels="$1"
  local name="$2"
  magick "$app_png" -resize "${pixels}x${pixels}" "$iconset_dir/$name"
}
render_icon 16 icon_16x16.png
render_icon 32 icon_16x16@2x.png
render_icon 32 icon_32x32.png
render_icon 64 icon_32x32@2x.png
render_icon 128 icon_128x128.png
render_icon 256 icon_128x128@2x.png
render_icon 256 icon_256x256.png
render_icon 512 icon_256x256@2x.png
render_icon 512 icon_512x512.png
render_icon 1024 icon_512x512@2x.png
iconutil -c icns "$iconset_dir" -o "$resources_dir/OreoDeck.icns"

echo "Generated Layered Bloom brand assets."
