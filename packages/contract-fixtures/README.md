# @ccm/contract-fixtures

Golden fixtures dùng chung bởi hai suite:

- `packages/core` (TypeScript) — `packages/core/src/contract-fixtures.test.ts`
- `packages/app/src-tauri` (Rust) — `usage.rs` test
  `read_profile_usage_matches_golden_contract_fixture`

Sửa `transcript.jsonl` hoặc bảng giá/multiplier ở **một** bên mà quên cập nhật
`expected-usage.json` sẽ làm **cả hai** suite đỏ. Đó là chủ đích: đây là chốt
chống lệch contract TS ↔ Rust.

`nowMs` cố định (2026-07-16T12:00:00.000Z) để cửa sổ 5h là tất định.

## `config.json` / `config-corrupt.json`

Cặp fixture thứ hai, chống lệch cho `config.json` — không chỉ usage. Đọc bởi:

- `packages/core` (TypeScript) —
  `contract-fixtures.test.ts` test `"config.json fixture round-trips with
  canonical casing and known fields preserved"` và `"config-corrupt.json
  fixture is rejected, not silently swallowed"`.
- `packages/app/src-tauri` (Rust) — `store.rs` tests
  `config_contract_fixture_round_trips_with_canonical_casing_and_unknown_field_preserved`
  và `config_corrupt_contract_fixture_yields_config_corrupt`.

`config.json` là một config hợp lệ, mỗi trường pin một hành vi:

- **`profiles`**: hai profile, casing hỗn hợp (`"Work"` viết hoa, `"bot"` viết
  thường) — pin rằng casing gốc được giữ nguyên qua round-trip (không bị
  lowercase hoá), và cả hai `kind` (`subscription`, `api-key`) đều parse
  đúng.
- **`active`**: `"Work"` (canonical casing, không phải `"work"`) — pin rằng
  `active` không bị chuẩn hoá case khi đọc/ghi lại.
- **`failoverEnabled`** / **`failoverOrder`**: pin naming `camelCase` và thứ
  tự được giữ nguyên.
- **`telemetryOptIn`**: trường KHÔNG có trong `Config`/`Profile` của
  `Rust`/`TypeScript` hiện tại — mô phỏng một trường mà một phiên bản CLI
  tương lai thêm vào. Cả hai suite pin rằng trường lạ này sống sót
  byte-value-identical qua một lần ghi lại config (`setActive` phía TS,
  `set_active` phía Rust). Đây chính là assert lẽ ra đã bắt được lỗi Rust
  từng âm thầm xoá trường lạ khi ghi (`#[serde(flatten)] extra` trên
  `Config`/`Profile` trong `store.rs`).

`config-corrupt.json` là JSON bị cắt cụt (invalid syntax), không phải một
config hợp lệ thiếu trường. Pin hành vi **fail-loud** ở cả hai bên khi đọc
gặp lỗi cú pháp:

- TS: `loadConfig()` reject (`readJson()` chỉ coi `ENOENT` là "file thiếu" →
  default; mọi lỗi đọc/parse khác, kể cả `SyntaxError` từ `JSON.parse`, được
  ném lại nguyên văn).
- Rust: `load_config()` trả `Err(StoreError::CorruptConfig)` (message sentinel
  `"CONFIG_CORRUPT"` cho UI hiện banner).

## Schema of `expected-usage.json`

Every field in `expected-usage.json` and its meaning:

- **`nowMs`** (number): Current time in milliseconds since Unix epoch. Fixed at `1784203200000` (2026-07-16T12:00:00.000Z) to ensure the 5-hour window is deterministic.

- **`windowMs`** (number): The duration of the rate-limit window in milliseconds. Fixed at `18000000` (5 hours). All entries with timestamp in `[nowMs - windowMs, nowMs]` are included in usage aggregation; others are excluded.

- **`windowStartMs`** (number): Start of the current rate-limit window (in milliseconds). Computed as `nowMs - windowMs`. Only entries with `timestamp >= windowStartMs` and `timestamp <= nowMs` contribute to usage.

- **`entries`** (number): Count of transcript lines that:
  1. Parse as valid JSON
  2. Have `type === "assistant"`
  3. Have a non-empty `message.usage` object
  4. Have a `timestamp` field that parses as a valid ISO 8601 datetime (via `Date.parse()`)
  5. Fall within the rate-limit window `[windowStartMs, nowMs]`
  
  Lines failing any of these checks (user messages, malformed JSON, invalid timestamps, out-of-window entries) do NOT increment this count.

- **`inputTokens`** (number): Sum of `usage.input_tokens` from all in-window entries.

- **`cacheWrite5mTokens`** (number): Sum of 5-minute cache write tokens from all in-window entries. Extracted from `usage.cache_creation.ephemeral_5m_input_tokens` if the object exists; otherwise from `usage.cache_creation_input_tokens` (fallback: no breakdown available, assume cheaper 5m TTL).

- **`cacheWrite1hTokens`** (number): Sum of 1-hour cache write tokens from all in-window entries. Extracted from `usage.cache_creation.ephemeral_1h_input_tokens` if the object exists; otherwise 0.

- **`cacheReadTokens`** (number): Sum of `usage.cache_read_input_tokens` from all in-window entries.

