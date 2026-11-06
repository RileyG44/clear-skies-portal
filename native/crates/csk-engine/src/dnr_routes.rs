//! WA DNR elevation routes: `/api/wadnr/elev/…` (and its float32 twin) and
//! the view download, `/api/wadnr/warm{,/status,/stop}`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use csk_core::elev32;
use csk_core::raster::{self, png, terrarium};
use csk_store::{Kind, pack_elevation, unpack_elevation};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Engine;
use crate::dnr_local::Ensure;
use crate::router::{Request, Response};
use crate::tiles::TILE_TTL;
use crate::usgs::catalog::encode_component;

/// The view download's progress, as the page polls it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WarmState {
    pub id: String,
    pub running: bool,
    pub total: u64,
    pub done: u64,
    pub bytes: u64,
    pub error: Option<String>,
    pub stop: bool,
    #[serde(default)]
    pub bbox: Option<[f64; 4]>,
}

#[derive(Default)]
pub struct Warm(Mutex<WarmState>);

impl Warm {
    pub fn status(&self) -> WarmState {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

fn save(engine: &Engine, state: &WarmState) -> Result<(), String> {
    let text = serde_json::to_string(state).map_err(|e| e.to_string())?;
    engine
        .store
        .write(|c| c.execute("INSERT OR REPLACE INTO pinned.dnr_download VALUES (1, ?1)", [text]))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Relaunch resumes the requested area from its last completed cell. A
/// source committed just before termination is reused by `dnr_ensure`.
pub fn resume(engine: &Arc<Engine>) {
    let text: Option<String> =
        engine.store.read(|c| c.query_row("SELECT json FROM pinned.dnr_download WHERE id = 1", [], |r| r.get(0))).ok();
    let Some(mut state) = text.and_then(|s| serde_json::from_str::<WarmState>(&s).ok()) else { return };
    let pending = state.running && !state.stop && state.done < state.total && state.bbox.is_some();
    state.running = pending;
    *engine.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner()) = state;
    if pending {
        run(engine);
    }
}

fn run(engine: &Arc<Engine>) {
    let me = engine.clone();
    tokio::spawn(async move {
        let start = me.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let Some(bbox) = start.bbox else { return };
        let (west, east, north, south) = crate::areas::tile_range(&bbox, 16);
        let before: u64 = me.dnr_local.files().iter().map(|f| f.bytes).sum();
        let mut error = None;
        let mut cursor = 0;
        'cells: for y in north..=south {
            for x in west..=east {
                cursor += 1;
                if cursor <= start.done {
                    continue;
                }
                loop {
                    if !me.work.checkpoint().await {
                        return;
                    }
                    if me.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner()).stop {
                        break 'cells;
                    }
                    match me.dnr_ensure(16, x, y).await {
                        Ensure::Pending => tokio::time::sleep(Duration::from_secs(1)).await,
                        Ensure::Error(e) => {
                            error = Some(e);
                            break 'cells;
                        }
                        _ => break,
                    }
                }
                let mut st = me.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner());
                st.done = cursor;
                st.bytes =
                    start.bytes + me.dnr_local.files().iter().map(|f| f.bytes).sum::<u64>().saturating_sub(before);
                if let Err(e) = save(&me, &st) {
                    error = Some(e);
                    break 'cells;
                }
            }
        }
        let mut st = me.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner());
        st.running = false;
        st.error = error;
        if let Err(e) = save(&me, &st) {
            st.error = Some(e);
        }
    });
}

