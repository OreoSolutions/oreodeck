# Calm Control Center Dashboard Design

## Goal

Refresh the complete OreoDeck macOS dashboard so developers can scan the state
of their Claude Code profiles, act on the selected profile, and understand
gateway compatibility without navigating a dense set of unrelated controls.

## Scope

The redesign covers the persistent sidebar and the Profiles, Usage, Failover,
CLI & Tools, and Settings tabs. It also improves the gateway profile workflow:
users can see its normalized URL and model aliases, and can explicitly check
whether its `/models` endpoint is reachable before starting a Claude Code
session.

Existing profile storage, Keychain boundaries, terminal integration, usage
calculation, and failover behavior remain unchanged. The redesign must not
invent provider capabilities or show a successful gateway state without a
successful response.

## Direction: Calm Control Center

This is an **Operate** surface. It combines a compact control-center layout
for frequent scanning with guided cards for configuration and recovery.

### Visual system

- Preserve the OreoDeck/Claude Code companion identity: charcoal foundations,
  a restrained terracotta primary accent, warm cream surfaces, and semantic
  green/amber/red feedback.
- Keep macOS-native controls and system typography. Brand expression appears
  in the sidebar identity, section icons, selected states, action hierarchy,
  and cards rather than decorative illustration.
- Use one elevated card language with consistent corner radii, borders, and
  spacing. Information-dense tables stay tables; configuration and explanation
  use cards.

### Sidebar

- Establish a clearer visual hierarchy: logo/identity first, five sections in
  the middle, then connection and update status at the bottom.
- The selected item uses a terracotta-tinted state and a slim leading marker;
  unselected items stay quiet.
- CLI readiness and update state remain visible but compact, and never compete
  with primary navigation.

### Common tab grammar

Every tab follows the same order: page header with a single primary action,
compact facts relevant to that tab, the primary working surface, then guided
help/recovery only when it is useful. Empty, loading, warning, and error
states use the same component vocabulary.

### Profiles

- Keep the table for scanning many profiles, but enrich its selected state
  with a detail card below it.
- The detail card identifies the selected profile type, active status, recent
  usage, and the next relevant action.
- For a gateway profile it also shows the endpoint, four Claude-family mapping
  slots, and a connection check. The check reports one of: not checked,
  checking, connected with discovered model count, unauthorized, unreachable,
  or an unexpected response. It must not reveal API keys.
- Replace the generic action strip with a clear primary action (set active or
  open session) and grouped secondary/profile-management actions.
- Gateway creation and model mapping forms become guided sections: endpoint,
  credential, optional aliases, then a concise explanation that aliases must
  match a provider-advertised model ID.

### Usage and Failover

- Usage foregrounds the selected/active profile and separates plan allowance,
  reset timing, token/cost telemetry, and empty telemetry states.
- Failover makes the enabled/disabled state, ordered fallback list, and the
  consequence of reordering immediately legible. Destructive changes continue
  to require the existing confirmation behavior.

### CLI & Tools and Settings

- CLI & Tools groups commands by task: launch and routing, dashboard setup,
  and maintenance. Commands remain copyable and descriptions remain factual.
- Settings uses a clear account/app-status hierarchy, update state, and
  external/support links without making them visually louder than the app's
  profile operations.

## Gateway connection data flow

1. The selected gateway profile requests a one-off check from the UI.
2. The native backend reads the profile's gateway URL and Keychain token within
   its existing secret boundary.
3. It requests the provider's OpenAI-style `${baseURL}/models` endpoint using
   the stored bearer token when one exists.
4. The backend returns a display-safe result: endpoint reachability, HTTP
   category, and the number of distinct advertised model IDs. Model IDs are
   shown only as user-visible provider metadata, never treated as an automatic
   mapping.
5. A failed check leaves existing profile configuration untouched and surfaces
   an actionable message. A check never launches Claude Code or sends a model
   completion request.

## Accessibility and interaction requirements

- All status uses text plus colour and an accessible label; colour alone never
  carries meaning.
- Buttons explain disabled state nearby where an action cannot run.
- The full sidebar row remains keyboard accessible and selected state is
  exposed to accessibility APIs.
- Text in profile rows and gateway cards truncates safely without hiding the
  profile name or current connection result.

## Verification

- Add focused Swift tests for status presentation and gateway result state,
  then demonstrate red-to-green before production code.
- Run the affected Swift tests, `bun run test`, `cargo test --manifest-path
  packages/core-rs/Cargo.toml`, `bun run typecheck`, and `bun run build:app`.
- Perform a native visual smoke test of the dashboard at its minimum window
  size with a subscription, API-key, and gateway profile, including each
  gateway connection result state.
- Update `CHANGELOG.md` under `Unreleased` with the gateway model-mapping and
  Calm Control Center dashboard improvements.

## Out of scope

- Changing provider model IDs automatically.
- Changing profile configuration semantics, credential storage, or failover
  policy.
- Altering the user-owned, uncommitted Layered Bloom logo assets.
