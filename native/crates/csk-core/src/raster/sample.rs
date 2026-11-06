//! Resampling projected rasters onto Web Mercator tiles.
//!
//! A tile is sampled as an `(size + 2)²` grid with a one-pixel skirt, so
//! slope and hillshade kernels have neighbours at the tile edge and adjacent
//! tiles meet without seams. Grid point (1, 1) is the first pixel centre.

use std::sync::Arc;

use crate::geo::{self, TileBounds};

/// Exact projections are made every `LATTICE_STEP` grid points and
/// interpolated between, as GDAL's approximate transformer does. The error
/// stays far below a DEM pixel at every zoom, and the transverse-Mercator
/// series is otherwise most of the sampling time.
pub const LATTICE_STEP: usize = 8;

/// What one tile asks of its sources.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TileSpec {
    pub z: u8,
    pub x: u32,
    pub y: u32,
    /// Output pixels per side, without the skirt.
    pub size: u32,
    pub bounds: TileBounds,
    /// Mercator metres per output pixel.
    pub step: f64,
    pub zone: i32,
    /// Ground metres per output pixel at the tile centre.
    pub ground_res: f64,
}

impl TileSpec {
    pub fn new(z: u8, x: u32, y: u32, size: u32) -> Self {
        let bounds = geo::tile_bounds_merc(z, x, y);
        let step = bounds.span / f64::from(size);
        let (lon, lat) = geo::merc_to_lon_lat((bounds.min_x + bounds.max_x) / 2.0, (bounds.min_y + bounds.max_y) / 2.0);
        let zone = geo::utm_zone(lon);
        Self { z, x, y, size, bounds, step, zone, ground_res: step * lat.to_radians().cos() }
    }

    /// Grid points per side, skirt included.
    pub fn n(&self) -> usize {
        self.size as usize + 2
    }

    /// The tile's footprint in its UTM zone, padded by three ground pixels.
    /// The perimeter is walked rather than the corners, because Mercator to
    /// UTM is not affine and a rotated footprint would clip at the edges.
    pub fn utm_footprint(&self) -> Footprint {
        let b = self.bounds;
        let mut f = Footprint {
            min_e: f64::INFINITY,
            max_e: f64::NEG_INFINITY,
            min_n: f64::INFINITY,
            max_n: f64::NEG_INFINITY,
        };
        for i in 0..=16 {
            let t = f64::from(i) / 16.0;
            for (mx, my) in [
                (b.min_x + t * b.span, b.min_y),
                (b.min_x + t * b.span, b.max_y),
                (b.min_x, b.min_y + t * b.span),
                (b.max_x, b.min_y + t * b.span),
            ] {
                let (lon, lat) = geo::merc_to_lon_lat(mx, my);
                let (e, n) = geo::lon_lat_to_utm(lon, lat, self.zone);
                f.min_e = f.min_e.min(e);
                f.max_e = f.max_e.max(e);
                f.min_n = f.min_n.min(n);
                f.max_n = f.max_n.max(n);
            }
        }
        let pad = self.ground_res * 3.0;
        Footprint { min_e: f.min_e - pad, max_e: f.max_e + pad, min_n: f.min_n - pad, max_n: f.max_n + pad }
    }

