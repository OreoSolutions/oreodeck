// SwiftPM requires a C target to have at least one source file. The real
// symbols come from the Rust staticlib (see Package.swift linkerSettings);
// this target exists only to expose the generated header + module.modulemap
// under include/ as a Clang module named `ccm_coreFFI`.
