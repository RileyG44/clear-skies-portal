//! The engine's C ABI (docs/native/ARCHITECTURE.md §4.1).
//!
//! The platform layer creates one engine with a transport (URLSession on
//! iOS), sends it the web client's requests, and gets each answer through a
//! callback with a body it owns until it frees it. Bodies are handed over
//! without copying.
//!
//! Contracts:
//! - `respond` is called exactly once per request, on an engine thread,
//!   with `response == NULL` if the request was cancelled.
//! - Each `fetch` hands the platform a `CskFetch` token, which it must
//!   consume exactly once with `csk_fetch_complete` or `csk_fetch_fail`,
//!   from any thread. `cancel` is advisory: the token must still be
//!   consumed.

#![allow(clippy::missing_safety_doc)]

mod app;
mod map;
pub use app::*;
pub use map::*;

use std::collections::HashMap;
use std::ffi::{CStr, CString, c_char, c_void};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use csk_engine::transport::{FetchError, FetchFuture, FetchRequest, FetchResponse, RestoreFuture, Transport};
use csk_engine::{Config, Engine, Request, Response};
use tokio::sync::oneshot;

/// A request the platform should make.
#[repr(C)]
pub struct CskFetchRequest {
    /// "GET", "HEAD" or "POST".
    pub method: *const c_char,
    pub url: *const c_char,
    /// Inclusive byte range, or -1 for none.
    pub range_first: i64,
    pub range_last: i64,
    pub timeout_ms: u32,
    /// Fail with `CSK_FETCH_TOO_LARGE` beyond this many body bytes.
    pub max_body: u64,
    /// Extra headers, `Name: value` lines (may be empty).
    pub headers: *const c_char,
    /// Request body, or NULL.
    pub body: *const u8,
    pub body_len: usize,
    /// Write the response body to this file path instead of returning it
    /// (complete with an empty body), or NULL.
    pub dest_path: *const c_char,
    /// Only restore an existing system transfer or completed file. Never
    /// start a network request; fail with CSK_FETCH_NOT_FOUND if absent.
    pub restore_only: bool,
}

/// The platform's network.
#[repr(C)]
pub struct CskTransport {
    pub context: *mut c_void,
    /// Start `request`; consume `token` when it finishes. `id` names it for `cancel`.
    pub fetch: extern "C" fn(context: *mut c_void, token: *mut CskFetch, id: u64, request: *const CskFetchRequest),
    /// The engine no longer needs fetch `id`.
    pub cancel: extern "C" fn(context: *mut c_void, id: u64),
    /// The engine is gone; release `context`.
    pub release: extern "C" fn(context: *mut c_void),
    /// Release a durable public GET archive after its consumer's commit.
    /// May be NULL on platforms without a background download journal.
    pub download_consumed: Option<extern "C" fn(context: *mut c_void, url: *const c_char)>,
}

/// Failure codes for `csk_fetch_fail`.
pub const CSK_FETCH_NETWORK: i32 = 0;
pub const CSK_FETCH_TIMEOUT: i32 = 1;
pub const CSK_FETCH_CANCELLED: i32 = 2;
pub const CSK_FETCH_TOO_LARGE: i32 = 3;
pub const CSK_FETCH_OFFLINE: i32 = 4;
pub const CSK_FETCH_NOT_FOUND: i32 = 5;

/// An answer. `headers` is `Name: value` lines separated by `\n`.
#[repr(C)]
pub struct CskResponse {
    pub status: u16,
    pub headers: *const c_char,
    pub body: *const u8,
    pub body_len: usize,
}

pub type CskRespond = extern "C" fn(context: *mut c_void, response: *const CskResponse, owner: *mut CskBody);

/// Owns a response's headers and body until `csk_body_free`.
pub struct CskBody {
    _headers: CString,
    _body: Vec<u8>,
    _reservation: Option<csk_engine::MemoryReservation>,
}

/// A pending fetch, consumed by `csk_fetch_complete` or `csk_fetch_fail`.
pub struct CskFetch {
    tx: oneshot::Sender<Result<FetchResponse, FetchError>>,
    reservation: Mutex<csk_engine::MemoryReservation>,
    max_body: usize,
}

/// The process's admitted engine memory: request and raster work plus the
/// native map's GPU resources (tile pool, store, screen field, drawables),
/// which share one budget.
const MEMORY_CAP: usize = 512 << 20;

