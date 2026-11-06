//! Typed terrain tiles for native consumers (the native map), beside the
//! HTTP-shaped routes the WebView uses. One answer per source and tile, with
//! no PNG or wire encoding in between.

use std::sync::Arc;
use std::time::Duration;

use csk_core::raster::{png, terrarium};

use crate::Engine;
use crate::tiles::{Baseline, Lidar, RAW_MIN_ZOOM};

/// Terrain sources in the web client's ranking (`gpu-terrain-store.js`):
/// a higher rank wins where valid.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TerrainSource {
    Overview,
    National,
    Lidar,
    Dnr,
    Oregon,
}

impl TerrainSource {
    pub const ALL: [TerrainSource; 5] = [Self::Overview, Self::National, Self::Lidar, Self::Dnr, Self::Oregon];

    pub fn rank(self) -> u8 {
        match self {
            Self::Overview => 1,
            Self::National => 2,
            Self::Lidar => 3,
            Self::Dnr => 5,
            Self::Oregon => 6,
        }
    }

    /// The finest level the source is requested at; finer display levels
    /// magnify it.
    pub fn max_zoom(self) -> u8 {
        match self {
            Self::Overview => 15,
            Self::Dnr | Self::Oregon => 18,
            Self::National | Self::Lidar => 22,
        }
    }

    /// Survey sources whose answer, even an empty one, is their truth at a
    /// level: their coarser records never stand in beneath it.
    pub fn authoritative(self) -> bool {
        matches!(self, Self::Dnr | Self::Oregon)
    }

    /// Levels coarser than the request a fast stand-in is asked at while
    /// the request renders (one raw tile at z-2 covers sixteen).
    pub fn stand_in(self) -> u8 {
        if self == Self::Lidar { 2 } else { 0 }
    }
}

/// Where each source may draw and be asked, for display tiles at any level
/// (`app/terrain-sources.js`). A snapshot: `revision` changes whenever
/// prepared WA DNR rasters do, and then answers may change too.
#[derive(Clone, Debug, PartialEq)]
pub struct TerrainCoverage {
    pub revision: i64,
    /// Lon/lat bounds of the prepared DNR rasters.
    dnr: Vec<[f64; 4]>,
}

fn oregon_region(z: u8, x: u32, y: u32) -> bool {
    let [west, south, east, north] = crate::dnr_local::tile_lonlat(z, x, y);
    z >= 13 && west < -116.4 && east > -124.8 && north > 41.9 && south < 46.4
}

impl TerrainCoverage {
    fn dnr(&self, z: u8, x: u32, y: u32) -> bool {
        let t = crate::dnr_local::tile_lonlat(z, x, y);
        self.dnr.iter().any(|b| t[0] < b[2] && t[2] > b[0] && t[1] < b[3] && t[3] > b[1])
    }

    /// Whether `source` draws into (and is asked for) display tile (z, x, y).
    /// Below z13 one raw tile opens dozens of surveys for pixels over 13 m
    /// wide; national shows the same there. Oregon defers to prepared DNR.
    pub fn allows(&self, source: TerrainSource, z: u8, x: u32, y: u32) -> bool {
        match source {
            TerrainSource::Overview => true,
            TerrainSource::National | TerrainSource::Lidar => z >= RAW_MIN_ZOOM,
            TerrainSource::Dnr => self.dnr(z, x, y),
            TerrainSource::Oregon => oregon_region(z, x, y) && !self.dnr(z, x, y),
        }
    }
}

/// One source's answer for one tile.
#[derive(Debug, Clone, PartialEq)]
pub enum TerrainAnswer {
    /// 256x256 row-major metres, NaN where invalid. `lasting` is false for a
    /// stale or provisional stand-in that must be asked again.
    Tile { values: Vec<f32>, lasting: bool },
    /// No data. `lasting` holds until the coverage revision changes.
    Empty { lasting: bool },
    /// Unavailable now (busy, offline, coverage unknown); ask again later.
    Retry { after: Duration },
}

fn interior(grid: &crate::tiles::Grid) -> Option<Vec<f32>> {
    (grid.size() == 256).then(|| grid.interior())
}

impl Engine {
    /// Changes whenever `terrain_coverage` or its sources' answers may.
    pub fn terrain_revision(&self) -> i64 {
        self.dnr_local.revision()
    }

    pub fn terrain_coverage(&self) -> TerrainCoverage {
        let files = self.dnr_local.files();
        TerrainCoverage { revision: self.dnr_local.revision(), dnr: files.iter().map(|f| f.bounds).collect() }
    }

    /// The terrain tile from one source. Never starts a WA DNR acquisition.
    pub async fn terrain_tile(self: &Arc<Self>, source: TerrainSource, z: u8, x: u32, y: u32) -> TerrainAnswer {
        let retry = |secs| TerrainAnswer::Retry { after: Duration::from_secs(secs) };
        if z > source.max_zoom() || x >= 1 << z || y >= 1 << z {
            return TerrainAnswer::Empty { lasting: true };
        }
        if source == TerrainSource::Lidar && z < RAW_MIN_ZOOM {
            return TerrainAnswer::Empty { lasting: true };
        }
        match source {
            TerrainSource::Lidar => match self.tiles.lidar(z, x, y).await {
                Lidar::Tile { grid, .. } => {
                    interior(&grid).map_or(retry(2), |values| TerrainAnswer::Tile { values, lasting: true })
                }
                Lidar::None => TerrainAnswer::Empty { lasting: true },
                Lidar::Provisional => retry(10),
                Lidar::Failed { stale: Some((grid, _)) } => {
                    interior(&grid).map_or(retry(2), |values| TerrainAnswer::Tile { values, lasting: false })
                }
                Lidar::Failed { stale: None } => retry(2),
            },
            TerrainSource::National => match self.tiles.baseline(z, x, y).await {
                Baseline::Tile { grid, .. } => {
                    interior(&grid).map_or(retry(2), |values| TerrainAnswer::Tile { values, lasting: true })
                }
                Baseline::None => TerrainAnswer::Empty { lasting: true },
                Baseline::Failed { circuit_open } => retry(if circuit_open { 15 } else { 2 }),
            },
            TerrainSource::Overview => match self.overview(z, x, y).await {
                Ok((bytes, _)) => match png::decode_rgba(&bytes) {
                    Some((256, 256, rgba)) => TerrainAnswer::Tile { values: terrarium::decode(&rgba), lasting: true },
                    _ => retry(30),
                },
                Err(_) => retry(5),
            },
            TerrainSource::Oregon => match crate::oregon::grid(self, z, x, y).await {
                Ok(Some(values)) => TerrainAnswer::Tile { values, lasting: true },
                Ok(None) => TerrainAnswer::Empty { lasting: true },
                Err(_) => retry(2),
            },
            TerrainSource::Dnr => match crate::dnr_routes::lookup(self, false, z, x, y).await.result {
                crate::dnr_routes::Found::Grid { grid, .. } => TerrainAnswer::Tile { values: grid, lasting: true },
                // Prepared rasters change only with the coverage revision.
                crate::dnr_routes::Found::Missing => TerrainAnswer::Empty { lasting: true },
                crate::dnr_routes::Found::SampleFailed(_) => retry(5),
            },
        }
    }
}
