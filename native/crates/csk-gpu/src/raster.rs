//! Raster map layers (the basemap, reference overlays): published 256 px
//! tiles in a GPU pool, drawn as camera-aligned quads in the frame's single
//! render pass, beneath or above the terrain in layer order.
//!
//! A layer draws at the published level nearest the view's zoom (as web
//! maps choose tiles), clamped to its finest level and stretched beyond.
//! While a tile loads, its nearest held ancestor stands in, and held
//! children from a finer view cover it when zooming out. An answered empty
//! tile is the layer's truth there: nothing coarser shows through.

use std::collections::HashMap;
use std::sync::Arc;

use csk_core::resource::Reservation;
use wgpu::util::DeviceExt;

use crate::render::texture_bytes;
use crate::terrain::{TileId, View};
use crate::{Error, Renderer};

/// Empty answers kept as coverage, beyond the pool's resident tiles.
const MAX_EMPTY: usize = 4096;
/// Levels an ancestor may be magnified by to stand in.
const MAX_STRETCH: u8 = 8;

/// How a layer is composited.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RasterStyle {
    /// 0..=1.
    pub opacity: f32,
    /// Greyscale and brightened, as the web map reads reference layers on
    /// a dark basemap.
    pub muted: bool,
}

struct Record {
    layer: Option<u32>,
    used: u64,
}

pub struct Raster {
    identity: Arc<()>,
    min_zoom: u8,
    max_zoom: u8,
    /// Tile side in pixels (256, or more for display-density exports).
    pixels: u32,
    records: HashMap<TileId, Record>,
    pool: wgpu::Texture,
    pool_view: wgpu::TextureView,
    free: Vec<u32>,
    frame: u64,
    _charge: Arc<Reservation>,
}

/// One tile to draw: CSS-pixel rectangle about the view centre (unrotated),
/// pool sub-rectangle and pool layer.
struct Quad {
    rect: [f64; 4],
    uv: [f32; 4],
    layer: u32,
}

impl Raster {
    /// A layer whose pool holds `pool_tiles` tiles of `pixels` square,
    /// drawn from level `min_zoom` and published to `max_zoom`.
    pub fn new(gpu: &Renderer, pool_tiles: u32, min_zoom: u8, max_zoom: u8, pixels: u32) -> Result<Self, Error> {
        if pixels == 0 || pixels > gpu.max_dimension() {
            return Err(Error::Input("raster tile size"));
        }
        if pool_tiles == 0 || pool_tiles > gpu.device.limits().max_texture_array_layers {
            return Err(Error::Input("raster pool exceeds device array limits"));
        }
        let charge = Arc::new(gpu.budget.reserve(texture_bytes(pixels, pixels, 4) * pool_tiles as usize)?);
        let pool = gpu.texture(
            pixels,
            pixels,
            pool_tiles,
            wgpu::TextureFormat::Rgba8Unorm,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        );
        let pool_view = pool.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        Ok(Self {
            identity: gpu.identity.clone(),
            min_zoom,
            max_zoom,
            pixels,
            records: HashMap::new(),
            pool,
            pool_view,
            free: (0..pool_tiles).rev().collect(),
            frame: 0,
            _charge: charge,
        })
    }

    /// The published level the view draws at.
    pub fn level(&self, view: &View) -> u8 {
        (view.zoom.round().clamp(0.0, 30.0) as u8).min(self.max_zoom)
    }

    /// Tiles the view needs, nearest the centre first, one tile around.
    pub fn wanted(&self, view: &View) -> Vec<TileId> {
        if self.level(view) < self.min_zoom {
            return Vec::new();
        }
        view.tiles_at(self.level(view), 1)
    }

    /// Tile side in pixels.
    pub fn pixels(&self) -> u32 {
        self.pixels
    }

    /// Whether the layer has answered for `tile` (an image or empty).
    pub fn held(&self, tile: TileId) -> bool {
        self.records.contains_key(&tile)
    }