/// `/api/wadnr/elev/<z>/<x>/<y>.png` or `/api/elev32/wadnr/<z>/<x>/<y>`.
pub async fn elevation(engine: &Arc<Engine>, req: &Request, z: u8, x: u32, y: u32, float32: bool) -> Response {
    if z > 18 {
        return Response::json(400, &json!({"error": "bad tile coordinates"}));
    }
    let state = if req.param("acquire") == Some("0") { Ensure::Ready } else { engine.dnr_ensure(z, x, y).await };
    let revision = engine.dnr_local.revision();
    let key = format!("dnr:v2:{revision}:{z}/{x}/{y}");
    let hit = engine.store.get(&key, TILE_TTL).ok().flatten();
    let mut out: Option<(Vec<f32>, Value)> = hit.as_ref().and_then(|e| {
        let (_, _, grid) = unpack_elevation(&e.body).ok()?;
        Some((grid, e.meta.as_deref().and_then(|m| serde_json::from_str(m).ok()).unwrap_or(Value::Null)))
    });
    if out.is_none() && !engine.dnr_local.files().is_empty() {
        let sampled = match engine.dnr_sample(z, x, y).await {
            Ok(v) => v,
            Err(e) => {
                return Response::json(503, &json!({"state": "error", "error": e}))
                    .header("Cache-Control", "no-store")
                    .header("Retry-After", "5");
            }
        };
        out = sampled.map(|(grid, coverage, ground, sources)| {
            let meta = json!({"coverage": (coverage * 1000.0).round() / 1000.0, "groundRes": (ground * 100.0).round() / 100.0, "sources": sources});
            let packed = pack_elevation(256, 256, &grid);
            let _ = engine.store.put(&key, Kind::Derived, 200, elev32::MEDIA_TYPE, Some(&meta.to_string()), &packed);
            (grid, meta)
        });
    }
    let base = |r: Response, source: &str| {
        r.header("Cache-Control", "no-store")
            .header("X-DNR-Status", state.name())
            .header("X-DNR-Revision", revision.to_string())
            .header("X-Elevation-Source", source)
    };
    let Some((grid, meta)) = out else {
        return match &state {
            Ensure::Pending => base(
                Response::json(
                    202,
                    &json!({"state": "pending", "revision": revision, "acquisition": engine.dnr_status()}),
                ),
                "pending",
            )
            .header("Retry-After", "5"),
            Ensure::Error(e) => {
                base(Response::json(503, &json!({"state": "error", "error": e, "revision": revision})), "unknown")
                    .header("Retry-After", "30")
            }
            _ => {
                let r = if float32 {
                    Response::new(204, elev32::MEDIA_TYPE, Vec::new())
                } else {
                    Response::new(200, "image/png", raster::transparent_png().to_vec())
                };
                base(r, "none").header("X-Coverage", "none")
            }
        };
    };
    let body = if float32 {
        Response::new(200, elev32::MEDIA_TYPE, elev32::encode(256, 256, &grid))
    } else {
        Response::new(200, "image/png", png::encode_rgba(&terrarium::encode(&grid), 256, 256))
    };
    base(body, "wadnr-dtm")
        .header("X-Coverage", meta["coverage"].to_string())
        .header("X-Ground-Res", meta["groundRes"].to_string())
        .header("X-DNR-Sources", encode_component(&meta["sources"].to_string()))
        .header("X-Cache", if hit.is_some() { "hit" } else { "miss" })
}

/// `POST /api/wadnr/warm {bbox}`: acquire every z16 cell of a view.
pub fn warm_start(engine: &Arc<Engine>, req: &Request) -> Response {
    let b: Option<[f64; 4]> = serde_json::from_slice::<Value>(&req.body).ok().and_then(|v| {
        let a = v["bbox"].as_array()?;
        let b: Vec<f64> = a.iter().map(Value::as_f64).collect::<Option<_>>()?;
        (b.len() == 4 && b[0] < b[2] && b[1] < b[3] && b[1] >= -85.0 && b[3] <= 85.0 && b[0] >= -180.0 && b[2] <= 180.0)
            .then(|| [b[0], b[1], b[2], b[3]])
    });
    let Some(bbox) = b else { return Response::json(400, &json!({"error": "bbox=w,s,e,n required"})) };
    let mut st = engine.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner());
    if st.running {
        return Response::json(409, &json!({"busy": true, "error": "Another WA DNR download is running"}))
            .header("Cache-Control", "no-store");
    }
    let (west, east, north, south) = crate::areas::tile_range(&bbox, 16);
    let total = u64::from(east - west + 1) * u64::from(south - north + 1);
    if total > 4096 {
        return Response::json(
            400,
            &json!({"error": "A WA DNR fetch is limited to 4096 acquisition cells; split a larger area into multiple fetches"}),
        );
    }
    let next = WarmState {
        id: format!("{:x}", csk_store::now_ms()),
        running: true,
        total,
        bbox: Some(bbox),
        ..WarmState::default()
    };
    if let Err(e) = save(engine, &next) {
        return Response::json(503, &json!({"error": e}));
    }
    *st = next;
    let snapshot = st.clone();
    drop(st);
    run(engine);
    Response::json(200, &serde_json::to_value(snapshot).unwrap_or_default()).header("Cache-Control", "no-store")
}

