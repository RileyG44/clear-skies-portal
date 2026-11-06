//! The app state's actions: the shell's commands and queries in, shell
//! updates out, and the map kept drawing what the state describes.

use std::sync::{Arc, Mutex, MutexGuard};

use csk_engine::Engine;
use csk_engine::elevation::TerrainSource;
use csk_engine::layers::RasterLayer;
use csk_gpu::RasterStyle;
use csk_gpu::ViewSample;
use csk_map::{Draw, Listener, Map, Pose};
use serde_json::{Map as Object, Value, json};

use crate::render::{Appearance, Lighting, Look, Spectrum};
use crate::shell;
use crate::state::{AppState, Fitted, TerrainState};
use crate::terrain::{Fit, Stack, catalog, fit_elevation, fit_range, fit_relative, stable_fit};

const STATE_KEY: &str = "app.state.v1";
/// The `.clearskies` document's type (UTType dev.riley.clearskies.view).
pub const DOCUMENT_TYPE: &str = "clearskies.view";

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
    /// The selected place, and how many times it has changed.
    location: Option<shell::Location>,
    location_version: u64,
}

/// The last place suggestions, numbered so a pick names the list it saw.
#[derive(Default)]
struct Suggestions {
    version: u64,
    places: Vec<csk_engine::places::Place>,
}

pub struct App {
    engine: Arc<Engine>,
    inner: Mutex<Inner>,
    suggestions: Mutex<Suggestions>,
    /// The lighting the published look previews were drawn with.
    previews: Mutex<Option<crate::render::Lighting>>,
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

/// The map's layers, bottom first: the pinned reference basemap in the
/// map theme, then the person's order (kept top first).
fn draws(state: &AppState) -> Vec<Draw> {
    let dark = state.theme == "dark";
    let mut out = Vec::new();
    if let Some(base) = RasterLayer::by_id(if dark { "dark" } else { "light" }) {
        out.push(Draw::Raster(base, RasterStyle { opacity: 1.0, muted: false }));
    }
    for id in state.layer_order.iter().rev() {
        match id.as_str() {
            "terrain" => out.push(Draw::Terrain),
            overlay => {
                let Some(o) = overlay.strip_prefix("overlay:") else { continue };
                let state = state.overlay(o);
                if let (true, Some((layer, muted))) = (state.on, crate::overlays::raster(o, dark)) {
                    let opacity = (state.opacity / 100.0).clamp(0.0, 1.0) as f32;
                    out.push(Draw::Raster(layer, RasterStyle { opacity, muted }));
                }
            }
        }
    }
    if !out.contains(&Draw::Terrain) {
        out.insert(out.len().min(1), Draw::Terrain);
    }
    out
}

/// The selected place's dot (search.js setLoc: radius 7, weight 2, the
/// appearance's location-dot colour, fill at 55%).
fn markers(location: Option<&shell::Location>) -> Vec<csk_gpu::Marker> {
    location
        .map(|l| {
            let at = Pose::from_lon_lat(l.lng, l.lat, 0.0, 0.0).center;
            let white = [1.0, 1.0, 1.0];
            vec![csk_gpu::Marker {
                at,
                radius: 7.0,
                stroke: 2.0,
                fill: [white[0], white[1], white[2], 0.55],
                line: [white[0], white[1], white[2], 1.0],
            }]
        })
        .unwrap_or_default()
}

/// The derived fields a stack reads: the Detail blur, and the valley floors
/// of its relative-elevation layers (land-only when separated).
fn derive(stack: Option<&Stack>) -> csk_gpu::Derive {
    let Some(stack) = stack else { return csk_gpu::Derive::default() };
    let rem = |separate: bool| stack.layers.iter().any(|l| l.style == "rem" && l.separate_rem == separate);
    let floor = |separate: bool| if stack.rem_radius > 0.0 && rem(separate) { stack.rem_radius } else { 0.0 };
    csk_gpu::Derive {
        blur: if stack.detail != 0.0 && stack.detail_radius > 0.0 { stack.detail_radius } else { 0.0 },
        base: floor(false),
        land_base: floor(true),
    }
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
            location: None,
            location_version: 0,
        };
        Arc::new(Self {
            engine,
            inner: Mutex::new(inner),
            suggestions: Mutex::default(),
            previews: Mutex::new(None),
            map: Mutex::new(None),
            publish,
        })
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
            let (uniforms, derive) = self.appearance(&inner);
            map.set_appearance(uniforms, derive);
            map.set_layers(draws(&inner.state));
            map.set_markers(markers(inner.location.as_ref()));
            let lighting = inner.state.terrain.lighting;
            drop(inner);
            *lock(&self.map) = Some(map.clone());
            *lock(&self.previews) = None;
            self.refresh_previews(lighting);
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
        update.insert("search".into(), shell::search(inner.location.as_ref(), inner.location_version));
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

