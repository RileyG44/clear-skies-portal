//! The map camera and its gestures and animations.
//!
//! Screen points are CSS points from the view's top-left corner. Bearing is
//! clockwise in degrees: a clockwise finger twist turns the content clockwise
//! and so lowers the bearing. Every gesture keeps the world point under its
//! anchor fixed on screen.

use csk_gpu::View;

/// UIScrollView's normal deceleration: velocity keeps 0.998 of itself per
/// millisecond, so it decays as e^(-t/TAU).
const TAU: f64 = 0.4995;
/// Pinch momentum decays faster than pan momentum.
const ZOOM_TAU: f64 = 0.25;
/// Below these a fling has stopped (CSS points/s, zoom levels/s).
const REST_PAN: f64 = 6.0;
const REST_ZOOM: f64 = 0.02;

/// Where the camera looks. Web Mercator centre in [0,1].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub center: [f64; 2],
    pub zoom: f64,
    pub bearing: f64,
}

impl Pose {
    /// A pose from degrees of longitude and latitude (clamped to Web
    /// Mercator's ±85.05°).
    pub fn from_lon_lat(lon: f64, lat: f64, zoom: f64, bearing: f64) -> Self {
        let lat = lat.clamp(-85.051_128_78, 85.051_128_78).to_radians();
        let y = 0.5 - (std::f64::consts::FRAC_PI_4 + lat / 2.0).tan().ln() / (2.0 * std::f64::consts::PI);
        Self { center: [lon / 360.0 + 0.5, y], zoom, bearing }
    }

    /// The centre's longitude and latitude in degrees.
    pub fn lon_lat(&self) -> [f64; 2] {
        let lon = (self.center[0] - 0.5) * 360.0;
        let lat = (std::f64::consts::PI * (1.0 - 2.0 * self.center[1])).sinh().atan().to_degrees();
        [lon, lat]
    }
}

#[derive(Clone, Copy, Debug)]
enum Motion {
    /// Momentum after a gesture ends. Displacement after t seconds is
    /// v·τ·(1 − e^(−t/τ)); `done` is the part already applied.
    Fling { start: f64, pan: [f64; 2], zoom: f64, anchor: [f64; 2], done: ([f64; 2], f64) },
    /// An eased move. With `around`, the world point stays under that
    /// screen point throughout (double-tap zoom).
    Ease { start: f64, duration: f64, from: Pose, to: Pose, around: Option<([f64; 2], [f64; 2])> },
}

pub struct Camera {
    view: View,
    min_zoom: f64,
    max_zoom: f64,
    motion: Option<Motion>,
}

/// Ease-out cubic.
fn ease(t: f64) -> f64 {
    1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3)
}

/// Bearing in (-180, 180].
fn wrap_bearing(b: f64) -> f64 {
    let b = (b + 180.0).rem_euclid(360.0) - 180.0;
    if b == -180.0 { 180.0 } else { b }
}

impl Camera {
    pub fn new(pose: Pose, css: [f64; 2], dpr: f64) -> Self {
        let mut camera = Self {
            view: View { center: pose.center, zoom: pose.zoom, bearing: pose.bearing, css, dpr },
            min_zoom: 0.0,
            max_zoom: 22.0,
            motion: None,
        };
        camera.normalize();
        camera
    }

    pub fn view(&self) -> View {
        self.view
    }

    pub fn pose(&self) -> Pose {
        Pose { center: self.view.center, zoom: self.view.zoom, bearing: self.view.bearing }
    }

    pub fn animating(&self) -> bool {
        self.motion.is_some()
    }

    pub fn set_zoom_limits(&mut self, min: f64, max: f64) {
        if min.is_finite() && max.is_finite() && 0.0 <= min && min <= max && max <= 24.0 {
            (self.min_zoom, self.max_zoom) = (min, max);
            self.normalize();
        }
    }

    /// The view's size in CSS points and its device pixel ratio.
    pub fn resize(&mut self, css: [f64; 2], dpr: f64) {
        if css.iter().all(|v| v.is_finite() && *v > 0.0) && dpr.is_finite() && dpr > 0.0 {
            self.view.css = css;
            self.view.dpr = dpr;
        }
    }

    fn world(&self) -> f64 {
        256.0 * self.view.zoom.exp2()
    }

    /// Screen offset from the view centre to Mercator, at the current bearing.
    fn rotate(&self, a: f64, b: f64) -> [f64; 2] {
        let (sin, cos) = self.view.bearing.to_radians().sin_cos();
        [a * cos + b * sin, -a * sin + b * cos]
    }

    fn offset(&self, point: [f64; 2]) -> [f64; 2] {
        [point[0] - self.view.css[0] / 2.0, point[1] - self.view.css[1] / 2.0]
    }

    /// The Mercator point under a screen point.
    pub fn unproject(&self, point: [f64; 2]) -> [f64; 2] {
        let [a, b] = self.offset(point);
        let [dx, dy] = self.rotate(a, b);
        let world = self.world();
        [self.view.center[0] + dx / world, self.view.center[1] + dy / world]
    }

