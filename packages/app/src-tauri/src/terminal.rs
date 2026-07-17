use std::process::Command;

use crate::store::assert_valid_name;

#[derive(Debug)]
pub struct TermError(String);

impl TermError {
    pub fn message(&self) -> &str {
        &self.0
    }
}

/// Escape một chuỗi để nhúng vào literal chuỗi kép của AppleScript. Profile
/// name là input bị ảnh hưởng bởi kẻ tấn công (có thể đến từ config.json sửa
/// tay), nên hàm này chạy SAU assert_valid_name như defense-in-depth — dù
/// NAME_RE đã cấm mọi ký tự mà hàm này escape.
pub fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn run_terminal(command: &str) -> Result<(), TermError> {
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
        escape_applescript(command)
    );
    let status = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status()
        .map_err(|_| TermError("Could not launch Terminal.app.".to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(TermError("Terminal.app returned an error.".to_string()))
    }
}

pub fn open_session(name: &str) -> Result<(), TermError> {
    assert_valid_name(name).map_err(|_| TermError("Invalid profile name.".to_string()))?;
    run_terminal(&format!("ccm claude -P {name}"))
}

pub fn open_login_terminal(name: &str) -> Result<(), TermError> {
    assert_valid_name(name).map_err(|_| TermError("Invalid profile name.".to_string()))?;
    run_terminal(&format!("ccm add {name}"))
}

/// Dò `ccm` trên PATH. Thiếu ⇒ frontend hiện banner hướng dẫn cài.
pub fn check_cli() -> bool {
    Command::new("sh")
        .arg("-c")
        .arg("command -v ccm")
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_applescript_escapes_backslash_and_quote() {
        assert_eq!(escape_applescript(r#"a"b\c"#), r#"a\"b\\c"#);
        assert_eq!(escape_applescript("plain"), "plain");
    }

    #[test]
    fn open_session_rejects_invalid_name_without_spawning() {
        // ".." fails assert_valid_name, so it never reaches osascript.
        assert!(open_session("../evil").is_err());
        assert!(open_login_terminal("bad name").is_err());
    }

    /// Regression/injection test: builds the same script template
    /// `run_terminal` uses (script GENERATION only — never executed here) with
    /// a payload crafted to break out of the `do script "..."` string literal
    /// and splice in a second AppleScript command via `& do shell script ...`.
    /// If `escape_applescript` regressed to a no-op, this test must fail.
    #[test]
    fn escape_applescript_neutralizes_applescript_injection_payload() {
        let malicious = r#"x" & do shell script "touch /tmp/pwned" & ""#;
        let script = format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
            escape_applescript(malicious)
        );

        // Count double quotes that are NOT escaped by a preceding backslash.
        // The template itself contributes exactly 4 such quotes: the pair
        // around "Terminal" and the pair opening/closing the do-script
        // literal. Any additional unescaped quote means attacker input broke
        // out of the literal.
        let mut unescaped_quotes = 0;
        let mut prev_was_backslash = false;
        for c in script.chars() {
            if c == '"' && !prev_was_backslash {
                unescaped_quotes += 1;
            }
            prev_was_backslash = c == '\\' && !prev_was_backslash;
        }
        assert_eq!(
            unescaped_quotes, 4,
            "payload escaped the do-script string literal: {script}"
        );

        // The specific break-out sequence must never appear verbatim.
        assert!(!script.contains("\" & do shell script \"touch /tmp/pwned\" & \"\""));
    }
}
