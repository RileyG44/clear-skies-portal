//! WA DNR lidar (lidarportal.dnr.wa.gov): the project catalogue and
//! coverage, the hillshade export proxy and the file query. Catalogue
//! bounding boxes are candidates, never pixel provenance; a failed lookup
//! is unknown coverage, never "none".
//!
//! Direct acquisition, ingestion and elevation tiles live in `dnr_local`
//! and `dnr_routes`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use csk_store::{Kind, now_ms};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Engine;
use crate::flight::Flights;
use crate::proxies::{is_png, valid_merc_bbox};
use crate::router::{Request, Response};
use crate::transport::FetchRequest;
use crate::usgs::catalog::encode_component;

pub const HOST: &str = "lidarportal.dnr.wa.gov";
const MAP: &str = "/arcgis/rest/services/lidar/wadnr_hillshade/MapServer";
const CATALOG_KEY: &str = "dnr.catalog";
const CATALOG_TTL: Duration = Duration::from_secs(7 * 86400);
const RETRY: Duration = Duration::from_secs(30);
const TTL_TILE: Duration = Duration::from_secs(90 * 24 * 3600);
const TTL_META: Duration = Duration::from_secs(7 * 24 * 3600);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub name: String,
    pub year: i32,
    /// West, south, east, north in degrees.
    pub bounds: [f64; 4],
    /// Hillshade map layer ids.
    pub dtm: Option<i64>,
    pub dsm: Option<i64>,
    /// The DTM raster dataset for acquisition.
    #[serde(rename = "dtmDataset")]
    pub dtm_dataset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Catalog {
    pub at: i64,
    pub projects: Vec<Project>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stale: bool,
}

#[derive(Default)]
pub struct Dnr {
    catalog: Mutex<Option<Catalog>>,
    retry_at: Mutex<Option<Instant>>,
    loading: Flights<u8, Result<Catalog, String>>,
}

fn intersects(a: &[f64; 4], b: &[f64; 4]) -> bool {
    a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}

/// Parses the portal's `/project` list and hillshade layer list.
pub fn parse_catalog(projects: &Value, layers: &Value) -> Option<Vec<Project>> {
    let projects = projects.as_array()?;
    let layers = layers.get("layers")?.as_array()?;
    let id_of = |name: Option<&str>| {
        let name = name?;
        layers
            .iter()
            .find(|l| l["type"] == "Raster Layer" && l["name"].as_str() == Some(name))
            .and_then(|l| l["id"].as_i64())
    };
    let mut rows: Vec<Project> = projects
        .iter()
        .filter_map(|p| {
            let datasets = p["datasets"].as_array()?;
            let find = |n: &str| datasets.iter().find(|d| d["name"] == n);
            let (dtm, shade, dsm) = (find("DTM"), find("DTM Hillshade"), find("DSM Hillshade"));
            let extent = dtm.or(shade).or(dsm)?;
            let b = [
                extent["XMin"].as_f64()?,
                extent["YMin"].as_f64()?,
                extent["XMax"].as_f64()?,
                extent["YMax"].as_f64()?,
            ];
            if !b.iter().all(|v| v.is_finite()) {
                return None;
            }
            let name = p["name"].as_str()?.to_owned();
            let year = name
                .trim_end()
                .rsplit(|c: char| !c.is_ascii_digit())
                .next()
                .filter(|y| y.len() >= 4)
                .and_then(|y| y[y.len() - 4..].parse().ok())
                .unwrap_or(0);
            Some(Project {
                year,
                bounds: b,
                dtm: id_of(shade.and_then(|d| d["layers"].as_str())),
                dsm: id_of(dsm.and_then(|d| d["layers"].as_str())),
                dtm_dataset: dtm.and_then(|d| d["ID"].as_i64()),
                name,
            })
        })
        .collect();
    rows.sort_by(|a, b| b.year.cmp(&a.year).then_with(|| a.name.cmp(&b.name)));
    Some(rows)
}

impl Engine {
    async fn dnr_json(&self, path: &str, form: Option<String>) -> Result<Value, String> {
        let url = format!("https://{HOST}{path}");
        let req = match form {
            Some(f) => FetchRequest::post_form(url, f),
            None => FetchRequest::get(url),
        }
        .timeout(Duration::from_secs(30))
        .max_body(8 << 20);
        let r = self.upstream.fetch(req).await.map_err(|e| e.to_string())?;
        if r.status != 200 {
            return Err(format!("DNR metadata HTTP {}", r.status));
        }
        serde_json::from_slice(&r.body).map_err(|_| "DNR returned invalid metadata".to_owned())
    }

