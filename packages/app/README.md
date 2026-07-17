# ccm app — Desktop manager (Tauri v2, macOS)

Menu-bar + dashboard app quản lý profile ccm. Chia sẻ state trên đĩa với CLI
(`~/.ccm/`), logic core viết lại bằng Rust (không sidecar). Contract TS ↔ Rust
được khóa bởi `packages/contract-fixtures/`.

## Dev

```bash
bun install
cd packages/app
bun gen-icon.ts && bunx @tauri-apps/cli@2 icon src-tauri/app-icon.png   # lần đầu
bun run tauri dev
```

## Test

```bash
bun run test                                                   # frontend (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml                # Rust
bun run test:contract                                          # (từ root) golden TS + Rust
```

## Build

```bash
cd packages/app && bun run tauri build        # .app + DMG chưa ký trong src-tauri/target/release/bundle/
```

Ký + notarize DMG: Giai đoạn sau (ngoài phạm vi v1).

Design: `docs/superpowers/specs/2026-07-17-ccm-app-phase-2-design.md`
