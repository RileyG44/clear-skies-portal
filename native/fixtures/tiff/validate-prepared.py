"""Independent GDAL gate for the native writer's odd-sized tilted-plane fixture.

The Rust test emits this with CSK_TILED_QA_OUTPUT. Rasterio's pinned wheel carries
GDAL: no Homebrew/system GDAL dependency and no second native TIFF decoder.
"""
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling

with rasterio.open(sys.argv[1]) as dataset:
    assert dataset.driver == "GTiff"
    assert dataset.shape == (517, 515)
    assert dataset.block_shapes == [(256, 256)]
    assert dataset.crs.to_epsg() == 26910
    assert tuple(dataset.transform) == (0.5, 0.0, 500000.0, 0.0, -0.5, 5300000.0, 0.0, 0.0, 1.0)
    assert dataset.overviews(1) == [2, 4]
    assert np.isnan(dataset.nodata)
    base = dataset.read(1)
    y, x = np.indices(base.shape)
    expected = (1000 + x * 0.25 + y * 0.5).astype("float32")
    assert np.isnan(base[:3, :2]).all()
    valid = np.isfinite(base)
    assert valid.sum() == base.size - 6
    assert np.array_equal(base[valid], expected[valid])
    # Ask GDAL to use the stored first overview. Integrate the piecewise
    # constant plane independently, including its fractional edge pixels.
    overview = dataset.read(1, out_shape=(259, 258), resampling=Resampling.nearest)
    y, x = np.indices(overview.shape)
    sx, sy = 515 / 258, 517 / 259

    def integral(value):
        whole = np.floor(value)
        return whole * (whole - 1) / 2 + whole * (value - whole)

    mx = (integral((x + 1) * sx) - integral(x * sx)) / sx
    my = (integral((y + 1) * sy) - integral(y * sy)) / sy
    expected = 1000 + 0.25 * mx + 0.5 * my
    outside_void = (x >= 2) | (y >= 2)
    assert np.max(np.abs(overview[outside_void] - expected[outside_void])) < 0.0001

print(f"GDAL {rasterio.__gdal_version__}: base bits, no-data, overview lattice and georeferencing verified")