    /// The project catalogue: memory, then the store, then the portal. A
    /// failed refresh serves the previous catalogue marked stale.
    pub async fn dnr_catalog(self: &Arc<Self>) -> Result<Catalog, String> {
        let fresh = |c: &Catalog| now_ms() - c.at < CATALOG_TTL.as_millis() as i64;
        if let Some(c) = self.dnr.catalog.lock().unwrap_or_else(|e| e.into_inner()).clone()
            && fresh(&c)
        {
            return Ok(c);
        }
        let previous: Option<Catalog> =
            self.store.kv_get(CATALOG_KEY).ok().flatten().and_then(|(v, _)| serde_json::from_str(&v).ok());
        if let Some(p) = &previous
            && fresh(p)
        {
            *self.dnr.catalog.lock().unwrap_or_else(|e| e.into_inner()) = Some(p.clone());
            return Ok(p.clone());
        }
        let waiting = self.dnr.retry_at.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|t| Instant::now() < t);
        if waiting {
            return previous
                .map(|p| Catalog { stale: true, ..p })
                .ok_or_else(|| "DNR catalogue lookup is temporarily unavailable".to_owned());
        }
        let me = self.clone();
        let loaded = self
            .dnr
            .loading
            .run(0, move || async move {
                let layers_path = format!("{MAP}/layers?f=json");
                let (projects, layers) = tokio::join!(me.dnr_json("/project", None), me.dnr_json(&layers_path, None));
                let (projects, layers) = (projects?, layers?);
                if layers.get("error").is_some() {
                    return Err("Invalid DNR catalogue".to_owned());
                }
                let rows = parse_catalog(&projects, &layers).ok_or("Invalid DNR catalogue")?;
                let c = Catalog { at: now_ms(), projects: rows, stale: false };
                let _ = me.store.kv_put(CATALOG_KEY, &serde_json::to_string(&c).unwrap_or_default());
                Ok(c)
            })
            .await
            .unwrap_or_else(|| Err("DNR catalogue lookup stopped".into()));
        match loaded {
            Ok(c) => {
                *self.dnr.catalog.lock().unwrap_or_else(|e| e.into_inner()) = Some(c.clone());
                *self.dnr.retry_at.lock().unwrap_or_else(|e| e.into_inner()) = None;
                Ok(c)
            }
            Err(e) => {
                *self.dnr.retry_at.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now() + RETRY);
                previous.map(|p| Catalog { stale: true, ..p }).ok_or(e)
            }
        }
    }

    /// Local DNR rasters and acquisition.
    pub fn dnr_status(&self) -> Value {
        self.dnr_local.status()
    }
}

fn parse_bbox(v: &str) -> Option<[f64; 4]> {
    let b: Vec<f64> = v.split(',').map(|x| x.trim().parse::<f64>()).collect::<Result<_, _>>().ok()?;
    let ok = b.len() == 4
        && b.iter().all(|x| x.is_finite())
        && b[0] >= -180.0
        && b[2] <= 180.0
        && b[1] >= -85.051129
        && b[3] <= 85.051129
        && b[0] < b[2]
        && b[1] < b[3];
    ok.then(|| [b[0], b[1], b[2], b[3]])
}

pub async fn coverage(engine: &Arc<Engine>, req: &Request) -> Response {
    let Some(bbox) = req.param("bbox").and_then(parse_bbox) else {
        return Response::json(400, &json!({"error": "bbox=w,s,e,n required"}));
    };
    match engine.dnr_catalog().await {
        Ok(c) => Response::json(
            200,
            &json!({"state": if c.stale { "stale" } else { "ready" }, "basis": "catalogue candidates", "checked": c.at,
                    "projects": c.projects.iter().filter(|p| intersects(&p.bounds, &bbox)).collect::<Vec<_>>(),
                    "elevation": engine.dnr_status()}),
        )
        .header("Cache-Control", "no-store"),
        Err(e) => Response::json(503, &json!({"state": "error", "error": e}))
            .header("Cache-Control", "no-store")
            .header("Retry-After", "30"),
    }
}

pub fn status(engine: &Arc<Engine>) -> Response {
    Response::json(200, &engine.dnr_status()).header("Cache-Control", "no-store")
}

/// `POST /api/wadnr/query`: which DNR files cover this polygon.
pub async fn query(engine: &Arc<Engine>, req: &Request) -> Response {
    let text = String::from_utf8_lossy(&req.body).into_owned();
    let Ok(geometry) = serde_json::from_str::<Value>(&text) else {
        return Response::json(400, &json!({"error": "valid GeoJSON required"}));
    };
    if geometry["type"] != "Polygon" || !geometry["coordinates"].as_array().is_some_and(|c| !c.is_empty()) {
        return Response::json(400, &json!({"error": "GeoJSON Polygon required"}));
    }
    let key = format!("wadnr:query:{text}");
    if let Ok(Some(hit)) = engine.store.get(&key, TTL_META) {
        return Response::new(200, &hit.media, hit.body).header("X-Cache", "HIT");
    }
    let form = format!("geojson={}", encode_component(&text));
    let req = FetchRequest::post_form(format!("https://{HOST}/query"), form)
        .timeout(Duration::from_secs(30))
        .max_body(8 << 20);
    match engine.upstream.fetch(req).await {
        Ok(r) if r.status == 200 && serde_json::from_slice::<Value>(&r.body).is_ok_and(|v| v.is_array()) => {
            let media = r.header("content-type").unwrap_or("application/json").to_owned();
            let _ = engine.store.put(&key, Kind::Source, 200, &media, None, &r.body);
            Response::new(200, &media, r.body).header("X-Cache", "MISS")
        }
        _ => {
            Response::json(503, &json!({"state": "error", "error": "DNR coverage lookup failed; coverage is unknown"}))
                .header("X-Cache", "ERROR")
                .header("Cache-Control", "no-store")
                .header("Retry-After", "30")
        }
    }
}

