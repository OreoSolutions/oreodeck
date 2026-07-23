# OreoDeck

English | [Tiếng Việt](README.vi.md) | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-15%2B-black.svg)](https://www.apple.com/macos/)
[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/nguyenhuyquang)

<p align="center">
  <img src="packages/app/Resources/OreoDeck.png" alt="OreoDeck logo" width="128">
</p>

<p align="center">
  A macOS app and CLI for managing multiple isolated Claude Code profiles.
</p>

OreoDeck lets you run multiple Claude accounts side by side, pin a profile to
one terminal tab, monitor usage, move sessions between profiles, share selected
global resources, and fail over when an account reaches its usage limit.

The full command is `oreodeck`; `ord` is the shorter alias. Both provide the
same functionality.

## Highlights

- Isolated Claude Code profiles powered by a separate `CLAUDE_CONFIG_DIR` for
  every account.
- Subscription/OAuth and API-key profiles, with API keys stored in macOS
  Keychain rather than configuration files.
- Global, per-tab, and one-command profile selection.
- Interactive session picker for importing and resuming conversations from
  global Claude or another profile.
- Selective sharing for MCP servers, skills, plugins, and the Claude status
  line without sharing credentials or the complete settings file.
- Five-hour token usage and estimated API cost summaries.
- Configurable automatic failover order.
- Native SwiftUI dashboard and menu-bar app.
- Terminal integrations for Terminal.app, Ghostty, iTerm2, WezTerm, Alacritty,
  Kitty, Warp, Hyper, Tabby, Rio, and Wave Terminal.
- English-language native installer with interactive CLI, UI, and shell setup.

## Requirements

- macOS 15 or later for the desktop app.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and
  available on `PATH`.
- A full OreoDeck Release package requires no Bun, Rust, or Xcode installation.
- Building from source requires Bun, Rust/Cargo, Swift 6, and Xcode Command Line
  Tools.

## Install from a release

Install the latest signed release directly, without downloading it manually:

```bash
curl -fsSL https://raw.githubusercontent.com/OreoSolutions/oreodeck/main/install.sh | bash
```

The bootstrap installer downloads the stable asset for the current Mac
architecture, verifies its published SHA-256 checksum, then runs the bundled
native installer. Alternatively, download and extract the complete release
archive and run:

```bash
./install.sh
```

The installer runs in English and asks whether to install the optional desktop
app and whether the `claude` command should automatically route through
OreoDeck.

Finder users can double-click `install.command`; it invokes the same installer
and keeps the window open so the result remains visible.

The installer places:

- `oreodeck` and `ord` in `~/.local/bin`.
- `OreoDeck.app` in `~/Applications` when the UI is selected.
- A reusable UI payload in `~/.local/share/oreodeck`.

If you initially install only the CLI, install the app later with:

```bash
ord ui install
ord ui open
```

## Quick start

Create a subscription profile and finish Claude login in the opened terminal:

```bash
oreodeck add work
```

Create an API-key profile:

```bash
oreodeck add automation --api-key
```

List profiles, choose the global default, and launch Claude:

```bash
ord list
ord use work
ord run
```

Override the profile for one invocation:

```bash
ord run -P personal
```

Arguments after `run` are forwarded to Claude Code:

```bash
ord run -P work -- --resume <session-id>
ord run -P automation -p "Summarize this repository"
```

## Use different profiles in different terminal tabs

Enable shell integration during installation, or add it manually:

```bash
oreodeck shell-init >> ~/.zshrc
source ~/.zshrc
```

Verify that `claude` is routed through OreoDeck:

```bash
type claude
```

Pin each tab independently:

```bash
# Tab 1
ord use --tab work
claude

# Tab 2
ord use --tab personal
claude
```

Profile resolution follows this order:

1. Explicit `-P` / `--profile` option.
2. Nearest project config at `.oreodeck/config.json`.
3. Profile pinned to the current tab with `ord use --tab`.
4. Global active profile selected with `ord use <name>`.

Set a default profile for the current project:

```bash
cd /path/to/project
ord use --project work
```

This creates `.oreodeck/config.json` containing `{ "profile": "work" }`.
Running `ord run` or the shell-integrated `claude` command anywhere below that
project uses `work`; `ord run -P personal` still overrides it for one run.

## Sessions

Pick a session for the current project folder from global Claude or another
profile, copy it into the destination profile, and resume it immediately:

```bash
ord sessions
```

Useful filters:

```bash
ord sessions --from global
ord sessions --from personal
ord sessions --list
ord sessions --all
ord sessions -P work
```

Use `--all` to browse other project folders. The picker excludes the destination
profile and subagent transcripts. Sessions
are copied on demand rather than sharing the entire history directory, keeping
profiles isolated.

## Shared resources

Configure shared resources interactively:

```bash
ord shared set work
```

Use the arrow keys to move, Space to select, and Enter to confirm. Configure
the same resources non-interactively with:

```bash
ord shared set work mcp skills plugins statusline.sh
ord shared show work
ord shared clear work
```

If the profile already owns a conflicting resource, OreoDeck refuses to replace
it by default. To explicitly back it up and create the managed link:

```bash
ord shared set work skills plugins --force --yes
```

Backups are stored under the profile's `.oreodeck-backups/shared` directory.

Sharing remains selective:

- Skills and plugin resources use managed symlinks.
- Plugin activation copies only `enabledPlugins` and
  `extraKnownMarketplaces` into the isolated settings file.
- MCP sharing copies only `mcpServers` into the isolated Claude state file.
- Status-line sharing links `statusline.sh` and copies only the `statusLine`
  field into the isolated profile settings file.
- OAuth credentials, API keys, projects, history, and unrelated settings remain
  private to each profile.
- Disabling sharing restores the profile's original configuration values.

## Usage and failover

Inspect the profile resolved for the current directory and its safe Claude
account identity fields:

```bash
ord identity
ord identity -P personal
ord identity --json
```

Every Claude session launched through OreoDeck also receives the managed
`/oreodeck` skill. Invoke it inside Claude to show the same profile, account,
model, MCP and settings summary. OAuth tokens, API keys and account UUIDs are
never included. Claude's built-in `/status` remains the source for live session
ID, connection health and runtime model details.

View Claude's account-level five-hour and weekly plan usage for each
subscription profile, plus local token/cost telemetry for API-key profiles:

```bash
ord status
```

Subscription percentages and exact reset timestamps come from the usage cache
written by Claude Code, so they include activity from Claude.ai, Desktop, IDEs,
and other Claude sessions on the same account. Run `/usage` inside Claude to
refresh that account's cache. OreoDeck displays the cache age instead of
presenting stale data as live.

Configure failover:

```bash
ord failover order work personal automation
ord failover on
ord failover show
ord failover off
```

Headless Claude runs can detect rate-limit output and retry with the next
profile automatically. Interactive runs ask for confirmation before carrying
the current session to another profile because an inherited TTY cannot be
scraped safely for a rate-limit message.

## Desktop app

The native SwiftUI app provides:

- A menu-bar profile overview.
- Profile creation, activation, removal, and session launching.
- Usage and estimated-cost dashboards.
- Failover configuration.
- Shared resource selection.
- Contextual CLI suggestions that can be copied or opened in a terminal.
- Terminal preference and integration testing.

Terminal.app, Ghostty, iTerm2, WezTerm, Alacritty, and Kitty can launch OreoDeck
commands directly. Warp, Hyper, Tabby, Rio, and Wave Terminal are available as
window-only integrations; OreoDeck shows a warning and the command must be run
manually inside the opened window.

Manage the optional app from the CLI:

```bash
ord ui install
ord ui open
ord ui remove
```

## Data and security

OreoDeck stores profiles under:

```text
~/.oreodeck/profiles/<profile-name>/
```

Existing installations using `~/.ccm` remain supported. Override the data
location with `OREODECK_HOME`; the legacy `CCM_HOME` variable is also accepted.

API keys use the macOS Keychain service `com.oreo.oreodeck`. Keys stored by the
legacy `com.oreo.ccm` service remain readable and removable for compatibility.

## Build from source

```bash
bun install
bun run build
```

Build outputs:

```text
dist/oreodeck
dist/ord
dist/OreoDeck.app
```

Run the test and quality suites:

```bash
bun run typecheck
bun run test
cargo test --manifest-path packages/core-rs/Cargo.toml
bun run test:app
bun run test:contract
bun run lint
bun run fmt:check
```

The CLI checks GitHub Releases at most once per day on interactive commands and
asks before installing. Use `ord update --check` for an explicit check or
`ord update` to download, verify and install an available release. Set
`OREODECK_DISABLE_UPDATE_CHECK=1` to disable automatic checks.

## Uninstall

Remove the app, app backups, CLI, cached UI payload, and shell integration while
keeping profiles:

```bash
ord uninstall
```

Permanently remove OreoDeck and all managed profiles, sessions, configuration,
and stored API keys:

```bash
ord uninstall --purge
```

`--purge` cannot be undone. Both commands ask for confirmation; use `--yes`
only in automation where the removal scope has already been reviewed.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Support OreoDeck

OreoDeck is free and open-source. If it saves you time, you can support its
continued development by [buying the author a coffee on Ko-fi](https://ko-fi.com/nguyenhuyquang). ☕

## License

Copyright 2026 OreoSolutions.

OreoDeck is open-source software licensed under the
[Apache License 2.0](LICENSE). It may be used, modified, and distributed,
including commercially, subject to the license terms. Apache-2.0 includes an
express patent grant from contributors and does not grant rights to project
trademarks.

Third-party components remain under their own licenses. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), the included
[license texts](LICENSES), and the [trademark policy](TRADEMARKS.md).

Contributions are accepted under Apache-2.0 as described in
[CONTRIBUTING.md](CONTRIBUTING.md).
