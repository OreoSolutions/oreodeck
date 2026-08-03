use crate::{keychain, store, terminal, usage};
use serde::Deserialize;
use std::collections::HashSet;
use std::time::Duration;
use url::Url;

/// Typed error surface for Swift. Replaces the old webview app's stringly
/// `Result<_, String>` (whose `"CONFIG_CORRUPT"` sentinel leaked raw to
/// users). Swift `switch`es on these variants — it must never compare
/// strings. Invariant: no variant ever carries key material; `Keychain`
/// messages come from `keychain.rs`, which swallows the OS error and emits a
/// fixed template naming only the profile.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CcmError {
    #[error("The OreoDeck config file is not valid JSON and could not be read.")]
    ConfigCorrupt,
    #[error("{message}")]
    InvalidName { name: String, message: String },
    #[error("Profile \"{name}\" not found.")]
    NotFound { name: String },
    #[error("Profile \"{name}\" already exists.")]
    AlreadyExists { name: String },
    #[error("{message}")]
    Io { message: String },
    #[error("{message}")]
    Keychain { message: String },
}

impl From<store::StoreError> for CcmError {
    fn from(e: store::StoreError) -> Self {
        // Map on the VARIANT, never by matching on message text.
        let message = e.message();
        match e {
            store::StoreError::CorruptConfig => CcmError::ConfigCorrupt,
            store::StoreError::InvalidName(name) => CcmError::InvalidName { name, message },
            store::StoreError::NotFound(name) => CcmError::NotFound { name },
            store::StoreError::AlreadyExists(name) => CcmError::AlreadyExists { name },
            store::StoreError::Io(_) => CcmError::Io { message },
            store::StoreError::SharedResource(_) => CcmError::Io { message },
            store::StoreError::InvalidTerminal(_) => CcmError::Io { message },
            store::StoreError::InvalidGatewayBaseUrl(_) => CcmError::Io { message },
            store::StoreError::InvalidGatewayModelMappings(_) => CcmError::Io { message },
        }
    }
}

impl From<keychain::KeychainError> for CcmError {
    fn from(e: keychain::KeychainError) -> Self {
        CcmError::Keychain {
            message: e.message().to_string(),
        }
    }
}

impl From<terminal::TermError> for CcmError {
    fn from(e: terminal::TermError) -> Self {
        // A TermError is a process/OS failure and its message is already
        // human copy — Io is the honest bucket for it.
        CcmError::Io {
            message: e.message().to_string(),
        }
    }
}

#[derive(Debug, uniffi::Record)]
pub struct ProfileView {
    pub name: String,
    /// "subscription" | "api-key" | "gateway" — same wire values as config.json's `kind`.
    pub kind: String,
    pub active: bool,
    pub shared_resources: Vec<String>,
    pub model_mappings: Option<store::GatewayModelMappings>,
}

#[derive(Debug, uniffi::Record)]
pub struct ProfileUsageView {
    pub profile: String,
    pub kind: String,
    pub input_tokens: i64,
    pub cache_write_5m_tokens: i64,
    pub cache_write_1h_tokens: i64,
    pub cache_read_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    /// None ⇒ no billable entry in the 5h window ⇒ UI shows "—".
    pub reset_at_ms: Option<i64>,
    /// Authoritative account-level plan usage cached by Claude Code.
    pub plan_five_hour_percent: Option<f64>,
    pub plan_five_hour_reset_at_ms: Option<i64>,
    pub plan_weekly_percent: Option<f64>,
    pub plan_weekly_reset_at_ms: Option<i64>,
    pub plan_usage_fetched_at_ms: Option<i64>,
}

#[derive(Debug, uniffi::Record)]
pub struct FailoverView {
    pub enabled: bool,
    pub order: Vec<String>,
}

/// Display-safe outcome of a one-off gateway `/models` request. This record
/// intentionally contains only public endpoint metadata; it never contains a
/// Keychain token, response body, or raw transport error.
#[derive(Debug, uniffi::Record)]
pub struct GatewayConnectionView {
    pub state: String,
    pub endpoint: String,
    pub model_count: u32,
    pub message: String,
}

/// Display-safe model index for a draft gateway profile. It is intentionally
/// transient: callers supply the draft URL and token, and this record never
/// carries either secret back across the FFI boundary.
#[derive(Debug, uniffi::Record)]
pub struct GatewayModelIndexView {
    pub state: String,
    pub endpoint: String,
    pub model_ids: Vec<String>,
    pub message: String,
}

