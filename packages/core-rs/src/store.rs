use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Tên profile thành tên thư mục ⇒ phải chặn path traversal. Regex y hệt
/// `NAME_RE` trong packages/core (paths.ts).
static NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$").unwrap());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProfileKind {
    Subscription,
    ApiKey,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub kind: ProfileKind,
    /// Trường lạ (chưa biết ở phiên bản Rust này) — giữ nguyên qua round-trip
    /// thay vì bị xóa khi app ghi lại config.json, khớp tính lossless của TS
    /// (`readJson` → mutate → `JSON.stringify`, không đi qua struct cố định
    /// field nào). Không tương thích với `deny_unknown_fields` — ta cố ý
    /// không dùng nó, vì bỏ qua trường lạ khi ĐỌC đã là hành vi forward-
    /// compat đúng theo mặc định của serde.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub profiles: Vec<Profile>,
    pub active: Option<String>,
    pub failover_enabled: bool,
    pub failover_order: Vec<String>,
    /// Xem ghi chú `extra` trên `Profile` — cùng lý do, ở cấp top-level của
    /// config.json.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            profiles: Vec::new(),
            active: None,
            failover_enabled: true,
            failover_order: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

#[derive(Debug)]
pub enum StoreError {
    InvalidName(String),
    NotFound(String),
    AlreadyExists(String),
    CorruptConfig,
    Io(String),
    SharedResource(String),
    InvalidTerminal(String),
}

impl StoreError {
    /// Chuỗi sạch cho tầng UI — không path, không key, không raw OS error.
    /// KHÔNG có sentinel máy-đọc nào ở đây: `CorruptConfig` từng trả chuỗi
    /// "CONFIG_CORRUPT" cho bản webview cũ, và chuỗi đó rò thẳng ra màn hình
    /// người dùng. Nay việc phân loại lỗi là của `api::CcmError` (enum có
    /// kiểu, Swift switch trên variant), còn hàm này chỉ sinh câu chữ.
    pub fn message(&self) -> String {
        match self {
            StoreError::InvalidName(n) => {
                format!("Invalid profile name: {n:?}. Use letters, digits, - and _ (max 64 chars).")
            }
            StoreError::NotFound(n) => format!("Profile \"{n}\" not found."),
            StoreError::AlreadyExists(n) => format!("Profile \"{n}\" already exists."),
            StoreError::CorruptConfig => {
                "The OreoDeck config file is not valid JSON and could not be read.".to_string()
            }
            StoreError::Io(_) => {
                "A file operation failed. Check that the OreoDeck data folder is readable and writable.".to_string()
            }
            StoreError::SharedResource(message) => message.clone(),
            StoreError::InvalidTerminal(value) => format!(
                "Unsupported terminal \"{value}\". Choose a terminal from OreoDeck Settings."
            ),
        }
    }
}

fn default_home() -> PathBuf {
    let home = env::var("HOME").unwrap_or_default();
    let current = PathBuf::from(&home).join(".oreodeck");
    let legacy = PathBuf::from(home).join(".ccm");
    if current.exists() || !legacy.exists() {
        current
    } else {
        legacy
    }
}

/// Khớp semantics `ccmHome()` của paths.ts: trim; rỗng/toàn khoảng trắng ⇒
/// fallback ~/.ccm; tương đối ⇒ resolve tuyệt đối theo CWD.
pub fn ccm_home() -> PathBuf {
    match env::var("OREODECK_HOME").or_else(|_| env::var("CCM_HOME")) {
        Ok(v) => {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                default_home()
            } else {
                let p = Path::new(trimmed);
                if p.is_absolute() {
                    p.to_path_buf()
                } else {
                    env::current_dir().unwrap_or_default().join(trimmed)
                }
            }
        }
        Err(_) => default_home(),
    }
}

pub fn profiles_dir() -> PathBuf {
    ccm_home().join("profiles")
}

pub const SHARED_RESOURCES: &[&str] = &["mcp", "skills", "plugins"];

const LEGACY_SHARED_RESOURCES: &[&str] = &[
    "CLAUDE.md",
    "settings.json",
    "statusline.sh",
    "agents",
    "commands",
    "skills",
    "plugins",
    "mcp",
];