pub struct CskEngine {
    runtime: tokio::runtime::Runtime,
    engine: Arc<Engine>,
    next: AtomicU64,
    requests: Arc<Mutex<HashMap<u64, tokio::task::AbortHandle>>>,
}

/// Independent of the engine runtime: background URLSession may restore first.
pub struct CskDisk(Arc<csk_store::disk::Budget>);

#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_disk_open(root: *const c_char) -> *mut CskDisk {
    if root.is_null() {
        return std::ptr::null_mut();
    }
    let Ok(root) = unsafe { CStr::from_ptr(root) }.to_str() else {
        return std::ptr::null_mut();
    };
    csk_store::disk::Budget::open(std::path::Path::new(root))
        .map_or(std::ptr::null_mut(), |budget| Box::into_raw(Box::new(CskDisk(budget))))
}

/// Atomically replace an identity's remaining growth. Zero releases it.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_disk_reserve(disk: *const CskDisk, id: *const c_char, remaining: u64) -> bool {
    let Some(disk) = (unsafe { disk.as_ref() }) else {
        return false;
    };
    if id.is_null() {
        return false;
    }
    let Ok(id) = unsafe { CStr::from_ptr(id) }.to_str() else {
        return false;
    };
    disk.0.reserve(id, remaining).is_ok()
}

/// Newline-separated live identities, restricted to the caller's namespace.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_disk_reconcile(disk: *const CskDisk, prefix: *const c_char, live: *const c_char) -> bool {
    let Some(disk) = (unsafe { disk.as_ref() }) else {
        return false;
    };
    if prefix.is_null() || live.is_null() {
        return false;
    }
    let (Ok(prefix), Ok(live)) = (unsafe { CStr::from_ptr(prefix) }.to_str(), unsafe { CStr::from_ptr(live) }.to_str())
    else {
        return false;
    };
    disk.0.reconcile(prefix, &live.lines().map(str::to_owned).collect::<Vec<_>>()).is_ok()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_disk_free(disk: *mut CskDisk) {
    if !disk.is_null() {
        drop(unsafe { Box::from_raw(disk) });
    }
}

struct Platform {
    t: CskTransport,
    next: AtomicU64,
    memory: Arc<csk_engine::MemoryBudget>,
}

// The platform promises its callbacks are thread-safe (see the module docs).
unsafe impl Send for Platform {}
unsafe impl Sync for Platform {}

impl Drop for Platform {
    fn drop(&mut self) {
        (self.t.release)(self.t.context);
    }
}

/// Cancels the platform's fetch if the engine stops waiting for it.
struct CancelOnDrop {
    platform: Arc<Platform>,
    id: u64,
    armed: bool,
}

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if self.armed {
            (self.platform.t.cancel)(self.platform.t.context, self.id);
        }
    }
}

struct Bridge(Arc<Platform>);

impl Transport for Bridge {
    fn download_consumed(&self, url: &str) {
        if let Some(callback) = self.0.t.download_consumed
            && let Ok(url) = CString::new(url)
        {
            callback(self.0.t.context, url.as_ptr());
        }
    }

    fn fetch(&self, req: FetchRequest) -> FetchFuture {
        self.fetch_request(req, false)
    }

    fn restore_download(&self, req: FetchRequest) -> RestoreFuture {
        let pending = self.fetch_request(req, true);
        Box::pin(async move {
            match pending.await {
                Ok(response) => Ok(Some(response)),
                Err(FetchError::NotFound) => Ok(None),
                Err(e) => Err(e),
            }
        })
    }
}