pub fn warm_status(engine: &Arc<Engine>) -> Response {
    let st = engine.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let mut v = serde_json::to_value(st).unwrap_or_default();
    v["acquisition"] = engine.dnr_status();
    Response::json(200, &v).header("Cache-Control", "no-store")
}

/// `POST /api/wadnr/warm/stop {id}`: stops the view download (not the
/// acquisition already under way, which finishes into the store).
pub fn warm_stop(engine: &Arc<Engine>, req: &Request) -> Response {
    let id = serde_json::from_slice::<Value>(&req.body).ok().and_then(|v| v["id"].as_str().map(str::to_owned));
    let Some(id) = id.filter(|id| !id.is_empty()) else {
        return Response::json(400, &json!({"error": "download id required"}));
    };
    let mut st = engine.dnr_warm.0.lock().unwrap_or_else(|e| e.into_inner());
    let cancelled = id == st.id;
    if cancelled {
        st.stop = true;
        if let Err(e) = save(engine, &st) {
            return Response::json(503, &json!({"error": e}));
        }
    }
    let mut v = serde_json::to_value(st.clone()).unwrap_or_default();
    v["cancelled"] = json!(cancelled);
    Response::json(200, &v).header("Cache-Control", "no-store")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{FetchError, FetchFuture, FetchRequest, Transport};

    struct Offline;
    impl Transport for Offline {
        fn fetch(&self, _: FetchRequest) -> FetchFuture {
            Box::pin(async { Err(FetchError::Offline) })
        }
    }

    #[tokio::test]
    async fn download_methods_ownership_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::new(
            crate::Config {
                cache_dir: dir.path().into(),
                data_dir: None,
                cache_budget: 1 << 20,
                usgs_scope: Some(vec![]),
            },
            Arc::new(Offline),
        )
        .unwrap();
        let ask = |method, path, body: &str| Request::new(method, path, body.as_bytes().to_vec()).unwrap();
        assert_eq!(engine.handle(ask("GET", "/api/wadnr/warm", "{}")).await.status, 405);
        assert!(!engine.dnr_warm.0.lock().unwrap().running);
        assert_eq!(engine.handle(ask("POST", "/api/wadnr/warm", "{}")).await.status, 400);
        assert_eq!(engine.handle(ask("GET", "/api/elev32/wadnr/1/2/0", "")).await.status, 400);

        let state = WarmState { id: "ours".into(), running: true, total: 3, done: 1, ..WarmState::default() };
        *engine.dnr_warm.0.lock().unwrap() = state.clone();
        save(&engine, &state).unwrap();
        assert_eq!(engine.handle(ask("POST", "/api/wadnr/warm/stop", "{}")).await.status, 400);
        let r = engine.handle(ask("POST", "/api/wadnr/warm/stop", r#"{"id":"old"}"#)).await;
        assert_eq!(serde_json::from_slice::<Value>(&r.body).unwrap()["cancelled"], false);
        assert!(!engine.dnr_warm.0.lock().unwrap().stop);
        let r = engine.handle(ask("POST", "/api/wadnr/warm/stop", r#"{"id":"ours"}"#)).await;
        assert_eq!(serde_json::from_slice::<Value>(&r.body).unwrap()["stop"], true);
        resume(&engine);
        let restored = engine.dnr_warm.0.lock().unwrap().clone();
        assert!(restored.stop && !restored.running);
        assert_eq!(restored.done, 1);

        // An interrupted download continues from its journalled cursor.
        let catalog = json!({"at": csk_store::now_ms(), "projects": []});
        engine.store.kv_put("dnr.catalog", &catalog.to_string()).unwrap();
        let state = WarmState {
            id: "resume".into(),
            running: true,
            total: 2,
            done: 1,
            bbox: Some([-121.430, 47.430, -121.420, 47.431]),
            ..WarmState::default()
        };
        save(&engine, &state).unwrap();
        resume(&engine);
        tokio::time::timeout(Duration::from_secs(2), async {
            while engine.dnr_warm.0.lock().unwrap().running {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let finished = engine.dnr_warm.0.lock().unwrap().clone();
        let (w, e, n, s) = crate::areas::tile_range(&state.bbox.unwrap(), 16);
        assert_eq!(finished.done, u64::from(e - w + 1) * u64::from(s - n + 1));
        assert!(finished.error.is_none());
    }
}
