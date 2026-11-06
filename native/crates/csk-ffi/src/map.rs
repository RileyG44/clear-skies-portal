//! The native map's C ABI (ARCHITECTURE §4.2).
//!
//! Contracts:
//! - The platform creates a map on a `CAMetalLayer` it keeps on screen, and
//!   frees the map before its engine.
//! - Camera calls (gestures) may come from any thread, typically the UI
//!   thread; `csk_map_frame` comes from one render thread, typically a
//!   display link's. Points are CSS points from the layer's top-left corner;
//!   times are seconds on the media clock (`CACurrentMediaTime`).
//! - `wake` may be called from any thread when the map needs a frame; the
//!   platform resumes its display link. `release` is called once, when the
//!   map is freed.

use std::ffi::{c_char, c_void};
use std::sync::Arc;

use csk_map::{Camera, Map, Pose};

use crate::CskEngine;

pub struct CskMap {
    pub(crate) map: Arc<Map>,
}

/// The platform's frame loop.
#[repr(C)]
pub struct CskWake {
    pub context: *mut c_void,
    pub wake: extern "C" fn(context: *mut c_void),
    pub release: extern "C" fn(context: *mut c_void),
}

struct Waker(CskWake);

// The platform promises its callbacks are thread-safe (see the module docs).
unsafe impl Send for Waker {}
unsafe impl Sync for Waker {}

impl Drop for Waker {
    fn drop(&mut self) {
        (self.0.release)(self.0.context);
    }
}

/// The camera, in degrees.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CskCamera {
    pub lon: f64,
    pub lat: f64,
    pub zoom: f64,
    /// Clockwise from north.
    pub bearing: f64,
}

/// What a frame did.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct CskMapFrame {
    /// A new frame was presented.
    pub presented: bool,
    /// Keep the display link running: an animation is in progress or the
    /// frame was skipped. Otherwise it may pause until `wake`.
    pub again: bool,
    /// The frame failed (e.g. memory unavailable); the next may succeed.
    pub failed: bool,
    /// Share of visible display tiles with terrain, 0-1.
    pub coverage: f64,
    /// Source tiles resident on the GPU, and tile requests in flight.
    pub resident: u32,
    pub in_flight: u32,
    /// Why the frame failed, NUL-terminated (empty unless `failed`).
    pub error: [c_char; 128],
}

impl CskMapFrame {
    fn failed(message: &str) -> Self {
        let mut error = [0 as c_char; 128];
        for (out, byte) in error.iter_mut().zip(message.bytes().take(127)) {
            *out = byte as c_char;
        }
        Self { presented: false, again: false, failed: true, coverage: 0.0, resident: 0, in_flight: 0, error }
    }
}

fn pose(c: &CskCamera) -> Pose {
    Pose::from_lon_lat(c.lon, c.lat, c.zoom, c.bearing)
}

/// Creates a map presenting into `metal_layer` (a `CAMetalLayer *`, which
/// the map retains) sized `css_width` x `css_height` points at `dpr` pixels
/// per point. Returns NULL (and releases `wake`) if no GPU can drive the
/// layer or memory is unavailable, writing why into `error` (`error_len`
/// bytes, NUL-terminated; may be NULL).
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn csk_map_new(
    engine: *const CskEngine,
    metal_layer: *mut c_void,
    camera: CskCamera,
    css_width: f64,
    css_height: f64,
    dpr: f64,
    wake: CskWake,
    error: *mut c_char,
    error_len: usize,
) -> *mut CskMap {
    let wake = Arc::new(Waker(wake));
    // SAFETY: the caller passes a live engine (or NULL) and a valid layer.
    let made = unsafe { engine.as_ref() }
        .ok_or_else(|| "no engine".to_string())
        .and_then(|e| unsafe { create(e, metal_layer, camera, [css_width, css_height], dpr, wake) });
    match made {
        Ok(map) => Box::into_raw(Box::new(CskMap { map: Arc::new(map) })),
        Err(message) => {
            if !error.is_null() && error_len > 0 {
                let bytes = &message.as_bytes()[..message.len().min(error_len - 1)];
                // SAFETY: the caller passes `error_len` writable bytes.
                unsafe {
                    std::ptr::copy_nonoverlapping(bytes.as_ptr().cast::<c_char>(), error, bytes.len());
                    *error.add(bytes.len()) = 0;
                }
            }
            std::ptr::null_mut()
        }
    }
}