/// `GET /api/wadnr/export`: a hillshade image restricted to given layers.
pub async fn export(engine: &Arc<Engine>, req: &Request) -> Response {
    let bbox = req.param("bbox").unwrap_or("");
    let size = req.param("size").unwrap_or("256,256");
    let layers = req.param("layers").unwrap_or("");
    let dims: Option<(u32, u32)> = size.split_once(',').and_then(|(a, b)| Some((a.parse().ok()?, b.parse().ok()?)));
    // A larger export keeps the scale of a 256 px one: DNR's hillshade is a
    // tile cache, and one level finer than it holds comes back as Esri's
    // "Map data not yet available" stamp.
    let dpi: Option<i64> = match req.param("dpi") {
        Some(d) => d.parse::<f64>().ok().filter(|v| v.fract() == 0.0).map(|v| v as i64),
        None => Some(dims.map_or(96, |(w, _)| (96.0 * f64::from(w) / 256.0 + 0.5).floor() as i64)),
    };
    let layers_ok = layers.is_empty()
        || (layers.split(',').all(|l| !l.is_empty() && l.bytes().all(|c| c.is_ascii_digit()))
            && layers.split(',').count() <= 14);
    let (Some((w, h)), Some(dpi)) = (dims, dpi) else { return Response::json(400, &json!({"error": "bad params"})) };
    if !valid_merc_bbox(bbox)
        || !(1..=1024).contains(&w)
        || !(1..=1024).contains(&h)
        || !(24..=384).contains(&dpi)
        || !layers_ok
    {
        return Response::json(400, &json!({"error": "bad params"}));
    }
    let qp = |size: &str, dpi: i64| {
        let mut q = format!(
            "?bbox={bbox}&bboxSR=3857&imageSR=3857&size={size}&format=png32&transparent=true&dpi={dpi}&f=image"
        );
        if !layers.is_empty() {
            q += &format!("&layers=show:{layers}");
        }
        q
    };
    let key = format!("wadnr:export:{}", qp(size, dpi));
    if let Ok(Some(hit)) = engine.store.get(&key, TTL_TILE) {
        return Response::new(200, &hit.media, hit.body)
            .header("X-Cache", "HIT")
            .header("Cache-Control", "public, max-age=604800");
    }
    let url = format!("https://{HOST}{MAP}/export{}", qp(size, dpi));
    match engine.upstream.fetch(FetchRequest::get(url).timeout(Duration::from_secs(30)).max_body(8 << 20)).await {
        Ok(r) if r.status == 200 && is_png(&r.body) => {
            let _ = engine.store.put(&key, Kind::Source, 200, "image/png", None, &r.body);
            Response::new(200, "image/png", r.body)
                .header("X-Cache", "MISS")
                .header("Cache-Control", "public, max-age=604800")
        }
        _ => {
            // Offline: a high-density request can still use the 256 px copy.
            if size != "256,256"
                && let Ok(Some(low)) = engine.store.get(&format!("wadnr:export:{}", qp("256,256", 96)), TTL_TILE)
            {
                return Response::new(200, &low.media, low.body)
                    .header("X-Cache", "HIT-256")
                    .header("Cache-Control", "no-store");
            }
            // An upstream failure is not an empty tile: keep it retryable.
            Response::new(204, "image/png", Vec::new())
                .header("X-Cache", "ERROR")
                .header("X-CSP-Error", "upstream")
                .header("Cache-Control", "no-store")
                .header("Retry-After", "2")
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_the_portal_catalogue() {
        let projects = serde_json::json!([
            {"name": "Olympics 2019", "datasets": [
                {"name": "DTM", "ID": 77, "XMin": -124.0, "YMin": 47.5, "XMax": -123.0, "YMax": 48.0},
                {"name": "DTM Hillshade", "layers": "olympics_2019_hh", "XMin": -124.0, "YMin": 47.5, "XMax": -123.0, "YMax": 48.0}]},
            {"name": "No data", "datasets": []}
        ]);
        let layers = serde_json::json!({"layers": [{"type": "Raster Layer", "name": "olympics_2019_hh", "id": 12}]});
        let rows = super::parse_catalog(&projects, &layers).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].year, rows[0].dtm, rows[0].dtm_dataset), (2019, Some(12), Some(77)));
    }
}
