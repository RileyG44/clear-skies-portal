//! The native map (docs/native/ARCHITECTURE.md §4.2): the camera, the
//! terrain scene fed by the engine, and presentation into a platform surface.
//!
//! Threads: gestures move the camera from the UI thread; the platform's
//! display link calls [`Map::frame`] on a render thread. They share only the
//! camera lock, held for microseconds, so a long GPU submission never delays
//! a touch. Tile answers arrive on the engine runtime and wake the display
//! link, which may otherwise pause while nothing changes.

pub mod camera;
pub mod loader;

use std::sync::{Arc, Mutex, MutexGuard};

use csk_engine::Engine;
use csk_engine::elevation::TerrainSource;
use csk_gpu::{Presented, Presenter, Renderer, TILE, Terrain, Uniforms, View, ViewSample};

pub use camera::{Camera, Pose};
pub use loader::Wake;

/// What the map tells the app state, always outside the map's locks so the
/// app may change the map in reply.
pub trait Listener: Send + Sync {
    /// The camera moved (a gesture, momentum or an animation).
    fn moved(&self, _pose: Pose) {}
    /// Heights of a settled, presented view: what auto layers fit to.
    fn sampled(&self, _sample: ViewSample) {}
}

/// Bounds the tile pool: enough for the largest rotated view at any
/// fractional zoom, with every slot drawing from two sources.
const MIN_POOL: u32 = 128;
const MAX_POOL: u32 = 512;

/// What one call to [`Map::frame`] did.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameResult {
    /// A new frame was presented.
    pub presented: bool,
    /// Call again next vsync (an animation is running or a frame was
    /// skipped). Otherwise the loop may pause until the next wake.
    pub again: bool,
    /// Share of visible display tiles with terrain.
    pub coverage: f64,
    /// Source tiles resident on the GPU, and requests in flight.
    pub resident: usize,
    pub in_flight: usize,
}

struct Scene {
    gpu: Renderer,
    presenter: Presenter,
    terrain: Terrain,
    loader: loader::Loader,
    uniforms: Uniforms,
    /// The last presented view; `None` forces the next frame.
    shown: Option<View>,
    coverage: f64,
    /// The view last sampled, and whether terrain arrived since.
    sampled: Option<View>,
    fresh: bool,
}

pub struct Map {
    camera: Mutex<Camera>,
    scene: Mutex<Scene>,
    wake: Wake,
    listener: Mutex<Option<Arc<dyn Listener>>>,
    /// The pose last reported to the listener.
    reported: Mutex<Option<Pose>>,
}

