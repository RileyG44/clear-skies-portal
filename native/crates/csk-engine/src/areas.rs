//! Offline areas: download the ground for an area so it loads instantly
//! and works with no network (ARCHITECTURE.md §4.5).
//!
//! A download is a journalled job: every tile it needs is written down
//! before it starts and checked off as it lands, so a job the system kills
//! resumes where it stopped. Each finished tile is pinned at once (copied to
//! the offline tier), so cache eviction can never take back what a job has
//! already fetched. The area's definition and manifest are user state.

use std::collections::{BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use csk_store::now_ms;
use csk_store::rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::Engine;
use crate::router::{Request, Response};
use crate::tiles::{self, Baseline, Lidar};
use crate::transport::{FetchRequest, Method};

pub const MAX_TILES: u64 = 40_000;
/// Download lanes. Cold 1 m tiles are latency-bound; four keep the network
/// busy while leaving room for the map the person is looking at.
const LANES: usize = 4;
pub const DOWNLOAD_STYLES: &[&str] =
    &["hs", "hsmulti", "tint", "slope", "aspect", "northness", "c2", "c5", "c10", "c25"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Spec {
    pub bbox: [f64; 4],
    pub z0: u8,
    pub z1: u8,
    pub style: String,
    pub label: String,
    pub raw: bool,
    pub total: u64,
}

/// Tile column/row range of a lon/lat box at zoom `z` (cache-budget.js:tileRange).
pub fn tile_range(b: &[f64; 4], z: u8) -> (u32, u32, u32, u32) {
    let n = 2f64.powi(i32::from(z));
    let xt = |lon: f64| ((lon + 180.0) / 360.0 * n).floor();
    let yt = |lat: f64| {
        let r = lat.to_radians();
        ((1.0 - (r.tan() + 1.0 / r.cos()).ln() / std::f64::consts::PI) / 2.0 * n).floor()
    };
    let max = n - 1.0;
    let c = |v: f64| v.clamp(0.0, max) as u32;
    (c(xt(b[0])), c(xt(b[2])), c(yt(b[3])), c(yt(b[1])))
}

fn valid_bbox(v: &Value) -> Option<[f64; 4]> {
    let a = v.as_array().filter(|a| a.len() == 4)?;
    let b: Vec<f64> = a.iter().map(Value::as_f64).collect::<Option<_>>()?;
    let (w, s, e, n) = (b[0], b[1], b[2], b[3]);
    let ok = b.iter().all(|v| v.is_finite())
        && w >= -180.0
        && e <= 180.0
        && s >= -85.051129
        && n <= 85.051129
        && w < e
        && s < n;
    ok.then_some([w, s, e, n])
}

fn err(status: u16, msg: &str) -> Response {
    Response::json(status, &json!({"error": msg}))
}

/// Validates a 1 m area request (`downloads.js:validateWarmJob`).
pub fn validate(body: &[u8]) -> Result<Spec, Response> {
    let v: Value = serde_json::from_slice(body).map_err(|_| err(400, "JSON object required"))?;
    if !v.is_object() {
        return Err(err(400, "JSON object required"));
    }
    let bbox = valid_bbox(&v["bbox"]).ok_or_else(|| err(400, "bbox must be [west,south,east,north]"))?;
    let z = |k: &str| v[k].as_f64().filter(|z| z.fract() == 0.0).map(|z| z as i64);
    let (Some(z0), Some(z1)) = (z("z0"), z("z1")) else {
        return Err(err(400, "z0 and z1 must be integers from 1 to 20"));
    };
    if z0 < 1 || z1 > 20 || z0 > z1 {
        return Err(err(400, "z0 and z1 must be integers from 1 to 20"));
    }
    let mut total = 0u64;
    for z in z0..=z1 {
        let (x0, x1, y0, y1) = tile_range(&bbox, z as u8);
        total += u64::from(x1 - x0 + 1) * u64::from(y1 - y0 + 1);
        if total > MAX_TILES {
            return Err(err(413, &format!("download exceeds {MAX_TILES} tiles")));
        }
    }
    let style = v["style"].as_str().unwrap_or("hs").to_owned();
    if !DOWNLOAD_STYLES.contains(&style.as_str()) {
        return Err(err(400, "unsupported terrain style"));
    }
    let label: String = v["label"]
        .as_str()
        .map_or_else(|| format!("z{z0}-{z1}"), str::to_owned)
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect();
    Ok(Spec { bbox, z0: z0 as u8, z1: z1 as u8, style, label, raw: v["raw"].as_bool() != Some(false), total })
}

fn area_id(s: &Spec) -> String {
    let text = json!([s.bbox, s.z0, s.z1, s.style]).to_string();
    Sha256::digest(text.as_bytes()).iter().take(6).map(|b| format!("{b:02x}")).collect()
}

/// What the page polls.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Progress {
    pub running: bool,
    pub total: u64,
    pub done: u64,
    pub ok: u64,
    pub skipped: u64,
    pub bytes: u64,
    pub label: String,
    pub error: String,
    pub unrecorded: String,
}

#[derive(Default)]
pub struct Downloads {
    progress: Arc<Mutex<Progress>>,
    task: Mutex<Option<(String, tokio::task::AbortHandle)>>,
}

impl Downloads {
    pub fn status(&self) -> Progress {
        self.progress.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// `POST /api/usgs/warm`
pub fn start(engine: &Arc<Engine>, req: &Request) -> Response {
    let spec = match validate(&req.body) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let d = &engine.downloads;
    if d.status().running {
        let mut v = serde_json::to_value(d.status()).unwrap_or_default();
        v["error"] = json!("already running");
        return Response::json(409, &v);
    }
    let area = area_id(&spec);
    let job = match open_job(engine, &area, &spec) {
        Ok(j) => j,
        Err(e) => return err(500, &format!("could not record the download: {e}")),
    };
    run(engine, job, spec);
    Response::json(200, &serde_json::to_value(d.status()).unwrap_or_default())
}

/// Resumes a job the system stopped (the app was killed mid-download).
pub fn resume(engine: &Arc<Engine>) {
    let row: Option<(String, String)> = engine
        .store
        .read(|c| {
            c.query_row(
                "SELECT id, spec FROM pinned.jobs WHERE state = 'running' ORDER BY updated DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
        })
        .ok()
        .flatten();
    if let Some((job, spec)) = row
        && let Ok(spec) = serde_json::from_str::<Spec>(&spec)
    {
        run(engine, job, spec);
    }
}

/// The job for this area: the unfinished one if any (resume), else a new
/// one with every tile written down.
fn open_job(engine: &Arc<Engine>, area: &str, spec: &Spec) -> Result<String, csk_store::StoreError> {
    let spec_text = serde_json::to_string(spec).expect("spec serialises");
    engine.store.write(|c| {
        let tx = c.transaction()?;
        let existing: Option<String> = tx
            .query_row("SELECT id FROM pinned.jobs WHERE area = ?1 AND state != 'done'", params![area], |r| r.get(0))
            .optional()?;
        let now = now_ms();
        let id = match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE pinned.jobs SET state = 'running', spec = ?2, error = '', updated = ?3 WHERE id = ?1",
                    params![id, spec_text, now],
                )?;
                id
            }
            None => {
                let id = format!("{area}-{now}");
                tx.execute(
                    "INSERT INTO pinned.jobs (id, area, source, spec, state, total, created, updated)
                     VALUES (?1, ?2, 'usgs1m', ?3, 'running', ?4, ?5, ?5)",
                    params![id, area, spec_text, spec.total as i64, now],
                )?;
                let mut ins =
                    tx.prepare("INSERT OR IGNORE INTO pinned.job_tiles (job, z, x, y) VALUES (?1, ?2, ?3, ?4)")?;
                for z in spec.z0..=spec.z1 {
                    let (x0, x1, y0, y1) = tile_range(&spec.bbox, z);
                    for x in x0..=x1 {
                        for y in y0..=y1 {
                            ins.execute(params![id, z, x, y])?;
                        }
                    }
                }
                drop(ins);
                id
            }
        };
        tx.commit()?;
        Ok(id)
    })
}

struct JobState {
    queue: VecDeque<(u8, u32, u32)>,
    sources: BTreeSet<String>,
}

fn run(engine: &Arc<Engine>, job: String, spec: Spec) {
    let pending: Vec<(u8, u32, u32)> = engine
        .store
        .read(|c| {
            c.prepare("SELECT z, x, y FROM pinned.job_tiles WHERE job = ?1 AND done = 0 ORDER BY z, x, y")?
                .query_map(params![job], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect()
        })
        .unwrap_or_default();
    let counts: (u64, u64, u64, u64) = engine
        .store
        .read(|c| {
            c.query_row("SELECT done, ok, skipped, bytes FROM pinned.jobs WHERE id = ?1", params![job], |r| {
                Ok((
                    r.get::<_, i64>(0)? as u64,
                    r.get::<_, i64>(1)? as u64,
                    r.get::<_, i64>(2)? as u64,
                    r.get::<_, i64>(3)? as u64,
                ))
            })
        })
        .unwrap_or_default();
    {
        let mut p = engine.downloads.progress.lock().unwrap_or_else(|e| e.into_inner());
        *p = Progress {
            running: true,
            total: spec.total,
            done: counts.0,
            ok: counts.1,
            skipped: counts.2,
            bytes: counts.3,
            label: format!("z{}-{} {}", spec.z0, spec.z1, spec.style),
            ..Progress::default()
        };
    }
    let area = area_id(&spec);
    let state = Arc::new(Mutex::new(JobState { queue: pending.into(), sources: BTreeSet::new() }));
    let me = engine.clone();
    let job2 = job.clone();
    let handle = tokio::spawn(async move {
        let lanes = (0..LANES).map(|_| lane(me.clone(), job2.clone(), area.clone(), spec.raw, state.clone()));
        futures_util::future::join_all(lanes).await;
        finish(&me, &job2, &area, &spec, &state).await;
    });
    *engine.downloads.task.lock().unwrap_or_else(|e| e.into_inner()) = Some((job, handle.abort_handle()));
}

async fn lane(engine: Arc<Engine>, job: String, area: String, raw: bool, state: Arc<Mutex<JobState>>) {
    loop {
        if !engine.work.checkpoint().await {
            return;
        }
        let Some((z, x, y)) = state.lock().unwrap_or_else(|e| e.into_inner()).queue.pop_front() else { return };
        let mut keys = Vec::new();
        let mut fetched = false;
        let mut failure = None;
        // 1 m first: where it covers the whole tile, nothing offline ever
        // reads the national baseline under it, so its outage cannot fail it.
        let mut lidar_complete = false;
        if raw && z >= tiles::RAW_MIN_ZOOM {
            keys.push(tiles::lidar_key(z, x, y));
            match engine.tiles.lidar(z, x, y).await {
                Lidar::Tile { hit, meta, .. } => {
                    fetched |= !hit;
                    lidar_complete = meta.coverage.is_some_and(|c| c >= 1.0);
                    let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                    for src in meta.sources {
                        s.sources.insert(src.key);
                    }
                }
                Lidar::None => {}
                // Unknown coverage is a failed read, never a saved gap.
                Lidar::Provisional => failure = Some("1 m coverage index is incomplete; retry later".to_owned()),
                Lidar::Failed { .. } => failure = Some("1 m source read failed; retry later".to_owned()),
            }
        }
        if failure.is_none() {
            match engine.tiles.baseline(z, x, y).await {
                Baseline::Tile { hit, .. } => {
                    fetched |= !hit;
                    keys.push(tiles::national_key(z, x, y));
                }
                Baseline::None => keys.push(tiles::national_key(z, x, y)),
                Baseline::Failed { .. } if lidar_complete => {}
                Baseline::Failed { .. } => failure = Some("national 3DEP unavailable; retry later".to_owned()),
            }
        }
        if let Some(f) = failure {
            // Left undone in the journal: the next start resumes it.
            let mut p = engine.downloads.progress.lock().unwrap_or_else(|e| e.into_inner());
            p.error = f;
            p.done += 1;
            continue;
        }
        if let Err(e) = engine.store.pin(&area, &keys) {
            let mut p = engine.downloads.progress.lock().unwrap_or_else(|e| e.into_inner());
            p.error = format!("could not keep the tile offline: {e}");
            p.done += 1;
            continue;
        }
        let bytes = engine.store.bytes_of(&keys).unwrap_or(0);
        let (ok, skipped) = if fetched { (1, 0) } else { (0, 1) };
        let _ = engine.store.write(|c| {
            let tx = c.transaction()?;
            tx.execute("UPDATE pinned.job_tiles SET done = 1 WHERE job = ?1 AND z = ?2 AND x = ?3 AND y = ?4", params![job, z, x, y])?;
            tx.execute(
                "UPDATE pinned.jobs SET done = done + 1, ok = ok + ?2, skipped = skipped + ?3, bytes = bytes + ?4, updated = ?5
                 WHERE id = ?1",
                params![job, ok, skipped, bytes as i64, now_ms()],
            )?;
            tx.commit()
        });
        let mut p = engine.downloads.progress.lock().unwrap_or_else(|e| e.into_inner());
        p.done += 1;
        p.ok += ok as u64;
        p.skipped += skipped as u64;
        p.bytes += bytes;
    }
}

async fn finish(engine: &Arc<Engine>, job: &str, area: &str, spec: &Spec, state: &Arc<Mutex<JobState>>) {
    let remaining: i64 = engine
        .store
        .read(|c| {
            c.query_row("SELECT COUNT(*) FROM pinned.job_tiles WHERE job = ?1 AND done = 0", params![job], |r| r.get(0))
        })
        .unwrap_or(1);
    let progress = engine.downloads.status();
    let sources: Vec<String> = state.lock().unwrap_or_else(|e| e.into_inner()).sources.iter().cloned().collect();
    let mut unrecorded = String::new();
    if progress.ok + progress.skipped > 0 {
        // Record each source COG's ETag: that is what makes staleness a HEAD away.
        let mut manifest_sources = Vec::new();
        for key in &sources {
            if !engine.work.checkpoint().await {
                return;
            }
            manifest_sources.push(head(engine, key).await);
        }
        let manifest = json!({
            "id": area, "source": "usgs1m", "label": spec.label, "bbox": spec.bbox, "z0": spec.z0, "z1": spec.z1,
            "style": spec.style, "raw": spec.raw, "tiles": spec.total, "ok": progress.ok, "skipped": progress.skipped,
            "bytes": progress.bytes, "created": now_ms(), "checked": now_ms(), "sources": manifest_sources,
            "stale": false, "changed": [], "complete": remaining == 0,
        });
        if let Err(e) = save_area(engine, area, &manifest) {
            unrecorded = e.to_string();
        }
    }
    let _ = engine.store.write(|c| {
        c.execute(
            "UPDATE pinned.jobs SET state = ?2, updated = ?3 WHERE id = ?1",
            params![job, if remaining == 0 { "done" } else { "stopped" }, now_ms()],
        )?;
        if remaining == 0 {
            c.execute("DELETE FROM pinned.job_tiles WHERE job = ?1", params![job])?;
        }
        Ok(())
    });
    let mut p = engine.downloads.progress.lock().unwrap_or_else(|e| e.into_inner());
    p.running = false;
    p.unrecorded = unrecorded;
    engine.downloads.task.lock().unwrap_or_else(|e| e.into_inner()).take();
}

fn save_area(engine: &Engine, area: &str, manifest: &Value) -> Result<(), csk_store::StoreError> {
    engine.user.with(|c| {
        c.execute(
            "INSERT OR REPLACE INTO areas (id, source, manifest, created) VALUES (?1, 'usgs1m', ?2, ?3)",
            params![area, manifest.to_string(), now_ms()],
        )
    })?;
    Ok(())
}

/// HEAD an S3 object: `{key, ok, etag, size, lastModified}`.
async fn head(engine: &Engine, key: &str) -> Value {
    let mut req = FetchRequest::get(format!("{}/{key}", crate::usgs::Usgs::s3_origin()));
    req.method = Method::Head;
    match engine.upstream.fetch(req).await {
        Ok(r) => json!({
            "key": key, "ok": r.status == 200,
            "etag": r.header("etag").unwrap_or("").replace('"', ""),
            "size": r.header("content-length").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0),
            "lastModified": r.header("last-modified"),
        }),
        Err(e) => json!({"key": key, "ok": false, "error": e.to_string()}),
    }
}

/// `POST /api/usgs/warm/stop`
pub fn stop(engine: &Arc<Engine>) -> Response {
    if let Some((job, h)) = engine.downloads.task.lock().unwrap_or_else(|e| e.into_inner()).take() {
        h.abort();
        let _ = engine.store.write(|c| {
            c.execute("UPDATE pinned.jobs SET state = 'stopped', updated = ?2 WHERE id = ?1", params![job, now_ms()])
        });
        engine.downloads.progress.lock().unwrap_or_else(|e| e.into_inner()).running = false;
    }
    Response::json(200, &serde_json::to_value(engine.downloads.status()).unwrap_or_default())
}

fn list(engine: &Engine) -> Vec<Value> {
    let rows: Vec<String> = engine
        .user
        .with(|c| {
            c.prepare("SELECT manifest FROM areas WHERE source = 'usgs1m' ORDER BY created DESC")?
                .query_map([], |r| r.get(0))?
                .collect()
        })
        .unwrap_or_default();
    rows.iter().filter_map(|m| serde_json::from_str(m).ok()).collect()
}

/// `GET /api/usgs/areas/check[?id=]`: re-HEAD each recorded COG; a changed
/// ETag means the tile was re-issued.
pub async fn check(engine: &Arc<Engine>, want: Option<&str>) -> Response {
    let mut out = Vec::new();
    for mut a in list(engine).into_iter().filter(|a| want.is_none_or(|w| a["id"] == w)) {
        let mut changed = Vec::new();
        let mut failed = false;
        for s in a["sources"].as_array().cloned().unwrap_or_default() {
            let Some(key) = s["key"].as_str() else { continue };
            let now = head(engine, key).await;
            failed |= now["ok"] != true;
            let was = s["etag"].as_str().unwrap_or("");
            if !was.is_empty() && now["etag"].as_str().is_some_and(|e| e != was) {
                let mut c = now.clone();
                c["changed"] = json!(true);
                changed.push(c);
            }
        }
        a["checked"] = json!(now_ms());
        a["stale"] = json!(!changed.is_empty());
        a["changed"] = json!(changed);
        a["checkFailed"] = json!(failed);
        if let Some(id) = a["id"].as_str() {
            let _ = save_area(engine, id, &a);
        }
        out.push(a);
    }
    Response::json(200, &Value::Array(out))
}

/// `GET /api/usgs/areas`
pub fn areas(engine: &Arc<Engine>) -> Response {
    Response::json(200, &Value::Array(list(engine)))
}

/// `GET /api/usgs/plan?bbox=w,s,e,n&z0=&z1=`
pub fn plan(req: &Request) -> Response {
    let bbox: Vec<f64> = req.param("bbox").unwrap_or("").split(',').filter_map(|v| v.parse().ok()).collect();
    let body = json!({"bbox": bbox, "z0": req.param("z0").and_then(|v| v.parse::<f64>().ok()),
                      "z1": req.param("z1").and_then(|v| v.parse::<f64>().ok()), "style": "hs"});
    match validate(body.to_string().as_bytes()) {
        Ok(s) => Response::json(200, &json!({"tiles": s.total})),
        Err(r) if r.status == 413 => r,
        Err(_) => err(400, "bbox,z0,z1 required"),
    }
}

/// `POST /api/usgs/check`: freshness of the given COGs by ETag.
pub async fn fresh(engine: &Arc<Engine>, req: &Request) -> Response {
    let entries: Vec<Value> = match serde_json::from_slice::<Value>(&req.body) {
        Ok(Value::Array(a)) if a.len() <= 500 => a,
        _ => return err(400, "JSON array with at most 500 entries required"),
    };
    let mut out = Vec::new();
    for e in entries {
        let Some(key) = e["key"].as_str() else { continue };
        let mut now = head(engine, key).await;
        let was = e["etag"].as_str().unwrap_or("");
        now["changed"] = json!(!was.is_empty() && now["etag"].as_str().is_some_and(|n| n != was));
        out.push(now);
    }
    Response::json(200, &Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_like_the_engine() {
        let s = validate(br#"{"bbox":[-121.5,47.4,-121.4,47.45],"z0":12,"z1":14,"style":"hs","label":"Pass\u0001"}"#)
            .unwrap();
        assert_eq!((s.z0, s.z1, s.raw, s.label.as_str()), (12, 14, true, "Pass"));
        assert!(s.total > 0);
        assert_eq!(validate(br#"{"bbox":[1,2,3],"z0":1,"z1":2}"#).unwrap_err().status, 400);
        assert_eq!(validate(br#"{"bbox":[-125,45,-116,49],"z0":1,"z1":20}"#).unwrap_err().status, 413);
        assert_eq!(validate(br#"{"bbox":[-1,1,0,2],"z0":1,"z1":2,"style":"x"}"#).unwrap_err().status, 400);
        // cache-budget.js:tileRange for Rainier at z10.
        assert_eq!(tile_range(&[-121.8, 46.8, -121.7, 46.9], 10), (165, 165, 360, 361));
    }
}