    /// Moves the centre so that Mercator `world` lies under screen `point`.
    fn place(&mut self, world: [f64; 2], point: [f64; 2]) {
        let [a, b] = self.offset(point);
        let [dx, dy] = self.rotate(a, b);
        let scale = self.world();
        self.view.center = [world[0] - dx / scale, world[1] - dy / scale];
    }

    fn normalize(&mut self) {
        let v = &mut self.view;
        v.zoom = v.zoom.clamp(self.min_zoom, self.max_zoom);
        v.bearing = wrap_bearing(v.bearing);
        v.center[0] = v.center[0].rem_euclid(1.0);
        v.center[1] = v.center[1].clamp(0.0, 1.0);
    }

    /// A finger touched down: momentum and animations stop.
    pub fn stop(&mut self) {
        self.motion = None;
    }

    /// The content follows a finger by `delta` CSS points.
    pub fn pan(&mut self, delta: [f64; 2]) {
        if !delta.iter().all(|v| v.is_finite()) {
            return;
        }
        let [dx, dy] = self.rotate(delta[0], delta[1]);
        let world = self.world();
        self.view.center[0] -= dx / world;
        self.view.center[1] -= dy / world;
        self.normalize();
    }

    /// Zooms by `levels` (log2 scale) about a screen point.
    pub fn zoom_by(&mut self, levels: f64, anchor: [f64; 2]) {
        if !levels.is_finite() || !anchor.iter().all(|v| v.is_finite()) {
            return;
        }
        let world = self.unproject(anchor);
        self.view.zoom = (self.view.zoom + levels).clamp(self.min_zoom, self.max_zoom);
        self.place(world, anchor);
        self.normalize();
    }

    /// Turns the content clockwise by `degrees` about a screen point.
    pub fn rotate_by(&mut self, degrees: f64, anchor: [f64; 2]) {
        if !degrees.is_finite() || !anchor.iter().all(|v| v.is_finite()) {
            return;
        }
        let world = self.unproject(anchor);
        self.view.bearing -= degrees;
        self.place(world, anchor);
        self.normalize();
    }

    /// Momentum when fingers lift: pan velocity in CSS points/s, zoom in
    /// levels/s about `anchor`. `now` is in seconds on the frame clock.
    pub fn fling(&mut self, now: f64, pan: [f64; 2], zoom: f64, anchor: [f64; 2]) {
        let finite = pan.iter().chain(&anchor).chain([&zoom, &now]).all(|v| v.is_finite());
        let moving = pan[0].hypot(pan[1]) > REST_PAN || zoom.abs() > REST_ZOOM;
        self.motion =
            (finite && moving).then_some(Motion::Fling { start: now, pan, zoom, anchor, done: ([0.0; 2], 0.0) });
    }

    /// Eases to `to` over `duration` seconds (immediately when zero).
    /// With `around`, the screen point's world point stays fixed (the
    /// target's centre is then implied by zoom and bearing).
    pub fn ease_to(&mut self, now: f64, to: Pose, duration: f64, around: Option<[f64; 2]>) {
        let finite = to.center.iter().chain([&to.zoom, &to.bearing, &duration]).all(|v| v.is_finite())
            && (now.is_finite() || now.is_nan());
        if !finite || !(0.0..=1.0).contains(&to.center[1]) {
            return;
        }
        let to = Pose { zoom: to.zoom.clamp(self.min_zoom, self.max_zoom), ..to };
        let around = around.filter(|p| p.iter().all(|v| v.is_finite())).map(|p| (self.unproject(p), p));
        let from = self.pose();
        // Turn the short way, and cross the antimeridian the short way.
        let to = Pose {
            bearing: from.bearing + wrap_bearing(to.bearing - from.bearing),
            center: [from.center[0] + (to.center[0] - from.center[0] + 0.5).rem_euclid(1.0) - 0.5, to.center[1]],
            ..to
        };
        self.motion = Some(Motion::Ease { start: now, duration: duration.max(0.0), from, to, around });
        if now.is_finite() {
            self.advance(now);
        }
    }

    /// Eases to `to` from the next frame, for callers without the frame
    /// clock (the app state's own actions, such as reset to north).
    pub fn ease_next(&mut self, to: Pose, duration: f64) {
        self.ease_to(f64::NAN, to, duration, None);
    }

