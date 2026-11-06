//! The display-only water geography (water-geography.js): Natural Earth
//! land, ocean and inland water at 16384 x 8192 cells over longitude and
//! latitude, two bits a cell. Shading and the derived land-only floor read
//! it; heights never decide water.
//!
//! Bundled as the web build's run-length packing (generated/water-mask.rle):
//! runs of (u16 little-endian value, LEB128 count) filling the 16-bit packed
//! words. Texel (x, y) of the RGBA16UI mask holds cells 8x..8x+7 of rows
//! 4y..4y+3, one row per channel, most significant bits first.

use crate::Error;

pub const WIDTH: u32 = 16384;
pub const HEIGHT: u32 = 8192;
/// Mask texture size: 8 cells across a word, 4 rows across the channels.
pub const TEXTURE: (u32, u32) = (WIDTH / 8, HEIGHT / 4);

const PACKED: &[u8] = include_bytes!("../../../shaders/generated/water-mask.rle");

/// The decoded mask: `TEXTURE.0 * TEXTURE.1` RGBA16UI texels, row-major.
pub fn packed() -> Result<Vec<u16>, Error> {
    let total = (WIDTH / 8 * HEIGHT) as usize;
    let mut out = Vec::with_capacity(total);
    let mut i = 0;
    while i < PACKED.len() {
        let value = u16::from_le_bytes([PACKED[i], *PACKED.get(i + 1).ok_or(Error::Input("water mask"))?]);
        i += 2;
        let (mut count, mut shift) = (0usize, 0u32);
        loop {
            let part = *PACKED.get(i).ok_or(Error::Input("water mask"))?;
            i += 1;
            count |= usize::from(part & 127).checked_shl(shift).ok_or(Error::Input("water mask"))?;
            shift += 7;
            if part & 128 == 0 {
                break;
            }
        }
        if out.len() + count > total {
            return Err(Error::Input("water mask"));
        }
        out.resize(out.len() + count, value);
    }
    if out.len() != total {
        return Err(Error::Input("water mask"));
    }
    Ok(out)
}

/// The decoded mask, decoded once per process.
pub fn packed_cached() -> &'static [u16] {
    static MASK: std::sync::OnceLock<Vec<u16>> = std::sync::OnceLock::new();
    MASK.get_or_init(|| packed().expect("bundled water mask"))
}

/// 0: dry land, 1: ocean, 2: inland water, at a Web Mercator position.
pub fn class_at(packed: &[u16], merc: [f64; 2]) -> u8 {
    let latitude = (std::f64::consts::PI * (1.0 - 2.0 * merc[1])).sinh().atan().to_degrees();
    let x = ((merc[0].rem_euclid(1.0) * f64::from(WIDTH)).floor() as u32).min(WIDTH - 1);
    let y = ((90.0 - latitude) / 180.0 * f64::from(HEIGHT)).floor().clamp(0.0, f64::from(HEIGHT - 1)) as u32;
    let texel = ((y / 4) * TEXTURE.0 + x / 8) as usize;
    ((packed[texel * 4 + (y % 4) as usize] >> (14 - 2 * (x % 8))) & 3) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_land_ocean_and_inland_water() {
        let mask = packed().unwrap();
        let merc = |lon: f64, lat: f64| {
            let y = (1.0 - (lat.to_radians().tan() + 1.0 / lat.to_radians().cos()).ln() / std::f64::consts::PI) / 2.0;
            [(lon + 180.0) / 360.0, y]
        };
        // Spokane, the mid-Pacific and Lake Superior.
        assert_eq!(class_at(&mask, merc(-117.4, 47.66)), 0);
        assert_eq!(class_at(&mask, merc(-150.0, 20.0)), 1);
        assert_eq!(class_at(&mask, merc(-87.5, 47.7)), 2);
    }
}
