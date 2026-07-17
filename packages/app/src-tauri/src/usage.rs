use std::fs;
use std::path::{Path, PathBuf};

use chrono::DateTime;
use serde::Serialize;
use serde_json::Value;

use crate::store::profile_dir;

/// Cửa sổ rate-limit 5 giờ của Claude Code (khớp WINDOW_MS trong usage.ts).
pub const WINDOW_MS: i64 = 5 * 60 * 60 * 1000;

const CACHE_WRITE_5M_MULTIPLIER: f64 = 1.25;
const CACHE_WRITE_1H_MULTIPLIER: f64 = 2.0;
const CACHE_READ_MULTIPLIER: f64 = 0.1;

#[derive(Debug, Clone, PartialEq)]
pub struct UsageEntry {
    pub timestamp: i64,
    pub model: String,
    pub input_tokens: i64,
    pub cache_write_5m_tokens: i64,
    pub cache_write_1h_tokens: i64,
    pub cache_read_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUsage {
    pub profile: String,
    pub entries: i64,
    pub input_tokens: i64,
    pub cache_write_5m_tokens: i64,
    pub cache_write_1h_tokens: i64,
    pub cache_read_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub window_start: i64,
    pub reset_at: Option<i64>,
}

struct Price {
    input: f64,
    output: f64,
}

/// USD/1M token. Model lạ ⇒ None ⇒ cost 0. Khớp bảng PRICING trong usage.ts.
fn pricing(model: &str) -> Option<Price> {
    match model {
        "claude-opus-4-8" => Some(Price {
            input: 5.0,
            output: 25.0,
        }),
        "claude-sonnet-5" => Some(Price {
            input: 3.0,
            output: 15.0,
        }),
        "claude-haiku-4-5" => Some(Price {
            input: 1.0,
            output: 5.0,
        }),
        "claude-fable-5" => Some(Price {
            input: 10.0,
            output: 50.0,
        }),
        _ => None,
    }
}

/// Khớp num() của usage.ts: số hữu hạn thì lấy, còn lại 0.
fn num(v: Option<&Value>) -> i64 {
    match v.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => n as i64,
        _ => 0,
    }
}

pub fn parse_transcript_line(line: &str) -> Option<UsageEntry> {
    if line.trim().is_empty() {
        return None;
    }
    let parsed: Value = serde_json::from_str(line).ok()?;
    let obj = parsed.as_object()?;
    if obj.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let message = obj.get("message").and_then(Value::as_object)?;
    let usage = message.get("usage").and_then(Value::as_object)?;

    let ts_str = obj.get("timestamp").and_then(Value::as_str).unwrap_or("");
    let timestamp = DateTime::parse_from_rfc3339(ts_str)
        .ok()?
        .timestamp_millis();

    let (cw5m, cw1h) = match usage.get("cache_creation").and_then(Value::as_object) {
        Some(cc) => (
            num(cc.get("ephemeral_5m_input_tokens")),
            num(cc.get("ephemeral_1h_input_tokens")),
        ),
        // No breakdown ⇒ treat the whole amount as the cheaper 5-minute TTL.
        None => (num(usage.get("cache_creation_input_tokens")), 0),
    };

    Some(UsageEntry {
        timestamp,
        model: message
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        input_tokens: num(usage.get("input_tokens")),
        cache_write_5m_tokens: cw5m,
        cache_write_1h_tokens: cw1h,
        cache_read_tokens: num(usage.get("cache_read_input_tokens")),
        output_tokens: num(usage.get("output_tokens")),
    })
}

/// Cache multipliers áp lên giá INPUT, không bao giờ output. Khớp
/// estimateCostUsd() của usage.ts.
pub fn estimate_cost_usd(e: &UsageEntry) -> f64 {
    let p = match pricing(&e.model) {
        Some(p) => p,
        None => return 0.0,
    };
    let cost = e.input_tokens as f64 * p.input
        + e.cache_write_5m_tokens as f64 * p.input * CACHE_WRITE_5M_MULTIPLIER
        + e.cache_write_1h_tokens as f64 * p.input * CACHE_WRITE_1H_MULTIPLIER
        + e.cache_read_tokens as f64 * p.input * CACHE_READ_MULTIPLIER
        + e.output_tokens as f64 * p.output;
    cost / 1_000_000.0
}

/// Đệ quy tìm mọi *.jsonl dưới dir. Thư mục thiếu / lỗi đọc ⇒ bỏ qua.
///
/// Dùng `DirEntry::file_type()` (không theo symlink) thay vì `Path::is_dir()`
/// / `is_file()` (có theo symlink), khớp `Dirent.isDirectory()` /
/// `e.isFile()` của usage.ts — nếu không, một symlink dưới
/// `projects/` có thể đưa việc đọc/tính tiền transcript ra ngoài biên giới
/// profile trong khi CLI báo 0.
fn list_transcript_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        let path = entry.path();
        if ft.is_dir() {
            list_transcript_files(&path, out);
        } else if ft.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

