//! The app state's actions: the shell's commands and queries in, shell
//! updates out, and the map kept drawing what the state describes.

use std::sync::{Arc, Mutex, MutexGuard};

use csk_engine::Engine;
use csk_engine::elevation::TerrainSource;
use csk_gpu::ViewSample;
use csk_map::{Listener, Map, Pose};
use serde_json::{Map as Object, Value, json};

use crate::render::{Appearance, Lighting, Look, Spectrum};
use crate::shell;
use crate::state::{AppState, Fitted, TerrainState};
use crate::terrain::{Fit, catalog, fit_range};

const STATE_KEY: &str = "app.state.v1";

/// Receives `ShellUpdate` JSON, from any thread.
pub type Publish = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Default)]
struct View {
    sheet: String,
    page: Option<String>,
}

struct Inner {
    state: AppState,
    fitted: Fitted,
    view: View,
    route: String,
    /// The camera as last reported by the map.
    pose: Option<Pose>,
    /// Bearing last published (the dock's north button).
    bearing: f64,
    settled: bool,
}

pub struct App {
    engine: Arc<Engine>,
    inner: Mutex<Inner>,
    map: Mutex<Option<Arc<Map>>>,
    publish: Publish,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|s| s.trim().parse().ok())).filter(|v| v.is_finite())
}

/// The sources a terrain preference draws from.
fn sources(preference: &str) -> Vec<TerrainSource> {
    match preference {
        "3dep" => vec![TerrainSource::Overview, TerrainSource::National],
        "usgs1m" => vec![TerrainSource::Overview, TerrainSource::National, TerrainSource::Lidar],
        _ => TerrainSource::ALL.to_vec(),
    }
}

/// Keeps a fitted range unless the view materially changed it, so colours
/// do not shimmer while panning; a newly sampled extreme always widens it.
fn stable(next: [f64; 2], previous: Option<[f64; 2]>) -> [f64; 2] {
    let Some(p) = previous else { return next };
    let threshold = (next[1] - next[0]).max(1e-6) * 0.04;
    [
        if next[0] < p[0] || next[0] - p[0] > threshold { next[0] } else { p[0] },
        if next[1] > p[1] || p[1] - next[1] > threshold { next[1] } else { p[1] },
    ]
}

impl App {
    /// The app state, restored from the engine's store.
    pub fn new(engine: Arc<Engine>, publish: Publish) -> Arc<Self> {
        let state = engine
            .store
            .kv_get(STATE_KEY)
            .ok()
            .flatten()
            .and_then(|(json, _)| serde_json::from_str::<AppState>(&json).ok())
            .unwrap_or_default();
        let inner = Inner {
            state,
            fitted: Fitted::default(),
            view: View::default(),
            route: "layers".into(),
            pose: None,
            bearing: 0.0,
            settled: false,
        };
        Arc::new(Self { engine, inner: Mutex::new(inner), map: Mutex::new(None), publish })
    }

    /// Starts the shell: everything it shows, marked ready.
    pub fn start(&self) {
        let inner = lock(&self.inner);
        let mut update = self.whole(&inner);
        update.insert("ready".into(), json!(true));
        drop(inner);
        self.send_update(update);
    }

    /// Draws into `map` (or stops drawing when None). The map reports its
    /// camera and samples back to the app.
    pub fn set_map(self: &Arc<Self>, map: Option<Arc<Map>>) {
        if let Some(old) = lock(&self.map).take() {
            old.set_listener(None);
        }
        if let Some(map) = &map {
            let inner = lock(&self.inner);
            map.set_sources(&sources(&inner.state.terrain.source));
            map.set_uniforms(self.uniforms(&inner));
            drop(inner);
            map.set_listener(Some(Arc::new(MapEvents(Arc::downgrade(self)))));
        }
        *lock(&self.map) = map;
    }

    fn whole(&self, inner: &Inner) -> Object<String, Value> {
        let (lon, lat, zoom) = self.where_(inner);
        let mut update = Object::new();
        update.insert("appearance".into(), shell::appearance());
        update.insert("groups".into(), shell::groups());
        update.insert("route".into(), json!(inner.route));
        update.insert("counts".into(), shell::counts(&inner.state));
        update.insert("search".into(), shell::search());
        update.insert("map".into(), shell::map_state(&inner.state, inner.bearing));
        update.insert("dock".into(), shell::dock(&inner.state, inner.bearing));
        update.insert("status".into(), shell::status(&inner.state, &inner.fitted, lon, lat, zoom, inner.settled));
        update.insert("panelOpen".into(), Value::Null);
        update.insert("panel".into(), Value::Null);
        update
    }

