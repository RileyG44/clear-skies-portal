//! DOGAMI numeric primary terrain. Published raster overviews cannot enter
//! this path; project identity and vertical units must be established first.
use std::sync::Arc;
use std::time::Duration;

use csk_core::raster::{self, png, terrarium};
use csk_core::{codec::lerc, elev32, geo, resource::Reservation};
use csk_store::{Kind, pack_elevation, unpack_elevation};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::usgs::catalog::encode_component;
use crate::{Engine, Response, flight::Flights, transport::FetchRequest};

const HOST: &str = "gis.dogami.oregon.gov";
const SERVICE: &str = "/arcgis/rest/services/lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer";
const PROJECTS: &str = "/arcgis/rest/services/lidar/DOGAMI_Lidar_Project_Status/MapServer/1";
const VERSION: &str = "oregon-olc-v2";
const CATALOG_TTL: Duration = Duration::from_secs(600);
const SAMPLES: usize = 256 * 256;
const IMMUTABLE: &str = "public, max-age=604800, immutable";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    dataset_id: i64,
    project: String,
    provider: String,
    native_meters: f64,
    acquisition: Option<String>,
    vertical_datum: Option<String>,
    horizontal_datum: Option<String>,
    source_vertical_units: String,
    vertical_units: String,
    vertical_unit_basis: String,
    metadata_dataset_id: i64,
    #[serde(rename = "metadataURL")]
    metadata_url: Option<String>,
    order: f64,
    contribution: String,
}

struct Tile {
    values: Vec<f32>,
    sources: Vec<Source>,
    coverage: f64,
    hit: bool,
    _reservation: Reservation,
}

#[derive(Default)]
pub struct Oregon {
    catalogs: Flights<String, Result<Vec<Source>, String>>,
    tiles: Flights<String, Result<Arc<Tile>, String>>,
}

fn normalize(name: &str) -> String {
    name.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_uppercase()).collect()
}

fn text(value: &Value, key: &str) -> Option<String> {
    value[key].as_str().filter(|s| !s.is_empty() && s.len() <= 2048).map(str::to_owned)
}

pub fn select_sources(items: &[Value], projects: &[Value]) -> Vec<Source> {
    let mut selected = Vec::new();
    for item in items {
        let Some(id) = item["OBJECTID"].as_i64() else { continue };
        let Some(spacing) = item["LowPS"].as_f64().filter(|p| *p > 0. && p * 0.3048 <= 1.001) else { continue };
        if item["Category"].as_i64() != Some(1) {
            continue;
        }
        let Some(name) = text(item, "Name") else { continue };
        let name = normalize(&name);
        let mut matching = projects.iter().filter(|p| {
            text(p, "Project").is_some_and(|s| {
                let n = normalize(&s);
                !n.is_empty() && name.contains(&n)
            })
        });
        let Some(project) = matching.next() else { continue };
        if matching.next().is_some() {
            continue;
        }
        let Some(units) = text(project, "Vert_Units").filter(|s| s.eq_ignore_ascii_case("Feet")) else { continue };
        let cell = project["CELL_SIZE"].as_str().unwrap_or("");
        let parts: Vec<_> = cell.split_whitespace().collect();
        if parts.len() != 2 || parts[0] != "3" || !parts[1].eq_ignore_ascii_case("FOOT") {
            continue;
        }
        let Some(metadata_id) = project["OBJECTID"].as_i64() else { continue };
        selected.push(Source {
            dataset_id: id,
            project: text(project, "Project").unwrap(),
            provider: "Oregon DOGAMI".into(),
            native_meters: spacing * 0.3048,
            acquisition: text(project, "ACQ_DATES"),
            vertical_datum: text(project, "Vert_Datum"),
            horizontal_datum: text(project, "Horz_Datum"),
            source_vertical_units: units,
            vertical_units: "meters".into(),
            vertical_unit_basis: "DOGAMI completed OLC project metadata".into(),
            metadata_dataset_id: metadata_id,
            metadata_url: text(project, "Report"),
            order: item["ZOrder"].as_f64().unwrap_or(0.),
            contribution: "Selected primary mosaic raster; per-pixel contributor is not exposed by the service".into(),
        });
    }
    selected.sort_by(|a, b| a.native_meters.total_cmp(&b.native_meters).then(b.order.total_cmp(&a.order)));
    selected.truncate(8);
    selected
}

