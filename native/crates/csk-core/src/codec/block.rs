//! One tile or strip to float32 samples, ported from `cog.js:decodeTile`.

use std::fmt;

use super::tiff::Level;
use super::{lzw, predictor};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    Compression(u16),
    Predictor(u16),
    SampleFormat {
        bits: u16,
        format: u16,
    },
    /// The block's declared size is implausible (or overflows).
    Size,
    Inflate,
    Lerc(String),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Compression(c) => write!(f, "unsupported compression {c}"),
            Self::Predictor(p) => write!(f, "unsupported predictor {p}"),
            Self::SampleFormat { bits, format } => write!(f, "unsupported sample format bps={bits} sf={format}"),
            Self::Size => write!(f, "block size out of range"),
            Self::Inflate => write!(f, "corrupt deflate stream"),
            Self::Lerc(message) => write!(f, "LERC: {message}"),
        }
    }
}

impl std::error::Error for DecodeError {}

/// Largest block decoded, in samples (a 4096 x 4096 single-band tile).
pub const MAX_BLOCK_SAMPLES: usize = 4096 * 4096;

/// Decodes one block's compressed bytes into `block_width * block_height *
/// samples_per_pixel` float32 samples, row-major and pixel-interleaved.
///
/// As in `cog.js`, a short block (the last strip, a truncated stream) is
/// padded with zero bytes before the predictor runs. Unlike `cog.js`, samples
/// honour the file's byte order and predictor 2 works for 16-, 32- and 64-bit
/// samples (see `native/fixtures/goldens.json`, `jsParity`).
pub fn decode_block(raw: &[u8], level: &Level, little_endian: bool) -> Result<Vec<f32>, DecodeError> {
    let bps = usize::from(level.bits_per_sample) / 8;
    let spp = usize::from(level.samples_per_pixel.max(1));
    let (w, h) = (level.block_width as usize, level.block_height as usize);
    if !matches!(bps, 1 | 2 | 4 | 8) || usize::from(level.bits_per_sample) % 8 != 0 {
        return Err(DecodeError::SampleFormat { bits: level.bits_per_sample, format: level.sample_format });
    }
    let samples = w.checked_mul(h).and_then(|n| n.checked_mul(spp)).ok_or(DecodeError::Size)?;
    if samples == 0 || samples > MAX_BLOCK_SAMPLES {
        return Err(DecodeError::Size);
    }
    let bytes = samples * bps;

    if level.compression == 34887 {
        if spp != 1 || level.predictor != 1 {
            return Err(DecodeError::Lerc("non-scalar or predicted LERC TIFF".into()));
        }
        let limit = samples.checked_mul(12).and_then(|n| n.checked_add(64 << 10)).ok_or(DecodeError::Size)?;
        let inflated;
        let blob = match level.lerc_compression {
            0 => raw,
            1 => {
                inflated = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(raw, limit)
                    .map_err(|_| DecodeError::Inflate)?;
                &inflated
            }
            2 => {
                use std::io::Read;
                let mut decoder = zstd::stream::read::Decoder::with_buffer(raw).map_err(|_| DecodeError::Inflate)?;
                // Set before the first read: limiting output alone does not
                // bound the window allocated from an untrusted frame header.
                decoder.window_log_max(23).map_err(|_| DecodeError::Inflate)?;
                let mut buffer = vec![0; limit + 1];
                let mut used = 0;
                while used < buffer.len() {
                    let n = decoder.read(&mut buffer[used..]).map_err(|_| DecodeError::Inflate)?;
                    if n == 0 {
                        break;
                    }
                    used += n;
                }
                if used > limit {
                    return Err(DecodeError::Size);
                }
                buffer.truncate(used);
                inflated = buffer;
                &inflated
            }
            other => return Err(DecodeError::Lerc(format!("unsupported secondary compression {other}"))),
        };
        let mut raster = super::lerc::decode(blob, samples)?;
        if raster.width != level.block_width
            || raster.height > level.block_height
            || (!level.stripped && raster.height != level.block_height)
        {
            return Err(DecodeError::Size);
        }
        raster.values.resize(samples, f32::NAN);
        return Ok(raster.values);
    }

    let mut d = match level.compression {
        1 => raw[..raw.len().min(bytes)].to_vec(),
        5 => lzw::decode(raw, bytes),
        8 | 32946 => match miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(raw, bytes) {
            Ok(d) => d,
            // More data than the block holds: keep the block, as cog.js
            // callers only ever read its first `bytes`.
            Err(e) if e.status == miniz_oxide::inflate::TINFLStatus::HasMoreOutput => e.output,
            Err(_) => return Err(DecodeError::Inflate),
        },
        c => return Err(DecodeError::Compression(c)),
    };
    d.resize(bytes, 0);

    match level.predictor {
        1 => to_little_endian(&mut d, bps, little_endian),
        2 => {
            to_little_endian(&mut d, bps, little_endian);
            predictor::undo_horizontal(&mut d, w, h, spp, bps);
        }
        3 => predictor::undo_floating_point(&mut d, w, h, spp, bps),
        p => return Err(DecodeError::Predictor(p)),
    }
    convert(&d, bps, level)
}

fn to_little_endian(d: &mut [u8], bps: usize, little_endian: bool) {
    if !little_endian && bps > 1 {
        for sample in d.chunks_exact_mut(bps) {
            sample.reverse();
        }
    }
}

fn convert(d: &[u8], bps: usize, level: &Level) -> Result<Vec<f32>, DecodeError> {
    let err = DecodeError::SampleFormat { bits: level.bits_per_sample, format: level.sample_format };
    let out = match (level.sample_format, bps) {
        (3, 4) => d.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().expect("4"))).collect(),
        (3, 8) => d.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().expect("8")) as f32).collect(),
        (1 | 4, 1) => d.iter().map(|&v| f32::from(v)).collect(),
        (2, 1) => d.iter().map(|&v| f32::from(v as i8)).collect(),
        (1 | 4, 2) => d.chunks_exact(2).map(|c| f32::from(u16::from_le_bytes([c[0], c[1]]))).collect(),
        (2, 2) => d.chunks_exact(2).map(|c| f32::from(i16::from_le_bytes([c[0], c[1]]))).collect(),
        (1 | 4, 4) => d.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().expect("4")) as f32).collect(),
        (2, 4) => d.chunks_exact(4).map(|c| i32::from_le_bytes(c.try_into().expect("4")) as f32).collect(),
        _ => return Err(err),
    };
    Ok(out)
}
