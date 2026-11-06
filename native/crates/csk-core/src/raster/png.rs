//! A small, fast PNG encoder for tiles: 8-bit grey, grey+alpha, RGB or RGBA
//! (the narrowest that holds the pixels exactly), per-row adaptive filtering
//! over all five PNG filters, zlib via miniz_oxide.

use miniz_oxide::deflate::compress_to_vec_zlib;

/// zlib level for tiles: close to level 6's size at a fraction of the time
/// on filtered terrain rows.
pub const LEVEL: u8 = 4;

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// Encodes `rgba` (`width * height * 4` bytes, row-major).
///
/// Panics if `rgba` has the wrong length: that is a caller bug.
pub fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    encode_rgba_level(rgba, width, height, LEVEL)
}

pub fn encode_rgba_level(rgba: &[u8], width: u32, height: u32, level: u8) -> Vec<u8> {
    let px = width as usize * height as usize;
    assert_eq!(rgba.len(), px * 4, "png: pixel buffer length");
    let (mut grey, mut opaque) = (true, true);
    for p in rgba.chunks_exact(4) {
        opaque &= p[3] == 255;
        grey &= p[0] == p[1] && p[0] == p[2];
        if !grey && !opaque {
            break;
        }
    }
    let (bpp, color_type) = match (grey, opaque) {
        (true, true) => (1, 0),
        (true, false) => (2, 4),
        (false, true) => (3, 2),
        (false, false) => (4, 6),
    };
    let packed: Vec<u8> = if bpp == 4 {
        rgba.to_vec()
    } else {
        let mut out = Vec::with_capacity(px * bpp);
        for p in rgba.chunks_exact(4) {
            match bpp {
                1 => out.push(p[0]),
                2 => out.extend_from_slice(&[p[0], p[3]]),
                _ => out.extend_from_slice(&p[..3]),
            }
        }
        out
    };
    let stride = width as usize * bpp;
    let raw = filter_rows(&packed, stride, height as usize, bpp);

    let mut ihdr = [0u8; 13];
    ihdr[..4].copy_from_slice(&width.to_be_bytes());
    ihdr[4..8].copy_from_slice(&height.to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = color_type;
    let idat = compress_to_vec_zlib(&raw, level);
    let mut out = Vec::with_capacity(idat.len() + 64);
    out.extend_from_slice(&SIGNATURE);
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &idat);
    chunk(&mut out, b"IEND", &[]);
    out
}

/// Chooses each row's filter by the minimum sum of absolute differences
/// (the libpng heuristic) and writes `filter byte + row` per row.
fn filter_rows(packed: &[u8], stride: usize, rows: usize, bpp: usize) -> Vec<u8> {
    let mut raw = Vec::with_capacity((stride + 1) * rows);
    let zero = vec![0u8; stride];
    let mut cand: [Vec<u8>; 5] = std::array::from_fn(|_| vec![0u8; stride]);
    for y in 0..rows {
        let row = &packed[y * stride..(y + 1) * stride];
        let up = if y == 0 { &zero[..] } else { &packed[(y - 1) * stride..y * stride] };
        let mut best = (0usize, u64::MAX);
        for (f, c) in cand.iter_mut().enumerate() {
            let mut cost = 0u64;
            for i in 0..stride {
                let a = if i >= bpp { row[i - bpp] } else { 0 };
                let b = up[i];
                let cc = if i >= bpp { up[i - bpp] } else { 0 };
                let pred = match f {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                    _ => paeth(a, b, cc),
                };
                let d = row[i].wrapping_sub(pred);
                c[i] = d;
                cost += u64::from((d as i8).unsigned_abs());
                if cost >= best.1 {
                    break;
                }
            }
            if cost < best.1 {
                best = (f, cost);
            }
        }
        raw.push(best.0 as u8);
        // Only losing candidates stop early, so the winner is whole.
        raw.extend_from_slice(&cand[best.0]);
    }
    raw
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = i16::from(a) + i16::from(b) - i16::from(c);
    let (pa, pb, pc) = ((p - i16::from(a)).abs(), (p - i16::from(b)).abs(), (p - i16::from(c)).abs());
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = out.len();
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let crc = crc32(&out[start..]);
    out.extend_from_slice(&crc.to_be_bytes());
}

