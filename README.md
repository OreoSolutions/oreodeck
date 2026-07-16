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
