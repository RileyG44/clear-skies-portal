//! Elevation tiles: 1 m lidar, the national baseline, and the choice
//! between them, with the scientific loading contracts
//! (docs/ENGINEERING_REVIEW.md) enforced here rather than in each route:
//!
//! - "No coverage" is cached only when the catalogue that said so was
//!   complete, under the scope it was complete for.
//! - A failed or timed-out read is never cached as an answer; a coarser
//!   stand-in served meanwhile is marked uncacheable.
//! - Every tile carries its true source; overview or national data is never
//!   labelled as lidar.

use std::sync::Arc;
use std::time::Duration;

use csk_core::raster::sample::TileSpec;
use csk_store::{Kind, Store, pack_elevation, unpack_elevation};
use serde::{Deserialize, Serialize};

use crate::flight::Flights;
use crate::national::{self, NationalTile};
use crate::upstream::Upstream;
use crate::usgs::{Outcome, SourceInfo, Usgs};

/// Lidar and 3DEP tiles do not change; refreshed after this regardless.
pub const TILE_TTL: Duration = Duration::from_secs(90 * 24 * 3600);
pub const TILE_SIZE: u32 = 256;
/// Raw 1 m cannot add information to a continental or regional tile.
pub const RAW_MIN_ZOOM: u8 = 13;

/// A square grid of metres, NaN where invalid, optionally with a one-pixel skirt.
#[derive(Debug, Clone, PartialEq)]
pub struct Grid {
    pub side: u16,
    pub skirt: bool,
    pub values: Arc<[f32]>,
}

impl Grid {
    /// Output pixels per side, without the skirt.
    pub fn size(&self) -> u16 {
        if self.skirt { self.side - 2 } else { self.side }
    }

    /// The `size × size` interior.
    pub fn interior(&self) -> Vec<f32> {
        if !self.skirt {
            return self.values.to_vec();
        }
        let (n, s) = (usize::from(self.side), usize::from(self.size()));
        let mut out = Vec::with_capacity(s * s);
        for y in 0..s {
            out.extend_from_slice(&self.values[(y + 1) * n + 1..(y + 1) * n + 1 + s]);
        }
        out
    }
}

/// What the cache keeps beside a tile.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage: Option<f64>,
    #[serde(rename = "groundRes", default, skip_serializing_if = "Option::is_none")]
    pub ground_res: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<SourceInfo>,
    /// A "none" answer given by a complete catalogue.
    #[serde(rename = "final", default)]
    pub final_: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default)]
    pub skirt: bool,
}

fn round(v: f64, places: i32) -> f64 {
    let m = 10f64.powi(places);
    (v * m).round() / m
}

