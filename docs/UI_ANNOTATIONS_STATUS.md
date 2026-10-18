# UI annotation implementation status

Current delivery: clarified annotations #2 and #3 implemented in `ui-system.js`. Earlier recovery evidence and inventory below are retained as historical context. Remaining annotations are outside this narrowed task.

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

## Resumed narrowed deliverable

Riley clarified #2 and #3; implement only these in `ui-system.js` and this document.

- [x] Record narrowed scope before exploration.
- [x] Merge `origin/main` (expected `56e18e0`) into isolated branch, preserving inventory.
- [x] #2: Move full source metadata from compact toolbar layer cards into a footer listing active layer names and metadata at the bottom of the toolbar Layers pop-out. Keep ordinary sidebar metadata.
- [x] #3: Use native `.csp-layer-title` buttons to open matching existing settings/edit route and close pop-out; preserve independent slider, toggle and drag behavior. Keep pinned basemap informational where no meaningful route exists.
- [x] Verify JavaScript syntax and browser behavior on port 8820 with temporary cache.
- [x] Prepare implementation commit and report behavior, SHA and limitations.

Root owns CSS (including new classes), #1 and #7. Do not edit CSS, tests, build stamps, index.html, GPU files, parent checkout or deployed service. Other annotations remain unresolved and out of scope. Footer classes: `.csp-layer-sources`, `.csp-layer-source`, `.csp-layer-source-name`, `.csp-layer-source-meta`.


## Narrowed implementation result

- Merged `origin/main` at `56e18e0` via merge commit `d8e653c`; inventory document preserved. Upstream GPU/index/build changes came from that requested merge, not this implementation.
- #2: Toolbar source descriptions now appear in a final `.csp-layer-sources` footer, with each active displayed row's name and full existing metadata. The existing inline metadata nodes remain hidden so the native terrain renderer can keep updating them; a scoped observer copies changed text without replacing sliders. Sidebar metadata remains inline.
- #3: Toolbar titles are native buttons using `.csp-layer-title` and `routeForLayer`. They close the pop-out using its existing close control, reveal a collapsed sidebar, open the matching existing edit route, and focus the destination heading. Sidebar card titles also use native edit buttons. The basemap stays informational because it has no settings route.
- Actual toolbar rows originate in `index.html`'s `renderTerrainSourcePanel`, separately from `buildLayerCard`; enhancement lives entirely in `ui-system.js` to respect file ownership. No original renderer code was edited.
- Root notified of both title selector variants: `button.terrain-source-panel-name.csp-layer-title` for toolbar and `button.csp-layer-name.csp-layer-title` for sidebar.

### Verification

- `node --check ui-system.js`, `node scripts/check-static.js`, `node test-menu-controls.js`, `node test-coordinate-search.js`, and `git diff --check` passed.
- Fresh server on `127.0.0.1:8820`, cache `/tmp/csp-ui-annotations-cache.MzvdGd`; stopped after verification. Ports 8765/8816 untouched.
- T3 preview at 1280 × 800: verified hidden inline toolbar metadata, footer as last child with all four displayed names/full source strings, and retained sidebar metadata.
- Real keyboard Enter and Space activated title navigation to Conditions and closed the pop-out. Space also reopened a collapsed sidebar; focus landed on `#cspWorkspaceTitle`.
- Real keyboard ArrowLeft on toolbar opacity changed 90% to 89%, kept the pop-out open and left the current route unchanged.
- Browser-only temporary metadata mutation propagated its full text into the footer while preserving the exact slider DOM node. No fixture or test files were changed.
- Visual screenshot inspected: `/Users/riley/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvddyfhs-6e53b40c.png`.

### Limitations and integration

Root owns final title/footer CSS; screenshot shows browser-default button borders and unstyled footer text until that CSS is integrated. Existing pop-out scrolling still applies to the longer content. No CSS, tests, index.html, build stamps, GPU files, deployed service or parent checkout were edited by this implementation. No deployment or merge into parent was performed. Other annotations remain unimplemented here by explicit scope. Changed implementation files: `ui-system.js` and this document only.

## Root integration result

- #1: Desktop map info and layer keys now share a pale, padded background with dark text; it stays readable over light/dark imagery and remains hidden on mobile.
- #2: Toolbar per-layer source text appears in the final Sources footer. Existing summary/provenance and attribution remain available.
- #3: Both toolbar and sidebar layer names open their existing settings destinations. Titles have plain text styling, hover underline and visible keyboard focus. Slider/toggle handling remains separate.
- #7: Sidebar selected/hover rows use flat fills; raised rims and hover label/icon scaling were removed.
- Parent checked computed styles in light/dark themes, inspected desktop screenshots, confirmed title navigation closes the pop-out, and checked mobile width/readout visibility.
- Relevant map readout, glass motion, menu controls, coordinate search, syntax and static checks pass. No new tests were added for these reversible UI changes.
- Remaining annotations: #4–6 have uncertain targets; #8–18 await further user descriptions.
