//! Local tiled float32 TIFF preparation. The base is lossless; overview pixels
//! are area-weighted finite means over the exact parent extent. Header space is
//! reserved before tiles and only made readable after every level succeeds.

use std::collections::VecDeque;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::sync::Arc;

use super::{Geo, GeoValue, Level, decode_block};

const TILE_WIDTH: u32 = 256;
const MAX_LEVELS: usize = 16;

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[derive(Clone)]
struct Image {
    width: u32,
    height: u32,
    tile_height: u32,
    offsets: Vec<u32>,
    counts: Vec<u32>,
}
impl Image {
    fn across(&self) -> u32 {
        self.width.div_ceil(TILE_WIDTH)
    }
    fn block_bytes(&self) -> usize {
        (TILE_WIDTH * self.tile_height) as usize * 4
    }
    fn level(&self) -> Level {
        Level {
            width: self.width,
            height: self.height,
            block_width: TILE_WIDTH,
            block_height: self.tile_height,
            compression: 8,
            lerc_compression: 0,
            predictor: 3,
            bits_per_sample: 32,
            samples_per_pixel: 1,
            sample_format: 3,
            offsets: Vec::new(),
            counts: Vec::new(),
            stripped: false,
        }
    }
}

pub struct Plan {
    images: Vec<Image>,
    geo: Geo,
    header_bytes: usize,
    pub max_bytes: u64,
    pub memory_bytes: usize,
    source_nodata: Option<f32>,
}
impl Plan {
    /// `max_bytes` includes incompressible tile payload and all tables. Refusal
    /// precedes creating a file or allocating a tile band. Prepared files stay
    /// below 4 GiB, so classic TIFF is sufficient even for a BigTIFF input.
    pub fn new(width: u32, height: u32, geo: &Geo, byte_limit: u64) -> io::Result<Self> {
        if width == 0 || height == 0 || byte_limit > u64::from(u32::MAX) {
            return Err(invalid("invalid tiled TIFF dimensions or byte limit"));
        }
        let mut images = Vec::new();
        let (mut w, mut h) = (width, height);
        let mut bytes = 0u64;
        loop {
            // Usual rasters use square 256px tiles. Very wide strips lower
            // tile height, still a TIFF multiple of 16, to bound the row band.
            let mut tile_height = 256;
            while tile_height > 16 && u64::from(w) * u64::from(tile_height) * 4 > 32 << 20 {
                tile_height /= 2;
            }
            let count = u64::from(w.div_ceil(TILE_WIDTH)) * u64::from(h.div_ceil(tile_height));
            let block = u64::from(TILE_WIDTH) * u64::from(tile_height) * 4;
            bytes = bytes
                .checked_add(count.checked_mul(block + block / 100 + 256).ok_or_else(|| invalid("TIFF size overflow"))?)
                .ok_or_else(|| invalid("TIFF size overflow"))?;
            if bytes > byte_limit || count > 1 << 22 {
                return Err(invalid("prepared TIFF exceeds its admitted output limit"));
            }
            images.push(Image {
                width: w,
                height: h,
                tile_height,
                offsets: vec![0; count as usize],
                counts: vec![0; count as usize],
            });
            if w <= 256 && h <= 256 {
                break;
            }
            if images.len() >= MAX_LEVELS {
                return Err(invalid("too many TIFF overview levels"));
            }
            w = w.div_ceil(2);
            h = h.div_ceil(2);
        }
        let source_nodata = geo.nodata.map(|v| v as f32).filter(|v| v.is_finite());
        let mut geo = geo.clone();
        geo.nodata = Some(f64::NAN);
        let header_bytes = header(&images, &geo)?.len();
        let max_bytes = bytes.checked_add(header_bytes as u64).ok_or_else(|| invalid("TIFF size overflow"))?;
        if max_bytes > byte_limit {
            return Err(invalid("prepared TIFF header exceeds its admitted output limit"));
        }
        let tables: usize = images.iter().map(|i| i.offsets.len() * 8).sum();
        let memory_bytes = width as usize * images[0].tile_height as usize * 4 + tables + header_bytes * 2 + (8 << 20);
        Ok(Self { images, geo, header_bytes, max_bytes, memory_bytes, source_nodata })
    }
}

