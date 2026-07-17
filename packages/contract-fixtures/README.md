# @ccm/contract-fixtures

Golden fixtures dùng chung bởi hai suite:

- `packages/core` (TypeScript) — `packages/core/src/contract-fixtures.test.ts`
- `packages/app/src-tauri` (Rust) — `usage.rs` test `contract_usage_matches_expected`

Sửa `transcript.jsonl` hoặc bảng giá/multiplier ở **một** bên mà quên cập nhật
`expected-usage.json` sẽ làm **cả hai** suite đỏ. Đó là chủ đích: đây là chốt
chống lệch contract TS ↔ Rust.

`nowMs` cố định (2026-07-16T12:00:00.000Z) để cửa sổ 5h là tất định.