/// # Safety
/// `metal_layer` must be a valid `CAMetalLayer` (or NULL).
unsafe fn create(
    e: &CskEngine,
    metal_layer: *mut c_void,
    camera: CskCamera,
    css: [f64; 2],
    dpr: f64,
    wake: Arc<Waker>,
) -> Result<Map, String> {
    if metal_layer.is_null() {
        return Err("no layer".into());
    }
    #[cfg(target_vendor = "apple")]
    {
        let instance = csk_gpu::instance();
        // SAFETY: the caller passes a valid CAMetalLayer; wgpu retains it.
        let surface = unsafe {
            instance.create_surface_unsafe(csk_gpu::wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(metal_layer))
        }
        .map_err(|e| e.to_string())?;
        let (gpu, presenter) = e
            .runtime
            .block_on(csk_gpu::Renderer::for_surface(&instance, surface, e.engine.memory.clone()))
            .map_err(|e| e.to_string())?;
        let camera = Camera::new(pose(&camera), css, dpr);
        let wake: csk_map::Wake = Arc::new(move || (wake.0.wake)(wake.0.context));
        Map::new(gpu, presenter, e.runtime.handle().clone(), e.engine.clone(), camera, wake).map_err(|e| e.to_string())
    }
    #[cfg(not(target_vendor = "apple"))]
    {
        let _ = (e, camera, css, dpr, wake);
        Err("native map presentation needs Metal".into())
    }
}

/// Frees the map. Call before `csk_engine_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_free(map: *mut CskMap) {
    if !map.is_null() {
        // SAFETY: the map came from csk_map_new and is freed once.
        drop(unsafe { Box::from_raw(map) });
    }
}

fn with(map: *const CskMap, f: impl FnOnce(&mut Camera)) {
    // SAFETY: the caller passes a live map.
    if let Some(m) = unsafe { map.as_ref() } {
        m.map.camera(f);
    }
}

/// The layer's size in points and its scale.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_resize(map: *const CskMap, css_width: f64, css_height: f64, dpr: f64) {
    with(map, |c| c.resize([css_width, css_height], dpr));
}

/// A finger touched down: momentum and animations stop.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_stop(map: *const CskMap) {
    with(map, Camera::stop);
}

/// The content follows a finger by (dx, dy) points.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_pan(map: *const CskMap, dx: f64, dy: f64) {
    with(map, |c| c.pan([dx, dy]));
}

/// Zooms by `levels` (log2 of the pinch scale) about a point.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_zoom(map: *const CskMap, levels: f64, x: f64, y: f64) {
    with(map, |c| c.zoom_by(levels, [x, y]));
}

/// Turns the content clockwise by `degrees` about a point.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_rotate(map: *const CskMap, degrees: f64, x: f64, y: f64) {
    with(map, |c| c.rotate_by(degrees, [x, y]));
}

/// Momentum as fingers lift: pan points/s and zoom levels/s about (x, y).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_fling(
    map: *const CskMap,
    now: f64,
    vx: f64,
    vy: f64,
    zoom_per_second: f64,
    x: f64,
    y: f64,
) {
    with(map, |c| c.fling(now, [vx, vy], zoom_per_second, [x, y]));
}

/// Eases the camera to `to` over `duration` seconds (0 jumps).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_ease_to(map: *const CskMap, now: f64, to: CskCamera, duration: f64) {
    with(map, |c| c.ease_to(now, pose(&to), duration, None));
}

/// Eases zoom and bearing to `to`'s while the world point under (x, y)
/// stays there (double-tap zoom); `to`'s centre is ignored.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_ease_around(
    map: *const CskMap,
    now: f64,
    to: CskCamera,
    duration: f64,
    x: f64,
    y: f64,
) {
    with(map, |c| {
        let target = Pose { center: c.pose().center, ..pose(&to) };
        c.ease_to(now, target, duration, Some([x, y]));
    });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_camera(map: *const CskMap) -> CskCamera {
    // SAFETY: the caller passes a live map.
    let Some(m) = (unsafe { map.as_ref() }) else { return CskCamera::default() };
    let p = m.map.read_camera(Camera::pose);
    let [lon, lat] = p.lon_lat();
    CskCamera { lon, lat, zoom: p.zoom, bearing: p.bearing }
}

/// One display-link tick for the frame shown at `now`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn csk_map_frame(map: *const CskMap, now: f64) -> CskMapFrame {
    // SAFETY: the caller passes a live map.
    let Some(m) = (unsafe { map.as_ref() }) else { return CskMapFrame::failed("no map") };
    match m.map.frame(now) {
        Ok(r) => CskMapFrame {
            presented: r.presented,
            again: r.again,
            failed: false,
            coverage: r.coverage,
            resident: r.resident as u32,
            in_flight: r.in_flight as u32,
            error: [0; 128],
        },
        Err(e) => CskMapFrame::failed(&e.to_string()),
    }
}