impl Bridge {
    fn fetch_request(&self, req: FetchRequest, restore_only: bool) -> FetchFuture {
        let platform = self.0.clone();
        Box::pin(async move {
            let (tx, rx) = oneshot::channel();
            let id = platform.next.fetch_add(1, Ordering::Relaxed);
            {
                // Raw pointers live only for the call, never across an await.
                let method = CString::new(req.method.as_str()).expect("no NUL");
                let url = CString::new(req.url.as_str()).map_err(|_| FetchError::Network("URL contains NUL".into()))?;
                let (first, last) = req.range.map_or((-1, -1), |(a, b)| (a as i64, b as i64));
                let headers: String = req
                    .headers
                    .iter()
                    .filter(|(k, v)| !k.contains(['\n', ':', '\0']) && !v.contains(['\n', '\0']))
                    .map(|(k, v)| format!("{k}: {v}\n"))
                    .collect();
                let headers = CString::new(headers).expect("filtered");
                let dest = req.dest.as_ref().and_then(|p| CString::new(p.to_string_lossy().into_owned()).ok());
                let c = CskFetchRequest {
                    method: method.as_ptr(),
                    url: url.as_ptr(),
                    range_first: first,
                    range_last: last,
                    timeout_ms: req.timeout.as_millis().min(u128::from(u32::MAX)) as u32,
                    max_body: req.max_body as u64,
                    headers: headers.as_ptr(),
                    body: if req.body.is_empty() { std::ptr::null() } else { req.body.as_ptr() },
                    body_len: req.body.len(),
                    dest_path: dest.as_ref().map_or(std::ptr::null(), |d| d.as_ptr()),
                    restore_only,
                };
                let token = Box::into_raw(Box::new(CskFetch {
                    tx,
                    max_body: req.max_body,
                    reservation: Mutex::new(platform.memory.reserve(0).expect("zero-byte admission")),
                }));
                (platform.t.fetch)(platform.t.context, token, id, &c);
            }
            let mut guard = CancelOnDrop { platform: platform.clone(), id, armed: true };
            let out = rx.await.unwrap_or(Err(FetchError::Cancelled));
            guard.armed = false;
            out
        })
    }
}

unsafe fn str_arg<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() {
        return None;
    }
    // SAFETY: the caller passes a NUL-terminated string valid for this call.
    unsafe { CStr::from_ptr(p) }.to_str().ok()
}

/// Creates the engine. `config_json` is csk_engine::Config as JSON. Returns
/// NULL (and releases the transport) if the configuration or store is invalid.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_new(
    config_json: *const c_char,
    transport: CskTransport,
    work_allowed: bool,
) -> *mut CskEngine {
    let memory = csk_engine::MemoryBudget::new(MEMORY_CAP);
    let platform = Arc::new(Platform { t: transport, next: AtomicU64::new(1), memory: memory.clone() });
    // SAFETY: per the contract above.
    let Some(text) = (unsafe { str_arg(config_json) }) else { return std::ptr::null_mut() };
    let Ok(config) = serde_json_config(text) else { return std::ptr::null_mut() };
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(2, 6);
    let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(threads)
        .max_blocking_threads(threads * 2)
        .thread_name("csk-engine")
        .thread_keep_alive(Duration::from_secs(30))
        .enable_time()
        .build()
    else {
        return std::ptr::null_mut();
    };
    let engine = {
        let _enter = runtime.enter();
        match Engine::with_memory(config, Arc::new(Bridge(platform)), memory) {
            Ok(e) => {
                e.work.set_allowed(work_allowed);
                e.warm();
                e
            }
            Err(_) => return std::ptr::null_mut(),
        }
    };
    Box::into_raw(Box::new(CskEngine { runtime, engine, next: AtomicU64::new(1), requests: Arc::default() }))
}

fn serde_json_config(text: &str) -> Result<Config, ()> {
    csk_engine::config_from_json(text).map_err(|_| ())
}

/// Durable-job progress; reading this never starts work or accesses the network.
#[repr(C)]
#[derive(Default)]
pub struct CskWorkStatus {
    pub pending: bool,
    pub cpu_pending: bool,
    pub failed: bool,
    pub total: u64,
    pub completed: u64,
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_work_status(engine: *mut CskEngine) -> CskWorkStatus {
    let Some(e) = (unsafe { engine.as_ref() }) else { return CskWorkStatus::default() };
    let usgs = e.engine.downloads.status();
    let dnr = e.engine.dnr_warm.status();
    let (acquisition, cpu) = e.engine.dnr_work_status();
    CskWorkStatus {
        pending: usgs.running || dnr.running || acquisition,
        cpu_pending: usgs.running || cpu || (dnr.running && !acquisition),
        failed: !usgs.error.is_empty() || dnr.error.is_some(),
        total: usgs.total + dnr.total + u64::from(acquisition && !dnr.running),
        completed: usgs.done + dnr.done,
    }
}

/// Background grants and the foreground allow durable jobs to advance.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_set_work_allowed(engine: *mut CskEngine, allowed: bool) {
    if let Some(e) = unsafe { engine.as_ref() } {
        e.engine.work.set_allowed(allowed);
    }
}

/// Drop disposable decoded blocks and headers under platform memory pressure.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_purge_memory(engine: *mut CskEngine) {
    if let Some(e) = unsafe { engine.as_ref() } {
        e.engine.tiles.usgs.cog.purge_memory();
        e.engine.analysis.purge_memory();
    }
}

