// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CcmSpikeApp",
    platforms: [.macOS(.v13)],
    targets: [
        // Header-only C target: wraps the uniffi-generated C header + modulemap
        // so Swift can `import ccm_spike_rsFFI`. The actual symbols are provided
        // by the Rust staticlib, linked below via unsafeFlags.
        .target(
            name: "CcmSpikeCoreFFI",
            path: "Sources/CcmSpikeCoreFFI"
        ),
        // Pure-Swift target holding the uniffi-generated Swift bindings.
        .target(
            name: "CcmSpikeKit",
            dependencies: ["CcmSpikeCoreFFI"],
            path: "Sources/CcmSpikeKit"
        ),
        .executableTarget(
            name: "CcmSpikeApp",
            dependencies: ["CcmSpikeKit"],
            path: "Sources/CcmSpikeApp",
            linkerSettings: [
                .unsafeFlags([
                    "-L../ccm-spike-rs/target/release",
                    "-lccm_spike_rs",
                ])
            ]
        ),
    ]
)
