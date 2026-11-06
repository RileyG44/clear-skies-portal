//! `application/vnd.clearskies.elev32`: float32 elevation tiles for the
//! WebView map while it is fed by the in-app engine
//! (docs/native/ARCHITECTURE.md §4.3).
//!
//! | Offset | Field |
//! |---|---|
//! | 0–3 | ASCII `CSE2` |
//! | 4 | u8 version = 1 |
//! | 5 | u8 flags (bit 0 = zstd payload; disk only, never on the wire) |
//! | 6–7 | u16 LE header bytes = 16 |
//! | 8–9 | u16 LE width |
//! | 10–11 | u16 LE height |
//! | 12–15 | u32 LE reserved = 0 |
//! | 16… | f32 LE row-major metres, top-left first; NaN = invalid |

use std::fmt;

pub const MAGIC: [u8; 4] = *b"CSE2";
pub const VERSION: u8 = 1;
pub const HEADER_BYTES: usize = 16;
pub const FLAG_ZSTD: u8 = 1;
pub const MEDIA_TYPE: &str = "application/vnd.clearskies.elev32";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Elev32Error {
    Short,
    Magic,
    Version(u8),
    /// A header longer than this reader knows is fine (it is skipped); a
    /// shorter one is not.
    HeaderBytes(u16),
    /// The payload is compressed; only the disk cache does that.
    Compressed,
    Flags(u8),
    Empty,
    Length {
        expected: usize,
        actual: usize,
    },
}

impl fmt::Display for Elev32Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Short => write!(f, "elev32: shorter than its header"),
            Self::Magic => write!(f, "elev32: bad magic"),
            Self::Version(v) => write!(f, "elev32: unsupported version {v}"),
            Self::HeaderBytes(n) => write!(f, "elev32: header size {n} below {HEADER_BYTES}"),
            Self::Compressed => write!(f, "elev32: compressed payload on the wire"),
            Self::Flags(v) => write!(f, "elev32: unknown flags {v:#04x}"),
            Self::Empty => write!(f, "elev32: zero width or height"),
            Self::Length { expected, actual } => write!(f, "elev32: payload {actual} bytes, expected {expected}"),
        }
    }
}

impl std::error::Error for Elev32Error {}

/// A decoded header, borrowing its samples' bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct View<'a> {
    pub width: u16,
    pub height: u16,
    /// `width * height` little-endian f32 values.
    pub payload: &'a [u8],
}

impl View<'_> {
    pub fn samples(&self) -> impl ExactSizeIterator<Item = f32> + '_ {
        self.payload.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().expect("4 bytes")))
    }
}

/// Encodes a tile for the wire (uncompressed). Panics if `samples` is not
/// `width * height` long or a side is zero: that is a caller bug.
pub fn encode(width: u16, height: u16, samples: &[f32]) -> Vec<u8> {
    assert!(width > 0 && height > 0, "elev32: empty tile");
    assert_eq!(samples.len(), usize::from(width) * usize::from(height), "elev32: sample count");
    let mut out = Vec::with_capacity(HEADER_BYTES + samples.len() * 4);
    out.extend_from_slice(&MAGIC);
    out.push(VERSION);
    out.push(0);
    out.extend_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    for v in samples {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Checks the header and length of a wire tile, as the page does. The
/// producing engine validates values; this does not look at them.
pub fn decode(bytes: &[u8]) -> Result<View<'_>, Elev32Error> {
    if bytes.len() < HEADER_BYTES {
        return Err(Elev32Error::Short);
    }
    if bytes[..4] != MAGIC {
        return Err(Elev32Error::Magic);
    }
    if bytes[4] != VERSION {
        return Err(Elev32Error::Version(bytes[4]));
    }
    let flags = bytes[5];
    if flags & FLAG_ZSTD != 0 {
        return Err(Elev32Error::Compressed);
    }
    if flags != 0 {
        return Err(Elev32Error::Flags(flags));
    }
    let header = u16::from_le_bytes([bytes[6], bytes[7]]);
    if usize::from(header) < HEADER_BYTES {
        return Err(Elev32Error::HeaderBytes(header));
    }
    let width = u16::from_le_bytes([bytes[8], bytes[9]]);
    let height = u16::from_le_bytes([bytes[10], bytes[11]]);
    if width == 0 || height == 0 {
        return Err(Elev32Error::Empty);
    }
    let expected = usize::from(header) + usize::from(width) * usize::from(height) * 4;
    if bytes.len() != expected {
        return Err(Elev32Error::Length { expected, actual: bytes.len() });
    }
    Ok(View { width, height, payload: &bytes[usize::from(header)..] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_bits_and_nan() {
        let samples = [1234.5f32, f32::NAN, -0.0, 4392.25, f32::MIN_POSITIVE, -86.0];
        let bytes = encode(3, 2, &samples);
        assert_eq!(&bytes[..16], b"CSE2\x01\x00\x10\x00\x03\x00\x02\x00\x00\x00\x00\x00");
        let view = decode(&bytes).unwrap();
        assert_eq!((view.width, view.height), (3, 2));
        let got: Vec<u32> = view.samples().map(f32::to_bits).collect();
        let want: Vec<u32> = samples.iter().map(|v| v.to_bits()).collect();
        assert_eq!(got, want);
    }

    #[test]
    fn rejects_what_the_page_must_not_draw() {
        let good = encode(2, 2, &[1.0; 4]);
        assert_eq!(decode(&good[..15]), Err(Elev32Error::Short));
        assert_eq!(decode(&good[..good.len() - 1]), Err(Elev32Error::Length { expected: 32, actual: 31 }));
        let mut bad = good.clone();
        bad[0] = b'X';
        assert_eq!(decode(&bad), Err(Elev32Error::Magic));
        let mut bad = good.clone();
        bad[4] = 2;
        assert_eq!(decode(&bad), Err(Elev32Error::Version(2)));
        let mut bad = good.clone();
        bad[5] = FLAG_ZSTD;
        assert_eq!(decode(&bad), Err(Elev32Error::Compressed));
        let mut bad = good.clone();
        bad[8] = 0;
        bad[9] = 0;
        assert_eq!(decode(&bad), Err(Elev32Error::Empty));
    }

    #[test]
    fn longer_headers_are_skipped() {
        let mut bytes = encode(1, 1, &[7.0]);
        bytes[6] = 20;
        bytes.splice(16..16, [0u8; 4]);
        assert_eq!(decode(&bytes).unwrap().samples().next(), Some(7.0));
    }
}
