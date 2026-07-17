// swift-tools-version: 6.0
import PackageDescription

// Link flags for the Rust staticlib. VERIFIED, twice over:
//  - SwiftPM resolves a relative `-L` against the PACKAGE ROOT (packages/app),
//    not the process cwd, so `swift build --package-path packages/app` from the
//    repo root works.
//  - linkerSettings are NOT inherited by targets that merely depend on CcmKit.
//    Omitting them on the test target fails at link with
//    "Undefined symbols ... _ffi_ccm_core_rustbuffer_free". Both the executable
//    and the test target must repeat them.
// Caveat: `unsafeFlags` makes this package unusable as another package's
// dependency. Fine — CcmApp is always the root package; nobody imports it.
let rustLinkFlags: [LinkerSetting] = [
    .unsafeFlags([
        "-L../core-rs/target/release",
        "-lccm_core",
    ])
]

let package = Package(
    name: "CcmApp",
    // .v15 floor: `.defaultLaunchBehavior(.suppressed)` (macOS 15+) keeps the
    // dashboard Window from auto-opening at launch — this is a menu-bar agent.
    platforms: [.macOS(.v15)],
    // ViewInspector: test-only, linked only into CcmUITests below (never into
    // CcmApp/CcmUI), so it adds nothing to the shipped app or its 0-warning
    // release build. Added for the Task 3 review's Critical finding — the
    // model already turned every action failure into human copy, but nothing
    // rendered it, and that class of gap is invisible to a `swift test`-only
    // strategy without a way to assert on the actual SwiftUI render tree
    // (`screencapture`/Accessibility are unavailable in this sandbox, so a
    // human-eyes check alone can't be the only net either).
    dependencies: [
        .package(url: "https://github.com/nalexn/ViewInspector", from: "0.9.0")
    ],
    targets: [
        // Header-only C target wrapping the uniffi-generated header + modulemap
        // so Swift can `import ccm_coreFFI`. The symbols themselves come from
        // the Rust staticlib linked above. SwiftPM requires a C target to have
        // at least one source file, hence empty.c.
        .target(
            name: "CcmCoreFFI",
            path: "Sources/CcmCoreFFI"
        ),
        // Pure-Swift target holding the uniffi-generated bindings
        // (Sources/CcmKit/ccm_core.swift — generated, gitignored).
        .target(
            name: "CcmKit",
            dependencies: ["CcmCoreFFI"],
            path: "Sources/CcmKit"
        ),
        // All testable logic lives here; CcmApp is only @main.
        .target(
            name: "CcmUI",
            dependencies: ["CcmKit"],
            path: "Sources/CcmUI"
        ),
        .executableTarget(
            name: "CcmApp",
            dependencies: ["CcmUI", "CcmKit"],
            path: "Sources/CcmApp",
            linkerSettings: rustLinkFlags
        ),
        .testTarget(
            name: "CcmUITests",
            dependencies: ["CcmUI", "CcmKit", "ViewInspector"],
            path: "Tests/CcmUITests",
            linkerSettings: rustLinkFlags
        ),
    ]
)
