#!/usr/bin/env python3
"""
trailcheck.py — pre-trip conditions check for a point or a GPX route (Western US/Canada)

  python3 trailcheck.py --lat 46.8523 --lon -121.7603 --name "Rainier"
  python3 trailcheck.py --gpx myroute.gpx

Answers:
  1. SNOW  — where is the snow line, and where does my route cross it?
             Sentinel-2 NDSI + Copernicus 30 m DEM, freshest low-cloud scene.
  2. FIRE  — active fire detections and official perimeters near the route.
             VIIRS 24 h (NASA FIRMS) + WFIGS current perimeters (NIFC).
  3. GROUND TRUTH — nearest SNOTEL station's current snow water equivalent.

Every source is free and none of them requires an API key.
"""
import os, json, csv, io, math, argparse, urllib.request, datetime as dt
for _v in ("AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SESSION_TOKEN","AWS_PROFILE"):
    os.environ.pop(_v, None)
os.environ.update(AWS_NO_SIGN_REQUEST="YES", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR")
import numpy as np, rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
from rasterio.enums import Resampling

STAC        = "https://earth-search.aws.element84.com/v1/search"
SNOTEL      = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1"
NIFC        = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
               "WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query")
FIRMS       = ("https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/"
               "J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv")
NDSI_THRESH, NIR_MIN = 0.42, 0.11
M2FT = 3.28084

def get(url, timeout=90):
    return urllib.request.urlopen(urllib.request.Request(
        url, headers={"User-Agent":"trailcheck/1.0"}), timeout=timeout).read()

def stac(collection, bounds, days=None, cloud=None, limit=10):
    q = {"collections":[collection], "bbox":list(bounds), "limit":limit,
         "sortby":[{"field":"properties.datetime","direction":"desc"}]}
    if days:
        since = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
        q["datetime"] = f"{since}/.."
    if cloud is not None: q["query"] = {"eo:cloud_cover":{"lt":cloud}}
    r = urllib.request.Request(STAC, data=json.dumps(q).encode(),
                               headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r, timeout=90))["features"]

def read(href, bb, shape=None):
    with rasterio.open(href) as src:
        w = from_bounds(*transform_bounds("EPSG:4326", src.crs, *bb), transform=src.transform)
        kw = {"window":w, "boundless":True, "fill_value":0}
        if shape: kw.update(out_shape=shape, resampling=Resampling.bilinear)
        return src.read(1, **kw).astype("float32")

def haversine(la1, lo1, la2, lo2):
    R=6371.0; p=math.radians
    a=(math.sin(p(la2-la1)/2)**2 + math.cos(p(la1))*math.cos(p(la2))*math.sin(p(lo2-lo1)/2)**2)
    return 2*R*math.asin(math.sqrt(a))