#[derive(Deserialize)]
struct GatewayModelsResponse {
    data: Vec<GatewayModel>,
}

#[derive(Deserialize)]
struct GatewayModel {
    id: String,
}

fn gateway_connection(
    state: &str,
    endpoint: &str,
    model_count: u32,
    message: &str,
) -> GatewayConnectionView {
    GatewayConnectionView {
        state: state.to_string(),
        endpoint: endpoint.to_string(),
        model_count,
        message: message.to_string(),
    }
}

fn gateway_model_index(
    state: &str,
    endpoint: &str,
    model_ids: Vec<String>,
    message: &str,
) -> GatewayModelIndexView {
    GatewayModelIndexView {
        state: state.to_string(),
        endpoint: endpoint.to_string(),
        model_ids,
        message: message.to_string(),
    }
}

fn gateway_model_ids(body: &str) -> Result<Vec<String>, ()> {
    let models = serde_json::from_str::<GatewayModelsResponse>(body).map_err(|_| ())?;
    let mut ids = models
        .data
        .into_iter()
        .map(|model| model.id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    ids.sort_unstable();
    Ok(ids)
}

/// Turns an HTTP response into safe UI data. The body is parsed only for the
/// `data[].id` shape advertised by OpenAI-compatible model endpoints; neither
/// the body nor parser errors cross the FFI boundary.
fn gateway_connection_from_http_response(
    endpoint: &str,
    status: u16,
    body: &str,
) -> GatewayConnectionView {
    match status {
        200..=299 => match gateway_model_ids(body) {
            Ok(model_ids) => {
                let count = model_ids.len() as u32;
                let noun = if count == 1 { "model" } else { "models" };
                gateway_connection(
                    "connected",
                    endpoint,
                    count,
                    &format!("Connected — {count} {noun} available."),
                )
            }
            Err(_) => gateway_connection(
                "unexpected-response",
                endpoint,
                0,
                "The gateway returned an unexpected model list.",
            ),
        },
        401 | 403 => gateway_connection(
            "unauthorized",
            endpoint,
            0,
            "The gateway rejected this profile's API key.",
        ),
        _ => gateway_connection(
            "unexpected-response",
            endpoint,
            0,
            "The gateway returned an unexpected response.",
        ),
    }
}

fn gateway_model_index_from_http_response(
    endpoint: &str,
    status: u16,
    body: &str,
) -> GatewayModelIndexView {
    match status {
        200..=299 => match gateway_model_ids(body) {
            Ok(model_ids) if !model_ids.is_empty() => {
                let count = model_ids.len();
                let noun = if count == 1 { "model" } else { "models" };
                gateway_model_index(
                    "connected",
                    endpoint,
                    model_ids,
                    &format!("Connected — {count} {noun} available."),
                )
            }
            Ok(_) => gateway_model_index(
                "connected",
                endpoint,
                vec![],
                "Connected — the gateway did not advertise any models.",
            ),
            Err(_) => gateway_model_index(
                "unexpected-response",
                endpoint,
                vec![],
                "The gateway returned an unexpected model list.",
            ),
        },
        401 | 403 => gateway_model_index(
            "unauthorized",
            endpoint,
            vec![],
            "The gateway rejected this profile's API key.",
        ),
        _ => gateway_model_index(
            "unexpected-response",
            endpoint,
            vec![],
            "The gateway returned an unexpected response.",
        ),
    }
}

fn gateway_connection_transport_failure(endpoint: &str) -> GatewayConnectionView {
    gateway_connection(
        "unreachable",
        endpoint,
        0,
        "Could not reach the gateway. Check its URL and network access.",
    )
}

fn gateway_model_index_transport_failure(endpoint: &str) -> GatewayModelIndexView {
    gateway_model_index(
        "unreachable",
        endpoint,
        vec![],
        "Could not reach the gateway. Check its URL and network access.",
    )
}

fn gateway_models_endpoint(base_url: &str) -> Option<String> {
    let mut url = Url::parse(base_url).ok()?;
    let path = url.path().trim_end_matches('/');
    url.set_path(&format!("{path}/models"));
    url.set_query(None);
    url.set_fragment(None);
    Some(url.into())
}

fn check_gateway_connection_with<F>(
    endpoint: &str,
    token: Option<&str>,
    get: F,
) -> GatewayConnectionView
where
    F: FnOnce(&str, Option<&str>) -> Result<(u16, String), ()>,
{
    match get(endpoint, token) {
        Ok((status, body)) => gateway_connection_from_http_response(endpoint, status, &body),
        Err(()) => gateway_connection_transport_failure(endpoint),
    }
}

fn probe_gateway_models_with<F>(endpoint: &str, token: &str, get: F) -> GatewayModelIndexView
where
    F: FnOnce(&str, Option<&str>) -> Result<(u16, String), ()>,
{
    match get(endpoint, Some(token)) {
        Ok((status, body)) => gateway_model_index_from_http_response(endpoint, status, &body),
        Err(()) => gateway_model_index_transport_failure(endpoint),
    }
}

fn request_gateway_models(endpoint: &str, token: Option<&str>) -> Result<(u16, String), ()> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(5))
        .timeout_write(Duration::from_secs(5))
        .redirects(0)
        .build();
    let mut request = agent.get(endpoint).set("Accept", "application/json");
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    match request.call() {
        Ok(response) => {
            let status = response.status();
            let body = response.into_string().map_err(|_| ())?;
            Ok((status, body))
        }
        Err(ureq::Error::Status(status, _)) => Ok((status, String::new())),
        Err(_) => Err(()),
    }
}

