# Drumlin demo: the plan to a testable build

The goal: a Drumlin build Riley can run on an iPhone through TestFlight,
in which every page and dock tool either works natively or says plainly
that it is not in this build yet. Layers are the heart of it: they must be
accurate, fast, consistent and better than the web's, and fully native.

Read `ARCHITECTURE.md` and `PROGRESS.md` first. Standards that hold for
every step: do it the right way, never port inferior code for its own sake,
keep the web's semantics (names, defaults, ranges, persisted shapes) where
they are the product, test leanly, keep `cargo fmt`, `cargo clippy
--workspace --all-targets` and `cargo test` clean, and commit each step
with a clear message.

## Where things stand (6 Nov 2026)

Branch `native/drumlin` in the worktree `/Users/riley/Developer/csp-native-gpu`,
stacked on `native/previews` (#126) → `native/share` (#125) →
`native/search` (#124) → `main`. Merge order is #124, #125, #126, then
this branch; rebase each onto `main` after the previous squash-merge.

Done and verified in the simulator: native terrain with the looks, Detail
and relative-elevation fields; basemap and Rivers & lakes; all seven Labels
& reference overlays (Esri cached tiles and USGS dynamic exports) with
their page; place search, Locate, selection marker; `.clearskies`
documents; look previews. The Drumlin target (bundle `dev.riley.Drumlin`,
`NATIVE_ONLY`, no web layer, its own icon) builds and runs.

Riley has asked for the App Store Connect record for `dev.riley.Drumlin`
to be created on their side; `ios/scripts/testflight.sh --app Drumlin`
uploads once it exists. Never touch the ClearSkies target, scheme, bundle
ID or its script.

## Step A: a data-driven raster layer catalogue

Today `csk_engine::layers::RasterLayer` is a fixed enum of ten layers.
Replace it with a catalogue so Geology & hazards, Conditions and Past
landscapes raster layers ride the same native path as Labels & reference.

In `csk-engine/src/layers.rs`:

- `pub struct Spec { id: &'static str, source: Source, min_zoom: u8,
  max_zoom: u8, ttl: Duration }` and `pub enum Source { Tiles(&'static
  str) /* {z} {x} {y} template */, Export { endpoint: &'static str,
  layers: &'static str, dpi: bool }, Gibs(&'static str) /* product */ }`.
- `#[derive(Clone, Copy)] pub struct RasterLayer(&'static Spec)` with
  `PartialEq`, `Eq`, `Hash`, `Debug` by `id`; `RasterLayer::by_id(&str)`;
  `id()`, `min_zoom()`, `max_zoom()`, `pixels()` (512 for exports, else
  256), `url(z, x, y)`, `key(z, x, y)`.
- Keep the existing ids and keys so caches stay valid: `light`, `dark`
  (bases), `hydro` (Rivers & lakes), `roads`, `places`, `labels-light`,
  `labels-dark`, `trails`, `peaks`, `names`.
- Add, from `app/overlays.js` (the web's catalogue; read it, it has the
  URLs, layer numbers, zoom ranges and notes):
  - Geology & hazards: `geology` (Macrostrat tiles, max 16), `sgmc` (USGS
    WMTS tiles, max 14), `wageology` (WGS export, layer 11, 6..17),
    `wafaults` (WGS export, layer 12, 6..18), `wavents` (WGS export, layer
    0, 7..18), `usfaults` (USGS export, layers 21,22, 4..18), `landslide`
    (ArcGIS tiles, max 22), `plateboundaries` (USGS export, layers 0,1,
    1..12), `vs30` (USGS export, layer 0, 3..18).
  - Conditions: `snowdepth` and `swe` (NOHRSC export, `layers=show:3` /
    `7`, no `dpi` parameter, 512 px, max 14, TTL 6 h: NOAA refreshes four
    times a day), `snowcover` (NASA GIBS WMTS
    `MODIS_Terra_NDSI_Snow_Cover`, `GoogleMapsCompatible_Level8`, max 8,
    for yesterday's UTC date so the day is complete; put the day in the
    cache key).
- ArcGIS exports: bbox from the tile's EPSG:3857 bounds (west, south,
  east, north), `size=512,512&format=png32&transparent=true&f=image`,
  `dpi=192` when `dpi` is true, `layers=show:<layers>`. A 404 is an empty
  tile. Keep the existing kept-tile-after-failed-refresh behaviour and the
  per-layer flight dedup (`layer_flights`).
- A unit test that every id resolves, that URLs for one tile of each
  source kind are exactly right, and that the GIBS day rolls.

`csk-map/src/layers.rs` needs only the type change (it keys pools and
flights by `RasterLayer`).

In `csk-app/src/overlays.rs`, the presentation catalogue, in the web's
page order: `Info { id, name, via, color, group: Group, note: Option<&str>,
default_opacity: f64, raster: Option<&'static str> /* engine id, or the
themed pair */ }` for every overlay in `app/overlays.js` groups Labels &
reference, Geology & hazards, Conditions and Past landscapes. Vector-only
overlays (`geojson`, `geoLoader`, `geoData`: ice limits, flood extent,
Pleistocene lakes, Cordilleran ice, archaeology, weather alerts,
earthquakes, volcano status) have `raster: None` and show as a disabled
row with detail "Not in this build yet". `default_opacity` comes from the
web's `defaultOpacity` (90 when absent); `water` stays at 5 on a fresh
launch (`LAUNCH_WATER_OPACITY`). Hydro is muted (greyscale, brightened)
on the dark theme as today; labels pick `labels-light`/`labels-dark`.

In `csk-app/src/shell.rs`: one `overlay_page(route, group)` replaces
`labels_page`, used for `labels`, `geology`, `conditions` and `past`, with
the toggle, the opacity slider once on, and the "About these layers"
sources disclosure (name · via, plus the note). `layer_title` reports the
group name ("Geology & hazards · USGS") instead of the fixed "Labels &
reference". The Conditions page also carries one hint row: "Live weather,
earthquake and volcano alerts aren't in this build yet." The Past page
carries "Ice-age reconstructions aren't in this build yet" above its rows.

`draws()` in `app.rs` already walks `layer_order`; it just resolves
through the new catalogue. The `#ov_<id>` and `#ovOpacity_<id>` act
handlers are generic already.

Verify in the simulator with `-cspDebugAct "#ov_wafaults"` over
Washington and `-cspDebugAct "#ov_snowdepth"` (see "Checking a build").

## Step B: Elevation colors, natively

The GPU shade program already takes the spectrum and band uniforms
(`csk-app/src/render.rs` `Spectrum`, `Band`; `Appearance::apply`). What is
missing is state, the page and the actions. The web's logic is in
`app/spectrum.js` and the markup in `index.html` lines 674–810; match it.

State (`state.rs`), persisted with `AppState`:

```
Elevation { on: bool, level_m: f64 (default 1100 ft = 335.28 m, clamp
  -500..8850 m), span_m: f64 (default 300 ft, clamp 10..20000 ft),
  alpha: f64 (percent, default 48), colors: [String; 3] (default
  classic #f85c6c #fffffa #46a0ff), unit: "ft" | "m" (default ft),
  below: Band { on: false, level_m: 1000 ft, color: "#f85c6c" },
  above: Band { on: false, level_m: 1500 ft, color: "#46a0ff" },
  band_alpha: 52, feather_m: 40 ft (0..10000 ft), outline: false }
```

Page `elevation` (refs are the web's ids so the shell's parity recordings
line up):

- Group "Color by elevation", detail "Off" or "1,100 ft ± 300 ft · Red /
  white / blue · 48%", with a toggle `#elevSh`; inside: a slider
  `#elevSlide` "Reference elevation" (metres, -500..8850, display in the
  page unit), a slider `#elevSpanSlide` "Color span" on the web's
  logarithmic position 0..1000 (`elevSpanPosition` /
  `elevSpanFromPosition`, snapping to 50/150/300/600/1200/2500 ft), a
  picker `#elevPalette` with the six palettes plus Custom (selected when
  the colours match none), three colour rows `#elevLowColor`,
  `#elevMidColor`, `#elevHighColor`, a button `#elevPaletteReverse`
  "Reverse colors", a slider `#elevAlpha` "Opacity", and the buttons
  `#elevPaletteReset` "Reset colors" and `#elevSpectrumReset` "Reset
  coloring" (restores reference, span, colours and opacity, and switches
  off).