pub fn crc32(bytes: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let t = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (n, slot) in t.iter_mut().enumerate() {
            let mut c = n as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *slot = c;
        }
        t
    });
    !bytes.iter().fold(!0u32, |c, &b| t[((c ^ u32::from(b)) & 0xff) as usize] ^ (c >> 8))
}

/// Decodes the PNGs this module writes (8-bit, non-interlaced) back to RGBA.
/// Used for checks and for reading cached Terrarium tiles from upstream.
pub fn decode_rgba(png: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if png.len() < 8 || png[..8] != SIGNATURE {
        return None;
    }
    let (mut at, mut idat, mut hdr) = (8usize, Vec::new(), None);
    while at + 8 <= png.len() {
        let len = u32::from_be_bytes(png[at..at + 4].try_into().ok()?) as usize;
        let kind = &png[at + 4..at + 8];
        let data = png.get(at + 8..at + 8 + len)?;
        match kind {
            b"IHDR" if len == 13 => hdr = Some(data.to_vec()),
            b"IDAT" => idat.extend_from_slice(data),
            b"IEND" => break,
            _ => {}
        }
        at += 12 + len;
    }
    let h = hdr?;
    let (w, ht) = (u32::from_be_bytes(h[..4].try_into().ok()?), u32::from_be_bytes(h[4..8].try_into().ok()?));
    if h[8] != 8 || h[12] != 0 {
        return None;
    }
    let bpp = match h[9] {
        0 => 1,
        4 => 2,
        2 => 3,
        6 => 4,
        _ => return None,
    };
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib(&idat).ok()?;
    let stride = w as usize * bpp;
    if raw.len() < (stride + 1) * ht as usize {
        return None;
    }
    let mut cur = vec![0u8; stride];
    let mut prev = vec![0u8; stride];
    let mut out = Vec::with_capacity(w as usize * ht as usize * 4);
    for y in 0..ht as usize {
        let line = &raw[y * (stride + 1)..(y + 1) * (stride + 1)];
        for i in 0..stride {
            let a = if i >= bpp { cur[i - bpp] } else { 0 };
            let b = prev[i];
            let c = if i >= bpp { prev[i - bpp] } else { 0 };
            let pred = match line[0] {
                0 => 0,
                1 => a,
                2 => b,
                3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                4 => paeth(a, b, c),
                _ => return None,
            };
            cur[i] = line[1 + i].wrapping_add(pred);
        }
        for p in cur.chunks_exact(bpp) {
            match bpp {
                1 => out.extend_from_slice(&[p[0], p[0], p[0], 255]),
                2 => out.extend_from_slice(&[p[0], p[0], p[0], p[1]]),
                3 => out.extend_from_slice(&[p[0], p[1], p[2], 255]),
                _ => out.extend_from_slice(p),
            }
        }
        std::mem::swap(&mut cur, &mut prev);
    }
    Some((w, ht, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_colour_type() {
        let w = 37u32;
        let cases: [&dyn Fn(usize) -> [u8; 4]; 4] = [
            &|i| {
                let v = (i % 251) as u8;
                [v, v, v, 255]
            },
            &|i| [(i % 7) as u8, (i % 7) as u8, (i % 7) as u8, (i % 3) as u8 * 100],
            &|i| [(i * 3) as u8, (i * 5) as u8, (i * 7) as u8, 255],
            &|i| [(i * 3) as u8, (i * 5) as u8, (i * 7) as u8, (i * 11) as u8],
        ];
        for f in cases {
            let rgba: Vec<u8> = (0..(w * 23) as usize).flat_map(f).collect();
            let png = encode_rgba(&rgba, w, 23);
            let (dw, dh, back) = decode_rgba(&png).unwrap();
            assert_eq!((dw, dh), (w, 23));
            assert_eq!(back, rgba);
        }
        assert_eq!(crc32(b"IEND"), 0xae42_6082);
    }
}
