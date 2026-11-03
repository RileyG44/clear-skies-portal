# Gray terrain patches near Mount Hood

The reported TestFlight screenshots show gray plateaus and dark, stair-stepped
edges south of Mount Hood. The Oregon numeric adapter introduced in #61 exported
DOGAMI survey rasters as Float32 TIFF. At survey holes, the provider writes zero
without a TIFF nodata tag. The worker consequently packed missing pixels as valid
0 m elevation, and their higher quality rank hid national/overview ground.
The hillshade rendered those false cliffs and plateaus correctly from bad input.

For primary raster 49 (Wasco 2015), tile 13/1325/2937, the TIFF contains 45,358
unmarked zero pixels. The same numeric request as LERC v2 explicitly masks those
pixels, retaining 20,178 valid elevations. The provider's mask is authoritative;
zero itself is not a missing-data sentinel. The offline fixture is documented
in `test-fixtures/oregon/README.md`.

The adapter now requests LERC and the worker preserves the mask before converting
feet to metres and packing transparent Terrarium. Survey identity, units, source
rank and request budgets are unchanged. Invalid responses remain retryable and
uncached. The server's Oregon cache namespace and all client Oregon URLs are
versioned so immutable corrupt responses are not reused. Once a finer Oregon
response establishes coverage, its holes reveal lower-ranked terrain rather than
magnifying a coarser survey sample into them. Useful coarser terrain remains
available while a finer request is unanswered or fails.

Verification includes the captured real-provider fixture, a live request through
the updated engine, corrupt-response rejection, unit conversion, valid sea level,
server/HTTP cache migration, source priority, 3D loading, cancellation, worker
pool and GPU store/renderer tests. The real-GPU suite checks fallback after zoom
and revisit on Chrome/Metal and WebKit/Apple GPU. Numerical evidence is in
[the recorded results](assets/2026-11-02-terrain-nodata.json).

This repairs missing-data handling throughout the Oregon adapter. It does not
establish complete provider coverage, uniform resolution, survey accuracy or
inter-survey vertical-datum alignment.

Native iPhone 17 Pro / iOS 26 simulator verification passed on build
`2026-11-02b` at zooms 12, 13, 14, 15 and a return to 12. Each GPU field
contained 3,162,132 valid pixels with no false zero elevations. Actual Oregon
detail reached the field and its masked gaps revealed lower-ranked ground.
The 27-tile live grid around the site returned successful full, partial and
empty coverage. The native probe uses an 18-second observation window per view;
provider refinement was still pending, so this is not a settled-load timing claim.