    fn where_(&self, inner: &Inner) -> (f64, f64, f64) {
        inner.pose.map_or((0.0, 0.0, 0.0), |p| {
            let [lon, lat] = p.lon_lat();
            (lon, lat, p.zoom)
        })
    }

    fn send_update(&self, update: Object<String, Value>) {
        if !update.is_empty() {
            (self.publish)(Value::Object(update).to_string());
        }
    }

    fn uniforms(&self, inner: &Inner) -> csk_gpu::Uniforms {
        let t = &inner.state.terrain;
        let appearance = Appearance {
            style: t.style.clone(),
            opacity: t.opacity / 100.0,
            look: t.look,
            lighting: t.lighting,
            spectrum: Spectrum::default(),
            spectrum_opacity: 1.0,
            stack: t.studio.build_stack(&t.style, &inner.fitted.ranges, 0.0, None),
        };
        let mut uniforms = csk_gpu::Uniforms::default();
        // The appearance is built from clamped state; a failure is a layout bug.
        if let Err(error) = appearance.apply(&mut uniforms) {
            debug_assert!(false, "appearance uniforms: {error}");
        }
        uniforms
    }

    fn redraw(&self, inner: &Inner) {
        if let Some(map) = lock(&self.map).as_ref() {
            map.set_uniforms(self.uniforms(inner));
        }
    }

    fn save(&self, inner: &Inner) {
        if let Ok(json) = serde_json::to_string(&inner.state) {
            let _ = self.engine.store.kv_put(STATE_KEY, &json);
        }
    }

    /// The visible page and everything a state change can alter.
    fn changed(&self, inner: &Inner) -> Object<String, Value> {
        let (lon, lat, zoom) = self.where_(inner);
        let mut update = Object::new();
        update.insert("counts".into(), shell::counts(&inner.state));
        update.insert("map".into(), shell::map_state(&inner.state, inner.bearing));
        update.insert("dock".into(), shell::dock(&inner.state, inner.bearing));
        update.insert("status".into(), shell::status(&inner.state, &inner.fitted, lon, lat, zoom, inner.settled));
        if let Some(page) = inner.view.page.as_deref().and_then(|p| shell::page(p, &inner.state, &inner.fitted)) {
            update.insert("page".into(), page);
        }
        update
    }

    /// A shell command (ios/Sources/Shell/ShellBackend.swift).
    pub fn send(&self, command: &str, args: &Value) {
        let mut inner = lock(&self.inner);
        let update = match command {
            "setView" => {
                let page = args["page"].as_str().map(str::to_owned);
                inner.view.sheet = args["sheet"].as_str().unwrap_or("closed").to_owned();
                let opened = page.is_some() && page != inner.view.page;
                inner.view.page = page;
                let mut update = Object::new();
                if opened
                    && let Some(page) =
                        inner.view.page.as_deref().and_then(|p| shell::page(p, &inner.state, &inner.fitted))
                {
                    update.insert("page".into(), page);
                }
                update
            }
            "open" => {
                let Some(route) = args["route"].as_str().filter(|r| shell::route_info(r).is_some()) else { return };
                inner.route = route.to_owned();
                inner.view.page = Some(route.to_owned());
                inner.view.sheet = args["sheet"].as_str().unwrap_or("medium").to_owned();
                let mut update = Object::new();
                update.insert("route".into(), json!(route));
                if let Some(page) = shell::page(route, &inner.state, &inner.fitted) {
                    update.insert("page".into(), page);
                }
                update
            }
            "act" => {
                let r = args["ref"].as_str().unwrap_or_default();
                let op = args["op"].as_str().unwrap_or("click");
                if !self.act(&mut inner, r, op, &args["value"]) {
                    return;
                }
                self.redraw(&inner);
                if op != "input" {
                    self.save(&inner);
                }
                self.changed(&inner)
            }
            "tool" => {
                match args["id"].as_str().unwrap_or_default() {
                    "mapTheme" => {
                        let dark = inner.state.theme == "dark";
                        inner.state.theme = if dark { "light" } else { "dark" }.into();
                        self.save(&inner);
                    }
                    "bearingReset" => {
                        if let Some(map) = lock(&self.map).as_ref() {
                            map.camera(|c| {
                                let pose = c.pose();
                                c.ease_next(Pose { bearing: 0.0, ..pose }, 0.3);
                            });
                        }
                        return;
                    }
                    _ => return,
                }
                self.changed(&inner)
            }
            "moveTool" => {
                let (Some(id), Some(index)) = (args["id"].as_str(), args["index"].as_u64()) else { return };
                let mut order: Vec<String> = shell::dock(&inner.state, inner.bearing)
                    .as_array()
                    .map(|tools| tools.iter().filter_map(|t| t["id"].as_str().map(str::to_owned)).collect())
                    .unwrap_or_default();
                let Some(from) = order.iter().position(|t| t == id) else { return };
                let tool = order.remove(from);
                order.insert((index as usize).min(order.len()), tool);
                inner.state.dock_order = order;
                self.save(&inner);
                let mut update = Object::new();
                update.insert("dock".into(), shell::dock(&inner.state, inner.bearing));
                update
            }
            _ => return,
        };
        drop(inner);
        self.send_update(update);
    }