/// Admission ceiling adapts to available platform memory. Existing readers
/// retain their allocations, while new work waits through retryable errors.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_set_memory_limit(engine: *mut CskEngine, bytes: usize) {
    if let Some(e) = unsafe { engine.as_ref() } {
        e.engine.memory.set_limit(bytes.min(MEMORY_CAP));
    }
}

/// Stops the engine: in-flight requests are cancelled (each `respond` gets NULL).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_free(engine: *mut CskEngine) {
    if engine.is_null() {
        return;
    }
    // SAFETY: created by csk_engine_new and not used after this call.
    let e = unsafe { Box::from_raw(engine) };
    e.engine.work.shutdown();
    for (_, h) in e.requests.lock().unwrap_or_else(|p| p.into_inner()).drain() {
        h.abort();
    }
    e.runtime.shutdown_timeout(Duration::from_secs(2));
}

struct Responder {
    respond: CskRespond,
    context: *mut c_void,
    done: bool,
    memory: Option<Arc<csk_engine::MemoryBudget>>,
}

// The platform's respond callback is thread-safe by contract.
unsafe impl Send for Responder {}

impl Responder {
    fn send(mut self, mut r: Response) {
        if r.reservation.is_none()
            && let Some(memory) = &self.memory
        {
            match memory.reserve(r.body.capacity()) {
                Ok(reservation) => r.reservation = Some(reservation),
                Err(_) => r = Response::text(503, "response is waiting for memory").header("Retry-After", "2"),
            }
        }
        let headers: String = r
            .headers
            .iter()
            .filter(|(k, v)| !k.contains(['\n', ':']) && !v.contains('\n'))
            .map(|(k, v)| format!("{k}: {v}\n"))
            .collect();
        let body = Box::new(CskBody {
            _headers: CString::new(headers.replace('\0', "")).expect("no NUL"),
            _body: r.body,
            _reservation: r.reservation,
        });
        let c = CskResponse {
            status: r.status,
            headers: body._headers.as_ptr(),
            body: body._body.as_ptr(),
            body_len: body._body.len(),
        };
        self.done = true;
        (self.respond)(self.context, &c, Box::into_raw(body));
    }
}

impl Drop for Responder {
    fn drop(&mut self) {
        if !self.done {
            (self.respond)(self.context, std::ptr::null(), std::ptr::null_mut());
        }
    }
}

/// Answers one request (`url` may be absolute or a path with query;
/// `headers` is `Name: value` lines, or NULL). Returns its id for
/// `csk_engine_cancel`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_request(
    engine: *const CskEngine,
    method: *const c_char,
    url: *const c_char,
    headers: *const c_char,
    body: *const u8,
    body_len: usize,
    context: *mut c_void,
    respond: CskRespond,
) -> u64 {
    let mut responder = Responder { respond, context, done: false, memory: None };
    // SAFETY: a live engine from csk_engine_new.
    let Some(e) = (unsafe { engine.as_ref() }) else {
        responder.send(Response::text(503, "engine not running"));
        return 0;
    };
    responder.memory = Some(e.engine.memory.clone());
    // SAFETY: per the contract above.
    let (m, u, hdrs) = unsafe { (str_arg(method).unwrap_or("GET"), str_arg(url), str_arg(headers).unwrap_or("")) };
    if body_len > 32 << 20 {
        responder.send(Response::text(413, "request body exceeds 32 MiB"));
        return 0;
    }
    let request_reservation = match e.engine.memory.reserve(body_len) {
        Ok(r) => r,
        Err(_) => {
            responder.send(Response::text(503, "request is waiting for memory").header("Retry-After", "2"));
            return 0;
        }
    };
    let payload = if body.is_null() || body_len == 0 {
        Vec::new()
    } else {
        // SAFETY: body points at body_len readable bytes for this call.
        unsafe { std::slice::from_raw_parts(body, body_len) }.to_vec()
    };
    let Some(req) = u.and_then(|u| Request::new(m, u, payload)).map(|r| r.with_header_lines(hdrs)) else {
        responder.send(Response::text(400, "invalid URL encoding"));
        return 0;
    };
    let id = e.next.fetch_add(1, Ordering::Relaxed);
    let engine = e.engine.clone();
    let requests = e.requests.clone();
    let mut table = e.requests.lock().unwrap_or_else(|p| p.into_inner());
    let task = e.runtime.spawn(async move {
        let res = engine.handle(req).await;
        drop(request_reservation);
        requests.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
        responder.send(res);
    });
    table.insert(id, task.abort_handle());
    id
}

