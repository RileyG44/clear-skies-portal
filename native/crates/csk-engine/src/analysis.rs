//! Viewport DEM analysis (`POST /api/terrain/analyze`), computed natively
//! by csk-science. The page uploads a float32 grid; the answer is a CSPA
//! frame. Identical uploads are answered from a short, bounded memory cache;
//! at most two analyses run at once.

use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};

use csk_science::contract::{self, Raw, RunError};
use lru::LruCache;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use crate::Engine;
use crate::router::{Request, Response};

const CACHE_BYTES: usize = 64 << 20;
const ENGINE_LABEL: &str = "built-in";

/// Frames by request key, and their total bytes.
struct Frame {
    body: Vec<u8>,
    _reservation: csk_core::resource::Reservation,
}
struct Frames(LruCache<String, Arc<Frame>>, usize);

pub struct Analysis {
    cache: Mutex<Frames>,
    running: Semaphore,
}

impl Default for Analysis {
    fn default() -> Self {
        Self {
            cache: Mutex::new(Frames(LruCache::new(NonZeroUsize::new(256).expect("nonzero")), 0)),
            running: Semaphore::new(2),
        }
    }
}

impl Analysis {
    pub fn purge_memory(&self) {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.0.clear();
        cache.1 = 0;
    }

    fn get(&self, key: &str) -> Option<Arc<Frame>> {
        self.cache.lock().unwrap_or_else(|e| e.into_inner()).0.get(key).cloned()
    }

    fn put(&self, key: String, frame: Arc<Frame>) {
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        c.1 += frame.body.len();
        if let Some((_, old)) = c.0.push(key, frame) {
            c.1 -= old.body.len();
        }
        while c.1 > CACHE_BYTES {
            match c.0.pop_lru() {
                Some((_, f)) => c.1 -= f.body.len(),
                None => break,
            }
        }
    }
}

fn bad(status: u16, msg: &str) -> Response {
    Response::json(status, &json!({"error": msg})).header("Cache-Control", "no-store")
}

pub async fn analyze(engine: &Arc<Engine>, req: &Request) -> Response {
    let media = req.header("content-type").unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if media != "application/octet-stream" {
        return bad(415, "terrain analysis body must be application/octet-stream Float32 data");
    }
    let num = |k: &str| {
        req.param(k).map_or(f64::NAN, |v| if v.trim().is_empty() { 0.0 } else { v.trim().parse().unwrap_or(f64::NAN) })
    };
    let opt = |k: &str| req.param(k).and_then(|v| v.trim().parse::<f64>().ok());
    let product = req.param("product").unwrap_or("");
    let scale = req.param("scale").unwrap_or("");
    let raw = Raw {
        product,
        scale,
        width: num("width"),
        height: num("height"),
        resolution: num("resolution"),
        day: opt("day"),
        lat: opt("lat"),
        wind: opt("wind"),
    };
    let request = match contract::Request::new(&raw) {
        Ok(r) => r,
        Err(m) => return bad(400, &m.replace("analysis", "terrain analysis").replace("research", "terrain analysis")),
    };
    let bytes = request.width * request.height * 4;
    if req.body.len() != bytes {
        return bad(400, "terrain analysis payload length does not match its dimensions");
    }
    let digest: String = Sha256::digest(&req.body).iter().map(|b| format!("{b:02x}")).collect();
    let key = format!(
        "research-v1:{}:{}:{}x{}:{}:{}:{digest}",
        request.product,
        request.scale,
        request.width,
        request.height,
        request.resolution,
        request.options_json()
    );
    if let Some(frame) = engine.analysis.get(&key) {
        let reservation = match engine.memory.reserve(frame.body.len()) {
            Ok(r) => r,
            Err(_) => return bad(503, "terrain analysis is waiting for memory").header("Retry-After", "2"),
        };
        let mut response = Response::new(200, contract::MIME, frame.body.clone())
            .header("X-Cache", "HIT")
            .header("X-CSP-Analysis-Engine", ENGINE_LABEL)
            .header("Cache-Control", "no-store");
        response.reservation = Some(reservation);
        return response;
    }
    let Ok(_permit) = engine.analysis.running.acquire().await else {
        return bad(503, "terrain analysis engine is busy");
    };
    // Covers input conversion, product intermediates (including solar horizon
    // planes and drainage queues) and encoded output. It stays with the worker
    // even when its async caller is cancelled.
    let estimate = request.width * request.height * 256 + (1 << 20);
    let mut reservation = match engine.memory.reserve(estimate) {
        Ok(r) => r,
        Err(_) => {
            engine.analysis.purge_memory();
            engine.tiles.usgs.cog.purge_memory();
            match engine.memory.reserve(estimate) {
                Ok(r) => r,
                Err(_) => return bad(503, "terrain analysis is waiting for memory").header("Retry-After", "2"),
            }
        }
    };
    let grid: Vec<f32> = req.body.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let result = tokio::task::spawn_blocking(move || {
        let body = contract::run(&request, &grid)
            .map(|(p, label, notice)| contract::encode(&p, request.width, request.height, label, notice.as_ref()))?;
        drop(grid);
        reservation.shrink(body.capacity());
        Ok::<_, RunError>(Frame { body, _reservation: reservation })
    })
    .await;
    match result {
        Ok(Ok(frame)) => {
            let response_reservation = match engine.memory.reserve(frame.body.len()) {
                Ok(r) => r,
                Err(_) => return bad(503, "terrain analysis is waiting for memory").header("Retry-After", "2"),
            };
            let frame = Arc::new(frame);
            engine.analysis.put(key, frame.clone());
            let mut response = Response::new(200, contract::MIME, frame.body.clone())
                .header("X-Cache", "MISS")
                .header("X-CSP-Analysis-Engine", ENGINE_LABEL)
                .header("Cache-Control", "no-store");
            response.reservation = Some(response_reservation);
            response
        }
        Ok(Err(RunError::Invalid(m))) => bad(422, &m),
        // Not yet native: the page computes it in its own worker instead.
        Ok(Err(RunError::Unsupported(p))) => bad(501, &format!("{p} is not available in the built-in engine yet")),
        Err(_) => bad(503, "terrain analysis engine is busy").header("Retry-After", "2"),
    }
}

