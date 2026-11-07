//! Map layers: raster layers (which tiles each visible layer needs, fetched
//! through the engine, which keeps them for offline use, decoded off the
//! render thread) and vector layers (shapes from the app, tessellated off
//! the render thread), drawn in layer order with the terrain.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use csk_engine::Engine;
use csk_engine::layers::{RasterAnswer, RasterLayer};
use csk_gpu::{Raster, RasterStyle, Renderer, Shapes, TILE, TileId, Vector, View};

use crate::loader::Wake;

const IN_FLIGHT_PER_LAYER: usize = 6;
/// Enough for the largest rotated view, stand-ins and a zoom step's cover.
const POOL_TILES: u32 = 96;
/// A kept tile served after a failed refresh is asked again after.
const REFRESH_STALE: Duration = Duration::from_secs(60);

/// One entry of the map's layer order, bottom first.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Draw {
    Terrain,
    Raster(RasterLayer, RasterStyle),
    /// A satellite scene set with [`Layers::set_scene`].
    Scene(u32, RasterStyle),
    /// A vector layer set with [`Layers::set_vector`], at an opacity.
    Vector(&'static str, f32),
}

/// A satellite scene's tiles: a template with `{z}`, `{x}` and `{y}` on an
/// imagery host, the finest level it holds and the tile side it sends.
#[derive(Clone, Debug, PartialEq)]
pub struct SceneTiles {
    pub template: Arc<str>,
    pub max_zoom: u8,
    pub pixels: u32,
}

/// What a raster pool draws: a catalogue layer or a scene.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Pool {
    Layer(RasterLayer),
    Scene(u32),
}

/// A vector layer: the newest shapes' revision, and the mesh of that
/// revision once built.
#[derive(Default)]
struct VectorSlot {
    revision: u64,
    drawn: Option<(u64, Vector)>,
}

/// A decoded answer: premultiplied 256x256 RGBA, nothing, or not yet.
enum Decoded {
    Image(Vec<u8>, bool),
    Empty,
    Retry(Duration),
}

/// Decodes a published tile to premultiplied RGBA. None if it is not a
/// `side` px PNG or JPEG.
pub fn decode(bytes: &[u8], side: u32) -> Option<Vec<u8>> {
    let mut rgba = if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        use zune_core::bytestream::ZCursor;
        use zune_core::colorspace::ColorSpace;
        use zune_core::options::DecoderOptions;
        let options = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGBA);
        let mut decoder = zune_jpeg::JpegDecoder::new_with_options(ZCursor::new(bytes), options);
        let pixels = decoder.decode().ok()?;
        let info = decoder.info()?;
        (u32::from(info.width) == side && u32::from(info.height) == side).then_some(pixels)?
    } else {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
        let mut reader = decoder.read_info().ok()?;
        let mut buffer = vec![0; reader.output_buffer_size()?];
        let frame = reader.next_frame(&mut buffer).ok()?;
        if frame.width != side || frame.height != side {
            return None;
        }
        let pixels = &buffer[..frame.buffer_size()];
        match frame.color_type {
            png::ColorType::Rgba => pixels.to_vec(),
            png::ColorType::GrayscaleAlpha => pixels.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
            _ => return None,
        }
    };
    if rgba.len() != (side * side * 4) as usize {
        return None;
    }
    csk_gpu::raster::premultiply(&mut rgba);
    Some(rgba)
}

