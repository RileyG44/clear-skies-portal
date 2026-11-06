//! ClearSkies scientific products (docs/native/ARCHITECTURE.md §4.1,
//! phase S): viewport DEM analysis ported from the JavaScript engine so the
//! phone computes them natively.
//!
//! Grids are row-major, row 0 north, NaN no-data, metres. Results are f32
//! rasters the size of the input, plus JSON metadata, framed by
//! [`contract::encode`] exactly as `research-contract.js` frames them.

pub mod contract;
pub mod fabric;
pub mod glacial;
pub mod moraine;
pub mod terrain;

/// A product's output.
#[derive(Debug, Clone, PartialEq)]
pub struct Product {
    pub data: Vec<f32>,
    pub secondary: Option<Vec<f32>>,
    pub metadata: serde_json::Value,
}

/// JavaScript's `Math.round`: halves toward +∞.
#[inline]
pub(crate) fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// JavaScript's `Number.prototype.toFixed` as a number.
pub(crate) fn fixed(v: f64, places: usize) -> f64 {
    format!("{v:.places$}").parse().unwrap_or(v)
}