pub fn global_claude_dir() -> PathBuf {
    match env::var("OREODECK_GLOBAL_CLAUDE_HOME").or_else(|_| env::var("CCM_GLOBAL_CLAUDE_HOME")) {
        Ok(v) if !v.trim().is_empty() => {
            let p = Path::new(v.trim());
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                env::current_dir().unwrap_or_default().join(p)
            }
        }
        _ => PathBuf::from(env::var("HOME").unwrap_or_default()).join(".claude"),
    }
}

pub fn profile_shared_resources(profile: &Profile) -> Vec<String> {
    profile
        .extra
        .get("sharedResources")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn validate_shared_resources(resources: &[String]) -> Result<Vec<String>, StoreError> {
    let mut unique = Vec::new();
    for resource in resources {
        if !SHARED_RESOURCES.contains(&resource.as_str()) {
            return Err(StoreError::SharedResource(format!(
                "Unsupported shared resource \"{resource}\". Allowed: {}.",
                SHARED_RESOURCES.join(", ")
            )));
        }
        if !unique.contains(resource) {
            unique.push(resource.clone());
        }
    }
    Ok(unique)
}

fn validate_stored_shared_resources(resources: &[String]) -> Result<Vec<String>, StoreError> {
    let mut unique = Vec::new();
    for resource in resources {
        if !LEGACY_SHARED_RESOURCES.contains(&resource.as_str()) {
            return Err(StoreError::SharedResource(format!(
                "Unsupported stored shared resource \"{resource}\"."
            )));
        }
        if !unique.contains(resource) {
            unique.push(resource.clone());
        }
    }
    Ok(unique)
}

fn is_expected_link(destination: &Path, source: &Path) -> Result<bool, StoreError> {
    let metadata = fs::symlink_metadata(destination).map_err(|e| StoreError::Io(e.to_string()))?;
    if !metadata.file_type().is_symlink() {
        return Ok(false);
    }
    let target = fs::read_link(destination).map_err(|e| StoreError::Io(e.to_string()))?;
    let resolved = if target.is_absolute() {
        target
    } else {
        destination.parent().unwrap_or(Path::new("")).join(target)
    };
    Ok(resolved == source)
}

pub fn set_shared_resources(name: &str, requested: &[String]) -> Result<(), StoreError> {
    set_shared_resources_impl(name, requested, false)
}

pub fn set_shared_resources_force(name: &str, requested: &[String]) -> Result<(), StoreError> {
    set_shared_resources_impl(name, requested, true)
}

fn set_shared_resources_impl(
    name: &str,
    requested: &[String],
    force: bool,
) -> Result<(), StoreError> {
    use std::os::unix::fs::symlink;
    let resources = validate_shared_resources(requested)?;
    let _lock = acquire_config_lock()?;
    let mut config = load_config()?;
    let profile_index = config
        .profiles
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| StoreError::NotFound(name.to_string()))?;
    let profile_name = config.profiles[profile_index].name.clone();
    assert_valid_name(&profile_name)?;
    let old = validate_stored_shared_resources(&profile_shared_resources(
        &config.profiles[profile_index],
    ))?;
    let global = global_claude_dir();
    let profile_root = profile_dir(&profile_name)?;
    let mut created: Vec<PathBuf> = Vec::new();
    let mut removed: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut displaced: Vec<(PathBuf, PathBuf)> = Vec::new();
    let backup_root = profile_root
        .join(".oreodeck-backups")
        .join("shared")
        .join(format!(
            "{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            process::id()
        ));

    let result = (|| -> Result<(), StoreError> {
        for resource in resources.iter().filter(|r| !old.contains(r)) {
            if resource == "mcp" {
                continue;
            }
            let source = global.join(resource);
            let destination = profile_root.join(resource);
            if fs::symlink_metadata(&source).is_err() {
                return Err(StoreError::SharedResource(format!(
                    "Global Claude resource does not exist: ~/.claude/{resource}"
                )));
            }
            match fs::symlink_metadata(&destination) {
                Ok(_) if is_expected_link(&destination, &source)? => continue,
                Ok(_) => {
                    if !force {
                        return Err(StoreError::SharedResource(format!(
                            "Profile resource already exists and will not be overwritten: {}",
                            destination.display()
                        )));
                    }
                    let backup = backup_root.join(resource);
                    if let Some(parent) = backup.parent() {
                        fs::create_dir_all(parent).map_err(|e| StoreError::Io(e.to_string()))?;
                    }
                    fs::rename(&destination, &backup).map_err(|e| StoreError::Io(e.to_string()))?;
                    displaced.push((destination.clone(), backup));
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(StoreError::Io(e.to_string())),
            }
            symlink(&source, &destination).map_err(|e| StoreError::Io(e.to_string()))?;
            created.push(destination);
        }
        for resource in old.iter().filter(|r| !resources.contains(r)) {
            if resource == "mcp" {
                continue;
            }
            let source = global.join(resource);
            let destination = profile_root.join(resource);
            match fs::symlink_metadata(&destination) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(StoreError::Io(e.to_string())),
                Ok(_) if !is_expected_link(&destination, &source)? => {
                    return Err(StoreError::SharedResource(format!(
                        "Profile resource is not an OreoDeck-managed symlink: {}",
                        destination.display()
                    )))
                }
                Ok(_) => {}
            }
            fs::remove_file(&destination).map_err(|e| StoreError::Io(e.to_string()))?;
            removed.push((source, destination));
        }
        if resources.is_empty() {
            config.profiles[profile_index]
                .extra
                .remove("sharedResources");
        } else {
            config.profiles[profile_index]
                .extra
                .insert("sharedResources".to_string(), serde_json::json!(resources));
        }
        save_config(&config)
    })();

    if let Err(error) = result {
        for destination in created.into_iter().rev() {
            let _ = fs::remove_file(destination);
        }
        for (destination, backup) in displaced.into_iter().rev() {
            let _ = fs::rename(backup, destination);
        }
        for (source, destination) in removed.into_iter().rev() {
            let _ = symlink(source, destination);
        }
        return Err(error);
    }
    Ok(())
}

