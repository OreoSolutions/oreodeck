---
name: oreodeck
description: Show the current OreoDeck profile, profile-selection source, Claude account identity, configuration directory, model setting, MCP count, working directory, and installed versions. Use when the user invokes /oreodeck or asks which OreoDeck or Claude account/profile the current session is using.
---

<!-- managed-by: oreodeck -->

# OreoDeck identity

Run `ord identity --json` with the Bash tool. Do not read raw Claude state,
settings, Keychain entries, environment secrets, tokens, or API keys.

Present the returned allow-listed fields in a compact status table. Include:

- OreoDeck version, profile, profile kind, and selection source
- Claude version, login method, organization, and email when available
- working directory and isolated config directory
- configured model, MCP server count, and setting sources

If a field is `null`, display `—`. Never infer or expose credentials. Mention
that Claude's built-in `/status` remains the source for live session ID,
connection health, usage, and runtime model details that OreoDeck cannot read.
