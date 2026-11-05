# Elevation color scaling

Absolute and relative elevation layers fitted to the view default to **Land & water separately**.
For absolute elevation, the land palette uses the minimum and maximum finite land samples, including
negative elevations and isolated peaks/pits. Inland lakes use the selected terrain
palette on their own absolute elevation range, preserving tile detail without
stretching the land range. Ocean has its own blue elevation ramp and fitted range. Neither fitting nor coloring changes the elevation
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
Reverse changes the terrain palette; ocean retains dark-deep to light-shallow blue.
Gallery thumbnails use synthetic terrain without geographic water classification.
The web, native iOS adapter, 3D drape and export keys use the shared studio state.
Scale settings and fitted ranges survive presets, storage and share links;
pre-existing links with continuous fitted ranges remain supported.

Relative elevation (including Missoula/Ember) keeps its existing valley-focused
contrast: zero to the 60th percentile of terrestrial relative heights. Ocean and inland water are excluded
from the land valley-floor minimum, smoothing calculation and range fit. Ocean is
colored from its own absolute elevation range. Its key reads **Ocean · absolute elevation ·
separate scale**. Inland lakes have a third independent absolute elevation range using the selected
terrain palette, curve, bands and transparency; the key reads **Inland water ·
absolute elevation · separate scale**. This shows detail supplied by the tiles
without letting deep lakebeds alter adjacent land relief. Dry inland basins,
including those below sea level, retain the normal land fit and valley-floor filter. **Single relative scale**
restores the original combined relative fit. Manual ranges remain continuous.
In 3D, which has no local valley-floor field, separate REM uses a land-only view
floor and matching fitted legend. Mixed manual/automatic layers retain independent
floors. Missing local-floor samples stay aligned with the height and water samples;
overview views without a local floor use the land-only view floor.

## Geography and practical limits

`water-geography-data.js` is a bundled, display-only mask made from Natural
Earth's public-domain 1:10m land and lake polygons. Exterior marine coastlines
separate ocean from land; interior rings and lake polygons identify inland water. The reproducible generator
is `scripts/data/build-water-geography.py`; it pins the source revision and
requires Pillow. Attribution and terms: <https://www.naturalearthdata.com/about/terms-of-use/>.
There are no live shoreline requests or new elevation providers.

The mask has 16,384 by 8,192 geographic cells (about 2.45 km at the equator;
east/west spacing decreases toward the poles). A scanline rasterizer classifies
cell centers from the polygon geometry, with no extra shoreline erosion.
Small islands, narrow inlets and modern shoreline changes may not
be resolved. This is not survey-grade
shoreline or flood mapping. Coast cells can represent the opposite side of a
shoreline away from the cell center. Ocean or lake water represented as land can
affect the land fit; users can adjust the manual range or use the explicit trimmed mode.
The ocean key reports absolute elevation. This display mask does not infer
water from negative heights or flatten the actual elevation field. Inland
water detail still depends on the source: a flat lake-surface DEM cannot
provide missing lakebed bathymetry.

Two-bit geography is packed into a 2,048-square RGBA16UI integer texture, within WebGL2's
guaranteed texture dimensions. The module decodes once (32 MiB CPU, only when
separate elevation fitting requests geography); each active renderer uploads one 32 MiB texture lazily and reports its allocation in stats.
Renderer cleanup and context restoration follow the existing texture lifecycle.

Fitting retains the existing coarse GPU readback limit of 128 by 128 samples.
It preserves every finite sampled land extreme; it does not promise to find
an unsampled narrow peak or pit. Relative elevation retains its existing local
valley-floor filter and fitting percentile, excluding both ocean and inland water in separate mode.
CPU fallback terrain continues to
use its existing fixed relief palette; the studio controls require WebGL2.

## Verification

- `node --test test-elevation-scaling.js test-lidar-render.js test-lidar-menu.js test-gpu-terrain-shaders.js test-gpu-terrain-engine.js test-gpu-terrain-3d-renderer.js test-gpu-terrain-3d-layer.js test-share-links.js test-map-readout.js`
- `node scripts/gpu2d/water-scaling.js chrome` and `webkit`: numerical 3D
  GPU/CPU comparison with coastlines, transparency and curves; real 2D sampling
  at four bearings; export rendering; mode changes and single-domain views;
  native picker description, actions and three independent gradient keys;
  deep lakebed changes leave dry-land fits and local floors unchanged away from
  the generalized shoreline footprint.
- Existing shader parity in Chrome and WebKit, native menu/adapter tests,
  desktop packaging checks, static checks and site assembly.

- `node scripts/performance/relative-elevation-regression.js chrome` and `webkit`: 52 numerical filter cases, including land-only geography, missing data and downsample boundaries.

These tests use deterministic synthetic elevation and bundled geography. They
are not live-provider field tests or a physical iPhone UI test.
