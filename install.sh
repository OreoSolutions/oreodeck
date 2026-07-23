#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/Applications"
UI_PAYLOAD_DIR="${HOME}/.local/share/oreodeck"

prompt_read() {
  local prompt="$1" variable="$2" value=""
  if [ -r /dev/tty ]; then
    IFS= read -r -p "$prompt" value </dev/tty || true
  else
    IFS= read -r -p "$prompt" value || true
  fi
  printf -v "$variable" '%s' "$value"
}

# When executed through `curl -fsSL .../install.sh | bash`, no release payload
# exists beside the script. Download the stable latest-release asset, verify its
# SHA-256, extract it, then hand control to the bundled installer.
if { [ ! -x "$ROOT_DIR/dist/oreodeck" ] || [ ! -x "$ROOT_DIR/dist/ord" ]; } \
  && [ ! -f "$ROOT_DIR/packages/cli/src/index.ts" ]; then
  if [ "${OREODECK_BOOTSTRAPPED:-0}" != "1" ]; then
    command -v curl >/dev/null 2>&1 || { echo "Error: curl is required." >&2; exit 1; }
    command -v shasum >/dev/null 2>&1 || { echo "Error: shasum is required." >&2; exit 1; }
    command -v ditto >/dev/null 2>&1 || { echo "Error: this installer requires macOS ditto." >&2; exit 1; }
    case "$(uname -m)" in
      arm64) RELEASE_ARCH="arm64" ;;
      x86_64) RELEASE_ARCH="x86_64" ;;
      *) echo "Error: unsupported Mac architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    RELEASE_BASE="${OREODECK_RELEASE_BASE_URL:-https://github.com/OreoSolutions/oreodeck/releases/latest/download}"
    RELEASE_FILE="oreodeck-macos-${RELEASE_ARCH}.zip"
    BOOTSTRAP_DIR="$(mktemp -d)"
    trap 'rm -rf "$BOOTSTRAP_DIR"' EXIT
    echo "Downloading the latest OreoDeck release..."
    curl -fL --retry 3 --proto '=https' --tlsv1.2 \
      "$RELEASE_BASE/$RELEASE_FILE" -o "$BOOTSTRAP_DIR/$RELEASE_FILE"
    curl -fL --retry 3 --proto '=https' --tlsv1.2 \
      "$RELEASE_BASE/$RELEASE_FILE.sha256" -o "$BOOTSTRAP_DIR/$RELEASE_FILE.sha256"
    (cd "$BOOTSTRAP_DIR" && shasum -a 256 -c "$RELEASE_FILE.sha256")
    ditto -x -k "$BOOTSTRAP_DIR/$RELEASE_FILE" "$BOOTSTRAP_DIR/unpacked"
    BUNDLED_INSTALLER="$(find "$BOOTSTRAP_DIR/unpacked" -mindepth 2 -maxdepth 2 -name install.sh -type f -print -quit)"
    [ -n "$BUNDLED_INSTALLER" ] || { echo "Error: release archive has no installer." >&2; exit 1; }
    export OREODECK_BOOTSTRAPPED=1
    /bin/bash "$BUNDLED_INSTALLER"
    exit $?
  fi
fi

cd "$ROOT_DIR"

echo "OreoDeck Installer"
echo "=================="
echo

INSTALL_LANGUAGE="${OREODECK_INSTALL_LANGUAGE:-}"
[ -n "$INSTALL_LANGUAGE" ] || prompt_read "Choose language / Chọn ngôn ngữ [1] English (default), [2] Tiếng Việt: " INSTALL_LANGUAGE
case "${INSTALL_LANGUAGE:-1}" in
  2|vi|VI|vn|VN|vietnamese|Vietnamese) LANG_CHOICE="vi" ;;
  *) LANG_CHOICE="en" ;;
esac

