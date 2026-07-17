// uniffi_bindgen (crates.io) ships NO binary — `cargo install uniffi_bindgen`
// fails with "there is nothing to install ... it has no binaries". Every
// consuming crate must declare its own [[bin]] wrapper like this one. Bonus:
// because this binary is built from this crate's own Cargo.lock, the bindgen
// and the uniffi runtime linked into the library can never drift apart, so no
// separate version pin is needed.
fn main() {
    uniffi::uniffi_bindgen_main()
}
