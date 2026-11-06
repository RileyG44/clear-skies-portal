//! The native app state's C ABI: the SwiftUI shell's content and actions
//! (ios/Sources/Shell/ShellBackend.swift).
//!
//! Contracts:
//! - `update` receives `ShellUpdate` JSON (NUL-terminated, valid for the
//!   call) from any thread; the platform hops to its UI thread.
//! - Commands and queries come from the UI thread with JSON arguments.
//! - Attach a map with `csk_app_set_map` and detach it (NULL) before freeing
//!   that map. Free the app before its engine.

use std::ffi::{CStr, CString, c_char, c_void};
use std::sync::Arc;

use csk_app::App;

use crate::{CskEngine, CskMap};

pub struct CskApp {
    app: Arc<App>,
}

/// Where shell updates go.
#[repr(C)]
pub struct CskShellSink {
    pub context: *mut c_void,
    pub update: extern "C" fn(context: *mut c_void, json: *const c_char),
    pub release: extern "C" fn(context: *mut c_void),
}

struct Sink(CskShellSink);

// The platform promises its callbacks are thread-safe (see the module docs).
unsafe impl Send for Sink {}
unsafe impl Sync for Sink {}

impl Sink {
    fn update(&self, json: String) {
        if let Ok(json) = CString::new(json) {
            (self.0.update)(self.0.context, json.as_ptr());
        }
    }
}

impl Drop for Sink {
    fn drop(&mut self) {
        (self.0.release)(self.0.context);
    }
}

/// # Safety
/// `p` must be NULL or a NUL-terminated string valid for this call.
unsafe fn text<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() {
        return None;
    }
    // SAFETY: per the contract above.
    unsafe { CStr::from_ptr(p) }.to_str().ok()
}

/// # Safety
/// `p` must be NULL or a NUL-terminated string valid for this call.
unsafe fn json_arg(p: *const c_char) -> serde_json::Value {
    // SAFETY: per the contract above.
    unsafe { text(p) }.and_then(|t| serde_json::from_str(t).ok()).unwrap_or(serde_json::Value::Null)
}

/// The app state for `engine`, restored from its store. NULL (releasing
/// `sink`) without an engine.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_app_new(engine: *const CskEngine, sink: CskShellSink) -> *mut CskApp {
    let sink = Sink(sink);
    // SAFETY: the caller passes a live engine or NULL.
    let Some(e) = (unsafe { engine.as_ref() }) else { return std::ptr::null_mut() };
    let publish: csk_app::Publish = Arc::new(move |json: String| sink.update(json));
    Box::into_raw(Box::new(CskApp { app: App::new(e.engine.clone(), publish) }))
}

/// Publishes everything the shell shows, marked ready.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_app_start(app: *const CskApp) {
    // SAFETY: the caller passes a live app.
    if let Some(a) = unsafe { app.as_ref() } {
        a.app.start();
    }
}

/// A shell command, e.g. `act` with `{"ref": "#terOp", "op": "input", "value": 80}`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_app_send(app: *const CskApp, command: *const c_char, args_json: *const c_char) {
    // SAFETY: the caller passes a live app and strings valid for this call.
    let (Some(a), Some(command)) = (unsafe { app.as_ref() }, unsafe { text(command) }) else { return };
    // SAFETY: as above.
    a.app.send(command, &unsafe { json_arg(args_json) });
}

/// A shell query. Returns its JSON answer, to free with `csk_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_app_ask(
    app: *const CskApp,
    query: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    // SAFETY: the caller passes a live app and strings valid for this call.
    let (Some(a), Some(query)) = (unsafe { app.as_ref() }, unsafe { text(query) }) else { return std::ptr::null_mut() };
    // SAFETY: as above.
    let answer = a.app.ask(query, &unsafe { json_arg(args_json) });
    CString::new(answer.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Draws the app state into `map`, or detaches with NULL.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_app_set_map(app: *const CskApp, map: *const CskMap) {
    // SAFETY: the caller passes a live app and a live map or NULL.
    let Some(a) = (unsafe { app.as_ref() }) else { return };
    // SAFETY: as above.
    a.app.set_map(unsafe { map.as_ref() }.map(|m| m.map.clone()));
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_app_free(app: *mut CskApp) {
    if !app.is_null() {
        // SAFETY: the app came from csk_app_new and is freed once.
        let app = unsafe { Box::from_raw(app) };
        app.app.set_map(None);
    }
}

/// Frees a string the engine returned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_string_free(text: *mut c_char) {
    if !text.is_null() {
        // SAFETY: the string came from CString::into_raw here.
        drop(unsafe { CString::from_raw(text) });
    }
}
