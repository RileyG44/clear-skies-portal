//! TIFF-flavoured LZW, ported from `cog.js:lzwDecode`.
//!
//! TIFF LZW differs from GIF: codes pack MSB-first and the code width grows
//! one step early (at 511, not 512). Every dictionary string already sits in
//! the output, so a code is an offset and a length into the output and
//! emitting it is a copy from earlier output: no prefix-chain walk.

const CLEAR: u32 = 256;
const EOI: u32 = 257;
const FIRST: usize = 258;
const TABLE: usize = 4096;

/// Decodes `src` into at most `expected` bytes.
///
/// Returns fewer bytes if the stream ends early or is corrupt (a code past
/// the table stops decoding rather than looping); never panics on any input.
pub fn decode(src: &[u8], expected: usize) -> Vec<u8> {
    let mut out = vec![0u8; expected];
    let mut pos = 0usize;
    let mut off = [0usize; TABLE];
    let mut len = [0usize; TABLE];
    len[..256].fill(1);

    let (mut next, mut width) = (FIRST, 9u32);
    let mut old: Option<usize> = None;
    let mut old_pos = 0usize;
    let (mut bits, mut count, mut p) = (0u32, 0u32, 0usize);

    loop {
        while count < width {
            let Some(&byte) = src.get(p) else {
                out.truncate(pos);
                return out;
            };
            bits = (bits << 8) | u32::from(byte);
            count += 8;
            p += 1;
        }
        let code = (bits >> (count - width)) & ((1 << width) - 1);
        count -= width;
        bits &= (1u32 << count).wrapping_sub(1);

        if code == EOI {
            break;
        }
        if code == CLEAR {
            next = FIRST;
            width = 9;
            old = None;
            continue;
        }
        let code = code as usize;
        let at = pos;
        let room = expected - pos;
        if code < 256 {
            if room > 0 {
                out[pos] = code as u8;
                pos += 1;
            }
        } else if code < next {
            // Entirely earlier output: a plain (non-overlapping) copy.
            let (o, l) = (off[code], len[code].min(room));
            out.copy_within(o..o + l, pos);
            pos += l;
        } else if let (true, Some(prev)) = (code == next, old) {
            // KwKwK: old's string plus its own first byte. The copy overlaps
            // its own output by one byte, so it must run forwards bytewise.
            let (o, l) = (old_pos, (len[prev] + 1).min(room));
            for i in 0..l {
                out[pos + i] = out[o + i];
            }
            pos += l;
        } else {
            break; // corrupt: a code past the table
        }

        if let Some(prev) = old
            && next < TABLE
        {
            off[next] = old_pos;
            len[next] = len[prev] + 1;
            next += 1;
        }
        old = Some(code);
        old_pos = at;
        if next + 1 >= (1 << width) && width < 12 {
            width += 1; // early change
        }
    }
    out.truncate(pos);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hand_packed_stream() {
        // CLEAR, 'A', 'B', EOI at 9 bits, MSB-first (test-cog.js).
        assert_eq!(decode(&[0x80, 0x10, 0x48, 0x50, 0x10], 2), b"AB");
    }

    #[test]
    fn empty_stream() {
        assert!(decode(&[0x80, 0x08, 0x00], 0).is_empty());
    }

    #[test]
    fn garbage_never_panics() {
        let mut seed = 7u32;
        for n in 0..2000 {
            let data: Vec<u8> = (0..(n % 300))
                .map(|_| {
                    seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                    (seed >> 16) as u8
                })
                .collect();
            let out = decode(&data, n % 1000);
            assert!(out.len() <= n % 1000);
        }
    }
}