- Group "Highlight elevations", detail "Below 1,000 ft · Above 1,500 ft"
  or "Off": toggles `#elevBelowOn`/`#elevAboveOn`, colours
  `#elevBelowColor`/`#elevAboveColor`, number fields
  `#elevBelowVal`/`#elevAboveVal` (step 10 in the page unit), then
  "Edges & opacity": slider `#elevBandAlpha`, number `#elevBandFeather`
  "Soft edge" with the hint "Blends the highlight in over this height
  instead of a hard cut. 0 gives a sharp edge.", toggle
  `#elevBandOutline`, and `#elevBandsReset` "Reset highlights".
- Group "Units": picker `#elevUnit` feet / metres, "Heights shown in".

Actions clamp as the web does; heights are held in metres so a unit switch
never changes the physical height. `appearance()` in `app.rs` feeds
`Spectrum` from this state (`spectrum_opacity` 1.0; outline width 8 ft).
The layer list shows "Elevation highlights" as the web's
`elevation-bands` layer when a band is on (title "Elevation highlights",
detail "USGS 3DEP elevation"). The search keywords "elevation", "bands"
and "highlight" already route to the page.

## Step C: App appearance, natively

The web's logic is in `ui-system.js` lines 844–1020 (`CONTROL_ACCENTS`,
`LOCATION_DOT_SWATCHES`, `TRACK_SWATCHES`, `FONTS`, `THEME_PRESETS`,
`loadAppearance`, `applyAppearance`). The shell already consumes
`appearance: {toggle, track, button, font, fontColor, textSize}`
(`NativeAppearance` in `ios/Sources/Shell/ShellTypes.swift`); add
`locationDot` there too and use it for the selection marker
(`markers()` in `app.rs`, which today hard-codes white).