pub fn allowed(z: u8, x: u32, y: u32) -> bool {
    if !(13..=18).contains(&z) {
        return false;
    }
    let b = geo::tile_bounds_merc(z, x, y);
    let (west, south) = geo::merc_to_lon_lat(b.min_x, b.min_y);
    let (east, north) = geo::merc_to_lon_lat(b.max_x, b.max_y);
    west < -116.4 && east > -124.8 && north > 41.9 && south < 46.4
}

fn url(path: &str, params: &[(&str, String)]) -> String {
    let mut u = url::Url::parse(&format!("https://{HOST}{path}")).expect("static URL");
    u.query_pairs_mut().extend_pairs(params.iter().map(|(k, v)| (*k, v.as_str())));
    u.into()
}

fn spatial(z: u8, x: u32, y: u32) -> String {
    let b = geo::tile_bounds_merc(z, x, y);
    json!({"xmin": b.min_x, "ymin": b.min_y, "xmax": b.max_x, "ymax": b.max_y,
        "spatialReference": {"wkid": 3857}})
    .to_string()
}

async fn query(
    engine: &Engine,
    path: &str,
    geometry: &str,
    predicate: &str,
    fields: &str,
) -> Result<Vec<Value>, String> {
    let u = url(
        &format!("{path}/query"),
        &[
            ("f", "json".into()),
            ("returnGeometry", "false".into()),
            ("geometry", geometry.into()),
            ("geometryType", "esriGeometryEnvelope".into()),
            ("inSR", "3857".into()),
            ("spatialRel", "esriSpatialRelIntersects".into()),
            ("where", predicate.into()),
            ("outFields", fields.into()),
        ],
    );
    let r = engine
        .upstream
        .fetch(FetchRequest::get(u).timeout(Duration::from_secs(20)).max_body(2 << 20))
        .await
        .map_err(|e| e.to_string())?;
    if r.status != 200 {
        return Err(format!("DOGAMI catalogue HTTP {}", r.status));
    }
    let mut v: Value = serde_json::from_slice(&r.body).map_err(|e| e.to_string())?;
    if !v["error"].is_null() || v["exceededTransferLimit"].as_bool() == Some(true) {
        return Err("DOGAMI catalogue incomplete".into());
    }
    let features = v["features"].as_array_mut().ok_or("DOGAMI catalogue has no features")?;
    if features.iter().any(|f| !f["attributes"].is_object()) {
        return Err("DOGAMI catalogue has invalid attributes".into());
    }
    Ok(features.iter_mut().map(|f| f["attributes"].take()).collect())
}

async fn catalog(engine: &Arc<Engine>, z: u8, x: u32, y: u32) -> Result<Vec<Source>, String> {
    let dz = z.saturating_sub(12);
    let (z, x, y) = (z - dz, x >> dz, y >> dz);
    let key = format!("{VERSION}:catalog:{z}/{x}/{y}");
    let me = engine.clone();
    engine
        .oregon
        .catalogs
        .run(key.clone(), move || async move {
            let _scratch = me.memory.reserve(32 << 20).map_err(|e| e.to_string())?;
            if let Ok(Some(entry)) = me.store.get(&key, CATALOG_TTL)
                && let Ok(sources) = serde_json::from_slice::<Vec<Source>>(&entry.body)
            {
                return Ok(sources);
            }
            let geometry = spatial(z, x, y);
            let (items, projects) = tokio::try_join!(
                query(
                    &me,
                    SERVICE,
                    &geometry,
                    "Category = 1 AND LowPS <= 3.281",
                    "OBJECTID,Name,Category,LowPS,ZOrder"
                ),
                query(
                    &me,
                    PROJECTS,
                    &geometry,
                    "1=1",
                    "OBJECTID,Project,CELL_SIZE,Vert_Units,Vert_Datum,Horz_Datum,ACQ_DATES,Report"
                ),
            )?;
            let sources = select_sources(&items, &projects);
            let body = serde_json::to_vec(&sources).map_err(|e| e.to_string())?;
            let _ = me.store.put(&key, Kind::Source, 200, "application/json", None, &body);
            Ok(sources)
        })
        .await
        .ok_or("DOGAMI catalogue stopped")?
}