pub fn config_path() -> PathBuf {
    ccm_home().join("config.json")
}

pub fn assert_valid_name(name: &str) -> Result<(), StoreError> {
    if NAME_RE.is_match(name) {
        Ok(())
    } else {
        Err(StoreError::InvalidName(name.to_string()))
    }
}

/// Chokepoint duy nhất: mọi path phái sinh từ tên profile đi qua đây, nên
/// validate ở đây chặn traversal cho toàn bộ (kể cả tên đọc từ config hỏng).
pub fn profile_dir(name: &str) -> Result<PathBuf, StoreError> {
    assert_valid_name(name)?;
    Ok(profiles_dir().join(name))
}

pub fn load_config() -> Result<Config, StoreError> {
    match fs::read_to_string(config_path()) {
        Ok(s) => serde_json::from_str(&s).map_err(|_| StoreError::CorruptConfig),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(StoreError::Io(e.to_string())),
    }
}

pub fn save_config(c: &Config) -> Result<(), StoreError> {
    write_json_atomic(&config_path(), c)
}

const LOCK_TIMEOUT: Duration = Duration::from_secs(10);
const LOCK_STALE: Duration = Duration::from_secs(30);

struct ConfigLock(PathBuf);

impl Drop for ConfigLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn acquire_config_lock() -> Result<ConfigLock, StoreError> {
    let lock = ccm_home().join(".config.lock");
    fs::create_dir_all(ccm_home()).map_err(|e| StoreError::Io(e.to_string()))?;
    let started = SystemTime::now();
    loop {
        match fs::create_dir(&lock) {
            Ok(()) => return Ok(ConfigLock(lock)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&lock)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| SystemTime::now().duration_since(m).ok())
                    .is_some_and(|age| age > LOCK_STALE);
                if stale {
                    let stale_lock = ccm_home().join(format!(
                        ".config.lock.stale-{}-{}",
                        process::id(),
                        SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                    ));
                    if fs::rename(&lock, &stale_lock).is_ok() {
                        let _ = fs::remove_dir_all(stale_lock);
                    }
                    continue;
                }
                if SystemTime::now()
                    .duration_since(started)
                    .unwrap_or_default()
                    >= LOCK_TIMEOUT
                {
                    return Err(StoreError::Io(
                        "timed out waiting for config lock".to_string(),
                    ));
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(StoreError::Io(e.to_string())),
        }
    }
}