    /// A shell query; answers JSON in the page's shapes.
    pub fn ask(&self, query: &str, _args: &Value) -> Value {
        match query {
            "routeMatches" | "suggest" => json!([]),
            "submit" => json!({}),
            "enterValue" => json!({"accepted": false, "message": "This size is no longer available."}),
            "selectMark" => json!({"selected": false}),
            "shareURL" => json!({"error": "Sharing is not available yet in this build."}),
            "bestImagery" => json!({"message": "", "applied": false}),
            _ => Value::Null,
        }
    }

    /// Applies an action on a control. Returns whether anything changed.
    fn act(&self, inner: &mut Inner, r: &str, op: &str, value: &Value) -> bool {
        let t = &mut inner.state.terrain;
        let v = number(value);
        let refit = |inner: &mut Inner| inner.fitted.ranges.clear();
        if let Some(id) = r.strip_prefix("look:") {
            if !t.apply_look(id) {
                return false;
            }
            refit(inner);
            return true;
        }
        if let Some(style) = r.strip_prefix("style:") {
            return self.set_style(inner, style);
        }
        if let Some(rest) = r.strip_prefix("studio:") {
            return self.act_studio(inner, rest, op, value);
        }
        match (r, v) {
            ("#terStyle", _) => {
                let style = value.as_str().unwrap_or_default().to_owned();
                return self.set_style(inner, &style);
            }
            ("#terOp", Some(v)) => t.opacity = v.clamp(0.0, 100.0),
            ("#terBrightness", Some(v)) => t.look.brightness = v.clamp(75.0, 150.0),
            ("#terContrast", Some(v)) => t.look.contrast = v.clamp(60.0, 180.0),
            ("#terSaturation", Some(v)) => t.look.saturation = v.clamp(0.0, 180.0),
            ("#terLookReset", _) => t.look = Look::default(),
            ("#terSunAz", Some(v)) => t.lighting.azimuth = v.clamp(0.0, 359.0),
            ("#terSunAlt", Some(v)) => t.lighting.altitude = v.clamp(5.0, 90.0),
            ("#terAmbient", Some(v)) => t.lighting.ambient = v.clamp(0.0, 60.0) / 100.0,
            ("#terExaggeration", Some(v)) => t.exaggeration = v.clamp(25.0, 400.0),
            ("#terLightReset", _) => {
                t.lighting = Lighting::default();
                t.exaggeration = 125.0;
            }
            ("#terSrc", _) => {
                let Some(source) = value.as_str().filter(|s| ["auto", "3dep", "usgs1m"].contains(s)) else {
                    return false;
                };
                t.source = source.to_owned();
                if let Some(map) = lock(&self.map).as_ref() {
                    map.set_sources(&sources(source));
                }
            }
            ("#terReset", _) => *t = TerrainState::default(),
            ("#ls-relief", Some(v)) => t.studio.effects.relief_exag = shell::slider_to_relief(v).clamp(0.25, 8.0),
            ("#ls-detail", Some(v)) => t.studio.effects.detail = (v / 100.0).clamp(-1.0, 3.0),
            ("#ls-detail-size", Some(v)) => {
                t.studio.effects.detail_radius = shell::slider_to_detail_radius(v).clamp(1.0, 500.0);
            }
            ("#ls-valley", Some(v)) => {
                t.studio.effects.rem_radius = shell::slider_to_rem_radius(v).clamp(50.0, 20000.0)
            }
            _ => return false,
        }
        if r.starts_with("#ls-") {
            t.studio.look = match_look(t);
        }
        if r == "#terReset" {
            refit(inner);
        }
        true
    }

    fn set_style(&self, inner: &mut Inner, style: &str) -> bool {
        if style != "off" && catalog().style(style).is_none() {
            return false;
        }
        let t = &mut inner.state.terrain;
        t.style = style.to_owned();
        t.studio.look = match_look(t);
        inner.fitted.ranges.clear();
        true
    }

