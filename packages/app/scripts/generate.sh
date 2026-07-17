#!/usr/bin/env bash
# Builds the Rust staticlib and regenerates the Swift bindings FROM THE BUILT
# LIBRARY (there is no .udl in this project), then copies them into the SPM
# source tree. Everything it writes under Sources/ is gitignored — this script
# is the only way those files come into existence, so run it after any change
# to packages/core-rs/src/api.rs.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$(cd "$APP_DIR/../core-rs" && pwd)"

cd "$CORE_DIR"
cargo build --release -p ccm-core
# uniffi-bindgen is a [[bin]] of THIS crate (the uniffi_bindgen crate ships no
# binary), so it is always version-matched with the uniffi runtime in the .a.
./target/release/uniffi-bindgen generate \
  --library ./target/release/libccm_core.a \
  --language swift \
  --out-dir ./Generated

mkdir -p "$APP_DIR/Sources/CcmCoreFFI/include" "$APP_DIR/Sources/CcmKit"
cp "$CORE_DIR/Generated/ccm_core.swift" "$APP_DIR/Sources/CcmKit/ccm_core.swift"
cp "$CORE_DIR/Generated/ccm_coreFFI.h" "$APP_DIR/Sources/CcmCoreFFI/include/ccm_coreFFI.h"
# SwiftPM's convention wants the file called module.modulemap.
cp "$CORE_DIR/Generated/ccm_coreFFI.modulemap" "$APP_DIR/Sources/CcmCoreFFI/include/module.modulemap"

echo "generate: ok"
