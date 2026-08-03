# Direct subscription usage sync design

## Goal

Let OreoDeck verify the login state and read current rate-limit data for each
subscription profile without waiting for an active Claude Code response or
presenting a stale local usage cache as live data.

This is explicitly experimental. It uses the same Claude OAuth usage route
documented by CodexBar, not an Anthropic public API contract.

## Scope

This release changes subscription profiles only. API-key and gateway profiles
retain their local transcript telemetry and existing gateway connection checks.

It adds:

- an opt-in application setting: `Direct subscription usage sync (experimental)`;
- an individually visible login state for every subscription profile;
- direct five-hour, weekly, model-scoped, and (when provided) extra-usage data;
- `Refresh now` and `Login again` actions; and
- a clearly labelled fallback to the existing status-line snapshot or Claude
  usage cache.

It does not add browser-cookie import, browser automation, a hidden Claude
PTY, automatic re-login, or any request that sends a prompt.

## User experience

### Sync off

Subscription cards retain the current local/cache-backed display. Their login
row reads `Direct sync is off` with a Settings action. OreoDeck must not infer
that the account is connected merely because cached usage exists.

### Sync on

Each subscription profile exposes a compact, independent state:

| State | Meaning | Action |
| --- | --- | --- |
| `Connected` | The direct OAuth request succeeded. | `Refresh now` |
| `Checking` | A request for this profile is in flight. | Disabled refresh |
| `Needs sign in` | The selected profile has no usable credential, its token is expired, or Anthropic returned 401/403. | `Login again` |
| `Rate limited` | Anthropic returned 429. | Retry after the supplied retry time or manual refresh |
| `Cannot verify` | Network, timeout, malformed response, unsupported credential storage, or another non-auth failure. | `Refresh now` |

Only `Connected` is a successful authentication signal. The UI shows when that
direct result was received. A former successful value may remain as a separate
`Last live result` with its timestamp, but it must never retain a Connected
badge after a later auth failure.

`Login again` opens `oreodeck run -P <profile>` in the user's configured
terminal. That command pins Claude Code to the existing profile directory; the
user completes `/login` in the opened terminal. OreoDeck does not automate the
command, inspect its terminal output, or mutate credentials. After the user
returns, `Refresh now` (and the normal surface refresh) verifies the account.

### Usage and money

The successful direct result is the live source for five-hour, weekly, and
model-scoped quota windows. If Anthropic returns `extra_usage`, OreoDeck shows
the returned current spend and plan limit as subscription overage data. It does
not invent per-token dollars for the included Pro/Max plan.

The Usage tab and selected subscription-profile card use the same source label:
`Live`, `Last live result`, `Claude cache`, or `Unavailable`.

## Data flow and boundaries

```text
Selected subscription profile
  -> profile-scoped Claude OAuth credential reader
  -> GET https://api.anthropic.com/api/oauth/usage
  -> display-safe SubscriptionUsageSyncView
  -> Rust UniFFI boundary
  -> AppModel per-profile transient state
  -> Profiles and Usage views
```

The Rust core owns the network call and credential access. The credential reader
must resolve only the selected profile's Claude Code credential source for its
`CLAUDE_CONFIG_DIR`; it must not fall back to the user's ambient global profile
or another OreoDeck profile. It may read an existing system Keychain item only
when that item is positively attributable to the selected profile. If the
installed Claude Code version offers no safe profile-scoped source, return
`Cannot verify` rather than guessing.

The FFI record contains only display-safe fields: state, quota percentages,
reset timestamps, optional extra-usage spend/limit, timestamp, retry hint, and
human-safe message. It never contains an OAuth token, authorization header,
credential path, response body, organization ID, email, or raw transport
error.

## Polling and failure policy

- Direct sync is off by default and requires an explicit Settings toggle.
- While at least one OreoDeck surface is visible, each subscription profile is
  polled at most once per two minutes; no background daemon runs after all
  surfaces close.
- `Refresh now` is allowed once per 15 seconds per profile. A single in-flight
  request is coalesced rather than duplicated.
- Requests use a 10-second timeout and bounded response size.
- On 401/403, stop automatic polling for that profile and show `Needs sign in`.
  Polling resumes only after the user chooses `Refresh now` or `Login again`.
- On 429, respect `Retry-After` when present and do not issue another automatic
  request before that time.
- On transport or decoding failure, use exponential backoff. Existing
  cache/status-line data remains visible only under its own non-live label.

No token is persisted, copied to Swift, emitted in telemetry, written to logs,
or included in an error message. The request is one read-only GET with the
required OAuth headers; OreoDeck never scrapes claude.ai cookies or pages.

## Implementation boundaries

1. Add a small Rust `subscription_usage` module with injectable HTTP and
   credential-reader seams, then expose one safe per-profile operation through
   UniFFI.
2. Extend the Swift backend protocol and `AppModel` with per-profile transient
   sync state, visibility-aware cadence, cancellation, and retry gating.
3. Add the opt-in setting, login-state row, labels, and actions to the existing
   subscription profile detail and Usage cards. Keep the established direct
   token/cost view for API-key and gateway profiles unchanged.
4. Reuse the existing `openSession(name:)` operation for `Login again`; do not
   reuse `openLoginTerminal(name:)`, because that existing operation invokes
   `oreodeck add <name>` for creating a new profile.

## Verification

- Rust tests: credential attribution, no ambient-profile fallback, OAuth
  response mapping, redaction, 401/403/429/timeout handling, timeout and
  response-size limits, and no duplicate requests.
- Swift model tests: opt-in default, visibility-aware polling, per-profile
  cadence/backoff, retry gating, auth-state transitions, and `Login again`
  opening only the selected existing profile.
- SwiftUI tests: every state is visible and distinguishable; stale cache data
  cannot render as Live; action labels and disabled states are accessible.
- Visual render: multiple subscription profiles with mixed Connected, Needs
  sign in, and Cannot verify states at the dashboard's minimum height.
- Full Rust and Swift suites plus release bundle build. A manual smoke test on
  two real subscription profiles remains required before release; no test may
  print or retain a real OAuth credential.

## Non-goals

- Guaranteeing Anthropic will keep the internal OAuth endpoint available.
- Claiming included subscription usage has a token-priced dollar cost.
- Reading another profile's credential, browser cookies, or terminal output.
- Automatic account switching or automatic re-authentication.