fn kind_str(k: store::ProfileKind) -> String {
    match k {
        store::ProfileKind::Subscription => "subscription",
        store::ProfileKind::ApiKey => "api-key",
        store::ProfileKind::Gateway => "gateway",
    }
    .to_string()
}

fn is_active(active: &Option<String>, name: &str) -> bool {
    active
        .as_deref()
        .map(|a| a.eq_ignore_ascii_case(name))
        .unwrap_or(false)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[uniffi::export]
pub fn list_profiles() -> Result<Vec<ProfileView>, CcmError> {
    let c = store::load_config()?;
    let active = c.active.clone();
    Ok(c.profiles
        .into_iter()
        .map(|p| {
            let shared_resources = store::profile_shared_resources(&p);
            ProfileView {
                active: is_active(&active, &p.name),
                name: p.name,
                kind: kind_str(p.kind),
                shared_resources,
                model_mappings: p.model_mappings,
            }
        })
        .collect())
}

#[uniffi::export]
pub fn set_shared_resources(name: String, resources: Vec<String>) -> Result<(), CcmError> {
    Ok(store::set_shared_resources(&name, &resources)?)
}

#[uniffi::export]
pub fn set_shared_resources_force(name: String, resources: Vec<String>) -> Result<(), CcmError> {
    Ok(store::set_shared_resources_force(&name, &resources)?)
}

/// Walks every profile's transcript directory (`usage::read_profile_usage`),
/// which can be slow with a large usage history. Callers on a UI thread must
/// hop off it themselves.
#[uniffi::export]
pub fn get_usage() -> Result<Vec<ProfileUsageView>, CcmError> {
    let c = store::load_config()?;
    let now = now_ms();
    Ok(c.profiles
        .into_iter()
        .map(|p| {
            let u = usage::read_profile_usage(&p.name, now);
            let plan = if matches!(p.kind, store::ProfileKind::Subscription) {
                usage::read_claude_plan_usage(&p.name)
            } else {
                None
            };
            ProfileUsageView {
                profile: p.name,
                kind: kind_str(p.kind),
                input_tokens: u.input_tokens,
                cache_write_5m_tokens: u.cache_write_5m_tokens,
                cache_write_1h_tokens: u.cache_write_1h_tokens,
                cache_read_tokens: u.cache_read_tokens,
                output_tokens: u.output_tokens,
                total_tokens: u.total_tokens,
                cost_usd: u.cost_usd,
                reset_at_ms: u.reset_at,
                plan_five_hour_percent: plan
                    .as_ref()
                    .and_then(|value| value.five_hour.as_ref().map(|window| window.utilization)),
                plan_five_hour_reset_at_ms: plan
                    .as_ref()
                    .and_then(|value| value.five_hour.as_ref().and_then(|window| window.reset_at)),
                plan_weekly_percent: plan
                    .as_ref()
                    .and_then(|value| value.seven_day.as_ref().map(|window| window.utilization)),
                plan_weekly_reset_at_ms: plan
                    .as_ref()
                    .and_then(|value| value.seven_day.as_ref().and_then(|window| window.reset_at)),
                plan_usage_fetched_at_ms: plan.as_ref().map(|value| value.fetched_at),
            }
        })
        .collect())
}

#[uniffi::export]
pub fn set_active(name: String) -> Result<(), CcmError> {
    Ok(store::set_active(&name)?)
}

/// Testable core of `add_api_key_profile`. `set_key` is injected so tests can
/// force a genuine (non-"not found") Keychain failure deterministically,
/// without touching the real Keychain, to pin the rollback path: on failure
/// the just-created profile is removed from config + disk and the ORIGINAL
/// keychain error (not the rollback outcome) is returned.
fn add_api_key_profile_with<S>(name: &str, key: &str, set_key: S) -> Result<(), CcmError>
where
    S: FnOnce(&str, &str) -> Result<(), CcmError>,
{
    store::add_profile(name, store::ProfileKind::ApiKey)?;
    if let Err(e) = set_key(name, key) {
        // Rollback: never leave a keyless api-key profile behind.
        let _ = store::remove_profile(name);
        return Err(e);
    }
    Ok(())
}

/// `key` is key material: it is passed straight to the Keychain and is never
/// logged, echoed, or embedded in any error.
#[uniffi::export]
pub fn add_api_key_profile(name: String, key: String) -> Result<(), CcmError> {
    add_api_key_profile_with(&name, &key, |n, k| Ok(keychain::set_api_key(n, k)?))
}

fn add_gateway_profile_with<S>(
    name: &str,
    base_url: &str,
    key: &str,
    model_mappings: store::GatewayModelMappings,
    set_key: S,
) -> Result<(), CcmError>
where
    S: FnOnce(&str, &str) -> Result<(), CcmError>,
{
    store::add_gateway_profile_with_mappings(name, base_url, model_mappings)?;
    if let Err(error) = set_key(name, key) {
        let _ = store::remove_profile(name);
        return Err(error);
    }
    Ok(())
}

/// `key` is passed directly to Keychain and never persisted in config.json.
#[uniffi::export]
pub fn add_gateway_profile(
    name: String,
    base_url: String,
    key: String,
    model_mappings: store::GatewayModelMappings,
) -> Result<(), CcmError> {
    add_gateway_profile_with(&name, &base_url, &key, model_mappings, |n, k| {
        Ok(keychain::set_api_key(n, k)?)
    })
}

#[uniffi::export]
pub fn update_gateway_model_mappings(
    name: String,
    model_mappings: store::GatewayModelMappings,
) -> Result<(), CcmError> {
    Ok(store::update_gateway_model_mappings(&name, model_mappings)?)
}

/// Checks only the gateway's OpenAI-compatible model index. The Keychain token
/// is read and attached inside this Rust boundary, then discarded; Swift gets
/// the safe `GatewayConnectionView` record only.
#[uniffi::export]
pub fn check_gateway_connection(name: String) -> Result<GatewayConnectionView, CcmError> {
    let profile = store::get_profile(&name)?.ok_or_else(|| CcmError::NotFound { name })?;
    if profile.kind != store::ProfileKind::Gateway {
        return Err(CcmError::Io {
            message: "Only gateway profiles can be checked.".to_string(),
        });
    }
    let base_url = profile.gateway_base_url.ok_or_else(|| CcmError::Io {
        message: "This gateway profile has no URL to check.".to_string(),
    })?;
    let endpoint = gateway_models_endpoint(&base_url).ok_or_else(|| CcmError::Io {
        message: "This gateway profile has an invalid URL.".to_string(),
    })?;
    let token = keychain::get_api_key(&profile.name)?;
    Ok(check_gateway_connection_with(
        &endpoint,
        token.as_deref(),
        request_gateway_models,
    ))
}

/// Lists a draft gateway's advertised model IDs without writing a profile or
/// storing the supplied token. The result contains only display-safe metadata.
#[uniffi::export]
pub fn probe_gateway_models(
    base_url: String,
    key: String,
) -> Result<GatewayModelIndexView, CcmError> {
    let endpoint = gateway_models_endpoint(&base_url).ok_or_else(|| CcmError::Io {
        message: "This gateway profile has an invalid URL.".to_string(),
    })?;
    Ok(probe_gateway_models_with(
        &endpoint,
        &key,
        request_gateway_models,
    ))
}

/// Testable core of `remove_profile`. Resolves the CANONICAL stored name
/// FIRST (so a caller passing mismatched case, e.g. "WORK" for a profile
/// stored as "work", can never orphan a Keychain entry — macOS Keychain
/// account matching is case-sensitive, a real Phase 1 regression), then
/// deletes the Keychain entry for that canonical name, and only then removes
/// the profile from the store. An unknown profile errors before any side
/// effect; a genuine (non-"not found") Keychain failure aborts before the
/// store is touched, so the profile survives and is recoverable.
/// `delete_key` is injected so tests can force a genuine Keychain failure
/// deterministically without touching the real Keychain.
fn remove_profile_with<D>(name: &str, delete_key: D) -> Result<(), CcmError>
where
    D: FnOnce(&str) -> Result<(), CcmError>,
{
    let profile = store::get_profile(name)?.ok_or_else(|| CcmError::NotFound {
        name: name.to_string(),
    })?;
    // Refuse cleanly before touching the Keychain: a hand-tampered
    // config.json could carry an invalid stored name, and the Keychain must
    // never be called for a name that will be rejected anyway.
    store::assert_valid_name(&profile.name)?;
    delete_key(&profile.name)?;
    Ok(store::remove_profile(&profile.name)?)
}

#[uniffi::export]
pub fn remove_profile(name: String) -> Result<(), CcmError> {
    // `keychain::delete_api_key` maps errSecItemNotFound to Ok(()) — a
    // subscription profile with no Keychain entry must still be removable.
    remove_profile_with(&name, |canonical| Ok(keychain::delete_api_key(canonical)?))
}

#[uniffi::export]
pub fn get_failover() -> Result<FailoverView, CcmError> {
    let c = store::load_config()?;
    Ok(FailoverView {
        enabled: c.failover_enabled,
        order: c.failover_order,
    })
}

#[uniffi::export]
pub fn set_failover_enabled(on: bool) -> Result<(), CcmError> {
    Ok(store::set_failover_enabled(on)?)
}

#[uniffi::export]
pub fn set_failover_order(names: Vec<String>) -> Result<(), CcmError> {
    Ok(store::set_failover_order(&names)?)
}

#[uniffi::export]
pub fn get_terminal() -> Result<String, CcmError> {
    Ok(store::get_terminal()?)
}

#[uniffi::export]
pub fn set_terminal(value: String) -> Result<(), CcmError> {
    Ok(store::set_terminal(&value)?)
}

/// `terminal::open_session` runs `assert_valid_name` itself before the name
/// reaches the AppleScript/shell command — that check lives there, at the
/// chokepoint, not here.
#[uniffi::export]
pub fn open_session(name: String) -> Result<(), CcmError> {
    Ok(terminal::open_session(&name)?)
}

#[uniffi::export]
pub fn open_login_terminal(name: String) -> Result<(), CcmError> {
    Ok(terminal::open_login_terminal(&name)?)
}

#[uniffi::export]
pub fn open_terminal_command(command: String) -> Result<(), CcmError> {
    Ok(terminal::open_command(&command)?)
}

#[uniffi::export]
pub fn open_config_in_editor() -> Result<(), CcmError> {
    std::process::Command::new("open")
        .arg("-t")
        .arg(store::config_path())
        .status()
        .map_err(|_| CcmError::Io {
            message: "Could not open the config file.".to_string(),
        })?;
    Ok(())
}

#[uniffi::export]
pub fn check_cli() -> bool {
    terminal::check_cli()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;

    /// Test seam matching store.rs's convention: temp CCM_HOME per test.
    fn with_ccm_home<F: FnOnce()>(f: F) {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        f();
        env::remove_var("CCM_HOME");
    }

    /// Test seam matching keychain.rs's convention: throwaway Keychain
    /// service so tests never touch the user's real Keychain entries.
    fn with_throwaway_keychain<F: FnOnce()>(f: F) {
        env::set_var("CCM_KEYCHAIN_SERVICE", "com.oreo.ccm.commands-test-suite");
        f();
        env::remove_var("CCM_KEYCHAIN_SERVICE");
    }

    fn real_delete(name: &str) -> Result<(), CcmError> {
        Ok(keychain::delete_api_key(name)?)
    }

    fn real_set(name: &str, key: &str) -> Result<(), CcmError> {
        Ok(keychain::set_api_key(name, key)?)
    }

    // --- remove_profile_with ---

    #[test]
    #[serial]
    fn remove_profile_not_found_in_keychain_does_not_abort_removal() {
        with_ccm_home(|| {
            with_throwaway_keychain(|| {
                store::add_profile("work", store::ProfileKind::Subscription).unwrap();
                let result = remove_profile_with("work", real_delete);
                assert!(result.is_ok());
                assert!(store::get_profile("work").unwrap().is_none());
                assert!(!store::profile_dir("work").unwrap().exists());
            });
        });
    }

    #[test]
    #[serial]
    fn remove_profile_actually_deletes_the_keychain_entry_before_store_removal() {
        with_ccm_home(|| {
            with_throwaway_keychain(|| {
                store::add_profile("work", store::ProfileKind::ApiKey).unwrap();
                keychain::set_api_key("work", "sk-ant-x").unwrap();

                let result = remove_profile_with("work", real_delete);

                assert!(result.is_ok());
                assert_eq!(keychain::get_api_key("work").unwrap(), None);
                assert!(store::get_profile("work").unwrap().is_none());
                let _ = keychain::delete_api_key("work");
            });
        });
    }

    /// Finding 3 regression: profile stored as "work", command called with
    /// "WORK" — the canonical "work" Keychain entry must actually be gone,
    /// not a mismatched-case no-op that silently orphans it.
    #[test]
    #[serial]
    fn remove_profile_canonicalizes_name_before_deleting_keychain_entry() {
        with_ccm_home(|| {
            with_throwaway_keychain(|| {
                store::add_profile("work", store::ProfileKind::ApiKey).unwrap();
                keychain::set_api_key("work", "sk-ant-x").unwrap();

                let result = remove_profile_with("WORK", real_delete);

                assert!(result.is_ok());
                assert_eq!(keychain::get_api_key("work").unwrap(), None);
                assert!(store::get_profile("work").unwrap().is_none());
                let _ = keychain::delete_api_key("work");
            });
        });
    }

    #[test]
    #[serial]
    fn remove_profile_aborts_store_removal_and_surfaces_real_keychain_error() {
        with_ccm_home(|| {
            store::add_profile("work", store::ProfileKind::Subscription).unwrap();

            let result = remove_profile_with("work", |_| {
                Err(CcmError::Keychain {
                    message: "a real keychain error".to_string(),
                })
            });

            match result {
                Err(CcmError::Keychain { message }) => assert_eq!(message, "a real keychain error"),
                other => panic!("expected the ORIGINAL keychain error, got {other:?}"),
            }
            // Store step must never have run: profile + dir survive.
            assert!(store::get_profile("work").unwrap().is_some());
            assert!(store::profile_dir("work").unwrap().exists());
        });
    }

    #[test]
    #[serial]
    fn remove_profile_unknown_name_errors_before_any_keychain_call() {
        with_ccm_home(|| {
            let result = remove_profile_with("ghost", |_| {
                panic!("keychain must not be touched for an unknown profile");
            });
            match result {
                Err(CcmError::NotFound { name }) => assert_eq!(name, "ghost"),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    /// M5 regression: `get_profile` does not validate, so a hand-tampered
    /// config.json can carry an invalid stored name (e.g. from a
    /// `../`-style traversal attempt). `remove_profile_with` must reject via
    /// `assert_valid_name` BEFORE the Keychain is ever touched, not just
    /// before the store write — the injected `delete_key` panics if called,
    /// so this fails loudly if that ordering regresses.
    #[test]
    #[serial]
    fn remove_profile_rejects_tampered_stored_name_before_any_keychain_call() {
        with_ccm_home(|| {
            let tampered = b"{\"profiles\":[{\"name\":\"../../escape\",\"kind\":\"subscription\"}],\"active\":null,\"failoverEnabled\":true,\"failoverOrder\":[]}\n";
            std::fs::write(store::config_path(), tampered).unwrap();

            let result = remove_profile_with("../../escape", |_| {
                panic!("keychain must not be touched for a tampered/invalid stored name");
            });

            assert!(
                matches!(result, Err(CcmError::InvalidName { .. })),
                "expected InvalidName, got {result:?}"
            );
        });
    }

    // --- add_api_key_profile_with ---

    #[test]
    #[serial]
    fn add_api_key_profile_rolls_back_and_surfaces_original_error_on_keychain_failure() {
        with_ccm_home(|| {
            let result = add_api_key_profile_with("bot", "sk-ant-x", |_, _| {
                Err(CcmError::Keychain {
                    message: "original keychain error".to_string(),
                })
            });

            match result {
                Err(CcmError::Keychain { message }) => {
                    assert_eq!(message, "original keychain error")
                }
                other => panic!("expected the ORIGINAL keychain error, got {other:?}"),
            }
            assert!(store::get_profile("bot").unwrap().is_none());
            assert!(!store::profile_dir("bot").unwrap().exists());
        });
    }

    #[test]
    #[serial]
    fn add_api_key_profile_happy_path_persists_profile_and_key() {
        with_ccm_home(|| {
            with_throwaway_keychain(|| {
                let result = add_api_key_profile_with("bot", "sk-ant-x", real_set);

                assert!(result.is_ok());
                assert!(store::get_profile("bot").unwrap().is_some());
                assert_eq!(
                    keychain::get_api_key("bot").unwrap().as_deref(),
                    Some("sk-ant-x")
                );
                let _ = keychain::delete_api_key("bot");
            });
        });
    }

    // --- happy path for the remaining command groups ---

    #[test]
    #[serial]
    fn list_profiles_reflects_store_state() {
        with_ccm_home(|| {
            store::add_profile("work", store::ProfileKind::Subscription).unwrap();

            let views = list_profiles().unwrap();

            assert_eq!(views.len(), 1);
            assert_eq!(views[0].name, "work");
            assert_eq!(views[0].kind, "subscription");
            assert!(views[0].active);
        });
    }

    #[test]
    #[serial]
    fn set_active_updates_store() {
        with_ccm_home(|| {
            store::add_profile("work", store::ProfileKind::Subscription).unwrap();
            store::add_profile("personal", store::ProfileKind::Subscription).unwrap();

            set_active("personal".to_string()).unwrap();

            assert_eq!(
                store::load_config().unwrap().active.as_deref(),
                Some("personal")
            );
        });
    }

    #[test]
    #[serial]
    fn get_failover_and_set_failover_roundtrip() {
        with_ccm_home(|| {
            store::add_profile("work", store::ProfileKind::Subscription).unwrap();
            store::add_profile("bot", store::ProfileKind::ApiKey).unwrap();

            set_failover_enabled(false).unwrap();
            set_failover_order(vec!["bot".to_string(), "work".to_string()]).unwrap();
            let view = get_failover().unwrap();

            assert!(!view.enabled);
            assert_eq!(view.order, vec!["bot", "work"]);
        });
    }

    // --- typed CcmError mapping (uniffi layer) ---

    #[test]
    #[serial]
    fn corrupt_config_surfaces_as_typed_config_corrupt_not_a_string_sentinel() {
        with_ccm_home(|| {
            std::fs::write(store::config_path(), b"{ not json").unwrap();
            let err = list_profiles().unwrap_err();
            assert!(matches!(err, CcmError::ConfigCorrupt));
            // Regression guard for the old webview app's real bug: the raw
            // sentinel leaked to users as the error text.
            assert!(!err.to_string().contains("CONFIG_CORRUPT"));
        });
    }

    #[test]
    #[serial]
    fn unknown_profile_surfaces_as_typed_not_found_with_the_name() {
        with_ccm_home(|| {
            let err = set_active("ghost".to_string()).unwrap_err();
            match err {
                CcmError::NotFound { name } => assert_eq!(name, "ghost"),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    #[serial]
    fn duplicate_name_surfaces_as_typed_already_exists() {
        with_ccm_home(|| {
            store::add_profile("work", store::ProfileKind::Subscription).unwrap();
            let err = add_api_key_profile_with("WORK", "sk-ant-x", |_, _| {
                panic!("keychain must not be touched when the name is taken");
            })
            .unwrap_err();
            match err {
                CcmError::AlreadyExists { name } => assert_eq!(name, "WORK"),
                other => panic!("expected AlreadyExists, got {other:?}"),
            }
        });
    }

    #[test]
    #[serial]
    fn tampered_stored_name_surfaces_as_typed_invalid_name() {
        with_ccm_home(|| {
            let tampered = b"{\"profiles\":[{\"name\":\"../../escape\",\"kind\":\"subscription\"}],\"active\":null,\"failoverEnabled\":true,\"failoverOrder\":[]}\n";
            std::fs::write(store::config_path(), tampered).unwrap();
            let err = remove_profile_with("../../escape", |_| {
                panic!("keychain must not be touched for a tampered/invalid stored name");
            })
            .unwrap_err();
            assert!(matches!(err, CcmError::InvalidName { .. }));
        });
    }

    #[test]
    #[serial]
    fn keychain_failure_surfaces_as_typed_keychain_error_carrying_no_key_material() {
        with_ccm_home(|| {
            let err = add_api_key_profile_with("bot", "sk-ant-supersecret", |_, _| {
                Err(CcmError::Keychain {
                    message: "Failed to save API key for profile \"bot\" to macOS Keychain."
                        .to_string(),
                })
            })
            .unwrap_err();
            assert!(matches!(err, CcmError::Keychain { .. }));
            assert!(!format!("{err:?}").contains("sk-ant-supersecret"));
            assert!(!err.to_string().contains("sk-ant-supersecret"));
            // Rollback invariant survives the retype.
            assert!(store::get_profile("bot").unwrap().is_none());
            assert!(!store::profile_dir("bot").unwrap().exists());
        });
    }

    #[test]
    #[serial]
    fn get_usage_view_carries_reset_at_ms_none_for_a_fresh_profile() {
        with_ccm_home(|| {
            store::add_profile("fresh", store::ProfileKind::Subscription).unwrap();
            let views = get_usage().unwrap();
            assert_eq!(views.len(), 1);
            assert_eq!(views[0].profile, "fresh");
            assert_eq!(views[0].kind, "subscription");
            assert_eq!(views[0].total_tokens, 0);
            assert_eq!(views[0].reset_at_ms, None);
        });
    }

    // A gateway can report the same model through more than one capability
    // record. The dashboard must show the distinct model count, not inflate
    // it by counting duplicate IDs. Returning the wrong state or count would
    // make this test fail.
    #[test]
    fn gateway_connection_counts_distinct_advertised_models() {
        let result = gateway_connection_from_http_response(
            "https://gateway.example.com/v1/models",
            200,
            r#"{"data":[{"id":"cx/large"},{"id":"cx/large"},{"id":"cx/fast"}]}"#,
        );

        assert_eq!(result.state, "connected");
        assert_eq!(result.endpoint, "https://gateway.example.com/v1/models");
        assert_eq!(result.model_count, 2);
        assert_eq!(result.message, "Connected — 2 models available.");
    }

    // The add-gateway sheet needs the actual IDs to populate its selector.
    // Sorting and de-duplication make the choice list deterministic and never
    // expose blank provider records.
    #[test]
    fn gateway_model_index_returns_sorted_distinct_advertised_ids() {
        let result = gateway_model_index_from_http_response(
            "https://gateway.example.com/v1/models",
            200,
            r#"{"data":[{"id":"cx/sonnet"},{"id":""},{"id":"cx/opus"},{"id":"cx/sonnet"}]}"#,
        );

        assert_eq!(result.state, "connected");
        assert_eq!(result.endpoint, "https://gateway.example.com/v1/models");
        assert_eq!(result.model_ids, vec!["cx/opus", "cx/sonnet"]);
        assert!(!format!("{result:?}").contains("sk-ant-supersecret"));
    }

    #[test]
    fn gateway_model_index_hides_ids_when_gateway_rejects_the_token() {
        let result = gateway_model_index_from_http_response(
            "https://gateway.example.com/v1/models",
            401,
            "ignored",
        );

        assert_eq!(result.state, "unauthorized");
        assert!(result.model_ids.is_empty());
        assert!(!format!("{result:?}").contains("sk-ant-supersecret"));
    }

    // An authentication rejection is actionable and fundamentally different
    // from an offline endpoint. Collapsing 401 into "unreachable" would send
    // the user to diagnose the wrong problem.
    #[test]
    fn gateway_connection_reports_unauthorized_without_request_secrets() {
        let result = gateway_connection_from_http_response(
            "https://gateway.example.com/v1/models",
            401,
            "not authorized",
        );

        assert_eq!(result.state, "unauthorized");
        assert_eq!(result.model_count, 0);
        assert_eq!(
            result.message,
            "The gateway rejected this profile's API key."
        );
        assert!(!format!("{result:?}").contains("sk-ant-supersecret"));
    }

    // Network failures must produce a safe, helpful state without exposing
    // client-library errors, URLs with embedded credentials, or Keychain data.
    #[test]
    fn gateway_connection_reports_unreachable_without_transport_detail() {
        let result = gateway_connection_transport_failure("https://gateway.example.com/v1/models");

        assert_eq!(result.state, "unreachable");
        assert_eq!(result.model_count, 0);
        assert_eq!(
            result.message,
            "Could not reach the gateway. Check its URL and network access."
        );
        assert!(!format!("{result:?}").contains("sk-ant-supersecret"));
    }
}
