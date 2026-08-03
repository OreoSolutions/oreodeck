# Direct Subscription Usage Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, direct OAuth usage and login-status verification for each OreoDeck subscription profile.

**Architecture:** The Rust core reads only a selected profile's OAuth credential, makes a bounded read-only usage request, and returns a redacted UniFFI record. Swift keeps that result as transient per-profile state, schedules visibility-gated refreshes, and renders it in Profiles and Usage. `Login again` reuses the existing selected-profile session launcher so it never creates or overwrites a profile.

**Tech Stack:** Rust 2021, `ureq`, `serde_json`, UniFFI, Swift 6/SwiftUI, Swift Testing, ViewInspector.

## Global Constraints

- The OAuth usage endpoint is experimental and direct sync is off by default.
- Read credentials only for the requested profile; never use an ambient profile as a fallback.
- Never return, persist, log, or render OAuth credentials, headers, paths, response bodies, organization IDs, or emails.
- Use a read-only GET, a 10-second timeout, bounded response size, no browser cookies, and no CLI PTY.
- Poll only while a UI surface is visible: once per profile per two minutes; manual refresh is once per 15 seconds.
- Stop automatic polling after 401/403; honor 429 retry timing; never label cache data as Live.
- Do not stage or alter unrelated user files. The user explicitly authorizes committing the present logo-asset changes together with this feature.

---

### Task 1: Redacted OAuth usage core

**Files:**
- Create: `packages/core-rs/src/subscription_usage.rs`
- Modify: `packages/core-rs/src/lib.rs`
- Modify: `packages/core-rs/src/api.rs`
- Modify: `packages/core-rs/src/store.rs`
- Test: `packages/core-rs/src/subscription_usage.rs`

**Interfaces:**
- Consumes: `store::get_profile`, `store::profile_dir`, `ureq`, and selected profile names.
- Produces: `SubscriptionUsageSyncView { state, message, fetched_at_ms, retry_after_ms, five_hour_percent, five_hour_reset_at_ms, weekly_percent, weekly_reset_at_ms, extra_usage_spend_usd, extra_usage_limit_usd }`, `get_subscription_usage_sync(name: String)`, `get_direct_subscription_usage_sync_enabled()`, and `set_direct_subscription_usage_sync_enabled(enabled: bool)`.

- [ ] **Step 1: Write failing Rust tests for response and authentication mapping**

```rust
#[test]
fn unauthorized_response_is_needs_sign_in_without_exposing_a_token() {
    let result = usage_sync_from_response(401, "", 1_700_000_000_000, None);
    assert_eq!(result.state, "needs-sign-in");
    assert_eq!(result.message, "Sign in again to refresh this profile.");
    assert!(!result.message.contains("sk-ant-"));
}

#[test]
fn successful_response_maps_live_windows_and_extra_usage() {
    let result = usage_sync_from_response(200, fixture("oauth-usage.json"), 1_700_000_000_000, None);
    assert_eq!(result.state, "connected");
    assert_eq!(result.five_hour_percent, Some(37.0));
    assert_eq!(result.extra_usage_spend_usd, Some(2.5));
}
```

- [ ] **Step 2: Run the new Rust tests and verify RED**

Run: `cargo test --manifest-path packages/core-rs/Cargo.toml subscription_usage`

Expected: compilation failure because `subscription_usage` and `usage_sync_from_response` do not exist.

- [ ] **Step 3: Implement the pure parser and redacted result constructors**

```rust
pub fn usage_sync_from_response(
    status: u16, body: &str, now_ms: i64, retry_after_ms: Option<i64>,
) -> SubscriptionUsageSyncView {
    match status {
        200..=299 => parse_connected_usage(body, now_ms),
        401 | 403 => needs_sign_in(),
        429 => rate_limited(retry_after_ms),
        _ => cannot_verify("Claude returned an unexpected usage response."),
    }
}
```

Require finite percentages, RFC 3339 reset parsing, and only numeric
extra-usage fields. Malformed 2xx JSON returns `cannot-verify` with fixed
copy, never parser/response text.

- [ ] **Step 4: Run the focused Rust tests and verify GREEN**

Run: `cargo test --manifest-path packages/core-rs/Cargo.toml subscription_usage`

