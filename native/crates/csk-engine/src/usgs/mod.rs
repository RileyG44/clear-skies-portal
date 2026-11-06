//! USGS 3DEP 1 m DEMs from the public S3 archive: the catalogue, COG
//! access, and sampling onto map tiles with truthful provenance.

pub mod catalog;
pub mod cog;

use std::collections::BTreeSet;
use std::sync::{Arc, OnceLock};

use csk_core::codec::Tiff;
use csk_core::raster::sample::{self, BlockRaster, TileSpec};
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};

pub use catalog::{Catalog, Cell};
pub use cog::{CogReader, ReadError};

use crate::upstream::S3_HOST;

/// A file that holds a cell, ranked for sampling.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Candidate {
    pub project: String,
    pub cell: String,
    pub zone: i32,
    pub file: String,
    pub size: u64,
    pub year: i32,
}

impl Candidate {
    pub fn key(&self) -> String {
        format!("{}{}/TIFF/{}", catalog::S3_BASE, self.project, self.file)
    }
}

/// The Elwha River OPR survey (CR-014): verified numeric rasters only,
/// bounded by their real header extents, used only to fill holes after
/// every standard candidate.
#[derive(Debug, Clone, Deserialize)]
pub struct Opr {
    pub survey: String,
    pub product: String,
    #[serde(rename = "horizontalDatum")]
    pub horizontal_datum: String,
    #[serde(rename = "verticalDatum")]
    pub vertical_datum: String,
    #[serde(rename = "verticalUnits")]
    pub vertical_units: String,
    pub acquisition: serde_json::Value,
    #[serde(rename = "projectionLimitation")]
    pub projection_limitation: String,
    #[serde(rename = "metadataURL")]
    pub metadata_url: String,
    #[serde(rename = "standardProductLimitation")]
    pub standard_product_limitation: String,
    pub files: Vec<OprFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OprFile {
    pub key: String,
    pub size: u64,
    /// West, south, east, north in EPSG:26910 metres.
    pub bounds: [f64; 4],
    pub width: u32,
    pub height: u32,
}

pub fn elwha() -> &'static Opr {
    static OPR: OnceLock<Opr> = OnceLock::new();
    OPR.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../../usgs-elwha-opr.json")).expect("bundled usgs-elwha-opr.json")
    })
}

fn validate_opr_header(f: &OprFile, t: &Tiff) -> bool {
    let (g, l, b) = (&t.geo, &t.levels[0], f.bounds);
    g.epsg == Some(26910)
        && g.pixel_scale.first() == Some(&1.0)
        && g.pixel_scale.get(1) == Some(&1.0)
        && g.tiepoint.len() >= 5
        && g.tiepoint[0] == 0.0
        && g.tiepoint[1] == 0.0
        && g.tiepoint[3] == b[0]
        && g.tiepoint[4] == b[3]
        && l.width == f.width
        && l.height == f.height
        && b[2] == b[0] + f64::from(l.width)
        && b[1] == b[3] - f64::from(l.height)
        && l.samples_per_pixel == 1
        && l.sample_format == 3
        && l.bits_per_sample == 32
}

/// Where a sampled tile's pixels came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceInfo {
    pub project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell: Option<String>,
    pub key: String,
    pub level: usize,
    pub res: f64,
    #[serde(rename = "nativeMeters")]
    pub native_meters: f64,
    #[serde(rename = "cogTiles")]
    pub cog_tiles: usize,
    /// OPR provenance (product, datums, acquisition, limitations).
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub opr: Option<serde_json::Map<String, serde_json::Value>>,
}

/// A tile sampled from 1 m sources: `n × n` with a one-pixel skirt.
#[derive(Debug, Clone, PartialEq)]
pub struct Sampled {
    pub grid: Vec<f32>,
    pub n: usize,
    pub ground_res: f64,
    pub coverage: f64,
    pub sources: Vec<SourceInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SampleError {
    #[error("1 m catalogue unavailable: {0}")]
    Catalog(String),
    /// A failed read is not missing coverage: the tile must not be cached.
    #[error("1 m source read failed ({0})")]
    Read(usize),
}

/// The answer for one tile.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Tile(Sampled),
    /// No 1 m coverage, and the catalogue is complete enough to say so.
    None,
    /// Coverage unknown: the catalogue is incomplete. Never cached.
    Provisional,
}

#[derive(Debug, Clone, Copy)]
struct Plan {
    max_sources: usize,
    include_opr: bool,
}

