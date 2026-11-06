//! WA DNR rasters prepared on the device (ARCHITECTURE.md §4.4).
//!
//! The portal's download builds a ZIP of whole source files on the fly
//! (streamed, no byte ranges), so acquisition is staged: download the ZIP to
//! a file, extract each DTM with its CRC checked, inspect it, and publish it
//! with one index transaction. Tiled (Big)TIFFs are read in place through the
//! USGS block cache. Strip-layout rasters stream into lossless tiled float32
//! TIFFs with bounded overviews before publication.
//!
//! Vertical units come only from GeoKeys, scoped vertical citations or
//! documented survey metadata. Unknown units fail closed; terrain comparisons
//! cannot distinguish international from US survey feet or establish a datum.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use csk_core::codec::Geo;
use csk_core::geo::proj::{Projection, US_FOOT};
use csk_core::raster::sample::TileSpec;
use csk_store::now_ms;
use csk_store::rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Engine;
use crate::tiles::TILE_SIZE;
use crate::transport::{FetchRequest, FetchResponse};
use crate::usgs::catalog::encode_component;

const HOST: &str = crate::dnr::HOST;
/// One acquisition's ZIP and extracted files (configurable).
const MAX_ARCHIVE: u64 = 2 << 30;
/// Prepared DNR rasters kept on the device before the least recently used go.
const MAX_STORE: u64 = 6 << 30;
const MAX_FILES: usize = 32;
const MAX_QUEUE: usize = 4;
const ERROR_BACKOFF: Duration = Duration::from_secs(120);
/// Acquisition happens at z16 areas, one at a time.
const ACQUIRE_ZOOM: u8 = 16;

/// A prepared raster.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalFile {
    pub key: String,
    #[serde(rename = "datasetId")]
    pub dataset_id: i64,
    pub project: String,
    pub year: i32,
    #[serde(rename = "archivePath")]
    pub archive_path: String,
    /// File name under the DNR directory.
    pub file: String,
    pub bytes: u64,
    /// Lon/lat bounds (west, south, east, north).
    pub bounds: [f64; 4],
    pub width: u32,
    pub height: u32,
    /// Upper-left corner and pixel size in the file's CRS units.
    pub origin: [f64; 2],
    pub resolution: [f64; 2],
    #[serde(rename = "pixelIsArea")]
    pub pixel_is_area: bool,
    pub nodata: Option<f64>,
    /// Metres per stored elevation unit.
    #[serde(rename = "verticalMeters")]
    pub vertical_meters: f64,
    #[serde(rename = "verticalUnitBasis")]
    pub vertical_basis: String,
    #[serde(rename = "nativeMeters")]
    pub native_meters: f64,
    #[serde(rename = "projection")]
    pub proj: ProjSpec,
    pub added: i64,
}

impl LocalFile {
    /// An enclosing lon/lat box is only a search hint. Check the request
    /// boundary in the source CRS before skipping an acquisition.
    fn covers(&self, bbox: &[f64; 4]) -> bool {
        let p = self.proj.projection();
        (0..=16).all(|i| {
            let f = f64::from(i) / 16.0;
            let [w, s, e, n] = *bbox;
            [(w + (e - w) * f, s), (w + (e - w) * f, n), (w, s + (n - s) * f), (e, s + (n - s) * f)].iter().all(
                |&(lon, lat)| {
                    let (x, y) = p.forward(lon, lat);
                    let px = (x - self.origin[0]) / self.resolution[0];
                    let py = (y - self.origin[1]) / self.resolution[1];
                    px > 0.01 && py > 0.01 && px < f64::from(self.width) - 0.01 && py < f64::from(self.height) - 0.01
                },
            )
        })
    }
}

/// A serialisable projection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct ProjSpec {
    pub kind: u8,
    pub p: [f64; 4],
    pub a: f64,
    pub rf: f64,
    pub fe: f64,
    pub fnn: f64,
    pub unit: f64,
}

impl From<Projection> for ProjSpec {
    fn from(p: Projection) -> Self {
        use csk_core::geo::proj::Method::*;
        let (kind, params) = match p.method {
            Lcc2 { lat1, lat2, lat0, lon0 } => (1, [lat1, lat2, lat0, lon0]),
            Lcc1 { lat0, lon0, k0 } => (2, [lat0, lon0, k0, 0.0]),
            TransverseMercator { lat0, lon0, k0 } => (3, [lat0, lon0, k0, 0.0]),
        };
        Self { kind, p: params, a: p.a, rf: p.rf, fe: p.false_easting, fnn: p.false_northing, unit: p.unit }
    }
}

impl ProjSpec {
    pub fn projection(&self) -> Projection {
        use csk_core::geo::proj::Method;
        let [a, b, c, d] = self.p;
        let method = match self.kind {
            1 => Method::Lcc2 { lat1: a, lat2: b, lat0: c, lon0: d },
            2 => Method::Lcc1 { lat0: a, lon0: b, k0: c },
            _ => Method::TransverseMercator { lat0: a, lon0: b, k0: c },
        };
        Projection { method, a: self.a, rf: self.rf, false_easting: self.fe, false_northing: self.fnn, unit: self.unit }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Job {
    id: String,
    bbox: [f64; 4],
    dataset: i64,
    project: String,
    year: i32,
    #[serde(skip, default = "Instant::now")]
    touched: Instant,
}

/// A dropped acquisition leaves only its platform-owned archive and journal.
/// Process termination is handled by the startup staging sweep as well.
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Active {
    pub project: String,
    pub state: String,
    pub bytes: u64,
    pub fraction: f64,
}

#[derive(Default)]
struct State {
    queue: Vec<Job>,
    active: Option<(String, Active)>,
    errors: HashMap<String, (Instant, String)>,
    revision: i64,
}

/// What `ensure_tile` found.
#[derive(Debug, Clone, PartialEq)]
pub enum Ensure {
    Ready,
    Pending,
    Empty,
    /// Too far out to acquire; whatever is local still serves.
    Overview,
    Error(String),
}

impl Ensure {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Pending => "pending",
            Self::Empty => "empty",
            Self::Overview => "overview",
            Self::Error(_) => "error",
        }
    }
}

pub struct DnrLocal {
    dir: PathBuf,
    state: Mutex<State>,
    files: Mutex<Vec<LocalFile>>,
}

fn intersects(a: &[f64; 4], b: &[f64; 4]) -> bool {
    a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}
/// Lon/lat bounds of an XYZ tile.
pub fn tile_lonlat(z: u8, x: u32, y: u32) -> [f64; 4] {
    let n = 2f64.powi(i32::from(z));
    let lat = |y: f64| (std::f64::consts::PI * (1.0 - 2.0 * y / n)).sinh().atan().to_degrees();
    [f64::from(x) / n * 360.0 - 180.0, lat(f64::from(y) + 1.0), f64::from(x + 1) / n * 360.0 - 180.0, lat(f64::from(y))]
}

fn polygon(b: &[f64; 4]) -> Value {
    let [w, s, e, n] = *b;
    json!([[[w, s], [e, s], [e, n], [w, n], [w, s]]])
}

fn geometry(parts: &[[f64; 4]]) -> Value {
    if parts.len() == 1 {
        json!({"type": "Polygon", "coordinates": polygon(&parts[0])})
    } else {
        json!({"type": "MultiPolygon", "coordinates": parts.iter().map(polygon).collect::<Vec<_>>()})
    }
}

fn download_url(dataset: i64, shape: &str) -> String {
    format!(
        "https://{HOST}/download?geojson={}&ids={}",
        encode_component(shape),
        encode_component(&dataset.to_string())
    )
}

