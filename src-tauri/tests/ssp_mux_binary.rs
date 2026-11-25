#![cfg(feature = "encode")]

//! Keep the real `ssp-mux` helper available to the library's EOF-finalization
//! tests. Referencing `CARGO_BIN_EXE_ssp-mux` makes Cargo build the binary
//! alongside this integration-test target; the library tests locate it next
//! to their harness via `helper_path()`.

use std::path::Path;

#[test]
fn ssp_mux_helper_binary_is_built_for_tests() {
    let path = Path::new(env!("CARGO_BIN_EXE_ssp-mux"));
    assert!(
        path.is_file(),
        "ssp-mux binary missing at {}",
        path.display()
    );
}
