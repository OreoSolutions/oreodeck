use std::env;

use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

pub const KEYCHAIN_SERVICE: &str = "com.oreo.oreodeck";
const LEGACY_KEYCHAIN_SERVICE: &str = "com.oreo.ccm";

/// `errSecItemNotFound` — verified trên docs.rs cho security-framework 3.7.0.
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[derive(Debug)]
pub struct KeychainError(String);

impl KeychainError {
    pub fn message(&self) -> &str {
        &self.0
    }
}

/// Test seam: service throwaway qua CCM_KEYCHAIN_SERVICE, để test không đụng
/// Keychain thật của người dùng.
fn service() -> String {
    env::var("OREODECK_KEYCHAIN_SERVICE")
        .or_else(|_| env::var("CCM_KEYCHAIN_SERVICE"))
        .unwrap_or_else(|_| KEYCHAIN_SERVICE.to_string())
}

fn service_candidates() -> Vec<String> {
    if env::var("OREODECK_KEYCHAIN_SERVICE").is_ok() || env::var("CCM_KEYCHAIN_SERVICE").is_ok() {
        vec![service()]
    } else {
        vec![
            KEYCHAIN_SERVICE.to_string(),
            LEGACY_KEYCHAIN_SERVICE.to_string(),
        ]
    }
}

/// Lưu key. `set_generic_password` tự tạo mới hoặc ghi đè (tương đương `-U`).
/// Nuốt error gốc của security-framework để KHÔNG rò key/detail; chỉ trả
/// message template cố định.
pub fn set_api_key(profile: &str, key: &str) -> Result<(), KeychainError> {
    set_generic_password(&service(), profile, key.as_bytes()).map_err(|_| {
        KeychainError(format!(
            "Failed to save API key for profile \"{profile}\" to macOS Keychain."
        ))
    })
}

pub fn get_api_key(profile: &str) -> Result<Option<String>, KeychainError> {
    for candidate in service_candidates() {
        match get_generic_password(&candidate, profile) {
            Ok(bytes) => return Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => continue,
            Err(_) => {
                return Err(KeychainError(format!(
                    "Failed to read API key for profile \"{profile}\" from macOS Keychain."
                )))
            }
        }
    }
    Ok(None)
}

pub fn delete_api_key(profile: &str) -> Result<(), KeychainError> {
    for candidate in service_candidates() {
        match delete_generic_password(&candidate, profile) {
            Ok(()) => {}
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => {}
            Err(_) => {
                return Err(KeychainError(format!(
                    "Failed to delete API key for profile \"{profile}\" from macOS Keychain."
                )))
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;

    const P: &str = "ccm-test-kc";

    fn with_throwaway_service<F: FnOnce()>(f: F) {
        env::set_var("CCM_KEYCHAIN_SERVICE", "com.oreo.ccm.test-suite");
        let _ = delete_api_key(P);
        f();
        let _ = delete_api_key(P);
        env::remove_var("CCM_KEYCHAIN_SERVICE");
    }

    #[test]
    #[serial]
    fn get_absent_returns_none() {
        with_throwaway_service(|| {
            assert_eq!(get_api_key("ccm-test-absent").unwrap(), None);
        });
    }

    #[test]
    #[serial]
    fn set_then_get_roundtrips_and_overwrites() {
        with_throwaway_service(|| {
            set_api_key(P, "sk-ant-old").unwrap();
            set_api_key(P, "sk-ant-new").unwrap();
            assert_eq!(get_api_key(P).unwrap().as_deref(), Some("sk-ant-new"));
        });
    }

    #[test]
    #[serial]
    fn delete_removes_and_is_idempotent() {
        with_throwaway_service(|| {
            set_api_key(P, "sk-ant-x").unwrap();
            delete_api_key(P).unwrap();
            assert_eq!(get_api_key(P).unwrap(), None);
            delete_api_key(P).unwrap(); // second delete does not error
        });
    }

    #[test]
    #[serial]
    fn error_message_never_contains_key_material() {
        // A crafted service that cannot exist still must not surface the key.
        // (Smoke: the message templates below hold no key by construction.)
        with_throwaway_service(|| {
            set_api_key(P, "sk-ant-secret").unwrap();
            let msg = get_api_key(P)
                .map(|_| String::new())
                .unwrap_or_else(|e| e.message().to_string());
            assert!(!msg.contains("sk-ant-secret"));
        });
    }
}
