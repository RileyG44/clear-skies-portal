//! TIFF and BigTIFF directory parsing, ported from `cog.js:parseTiff`.
//!
//! The engine rarely holds a whole file: it range-reads a head, and for
//! ordinary TIFFs whose directory sits at the end, a tail from the first IFD.
//! A [`Source`] answers reads at absolute file offsets from whatever windows
//! it holds. Unlike `cog.js`, a read outside them is never treated as zeros:
//! a directory whose entries or tables are not all held is reported as
//! incomplete and is not returned as a level, so a tile table of zeros can
//! never be mistaken for a real one.

use std::fmt;

/// Bytes of a file at absolute offsets.
pub trait Source {
    /// `len` bytes at `offset`, or `None` if they are not all held.
    fn bytes(&self, offset: u64, len: usize) -> Option<&[u8]>;
}

impl Source for [u8] {
    fn bytes(&self, offset: u64, len: usize) -> Option<&[u8]> {
        let start = usize::try_from(offset).ok()?;
        self.get(start..start.checked_add(len)?)
    }
}

impl Source for Vec<u8> {
    fn bytes(&self, offset: u64, len: usize) -> Option<&[u8]> {
        self.as_slice().bytes(offset, len)
    }
}

/// Several byte ranges of one file, e.g. a head and a tail read separately.
#[derive(Debug, Default)]
pub struct Windows<'a> {
    parts: Vec<(u64, &'a [u8])>,
}

impl<'a> Windows<'a> {
    pub fn new() -> Self {
        Self::default()
    }
    /// Adds the bytes that start at file offset `at`.
    pub fn with(mut self, at: u64, bytes: &'a [u8]) -> Self {
        self.parts.push((at, bytes));
        self
    }
}

impl Source for Windows<'_> {
    fn bytes(&self, offset: u64, len: usize) -> Option<&[u8]> {
        self.parts.iter().find_map(|&(at, part)| {
            let start = usize::try_from(offset.checked_sub(at)?).ok()?;
            part.get(start..start.checked_add(len)?)
        })
    }
}

/// One image in the file: full resolution first, then overviews.
#[derive(Debug, Clone, PartialEq)]
pub struct Level {
    pub width: u32,
    pub height: u32,
    /// Block size. A strip is a block as wide as the image.
    pub block_width: u32,
    pub block_height: u32,
    pub compression: u16,
    pub predictor: u16,
    pub bits_per_sample: u16,
    pub samples_per_pixel: u16,
    pub sample_format: u16,
    pub offsets: Vec<u64>,
    pub counts: Vec<u64>,
    pub stripped: bool,
}

impl Level {
    pub fn blocks_across(&self) -> u32 {
        self.width.div_ceil(self.block_width.max(1))
    }
    pub fn blocks_down(&self) -> u32 {
        self.height.div_ceil(self.block_height.max(1))
    }
}

/// Georeferencing from the first image, as the engine reads it today.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Geo {
    /// ModelPixelScaleTag (33550).
    pub pixel_scale: Vec<f64>,
    /// ModelTiepointTag (33922).
    pub tiepoint: Vec<f64>,
    /// ProjectedCSTypeGeoKey (3072), when present.
    pub epsg: Option<u32>,
    /// GeoAsciiParamsTag (34737), NULs removed.
    pub citation: String,
    /// GDAL_NODATA (42113).
    pub nodata: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tiff {
    pub little_endian: bool,
    pub big: bool,
    pub levels: Vec<Level>,
    pub geo: Geo,
    /// False when the IFD chain or a directory's tables ran past the held
    /// bytes: the caller should read more before concluding anything.
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TiffError {
    /// The 8-byte header is not held.
    ShortHeader,
    NotTiff {
        version: u16,
    },
    /// No directory with tiles or strips could be read from the held bytes.
    NoReadableIfd,
}

impl fmt::Display for TiffError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ShortHeader => write!(f, "TIFF header not available"),
            Self::NotTiff { version } => write!(f, "not a TIFF (version {version})"),
            Self::NoReadableIfd => write!(f, "no readable IFD found (neither tiles nor strips)"),
        }
    }
}

impl std::error::Error for TiffError {}

/// At most this many directories are followed (`cog.js` guard).
pub const MAX_IFDS: usize = 16;
/// A tag with more values than this is treated as unreadable.
const MAX_VALUES: u64 = 1 << 24;

struct Reader<'a, S: Source + ?Sized> {
    src: &'a S,
    le: bool,
    big: bool,
}

#[derive(Clone, Copy)]
struct Entry {
    typ: u16,
    count: u64,
    /// Absolute offset of the values (inline values point into the entry).
    at: u64,
}

