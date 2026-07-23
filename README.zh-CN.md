# OreoDeck

[English](README.md) | [Tiếng Việt](README.vi.md) | 简体中文

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-15%2B-black.svg)](https://www.apple.com/macos/)
[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/nguyenhuyquang)

<p align="center"><img src="packages/app/Resources/OreoDeck.png" alt="OreoDeck 标志" width="128"></p>

<p align="center">用于管理多个相互隔离的 Claude Code 配置档案的 macOS 应用和 CLI。</p>

OreoDeck 支持并行使用多个 Claude 账户、为不同终端标签页固定配置档案、监控用量、迁移会话、选择性共享全局资源，并在账户达到用量限制时故障转移。完整命令为 `oreodeck`，`ord` 是功能相同的短别名。

## 主要功能

- 每个账户使用独立的 `CLAUDE_CONFIG_DIR`。
- 支持订阅/OAuth 和 API 密钥配置档案；API 密钥存储在 macOS Keychain 中。
- 支持全局、每个标签页和单次命令的配置档案选择。
- 从全局 Claude 或其他配置档案导入并继续会话。
- 选择性共享 MCP、skills、plugins 和状态栏，不共享凭据或完整设置文件。
- 五小时窗口的 token 用量和 API 成本估算。
- 可配置的自动故障转移顺序。
- 原生 SwiftUI 仪表板和菜单栏应用。
- 支持 Terminal.app、Ghostty、iTerm2、WezTerm、Alacritty、Kitty、Warp、Hyper、Tabby、Rio 和 Wave Terminal。
- 安装程序全程使用英语。

## 系统要求

- 桌面应用需要 macOS 15 或更高版本。
- `PATH` 中已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)。
- 从完整 Release 安装无需 Bun、Rust 或 Xcode。
- 从源码构建需要 Bun、Rust/Cargo、Swift 6 和 Xcode Command Line Tools。

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/OreoSolutions/oreodeck/main/install.sh | bash
```

安装程序下载适合当前架构的资源、验证 SHA-256 后运行原生安装器。也可以解压 Release 后执行：

```bash
./install.sh
```

安装器使用英语，并会询问是否安装 UI，以及是否让 `claude` 命令自动通过 OreoDeck。Finder 用户可以双击 `install.command`。

安装位置：

- `oreodeck`、`ord`：`~/.local/bin`
- 可选应用：`~/Applications/OreoDeck.app`
- UI 资源：`~/.local/share/oreodeck`

稍后安装 UI：

```bash
ord ui install
ord ui open
```

## 快速开始

```bash
oreodeck add work
oreodeck add automation --api-key
ord list
ord use work
ord run
```

为单次调用覆盖配置档案：

```bash
ord run -P personal
ord run -P work -- --resume <session-id>
ord run -P automation -p "Summarize this repository"
```

## 在不同终端标签页使用不同配置档案

```bash
oreodeck shell-init >> ~/.zshrc
source ~/.zshrc
type claude

# 标签页 1
ord use --tab work
claude

# 标签页 2
ord use --tab personal
claude
```

解析优先级：`-P/--profile` → 当前标签页固定的配置档案 → `ord use <name>` 选择的全局配置档案。

## 会话

```bash
ord sessions
ord sessions --from global
ord sessions --from personal
ord sessions --list
ord sessions -P work
```

会话按需复制，而不是共享整个历史目录，从而保持配置档案隔离。

## 共享资源

```bash
ord shared set work
```

使用方向键移动、Space 选择、Enter 确认。非交互模式：

```bash
ord shared set work mcp skills plugins statusline.sh
ord shared show work
ord shared clear work
ord shared set work skills plugins --force --yes
```

强制替换前，原资源会备份到 `.oreodeck-backups/shared`。状态栏会链接 `statusline.sh`，并仅同步所需的 `statusLine` 字段；不会共享完整的 `settings.json`。OAuth、API 密钥、projects、history 与无关设置保持私有。

## 用量和故障转移

```bash
ord status
ord failover order work personal automation
ord failover on
ord failover show
ord failover off
```

无头运行检测到限流时可以自动尝试下一个配置档案。交互运行会在迁移当前会话前请求确认。

## 桌面应用

原生应用提供菜单栏概览、配置档案和会话管理、用量仪表板、故障转移和共享资源配置、CLI 建议以及终端选择。Terminal.app、Ghostty、iTerm2、WezTerm、Alacritty 和 Kitty 可直接执行命令；Warp、Hyper、Tabby、Rio 和 Wave 会打开窗口并提示手动执行。

```bash
ord ui install
ord ui open
ord ui remove
```

## 数据与安全

配置档案存储在 `~/.oreodeck/profiles/<profile-name>/`。旧的 `~/.ccm` 安装仍受支持。使用 `OREODECK_HOME` 更改位置；旧变量 `CCM_HOME` 仍可使用。API 密钥存储在服务名为 `com.oreo.oreodeck` 的 macOS Keychain 中。

## 从源码构建

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

构建产物位于 `dist/`：`oreodeck`、`ord` 和 `OreoDeck.app`。

CLI 在交互命令中最多每天检查一次 GitHub Release，并在安装前询问用户。使用 `ord update --check`、`ord update`，或设置 `OREODECK_DISABLE_UPDATE_CHECK=1` 禁用自动检查。

## 卸载

```bash
ord uninstall          # 保留配置档案
ord uninstall --purge  # 删除所有 OreoDeck 数据
```

`--purge` 无法撤销。两个命令都会请求确认；仅在已经审查删除范围的自动化中使用 `--yes`。

## 支持 OreoDeck

OreoDeck 是免费开源软件。如果它为你节省了时间，你可以在 [Ko-fi 上请作者喝杯咖啡](https://ko-fi.com/nguyenhuyquang)，支持项目继续开发。☕

## 更新日志与许可证

参见 [CHANGELOG.md](CHANGELOG.md)。OreoDeck 版权所有 © 2026 OreoSolutions，并采用 [Apache License 2.0](LICENSE)。第三方组件仍遵循其各自许可证；参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[LICENSES](LICENSES) 和 [TRADEMARKS.md](TRADEMARKS.md)。贡献指南见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)，安全政策见 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)。

> 如法律含义存在差异，以英文版本为准。