if [ "$LANG_CHOICE" = "vi" ]; then
  PROMPT_UI="Bạn có muốn cài giao diện OreoDeck (UI) không? [Y/n]: "
  MSG_INSTALL_CLI="Đang cài OreoDeck CLI từ binary có sẵn..."
  MSG_NO_CLI="Lỗi: gói này không có CLI prebuilt và máy chưa cài Bun."
  MSG_GET_RELEASE="Hãy tải gói OreoDeck Release đầy đủ hoặc cài Bun tại https://bun.sh"
  MSG_BUILD_CLI="Không tìm thấy binary prebuilt; đang build OreoDeck CLI..."
  MSG_PAYLOAD="Đã lưu UI payload để có thể cài sau bằng: ord ui install"
  MSG_INSTALL_UI="Đang cài OreoDeck UI từ app có sẵn..."
  MSG_NO_APP="Lỗi: gói này không có OreoDeck.app prebuilt."
  MSG_UI_DEPS="Build UI từ source cần Bun, Rust/Cargo và Xcode Command Line Tools."
  MSG_CLI_ONLY_OK="CLI đã được cài thành công; UI chưa được cài."
  MSG_BUILD_UI="Không tìm thấy app prebuilt; đang build OreoDeck UI..."
  MSG_BACKUP="Đã sao lưu app cũ tại:"
  MSG_UI_INSTALLED="Đã cài UI:"
  MSG_UI_RESTARTED="Đã khởi động lại OreoDeck với phiên bản vừa cài."
  MSG_SKIP_UI="Bỏ qua UI; chỉ cài CLI."
  MSG_COMMANDS="Đã cài command:"
  MSG_ADD_PATH="Thêm dòng này vào ~/.zshrc rồi mở Terminal mới:"
  PROMPT_SHELL="Bạn có muốn lệnh claude tự đi qua profile active của OreoDeck không? [Y/n]: "
  MSG_SHELL_EXISTS="Shell integration đã tồn tại trong"
  MSG_SHELL_DONE="Đã cấu hình lệnh claude trong"
  MSG_SOURCE="Chạy: source ~/.zshrc"
  MSG_SKIP_SHELL="Bỏ qua shell integration. Dùng 'ord run -P <profile>' để mở Claude."
  MSG_START="Bắt đầu bằng: oreodeck add work"
else
  PROMPT_UI="Install the OreoDeck desktop UI too? [Y/n]: "
  MSG_INSTALL_CLI="Installing the OreoDeck CLI from prebuilt binaries..."
  MSG_NO_CLI="Error: this package has no prebuilt CLI and Bun is not installed."
  MSG_GET_RELEASE="Download the complete OreoDeck Release package or install Bun from https://bun.sh"
  MSG_BUILD_CLI="No prebuilt binary found; building the OreoDeck CLI..."
  MSG_PAYLOAD="Saved the UI payload for later installation with: ord ui install"
  MSG_INSTALL_UI="Installing the OreoDeck UI from the bundled app..."
  MSG_NO_APP="Error: this package has no prebuilt OreoDeck.app."
  MSG_UI_DEPS="Building the UI from source requires Bun, Rust/Cargo, and Xcode Command Line Tools."
  MSG_CLI_ONLY_OK="The CLI was installed successfully; the UI was not installed."
  MSG_BUILD_UI="No prebuilt app found; building the OreoDeck UI..."
  MSG_BACKUP="Backed up the previous app at:"
  MSG_UI_INSTALLED="Installed UI:"
  MSG_UI_RESTARTED="Restarted OreoDeck with the newly installed version."
  MSG_SKIP_UI="Skipping the UI; installing the CLI only."
  MSG_COMMANDS="Installed commands:"
  MSG_ADD_PATH="Add this line to ~/.zshrc, then open a new Terminal:"
  PROMPT_SHELL="Route the claude command through the active OreoDeck profile? [Y/n]: "
  MSG_SHELL_EXISTS="Shell integration already exists in"
  MSG_SHELL_DONE="Configured the claude command in"
  MSG_SOURCE="Run: source ~/.zshrc"
  MSG_SKIP_SHELL="Skipping shell integration. Use 'ord run -P <profile>' to launch Claude."
  MSG_START="Get started with: oreodeck add work"
fi

echo
INSTALL_UI="${OREODECK_INSTALL_UI:-}"
[ -n "$INSTALL_UI" ] || prompt_read "$PROMPT_UI" INSTALL_UI
INSTALL_UI="${INSTALL_UI:-Y}"

echo
if [ -x "$ROOT_DIR/dist/oreodeck" ] && [ -x "$ROOT_DIR/dist/ord" ]; then
  echo "$MSG_INSTALL_CLI"
else
  if ! command -v bun >/dev/null 2>&1; then
    echo "$MSG_NO_CLI"
    echo "$MSG_GET_RELEASE"
    exit 1
  fi
  echo "$MSG_BUILD_CLI"
  bun run build
fi
mkdir -p "$BIN_DIR"
install -m 755 "$ROOT_DIR/dist/oreodeck" "$BIN_DIR/oreodeck"
install -m 755 "$ROOT_DIR/dist/ord" "$BIN_DIR/ord"

