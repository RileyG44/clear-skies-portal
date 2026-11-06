//! ClearSkies native engine core (docs/native/ARCHITECTURE.md §4.1).
//!
//! Phase 1 groundwork: the raster codecs, the transition elevation format
//! and the engine's current geodesy, each held to frozen goldens produced
//! from today's JavaScript engine (`native/fixtures`).

pub mod codec;
pub mod elev32;
pub mod geo;
pub mod raster;
