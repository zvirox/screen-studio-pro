mod store;

pub use store::LibraryHandle;
// The finalized-row write joins the pipeline flow (task 1.6) — with no
// encode feature there is no stop path to call it from.
#[cfg(feature = "encode")]
pub use store::FinalizedRecording;