    fn act_studio(&self, inner: &mut Inner, rest: &str, _op: &str, _value: &Value) -> bool {
        let t = &mut inner.state.terrain;
        let style = t.style.clone();
        if let Some(key) = rest.strip_suffix(":eye") {
            let layer = if key == "base" {
                let mut layer = t.studio.base_layer(&style);
                layer.visible = !layer.visible;
                t.studio.base.insert(style.clone(), layer);
                true
            } else if let Some(i) = key.strip_prefix("overlay:").and_then(|i| i.parse::<usize>().ok())
                && let Some(layer) = t.studio.overlays.get_mut(i)
            {
                layer.visible = !layer.visible;
                true
            } else {
                false
            };
            if layer {
                t.studio.look = match_look(t);
            }
            return layer;
        }
        if rest == "reset" {
            // Back to the applied look's own mix, or the style's plain layer.
            let look = t.studio.look.clone().and_then(|id| catalog().look(&id).cloned());
            match look {
                Some(look) if look.scene.style == style => {
                    t.studio.apply_scene(&look.scene, Some(&look.id));
                }
                _ => {
                    t.studio.base.remove(&style);
                    t.studio.overlays.clear();
                    t.studio.effects = catalog().effect_defaults;
                    t.studio.look = match_look(t);
                }
            }
            inner.fitted.ranges.clear();
            return true;
        }
        false
    }

    fn moved(&self, pose: Pose) {
        let mut inner = lock(&self.inner);
        inner.pose = Some(pose);
        inner.settled = false;
        // The dock's north button and the bearing in map state.
        let shows = |b: f64| b.abs() >= 0.5;
        if shows(pose.bearing) != shows(inner.bearing) || (pose.bearing - inner.bearing).abs() >= 0.5 {
            inner.bearing = pose.bearing;
            let mut update = Object::new();
            update.insert("map".into(), shell::map_state(&inner.state, inner.bearing));
            update.insert("dock".into(), shell::dock(&inner.state, inner.bearing));
            drop(inner);
            self.send_update(update);
        }
    }

    fn sampled(&self, sample: ViewSample) {
        let mut inner = lock(&self.inner);
        let heights: Vec<f64> = sample.heights.iter().map(|h| f64::from(*h)).collect();
        let centre = heights[(sample.height / 2 * sample.width + sample.width / 2) as usize];
        inner.fitted.center = centre.is_finite().then_some(centre);
        inner.settled = true;
        let t = &inner.state.terrain;
        let mut ranges = inner.fitted.ranges.clone();
        let mut layers = vec![("base".to_string(), t.studio.base_layer(&t.style))];
        layers.extend(t.studio.overlays.iter().enumerate().map(|(i, l)| (format!("overlay:{i}"), l.clone())));
        for (key, layer) in layers {
            // Relative elevation fits once the valley-floor field exists.
            if !layer.visible || !layer.auto || layer.style == "rem" {
                continue;
            }
            let mode = (layer.style == "tint" && layer.range_mode != "separate").then_some(layer.range_mode.as_str());
            let Some(fit) = fit_range(&heights, &layer.style, mode) else { continue };
            let previous = match ranges.get(&key) {
                Some(Fit::Range(r)) => Some(*r),
                _ => None,
            };
            ranges.insert(key, Fit::Range(if layer.style == "tint" { stable(fit, previous) } else { fit }));
        }
        let refitted = ranges != inner.fitted.ranges;
        inner.fitted.ranges = ranges;
        if refitted {
            self.redraw(&inner);
        }
        let update = self.changed(&inner);
        drop(inner);
        self.send_update(update);
    }
}

/// The applied look, if the studio still draws exactly that look.
fn match_look(t: &TerrainState) -> Option<String> {
    catalog()
        .looks
        .iter()
        .find(|look| {
            let s = &look.scene;
            s.style == t.style
                && t.studio.base_layer(&s.style) == s.base
                && t.studio.overlays == s.overlays
                && t.studio.effects == s.effects
        })
        .map(|look| look.id.clone())
}

/// The map's events, held weakly so a map never keeps the app alive.
struct MapEvents(std::sync::Weak<App>);

impl Listener for MapEvents {
    fn moved(&self, pose: Pose) {
        if let Some(app) = self.0.upgrade() {
            app.moved(pose);
        }
    }

    fn sampled(&self, sample: ViewSample) {
        if let Some(app) = self.0.upgrade() {
            app.sampled(sample);
        }
    }
}