fn export_url(z: u8, x: u32, y: u32, sources: &[Source]) -> String {
    let b = geo::tile_bounds_merc(z, x, y);
    url(&format!("{SERVICE}/exportImage"), &[
        ("bbox", format!("{},{},{},{}", b.min_x, b.min_y, b.max_x, b.max_y)),
        ("bboxSR", "3857".into()), ("imageSR", "3857".into()), ("size", "256,256".into()),
        ("format", "lerc".into()), ("lercVersion", "2".into()), ("compressionTolerance", "0.001".into()),
        ("pixelType", "F32".into()), ("f", "image".into()), ("interpolation", "RSP_BilinearInterpolation".into()),
        ("renderingRule", json!({"rasterFunction": "None"}).to_string()),
        ("mosaicRule", json!({"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": sources.iter().map(|s| s.dataset_id).collect::<Vec<_>>(), "mosaicOperation": "MT_FIRST"}).to_string()),
    ])
}

#[derive(Serialize, Deserialize)]
struct Meta {
    sources: Vec<Source>,
    coverage: f64,
}

fn decode(raw: &[u8]) -> Result<(Vec<f32>, f64), String> {
    let mut raster = lerc::decode(raw, SAMPLES).map_err(|e| e.to_string())?;
    if raster.width != 256 || raster.height != 256 {
        return Err("DOGAMI returned an unexpected shape".into());
    }
    let mut valid = 0;
    for v in &mut raster.values {
        let metres = f64::from(*v) * 0.3048;
        *v = if metres.is_finite() && (-2000.0..=10000.0).contains(&metres) {
            valid += 1;
            metres as f32
        } else {
            f32::NAN
        };
    }
    Ok((raster.values, (valid as f64 / SAMPLES as f64 * 1000.).round() / 1000.))
}

