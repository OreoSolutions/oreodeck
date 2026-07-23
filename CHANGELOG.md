# Changelog

All notable changes to OreoDeck are documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-07-23

### Added

- Added project-local profile selection through `.oreodeck/config.json` and
  `ord use --project <profile>`, with explicit `-P` retaining highest priority.

### Changed

- `ord sessions` now defaults to the current project folder; use `--all` to
  browse sessions from every project.

### Fixed

- Auto-update now preserves the existing UI and shell-integration choices, so
  it asks only once for update confirmation instead of repeating installer
  questions.
- Automatic update discovery now also runs for the bare command and refreshes
  its release cache every 15 minutes.

## [0.1.3] - 2026-07-23

### Changed

- Made the sidebar update card easier to discover with a navigation indicator
  and a complete accessibility label.

## [0.1.2] - 2026-07-23

### Added

- Added per-profile status-line sharing while preserving isolated settings.
- Added a clickable version and update-status card to the sidebar footer.
- Install and uninstall now print the exact shell refresh command whenever
  they modify OreoDeck integration in `~/.zshrc`.

## [0.1.1] - 2026-07-23

### Added

- Added Vietnamese and Simplified Chinese README, contribution, and security
  documentation.
- Added Ko-fi sponsorship links to all README languages and the native Settings
  screen.

### Changed

- Restricted shared resources to MCP servers, skills, and plugins while
  retaining a cleanup path for legacy shared-resource metadata.
- Release packaging now verifies both versioned and stable archive checksums.
- Release automation now rolls `Unreleased` into versioned GitHub release notes
  automatically bumps all package/app versions, and skips test, lint, and
  format commands.
- The native installer now uses English exclusively and no longer prompts for
  a language.

### Fixed

- Synchronized the Bun lockfile with the OreoDeck CLI package and binary names.

## [0.1.0] - 2026-07-23

### Added

- Licensed the project under Apache-2.0 and added NOTICE, third-party license,
  trademark, security, and contribution documentation for public distribution.
- Introduced the OreoDeck product name, `oreodeck` command, and short `ord`
  alias.
- Added isolated subscription/OAuth and API-key profiles using dedicated
  `CLAUDE_CONFIG_DIR` directories.
- Added secure API-key storage through macOS Keychain with legacy OreoDeck/CCM
  compatibility.
- Added global profile selection, per-tab profile pinning, and one-run profile
  overrides with `-P` / `--profile`.
- Added shell integration that routes the regular `claude` command through the
  selected OreoDeck profile.
- Added interactive session discovery, import, and resume from global Claude or
  another profile with `ord sessions`.
- Added five-hour token usage summaries and estimated API cost reporting.
- Added configurable automatic failover order for rate-limited profiles.
- Added interactive shared-resource selection with keyboard navigation and
  safe conflict handling.
- Added selective sharing for MCP servers, skills, plugins, commands, agents,
  status line configuration, and other allowlisted Claude resources.
- Added backup and restore behavior when a local profile resource is forcibly
  replaced by a managed shared resource.
- Added a native macOS 15 SwiftUI dashboard with Profiles, Usage, Failover,
  CLI & Tools, and Settings sections.
- Added a menu-bar popover with profile status and dashboard shortcuts.
- Added terminal selection for Terminal.app, Ghostty, iTerm2, WezTerm,
  Alacritty, Kitty, Warp, Hyper, Tabby, Rio, and Wave Terminal.
- Added explicit window-only warnings for terminal apps that cannot reliably
  receive a dynamic command.
- Added optional UI installation and management through `ord ui`.
- Added a bilingual English/Vietnamese `install.sh`, with English selected by
  default.
- Added complete uninstall support for the app, app backups, CLI, UI payload,
  and shell integration while preserving profiles by default.
- Added `ord uninstall --purge` for permanent removal of profiles, sessions,
  configuration, and stored API keys.
- Added the OreoDeck cookie/deck application icon and visual identity.

### Security

- Profile names are validated before they are used in filesystem paths or
  terminal commands.
- API keys never pass through command-line arguments and are not written to
  OreoDeck configuration files.
- Shared resources avoid sharing OAuth credentials or complete Claude state
  files.
- Filesystem updates use atomic writes and cross-process locking where profile
  configuration could otherwise be corrupted.

### Compatibility

- Existing `~/.ccm` data and legacy `CCM_*` environment variables remain
  supported during the OreoDeck migration.
- Legacy Keychain entries under `com.oreo.ccm` remain readable and removable.

[Unreleased]: https://github.com/OreoSolutions/oreodeck/compare/v0.1.4...HEAD
[0.1.0]: https://github.com/OreoSolutions/oreodeck/releases/tag/v0.1.0
[0.1.1]: https://github.com/OreoSolutions/oreodeck/releases/tag/v0.1.1
[0.1.2]: https://github.com/OreoSolutions/oreodeck/releases/tag/v0.1.2
[0.1.3]: https://github.com/OreoSolutions/oreodeck/releases/tag/v0.1.3
[0.1.4]: https://github.com/OreoSolutions/oreodeck/releases/tag/v0.1.4