impl<S: Source + ?Sized> Reader<'_, S> {
    fn array<const N: usize>(&self, at: u64) -> Option<[u8; N]> {
        self.src.bytes(at, N)?.try_into().ok()
    }
    fn u16(&self, at: u64) -> Option<u16> {
        let b = self.array::<2>(at)?;
        Some(if self.le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) })
    }
    fn u32(&self, at: u64) -> Option<u32> {
        let b = self.array::<4>(at)?;
        Some(if self.le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
    }
    fn u64(&self, at: u64) -> Option<u64> {
        let b = self.array::<8>(at)?;
        Some(if self.le { u64::from_le_bytes(b) } else { u64::from_be_bytes(b) })
    }
    fn offset(&self, at: u64) -> Option<u64> {
        if self.big { self.u64(at) } else { self.u32(at).map(u64::from) }
    }

    /// Entries of the IFD at `ifd` and the next IFD's offset, or `None` if
    /// the directory is not all held.
    fn directory(&self, ifd: u64) -> Option<(Vec<(u16, Entry)>, u64)> {
        let n = if self.big { self.u64(ifd)? } else { u64::from(self.u16(ifd)?) };
        let (first, size) = if self.big { (ifd + 8, 20) } else { (ifd + 2, 12) };
        let n = n.min(4096);
        let mut entries = Vec::with_capacity(n as usize);
        for i in 0..n {
            let e = first + i * size;
            let tag = self.u16(e)?;
            let typ = self.u16(e + 2)?;
            let count = if self.big { self.u64(e + 4)? } else { u64::from(self.u32(e + 4)?) };
            let value = if self.big { e + 12 } else { e + 8 };
            let bytes = type_size(typ).saturating_mul(count);
            let at = if bytes <= if self.big { 8 } else { 4 } { value } else { self.offset(value)? };
            entries.push((tag, Entry { typ, count, at }));
        }
        let next = self.offset(first + n * size)?;
        Some((entries, next))
    }

    /// Numeric values of a tag, or `None` if they are not all held.
    fn numbers(&self, e: Entry) -> Option<Vec<f64>> {
        if e.count > MAX_VALUES {
            return None;
        }
        let size = type_size(e.typ);
        let raw = self.src.bytes(e.at, usize::try_from(size * e.count).ok()?)?;
        let le = self.le;
        let mut out = Vec::with_capacity(e.count as usize);
        for c in raw.chunks_exact(size as usize) {
            let v = match (e.typ, c.len()) {
                (1 | 2 | 7, _) => f64::from(c[0]),
                (6, _) => f64::from(c[0] as i8),
                (3, _) => f64::from(u16_of(c, le)),
                (8, _) => f64::from(u16_of(c, le) as i16),
                (4, _) => f64::from(u32_of(c, le)),
                (9, _) => f64::from(u32_of(c, le) as i32),
                (11, _) => f64::from(f32::from_bits(u32_of(c, le))),
                (12, _) => f64::from_bits(u64_of(c, le)),
                (16, _) => u64_of(c, le) as f64,
                (17, _) => u64_of(c, le) as i64 as f64,
                (5, _) => f64::from(u32_of(&c[..4], le)) / f64::from(u32_of(&c[4..], le)),
                (10, _) => f64::from(u32_of(&c[..4], le) as i32) / f64::from(u32_of(&c[4..], le) as i32),
                _ => f64::from(c[0]),
            };
            out.push(v);
        }
        Some(out)
    }

    /// Unsigned integer values (offsets, counts, sizes) without f64 rounding.
    fn integers(&self, e: Entry) -> Option<Vec<u64>> {
        if e.count > MAX_VALUES {
            return None;
        }
        let size = type_size(e.typ);
        let raw = self.src.bytes(e.at, usize::try_from(size * e.count).ok()?)?;
        let le = self.le;
        Some(
            raw.chunks_exact(size as usize)
                .map(|c| match e.typ {
                    3 | 8 => u64::from(u16_of(c, le)),
                    4 | 9 => u64::from(u32_of(c, le)),
                    16 | 17 => u64_of(c, le),
                    _ => u64::from(c[0]),
                })
                .collect(),
        )
    }

    fn text(&self, e: Entry) -> Option<String> {
        let raw = self.src.bytes(e.at, usize::try_from(e.count.min(MAX_VALUES)).ok()?)?;
        Some(raw.iter().filter(|&&b| b != 0).map(|&b| char::from(b)).collect())
    }
}

fn type_size(typ: u16) -> u64 {
    match typ {
        3 | 8 => 2,
        4 | 9 | 11 => 4,
        5 | 10 | 12 | 16 | 17 | 18 => 8,
        _ => 1,
    }
}
fn u16_of(c: &[u8], le: bool) -> u16 {
    let b = [c[0], c[1]];
    if le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) }
}
fn u32_of(c: &[u8], le: bool) -> u32 {
    let b = [c[0], c[1], c[2], c[3]];
    if le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) }
}
fn u64_of(c: &[u8], le: bool) -> u64 {
    let b: [u8; 8] = c[..8].try_into().expect("8 bytes");
    if le { u64::from_le_bytes(b) } else { u64::from_be_bytes(b) }
}

/// GDAL writes NODATA as text; take the longest numeric prefix, as
/// JavaScript's `parseFloat` does (`"-9999"`, `"nan"`, `"-3.4e+38"`).
fn parse_nodata(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    (1..=s.len()).rev().filter(|&n| s.is_char_boundary(n)).find_map(|n| s[..n].parse().ok())
}

