# Third-party notices

OreoDeck includes and builds upon third-party open-source software. Those
components remain governed by their respective licenses; the Apache-2.0 license
for OreoDeck does not replace their terms.

This notice covers the direct dependencies used by the current `v0.1.0` source
and release build. Exact resolved versions and transitive dependency graphs are
recorded in `bun.lock`, `packages/core-rs/Cargo.lock`, and
`packages/app/Package.resolved`.

## Runtime and generated-code dependencies

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Commander.js | 12.1.0 | MIT | https://github.com/tj/commander.js |
| UniFFI and support crates | 0.32.0 | MPL-2.0 | https://github.com/mozilla/uniffi-rs |
| thiserror | 2.x | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| serde / serde_json | 1.x | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| chrono | 0.4.x | MIT OR Apache-2.0 | https://github.com/chronotope/chrono |
| security-framework | 3.x | MIT OR Apache-2.0 | https://github.com/kornelski/rust-security-framework |
| regex | 1.x | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |

Rust transitive dependencies use their own license expressions, primarily MIT,
Apache-2.0, or a choice of those licenses. Their authoritative metadata and
notices are included in their source distributions. Target-specific crates not
compiled into the macOS release may also appear in `Cargo.lock`.

UniFFI source is available from its upstream repository and through the version
pinned by Cargo. Its complete terms are in `LICENSES/MPL-2.0.txt`.

## Development and test dependencies

| Component | Version | License | Source |
| --- | --- | --- | --- |
| TypeScript | 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| @types/node | 22.20.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| bun-types | 1.3.14 | MIT | https://github.com/oven-sh/bun |
| ViewInspector | 0.9.x | MIT | https://github.com/nalexn/ViewInspector |
| serial_test | 3.x | MIT | https://github.com/palfrey/serial_test |
| tempfile | 3.x | MIT OR Apache-2.0 | https://github.com/Stebalien/tempfile |

Development-only dependencies are not bundled unless their generated output is
explicitly part of the build.

## Included license texts

- OreoDeck: `LICENSE` (Apache-2.0)
- Mozilla Public License 2.0: `LICENSES/MPL-2.0.txt`
- MIT License template: `LICENSES/MIT.txt`

Copyright and attribution notices contained in third-party source distributions
and generated files must be preserved when those materials are redistributed.
