//! The ClearSkies engine, in the app's process (docs/native/ARCHITECTURE.md).
//!
//! [`Engine`] owns the store, the upstream lanes, the sources and the tile
//! service; [`router::handle`] answers the web client's `/api` requests.
//! Network access goes through a [`transport::Transport`] the platform
//! provides (URLSession on iOS).

pub mod analysis;
pub mod areas;
pub mod dnr;
pub mod flight;
pub mod markup;
pub mod national;
pub mod proxies;
pub mod router;
pub mod tiles;
pub mod transport;
pub mod upstream;
pub mod usgs;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use csk_store::{Kind, Store, UserStore};
use serde::Deserialize;
use serde_json::json;

pub use router::{Request, Response};
use tiles::Tiles;
use transport::{FetchRequest, Transport};
use upstream::{DEP_HOST, TERRARIUM_HOST, Upstream};
use usgs::{Catalog, CogReader, Usgs};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// What the platform tells the engine at start.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Disposable data (`Library/Caches` on iOS).
    pub cache_dir: PathBuf,
    /// User state (Application Support on iOS): kept, backed up, never
    /// evicted. Defaults to `<cache_dir>/user` for desktop tools.
    #[serde(default)]
    pub data_dir: Option<PathBuf>,
    /// Cache budget in bytes.
    #[serde(default = "default_budget")]
    pub cache_budget: u64,
    /// USGS project prefixes to discover; `["ALL"]` for the whole archive.
    #[serde(default)]
    pub usgs_scope: Option<Vec<String>>,
}

/// Parses a [`Config`] from the platform's JSON.
pub fn config_from_json(text: &str) -> Result<Config, serde_json::Error> {
    serde_json::from_str(text)
}

fn default_budget() -> u64 {
    4 << 30
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error(transparent)]
    Store(#[from] csk_store::StoreError),
}

pub struct Engine {
    pub store: Arc<Store>,
    pub upstream: Arc<Upstream>,
    pub tiles: Arc<Tiles>,
    pub user: Arc<UserStore>,
    pub downloads: areas::Downloads,
    pub analysis: analysis::Analysis,
    pub dnr: dnr::Dnr,
    /// Proxy fetches shared while in flight.
    proxy_flights: flight::Flights<String, Option<(Vec<u8>, String, bool)>>,
    started: Instant,
}

/// Features the web client may use (`/api/health` → `features`). Only what
/// this engine really answers is listed.
pub const FEATURES: &[&str] = &["overview-elevation", "elev32", "built-in", "markup", "wadnr-dpi"];

impl Engine {
    pub fn new(config: Config, transport: Arc<dyn Transport>) -> Result<Arc<Self>, EngineError> {
        let data_dir = config.data_dir.clone().unwrap_or_else(|| config.cache_dir.join("user"));
        // Offline areas: in data_dir (not purgeable), under offline/ (the
        // platform excludes it from backup: it can be downloaded again).
        let store = Arc::new(Store::open(
            &config.cache_dir.join("engine.sqlite"),
            &data_dir.join("offline").join("pinned.sqlite"),
            config.cache_budget,
        )?);
        let user = Arc::new(UserStore::open(&data_dir.join("user.sqlite"))?);
        let upstream = Arc::new(Upstream::new(transport));
        let scope =
            config.usgs_scope.unwrap_or_else(|| usgs::catalog::DEFAULT_SCOPE.iter().map(|s| (*s).to_owned()).collect());
        let catalog = Catalog::new(store.clone(), upstream.clone(), scope);
        let cog = CogReader::new(store.clone(), upstream.clone(), Usgs::s3_origin());
        let usgs = Arc::new(Usgs::new(catalog, cog));
        let tiles = Tiles::new(store.clone(), upstream.clone(), usgs);
        Ok(Arc::new(Self {
            store,
            upstream,
            tiles,
            user,
            downloads: areas::Downloads::default(),
            analysis: analysis::Analysis::default(),
            dnr: dnr::Dnr::default(),
            proxy_flights: flight::Flights::default(),
            started: Instant::now(),
        }))
    }

    /// Starts background work that should not wait for the first request.
    pub fn warm(self: &Arc<Self>) {
        let catalog = self.tiles.usgs.catalog.clone();
        tokio::spawn(async move {
            let _ = catalog.ensure().await;
        });
        // A download the system stopped (the app was killed) carries on.
        areas::resume(self);
    }

    pub async fn handle(self: &Arc<Self>, req: Request) -> Response {
        router::handle(self, req).await
    }

    pub fn health(&self) -> Response {
        let stats = self.store.stats().unwrap_or_default();
        let catalog = &self.tiles.usgs.catalog;
        let meta = catalog.meta();
        Response::json(
            200,
            &json!({
                "ok": true,
                "engine": "built-in",
                "engineVersion": VERSION,
                "cached": stats.entries,
                "cacheBudget": {"bytes": stats.bytes, "budget": stats.budget,
                                "pinnedEntries": stats.pinned_entries, "pinnedBytes": stats.pinned_bytes},
                "nationalCircuit": self.upstream.circuit_state(DEP_HOST),
                "uptimeSec": self.started.elapsed().as_secs(),
                "features": FEATURES,
                "usgsCatalog": {
                    "complete": catalog.complete(),
                    "built": meta.as_ref().map(|m| m.built),
                    "projects": meta.as_ref().map_or(0, |m| m.projects),
                    "failed": meta.as_ref().map_or(0, |m| m.failed.len()),
                },
                "dnr": self.dnr_status(),
            }),
        )
    }

    /// A global Terrarium overview tile (256² PNG), cached verbatim.
    pub async fn overview(&self, z: u8, x: u32, y: u32) -> Result<(Vec<u8>, bool), String> {
        let key = format!("overview:{z}/{x}/{y}");
        if let Ok(Some(hit)) = self.store.get(&key, tiles::TILE_TTL) {
            return Ok((hit.body, true));
        }
        let url = format!("https://{TERRARIUM_HOST}/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png");
        let r = self
            .upstream
            .fetch(FetchRequest::get(url).timeout(Duration::from_secs(8)).max_body(1 << 20))
            .await
            .map_err(|e| e.to_string())?;
        let b = &r.body;
        let ok = r.status == 200
            && b.len() >= 24
            && b.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
            && b[16..20] == 256u32.to_be_bytes()
            && b[20..24] == 256u32.to_be_bytes();
        if !ok {
            return Err(format!("overview answered {}", r.status));
        }
        let _ = self.store.put(&key, Kind::Source, 200, "image/png", None, &r.body);
        Ok((r.body, false))
    }
}
