//! Raster codecs: TIFF/BigTIFF directories, LZW, Deflate, predictors.
//!
//! Ported from `cog.js` and held to the frozen goldens in
//! `native/fixtures/goldens.json` (bit-exact decode).

pub mod block;
pub mod lerc;
pub mod lzw;
pub mod predictor;
pub mod rows;
pub mod tiff;
pub mod tiled;

pub use block::{DecodeError, decode_block};
pub use tiff::{Geo, GeoValue, Level, Source, Tiff, TiffError, Windows, parse};
