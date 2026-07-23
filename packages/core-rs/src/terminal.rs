use std::env;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
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

/// `do script` chạy lệnh bên trong Terminal.app, tức là qua **login shell**
/// của user (Terminal luôn khởi động shell với `-l`, re-source `.zprofile`
/// v.v.), khác với process của app (khởi động bởi launchd, PATH tối giản).
/// Vì vậy lệnh `ccm ...` trần trong `command` bên dưới là AN TOÀN — login
/// shell đã có `/usr/local/bin`, `/opt/homebrew/bin`, `~/.bun/bin` trên PATH
/// từ profile của user. Điều này KHÔNG đúng cho `check_cli()`, vốn chạy
/// trong process của chính app (không qua Terminal), nên hàm đó phải tự
/// augment PATH — xem comment ở `check_cli`.
fn run_terminal_app(command: &str) -> Result<(), TermError> {
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

fn run_iterm(command: &str) -> Result<(), TermError> {
    let script = format!(
        "tell application \"iTerm2\"\nactivate\nset newWindow to (create window with default profile)\ntell current session of newWindow to write text \"{}\"\nend tell",
        escape_applescript(command)
    );
    let status = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|_| TermError("Could not launch iTerm2.".to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(TermError("iTerm2 returned an error.".to_string()))
    }
}

fn run_ghostty(command: &str) -> Result<(), TermError> {
    let keep_open = format!("{command}; exec /bin/zsh -l");
    let status = Command::new("open")
        .args(["-na", "Ghostty", "--args", "-e", "/bin/zsh", "-lic"])
        .arg(keep_open)
        .status()
        .map_err(|_| TermError("Could not launch Ghostty.".to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(TermError("Ghostty returned an error.".to_string()))
    }
}

fn run_open_terminal(app: &str, arguments: &[&str], command: &str) -> Result<(), TermError> {
    let keep_open = format!("{command}; exec /bin/zsh -l");
    let mut process = Command::new("open");
    process.args(["-na", app, "--args"]);
    process.args(arguments);
    process.args(["/bin/zsh", "-lic"]);
    process.arg(keep_open);
    let status = process
        .status()
        .map_err(|_| TermError(format!("Could not launch {app}.")))?;
    if status.success() {
        Ok(())
    } else {
        Err(TermError(format!("{app} returned an error.")))
    }
}

fn open_window_only(app: &str) -> Result<(), TermError> {
    let status = Command::new("open")
        .args(["-na", app])
        .status()
        .map_err(|_| TermError(format!("Could not launch {app}.")))?;
    if status.success() {
        Ok(())
    } else {
        Err(TermError(format!("{app} returned an error.")))
    }
}

pub fn open_command(command: &str) -> Result<(), TermError> {
    match crate::store::get_terminal()
        .map_err(|_| TermError("Could not read the terminal setting.".to_string()))?
        .as_str()
    {
        "ghostty" => run_ghostty(command),
        "iterm2" => run_iterm(command),
        "wezterm" => {
            run_open_terminal("WezTerm", &["start", "--always-new-process", "--"], command)
        }
        "alacritty" => run_open_terminal("Alacritty", &["-e"], command),
        "kitty" => run_open_terminal("kitty", &[], command),
        "warp" => open_window_only("Warp"),
        "hyper" => open_window_only("Hyper"),
        "tabby" => open_window_only("Tabby"),
        "rio" => open_window_only("Rio"),
        "wave" => open_window_only("Wave"),
        _ => run_terminal_app(command),
    }
}

/// `name` đi qua HAI lớp phòng thủ độc lập trước khi tới tiến trình con.
/// Lớp (1): `assert_valid_name` (charset `NAME_RE`), gọi NGAY TRƯỚC khi
/// `name` được nội suy vào chuỗi lệnh shell `format!("ccm claude -P
/// {name}")` bên dưới, đảm bảo không ký tự shell metacharacter nào (`$()`,
/// backtick, `;`, khoảng trắng, dấu ngoặc) lọt vào `do script`, vốn được
/// Terminal thực thi qua login shell của user. Lớp (2): `escape_applescript`
/// (gọi bên trong `run_terminal`) — escape lớp AppleScript string-literal,
/// độc lập với lớp shell ở trên. Nếu `NAME_RE` từng bị nới lỏng mà thiếu lớp
/// (1) ở đây, injection sẽ mở lại một cách âm thầm dù lớp (2) vẫn escape
/// đúng AppleScript.
pub fn open_session(name: &str) -> Result<(), TermError> {
    assert_valid_name(name).map_err(|_| TermError("Invalid profile name.".to_string()))?;
    open_command(&format!("oreodeck run -P {name}"))
}

/// Xem comment ở `open_session` — cùng hai lớp phòng thủ, cùng lý do.
pub fn open_login_terminal(name: &str) -> Result<(), TermError> {
    assert_valid_name(name).map_err(|_| TermError("Invalid profile name.".to_string()))?;
    open_command(&format!("oreodeck add {name}"))
}

/// True nếu `name_dir/name` tồn tại và là file có ít nhất một execute bit
/// (owner/group/other) — không shell-out, chỉ đọc metadata.
fn is_executable_file(dir: &Path, name: &str) -> bool {
    let candidate = dir.join(name);
    match fs::metadata(&candidate) {
        Ok(meta) => meta.is_file() && meta.permissions().mode() & 0o111 != 0,
        Err(_) => false,
    }
}

/// Dò `ccm` trong tập ứng viên `dirs` (không đụng filesystem thật ngoài
/// những gì được truyền vào) — tách riêng để test không phải ghi vào
/// `/usr/local/bin` thật.
fn check_cli_in(dirs: &[PathBuf]) -> bool {
    dirs.iter().any(|dir| {
        is_executable_file(dir, "oreodeck")
            || is_executable_file(dir, "ord")
            || is_executable_file(dir, "ccm")
    })
}

/// Các thư mục cài đặt phổ biến cho `ccm` (bun CLI) mà launchd KHÔNG đưa
/// vào PATH tối giản của GUI app (`/usr/bin:/bin:/usr/sbin:/sbin`).
fn well_known_install_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ];
    if let Some(home) = env::var_os("HOME") {
        dirs.push(PathBuf::from(&home).join(".local/bin"));
        dirs.push(PathBuf::from(home).join(".bun/bin"));
    }
    dirs
}