    /// The map's shading parameters and the derived fields they read.
    fn appearance(&self, inner: &Inner) -> (csk_gpu::Uniforms, csk_gpu::Derive) {
        let t = &inner.state.terrain;
        let f = &inner.fitted;
        let floor = f.rem_floor.unwrap_or(0.0);
        let stack = t.studio.build_stack(&t.style, &f.ranges, floor, Some(f.rem_land_floor.unwrap_or(floor)));
        let derive = derive(stack.as_ref());
        let appearance = Appearance {
            style: t.style.clone(),
            opacity: t.opacity / 100.0,
            look: t.look,
            lighting: t.lighting,
            spectrum: Spectrum::default(),
            spectrum_opacity: 1.0,
            stack,
        };
        let mut uniforms = csk_gpu::Uniforms::default();
        // The appearance is built from clamped state; a failure is a layout bug.
        if let Err(error) = appearance.apply(&mut uniforms) {
            debug_assert!(false, "appearance uniforms: {error}");
        }
        (uniforms, derive)
    }

    /// Draws the look previews with the person's lighting, off the caller,
    /// unless they are already drawn with it.
    fn refresh_previews(self: &Arc<Self>, lighting: crate::render::Lighting) {
        let Some(map) = lock(&self.map).clone() else { return };
        {
            let mut drawn = lock(&self.previews);
            if *drawn == Some(lighting) {
                return;
            }
            *drawn = Some(lighting);
        }
        let app = Arc::downgrade(self);
        let gpu = map.gpu();
        std::thread::spawn(move || {
            let mut landscape = crate::preview::Landscape::default();
            let mut images = Object::new();
            for look in &catalog().looks {
                // A newer lighting supersedes this batch.
                if app.upgrade().is_none_or(|a| *lock(&a.previews) != Some(lighting)) {
                    return;
                }
                if let Ok(rgba) = landscape.render(&gpu, look, lighting) {
                    let url = crate::preview::data_url(&rgba, crate::preview::WIDTH, crate::preview::HEIGHT);
                    images.insert(format!("csp-image:look:{}", look.id), json!(url));
                }
            }
            if let Some(app) = app.upgrade() {
                let mut update = Object::new();
                update.insert("images".into(), Value::Object(images));
                app.send_update(update);
            }
        });
    }

