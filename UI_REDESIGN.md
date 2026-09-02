# Clear Skies interface system

Build: `2026-09-02b`

This document is the implementation handoff for the task-oriented sidebar introduced in the September 2026 redesign. It explains the information architecture, visual rules, integration points, persistence, and QA contract so a future Claude or Codex session can continue without rediscovering the design.

## Product model

The interface separates two questions that the old sidebar mixed together:

1. **What is on the map?** — **Layers** is the active render stack. It is the only cross-category view and owns visibility, opacity, ordering, editing, and per-layer reset.
2. **What can I add or configure?** — each catalog destination owns one coherent subject and never displays another subject's layers.

The global task navigation is:

- Layers
- Satellite imagery
- Terrain & LiDAR
- Analyze
- Export

The layer catalog is:

- Conditions
- Geology & hazards
- Past landscapes
- Labels & reference

There is deliberately no top-level **Filters** destination. Satellite date, cloud, type, ordering, fire, and mosaic filters live inside **Satellite imagery**, beside the results they affect. Elevation color and threshold tools live in **Terrain & LiDAR**. Surface analysis lives in **Analyze**. Point identification lives in **Geology & hazards**.

## Visual authority and useful code precedents

The supplied `9AAA29A5-F25F-4703-8736-D43422E28041.PNG` is the visual authority: system typography, neutral surfaces, selected rows rather than bright pills, restrained cards, hairline rules, and hierarchy through weight and color. `clearskiesui.jpg` is the application-specific composition reference.

The implementation was informed by:

