use crate::{keychain, store, terminal, usage};

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
    /// "subscription" | "api-key" — same wire values as config.json's `kind`.
    pub kind: String,
    pub active: bool,
    pub shared_resources: Vec<String>,
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

fn kind_str(k: store::ProfileKind) -> String {
    match k {
        store::ProfileKind::Subscription => "subscription",
        store::ProfileKind::ApiKey => "api-key",
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
}
