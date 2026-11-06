//! The network, as the engine sees it. On iOS the platform layer implements
//! [`Transport`] with URLSession (csk-ffi); tests use an in-memory one.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Head,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Head => "HEAD",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchRequest {
    pub method: Method,
    pub url: String,
    /// Inclusive byte range.
    pub range: Option<(u64, u64)>,
    pub timeout: Duration,
    /// A larger body fails the fetch rather than filling memory.
    pub max_body: usize,
}

impl FetchRequest {
    pub fn get(url: impl Into<String>) -> Self {
        Self { method: Method::Get, url: url.into(), range: None, timeout: Duration::from_secs(30), max_body: 32 << 20 }
    }
    pub fn range(mut self, first: u64, last: u64) -> Self {
        self.range = Some((first, last));
        self
    }
    pub fn timeout(mut self, t: Duration) -> Self {
        self.timeout = t;
        self
    }
    pub fn max_body(mut self, n: usize) -> Self {
        self.max_body = n;
        self
    }
    pub fn host(&self) -> &str {
        let rest = self.url.split_once("://").map_or(self.url.as_str(), |(_, r)| r);
        rest.split(['/', '?']).next().unwrap_or("")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchResponse {
    pub status: u16,
    /// Header names lower-cased.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl FetchResponse {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FetchError {
    #[error("network: {0}")]
    Network(String),
    #[error("timed out")]
    Timeout,
    #[error("cancelled")]
    Cancelled,
    #[error("response larger than allowed")]
    TooLarge,
    #[error("offline")]
    Offline,
}

pub type FetchFuture = Pin<Box<dyn Future<Output = Result<FetchResponse, FetchError>> + Send>>;

/// Dropping the returned future must cancel the request.
pub trait Transport: Send + Sync + 'static {
    fn fetch(&self, req: FetchRequest) -> FetchFuture;
}
