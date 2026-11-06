//! Bounded TIFF strip decoding. Compressed input, the LZW dictionary, and
//! predictor scratch are independent of strip height. A consumer may stop at
//! every row; the caller can also wrap input reads with its execution gate.
//! Unlike the compatibility block decoder, import refuses truncated streams.

use std::io::{self, BufReader, Read};

use flate2::{Decompress, FlushDecompress, Status};

use super::{DecodeError, Level, block};

const INPUT_BYTES: usize = 64 << 10;
pub const MAX_ROW_BYTES: usize = 8 << 20;

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

/// Admission before constructing a decoder: input + dictionary + predictor
/// planes + encoded row + float32 row. No term depends on strip height.
pub fn scratch_bytes(level: &Level) -> Result<usize, DecodeError> {
    let bps = usize::from(level.bits_per_sample) / 8;
    if !matches!(level.bits_per_sample, 8 | 16 | 32 | 64) {
        return Err(DecodeError::SampleFormat { bits: level.bits_per_sample, format: level.sample_format });
    }
    if !matches!((level.sample_format, bps), (1 | 2 | 4, 1 | 2 | 4) | (3, 4 | 8)) {
        return Err(DecodeError::SampleFormat { bits: level.bits_per_sample, format: level.sample_format });
    }
    if !matches!(level.compression, 1 | 5 | 8 | 32946) {
        return Err(DecodeError::Compression(level.compression));
    }
    if !matches!(level.predictor, 1..=3) {
        return Err(DecodeError::Predictor(level.predictor));
    }
    let samples = (level.block_width as usize)
        .checked_mul(usize::from(level.samples_per_pixel.max(1)))
        .ok_or(DecodeError::Size)?;
    let bytes = samples.checked_mul(bps).ok_or(DecodeError::Size)?;
    if bytes == 0 || bytes > MAX_ROW_BYTES {
        return Err(DecodeError::Size);
    }
    Ok(bytes * 2 + samples * 4 + (256 << 10))
}

/// Decode exactly `rows` real rows of a block. Last strips supply only their
/// real image height, not RowsPerStrip padding. Excess expansion, missing EOI,
/// invalid codes and missing/invalid zlib checksums fail before publication.
pub fn decode<R: Read>(
    reader: R,
    level: &Level,
    little_endian: bool,
    rows: u32,
    mut consume: impl FnMut(u32, &[f32]) -> io::Result<()>,
) -> io::Result<()> {
    scratch_bytes(level).map_err(|e| invalid(e.to_string()))?;
    if rows == 0 || rows > level.block_height {
        return Err(invalid("strip row count is outside the directory"));
    }
    let mut decoder: Box<dyn Read + '_> = match level.compression {
        1 => Box::new(reader),
        5 => Box::new(Lzw::new(reader)),
        8 | 32946 => Box::new(Inflate::new(reader)),
        _ => unreachable!("validated compression"),
    };
    let row_bytes =
        level.block_width as usize * usize::from(level.samples_per_pixel.max(1)) * usize::from(level.bits_per_sample)
            / 8;
    let mut row = vec![0; row_bytes];
    for y in 0..rows {
        decoder.read_exact(&mut row)?;
        let samples = block::decode_samples(&mut row, level, little_endian, 1).map_err(|e| invalid(e.to_string()))?;
        consume(y, &samples)?;
    }
    // Reading past the last output validates the end marker/checksum, without
    // ever expanding unexpected extra data into an unbounded allocation.
    if decoder.read(&mut [0])? != 0 {
        return Err(invalid("strip expands beyond its declared rows"));
    }
    Ok(())
}

struct Inflate<R> {
    reader: R,
    state: Decompress,
    input: Vec<u8>,
    position: usize,
    length: usize,
    eof: bool,
    done: bool,
}
impl<R: Read> Inflate<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            state: Decompress::new(true),
            input: vec![0; INPUT_BYTES],
            position: 0,
            length: 0,
            eof: false,
            done: false,
        }
    }
}
impl<R: Read> Read for Inflate<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.done || out.is_empty() {
            return Ok(0);
        }
        loop {
            if self.position == self.length && !self.eof {
                self.length = self.reader.read(&mut self.input)?;
                self.position = 0;
                self.eof = self.length == 0;
            }
            let (before_in, before_out) = (self.state.total_in(), self.state.total_out());
            let status = self
                .state
                .decompress(&self.input[self.position..self.length], out, FlushDecompress::None)
                .map_err(|e| invalid(e.to_string()))?;
            let used = (self.state.total_in() - before_in) as usize;
            let produced = (self.state.total_out() - before_out) as usize;
            self.position += used;
            if status == Status::StreamEnd {
                self.done = true;
            }
            if produced > 0 || self.done {
                return Ok(produced);
            }
            if used == 0 && self.eof {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "incomplete TIFF Deflate stream"));
            }
            if used == 0 && self.position < self.length {
                return Err(invalid("stalled TIFF Deflate stream"));
            }
        }
    }
}