type Key = (Pool, TileId);
/// A layer's tessellated shapes and the revision they were built for.
type Built = (&'static str, u64, csk_gpu::Mesh);

pub struct Layers {
    runtime: tokio::runtime::Handle,
    engine: Arc<Engine>,
    wake: Wake,
    pub order: Vec<Draw>,
    rasters: HashMap<Pool, Raster>,
    scenes: HashMap<u32, SceneTiles>,
    in_flight: HashMap<Key, tokio::task::AbortHandle>,
    later: HashMap<Key, Instant>,
    stale: HashSet<Key>,
    tx: mpsc::Sender<(Key, Decoded)>,
    rx: mpsc::Receiver<(Key, Decoded)>,
    vectors: HashMap<&'static str, VectorSlot>,
    meshes: (mpsc::Sender<Built>, mpsc::Receiver<Built>),
}

impl Layers {
    pub fn new(runtime: tokio::runtime::Handle, engine: Arc<Engine>, wake: Wake) -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            runtime,
            engine,
            wake,
            order: vec![Draw::Terrain],
            rasters: HashMap::new(),
            scenes: HashMap::new(),
            in_flight: HashMap::new(),
            later: HashMap::new(),
            stale: HashSet::new(),
            tx,
            rx,
            vectors: HashMap::new(),
            meshes: mpsc::channel(),
        }
    }

    /// Sets a scene's tiles (None removes it). New tiles replace what the
    /// scene drew before.
    pub fn set_scene(&mut self, id: u32, tiles: Option<SceneTiles>) {
        if self.scenes.get(&id) == tiles.as_ref() {
            return;
        }
        self.rasters.remove(&Pool::Scene(id));
        self.in_flight.retain(|(pool, _), task| {
            let kept = *pool != Pool::Scene(id);
            if !kept {
                task.abort();
            }
            kept
        });
        self.later.retain(|(pool, _), _| *pool != Pool::Scene(id));
        self.stale.retain(|(pool, _)| *pool != Pool::Scene(id));
        match tiles {
            Some(tiles) => self.scenes.insert(id, tiles),
            None => self.scenes.remove(&id),
        };
    }

    /// Replaces a vector layer's shapes (None removes the layer). They are
    /// tessellated on the runtime; until then the previous shapes draw.
    pub fn set_vector(&mut self, id: &'static str, shapes: Option<Arc<Shapes>>) {
        let Some(shapes) = shapes else {
            self.vectors.remove(id);
            return;
        };
        let slot = self.vectors.entry(id).or_default();
        slot.revision += 1;
        let (revision, tx, wake) = (slot.revision, self.meshes.0.clone(), self.wake.clone());
        self.runtime.spawn_blocking(move || {
            if tx.send((id, revision, csk_gpu::vector::tessellate(&shapes))).is_ok() {
                wake();
            }
        });
    }

    /// Tiles requested and vector shapes still tessellating.
    pub fn in_flight(&self) -> usize {
        let meshing = self.vectors.values().filter(|v| v.drawn.as_ref().is_none_or(|(r, _)| *r != v.revision)).count();
        self.in_flight.len() + meshing
    }

    fn wake_at(&self, after: Duration) {
        let wake = self.wake.clone();
        self.runtime.spawn(async move {
            tokio::time::sleep(after).await;
            wake();
        });
    }

    /// Sets the layer order (bottom first). Layers no longer drawn free
    /// their pools.
    pub fn set_order(&mut self, order: Vec<Draw>) {
        let used: HashSet<Pool> = order
            .iter()
            .filter_map(|d| match d {
                Draw::Raster(layer, style) if style.opacity > 0.0 => Some(Pool::Layer(*layer)),
                Draw::Scene(id, style) if style.opacity > 0.0 => Some(Pool::Scene(*id)),
                _ => None,
            })
            .collect();
        self.rasters.retain(|layer, _| used.contains(layer));
        self.in_flight.retain(|(layer, _), task| {
            let kept = used.contains(layer);
            if !kept {
                task.abort();
            }
            kept
        });
        self.order = order;
    }

    /// Takes in arrived tiles and requests what `view` needs. Returns
    /// whether anything drawn changed.
    pub fn update(&mut self, gpu: &Renderer, view: &View) -> Result<bool, csk_gpu::Error> {
        let now = Instant::now();
        let mut changed = false;
        for draw in &self.order {
            // A pool's tiles: (min, max) zoom, side, and sharp.
            let (pool, spec) = match *draw {
                Draw::Raster(layer, style) if style.opacity > 0.0 => {
                    (Pool::Layer(layer), ((layer.min_zoom(), layer.max_zoom()), layer.pixels(), layer.sharp()))
                }
                Draw::Scene(id, style) if style.opacity > 0.0 => {
                    let Some(tiles) = self.scenes.get(&id) else { continue };
                    (Pool::Scene(id), ((0, tiles.max_zoom), tiles.pixels, false))
                }
                _ => continue,
            };
            if let std::collections::hash_map::Entry::Vacant(slot) = self.rasters.entry(pool) {
                let ((min, max), pixels, sharp) = spec;
                // Display-density tiles are 4x the bytes a tile.
                let tiles = if pixels > TILE { POOL_TILES * 2 / 3 } else { POOL_TILES };
                slot.insert(Raster::new(gpu, tiles, min, max, pixels, sharp)?);
            }
        }
        while let Ok((key, answer)) = self.rx.try_recv() {
            self.in_flight.remove(&key);
            self.stale.remove(&key);
            let Some(raster) = self.rasters.get_mut(&key.0) else { continue };
            match answer {
                Decoded::Image(rgba, lasting) => {
                    raster.insert(gpu, key.1, &rgba)?;
                    changed = true;
                    if !lasting {
                        self.stale.insert(key);
                        self.later.insert(key, now + REFRESH_STALE);
                        self.wake_at(REFRESH_STALE);
                    }
                }
                Decoded::Empty => {
                    raster.insert_empty(key.1);
                    changed = true;
                }
                Decoded::Retry(after) => {
                    self.later.insert(key, now + after);
                    self.wake_at(after);
                }
            }
        }
        while let Ok((id, revision, mesh)) = self.meshes.1.try_recv() {
            // Only the newest shapes of a layer still set are kept.
            let Some(slot) = self.vectors.get_mut(id) else { continue };
            if slot.revision == revision {
                slot.drawn = Some((revision, Vector::new(gpu, &mesh)?));
                changed = true;
            }
        }
        let mut wanted = Vec::new();
        for (&layer, raster) in &self.rasters {
            wanted.extend(raster.wanted(view).into_iter().map(|t| (layer, t)));
        }
        let keep: HashSet<Key> = wanted.iter().copied().collect();
        self.in_flight.retain(|key, task| {
            let kept = keep.contains(key);
            if !kept {
                task.abort();
            }
            kept
        });
        self.later.retain(|key, at| keep.contains(key) && *at > now);
        let mut busy: HashMap<Pool, usize> = HashMap::new();
        for (layer, _) in self.in_flight.keys() {
            *busy.entry(*layer).or_default() += 1;
        }
        for key in wanted {
            let held = self.rasters[&key.0].held(key.1);
            if (held && !self.stale.contains(&key))
                || self.in_flight.contains_key(&key)
                || self.later.contains_key(&key)
            {
                continue;
            }
            let count = busy.entry(key.0).or_default();
            if *count >= IN_FLIGHT_PER_LAYER {
                continue;
            }
            *count += 1;
            let (engine, tx, wake) = (self.engine.clone(), self.tx.clone(), self.wake.clone());
            let scene = match key.0 {
                Pool::Scene(id) => self.scenes.get(&id).cloned(),
                Pool::Layer(_) => None,
            };
            let pixels = self.rasters[&key.0].pixels();
            let task = self.runtime.spawn(async move {
                let TileId { z, x, y } = key.1;
                let answer = match (key.0, scene) {
                    (Pool::Layer(layer), _) => engine.raster_tile(layer, z, x, y).await,
                    (Pool::Scene(_), Some(tiles)) => engine.scene_tile(&tiles.template, z, x, y).await,
                    (Pool::Scene(_), None) => RasterAnswer::Empty,
                };
                let decoded = match answer {
                    RasterAnswer::Image { bytes, lasting } => match decode(&bytes, pixels) {
                        Some(rgba) => Decoded::Image(rgba, lasting),
                        // Undecodable bytes are not an answer to keep.
                        None => Decoded::Retry(Duration::from_secs(60)),
                    },
                    RasterAnswer::Empty => Decoded::Empty,
                    RasterAnswer::Retry { after } => Decoded::Retry(after),
                };
                if tx.send((key, decoded)).is_ok() {
                    wake();
                }
            });
            self.in_flight.insert(key, task.abort_handle());
        }
        Ok(changed)
    }

    /// The frame's layers, bottom first, for [`csk_gpu::Terrain::render`].
    pub fn frame(&mut self) -> Vec<csk_gpu::Layer<'_>> {
        let mut rasters: HashMap<Pool, &mut Raster> = self.rasters.iter_mut().map(|(k, v)| (*k, v)).collect();
        let mut out = Vec::with_capacity(self.order.len());
        for draw in &self.order {
            match *draw {
                Draw::Terrain => out.push(csk_gpu::Layer::Terrain),
                Draw::Raster(layer, style) => {
                    if let Some(raster) = rasters.remove(&Pool::Layer(layer)) {
                        out.push(csk_gpu::Layer::Raster(raster, style));
                    }
                }
                Draw::Scene(id, style) => {
                    if let Some(raster) = rasters.remove(&Pool::Scene(id)) {
                        out.push(csk_gpu::Layer::Raster(raster, style));
                    }
                }
                Draw::Vector(id, opacity) => {
                    if let Some((_, vector)) = self.vectors.get(id).and_then(|v| v.drawn.as_ref()) {
                        out.push(csk_gpu::Layer::Vector(vector, opacity));
                    }
                }
            }
        }
        out
    }
}

impl Drop for Layers {
    fn drop(&mut self) {
        for task in self.in_flight.values() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_and_premultiplies_png() {
        let mut rgba = vec![0u8; (TILE * TILE * 4) as usize];
        rgba[..4].copy_from_slice(&[200, 100, 50, 128]);
        let png = csk_core::raster::png::encode_rgba(&rgba, TILE, TILE);
        let out = decode(&png, TILE).unwrap();
        assert_eq!(&out[..4], &[100, 50, 25, 128]);
    }
}