pub struct Writer<W> {
    output: W,
    plan: Plan,
    band: Vec<f32>,
    rows: u32,
    position: u64,
}
impl<W: Read + Write + Seek> Writer<W> {
    pub fn new(mut output: W, plan: Plan) -> io::Result<Self> {
        output.seek(SeekFrom::Start(0))?;
        output.write_all(&vec![0; plan.header_bytes])?;
        let band = vec![f32::NAN; plan.images[0].width as usize * plan.images[0].tile_height as usize];
        let position = plan.header_bytes as u64;
        Ok(Self { output, plan, band, rows: 0, position })
    }
    pub fn row(&mut self, row: &[f32]) -> io::Result<()> {
        let image = &self.plan.images[0];
        let (image_width, image_height, tile_height, across) =
            (image.width, image.height, image.tile_height, image.across());
        if row.len() != image_width as usize || self.rows >= image_height {
            return Err(invalid("prepared TIFF row shape or order"));
        }
        let at = (self.rows % tile_height) as usize * row.len();
        self.band[at..at + row.len()].copy_from_slice(row);
        if let Some(nodata) = self.plan.source_nodata {
            for v in &mut self.band[at..at + row.len()] {
                if *v == nodata {
                    *v = f32::NAN;
                }
            }
        }
        self.rows += 1;
        if self.rows.is_multiple_of(tile_height) || self.rows == image_height {
            let ty = (self.rows - 1) / tile_height;
            let mut tile = vec![f32::NAN; (TILE_WIDTH * tile_height) as usize];
            for tx in 0..across {
                tile.fill(f32::NAN);
                let x0 = tx * TILE_WIDTH;
                let width = (image_width - x0).min(TILE_WIDTH) as usize;
                let rows = (image_height - ty * tile_height).min(tile_height);
                for y in 0..rows as usize {
                    let start = y * image_width as usize + x0 as usize;
                    tile[y * TILE_WIDTH as usize..y * TILE_WIDTH as usize + width]
                        .copy_from_slice(&self.band[start..start + width]);
                }
                self.tile(0, (ty * across + tx) as usize, &tile)?;
            }
            self.band.fill(f32::NAN);
        }
        Ok(())
    }
    fn tile(&mut self, level: usize, index: usize, values: &[f32]) -> io::Result<()> {
        let image = &self.plan.images[level];
        let words = TILE_WIDTH as usize;
        let mut bytes = vec![0; image.block_bytes()];
        for y in 0..image.tile_height as usize {
            let row = &mut bytes[y * words * 4..(y + 1) * words * 4];
            for x in 0..words {
                let sample = values[y * words + x].to_le_bytes();
                for b in 0..4 {
                    row[(3 - b) * words + x] = sample[b];
                }
            }
            for i in (1..row.len()).rev() {
                row[i] = row[i].wrapping_sub(row[i - 1]);
            }
        }
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&bytes)?;
        let encoded = encoder.finish()?;
        let next = self.position.checked_add(encoded.len() as u64).ok_or_else(|| invalid("TIFF offset overflow"))?;
        if next > self.plan.max_bytes || next > u64::from(u32::MAX) {
            return Err(invalid("prepared TIFF exceeded its admitted bytes"));
        }
        self.output.seek(SeekFrom::Start(self.position))?;
        self.output.write_all(&encoded)?;
        self.plan.images[level].offsets[index] = self.position as u32;
        self.plan.images[level].counts[index] = encoded.len() as u32;
        self.position = next;
        Ok(())
    }
    /// Build bounded tiles from the previous level. The cache holds twelve
    /// blocks, independent of raster width and height. A checkpoint runs before
    /// each output tile, including during long overview preparation.
    pub fn finish(mut self, mut checkpoint: impl FnMut() -> io::Result<()>) -> io::Result<W> {
        if self.rows != self.plan.images[0].height {
            return Err(invalid("prepared TIFF is missing rows"));
        }
        self.band = Vec::new();
        for level in 1..self.plan.images.len() {
            let parent = self.plan.images[level - 1].clone();
            let image = self.plan.images[level].clone();
            let (sx, sy) =
                (f64::from(parent.width) / f64::from(image.width), f64::from(parent.height) / f64::from(image.height));
            let mut cache: VecDeque<(usize, Arc<Vec<f32>>)> = VecDeque::new();
            let parent_level = parent.level();
            for ty in 0..image.height.div_ceil(image.tile_height) {
                for tx in 0..image.across() {
                    checkpoint()?;
                    let mut tile = vec![f32::NAN; (TILE_WIDTH * image.tile_height) as usize];
                    let width = (image.width - tx * TILE_WIDTH).min(TILE_WIDTH);
                    let height = (image.height - ty * image.tile_height).min(image.tile_height);
                    let bx0 = ((f64::from(tx * TILE_WIDTH) * sx).floor() as u32) / TILE_WIDTH;
                    let bx1 =
                        (((f64::from(tx * TILE_WIDTH + width) * sx).ceil() as u32).min(parent.width) - 1) / TILE_WIDTH;
                    let by0 = ((f64::from(ty * image.tile_height) * sy).floor() as u32) / parent.tile_height;
                    let by1 = (((f64::from(ty * image.tile_height + height) * sy).ceil() as u32).min(parent.height)
                        - 1)
                        / parent.tile_height;
                    let mut blocks = Vec::new();
                    for by in by0..=by1 {
                        for bx in bx0..=bx1 {
                            let index = (by * parent.across() + bx) as usize;
                            let values = if let Some(slot) = cache.iter().position(|(i, _)| *i == index) {
                                let entry = cache.remove(slot).unwrap();
                                let values = entry.1.clone();
                                cache.push_front(entry);
                                values
                            } else {
                                let mut bytes = vec![0; parent.counts[index] as usize];
                                self.output.seek(SeekFrom::Start(u64::from(parent.offsets[index])))?;
                                self.output.read_exact(&mut bytes)?;
                                let values = Arc::new(
                                    decode_block(&bytes, &parent_level, true).map_err(|e| invalid(&e.to_string()))?,
                                );
                                if cache.len() == 12 {
                                    cache.pop_back();
                                }
                                cache.push_front((index, values.clone()));
                                values
                            };
                            blocks.push(values);
                        }
                    }
                    for y in 0..height {
                        for x in 0..width {
                            let (ox, oy) = (tx * TILE_WIDTH + x, ty * image.tile_height + y);
                            let (x0, x1, y0, y1) = (
                                f64::from(ox) * sx,
                                f64::from(ox + 1) * sx,
                                f64::from(oy) * sy,
                                f64::from(oy + 1) * sy,
                            );
                            let (mut sum, mut weight) = (0.0, 0.0);
                            for py in y0.floor() as u32..(y1.ceil() as u32).min(parent.height) {
                                for px in x0.floor() as u32..(x1.ceil() as u32).min(parent.width) {
                                    let index = ((py / parent.tile_height - by0) * (bx1 - bx0 + 1) + px / TILE_WIDTH
                                        - bx0) as usize;
                                    let value = blocks[index]
                                        [((py % parent.tile_height) * TILE_WIDTH + px % TILE_WIDTH) as usize];
                                    if !value.is_finite() {
                                        continue;
                                    }
                                    let w = (x1.min(f64::from(px + 1)) - x0.max(f64::from(px)))
                                        * (y1.min(f64::from(py + 1)) - y0.max(f64::from(py)));
                                    sum += f64::from(value) * w;
                                    weight += w;
                                }
                            }
                            if weight > 0.0 {
                                tile[(y * TILE_WIDTH + x) as usize] = (sum / weight) as f32;
                            }
                        }
                    }
                    self.tile(level, (ty * image.across() + tx) as usize, &tile)?;
                }
            }
        }
        checkpoint()?;
        let header = header(&self.plan.images, &self.plan.geo)?;
        if header.len() != self.plan.header_bytes {
            return Err(invalid("TIFF header size changed"));
        }
        self.output.seek(SeekFrom::Start(0))?;
        self.output.write_all(&header)?;
        self.output.flush()?;
        Ok(self.output)
    }
}

