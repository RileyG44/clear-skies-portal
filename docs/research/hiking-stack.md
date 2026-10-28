# Western US Hiking Imagery Stack
### Revised source list — snow, fire, route-finding. Personal use.

**Revised:** 18 August 2026. Supersedes the general-purpose catalog for your actual use case.
Companion tool: `trailcheck.py` (working, validated below).

---

## What changed from v1

You're hiking the Western US/Canada, not building a commercial global portal. Three consequences:

**Licensing stops mattering.** Vantor/Maxar's CC-BY-NC 30 cm imagery, Google Earth Engine's noncommercial tier, EOX cloudless mosaics — all fine for personal use. That was a third of the high-res catalog, unlocked. The only remaining rule is don't scrape and re-serve Google/Bing/Esri tiles, which you have no reason to do.

**Cost stops mattering.** CDSE's 10,000 processing units/month was the binding constraint for a public portal. For one person checking a few passes a week it's effectively infinite. No caching tier, no requester-pays anxiety, no Phase 2 as originally written.

**The source list shrinks by ~70%.** Gone: geostationary (2 km pixels tell you nothing about a trail), Sentinel-3, ocean coverage, most aggregators, most episodic VHR. **Sentinel-1 SAR drops from #2 to niche** — I overweighted it. SAR is the right answer for a general portal but the wrong tool here, because "is the pass melted out" is a question you answer by looking at a picture, and SAR imagery is hard to read visually.

