# Chính sách bảo mật

[English](SECURITY.md) | Tiếng Việt | [简体中文](SECURITY.zh-CN.md)

## Phiên bản được hỗ trợ

Bản phát hành OreoDeck mới nhất sẽ nhận các bản sửa lỗi bảo mật.

| Phiên bản | Được hỗ trợ |
| --- | --- |
| 0.1.x | Có |
| Bản cũ hơn hoặc chưa phát hành | Không |

## Báo cáo lỗ hổng

Không công khai lỗ hổng, credential, thông tin tài khoản hoặc chi tiết khai thác trong public issue.

Hãy báo cáo qua GitHub Private Vulnerability Reporting hoặc private security advisory của `OreoSolutions/oreodeck`, kèm theo:

- Phiên bản OreoDeck và macOS bị ảnh hưởng.
- Các bước tái hiện hoặc proof of concept tối thiểu.
- Tác động bảo mật dự kiến và quan sát được.
- Thông tin liệu profile data, API key, trạng thái OAuth, shell integration, symlink hoặc thực thi lệnh terminal có liên quan hay không.

Maintainer sẽ xác nhận báo cáo đầy đủ sau khi xem xét, điều tra riêng tư và phối hợp công bố với người báo cáo khi phù hợp. Không cam kết thời hạn phản hồi hoặc khắc phục cụ thể.

## Phạm vi

Các khu vực ưu tiên cao gồm rò rỉ credential, vượt qua cơ chế cô lập profile, path traversal, xử lý symlink không an toàn, chèn lệnh terminal, truy cập Keychain không an toàn và hành vi uninstall phá hủy dữ liệu ngoài đường dẫn do OreoDeck quản lý.

Claude Code, ứng dụng terminal, macOS và các dependency bên thứ ba có chính sách bảo mật riêng. Các lỗ hổng chỉ ảnh hưởng tới những dự án đó cũng cần được báo cáo cho upstream.

> Bản tiếng Anh là chính sách chuẩn nếu có khác biệt trong diễn giải.