    fn redraw(&self, inner: &Inner) {
        if let Some(map) = lock(&self.map).as_ref() {
            let (uniforms, derive) = self.appearance(inner);
            map.set_appearance(uniforms, derive);
            map.set_layers(draws(&inner.state));
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
    pub fn send(self: &Arc<Self>, command: &str, args: &Value) {
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
                if let Some(route) = r.strip_prefix("open:") {
                    drop(inner);
                    self.navigate(route);
                    return;
                }
                if let Some(id) = r.strip_prefix("layer:").and_then(|r| r.strip_suffix(":edit")) {
                    drop(inner);
                    let group = id.strip_prefix("overlay:").and_then(crate::overlays::find).map(|o| o.group);
                    self.navigate(group.map_or("terrain", |g| g.route()));
                    return;
                }
                if !self.act(&mut inner, r, op, &args["value"]) {
                    return;
                }
                self.redraw(&inner);
                if op != "input" {
                    self.save(&inner);
                    self.refresh_previews(inner.state.terrain.lighting);
                }
                self.changed(&inner)
            }
            "tool" => {
                match args["id"].as_str().unwrap_or_default() {
                    "mapTheme" => {
                        let dark = inner.state.theme == "dark";
                        inner.state.theme = if dark { "light" } else { "dark" }.into();
                        self.save(&inner);
                        self.redraw(&inner);
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
            "pick" => {
                let (Some(index), Some(version)) = (args["index"].as_u64(), args["version"].as_u64()) else { return };
                let place = {
                    let s = lock(&self.suggestions);
                    (s.version == version).then(|| s.places.get(index as usize).cloned()).flatten()
                };
                drop(inner);
                if let Some(place) = place {
                    self.select(Some(shell::Location {
                        lat: place.lat,
                        lng: place.lng,
                        label: shell::place_label(&place.primary, &place.secondary),
                    }));
                    self.show_place(&place);
                }
                return;
            }
            "selectPoint" => {
                // A map tap (CSS px): the place under it, labelled by its
                // coordinates.
                let (Some(x), Some(y)) = (args["x"].as_f64(), args["y"].as_f64()) else { return };
                let Some(map) = lock(&self.map).clone() else { return };
                drop(inner);
                let [lng, lat] = map.lon_lat_at([x, y]);
                let label = format!("{lat:.5}, {lng:.5}");
                self.select(Some(shell::Location { lat, lng, label }));
                return;
            }
            "clear" => {
                drop(inner);
                self.select(None);
                return;
            }
            "centerSelected" => {
                let Some(l) = inner.location.clone() else { return };
                drop(inner);
                self.go_to(l.lat, l.lng, None, 0.0);
                return;
            }
            "openDocument" => {
                drop(inner);
                self.open_document(args["text"].as_str().unwrap_or_default());
                return;
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

    /// Opens a page from inside another (a navigation row, a layer's Edit):
    /// the shell follows with a way back.
    fn navigate(&self, route: &str) {
        let mut inner = lock(&self.inner);
        if shell::route_info(route).is_none() {
            return;
        }
        inner.route = route.to_owned();
        inner.view.page = Some(route.to_owned());
        let mut update = Object::new();
        update.insert("route".into(), json!(route));
        update.insert("openRoute".into(), json!(route));
        if let Some(page) = shell::page(route, &inner.state, &inner.fitted) {
            update.insert("page".into(), page);
        }
        drop(inner);
        self.send_update(update);
    }

    /// Eases the camera to a point, keeping the bearing; `zoom` None keeps
    /// the zoom (raised to `at_least`).
    fn go_to(&self, lat: f64, lng: f64, zoom: Option<f64>, at_least: f64) {
        if let Some(map) = lock(&self.map).as_ref() {
            map.camera(|c| {
                let pose = c.pose();
                let zoom = zoom.unwrap_or(pose.zoom.max(at_least));
                c.ease_next(Pose::from_lon_lat(lng, lat, zoom, pose.bearing), 0.8);
            });
        }
    }

    /// Selects a place (search, a map tap) and publishes it.
    fn select(&self, location: Option<shell::Location>) {
        let mut inner = lock(&self.inner);
        inner.location = location;
        inner.location_version += 1;
        if let Some(map) = lock(&self.map).as_ref() {
            map.set_markers(markers(inner.location.as_ref()));
        }
        let mut update = Object::new();
        update.insert("search".into(), shell::search(inner.location.as_ref(), inner.location_version));
        drop(inner);
        self.send_update(update);
    }

    /// The view as a `.clearskies` document: the camera, the selected
    /// place and everything the person chose. Opens in the app, offline.
    fn document(&self) -> Value {
        let inner = lock(&self.inner);
        let camera = inner.pose.map(|p| {
            let [lon, lat] = p.lon_lat();
            json!({"lon": lon, "lat": lat, "zoom": p.zoom, "bearing": p.bearing})
        });
        json!({"type": DOCUMENT_TYPE, "version": 1, "camera": camera, "location": inner.location,
            "state": inner.state})
    }

    /// Writes the view document for the share sheet; answers its file URL.
    fn share(&self) -> Value {
        let label = lock(&self.inner).location.as_ref().map(|l| l.label.clone()).unwrap_or_default();
        let name: String = label
            .chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let name = if name.is_empty() { "Clear Skies view".to_owned() } else { name.chars().take(60).collect() };
        let dir = std::env::temp_dir().join("share");
        let path = dir.join(format!("{name}.clearskies"));
        let written = std::fs::create_dir_all(&dir)
            .and_then(|_| std::fs::write(&path, serde_json::to_vec_pretty(&self.document()).unwrap_or_default()));
        match written {
            Ok(()) => json!({"url": format!("file://{}", path.display())}),
            Err(error) => json!({"error": format!("The view could not be saved: {error}")}),
        }
    }

    /// Opens a `.clearskies` document: its choices, place and camera.
    fn open_document(&self, text: &str) -> bool {
        let Ok(doc) = serde_json::from_str::<Value>(text) else { return false };
        if doc["type"] != DOCUMENT_TYPE || doc["version"].as_u64().is_none_or(|v| v > 1) {
            return false;
        }
        let Ok(state) = serde_json::from_value::<AppState>(doc["state"].clone()) else { return false };
        let location = serde_json::from_value::<Option<shell::Location>>(doc["location"].clone()).ok().flatten();
        let mut inner = lock(&self.inner);
        inner.state = state;
        inner.fitted = Fitted::default();
        inner.location = location;
        inner.location_version += 1;
        self.save(&inner);
        let camera = &doc["camera"];
        if let Some(map) = lock(&self.map).as_ref() {
            map.set_sources(&sources(&inner.state.terrain.source));
            map.set_markers(markers(inner.location.as_ref()));
            if let (Some(lon), Some(lat), Some(zoom)) =
                (camera["lon"].as_f64(), camera["lat"].as_f64(), camera["zoom"].as_f64())
            {
                let bearing = camera["bearing"].as_f64().unwrap_or(0.0);
                map.camera(|c| c.ease_next(Pose::from_lon_lat(lon, lat, zoom, bearing), 0.8));
            }
        }
        self.redraw(&inner);
        let mut update = self.whole(&inner);
        if let Some(page) = inner.view.page.as_deref().and_then(|p| shell::page(p, &inner.state, &inner.fitted)) {
            update.insert("page".into(), page);
        }
        drop(inner);
        self.send_update(update);
        true
    }

    /// Fits a place in view (its extent up to z13, else z12), as the web's
    /// place pick does.
    fn show_place(&self, place: &csk_engine::places::Place) {
        let zoom = match (place.extent, lock(&self.map).as_ref()) {
            (Some([west, north, east, south]), Some(map)) => {
                let css = map.read_camera(|c| c.view().css);
                let merc = |lng: f64, lat: f64| Pose::from_lon_lat(lng, lat, 0.0, 0.0).center;
                let (a, b) = (merc(west, north), merc(east, south));
                let (dx, dy) = ((b[0] - a[0]).abs().max(1e-12), (b[1] - a[1]).abs().max(1e-12));
                let fit = (css[0] / (dx * 256.0)).min(css[1] / (dy * 256.0)).log2();
                fit.min(13.0)
            }
            _ => 12.0,
        };
        self.go_to(place.lat, place.lng, Some(zoom), 0.0);
    }

    /// Looks text up: coordinates go straight there (zoom at least 10), a
    /// place name is geocoded (zoom 11).
    async fn search_text(self: Arc<Self>, text: String) {
        match crate::coords::parse(&text) {
            Ok(Some((lat, lng))) => {
                self.select(Some(shell::Location { lat, lng, label: text.clone() }));
                self.go_to(lat, lng, None, 10.0);
            }
            Ok(None) => {
                if let Ok(found) = self.engine.places(&text, 1).await
                    && let Some(place) = found.first()
                {
                    self.select(Some(shell::Location { lat: place.lat, lng: place.lng, label: text.clone() }));
                    self.go_to(place.lat, place.lng, Some(11.0), 0.0);
                }
            }
            Err(_) => {}
        }
    }

    /// A shell query; answers JSON in the page's shapes. Queries that need
    /// the network (place suggestions) resolve on the engine's runtime.
    pub async fn ask(self: Arc<Self>, query: String, args: Value) -> Value {
        let text = args["text"].as_str().unwrap_or_default().trim().to_owned();
        match query.as_str() {
            "routeMatches" => route_matches(&text),
            "suggest" => {
                if text.chars().count() < 3 || !matches!(crate::coords::parse(&text), Ok(None)) {
                    return json!([]);
                }
                let Ok(places) = self.engine.places(&text, 6).await else {
                    return json!({"error": "Place search is unavailable."});
                };
                let mut s = lock(&self.suggestions);
                s.version += 1;
                s.places = places;
                let version = s.version;
                Value::Array(
                    s.places
                        .iter()
                        .enumerate()
                        .map(|(index, p)| {
                            json!({"index": index, "version": version, "primary": p.primary,
                                "secondary": p.secondary, "kind": p.kind})
                        })
                        .collect(),
                )
            }
            "submit" => {
                if let Some(route) = route_for_text(&text) {
                    return json!({"route": route});
                }
                let me = self.clone();
                tokio::spawn(me.search_text(text));
                json!({})
            }
            "enterValue" => json!({"accepted": false, "message": "This size is no longer available."}),
            "selectMark" => json!({"selected": false}),
            "shareURL" => self.share(),
            "bestImagery" => json!({"message": "", "applied": false}),
            _ => Value::Null,
        }
    }

    /// Commands that take time (geocoding) run here, off the caller.
    pub fn send_async(self: &Arc<Self>, runtime: &tokio::runtime::Handle, command: &str, args: &Value) -> bool {
        match command {
            "searchText" => {
                let text = args["text"].as_str().unwrap_or_default().trim().to_owned();
                if !text.is_empty() {
                    runtime.spawn(self.clone().search_text(text));
                }
                true
            }
            _ => false,
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
        if let Some(rest) = r.strip_prefix("layer:") {
            return act_layer(&mut inner.state, rest, value);
        }
        // An overlay's switch and, once on, its opacity. Overlays with no
        // native layer cannot be turned on.
        if let Some(id) = r.strip_prefix("#ov_") {
            if crate::overlays::find(id).is_none_or(|o| o.raster.is_none()) {
                return false;
            }
            let on = value.as_bool().unwrap_or(!inner.state.overlay(id).on);
            inner.state.set_overlay(id, on);
            return true;
        }
        if let Some(id) = r.strip_prefix("#ovOpacity_") {
            let Some(v) = v else { return false };
            if crate::overlays::find(id).is_none_or(|o| o.raster.is_none()) {
                return false;
            }
            let mut overlay = inner.state.overlay(id);
            overlay.opacity = v.clamp(0.0, 100.0);
            inner.state.overlays.insert(id.to_owned(), overlay);
            return true;
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

    /// Re-stretches auto layers to the settled view (lidar-studio.js
    /// fitFromView): elevation ranges hold through small inward changes,
    /// other ranges refit past 4% of their span.
    fn sampled(&self, sample: ViewSample) {
        let mut inner = lock(&self.inner);
        let centre = sample.heights[(sample.height / 2 * sample.width + sample.width / 2) as usize];
        inner.fitted.center = centre.is_finite().then_some(f64::from(centre));
        inner.settled = true;
        // Drawn samples only, with their floors and water class.
        let (mut heights, mut relative, mut land_relative, mut water) = (vec![], vec![], vec![], vec![]);
        for i in 0..sample.heights.len() {
            let h = f64::from(sample.heights[i]);
            if !h.is_finite() {
                continue;
            }
            let above = |floor: f32| if floor.is_finite() { (h - f64::from(floor)).max(0.0) } else { f64::NAN };
            heights.push(h);
            relative.push(above(sample.base[i]));
            land_relative.push(above(sample.land_base[i]));
            water.push(sample.water[i]);
        }
        let floors = (inner.fitted.rem_floor, inner.fitted.rem_land_floor);
        if let Some([low, _]) = fit_range(&heights, "tint", Some("robust")) {
            inner.fitted.rem_floor = Some(low);
        }
        let land: Vec<f64> = heights.iter().zip(&water).filter(|(_, w)| **w == 0).map(|(h, _)| *h).collect();
        inner.fitted.rem_land_floor = fit_range(&land, "tint", Some("robust")).map(|[low, _]| low);
        let t = &inner.state.terrain;
        let mut layers = vec![("base".to_string(), t.studio.base_layer(&t.style))];
        layers.extend(t.studio.overlays.iter().enumerate().map(|(i, l)| (format!("overlay:{i}"), l.clone())));
        layers.retain(|(_, l)| l.visible && l.auto);
        let mut changed = layers.iter().any(|(_, l)| l.style == "rem")
            && floors != (inner.fitted.rem_floor, inner.fitted.rem_land_floor);
        let land_floor = inner.fitted.rem_land_floor;
        for (key, layer) in layers {
            let rem = layer.style == "rem";
            let separate = layer.range_mode == "separate";
            let source: Vec<f64> = match (rem, separate) {
                (false, _) => heights.clone(),
                (true, false) => relative.clone(),
                (true, true) => land_relative
                    .iter()
                    .zip(&heights)
                    .map(
                        |(v, h)| {
                            if v.is_finite() { *v } else { land_floor.map_or(f64::NAN, |floor| (h - floor).max(0.0)) }
                        },
                    )
                    .collect(),
            };
            if source.len() < 16 {
                continue;
            }
            let previous = inner.fitted.ranges.get(&key);
            let elevation = layer.style == "tint" || (rem && separate);
            let fit = if rem {
                fit_relative(&source, &heights, &water, &layer.range_mode)
            } else if layer.style == "tint" {
                fit_elevation(&source, &water, &layer.range_mode)
            } else {
                fit_range(&source, &layer.style, None).map(Fit::Range)
            };
            let Some(next) = fit.map(|fit| if elevation { stable_fit(fit, previous) } else { fit }) else { continue };
            let accept = match (previous, next.display()) {
                (None, _) => true,
                (Some(previous), _) if elevation => *previous != next,
                (Some(previous), Some(range)) => previous.display().is_none_or(|old| {
                    let span = (range[1] - range[0]).max(1e-6);
                    (old[0] - range[0]).abs() > span * 0.04 || (old[1] - range[1]).abs() > span * 0.04
                }),
                (Some(_), None) => false,
            };
            if accept {
                inner.fitted.ranges.insert(key, next);
                changed = true;
            }
        }
        if changed {
            self.redraw(&inner);
        }
        let update = self.changed(&inner);
        drop(inner);
        self.send_update(update);
    }
}

/// Words that open a page from the search field (ui-system.js SEARCH_ROUTES).
const SEARCH_ROUTES: &[(&str, &str)] = &[
    ("layers", "layers"),
    ("active layers", "layers"),
    ("satellite", "satellite"),
    ("satellite imagery", "satellite"),
    ("imagery", "satellite"),
    ("scenes", "satellite"),
    ("filters", "satellite"),
    ("terrain", "terrain"),
    ("lidar", "terrain"),
    ("terrain lidar", "terrain"),
    ("hillshade", "terrain"),
    ("wa dnr", "terrain"),
    ("dnr", "terrain"),
    ("point cloud", "terrain"),
    ("elevation", "elevation"),
    ("elevation spectrum", "elevation"),
    ("spectrum", "elevation"),
    ("elevation highlights", "elevation"),
    ("elevation bands", "elevation"),
    ("analyze", "analyze"),
    ("analysis", "analyze"),
    ("research", "analyze"),
    ("export", "export"),
    ("snapshot", "export"),
    ("download", "export"),
    ("conditions", "conditions"),
    ("weather", "conditions"),
    ("earthquakes", "conditions"),
    ("fire", "conditions"),
    ("snow", "conditions"),
    ("geology", "geology"),
    ("hazards", "geology"),
    ("faults", "geology"),
    ("landslides", "geology"),
    ("past landscapes", "past"),
    ("glaciers", "past"),
    ("ice age", "past"),
    ("archaeology", "past"),
    ("labels", "labels"),
    ("reference", "labels"),
    ("roads", "labels"),
    ("boundaries", "labels"),
    ("markup", "markup"),
    ("annotate", "markup"),
    ("annotations", "markup"),
    ("draw", "markup"),
    ("drawing", "markup"),
    ("notes", "markup"),
    ("settings", "settings"),
    ("preferences", "settings"),
    ("terrain engine", "settings"),
    ("server", "settings"),
    ("appearance", "appearance"),
    ("theme", "appearance"),
    ("accent", "appearance"),
    ("accent color", "appearance"),
    ("color", "appearance"),
    ("font", "appearance"),
];

fn normalize(text: &str) -> String {
    text.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn route_for_text(text: &str) -> Option<&'static str> {
    let query = normalize(text);
    SEARCH_ROUTES.iter().find(|(k, _)| *k == query).map(|(_, r)| *r)
}

/// Pages whose keywords start with (or, from three letters, contain) the text.
fn route_matches(text: &str) -> Value {
    let query = normalize(text);
    if query.chars().count() < 2 {
        return json!([]);
    }
    let mut found: Vec<(&str, &str)> = Vec::new();
    for (keyword, route) in SEARCH_ROUTES {
        let hit = keyword.starts_with(&query) || (query.chars().count() >= 3 && keyword.contains(&query));
        if hit && !found.iter().any(|(r, _)| r == route) {
            found.push((route, keyword));
        }
    }
    Value::Array(found.into_iter().map(|(route, keyword)| json!({"route": route, "keyword": keyword})).collect())
}

/// A layer list control: `<id>:<toggle|opacity|up|down|reset>`.
fn act_layer(state: &mut AppState, rest: &str, value: &Value) -> bool {
    let Some((id, what)) = rest.rsplit_once(':') else { return false };
    if !state.layer_order.iter().any(|l| l == id) {
        return false;
    }
    if let Some(o) = id.strip_prefix("overlay:")
        && crate::overlays::find(o).is_none_or(|o| o.raster.is_none())
    {
        return false;
    }
    let v = number(value);
    match (id, what) {
        (overlay, "toggle") if overlay.starts_with("overlay:") => {
            let o = &overlay["overlay:".len()..];
            let on = value.as_bool().unwrap_or(!state.overlay(o).on);
            state.set_overlay(o, on);
        }
        (overlay, "opacity") if overlay.starts_with("overlay:") => {
            let o = &overlay["overlay:".len()..];
            let mut s = state.overlay(o);
            s.opacity = v.unwrap_or(s.opacity).clamp(0.0, 100.0);
            state.overlays.insert(o.to_owned(), s);
        }
        (overlay, "reset") if overlay.starts_with("overlay:") => {
            let o = &overlay["overlay:".len()..];
            let mut s = state.overlay(o);
            s.opacity = AppState::default_opacity(o);
            state.overlays.insert(o.to_owned(), s);
        }
        ("terrain", "toggle") => {
            let on = value.as_bool().unwrap_or(state.terrain.style == "off");
            let t = &mut state.terrain;
            if on && t.style == "off" {
                // Back to the applied look, or the launch look.
                let look = t.studio.look.clone().unwrap_or_else(|| crate::state::LAUNCH_LOOK.into());
                if !t.apply_look(&look) {
                    t.apply_look(crate::state::LAUNCH_LOOK);
                }
            } else if !on {
                t.style = "off".into();
            }
        }
        ("terrain", "opacity") => state.terrain.opacity = v.unwrap_or(state.terrain.opacity).clamp(0.0, 100.0),
        ("terrain", "reset") => {
            let look = state.terrain.studio.look.clone().and_then(|id| catalog().look(&id).cloned());
            state.terrain.opacity = look.map_or(100.0, |l| l.opacity);
        }
        (_, "up" | "down") => {
            let order = &mut state.layer_order;
            let i = order.iter().position(|l| l == id).expect("listed");
            let j = if what == "up" { i.checked_sub(1) } else { Some(i + 1).filter(|j| *j < order.len()) };
            let Some(j) = j else { return false };
            order.swap(i, j);
        }
        _ => return false,
    }
    true
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
