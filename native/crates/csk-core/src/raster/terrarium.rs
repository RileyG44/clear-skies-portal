//! Terrarium encoding, `elevation = R·256 + G + B/256 − 32768`: a centimetre
//! of precision over the whole range, as an ordinary image. Used only for
//! consumers that need an image (`<img>`, `createImageBitmap`); the engine
//! itself keeps float32 metres.

/// RGBA for a grid of metres; NaN becomes a transparent pixel.
pub fn encode(grid: &[f32]) -> Vec<u8> {
    let mut out = vec![0u8; grid.len() * 4];
    for (v, px) in grid.iter().zip(out.chunks_exact_mut(4)) {
        if v.is_nan() {
            continue;
        }
        let t = (f64::from(*v) + 32768.0).clamp(0.0, 65535.996);
        let whole = t.floor();
        px[0] = ((whole as u32) >> 8) as u8;
        px[1] = (whole as u32 & 255) as u8;
        px[2] = ((t - whole) * 256.0).floor() as u8;
        px[3] = 255;
    }
    out
}

/// Metres from Terrarium RGBA; a pixel with alpha below 255 is NaN.
pub fn decode(rgba: &[u8]) -> Vec<f32> {
    rgba.chunks_exact(4)
        .map(|p| {
            if p[3] < 255 {
                f32::NAN
            } else {
                (f64::from(p[0]) * 256.0 + f64::from(p[1]) + f64::from(p[2]) / 256.0 - 32768.0) as f32
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn centimetre_round_trip() {
        let grid = [0.0f32, 4392.25, -86.5, f32::NAN, 1234.567];
        let back = super::decode(&super::encode(&grid));
        for (a, b) in grid.iter().zip(&back) {
            assert!(a.is_nan() && b.is_nan() || (a - b).abs() < 0.004, "{a} {b}");
        }
        assert_eq!(&super::encode(&[0.0])[..], &[128, 0, 0, 255]);
    }
}
