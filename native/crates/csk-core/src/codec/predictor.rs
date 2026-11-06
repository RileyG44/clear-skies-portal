//! TIFF predictors, undone in place.

/// Predictor 3 (floating point), ported from `cog.js:undoPredictor3`.
///
/// Rows are byte-wise horizontally differenced, then each sample's bytes are
/// stored as planes, most significant plane first, whatever the file's byte
/// order (libtiff `fpAcc`). Undo the differencing first, then gather the
/// planes. The result is little-endian samples. A short buffer leaves its
/// incomplete last row untouched, as the JS does.
pub fn undo_floating_point(buf: &mut [u8], width: usize, rows: usize, spp: usize, bps: usize) {
    let words = width * spp;
    let row_bytes = words * bps;
    if row_bytes == 0 {
        return;
    }
    let mut planes = vec![0u8; row_bytes];
    for row in buf.chunks_exact_mut(row_bytes).take(rows) {
        for i in spp..row_bytes {
            row[i] = row[i].wrapping_add(row[i - spp]);
        }
        planes.copy_from_slice(row);
        for n in 0..words {
            for b in 0..bps {
                row[bps * n + b] = planes[(bps - b - 1) * words + n];
            }
        }
    }
}

/// Predictor 2 (horizontal differencing) on little-endian samples of `bps`
/// bytes, wrapping in the sample's width as libtiff `horAcc8/16/32` does.
///
/// `cog.js:undoPredictor2` only handles 8-bit samples; 16- and 32-bit DEMs
/// with predictor 2 decode wrong there (`native/fixtures`, case
/// `int16-pred2-deflate`).
pub fn undo_horizontal(buf: &mut [u8], width: usize, rows: usize, spp: usize, bps: usize) {
    let row_bytes = width * spp * bps;
    if row_bytes == 0 {
        return;
    }
    for row in buf.chunks_exact_mut(row_bytes).take(rows) {
        match bps {
            1 => {
                for i in spp..row.len() {
                    row[i] = row[i].wrapping_add(row[i - spp]);
                }
            }
            2 => accumulate::<2>(row, spp, |b| u64::from(u16::from_le_bytes(b))),
            4 => accumulate::<4>(row, spp, |b| u64::from(u32::from_le_bytes(b))),
            8 => accumulate::<8>(row, spp, u64::from_le_bytes),
            _ => {}
        }
    }
}

fn accumulate<const B: usize>(row: &mut [u8], spp: usize, read: impl Fn([u8; B]) -> u64) {
    let mask = if B == 8 { u64::MAX } else { (1u64 << (8 * B)) - 1 };
    let at = |row: &[u8], i: usize| read(row[i * B..i * B + B].try_into().expect("B bytes"));
    for i in spp..row.len() / B {
        let v = at(row, i).wrapping_add(at(row, i - spp)) & mask;
        row[i * B..i * B + B].copy_from_slice(&v.to_le_bytes()[..B]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floating_point_round_trip() {
        // test-cog.js: split two floats into planes, difference, undo.
        let vals = [1234.5f32, 1240.25];
        let (w, bps) = (vals.len(), 4);
        let mut planed = vec![0u8; w * bps];
        for (n, v) in vals.iter().enumerate() {
            let le = v.to_le_bytes();
            for b in 0..bps {
                planed[(bps - b - 1) * w + n] = le[b];
            }
        }
        for i in (1..planed.len()).rev() {
            planed[i] = planed[i].wrapping_sub(planed[i - 1]);
        }
        undo_floating_point(&mut planed, w, 1, 1, bps);
        let got: Vec<f32> = planed.chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
        assert_eq!(got, vals);
    }

    #[test]
    fn horizontal_wraps_in_sample_width() {
        let vals: [i16; 4] = [-5, 30000, -30000, 12];
        let mut diffs = vals;
        for i in (1..4).rev() {
            diffs[i] = diffs[i].wrapping_sub(diffs[i - 1]);
        }
        let mut buf: Vec<u8> = diffs.iter().flat_map(|v| v.to_le_bytes()).collect();
        undo_horizontal(&mut buf, 4, 1, 1, 2);
        let got: Vec<i16> = buf.chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(got, vals);
    }
}
