//! Rasters the engine produces: elevation grids, Terrarium images for the
//! image-only consumers of today's web client, and PNG encoding.

pub mod png;
pub mod sample;
pub mod terrarium;

use std::sync::OnceLock;

/// A 1×1 transparent PNG: "nothing here" for 2D overlays.
pub fn transparent_png() -> &'static [u8] {
    static PNG: OnceLock<Vec<u8>> = OnceLock::new();
    PNG.get_or_init(|| png::encode_rgba(&[0, 0, 0, 0], 1, 1))
}

/// A 256×256 Terrarium tile of a constant 0 m, for elevation routes only.
/// The 1×1 transparent tile decodes to −32768 m as terrain geometry, which
/// punches a pit into the mesh wherever data runs out.
pub fn sea_level_png() -> &'static [u8] {
    static PNG: OnceLock<Vec<u8>> = OnceLock::new();
    PNG.get_or_init(|| {
        let rgba: Vec<u8> = std::iter::repeat_n([128u8, 0, 0, 255], 256 * 256).flatten().collect();
        png::encode_rgba_level(&rgba, 256, 256, 9)
    })
}