- **`outputTokens`** (number): Sum of `usage.output_tokens` from all in-window entries.

- **`totalTokens`** (number): Sum of all token types: `inputTokens + cacheWrite5mTokens + cacheWrite1hTokens + cacheReadTokens + outputTokens`. This is the total tokens the model processed (what counts against rate limits).

- **`costUsd`** (number): Sum of per-entry costs (in USD). Cost per entry is computed as:
  ```
  cost = (inputTokens × input_rate
          + cacheWrite5mTokens × input_rate × 1.25
          + cacheWrite1hTokens × input_rate × 2.0
          + cacheReadTokens × input_rate × 0.1
          + outputTokens × output_rate) / 1_000_000
  ```
  where `input_rate` and `output_rate` (in USD per 1M tokens) come from the pricing table:
  - `claude-opus-4-8`: input 5, output 25
  - `claude-sonnet-5`: input 3, output 15
  - `claude-haiku-4-5`: input 1, output 5
  - `claude-fable-5`: input 10, output 50
  - Unknown model (e.g., `future-model-x`): cost 0 (not in table)
  
  Cache multipliers (applied to input rates only, never output):
  - 5-minute writes: 1.25×
  - 1-hour writes: 2.0×
  - Cache reads: 0.1×

- **`resetAtMs`** (number): Time when the current window resets, computed as `earliest_in_window_timestamp + windowMs`. This is when the oldest in-window entry will fall out of the window.

## Per-line mapping of `transcript.jsonl`

Each line of the fixture transcript and which contract branch it exercises:

- **Line 1** (`"type":"user"`, 2026-07-16T09:00:00.000Z): User message (type ≠ "assistant"). NOT COUNTED — user messages have no `usage` field.

- **Line 2** (assistant, `claude-opus-4-8`, 2026-07-16T10:00:05.000Z): 
  - Exercises: **Opus model** (input rate 5/M, output rate 25/M), **cache_creation object** (broken into `ephemeral_5m_input_tokens`=8000 and `ephemeral_1h_input_tokens`=0), **cache_read_input_tokens**=5000.
  - Within window [07:00Z, 12:00Z]: ✓ COUNTED
  - Contributes: 1200 input, 8000 cache_write_5m, 5000 cache_read, 300 output tokens and cost.

- **Line 3** (assistant, `claude-sonnet-5`, 2026-07-16T10:05:00.000Z):
  - Exercises: **Sonnet model** (input rate 3/M, output rate 15/M), **cache_creation_input_tokens fallback** (no `cache_creation` object, so `cache_creation_input_tokens`=2000 is treated as 5-minute TTL, not 1-hour).
  - Within window: ✓ COUNTED
  - Contributes: 400 input, 2000 cache_write_5m, 150 output tokens and cost.

- **Line 4** (assistant, `claude-haiku-4-5`, 2026-07-16T10:10:00.000Z):
  - Exercises: **Haiku model** (input rate 1/M, output rate 5/M), **cache_creation object** with `ephemeral_1h_input_tokens`=4000 (1-hour TTL, not 5-minute).
  - Within window: ✓ COUNTED
  - Contributes: 1000 input, 4000 cache_write_1h, 500 output tokens and cost.

- **Line 5** (assistant, `claude-fable-5`, 2026-07-16T10:15:00.000Z):
  - Exercises: **Fable model** (input rate 10/M, output rate 50/M), **no cache** (neither `cache_creation` object nor `cache_creation_input_tokens`).
  - Within window: ✓ COUNTED
  - Contributes: 100 input, 50 output tokens and cost.

- **Line 6** (assistant, `future-model-x`, 2026-07-16T10:20:00.000Z):
  - Exercises: **Unknown model** (not in pricing table) → cost = 0 even though tokens are present.
  - Within window: ✓ COUNTED (line parsed and in window, so `entries` increments)
  - Contributes: 0 cost, but tokens still aggregated (1000 input, 1000 output).

- **Line 7** (assistant, `claude-opus-4-8`, timestamp `"not-a-timestamp"`):
  - Exercises: **Invalid timestamp** branch (`Date.parse()` fails, returns NaN).
  - Timestamp invalid: ✗ NOT COUNTED — line rejected by timestamp validation.

- **Line 8** (`not json`):
  - Exercises: **Malformed JSON** branch (JSON.parse() fails).
  - JSON invalid: ✗ NOT COUNTED — line rejected by parsing.

- **Line 9** (`"type":"summary"`):
  - Exercises: **Non-assistant message type** (type ≠ "assistant").
  - Type check fails: ✗ NOT COUNTED — line skipped by type filter.

- **Line 10** (assistant, `claude-opus-4-8`, 2026-07-16T03:00:00.000Z):
  - Exercises: **Out-of-window entry** (timestamp 03:00Z < windowStartMs 07:00Z).
  - Timestamp before window start: ✗ NOT COUNTED — line falls outside rate-limit window (would contribute ~0.02997 cost and 1998 tokens if included, so exclusion is materially exercised).

- **Line 11** (empty):
  - Exercises: **Empty line** (trimmed string is empty).
  - Empty: ✗ NOT COUNTED — line rejected by empty check.

**Summary:** 5 lines counted (A, B, C, D, E); 6 lines skipped (user, invalid timestamp, malformed JSON, summary type, out-of-window, empty).
