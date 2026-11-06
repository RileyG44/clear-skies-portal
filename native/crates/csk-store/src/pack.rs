//! Elevation tiles on disk: the elev32 container (csk-core) with its
//! samples byte-shuffled into four planes and zstd-compressed.
//!
//! Shuffling puts the slowly varying sign/exponent bytes of neighbouring
//! samples next to each other, which is what lets a general-purpose
//! compressor do well on float32 terrain. The wire format never carries this.

use csk_core::elev32;

/// Header flag bit 0: zstd payload. Bit 1: byte-shuffled planes.
pub use elev32::{FLAG_SHUFFLE, FLAG_ZSTD};
const LEVEL: i32 = 3;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PackError {
    #[error("packed elevation: {0}")]
    Format(&'static str),
    #[error("packed elevation: zstd failed")]
    Zstd,
}

/// Packs a `width × height` grid of metres for the disk cache.
pub fn pack_elevation(width: u16, height: u16, samples: &[f32]) -> Vec<u8> {
    assert_eq!(samples.len(), usize::from(width) * usize::from(height), "pack: sample count");
    let n = samples.len();
    let mut planes = vec![0u8; n * 4];
    for (i, v) in samples.iter().enumerate() {
        let b = v.to_le_bytes();
        for (p, byte) in b.iter().enumerate() {
            planes[p * n + i] = *byte;
        }
    }
    let body = zstd::bulk::compress(&planes, LEVEL).expect("zstd compress into memory");
    let mut out = Vec::with_capacity(elev32::HEADER_BYTES + body.len());
    out.extend_from_slice(&elev32::MAGIC);
    out.push(elev32::VERSION);
    out.push(FLAG_ZSTD | FLAG_SHUFFLE);
    out.extend_from_slice(&(elev32::HEADER_BYTES as u16).to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&body);
    out
}

/// Unpacks to `(width, height, samples)`.
pub fn unpack_elevation(bytes: &[u8]) -> Result<(u16, u16, Vec<f32>), PackError> {
    if bytes.len() < elev32::HEADER_BYTES || bytes[..4] != elev32::MAGIC {
        return Err(PackError::Format("bad header"));
    }
    if bytes[4] != elev32::VERSION {
        return Err(PackError::Format("version"));
    }
    if bytes[5] != FLAG_ZSTD | FLAG_SHUFFLE {
        return Err(PackError::Format("flags"));
    }
    let header = usize::from(u16::from_le_bytes([bytes[6], bytes[7]]));
    let width = u16::from_le_bytes([bytes[8], bytes[9]]);
    let height = u16::from_le_bytes([bytes[10], bytes[11]]);
    let n = usize::from(width) * usize::from(height);
    if header < elev32::HEADER_BYTES || header > bytes.len() || n == 0 {
        return Err(PackError::Format("header size"));
    }
    let planes = zstd::bulk::decompress(&bytes[header..], n * 4).map_err(|_| PackError::Zstd)?;
    if planes.len() != n * 4 {
        return Err(PackError::Format("length"));
    }
    let samples =
        (0..n).map(|i| f32::from_le_bytes([planes[i], planes[n + i], planes[2 * n + i], planes[3 * n + i]])).collect();
    Ok((width, height, samples))
}

#[cfg(test)]
mod tests {
    #[test]
    fn round_trip_is_bit_exact_and_small() {
        let (w, h) = (258u16, 258u16);
        let s: Vec<f32> = (0..usize::from(w) * usize::from(h))
            .map(|i| if i % 997 == 0 { f32::NAN } else { 1200.0 + (i % 258) as f32 * 0.37 + (i / 258) as f32 * 0.11 })
            .collect();
        let packed = super::pack_elevation(w, h, &s);
        let (pw, ph, back) = super::unpack_elevation(&packed).unwrap();
        assert_eq!((pw, ph), (w, h));
        assert!(s.iter().zip(&back).all(|(a, b)| a.to_bits() == b.to_bits()));
        assert!(packed.len() < s.len() * 4 / 2, "{} bytes", packed.len());
    }
}
