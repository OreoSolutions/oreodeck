use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub profiles: Vec<Profile>,
    pub active: Option<String>,
    pub failover_enabled: bool,
    pub failover_order: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            profiles: Vec::new(),
            active: None,
            failover_enabled: true,
            failover_order: Vec::new(),
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
}

impl StoreError {
    /// Chuỗi sạch cho frontend — không path, không key, không raw OS error.
    /// `CorruptConfig` trả sentinel để UI hiện banner "config hỏng".
    pub fn message(&self) -> String {
        match self {
            StoreError::InvalidName(n) => format!(
                "Invalid profile name: {n:?}. Use letters, digits, - and _ (max 64 chars)."
            ),
            StoreError::NotFound(n) => format!("Profile \"{n}\" not found."),
            StoreError::AlreadyExists(n) => format!("Profile \"{n}\" already exists."),
            StoreError::CorruptConfig => "CONFIG_CORRUPT".to_string(),
            StoreError::Io(_) => {
                "A file operation failed. Check that ~/.ccm is readable and writable.".to_string()
            }
        }
    }
}

fn default_home() -> PathBuf {
    let home = env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(".ccm")
}

/// Khớp semantics `ccmHome()` của paths.ts: trim; rỗng/toàn khoảng trắng ⇒
/// fallback ~/.ccm; tương đối ⇒ resolve tuyệt đối theo CWD.
pub fn ccm_home() -> PathBuf {
    match env::var("CCM_HOME") {
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
    let mut c = load_config()?;
    if find_profile(&c.profiles, name).is_some() {
        return Err(StoreError::AlreadyExists(name.to_string()));
    }
    fs::create_dir_all(profile_dir(name)?).map_err(|e| StoreError::Io(e.to_string()))?;
    c.profiles.push(Profile { name: name.to_string(), kind });
    c.failover_order.push(name.to_string());
    if c.active.is_none() {
        c.active = Some(name.to_string());
    }
    save_config(&c)
}

/// Xóa profile: hủy tài nguyên TRƯỚC (thư mục), commit config SAU. Keychain do
/// command layer (Task 5) xóa trước khi gọi hàm này. Re-validate tên đã lưu.
pub fn remove_profile(name: &str) -> Result<(), StoreError> {
    let mut c = load_config()?;
    let profile = find_profile(&c.profiles, name)
        .cloned()
        .ok_or_else(|| StoreError::NotFound(name.to_string()))?;
    assert_valid_name(&profile.name)?;

    let dir = profile_dir(&profile.name)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| StoreError::Io(e.to_string()))?;
    }

    let lower = profile.name.to_lowercase();
    c.profiles.retain(|p| p.name.to_lowercase() != lower);
    c.failover_order.retain(|n| n.to_lowercase() != lower);
    if c.active.as_deref().map(str::to_lowercase) == Some(lower) {
        c.active = c.profiles.first().map(|p| p.name.clone());
    }
    save_config(&c)
}

pub fn set_active(name: &str) -> Result<(), StoreError> {
    let mut c = load_config()?;
    let profile = find_profile(&c.profiles, name)
        .cloned()
        .ok_or_else(|| StoreError::NotFound(name.to_string()))?;
    assert_valid_name(&profile.name)?;
    c.active = Some(profile.name);
    save_config(&c)
}

pub fn set_failover_enabled(on: bool) -> Result<(), StoreError> {
    let mut c = load_config()?;
    c.failover_enabled = on;
    save_config(&c)
}

/// Ghi failoverOrder canonical casing (theo spec Giai đoạn 2). Tên không được
/// liệt kê giữ ở cuối hàng.
pub fn set_failover_order(names: &[String]) -> Result<(), StoreError> {
    let c = load_config()?;
    let mut order: Vec<String> = Vec::with_capacity(names.len());
    for n in names {
        let p = find_profile(&c.profiles, n).ok_or_else(|| StoreError::NotFound(n.clone()))?;
        order.push(p.name.clone());
    }
    for p in &c.profiles {
        let low = p.name.to_lowercase();
        if !order.iter().any(|o| o.to_lowercase() == low) {
            order.push(p.name.clone());
        }
    }
    let mut c = c;
    c.failover_order = order;
    save_config(&c)
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
        assert!(home.ends_with(".ccm"));
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
        assert_eq!(err.message(), "CONFIG_CORRUPT");
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
        env::remove_var("CCM_HOME");

        assert!(matches!(err, StoreError::Io(_)));
        assert_eq!(c.profiles.len(), 1);
        assert_eq!(c.profiles[0].name, "work");
        assert!(profile_dir("work").unwrap().exists());
    }
}