struct Tag {
    id: u16,
    kind: u16,
    count: u32,
    data: Vec<u8>,
}
impl Tag {
    fn shorts(id: u16, values: &[u16]) -> Self {
        Self { id, kind: 3, count: values.len() as u32, data: values.iter().flat_map(|v| v.to_le_bytes()).collect() }
    }
    fn longs(id: u16, values: &[u32]) -> Self {
        Self { id, kind: 4, count: values.len() as u32, data: values.iter().flat_map(|v| v.to_le_bytes()).collect() }
    }
    fn doubles(id: u16, values: &[f64]) -> Self {
        Self { id, kind: 12, count: values.len() as u32, data: values.iter().flat_map(|v| v.to_le_bytes()).collect() }
    }
    fn text(id: u16, s: &str) -> Self {
        let mut data = s.as_bytes().to_vec();
        data.push(0);
        Self { id, kind: 2, count: data.len() as u32, data }
    }
}
fn header(images: &[Image], geo: &Geo) -> io::Result<Vec<u8>> {
    let mut directories = Vec::new();
    for (level, image) in images.iter().enumerate() {
        let mut tags = vec![
            Tag::longs(254, &[u32::from(level != 0)]),
            Tag::longs(256, &[image.width]),
            Tag::longs(257, &[image.height]),
            Tag::shorts(258, &[32]),
            Tag::shorts(259, &[8]),
            Tag::shorts(262, &[1]),
            Tag::shorts(277, &[1]),
            Tag::shorts(284, &[1]),
            Tag::shorts(317, &[3]),
            Tag::longs(322, &[TILE_WIDTH]),
            Tag::longs(323, &[image.tile_height]),
            Tag::longs(324, &image.offsets),
            Tag::longs(325, &image.counts),
            Tag::shorts(339, &[3]),
        ];
        if level == 0 {
            if !geo.pixel_scale.is_empty() {
                tags.push(Tag::doubles(33550, &geo.pixel_scale));
            }
            if !geo.tiepoint.is_empty() {
                tags.push(Tag::doubles(33922, &geo.tiepoint));
            }
            if !geo.transformation.is_empty() {
                tags.push(Tag::doubles(34264, &geo.transformation));
            }
            let (mut keys, mut doubles, mut ascii) = (vec![1, 1, 0, 0], Vec::new(), geo.citation.clone());
            for (id, value) in &geo.keys {
                keys.push(*id);
                match value {
                    GeoValue::Short(v) => keys.extend_from_slice(&[0, 1, *v]),
                    GeoValue::Doubles(v) => {
                        keys.extend_from_slice(&[
                            34736,
                            u16::try_from(v.len()).map_err(|_| invalid("too many GeoKey values"))?,
                            u16::try_from(doubles.len()).map_err(|_| invalid("GeoKey offset overflow"))?,
                        ]);
                        doubles.extend_from_slice(v);
                    }
                    GeoValue::Ascii(s) => {
                        // GeoTIFF citations are ASCII; reject unsupported text
                        // rather than changing character/byte GeoKey offsets.
                        if !s.is_ascii() || !ascii.is_ascii() {
                            return Err(invalid("non-ASCII GeoTIFF citation"));
                        }
                        let text = format!("{s}|");
                        let offset = ascii.find(&text).unwrap_or_else(|| {
                            let at = ascii.len();
                            ascii.push_str(&text);
                            at
                        });
                        keys.extend_from_slice(&[
                            34737,
                            u16::try_from(text.len()).map_err(|_| invalid("GeoKey text overflow"))?,
                            u16::try_from(offset).map_err(|_| invalid("GeoKey offset overflow"))?,
                        ]);
                    }
                }
            }
            keys[3] = u16::try_from(geo.keys.len()).map_err(|_| invalid("too many GeoKeys"))?;
            tags.push(Tag::shorts(34735, &keys));
            if !doubles.is_empty() {
                tags.push(Tag::doubles(34736, &doubles));
            }
            if !ascii.is_empty() {
                tags.push(Tag::text(34737, &ascii));
            }
            tags.push(Tag::text(42113, "nan"));
        }
        tags.sort_by_key(|t| t.id);
        directories.push(tags);
    }
    let mut at = 8usize;
    let mut ifds = Vec::new();
    for tags in &directories {
        ifds.push(at);
        at += 2 + tags.len() * 12 + 4;
    }
    let mut out = vec![0; at];
    out[..8].copy_from_slice(&[b'I', b'I', 42, 0, 8, 0, 0, 0]);
    for (i, tags) in directories.iter().enumerate() {
        let start = ifds[i];
        out[start..start + 2].copy_from_slice(&(tags.len() as u16).to_le_bytes());
        for (j, tag) in tags.iter().enumerate() {
            let at = start + 2 + j * 12;
            out[at..at + 2].copy_from_slice(&tag.id.to_le_bytes());
            out[at + 2..at + 4].copy_from_slice(&tag.kind.to_le_bytes());
            out[at + 4..at + 8].copy_from_slice(&tag.count.to_le_bytes());
            if tag.data.len() <= 4 {
                out[at + 8..at + 8 + tag.data.len()].copy_from_slice(&tag.data);
            } else {
                while !out.len().is_multiple_of(8) {
                    out.push(0);
                }
                let offset = u32::try_from(out.len()).map_err(|_| invalid("TIFF header overflow"))?;
                out[at + 8..at + 12].copy_from_slice(&offset.to_le_bytes());
                out.extend_from_slice(&tag.data);
            }
        }
        let next = ifds.get(i + 1).copied().unwrap_or(0) as u32;
        let end = start + 2 + tags.len() * 12;
        out[end..end + 4].copy_from_slice(&next.to_le_bytes());
    }
    while !out.len().is_multiple_of(8) {
        out.push(0);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn geo() -> Geo {
        Geo {
            pixel_scale: vec![0.5, 0.5, 0.0],
            tiepoint: vec![0.0, 0.0, 0.0, 500000.0, 5300000.0, 0.0],
            epsg: Some(26910),
            citation: "NAD83 / UTM zone 10N|NAVD88|".into(),
            nodata: Some(-9999.0),
            keys: vec![
                (1024, GeoValue::Short(1)),
                (1025, GeoValue::Short(1)),
                (3072, GeoValue::Short(26910)),
                (3073, GeoValue::Ascii("NAD83 / UTM zone 10N".into())),
                (4097, GeoValue::Ascii("NAVD88".into())),
                (4099, GeoValue::Short(9003)),
                (2057, GeoValue::Doubles(vec![6378137.0])),
            ],
            transformation: vec![],
        }
    }
    fn image(file: &[u8], level: &Level) -> Vec<f32> {
        let mut out = vec![f32::NAN; (level.width * level.height) as usize];
        for ty in 0..level.blocks_down() {
            for tx in 0..level.blocks_across() {
                let i = (ty * level.blocks_across() + tx) as usize;
                let start = level.offsets[i] as usize;
                let count = level.counts[i] as usize;
                let block = decode_block(&file[start..start + count], level, true).unwrap();
                for y in 0..level.block_height {
                    for x in 0..level.block_width {
                        let (px, py) = (tx * level.block_width + x, ty * level.block_height + y);
                        if px < level.width && py < level.height {
                            out[(py * level.width + px) as usize] = block[(y * level.block_width + x) as usize];
                        }
                    }
                }
            }
        }
        out
    }
    #[test]
    fn lossless_base_geokeys_and_registered_odd_sized_overviews() {
        let (w, h) = (515u32, 517u32);
        let geo = geo();
        let plan = Plan::new(w, h, &geo, 16 << 20).unwrap();
        let admitted = plan.max_bytes;
        assert!(plan.memory_bytes < 16 << 20);
        let mut writer = Writer::new(Cursor::new(Vec::new()), plan).unwrap();
        let mut input = Vec::new();
        for y in 0..h {
            let row: Vec<f32> = (0..w)
                .map(|x| if x < 2 && y < 3 { -9999.0 } else { 1000.0 + x as f32 * 0.25 + y as f32 * 0.5 })
                .collect();
            input.extend_from_slice(&row);
            writer.row(&row).unwrap();
        }
        let file = writer.finish(|| Ok(())).unwrap().into_inner();
        assert!((file.len() as u64) <= admitted);
        let tiff = super::super::parse(&file).unwrap();
        assert!(tiff.complete);
        assert_eq!(tiff.levels.len(), 3);
        assert_eq!(tiff.geo.pixel_scale, geo.pixel_scale);
        assert_eq!(tiff.geo.tiepoint, geo.tiepoint);
        assert_eq!(tiff.geo.keys, geo.keys);
        assert_eq!(tiff.geo.epsg, geo.epsg);
        assert!(tiff.geo.nodata.unwrap().is_nan());
        let base = image(&file, &tiff.levels[0]);
        for (&a, &b) in base.iter().zip(&input) {
            if b == -9999.0 {
                assert!(a.is_nan());
            } else {
                assert_eq!(a.to_bits(), b.to_bits());
            }
        }
        let overview = &tiff.levels[1];
        let pixels = image(&file, overview);
        // Integrate a piecewise-constant tilted plane analytically. A naive
        // 2x2 decimator would shift this odd-sized image's sample lattice.
        let integral = |v: f64| {
            let n = v.floor();
            n * (n - 1.0) / 2.0 + n * (v - n)
        };
        let (sx, sy) = (f64::from(w) / f64::from(overview.width), f64::from(h) / f64::from(overview.height));
        for (i, &value) in pixels.iter().enumerate() {
            let (x, y) = ((i % overview.width as usize) as f64, (i / overview.width as usize) as f64);
            if x < 2.0 && y < 2.0 {
                continue;
            }
            let mean_x = (integral((x + 1.0) * sx) - integral(x * sx)) / sx;
            let mean_y = (integral((y + 1.0) * sy) - integral(y * sy)) / sy;
            let expected = 1000.0 + 0.25 * mean_x + 0.5 * mean_y;
            assert!((f64::from(value) - expected).abs() < 0.0001, "overview {i}: {value} vs {expected}");
        }
        if let Some(path) = std::env::var_os("CSK_TILED_QA_OUTPUT") {
            std::fs::write(path, &file).unwrap();
        }
    }
    #[test]
    fn interrupted_or_incomplete_images_never_publish_a_header() {
        let mut output = Cursor::new(Vec::new());
        let plan = Plan::new(257, 257, &geo(), 16 << 20).unwrap();
        let mut writer = Writer::new(&mut output, plan).unwrap();
        writer.row(&vec![100.0; 257]).unwrap();
        assert!(writer.finish(|| Ok(())).is_err());
        assert!(super::super::parse(output.get_ref()).is_err());
        let mut output = Cursor::new(Vec::new());
        let plan = Plan::new(257, 257, &geo(), 16 << 20).unwrap();
        let mut writer = Writer::new(&mut output, plan).unwrap();
        for _ in 0..257 {
            writer.row(&vec![100.0; 257]).unwrap();
        }
        assert!(writer.finish(|| Err(io::Error::new(io::ErrorKind::Interrupted, "execution expired"))).is_err());
        assert!(super::super::parse(output.get_ref()).is_err());
        assert!(Plan::new(100000, 100000, &geo(), 2 << 30).is_err());
        let plan = Plan::new(2 << 20, 1, &geo(), 2 << 30).unwrap();
        assert!(plan.memory_bytes < 160 << 20);
    }
}
