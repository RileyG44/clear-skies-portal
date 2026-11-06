//! The native terrain scene.
//!
//! Source tiles (256x256 float32 metres from the engine) live in a GPU tile
//! pool. They are composited once, when they arrive, into a world-anchored
//! store at the display tile level, under the scientific loading rules: the
//! highest-ranked valid sample wins, survey no-data reveals lower-ranked
//! terrain, a source's own coverage at a level hides its stale finer records,
//! and an authoritative source's answered coverage (even an empty answer)
//! hides its coarser magnified samples. Panning re-anchors the store by
//! copying the overlap; only newly exposed slots are composited.
//!
//! Each frame then costs two full-screen passes: a resample of the store at
//! every screen pixel (Catmull-Rom when magnifying and all taps are valid,
//! otherwise bilinear over valid taps) and the shading program generated from
//! the JS factory.

use std::collections::HashMap;
use std::sync::Arc;

use csk_core::resource::Reservation;
use wgpu::util::DeviceExt;

use crate::render::{FRAME_FORMAT, Frame, texture_bytes};
use crate::{Error, Renderer, Uniforms};

/// Source tiles and store slots are 256 texels square.
pub const TILE: u32 = 256;
/// Finer records more than this many levels below a slot are sub-texel there.
const MAX_FINER: u8 = 8;
/// Metadata-only records (answered with no data) kept for coverage.
const MAX_EMPTY: usize = 16_384;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TileId {
    pub z: u8,
    pub x: u32,
    pub y: u32,
}

/// One source's answer for one tile.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TileKey {
    pub source: u16,
    pub tile: TileId,
}

/// Per-source policy. Records of sources not registered are not drawn.
#[derive(Clone, Default)]
pub struct SourceSpec {
    /// An answer, even an empty one, is the source's truth at that level: its
    /// coarser records no longer stand in beneath it.
    pub authoritative_coverage: bool,
    /// Display tiles this source may draw into (e.g. a survey's region).
    #[allow(clippy::type_complexity)]
    pub allowed: Option<Arc<dyn Fn(TileId) -> bool + Send + Sync>>,
}

/// The map camera. Bearing is clockwise in degrees; Web Mercator in [0,1].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub center: [f64; 2],
    pub zoom: f64,
    pub bearing: f64,
    pub css: [f64; 2],
    pub dpr: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    z: u8,
    x0: i64,
    x1: i64,
    y0: i64,
    y1: i64,
}

impl Bounds {
    fn contains(&self, other: &Bounds) -> bool {
        self.z == other.z && self.x0 <= other.x0 && self.x1 >= other.x1 && self.y0 <= other.y0 && self.y1 >= other.y1
    }
}

impl View {
    /// Display tile level: one finer on high-density screens.
    pub fn level(&self) -> u8 {
        (self.zoom.round() + if self.dpr >= 1.5 { 1.0 } else { 0.0 }).clamp(0.0, 22.0) as u8
    }

    pub fn device_size(&self) -> (u32, u32) {
        let size = |css: f64| (css * self.dpr).round().max(1.0) as u32;
        (size(self.css[0]), size(self.css[1]))
    }

    fn check(&self) -> Result<(), Error> {
        let finite =
            self.center.iter().chain(&self.css).chain([&self.zoom, &self.bearing, &self.dpr]).all(|v| v.is_finite());
        if !finite
            || !(0.0..=24.0).contains(&self.zoom)
            || self.css.iter().any(|v| *v <= 0.0)
            || self.dpr <= 0.0
            || !(0.0..=1.0).contains(&self.center[1])
        {
            return Err(Error::Input("invalid view"));
        }
        Ok(())
    }

