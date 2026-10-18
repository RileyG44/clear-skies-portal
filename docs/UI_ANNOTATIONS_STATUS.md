# UI annotation implementation status

Implementation is blocked on missing annotation context. No application code was changed. Parent confirmed the same missing tools and requested a read-only inventory, with implementation to resume when Riley resends details.

## Checklist

- [x] Create status checklist before inspection.
- [x] Review supplied global instructions and repository README; no additional applicable AGENTS.md found.
- [x] Confirm isolated branch `t3/implement-preview-ui-annotations`, starting commit `898973f`.
- [x] Investigate supported T3 tools, resources, and parent thread history.
- [ ] Recover all 18 full annotation texts, targets, and screenshots.
- [ ] Implement recovered UI annotations within authorized files.
- [x] Run fresh development server on port 8820 with temporary cache.
- [x] Inspect baseline visually and run relevant baseline checks.
- [ ] Verify implemented changes visually (no implementation yet).
- [x] Prepare status artifact for commit and parent integration.

## Recovery evidence

- T3 tool catalog exposes preview tools and thread history, but no annotation/context reader.
- `list_mcp_resources` returned `resources: []`; `list_mcp_resource_templates` returned `resourceTemplates: []`.
- `read_mcp_resource` on server `t3-code` with URI `t3-context://v1/preview-annotation/preview-annotation_annotation_2` failed: `Resource 't3-context://v1/preview-annotation/preview-annotation_annotation_2' not found`.
- Parent thread `b9f13760-ea28-4094-b5ee-0b4606d11a19` was read through position 833. Annotation messages at positions 775 and 825 contain only the truncated link labels below; no target metadata or screenshots.
- Parent was notified through `t3_thread_send`, request ID `ui-annotation-recovery-needed-v1`. Parent subsequently confirmed Riley has been asked to resend the details and instructed this leaf not to infer implementation from truncated notes.

## Missing annotation content

Every row needs the full text, named target/control or selector, and original screenshot or highlighted target. For relocation requests, the destination must also be identifiable. Labels below are transcribed references, not sufficient implementation specifications.

| Annotation | Available label | State |
| --- | --- | --- |
| annotation_2 | Can we put a light background behind this or so… | Unresolved |
| annotation_e | move all of these to the bottom of this pop out… | Unresolved |
| annotation_g | Make these layer titles selectable, where click… | Unresolved |
| annotation_i | Get ride of this. | Unresolved |
| annotation_k | Include this with the info were putting at the … | Unresolved |
| annotation_m | The icons are too wide here causing the whole s… | Unresolved |
| annotation_o | These 3D buttons are too busy. Can we make them… | Unresolved |
| annotation_q | Let's actually get rid of this mode selection p… | Unresolved |
| annotation_s | Lets change out the drop down menu here for sel… | Unresolved |
| annotation_v | We need a second button here below select area … | Unresolved |
| annotation_x | Get rid of this explainer text. | Unresolved |
| annotation_z | Add a way to clear the current selection and an… | Unresolved |
| annotation_11 | Same thing here re a way to clear the entry and… | Unresolved |
| annotation_13 | Move copy coordinates to the top of this list, … | Unresolved |
| annotation_15 | Move this and ALL base layer related menu items… | Unresolved |
| annotation_17 | turn these into on/off style graphical buttons … | Unresolved |
| annotation_19 | This doesn't need to be here/doesnt belong here… | Unresolved |
| annotation_1b | This looks Terrible. Lets swap it our for a tog… | Unresolved |

Each full reference ID is `preview-annotation_<annotation ID>` and its URI is `t3-context://v1/preview-annotation/<full reference ID>`.

## Read-only UI inventory for resumption

These are verified current code locations, not mappings inferred from the missing annotations.

| UI area | Code location | Current structure |
| --- | --- | --- |
| Route names, descriptions, grouping | `ui-system.js:34` | `ROUTES` defines Layers, Satellite imagery, LiDAR, Elevation, Analyze, Export, layer groups, Appearance and Settings. |
| Active layer rows | `ui-system.js:374` | Card builder creates a non-button `.csp-layer-name`, metadata, opacity slider, visibility switch and reorder/edit/reset rail. |
| Layers route | `ui-system.js:456` | Renders active layer cards and links to layer categories. Reference basemap is pinned. |
| Layer styling | `ui-system.css:474`, `ui-system.css:777`, `ui-system.css:1164` | Base, responsive, and glass-theme styles each affect card structure or typography. |
| Export route | `ui-system.js:589` | Custom export UI is generated separately from original HTML panes. |
| Settings route | `ui-system.js:796` | Custom settings rendering. |
| Map mode popover | `ui-system.js:1027` | Generates `#mapModeMenu`; styling begins at `ui-system.css:1353`. |
| Original LiDAR mode controls | `index.html:1245` | `#terView` holds 2D map, 3D terrain, Point cloud and a mode note; existing handlers reference these elements. |
| Terrain style/source selectors | `index.html:1255` | `#terStyle` and `#terSrc` are native selects inside LiDAR terrain section. |
| DNR UI | `index.html:1284` | `#dnrAreaPanel` contains Select area on map, hint/status and Clear areas. Existing menu test asserts the button count. Acquisition implementation remains out of scope. |
| Coordinate actions | `index.html:5112` | Copy/open button state and Maps/Earth links share `coordinateForActions()`. |
| Map context menu | `index.html:5146` | Builds scene choices and search, copy coordinates, geology, research, and fill actions. |

## Baseline verification

- Started `HOST=127.0.0.1 PORT=8820 CSP_CACHE_DIR=/tmp/csp-ui-annotations-cache.ChTW98 node server.js` in this worktree. Stopped this process after inspection.
- Product-native T3 preview opened `http://127.0.0.1:8820/` in tab `tab_7_8709b086-7eaa-433b-a152-18646d6d5000`, at 1280 × 800.
- Inspected the rendered Layers route screenshot: navigation at left, active layer cards with vertical tool rails, metadata, opacity sliders, visibility switches, pinned reference basemap, and right-side map tools.
- Baseline screenshot (local, not an original annotation screenshot): `/Users/riley/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvdbkm64-a628b2d3.png`.
- Passed: `node test-menu-controls.js`, `node test-coordinate-search.js`, `node test-map-readout.js`, `node scripts/check-static.js`.
- Browser reported an existing terrain GPU aspect self-test mismatch and CPU fallback on committed baseline. No GPU files or integration functions were changed; parent owns that work.

## Delivery and boundaries

Implemented annotations: none. Unresolved annotations: all 18 listed above. Changed files: only this status artifact.

UI work only when resumed. Do not edit GPU terrain files, GPU integration functions/tests, or DNR acquisition/server implementation. Do not deploy, merge into parent, or overwrite its checkout. Ports 8765 and 8816 were left untouched. No agents were spawned or delegated.
