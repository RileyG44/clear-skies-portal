# DOGAMI validity-mask regression

`hood-survey-edge.lerc` is the numeric response from DOGAMI's public
DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer at tile 13/1325/2937 (near Mount
Hood), captured November 2, 2026. Request: Web Mercator bbox, 256×256,
F32, LERC v2, 0.001-foot compression tolerance, bilinear interpolation,
`None` rendering rule, locked primary raster 49 (Wasco 2015), MT_FIRST.

The response has 20,178 valid elevations in feet and 45,358 masked pixels.
Those masked pixels contain zero in the numeric buffer. The equivalent TIFF
export has the same zeroes with no nodata tag, which previously produced
false sea-level plateaus. This fixture exercises the real decoder offline;
zero must not be used as a substitute for the validity mask.