Expected: all new mapping and redaction tests pass.

- [ ] **Step 5: Add the selected-profile credential and HTTP seam**

```rust
fn subscription_usage_sync_with<R, H>(name: &str, read_credential: R, get: H) -> SubscriptionUsageSyncView
where
    R: FnOnce(&str) -> Result<String, CredentialReadError>,
    H: FnOnce(&str, &str) -> Result<HttpUsageResponse, ()>;
```

Read only a credential source belonging to `profile_dir(name)`. Reject a
non-subscription profile and a missing/unattributable credential with
`needs-sign-in`; do not inspect `~/.claude` or any other OreoDeck profile.
Use `ureq` with a 10-second timeout, `Authorization: Bearer`,
`anthropic-beta: oauth-2025-04-20`, bounded body read, and sanitised failures.
Export `get_subscription_usage_sync` through `api.rs` and `lib.rs`.

- [ ] **Step 6: Add the persisted experimental opt-in core setting**

```rust
const DIRECT_SUBSCRIPTION_USAGE_SYNC_KEY: &str = "directSubscriptionUsageSyncEnabled";

pub fn direct_subscription_usage_sync_enabled() -> Result<bool, StoreError> {
    Ok(load_config()?.extra.get(DIRECT_SUBSCRIPTION_USAGE_SYNC_KEY)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false))
}

pub fn set_direct_subscription_usage_sync_enabled(enabled: bool) -> Result<(), StoreError> {
    update_config(|config| {
        config.extra.insert(DIRECT_SUBSCRIPTION_USAGE_SYNC_KEY.into(), serde_json::Value::Bool(enabled));
        Ok(())
    })
}
```

Expose these through `api.rs`. Add a round-trip test proving an absent field
is false and unrelated forward-compatible config fields survive the write.

- [ ] **Step 7: Add credential-attribution, 429, timeout, and no-leak tests**

```rust
#[test]
fn a_missing_selected_profile_credential_never_uses_the_ambient_profile() {
    let result = subscription_usage_sync_with("work", |_| Err(CredentialReadError::Missing), unreachable_get);
    assert_eq!(result.state, "needs-sign-in");
}
```

Test a 429 with `Retry-After`, a network failure, a body larger than the cap,
and a token-containing HTTP error. Assert only fixed display copy crosses the
result.

- [ ] **Step 8: Run the complete Rust suite and commit**

Run: `cargo test --manifest-path packages/core-rs/Cargo.toml`

Expected: all tests pass.

```bash
git add packages/core-rs/src/lib.rs packages/core-rs/src/api.rs packages/core-rs/src/store.rs packages/core-rs/src/subscription_usage.rs
git commit -m "feat: probe subscription usage safely"
```

### Task 2: Generated binding and model scheduling

**Files:**
- Modify: `packages/app/Sources/CcmUI/Backend.swift`
- Modify: `packages/app/Sources/CcmUI/AppModel.swift`
- Modify: `packages/app/Tests/CcmUITests/FakeBackend.swift`
- Modify: `packages/app/Tests/CcmUITests/AppModelTests.swift`
- Generated: `packages/app/Sources/CcmKit/ccm_core.swift`

**Interfaces:**
- Consumes: `SubscriptionUsageSyncView`, `CcmBackend.getSubscriptionUsageSync(name:)`, `CcmBackend.getDirectSubscriptionUsageSyncEnabled()`, `CcmBackend.setDirectSubscriptionUsageSyncEnabled(enabled:)`, and existing `visibleSurfaces`.
- Produces: `AppModel.directSubscriptionUsageSyncEnabled`, `subscriptionUsageSyncs: [String: SubscriptionUsageSyncView]`, `refreshSubscriptionUsage(name:force:)`, and visibility-gated cadence state.

- [ ] **Step 1: Write failing Swift model tests**