async fn load(engine: &Arc<Engine>, z: u8, x: u32, y: u32) -> Result<Arc<Tile>, String> {
    let key = format!("{VERSION}:{z}/{x}/{y}");
    let me = engine.clone();
    engine
        .oregon
        .tiles
        .run(key.clone(), move || async move {
            let mut reservation = me.memory.reserve((SAMPLES * 48) + (2 << 20)).map_err(|e| e.to_string())?;
            if let Ok(Some(entry)) = me.store.get(&key, crate::tiles::TILE_TTL) {
                let meta = entry.meta.as_deref().and_then(|m| serde_json::from_str::<Meta>(m).ok());
                let grid = if entry.status == 204 {
                    Some(vec![])
                } else {
                    // Check dimensions before the unpacker allocates from them.
                    (entry.body.get(8..12) == Some(&[0, 1, 0, 1]))
                        .then(|| unpack_elevation(&entry.body).ok())
                        .flatten()
                        .map(|(_, _, grid)| grid)
                };
                if let (Some(meta), Some(values)) = (meta, grid) {
                    reservation.shrink(values.len() * 4);
                    return Ok(Arc::new(Tile {
                        values,
                        sources: meta.sources,
                        coverage: meta.coverage,
                        hit: true,
                        _reservation: reservation,
                    }));
                }
            }
            let sources = catalog(&me, z, x, y).await?;
            let (values, coverage) = if sources.is_empty() {
                (vec![], 0.)
            } else {
                let r = me
                    .upstream
                    .fetch(
                        FetchRequest::get(export_url(z, x, y, &sources))
                            .timeout(Duration::from_secs(25))
                            .max_body(2 << 20),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                if r.status != 200 {
                    return Err(format!("DOGAMI export HTTP {}", r.status));
                }
                // The blocking decoder owns admission even if its last waiter cancels.
                let result = tokio::task::spawn_blocking(move || {
                    let out = decode(&r.body);
                    (out, reservation)
                })
                .await
                .map_err(|_| "DOGAMI decode stopped")?;
                reservation = result.1;
                result.0?
            };
            let sources = if values.iter().any(|v| v.is_finite()) { sources } else { vec![] };
            let meta =
                serde_json::to_string(&Meta { sources: sources.clone(), coverage }).map_err(|e| e.to_string())?;
            let has_values = !sources.is_empty();
            let packed = if has_values { pack_elevation(256, 256, &values) } else { vec![] };
            let _ = me.store.put(
                &key,
                Kind::Derived,
                if has_values { 200 } else { 204 },
                elev32::MEDIA_TYPE,
                Some(&meta),
                &packed,
            );
            reservation.shrink(values.len() * 4);
            Ok(Arc::new(Tile { values, sources, coverage, hit: false, _reservation: reservation }))
        })
        .await
        .ok_or("DOGAMI tile stopped")?
}

fn empty(float32: bool) -> Response {
    if float32 {
        Response::new(204, elev32::MEDIA_TYPE, vec![])
    } else {
        Response::new(200, "image/png", raster::transparent_png().to_vec())
    }
}

pub async fn elevation(engine: &Arc<Engine>, z: u8, x: u32, y: u32, float32: bool) -> Response {
    if !allowed(z, x, y) {
        return empty(float32)
            .header("X-Coverage", "none")
            .header("X-Oregon-Sources", "%5B%5D")
            .header("X-Cache", "outside")
            .header("Cache-Control", IMMUTABLE);
    }
    let answer = async {
        let tile = load(engine, z, x, y).await?;
        let mut reservation = engine.memory.reserve(2 << 20).map_err(|e| e.to_string())?;
        let mut response = if tile.sources.is_empty() {
            empty(float32)
        } else if float32 {
            Response::new(200, elev32::MEDIA_TYPE, elev32::encode(256, 256, &tile.values))
        } else {
            Response::new(200, "image/png", png::encode_rgba(&terrarium::encode(&tile.values), 256, 256))
        };
        reservation.shrink(response.body.capacity());
        response.reservation = Some(reservation);
        Ok::<_, String>(
            response
                .header("X-Coverage", if tile.sources.is_empty() { "none".into() } else { tile.coverage.to_string() })
                .header(
                    "X-Oregon-Sources",
                    encode_component(&serde_json::to_string(&tile.sources).map_err(|e| e.to_string())?),
                )
                .header("X-Elevation-Source", if tile.sources.is_empty() { "none" } else { "oregon-dogami" })
                .header("X-Cache", if tile.hit { "hit" } else { "miss" })
                .header("Cache-Control", IMMUTABLE),
        )
    }
    .await;
    answer.unwrap_or_else(|_| {
        let r = if float32 {
            Response::new(503, elev32::MEDIA_TYPE, vec![])
        } else {
            Response::new(503, "image/png", raster::transparent_png().to_vec())
        };
        r.header("Cache-Control", "no-store")
            .header("Retry-After", "2")
            .header("X-CSP-Error", "Oregon elevation unavailable")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Config, Request,
        transport::{FetchError, FetchFuture, FetchResponse, Transport},
    };
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    };

    const RAW: &[u8] = include_bytes!("../../../../test-fixtures/oregon/hood-survey-edge.lerc");
    fn primary() -> Value {
        json!({"OBJECTID":96,"Name":"OLC_LANE_COUNTY_2014_BARE_EARTH_OGIC_2011","Category":1,"LowPS":3,"ZOrder":2014})
    }
    fn project() -> Value {
        json!({"OBJECTID":600,"Project":"Lane County 2014","CELL_SIZE":"3 FOOT","Vert_Units":"Feet","Vert_Datum":"NAVD88","ACQ_DATES":"2013-2015"})
    }

    #[derive(Default)]
    struct Fixture {
        calls: Mutex<Vec<String>>,
        fail: AtomicBool,
        overview: AtomicBool,
        incomplete: AtomicBool,
        corrupt: AtomicBool,
        delay_export: AtomicBool,
    }
    impl Transport for Fixture {
        fn fetch(&self, req: FetchRequest) -> FetchFuture {
            self.calls.lock().unwrap().push(req.url.clone());
            if self.fail.load(Ordering::SeqCst) {
                return Box::pin(async { Err(FetchError::Offline) });
            }
            let u = url::Url::parse(&req.url).unwrap();
            let body = if u.path().ends_with("/query") {
                let params: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
                let geometry: Value = serde_json::from_str(&params["geometry"]).unwrap();
                assert!(geometry["xmin"].as_f64().unwrap().is_finite());
                let mut item = if u.path().contains("DOGAMI_Lidar_Project_Status") { project() } else { primary() };
                if self.overview.load(Ordering::SeqCst) {
                    item["Category"] = json!(2);
                }
                serde_json::to_vec(&json!({"features":[{"attributes":item}],"exceededTransferLimit":self.incomplete.load(Ordering::SeqCst)})).unwrap()
            } else {
                let params: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
                for (k, v) in [
                    ("format", "lerc"),
                    ("lercVersion", "2"),
                    ("pixelType", "F32"),
                    ("interpolation", "RSP_BilinearInterpolation"),
                    ("compressionTolerance", "0.001"),
                ] {
                    assert_eq!(params[k], v);
                }
                assert_eq!(
                    serde_json::from_str::<Value>(&params["renderingRule"]).unwrap(),
                    json!({"rasterFunction":"None"})
                );
                assert_eq!(
                    serde_json::from_str::<Value>(&params["mosaicRule"]).unwrap(),
                    json!({"mosaicMethod":"esriMosaicLockRaster","lockRasterIds":[96],"mosaicOperation":"MT_FIRST"})
                );
                if self.corrupt.load(Ordering::SeqCst) { b"broken raster".to_vec() } else { RAW.to_vec() }
            };
            let delay = self.delay_export.load(Ordering::SeqCst) && !u.path().ends_with("/query");
            Box::pin(async move {
                if delay {
                    tokio::time::sleep(Duration::from_millis(40)).await;
                }
                Ok(FetchResponse { status: 200, headers: vec![], body, reservation: None })
            })
        }
    }
    fn engine(dir: &std::path::Path, fixture: Arc<Fixture>) -> Arc<Engine> {
        Engine::for_test(
            Config { cache_dir: dir.into(), data_dir: None, cache_budget: 1 << 20, usgs_scope: Some(vec![]) },
            fixture,
        )
        .unwrap()
    }
    async fn ask(engine: &Arc<Engine>, path: &str) -> Response {
        engine.handle(Request::new("GET", path, vec![]).unwrap()).await
    }

    #[test]
    fn survey_identity_units_and_primary_resolution_are_required() {
        assert_eq!(select_sources(&[primary()], &[project()])[0].metadata_dataset_id, 600);
        for (key, value) in [
            ("Project", json!("Keno 2012")),
            ("Project", json!("Lane County 2015")),
            ("Vert_Units", json!("Unknown")),
            ("CELL_SIZE", json!("30 FOOT")),
        ] {
            let mut p = project();
            p[key] = value;
            assert!(select_sources(&[primary()], &[p]).is_empty());
        }
        assert!(select_sources(&[primary()], &[project(), project()]).is_empty());
        for (key, value) in [("Category", json!(2)), ("LowPS", json!(30)), ("LowPS", json!(0)), ("LowPS", json!(-1))] {
            let mut i = primary();
            i[key] = value;
            assert!(select_sources(&[i], &[project()]).is_empty());
        }
    }

    #[tokio::test]
    async fn routes_preserve_valid_pixels_units_provenance_and_cached_revisits() {
        let dir = tempfile::tempdir().unwrap();
        let f = Arc::new(Fixture::default());
        let e = engine(dir.path(), f.clone());
        let (a, b) =
            tokio::join!(ask(&e, "/api/elev32/oregon/18/42287/94982"), ask(&e, "/api/oregon/elev/18/42287/94982.png"));
        assert_eq!((a.status, b.status), (200, 200));
        assert_eq!(a.get("X-Coverage"), Some("0.308"));
        let sources: Value = serde_json::from_str(
            &percent_encoding::percent_decode_str(a.get("X-Oregon-Sources").unwrap()).decode_utf8().unwrap(),
        )
        .unwrap();
        assert_eq!(sources[0]["datasetId"], 96);
        assert_eq!(sources[0]["metadataDatasetId"], 600);
        assert_eq!(sources[0]["sourceVerticalUnits"], "Feet");
        assert_eq!(sources[0]["verticalUnits"], "meters");
        let values: Vec<f32> =
            a.body[16..].chunks_exact(4).map(|p| f32::from_le_bytes(p.try_into().unwrap())).collect();
        let raw = lerc::decode(RAW, SAMPLES).unwrap();
        assert_eq!(values.iter().filter(|v| v.is_finite()).count(), 20178);
        for (value, feet) in values.iter().zip(&raw.values) {
            if feet.is_nan() {
                assert!(value.is_nan());
            } else {
                assert_eq!(value.to_bits(), ((f64::from(*feet) * 0.3048) as f32).to_bits());
            }
        }
        assert_eq!(f.calls.lock().unwrap().len(), 3, "two concurrent routes share catalog and export");
        drop(a);
        drop(b);
        assert_eq!(ask(&e, "/api/oregon/elev/18/42287/94982.png").await.get("X-Cache"), Some("hit"));
        assert_eq!(f.calls.lock().unwrap().len(), 3);
        assert_eq!(ask(&e, "/api/oregon/elev/18/42288/94982.png").await.status, 200);
        assert_eq!(f.calls.lock().unwrap().len(), 4, "neighbor shares z12 catalogue");
        assert_eq!(ask(&e, "/api/oregon/elev/18/50000/50000.png").await.get("X-Cache"), Some("outside"));
        assert_eq!(ask(&e, "/api/oregon/elev/19/42287/94982.png").await.status, 400);
        assert_eq!(f.calls.lock().unwrap().len(), 4);
        f.fail.store(true, Ordering::SeqCst);
        assert_eq!(
            ask(&e, "/api/elev32/oregon/18/42287/94982").await.status,
            200,
            "cached numeric terrain works offline"
        );
    }

    #[tokio::test]
    async fn failures_stay_retryable_and_overviews_never_export_numeric_terrain() {
        for failure in ["network", "incomplete", "corrupt"] {
            let dir = tempfile::tempdir().unwrap();
            let f = Arc::new(Fixture::default());
            let e = engine(dir.path(), f.clone());
            match failure {
                "network" => f.fail.store(true, Ordering::SeqCst),
                "incomplete" => f.incomplete.store(true, Ordering::SeqCst),
                _ => f.corrupt.store(true, Ordering::SeqCst),
            }
            let response = ask(&e, "/api/elev32/oregon/18/42287/94982").await;
            assert_eq!(response.status, 503);
            assert_eq!(response.get("Cache-Control"), Some("no-store"));
            assert!(e.store.get("oregon-olc-v2:18/42287/94982", crate::tiles::TILE_TTL).unwrap().is_none());
            f.fail.store(false, Ordering::SeqCst);
            f.incomplete.store(false, Ordering::SeqCst);
            f.corrupt.store(false, Ordering::SeqCst);
            assert_eq!(ask(&e, "/api/elev32/oregon/18/42287/94982").await.status, 200);
        }
        let dir = tempfile::tempdir().unwrap();
        let f = Arc::new(Fixture::default());
        let e = engine(dir.path(), f.clone());
        f.overview.store(true, Ordering::SeqCst);
        let response = ask(&e, "/api/elev32/oregon/18/42287/94982").await;
        assert_eq!(response.status, 204);
        assert_eq!(response.get("X-Coverage"), Some("none"));
        assert_eq!(f.calls.lock().unwrap().len(), 2);
        let dir = tempfile::tempdir().unwrap();
        let f = Arc::new(Fixture::default());
        let e = engine(dir.path(), f.clone());
        e.memory.set_limit(1024);
        assert_eq!(ask(&e, "/api/elev32/oregon/18/42287/94982").await.status, 503);
        assert!(f.calls.lock().unwrap().is_empty());
        e.memory.set_limit(64 << 20);
        assert_eq!(ask(&e, "/api/elev32/oregon/18/42287/94982").await.status, 200);
    }

    #[tokio::test]
    async fn leaving_one_consumer_keeps_another_consumers_export_alive() {
        let dir = tempfile::tempdir().unwrap();
        let f = Arc::new(Fixture::default());
        let e = engine(dir.path(), f.clone());
        f.delay_export.store(true, Ordering::SeqCst);
        let (cancelled, remaining) = tokio::join!(
            tokio::time::timeout(Duration::from_millis(5), ask(&e, "/api/elev32/oregon/18/42287/94982")),
            ask(&e, "/api/elev32/oregon/18/42287/94982"),
        );
        assert!(cancelled.is_err());
        assert_eq!(remaining.status, 200);
        assert_eq!(f.calls.lock().unwrap().len(), 3);
        drop(remaining);
        assert_eq!(e.memory.stats().used, 0);
    }
}
