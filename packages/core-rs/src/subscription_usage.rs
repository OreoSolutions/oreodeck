use chrono::DateTime;
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const OAUTH_USAGE_ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
const MAX_USAGE_RESPONSE_BYTES: u64 = 128 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialReadError {
    Missing,
    Unreadable,
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

/// Reads the OAuth credential that belongs to exactly one OreoDeck profile.
/// The profile directory is the `CLAUDE_CONFIG_DIR` OreoDeck launches for this
/// identity, so intentionally never fall back to the ambient `~/.claude`.
pub fn read_profile_oauth_access_token(
    profile_name: &str,
) -> Result<Option<String>, CredentialReadError> {
    let credential_path = crate::store::profile_dir(profile_name)
        .map_err(|_| CredentialReadError::Unreadable)?
        .join(".credentials.json");
    let value = match fs::read_to_string(credential_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(CredentialReadError::Unreadable),
    };
    let credential =
        serde_json::from_str::<Value>(&value).map_err(|_| CredentialReadError::Unreadable)?;
    let token = credential
        .get("claudeAiOauth")
        .and_then(Value::as_object)
        .and_then(|oauth| oauth.get("accessToken"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|token| token.starts_with("sk-ant-oat-"))
        .map(str::to_owned);
    Ok(token)
}

/// Display-safe result from the experimental Claude OAuth usage endpoint.
/// It deliberately contains no credential, response body, account identity,
/// or transport diagnostics.
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
                .or_else(|| window.get("used_percentage")),
        ),
        reset_at_ms(window.get("resets_at")),
    )
}

fn parse_connected_usage(body: &str, fetched_at_ms: i64) -> SubscriptionUsageSyncView {
    let Ok(root) = serde_json::from_str::<Value>(body) else {
        return view(
            "cannot-verify",
            "Claude returned an unreadable usage response.",
        );
    };
    let (five_hour_percent, five_hour_reset_at_ms) = parse_window(root.get("five_hour"));
    let (weekly_percent, weekly_reset_at_ms) = parse_window(root.get("seven_day"));
    if five_hour_percent.is_none() && weekly_percent.is_none() {
        return view(
            "cannot-verify",
            "Claude did not return subscription usage for this profile.",
        );
    }
    let extra_usage = root.get("extra_usage").and_then(Value::as_object);
    let mut result = view("connected", "Connected — subscription usage is live.");
    result.fetched_at_ms = Some(fetched_at_ms);
    result.five_hour_percent = five_hour_percent;
    result.five_hour_reset_at_ms = five_hour_reset_at_ms;
    result.weekly_percent = weekly_percent;
    result.weekly_reset_at_ms = weekly_reset_at_ms;
    result.extra_usage_spend_usd = extra_usage
        .and_then(|usage| finite_number(usage.get("used_usd").or_else(|| usage.get("spend_usd"))));
    result.extra_usage_limit_usd = extra_usage.and_then(|usage| {
        finite_number(
            usage
                .get("monthly_limit_usd")
                .or_else(|| usage.get("limit_usd")),
        )
    });
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

fn request_oauth_usage(token: &str, now_ms: i64) -> Result<HttpUsageResponse, ()> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .build();
    let request = agent
        .get(OAUTH_USAGE_ENDPOINT)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", "oauth-2025-04-20");
    match request.call() {
        Ok(response) => response_from_ureq(response, now_ms),
        Err(ureq::Error::Status(_, response)) => response_from_ureq(response, now_ms),
        Err(_) => Err(()),
    }
}

pub fn subscription_usage_sync_with<R, H>(
    profile_name: &str,
    read_credential: R,
    get: H,
    now_ms: i64,
) -> Result<SubscriptionUsageSyncView, crate::store::StoreError>
where
    R: FnOnce(&str) -> Result<Option<String>, CredentialReadError>,
    H: FnOnce(&str, &str) -> Result<HttpUsageResponse, ()>,
{
    let profile = crate::store::get_profile(profile_name)?
        .ok_or_else(|| crate::store::StoreError::NotFound(profile_name.to_string()))?;
    if profile.kind != crate::store::ProfileKind::Subscription {
        return Ok(view(
            "cannot-verify",
            "Only subscription profiles can refresh Claude usage.",
        ));
    }
    let token = match read_credential(&profile.name) {
        Ok(Some(token)) => token,
        Ok(None) => {
            return Ok(view(
                "needs-sign-in",
                "Sign in again to refresh this profile.",
            ))
        }
        Err(CredentialReadError::Missing) => {
            return Ok(view(
                "needs-sign-in",
                "Sign in again to refresh this profile.",
            ));
        }
        Err(CredentialReadError::Unreadable) => {
            return Ok(view(
                "cannot-verify",
                "OreoDeck could not safely read this profile's login state.",
            ));
        }
    };
    match get(&profile.name, &token) {
        Ok(response) => Ok(usage_sync_from_response(
            response.status,
            &response.body,
            now_ms,
            response.retry_after_ms,
        )),
        Err(()) => Ok(view(
            "cannot-verify",
            "OreoDeck could not reach Claude to verify this profile.",
        )),
    }
}

pub fn get_subscription_usage_sync(
    profile_name: &str,
) -> Result<SubscriptionUsageSyncView, crate::store::StoreError> {
    let now_ms = now_ms();
    subscription_usage_sync_with(
        profile_name,
        read_profile_oauth_access_token,
        |_, token| request_oauth_usage(token, now_ms),
        now_ms,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        read_profile_oauth_access_token, subscription_usage_sync_with, usage_sync_from_response,
        HttpUsageResponse,
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
        assert_eq!(result.extra_usage_spend_usd, Some(2.5));
        assert_eq!(result.extra_usage_limit_usd, Some(10.0));
    }

    #[test]
    #[serial]
    fn reads_only_the_selected_profiles_oauth_access_token() {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        crate::store::add_profile("work", crate::store::ProfileKind::Subscription).unwrap();
        std::fs::write(
            crate::store::profile_dir("work")
                .unwrap()
                .join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-profile-only"}}"#,
        )
        .unwrap();

        let token = read_profile_oauth_access_token("work").unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(token.as_deref(), Some("sk-ant-oat-profile-only"));
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
                Ok(HttpUsageResponse::new(200, "{}", None))
            },
            1_700_000_000_000,
        )
        .unwrap();
        env::remove_var("CCM_HOME");

        assert_eq!(result.state, "needs-sign-in");
        assert_eq!(requests, 0);
    }
}
