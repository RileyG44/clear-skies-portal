# Third-party browser renderers

Clear Skies Portal vendors browser-ready distribution files during `npm run vendor` so the installed app and GitHub Pages build work without a CDN at runtime.

- MapLibre GL JS 6.6.0 — BSD-3-Clause — https://github.com/maplibre/maplibre-gl-js
- @tomickigrzegorz/leaflet-rotate 0.2.4 — MIT — https://github.com/tomickigrzegorz/leaflet-rotate
- Potree 1.8.2 — BSD-2-Clause — https://github.com/potree/potree

Potree's reviewed release bundle also supplies its compatible browser companions (jQuery, BinaryHeap, tween.js, proj4js and copc.js) and LAZ decoder/WASM. Exact upstream paths, archive hash, and runtime files are recorded in `vendor/potree/SOURCE.json`; the Potree license is retained beside the distribution.

The packages and exact versions are recorded in `package-lock.json`. Their upstream license files remain available in their npm packages.

# Bundled data

- `nadi1-cordilleran.json` — derived from NADI-1, North American Deglacial Isochrones v1 (Dalton, A.S. et al. 2023, *Quaternary Science Reviews* 321, 108345, https://doi.org/10.1016/j.quascirev.2023.108345; data https://doi.org/10.5281/zenodo.8161764) — CC BY 4.0. Clipped to the Pacific Northwest and simplified; see `scripts/build-nadi1-cordilleran.py`.
