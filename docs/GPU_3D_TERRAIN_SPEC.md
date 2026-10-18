# Resident GPU analytical overlays for 3D terrain

Owner/integrator: GPT 6.1. Workstreams: GPT 6.1 renderer, Grok 4.7 architecture
review, Muse Wonder browser measurements, DeepSeek 4.1 Flash specified cache.
Claude is excluded for this change.

## Rendering contract

MapLibre 6.6 continues to own terrain geometry, elevation selection, hillshade,
color relief, depth, occlusion, raster projection, anisotropic filtering and
exports. The new analytical path shades its native mipmapped raster textures
inside the same WebGL2 context, before MapLibre's terrain composition pass.
No second overlay canvas, replacement terrain mesh or screen-space projection
is introduced. Resolution, source selection and Float32 elevation are preserved.

1. `gpu-terrain-3d-cache.js` deduplicates elevation and neighbour requests and
   retains one Float32, one-pixel-skirted elevation grid per coordinate. Both
   analytical terrain and elevation colors share that record. Independent
   consumer cancellation and generation checks prevent abandoned work returning.
2. `gpu-terrain-3d-renderer.js` uploads a grid to a resident R32F texture once.
   It reuses the validated terrain shader, with north-up tile coordinates and
   the true ground distance per source pixel. Styles, light and colors update
   uniforms and shade directly into MapLibre's existing RGBA8 texture. The
   output is premultiplied, with north at texture row zero, and gets mipmaps.
   Source grids and texture uploads are reused across setting changes.
3. `gpu-terrain-3d-layer.js` is the guarded adapter. A standard custom layer's
   `prerender` batches dirty tile outputs in MapLibre's offscreen pass. It never
   draws a separate surface in its `render` method. A modified raster texture
   invalidates overlapping terrain RTT tiles before composition. Clean frames
   do no analytical shading work. Camera motion retains the native terrain
   cache, geometry and visibility machinery.
4. `index.html` retains analytical/spectrum sources between style and color
   changes, toggles native layers in place, and avoids rebuilding the style
   or changing tile URLs for uniform-only changes.

## Performance and hardware policy

Reuse one program, VAO and framebuffer, batch state capture/restoration once
per batch, upload only new/revised Float32 grids, keep input textures under an
LRU byte budget, and generate output mipmaps for native oblique filtering.
Do not call `finish` or read pixels on the draw path. A small startup parity
self-test may read back once. Diagnostics must distinguish main-thread time,
worker shading, source/network latency, GPU submissions and frame presentation.
Extra derivative passes, precision reductions and custom mesh LOD are not
added without measurements demonstrating a benefit and unchanged correctness.
Desktop input texture and skirt caches each allow 192 MiB; coarse-pointer
devices each allow 64 MiB. MapLibre's existing caches are additional memory.
These limits are ceilings, not eager allocations. Preserve the existing mobile
pixel ratio and MSAA policy.

## Compatibility and recovery

Custom layers are not terrain RTT eligible in the installed MapLibre renderer.
This adapter consequently depends on guarded 6.6 internals: `painter.context`,
`style.tileManagers`, raster `tile.texture` and
`terrain.tileManager.releaseRTT`. Pin and check the version and structural
contract. Do not edit vendored MapLibre. Missing support, compile/self-test
failure or an adapter exception selects the existing CPU-worker renderer.
`?gpu3d=0` explicitly selects that legacy path; `?gpu3d=1` requests GPU support.
Context restoration recreates owned input textures from retained CPU records;
the adapter never deletes MapLibre's output handles. Source changes clear both
caches and reject obsolete requests. Exiting 3D destroys the context's owned
resources and listeners. Re-entering starts a new controller.

## Acceptance evidence

Require independent cache and GL lifecycle tests, actual GPU versus CPU image
comparisons on asymmetric terrain and no-data edges, all analytical styles,
spectrum and bands, oblique view/orbit, opacity/light/look controls, source
switches, context loss/restore, 3D exit/re-entry and 2D regressions. Record
Chrome/Metal and WebKit benchmarks on the Mac; phone viewport tests are not
physical iPhone measurements. Report incomplete gates explicitly. Never
infer a speedup from API call counts alone or claim faster data downloads.
