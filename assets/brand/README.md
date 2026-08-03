# OreoDeck brand assets

`oreodeck-layered-bloom-mark.svg` is the canonical opaque Layered Bloom mark.
It depicts three rounded profile layers and an original six-petal companion
bloom. `oreodeck-layered-bloom-lockup.svg` is the dark-surface wordmark lockup.

Run `bash scripts/generate-brand-assets.sh` after changing either source. The
script regenerates all files in `assets/brand/generated/` and the checked-in
macOS app resources. Do not edit generated PNG or `.icns` files directly.

Use the opaque `oreodeck-mark-1024.png` wherever the square OreoDeck mark is
needed; use `oreodeck-social-1200x630.png` for social previews. The product
descriptor is `A companion for Claude Code`. The bloom is OreoDeck-original:
do not add Anthropic's logo or wordmark, or wording that implies official
affiliation.