pub struct Usgs {
    pub catalog: Arc<Catalog>,
    pub cog: Arc<CogReader>,
}

impl Usgs {
    pub fn new(catalog: Arc<Catalog>, cog: Arc<CogReader>) -> Self {
        Self { catalog, cog }
    }

    pub fn s3_origin() -> String {
        format!("https://{S3_HOST}")
    }

    /// Files holding this cell in this zone, newest first. A zoneless file
    /// has its zone read from its header once and remembered.
    pub async fn candidates(&self, cell: Cell, zone: i32) -> Result<Vec<Candidate>, SampleError> {
        let files = self.catalog.files_at(cell, zone).map_err(|e| SampleError::Catalog(e.to_string()))?;
        let mut out = Vec::new();
        for f in files {
            let z = match f.zone {
                Some(z) => z,
                None => {
                    let known = match self.catalog.cached_zone(&f.project, cell) {
                        Some(z) => z,
                        None => {
                            let key = format!("{}{}/TIFF/{}", catalog::S3_BASE, f.project, f.file);
                            let z = self.cog.header(&key, f.size).await.ok().and_then(|t| zone_of_epsg(t.geo.epsg));
                            self.catalog.remember_zone(&f.project, cell, z);
                            z
                        }
                    };
                    match known {
                        Some(z) if z != zone => continue, // same cell name, another zone
                        Some(z) => z,
                        // Unreadable header: left in; sampling's EPSG check is the backstop.
                        None => zone,
                    }
                }
            };
            out.push(Candidate {
                year: catalog::project_year(&f.project),
                project: f.project,
                cell: cell.name(),
                zone: z,
                file: f.file,
                size: f.size,
            });
        }
        out.sort_by(|a, b| b.year.cmp(&a.year).then(b.size.cmp(&a.size)));
        Ok(out)
    }

    /// Projects holding the cell under a point, newest first.
    pub async fn find_cells(&self, lon: f64, lat: f64) -> Result<(i32, f64, f64, Cell, Vec<Candidate>), SampleError> {
        self.catalog.ensure().await.map_err(|e| SampleError::Catalog(e.to_string()))?;
        let zone = csk_core::geo::utm_zone(lon);
        let (e, n) = csk_core::geo::lon_lat_to_utm(lon, lat, zone);
        let cell = Cell::of(e, n);
        let hits = self.candidates(cell, zone).await?;
        Ok((zone, e, n, cell, hits))
    }

    /// Samples the tile from 1 m data, trying the best source first and
    /// widening only where it leaves holes. A newer project can have holes an
    /// older one covers, so an incomplete tile is resampled from up to three
    /// per cell, and the Elwha OPR survey fills what is left.
    pub async fn elevation(&self, spec: &TileSpec) -> Result<Outcome, SampleError> {
        self.catalog.ensure().await.map_err(|e| SampleError::Catalog(e.to_string()))?;
        let first = self.sample(spec, Plan { max_sources: 1, include_opr: false }).await?;
        let mut best = first;
        if best.as_ref().is_none_or(|s| s.coverage < 1.0) {
            let wider = self.sample(spec, Plan { max_sources: 3, include_opr: false }).await?;
            if better(&wider, &best) {
                best = wider;
            }
        }
        if best.as_ref().is_none_or(|s| s.coverage < 1.0) {
            let opr = self.sample(spec, Plan { max_sources: 3, include_opr: true }).await?;
            if better(&opr, &best) {
                best = opr;
            }
        }
        let complete = self.catalog.complete();
        Ok(match best {
            None if complete => Outcome::None,
            None => Outcome::Provisional,
            // Partial coverage under an incomplete catalogue may be missing a project.
            Some(s) if s.coverage < 1.0 && !complete => Outcome::Provisional,
            Some(s) => Outcome::Tile(s),
        })
    }

