//! Image export (app/snapshot.js): a rectangle of the view rendered at a
//! chosen resolution from sources at the detail that resolution asks for,
//! in the person's layer order and appearance, written as a streamed PNG.
//!
//! The image is rendered in blocks, each with its own terrain store, tile
//! loader and layers loading for that block alone, and written band by band,
//! so no buffer ever holds the whole image: the limit is the file, not the
//! device. Most exports (up to 4096 px a side) are one block and so have no
//! seams at all.

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use csk_gpu::{Layer, View};

/// Output limits (snapshot.js on iOS with streamed PNG).
pub const MAX_PIXELS: u64 = 200_000_000;
pub const MAX_EDGE: u32 = 200_000;
/// How long a block waits for its sources before it is drawn as it stands.
const BLOCK_WAIT: Duration = Duration::from_secs(30);

/// What to export.
#[derive(Clone, Debug)]
pub struct Request {
    /// The live view the rectangle is drawn on.
    pub view: View,
    /// The rectangle in the view's CSS px: left, top, right, bottom.
    pub rect: [f64; 4],
    /// Output pixels per CSS px.
    pub scale: f64,
    /// The map info card, drawn over the image's bottom-left corner, once
    /// the platform has drawn it.
    pub card: Option<Arc<Card>>,
}

/// The map info card for an export: straight RGBA and its size in output
/// px, drawn by the platform while the export starts.
#[derive(Default)]
pub struct Card {
    image: Mutex<Option<(Vec<u8>, u32, u32)>>,
    ready: Condvar,
}

impl std::fmt::Debug for Card {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let size = self.image.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|(_, w, h)| (*w, *h));
        f.debug_struct("Card").field("size", &size).finish()
    }
}

impl Card {
    /// Takes the card as a PNG. False if it is not one.
    pub fn put_png(&self, bytes: &[u8]) -> bool {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
        let Ok(mut reader) = decoder.read_info() else { return false };
        let Some(size) = reader.output_buffer_size() else { return false };
        let mut buffer = vec![0; size];
        let Ok(frame) = reader.next_frame(&mut buffer) else { return false };
        if frame.color_type != png::ColorType::Rgba {
            return false;
        }
        buffer.truncate(frame.buffer_size());
        *self.image.lock().unwrap_or_else(|e| e.into_inner()) = Some((buffer, frame.width, frame.height));
        self.ready.notify_all();
        true
    }

    /// The card, waiting up to `timeout` for it.
    fn wait(&self, timeout: Duration) -> Option<(Vec<u8>, u32, u32)> {
        let image = self.image.lock().unwrap_or_else(|e| e.into_inner());
        let (image, _) =
            self.ready.wait_timeout_while(image, timeout, |i| i.is_none()).unwrap_or_else(|e| e.into_inner());
        image.clone()
    }
}

impl Request {
    /// The output size in pixels.
    pub fn size(&self) -> (u32, u32) {
        let w = ((self.rect[2] - self.rect[0]) * self.scale).round().max(1.0);
        let h = ((self.rect[3] - self.rect[1]) * self.scale).round().max(1.0);
        (w as u32, h as u32)
    }

