//! GeoJSON feature collections for vector map layers (app/overlays.js
//! `ovGeoData`): fetched through the engine's transport, kept in the store
//! for offline use, refreshed after their age limit, and served from the
//! kept copy when a refresh fails.

use std::sync::Arc;
use std::time::Duration;

use csk_store::Kind;
use sha2::{Digest, Sha256};

use crate::Engine;
use crate::transport::FetchRequest;

const KEPT: Duration = Duration::from_secs(10 * 365 * 24 * 3600);
/// The web's 15 s abort, with headroom for a slow phone network.
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY: usize = 24 << 20;

/// A feature collection's bytes and when they were fetched.
#[derive(Clone, Debug, PartialEq)]
pub struct Features {
    pub body: Vec<u8>,
    /// Unix milliseconds.
    pub fetched: i64,
    /// A refresh failed and these are the last kept answer.
    pub stale: bool,
}

/// Why no features could be given.
#[derive(Clone, Debug, PartialEq)]
pub enum Unavailable {
    /// The source refused, failed or timed out, and nothing is kept.
    Source(String),
    /// The source answered something that is not a feature collection.
    Invalid,
}

fn key(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    let hex: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    format!("features:{hex}")
}

/// Whether bytes parse as a GeoJSON FeatureCollection.
fn collection(body: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(body)
        .is_ok_and(|v| v["type"] == "FeatureCollection" && v["features"].is_array())
}

impl Engine {
    /// The feature collection at `url`, fresh for `max_age`. Identical
    /// requests in flight share one fetch.
    pub async fn features(self: &Arc<Self>, url: &str, max_age: Duration) -> Result<Features, Unavailable> {
        let key = key(url);
        if let Ok(Some(hit)) = self.store.get(&key, max_age) {
            return Ok(Features { body: hit.body, fetched: hit.created, stale: false });
        }
        let fetch = FetchRequest::get(url)
            .header("accept", "application/geo+json, application/json")
            .timeout(TIMEOUT)
            .max_body(MAX_BODY);
        let me = self.clone();
        let k = key.clone();
        let fetched = self
            .layer_flights
            .run(key.clone(), move || async move {
                let r = me.upstream.fetch(fetch).await.ok()?;
                // An empty body marks a non-collection answer for the waiters.
                if r.status != 200 {
                    return None;
                }
                if !collection(&r.body) {
                    return Some(Vec::new());
                }
                let _ = me.store.put(&k, Kind::Source, 200, "application/geo+json", None, &r.body);
                Some(r.body)
            })
            .await
            .flatten();
        let now =
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
        match fetched {
            Some(body) if !body.is_empty() => Ok(Features { body, fetched: now, stale: false }),
            answered => match self.store.get(&key, KEPT) {
                Ok(Some(hit)) => Ok(Features { body: hit.body, fetched: hit.created, stale: true }),
                _ if answered.is_some() => Err(Unavailable::Invalid),
                _ => Err(Unavailable::Source("source unavailable".into())),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_stable_and_collections_are_checked() {
        assert_eq!(key("https://a/b"), key("https://a/b"));
        assert_ne!(key("https://a/b"), key("https://a/c"));
        assert!(collection(br#"{"type":"FeatureCollection","features":[]}"#));
        assert!(!collection(br#"{"type":"Feature"}"#));
        assert!(!collection(b"<html>"));
    }
}