    async fn sample(&self, spec: &TileSpec, plan: Plan) -> Result<Option<Sampled>, SampleError> {
        let _scratch = self.cog.reserve_scratch(spec.n() * spec.n() * 24).map_err(|_| SampleError::Read(1))?;
        let foot = spec.utm_footprint();
        let zone = spec.zone;
        let ground = spec.ground_res;
        let (c0, c1) = (Cell::of(foot.min_e, foot.min_n), Cell::of(foot.max_e, foot.max_n));
        let mut cells = BTreeSet::new();
        for cx in c0.cx..=c1.cx {
            for cy in c0.cy..=c1.cy {
                cells.insert((cx, cy));
            }
        }
        let mut groups = Vec::new();
        for (cx, cy) in cells {
            let c = self.candidates(Cell { cx, cy }, zone).await?;
            if !c.is_empty() {
                groups.push(c);
            }
        }
        let opr_files: Vec<&OprFile> = if plan.include_opr && zone == 10 {
            elwha()
                .files
                .iter()
                .filter(|f| {
                    f.bounds[0] < foot.max_e
                        && f.bounds[2] > foot.min_e
                        && f.bounds[1] < foot.max_n
                        && f.bounds[3] > foot.min_n
                })
                .collect()
        } else {
            Vec::new()
        };
        if groups.is_empty() && opr_files.is_empty() {
            return Ok(None);
        }

        struct Opened {
            key: String,
            tiff: Arc<Tiff>,
            level: usize,
            res: f64,
            project: String,
            cell: Option<String>,
            opr: bool,
        }
        let mut failed = 0usize;
        let mut opened: Vec<Opened> = Vec::new();
        for group in &groups {
            // Probe headers together: one round trip instead of one per candidate.
            let probes = join_all(group.iter().take(8).map(|c| async move {
                let key = c.key();
                let r = self.cog.header(&key, c.size).await;
                (c, key, r)
            }))
            .await;
            let mut available = Vec::new();
            for (c, key, r) in probes {
                let Ok(t) = r else {
                    failed += 1;
                    continue;
                };
                // Reject another projection outright.
                if let Some(epsg) = t.geo.epsg
                    && epsg != 26900 + zone as u32
                    && epsg != 32600 + zone as u32
                {
                    continue;
                }
                let base = t.geo.pixel_scale.first().copied().filter(|v| *v > 0.0).unwrap_or(1.0);
                available.push((c, key, t, base));
            }
            // Quality first: a newer 2 m DEM must not replace older 1 m lidar.
            available.sort_by(|a, b| a.3.total_cmp(&b.3).then(b.0.year.cmp(&a.0.year)).then(b.0.size.cmp(&a.0.size)));
            for (c, key, t, base) in available.into_iter().take(plan.max_sources) {
                let level = finest_level(&t, base, ground);
                opened.push(Opened {
                    key,
                    res: level_res(&t, base, level),
                    level,
                    tiff: t,
                    project: c.project.clone(),
                    cell: Some(c.cell.clone()),
                    opr: false,
                });
            }
        }
        for f in opr_files {
            match self.cog.header(&f.key, f.size).await {
                Ok(t) if validate_opr_header(f, &t) => {
                    let level = finest_level(&t, 1.0, ground);
                    opened.push(Opened {
                        key: f.key.clone(),
                        res: level_res(&t, 1.0, level),
                        level,
                        tiff: t,
                        project: elwha().survey.clone(),
                        cell: None,
                        opr: true,
                    });
                }
                _ => failed += 1,
            }
        }
        if opened.is_empty() {
            return if failed > 0 { Err(SampleError::Read(failed)) } else { Ok(None) };
        }

        // Every block the footprint touches, from every source, at once.
        let pointer_bytes: usize = opened
            .iter()
            .map(|o| {
                let l = &o.tiff.levels[o.level];
                l.blocks_across() as usize
                    * l.blocks_down() as usize
                    * std::mem::size_of::<Option<Arc<csk_core::resource::Samples>>>()
            })
            .sum();
        let _pointers = self.cog.reserve_scratch(pointer_bytes).map_err(|_| SampleError::Read(1))?;
        let mut rasters: Vec<BlockRaster> = opened
            .iter()
            .map(|o| {
                let l = &o.tiff.levels[o.level];
                BlockRaster {
                    width: l.width,
                    height: l.height,
                    block_width: l.block_width,
                    block_height: l.block_height,
                    blocks: vec![None; (l.blocks_across() * l.blocks_down()) as usize],
                    origin_x: o.tiff.geo.tiepoint.get(3).copied().unwrap_or(0.0),
                    origin_y: o.tiff.geo.tiepoint.get(4).copied().unwrap_or(0.0),
                    res: o.res,
                    nodata: o.tiff.geo.nodata,
                }
            })
            .collect();
        let wanted: Vec<(usize, u32, u32)> = rasters
            .iter()
            .enumerate()
            .flat_map(|(i, r)| sample::blocks_for(r, &foot).into_iter().map(move |(tx, ty)| (i, tx, ty)))
            .collect();
        let fetched = join_all(wanted.iter().map(|&(i, tx, ty)| {
            let o = &opened[i];
            async move { (i, tx, ty, self.cog.block(&o.key, &o.tiff, o.level, tx, ty).await) }
        }))
        .await;
        let mut cog_tiles = vec![0usize; opened.len()];
        for (i, tx, ty, r) in fetched {
            match r {
                Ok(Some(b)) => {
                    let cols = rasters[i].width.div_ceil(rasters[i].block_width);
                    rasters[i].blocks[(ty * cols + tx) as usize] = Some(b);
                    cog_tiles[i] += 1;
                }
                Ok(None) => {}
                Err(_) => failed += 1,
            }
        }
        if failed > 0 {
            return Err(SampleError::Read(failed));
        }

        let spec2 = *spec;
        let filled = tokio::task::spawn_blocking(move || {
            let (_scratch, _pointers) = (_scratch, _pointers);
            let (e, n) = spec2.utm_grid();
            let refs: Vec<&BlockRaster> = rasters.iter().collect();
            sample::fill(&e, &n, &refs)
        })
        .await
        .map_err(|_| SampleError::Read(1))?;
        if filled.filled == 0 {
            return Ok(None);
        }
        let n = spec.n();
        let opr_meta = opr_provenance();
        let sources = opened
            .iter()
            .zip(&filled.contributed)
            .zip(&cog_tiles)
            .filter(|((_, c), _)| **c > 0)
            .map(|((o, _), tiles)| SourceInfo {
                project: o.project.clone(),
                cell: o.cell.clone(),
                key: o.key.clone(),
                level: o.level,
                res: (o.res * 100.0).round() / 100.0,
                native_meters: o.tiff.geo.pixel_scale.first().copied().unwrap_or(1.0),
                cog_tiles: *tiles,
                opr: o.opr.then(|| opr_meta.clone()),
            })
            .collect();
        Ok(Some(Sampled {
            grid: filled.grid,
            n,
            ground_res: ground,
            coverage: filled.filled as f64 / (n * n) as f64,
            sources,
        }))
    }
}

