//! Polite, bounded access to upstream hosts: a concurrency limit per host,
//! and a circuit breaker for hosts that fail in runs (3DEP's ImageServer),
//! so a down service costs one probe per cool-down instead of one per tile.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;

use crate::transport::{FetchError, FetchRequest, FetchResponse, Transport};

pub const S3_HOST: &str = "prd-tnm.s3.amazonaws.com";
pub const DEP_HOST: &str = "elevation.nationalmap.gov";
pub const TERRARIUM_HOST: &str = "s3.amazonaws.com";

/// Concurrent requests per host. Range reads are latency-bound, so S3 gets
/// more lanes; ImageServer exports are CPU-bound on the server.
fn lanes(host: &str) -> usize {
    match host {
        S3_HOST => 16,
        TERRARIUM_HOST => 12,
        DEP_HOST => 6,
        _ => 6,
    }
}

#[derive(Debug, Default, Clone, Copy)]
struct Circuit {
    failures: u32,
    open_until: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct CircuitState {
    pub failures: u32,
    #[serde(rename = "coolingDown")]
    pub cooling_down: bool,
    #[serde(rename = "retryInSec")]
    pub retry_in_sec: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UpstreamError {
    #[error(transparent)]
    Fetch(#[from] FetchError),
    #[error("{0} is cooling down after repeated failures")]
    CircuitOpen(String),
}

pub struct Upstream {
    transport: Arc<dyn Transport>,
    hosts: Mutex<HashMap<String, Arc<Semaphore>>>,
    circuits: Mutex<HashMap<String, Circuit>>,
}

impl Upstream {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport, hosts: Mutex::default(), circuits: Mutex::default() }
    }

    pub fn download_consumed(&self, url: &str) {
        self.transport.download_consumed(url);
    }

    pub async fn restore_download(&self, req: FetchRequest) -> Result<Option<FetchResponse>, FetchError> {
        self.transport.restore_download(req).await
    }

    fn lane(&self, host: &str) -> Arc<Semaphore> {
        let mut hosts = self.hosts.lock().unwrap_or_else(|e| e.into_inner());
        hosts.entry(host.to_owned()).or_insert_with(|| Arc::new(Semaphore::new(lanes(host)))).clone()
    }

    /// Fetches within the host's lane limit.
    pub async fn fetch(&self, req: FetchRequest) -> Result<FetchResponse, FetchError> {
        let lane = self.lane(req.host());
        let _permit = lane.acquire().await.map_err(|_| FetchError::Cancelled)?;
        self.transport.fetch(req).await
    }

    /// Fetches through the host's circuit breaker. `ok` decides whether a
    /// response counts as success (e.g. "a 200 that is really a TIFF").
    pub async fn fetch_guarded(
        &self,
        req: FetchRequest,
        ok: impl Fn(&FetchResponse) -> bool,
    ) -> Result<FetchResponse, UpstreamError> {
        let host = req.host().to_owned();
        if let Some(until) = self.circuit(&host).open_until
            && Instant::now() < until
        {
            return Err(UpstreamError::CircuitOpen(host));
        }
        match self.fetch(req).await {
            Ok(r) if ok(&r) => {
                self.set_circuit(&host, Circuit::default());
                Ok(r)
            }
            Ok(r) => {
                self.failed(&host);
                Err(UpstreamError::Fetch(FetchError::Network(format!("{host} answered {}", r.status))))
            }
            Err(FetchError::Cancelled) => Err(FetchError::Cancelled.into()),
            Err(e) => {
                self.failed(&host);
                Err(e.into())
            }
        }
    }

    fn circuit(&self, host: &str) -> Circuit {
        self.circuits.lock().unwrap_or_else(|e| e.into_inner()).get(host).copied().unwrap_or_default()
    }

    fn set_circuit(&self, host: &str, c: Circuit) {
        self.circuits.lock().unwrap_or_else(|e| e.into_inner()).insert(host.to_owned(), c);
    }

    /// Opens after two failures in a row: 15 s, doubling, at most 2 min.
    fn failed(&self, host: &str) {
        let mut c = self.circuit(host);
        c.failures += 1;
        if c.failures >= 2 {
            let secs = (15u64 << (c.failures - 2).min(4)).min(120);
            c.open_until = Some(Instant::now() + Duration::from_secs(secs));
        }
        self.set_circuit(host, c);
    }

    pub fn circuit_state(&self, host: &str) -> CircuitState {
        let c = self.circuit(host);
        let left = c.open_until.map_or(Duration::ZERO, |u| u.saturating_duration_since(Instant::now()));
        CircuitState {
            failures: c.failures,
            cooling_down: !left.is_zero(),
            retry_in_sec: left.as_secs_f64().ceil() as u64,
        }
    }
}
