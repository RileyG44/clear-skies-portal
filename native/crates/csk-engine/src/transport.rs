//! The network, as the engine sees it. On iOS the platform layer implements
//! [`Transport`] with URLSession (csk-ffi); tests use an in-memory one.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Head,
    Post,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Head => "HEAD",
            Self::Post => "POST",
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
    /// Extra request headers.
    pub headers: Vec<(String, String)>,
    /// Request body (POST).
    pub body: Vec<u8>,
    /// Write the body to this file instead of memory (large downloads); the
    /// response's `body` is then empty. `max_body` still applies.
    pub dest: Option<std::path::PathBuf>,
}

impl FetchRequest {
    pub fn get(url: impl Into<String>) -> Self {
        Self {
            method: Method::Get,
            url: url.into(),
            range: None,
            timeout: Duration::from_secs(30),
            max_body: 32 << 20,
            headers: Vec::new(),
            body: Vec::new(),
            dest: None,
        }
    }
    pub fn to_file(mut self, path: impl Into<std::path::PathBuf>) -> Self {
        self.dest = Some(path.into());
        self
    }
    pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
    /// A form POST (`application/x-www-form-urlencoded`).
    pub fn post_form(url: impl Into<String>, form: String) -> Self {
        let mut r = Self::get(url);
        r.method = Method::Post;
        r.headers.push(("Content-Type".into(), "application/x-www-form-urlencoded".into()));
        r.body = form.into_bytes();
        r
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

    /// `name=value` of every cookie set, from any number of `Set-Cookie`
    /// headers, including platforms that join them with commas.
    pub fn cookies(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (_, v) in self.headers.iter().filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie")) {
            for part in v.split(',') {
                let pair = part.split(';').next().unwrap_or("").trim();
                // An Expires date's comma leaves a fragment with no '=' before ';'.
                if let Some((name, _)) = pair.split_once('=')
                    && !name.is_empty()
                    && !name.contains(' ')
                    && !["expires", "max-age", "path", "domain"].contains(&name.to_ascii_lowercase().as_str())
                {
                    out.push(pair.to_owned());
                }
            }
        }
        out
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

/// Dropping the returned future must cancel the request. Redirects are not
/// followed: the engine sees the 3xx and decides (a snapshot re-validates
/// every hop against its allowlist).
pub trait Transport: Send + Sync + 'static {
    fn fetch(&self, req: FetchRequest) -> FetchFuture;
}

#[cfg(test)]
mod tests {
    #[test]
    fn cookies_from_separate_or_joined_headers() {
        let joined = super::FetchResponse {
            status: 200,
            headers: vec![(
                "Set-Cookie".into(),
                "JSESSIONID=84BB; Path=/; HttpOnly, dlgate=ok; Path=/; Max-Age=7200; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure".into(),
            )],
            body: vec![],
        };
        assert_eq!(joined.cookies(), vec!["JSESSIONID=84BB", "dlgate=ok"]);
        let separate = super::FetchResponse {
            status: 200,
            headers: vec![("set-cookie".into(), "a=1; Path=/".into()), ("set-cookie".into(), "b=2".into())],
            body: vec![],
        };
        assert_eq!(separate.cookies(), vec!["a=1", "b=2"]);
    }
}