fn update_config<T, F>(mutate: F) -> Result<T, StoreError>
where
    F: FnOnce(&mut Config) -> Result<T, StoreError>,
{
    let _lock = acquire_config_lock()?;
    let mut config = load_config()?;
    let result = mutate(&mut config)?;
    save_config(&config)?;
    Ok(result)
}

/// Ghi atomic: file tạm cùng thư mục `.{pid}-{millis}.tmp`, JSON pretty +
/// "\n", rồi rename. Khớp atomic.ts.
fn write_json_atomic<T: Serialize>(path: &Path, data: &T) -> Result<(), StoreError> {
    let dir = path
        .parent()
        .ok_or_else(|| StoreError::Io("target has no parent directory".to_string()))?;
    fs::create_dir_all(dir).map_err(|e| StoreError::Io(e.to_string()))?;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{}-{}.tmp", process::id(), millis));
    let mut body = serde_json::to_string_pretty(data).map_err(|e| StoreError::Io(e.to_string()))?;
    body.push('\n');
    let result = (|| -> std::io::Result<()> {
        fs::write(&tmp, &body)?;
        fs::rename(&tmp, path)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(StoreError::Io(e.to_string()));
    }
    Ok(())
}

/// So khớp case-insensitive (APFS mặc định case-insensitive) — khớp
/// findProfile() của profile-store.ts.
fn find_profile<'a>(profiles: &'a [Profile], name: &str) -> Option<&'a Profile> {
    let lower = name.to_lowercase();
    profiles.iter().find(|p| p.name.to_lowercase() == lower)
}

pub fn get_profile(name: &str) -> Result<Option<Profile>, StoreError> {
    Ok(find_profile(&load_config()?.profiles, name).cloned())
}

pub fn add_profile(name: &str, kind: ProfileKind) -> Result<(), StoreError> {
    assert_valid_name(name)?;
    update_config(|c| {
        if find_profile(&c.profiles, name).is_some() {
            return Err(StoreError::AlreadyExists(name.to_string()));
        }
        fs::create_dir_all(profile_dir(name)?).map_err(|e| StoreError::Io(e.to_string()))?;
        c.profiles.push(Profile {
            name: name.to_string(),
            kind,
            extra: serde_json::Map::new(),
        });
        c.failover_order.push(name.to_string());
        if c.active.is_none() {
            c.active = Some(name.to_string());
        }
        Ok(())
    })
}

/// Xóa profile: hủy tài nguyên TRƯỚC (thư mục), commit config SAU. Keychain do
/// command layer (Task 5) xóa trước khi gọi hàm này. Re-validate tên đã lưu.
pub fn remove_profile(name: &str) -> Result<(), StoreError> {
    let initial = load_config()?;
    let stored = find_profile(&initial.profiles, name)
        .cloned()
        .ok_or_else(|| StoreError::NotFound(name.to_string()))?;
    assert_valid_name(&stored.name)?;
    let dir = profile_dir(&stored.name)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| StoreError::Io(e.to_string()))?;
    }

    update_config(|c| {
        let profile = find_profile(&c.profiles, &stored.name)
            .cloned()
            .ok_or_else(|| StoreError::NotFound(stored.name.clone()))?;
        let lower = profile.name.to_lowercase();
        c.profiles.retain(|p| p.name.to_lowercase() != lower);
        c.failover_order.retain(|n| n.to_lowercase() != lower);
        if c.active.as_deref().map(str::to_lowercase) == Some(lower) {
            c.active = c.profiles.first().map(|p| p.name.clone());
        }
        Ok(())
    })
}

pub fn set_active(name: &str) -> Result<(), StoreError> {
    update_config(|c| {
        let profile = find_profile(&c.profiles, name)
            .cloned()
            .ok_or_else(|| StoreError::NotFound(name.to_string()))?;
        assert_valid_name(&profile.name)?;
        c.active = Some(profile.name);
        Ok(())
    })
}

pub fn set_failover_enabled(on: bool) -> Result<(), StoreError> {
    update_config(|c| {
        c.failover_enabled = on;
        Ok(())
    })
}