    /// Why the request cannot be exported, if it cannot.
    pub fn refused(&self) -> Option<&'static str> {
        let (w, h) = self.size();
        if !(self.rect.iter().all(|v| v.is_finite()) && self.scale.is_finite() && self.scale > 0.0) {
            return Some("The selection cannot be exported.");
        }
        if w > MAX_EDGE || h > MAX_EDGE || u64::from(w) * u64::from(h) > MAX_PIXELS {
            return Some("That is larger than this iPhone can save. Choose a lower resolution or a smaller area.");
        }
        None
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Refused(&'static str),
    #[error("the export was cancelled")]
    Cancelled,
    #[error(transparent)]
    Gpu(#[from] csk_gpu::Error),
    #[error("the image could not be written: {0}")]
    Io(#[from] std::io::Error),
    #[error("the image could not be encoded: {0}")]
    Png(#[from] png::EncodingError),
}

/// How an export went.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Summary {
    pub width: u32,
    pub height: u32,
    /// Blocks drawn before all their sources answered (a slow or failing
    /// source); the rest are complete.
    pub partial: u32,
    pub blocks: u32,
}

/// A block's view: the part `x`, `y` (output px, which may reach past the
/// image for a margin) of the rectangle, at the export's density.
fn block_view(req: &Request, x: [f64; 2], y: [f64; 2]) -> View {
    let v = req.view;
    let s = req.scale;
    let (bw, bh) = (x[1] - x[0], y[1] - y[0]);
    // The block centre on the live screen, from the screen centre.
    let cx = req.rect[0] + (x[0] + bw / 2.0) / s - v.css[0] / 2.0;
    let cy = req.rect[1] + (y[0] + bh / 2.0) / s - v.css[1] / 2.0;
    let (sin, cos) = v.bearing.to_radians().sin_cos();
    let world = 256.0 * v.zoom.exp2();
    // Screen offset to map offset: the inverse of the camera's rotation.
    let (mx, my) = (cx * cos + cy * sin, -cx * sin + cy * cos);
    View {
        center: [v.center[0] + mx / world, v.center[1] + my / world],
        zoom: v.zoom,
        bearing: v.bearing,
        css: [bw / s, bh / s],
        dpr: s,
        export: true,
    }
}

/// The block size and the overlap around each block. An image no larger
/// than the screen is one block; a larger one is cut into blocks no larger
/// than the screen (so they fit the map's own terrain store and tile pools),
/// each drawn with a margin that is cropped away, so filters near a block's
/// edge (relative elevation, Detail) read real terrain instead of an edge.
fn blocks(image: (u32, u32), screen: (u32, u32)) -> ([u32; 2], u32) {
    if image.0 <= screen.0 && image.1 <= screen.1 {
        return ([image.0, image.1], 0);
    }
    const MARGIN: u32 = 128;
    let side = |screen: u32| screen.saturating_sub(2 * MARGIN).clamp(256, 1024);
    ([side(screen.0), side(screen.1)], MARGIN)
}

/// Premultiplied to straight alpha, in place.
fn unpremultiply(rgba: &mut [u8]) {
    for p in rgba.chunks_exact_mut(4) {
        let a = u32::from(p[3]);
        if a != 0 && a != 255 {
            for c in &mut p[..3] {
                *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}

/// Draws straight-alpha `card` over straight-alpha `band` rows `[y0, y1)`
/// of an image `width` wide and `height` tall, at the bottom-left corner.
fn draw_card(band: &mut [u8], width: u32, height: u32, y0: u32, y1: u32, card: &(Vec<u8>, u32, u32), margin: u32) {
    let (pixels, cw, ch) = card;
    let (left, top) = (margin, height.saturating_sub(ch + margin));
    for y in y0.max(top)..y1.min(top + ch) {
        for x in left..(left + cw).min(width) {
            let c = &pixels[(((y - top) * cw + (x - left)) * 4) as usize..][..4];
            let d = &mut band[(((y - y0) * width + x) * 4) as usize..][..4];
            let a = u32::from(c[3]);
            for i in 0..3 {
                d[i] = ((u32::from(c[i]) * a + u32::from(d[i]) * (255 - a) + 127) / 255) as u8;
            }
            d[3] = (a + u32::from(d[3]) * (255 - a) / 255).min(255) as u8;
        }
    }
}

/// Renders the export into a PNG at `path`, with the map's own terrain,
/// tiles and layers; the map stops presenting meanwhile (`Scene::exporting`),
/// so the live view cannot cancel the export's requests. `progress` hears
/// blocks done of all; `cancel` stops it between steps.
pub(crate) fn run(
    map: &crate::Map,
    req: &Request,
    path: &Path,
    progress: &dyn Fn(u32, u32),
    cancel: &AtomicBool,
) -> Result<Summary, Error> {
    if let Some(reason) = req.refused() {
        return Err(Error::Refused(reason));
    }
    let (width, height) = req.size();
    let (block, margin) = blocks((width, height), req.view.device_size());
    let (cols, rows) = (width.div_ceil(block[0]), height.div_ceil(block[1]));
    let total = cols * rows;

    let file = std::io::BufWriter::new(std::fs::File::create(path)?);
    let mut encoder = png::Encoder::new(file, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut stream = encoder.write_header()?.into_stream_writer()?;

    // The card covers a corner that may span several bands: have it first.
    let card = req.card.as_ref().and_then(|c| c.wait(Duration::from_secs(5)));
    let mut summary = Summary { width, height, partial: 0, blocks: total };
    let corner = (12.0 * req.scale).round() as u32;
    let m = f64::from(margin);
    for row in 0..rows {
        let y = [row * block[1], ((row + 1) * block[1]).min(height)];
        let mut band = vec![0u8; (width * (y[1] - y[0]) * 4) as usize];
        for col in 0..cols {
            let x = [col * block[0], ((col + 1) * block[0]).min(width)];
            let view =
                block_view(req, [f64::from(x[0]) - m, f64::from(x[1]) + m], [f64::from(y[0]) - m, f64::from(y[1]) + m]);
            let started = Instant::now();
            // Load until every source has answered for this block, then draw.
            let pixels = loop {
                if cancel.load(Ordering::Relaxed) {
                    return Err(Error::Cancelled);
                }
                let (image, done) = {
                    let mut scene = crate::lock(&map.scene);
                    let crate::Scene { gpu, terrain, loader, layers, markers, uniforms, .. } = &mut *scene;
                    loader.update(gpu, terrain, &view);
                    layers.update(gpu, &view)?;
                    let mut frame = layers.frame();
                    frame.push(Layer::Markers(markers));
                    let (image, stats) = terrain.render_offscreen_layers(gpu, &view, uniforms, &mut frame)?;
                    let busy = loader.in_flight() + layers.in_flight();
                    (image, stats.coverage >= 1.0 && busy == 0)
                };
                if done || started.elapsed() >= BLOCK_WAIT {
                    summary.partial += u32::from(!done);
                    let gpu = crate::lock(&map.scene).gpu.clone();
                    break gpu.readback(&image)?;
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            // The block's rows, without its margin, into the band.
            let (bw, bh) = (x[1] - x[0], y[1] - y[0]);
            let stride = bw + 2 * margin;
            for r in 0..bh {
                let from = (((r + margin) * stride + margin) * 4) as usize;
                let to = ((r * width + x[0]) * 4) as usize;
                band[to..to + (bw * 4) as usize].copy_from_slice(&pixels[from..from + (bw * 4) as usize]);
            }
            progress(row * cols + col + 1, total);
        }
        unpremultiply(&mut band);
        if let Some(card) = &card {
            draw_card(&mut band, width, height, y[0], y[1], card, corner);
        }
        stream.write_all(&band)?;
    }
    stream.finish()?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(rect: [f64; 4], scale: f64, bearing: f64) -> Request {
        Request {
            view: View { center: [0.5, 0.5], zoom: 10.0, bearing, css: [400.0, 800.0], dpr: 3.0, export: false },
            rect,
            scale,
            card: None,
        }
    }

    #[test]
    fn blocks_tile_the_rectangle_on_a_turned_map() {
        let whole = request([0.0, 0.0, 400.0, 800.0], 2.0, 90.0);
        assert_eq!(whole.size(), (800, 1600));
        // One block: the view itself, at the export's density.
        let v = block_view(&whole, [0.0, 800.0], [0.0, 1600.0]);
        assert!((v.center[0] - 0.5).abs() < 1e-12 && (v.center[1] - 0.5).abs() < 1e-12);
        assert_eq!((v.css, v.dpr, v.export), ([400.0, 800.0], 2.0, true));
        // The right half of a selection on a map turned 90° clockwise: screen
        // right is map north, so the block centre moves north of the view's.
        let world = 256.0 * 1024.0;
        let half = block_view(&whole, [400.0, 800.0], [0.0, 1600.0]);
        assert!((half.center[0] - 0.5).abs() < 1e-12);
        assert!((half.center[1] - (0.5 - 100.0 / world)).abs() < 1e-12);
        assert!(request([0.0, 0.0, 400.0, 800.0], 32.0, 0.0).refused().is_some());
        assert!(whole.refused().is_none());
        // Up to the screen's size, one block; larger, screen-sized blocks with a margin.
        assert_eq!(blocks((880, 1912), (1320, 2868)), ([880, 1912], 0));
        assert_eq!(blocks((1760, 3824), (1320, 2868)), ([1024, 1024], 128));
    }

    #[test]
    fn unpremultiplies_and_draws_the_card_over_its_corner() {
        let mut px = vec![100, 50, 0, 128, 0, 0, 0, 0, 10, 20, 30, 255];
        unpremultiply(&mut px);
        assert_eq!(&px[..4], &[199, 100, 0, 128]);
        assert_eq!(&px[8..], &[10, 20, 30, 255]);
        // A 2x1 opaque red card in a 4x4 image, one pixel from the bottom left.
        let card = (vec![255, 0, 0, 255, 255, 0, 0, 255], 2, 1);
        let mut band = vec![0u8; 4 * 4 * 4];
        draw_card(&mut band, 4, 4, 0, 4, &card, 1);
        let at = |x: usize, y: usize| band[(y * 4 + x) * 4..(y * 4 + x) * 4 + 4].to_vec();
        assert_eq!(
            (at(1, 2), at(2, 2), at(0, 2), at(1, 3)),
            (vec![255, 0, 0, 255], vec![255, 0, 0, 255], vec![0; 4], vec![0; 4])
        );
    }
}