/// The platform no longer wants request `id`; its `respond` gets NULL.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_engine_cancel(engine: *const CskEngine, id: u64) {
    // SAFETY: a live engine from csk_engine_new.
    if let Some(e) = unsafe { engine.as_ref() }
        && let Some(h) = e.requests.lock().unwrap_or_else(|p| p.into_inner()).remove(&id)
    {
        h.abort();
    }
}

/// Frees a response body handed to `respond`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_body_free(owner: *mut CskBody) {
    if !owner.is_null() {
        // SAFETY: an owner from respond, freed once.
        drop(unsafe { Box::from_raw(owner) });
    }
}

/// Completes a fetch. `headers` is `Name: value` lines; `body` may be NULL
/// when `body_len` is 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_fetch_complete(
    token: *mut CskFetch,
    status: u16,
    headers: *const c_char,
    body: *const u8,
    body_len: usize,
) {
    if token.is_null() {
        return;
    }
    // SAFETY: a token from fetch, consumed once.
    let t = unsafe { Box::from_raw(token) };
    let mut reservation = t.reservation.into_inner().unwrap_or_else(|e| e.into_inner());
    let Some(receive_bytes) = body_len.checked_mul(3).filter(|_| body_len <= t.max_body) else {
        let _ = t.tx.send(Err(FetchError::TooLarge));
        return;
    };
    if reservation.grow_to(receive_bytes).is_err() {
        let _ = t.tx.send(Err(FetchError::Network("receive buffer is waiting for memory".into())));
        return;
    }
    // SAFETY: per the contract above.
    let headers = unsafe { str_arg(headers) }
        .unwrap_or("")
        .lines()
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
        .collect();
    let body = if body.is_null() || body_len == 0 {
        Vec::new()
    } else {
        // SAFETY: body points at body_len readable bytes for this call.
        unsafe { std::slice::from_raw_parts(body, body_len) }.to_vec()
    };
    let _ = t.tx.send(Ok(FetchResponse { status, headers, body, reservation: Some(reservation) }));
}

/// Admit receive-buffer growth before the platform appends bytes. The bound
/// covers Data's growth and the Rust handoff copy. Serialise with completion.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_fetch_reserve(token: *mut CskFetch, total_body_bytes: usize) -> bool {
    let Some(token) = (unsafe { token.as_ref() }) else {
        return false;
    };
    let Some(bytes) = total_body_bytes.checked_mul(3).filter(|_| total_body_bytes <= token.max_body) else {
        return false;
    };
    token.reservation.lock().unwrap_or_else(|e| e.into_inner()).grow_to(bytes).is_ok()
}

/// Fails a fetch with a `CSK_FETCH_*` code.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_fetch_fail(token: *mut CskFetch, code: i32, message: *const c_char) {
    if token.is_null() {
        return;
    }
    // SAFETY: a token from fetch, consumed once.
    let t = unsafe { Box::from_raw(token) };
    // SAFETY: per the contract above.
    let msg = unsafe { str_arg(message) }.unwrap_or("").to_owned();
    let e = match code {
        CSK_FETCH_TIMEOUT => FetchError::Timeout,
        CSK_FETCH_CANCELLED => FetchError::Cancelled,
        CSK_FETCH_TOO_LARGE => FetchError::TooLarge,
        CSK_FETCH_OFFLINE => FetchError::Offline,
        CSK_FETCH_NOT_FOUND => FetchError::NotFound,
        _ => FetchError::Network(msg),
    };
    let _ = t.tx.send(Err(e));
}