/// Không bao giờ throw: tên không hợp lệ, thiếu thư mục, file hỏng đều chỉ
/// đóng góp 0. Khớp readProfileUsage() của usage.ts.
pub fn read_profile_usage(profile: &str, now_ms: i64) -> ProfileUsage {
    let window_start = now_ms - WINDOW_MS;
    let mut u = ProfileUsage {
        profile: profile.to_string(),
        entries: 0,
        input_tokens: 0,
        cache_write_5m_tokens: 0,
        cache_write_1h_tokens: 0,
        cache_read_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost_usd: 0.0,
        window_start,
        reset_at: None,
    };

    let projects = match profile_dir(profile) {
        Ok(d) => d.join("projects"),
        Err(_) => return u,
    };
    let mut files = Vec::new();
    list_transcript_files(&projects, &mut files);

    let mut earliest: Option<i64> = None;
    for file in files {
        let content = fs::read_to_string(&file).unwrap_or_default();
        for line in content.split('\n') {
            if let Some(e) = parse_transcript_line(line) {
                if e.timestamp >= window_start && e.timestamp <= now_ms {
                    u.entries += 1;
                    u.input_tokens += e.input_tokens;
                    u.cache_write_5m_tokens += e.cache_write_5m_tokens;
                    u.cache_write_1h_tokens += e.cache_write_1h_tokens;
                    u.cache_read_tokens += e.cache_read_tokens;
                    u.output_tokens += e.output_tokens;
                    u.cost_usd += estimate_cost_usd(&e);
                    earliest = Some(match earliest {
                        Some(x) => x.min(e.timestamp),
                        None => e.timestamp,
                    });
                }
            }
        }
    }

    u.total_tokens = u.input_tokens
        + u.cache_write_5m_tokens
        + u.cache_write_1h_tokens
        + u.cache_read_tokens
        + u.output_tokens;
    u.reset_at = earliest.map(|e| e + WINDOW_MS);
    u
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;

    fn opus(field: &str, n: i64) -> UsageEntry {
        let mut e = UsageEntry {
            timestamp: 0,
            model: "claude-opus-4-8".to_string(),
            input_tokens: 0,
            cache_write_5m_tokens: 0,
            cache_write_1h_tokens: 0,
            cache_read_tokens: 0,
            output_tokens: 0,
        };
        match field {
            "input" => e.input_tokens = n,
            "cw5m" => e.cache_write_5m_tokens = n,
            "cw1h" => e.cache_write_1h_tokens = n,
            "cr" => e.cache_read_tokens = n,
            "output" => e.output_tokens = n,
            _ => unreachable!(),
        }
        e
    }
    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "expected {b}, got {a}");
    }

    #[test]
    fn cost_input_rate() {
        approx(estimate_cost_usd(&opus("input", 1_000_000)), 5.0);
    }
    #[test]
    fn cost_output_rate() {
        approx(estimate_cost_usd(&opus("output", 1_000_000)), 25.0);
    }
    #[test]
    fn cost_cache_write_5m_multiplier_is_1_25() {
        approx(estimate_cost_usd(&opus("cw5m", 1_000_000)), 6.25);
    }
    #[test]
    fn cost_cache_write_1h_multiplier_is_2() {
        approx(estimate_cost_usd(&opus("cw1h", 1_000_000)), 10.0);
    }
    #[test]
    fn cost_cache_read_multiplier_is_0_1() {
        approx(estimate_cost_usd(&opus("cr", 1_000_000)), 0.5);
    }
    #[test]
    fn cost_unknown_model_is_zero() {
        let mut e = opus("input", 1_000_000);
        e.model = "future-model-x".to_string();
        approx(estimate_cost_usd(&e), 0.0);
    }

    #[test]
    fn parse_uses_cache_creation_object_when_present() {
        let line = r#"{"type":"assistant","timestamp":"2026-07-16T10:00:00.000Z","message":{"model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":999,"cache_creation":{"ephemeral_5m_input_tokens":8000,"ephemeral_1h_input_tokens":400}}}}"#;
        let e = parse_transcript_line(line).unwrap();
        assert_eq!(e.cache_write_5m_tokens, 8000);
        assert_eq!(e.cache_write_1h_tokens, 400);
    }
    #[test]
    fn parse_falls_back_to_flat_cache_creation_input_tokens() {
        let line = r#"{"type":"assistant","timestamp":"2026-07-16T10:00:00.000Z","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":2000}}}"#;
        let e = parse_transcript_line(line).unwrap();
        assert_eq!(e.cache_write_5m_tokens, 2000);
        assert_eq!(e.cache_write_1h_tokens, 0);
    }
    #[test]
    fn parse_rejects_non_assistant_bad_json_and_bad_timestamp() {
        assert!(parse_transcript_line(r#"{"type":"user","message":{}}"#).is_none());
        assert!(parse_transcript_line(r#"{"type":"summary"}"#).is_none());
        assert!(parse_transcript_line("not json").is_none());
        assert!(parse_transcript_line("").is_none());
        assert!(parse_transcript_line(
            r#"{"type":"assistant","timestamp":"nope","message":{"model":"x","usage":{"input_tokens":1}}}"#
        )
        .is_none());
    }

    #[test]
    #[serial]
    fn read_profile_usage_matches_golden_contract_fixture() {
        // Golden test dùng chung packages/contract-fixtures/.
        let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("contract-fixtures");
        let expected: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(fixtures.join("expected-usage.json")).unwrap(),
        )
        .unwrap();

        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        let proj = crate::store::profile_dir("work")
            .unwrap()
            .join("projects")
            .join("demo");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::copy(
            fixtures.join("transcript.jsonl"),
            proj.join("session.jsonl"),
        )
        .unwrap();

        let now = expected["nowMs"].as_i64().unwrap();
        let u = read_profile_usage("work", now);
        env::remove_var("CCM_HOME");

        let ex = &expected["usage"];
        assert_eq!(u.entries, ex["entries"].as_i64().unwrap());
        assert_eq!(u.input_tokens, ex["inputTokens"].as_i64().unwrap());
        assert_eq!(
            u.cache_write_5m_tokens,
            ex["cacheWrite5mTokens"].as_i64().unwrap()
        );
        assert_eq!(
            u.cache_write_1h_tokens,
            ex["cacheWrite1hTokens"].as_i64().unwrap()
        );
        assert_eq!(u.cache_read_tokens, ex["cacheReadTokens"].as_i64().unwrap());
        assert_eq!(u.output_tokens, ex["outputTokens"].as_i64().unwrap());
        assert_eq!(u.total_tokens, ex["totalTokens"].as_i64().unwrap());
        assert!((u.cost_usd - ex["costUsd"].as_f64().unwrap()).abs() < 1e-9);
        assert_eq!(u.reset_at, Some(ex["resetAtMs"].as_i64().unwrap()));
    }

    #[test]
    #[serial]
    fn read_profile_usage_excludes_before_window_and_missing_dir() {
        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        crate::store::add_profile("fresh", crate::store::ProfileKind::Subscription).unwrap();
        let u = read_profile_usage("fresh", 1_784_203_200_000);
        env::remove_var("CCM_HOME");
        assert_eq!(u.entries, 0);
        assert_eq!(u.total_tokens, 0);
        assert_eq!(u.reset_at, None);
    }

    /// Regression: the transcript walker must use `DirEntry::file_type()`
    /// (not `Path::is_dir()`/`is_file()`, which follow symlinks), so a
    /// symlinked directory or file under `projects/` can never pull
    /// transcripts from outside the profile boundary into the app's
    /// usage/cost numbers — matching TS's `Dirent.isDirectory()`/`isFile()`,
    /// which describe the directory entry itself and skip symlinks.
    #[test]
    #[serial]
    fn list_transcript_files_ignores_symlinked_dir_and_file() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        env::set_var("CCM_HOME", dir.path());
        crate::store::add_profile("work", crate::store::ProfileKind::Subscription).unwrap();

        // Outside-the-profile tree holding a real, billable transcript.
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let outside_transcript = outside.join("session.jsonl");
        std::fs::write(
            &outside_transcript,
            r#"{"type":"assistant","timestamp":"2026-07-16T10:00:00.000Z","message":{"model":"claude-opus-4-8","usage":{"input_tokens":777,"output_tokens":0}}}"#,
        )
        .unwrap();

        let projects = crate::store::profile_dir("work").unwrap().join("projects");
        std::fs::create_dir_all(&projects).unwrap();
        // Symlinked directory escaping the profile.
        symlink(&outside, projects.join("link-dir")).unwrap();
        // Symlinked .jsonl file escaping the profile directly.
        symlink(&outside_transcript, projects.join("link-file.jsonl")).unwrap();

        let now = DateTime::parse_from_rfc3339("2026-07-16T12:00:00.000Z")
            .unwrap()
            .timestamp_millis();
        let u = read_profile_usage("work", now);
        env::remove_var("CCM_HOME");

        assert_eq!(
            u.entries, 0,
            "symlinked dir/file must be ignored, not walked/counted"
        );
        assert_eq!(u.input_tokens, 0);
        assert_eq!(u.total_tokens, 0);
    }
}