/// Dò `ccm`: PATH của process HIỆN TẠI (cộng) các thư mục cài đặt phổ biến.
/// App bị launchd khởi động (từ Finder/Dock/Launchpad) nhận PATH tối giản
/// (không có `/usr/local/bin`, `/opt/homebrew/bin`, `~/.bun/bin`), nên chỉ
/// tin PATH kế thừa sẽ false-negative dù `ccm` đã cài và chạy tốt từ
/// terminal. Kiểm tra trực tiếp bằng `fs::metadata` (execute bit), không
/// shell-out — tránh lệ thuộc lại vào PATH của một shell con.
pub fn check_cli() -> bool {
    let mut dirs: Vec<PathBuf> = env::var_os("PATH")
        .map(|p| env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.extend(well_known_install_dirs());
    check_cli_in(&dirs)
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

    /// Regression test for the terminal.rs layer's own shell-metacharacter
    /// defense: `assert_valid_name` must reject this payload from *inside*
    /// `open_session`/`open_login_terminal` themselves, not merely because
    /// some caller upstream happened to pre-filter it.
    #[test]
    fn open_session_rejects_shell_metacharacter_payload_from_terminal_fn_itself() {
        let payload = "$(touch /tmp/pwned)";
        assert!(open_session(payload).is_err());
        assert!(open_login_terminal(payload).is_err());
    }

    /// `check_cli_in` must not find `ccm` when the well-known dir list is
    /// empty and the process PATH doesn't contain it either (simulated by
    /// simply passing an empty candidate list).
    #[test]
    fn check_cli_in_returns_false_when_no_candidate_dir_has_ccm() {
        assert!(!check_cli_in(&[]));
    }

    /// Simulates launchd's minimal-PATH reality: `ccm` is absent from the
    /// (stripped) process PATH but present in a stand-in "well-known" dir
    /// (a tempdir, so the test never touches the real /usr/local/bin).
    #[test]
    fn check_cli_in_finds_ccm_in_a_well_known_dir_even_when_path_lacks_it() {
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("ccm");
        fs::write(&shim, "#!/bin/sh\necho ok\n").unwrap();
        let mut perms = fs::metadata(&shim).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&shim, perms).unwrap();

        // Stripped PATH candidates (no shim here) + the well-known stand-in.
        let stripped_path_dirs = vec![PathBuf::from("/usr/bin"), PathBuf::from("/bin")];
        assert!(!check_cli_in(&stripped_path_dirs));

        let mut dirs = stripped_path_dirs;
        dirs.push(dir.path().to_path_buf());
        assert!(check_cli_in(&dirs));
    }

    /// A file without the execute bit must not count as `ccm` being
    /// "installed" — `is_executable_file` checks permissions, not just
    /// existence.
    #[test]
    fn check_cli_in_ignores_non_executable_file_named_ccm() {
        let dir = tempfile::tempdir().unwrap();
        let not_exec = dir.path().join("ccm");
        fs::write(&not_exec, "not a real binary").unwrap();
        let mut perms = fs::metadata(&not_exec).unwrap().permissions();
        perms.set_mode(0o644);
        fs::set_permissions(&not_exec, perms).unwrap();

        assert!(!check_cli_in(&[dir.path().to_path_buf()]));
    }
}
