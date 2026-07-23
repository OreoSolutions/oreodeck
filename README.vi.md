# OreoDeck

[English](README.md) | Tiếng Việt | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-15%2B-black.svg)](https://www.apple.com/macos/)
[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/nguyenhuyquang)

<p align="center"><img src="packages/app/Resources/OreoDeck.png" alt="Logo OreoDeck" width="128"></p>

<p align="center">Ứng dụng macOS và CLI để quản lý nhiều profile Claude Code được cô lập.</p>

OreoDeck cho phép chạy nhiều tài khoản Claude song song, gắn profile theo từng tab terminal, theo dõi mức sử dụng, chuyển session, chia sẻ có chọn lọc tài nguyên global và failover khi tài khoản chạm giới hạn. `oreodeck` là lệnh đầy đủ; `ord` là alias ngắn với cùng chức năng.

## Điểm nổi bật

- Mỗi tài khoản dùng một `CLAUDE_CONFIG_DIR` riêng.
- Hỗ trợ profile subscription/OAuth và API key; API key được lưu trong macOS Keychain.
- Chọn profile global, theo tab hoặc cho một lần chạy.
- Picker để nhập và tiếp tục session từ Claude global hoặc profile khác.
- Chia sẻ có chọn lọc MCP, skills, plugins và status line mà không chia sẻ credential hay toàn bộ settings.
- Thống kê token trong cửa sổ 5 giờ và ước tính chi phí API.
- Thứ tự failover tùy chỉnh.
- Dashboard SwiftUI native và menu-bar app.
- Tích hợp Terminal.app, Ghostty, iTerm2, WezTerm, Alacritty, Kitty, Warp, Hyper, Tabby, Rio và Wave Terminal.
- Installer sử dụng tiếng Anh cho toàn bộ quá trình cài đặt.

## Yêu cầu

- macOS 15 trở lên cho desktop app.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) có trong `PATH`.
- Cài từ release không cần Bun, Rust hoặc Xcode.
- Build từ source cần Bun, Rust/Cargo, Swift 6 và Xcode Command Line Tools.

## Cài đặt

```bash
curl -fsSL https://raw.githubusercontent.com/OreoSolutions/oreodeck/main/install.sh | bash
```

Installer tải asset đúng kiến trúc, xác minh SHA-256 rồi chạy trình cài native. Hoặc giải nén release và chạy:

```bash
./install.sh
```

Installer sử dụng tiếng Anh, hỏi có cài UI hay không và có route lệnh `claude` qua OreoDeck hay không. Người dùng Finder có thể mở `install.command`.

Vị trí cài đặt:

- `oreodeck`, `ord`: `~/.local/bin`
- App tùy chọn: `~/Applications/OreoDeck.app`
- UI payload: `~/.local/share/oreodeck`

Cài UI sau:

```bash
ord ui install
ord ui open
```

## Bắt đầu nhanh

```bash
oreodeck add work
oreodeck add automation --api-key
ord list
ord use work
ord run
```

Chạy một lần bằng profile khác:

```bash
ord run -P personal
ord run -P work -- --resume <session-id>
ord run -P automation -p "Summarize this repository"
```

## Profile riêng cho từng tab terminal

```bash
oreodeck shell-init >> ~/.zshrc
source ~/.zshrc
type claude

# Tab 1
ord use --tab work
claude

# Tab 2
ord use --tab personal
claude
```

Thứ tự chọn profile: `-P/--profile` → `.oreodeck/config.json` gần nhất trong project → profile của tab → profile global từ `ord use <name>`.

Đặt profile mặc định cho project hiện tại bằng `ord use --project work`. Lệnh này tạo `.oreodeck/config.json` với nội dung `{ "profile": "work" }`; `ord run -P personal` vẫn ghi đè cho riêng lần chạy đó.

## Session

```bash
ord sessions
ord sessions --from global
ord sessions --from personal
ord sessions --list
ord sessions --all
ord sessions -P work
```

Mặc định chỉ hiện session của folder project đang đứng; dùng `--all` để xem mọi project. Session được copy theo yêu cầu thay vì chia sẻ toàn bộ history, nhờ đó profile vẫn cô lập.

## Tài nguyên dùng chung

```bash
ord shared set work
```

Dùng phím mũi tên để di chuyển, Space để chọn và Enter để xác nhận. Chế độ không tương tác:

```bash
ord shared set work mcp skills plugins statusline.sh
ord shared show work
ord shared clear work
ord shared set work skills plugins --force --yes
```

Khi force, tài nguyên cũ được backup trong `.oreodeck-backups/shared`. Status line liên kết `statusline.sh` và chỉ đồng bộ trường `statusLine` cần thiết; toàn bộ `settings.json` không được chia sẻ. OAuth, API key, projects, history và settings không liên quan vẫn riêng tư.

