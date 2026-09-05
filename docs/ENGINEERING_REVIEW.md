# Clear Skies engineering review — 2026-09-05

Baseline: `1d9edd3`. Scope: the browser map, elevation lifecycle, imagery mosaics,
terrain source selection, and development verification. Preserve the existing
Leaflet / MapLibre / point-cloud renderers and Node terrain engine.

## Assessment

The project has useful scientific primitives, CPU workers, GPU terrain shading,
source-specific adapters, and a substantial test suite. Its weakest boundary is
coordination: the large inline application owns source selection, async requests,
rendering, controls, and state independently in many places. More rendering
libraries would not resolve the request-order and presentation problems.

This change strengthens those boundaries without replacing the application.

## Fixed in this change

- Three elevation tiers previously waited in sequence at the presentation level.
  A blocked overview could hold up an already available national response, and
  raw lidar did not start until both previous stages completed. All tiers now
  start independently through a shared bounded request pool. Per-pixel quality
  ranks ensure late overview data can fill gaps but never overwrite detail.
- Elevation consumers now share source requests and decoded grids. The cache is
  limited to 48 MiB with a five-minute lifetime. There are at most eight active
  source requests: two raw, two national, and four overview requests, so a slow
  detail provider cannot take every loading slot. Unloaded consumers cancel
  their own waits; remaining consumers keep their shared request.
- Analytical style changes reuse existing elevation tiles; lighting input is
  coalesced to animation frames. Neither change needs another elevation download.
- The WA coverage query now requests the padded bounds it subsequently caches.
  Previously only the visible bounds were queried while the cache claimed a
  larger area. Obsolete queries are cancelled. Temporary failures do not erase
  an already discovered survey. Raw detail selection is per tile rather than
  gated by whether the centre point has coverage.
- Primary imagery and mosaic candidates stage at zero opacity. Candidates must
  meet the acceptance threshold before publication. Failed replacements preserve
  existing coverage; cancelled batches remove their staged layers.
- Terrain status reports loading, refinement, source mixtures and unavailable
  detail from the actual loaded tiles, separately from the preferred source.
  Analysis output records elevation source labels and whether capture occurred
  while refinement was still running. Sampling is not presented as accuracy.
- The desktop sidebar defaults to 580 px rather than 720 px, with a functional
  resize handle, more legible search, and a mode bar centred on the exposed map.
  Layer cards no longer rebuild periodically when their data has not changed.
  Their opacity sliders now have accessible names. Zoom controls moved to the
  right: they were physically behind the sidebar, where a click could activate
  the footer instead. The lighting explanation now uses a readable theme colour.
- Development accepts explicit host/port flags while retaining the real backend.
  The server integration test now uses a deterministic TIFF upstream fixture,
  including both no-coverage and populated elevation plus cached responses.

## Contracts for future work

1. Changing a palette or light must not fetch elevation again.
2. A tile may gain detail, but late lower-quality data must not reduce it.
3. Removing one layer must not cancel a source request still used by another.
4. A failed replacement must retain the previous useful map.
5. A cached coverage extent must never exceed the extent actually queried.
6. Data source, acquisition date, sample spacing, and accuracy are different facts.
   Do not label a global overview as lidar or upsampling as new information.
7. Geometry coverage and valid rendered pixel coverage are different measurements.
8. Test failed, delayed, cancelled and reversed-order responses, not only success.
9. Update static hosting, Electron resources and service-worker assets together.
10. Keep production deployment separate from review of a working branch.

## Verification

- Syntax and static-asset checks.
- Existing numerical, worker-pool, catalog, and server tests.
- Shared-request cancellation, priority, group capacity, cache eviction and retry.
- Actual elevation layer exercised with reversed response order, stalled baseline,
  multiple consumers, pan cancellation, and returning to cached tiles.
- Actual layer transition functions exercised for invisible staging, late valid
  content, rollback, and incomplete mosaic rejection.
- Cloud browser: opening the local development app, selecting slope, switching to
  aspect, toggling the panel, checking loading/source status and map layout.

Live national elevation requests failed in the review environment. The browser
showed overview terrain and reported missing detail. Deterministic tests verified
the high-resolution data path; they are not a substitute for a field test against
the user's Mac engine, real WA surveys, mobile Safari and slow networks. No claim
of measured universal flicker elimination or validated survey accuracy is made.

## Remaining architectural work

- Introduce an explicit source catalog contract carrying survey identity, date,
  native resolution, vertical reference, units and processing provenance. Current
  source labels do not establish compatible vertical datums across mosaics.
- Separate provider clients, map state and UI from `index.html` incrementally.
- Promote mosaics from stacked scene layers and sampled footprint coverage to
  a tile-level plan with validity masks, a clear acquisition-time policy, and
  consistent radiometry. Bounding polygons do not guarantee cloud-free pixels.
- Validate derivative seams, nodata edges, interpolation and physical analysis
  scales against known terrain and a reference GIS. Mixed-resolution elevation
  can introduce derivative discontinuities even when the map looks continuous.
- Benchmark visible-area completion, detail completion, dropped frames, memory,
  request counts and revisits on representative phone and desktop hardware.
  Larger hardware alone does not fix unnecessary work or poor scheduling.
- Decide product policy for freshest imagery versus clear imagery versus finest
  resolution. They should be explicit choices, not an undefined 'best' score.