fn transfer_claim(url: &str) -> String {
    use sha2::{Digest, Sha256};
    format!(
        "transfer:{}",
        Sha256::digest(format!("GET\n{url}").as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

impl DnrLocal {
    pub fn open(dir: PathBuf, store: &csk_store::Store) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let rows: Result<Vec<String>, _> =
            store.read(|c| c.prepare("SELECT json FROM pinned.dnr_files")?.query_map([], |r| r.get(0))?.collect());
        // An unavailable index is not evidence that files are orphans.
        let Ok(rows) = rows else {
            return Self { dir, state: Mutex::new(State::default()), files: Mutex::new(Vec::new()) };
        };
        let files: Vec<LocalFile> = rows
            .iter()
            .filter_map(|j| serde_json::from_str::<LocalFile>(j).ok())
            .filter(|f| std::fs::metadata(dir.join(&f.file)).is_ok_and(|m| m.is_file() && m.len() == f.bytes))
            .collect();
        let mut revision = store
            .read(|c| c.query_row("SELECT revision FROM pinned.dnr_state WHERE id = 1", [], |r| r.get(0)))
            .unwrap_or(0i64);
        // A missing source invalidates checked regions too: otherwise it
        // would be reported ready forever after an interrupted move or purge.
        if files.len() != rows.len() {
            revision += 1;
            let _ = store.write(|c| {
                let tx = c.transaction()?;
                tx.execute("DELETE FROM pinned.dnr_files", [])?;
                tx.execute("DELETE FROM pinned.dnr_regions", [])?;
                for f in &files {
                    tx.execute(
                        "INSERT INTO pinned.dnr_files (key, json, added, used) VALUES (?1, ?2, ?3, ?3)",
                        params![f.key, serde_json::to_string(f).unwrap_or_default(), f.added],
                    )?;
                }
                tx.execute("INSERT OR REPLACE INTO pinned.dnr_state VALUES (1, ?1)", [revision])?;
                tx.commit()
            });
        }
        let held: HashSet<_> = files.iter().map(|f| f.file.as_str()).collect();
        // The index is the commit point. Unindexed final files and staging
        // directories belong to interrupted acquisitions, never to readers.
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let name = e.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("staging-") {
                    let _ = std::fs::remove_dir_all(e.path());
                } else if name.ends_with(".tif") && !held.contains(name.as_ref()) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        // Restore the admitted source request without needing the portal's
        // catalogue or query again. Its background transfer may already be ready.
        let pending: Option<String> =
            store.read(|c| c.query_row("SELECT json FROM pinned.dnr_acquisition WHERE id = 1", [], |r| r.get(0))).ok();
        let queue = pending.and_then(|text| serde_json::from_str::<Job>(&text).ok()).into_iter().collect();
        Self { dir, state: Mutex::new(State { revision, queue, ..State::default() }), files: Mutex::new(files) }
    }

    pub fn files(&self) -> Vec<LocalFile> {
        self.files.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn revision(&self) -> i64 {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).revision
    }

    pub fn path_of(&self, f: &LocalFile) -> PathBuf {
        self.dir.join(&f.file)
    }

    pub fn status(&self) -> Value {
        let files = self.files();
        let s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        json!({
            "revision": s.revision, "files": files.len(),
            // Request-planning hints only: each raster can still contain nodata.
            "cachedBounds": files.iter().map(|f| f.bounds).collect::<Vec<_>>(),
            "bytes": files.iter().map(|f| f.bytes).sum::<u64>(), "maxBytes": MAX_STORE,
            "archive": {"available": false},
            "active": s.active.as_ref().map(|(_, a)| a),
            "queued": s.queue.len(),
        })
    }

    fn set_active(&self, state: &str, bytes: u64, fraction: f64) {
        if let Some((_, a)) = self.state.lock().unwrap_or_else(|e| e.into_inner()).active.as_mut() {
            a.state = state.into();
            a.bytes = bytes;
            a.fraction = fraction;
        }
    }
}

fn regions_cover(store: &csk_store::Store, dataset: i64, bbox: &[f64; 4]) -> bool {
    store
        .read(|c| {
            c.prepare_cached(
                "SELECT 1 FROM pinned.dnr_regions WHERE dataset = ?1 AND w <= ?2 AND s <= ?3 AND e >= ?4 AND n >= ?5",
            )?
            .exists(params![dataset, bbox[0], bbox[1], bbox[2], bbox[3]])
        })
        .unwrap_or(false)
}

fn add_region(store: &csk_store::Store, dataset: i64, b: &[f64; 4]) {
    let _ = store.write(|c| {
        c.execute(
            "INSERT INTO pinned.dnr_regions (dataset, w, s, e, n) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![dataset, b[0], b[1], b[2], b[3]],
        )
    });
}

impl Engine {
    pub fn dnr_resume(self: &Arc<Self>) {
        self.dnr_drain();
    }

    /// Makes sure DNR elevation for this tile is local or on its way.
    pub async fn dnr_ensure(self: &Arc<Self>, z: u8, x: u32, y: u32) -> Ensure {
        let bbox = tile_lonlat(z, x, y);
        let catalog = match self.dnr_catalog().await {
            Ok(c) => c,
            Err(_) if self.dnr_local.files().iter().any(|f| f.covers(&bbox)) => return Ensure::Ready,
            Err(e) => return Ensure::Error(e),
        };
        let projects: Vec<_> = catalog
            .projects
            .iter()
            .filter(|p| p.dtm_dataset.is_some() && intersects(&p.bounds, &bbox))
            .cloned()
            .collect();
        if projects.is_empty() {
            return Ensure::Empty;
        }
        // Nearby cached rasters serve any zoom; acquire only at map scales
        // where DNR adds detail, and one z16 area at a time.
        if z < 13 {
            return Ensure::Overview;
        }
        let az = z.min(ACQUIRE_ZOOM);
        let scale = 1u32 << (z - az);
        let area = tile_lonlat(az, x / scale, y / scale);
        let files = self.dnr_local.files();
        let (mut pending, mut reason) = (false, None);
        {
            let mut s = self.dnr_local.state.lock().unwrap_or_else(|e| e.into_inner());
            for p in projects.iter().take(2) {
                let ds = p.dtm_dataset.unwrap_or_default();
                if regions_cover(&self.store, ds, &bbox) || files.iter().any(|f| f.dataset_id == ds && f.covers(&bbox))
                {
                    continue;
                }
                let id = format!("{ds}:{az}/{}/{}", x / scale, y / scale);
                if let Some((at, m)) = s.errors.get(&id)
                    && at.elapsed() < ERROR_BACKOFF
                {
                    reason = Some(m.clone());
                    continue;
                }
                if s.active.as_ref().is_some_and(|(a, _)| *a == id) {
                    pending = true;
                    continue;
                }
                if let Some(j) = s.queue.iter_mut().find(|j| j.id == id) {
                    j.touched = Instant::now();
                    pending = true;
                    continue;
                }
                if s.queue.len() >= MAX_QUEUE {
                    // Keep the areas the map asked for most recently.
                    let oldest = s.queue.iter().enumerate().min_by_key(|(_, j)| j.touched).map(|(i, _)| i);
                    if let Some(i) = oldest {
                        s.queue.remove(i);
                    }
                }
                s.queue.push(Job {
                    id,
                    bbox: area,
                    dataset: ds,
                    project: p.name.clone(),
                    year: p.year,
                    touched: Instant::now(),
                });
                pending = true;
            }
        }
        self.dnr_drain();
        if pending {
            Ensure::Pending
        } else if let Some(r) = reason {
            Ensure::Error(r)
        } else {
            Ensure::Ready
        }
    }

    /// Starts the next queued acquisition if none is running.
    fn dnr_drain(self: &Arc<Self>) {
        let job = {
            let mut s = self.dnr_local.state.lock().unwrap_or_else(|e| e.into_inner());
            if s.active.is_some() || s.queue.is_empty() {
                return;
            }
            let i = s.queue.iter().enumerate().max_by_key(|(_, j)| j.touched).map(|(i, _)| i).unwrap_or(0);
            let job = s.queue.remove(i);
            s.active = Some((
                job.id.clone(),
                Active { project: job.project.clone(), state: "checking".into(), ..Active::default() },
            ));
            job
        };
        let me = self.clone();
        tokio::spawn(async move {
            let id = job.id.clone();
            let recorded = me.store.write(|c| {
                c.execute(
                    "INSERT OR REPLACE INTO pinned.dnr_acquisition VALUES (1, ?1)",
                    [serde_json::to_string(&job).unwrap_or_default()],
                )
            });
            let result = match recorded {
                Ok(_) if me.work.checkpoint().await => me.dnr_acquire(&job).await,
                Ok(_) => return,
                Err(e) => Err(e.to_string()),
            };
            if me.work.is_stopped() {
                return;
            }
            let _ = me.store.write(|c| c.execute("DELETE FROM pinned.dnr_acquisition WHERE id = 1", []));
            {
                let mut s = me.dnr_local.state.lock().unwrap_or_else(|e| e.into_inner());
                s.active = None;
                if let Err(e) = result {
                    s.errors.insert(id, (Instant::now(), e));
                    while s.errors.len() > 64 {
                        let oldest = s.errors.iter().min_by_key(|(_, (t, _))| *t).map(|(k, _)| k.clone());
                        if let Some(k) = oldest {
                            s.errors.remove(&k);
                        }
                    }
                }
            }
            me.dnr_drain();
        });
    }

    async fn dnr_acquire(self: &Arc<Self>, job: &Job) -> Result<(), String> {
        let local = &self.dnr_local;
        let known: Vec<LocalFile> = local.files().into_iter().filter(|f| f.dataset_id == job.dataset).collect();
        if known.iter().any(|f| f.covers(&job.bbox)) {
            add_region(&self.store, job.dataset, &job.bbox);
            return Ok(());
        }
        let shape = geometry(&[job.bbox]).to_string();
        let staging = local.dir.join(format!("staging-{}", now_ms()));
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let _staging_owner = Staging(staging.clone());
        let download_url = download_url(job.dataset, &shape);
        local.set_active("downloading", 0, 0.0);
        let restored = self
            .upstream
            .restore_download(
                FetchRequest::get(&download_url).max_body(MAX_ARCHIVE as usize).to_file(staging.join("download.zip")),
            )
            .await
            .map_err(|e| e.to_string())?;
        let output_bytes = if restored.is_some() {
            local.set_active("preparing", 0, 0.0);
            if !self.work.checkpoint().await {
                return Err("engine stopped".into());
            }
            // The archived query was admitted before the system task began.
            // Bound extraction independently of its compressed size.
            archive_output_size(&staging.join("download.zip"))?
        } else {
            local.set_active("checking", 0, 0.0);
            if !self.work.checkpoint().await {
                return Err("engine stopped".into());
            }
            match self.dnr_download_plan(job, &shape).await? {
                // A compressed query estimate cannot bound ZIP expansion.
                Some(_) => MAX_ARCHIVE,
                None => {
                    let _ = std::fs::remove_dir_all(&staging);
                    return Ok(());
                }
            }
        };
        let protected: u64 = local.files().iter().filter(|f| intersects(&f.bounds, &job.bbox)).map(|f| f.bytes).sum();
        if protected.saturating_add(output_bytes) > MAX_STORE {
            return Err("DNR source preparation exceeds the local store budget".into());
        }
        let output = self.disk.claim(output_bytes).map_err(|e| e.to_string())?;
        let transfer = transfer_claim(&download_url);
        if restored.is_none() {
            // The platform journal uses this exact URL identity, so Rust and
            // URLSession update one archive claim rather than claiming twice.
            self.disk.budget.reserve(&transfer, MAX_ARCHIVE).map_err(|e| e.to_string())?;
        }
        let outcome = self.dnr_stage(job, &shape, &staging, &known, restored, output).await;
        let _ = std::fs::remove_dir_all(&staging);
        let added = match outcome {
            Ok(files) => files,
            Err(e) => {
                if !self.work.is_stopped() {
                    self.upstream.download_consumed(&download_url);
                    let _ = self.disk.budget.reserve(&transfer, 0);
                }
                return Err(e);
            }
        };
        // One transaction publishes the files and the region.
        let revision = local.revision() + 1;
        let committed = self.store.write(|c| {
            let tx = c.transaction()?;
            for f in &added {
                tx.execute(
                    "INSERT OR REPLACE INTO pinned.dnr_files (key, json, added, used) VALUES (?1, ?2, ?3, ?3)",
                    params![f.key, serde_json::to_string(f).unwrap_or_default(), f.added],
                )?;
            }
            tx.execute(
                "INSERT INTO pinned.dnr_regions (dataset, w, s, e, n) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![job.dataset, job.bbox[0], job.bbox[1], job.bbox[2], job.bbox[3]],
            )?;
            tx.execute("INSERT OR REPLACE INTO pinned.dnr_state VALUES (1, ?1)", [revision])?;
            tx.commit()
        });
        if let Err(e) = committed {
            for f in &added {
                let _ = std::fs::remove_file(local.path_of(f));
            }
            self.upstream.download_consumed(&download_url);
            return Err(e.to_string());
        }
        {
            let mut files = local.files.lock().unwrap_or_else(|e| e.into_inner());
            for f in added {
                files.retain(|x| x.key != f.key);
                files.push(f);
            }
        }
        local.state.lock().unwrap_or_else(|e| e.into_inner()).revision = revision;
        self.dnr_evict(&job.bbox);
        self.upstream.download_consumed(&download_url);
        let _ = self.disk.budget.reserve(&transfer, 0);
        Ok(())
    }

    /// Validate the portal estimate before starting a new transfer.
    async fn dnr_download_plan(&self, job: &Job, shape: &str) -> Result<Option<u64>, String> {
        let rows = self
            .upstream
            .fetch(
                FetchRequest::post_form(
                    format!("https://{HOST}/query"),
                    format!("geojson={}", encode_component(shape)),
                )
                .timeout(Duration::from_secs(30))
                .max_body(8 << 20),
            )
            .await
            .map_err(|e| e.to_string())?;
        if rows.status != 200 {
            return Err(format!("DNR download coverage HTTP {}", rows.status));
        }
        let rows: Value =
            serde_json::from_slice(&rows.body).map_err(|_| "Invalid DNR download coverage response".to_owned())?;
        if !rows.is_array() {
            return Err("Invalid DNR download coverage response".into());
        }
        let Some(dataset) = rows
            .as_array()
            .and_then(|a| a.iter().find(|r| r["dataset_id"] == job.dataset && r["dataset_name"] == "DTM"))
        else {
            add_region(&self.store, job.dataset, &job.bbox);
            return Ok(None);
        };
        let (Some(bytes), Some(files)) = (dataset["bytes"].as_u64(), dataset["files"].as_u64()) else {
            return Err("DNR did not provide a download size and file count".into());
        };
        if bytes > MAX_ARCHIVE || files as usize > MAX_FILES {
            return Err("DNR area exceeds the download budget; zoom in to a smaller area".into());
        }
        let protected: u64 =
            self.dnr_local.files().iter().filter(|f| intersects(&f.bounds, &job.bbox)).map(|f| f.bytes).sum();
        if protected.saturating_add(bytes) > MAX_STORE {
            return Err("DNR source preparation exceeds the local store budget".into());
        }
        Ok(Some(bytes))
    }

    async fn dnr_stage(
        self: &Arc<Self>,
        job: &Job,
        shape: &str,
        staging: &Path,
        known: &[LocalFile],
        restored: Option<FetchResponse>,
        output: Arc<csk_store::disk::Lease>,
    ) -> Result<Vec<LocalFile>, String> {
        let local = &self.dnr_local;
        let zip_path = staging.join("download.zip");
        let r = if let Some(response) = restored {
            response
        } else {
            // The download needs the website's session cookie.
            let page = self
                .upstream
                .fetch(FetchRequest::get(format!("https://{HOST}/")).max_body(4 << 20))
                .await
                .map_err(|e| e.to_string())?;
            if page.status != 200 {
                return Err(format!("DNR session HTTP {}", page.status));
            }
            let cookie = page.cookies().join("; ");
            local.set_active("downloading", 0, 0.0);
            let url = download_url(job.dataset, shape);
            self.upstream
                .fetch(
                    FetchRequest::get(url)
                        .header("Cookie", cookie)
                        .header("Referer", format!("https://{HOST}/"))
                        .timeout(Duration::from_secs(3600))
                        .max_body(MAX_ARCHIVE as usize)
                        .to_file(&zip_path),
                )
                .await
                .map_err(|e| format!("DNR elevation download: {e}"))?
        };
        let media = r.header("content-type").unwrap_or("").to_ascii_lowercase();
        if r.status != 200 || !(media.contains("zip") || media.contains("octet-stream")) {
            return Err(format!("DNR elevation download HTTP {}", r.status));
        }
        self.disk.budget.reserve(&transfer_claim(&download_url(job.dataset, shape)), 0).map_err(|e| e.to_string())?;
        if !self.work.checkpoint().await {
            return Err("engine stopped".into());
        }
        local.set_active("preparing", std::fs::metadata(&zip_path).map_or(0, |m| m.len()), 0.0);
        let known_paths: Vec<String> = known.iter().map(|f| f.archive_path.clone()).collect();
        let dir = staging.to_path_buf();
        let work = self.work.clone();
        let extracted = tokio::task::spawn_blocking(move || {
            let result = extract_controlled(&zip_path, &dir, &known_paths, &work);
            // Every output byte now occupies the volume; only future growth
            // belongs in the ledger. Keep the lease until blocking I/O ends.
            output.materialized().map_err(|e| e.to_string())?;
            result
        })
        .await
        .map_err(|_| "DNR extraction stopped".to_owned())??;
        if extracted.is_empty() && known.is_empty() {
            return Err("DNR download contained no readable elevation files".into());
        }
        let mut inspected = Vec::new();
        for (archive_path, file) in extracted {
            if !self.work.checkpoint().await {
                return Err("engine stopped".into());
            }
            let file = self
                .dnr_prepare(&file)
                .await
                .map_err(|e| format!("DNR dataset {}, {archive_path}: {e}", job.dataset))?;
            let info = self
                .dnr_inspect(job, &archive_path, &file)
                .await
                .map_err(|e| format!("DNR dataset {}, {archive_path}: {e}", job.dataset))?;
            inspected.push((file, info));
        }
        let protected: u64 = local.files().iter().filter(|f| intersects(&f.bounds, &job.bbox)).map(|f| f.bytes).sum();
        let prepared: u64 = inspected.iter().map(|(_, f)| f.bytes).sum();
        if protected.saturating_add(prepared) > MAX_STORE {
            return Err("Prepared DNR rasters exceed the local store budget".into());
        }
        // Validate every member before moving any member into the source store.
        let mut added: Vec<LocalFile> = Vec::new();
        for (file, info) in inspected {
            if let Err(e) = std::fs::rename(&file, local.dir.join(&info.file)) {
                for f in &added {
                    let _ = std::fs::remove_file(local.path_of(f));
                }
                return Err(e.to_string());
            }
            added.push(info);
        }
        Ok(added)
    }

    pub fn dnr_work_status(&self) -> (bool, bool) {
        let state = self.dnr_local.state.lock().unwrap_or_else(|e| e.into_inner());
        let pending = state.active.is_some() || !state.queue.is_empty();
        let cpu = state.active.as_ref().map_or(!state.queue.is_empty(), |(_, a)| a.state != "downloading");
        (pending, cpu)
    }

    /// Convert only strip layouts. Source archive and extracted TIFF stay
    /// available until every member validates; a partial output is never
    /// indexed. Existing tiled sources retain their upstream bytes.
    async fn dnr_prepare(self: &Arc<Self>, file: &Path) -> Result<PathBuf, String> {
        use csk_core::codec::{rows, tiled};
        use std::io::{Read, Seek, SeekFrom};
        let size = std::fs::metadata(file).map_err(|e| e.to_string())?.len();
        let key = format!("file:{}", file.display());
        let tiff = self.tiles.usgs.cog.header(&key, size).await.map_err(|e| e.to_string())?;
        let level = &tiff.levels[0];
        if !level.stripped {
            return Ok(file.to_owned());
        }
        // LERC strips are self-contained blobs. Keep the bounded existing
        // decoder for those; large blobs still fail the explicit block gate.
        if level.compression == 34887 {
            return Ok(file.to_owned());
        }
        if !tiff.complete || level.samples_per_pixel != 1 || level.block_width != level.width {
            return Err("DNR strip directory is incomplete or not a scalar elevation grid".into());
        }
        let decoder_bytes = rows::scratch_bytes(level).map_err(|e| e.to_string())?;
        let plan = tiled::Plan::new(level.width, level.height, &tiff.geo, MAX_ARCHIVE).map_err(|e| e.to_string())?;
        let estimate = plan.memory_bytes + decoder_bytes;
        let memory = self
            .memory
            .reserve(estimate)
            .or_else(|_| {
                self.tiles.usgs.cog.purge_memory();
                self.analysis.purge_memory();
                self.memory.reserve(estimate)
            })
            .map_err(|e| e.to_string())?;
        let disk = self.disk.claim(plan.max_bytes).map_err(|e| e.to_string())?;
        let output = file.with_extension("prepared.tif");
        let (input_path, output_path, work) = (file.to_owned(), output.clone(), self.work.clone());
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            // Both claims stay with blocking I/O if an async waiter leaves.
            let _memory = memory;
            let result = (|| -> std::io::Result<()> {
                let mut input = std::fs::File::open(&input_path)?;
                // Overview preparation reads already-written base tiles.
                let output = std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .open(&output_path)?;
                let mut writer = tiled::Writer::new(output, plan)?;
                let level = &tiff.levels[0];
                let count = level.height.div_ceil(level.block_height);
                if level.offsets.len() != count as usize || level.counts.len() != count as usize {
                    return Err(std::io::Error::other("DNR strip table length is invalid"));
                }
                for i in 0..count as usize {
                    let (offset, length) = (level.offsets[i], level.counts[i]);
                    if offset.checked_add(length).is_none_or(|end| end > size) || length == 0 {
                        return Err(std::io::Error::other("DNR strip range is outside the file"));
                    }
                    input.seek(SeekFrom::Start(offset))?;
                    let reader = work.reader((&mut input).take(length));
                    let actual_rows = level.block_height.min(level.height - i as u32 * level.block_height);
                    rows::decode(reader, level, tiff.little_endian, actual_rows, |_, row| {
                        if !work.checkpoint_blocking() {
                            return Err(std::io::Error::other("engine stopped"));
                        }
                        writer.row(row)
                    })?;
                }
                let output = writer.finish(|| {
                    if work.checkpoint_blocking() { Ok(()) } else { Err(std::io::Error::other("engine stopped")) }
                })?;
                output.sync_all()?;
                Ok(())
            })();
            if let Err(e) = result {
                let _ = std::fs::remove_file(&output_path);
                return Err(e.to_string());
            }
            disk.materialized().map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .map_err(|_| "DNR strip preparation stopped".to_owned())??;
        Ok(output)
    }

    async fn dnr_inspect(self: &Arc<Self>, job: &Job, archive_path: &str, file: &Path) -> Result<LocalFile, String> {
        let size = std::fs::metadata(file).map_err(|e| e.to_string())?.len();
        let key_text = format!("file:{}", file.display());
        let tiff = self.tiles.usgs.cog.header(&key_text, size).await.map_err(|e| e.to_string())?;
        let l = &tiff.levels[0];
        let g = &tiff.geo;
        if !tiff.complete {
            return Err("DNR raster directory is incomplete".into());
        }
        if l.samples_per_pixel != 1 {
            return Err("DNR DTM must be a single elevation band".into());
        }
        if g.transformation.len() >= 6 && (g.transformation[1] != 0.0 || g.transformation[4] != 0.0) {
            return Err("Rotated DNR raster grids are not supported".into());
        }
        if u64::from(l.block_width) * u64::from(l.block_height) * 4 > 32 << 20 {
            return Err("DNR raster block exceeds the 32 MiB decoding budget".into());
        }
        let (sx, sy) = (g.pixel_scale.first().copied().unwrap_or(0.0), g.pixel_scale.get(1).copied().unwrap_or(0.0));
        if !(sx > 0.0 && sy > 0.0) || g.tiepoint.len() < 5 {
            return Err("DNR raster must have a north-up pixel grid".into());
        }
        let proj = Projection::from_geokeys(g).map_err(|e| e.to_string())?;
        let origin = [g.tiepoint[3] - g.tiepoint[0] * sx, g.tiepoint[4] + g.tiepoint[1] * sy];
        let (w, h) = (f64::from(l.width), f64::from(l.height));
        let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        for i in 0..=16 {
            let f = f64::from(i) / 16.0;
            for (px, py) in [(f * w, 0.0), (f * w, h), (0.0, f * h), (w, f * h)] {
                let (lon, lat) = proj.inverse(origin[0] + px * sx, origin[1] - py * sy);
                b = [b[0].min(lon), b[1].min(lat), b[2].max(lon), b[3].max(lat)];
            }
        }
        let pixel_is_area = g.short(1025) != Some(2);
        let key: String = {
            use sha2::{Digest, Sha256};
            Sha256::digest(format!("{}:{archive_path}", job.dataset).as_bytes())
                .iter()
                .take(16)
                .map(|x| format!("{x:02x}"))
                .collect()
        };
        let mut info = LocalFile {
            file: format!("{key}.tif"),
            key,
            dataset_id: job.dataset,
            project: job.project.clone(),
            year: job.year,
            archive_path: archive_path.to_owned(),
            bytes: size,
            bounds: b,
            width: l.width,
            height: l.height,
            origin,
            resolution: [sx, -sy],
            pixel_is_area,
            nodata: g.nodata.filter(|v| v.is_finite()),
            vertical_meters: 1.0,
            vertical_basis: String::new(),
            native_meters: sx * proj.unit,
            proj: proj.into(),
            added: now_ms(),
        };
        let (vm, basis) = declared_vertical(g, job.dataset)
            .ok_or_else(|| "DNR raster has no documented vertical units; elevation was not substituted".to_owned())?;
        info.vertical_meters = vm;
        info.vertical_basis = basis;
        Ok(info)
    }

    /// Drops the least recently used rasters over the budget, never ones
    /// overlapping the area just prepared.
    fn dnr_evict(&self, protect: &[f64; 4]) {
        let local = &self.dnr_local;
        let mut files = local.files.lock().unwrap_or_else(|e| e.into_inner());
        let mut total: u64 = files.iter().map(|f| f.bytes).sum();
        if total <= MAX_STORE {
            return;
        }
        let mut order: Vec<LocalFile> = files.iter().filter(|f| !intersects(&f.bounds, protect)).cloned().collect();
        let used: HashMap<String, i64> = self
            .store
            .read(|c| {
                c.prepare("SELECT key, used FROM pinned.dnr_files")?
                    .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect()
            })
            .unwrap_or_default();
        order.sort_by_key(|f| used.get(&f.key).copied().unwrap_or(f.added));
        let revision = local.revision() + 1;
        for f in order {
            if total <= MAX_STORE {
                break;
            }
            let removed = self.store.write(|c| {
                let tx = c.transaction()?;
                tx.execute("DELETE FROM pinned.dnr_files WHERE key = ?1", params![f.key])?;
                tx.execute(
                    "DELETE FROM pinned.dnr_regions WHERE dataset = ?1 AND w < ?4 AND e > ?2 AND s < ?5 AND n > ?3",
                    params![f.dataset_id, f.bounds[0], f.bounds[1], f.bounds[2], f.bounds[3]],
                )?;
                tx.execute("INSERT OR REPLACE INTO pinned.dnr_state VALUES (1, ?1)", [revision])?;
                tx.commit()
            });
            if removed.is_err() {
                continue;
            }
            let _ = std::fs::remove_file(local.dir.join(&f.file));
            files.retain(|x| x.key != f.key);
            total -= f.bytes;
        }
        local.state.lock().unwrap_or_else(|e| e.into_inner()).revision = revision;
    }

    /// Samples prepared DNR rasters onto a tile (`size × size`, no skirt).
    pub async fn dnr_sample(
        self: &Arc<Self>,
        z: u8,
        x: u32,
        y: u32,
    ) -> Result<Option<(Vec<f32>, f64, f64, Vec<Value>)>, String> {
        let size = TILE_SIZE as usize;
        let _scratch = self.memory.reserve(size * size * 24).map_err(|e| e.to_string())?;
        let spec = TileSpec::new(z, x, y, TILE_SIZE);
        let bbox = tile_lonlat(z, x, y);
        let mut candidates: Vec<LocalFile> =
            self.dnr_local.files().into_iter().filter(|f| intersects(&f.bounds, &bbox)).collect();
        if candidates.is_empty() {
            return Ok(None);
        }
        candidates.sort_by(|a, b| a.native_meters.total_cmp(&b.native_meters).then(b.year.cmp(&a.year)));
        let mut grid = vec![f32::NAN; size * size];
        let mut sources = Vec::new();
        let mut failure = None;
        let mut filled = 0;
        let step = spec.step;
        let b = spec.bounds;
        for f in candidates {
            let key = format!("file:{}", self.dnr_local.path_of(&f).display());
            let tiff = match self.tiles.usgs.cog.header(&key, f.bytes).await {
                Ok(t) => t,
                Err(e) => {
                    failure = Some(e.to_string());
                    continue;
                }
            };
            // The coarsest level still no coarser than the output.
            let mut level = 0;
            for i in 0..tiff.levels.len() {
                let factor = (f64::from(f.width) / f64::from(tiff.levels[i].width))
                    .max(f64::from(f.height) / f64::from(tiff.levels[i].height));
                if factor * f.native_meters <= spec.ground_res {
                    level = i;
                } else {
                    break;
                }
            }
            let lv = &tiff.levels[level];
            let factor_x = f64::from(f.width) / f64::from(lv.width);
            let factor_y = f64::from(f.height) / f64::from(lv.height);
            let factor = factor_x.max(factor_y);
            let proj = f.proj.projection();
            // Project a coarse lattice and interpolate, as the USGS reader does.
            let k = 8usize;
            let m = (size - 1).div_ceil(k) + 1;
            let mut nodes = Vec::with_capacity(m * m);
            for j in 0..m {
                for i in 0..m {
                    let (lon, lat) = csk_core::geo::merc_to_lon_lat(
                        b.min_x + ((i * k) as f64 + 0.5) * step,
                        b.max_y - ((j * k) as f64 + 0.5) * step,
                    );
                    nodes.push(proj.forward(lon, lat));
                }
            }
            let shift_x = if f.pixel_is_area { 0.5 } else { 0.5 - 0.5 / factor_x };
            let shift_y = if f.pixel_is_area { 0.5 } else { 0.5 - 0.5 / factor_y };
            let (mut px, mut py) = (vec![0f64; size * size], vec![0f64; size * size]);
            let (mut minx, mut miny, mut maxx, mut maxy) =
                (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
            for j in 0..size {
                for i in 0..size {
                    let (ix, iy) = (i / k, j / k);
                    let (dx, dy) = ((i % k) as f64 / k as f64, (j % k) as f64 / k as f64);
                    let (a, bb, c, d) = (
                        nodes[iy * m + ix],
                        nodes[iy * m + ix + 1],
                        nodes[(iy + 1) * m + ix],
                        nodes[(iy + 1) * m + ix + 1],
                    );
                    let sx =
                        a.0 * (1.0 - dx) * (1.0 - dy) + bb.0 * dx * (1.0 - dy) + c.0 * (1.0 - dx) * dy + d.0 * dx * dy;
                    let sy =
                        a.1 * (1.0 - dx) * (1.0 - dy) + bb.1 * dx * (1.0 - dy) + c.1 * (1.0 - dx) * dy + d.1 * dx * dy;
                    let xx = (sx - f.origin[0]) / (f.resolution[0] * factor_x) - shift_x;
                    let yy = (sy - f.origin[1]) / (f.resolution[1] * factor_y) - shift_y;
                    px[j * size + i] = xx;
                    py[j * size + i] = yy;
                    minx = minx.min(xx);
                    maxx = maxx.max(xx);
                    miny = miny.min(yy);
                    maxy = maxy.max(yy);
                }
            }
            let (x0, y0) = (minx.floor().max(0.0) as i64, miny.floor().max(0.0) as i64);
            let (x1, y1) =
                ((maxx.ceil() as i64 + 2).min(i64::from(lv.width)), (maxy.ceil() as i64 + 2).min(i64::from(lv.height)));
            if x0 >= x1 || y0 >= y1 {
                continue;
            }
            // Every block the window touches, fetched together.
            let (bw, bh) = (i64::from(lv.block_width), i64::from(lv.block_height));
            let mut wanted = Vec::new();
            for ty in y0 / bh..=(y1 - 1) / bh {
                for tx in x0 / bw..=(x1 - 1) / bw {
                    wanted.push((tx as u32, ty as u32));
                }
            }
            if wanted.len() as u64 * lv.block_width as u64 * lv.block_height as u64 * 4 > 64 << 20 {
                failure = Some("DNR sampling window exceeds the memory budget; zoom in".into());
                continue;
            }
            let fetched = futures_util::future::join_all(wanted.iter().map(|&(tx, ty)| {
                let (key, tiff) = (&key, &tiff);
                async move { ((tx, ty), self.tiles.usgs.cog.block(key, tiff, level, tx, ty).await) }
            }))
            .await;
            for (_, result) in &fetched {
                if let Err(e) = result {
                    failure = Some(e.to_string());
                }
            }
            let blocks: HashMap<(u32, u32), Arc<csk_core::resource::Samples>> =
                fetched.into_iter().filter_map(|(k, r)| r.ok().flatten().map(|b| (k, b))).collect();
            let at = |cx: i64, cy: i64| -> f64 {
                if cx < 0 || cy < 0 || cx >= i64::from(lv.width) || cy >= i64::from(lv.height) {
                    return f64::NAN;
                }
                let Some(bl) = blocks.get(&((cx / bw) as u32, (cy / bh) as u32)) else { return f64::NAN };
                let raw = f64::from(bl[((cy % bh) * bw + cx % bw) as usize]);
                if f.nodata.is_some_and(|nd| raw == nd) {
                    return f64::NAN;
                }
                let v = raw * f.vertical_meters;
                if v.is_finite() && v > -20000.0 && v < 10000.0 { v } else { f64::NAN }
            };
            let mut used = 0usize;
            for i in 0..grid.len() {
                if grid[i].is_finite() {
                    continue;
                }
                let (fx, fy) = (px[i], py[i]);
                if fx < -0.5 || fy < -0.5 || fx > f64::from(lv.width) - 0.5 || fy > f64::from(lv.height) - 0.5 {
                    continue;
                }
                let (xx, yy) = (fx.floor(), fy.floor());
                let (dx, dy) = (fx - xx, fy - yy);
                let (mut sum, mut weight) = (0.0, 0.0);
                for (ox, oy, w) in
                    [(0, 0, (1.0 - dx) * (1.0 - dy)), (1, 0, dx * (1.0 - dy)), (0, 1, (1.0 - dx) * dy), (1, 1, dx * dy)]
                {
                    let v = at(xx as i64 + ox, yy as i64 + oy);
                    if v.is_finite() && w > 0.0 {
                        sum += v * w;
                        weight += w;
                    }
                }
                if weight > 0.0 {
                    grid[i] = (sum / weight) as f32;
                    used += 1;
                }
            }
            if used > 0 {
                let at = now_ms();
                let _ = self.store.write(|c| {
                    c.execute(
                        "UPDATE pinned.dnr_files SET used = ?2 WHERE key = ?1 AND used < ?3",
                        params![f.key, at, at - 60_000],
                    )
                });
                sources.push(json!({"project": f.project, "datasetId": f.dataset_id, "nativeMeters": f.native_meters,
                    "sampleMeters": f.native_meters * factor, "pixels": used, "verticalUnits": "metres",
                    "verticalUnitBasis": f.vertical_basis}));
                filled += used;
                if filled == grid.len() {
                    break;
                }
            }
        }
        let covered: u64 = sources.iter().map(|s| s["pixels"].as_u64().unwrap_or(0)).sum();
        if covered == 0
            && let Some(e) = failure
        {
            return Err(e);
        }
        Ok((covered > 0).then(|| (grid, covered as f64 / (size * size) as f64, spec.ground_res, sources)))
    }
}

/// Vertical units the file itself (or a survey correction) declares.
fn declared_vertical(g: &Geo, dataset: i64) -> Option<(f64, String)> {
    // DNR dataset 1543 labels stored US survey feet as metres (vendor QA
    // report, dataset 1547 p3); an explicit correction, never inferred.
    if dataset == 1543 {
        return Some((US_FOOT, "DNR survey QA report: US survey feet; conflicting TIFF metre tag corrected".into()));
    }
    match g.short(4099) {
        Some(9001) => return Some((1.0, "VerticalUnitsGeoKey: metre".into())),
        Some(9002) => return Some((0.3048, "VerticalUnitsGeoKey: foot".into())),
        Some(9003) => return Some((US_FOOT, "VerticalUnitsGeoKey: US survey foot".into())),
        _ => {}
    }
    if dataset == 1603 {
        return Some((
            US_FOOT,
            "DNR metadata dataset 1607: WGS_QA_king_county_east_2021.pdf p3, US survey feet (NAVD88, GEOID18)".into(),
        ));
    }
    let citation =
        [g.ascii(3073), g.ascii(1026), g.ascii(4097)].iter().flatten().copied().collect::<Vec<_>>().join("|");
    for tag in ["VERTCS[", "VERT_CS["] {
        if let Some(start) = citation.find(tag) {
            let tail = &citation[start..];
            let (mut depth, mut quoted, mut end) = (0i32, false, tail.len());
            for (i, c) in tail.char_indices() {
                if c == '"' {
                    quoted = !quoted;
                }
                if !quoted {
                    if c == '[' {
                        depth += 1;
                    }
                    if c == ']' {
                        depth -= 1;
                    }
                    if depth == 0 && c == ']' {
                        end = i + 1;
                        break;
                    }
                }
            }
            let part = &tail[..end];
            if let Some(u) = part.rfind("UNIT[") {
                let after = &part[u..];
                let value: Option<f64> =
                    after.split(',').nth(1).and_then(|v| v.trim_end_matches([']', ' ']).trim().parse().ok());
                if let Some(v) = value.filter(|v| *v > 0.0 && *v <= 1.0) {
                    return Some((v, "vertical CRS in the file's citation".into()));
                }
            }
        }
    }
    let vc = g.ascii(4097).unwrap_or("").to_ascii_lowercase();
    if let Some(i) = vc.find("unit name") {
        let label = vc[i + "unit name".len()..].trim_start_matches([' ', '=']);
        if label.starts_with("meter") || label.starts_with("metre") {
            return Some((1.0, "VerticalCitationGeoKey".into()));
        }
        if label.starts_with("foot_us") {
            return Some((US_FOOT, "VerticalCitationGeoKey".into()));
        }
        if label.starts_with("foot") || label.starts_with("feet") {
            return Some((0.3048, "VerticalCitationGeoKey".into()));
        }
    }
    None
}

/// Inspect the central directory before admitting restored extraction. The
/// archive already occupies disk; reserve only its bounded output from here.
fn archive_output_size(path: &Path) -> Result<u64, String> {
    let mut archive =
        zip::ZipArchive::new(std::fs::File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut bytes = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        bytes = bytes.checked_add(entry.size()).ok_or("DNR archive output size overflow")?;
        if bytes > MAX_ARCHIVE {
            return Err("DNR extracted data exceeds the acquisition budget".into());
        }
    }
    Ok(bytes)
}

/// Extracts every TIFF in the archive not already held, with CRCs checked.
#[cfg(test)]
fn extract(zip_path: &Path, dir: &Path, known: &[String]) -> Result<Vec<(String, PathBuf)>, String> {
    extract_controlled(zip_path, dir, known, &crate::work::Work::default())
}

fn extract_controlled(
    zip_path: &Path,
    dir: &Path,
    known: &[String],
    work: &crate::work::Work,
) -> Result<Vec<(String, PathBuf)>, String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("DNR archive: {e}"))?;
    let mut out = Vec::new();
    let mut written = 0u64;
    let mut seen = HashSet::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("DNR archive: {e}"))?;
        let name = entry.name().map_err(|e| format!("DNR archive: {e}"))?.into_owned();
        if !name.to_ascii_lowercase().ends_with(".tif") && !name.to_ascii_lowercase().ends_with(".tiff") {
            continue;
        }
        if !seen.insert(name.clone()) {
            return Err("DNR archive contains duplicate elevation paths".into());
        }
        if known.contains(&name) {
            continue;
        }
        if entry.encrypted() {
            return Err("DNR archive member is encrypted".into());
        }
        if out.len() >= MAX_FILES {
            return Err("DNR archive contains too many elevation files".into());
        }
        let expected = entry.size();
        if expected > MAX_ARCHIVE - written {
            return Err("DNR extracted data exceeds the acquisition budget".into());
        }
        // Archive paths are identifiers only: nothing is written under them.
        let dest = dir.join(format!("entry-{i}.tif"));
        let mut f = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        // Reading to the end verifies the member's CRC-32.
        let copied =
            std::io::copy(&mut work.reader(std::io::Read::take(&mut entry, MAX_ARCHIVE - written + 1)), &mut f)
                .map_err(|e| format!("DNR elevation archive: {e}"))?;
        if copied != expected || copied > MAX_ARCHIVE - written {
            return Err("DNR archive member has an invalid size".into());
        }
        written += copied;
        f.sync_all().map_err(|e| e.to_string())?;
        out.push((name, dest));
    }
    if seen.is_empty() {
        return Err("DNR archive contains no elevation files".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{FetchFuture, FetchResponse, Transport};
    use csk_core::codec::GeoValue;

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(
                    name,
                    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn vertical_units_require_documented_evidence() {
        let mut g = Geo { keys: vec![(3076, GeoValue::Short(9003))], ..Geo::default() };
        assert!(declared_vertical(&g, 0).is_none());
        assert_eq!(declared_vertical(&g, 1603).unwrap().0, US_FOOT);
        g.keys.push((4099, GeoValue::Short(9001)));
        assert_eq!(declared_vertical(&g, 0).unwrap().0, 1.0);
        assert_eq!(declared_vertical(&g, 1543).unwrap().0, US_FOOT);
        g.keys = vec![(4097, GeoValue::Ascii(
            r#"COMPD_CS["test",VERT_CS["NAVD88",UNIT["Foot_US",0.3048006096012192]],PROJCS["horizontal",UNIT["metre",1]]]"#.into()
        ))];
        assert_eq!(declared_vertical(&g, 0).unwrap().0, US_FOOT);
    }

    #[test]
    fn zip_crc_and_paths_are_checked() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("download.zip");
        let data = b"unique terrain payload";
        let mut bytes = archive(&[("../../escape.tif", data)]);
        std::fs::write(&zip, &bytes).unwrap();
        let files = extract(&zip, dir.path(), &[]).unwrap();
        assert_eq!(files[0].1, dir.path().join("entry-0.tif"));
        assert_eq!(std::fs::read(&files[0].1).unwrap(), data);
        let pos = bytes.windows(data.len()).position(|w| w == data).unwrap();
        bytes[pos] ^= 1;
        std::fs::write(&zip, bytes).unwrap();
        assert!(extract(&zip, dir.path(), &[]).is_err());
    }

    struct Portal(Vec<u8>);
    impl Transport for Portal {
        fn fetch(&self, r: FetchRequest) -> FetchFuture {
            let bytes = self.0.clone();
            Box::pin(async move {
                if let Some(dest) = r.dest {
                    assert!(r.headers.iter().any(|(k, v)| k == "Cookie" && v == "session=ok"));
                    std::fs::write(dest, bytes).unwrap();
                    Ok(FetchResponse {
                        status: 200,
                        headers: vec![("Content-Type".into(), "application/zip".into())],
                        body: vec![],
                        reservation: None,
                    })
                } else {
                    Ok(FetchResponse {
                        status: 200,
                        headers: vec![("Set-Cookie".into(), "session=ok; Path=/".into())],
                        body: vec![],
                        reservation: None,
                    })
                }
            })
        }
    }

    struct RestoredArchive(Vec<u8>);
    impl Transport for RestoredArchive {
        fn fetch(&self, _: FetchRequest) -> FetchFuture {
            panic!("restored ingestion must not contact the portal")
        }
        fn restore_download(&self, r: FetchRequest) -> crate::transport::RestoreFuture {
            let bytes = self.0.clone();
            Box::pin(async move {
                std::fs::write(r.dest.unwrap(), bytes).unwrap();
                Ok(Some(FetchResponse {
                    status: 200,
                    headers: vec![("Content-Type".into(), "application/zip".into())],
                    body: vec![],
                    reservation: None,
                }))
            })
        }
    }

    /// A single raw strip bigger than the old whole-block decode ceiling.
    /// Construct it on disk so the test itself never holds a giant raster.
    fn giant_strip(path: &Path) {
        use std::io::Write;
        let (w, h) = (4097u32, 2049u32);
        let keys: [u16; 24] =
            [1, 1, 0, 5, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 26910, 3076, 0, 1, 9001, 4099, 0, 1, 9003];
        let mut tags: Vec<(u16, u16, u32, Vec<u8>)> = Vec::new();
        for (id, value) in [(256, w), (257, h), (273, 0), (278, h), (279, w * h * 4)] {
            tags.push((id, 4, 1, value.to_le_bytes().to_vec()));
        }
        for (id, value) in [(258, 32u16), (259, 1), (262, 1), (277, 1), (339, 3)] {
            tags.push((id, 3, 1, value.to_le_bytes().to_vec()));
        }
        tags.push((33550, 12, 3, [0.5f64, 0.5, 0.0].iter().flat_map(|v| v.to_le_bytes()).collect()));
        tags.push((
            33922,
            12,
            6,
            [0.0f64, 0.0, 0.0, 500000.0, 5300000.0, 0.0].iter().flat_map(|v| v.to_le_bytes()).collect(),
        ));
        tags.push((34735, 3, keys.len() as u32, keys.iter().flat_map(|v| v.to_le_bytes()).collect()));
        tags.sort_by_key(|t| t.0);
        let mut bytes = vec![0; 8 + 2 + tags.len() * 12 + 4];
        bytes[..8].copy_from_slice(&[b'I', b'I', 42, 0, 8, 0, 0, 0]);
        bytes[8..10].copy_from_slice(&(tags.len() as u16).to_le_bytes());
        let mut strip_entry = 0;
        for (i, (id, kind, count, data)) in tags.iter().enumerate() {
            let at = 10 + i * 12;
            bytes[at..at + 2].copy_from_slice(&id.to_le_bytes());
            bytes[at + 2..at + 4].copy_from_slice(&kind.to_le_bytes());
            bytes[at + 4..at + 8].copy_from_slice(&count.to_le_bytes());
            if *id == 273 {
                strip_entry = at + 8;
            }
            if data.len() <= 4 {
                bytes[at + 8..at + 8 + data.len()].copy_from_slice(data);
            } else {
                let offset = bytes.len() as u32;
                bytes[at + 8..at + 12].copy_from_slice(&offset.to_le_bytes());
                bytes.extend_from_slice(data);
            }
        }
        let offset = bytes.len() as u32;
        bytes[strip_entry..strip_entry + 4].copy_from_slice(&offset.to_le_bytes());
        let mut file = std::fs::File::create(path).unwrap();
        file.write_all(&bytes).unwrap();
        for y in 0..h {
            let row: Vec<u8> = (0..w).flat_map(|x| (1000.0f32 + ((x + y) % 32) as f32 / 4.0).to_le_bytes()).collect();
            file.write_all(&row).unwrap();
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn giant_strips_prepare_with_admission_pause_and_numeric_routes() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.tif");
        giant_strip(&source);
        let engine = Engine::for_test(
            crate::Config {
                cache_dir: dir.path().join("cache"),
                data_dir: None,
                cache_budget: 1 << 20,
                usgs_scope: Some(vec![]),
            },
            Arc::new(Portal(Vec::new())),
        )
        .unwrap();
        let job = Job {
            id: "strip".into(),
            bbox: [-124.0, 46.0, -121.0, 49.0],
            dataset: 0,
            project: "Strip fixture".into(),
            year: 2021,
            touched: Instant::now(),
        };
        assert!(engine.dnr_inspect(&job, "strip.tif", &source).await.unwrap_err().contains("32 MiB"));
        engine.memory.set_limit(1024);
        assert!(engine.dnr_prepare(&source).await.is_err());
        assert!(!source.with_extension("prepared.tif").exists());
        engine.memory.set_limit(256 << 20);
        engine.work.set_allowed(false);
        let worker = engine.clone();
        let input = source.clone();
        let mut task = tokio::spawn(async move { worker.dnr_prepare(&input).await });
        assert!(tokio::time::timeout(Duration::from_millis(30), &mut task).await.is_err());
        assert!(engine.memory.stats().used > 0, "parked preparation retains its memory charge");
        engine.work.set_allowed(true);
        let prepared = task.await.unwrap().unwrap();
        let mut info = engine.dnr_inspect(&job, "strip.tif", &prepared).await.unwrap();
        assert_eq!((info.width, info.height), (4097, 2049));
        assert_eq!(info.vertical_meters, US_FOOT);
        let bytes = std::fs::read(&prepared).unwrap();
        let tiff = csk_core::codec::parse(&bytes).unwrap();
        assert!(tiff.levels.len() > 1);
        assert!(tiff.levels.iter().all(|l| !l.stripped && l.block_width * l.block_height * 4 <= 256 * 256 * 4));
        for (x, y) in [(0, 0), (4096, 2048), (256, 257), (1234, 1000)] {
            let level = &tiff.levels[0];
            let index = (y / level.block_height * level.blocks_across() + x / level.block_width) as usize;
            let offset = level.offsets[index] as usize;
            let count = level.counts[index] as usize;
            let tile = csk_core::codec::decode_block(&bytes[offset..offset + count], level, true).unwrap();
            assert_eq!(
                tile[((y % level.block_height) * level.block_width + x % level.block_width) as usize],
                1000.0 + ((x + y) % 32) as f32 / 4.0
            );
        }
        std::fs::rename(&prepared, engine.dnr_local.path_of(&info)).unwrap();
        info.added = now_ms();
        *engine.dnr_local.files.lock().unwrap() = vec![info.clone()];
        let (lon, lat) = ((info.bounds[0] + info.bounds[2]) / 2.0, (info.bounds[1] + info.bounds[3]) / 2.0);
        let n = 2f64.powi(16);
        let x = ((lon + 180.0) / 360.0 * n) as u32;
        let y = ((1.0 - lat.to_radians().tan().asinh() / std::f64::consts::PI) / 2.0 * n) as u32;
        let response = engine
            .handle(crate::Request::new("GET", &format!("/api/elev32/wadnr/16/{x}/{y}?acquire=0"), vec![]).unwrap())
            .await;
        assert_eq!(response.status, 200);
        assert_eq!(response.get("X-Elevation-Source"), Some("wadnr-dtm"));
        let values: Vec<f32> =
            csk_core::elev32::decode(&response.body).unwrap().samples().filter(|v| v.is_finite()).collect();
        assert!(values.len() > 32000);
        assert!(values.iter().all(|v| *v > 304.0 && *v < 308.0), "source feet convert to metres exactly once");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn admitted_acquisition_restores_without_portal_or_catalogue() {
        let dir = tempfile::tempdir().unwrap();
        let config = crate::Config {
            cache_dir: dir.path().into(),
            data_dir: None,
            cache_budget: 1 << 20,
            usgs_scope: Some(vec![]),
        };
        let bytes = archive(&[("offline.tif", include_bytes!("../../../fixtures/tiff/usgs-tiled-lzw-fp.tif"))]);
        let engine = Engine::for_test(config.clone(), Arc::new(RestoredArchive(bytes.clone()))).unwrap();
        let job = Job {
            id: "offline".into(),
            bbox: [-124.0, 46.0, -121.0, 49.0],
            dataset: 1603,
            project: "Offline".into(),
            year: 2021,
            touched: Instant::now(),
        };
        engine
            .store
            .write(|c| {
                c.execute("INSERT INTO pinned.dnr_acquisition VALUES (1, ?1)", [serde_json::to_string(&job).unwrap()])
            })
            .unwrap();
        drop(engine);
        let engine = Engine::for_test(config, Arc::new(RestoredArchive(bytes))).unwrap();
        let restored = engine.dnr_local.state.lock().unwrap().queue.pop().unwrap();
        assert_eq!(restored.id, job.id);
        // Exercise the exact restore and ingest boundary without depending on
        // the test runner's available disk space or volume reserve.
        let staging = engine.dnr_local.dir.join("staging-offline");
        std::fs::create_dir(&staging).unwrap();
        let response = engine
            .upstream
            .restore_download(
                FetchRequest::get(download_url(job.dataset, &geometry(&[job.bbox]).to_string()))
                    .to_file(staging.join("download.zip")),
            )
            .await
            .unwrap()
            .unwrap();
        assert!(archive_output_size(&staging.join("download.zip")).unwrap() > 0);
        let files = engine
            .dnr_stage(&restored, "{}", &staging, &[], Some(response), engine.disk.claim(MAX_ARCHIVE).unwrap())
            .await
            .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].project, "Offline");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn ingestion_validates_all_members_and_recovers_missing_sources() {
        let fixture = include_bytes!("../../../fixtures/tiff/usgs-tiled-lzw-fp.tif");
        let dir = tempfile::tempdir().unwrap();
        let config = crate::Config {
            cache_dir: dir.path().into(),
            data_dir: None,
            cache_budget: 1 << 20,
            usgs_scope: Some(vec![]),
        };
        let engine = Engine::for_test(
            config.clone(),
            Arc::new(Portal(archive(&[("valid.tif", fixture), ("bad.tif", b"bad TIFF")]))),
        )
        .unwrap();
        let job = Job {
            id: "test".into(),
            bbox: [-124.0, 46.0, -121.0, 49.0],
            dataset: 1603,
            project: "Test".into(),
            year: 2021,
            touched: Instant::now(),
        };
        let staging = engine.dnr_local.dir.join("staging-test");
        std::fs::create_dir(&staging).unwrap();
        assert!(
            engine.dnr_stage(&job, "{}", &staging, &[], None, engine.disk.claim(MAX_ARCHIVE).unwrap()).await.is_err()
        );
        assert!(std::fs::read_dir(&engine.dnr_local.dir).unwrap().all(|e| e.unwrap().path().is_dir()));
        drop(engine);

        let engine = Engine::for_test(config, Arc::new(Portal(archive(&[("valid.tif", fixture)])))).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        let files =
            engine.dnr_stage(&job, "{}", &staging, &[], None, engine.disk.claim(MAX_ARCHIVE).unwrap()).await.unwrap();
        let f = &files[0];
        assert_eq!(f.vertical_meters, US_FOOT);
        assert!(f.vertical_basis.contains("1607"));
        *engine.dnr_local.files.lock().unwrap() = files.clone();
        let lon = (f.bounds[0] + f.bounds[2]) / 2.0;
        let lat = (f.bounds[1] + f.bounds[3]) / 2.0;
        let n = 2f64.powi(18);
        let x = ((lon + 180.0) / 360.0 * n) as u32;
        let y = ((1.0 - lat.to_radians().tan().asinh() / std::f64::consts::PI) / 2.0 * n) as u32;
        let tile = engine
            .handle(crate::Request::new("GET", &format!("/api/elev32/wadnr/18/{x}/{y}?acquire=0"), vec![]).unwrap())
            .await;
        assert_eq!(tile.status, 200);
        assert_eq!(tile.get("X-Elevation-Source"), Some("wadnr-dtm"));
        let grid: Vec<f32> = csk_core::elev32::decode(&tile.body).unwrap().samples().collect();
        assert!(grid.iter().any(|v| v.is_finite()));
        assert!(grid.iter().filter(|v| v.is_finite()).all(|v| *v > 250.0 && *v < 400.0));
        engine
            .store
            .write(|c| {
                c.execute(
                    "INSERT INTO pinned.dnr_files VALUES (?1, ?2, 1, 1)",
                    params![f.key, serde_json::to_string(f).unwrap()],
                )?;
                c.execute("INSERT INTO pinned.dnr_regions VALUES (1603,-124,46,-121,49)", [])
            })
            .unwrap();
        std::fs::remove_file(engine.dnr_local.path_of(f)).unwrap();
        std::fs::write(engine.dnr_local.dir.join("orphan.tif"), b"interrupted publish").unwrap();
        let restored = DnrLocal::open(engine.dnr_local.dir.clone(), &engine.store);
        assert!(restored.files().is_empty());
        assert!(!regions_cover(&engine.store, 1603, &job.bbox));
        assert!(!restored.dir.join("orphan.tif").exists());
        assert!(restored.revision() > 0);
    }

    #[test]
    fn acquisition_tile_bounds() {
        let t = tile_lonlat(16, 10665, 22938);
        assert!(t[0] < -121.41 && t[2] > -121.41 && t[1] < 47.42 && t[3] > 47.42);
    }
}