    /// Display-level tile bounds of the rotated viewport, `shift` world
    /// widths east (keeps an anchored store's numbering across ±180°).
    fn bounds(&self, margin: i64, shift: i64) -> Bounds {
        let z = self.level();
        let n = 1i64 << z;
        let scale = n as f64 / (256.0 * self.zoom.exp2());
        let a = self.bearing.to_radians();
        let (c, s) = (a.cos().abs(), a.sin().abs());
        let hx = (c * self.css[0] + s * self.css[1]) * scale / 2.0;
        let hy = (s * self.css[0] + c * self.css[1]) * scale / 2.0;
        let cx = self.center[0] * n as f64 + (shift * n) as f64;
        let cy = self.center[1] * n as f64;
        Bounds {
            z,
            x0: (cx - hx).floor() as i64 - margin,
            x1: (cx + hx).ceil() as i64 - 1 + margin,
            y0: ((cy - hy).floor() as i64 - margin).max(0),
            y1: ((cy + hy).ceil() as i64 - 1 + margin).min(n - 1),
        }
    }

    /// Tiles to request: one canonical id per world tile, one-tile margin.
    pub fn wanted(&self) -> Vec<TileId> {
        let b = self.bounds(1, 0);
        let n = 1i64 << b.z;
        let end = b.x1.min(b.x0 + n - 1);
        let mut out = Vec::new();
        for y in b.y0..=b.y1 {
            for x in b.x0..=end {
                out.push(TileId { z: b.z, x: x.rem_euclid(n) as u32, y: y as u32 });
            }
        }
        out
    }
}

struct Entry {
    rank: u8,
    layer: Option<u32>,
    all_valid: bool,
    used: u64,
    stamp: u64,
}

/// One planned draw into a store slot, in the composite program's layout.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Draw {
    origin: [f32; 2],
    scale: f32,
    rank: f32,
    rect: [u32; 4],
    layer: u32,
}

struct Store {
    bounds: Bounds,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    dirty: Vec<bool>,
    covered: Vec<bool>,
    charge: Arc<Reservation>,
}

impl Store {
    fn slot(&self, wx: i64, wy: i64) -> usize {
        ((wy - self.bounds.y0) * (self.bounds.x1 - self.bounds.x0 + 1) + (wx - self.bounds.x0)) as usize
    }
}

struct ScreenField {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    size: (u32, u32),
    charge: Arc<Reservation>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameStats {
    /// Share of visible display tiles with any resident terrain. Pixel
    /// coverage (no-data holes) is a separate, sampled measurement.
    pub coverage: f64,
    /// Store slots composited this frame.
    pub composited: usize,
}

pub struct Terrain {
    identity: Arc<()>,
    sources: HashMap<u16, SourceSpec>,
    records: HashMap<TileKey, Entry>,
    pool: wgpu::Texture,
    pool_view: wgpu::TextureView,
    free: Vec<u32>,
    _pool_charge: Arc<Reservation>,
    store: Option<Store>,
    field: Option<ScreenField>,
    frame: u64,
    stamp: u64,
}

/// Whether a record's footprint overlaps display tile (z, x, y).
fn overlaps(tile: TileId, z: u8, x: u32, y: u32) -> bool {
    if tile.z <= z {
        let d = z - tile.z;
        x >> d == tile.x && y >> d == tile.y
    } else {
        let d = tile.z - z;
        tile.x >> d == x && tile.y >> d == y
    }
}

impl Terrain {
    /// A scene whose pool holds `pool_tiles` source tiles (256 KiB each),
    /// charged to the budget up front.
    pub fn new(gpu: &Renderer, pool_tiles: u32) -> Result<Self, Error> {
        let limit = gpu.device.limits().max_texture_array_layers;
        if pool_tiles == 0 || pool_tiles > limit {
            return Err(Error::Input("tile pool exceeds device array limits"));
        }
        let charge = Arc::new(gpu.budget.reserve(texture_bytes(TILE, TILE, 4) * pool_tiles as usize)?);
        let pool = gpu.texture(
            TILE,
            TILE,
            pool_tiles,
            wgpu::TextureFormat::R32Float,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        );
        let pool_view = pool.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        Ok(Self {
            identity: gpu.identity.clone(),
            sources: HashMap::new(),
            records: HashMap::new(),
            pool,
            pool_view,
            free: (0..pool_tiles).rev().collect(),
            _pool_charge: charge,
            store: None,
            field: None,
            frame: 0,
            stamp: 0,
        })
    }

