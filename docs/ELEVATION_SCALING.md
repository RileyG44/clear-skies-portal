# Elevation color scaling

Absolute and relative elevation layers fitted to the view default to **Land & water separately**.
For absolute elevation, the land palette uses the minimum and maximum finite land samples, including
negative elevations and isolated peaks/pits. Water has its own blue elevation
ramp and fitted range. Neither fitting nor coloring changes the elevation
field, measurements, contours, slope, data-source labels, or loading priority.

Classic relief retains its existing fixed colors and absolute elevation domain.
Selecting a palette without a fixed domain enables fitting as before; users can
also enable Fit to view explicitly. Small inward range changes are smoothed,
while newly sampled extremes always expand the fitted range.

The existing Range & shading controls also offer **Full elevation range**
(one scale for all samples) and **Trim extremes (2–98%)** (the former robust
fit). Manual ranges remain continuous. Curve and Bands apply to both ramps;
custom palette transparency, layer opacity, shading and blending are preserved.
Legends reflect the curve and show separate scales, including elevation overlays.
Reverse changes the land palette; water retains dark-deep to light-shallow blue.
Gallery thumbnails use synthetic terrain without geographic water classification.
The web, native iOS adapter, 3D drape and export keys use the shared studio state.
Scale settings and fitted ranges survive presets, storage and share links;
pre-existing links with continuous fitted ranges remain supported.

Relative elevation (including Missoula/Ember) keeps its existing valley-focused
contrast: zero to the 60th percentile of land relative heights. Water is excluded
from the local valley-floor minimum and smoothing calculation, then colored from
its own absolute elevation range. Its key reads **Water · absolute elevation ·
separate scale**, since lakes can sit above sea level. **Single relative scale**
restores the original combined relative fit. Manual ranges remain continuous.
In 3D, which has no local valley-floor field, separate REM uses a land-only view
floor and matching fitted legend. Mixed manual/automatic layers retain independent
floors. Missing local-floor samples stay aligned with the height and water samples;
overview views without a local floor use the land-only view floor.

## Geography and practical limits

`water-geography-data.js` is a bundled, display-only mask made from Natural
Earth's public-domain 1:10m land and lake polygons. The reproducible generator
is `scripts/data/build-water-geography.py`; it pins the source revision and
requires Pillow. Attribution and terms: <https://www.naturalearthdata.com/about/terms-of-use/>.
There are no live shoreline requests or new elevation providers.

The mask has 16,384 by 8,192 geographic cells (about 2.45 km at the equator;
east/west spacing decreases toward the poles). A scanline rasterizer classifies
cell centers from the polygon geometry, with no extra shoreline erosion.
Small islands, narrow inlets and lakes, and modern shoreline changes may not
be resolved. This is not survey-grade
shoreline or flood mapping. Coast cells can represent the opposite side of a
shoreline away from the cell center. Coastal water represented as land can
affect the land fit; users can adjust the manual range or use the explicit trimmed mode.
Water labels report absolute elevation, which can be positive for inland lakes.

One-bit geography is packed into a 2,048-square RGBA8 texture, within WebGL2's
guaranteed texture dimensions. The module decodes once (16 MiB CPU, only when
separate elevation fitting requests geography); each active renderer uploads one 16 MiB texture lazily and reports its allocation in stats.
Renderer cleanup and context restoration follow the existing texture lifecycle.

Fitting retains the existing coarse GPU readback limit of 128 by 128 samples.
It preserves every finite sampled land extreme; it does not promise to find
an unsampled narrow peak or pit. Relative elevation retains its existing local
valley-floor filter and fitting percentile, applied to land only in separate mode.
CPU fallback terrain continues to
use its existing fixed relief palette; the studio controls require WebGL2.

## Verification

- `node --test test-elevation-scaling.js test-lidar-render.js test-lidar-menu.js test-gpu-terrain-shaders.js test-gpu-terrain-engine.js test-gpu-terrain-3d-renderer.js test-gpu-terrain-3d-layer.js test-share-links.js test-map-readout.js`
- `node scripts/gpu2d/water-scaling.js chrome` and `webkit`: numerical 3D
  GPU/CPU comparison with coastlines, transparency and curves; real 2D sampling
  at four bearings; export rendering; mode changes and single-domain views;
  native picker description, actions and dual gradient keys.
- Existing shader parity in Chrome and WebKit, native menu/adapter tests,
  desktop packaging checks, static checks and site assembly.

- `node scripts/performance/relative-elevation-regression.js chrome` and `webkit`: 52 numerical filter cases, including land-only geography, missing data and downsample boundaries.

These tests use deterministic synthetic elevation and bundled geography. They
are not live-provider field tests or a physical iPhone UI test.