#[cfg(test)]
mod tests {
    use crate::transport::{FetchError, FetchFuture, FetchRequest, Transport};
    use crate::{Config, Engine, Request};
    use std::sync::Arc;

    struct Offline;
    impl Transport for Offline {
        fn fetch(&self, _: FetchRequest) -> FetchFuture {
            Box::pin(async { Err(FetchError::Offline) })
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn analyze_route_frames_and_caches() {
        let dir = tempfile::tempdir().unwrap();
        let cfg =
            Config { cache_dir: dir.path().into(), data_dir: None, cache_budget: 1 << 20, usgs_scope: Some(vec![]) };
        let e = Engine::for_test(cfg, Arc::new(Offline)).unwrap();
        let grid: Vec<u8> = (0..20 * 10).flat_map(|i| (100.0f32 + (i % 20) as f32).to_le_bytes()).collect();
        let ask = |product: &str, media: &str| {
            Request::new(
                "POST",
                &format!("/api/terrain/analyze?product={product}&scale=fine&width=20&height=10&resolution=1"),
                grid.clone(),
            )
            .unwrap()
            .with_header_lines(&format!("Content-Type: {media}"))
        };
        let r = e.handle(ask("svf", "application/octet-stream")).await;
        assert_eq!((r.status, r.get("X-Cache")), (200, Some("MISS")));
        assert_eq!(&r.body[..4], b"CSPA");
        assert_eq!(e.handle(ask("svf", "application/octet-stream")).await.get("X-Cache"), Some("HIT"));
        assert_eq!(e.handle(ask("svf", "text/plain")).await.status, 415);
        assert_eq!(e.handle(ask("nope", "application/octet-stream")).await.status, 400);
        assert_eq!(e.handle(ask("moraine", "application/octet-stream")).await.status, 501);
        e.analysis.purge_memory();
        assert_eq!(e.memory.stats().used, r.body.capacity());
        drop(r);
        assert_eq!(e.memory.stats().used, 0);
        e.memory.set_limit(1024);
        let refused = e.handle(ask("svf", "application/octet-stream")).await;
        assert_eq!(refused.status, 503);
        assert_eq!(refused.get("Retry-After"), Some("2"));
        assert_eq!(e.memory.stats().used, 0);
        e.memory.set_limit(256 << 20);
        assert_eq!(e.handle(ask("svf", "application/octet-stream")).await.status, 200);
    }
}
