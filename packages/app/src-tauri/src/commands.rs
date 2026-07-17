use serde::Serialize;

use crate::{keychain, store, terminal, usage};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    pub name: String,
    pub kind: String,
    pub active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
    pub reset_at: Option<i64>,
    pub active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailoverView {
    pub enabled: bool,
    pub order: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
}

fn kind_str(k: store::ProfileKind) -> String {
    match k {
        store::ProfileKind::Subscription => "subscription",
        store::ProfileKind::ApiKey => "api-key",
    }
    .to_string()
}

fn is_active(active: &Option<String>, name: &str) -> bool {
    active.as_deref().map(|a| a.eq_ignore_ascii_case(name)).unwrap_or(false)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_profiles() -> Result<Vec<ProfileView>, String> {
    let c = store::load_config().map_err(|e| e.message())?;
    let active = c.active.clone();
    Ok(c.profiles
        .into_iter()
        .map(|p| ProfileView {
            active: is_active(&active, &p.name),
            name: p.name,
            kind: kind_str(p.kind),
        })
        .collect())
}

/// `async`: walks every profile's transcript directory (`usage::read_profile_usage`),
/// which can be slow with a large usage history. Marking this `async fn` moves
/// it off the main/webview thread onto Tauri's async runtime, per Tauri v2's
/// documented command threading model.
#[tauri::command]
pub async fn get_usage() -> Result<Vec<ProfileUsageView>, String> {
    let c = store::load_config().map_err(|e| e.message())?;
    let now = now_ms();
    let active = c.active.clone();
    Ok(c.profiles
        .into_iter()
        .map(|p| {
            let u = usage::read_profile_usage(&p.name, now);
            ProfileUsageView {
                active: is_active(&active, &p.name),
                profile: p.name,
                kind: kind_str(p.kind),
                input_tokens: u.input_tokens,
                cache_write_5m_tokens: u.cache_write_5m_tokens,
                cache_write_1h_tokens: u.cache_write_1h_tokens,
                cache_read_tokens: u.cache_read_tokens,
                output_tokens: u.output_tokens,
                total_tokens: u.total_tokens,
                cost_usd: u.cost_usd,
                reset_at: u.reset_at,
            }
        })
        .collect())
}

#[tauri::command]
pub fn set_active(name: String) -> Result<(), String> {
    store::set_active(&name).map_err(|e| e.message())
}

/// Testable core of `add_api_key_profile`. `set_key` is injected so tests can
/// force a genuine (non-"not found") Keychain failure deterministically,
/// without touching the real Keychain, to pin the rollback path: on failure
/// the just-created profile is removed from config + disk and the ORIGINAL
/// keychain error (not the rollback outcome) is returned.
fn add_api_key_profile_with<S>(name: &str, key: &str, set_key: S) -> Result<(), String>
where
    S: FnOnce(&str, &str) -> Result<(), String>,
{
    store::add_profile(name, store::ProfileKind::ApiKey).map_err(|e| e.message())?;
    if let Err(e) = set_key(name, key) {
        // Rollback: never leave a keyless api-key profile behind.
        let _ = store::remove_profile(name);
        return Err(e);
    }
    Ok(())
}

/// `async`: performs Keychain IO (and, on failure, a store rollback), so it
/// runs on Tauri's async runtime rather than the main thread.
#[tauri::command]
pub async fn add_api_key_profile(name: String, key: String) -> Result<(), String> {
    add_api_key_profile_with(&name, &key, |n, k| {
        keychain::set_api_key(n, k).map_err(|e| e.message().to_string())
    })
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
fn remove_profile_with<D>(name: &str, delete_key: D) -> Result<(), String>
where
    D: FnOnce(&str) -> Result<(), String>,
{
    let profile = store::get_profile(name)
        .map_err(|e| e.message())?
        .ok_or_else(|| store::StoreError::NotFound(name.to_string()).message())?;
    delete_key(&profile.name)?;
    store::remove_profile(&profile.name).map_err(|e| e.message())
}

/// `async`: performs Keychain IO before the store write, so it runs on
/// Tauri's async runtime rather than the main thread.
#[tauri::command]
pub async fn remove_profile(name: String) -> Result<(), String> {
    remove_profile_with(&name, |canonical| {
        keychain::delete_api_key(canonical).map_err(|e| e.message().to_string())
    })
}

#[tauri::command]
pub fn get_failover() -> Result<FailoverView, String> {
    let c = store::load_config().map_err(|e| e.message())?;
    Ok(FailoverView { enabled: c.failover_enabled, order: c.failover_order })
}

#[tauri::command]
pub fn set_failover_enabled(enabled: bool) -> Result<(), String> {
    store::set_failover_enabled(enabled).map_err(|e| e.message())
}

#[tauri::command]
pub fn set_failover_order(order: Vec<String>) -> Result<(), String> {
    store::set_failover_order(&order).map_err(|e| e.message())
}

/// `async`: blocks on `Command::status()` to launch Terminal.app via
/// `osascript`, so it runs on Tauri's async runtime rather than the main
/// thread.
#[tauri::command]
pub async fn open_session(name: String) -> Result<(), String> {
    terminal::open_session(&name).map_err(|e| e.message().to_string())
}

/// `async`: see `open_session` — same `osascript` spawn/block.
#[tauri::command]
pub async fn open_login_terminal(name: String) -> Result<(), String> {
    terminal::open_login_terminal(&name).map_err(|e| e.message().to_string())
}

#[tauri::command]
pub fn check_cli() -> CliStatus {
    CliStatus { installed: terminal::check_cli() }
}

/// `async`: blocks on `Command::status()` to launch the `open` process, so
/// it runs on Tauri's async runtime rather than the main thread.
#[tauri::command]
pub async fn open_config_in_editor() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-t")
        .arg(store::config_path())
        .status()
        .map_err(|_| "Could not open the config file.".to_string())?;
    Ok(())
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

    fn real_delete(name: &str) -> Result<(), String> {
        keychain::delete_api_key(name).map_err(|e| e.message().to_string())
    }

    fn real_set(name: &str, key: &str) -> Result<(), String> {
        keychain::set_api_key(name, key).map_err(|e| e.message().to_string())
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

            let result = remove_profile_with("work", |_| Err("a real keychain error".to_string()));

            assert_eq!(result, Err("a real keychain error".to_string()));
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
            assert_eq!(result, Err("Profile \"ghost\" not found.".to_string()));
        });
    }

    // --- add_api_key_profile_with ---

    #[test]
    #[serial]
    fn add_api_key_profile_rolls_back_and_surfaces_original_error_on_keychain_failure() {
        with_ccm_home(|| {
            let result = add_api_key_profile_with("bot", "sk-ant-x", |_, _| {
                Err("original keychain error".to_string())
            });

            assert_eq!(result, Err("original keychain error".to_string()));
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
                assert_eq!(keychain::get_api_key("bot").unwrap().as_deref(), Some("sk-ant-x"));
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

            assert_eq!(store::load_config().unwrap().active.as_deref(), Some("personal"));
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
}
