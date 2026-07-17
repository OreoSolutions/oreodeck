uniffi::setup_scaffolding!();

/// Mirrors the real ccm shape: a record with String, i64, Option<i64>.
#[derive(uniffi::Record)]
pub struct ProfileUsageView {
    pub profile: String,
    pub input_tokens: i64,
    pub reset_at_ms: Option<i64>,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CcmError {
    #[error("config corrupt")]
    ConfigCorrupt,
    #[error("not found: {name}")]
    NotFound { name: String },
}

/// Happy path: returns two records, one with reset_at_ms = Some, one with None.
#[uniffi::export]
pub fn get_usage() -> Result<Vec<ProfileUsageView>, CcmError> {
    Ok(vec![
        ProfileUsageView {
            profile: "work".to_string(),
            input_tokens: 12345,
            reset_at_ms: Some(1_784_200_000_000),
        },
        ProfileUsageView {
            profile: "personal".to_string(),
            input_tokens: 0,
            reset_at_ms: None,
        },
    ])
}

/// Error path: always returns a typed error so Swift can switch on it.
#[uniffi::export]
pub fn get_usage_failing() -> Result<Vec<ProfileUsageView>, CcmError> {
    Err(CcmError::NotFound {
        name: "ghost".to_string(),
    })
}