impl Usgs {
    /// Nearest-neighbour samples of 1 m data on an `n × n` UTM grid from
    /// (`min_e`, `min_n`) at `res` metres, rows northward: the newest
    /// compatible survey per 10 km cell fills first. `None` with no coverage.
    pub async fn sample_utm(
        &self,
        min_e: f64,
        min_n: f64,
        res: f64,
        n: usize,
        zone: i32,
    ) -> Result<Option<(Vec<f64>, Vec<String>)>, SampleError> {
        let _scratch = self.cog.reserve_scratch(n * n * 16).map_err(|_| SampleError::Read(1))?;
        self.catalog.ensure().await.map_err(|e| SampleError::Catalog(e.to_string()))?;
        let step = (n / 10).max(1);
        let mut cells = Vec::new();
        for a in (0..=n).step_by(step) {
            for b in (0..=n).step_by(step) {
                let c = Cell::of(min_e + a as f64 * res, min_n + b as f64 * res);
                if !cells.contains(&c) {
                    cells.push(c);
                }
            }
        }
        struct Src {
            key: String,
            tiff: Arc<Tiff>,
            level: usize,
            res: f64,
            project: String,
        }
        let mut opened: Vec<Src> = Vec::new();
        for cell in cells {
            let cands = self.candidates(cell, zone).await.unwrap_or_default();
            for c in cands.iter().take(3) {
                let key = c.key();
                if opened.iter().any(|o| o.key == key) {
                    break;
                }
                let Ok(t) = self.cog.header(&key, c.size).await else { continue };
                if let Some(epsg) = t.geo.epsg
                    && epsg != 26900 + zone as u32
                    && epsg != 32600 + zone as u32
                {
                    continue;
                }
                let base = t.geo.pixel_scale.first().copied().filter(|v| *v > 0.0).unwrap_or(1.0);
                let level = finest_level(&t, base, res);
                opened.push(Src { res: level_res(&t, base, level), key, tiff: t, level, project: c.project.clone() });
                break;
            }
        }
        if opened.is_empty() {
            return Ok(None);
        }
        let js_round = |v: f64| (v + 0.5).floor();
        let pixel = |o: &Src, i: usize, j: usize| {
            let (ox, oy) = (
                o.tiff.geo.tiepoint.get(3).copied().unwrap_or(0.0),
                o.tiff.geo.tiepoint.get(4).copied().unwrap_or(0.0),
            );
            (
                js_round((min_e + i as f64 * res - ox) / o.res) as i64,
                js_round((oy - (min_n + j as f64 * res)) / o.res) as i64,
            )
        };
        let mut grid = vec![f64::NAN; n * n];
        for o in &opened {
            let l = &o.tiff.levels[o.level];
            let (bw, bh) = (i64::from(l.block_width), i64::from(l.block_height));
            // Every block this source could fill, fetched together.
            let mut wanted = BTreeSet::new();
            for j in 0..n {
                for i in 0..n {
                    if grid[j * n + i].is_finite() {
                        continue;
                    }
                    let (px, py) = pixel(o, i, j);
                    if px >= 0 && py >= 0 && px < i64::from(l.width) && py < i64::from(l.height) {
                        wanted.insert(((px / bw) as u32, (py / bh) as u32));
                    }
                }
            }
            let blocks: std::collections::HashMap<(u32, u32), Arc<csk_core::resource::Samples>> =
                join_all(wanted.iter().map(|&(tx, ty)| async move {
                    ((tx, ty), self.cog.block(&o.key, &o.tiff, o.level, tx, ty).await)
                }))
                .await
                .into_iter()
                .filter_map(|(k, r)| r.ok().flatten().map(|b| (k, b)))
                .collect();
            for j in 0..n {
                for i in 0..n {
                    let k = j * n + i;
                    if grid[k].is_finite() {
                        continue;
                    }
                    let (px, py) = pixel(o, i, j);
                    if px < 0 || py < 0 || px >= i64::from(l.width) || py >= i64::from(l.height) {
                        continue;
                    }
                    let Some(b) = blocks.get(&((px / bw) as u32, (py / bh) as u32)) else { continue };
                    let v = f64::from(b[((py % bh) * bw + px % bw) as usize]);
                    if !v.is_finite() || v < -1e5 || o.tiff.geo.nodata.is_some_and(|nd| v == nd) {
                        continue;
                    }
                    grid[k] = v;
                }
            }
        }
        let mut sources: Vec<String> = Vec::new();
        for o in &opened {
            if !sources.contains(&o.project) {
                sources.push(o.project.clone());
            }
        }
        Ok(Some((grid, sources)))
    }
}