# Keep license and attribution terms available beside installed release data,
# including CLI-only installations.
mkdir -p "$UI_PAYLOAD_DIR/legal/LICENSES"
install -m 644 "$ROOT_DIR/LICENSE" "$UI_PAYLOAD_DIR/legal/LICENSE"
install -m 644 "$ROOT_DIR/NOTICE" "$UI_PAYLOAD_DIR/legal/NOTICE"
install -m 644 "$ROOT_DIR/THIRD_PARTY_NOTICES.md" "$UI_PAYLOAD_DIR/legal/THIRD_PARTY_NOTICES.md"
install -m 644 "$ROOT_DIR/TRADEMARKS.md" "$UI_PAYLOAD_DIR/legal/TRADEMARKS.md"
for LICENSE_FILE in "$ROOT_DIR"/LICENSES/*.txt; do
  install -m 644 "$LICENSE_FILE" "$UI_PAYLOAD_DIR/legal/LICENSES/$(basename "$LICENSE_FILE")"
done

if [ -d "$ROOT_DIR/dist/OreoDeck.app" ]; then
  mkdir -p "$UI_PAYLOAD_DIR"
  rm -rf "$UI_PAYLOAD_DIR/OreoDeck.app"
  ditto "$ROOT_DIR/dist/OreoDeck.app" "$UI_PAYLOAD_DIR/OreoDeck.app"
  echo "$MSG_PAYLOAD"
fi

case "$INSTALL_UI" in
  y|Y|yes|YES|Yes)
    if [ -d "$ROOT_DIR/dist/OreoDeck.app" ]; then
      echo "$MSG_INSTALL_UI"
    else
      if ! command -v bun >/dev/null 2>&1 \
        || ! command -v cargo >/dev/null 2>&1 \
        || ! command -v xcodebuild >/dev/null 2>&1; then
        echo "$MSG_NO_APP"
        echo "$MSG_UI_DEPS"
        echo "$MSG_CLI_ONLY_OK"
        exit 1
      fi
      echo "$MSG_BUILD_UI"
      bun run build:app
    fi
    mkdir -p "$APP_DIR"
    # A menu-bar app keeps the old executable loaded after its bundle is
    # replaced. Stop it before copying so upgrades show the new UI immediately.
    pkill -x OreoDeck >/dev/null 2>&1 || true
    if [ -e "$APP_DIR/OreoDeck.app" ]; then
      BACKUP="$APP_DIR/OreoDeck.app.backup-$(date +%Y%m%d-%H%M%S)"
      mv "$APP_DIR/OreoDeck.app" "$BACKUP"
      echo "$MSG_BACKUP $BACKUP"
    fi
    ditto "$ROOT_DIR/dist/OreoDeck.app" "$APP_DIR/OreoDeck.app"
    echo "$MSG_UI_INSTALLED $APP_DIR/OreoDeck.app"
    open "$APP_DIR/OreoDeck.app"
    echo "$MSG_UI_RESTARTED"
    ;;
  *)
    echo "$MSG_SKIP_UI"
    ;;
esac

echo
echo "$MSG_COMMANDS $BIN_DIR/oreodeck, $BIN_DIR/ord"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo
    echo "$MSG_ADD_PATH"
    echo 'export PATH="$HOME/.local/bin:$PATH"'
    ;;
esac

echo
INSTALL_SHELL="${OREODECK_INSTALL_SHELL:-}"
[ -n "$INSTALL_SHELL" ] || prompt_read "$PROMPT_SHELL" INSTALL_SHELL
INSTALL_SHELL="${INSTALL_SHELL:-Y}"
case "$INSTALL_SHELL" in
  y|Y|yes|YES|Yes)
    ZSHRC="${HOME}/.zshrc"
    MARKER="# >>> OreoDeck shell integration v2 >>>"
    if grep -Fq "$MARKER" "$ZSHRC" 2>/dev/null; then
      echo "$MSG_SHELL_EXISTS $ZSHRC"
    else
      {
        echo
        "$BIN_DIR/oreodeck" shell-init
      } >> "$ZSHRC"
      echo "$MSG_SHELL_DONE $ZSHRC"
      echo "$MSG_SOURCE"
    fi
    ;;
  *)
    echo "$MSG_SKIP_SHELL"
    ;;
esac

echo
echo "$MSG_START"
