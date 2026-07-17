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

#[tauri::command]
pub fn get_usage() -> Result<Vec<ProfileUsageView>, String> {
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

#[tauri::command]
pub fn add_api_key_profile(name: String, key: String) -> Result<(), String> {
    store::add_profile(&name, store::ProfileKind::ApiKey).map_err(|e| e.message())?;
    if let Err(e) = keychain::set_api_key(&name, &key) {
        // Rollback: never leave a keyless api-key profile behind.
        let _ = store::remove_profile(&name);
        return Err(e.message().to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn remove_profile(name: String) -> Result<(), String> {
    // Resources first, config last: delete the Keychain entry, then the dir +
    // config entry (inside store::remove_profile). delete_api_key is a no-op
    // for subscription profiles.
    keychain::delete_api_key(&name).map_err(|e| e.message().to_string())?;
    store::remove_profile(&name).map_err(|e| e.message())
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

#[tauri::command]
pub fn open_session(name: String) -> Result<(), String> {
    terminal::open_session(&name).map_err(|e| e.message().to_string())
}

#[tauri::command]
pub fn open_login_terminal(name: String) -> Result<(), String> {
    terminal::open_login_terminal(&name).map_err(|e| e.message().to_string())
}

#[tauri::command]
pub fn check_cli() -> CliStatus {
    CliStatus { installed: terminal::check_cli() }
}

#[tauri::command]
pub fn open_config_in_editor() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-t")
        .arg(store::config_path())
        .status()
        .map_err(|_| "Could not open the config file.".to_string())?;
    Ok(())
}