fn better(a: &Option<Sampled>, than: &Option<Sampled>) -> bool {
    match (a, than) {
        (Some(a), Some(b)) => a.coverage > b.coverage,
        (Some(_), None) => true,
        _ => false,
    }
}

/// Pixel size of a level: the full extent over the level's width, as GDAL
/// georeferences overviews (odd sizes round up, so it is not exactly 2^i).
fn level_res(t: &Tiff, base: f64, level: usize) -> f64 {
    base * f64::from(t.levels[0].width) / f64::from(t.levels[level].width.max(1))
}

/// The coarsest overview still no coarser than the output: picking a coarser
/// level upsamples, and its quantisation shows as cross-hatching in hillshade.
fn finest_level(t: &Tiff, base: f64, ground_res: f64) -> usize {
    let mut level = 0;
    for i in 0..t.levels.len() {
        if level_res(t, base, i) <= ground_res {
            level = i;
        } else {
            break;
        }
    }
    level
}

/// UTM zone from a projected EPSG code: WGS84 north 326xx, NAD83 269xx.
pub fn zone_of_epsg(epsg: Option<u32>) -> Option<i32> {
    match epsg? {
        e @ 32601..=32660 => Some((e - 32600) as i32),
        e @ 26901..=26923 => Some((e - 26900) as i32),
        _ => None,
    }
}

fn opr_provenance() -> serde_json::Map<String, serde_json::Value> {
    let o = elwha();
    let mut m = serde_json::Map::new();
    m.insert("product".into(), o.product.clone().into());
    m.insert("horizontalDatum".into(), o.horizontal_datum.clone().into());
    m.insert("verticalDatum".into(), o.vertical_datum.clone().into());
    m.insert("verticalUnits".into(), o.vertical_units.clone().into());
    m.insert("acquisition".into(), o.acquisition.clone());
    m.insert("projectionLimitation".into(), o.projection_limitation.clone().into());
    m.insert("metadataURL".into(), o.metadata_url.clone().into());
    m.insert("standardProductLimitation".into(), o.standard_product_limitation.clone().into());
    m
}

#[cfg(test)]
mod tests {
    #[test]
    fn levels_zones_opr() {
        assert_eq!(super::zone_of_epsg(Some(26910)), Some(10));
        assert_eq!(super::zone_of_epsg(Some(32611)), Some(11));
        assert_eq!(super::zone_of_epsg(Some(4326)), None);
        assert!(super::elwha().files.len() > 300);
    }
}