    /// Advances any motion to `now`. Returns whether it is still moving.
    pub fn advance(&mut self, now: f64) -> bool {
        // An ease queued without the clock starts at its first frame.
        if let Some(Motion::Ease { start, .. } | Motion::Fling { start, .. }) = &mut self.motion
            && start.is_nan()
        {
            *start = now;
        }
        let Some(motion) = self.motion else { return false };
        match motion {
            Motion::Fling { start, pan, zoom, anchor, done } => {
                let t = (now - start).max(0.0);
                let pan_k = TAU * (1.0 - (-t / TAU).exp());
                let zoom_k = ZOOM_TAU * (1.0 - (-t / ZOOM_TAU).exp());
                let total = ([pan[0] * pan_k, pan[1] * pan_k], zoom * zoom_k);
                self.pan([total.0[0] - done.0[0], total.0[1] - done.0[1]]);
                self.zoom_by(total.1 - done.1, anchor);
                let speed = pan[0].hypot(pan[1]) * (-t / TAU).exp();
                let zooming = zoom.abs() * (-t / ZOOM_TAU).exp();
                let at_limit =
                    (self.view.zoom <= self.min_zoom && zoom < 0.0) || (self.view.zoom >= self.max_zoom && zoom > 0.0);
                let zoom_moving = zooming > REST_ZOOM && !at_limit;
                self.motion = (speed > REST_PAN || zoom_moving).then_some(Motion::Fling {
                    start,
                    pan,
                    zoom: if zoom_moving { zoom } else { 0.0 },
                    anchor,
                    done: (total.0, if zoom_moving { total.1 } else { 0.0 }),
                });
            }
            Motion::Ease { start, duration, from, to, around } => {
                let t = if duration > 0.0 { (now - start) / duration } else { 1.0 };
                let k = ease(t);
                let mix = |a: f64, b: f64| a + (b - a) * k;
                self.view.zoom = mix(from.zoom, to.zoom);
                self.view.bearing = mix(from.bearing, to.bearing);
                match around {
                    Some((world, point)) => self.place(world, point),
                    None => self.view.center = [mix(from.center[0], to.center[0]), mix(from.center[1], to.center[1])],
                }
                self.normalize();
                if t >= 1.0 {
                    self.motion = None;
                }
            }
        }
        self.motion.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn camera() -> Camera {
        Camera::new(Pose { center: [0.17, 0.36], zoom: 14.3, bearing: 30.0 }, [390.0, 844.0], 3.0)
    }

    fn close(a: [f64; 2], b: [f64; 2]) -> bool {
        (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12
    }

    #[test]
    fn poses_round_trip_through_degrees() {
        let p = Pose::from_lon_lat(-122.3321, 47.6062, 12.0, 0.0);
        let [lon, lat] = p.lon_lat();
        assert!((lon + 122.3321).abs() < 1e-9 && (lat - 47.6062).abs() < 1e-9);
    }

    #[test]
    fn gestures_keep_their_anchor_fixed() {
        let mut c = camera();
        let anchor = [100.0, 600.0];
        let before = c.unproject(anchor);
        c.zoom_by(1.7, anchor);
        assert!(close(c.unproject(anchor), before));
        c.rotate_by(25.0, anchor);
        assert!(close(c.unproject(anchor), before));
        assert!((c.view().bearing - 5.0).abs() < 1e-9);
        let grabbed = c.unproject([200.0, 300.0]);
        c.pan([40.0, -15.0]);
        assert!(close(c.unproject([240.0, 285.0]), grabbed));
    }

    #[test]
    fn a_fling_decelerates_to_rest_independent_of_frame_rate() {
        let (mut a, mut b) = (camera(), camera());
        a.fling(10.0, [800.0, -300.0], 0.0, [0.0; 2]);
        b.fling(10.0, [800.0, -300.0], 0.0, [0.0; 2]);
        let mut t = 10.0;
        while a.advance(t) {
            t += 1.0 / 120.0;
        }
        let mut t = 10.0;
        while b.advance(t) {
            t += 1.0 / 30.0;
        }
        // Both travel v·τ (to within the rest threshold's tail).
        for c in [&a, &b] {
            let moved = c.unproject([195.0, 422.0]);
            let mut back = camera();
            back.pan([800.0 * TAU, -300.0 * TAU]);
            let expected = back.unproject([195.0, 422.0]);
            let px = (moved[0] - expected[0]).hypot(moved[1] - expected[1]) * 256.0 * 14.3f64.exp2();
            assert!(px < REST_PAN * TAU, "{px} points from the analytic rest");
        }
        assert!(!a.animating() && t < 15.0);
    }

    #[test]
    fn easing_crosses_the_antimeridian_the_short_way() {
        let mut c = Camera::new(Pose { center: [0.99, 0.4], zoom: 5.0, bearing: 170.0 }, [400.0, 400.0], 2.0);
        c.ease_to(0.0, Pose { center: [0.01, 0.4], zoom: 5.0, bearing: -170.0 }, 1.0, None);
        c.advance(0.5);
        let v = c.view();
        assert!(v.center[0] > 0.98 || v.center[0] < 0.02, "{v:?}");
        assert!(v.bearing.abs() > 170.0, "{v:?}");
        assert!(!c.advance(1.0));
        assert!((c.view().center[0] - 0.01).abs() < 1e-12);
    }
}