```swift
@MainActor
@Test func directSubscriptionRefreshPublishesOnlyThatProfilesSafeState() async throws {
    let backend = FakeBackend()
    backend.set(subscriptionUsageSync: .connected(profile: "work"), for: "work")
    let model = AppModel(backend: backend)
    await model.refreshSubscriptionUsage(name: "work", force: true)
    #expect(model.subscriptionUsageSyncs["work"]?.state == "connected")
    #expect(model.subscriptionUsageSyncs["other"] == nil)
}

@MainActor
@Test func loginAgainOpensOnlyTheSelectedExistingProfile() async {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)
    await model.loginAgain(name: "work")
    #expect(backend.openSessionCalls == ["work"])
    #expect(backend.openLoginTerminalCalls.isEmpty)
}
```

- [ ] **Step 2: Run these tests and verify RED**

Run: `swift test --package-path packages/app --filter directSubscriptionRefreshPublishesOnlyThatProfilesSafeState`

Expected: compile failure because the new backend method and model properties do not exist.

- [ ] **Step 3: Regenerate UniFFI bindings and extend the backend seam**

Run: `bash packages/app/scripts/generate.sh`

Add `getSubscriptionUsageSync(name:)`,
`getDirectSubscriptionUsageSyncEnabled()`, and
`setDirectSubscriptionUsageSyncEnabled(enabled:)` to `CcmBackend`,
`LiveBackend`, and `FakeBackend`. Script fake results by canonical profile
name; no fake stores a credential.

- [ ] **Step 4: Implement per-profile direct-sync state and cadence**

```swift
public func refreshSubscriptionUsage(name: String, force: Bool = false) async {
    guard force || mayRefreshSubscription(name, nowMs: nowMs) else { return }
    subscriptionUsageSyncs[name] = .checking()
    let backend = backend
    let result = await Task.detached { try backend.getSubscriptionUsageSync(name: name) }
    subscriptionUsageSyncs[name] = safeResult(result)
}
```

Load the persisted opt-in value with every normal model snapshot and expose
`setDirectSubscriptionUsageSyncEnabled(_:)` as a write-through action. Only
schedule subscription rows after `load()` while `visibleSurfaces` is
nonempty. Enforce a 120-second normal cadence, 15-second manual gate,
single-flight behavior, 401/403 stop, Retry-After, and exponential transport
backoff. `loginAgain(name:)` calls the existing `openSession(name:)` method and
adds an informational action result; it never calls `openLoginTerminal`.

- [ ] **Step 5: Run focused model tests and verify GREEN**

Run: `swift test --package-path packages/app --filter Subscription`

Expected: the new transitions, gate, and selected-profile action pass along
with existing subscription tests.

- [ ] **Step 6: Commit model/binding work**

```bash
git add packages/app/Sources/CcmUI/Backend.swift packages/app/Sources/CcmUI/AppModel.swift packages/app/Tests/CcmUITests/FakeBackend.swift packages/app/Tests/CcmUITests/AppModelTests.swift
git commit -m "feat: refresh subscription usage by profile"
```

### Task 3: Opt-in settings and native UI states

**Files:**
- Modify: `packages/app/Sources/CcmUI/SettingsView.swift`
- Modify: `packages/app/Sources/CcmUI/ProfilesTab.swift`
- Modify: `packages/app/Sources/CcmUI/UsageTab.swift`
- Modify: `packages/app/Tests/CcmUITests/ProfilesTabViewTests.swift`
- Modify: `packages/app/Tests/CcmUITests/UsageTabViewTests.swift`
- Modify: `packages/app/Tests/CcmUITests/VisualRenderTests.swift`

**Interfaces:**
- Consumes: `AppModel.directSubscriptionUsageSyncEnabled`, `subscriptionUsageSyncs`, `refreshSubscriptionUsage`, and `loginAgain`.
- Produces: one reusable subscription-sync status row used in profile detail and Usage cards.

- [ ] **Step 1: Write failing view tests for states and actions**

```swift
@MainActor
@Test func subscriptionProfileRendersNeedsSignInAndLoginAgainAction() async throws {
    let tab = profileTabWithSync(state: .needsSignIn(profile: "work"))
    #expect(try tab.inspect().find(text: "Needs sign in").string() == "Needs sign in")
    #expect(try tab.inspect().find(button: "Login again").isDisabled() == false)
}

@MainActor
@Test func cachedSubscriptionUsageNeverRendersAsLive() throws {
    let view = usageTabWithSyncDisabled()
    #expect(throws: (any Error).self) { try view.inspect().find(text: "Live") }
    #expect(try view.inspect().find(text: "Claude cache").string() == "Claude cache")
}
```

