//! `LocalEngine`: the engine's HTTP surface, answered in-process. Routes,
//! statuses and headers match the Node engine (docs/native/ROUTES.md) so the
//! web client runs unchanged; `/api/elev32/…` is the float32 path the client
//! uses when this engine is built in (ARCHITECTURE.md §4.3, R8).

use std::sync::Arc;

use csk_core::elev32;
use csk_core::raster::{self, png, terrarium};
use serde_json::json;

use crate::Engine;
use crate::tiles::{Baseline, Grid, Lidar, Meta};
use crate::usgs::catalog::encode_component;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    /// Path, percent-decoded.
    pub path: String,
    /// Query pairs, percent-decoded.
    pub query: Vec<(String, String)>,
    /// Header names lower-cased.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    /// Parses a request target (`/api/x?y=z`). `None` for invalid encoding.
    pub fn new(method: &str, target: &str, body: Vec<u8>) -> Option<Self> {
        let target = target.split_once("://").map_or(target, |(_, rest)| rest.find('/').map_or("/", |i| &rest[i..]));
        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        let path = percent_encoding::percent_decode_str(path).decode_utf8().ok()?.into_owned();
        let query = query
            .split('&')
            .filter(|p| !p.is_empty())
            .map(|p| {
                let (k, v) = p.split_once('=').unwrap_or((p, ""));
                let dec = |s: &str| {
                    percent_encoding::percent_decode_str(&s.replace('+', " ")).decode_utf8_lossy().into_owned()
                };
                (dec(k), dec(v))
            })
            .collect();
        Some(Self { method: method.to_ascii_uppercase(), path, query, headers: Vec::new(), body })
    }

    /// Adds headers from `Name: value` lines.
    pub fn with_header_lines(mut self, lines: &str) -> Self {
        self.headers = lines
            .lines()
            .filter_map(|l| l.split_once(':'))
            .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
            .collect();
        self
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    pub fn param(&self, name: &str) -> Option<&str> {
        self.query.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Follows response bytes through the platform's zero-copy buffer owner.
    pub reservation: Option<csk_core::resource::Reservation>,
}

impl Response {
    pub fn new(status: u16, media: &str, body: Vec<u8>) -> Self {
        Self { status, headers: vec![("Content-Type".into(), media.into())], body, reservation: None }
    }

    pub fn json(status: u16, value: &serde_json::Value) -> Self {
        Self::new(status, "application/json", serde_json::to_vec(value).expect("JSON serialises"))
    }

    pub fn text(status: u16, text: &str) -> Self {
        Self::new(status, "text/plain", text.as_bytes().to_vec())
    }

    pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn headers<I: IntoIterator<Item = (String, String)>>(mut self, h: I) -> Self {
        self.headers.extend(h);
        self
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

const IMMUTABLE: &str = "public, max-age=604800, immutable";
const NO_STORE: &str = "no-store";

/// How a tile goes over the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wire {
    /// Terrarium PNG for image consumers.
    Png,
    /// float32 metres, `application/vnd.clearskies.elev32`.
    Elev32,
}

fn encode(grid: &Grid, wire: Wire) -> (Vec<u8>, &'static str) {
    let s = grid.size();
    let interior = grid.interior();
    match wire {
        Wire::Png => (png::encode_rgba(&terrarium::encode(&interior), u32::from(s), u32::from(s)), "image/png"),
        Wire::Elev32 => (elev32::encode(s, s, &interior), elev32::MEDIA_TYPE),
    }
}

fn tile(grid: &Grid, wire: Wire) -> Response {
    let (body, media) = encode(grid, wire);
    Response::new(200, media, body)
}

/// "Nothing here" for an image route, or 204 for float32 (NaN everywhere
/// carries no information; the client decides how to fill it).
fn empty(wire: Wire, terrain_geometry: bool) -> Response {
    match wire {
        Wire::Elev32 => Response::new(204, elev32::MEDIA_TYPE, Vec::new()),
        Wire::Png if terrain_geometry => Response::new(200, "image/png", raster::sea_level_png().to_vec()),
        Wire::Png => Response::new(200, "image/png", raster::transparent_png().to_vec()),
    }
}

fn busy(wire: Wire, retry: u32) -> Response {
    let r = match wire {
        Wire::Png => Response::new(503, "image/png", raster::transparent_png().to_vec()),
        Wire::Elev32 => Response::new(503, elev32::MEDIA_TYPE, Vec::new()),
    };
    r.header("Cache-Control", NO_STORE).header("Retry-After", retry.to_string())
}

fn federal_headers(meta: &Meta) -> Vec<(String, String)> {
    let mut h = Vec::new();
    if let Some(c) = meta.coverage {
        h.push(("X-Coverage".into(), c.to_string()));
    }
    if let Some(g) = meta.ground_res {
        h.push(("X-Ground-Res".into(), g.to_string()));
    }
    let sources = serde_json::to_string(&meta.sources).unwrap_or_else(|_| "[]".into());
    h.push(("X-USGS-Sources".into(), encode_component(&sources)));
    h
}

fn sources_list(meta: &Meta) -> String {
    meta.sources.iter().map(|s| format!("{}@{}m", s.project, s.res)).collect::<Vec<_>>().join(",")
}

/// `/<prefix>/<z>/<x>/<y><suffix>` with valid coordinates.
pub(crate) fn tile_coords(path: &str, prefix: &str, suffix: &str, max_z: u8) -> Option<(u8, u32, u32)> {
    let rest = path.strip_prefix(prefix)?.strip_suffix(suffix)?;
    let mut it = rest.split('/');
    let (z, x, y) = (it.next()?, it.next()?, it.next()?);
    if it.next().is_some() || [z, x, y].iter().any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    let z: u8 = z.parse().ok()?;
    let (x, y): (u64, u64) = (x.parse().ok()?, y.parse().ok()?);
    let limit = 1u64 << z.min(31);
    if z > max_z || x >= limit || y >= limit {
        return None;
    }
    Some((z, x as u32, y as u32))
}

fn bad_tile() -> Response {
    Response::text(400, "bad tile coordinates")
}

pub async fn handle(engine: &Arc<Engine>, req: Request) -> Response {
    let p = req.path.as_str();
    if !(p == "/api" || p.starts_with("/api/")) {
        return Response::text(404, "not found");
    }
    if req.method == "OPTIONS" {
        return Response::new(204, "text/plain", Vec::new())
            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .header("Access-Control-Allow-Headers", "Content-Type")
            .header("Access-Control-Max-Age", "86400");
    }
    // Markup is user state with its own methods; everything else reads.
    if p == "/api/markup" || p.starts_with("/api/markup/") {
        let user = engine.user.clone();
        let req = req.clone();
        return tokio::task::spawn_blocking(move || crate::markup::handle(&user, &req))
            .await
            .unwrap_or_else(|_| Response::json(500, &json!({"error": "markup handler stopped"})));
    }
    // Routes that change state take POST.
    let post = |r: Response| {
        if req.method == "POST" {
            r
        } else {
            Response::json(405, &json!({"error": "method not allowed"})).header("Allow", "POST")
        }
    };
    match p {
        "/api/usgs/warm" => return post(crate::areas::start(engine, &req)),
        "/api/usgs/warm/stop" => return post(crate::areas::stop(engine)),
        "/api/usgs/check" if req.method == "POST" => return crate::areas::fresh(engine, &req).await,
        "/api/wadnr/query" => {
            return if req.method == "POST" {
                crate::dnr::query(engine, &req).await
            } else {
                post(Response::new(405, "text/plain", Vec::new()))
            };
        }
        "/api/wadnr/warm" if req.method == "POST" => return crate::dnr_routes::warm_start(engine, &req),
        "/api/wadnr/warm/stop" if req.method == "POST" => return crate::dnr_routes::warm_stop(engine, &req),
        "/api/wadnr/warm" | "/api/wadnr/warm/stop" => return post(Response::new(405, "text/plain", Vec::new())),
        "/api/terrain/analyze" => {
            return if req.method == "POST" {
                crate::analysis::analyze(engine, &req).await
            } else {
                post(Response::new(405, "text/plain", Vec::new()))
            };
        }
        // WA DNR areas arrive with the DNR source (phase 4).
        "/api/warm" | "/api/warm/stop" if req.method == "POST" => {
            return Response::json(
                501,
                &json!({"error": "WA DNR downloads are not available in the built-in engine yet."}),
            );
        }
        _ => {}
    }
    if req.method != "GET" && req.method != "HEAD" {
        return Response::json(405, &json!({"error": "method not allowed"})).header("Allow", "GET");
    }
    let mut res = route(engine, &req).await;
    if req.method == "HEAD" {
        res.body.clear();
    }
    res
}

async fn route(engine: &Arc<Engine>, req: &Request) -> Response {
    let p = req.path.as_str();
    match p {
        "/api/health" => return engine.health().header("Cache-Control", NO_STORE),
        "/api/usgs/cover" => return cover(engine, req).await,
        "/api/usgs/index" => return index(engine, req).await,
        "/api/usgs/warm/status" => {
            return Response::json(200, &serde_json::to_value(engine.downloads.status()).unwrap_or_default());
        }
        "/api/usgs/areas" => return crate::areas::areas(engine),
        "/api/usgs/areas/check" => return crate::areas::check(engine, req.param("id")).await,
        "/api/usgs/plan" => return crate::areas::plan(req),
        "/api/warm/status" => {
            return Response::json(200, &serde_json::to_value(crate::areas::Progress::default()).unwrap_or_default());
        }
        "/api/warm/areas" | "/api/warm/check" => return Response::json(200, &json!([])),
        "/api/usgs/fabric" | "/api/wadnr/fabric" => return fabric(engine, req).await,
        "/api/wadnr/coverage" => return crate::dnr::coverage(engine, req).await,
        "/api/wadnr/status" => return crate::dnr::status(engine),
        "/api/wadnr/export" => return crate::dnr::export(engine, req).await,
        "/api/wadnr/warm/status" => return crate::dnr_routes::warm_status(engine),
        "/api/3dep" => return crate::proxies::dep(engine, req).await,
        "/api/snow" => return crate::proxies::snow(engine, req).await,
        "/api/firms" => return crate::proxies::firms(engine, req).await,
        "/api/reference/nhd" => return crate::proxies::hydro(engine, req).await,
        "/api/snapshot/image" => return crate::proxies::snapshot(engine, req).await,
        _ => {}
    }
    if p.starts_with("/api/wadnr/elev/") || p.starts_with("/api/elev32/wadnr/") {
        let float32 = p.starts_with("/api/elev32/");
        let (prefix, suffix) = if float32 { ("/api/elev32/wadnr/", "") } else { ("/api/wadnr/elev/", ".png") };
        let Some((z, x, y)) = tile_coords(p, prefix, suffix, 18) else {
            return Response::json(400, &json!({"error": "bad DNR elevation tile path"}));
        };
        return crate::dnr_routes::elevation(engine, req, z, x, y, float32).await;
    }
    if let Some(rest) = p.strip_prefix("/api/usgs/tile/") {
        return styled(engine, rest).await;
    }
    if p.starts_with("/api/geo/") {
        return crate::proxies::geology(engine, req).await;
    }
    // Longest prefixes first, as server.js orders them.
    if p.starts_with("/api/elev32/") {
        for (prefix, which) in [
            ("/api/elev32/usgs/", Which::Lidar),
            ("/api/elev32/national/", Which::National),
            ("/api/elev32/overview/", Which::Overview),
            ("/api/elev32/", Which::Best),
        ] {
            if p.starts_with(prefix) {
                let max = if which == Which::Overview { 15 } else { 22 };
                let Some((z, x, y)) = tile_coords(p, prefix, "", max) else { return bad_tile() };
                return serve(engine, which, Wire::Elev32, z, x, y).await;
            }
        }
    }
    for (prefix, which, max) in [
        ("/api/elev/overview/", Which::Overview, 15),
        ("/api/elev/national/", Which::National, 22),
        ("/api/usgs/elev/", Which::Lidar, 22),
        ("/api/elev/", Which::Best, 22),
    ] {
        if p.starts_with(prefix) {
            let Some((z, x, y)) = tile_coords(p, prefix, ".png", max) else { return bad_tile() };
            return serve(engine, which, Wire::Png, z, x, y).await;
        }
    }
    Response::json(501, &json!({"error": "This route is not available in the built-in engine yet.", "route": p}))
        .header("Cache-Control", NO_STORE)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Which {
    Best,
    Lidar,
    National,
    Overview,
}

async fn serve(engine: &Arc<Engine>, which: Which, wire: Wire, z: u8, x: u32, y: u32) -> Response {
    match which {
        Which::Lidar => lidar(engine, wire, z, x, y).await,
        Which::National => national(engine, wire, z, x, y).await,
        Which::Overview => overview(engine, wire, z, x, y).await,
        Which::Best => best(engine, wire, z, x, y).await,
    }
}

/// Terrain drawn from 1 m lidar: `/api/usgs/tile/<style>/<z>/<x>/<y>.png`.
/// The elevation grid is what is cached; drawing it takes a few ms.
async fn styled(engine: &Arc<Engine>, rest: &str) -> Response {
    const TILE_STYLES: &[&str] = &["hs", "hsmulti", "tint", "slope", "aspect", "c2", "c5", "c10", "c25"];
    let Some((style, coords)) = rest.split_once('/') else { return Response::text(400, "bad tile path") };
    let Some((z, x, y)) = tile_coords(&format!("/{coords}"), "/", ".png", 22) else {
        return Response::text(400, "bad tile coordinates or style");
    };
    if !TILE_STYLES.contains(&style) {
        return Response::text(400, "bad tile coordinates or style");
    }
    let draw = |grid: &Grid, meta: &Meta| {
        let surface = csk_core::raster::style::Surface {
            grid: &grid.values,
            side: usize::from(grid.side),
            skirt: grid.skirt,
            ground_res: meta.ground_res.unwrap_or(1.0),
        };
        let rgba = csk_core::raster::style::render(style, &surface, Default::default());
        let s = u32::from(grid.size());
        Response::new(200, "image/png", png::encode_rgba(&rgba, s, s)).headers(federal_headers(meta))
    };
    match engine.tiles.lidar(z, x, y).await {
        Lidar::Tile { grid, meta, hit } => draw(&grid, &meta)
            .header("X-Sources", sources_list(&meta))
            .header("X-Cache", if hit { "hit" } else { "miss" })
            .header("Cache-Control", IMMUTABLE),
        Lidar::None => empty(Wire::Png, false).header("X-Coverage", "none").header("Cache-Control", IMMUTABLE),
        Lidar::Provisional => busy(Wire::Png, 10).header("X-Coverage", "unknown"),
        Lidar::Failed { stale: Some((grid, meta)) } => draw(&grid, &meta)
            .header("X-Cache", "saved-fallback")
            .header("X-CSP-Provisional", "1")
            .header("Cache-Control", NO_STORE),
        Lidar::Failed { stale: None } => busy(Wire::Png, 2).header("X-Cache", "BUSY"),
    }
}

/// 1 m lidar only (`/api/usgs/elev`): the client composes it over the
/// baseline itself.
async fn lidar(engine: &Arc<Engine>, wire: Wire, z: u8, x: u32, y: u32) -> Response {
    match engine.tiles.lidar(z, x, y).await {
        Lidar::Tile { grid, meta, hit } => tile(&grid, wire)
            .headers(federal_headers(&meta))
            .header("X-Sources", sources_list(&meta))
            .header("X-Elevation-Source", "usgs-1m")
            .header("X-Cache", if hit { "hit" } else { "miss" })
            .header("Cache-Control", IMMUTABLE),
        Lidar::None => empty(wire, false).header("X-Coverage", "none").header("Cache-Control", IMMUTABLE),
        Lidar::Provisional => busy(wire, 10).header("X-Coverage", "unknown"),
        Lidar::Failed { stale: Some((grid, meta)) } => tile(&grid, wire)
            .headers(federal_headers(&meta))
            .header("X-Elevation-Source", "usgs-1m")
            .header("X-Cache", "saved-fallback")
            .header("X-CSP-Provisional", "1")
            .header("Cache-Control", NO_STORE),
        Lidar::Failed { stale: None } => busy(wire, 2).header("X-Cache", "BUSY"),
    }
}

async fn national(engine: &Arc<Engine>, wire: Wire, z: u8, x: u32, y: u32) -> Response {
    match engine.tiles.baseline(z, x, y).await {
        Baseline::Tile { grid, coverage, hit } => tile(&grid, wire)
            .header("X-Coverage", coverage.to_string())
            .header("X-Elevation-Source", "3dep")
            .header("X-Cache", if hit { "hit" } else { "miss" })
            .header("Cache-Control", IMMUTABLE),
        Baseline::None => empty(wire, false)
            .header("X-Coverage", "none")
            .header("X-Elevation-Source", "none")
            .header("Cache-Control", IMMUTABLE),
        Baseline::Failed { circuit_open } => busy(wire, if circuit_open { 15 } else { 2 })
            .header("X-Cache", "BUSY")
            .header("X-Elevation-Source", "fallback"),
    }
}

/// The best ground for a tile (`/api/elev`): raw 1 m where it exists
/// (z ≥ 13), else national 3DEP, else sea level.
async fn best(engine: &Arc<Engine>, wire: Wire, z: u8, x: u32, y: u32) -> Response {
    let mut raw_failed = false;
    let mut stale_raw = None;
    if z >= crate::tiles::RAW_MIN_ZOOM {
        match engine.tiles.lidar(z, x, y).await {
            Lidar::Tile { grid, meta, hit } => {
                return tile(&grid, wire)
                    .headers(federal_headers(&meta))
                    .header("X-Elevation-Source", "usgs-1m")
                    .header("X-Cache", if hit { "hit" } else { "miss" })
                    .header("Cache-Control", IMMUTABLE);
            }
            Lidar::None => {}
            // Unknown coverage or a failed read: serve the baseline now, but
            // never as this tile's lasting answer.
            Lidar::Provisional => raw_failed = true,
            Lidar::Failed { stale } => {
                raw_failed = true;
                stale_raw = stale;
            }
        }
    }
    let keep = if raw_failed { NO_STORE } else { IMMUTABLE };
    match engine.tiles.baseline(z, x, y).await {
        Baseline::Tile { grid, coverage, hit } => tile(&grid, wire)
            .header("X-Coverage", coverage.to_string())
            .header("X-Elevation-Source", "3dep")
            .header(
                "X-Cache",
                if raw_failed {
                    "raw-failed"
                } else if hit {
                    "hit"
                } else {
                    "miss"
                },
            )
            .header("Cache-Control", keep),
        // Sea level, not transparent: this tile is terrain geometry.
        Baseline::None => empty(wire, true)
            .header("X-Coverage", "none")
            .header("X-Elevation-Source", "none")
            .header("Cache-Control", keep),
        Baseline::Failed { circuit_open } => match stale_raw {
            // Offline over ground seen before: the stored 1 m is the best there is.
            Some((grid, meta)) => tile(&grid, wire)
                .headers(federal_headers(&meta))
                .header("X-Cache", "saved-fallback")
                .header("X-Elevation-Source", "usgs-1m")
                .header("Cache-Control", NO_STORE),
            None => busy(wire, if circuit_open { 15 } else { 2 })
                .header("X-Cache", "BUSY")
                .header("X-Elevation-Source", "fallback"),
        },
    }
}

/// The global Terrarium overview (AWS open data), cached verbatim.
async fn overview(engine: &Arc<Engine>, wire: Wire, z: u8, x: u32, y: u32) -> Response {
    let (png_bytes, hit) = match engine.overview(z, x, y).await {
        Ok(v) => v,
        Err(_) => return Response::text(502, "overview elevation unavailable").header("Cache-Control", NO_STORE),
    };
    let base = |r: Response| {
        r.header("X-Elevation-Source", "overview")
            .header("X-Cache", if hit { "hit" } else { "miss" })
            .header("Cache-Control", "public, max-age=604800")
    };
    match wire {
        Wire::Png => base(Response::new(200, "image/png", png_bytes)),
        Wire::Elev32 => match png::decode_rgba(&png_bytes) {
            Some((w, h, rgba)) => {
                let grid = terrarium::decode(&rgba);
                base(Response::new(200, elev32::MEDIA_TYPE, elev32::encode(w as u16, h as u16, &grid)))
            }
            None => Response::text(502, "overview elevation unreadable").header("Cache-Control", NO_STORE),
        },
    }
}

/// Landform fabric over the view (`/api/usgs/fabric`). Without local DNR
/// rasters the DNR variant measures the same 1 m surface.
async fn fabric(engine: &Arc<Engine>, req: &Request) -> Response {
    let b: Vec<f64> = req.param("bbox").unwrap_or("").split(',').filter_map(|v| v.trim().parse().ok()).collect();
    let ok = b.len() == 4
        && b.iter().all(|v| v.is_finite())
        && b[0] >= -180.0
        && b[2] <= 180.0
        && b[1] >= -85.051129
        && b[3] <= 85.051129
        && b[0] < b[2]
        && b[1] < b[3]
        && b[2] - b[0] <= 5.0
        && b[3] - b[1] <= 5.0;
    if !ok {
        return Response::json(400, &json!({"error": "bbox=w,s,e,n in degrees"}));
    }
    let num = |k: &str| req.param(k).and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite()).unwrap_or(0.0);
    let zone = csk_core::geo::utm_zone((b[0] + b[2]) / 2.0);
    let corners = [(b[0], b[1]), (b[2], b[1]), (b[0], b[3]), (b[2], b[3])]
        .map(|(x, y)| csk_core::geo::lon_lat_to_utm(x, y, zone));
    let (min_e, max_e) = corners.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, z), c| (a.min(c.0), z.max(c.0)));
    let (min_n, max_n) = corners.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, z), c| (a.min(c.1), z.max(c.1)));
    let n_req = num("n") as i64;
    let n = (if n_req == 0 { 192 } else { n_req }).clamp(48, 320) as usize;
    let res = ((max_e - min_e) / n as f64).max((max_n - min_n) / n as f64).max(1.0);
    let (lo, hi) = csk_science::fabric::band(res, num("lo"), num("hi"));
    match engine.tiles.usgs.sample_utm(min_e, min_n, res, n, zone).await {
        Ok(Some((grid, sources))) => {
            let v = tokio::task::spawn_blocking(move || {
                csk_science::fabric::measure(&grid, n, res, lo, hi, zone, &sources)
            })
            .await
            .unwrap_or_else(|_| json!({"ok": false, "reason": "measurement stopped"}));
            Response::json(200, &v).header("Cache-Control", "no-store")
        }
        Ok(None) => Response::json(200, &json!({"ok": false, "reason": "no 1 m coverage in this view", "zone": zone}))
            .header("Cache-Control", "no-store"),
        Err(e) => Response::json(503, &json!({"error": e.to_string()})),
    }
}

