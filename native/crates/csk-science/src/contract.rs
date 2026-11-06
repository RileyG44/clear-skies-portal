//! Request bounds and result framing shared with the page
//! (`research-contract.js`): the CSPA frame is a 24-byte header, UTF-8 JSON
//! metadata padded to four bytes, then one or two little-endian f32 rasters.

use serde_json::{Value, json};

use crate::glacial::{self, Radius};
use crate::terrain::{self, Options};
use crate::{Product, js_round};

pub const PROTOCOL_VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 24;
pub const MAX_WIDTH: usize = 1024;
pub const MAX_HEIGHT: usize = 1024;
pub const MAX_CELLS: usize = 524_288;
pub const MIME: &str = "application/vnd.clearskies.terrain-analysis";

pub const PRODUCTS: &[&str] = &[
    "lrm",
    "tpi",
    "tri",
    "residual",
    "northness",
    "curvature",
    "glacial",
    "moraine",
    "flood",
    "svf",
    "openpos",
    "openneg",
    "rrim",
    "geomorphons",
    "drainage",
    "wetness",
    "depressions",
    "avalanche",
    "solar",
    "wind",
];
pub const TERRAIN_PRODUCTS: &[&str] = &[
    "svf",
    "openpos",
    "openneg",
    "rrim",
    "geomorphons",
    "drainage",
    "wetness",
    "depressions",
    "avalanche",
    "solar",
    "wind",
];

/// Radius in cells per scale for the glacial products.
pub fn scale_cells(scale: &str) -> Option<usize> {
    match scale {
        "fine" => Some(4),
        "balanced" => Some(10),
        "broad" => Some(24),
        _ => None,
    }
}
/// Horizon-search radius in cells for the lidar visualisation products.
fn horizon_cells(scale: &str) -> f64 {
    match scale {
        "fine" => 8.0,
        "broad" => 50.0,
        _ => 20.0,
    }
}
/// Upwind search for wind exposure, metres.
fn wind_metres(scale: &str) -> f64 {
    match scale {
        "fine" => 100.0,
        "broad" => 600.0,
        _ => 300.0,
    }
}

/// A request as it arrives (query parameters, parsed as numbers).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Raw<'a> {
    pub product: &'a str,
    pub scale: &'a str,
    pub width: f64,
    pub height: f64,
    pub resolution: f64,
    pub day: Option<f64>,
    pub lat: Option<f64>,
    pub wind: Option<f64>,
}

/// A validated request.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub product: String,
    pub scale: String,
    pub width: usize,
    pub height: usize,
    pub resolution: f64,
    pub day_of_year: Option<f64>,
    pub latitude: Option<f64>,
    pub wind_azimuth: Option<f64>,
}