/// The engine version, static.
#[unsafe(no_mangle)]
pub extern "C" fn csk_version() -> *const c_char {
    static V: &CStr = match CStr::from_bytes_with_nul(concat!(env!("CARGO_PKG_VERSION"), "\0").as_bytes()) {
        Ok(v) => v,
        Err(_) => panic!("version"),
    };
    V.as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn receive_growth_is_admitted_and_released_with_its_last_owner() {
        let memory = csk_engine::MemoryBudget::new(24);
        let (tx, mut rx) = oneshot::channel();
        let token =
            Box::into_raw(Box::new(CskFetch { tx, reservation: Mutex::new(memory.reserve(0).unwrap()), max_body: 16 }));
        // SAFETY: one live test token, used serially and consumed exactly once.
        unsafe {
            assert!(csk_fetch_reserve(token, 8));
            assert!(!csk_fetch_reserve(token, 9));
            assert!(!csk_fetch_reserve(token, 17));
            csk_fetch_complete(token, 200, c"".as_ptr(), b"12345678".as_ptr(), 8);
        }
        let response = rx.try_recv().unwrap().unwrap();
        assert_eq!(memory.stats().used, 24);
        assert_eq!(response.body, b"12345678");
        drop(response);
        assert_eq!(memory.stats().used, 0);

        let (tx, _rx) = oneshot::channel();
        let token =
            Box::into_raw(Box::new(CskFetch { tx, reservation: Mutex::new(memory.reserve(0).unwrap()), max_body: 16 }));
        unsafe {
            assert!(csk_fetch_reserve(token, 8));
            csk_fetch_fail(token, CSK_FETCH_CANCELLED, c"cancelled".as_ptr());
        }
        assert_eq!(memory.stats().used, 0);
    }

    #[test]
    fn zero_copy_response_keeps_admission_until_platform_frees_the_body() {
        extern "C" fn hold(ctx: *mut c_void, _: *const CskResponse, owner: *mut CskBody) {
            // SAFETY: the test gives this callback its channel once.
            let tx = unsafe { Box::from_raw(ctx.cast::<mpsc::Sender<usize>>()) };
            tx.send(owner as usize).unwrap();
        }
        let memory = csk_engine::MemoryBudget::new(32);
        let (tx, rx) = mpsc::channel::<usize>();
        Responder {
            respond: hold,
            context: Box::into_raw(Box::new(tx)).cast(),
            done: false,
            memory: Some(memory.clone()),
        }
        .send(Response::new(200, "test", vec![0; 16]));
        let owner = rx.recv().unwrap();
        assert_eq!(memory.stats().used, 16);
        unsafe {
            csk_body_free(owner as *mut CskBody);
        }
        assert_eq!(memory.stats().used, 0);
    }

    extern "C" fn fetch(_: *mut c_void, token: *mut CskFetch, _: u64, req: *const CskFetchRequest) {
        // SAFETY: test transport; the request is valid during this call.
        let url = unsafe { CStr::from_ptr((*req).url) }.to_str().unwrap().to_owned();
        struct Token(*mut CskFetch);
        unsafe impl Send for Token {}
        let token = Token(token);
        std::thread::spawn(move || {
            let token = token;
            let body = if url.contains("terrarium") { b"not a png".to_vec() } else { Vec::new() };
            // SAFETY: consuming the token once.
            unsafe { csk_fetch_complete(token.0, 200, c"content-type: x\n".as_ptr(), body.as_ptr(), body.len()) };
        });
    }
    extern "C" fn cancel(_: *mut c_void, _: u64) {}
    extern "C" fn release(_: *mut c_void) {}

    extern "C" fn respond(ctx: *mut c_void, r: *const CskResponse, owner: *mut CskBody) {
        // SAFETY: ctx is the test's channel; r is valid until owner is freed.
        let tx = unsafe { Box::from_raw(ctx.cast::<mpsc::Sender<Option<(u16, String)>>>()) };
        let got = unsafe { r.as_ref() }
            .map(|r| (r.status, unsafe { CStr::from_ptr(r.headers) }.to_str().unwrap().to_owned()));
        unsafe { csk_body_free(owner) };
        tx.send(got).unwrap();
    }

    #[test]
    fn requests_round_trip_through_the_abi() {
        let dir = std::env::temp_dir().join(format!("csk-ffi-{}", std::process::id()));
        let cfg = CString::new(format!("{{\"cacheDir\":{:?}}}", dir.to_str().unwrap())).unwrap();
        let t = CskTransport { context: std::ptr::null_mut(), fetch, cancel, release, download_consumed: None };
        // SAFETY: exercising the ABI as the platform does.
        unsafe {
            let e = csk_engine_new(cfg.as_ptr(), t, true);
            assert!(!e.is_null());
            let ask = |path: &CStr| {
                let (tx, rx) = mpsc::channel::<Option<(u16, String)>>();
                let ctx = Box::into_raw(Box::new(tx)).cast();
                csk_engine_request(
                    e,
                    c"GET".as_ptr(),
                    path.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    0,
                    ctx,
                    respond,
                );
                rx.recv_timeout(Duration::from_secs(10)).unwrap()
            };
            let (status, headers) = ask(c"/api/health").unwrap();
            assert_eq!(status, 200);
            assert!(headers.contains("Content-Type: application/json"));
            // An upstream answering garbage is a 502, not a crash.
            assert_eq!(ask(c"/api/elev/overview/1/0/0.png").unwrap().0, 502);
            csk_engine_free(e);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