## Usage và failover

Kiểm tra profile được chọn cho thư mục hiện tại và thông tin tài khoản Claude
an toàn bằng `ord identity`, `ord identity -P personal` hoặc
`ord identity --json`. Mỗi phiên Claude mở qua OreoDeck cũng có skill
`/oreodeck` để hiện cùng phần tổng quan về profile, tài khoản, model, MCP và
settings. Token OAuth, API key và UUID tài khoản không bao giờ được hiển thị;
dùng `/status` có sẵn của Claude để xem session ID và trạng thái runtime.

```bash
ord status
ord failover order work personal automation
ord failover on
ord failover show
ord failover off
```

`ord status` dùng phần trăm usage 5 giờ/tuần và thời điểm reset theo tài khoản
do Claude Code cung cấp, nên bao gồm cả Claude.ai, Desktop, IDE và các phiên
Claude khác. Chạy `/usage` trong Claude để làm mới cache của profile; OreoDeck
luôn hiển thị tuổi cache. Profile API key chỉ hiển thị token/cost cục bộ và
không có mốc reset subscription giả định.

Khi profile được mở qua OreoDeck, status-line proxy sẽ ghi nhận `rate_limits`
sau mỗi API response và chuyển nguyên output sang status line hiện có. Proxy
không đọc OAuth credential. `ord status` và app ưu tiên snapshot gần realtime
này, sau đó mới fallback về cache tài khoản Claude. Sau khi nâng cấp OreoDeck,
hãy mở một session mới cho profile để proxy được cài tự động.

Headless run có thể tự thử profile tiếp theo khi gặp rate limit. Interactive run sẽ hỏi xác nhận trước khi chuyển session.

## Desktop app

App cung cấp tổng quan profile trên menu bar, quản lý profile/session, dashboard usage, cấu hình failover/shared resources, gợi ý CLI và chọn terminal. Terminal.app, Ghostty, iTerm2, WezTerm, Alacritty và Kitty hỗ trợ chạy lệnh trực tiếp; Warp, Hyper, Tabby, Rio và Wave mở cửa sổ kèm cảnh báo chạy lệnh thủ công.

```bash
ord ui install
ord ui open
ord ui remove
```

## Dữ liệu và bảo mật

Profile được lưu tại `~/.oreodeck/profiles/<profile-name>/`. Cài đặt cũ ở `~/.ccm` vẫn được hỗ trợ. Dùng `OREODECK_HOME` để đổi vị trí; `CCM_HOME` cũ vẫn được chấp nhận. API key nằm trong macOS Keychain với service `com.oreo.oreodeck`.

## Build từ source

```bash
bun install
bun run build
bun run typecheck
bun run test
cargo test --manifest-path packages/core-rs/Cargo.toml
bun run test:app
bun run test:contract
bun run lint
bun run fmt:check
```

Artifact nằm trong `dist/`: `oreodeck`, `ord` và `OreoDeck.app`.

CLI kiểm tra GitHub Release tối đa một lần mỗi ngày khi chạy tương tác và luôn hỏi trước khi cài. Dùng `ord update --check`, `ord update`, hoặc đặt `OREODECK_DISABLE_UPDATE_CHECK=1` để tắt tự kiểm tra.

## Gỡ cài đặt

```bash
ord uninstall          # giữ profiles
ord uninstall --purge  # xóa toàn bộ dữ liệu OreoDeck
```

`--purge` không thể hoàn tác. Cả hai lệnh đều hỏi xác nhận; chỉ dùng `--yes` trong automation sau khi đã kiểm tra phạm vi.

## Ủng hộ OreoDeck

OreoDeck miễn phí và mã nguồn mở. Nếu ứng dụng giúp bạn tiết kiệm thời gian, bạn có thể [mời tác giả một ly cà phê trên Ko-fi](https://ko-fi.com/nguyenhuyquang) để ủng hộ quá trình phát triển. ☕

## Changelog và giấy phép

Xem [CHANGELOG.md](CHANGELOG.md). OreoDeck thuộc bản quyền OreoSolutions 2026 và được phát hành theo [Apache License 2.0](LICENSE). Thành phần bên thứ ba giữ giấy phép riêng; xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [LICENSES](LICENSES) và [TRADEMARKS.md](TRADEMARKS.md). Xem hướng dẫn đóng góp tại [CONTRIBUTING.vi.md](CONTRIBUTING.vi.md) và chính sách bảo mật tại [SECURITY.vi.md](SECURITY.vi.md).

> Bản tiếng Anh là tài liệu chuẩn nếu có khác biệt trong diễn giải pháp lý.