pub const TERMINAL_CHOICES: &[&str] = &[
    "terminal",
    "ghostty",
    "iterm2",
    "wezterm",
    "alacritty",
    "kitty",
    "warp",
    "hyper",
    "tabby",
    "rio",
    "wave",
];

pub fn get_terminal() -> Result<String, StoreError> {
    let config = load_config()?;
    Ok(config
        .extra
        .get("terminal")
        .and_then(serde_json::Value::as_str)
        .filter(|value| TERMINAL_CHOICES.contains(value))
        .unwrap_or("terminal")
        .to_string())
}

pub fn set_terminal(value: &str) -> Result<(), StoreError> {
    if !TERMINAL_CHOICES.contains(&value) {
        return Err(StoreError::InvalidTerminal(value.to_string()));
    }
    update_config(|config| {
        config.extra.insert(
            "terminal".to_string(),
            serde_json::Value::String(value.to_string()),
        );
        Ok(())
    })
}

/// Ghi failoverOrder canonical casing (theo spec Giai đoạn 2). Tên không được
/// liệt kê giữ ở cuối hàng.
pub fn set_failover_order(names: &[String]) -> Result<(), StoreError> {
    update_config(|c| {
        let mut order: Vec<String> = Vec::with_capacity(names.len());
        for n in names {
            let p = find_profile(&c.profiles, n).ok_or_else(|| StoreError::NotFound(n.clone()))?;
            if !order.iter().any(|o| o.eq_ignore_ascii_case(&p.name)) {
                order.push(p.name.clone());
            }
        }
        for p in &c.profiles {
            if !order.iter().any(|o| o.eq_ignore_ascii_case(&p.name)) {
                order.push(p.name.clone());
            }
        }
        c.failover_order = order;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;

    fn set_home(dir: &std::path::Path) {
        env::set_var("CCM_HOME", dir);
    }

    #[test]
    #[serial]
    fn ccm_home_trims_and_falls_back_on_whitespace() {
        env::set_var("CCM_HOME", "   ");
        let home = ccm_home();
        env::remove_var("CCM_HOME");
        assert_eq!(home, default_home());
    }

    #[test]
    #[serial]
    fn ccm_home_respects_absolute_override() {
        env::set_var("CCM_HOME", "/tmp/ccm-abs-test");
        assert_eq!(ccm_home(), std::path::PathBuf::from("/tmp/ccm-abs-test"));
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn assert_valid_name_matches_the_contract_regex() {
        assert!(assert_valid_name("work").is_ok());
        assert!(assert_valid_name("Work-2_final").is_ok());
        assert!(assert_valid_name("../evil").is_err());
        assert!(assert_valid_name("").is_err());
        assert!(assert_valid_name("_leading").is_err()); // first char must be alnum
        assert!(assert_valid_name(&"x".repeat(65)).is_err()); // max 64
    }

    #[test]
    #[serial]
    fn terminal_setting_defaults_validates_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        assert_eq!(get_terminal().unwrap(), "terminal");
        set_terminal("ghostty").unwrap();
        assert_eq!(get_terminal().unwrap(), "ghostty");
        assert!(matches!(
            set_terminal("unknown"),
            Err(StoreError::InvalidTerminal(_))
        ));
        assert_eq!(get_terminal().unwrap(), "ghostty");
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn load_config_returns_defaults_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        let c = load_config().unwrap();
        env::remove_var("CCM_HOME");
        assert_eq!(c, Config::default());
        assert!(c.failover_enabled);
    }

    #[test]
    #[serial]
    fn load_config_reports_corrupt_json() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        std::fs::write(config_path(), b"{ not json").unwrap();
        let err = load_config().unwrap_err();
        env::remove_var("CCM_HOME");
        assert!(matches!(err, StoreError::CorruptConfig));
        assert!(
            !err.message().contains("CONFIG_CORRUPT"),
            "the machine-readable sentinel must never reach user-facing copy"
        );
    }

    #[test]
    #[serial]
    fn add_profile_persists_and_creates_dir_and_first_is_active() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        add_profile("work", ProfileKind::Subscription).unwrap();
        add_profile("bot", ProfileKind::ApiKey).unwrap();
        let c = load_config().unwrap();
        assert_eq!(c.profiles.len(), 2);
        assert_eq!(c.active.as_deref(), Some("work"));
        assert_eq!(c.failover_order, vec!["work", "bot"]);
        assert!(profile_dir("work").unwrap().is_dir());
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn concurrent_profile_additions_do_not_lose_either_update() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        let a = std::thread::spawn(|| add_profile("work", ProfileKind::Subscription));
        let b = std::thread::spawn(|| add_profile("personal", ProfileKind::Subscription));
        a.join().unwrap().unwrap();
        b.join().unwrap().unwrap();
        let c = load_config().unwrap();
        env::remove_var("CCM_HOME");
        assert_eq!(c.profiles.len(), 2);
        assert!(c.profiles.iter().any(|p| p.name == "work"));
        assert!(c.profiles.iter().any(|p| p.name == "personal"));
    }

    #[test]
    #[serial]
    fn shared_resources_create_and_clear_only_managed_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let global = tempfile::tempdir().unwrap();
        set_home(dir.path());
        env::set_var("CCM_GLOBAL_CLAUDE_HOME", global.path());
        fs::create_dir(global.path().join("skills")).unwrap();
        add_profile("work", ProfileKind::Subscription).unwrap();

        set_shared_resources("work", &["skills".to_string()]).unwrap();
        let link = profile_dir("work").unwrap().join("skills");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            profile_shared_resources(&get_profile("work").unwrap().unwrap()),
            vec!["skills"]
        );

        set_shared_resources("work", &[]).unwrap();
        assert!(!link.exists());
        assert!(profile_shared_resources(&get_profile("work").unwrap().unwrap()).is_empty());
        env::remove_var("CCM_GLOBAL_CLAUDE_HOME");
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn shared_resources_reject_sensitive_and_existing_real_paths() {
        let dir = tempfile::tempdir().unwrap();
        let global = tempfile::tempdir().unwrap();
        set_home(dir.path());
        env::set_var("CCM_GLOBAL_CLAUDE_HOME", global.path());
        fs::create_dir(global.path().join("skills")).unwrap();
        add_profile("work", ProfileKind::Subscription).unwrap();
        fs::create_dir(profile_dir("work").unwrap().join("skills")).unwrap();

        assert!(matches!(
            set_shared_resources("work", &["projects".to_string()]),
            Err(StoreError::SharedResource(_))
        ));
        assert!(matches!(
            set_shared_resources("work", &["settings.json".to_string()]),
            Err(StoreError::SharedResource(_))
        ));
        assert!(matches!(
            set_shared_resources("work", &["skills".to_string()]),
            Err(StoreError::SharedResource(_))
        ));
        env::remove_var("CCM_GLOBAL_CLAUDE_HOME");
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn forced_shared_resource_backs_up_local_data_before_symlinking() {
        let dir = tempfile::tempdir().unwrap();
        let global = tempfile::tempdir().unwrap();
        set_home(dir.path());
        env::set_var("CCM_GLOBAL_CLAUDE_HOME", global.path());
        fs::create_dir(global.path().join("skills")).unwrap();
        add_profile("work", ProfileKind::Subscription).unwrap();
        let local = profile_dir("work").unwrap().join("skills");
        fs::create_dir(&local).unwrap();
        fs::write(local.join("local.txt"), "keep me").unwrap();

        set_shared_resources_force("work", &["skills".to_string()]).unwrap();
        assert!(fs::symlink_metadata(&local)
            .unwrap()
            .file_type()
            .is_symlink());
        let backup_root = profile_dir("work")
            .unwrap()
            .join(".oreodeck-backups")
            .join("shared");
        let backup = fs::read_dir(backup_root)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
            .join("skills")
            .join("local.txt");
        assert_eq!(fs::read_to_string(backup).unwrap(), "keep me");
        env::remove_var("CCM_GLOBAL_CLAUDE_HOME");
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn config_json_uses_camelcase_and_kebab_kind() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        add_profile("bot", ProfileKind::ApiKey).unwrap();
        let raw = std::fs::read_to_string(config_path()).unwrap();
        env::remove_var("CCM_HOME");
        assert!(raw.contains("\"failoverEnabled\""));
        assert!(raw.contains("\"failoverOrder\""));
        assert!(raw.contains("\"api-key\""));
        assert!(raw.ends_with("\n")); // trailing newline like the TS atomic writer
    }

    /// Regression for a real forward-compat bug: unknown top-level and
    /// profile-level fields (as a future CLI version might add) must
    /// survive an app write byte-identical in value, not be silently
    /// dropped by the fixed-field struct's re-serialization.
    #[test]
    #[serial]
    fn set_active_preserves_unknown_config_and_profile_fields() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());

        let tampered = br#"{"profiles":[{"name":"work","kind":"subscription","createdAt":123}],"active":null,"failoverEnabled":true,"failoverOrder":["work"],"telemetryOptIn":false}"#;
        std::fs::write(config_path(), tampered).unwrap();

        set_active("work").unwrap();
        let raw = std::fs::read_to_string(config_path()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(v["telemetryOptIn"], serde_json::json!(false));
        assert_eq!(v["profiles"][0]["createdAt"], serde_json::json!(123));
        assert_eq!(v["active"], serde_json::json!("work"));
    }

    /// CARGO_MANIFEST_DIR = packages/core-rs ⇒ `..` = packages/ ⇒
    /// packages/contract-fixtures. This is the anchor against TS/Rust
    /// contract drift; a wrong path fails the test loudly instead of
    /// silently skipping it.
    fn contract_fixtures_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("contract-fixtures")
    }

    /// I4: wires `contract-fixtures/config.json` into the Rust suite so the
    /// two suites agree on the config contract, not just the usage one.
    /// Also doubles as the Rust half of the unknown-field-preservation
    /// assert — the single check that would have caught I1.
    #[test]
    #[serial]
    fn config_contract_fixture_round_trips_with_canonical_casing_and_unknown_field_preserved() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        std::fs::copy(contract_fixtures_dir().join("config.json"), config_path()).unwrap();

        let c = load_config().unwrap();
        assert_eq!(c.profiles.len(), 2);
        assert_eq!(c.profiles[0].name, "Work"); // canonical casing preserved
        assert_eq!(c.profiles[0].kind, ProfileKind::Subscription);
        assert_eq!(c.profiles[1].name, "bot");
        assert_eq!(c.profiles[1].kind, ProfileKind::ApiKey);
        assert_eq!(c.active.as_deref(), Some("Work"));
        assert!(c.failover_enabled);
        assert_eq!(c.failover_order, vec!["Work", "bot"]);
        assert_eq!(
            c.extra.get("telemetryOptIn"),
            Some(&serde_json::json!(false))
        );

        set_active("bot").unwrap();
        let raw = std::fs::read_to_string(config_path()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(v["telemetryOptIn"], serde_json::json!(false));
        assert_eq!(v["active"], serde_json::json!("bot"));
    }

    /// I4: wires `contract-fixtures/config-corrupt.json` into the Rust
    /// suite — the TS suite asserts `loadConfig()` rejects on the same
    /// fixture (its real semantics, since `readJson` only treats ENOENT as
    /// "missing"); Rust's equivalent is `CONFIG_CORRUPT`.
    #[test]
    #[serial]
    fn config_corrupt_contract_fixture_yields_config_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        std::fs::copy(
            contract_fixtures_dir().join("config-corrupt.json"),
            config_path(),
        )
        .unwrap();

        let err = load_config().unwrap_err();
        env::remove_var("CCM_HOME");

        assert!(matches!(err, StoreError::CorruptConfig));
    }

    #[test]
    #[serial]
    fn add_profile_is_case_insensitive_but_stores_canonical() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        add_profile("Work", ProfileKind::Subscription).unwrap();
        let err = add_profile("work", ProfileKind::ApiKey).unwrap_err();
        assert!(matches!(err, StoreError::AlreadyExists(_)));
        assert_eq!(get_profile("WORK").unwrap().unwrap().name, "Work");
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn remove_profile_deletes_dir_and_reassigns_active() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        add_profile("work", ProfileKind::Subscription).unwrap();
        add_profile("personal", ProfileKind::Subscription).unwrap();
        remove_profile("Work").unwrap(); // case-insensitive match
        let c = load_config().unwrap();
        assert_eq!(c.profiles.len(), 1);
        assert_eq!(c.active.as_deref(), Some("personal"));
        assert_eq!(c.failover_order, vec!["personal"]);
        assert!(!profile_dir("work").unwrap().exists());
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn remove_profile_unknown_errors() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        let err = remove_profile("ghost").unwrap_err();
        env::remove_var("CCM_HOME");
        assert!(matches!(err, StoreError::NotFound(_)));
    }

    #[test]
    #[serial]
    fn set_failover_order_canonicalizes_and_appends_missing() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        add_profile("Work", ProfileKind::Subscription).unwrap();
        add_profile("Bot", ProfileKind::ApiKey).unwrap();
        add_profile("Extra", ProfileKind::Subscription).unwrap();
        set_failover_order(&["bot".to_string(), "work".to_string()]).unwrap();
        let c = load_config().unwrap();
        // canonical casing restored, "Extra" (not listed) kept at the tail
        assert_eq!(c.failover_order, vec!["Bot", "Work", "Extra"]);
        env::remove_var("CCM_HOME");
    }

    #[test]
    #[serial]
    fn set_failover_order_rejects_unknown() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        add_profile("work", ProfileKind::Subscription).unwrap();
        let err = set_failover_order(&["work".to_string(), "ghost".to_string()]).unwrap_err();
        env::remove_var("CCM_HOME");
        assert!(matches!(err, StoreError::NotFound(_)));
    }

    /// Regression for a real Phase-1 traversal bug: `remove_profile` must
    /// re-validate the *stored* name (`assert_valid_name`) before touching
    /// the filesystem, so a hand-tampered config.json with a `../`-style
    /// name can never reach `fs::remove_dir_all`.
    #[test]
    #[serial]
    fn remove_profile_rejects_tampered_name_before_destroying() {
        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());

        std::fs::create_dir_all(profiles_dir()).unwrap();
        // Sibling directory that a naive traversal-unaware implementation
        // would still be able to delete via `fs::remove_dir_all`.
        let canary = profiles_dir().join("canary");
        std::fs::create_dir_all(&canary).unwrap();

        let tampered = b"{\"profiles\":[{\"name\":\"../../escape\",\"kind\":\"subscription\"}],\"active\":null,\"failoverEnabled\":true,\"failoverOrder\":[]}\n";
        std::fs::write(config_path(), tampered).unwrap();

        let err = remove_profile("../../escape").unwrap_err();
        let raw_after = std::fs::read(config_path()).unwrap();
        env::remove_var("CCM_HOME");

        assert!(matches!(err, StoreError::InvalidName(_)));
        assert!(
            canary.exists(),
            "unrelated directory must survive a rejected traversal attempt"
        );
        assert_eq!(
            raw_after, tampered,
            "config.json must be untouched when remove is rejected"
        );
    }

    /// Regression for a real Phase-1 fail-closed bug: if the destructive
    /// filesystem step errors, `remove_profile` must never reach
    /// `save_config`, so the profile stays listed and recoverable.
    #[test]
    #[serial]
    fn remove_profile_fail_closed_on_partial_failure() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        set_home(dir.path());
        add_profile("work", ProfileKind::Subscription).unwrap();

        // Deny write on profiles_dir() itself so `fs::remove_dir_all` on the
        // "work" entry inside it fails with a permission error, without
        // requiring escalated privileges.
        let parent = profiles_dir();
        let original_perms = std::fs::metadata(&parent).unwrap().permissions();
        let mut readonly_perms = original_perms.clone();
        readonly_perms.set_mode(0o555);
        std::fs::set_permissions(&parent, readonly_perms).unwrap();

        let result = remove_profile("work");

        // Restore permissions before any assertion can bail out, so the
        // tempdir can still be cleaned up on drop.
        std::fs::set_permissions(&parent, original_perms).unwrap();

        let err = result.unwrap_err();
        let c = load_config().unwrap();

        assert!(matches!(err, StoreError::Io(_)));
        assert_eq!(c.profiles.len(), 1);
        assert_eq!(c.profiles[0].name, "work");
        assert!(profile_dir("work").unwrap().exists());
        env::remove_var("CCM_HOME");
    }
}
