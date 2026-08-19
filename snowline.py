#!/usr/bin/env python3
"""
snowline.py - "Is the pass melted out?"

Finds the freshest low-cloud Sentinel-2 scene over a point, computes NDSI snow
cover, drapes it over the Copernicus 30 m DEM, and reports the snow line elevation.

Free, no API key. Data: Element 84 Earth Search (Sentinel-2 L2A + Copernicus DEM).
"""
import os, json, sys, urllib.request, datetime as dt
for _v in ("AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SESSION_TOKEN","AWS_PROFILE"):
    os.environ.pop(_v, None)
os.environ.update(AWS_NO_SIGN_REQUEST="YES", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR")
import numpy as np, rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
from rasterio.enums import Resampling

STAC = "https://earth-search.aws.element84.com/v1/search"
NDSI_THRESH = 0.42   # standard snow threshold
NIR_MIN     = 0.11   # rejects water, which also has high NDSI

def stac(collection, lon, lat, days=60, cloud=25, limit=10):
    q = {"collections":[collection],
         "intersects":{"type":"Point","coordinates":[lon,lat]},
         "limit":limit,
         "sortby":[{"field":"properties.datetime","direction":"desc"}]}
    if days:
        since = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
        q["datetime"] = f"{since}/.."
    if cloud is not None:
        q["query"] = {"eo:cloud_cover":{"lt":cloud}}
    r = urllib.request.Request(STAC, data=json.dumps(q).encode(),
                               headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r, timeout=90))["features"]

def read(href, bounds_wgs84, shape=None):
    """Windowed read of a COG over a WGS84 bbox."""
    with rasterio.open(href) as src:
        b = transform_bounds("EPSG:4326", src.crs, *bounds_wgs84)
        w = from_bounds(*b, transform=src.transform)
        kw = {"window": w, "boundless": True, "fill_value": 0}
        if shape: kw.update(out_shape=shape, resampling=Resampling.bilinear)
        return src.read(1, **kw).astype("float32")

def bbox(lon, lat, km):
    dlat = km/111.0
    dlon = km/(111.0*max(np.cos(np.radians(lat)), 0.05))
    return (lon-dlon, lat-dlat, lon+dlon, lat+dlat)

def analyse(name, lat, lon, radius_km=4.0, days=45):
    bb = bbox(lon, lat, radius_km)
    scenes = stac("sentinel-2-l2a", lon, lat, days=days, cloud=25)
    if not scenes:
        print(f"\n{name}: no low-cloud scene in {days} days"); return
    it = scenes[0]; p = it["properties"]
    age = (dt.datetime.now(dt.timezone.utc)
           - dt.datetime.fromisoformat(p["datetime"].replace("Z","+00:00"))).total_seconds()/3600

    a = it["assets"]
    swir = read(a["swir16"]["href"], bb)                    # B11, 20 m -> defines grid
    grid = swir.shape
    green = read(a["green"]["href"], bb, shape=grid)        # B03
    nir   = read(a["nir"]["href"],  bb, shape=grid)         # B08
    scale = p.get("raster:bands",[{}])[0].get("scale", 1e-4) or 1e-4
    green, swir, nir = green*scale, swir*scale, nir*scale

    with np.errstate(divide="ignore", invalid="ignore"):
        ndsi = (green-swir)/(green+swir)
    snow = (ndsi > NDSI_THRESH) & (nir > NIR_MIN)
    valid = (green+swir) > 0

    dem_items = stac("cop-dem-glo-30", lon, lat, days=None, cloud=None, limit=1)
    dem = read(dem_items[0]["assets"]["data"]["href"], bb, shape=grid)

    ok = valid & (dem > -400)
    if ok.sum() == 0: print(f"\n{name}: no valid pixels"); return
    elev, sn = dem[ok], snow[ok]
    pct = 100*sn.mean()

    print(f"\n{name}  ({lat:.4f}, {lon:.4f})")
    print(f"  scene {p['datetime'][:16]}Z  age {age:.0f} h  cloud {p.get('eo:cloud_cover',0):.1f}%  [{it['id']}]")
    print(f"  elevation {elev.min():.0f}-{elev.max():.0f} m   snow-covered {pct:.1f}% of area")

    # snow line = lowest 100 m band that is >50% snow, with all bands above also snowy
    lo, hi = int(elev.min()//100*100), int(elev.max()//100*100+100)
    bands = []
    for e in range(lo, hi, 100):
        m = (elev>=e)&(elev<e+100)
        if m.sum() > 40: bands.append((e, 100*sn[m].mean(), int(m.sum())))
    line = None
    for i,(e,f,_) in enumerate(bands):
        if f >= 50 and all(b[1] >= 40 for b in bands[i:]):
            line = e; break
    print(f"  {'SNOW LINE ~ %d m (%d ft)' % (line, line*3.28084) if line else 'no continuous snow line - effectively melted out'}")
    for e,f,n in bands:
        bar = "#"*int(f/4)
        print(f"    {e:5d}-{e+100:5d} m  {f:5.1f}%  {bar}")

if __name__ == "__main__":
    targets = [("Mt Rainier, WA (glaciated - positive control)", 46.8523, -121.7603, 6.0),
               ("Forester Pass, Sierra CA (PCT high point)",     36.6939, -118.3958, 4.0),
               ("Glacier NP, MT (Logan Pass)",                   48.6960, -113.7180, 5.0)]
    for n,la,lo,r in targets:
        try: analyse(n, la, lo, r)
        except Exception as e: print(f"\n{n}: ERROR {type(e).__name__}: {e}")