    /// UTM easting and northing of every grid point.
    pub fn utm_grid(&self) -> (Vec<f64>, Vec<f64>) {
        utm_grid(&self.bounds, self.n(), self.step, self.zone, LATTICE_STEP)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Footprint {
    pub min_e: f64,
    pub max_e: f64,
    pub min_n: f64,
    pub max_n: f64,
}

/// `n × n` UTM coordinates over Mercator bounds `b` at `step` metres,
/// projected exactly on a lattice every `k` points and bilinearly between.
pub fn utm_grid(b: &TileBounds, n: usize, step: f64, zone: i32, k: usize) -> (Vec<f64>, Vec<f64>) {
    let m = (n - 1) / k + 2; // one node past the last grid point
    let (mut le, mut ln) = (vec![0.0; m * m], vec![0.0; m * m]);
    for j in 0..m {
        let my = b.max_y - ((j * k) as f64 - 1.0 + 0.5) * step;
        for i in 0..m {
            let (lon, lat) = geo::merc_to_lon_lat(b.min_x + ((i * k) as f64 - 1.0 + 0.5) * step, my);
            let (e, nn) = geo::lon_lat_to_utm(lon, lat, zone);
            le[j * m + i] = e;
            ln[j * m + i] = nn;
        }
    }
    let (mut e, mut nn) = (vec![0.0; n * n], vec![0.0; n * n]);
    for gy in 0..n {
        let j = gy / k;
        let ty = (gy - j * k) as f64 / k as f64;
        let (r0, r1) = (j * m, j * m + m);
        for gx in 0..n {
            let i = gx / k;
            let tx = (gx - i * k) as f64 / k as f64;
            let (w00, w10, w01, w11) = ((1.0 - tx) * (1.0 - ty), tx * (1.0 - ty), (1.0 - tx) * ty, tx * ty);
            let at = gy * n + gx;
            e[at] = le[r0 + i] * w00 + le[r0 + i + 1] * w10 + le[r1 + i] * w01 + le[r1 + i + 1] * w11;
            nn[at] = ln[r0 + i] * w00 + ln[r0 + i + 1] * w10 + ln[r1 + i] * w01 + ln[r1 + i + 1] * w11;
        }
    }
    (e, nn)
}

/// One overview level of a north-up projected raster, with whichever of its
/// blocks were fetched.
#[derive(Debug, Clone)]
pub struct BlockRaster {
    pub width: u32,
    pub height: u32,
    pub block_width: u32,
    pub block_height: u32,
    /// Blocks in row-major block order; `None` where not fetched or empty.
    pub blocks: Vec<Option<Arc<[f32]>>>,
    /// Upper-left corner of the upper-left pixel, in the source CRS.
    pub origin_x: f64,
    pub origin_y: f64,
    /// Pixel size at this level.
    pub res: f64,
    pub nodata: Option<f64>,
}

/// Block indices a footprint touches at one level, clamped to the raster.
pub fn blocks_for(raster: &BlockRaster, f: &Footprint) -> Vec<(u32, u32)> {
    let px0 = ((f.min_e - raster.origin_x) / raster.res).floor();
    let px1 = ((f.max_e - raster.origin_x) / raster.res).ceil();
    let py0 = ((raster.origin_y - f.max_n) / raster.res).floor();
    let py1 = ((raster.origin_y - f.min_n) / raster.res).ceil();
    let cols = raster.width.div_ceil(raster.block_width) as i64;
    let rows = raster.height.div_ceil(raster.block_height) as i64;
    let bw = i64::from(raster.block_width);
    let bh = i64::from(raster.block_height);
    let tx0 = (px0 as i64).div_euclid(bw).max(0);
    let tx1 = (px1 as i64).div_euclid(bw).min(cols - 1);
    let ty0 = (py0 as i64).div_euclid(bh).max(0);
    let ty1 = (py1 as i64).div_euclid(bh).min(rows - 1);
    let mut out = Vec::new();
    for ty in ty0..=ty1 {
        for tx in tx0..=tx1 {
            out.push((tx as u32, ty as u32));
        }
    }
    out
}

impl BlockRaster {
    fn cols(&self) -> u32 {
        self.width.div_ceil(self.block_width)
    }

    #[inline]
    fn at(&self, px: i64, py: i64) -> f64 {
        if px < 0 || py < 0 || px >= i64::from(self.width) || py >= i64::from(self.height) {
            return f64::NAN;
        }
        let (px, py) = (px as u32, py as u32);
        let block = (py / self.block_height) * self.cols() + px / self.block_width;
        let Some(Some(a)) = self.blocks.get(block as usize) else { return f64::NAN };
        let v = f64::from(a[((py % self.block_height) * self.block_width + px % self.block_width) as usize]);
        if !v.is_finite() || v < -1e5 || self.nodata.is_some_and(|nd| v == nd) {
            return f64::NAN;
        }
        v
    }

    /// Bilinear at a point in the source CRS, renormalised over the valid
    /// neighbours, so a half-pixel offset does not read as a terrace and a
    /// survey edge keeps its last pixels.
    #[inline]
    pub fn bilinear(&self, e: f64, n: f64) -> f64 {
        let fx = (e - self.origin_x) / self.res - 0.5;
        let fy = (self.origin_y - n) / self.res - 0.5;
        let (x0, y0) = (fx.floor(), fy.floor());
        let (dx, dy) = (fx - x0, fy - y0);
        let (x0, y0) = (x0 as i64, y0 as i64);
        let (mut sum, mut weight) = (0.0, 0.0);
        for (px, py, w) in [
            (x0, y0, (1.0 - dx) * (1.0 - dy)),
            (x0 + 1, y0, dx * (1.0 - dy)),
            (x0, y0 + 1, (1.0 - dx) * dy),
            (x0 + 1, y0 + 1, dx * dy),
        ] {
            if w > 0.0 {
                let v = self.at(px, py);
                if !v.is_nan() {
                    sum += v * w;
                    weight += w;
                }
            }
        }
        if weight > 0.0 { sum / weight } else { f64::NAN }
    }
}

/// The result of filling a grid from ranked sources.
#[derive(Debug, Clone)]
pub struct Filled {
    /// `n × n` metres; NaN where no source had data.
    pub grid: Vec<f32>,
    pub filled: usize,
    /// Grid points each source supplied, in source order.
    pub contributed: Vec<usize>,
}

/// Fills each grid point from the first source, in rank order, that has a
/// value there.
pub fn fill(e: &[f64], n: &[f64], sources: &[&BlockRaster]) -> Filled {
    let mut grid = vec![f32::NAN; e.len()];
    let mut contributed = vec![0usize; sources.len()];
    let mut filled = 0;
    for (k, cell) in grid.iter_mut().enumerate() {
        for (i, s) in sources.iter().enumerate() {
            let v = s.bilinear(e[k], n[k]);
            if !v.is_nan() {
                *cell = v as f32;
                filled += 1;
                contributed[i] += 1;
                break;
            }
        }
    }
    Filled { grid, filled, contributed }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic tilted plane in UTM must come back through Mercator
    /// sampling with sub-centimetre registration (ARCHITECTURE.md §6: < 0.01 px).
    #[test]
    fn tilted_plane_registers() {
        let spec = TileSpec::new(15, 5240, 11450, 256); // near Mt Rainier
        let f = spec.utm_footprint();
        let res = 1.0;
        let (ox, oy) = ((f.min_e - 50.0).floor(), (f.max_n + 50.0).ceil());
        let (w, h) = (((f.max_e - ox) / res) as u32 + 100, ((oy - f.min_n) / res) as u32 + 100);
        let (bw, bh) = (256u32, 256u32);
        let (cols, rows) = (w.div_ceil(bw), h.div_ceil(bh));
        let plane = |e: f64, n: f64| 1000.0 + 0.05 * (e - ox) - 0.03 * (oy - n);
        let mut blocks = Vec::new();
        for ty in 0..rows {
            for tx in 0..cols {
                let mut b = vec![0f32; (bw * bh) as usize];
                for y in 0..bh {
                    for x in 0..bw {
                        let (px, py) = (tx * bw + x, ty * bh + y);
                        let e = ox + (f64::from(px) + 0.5) * res;
                        let n = oy - (f64::from(py) + 0.5) * res;
                        b[(y * bw + x) as usize] = plane(e, n) as f32;
                    }
                }
                blocks.push(Some(Arc::from(b)));
            }
        }
        let r = BlockRaster {
            width: w,
            height: h,
            block_width: bw,
            block_height: bh,
            blocks,
            origin_x: ox,
            origin_y: oy,
            res,
            nodata: None,
        };
        let (e, n) = spec.utm_grid();
        let out = fill(&e, &n, &[&r]);
        assert_eq!(out.filled, spec.n() * spec.n());
        let mut worst = 0f64;
        for k in 0..e.len() {
            let want = plane(e[k], n[k]);
            worst = worst.max((f64::from(out.grid[k]) - want).abs());
        }
        // 0.01 px of a 0.05 slope at 1 m pixels is 0.5 mm, plus f32 storage.
        assert!(worst < 5e-4 + 1e-4, "worst {worst}");
        assert!(!blocks_for(&r, &f).is_empty());
    }
}
