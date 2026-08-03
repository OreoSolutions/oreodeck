# OreoDeck Companion Brand Rebrand Design

## Goal

Replace the current photorealistic cookie icon with a clear, contemporary
identity for OreoDeck: an independent macOS and CLI companion for Claude Code
profile management. The identity may feel compatible with a Claude Code
workflow, but must not suggest that OreoDeck is made, endorsed, or operated by
Anthropic.

## Chosen direction: Companion Deck

The mark is a pair of rounded profile cards offset into a compact, readable
stack. Their central negative space forms an `O`; a small amber dot denotes the
active profile. This makes the profile-isolation and profile-selection mechanism
legible without relying on a cookie illustration, terminal glyph, or a borrowed
Claude/Anthropic mark.

The primary palette is charcoal `#181614`, terracotta `#D46C4E`, coral
`#F2A07C`, cream `#FFF4EA`, and amber `#FFCF8B`. Charcoal is the app-icon field;
terracotta is the main front card; cream forms the `O`; amber is reserved for
the state dot. The logo remains flat with restrained depth only where needed to
separate the cards. It must read at 16 px, rather than depend on texture or
fine internal detail.

## Asset system and applications

- Create a canonical editable SVG and a 1024 px app-icon master.
- Derive the macOS application PNG and `.icns` from that master; retain an
  opaque charcoal rounded-square app icon for reliable Dock appearance.
- Provide a transparent horizontal logo and a square social/avatar mark for
  GitHub, README, release material, and the website.
- Update the app-repository README artwork and any icon references in this
  checkout. Use the descriptor `A companion for Claude Code` in prose or a
  lockup, never inside the core `OreoDeck` wordmark.
- Apply the same files and lockup to the separate website checkout after the
  app-repository assets are approved; that checkout is intentionally out of
  this repository's write scope.

## Non-goals and guardrails

This rebrand does not change profile behavior, app UI layout, package names, or
the `oreodeck`/`ord` commands. It does not use Anthropic's logo, wordmark, or
claim an official relationship. Existing unrelated README, package metadata,
and Settings changes remain outside the rebrand commit.

## Acceptance checks

- Inspect the app icon at 16, 32, 128, 512, and 1024 px on light and dark
  surroundings; the `O` and active dot must remain distinguishable.
- Inspect transparent marks over light and dark README/website backgrounds.
- Verify the `.icns` contains the expected icon sizes and rebuild the app bundle
  to confirm the new icon is packaged.
- Run the relevant image/asset checks, `git diff --check`, and review only the
  rebrand file list before handing off the separate website update.