/// Parses every readable directory from the bytes `src` holds.
pub fn parse<S: Source + ?Sized>(src: &S) -> Result<Tiff, TiffError> {
    let head = src.bytes(0, 8).ok_or(TiffError::ShortHeader)?;
    let le = head[..2] == *b"II";
    let version = if le { u16::from_le_bytes([head[2], head[3]]) } else { u16::from_be_bytes([head[2], head[3]]) };
    if version != 42 && version != 43 {
        return Err(TiffError::NotTiff { version });
    }
    let big = version == 43;
    let r = Reader { src, le, big };
    let mut ifd =
        if big { r.u64(8).ok_or(TiffError::ShortHeader)? } else { u64::from(r.u32(4).ok_or(TiffError::ShortHeader)?) };

    let mut levels = Vec::new();
    let mut geo = None;
    let mut complete = true;
    let mut seen = 0;
    while ifd != 0 {
        if seen == MAX_IFDS {
            break; // like cog.js, stop following; the chain still continues
        }
        seen += 1;
        let Some((entries, next)) = r.directory(ifd) else {
            complete = false;
            break;
        };
        let tag = |t: u16| entries.iter().find(|(k, _)| *k == t).map(|(_, e)| *e);
        let first_int = |t: u16, d: u64| -> Option<u64> {
            match tag(t) {
                None => Some(d),
                Some(e) => Some(r.integers(e)?.first().copied().unwrap_or(d)),
            }
        };
        let level = (|| {
            let width = first_int(256, 0)?;
            let height = first_int(257, 0)?;
            let mut level = Level {
                width: u32::try_from(width).ok()?,
                height: u32::try_from(height).ok()?,
                block_width: u32::try_from(first_int(322, 0)?).ok()?,
                block_height: u32::try_from(first_int(323, 0)?).ok()?,
                compression: u16::try_from(first_int(259, 1)?).ok()?,
                predictor: u16::try_from(first_int(317, 1)?).ok()?,
                bits_per_sample: u16::try_from(first_int(258, 32)?).ok()?,
                samples_per_pixel: u16::try_from(first_int(277, 1)?).ok()?,
                sample_format: u16::try_from(first_int(339, 1)?).ok()?,
                offsets: tag(324).map(|e| r.integers(e)).unwrap_or(Some(Vec::new()))?,
                counts: tag(325).map(|e| r.integers(e)).unwrap_or(Some(Vec::new()))?,
                stripped: false,
            };
            if level.block_width == 0 && tag(273).is_some() {
                // A strip is a block as wide as the image (WA_ColumbiaValley,
                // CA_YosemiteNP and other untiled 1 m products).
                level.block_width = level.width;
                level.block_height = u32::try_from(first_int(278, height)?.min(height)).ok()?;
                level.offsets = r.integers(tag(273)?)?;
                level.counts = tag(279).map(|e| r.integers(e)).unwrap_or(Some(Vec::new()))?;
                level.stripped = true;
            }
            Some(level)
        })();
        let Some(level) = level else {
            complete = false; // its tables are not all held
            break;
        };
        if level.block_width == 0 || level.offsets.is_empty() {
            complete = false; // cog.js: a directory without blocks ends the walk
            break;
        }
        if geo.is_none() {
            geo = Some(read_geo(&r, &tag).unwrap_or_else(|| {
                complete = false;
                Geo::default()
            }));
        }
        levels.push(level);
        ifd = next;
    }
    if ifd != 0 {
        complete = false;
    }
    if levels.is_empty() {
        return Err(TiffError::NoReadableIfd);
    }
    Ok(Tiff { little_endian: le, big, levels, geo: geo.unwrap_or_default(), complete })
}

fn read_geo<S: Source + ?Sized>(r: &Reader<'_, S>, tag: &impl Fn(u16) -> Option<Entry>) -> Option<Geo> {
    let nums = |t| tag(t).map(|e| r.numbers(e)).unwrap_or(Some(Vec::new()));
    let keys = nums(34735)?;
    let epsg = keys.get(4..).unwrap_or_default().chunks_exact(4).rfind(|k| k[0] == 3072.0).map(|k| k[3] as u32);
    let citation = tag(34737).map(|e| r.text(e)).unwrap_or(Some(String::new()))?;
    let nodata = match tag(42113) {
        Some(e) => parse_nodata(&r.text(e)?),
        None => None,
    };
    Some(Geo { pixel_scale: nums(33550)?, tiepoint: nums(33922)?, epsg, citation, nodata })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nodata_like_parse_float() {
        assert_eq!(parse_nodata("-9999"), Some(-9999.0));
        assert_eq!(parse_nodata(" -3.4028234663852886e+38 "), Some(-3.4028234663852886e38));
        assert!(parse_nodata("nan").unwrap().is_nan());
        assert_eq!(parse_nodata("12abc"), Some(12.0));
        assert_eq!(parse_nodata(""), None);
    }

    #[test]
    fn rejects_non_tiff() {
        assert_eq!(parse(&b"PK\x03\x04\0\0\0\0"[..]), Err(TiffError::NotTiff { version: 0x0304 }));
        assert_eq!(parse(&b"II*"[..]), Err(TiffError::ShortHeader));
    }
}