State, persisted: `Appearance { toggle, track, button, font_color,
location_dot: Option<String> (lower-case #rrggbb), font: "system" |
"inter" | "serif" | "mono", text_size: 0.92 | 1 | 1.12 }`; `preset` is
derived exactly as the web's `appearancePreset`: no colours → meadow, an
exact preset match → that preset, else custom. The page mirrors the
fixture in `ios/Tests/Fixtures/shell/web-fresh-launch.json` (`pages.
appearance`): Theme presets (segmented, Meadow/Ocean/Sunset/Berry/
Graphite), Controls (swatches "Toggle & slider color" with a custom
colour, segmented "Slider track color" Auto/Light grey/Grey/Charcoal/
Black/White, swatches "Button color" with custom), Text (font picker,
"Text color" Auto button + colour, "Text size" Small/Default/Large),
Selected location (swatches "Location dot color" with custom), and a
"Reset appearance" button. Use the fixture's exact titles and details.
Publish `appearance` in every update that changes it.

## Step D: App settings, the other pages, and the dock

Settings page, honest and native:

- "Terrain engine": text row "Secure terrain engine · built into this
  app". No "Manage terrain engine" (there is no remote engine in Drumlin).
- "Image export": route row to `export` once Step E exists; until then
  omit it.
- "Accessibility": nothing yet. Do not show "Smoother panning" (the
  native map draws at full resolution always) or "Reduce motion" (the
  system setting is honoured; an app-level toggle would need shell
  plumbing: do it only if cheap, by adding `reduceMotion` to the
  appearance JSON and the `NativeAppearance` struct and reading it where
  `accessibilityReduceMotion` is read).
- "This device": "Build details" with the app version and build (have
  Swift send a `build` command at start with `CFBundleShortVersionString`
  and `CFBundleVersion`; the Rust side keeps the label), and the engine's
  crate version. "Reset app preferences" (appearance, dock order, layer
  order, pane states; map content stays). "Reset menu layout".
- "About the map": the sources disclosure with the basemap and layer
  attributions of what is on.

Pages not in this build (`satellite`, `analyze`, `markup`, `export`
until Step E): the page carries one text row, style "hint": "<Title>
isn't in this build yet." plus a line on what it will hold, taken from
the route description. No empty sheets anywhere.

Dock: `quickDraw` opens the markup bar in the web; natively show a panel
with the same hint row. `snapshot` likewise until Step E. The
`terrainSourceToggle` panel ("Layers") lists the active layers with
opacity sliders from the same rows as the layers page. `serverToggle`
shows "Terrain engine built into this app" and the store's size. The
imagery button stays hidden.

## Step E (if time allows): native snapshot

`csk_gpu::Terrain::render_offscreen_layers` renders a view at any size.
Add `Scene::snapshot(scale) -> Result<Vec<u8>>` (PNG, premultiplied
undone) in `csk-map`, a `snapshot` command in `csk-app` that writes
`tmp/snapshot/<name>.png` and publishes its path, and have the Swift
backend save it to Photos (`PHPhotoLibrary`, add
`NSPhotoLibraryAddUsageDescription` to the Drumlin target). The export
page then has Resolution (1×..4× on a phone), "Include map info" (omit
until the readout exists) and "Capture view". "Select area" is a later
step.

## Step F: ship

1. Update `PROGRESS.md`.
2. Open a PR for `native/drumlin` stacked on #126; link it.
3. Merge #124 → #125 → #126 → this, rebasing each after the previous
   squash-merge, CI green each time.
4. `ios/scripts/testflight.sh --app Drumlin` once Riley confirms the App
   Store Connect record exists. Do not upload ClearSkies.

## Checking a build

```
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
cd ios && xcodegen generate --quiet
xcodebuild -project ClearSkies.xcodeproj -scheme Drumlin -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/dd-drumlin build
dev=$(xcrun simctl list devices booted -j | python3 -c "import json,sys;d=json.load(sys.stdin);print([x['udid'] for v in d['devices'].values() for x in v][0])")
xcrun simctl install $dev /tmp/dd-drumlin/Build/Products/Debug-iphonesimulator/Drumlin.app
xcrun simctl launch $dev dev.riley.Drumlin -cspDebugAct "open:elevation"   # or "#ov_roads", "look:missoula"
sleep 10; xcrun simctl io $dev screenshot /tmp/shot.png
```

`-cspDebugAct <ref>` runs one shell action at launch; `-cspDebugSearch
"<text>"` submits a search. The simulator takes no touches from
automation, so gestures are checked on a phone. `cargo` and `gh` need
`~/.cargo/bin` and `/opt/homebrew/bin` on `PATH`.