- [Apple HIG: Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) for broad, shallow navigation and adaptive collapse.
- [Apple HIG: Settings](https://developer.apple.com/design/human-interface-guidelines/settings) for placing frequently adjusted controls beside the task they affect.
- [Apple HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography) and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) for the system font stack, restrained weights, safe areas, and adaptive layout.
- [shadcn/ui Sidebar](https://ui.shadcn.com/docs/components/sidebar) for the composed header, scroll region, footer, desktop rail, and single mobile sheet model.
- [React Aria](https://github.com/adobe/react-spectrum) for keyboard/focus expectations on switches, sliders, and disclosures.
- [QGIS layer tools](https://docs.qgis.org/4.2/en/docs/user_manual/introduction/general_tools.html), [Kepler.gl](https://github.com/keplergl/kepler.gl), [Maputnik](https://github.com/maplibre/maputnik), and [MapLibre GL Layer Control](https://github.com/opengeos/maplibre-gl-layer-control) for visibility, opacity, styling, and render order in one active-layer surface.

The portal does not migrate to React to obtain this look. Its existing data and map implementation remains authoritative; the interface is an enhancement layer over the stable DOM.

## Files and boundaries

- `index.html` remains the map/data implementation and owns all original control IDs and event handlers.
- `ui-system.js` moves the existing DOM into the navigation/detail shell, routes panes, builds the active-layer view, and proxies actions through `window.ClearSkiesPortalBridge`.
- `ui-system.css` owns the light interface tokens, desktop two-column shell, route isolation, active-layer cards, and mobile sheet behavior.
- `scripts/sync-vendor.js` copies only the Lucide SVGs used by the interface. The app does not load an icon runtime.
- `version.js` and `sw.js` share the build identifier. Every deployed UI change must bump both and the three `?build=` references in `index.html`.

Do not clone or replace the original controls. Moving them preserves the large existing event graph. New interface controls should proxy an existing control or be added to the bridge.

## Route isolation

There are two independent visibility states and they must not be combined:

- `.csp-route-hidden` means a pane/tool does not belong to the current destination.
- `[hidden]` on an opacity or line-width control means its layer is currently off.

Legacy functions such as `showPane()` may change inline `display` to reflect data availability. Route membership uses `.csp-route-hidden { display:none!important; }`, so asynchronous legacy code cannot reopen a foreign pane. Overlay rows receive a stable `data-csp-group` slug; route-specific CSS shows exactly one group. The map's active-state painter remains free to toggle `[hidden]` without leaking another group's controls.

Research tools receive `data-csp-research-group="terrain|analyze|geology"`. `filterResearch()` hides every direct child that does not match. A newly added research block therefore remains hidden until it is deliberately assigned.

When adding a destination or group:

1. Add the route to `ROUTES` in `ui-system.js`.
2. Add the group-to-slug mapping in `overlayGroupSlug()`.
3. Add the route selectors in the catalog isolation block in `ui-system.css`.
4. Add the display group to `visibleOverlayGroup()` in `index.html` so counts, loading messages, failures, and notes remain scoped.
5. Add a static check and exercise the route at desktop and phone widths.

## Active layer contract

`window.ClearSkiesPortalBridge` exposes:

- `activeLayers()`
- `setLayerVisible(id, visible)`
- `setLayerOpacity(id, percent)`
- `resetLayer(id)`
- `setLayerOrder(ids)`
- `overlayCatalog()`
- `refreshOverlayStatus()`

Layer IDs are stable UI identities (`scene`, `terrain`, `elevation-spectrum`, `elevation-bands`, `surface-analysis`, `active-fires`, `overlay:<registry id>`, and `basemap`). The reference basemap is locked at the bottom. Render order is stored in `clearskies.active-layer-order.v1`; per-overlay opacity/order remains in the overlay preferences owned by `index.html`.

A reset is intentionally local to one layer. It must never erase unrelated work.

## Responsive behavior

- Above 1050 px: approximately 294 px navigation + 426 px contextual workspace + flexible map.
- 761–1050 px: one sidebar screen at a time; selecting a destination replaces navigation with its detail view.
- 760 px and below: safe-area-aware floating sheet. Its width reserves 76 px for the sidebar toggle and a map margin. Map tool buttons and the map mode control hide while the sheet is open, then return when it closes.
- The map continues to use dynamic viewport height and safe-area insets from the core stylesheet; the redesign must not add a second viewport-height calculation.

The mobile sheet's **All tools** button returns to navigation. The sidebar toggle always remains reachable outside the sheet. Controls use `white-space` and mobile font adjustments where a fixed segmented row would otherwise wrap and change height.

Selecting a point on the map continues to write its coordinates into the search field. Once a point exists, the search area exposes **Copy coordinates**, **Google Maps**, and **Google Earth** as first-class research shortcuts. Do not bury or remove these actions; they are part of the core cross-reference workflow for street-level and quick external 3D inspection.

## Design tokens

- Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`
- Control/body: 12–13 px
- Metadata/section labels: 10.5–11 px
- Workspace title: 26 px desktop, 23 px phone
- Weights: regular, medium, semibold only
- Spacing rhythm: 4 / 8 / 12 / 16 / 24 px
- Navigation: `#f7f7f5`
- Workspace/cards: white
- Selected row: `#e9e9e7`
- Borders: `#e7e7e3`
- Card radius: 13 px

Avoid gradients, saturated chrome, decorative blur, excessive pills, and oversized headings. The map supplies the color.

## QA checklist

- Each catalog route shows exactly its own group.
- Terrain shows only elevation tools; Analyze shows only derived-analysis tools; Geology shows only point identification plus geology layers.
- Layers contains the complete active render stack and no inactive catalog entries.
- Visibility, opacity, ordering, edit, and reset work without navigating away unexpectedly.
- Satellite search and place search still work; exact tool names typed into search route to the matching destination.
- A map point populates the search field and enables Copy coordinates, Google Maps, and Google Earth.
- Desktop, tablet, and phone layouts keep the map usable; no map tool overlaps an open phone sheet.
- Keyboard focus is visible, switches/sliders retain their labels, and reorder buttons have accessible names.
- Console contains no new errors or warnings.
- `npm run verify` passes.

See `design-qa.md` for the latest visual comparison and test record.