    /// Stores a tile: `pixels` square premultiplied RGBA, row-major, top-down.
    pub fn insert(&mut self, gpu: &Renderer, tile: TileId, rgba: &[u8]) -> Result<(), Error> {
        if !Arc::ptr_eq(&self.identity, &gpu.identity) {
            return Err(Error::Input("raster belongs to another GPU device"));
        }
        if rgba.len() != (self.pixels * self.pixels * 4) as usize {
            return Err(Error::Input("raster tile shape"));
        }
        let layer = match self.records.remove(&tile).and_then(|r| r.layer) {
            Some(layer) => layer,
            None => match self.free.pop() {
                Some(layer) => layer,
                None => self.evict()?,
            },
        };
        gpu.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.pool,
                mip_level: 0,
                origin: wgpu::Origin3d { x: 0, y: 0, z: layer },
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.pixels * 4),
                rows_per_image: Some(self.pixels),
            },
            wgpu::Extent3d { width: self.pixels, height: self.pixels, depth_or_array_layers: 1 },
        );
        self.records.insert(tile, Record { layer: Some(layer), used: self.frame });
        Ok(())
    }

    /// Records that the layer has nothing at `tile`.
    pub fn insert_empty(&mut self, tile: TileId) {
        if let Some(layer) = self.records.remove(&tile).and_then(|r| r.layer) {
            self.free.push(layer);
        }
        self.records.insert(tile, Record { layer: None, used: self.frame });
        let empty = self.records.values().filter(|r| r.layer.is_none()).count();
        if empty > MAX_EMPTY {
            let mut old: Vec<_> =
                self.records.iter().filter(|(_, r)| r.layer.is_none()).map(|(t, r)| (r.used, *t)).collect();
            old.sort_unstable();
            for (_, t) in old.into_iter().take(empty - MAX_EMPTY) {
                self.records.remove(&t);
            }
        }
    }

    /// Frees the least recently drawn resident tile.
    fn evict(&mut self) -> Result<u32, Error> {
        let victim = self
            .records
            .iter()
            .filter(|(_, r)| r.layer.is_some())
            .min_by_key(|(t, r)| (r.used, t.z, t.x, t.y))
            .map(|(t, _)| *t)
            .ok_or(Error::Input("raster pool is empty"))?;
        Ok(self.records.remove(&victim).and_then(|r| r.layer).expect("resident victim"))
    }

    /// What to draw for the view, back to front.
    fn quads(&mut self, view: &View) -> Vec<Quad> {
        self.frame += 1;
        let z = self.level(view);
        if z < self.min_zoom {
            return Vec::new();
        }
        let n = 1i64 << z;
        let b = view.bounds_at(z, 0, 0);
        let world = 256.0 * view.zoom.exp2();
        let (cx, cy) = (view.center[0] * world, view.center[1] * world);
        let side = world / n as f64;
        let rect = |x: f64, y: f64, size: f64| [x * side - cx, y * side - cy, size * side, size * side];
        let (mut back, mut middle, mut front) = (Vec::new(), Vec::new(), Vec::new());
        let frame = self.frame;
        for y in b.y0..=b.y1 {
            for x in b.x0..=b.x1 {
                let tile = TileId { z, x: x.rem_euclid(n) as u32, y: y as u32 };
                match self.records.get_mut(&tile) {
                    Some(Record { layer: Some(layer), used }) => {
                        *used = frame;
                        front.push(Quad {
                            rect: rect(x as f64, y as f64, 1.0),
                            uv: [0.0, 0.0, 1.0, 1.0],
                            layer: *layer,
                        });
                        continue;
                    }
                    Some(Record { layer: None, used }) => {
                        *used = frame;
                        continue;
                    }
                    None => {}
                }
                // Finer tiles held from a closer view.
                if z < self.max_zoom {
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let child = TileId { z: z + 1, x: tile.x * 2 + dx, y: tile.y * 2 + dy };
                        if let Some(Record { layer: Some(layer), used }) = self.records.get_mut(&child) {
                            *used = frame;
                            let (cx2, cy2) = (x as f64 + 0.5 * f64::from(dx), y as f64 + 0.5 * f64::from(dy));
                            middle.push(Quad { rect: rect(cx2, cy2, 0.5), uv: [0.0, 0.0, 1.0, 1.0], layer: *layer });
                        }
                    }
                }
                // The nearest answered ancestor, magnified.
                for up in 1..=MAX_STRETCH.min(z) {
                    let a = TileId { z: z - up, x: tile.x >> up, y: tile.y >> up };
                    let Some(record) = self.records.get_mut(&a) else { continue };
                    record.used = frame;
                    if let Some(layer) = record.layer {
                        let k = (1u32 << up) as f32;
                        let (u, v) = ((tile.x % (1 << up)) as f32 / k, (tile.y % (1 << up)) as f32 / k);
                        back.push(Quad {
                            rect: rect(x as f64, y as f64, 1.0),
                            uv: [u, v, u + 1.0 / k, v + 1.0 / k],
                            layer,
                        });
                    }
                    break;
                }
            }
        }
        back.extend(middle);
        back.extend(front);
        back
    }

    /// Records this layer's draw into `pass` (the frame's render pass of
    /// `format`).
    pub(crate) fn draw(
        &mut self,
        gpu: &Renderer,
        pass: &mut wgpu::RenderPass<'_>,
        view: &View,
        format: wgpu::TextureFormat,
        style: RasterStyle,
    ) {
        let quads = self.quads(view);
        if quads.is_empty() || style.opacity <= 0.0 {
            return;
        }
        let mut tiles = Vec::with_capacity(quads.len() * 64);
        for q in &quads {
            for v in q.rect {
                tiles.extend_from_slice(&(v as f32).to_le_bytes());
            }
            for v in q.uv {
                tiles.extend_from_slice(&v.to_le_bytes());
            }
            tiles.extend_from_slice(&q.layer.to_le_bytes());
            tiles.extend_from_slice(&[0; 28]);
        }
        let (sin, cos) = view.bearing.to_radians().sin_cos();
        let mut frame = Vec::with_capacity(32);
        for v in [view.css[0] as f32, view.css[1] as f32, cos as f32, sin as f32, style.opacity] {
            frame.extend_from_slice(&v.to_le_bytes());
        }
        frame.extend_from_slice(&u32::from(style.muted).to_le_bytes());
        frame.extend_from_slice(&[0; 8]);
        let buffer = |label, contents: &[u8], usage| {
            gpu.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents, usage })
        };
        let frame = buffer("raster frame", &frame, wgpu::BufferUsages::UNIFORM);
        let tiles = buffer("raster tiles", &tiles, wgpu::BufferUsages::STORAGE);
        let (pipeline, layout, sampler) = gpu.raster_pipeline(format);
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: frame.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: tiles.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&self.pool_view) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&sampler) },
            ],
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &group, &[]);
        pass.draw(0..6, 0..quads.len() as u32);
    }
}

/// Decoded tile pixels, premultiplied: what [`Raster::insert`] takes.
pub fn premultiply(rgba: &mut [u8]) {
    for p in rgba.chunks_exact_mut(4) {
        let a = u16::from(p[3]);
        if a < 255 {
            for c in &mut p[..3] {
                *c = ((u16::from(*c) * a + 127) / 255) as u8;
            }
        }
    }
}
