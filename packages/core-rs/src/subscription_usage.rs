use chrono::DateTime;
use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
use security_framework::passwords::get_generic_password;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const OAUTH_USAGE_ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_PROFILE_ENDPOINT: &str = "https://api.anthropic.com/api/oauth/profile";
const MAX_USAGE_RESPONSE_BYTES: u64 = 128 * 1024;
const CLAUDE_KEYCHAIN_SERVICE_PREFIX: &str = "Claude Code-credentials-";
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialReadError {
    Missing,
    McpOAuthOnly,
    MissingRequiredScope,
    KeychainAccessRequired,
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OAuthCredentials {
    access_token: String,
}

pub struct HttpUsageResponse {
    status: u16,
    body: String,
    retry_after_ms: Option<i64>,
}

impl HttpUsageResponse {
    #[cfg(test)]
    fn new(status: u16, body: &str, retry_after_ms: Option<i64>) -> Self {
        Self {
            status,
            body: body.to_string(),
            retry_after_ms,
        }
    }
}

fn credentials_from_json(value: &[u8]) -> Result<Option<OAuthCredentials>, CredentialReadError> {
    let credential =
        serde_json::from_slice::<Value>(value).map_err(|_| CredentialReadError::Unreadable)?;
    let Some(oauth) = credential.get("claudeAiOauth").and_then(Value::as_object) else {
        return if credential.get("mcpOAuth").is_some() {
            Err(CredentialReadError::McpOAuthOnly)
        } else {
            Ok(None)
        };
    };
    let access_token = oauth
        .get("accessToken")
        .and_then(Value::as_str)
        .map(str::trim)
        // Claude Code owns this credential format. Its OAuth token prefix is
        // not a stable OreoDeck contract, so accept any nonempty token just
        // as CodexBar does and let Anthropic's OAuth API validate it.
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .ok_or(CredentialReadError::Unreadable)?;
    let scopes = oauth
        .get("scopes")
        .and_then(Value::as_array)
        .map(|scopes| scopes.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    if !scopes.contains(&"user:profile") {
        return Err(CredentialReadError::MissingRequiredScope);
    }
    Ok(Some(OAuthCredentials { access_token }))
}

fn keychain_service_for_profile_path(path: &Path) -> String {
    let digest = Sha256::digest(path.as_os_str().as_encoded_bytes());
    let suffix = digest[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{CLAUDE_KEYCHAIN_SERVICE_PREFIX}{suffix}")
}

fn current_keychain_account() -> Result<String, CredentialReadError> {
    for name in ["USER", "LOGNAME"] {
        if let Ok(value) = env::var(name) {
            let value = value.trim();
            if !value.is_empty() {
                return Ok(value.to_string());
            }
        }
    }
    let output = Command::new("/usr/bin/id")
        .arg("-un")
        .output()
        .map_err(|_| CredentialReadError::Unreadable)?;
    if !output.status.success() {
        return Err(CredentialReadError::Unreadable);
    }
    let account = String::from_utf8(output.stdout).map_err(|_| CredentialReadError::Unreadable)?;
    let account = account.trim();
    (!account.is_empty())
        .then(|| account.to_string())
        .ok_or(CredentialReadError::Unreadable)
}

fn read_legacy_profile_oauth_credentials(
    profile_name: &str,
) -> Result<Option<OAuthCredentials>, CredentialReadError> {
    let credential_path = crate::store::profile_dir(profile_name)
        .map_err(|_| CredentialReadError::Unreadable)?
        .join(".credentials.json");
    let value = match fs::read(credential_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(CredentialReadError::Unreadable),
    };
    credentials_from_json(&value)
}

fn read_profile_oauth_credentials_with<F>(
    profile_name: &str,
    account: &str,
    read_keychain: F,
) -> Result<Option<OAuthCredentials>, CredentialReadError>
where
    F: FnOnce(&str, &str) -> Result<Option<Vec<u8>>, CredentialReadError>,
{
    let profile_path =
        crate::store::profile_dir(profile_name).map_err(|_| CredentialReadError::Unreadable)?;
    let service = keychain_service_for_profile_path(&profile_path);
    match read_keychain(&service, account)? {
        Some(value) => credentials_from_json(&value),
        None => read_legacy_profile_oauth_credentials(profile_name),
    }
}

/// OAuth credentials remain owned by Claude Code. Automatic refreshes never
/// access Claude Code's Keychain item, so OreoDeck cannot produce a macOS
/// authorization prompt in the background. A user-initiated refresh may.
fn read_profile_oauth_credentials_with_prompt(
    profile_name: &str,
    allow_keychain_prompt: bool,
) -> Result<Option<OAuthCredentials>, CredentialReadError> {
    if !allow_keychain_prompt {
        if let Some(credentials) = read_legacy_profile_oauth_credentials(profile_name)? {
            return Ok(Some(credentials));
        }
        let account = current_keychain_account()?;
        let profile_path =
            crate::store::profile_dir(profile_name).map_err(|_| CredentialReadError::Unreadable)?;
        let service = keychain_service_for_profile_path(&profile_path);
        return match read_keychain_password_without_prompt(&service, &account)? {
            Some(value) => credentials_from_json(&value),
            None => Err(CredentialReadError::KeychainAccessRequired),
        };
    }
    let account = current_keychain_account()?;
    read_profile_oauth_credentials_with(profile_name, &account, |service, account| {
        match get_generic_password(service, account) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(_) => Err(CredentialReadError::KeychainAccessRequired),
        }
    })
}

/// `kSecUseAuthenticationUISkip` is Keychain's noninteractive preflight: it
/// returns data only when this process is already allowed to decrypt the item.
/// It never presents a modal prompt in an automatic refresh.
fn read_keychain_password_without_prompt(
    service: &str,
    account: &str,
) -> Result<Option<Vec<u8>>, CredentialReadError> {
    let mut options = ItemSearchOptions::new();
    options
        .class(ItemClass::generic_password())
        .service(service)
        .account(account)
        .load_data(true)
        .skip_authenticated_items(true);
    match options.search() {
        Ok(results) => match results.into_iter().next() {
            Some(SearchResult::Data(value)) => Ok(Some(value)),
            _ => Ok(None),
        },
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(CredentialReadError::KeychainAccessRequired),
    }
}

/// Display-safe result from the experimental Claude OAuth usage endpoint.
/// It deliberately contains no credential, response body, account identity,
/// or transport diagnostics.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SubscriptionUsageLimitView {
    /// Stable API key for this quota bucket, such as `five_hour` or
    /// `seven_day_fable`. It is display-safe and contains no account data.
    pub id: String,
    /// A human-readable label derived locally from the bucket key.
    pub label: String,
    pub percent: Option<f64>,
    pub reset_at_ms: Option<i64>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct SubscriptionUsageSyncView {
    pub state: String,
    pub message: String,
    pub fetched_at_ms: Option<i64>,
    pub retry_after_ms: Option<i64>,
    pub five_hour_percent: Option<f64>,
    pub five_hour_reset_at_ms: Option<i64>,
    pub weekly_percent: Option<f64>,
    pub weekly_reset_at_ms: Option<i64>,
    pub extra_usage_spend_usd: Option<f64>,
    pub extra_usage_limit_usd: Option<f64>,
    /// Every quota window returned by Claude, including model-scoped limits
    /// such as Fable/Opus/Sonnet and future buckets the API adds.
    pub limits: Vec<SubscriptionUsageLimitView>,
}

fn view(state: &str, message: &str) -> SubscriptionUsageSyncView {
    SubscriptionUsageSyncView {
        state: state.to_string(),
        message: message.to_string(),
        fetched_at_ms: None,
        retry_after_ms: None,
        five_hour_percent: None,
        five_hour_reset_at_ms: None,
        weekly_percent: None,
        weekly_reset_at_ms: None,
        extra_usage_spend_usd: None,
        extra_usage_limit_usd: None,
        limits: Vec::new(),
    }
}

fn finite_number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

fn reset_at_ms(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_str)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|date| date.timestamp_millis())
}

