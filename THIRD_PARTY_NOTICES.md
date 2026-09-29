# Third-party browser renderers

Clear Skies Portal vendors browser-ready distribution files during `npm run vendor` so the installed app and GitHub Pages build work without a CDN at runtime.

- MapLibre GL JS 6.6.0 — BSD-3-Clause — https://github.com/maplibre/maplibre-gl-js
- @tomickigrzegorz/leaflet-rotate 0.2.4 — MIT — https://github.com/tomickigrzegorz/leaflet-rotate
- Potree 1.8.2 — BSD-2-Clause — https://github.com/potree/potree
- Inter 4 (via @fontsource-variable/inter 5.3.0) — SIL Open Font License 1.1 — https://github.com/rsms/inter. The fallback interface face where the system has no SF Pro; its licence ships beside it as `vendor/fonts/Inter-LICENSE.txt`.

Potree's reviewed release bundle also supplies its compatible browser companions (jQuery, BinaryHeap, tween.js, proj4js and copc.js) and LAZ decoder/WASM. Exact upstream paths, archive hash, and runtime files are recorded in `vendor/potree/SOURCE.json`; the Potree license is retained beside the distribution.

The packages and exact versions are recorded in `package-lock.json`. Their upstream license files remain available in their npm packages.