/// Prefix/suffix dictionary replaces the whole-output offsets used by the
/// ordinary block decoder. Strings are at most 4096 bytes, even after a very
/// large strip has produced gigabytes of samples. TIFF uses early-change LZW.
struct Lzw<R> {
    reader: BufReader<R>,
    prefix: [u16; 4096],
    suffix: [u8; 4096],
    stack: [u8; 4096],
    pending: usize,
    next: u16,
    width: u32,
    old: Option<u16>,
    first: u8,
    bits: u32,
    count: u32,
    done: bool,
}
impl<R: Read> Lzw<R> {
    fn new(reader: R) -> Self {
        Self {
            reader: BufReader::with_capacity(INPUT_BYTES, reader),
            prefix: [0; 4096],
            suffix: [0; 4096],
            stack: [0; 4096],
            pending: 0,
            next: 258,
            width: 9,
            old: None,
            first: 0,
            bits: 0,
            count: 0,
            done: false,
        }
    }
    fn code(&mut self) -> io::Result<u16> {
        while self.count < self.width {
            let mut byte = [0];
            self.reader.read_exact(&mut byte)?;
            self.bits = (self.bits << 8) | u32::from(byte[0]);
            self.count += 8;
        }
        let code = ((self.bits >> (self.count - self.width)) & ((1 << self.width) - 1)) as u16;
        self.count -= self.width;
        self.bits &= (1u32 << self.count).wrapping_sub(1);
        Ok(code)
    }
    fn word(&mut self) -> io::Result<()> {
        loop {
            let incoming = self.code()?;
            if incoming == 257 {
                self.done = true;
                return Ok(());
            }
            if incoming == 256 {
                self.next = 258;
                self.width = 9;
                self.old = None;
                continue;
            }
            let mut code = incoming;
            if code == self.next {
                let Some(old) = self.old else {
                    return Err(invalid("LZW code has no prefix"));
                };
                self.stack[self.pending] = self.first;
                self.pending += 1;
                code = old;
            } else if code > self.next {
                return Err(invalid("LZW code exceeds dictionary"));
            }
            while code >= 258 {
                if code >= self.next || self.pending >= self.stack.len() - 1 {
                    return Err(invalid("invalid LZW prefix chain"));
                }
                self.stack[self.pending] = self.suffix[code as usize];
                self.pending += 1;
                code = self.prefix[code as usize];
            }
            if code >= 256 || self.pending >= self.stack.len() {
                return Err(invalid("invalid LZW literal"));
            }
            self.first = code as u8;
            self.stack[self.pending] = self.first;
            self.pending += 1;
            if let Some(old) = self.old
                && self.next < 4096
            {
                self.prefix[self.next as usize] = old;
                self.suffix[self.next as usize] = self.first;
                self.next += 1;
            }
            self.old = Some(incoming);
            if u32::from(self.next) + 1 >= (1 << self.width) && self.width < 12 {
                self.width += 1;
            }
            return Ok(());
        }
    }
}
impl<R: Read> Read for Lzw<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let mut used = 0;
        while used < out.len() {
            if self.pending == 0 {
                if self.done {
                    break;
                }
                self.word()?;
                if self.done {
                    break;
                }
            }
            while self.pending > 0 && used < out.len() {
                self.pending -= 1;
                out[used] = self.stack[self.pending];
                used += 1;
            }
        }
        Ok(used)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn level() -> Level {
        Level {
            width: 2,
            height: 3,
            block_width: 2,
            block_height: 3,
            compression: 8,
            lerc_compression: 0,
            predictor: 1,
            bits_per_sample: 16,
            samples_per_pixel: 1,
            sample_format: 2,
            offsets: vec![],
            counts: vec![],
            stripped: true,
        }
    }
    fn compressed(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }
    struct Fragments<'a>(&'a [u8]);
    impl Read for Fragments<'_> {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            let n = 3.min(out.len()).min(self.0.len());
            out[..n].copy_from_slice(&self.0[..n]);
            self.0 = &self.0[n..];
            Ok(n)
        }
    }
    #[test]
    fn fragmented_deflate_checks_end_and_expansion() {
        let level = level();
        let values = [-200i16, 0, 30000, -30000, 2, 7];
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let encoded = compressed(&bytes);
        let mut decoded = Vec::new();
        decode(Fragments(&encoded), &level, true, 3, |_, row| {
            decoded.extend_from_slice(row);
            Ok(())
        })
        .unwrap();
        assert_eq!(decoded, values.map(f32::from));
        for cut in [encoded.len() - 1, encoded.len() / 2] {
            assert!(
                decode(Fragments(&encoded[..cut]), &level, true, 3, |_, _| Ok(())).is_err(),
                "missing checksum/data must fail"
            );
        }
        let mut corrupt = encoded.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(decode(Fragments(&corrupt), &level, true, 3, |_, _| Ok(())).is_err());
        let mut extra = bytes.clone();
        extra.push(0);
        assert!(decode(Fragments(&compressed(&extra)), &level, true, 3, |_, _| Ok(())).is_err());
    }
    fn codes(codes: &[u16]) -> Vec<u8> {
        let (mut out, mut bits, mut count, mut width, mut next, mut previous) =
            (Vec::new(), 0u32, 0u32, 9u32, 258u32, false);
        for &code in codes {
            bits = (bits << width) | u32::from(code);
            count += width;
            while count >= 8 {
                count -= 8;
                out.push((bits >> count) as u8);
                bits &= (1 << count) - 1;
            }
            if code == 256 {
                width = 9;
                next = 258;
                previous = false;
            } else if code != 257 {
                if previous && next < 4096 {
                    next += 1;
                }
                previous = true;
                if next + 1 >= (1 << width) && width < 12 {
                    width += 1;
                }
            }
        }
        if count > 0 {
            out.push((bits << (8 - count)) as u8);
        }
        out
    }
    #[test]
    fn lzw_kwkwk_width_growth_dictionary_saturation_and_reset() {
        let input = codes(&[256, 65, 258, 259, 260, 257]);
        let mut result = Vec::new();
        Lzw::new(Fragments(&input)).read_to_end(&mut result).unwrap();
        assert_eq!(result, vec![65; 10]);
        let mut sequence = vec![256];
        let mut expected = Vec::new();
        for i in 0..10000 {
            if i == 6000 {
                sequence.push(256);
            }
            sequence.push((i % 251) as u16);
            expected.push((i % 251) as u8);
        }
        sequence.push(257);
        let encoded = codes(&sequence);
        let mut decoded = Vec::new();
        Lzw::new(Fragments(&encoded)).read_to_end(&mut decoded).unwrap();
        assert_eq!(decoded, expected);
        assert_eq!(super::super::lzw::decode(&encoded, expected.len()), expected);
        for bad in [&[256, 259, 257][..], &[256, 65, 300, 257][..], &[256, 65][..]] {
            let mut output = Vec::new();
            assert!(Lzw::new(Fragments(&codes(bad))).read_to_end(&mut output).is_err());
        }
    }
    #[test]
    fn giant_strip_uses_row_memory_and_consumer_cancellation() {
        let mut level = level();
        level.compression = 1;
        level.block_width = 1024;
        level.bits_per_sample = 32;
        level.sample_format = 3;
        let small = scratch_bytes(&level).unwrap();
        level.block_height = u32::MAX;
        assert_eq!(scratch_bytes(&level).unwrap(), small);
        let mut reader = io::repeat(0);
        let mut rows = 0;
        let error = decode(&mut reader, &level, true, u32::MAX, |y, row| {
            assert_eq!(row.len(), 1024);
            rows += 1;
            if y == 16 { Err(io::Error::new(io::ErrorKind::Interrupted, "execution grant expired")) } else { Ok(()) }
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert_eq!(rows, 17);
        level.block_width = MAX_ROW_BYTES as u32;
        assert_eq!(scratch_bytes(&level), Err(DecodeError::Size));
    }
}