fn parse_window(value: Option<&Value>) -> (Option<f64>, Option<i64>) {
    let Some(window) = value.and_then(Value::as_object) else {
        return (None, None);
    };
    (
        finite_number(
            window
                .get("utilization")
                .or_else(|| window.get("used_percentage"))
                .or_else(|| window.get("percent")),
        ),
        reset_at_ms(window.get("resets_at")),
    )
}

fn limit_label(id: &str) -> String {
    match id {
        "five_hour" => "5-hour".to_string(),
        "seven_day" => "Weekly".to_string(),
        "spend" | "usage_credit" | "usage_credits" => "Usage credits".to_string(),
        _ => {
            let weekly = id.strip_prefix("seven_day_");
            let words = weekly
                .unwrap_or(id)
                .split('_')
                .filter(|word| !word.is_empty())
                .map(|word| {
                    let mut characters = word.chars();
                    let Some(first) = characters.next() else {
                        return String::new();
                    };
                    format!("{}{}", first.to_uppercase(), characters.as_str())
                })
                .collect::<Vec<_>>()
                .join(" ");
            if weekly.is_some() {
                format!("{words} weekly")
            } else {
                words
            }
        }
    }
}

fn string_field<'a>(value: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn generic_limit_id(value: &serde_json::Map<String, Value>) -> Option<String> {
    let kind = string_field(value, &["kind", "type"]);
    let scope = value.get("scope");
    let scoped_model = scope
        .and_then(Value::as_object)
        .and_then(|scope| string_field(scope, &["model", "model_family", "name"]))
        .or_else(|| {
            scope
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .or_else(|| string_field(value, &["model", "model_family"]));

    match (kind, scoped_model) {
        (Some("session" | "five_hour"), _) => Some("five_hour".to_string()),
        (Some("weekly" | "weekly_all" | "seven_day"), _) => Some("seven_day".to_string()),
        (Some("weekly_scoped"), None) => Some("seven_day_fable".to_string()),
        (Some(kind), Some(model)) if kind.contains("week") || kind.contains("seven_day") => {
            Some(format!("seven_day_{}", model.replace(' ', "_")))
        }
        (Some(kind), _) => Some(kind.to_string()),
        (None, _) => string_field(value, &["id", "key", "name"]).map(str::to_string),
    }
}

fn parse_limits(root: &serde_json::Map<String, Value>) -> Vec<SubscriptionUsageLimitView> {
    let mut limits = root
        .iter()
        .filter(|(id, _)| id.as_str() != "extra_usage")
        .filter_map(|(id, value)| {
            let (percent, reset_at_ms) = parse_window(Some(value));
            (percent.is_some() || reset_at_ms.is_some()).then(|| SubscriptionUsageLimitView {
                id: id.to_string(),
                label: limit_label(id),
                percent,
                reset_at_ms,
            })
        })
        .collect::<Vec<_>>();
    if let Some(generic_limits) = root.get("limits").and_then(Value::as_array) {
        for value in generic_limits {
            let Some(value) = value.as_object() else {
                continue;
            };
            let Some(id) = generic_limit_id(value) else {
                continue;
            };
            if limits.iter().any(|limit| limit.id == id) {
                continue;
            }
            let (percent, reset_at_ms) = parse_window(Some(&Value::Object(value.clone())));
            if percent.is_some() || reset_at_ms.is_some() {
                limits.push(SubscriptionUsageLimitView {
                    label: limit_label(&id),
                    id,
                    percent,
                    reset_at_ms,
                });
            }
        }
    }
    limits.sort_by(|left, right| {
        let rank = |id: &str| match id {
            "five_hour" => 0,
            "seven_day" => 1,
            _ => 2,
        };
        rank(&left.id)
            .cmp(&rank(&right.id))
            .then_with(|| left.id.cmp(&right.id))
    });
    limits
}

fn parse_connected_usage(body: &str, fetched_at_ms: i64) -> SubscriptionUsageSyncView {
    let Ok(root) = serde_json::from_str::<Value>(body) else {
        return view(
            "cannot-verify",
            "Claude returned an unreadable usage response.",
        );
    };
    let Some(root) = root.as_object() else {
        return view(
            "cannot-verify",
            "Claude returned an unreadable usage response.",
        );
    };
    let limits = parse_limits(root);
    if limits.is_empty() {
        return view(
            "cannot-verify",
            "Claude did not return subscription usage for this profile.",
        );
    }
    let five_hour = limits.iter().find(|limit| limit.id == "five_hour");
    let weekly = limits.iter().find(|limit| limit.id == "seven_day");
    let extra_usage = root.get("extra_usage").and_then(Value::as_object);
    let mut result = view("connected", "Connected — subscription usage is live.");
    result.fetched_at_ms = Some(fetched_at_ms);
    result.five_hour_percent = five_hour.and_then(|limit| limit.percent);
    result.five_hour_reset_at_ms = five_hour.and_then(|limit| limit.reset_at_ms);
    result.weekly_percent = weekly.and_then(|limit| limit.percent);
    result.weekly_reset_at_ms = weekly.and_then(|limit| limit.reset_at_ms);
    result.extra_usage_spend_usd = extra_usage
        .and_then(|usage| finite_number(usage.get("used_usd").or_else(|| usage.get("spend_usd"))));
    result.extra_usage_limit_usd = extra_usage.and_then(|usage| {
        finite_number(
            usage
                .get("monthly_limit_usd")
                .or_else(|| usage.get("limit_usd")),
        )
    });
    result.limits = limits;
    result
}

pub fn usage_sync_from_response(
    status: u16,
    body: &str,
    fetched_at_ms: i64,
    retry_after_ms: Option<i64>,
) -> SubscriptionUsageSyncView {
    match status {
        200..=299 => parse_connected_usage(body, fetched_at_ms),
        401 | 403 => view("needs-sign-in", "Sign in again to refresh this profile."),
        429 => {
            let mut result = view(
                "rate-limited",
                "Claude asked OreoDeck to wait before refreshing.",
            );
            result.retry_after_ms = retry_after_ms;
            result
        }
        _ => view(
            "cannot-verify",
            "Claude returned an unexpected usage response.",
        ),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn retry_after_ms(response: &ureq::Response, now_ms: i64) -> Option<i64> {
    response
        .header("Retry-After")
        .and_then(|value| value.trim().parse::<u64>().ok())
        .and_then(|seconds| i64::try_from(seconds).ok())
        .and_then(|seconds| seconds.checked_mul(1_000))
        .and_then(|delay| now_ms.checked_add(delay))
}

fn response_from_ureq(response: ureq::Response, now_ms: i64) -> Result<HttpUsageResponse, ()> {
    let status = response.status();
    let retry_after_ms = retry_after_ms(&response, now_ms);
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_USAGE_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > MAX_USAGE_RESPONSE_BYTES {
        return Err(());
    }
    let body = String::from_utf8(bytes).map_err(|_| ())?;
    Ok(HttpUsageResponse {
        status,
        body,
        retry_after_ms,
    })
}

fn request_oauth_endpoint(
    endpoint: &str,
    token: &str,
    now_ms: i64,
) -> Result<HttpUsageResponse, ()> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .build();
    let request = agent
        .get(endpoint)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", "oauth-2025-04-20");
    match request.call() {
        Ok(response) => response_from_ureq(response, now_ms),
        Err(ureq::Error::Status(_, response)) => response_from_ureq(response, now_ms),
        Err(_) => Err(()),
    }
}

fn request_oauth_usage_and_profile(
    token: &str,
    now_ms: i64,
) -> Result<(HttpUsageResponse, HttpUsageResponse), ()> {
    let profile = request_oauth_endpoint(OAUTH_PROFILE_ENDPOINT, token, now_ms)?;
    let usage = request_oauth_endpoint(OAUTH_USAGE_ENDPOINT, token, now_ms)?;
    Ok((profile, usage))
}

fn subscription_usage_sync_with<R, H>(
    profile_name: &str,
    read_credential: R,
    get: H,
    now_ms: i64,
) -> Result<SubscriptionUsageSyncView, crate::store::StoreError>
where
    R: FnOnce(&str) -> Result<Option<OAuthCredentials>, CredentialReadError>,
    H: FnOnce(&str, &str) -> Result<(HttpUsageResponse, HttpUsageResponse), ()>,
{
    let profile = crate::store::get_profile(profile_name)?
        .ok_or_else(|| crate::store::StoreError::NotFound(profile_name.to_string()))?;
    if profile.kind != crate::store::ProfileKind::Subscription {
        return Ok(view(
            "cannot-verify",
            "Only subscription profiles can refresh Claude usage.",
        ));
    }
    let credentials = match read_credential(&profile.name) {
        Ok(Some(credentials)) => credentials,
        Ok(None) => {
            return Ok(view(
                "needs-sign-in",
                "Sign in again to refresh this profile.",
            ));
        }
        Err(CredentialReadError::Missing) => {
            return Ok(view(
                "needs-sign-in",
                "Sign in again to refresh this profile.",
            ));
        }
        Err(CredentialReadError::McpOAuthOnly) => {
            return Ok(view(
                "oauth-mcp-only",
                "Claude Code has MCP OAuth state only. Run /login again to restore Claude OAuth.",
            ));
        }
        Err(CredentialReadError::MissingRequiredScope) => {
            return Ok(view(
                "oauth-missing-scope",
                "Claude OAuth is missing user:profile. Run /login again to reauthorize this profile.",
            ));
        }
        Err(CredentialReadError::KeychainAccessRequired) => {
            return Ok(view(
                "keychain-access-needed",
                "Allow OreoDeck to access Claude Code-credentials, then refresh this profile.",
            ));
        }
        Err(CredentialReadError::Unreadable) => {
            return Ok(view(
                "cannot-verify",
                "OreoDeck could not safely read this profile's login state.",
            ));
        }
    };
    match get(&profile.name, &credentials.access_token) {
        Ok((profile_response, usage_response))
            if (200..=299).contains(&profile_response.status) =>
        {
            let result = usage_sync_from_response(
                usage_response.status,
                &usage_response.body,
                now_ms,
                usage_response.retry_after_ms,
            );
            Ok(result)
        }
        Ok((profile_response, _)) if matches!(profile_response.status, 401 | 403) => Ok(view(
            "needs-sign-in",
            "Sign in again to refresh this profile.",
        )),
        Ok((_profile_response, _)) => Ok(view(
            "cannot-verify",
            "Claude could not verify the account for this profile.",
        )),
        Err(()) => Ok(view(
            "cannot-verify",
            "OreoDeck could not reach Claude to verify this profile.",
        )),
    }
}

pub fn get_subscription_usage_sync(
    profile_name: &str,
    allow_keychain_prompt: bool,
) -> Result<SubscriptionUsageSyncView, crate::store::StoreError> {
    let now_ms = now_ms();
    subscription_usage_sync_with(
        profile_name,
        |name| read_profile_oauth_credentials_with_prompt(name, allow_keychain_prompt),
        |_, token| request_oauth_usage_and_profile(token, now_ms),
        now_ms,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        keychain_service_for_profile_path, read_profile_oauth_credentials_with,
        read_profile_oauth_credentials_with_prompt, subscription_usage_sync_with,
        usage_sync_from_response, CredentialReadError, HttpUsageResponse,
    };
    use serial_test::serial;
    use std::env;

    #[test]
    fn unauthorized_response_requires_sign_in_without_exposing_a_token() {
        let result = usage_sync_from_response(401, "", 1_700_000_000_000, None);

        assert_eq!(result.state, "needs-sign-in");
        assert_eq!(result.message, "Sign in again to refresh this profile.");
        assert!(!result.message.contains("sk-ant-"));
    }

    #[test]
    fn successful_response_maps_live_windows_and_extra_usage() {
        let body = r#"{
          "five_hour":{"utilization":37.0,"resets_at":"2026-08-03T13:00:00Z"},
          "seven_day":{"utilization":12.0,"resets_at":"2026-08-08T13:00:00Z"},
          "extra_usage":{"used_usd":2.5,"monthly_limit_usd":10.0}
        }"#;

        let result = usage_sync_from_response(200, body, 1_700_000_000_000, None);

        assert_eq!(result.state, "connected");
        assert_eq!(result.five_hour_percent, Some(37.0));
        assert_eq!(result.weekly_percent, Some(12.0));
        assert_eq!(result.limits.len(), 2);
        assert_eq!(result.limits[0].id, "five_hour");
        assert_eq!(result.limits[1].id, "seven_day");
        assert_eq!(result.extra_usage_spend_usd, Some(2.5));
        assert_eq!(result.extra_usage_limit_usd, Some(10.0));
    }

    #[test]
    fn model_specific_limit_is_live_even_when_the_standard_windows_are_absent() {
        let body = r#"{
          "seven_day_fable":{"utilization":63.0,"resets_at":"2026-08-10T13:00:00Z"}
        }"#;

        let result = usage_sync_from_response(200, body, 1_700_000_000_000, None);

        assert_eq!(result.state, "connected");
        assert_eq!(result.limits.len(), 1);
        assert_eq!(result.limits[0].id, "seven_day_fable");
        assert_eq!(result.limits[0].label, "Fable weekly");
        assert_eq!(result.limits[0].percent, Some(63.0));
    }

    #[test]
    fn generic_limits_array_is_supported_for_future_model_buckets() {
        let body = r#"{
          "limits":[{
            "kind":"weekly_scoped",
            "scope":{"model":"fable"},
            "utilization":63.0,
            "resets_at":"2026-08-10T13:00:00Z"
          }]
        }"#;

        let result = usage_sync_from_response(200, body, 1_700_000_000_000, None);

        assert_eq!(result.state, "connected");
        assert_eq!(result.limits.len(), 1);
        assert_eq!(result.limits[0].id, "seven_day_fable");
        assert_eq!(result.limits[0].label, "Fable weekly");
    }

    #[test]
    fn generic_limits_array_labels_usage_credits_and_string_scoped_model() {
        let body = r#"{
          "limits": [
            {
              "kind": "spend",
              "utilization": 0.0,
              "resets_at": null
            },
            {
              "kind": "weekly_scoped",
              "scope": "fable",
              "utilization": 49.0,
              "resets_at": "2026-08-10T13:00:00Z"
            }
          ]
        }"#;

        let result = usage_sync_from_response(200, body, 1_000, None);

        let usage_credits = result
            .limits
            .iter()
            .find(|limit| limit.id == "spend")
            .expect("usage credits limit");
        assert_eq!(usage_credits.label, "Usage credits");

        let fable = result
            .limits
            .iter()
            .find(|limit| limit.id == "seven_day_fable")
            .expect("fable limit");
        assert_eq!(fable.label, "Fable weekly");
        assert_eq!(fable.percent, Some(49.0));
    }

    #[test]
    fn weekly_scoped_limit_without_scope_is_the_fable_weekly_limit() {
        let body = r#"{
          "limits": [{
            "kind": "weekly_scoped",
            "utilization": 49.0,
            "resets_at": "2026-08-10T13:00:00Z"
          }]
        }"#;

        let result = usage_sync_from_response(200, body, 1_000, None);

        assert_eq!(result.limits.len(), 1);
        assert_eq!(result.limits[0].id, "seven_day_fable");
        assert_eq!(result.limits[0].label, "Fable weekly");
    }

    #[test]
    #[serial]
    fn reads_only_the_selected_profiles_oauth_credentials() {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        crate::store::add_profile("work", crate::store::ProfileKind::Subscription).unwrap();
        std::fs::write(
            crate::store::profile_dir("work")
                .unwrap()
                .join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-profile-only","scopes":["user:profile"]}}"#,
        )
        .unwrap();

        let credentials = read_profile_oauth_credentials_with_prompt("work", false).unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(credentials.unwrap().access_token, "sk-ant-oat-profile-only");
    }

    #[test]
    #[serial]
    fn reads_the_selected_profiles_oauth_token_from_its_hashed_keychain_service() {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        crate::store::add_profile("work", crate::store::ProfileKind::Subscription).unwrap();
        let mut requested_service = None;

        let credentials =
            read_profile_oauth_credentials_with("work", "local-user", |service, account| {
                requested_service = Some((service.to_string(), account.to_string()));
                Ok(Some(
                    br#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-keychain-only","scopes":["user:profile"]}}"#.to_vec(),
                ))
            })
            .unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(
            credentials.unwrap().access_token,
            "sk-ant-oat-keychain-only"
        );
        assert_eq!(
            requested_service,
            Some((
                keychain_service_for_profile_path(&dir.path().join("profiles/work")),
                "local-user".to_string()
            ))
        );
    }

    #[test]
    fn accepts_a_nonempty_claude_code_oauth_token_without_assuming_its_prefix() {
        let credentials = read_profile_oauth_credentials_with("work", "local-user", |_, _| {
            Ok(Some(
                br#"{"claudeAiOauth":{"accessToken":"oauth-token-format-owned-by-claude-code","scopes":["user:profile"]}}"#.to_vec(),
            ))
        })
        .unwrap();

        assert_eq!(
            credentials.unwrap().access_token,
            "oauth-token-format-owned-by-claude-code"
        );
    }

    #[test]
    fn keychain_service_hashes_the_absolute_claude_config_directory() {
        assert_eq!(
            keychain_service_for_profile_path(std::path::Path::new(
                "/Users/quanguyen/.oreodeck/profiles/work"
            )),
            "Claude Code-credentials-1a38f640"
        );
    }

    #[test]
    fn mcp_only_credentials_require_reauthentication() {
        let error = read_profile_oauth_credentials_with("work", "local-user", |_, _| {
            Ok(Some(br#"{"mcpOAuth":{"server":"example"}}"#.to_vec()))
        })
        .unwrap_err();

        assert_eq!(error, CredentialReadError::McpOAuthOnly);
    }

    #[test]
    fn oauth_without_user_profile_scope_requires_reauthentication() {
        let error = read_profile_oauth_credentials_with("work", "local-user", |_, _| {
            Ok(Some(br#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-token","scopes":["user:inference"]}}"#.to_vec()))
        })
        .unwrap_err();

        assert_eq!(error, CredentialReadError::MissingRequiredScope);
    }

    #[test]
    #[serial]
    fn a_missing_selected_profile_credential_never_calls_the_usage_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        crate::store::add_profile("work", crate::store::ProfileKind::Subscription).unwrap();
        let mut requests = 0;

        let result = subscription_usage_sync_with(
            "work",
            |_| Ok(None),
            |_, _| {
                requests += 1;
                Ok((
                    HttpUsageResponse::new(200, "{}", None),
                    HttpUsageResponse::new(200, "{}", None),
                ))
            },
            1_700_000_000_000,
        )
        .unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(result.state, "needs-sign-in");
        assert_eq!(requests, 0);
    }

    #[test]
    #[serial]
    fn profile_endpoint_must_verify_the_oauth_account_before_usage_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        crate::store::add_profile("work", crate::store::ProfileKind::Subscription).unwrap();

        let result = subscription_usage_sync_with(
            "work",
            |_| {
                read_profile_oauth_credentials_with("work", "local-user", |_, _| {
                    Ok(Some(br#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-token","scopes":["user:profile"]}}"#.to_vec()))
                })
            },
            |_, _| {
                Ok((
                    HttpUsageResponse::new(403, "", None),
                    HttpUsageResponse::new(
                        200,
                        r#"{"seven_day":{"utilization":20.0}}"#,
                        None,
                    ),
                ))
            },
            1_700_000_000_000,
        )
        .unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(result.state, "needs-sign-in");
        assert_eq!(result.weekly_percent, None);
    }

    #[test]
    #[serial]
    fn subscription_usage_does_not_write_a_diagnostic_log() {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("HOME", dir.path());
        env::set_var("CCM_HOME", dir.path().join("legacy-ccm"));
        crate::store::add_profile("work", crate::store::ProfileKind::Subscription).unwrap();
        let mut requests = 0;

        let result = subscription_usage_sync_with(
            "work",
            |_| Err(CredentialReadError::KeychainAccessRequired),
            |_, _| {
                requests += 1;
                unreachable!("the API must not be called without Keychain access")
            },
            1_700_000_000_000,
        )
        .unwrap();
        let log_path = dir
            .path()
            .join(".oreodeck")
            .join("logs")
            .join("subscription-usage.log");
        env::remove_var("HOME");
        env::remove_var("CCM_HOME");

        assert_eq!(result.state, "keychain-access-needed");
        assert_eq!(requests, 0);
        assert!(!log_path.exists());
    }
}