/// A 1 m answer.
#[derive(Debug, Clone, PartialEq)]
pub enum Lidar {
    Tile {
        grid: Grid,
        meta: Meta,
        hit: bool,
    },
    /// No 1 m coverage (final).
    None,
    /// Coverage unknown: the catalogue is incomplete.
    Provisional,
    /// The read failed; a previously stored tile is offered as a fallback.
    Failed {
        stale: Option<(Grid, Meta)>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Baseline {
    Tile { grid: Grid, coverage: f64, hit: bool },
    None,
    Failed { circuit_open: bool },
}

type Key = (u8, u32, u32);

pub struct Tiles {
    store: Arc<Store>,
    upstream: Arc<Upstream>,
    pub usgs: Arc<Usgs>,
    lidar: Flights<Key, Lidar>,
    baseline: Flights<Key, Baseline>,
}

fn lidar_key(z: u8, x: u32, y: u32) -> String {
    format!("usgs1m:v1:{z}/{x}/{y}")
}

fn national_key(z: u8, x: u32, y: u32) -> String {
    format!("national:v1:{z}/{x}/{y}")
}

struct Stored {
    status: u16,
    grid: Option<Grid>,
    meta: Meta,
}

impl Tiles {
    pub fn new(store: Arc<Store>, upstream: Arc<Upstream>, usgs: Arc<Usgs>) -> Arc<Self> {
        Arc::new(Self { store, upstream, usgs, lidar: Flights::default(), baseline: Flights::default() })
    }

    fn load(&self, key: &str) -> Option<Stored> {
        let e = self.store.get(key, TILE_TTL).ok()??;
        let meta: Meta = e.meta.as_deref().and_then(|m| serde_json::from_str(m).ok()).unwrap_or_default();
        let grid = if e.status == 200 {
            let (w, h, values) = unpack_elevation(&e.body).ok()?;
            if w != h {
                return None;
            }
            Some(Grid { side: w, skirt: meta.skirt, values: values.into() })
        } else {
            None
        };
        Some(Stored { status: e.status, grid, meta })
    }

    fn save(&self, key: &str, grid: Option<&Grid>, meta: &Meta) {
        let meta_text = serde_json::to_string(meta).ok();
        let (status, body) = match grid {
            Some(g) => (200, pack_elevation(g.side, g.side, &g.values)),
            None => (204, Vec::new()),
        };
        let _ = self.store.put(
            key,
            Kind::Derived,
            status,
            "application/vnd.clearskies.elev32",
            meta_text.as_deref(),
            &body,
        );
    }

    /// Whether a stored 1 m answer must be asked again: a "none" not given by
    /// a complete catalogue under this scope, or any answer from another scope
    /// (partial positives can hide newly added pixels).
    fn stale(&self, s: &Stored) -> bool {
        let scope = self.usgs.catalog.coverage_scope();
        match s.status {
            204 => !(s.meta.final_ && s.meta.scope.as_deref() == Some(scope.as_str())),
            _ => s.meta.scope.as_deref() != Some(scope.as_str()),
        }
    }

    /// The stored 1 m answer, fresh or not, without asking upstream.
    pub fn lidar_cached(&self, z: u8, x: u32, y: u32) -> Option<(Grid, Meta)> {
        let s = self.load(&lidar_key(z, x, y))?;
        Some((s.grid?, s.meta))
    }

    /// 1 m lidar for a tile, from the store or sampled now.
    pub async fn lidar(self: &Arc<Self>, z: u8, x: u32, y: u32) -> Lidar {
        let key = lidar_key(z, x, y);
        let stored = self.load(&key);
        if let Some(s) = &stored
            && !self.stale(s)
        {
            return match &s.grid {
                Some(g) => Lidar::Tile { grid: g.clone(), meta: s.meta.clone(), hit: true },
                None => Lidar::None,
            };
        }
        let me = self.clone();
        let stale = stored.and_then(|s| Some((s.grid?, s.meta)));
        let answer = self
            .lidar
            .run((z, x, y), move || async move { me.sample_lidar(z, x, y).await })
            .await
            .unwrap_or(Lidar::Failed { stale: None });
        match answer {
            Lidar::Failed { .. } => Lidar::Failed { stale },
            a => a,
        }
    }

    async fn sample_lidar(&self, z: u8, x: u32, y: u32) -> Lidar {
        let spec = TileSpec::new(z, x, y, TILE_SIZE);
        let key = lidar_key(z, x, y);
        let scope = Some(self.usgs.catalog.coverage_scope());
        match self.usgs.elevation(&spec).await {
            Ok(Outcome::Tile(s)) => {
                let grid = Grid { side: s.n as u16, skirt: true, values: s.grid.into() };
                let meta = Meta {
                    coverage: Some(round(s.coverage, 3)),
                    ground_res: Some(round(s.ground_res, 2)),
                    sources: s.sources,
                    final_: false,
                    scope,
                    skirt: true,
                };
                self.save(&key, Some(&grid), &meta);
                Lidar::Tile { grid, meta, hit: false }
            }
            Ok(Outcome::None) => {
                self.save(&key, None, &Meta { final_: true, scope, ..Meta::default() });
                Lidar::None
            }
            Ok(Outcome::Provisional) => Lidar::Provisional,
            Err(_) => Lidar::Failed { stale: None },
        }
    }

    /// The national baseline for a tile.
    pub async fn baseline(self: &Arc<Self>, z: u8, x: u32, y: u32) -> Baseline {
        if z < national::MIN_ZOOM {
            return Baseline::None;
        }
        let key = national_key(z, x, y);
        let stored = self.load(&key);
        if let Some(s) = &stored {
            return match &s.grid {
                Some(g) => Baseline::Tile { grid: g.clone(), coverage: s.meta.coverage.unwrap_or(1.0), hit: true },
                None => Baseline::None,
            };
        }
        let me = self.clone();
        self.baseline
            .run((z, x, y), move || async move {
                match national::fetch(&me.upstream, z, x, y, TILE_SIZE).await {
                    Ok(Some(NationalTile { grid, size, coverage })) => {
                        let grid = Grid { side: size as u16, skirt: false, values: grid.into() };
                        let coverage = round(coverage, 3);
                        me.save(&key, Some(&grid), &Meta { coverage: Some(coverage), ..Meta::default() });
                        Baseline::Tile { grid, coverage, hit: false }
                    }
                    Ok(None) => {
                        me.save(&key, None, &Meta::default());
                        Baseline::None
                    }
                    Err(e) => Baseline::Failed { circuit_open: e.circuit_open() },
                }
            })
            .await
            .unwrap_or(Baseline::Failed { circuit_open: false })
    }

    /// The stored baseline, without asking upstream.
    pub fn baseline_cached(&self, z: u8, x: u32, y: u32) -> Option<Option<(Grid, f64)>> {
        let s = self.load(&national_key(z, x, y))?;
        Some(s.grid.map(|g| (g, s.meta.coverage.unwrap_or(1.0))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interior_drops_the_skirt() {
        let values: Vec<f32> = (0..16).map(|v| v as f32).collect();
        let g = Grid { side: 4, skirt: true, values: values.into() };
        assert_eq!(g.size(), 2);
        assert_eq!(g.interior(), vec![5.0, 6.0, 9.0, 10.0]);
    }
}
