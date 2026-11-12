mod store;
#[cfg(feature = "encode")]
mod thumbs;

pub use store::LibraryHandle;
#[cfg(feature = "encode")]
pub use thumbs::extract_thumbnail;
// The finalized-row write joins the pipeline flow (task 1.6) — with no
// encode feature there is no stop path to call it from.
#[cfg(feature = "encode")]
pub use store::FinalizedRecording;