    fn check(&self, gpu: &Renderer) -> Result<(), Error> {
        if Arc::ptr_eq(&self.identity, &gpu.identity) {
            Ok(())
        } else {
            Err(Error::Input("terrain belongs to another GPU device"))
        }
    }

    /// Replaces the active sources. Every slot recomposites.
    pub fn set_sources(&mut self, sources: HashMap<u16, SourceSpec>) {
        self.sources = sources;
        if let Some(store) = &mut self.store {
            store.dirty.fill(true);
        }
    }

    pub fn resident_tiles(&self) -> usize {
        self.records.values().filter(|e| e.layer.is_some()).count()
    }

    fn touch(&mut self, tile: TileId) {
        let Some(store) = &mut self.store else { return };
        let b = store.bounds;
        let n = 1i64 << b.z;
        for wy in b.y0..=b.y1 {
            for wx in b.x0..=b.x1 {
                if overlaps(tile, b.z, wx.rem_euclid(n) as u32, wy as u32) {
                    let i = store.slot(wx, wy);
                    store.dirty[i] = true;
                }
            }
        }
    }

    /// Stores one source's answer for a tile: 256x256 row-major top-down
    /// metres; non-finite or <= -1e20 is no data. An all-empty answer is kept
    /// as coverage metadata only.
    pub fn insert(&mut self, gpu: &Renderer, key: TileKey, rank: u8, heights: &[f32]) -> Result<(), Error> {
        self.check(gpu)?;
        if heights.len() != (TILE * TILE) as usize {
            return Err(Error::Input("source tile must be 256x256"));
        }
        if key.tile.z > 24 || key.tile.x >= 1 << key.tile.z || key.tile.y >= 1 << key.tile.z {
            return Err(Error::Input("tile outside the world"));
        }
        let valid = |v: &f32| v.is_finite() && *v > -1e20;
        let count = heights.iter().filter(|v| valid(v)).count();
        let previous = self.records.remove(&key).and_then(|e| e.layer);
        let layer = if count == 0 {
            if let Some(layer) = previous {
                self.free.push(layer);
            }
            None
        } else {
            let layer = match previous.or_else(|| self.free.pop()) {
                Some(layer) => layer,
                None => self.evict()?,
            };
            let bytes: Vec<u8> = heights.iter().flat_map(|v| v.to_le_bytes()).collect();
            gpu.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.pool,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: 0, y: 0, z: layer },
                    aspect: wgpu::TextureAspect::All,
                },
                &bytes,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(TILE * 4), rows_per_image: Some(TILE) },
                wgpu::Extent3d { width: TILE, height: TILE, depth_or_array_layers: 1 },
            );
            Some(layer)
        };
        self.stamp += 1;
        self.records
            .insert(key, Entry { rank, layer, all_valid: count == heights.len(), used: self.frame, stamp: self.stamp });
        if layer.is_none() && self.records.len() > MAX_EMPTY {
            self.trim_empty();
        }
        self.touch(key.tile);
        Ok(())
    }

    pub fn remove(&mut self, key: TileKey) {
        if let Some(entry) = self.records.remove(&key) {
            if let Some(layer) = entry.layer {
                self.free.push(layer);
            }
            self.touch(key.tile);
        }
    }

    /// Frees the least recently drawn resident tile. The record goes
    /// entirely: keeping it as metadata would claim an empty answer.
    fn evict(&mut self) -> Result<u32, Error> {
        let victim = self
            .records
            .iter()
            .filter(|(_, e)| e.layer.is_some())
            .min_by_key(|(_, e)| (e.used, e.stamp))
            .map(|(k, _)| *k)
            .ok_or(Error::Input("tile pool is empty"))?;
        let entry = self.records.remove(&victim).expect("victim");
        self.touch(victim.tile);
        Ok(entry.layer.expect("resident victim"))
    }

    fn trim_empty(&mut self) {
        let mut empty: Vec<_> =
            self.records.iter().filter(|(_, e)| e.layer.is_none()).map(|(k, e)| (e.used, e.stamp, *k)).collect();
        empty.sort_unstable();
        let excess = self.records.len().saturating_sub(MAX_EMPTY);
        for (_, _, key) in empty.into_iter().take(excess) {
            self.records.remove(&key);
            self.touch(key.tile);
        }
    }

    /// Draws for one store slot, lowest priority first (rank, then level).
    fn plan(&self, order: &[(TileKey, &Entry)], z: u8, x: u32, y: u32) -> Vec<(TileKey, Draw)> {
        let tile = TileId { z, x, y };
        // The finest level at which each authoritative source has answered.
        let mut answered: HashMap<u16, u8> = HashMap::new();
        for (key, _) in order {
            let spec = &self.sources[&key.source];
            if spec.authoritative_coverage && key.tile.z <= z && overlaps(key.tile, z, x, y) {
                let level = answered.entry(key.source).or_insert(key.tile.z);
                *level = (*level).max(key.tile.z);
            }
        }
        let mut complete: Vec<u16> = Vec::new();
        let mut out = Vec::new();
        for (key, entry) in order {
            let Some(layer) = entry.layer else { continue };
            let r = key.tile;
            if !overlaps(r, z, x, y) || (r.z > z && r.z - z > MAX_FINER) {
                continue;
            }
            let spec = &self.sources[&key.source];
            if spec.allowed.as_ref().is_some_and(|allowed| !allowed(tile)) {
                continue;
            }
            // Sparse survey coverage is authoritative at its finest answered
            // level; its no-data reveals lower-ranked terrain rather than a
            // magnified sample from a much wider view.
            if answered.get(&key.source).is_some_and(|level| r.z < *level) {
                continue;
            }
            // A source's own complete coverage hides its stale finer records.
            if r.z > z && complete.contains(&key.source) {
                continue;
            }
            let (rect, full) = if r.z <= z {
                ([0, 0, TILE, TILE], true)
            } else {
                let f = 1u32 << (r.z - z);
                let side = TILE / f;
                let (ox, oy) = ((r.x % f) * side, (r.y % f) * side);
                ([ox, oy, ox + side, oy + side], false)
            };
            // A complete record covering the slot hides every earlier draw.
            if entry.all_valid && full {
                out.clear();
                complete.push(key.source);
            }
            // Native texel of slot texel (0,0) and native texels per store
            // texel, from the record's and the slot's Mercator extents.
            let scale = (f64::from(r.z) - f64::from(z)).exp2();
            let origin = |slot: u32, record: u32| {
                ((f64::from(slot) * scale - f64::from(record)) * f64::from(TILE) + 0.5 * scale - 0.5) as f32
            };
            out.push((
                *key,
                Draw {
                    origin: [origin(x, r.x), origin(y, r.y)],
                    scale: scale as f32,
                    rank: f32::from(entry.rank),
                    rect,
                    layer,
                },
            ));
        }
        out
    }

    /// Anchors the store over the view, re-using the overlap of the previous
    /// store at the same level. Returns the world shift used for the view.
    fn anchor(&mut self, gpu: &Renderer, view: &View, encoder: &mut wgpu::CommandEncoder) -> Result<i64, Error> {
        let z = view.level();
        let n = 1i64 << z;
        // Keep the old numbering when the camera wraps across ±180°.
        let shift = match &self.store {
            Some(s) if s.bounds.z == z => {
                let mid = (s.bounds.x0 + s.bounds.x1 + 1) as f64 / 2.0;
                ((mid - view.center[0] * n as f64) / n as f64).round() as i64
            }
            _ => 0,
        };
        let visible = view.bounds(0, shift);
        if self.store.as_ref().is_some_and(|s| s.bounds.contains(&visible)) {
            return Ok(shift);
        }
        let bounds = view.bounds(1, shift);
        let (tw, th) = ((bounds.x1 - bounds.x0 + 1) as u32, (bounds.y1 - bounds.y0 + 1) as u32);
        let (w, h) = (tw * TILE, th * TILE);
        if w > gpu.max_dimension() || h > gpu.max_dimension() {
            return Err(Error::Input("view exceeds the terrain store limits"));
        }
        let charge = Arc::new(gpu.budget.reserve(texture_bytes(w, h, 8))?);
        let texture = gpu.texture(
            w,
            h,
            1,
            wgpu::TextureFormat::Rg32Float,
            wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
        );
        let slots = (tw * th) as usize;
        let mut store = Store {
            bounds,
            view: texture.create_view(&Default::default()),
            texture,
            dirty: vec![true; slots],
            covered: vec![false; slots],
            charge,
        };
        if let Some(old) = self.store.take() {
            if old.bounds.z == z {
                let (x0, x1) = (bounds.x0.max(old.bounds.x0), bounds.x1.min(old.bounds.x1));
                let (y0, y1) = (bounds.y0.max(old.bounds.y0), bounds.y1.min(old.bounds.y1));
                if x0 <= x1 && y0 <= y1 {
                    encoder.copy_texture_to_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &old.texture,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: ((x0 - old.bounds.x0) as u32) * TILE,
                                y: ((y0 - old.bounds.y0) as u32) * TILE,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyTextureInfo {
                            texture: &store.texture,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: ((x0 - bounds.x0) as u32) * TILE,
                                y: ((y0 - bounds.y0) as u32) * TILE,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::Extent3d {
                            width: ((x1 - x0 + 1) as u32) * TILE,
                            height: ((y1 - y0 + 1) as u32) * TILE,
                            depth_or_array_layers: 1,
                        },
                    );
                    for wy in y0..=y1 {
                        for wx in x0..=x1 {
                            let (i, j) = (store.slot(wx, wy), old.slot(wx, wy));
                            store.dirty[i] = old.dirty[j];
                            store.covered[i] = old.covered[j];
                        }
                    }
                }
            }
            gpu.retain_until_done(old.charge);
        }
        self.store = Some(store);
        Ok(shift)
    }

    /// Composites every dirty slot. Returns the number composited.
    fn composite(&mut self, gpu: &Renderer, encoder: &mut wgpu::CommandEncoder) -> usize {
        let Some(store) = &self.store else { return 0 };
        let b = store.bounds;
        let n = 1i64 << b.z;
        let mut order: Vec<(TileKey, &Entry)> =
            self.records.iter().filter(|(k, _)| self.sources.contains_key(&k.source)).map(|(k, e)| (*k, e)).collect();
        order.sort_unstable_by_key(|(k, e)| (e.rank, k.tile.z, k.source, k.tile.x, k.tile.y));
        let mut jobs: Vec<u8> = Vec::new();
        let mut draws: Vec<u8> = Vec::new();
        let mut done = Vec::new();
        let mut used = Vec::new();
        let mut count = 0u32;
        for wy in b.y0..=b.y1 {
            for wx in b.x0..=b.x1 {
                let i = store.slot(wx, wy);
                if !store.dirty[i] {
                    continue;
                }
                let plan = self.plan(&order, b.z, wx.rem_euclid(n) as u32, wy as u32);
                let first = count;
                for (key, d) in &plan {
                    used.push(*key);
                    for v in [d.origin[0], d.origin[1], d.scale, d.rank] {
                        draws.extend_from_slice(&v.to_le_bytes());
                    }
                    for v in d.rect.into_iter().chain([d.layer, 0, 0, 0]) {
                        draws.extend_from_slice(&v.to_le_bytes());
                    }
                    count += 1;
                }
                let origin = [((wx - b.x0) as u32) * TILE, ((wy - b.y0) as u32) * TILE];
                for v in [origin[0], origin[1], first, plan.len() as u32] {
                    jobs.extend_from_slice(&v.to_le_bytes());
                }
                done.push((i, !plan.is_empty()));
            }
        }
        if done.is_empty() {
            return 0;
        }
        if draws.is_empty() {
            draws.resize(48, 0);
        }
        let storage = |label, contents: &[u8]| {
            gpu.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage: wgpu::BufferUsages::STORAGE,
            })
        };
        let (jobs_buffer, draws_buffer) = (storage("composite jobs", &jobs), storage("composite draws", &draws));
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &gpu.composite.1,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&self.pool_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&store.view) },
                wgpu::BindGroupEntry { binding: 2, resource: jobs_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: draws_buffer.as_entire_binding() },
            ],
        });
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&gpu.composite.0);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(TILE / 16, TILE / 16, done.len() as u32);
        }
        let frame = self.frame;
        for key in used {
            if let Some(e) = self.records.get_mut(&key) {
                e.used = frame;
            }
        }
        let store = self.store.as_mut().expect("store");
        for (i, covered) in &done {
            store.dirty[*i] = false;
            store.covered[*i] = *covered;
        }
        done.len()
    }

    /// Renders the view into `target` (e.g. a presentation surface texture of
    /// `format`, sized to the view's device pixels).
    pub fn render(
        &mut self,
        gpu: &Renderer,
        view: &View,
        uniforms: &Uniforms,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
    ) -> Result<FrameStats, Error> {
        self.check(gpu)?;
        view.check()?;
        gpu.poll()?;
        self.frame += 1;
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        let shift = self.anchor(gpu, view, &mut encoder)?;
        let composited = self.composite(gpu, &mut encoder);
        let (w, h) = view.device_size();
        if w > gpu.max_dimension() || h > gpu.max_dimension() {
            return Err(Error::Input("viewport exceeds device limits"));
        }
        if self.field.as_ref().is_none_or(|f| f.size != (w, h)) {
            let charge = Arc::new(gpu.budget.reserve(texture_bytes(w, h, 4))?);
            let texture = gpu.texture(
                w,
                h,
                1,
                wgpu::TextureFormat::R32Float,
                wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC,
            );
            if let Some(old) = self.field.take() {
                gpu.retain_until_done(old.charge);
            }
            self.field =
                Some(ScreenField { view: texture.create_view(&Default::default()), texture, size: (w, h), charge });
        }
        let store = self.store.as_ref().expect("anchored");
        let field = self.field.as_ref().expect("field");
        // Screen pixel -> store texel (centres at integers), in f64 relative
        // to the store origin. Matches the shading program's camera model.
        let z = store.bounds.z;
        let k = (f64::from(z) - view.zoom).exp2();
        let (sin, cos) = view.bearing.to_radians().sin_cos();
        let (sx, sy) = (view.css[0] / f64::from(w), view.css[1] / f64::from(h));
        let rotate = |a: f64, b: f64| (a * cos + b * sin, -a * sin + b * cos);
        let n = (1u64 << z) as f64;
        let base_x = ((view.center[0] + shift as f64) * n - store.bounds.x0 as f64) * f64::from(TILE) - 0.5;
        let base_y = (view.center[1] * n - store.bounds.y0 as f64) * f64::from(TILE) - 0.5;
        let (ox, oy) = rotate((0.5 * sx - 0.5 * view.css[0]) * k, (0.5 * sy - 0.5 * view.css[1]) * k);
        let axis_x = rotate(k * sx, 0.0);
        let axis_y = rotate(0.0, k * sy);
        let magnify = axis_x.0.hypot(axis_x.1) < 1.0;
        let mut params = Vec::with_capacity(32);
        for v in [base_x + ox, base_y + oy, axis_x.0, axis_x.1, axis_y.0, axis_y.1] {
            params.extend_from_slice(&(v as f32).to_le_bytes());
        }
        params.extend_from_slice(&u32::from(magnify).to_le_bytes());
        params.extend_from_slice(&0u32.to_le_bytes());
        let params = gpu.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("resample"),
            contents: &params,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &gpu.resample.1,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&store.view) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&field.view) },
            ],
        });
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&gpu.resample.0);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(w.div_ceil(16), h.div_ceil(16), 1);
        }
        let mut uniforms = uniforms.clone();
        uniforms.set("u_cssSize", &[view.css[0] as f32, view.css[1] as f32])?;
        uniforms.set("u_dpr", &[view.dpr as f32])?;
        uniforms.set("u_zoom", &[view.zoom as f32])?;
        uniforms.set("u_centerMerc", &[view.center[0] as f32, view.center[1] as f32])?;
        uniforms.set("u_bearingRad", &[view.bearing.to_radians() as f32])?;
        gpu.encode_shade(&mut encoder, &field.view, &uniforms, target, format);
        gpu.queue.submit([encoder.finish()]);
        gpu.retain_until_done((store.charge.clone(), field.charge.clone()));
        let visible = view.bounds(0, shift);
        let (mut total, mut covered) = (0usize, 0usize);
        for wy in visible.y0..=visible.y1 {
            for wx in visible.x0..=visible.x1 {
                total += 1;
                covered += usize::from(store.covered[store.slot(wx, wy)]);
            }
        }
        Ok(FrameStats { coverage: if total == 0 { 0.0 } else { covered as f64 / total as f64 }, composited })
    }

    /// Renders the view into an offscreen premultiplied RGBA frame.
    pub fn render_offscreen(
        &mut self,
        gpu: &Renderer,
        view: &View,
        uniforms: &Uniforms,
    ) -> Result<(Frame, FrameStats), Error> {
        let (w, h) = view.device_size();
        let frame = gpu.frame(w, h, uniforms.bytes().len())?;
        let stats = self.render(gpu, view, uniforms, &Renderer::frame_view(&frame), FRAME_FORMAT)?;
        gpu.retain_until_done(Renderer::frame_charge(&frame));
        Ok((frame, stats))
    }

    /// The last frame's screen field (float32 metres, top-down; invalid
    /// samples are <= -1e20). For QA, provenance sampling and exports.
    pub fn read_field(&self, gpu: &Renderer) -> Result<Vec<f32>, Error> {
        self.check(gpu)?;
        let field = self.field.as_ref().ok_or(Error::Input("no frame rendered"))?;
        let pixels = gpu.read(&field.texture, field.size.0, field.size.1, 4, field.charge.clone())?;
        Ok(pixels.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().expect("4 bytes"))).collect())
    }
}

/// Planning is pure; tested without a device in `tests/terrain.rs` through
/// rendered fields, and here for the priority rules alone.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlap_is_symmetric_across_levels() {
        let parent = TileId { z: 10, x: 5, y: 7 };
        assert!(overlaps(parent, 12, 5 * 4 + 3, 7 * 4));
        assert!(!overlaps(parent, 12, 5 * 4 + 4, 7 * 4));
        let child = TileId { z: 13, x: 5 * 8 + 7, y: 7 * 8 };
        assert!(overlaps(child, 10, 5, 7));
        assert!(!overlaps(child, 10, 6, 7));
    }

    #[test]
    fn bounds_cover_the_rotated_view() {
        let view = View { center: [0.5, 0.5], zoom: 10.0, bearing: 0.0, css: [512.0, 256.0], dpr: 1.0 };
        let b = view.bounds(0, 0);
        assert_eq!((b.z, b.x0, b.x1, b.y0, b.y1), (10, 511, 512, 511, 512));
        let turned = View { bearing: 90.0, ..view };
        let t = turned.bounds(0, 0);
        assert!(t.x1 - t.x0 <= b.x1 - b.x0 && t.y1 - t.y0 >= b.y1 - b.y0);
    }
}