**And you should know this exists before building anything:** [CalTopo Pro](https://training.caltopo.com/all_users/base-layers/layers), about $50/yr, already ships Sentinel Weekly (10 m, 5-day, with a false-color burn view), MODIS Daily, GOES Live on a 5-minute refresh, and up to 50 cm global imagery including Vantor. Andrew Skurka [wrote it up specifically as a snowpack tool](https://andrewskurka.com/new-snowpack-tool-satellite-imagery-for-caltopo-gaiagps/). If what you want is *recent imagery on a hiking map*, buy that instead of building it.

**What CalTopo doesn't do — and what's worth building:** route-centric analysis. Snow line as a *number in feet* rather than a picture to eyeball. Freshest **cloud-free** scene rather than a weekly composite that might be socked in. Same-date comparison against prior years, so you know whether this season is early or late. Alerting when a pass melts out. That's a small, sharp, genuinely useful build — and it's what `trailcheck.py` does.

---

## The stack that actually matters

### Tier 1 — Build on these

| Source | What it gives you | Resolution | Freshness | Key? |
|---|---|---|---|---|
| **Sentinel-2 L2A** | Snow cover (NDSI), burn scars, green-up | 10 m / 20 m SWIR | **1–3 days** | no |
| **Copernicus DEM GLO-30** | Global 30 m terrain, pairs with any imagery | 30 m | static | no |
| **USGS 3DEP** | **1 m lidar terrain** in most of the West | 1 m | 2015–2024 | no |
| **NAIP** | 60 cm aerial — best route-finding imagery in the US | 0.6 m | 1–3 yr | no |
| **SNOTEL (NRCS)** | Ground-truth snow depth + SWE, ~800 Western sites | point | **daily** | no |
| **NASA FIRMS** | Active fire detections | 375 m | **~24 h, keyless CSV** | no |
| **WFIGS / NIFC** | Official fire perimeters + containment % | vector | hourly | no |

Every one of those is free, and — the useful discovery — **every one works without an API key.** You can build the whole thing with `urllib`.

### Tier 2 — Worth adding later

- **Landsat 8/9** — 30 m, but **15 m panchromatic** and a thermal band; fills Sentinel-2 gaps and extends the archive to 1984 for multi-decade glacier comparison.
- **SNODAS (NOAA NOHRSC)** — 1 km modeled snow depth & SWE, daily, CONUS. Interpolates between SNOTEL points.
- **MODIS/VIIRS snow (MOD10A1 / VNP10A1)** — 375–500 m daily snow cover. Coarse, but cloud-gap filling.
- **Sentinel-2 burn indices (NBR/dNBR)** — burn severity for post-fire trail conditions; deadfall is the real hazard in a recent burn.
- **NOAA HMS smoke plumes** — daily smoke polygons; pairs with AirNow for air quality on the route.
- **BC/Alberta provincial ortho + NRCan HRDEM** — the Canadian equivalents of NAIP and 3DEP.
- **Vantor Open Data** — 30 cm, now usable for you, but only fires on disaster activations. Occasionally lucky after a major wildfire or flood.

### Tier 3 — Skip
Geostationary (too coarse), Sentinel-1 SAR (hard to read), Sentinel-3, all the ocean and aggregator infrastructure, ESA Third Party Missions (application-gated, research-only — personal hiking won't qualify), Google Earth Engine (works, but you don't need it and it's a heavier dependency than direct COG reads).

---

## Ready-made shortcuts

Don't write snow detection from scratch — [Sentinel Hub's custom scripts library](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel/sentinel-2/) has tested evalscripts for [NDSI](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/ndsi/), a [snow classifier](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/snow_classifier/), [snow cover change detection](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/snow_cover_change/), and a [monthly snow report](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/monthly_snow_report/). Drop them into a CDSE Sentinel Hub configuration and you get WMS tiles rendering snow directly.

**Note for Europe only:** Copernicus HR Snow & Ice publishes [20 m fractional snow cover, daily](https://land.copernicus.eu/api/en/products/snow/fractional-snow-cover) — a finished product that does exactly this. It stops at the Atlantic. In North America you compute it yourself, which is what the tool does.

---

## Validation run — 18 August 2026

`trailcheck.py`, three sites, no credentials, ~20 s each:

**Mt Rainier, WA** — Sentinel-2 scene 23 h old, 4.3% cloud
```
    2300 m   7546 ft  39.4%  #########
    2400 m   7874 ft  54.2%  ############# <-- SNOW LINE
    2500 m   8202 ft  67.4%  ################
>> SNOW LINE ~ 2400 m (7874 ft),  36.8% of area snow-covered
```
Fire: 17 VIIRS detections within 80 km in 24 h; WFIGS shows **Three Queens 3,726 ac at 2% contained** and **Grand Park 2, 167 ac, inside the park**.
SNOTEL: Paradise (5,150 ft, 8 km away) reads 2 in depth / 0.0 in SWE — consistent with sitting ~2,700 ft below the computed snow line.

**Forester Pass, Sierra CA** (PCT high point) — scene 24 h old: 0.1% snow, no continuous snow line. Melted out.

**Logan Pass, Glacier NP MT** — scene 24 h old: 0.5% snow. Melted out.

Three independent sources agreeing — satellite NDSI, a ground sensor, and official fire perimeters — is the thing that makes this trustworthy. Rainier's glaciers correctly show as permanent snow; the two non-glaciated passes correctly show as bare.

---

## How the snow line calculation works

1. STAC query to Earth Search for the newest Sentinel-2 L2A over the bbox with cloud < 30%.
2. Windowed COG reads of **B03 (green, 10 m)**, **B11 (SWIR, 20 m)**, **B08 (NIR)** — only the bytes covering your area, never the whole scene.
3. `NDSI = (B03 − B11) / (B03 + B11)`; snow where **NDSI > 0.42 AND NIR > 0.11**. The NIR test matters — water also has high NDSI, and without it every alpine lake reads as snow.
4. Copernicus DEM GLO-30 read onto the same grid.
5. Snow fraction per 100 m elevation band; the snow line is the lowest band over 50% where every band above stays over 40%. That "everything above too" condition is what stops a single snowy north-facing cirque from producing a bogus reading.

**Known limitations, honestly:**
- NDSI cannot distinguish snow from glacial ice — fine for hiking, both stop you.
- Dense forest canopy hides snow beneath it, so treeline-and-below readings run low.
- Deep shadow in steep north-facing terrain under-detects; the very couloirs that hold snow latest.
- Clouds are the hard limit. If it's been socked in for two weeks, your freshest usable scene is two weeks old.
- The 30 m DEM smooths sharp terrain. Swap in 3DEP 1 m for real routes.

---

## Suggested next steps

1. **Run it against a pass you already know.** Best calibration there is — you know the ground truth.
2. **Add multi-year comparison.** Same location, same calendar week, back 8 years. "Is this year early or late?" is the question that actually drives trip decisions, and no existing tool answers it.
3. **Feed it real GPX.** The tool already accepts `--gpx`; point it at a route file and it reports what fraction sits above the snow line.
4. **Swap the DEM to 3DEP 1 m** for Western US routes — the elevation point service is at `https://epqs.nationalmap.gov/v1/json` and returned 1 m data for Forester Pass on the first try.
5. **Schedule it.** A weekly run against your target passes through the melt season, emailing you when one drops below threshold, is maybe twenty more lines.

---

## Endpoints (all keyless)

```
Sentinel-2 + DEM + NAIP   https://earth-search.aws.element84.com/v1/search
SNOTEL stations/data      https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/{stations,data}
NIFC fire perimeters      https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/
                          WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query
FIRMS VIIRS 24h CSV       https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/
                          csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv
USGS 3DEP elevation       https://epqs.nationalmap.gov/v1/json?x={lon}&y={lat}&units=Meters&wkid=4326
NASA GIBS tiles           https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/...
```

A CDSE account (free) is only needed if you want Sentinel Hub's server-side rendering. For everything above, you don't.

---

## Sources

[CalTopo base layers](https://training.caltopo.com/all_users/base-layers/layers) · [Skurka snowpack tool](https://andrewskurka.com/new-snowpack-tool-satellite-imagery-for-caltopo-gaiagps/) · [Sentinel Hub custom scripts](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel/sentinel-2/) · [NDSI script](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/ndsi/) · [Copernicus HR Snow & Ice](https://land.copernicus.eu/api/en/products/snow/fractional-snow-cover) · [NRCS AWDB web service](https://www.nrcs.usda.gov/sites/default/files/2023-03/AWDB%20Web%20Service%20User%20Guide.pdf) · [NRCS Snow Survey](https://www.nrcs.usda.gov/programs-initiatives/sswsf-snow-survey-and-water-supply-forecasting-program) · [NASA FIRMS API](https://firms.modaps.eosdis.nasa.gov/api/) · [WFIGS current perimeters](https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about) · [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) · [3DEP lidar on AWS](https://registry.opendata.aws/usgs-lidar/) · [Earth Search](https://element84.com/earth-search/) · [SNODAS](https://www.drought.gov/data-maps-tools/snodas-gridded-snow-depth-us) · [MODIS snow cover](https://nsidc.org/data/mod10a1/versions/61)