async fn cover(engine: &Arc<Engine>, req: &Request) -> Response {
    let parse = |k: &str| req.param(k).and_then(|v| v.trim().parse::<f64>().ok()).filter(|v| v.is_finite());
    // A missing parameter must not be answered for a point at 0°, 0°.
    let (Some(lat), Some(lon)) = (parse("lat"), parse("lon")) else {
        return Response::json(400, &json!({"error": "lat and lon required"}));
    };
    if lat.abs() > 90.0 || lon.abs() > 180.0 {
        return Response::json(400, &json!({"error": "lat and lon required"}));
    }
    match engine.tiles.usgs.find_cells(lon, lat).await {
        Ok((zone, e, n, cell, hits)) => Response::json(
            200,
            &json!({"zone": zone, "easting": e, "northing": n, "cell": cell.name(), "hits": hits,
                    "complete": engine.tiles.usgs.catalog.complete()}),
        )
        .header("Cache-Control", "max-age=3600"),
        Err(e) => Response::json(503, &json!({"error": e.to_string()})).header("Cache-Control", NO_STORE),
    }
}

async fn index(engine: &Arc<Engine>, req: &Request) -> Response {
    let catalog = &engine.tiles.usgs.catalog;
    let meta = if req.param("force") == Some("1") { catalog.build().await } else { catalog.ensure().await };
    let meta = match meta {
        Ok(m) => m,
        Err(e) => return Response::json(503, &json!({"error": e.to_string()})),
    };
    let mut projects: Vec<serde_json::Value> = catalog
        .summary()
        .unwrap_or_default()
        .into_iter()
        .map(|(p, tiles, bytes)| {
            json!({"project": p, "year": crate::usgs::catalog::project_year(&p), "tiles": tiles, "bytes": bytes})
        })
        .collect();
    projects.sort_by_key(|p| std::cmp::Reverse(p["year"].as_i64().unwrap_or(0)));
    let tiles: u64 = projects.iter().map(|p| p["tiles"].as_u64().unwrap_or(0)).sum();
    let bytes: u64 = projects.iter().map(|p| p["bytes"].as_u64().unwrap_or(0)).sum();
    Response::json(
        200,
        &json!({"built": meta.built, "scope": meta.scope, "complete": catalog.complete(), "failed": meta.failed,
                "totals": {"projects": projects.len(), "tiles": tiles, "bytes": bytes}, "projects": projects}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_targets_and_tiles() {
        let r = Request::new("get", "clearskies://app/api/usgs/cover?lat=46.8&lon=-121.7&x=a%20b", vec![]).unwrap();
        assert_eq!((r.method.as_str(), r.path.as_str()), ("GET", "/api/usgs/cover"));
        assert_eq!((r.param("lat"), r.param("x")), (Some("46.8"), Some("a b")));
        assert_eq!(tile_coords("/api/elev/13/1310/2862.png", "/api/elev/", ".png", 22), Some((13, 1310, 2862)));
        assert_eq!(tile_coords("/api/elev/1/2/0.png", "/api/elev/", ".png", 22), None);
        assert_eq!(tile_coords("/api/elev/23/0/0.png", "/api/elev/", ".png", 22), None);
        assert_eq!(tile_coords("/api/elev32/13/1310/2862", "/api/elev32/", "", 22), Some((13, 1310, 2862)));
        assert_eq!(tile_coords("/api/elev/13/-1/0.png", "/api/elev/", ".png", 22), None);
    }
}