- [ ] **Step 2: Run focused view tests and verify RED**

Run: `swift test --package-path packages/app --filter subscriptionProfileRendersNeedsSignInAndLoginAgainAction`

Expected: failure because the status row and action are absent.

- [ ] **Step 3: Implement the opt-in setting and reusable status row**

Bind the persisted Boolean setting from Task 2, defaulting to false. In
Settings, explain the experimental direct OAuth read
and link the state copy to the user controls. Implement one native SwiftUI row
for `Connected`, `Checking`, `Needs sign in`, `Rate limited`, and `Cannot
verify`, with an explicit source label (`Live`, `Last live result`, `Claude
cache`, or `Unavailable`).

- [ ] **Step 4: Add selected-profile and Usage-card integration**

Place the status row in the selected subscription profile detail, retaining
the gateway detail layout. Add the same condensed status/source row to Usage
cards. `Login again` runs `Task { await model.loginAgain(name: row.name) }`;
refreshes stay keyboard-accessible and show a disabled Checking state.

- [ ] **Step 5: Run view tests and visual rendering checks**

Run: `swift test --package-path packages/app --filter Subscription`

Run: `OREODECK_SUBSCRIPTION_SYNC_QA_PATH=/tmp/oreodeck-subscription-sync.png swift test --package-path packages/app --filter subscriptionUsageSyncVisualRender`

Expected: all focused tests pass and the render shows mixed Connected, Needs
sign in, and Cannot verify cards without clipping at 620px height.

- [ ] **Step 6: Commit UI work**

```bash
git add packages/app/Sources/CcmUI/SettingsView.swift packages/app/Sources/CcmUI/ProfilesTab.swift packages/app/Sources/CcmUI/UsageTab.swift packages/app/Tests/CcmUITests/ProfilesTabViewTests.swift packages/app/Tests/CcmUITests/UsageTabViewTests.swift packages/app/Tests/CcmUITests/VisualRenderTests.swift
git commit -m "feat: show subscription login status"
```

### Task 4: Release verification and authorized brand commit

**Files:**
- Modify/commit existing user-authorized brand paths under `assets/brand/`, `packages/app/Resources/OreoDeck.png`, and `scripts/`.
- Modify: `CHANGELOG.md` only if the release notes need a direct-sync entry.

**Interfaces:**
- Consumes: all three completed implementation tasks and existing brand scripts.
- Produces: a tested release bundle and one scope-checked commit of the already-present logo changes.

- [ ] **Step 1: Inspect every logo-asset diff before staging**

Run: `git diff -- assets/brand packages/app/Resources/OreoDeck.png scripts/check-brand-assets.sh scripts/generate-brand-assets.sh`

Expected: only the user-authorized Layered Bloom logo rebrand and its generated
outputs are included; stop and ask if any unrelated file appears.

- [ ] **Step 2: Run project verification**

Run: `cargo test --manifest-path packages/core-rs/Cargo.toml`

Run: `bun run test:app`

Run: `bun run build:app && plutil -lint dist/OreoDeck.app/Contents/Info.plist`

Run: `bash scripts/check-brand-assets.sh`

Expected: all suites, bundle validation, and brand asset checks pass.

- [ ] **Step 3: Inspect final scope and commit feature plus authorized logo work**

Run: `git status --short && git diff --check && git diff --cached --stat`

Stage only source/test/spec/plan files produced by this work plus the exact
brand paths authorized by the user. Commit with a conventional subject that
names both the direct subscription sync and completed rebrand. Do not push
unless the user separately requests it.

## Self-review

- Spec coverage: Task 1 covers direct, redacted, selected-profile OAuth reads;
  Task 2 covers transient state, visible-only polling, retry, and Login again;
  Task 3 covers opt-in and all required UI states; Task 4 covers release and
  the separately authorized logo commit.
- Completeness: all response classes and user actions are named with no
  deferred implementation markers.
- Type consistency: Task 1 exports `SubscriptionUsageSyncView`; Task 2
  consumes it through `CcmBackend.getSubscriptionUsageSync(name:)`; Task 3
  consumes only AppModel state/actions and does not access credential data.
