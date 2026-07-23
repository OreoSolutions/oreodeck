# Đóng góp cho OreoDeck

[English](CONTRIBUTING.md) | Tiếng Việt | [简体中文](CONTRIBUTING.zh-CN.md)

Cảm ơn bạn đã giúp OreoDeck trở nên tốt hơn.

## Trước khi mở pull request

1. Mở hoặc dẫn chiếu một issue đối với thay đổi hành vi đáng kể.
2. Bảo toàn tính cô lập profile, an toàn thông tin xác thực và khả năng tương thích ngược.
3. Thêm hoặc cập nhật test cho mọi hành vi người dùng có thể quan sát.
4. Chạy các kiểm tra liên quan:

   ```bash
   bun run typecheck
   bun run test
   cargo test --manifest-path packages/core-rs/Cargo.toml
   bun run test:app
   bun run lint
   bun run fmt:check
   ```

## Giấy phép đóng góp

Trừ khi có tuyên bố rõ ràng khác, mọi đóng góp được chủ ý gửi để đưa vào OreoDeck đều được cung cấp theo Apache-2.0, phù hợp với Điều 5 của giấy phép này. Người đóng góp phải có quyền gửi mã nguồn, tài liệu, thiết kế hoặc các tài liệu khác.

Không gửi nội dung sao chép có giấy phép không tương thích. Khi thêm dependency, hãy ghi tên, phiên bản, giấy phép và nguồn upstream trong `THIRD_PARTY_NOTICES.md`, đồng thời bổ sung các file cần thiết cho việc phân phối binary.

Khi gửi pull request, bạn xác nhận đóng góp là sản phẩm gốc hoặc bạn có đủ quyền để cung cấp nó theo các điều khoản này.

## Vấn đề bảo mật

Không công khai credential hoặc chi tiết có thể khai thác trong public issue. Hãy sử dụng tính năng private security advisory của repository.

> Bản tiếng Anh là tài liệu chuẩn nếu có khác biệt trong diễn giải pháp lý.
