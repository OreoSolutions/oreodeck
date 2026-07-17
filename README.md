# ccm — Multi-account Claude Code Manager

Chạy nhiều tài khoản Claude cùng lúc trên macOS: chuyển đổi nhanh, chạy song song
nhiều phiên, tự động failover khi hết limit, và theo dõi usage.

## Cài đặt

```bash
bun run build
cp dist/ccm /usr/local/bin/ccm
```

## Dùng

```bash
ccm add work                  # thêm profile subscription (mở luồng /login)
ccm add bot --api-key         # thêm profile API key (lưu vào Keychain)
ccm list                      # xem các profile
ccm use work                  # đặt profile mặc định
ccm claude                    # chạy Claude Code với profile active
ccm claude -P personal        # chạy với profile chỉ định — mở nhiều tab để chạy song song
ccm status                    # xem usage trong cửa sổ 5 giờ
ccm remove <name>             # xóa profile và dữ liệu của nó (hỏi xác nhận)
ccm failover order work personal bot
ccm shell-init >> ~/.zshrc    # để `claude` luôn đi qua profile active
```

Failover tự động (chuyển sang profile kế tiếp khi hết limit) bật/tắt bằng
`ccm failover on` / `ccm failover off`.

## Cách hoạt động

Mỗi profile là một `CLAUDE_CONFIG_DIR` riêng tại `~/.ccm/profiles/<tên>/`, nên
mỗi phiên có đăng nhập, settings và lịch sử độc lập. `~/.claude` của bạn không
bị đụng tới. API key nằm trong macOS Keychain, không nằm trong file config.

Thiết kế: `docs/superpowers/specs/2026-07-16-ccm-multi-account-claude-design.md`

## App (menu-bar + dashboard)

`packages/app` là một app **SwiftUI native**: icon trên menu bar (popover xem
usage nhanh, mở phiên) cộng dashboard (tab Profiles / Usage / Failover). Nó
quản lý đúng những profile mà CLI quản lý — đọc/ghi chung `~/.ccm/config.json`,
chung Keychain service `com.oreo.ccm`. Cần `ccm` trên PATH để mở phiên (Open
session) và đăng nhập subscription (Add subscription mở Terminal chạy
`ccm add <name>` rồi tự chờ profile hiện ra).

Logic core viết bằng Rust (`packages/core-rs`) và dùng lại nguyên vẹn từ bản
app trước; SwiftUI gọi sang qua **uniffi 0.32** với binding sinh tự động, nên
kiểu ở hai bên không thể lệch nhau.

Build:

```bash
bun run build:app          # cargo build → uniffi-bindgen → swift build → ccm.app
open packages/app/ccm.app
```

Test:

```bash
bun run test               # suite TS (core + cli)
bun run test:app           # suite Swift (view model)
cargo test --manifest-path packages/core-rs/Cargo.toml   # suite Rust
bun run test:contract      # golden fixtures, TS ↔ Rust cùng đọc
bun run lint && bun run fmt:check
```

Sau khi đổi `packages/core-rs/src/api.rs`, chạy lại
`bash packages/app/scripts/generate.sh` để sinh lại binding (binding bị
gitignore — nó luôn được sinh từ thư viện đã build, không bao giờ sửa tay).

**`.app` chưa ký (unsigned):** ký + notarize vẫn ngoài phạm vi. Bản build ngay
trên máy mở thẳng được. Nếu copy `.app` qua máy khác rồi double-click, macOS
Gatekeeper báo "ccm is damaged and can't be opened" — không phải bug. Cách mở:

`xattr -dr com.apple.quarantine /Applications/ccm.app`

Chuột phải → Open **không** dùng được: bundle chỉ có chữ ký ad-hoc do linker
tạo (`codesign --verify` fail), mà lối chuột-phải chưa bao giờ áp dụng cho chữ
ký không hợp lệ — và Apple đã bỏ hẳn lối này từ macOS Sequoia (15).

Thiết kế: `docs/superpowers/specs/2026-07-17-ccm-swift-app-design.md`
Spike chứng minh chuỗi uniffi → Swift → `.app`:
`docs/superpowers/spikes/2026-07-17-uniffi-swift.md`