/// Store slots of the largest view the camera can show at this size: a 45°
/// bearing at the zoom fraction that rounds to the finer level.
fn worst_slots(css: [f64; 2], dpr: f64) -> u32 {
    let tile = f64::from(TILE) * if dpr >= 1.5 { 0.5 } else { 1.0 } * 0.5f64.exp2().recip();
    let side = (css[0] + css[1]) / std::f64::consts::SQRT_2;
    let across = (side / tile).ceil() as u32 + 3;
    across * across
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Map {
    /// A map presenting through `presenter` on `gpu`, its tiles answered by
    /// `engine` on `runtime`. `wake` restarts a paused frame loop; it is
    /// called from any thread.
    pub fn new(
        gpu: Renderer,
        presenter: Presenter,
        runtime: tokio::runtime::Handle,
        engine: Arc<Engine>,
        camera: Camera,
        wake: Wake,
    ) -> Result<Self, csk_gpu::Error> {
        let view = camera.view();
        let pool = (worst_slots(view.css, view.dpr) * 2).clamp(MIN_POOL, MAX_POOL);
        let mut terrain = Terrain::new(&gpu, pool)?;
        let mut loader = loader::Loader::new(runtime, engine, wake.clone());
        loader.set_sources(&mut terrain, &TerrainSource::ALL);
        let scene = Scene {
            gpu,
            presenter,
            terrain,
            loader,
            uniforms: Uniforms::default(),
            shown: None,
            coverage: 0.0,
            sampled: None,
            fresh: false,
        };
        Ok(Self {
            camera: Mutex::new(camera),
            scene: Mutex::new(scene),
            wake,
            listener: Mutex::new(None),
            reported: Mutex::new(None),
        })
    }

    /// Who hears about camera moves and view samples.
    pub fn set_listener(&self, listener: Option<Arc<dyn Listener>>) {
        *lock(&self.listener) = listener;
        *lock(&self.reported) = None;
        let mut scene = lock(&self.scene);
        scene.sampled = None;
        drop(scene);
        (self.wake)();
    }

    /// Changes the camera under its lock and wakes the frame loop.
    pub fn camera<R>(&self, change: impl FnOnce(&mut Camera) -> R) -> R {
        let out = change(&mut lock(&self.camera));
        (self.wake)();
        out
    }

    /// Reads the camera without waking the frame loop.
    pub fn read_camera<R>(&self, read: impl FnOnce(&Camera) -> R) -> R {
        read(&lock(&self.camera))
    }

    /// The terrain sources to draw (the source preference).
    pub fn set_sources(&self, enabled: &[TerrainSource]) {
        let mut scene = lock(&self.scene);
        let Scene { terrain, loader, shown, .. } = &mut *scene;
        loader.set_sources(terrain, enabled);
        *shown = None;
        drop(scene);
        (self.wake)();
    }

    /// Replaces the appearance (style and its parameters).
    pub fn set_uniforms(&self, uniforms: Uniforms) {
        let mut scene = lock(&self.scene);
        scene.uniforms = uniforms;
        scene.shown = None;
        drop(scene);
        (self.wake)();
    }

    /// One display-link tick. `now` is the frame's target presentation time
    /// in seconds on the platform's media clock.
    pub fn frame(&self, now: f64) -> Result<FrameResult, csk_gpu::Error> {
        let (view, pose, animating) = {
            let mut camera = lock(&self.camera);
            let animating = camera.advance(now);
            (camera.view(), camera.pose(), animating)
        };
        let (result, sample) = self.draw(view, animating)?;
        let listener = lock(&self.listener).clone();
        if let Some(listener) = listener {
            let moved = lock(&self.reported).replace(pose) != Some(pose);
            if moved {
                listener.moved(pose);
            }
            if let Some(sample) = sample {
                listener.sampled(sample);
            }
        }
        Ok(result)
    }

    fn draw(&self, view: View, animating: bool) -> Result<(FrameResult, Option<ViewSample>), csk_gpu::Error> {
        let mut scene = lock(&self.scene);
        let Scene { gpu, presenter, terrain, loader, uniforms, shown, coverage, sampled, fresh } = &mut *scene;
        let changed = loader.update(gpu, terrain, &view);
        *fresh |= changed;
        let sample = terrain.take_sample(gpu);
        let mut result = FrameResult {
            presented: false,
            again: animating,
            coverage: *coverage,
            resident: terrain.resident_tiles(),
            in_flight: loader.in_flight(),
        };
        // A settled view is sampled once, and again as terrain arrives.
        let settle = !animating && !terrain.sampling() && (*sampled != Some(view) || *fresh);
        if !changed && *shown == Some(view) && !settle {
            result.again |= terrain.sampling();
            return Ok((result, sample));
        }
        if settle {
            terrain.request_sample();
        }
        match presenter.present(gpu, terrain, &view, uniforms)? {
            Presented::Shown(stats) => {
                *shown = Some(view);
                *coverage = stats.coverage;
                result.presented = true;
                result.coverage = stats.coverage;
                if settle {
                    *sampled = Some(view);
                    *fresh = false;
                }
            }
            Presented::Skipped => {
                *shown = None;
                result.again = true;
            }
        }
        result.again |= terrain.sampling();
        Ok((result, sample))
    }
}