# ---------------------------------------------------------------- SNOW
def snow(bb, track=None):
    print("\n" + "="*68 + "\nSNOW\n" + "="*68)
    sc = stac("sentinel-2-l2a", bb, days=45, cloud=30)
    if not sc: print("  no low-cloud Sentinel-2 scene in the last 45 days"); return
    it = sc[0]; p = it["properties"]
    age = (dt.datetime.now(dt.timezone.utc)
           - dt.datetime.fromisoformat(p["datetime"].replace("Z","+00:00"))).total_seconds()/3600
    print(f"  scene   {p['datetime'][:16]}Z   {age:.0f} h old   cloud {p.get('eo:cloud_cover',0):.1f}%")
    print(f"  id      {it['id']}")

    a = it["assets"]
    swir  = read(a["swir16"]["href"], bb); grid = swir.shape
    green = read(a["green"]["href"], bb, grid)
    nir   = read(a["nir"]["href"],  bb, grid)
    s = (p.get("raster:bands",[{}])[0].get("scale") or 1e-4)
    green, swir, nir = green*s, swir*s, nir*s
    with np.errstate(divide="ignore", invalid="ignore"):
        ndsi = (green-swir)/(green+swir)
    sn  = (ndsi > NDSI_THRESH) & (nir > NIR_MIN)
    dem = read(stac("cop-dem-glo-30", bb, limit=1)[0]["assets"]["data"]["href"], bb, grid)
    ok  = ((green+swir) > 0) & (dem > -400)
    if not ok.any(): print("  no valid pixels"); return
    elev, s_ok = dem[ok], sn[ok]
    print(f"  terrain {elev.min():.0f}-{elev.max():.0f} m    snow cover {100*s_ok.mean():.1f}% of area\n")

    lo, hi = int(elev.min()//100*100), int(elev.max()//100*100+100)
    bands = [(e, 100*s_ok[(elev>=e)&(elev<e+100)].mean())
             for e in range(lo, hi, 100) if ((elev>=e)&(elev<e+100)).sum() > 40]
    line = next((e for i,(e,f) in enumerate(bands)
                 if f >= 50 and all(b[1] >= 40 for b in bands[i:])), None)
    for e,f in bands:
        mark = " <-- SNOW LINE" if e == line else ""
        print(f"    {e:5d} m {e*M2FT:6.0f} ft {f:5.1f}%  {'#'*int(f/4)}{mark}")
    print()
    if line: print(f"  >> SNOW LINE ~ {line} m ({line*M2FT:.0f} ft)")
    else:    print("  >> No continuous snow line — effectively melted out")

    if track and line:
        above = [q for q in track if q[2] and q[2] >= line]
        if above:
            print(f"  >> Your route is above the snow line for {len(above)} of {len(track)} points "
                  f"({100*len(above)/len(track):.0f}%); highest point {max(q[2] for q in track):.0f} m")
        else:
            print(f"  >> Your route tops out at {max((q[2] or 0) for q in track):.0f} m — stays below the snow line")

# ---------------------------------------------------------------- FIRE
def fire(lat, lon, radius_km=80):
    print("\n" + "="*68 + "\nFIRE\n" + "="*68)
    try:
        rows = list(csv.DictReader(io.StringIO(get(FIRMS).decode())))
        near = sorted(((haversine(lat, lon, float(r["latitude"]), float(r["longitude"])), r)
                       for r in rows), key=lambda x: x[0])
        hits = [(d,r) for d,r in near if d <= radius_km]
        print(f"  VIIRS active-fire detections, last 24 h, within {radius_km} km: {len(hits)}")
        for d,r in hits[:6]:
            print(f"    {d:5.1f} km  {r['acq_date']} {r['acq_time']}Z  "
                  f"conf={r['confidence']}  FRP={float(r['frp']):.0f} MW")
        if not hits and near:
            print(f"    nearest detection is {near[0][0]:.0f} km away")
    except Exception as e:
        print(f"  FIRMS unavailable: {e}")
    try:
        d = 1.2*radius_km/111.0
        url = (f"{NIFC}?where=1%3D1&outFields=poly_IncidentName,poly_GISAcres,attr_PercentContained"
               f"&geometry={lon-d},{lat-d},{lon+d},{lat+d}&geometryType=esriGeometryEnvelope"
               f"&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&f=json")
        fs = json.loads(get(url))["features"]
        print(f"\n  Official WFIGS fire perimeters intersecting the area: {len(fs)}")
        for f in sorted(fs, key=lambda x: -(x["attributes"].get("poly_GISAcres") or 0))[:6]:
            at = f["attributes"]
            print(f"    {at.get('poly_IncidentName','?'):28} {at.get('poly_GISAcres') or 0:9,.0f} ac"
                  f"   {at.get('attr_PercentContained') or 0:.0f}% contained")
    except Exception as e:
        print(f"  NIFC unavailable: {e}")

# ---------------------------------------------------------------- SNOTEL
def snotel(lat, lon, states):
    print("\n" + "="*68 + "\nSNOTEL GROUND TRUTH\n" + "="*68)
    try:
        st = []
        for s in states:
            st += json.loads(get(f"{SNOTEL}/stations?stationTriplets=*:{s}:SNTL&returnStationElements=false"))
        near = sorted(st, key=lambda s: haversine(lat, lon, s["latitude"], s["longitude"]))[:3]
        end = dt.date.today(); beg = end - dt.timedelta(days=5)
        trip = ",".join(s["stationTriplet"] for s in near)
        data = json.loads(get(f"{SNOTEL}/data?stationTriplets={trip}&elements=WTEQ,SNWD"
                              f"&duration=DAILY&beginDate={beg}&endDate={end}"))
        by = {d["stationTriplet"]: d for d in data}
        for s in near:
            d = haversine(lat, lon, s["latitude"], s["longitude"])
            rec = by.get(s["stationTriplet"], {})
            out = []
            for e in rec.get("data", []):
                vals = [v for v in e.get("values",[]) if v.get("value") is not None]
                if vals: out.append(f"{e['stationElement']['elementCode']}={vals[-1]['value']}in")
            print(f"  {s['name'][:26]:26} {d:5.0f} km  {s['elevation']:6.0f} ft   {'  '.join(out) or 'no data'}")
    except Exception as e:
        print(f"  SNOTEL unavailable: {e}")

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float); ap.add_argument("--lon", type=float)
    ap.add_argument("--gpx"); ap.add_argument("--name", default="Area")
    ap.add_argument("--radius", type=float, default=5.0, help="km, point mode")
    ap.add_argument("--states", default="WA,OR,CA,ID,MT,WY,CO,UT,NV,AZ,NM,AK")
    a = ap.parse_args()

    track = None
    if a.gpx:
        import gpxpy
        g = gpxpy.parse(open(a.gpx))
        track = [(p.latitude, p.longitude, p.elevation)
                 for tr in g.tracks for sg in tr.segments for p in sg.points]
        if not track: raise SystemExit("no track points in GPX")
        las = [t[0] for t in track]; los = [t[1] for t in track]
        bb = (min(los)-0.02, min(las)-0.02, max(los)+0.02, max(las)+0.02)
        lat, lon = sum(las)/len(las), sum(los)/len(los)
        a.name = a.name if a.name != "Area" else os.path.basename(a.gpx)
        print(f"\n### {a.name} — {len(track)} track points, "
              f"{haversine(track[0][0],track[0][1],track[-1][0],track[-1][1]):.1f} km end-to-end")
    else:
        if a.lat is None or a.lon is None: raise SystemExit("need --lat/--lon or --gpx")
        lat, lon = a.lat, a.lon
        dla = a.radius/111.0; dlo = a.radius/(111.0*max(math.cos(math.radians(lat)),0.05))
        bb = (lon-dlo, lat-dla, lon+dlo, lat+dla)
        print(f"\n### {a.name} — {lat:.4f}, {lon:.4f}  (±{a.radius:.0f} km)")

    snow(bb, track)
    fire(lat, lon)
    snotel(lat, lon, [s.strip() for s in a.states.split(",")])
    print()

if __name__ == "__main__":
    main()