impl Request {
    /// Validates as `research-contract.js:validate` (with options clamped).
    pub fn new(raw: &Raw<'_>) -> Result<Self, &'static str> {
        let Raw { product, scale, width, height, resolution, day, lat, wind } = *raw;
        if !PRODUCTS.contains(&product) {
            return Err("unknown research product");
        }
        if scale_cells(scale).is_none() {
            return Err("unknown research scale");
        }
        let int = |v: f64| v.is_finite() && v.fract() == 0.0;
        if !int(width)
            || !int(height)
            || width < 3.0
            || height < 3.0
            || width > MAX_WIDTH as f64
            || height > MAX_HEIGHT as f64
            || width * height > MAX_CELLS as f64
        {
            return Err("analysis dimensions are outside the safe bounds");
        }
        if !resolution.is_finite() || !(0.01..=100_000.0).contains(&resolution) {
            return Err("analysis resolution is outside the safe bounds");
        }
        let finite = |v: Option<f64>| v.filter(|v| v.is_finite());
        Ok(Self {
            product: product.into(),
            scale: scale.into(),
            width: width as usize,
            height: height as usize,
            resolution,
            day_of_year: finite(day).map(|d| js_round(d).clamp(1.0, 366.0)),
            latitude: finite(lat).map(|l| (js_round(l * 1000.0) / 1000.0).clamp(-85.0, 85.0)),
            wind_azimuth: finite(wind).map(|w| (js_round(w) % 360.0 + 360.0) % 360.0),
        })
    }

    /// The options object as the page's cache key spells it.
    pub fn options_json(&self) -> Value {
        let mut o = serde_json::Map::new();
        if let Some(d) = self.day_of_year {
            o.insert("dayOfYear".into(), json!(d));
        }
        if let Some(l) = self.latitude {
            o.insert("latitude".into(), json!(l));
        }
        if let Some(w) = self.wind_azimuth {
            o.insert("windAzimuth".into(), json!(w));
        }
        Value::Object(o)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
    /// 422: the grid itself is unusable.
    Invalid(String),
    /// The product is not yet available natively.
    Unsupported(String),
}

/// Runs a product over `grid` (`width × height` f32 metres).
pub fn run(req: &Request, grid: &[f32]) -> Result<(Product, &'static str, Option<Value>), RunError> {
    if grid.len() != req.width * req.height {
        return Err(RunError::Invalid("analysis grid length must equal width times height".into()));
    }
    let mut finite = 0;
    for v in grid {
        if !v.is_finite() {
            continue;
        }
        if *v < -20000.0 || *v > 100_000.0 {
            return Err(RunError::Invalid("analysis grid contains an implausible finite elevation".into()));
        }
        finite += 1;
    }
    if finite < 9 {
        return Err(RunError::Invalid("analysis grid needs at least nine finite elevation samples".into()));
    }
    let (w, h, p) = (req.width, req.height, req.product.as_str());
    let mut o = Options {
        cell_size: req.resolution,
        radius_cells: Some(horizon_cells(&req.scale)),
        latitude: req.latitude,
        day_of_year: req.day_of_year,
        wind_azimuth: req.wind_azimuth,
        ..Options::default()
    };
    let (product, label) = match p {
        "svf" => (terrain::sky_view_factor(grid, w, h, &o), "Sky-view factor"),
        "openpos" => (terrain::openness(grid, w, h, &o), "Positive openness"),
        "openneg" => {
            o.negative = true;
            (terrain::openness(grid, w, h, &o), "Negative openness")
        }
        "rrim" => (terrain::red_relief(grid, w, h, &o), "Red relief image map"),
        "geomorphons" => {
            o.radius_cells = Some(horizon_cells(&req.scale) * 1.25);
            (terrain::geomorphons(grid, w, h, &o), "Landforms (geomorphons)")
        }
        "drainage" => (terrain::drainage(grid, w, h, &o), "Drainage network"),
        "wetness" => (terrain::wetness(grid, w, h, &o), "Topographic wetness index"),
        "depressions" => (terrain::depressions(grid, w, h, &o), "Depressions"),
        "avalanche" => (terrain::avalanche_slope(grid, w, h, &o), "Avalanche slope angle"),
        "solar" => {
            o.radius_cells = None;
            (terrain::solar_exposure(grid, w, h, &o), "Sun exposure")
        }
        "wind" => {
            o.search_metres = Some(wind_metres(&req.scale));
            (terrain::wind_exposure(grid, w, h, &o), "Wind exposure")
        }
        other => return run_glacial(req, grid, other),
    };
    let notice = product.metadata.get("caution").map(|c| json!({"warning": c}));
    Ok((product, label, notice))
}

fn run_glacial(req: &Request, grid: &[f32], p: &str) -> Result<(Product, &'static str, Option<Value>), RunError> {
    let (w, h, cell) = (req.width, req.height, req.resolution);
    let radius = scale_cells(&req.scale).unwrap_or(10);
    let (product, label) = match p {
        "lrm" => (glacial::local_relief(grid, w, h, cell, Radius::square(radius)), "Local relief"),
        "tpi" => (
            glacial::terrain_position(grid, w, h, cell, Radius::square(radius), Radius::square(radius / 3)),
            "Terrain position",
        ),
        "tri" => (glacial::ruggedness(grid, w, h, cell), "Terrain ruggedness"),
        "residual" => (
            glacial::multi_scale_residual(grid, w, h, cell, &[(radius / 2).max(2), radius, radius * 2]),
            "Multi-scale residual anomaly",
        ),
        "northness" => (glacial::aspect_components(grid, w, h, cell), "Aspect components"),
        "curvature" => (glacial::curvature(grid, w, h, cell), "Surface curvature"),
        "glacial" => {
            (glacial::glacial_margin(grid, w, h, cell, Radius::square(radius)), "Possible glacial-margin morphology")
        }
        "flood" => {
            (glacial::flood_channel(grid, w, h, cell, Radius::square(radius)), "Possible flood-channel morphology")
        }
        other => return Err(RunError::Unsupported(other.into())),
    };
    let notice = product.metadata.get("screeningNotice").cloned();
    Ok((product, label, notice))
}

/// Frames a result exactly as `research-contract.js:encodeResult`.
pub fn encode(p: &Product, width: usize, height: usize, label: &str, notice: Option<&Value>) -> Vec<u8> {
    let count = width * height;
    let descriptor = json!({"label": label, "metadata": p.metadata, "notice": notice}).to_string().into_bytes();
    let padded = (descriptor.len() + 3) & !3;
    let planes = if p.secondary.is_some() { 2 } else { 1 };
    let mut out = Vec::with_capacity(HEADER_BYTES + padded + count * 4 * planes);
    out.extend_from_slice(b"CSPA");
    out.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    out.extend_from_slice(&u16::from(p.secondary.is_some()).to_le_bytes());
    out.extend_from_slice(&(width as u32).to_le_bytes());
    out.extend_from_slice(&(height as u32).to_le_bytes());
    out.extend_from_slice(&(descriptor.len() as u32).to_le_bytes());
    out.extend_from_slice(&(count as u32).to_le_bytes());
    out.extend_from_slice(&descriptor);
    out.resize(HEADER_BYTES + padded, 0);
    for v in p.data.iter().chain(p.secondary.iter().flatten()) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_runs_and_frames() {
        assert!(
            Request::new(&Raw {
                product: "nope",
                scale: "fine",
                width: 10.0,
                height: 10.0,
                resolution: 1.0,
                day: None,
                lat: None,
                wind: None
            })
            .is_err()
        );
        assert!(
            Request::new(&Raw {
                product: "svf",
                scale: "fine",
                width: 2.0,
                height: 10.0,
                resolution: 1.0,
                day: None,
                lat: None,
                wind: None
            })
            .is_err()
        );
        assert!(
            Request::new(&Raw {
                product: "svf",
                scale: "fine",
                width: 1024.0,
                height: 1024.0,
                resolution: 1.0,
                day: None,
                lat: None,
                wind: None
            })
            .is_err()
        );
        let r = Request::new(&Raw {
            product: "wind",
            scale: "balanced",
            width: 32.0,
            height: 24.0,
            resolution: 2.0,
            day: None,
            lat: None,
            wind: Some(-10.4),
        })
        .unwrap();
        assert_eq!(r.wind_azimuth, Some(350.0));
        // A cone: every product runs and frames.
        let grid: Vec<f32> = (0..32 * 24)
            .map(|i| {
                let (x, y) = ((i % 32) as f32 - 16.0, (i / 32) as f32 - 12.0);
                100.0 - (x * x + y * y).sqrt()
            })
            .collect();
        for p in TERRAIN_PRODUCTS {
            let r = Request::new(&Raw {
                product: p,
                scale: "fine",
                width: 32.0,
                height: 24.0,
                resolution: 2.0,
                day: Some(172.0),
                lat: Some(47.0),
                wind: Some(270.0),
            })
            .unwrap();
            let (product, label, notice) = run(&r, &grid).unwrap();
            let frame = encode(&product, 32, 24, label, notice.as_ref());
            assert_eq!(&frame[..4], b"CSPA");
            let meta_len = u32::from_le_bytes(frame[16..20].try_into().unwrap()) as usize;
            let planes = 1 + usize::from(product.secondary.is_some());
            assert_eq!(frame.len(), HEADER_BYTES + ((meta_len + 3) & !3) + 32 * 24 * 4 * planes, "{p}");
        }
        // The cone's apex is a peak; its flanks drain outward.
        let r = Request::new(&Raw {
            product: "geomorphons",
            scale: "fine",
            width: 32.0,
            height: 24.0,
            resolution: 2.0,
            day: None,
            lat: None,
            wind: None,
        })
        .unwrap();
        assert_eq!(run(&r, &grid).unwrap().0.data[12 * 32 + 16], 2.0);
    }
}
