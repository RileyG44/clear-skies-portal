# Satellite Imagery Source Catalog
### Free & openly-licensed data sources for a "freshest image of any point on Earth" portal

**Compiled:** 18 August 2026 · **Status:** research pass 1 — endpoints verified against primary docs where noted

---

## 0. The honest baseline (read this first)

Before the catalog, the constraint that shapes the whole product:

**There is no free source that gives you a recent high-resolution image of an arbitrary point on Earth.** Freshness and resolution trade off hard, and the trade is a physical/economic one, not an access one:

| Freshness | Best free resolution | What you actually get |
|---|---|---|
| 5–15 minutes | 500 m – 2 km | Geostationary weather imagers (GOES, Himawari, Meteosat, GK-2A, FY-4) |
| 3–12 hours | 250 m – 1 km | VIIRS / MODIS near-real-time (NASA LANCE) |
| 0–3 days | **10 m** | **Sentinel-2** (optical, cloud-limited) + **Sentinel-1** (SAR, all-weather) |
| 0–8 days | 30 m | Landsat 8/9 |
| Weeks–months | 30 cm – 5 m | Episodic only: disaster activations (Vantor/Maxar), SAR open data (Umbra, ICEYE, Capella) |
| 1–5 years | 7.5 cm – 1 m | National aerial orthophoto programs (country-dependent) |

So the portal's core promise should be framed as **"the most recent image available, at the best resolution available, from every source we can legally serve"** — and the UI should be explicit about the age/resolution tradeoff rather than hiding it. The genuinely differentiated product is the *fusion + ranking layer*, not any single feed.

**The workhorse pair is Sentinel-2 + Sentinel-1.** Everything else is either coarser-but-faster, or sharper-but-rarer. Build the spine on those two, then layer.

---

## 1. Tier A — Global systematic missions (the backbone)

Continuously tasked, whole-Earth coverage, permanently free, API-accessible. These are what guarantee you can answer *any* lat/lon query.

### 1.1 Copernicus Sentinel-2 (optical) — **primary optical source**
- **What:** 13-band MSI; 10 m (RGB+NIR), 20 m (red-edge/SWIR), 60 m (atmospheric)
- **Constellation (Aug 2026):** Sentinel-2A, 2B, 2C operational (2C replaced 2A as primary Jan 2025; 2A returned to a 36°-offset orbit Mar 2025). 2D planned.
- **Revisit:** 5 days at equator with 2 sats; **2–3 days at mid-latitudes**; better with the 3-sat configuration
- **Latency:** L1C/L2A typically published within ~24 h of sensing (NTC)
- **License:** Copernicus free, full and open — commercial redistribution permitted with attribution
- **Access:** CDSE STAC / OData / OpenSearch / S3 · AWS `sentinel-s2-l2a-cogs` (Earth Search) · Planetary Computer · GEE
- **Portal role:** default "most recent optical image" for the overwhelming majority of queries

### 1.2 Copernicus Sentinel-1 (SAR) — **primary all-weather source**
- **What:** C-band SAR, IW mode 5×20 m (10 m pixel spacing), GRD + SLC
- **Constellation (Aug 2026):** 1A, 1C, 1D. **Sentinel-1D open data since 17 Apr 2026.** Late June 2026 reconfiguration set the final **6-day revisit between 1C and 1D**; 1A phasing out from early July 2026.
- **Latency:** **NRT products < 3 hours** after acquisition
- **License:** Copernicus free, full and open
- **Access:** CDSE (incl. SLC Bursts API) · ASF DAAC / Vertex · AWS · Planetary Computer · Earth Search
- **Portal role:** the answer when the target is cloud-covered or in polar night — critical, because ~67% of Earth is cloudy at any instant. **This is the single biggest differentiator vs. naive competitors.**

### 1.3 Landsat 8 & 9 (USGS/NASA)
- **What:** OLI/TIRS; 30 m multispectral, **15 m panchromatic** (pan-sharpen to 15 m RGB), 100 m thermal
- **Revisit:** 16 days each, **8 days combined**
- **Latency:** Real-Time tier within hours; Tier 1 within ~2–3 weeks after reprocessing
- **License:** US public domain
- **Access:** USGS M2M API · LandsatLook STAC (`https://landsatlook.usgs.gov/stac-server`) · AWS `usgs-landsat` (requester-pays) · Earth Search · Planetary Computer
- **Note:** Landsat Next (~2030/31) will bring 26 bands and a 6-day revisit across 3 observatories.
- **Portal role:** independent cross-check + thermal band + the 40-year archive for "how has this changed"

### 1.4 Sentinel-3 OLCI / SLSTR
- 300 m OLCI, 500–1000 m SLSTR incl. thermal; **sub-daily to 2-day revisit; NRT < 3 h**
- Free/open via CDSE. Portal role: daily true-colour fill and fire/thermal anomalies at regional scale.

### 1.5 NASA VIIRS (NOAA-20/21, Suomi-NPP) & MODIS (Terra/Aqua)
- **VIIRS:** 375 m I-bands / 750 m M-bands, ~daily + night (Day-Night Band)
- **MODIS:** 250/500/1000 m, twice-daily (Terra ageing)
- **Latency:** LANCE NRT **~3 hours**; FIRMS "Ultra Real-Time" active-fire detections in **~60 seconds to a few minutes**
- **License:** US public domain. **Access:** NASA GIBS (rendered tiles, no auth), LAADS/LANCE, CMR, FIRMS API
- **Portal role:** the "something is happening right now" layer — fires, smoke, floods, dust — at any location, today.

### 1.6 CBERS-4 / 4A and Amazonia-1 (INPE Brazil / CAST China)
- CBERS-4 MUX 20 m, PAN 5 m; CBERS-4A WPM **2 m pan / 8 m MS**; Amazonia-1 WFI 64 m
- Free, global-ish (best over South America, Africa, China); **AWS `cbers-pds` / `amazonia-pds` with STAC**
- Portal role: cheapest route to sub-5 m free optical in the Americas.

### 1.7 Also in this tier (secondary, mostly derived or specialised)
| Mission | Res / cadence | Access |
|---|---|---|
| Sentinel-5P (TROPOMI) | 3.5×5.5 km, daily, NRT <3 h | CDSE — atmospheric, not imagery |
| ALOS-2 / PALSAR-2 mosaics (JAXA) | 25 m L-band SAR, annual | JAXA EORC, DE Africa on AWS |
| ASTER (Terra) | 15/30/90 m, on-demand | LP DAAC, AWS `astraea-opendata` |
| RADARSAT-1 archive | 8–100 m SAR, 1996–2008 | AWS open data (CSA) |
| RCM CEOS ARD | C-band SAR, Canada | AWS open data |
| ESA WorldCover / composites | 10 m annual mosaics | AWS, S3 — derived product |

---

## 2. Tier B — Geostationary: the "right now" layer

Coarse but *continuous*. For a portal promising "most current," this is what fills the gap between satellite passes — and it's genuinely near-live.

| Satellite | Operator | Coverage | Cadence | Resolution | Free access |
|---|---|---|---|---|---|
| **GOES-19** (GOES-East) | NOAA | Americas / Atlantic | 10 min full disk, 5 min CONUS, **30–60 s mesoscale** | 0.5 km VIS, 2 km IR | AWS `noaa-goes19` (+ GCP, Azure), no auth |
| **GOES-18** (GOES-West) | NOAA | Pacific / W. Americas | same | same | AWS `noaa-goes18` |
| **Himawari-9** | JMA | E. Asia / Oceania | 10 min full disk, 2.5 min regional | 0.5–2 km | AWS `noaa-himawari` |
| **Meteosat-12 / MTG-I1** | EUMETSAT | Europe / Africa | **10 min FDSS** (FCI) | 0.5–2 km | EUMETSAT Data Store API (free registration) |
| **Meteosat-9/10/11** | EUMETSAT | Europe/Africa, Indian Ocean | 15 min | 1–3 km | EUMETSAT Data Store |
| **GK-2A** | KMA | E. Asia | 10 min | 0.5–2 km | NMSC portal (free reg.) |
| **FY-4B / FY-4C** | CMA | Asia-Pacific | 15 min | 0.5–4 km | NSMC portal (free reg.) |
| **INSAT-3D/3DR/3DS** | ISRO | Indian Ocean | 15–30 min | 1–4 km | MOSDAC (free reg.) |
| **NOAA GMGSI** | NOAA | **Global mosaic** | hourly | 4–8 km | AWS `noaa-gmgsi` — one call, whole planet |

**Portal role:** every location on Earth has an image less than 15 minutes old. Present it as the "live" tab. GMGSI is the cheapest global fallback; per-satellite feeds give the good resolution.

---

## 3. Tier C — High-resolution free & open (episodic)

This is where "highest quality image sourcing" actually comes from — but coverage is opportunistic, not systematic. Treat these as a **sparse overlay index**, not a queryable global layer.

### 3.1 Vantor (formerly Maxar) Open Data Program
- **30–50 cm** optical, pre- and post-event, ARD (COG + STAC)
- Released on **disaster activations** — earthquakes, floods, hurricanes, wildfires, conflict
- **S3:** `s3://maxar-opendata` (us-west-2), STAC catalog included
- **License: CC-BY-NC-4.0 — NON-COMMERCIAL.** ⚠️ This is a real constraint if the portal is ever monetised. Flag it in the data model.

### 3.2 Umbra Open Data
- **25 cm / 35 cm / 50 cm / 1 m SAR** spotlight collects (GEC, SICD, SIDD, CPHD)
- ~20 locations refreshed **weekly**, 1000+ locations imaged total
- `s3://umbra-open-data-catalog` + STAC browser at `open-data.umbra.space` · **no sign-up**
- **License: CC-BY-4.0** ✅ commercial-friendly. Best free sub-metre source that exists.

### 3.3 ICEYE Open Data Initiative
- SAR: SLC, GRD, COG · map browser + STAC browser + AWS Registry
- **"No registration. No paywall."** Flood/disaster focus.

### 3.4 Capella Space SAR Open Dataset
- Sub-metre to 1 m X-band SAR sample set · AWS Registry of Open Data · STAC

### 3.5 Wyvern Open Data
- **5.3 m hyperspectral, 23–110+ bands** · `opendata.wyvern.space` · **CC-BY-4.0**
- Niche but unique: no other free source gives hyperspectral at this GSD.

### 3.6 Satellogic EarthView
- ~1 m multispectral open dataset, `s3://satellogic-earthview` + HuggingFace mirror
- ML-training oriented (chips, not full scenes) — good for model work, weak for portal display.

### 3.7 ESA Third Party Missions / Copernicus Contributing Missions
- **Free-of-charge access to VHR commercial archives** (Pléiades, SPOT, PlanetScope, WorldView, KOMPSAT, Deimos, RapidEye, IRS and more) for approved users
- Portals: `tpm-ds.eo.esa.int` (Online Dissemination), ESA Earth Online, CDSE Contributing Missions collection
- ⚠️ Access is **application-gated and typically research/institutional-use-only**; redistribution is restricted. High value for internal quality benchmarking, risky as a portal-served layer.

### 3.8 SpaceNet, RarePlanes, Radiant MLHub
- Labelled VHR training datasets. Not a live source — relevant if you build automated change detection.

### 3.9 Programs that have **ended** — do not plan around them
- **Planet NICFI** (4.7 m tropical basemaps, free since 2020): contract expired early 2025, phased out from April 2025, and Norway **cancelled the next-phase procurement in September 2025.** Replacement is paid (Planet Tropical Forest Observatory ~$180/mo). Many blog listicles still list NICFI as free — they are stale.

---

## 4. Tier D — Aerial & national orthophoto (highest resolution, where it exists)

For populated areas in wealthy countries, national aerial programs beat *every* free satellite source by an order of magnitude — 7.5–25 cm vs 10 m. Refresh is 1–5 years, so these are the "best quality" answer, never the "most current" answer. Serve both.

| Program | Country | Resolution | Cadence | Access |
|---|---|---|---|---|
| **NAIP** | USA | 30–60 cm | 1–3 yr by state | AWS `naip-source` (req.-pays), Earth Search STAC, TNM |
| **USGS High-Res Ortho / 3DEP** | USA | 15–30 cm | varies | The National Map API |
| **NOAA Digital Coast** | US coasts | 10–50 cm | post-storm + program | `coast.noaa.gov` |
| **IGN BD ORTHO** | France | 20 cm | 3 yr | `geoservices.ign.fr` WMTS, open licence |
| **PDOK Luchtfoto** | Netherlands | **7.5–25 cm** | **annual** | PDOK WMTS/WMS, CC-BY |
| **Kartverket / Norge i bilder** | Norway | 10–50 cm | rolling | Kartverket APIs |
| **LINZ / NZ Imagery** | New Zealand | 10–75 cm | rolling | **AWS `nz-imagery`** open licence, STAC |
| **swisstopo SWISSIMAGE** | Switzerland | 10–25 cm | 3 yr | swisstopo STAC API, open |
| **PNOA** | Spain | 25–50 cm | 2–3 yr | IGN España WMS |
| **Lantmäteriet / MML / Maa-amet** | SE / FI / EE | 25–50 cm | 2–3 yr | national WMTS, open data |
| **DOP / state ortho** | Germany | 20–40 cm | 1–3 yr | per-Land WMS; several fully open |
| **Ordnance Survey / EA** | UK | 12.5–25 cm | varies | OS Open + EA LiDAR/aerial (OGL) |
| **GSI Japan** | Japan | 20–50 cm | rolling | GSI Tiles (`cyberjapandata`) |
| **NRCan / Geo.ca** | Canada | varies | varies | open licence |
| **Geoscape / state imagery** | Australia | 10–50 cm | annual (metro) | state WMTS, mixed licence |
| **OpenAerialMap** | Global (sparse) | **2–20 cm** | ad hoc | `api.openaerialmap.org`, OAM STAC, AWS — drone/aerial, open licences |

**Portal role:** a "best available resolution" mode alongside "most recent." Build a country→provider routing table; this is unglamorous integration work but it's the single biggest visible-quality win in the product.

---

## 5. Tier E — Aggregators & catalogs (your integration layer)

You will not integrate 40 providers one by one. You integrate ~6 catalogs that each front many datasets.

### 5.1 Copernicus Data Space Ecosystem (CDSE) — **anchor integration**
The service behind the browser link you sent. Single free account, many APIs:

| API | Purpose | Notes |
|---|---|---|
| **STAC** | `https://stac.dataspace.copernicus.eu/v1` — modern catalog search | preferred for new builds |
| **OData** | product metadata + download | `catalogue.dataspace.copernicus.eu/odata/v1` |
| **OpenSearch** | legacy catalog search | |
| **Sentinel Hub** | **on-the-fly processing, WMS/WMTS tiles, statistics** | this is the one that makes a *fast portal* possible |
| **openEO** | reproducible processing graphs | |
| **S3** | bulk parallel object access | |
| **Catalog Subscriptions** | push notification on new products | **use this to keep a "freshest" index warm** |
| **Sentinel-1 SLC Bursts** | burst-level SAR access | |
| **On-Demand Production** | CARD-BS, CARD-COH6/12 | |

**Free-tier quotas (verified):**
- 10,000–50,000 API requests/month (varies by service)
- **10,000 Sentinel Hub Processing Units/month**; 10,000 openEO credits/month
- Rate: Sentinel Hub 300 req/min & 300 PU/min · S3/OData 2,000 req/min · openEO 12 req/min
- Transfer: **12 TB / rolling 30 days**; 4 concurrent S3/OData connections @ 20 MB/s
- Data Workspace: 25 processed products, 0.1 TB transfer/month
- Tokens valid 10 min, refresh window 60 min, 100 active sessions

> ⚠️ **10,000 PU/month is the binding constraint on a public portal.** A single 512×512 true-colour tile request costs ~1/3 PU at 10 m. Budget it: roughly ~30k tiles/month before you're out. Plan for a caching tier from day one, and price out CDSE commercial credits or self-hosted Sentinel Hub before launch.

### 5.2 Element 84 Earth Search v1 — **fastest thing to prototype against**
- `https://earth-search.aws.element84.com/v1` · **no auth, no key**
- Collections: Sentinel-2 L1C, L2A, Sentinel-2 C1 L2A, Sentinel-1 GRD, Landsat C2 L2, NAIP, Copernicus DEM 30/90
- ⚠️ "This public API does not come with any guaranteed service" — **best-effort, no SLA.** Fine for dev, not for production load. Element 84's FilmDrop is the commercial path.

### 5.3 Microsoft Planetary Computer
- STAC API + data API with signed asset URLs; ~120 datasets (Sentinel, Landsat, NAIP, MODIS, ESA WorldCover, ALOS, Copernicus DEM…)
- Free anonymous read; a token-signing step for some assets. Note Microsoft has been steering new work toward *Planetary Computer Pro* (Azure paid) — **verify the free public STAC's long-term commitment before you make it load-bearing.**

### 5.4 AWS Registry of Open Data
- Not an API — a directory of ~55+ satellite-imagery buckets (plus hundreds of other datasets), many with their own STAC. Sentinel-2, Landsat, GOES, Himawari, CBERS, Amazonia, Maxar, Umbra, Capella, ICEYE, Satellogic, NZ Imagery, Digital Earth Africa, ArcticDEM/REMA/EarthDEM, RADARSAT-1, ASTER, SpaceNet…
- **Watch requester-pays buckets** (Landsat, NAIP) — egress costs land on you. Co-locating compute in `us-west-2` is the standard mitigation.

### 5.5 NASA Earthdata
- **CMR** (`cmr.earthdata.nasa.gov`) — catalog across all NASA DAACs; **CMR-STAC** wrapper available
- **GIBS** — see §6, rendered tiles, no auth
- **LANCE** — NRT products; **FIRMS API** — active fire, ultra-real-time
- **ASF DAAC / Vertex + ASF Search API** — the best SAR search (Sentinel-1, ALOS, RADARSAT, NISAR)
- Earthdata Login (free) required for most downloads.

### 5.6 USGS
- **M2M API** (`m2m.cr.usgs.gov/api`) — full EarthExplorer programmatic access, free ERS account
- **LandsatLook STAC** (`landsatlook.usgs.gov/stac-server`) — Landsat C2 with COG assets

### 5.7 Regional data cubes
- **Digital Earth Africa** — STAC (`explorer.digitalearth.africa/stac`) + OWS (`ows.digitalearth.africa`); ARD Sentinel-1/2, Landsat, ALOS
- **Digital Earth Australia** — DEA Knowledge Hub STAC + `ows.dea.ga.gov.au`
- **Digital Earth Pacific** — AWS Open Data
- **Brazil Data Cube (INPE)** — STAC, CBERS/Landsat/Sentinel cubes over Brazil
- **Euro Data Cube / CREODIAS / WEkEO / Sentinel Hub instances** — DIAS platforms fronting Copernicus

### 5.8 STAC Index — `stacindex.org`
Community directory of public STAC catalogs and APIs (hundreds). **Use it as a crawler seed list**: a scheduled job that walks STAC Index and auto-registers new conformant catalogs would make the portal's source coverage grow without manual work. This is a strong, cheap differentiator.

### 5.9 Google Earth Engine — ⚠️ **licensing landmine**
- Enormous catalog (900+ datasets), excellent for analysis
- **Free only for noncommercial/research/education.** Any commercial portal needs a paid Google Cloud EE licence, and EE's terms constrain serving raw imagery to third parties.
- **Recommendation: do not put GEE on the portal's serving path.** Use it, if at all, for internal R&D.

---

## 6. Tier F — Rendered tile services (the fast visual layer)

Pre-rendered tiles you can put straight into MapLibre/Leaflet without processing pixels yourself.

| Service | Endpoint pattern | Auth | Notes |
|---|---|---|---|
| **NASA GIBS WMTS** | `https://gibs.earthdata.nasa.gov/wmts/epsg{3857\|4326\|3413\|3031}/{best\|nrt\|std\|all}/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.{fmt}` | **none** | 1000+ layers, NRT endpoints, 4 projections, WMS + TWMS too. **Best free "just works" NRT basemap on the planet.** |
| **CDSE Sentinel Hub OGC** | WMS/WMTS/WCS per configuration instance | OAuth | on-the-fly S2/S1 rendering, any date, any band combo — costs PUs |
| **EOX Sentinel-2 cloudless** | `maps.eox.at` WMTS | none | annual cloudless mosaics 2016, 2018–2025; **demo service, attribution required, commercial use needs an EOX agreement** |
| **Esri World Imagery + Wayback** | ArcGIS REST tile service | key for most uses | best-available VHR mosaic + versioned archive since 2014. ⚠️ **ToS prohibits bulk caching/redistribution** |
| **Bing / Google / Mapbox satellite** | vendor tile APIs | key, paid | ⚠️ **ToS forbids scraping, caching and re-serving.** Do not build on these. |
| **OpenAerialMap tiles** | per-image TMS from OAM API | none | open-licensed drone/aerial |
| **NOAA nowCOAST / GOES imagery** | WMS | none | NRT geostationary rendered |

---

## 7. Licensing: the three buckets your data model must encode

Every source record needs a machine-readable rights field. Three tiers:

1. **✅ Serve freely, commercially, forever** — Copernicus (all Sentinels), USGS/NASA public domain, CC-BY-4.0 (Umbra, Wyvern, ICEYE), CC0, most national open orthophoto licences, ODbL (OpenAerialMap, with share-alike care). *Requirement: attribution strings, per-source, rendered in the UI.*
2. **⚠️ Free but non-commercial or gated** — **Vantor/Maxar CC-BY-NC-4.0**, ESA Third Party Missions (application-gated, restricted redistribution), EOX demo tiles, Google Earth Engine noncommercial tier. *These can be shown in a free/research mode but become a liability the day you monetise. Gate them behind a flag from day one — retrofitting this is painful.*
3. **🚫 Do not build on** — Google/Bing/Mapbox/Esri basemap tiles for anything beyond permitted in-app display; any "free" scraping of a commercial viewer.

---

## 8. Recommended build sequence

**Phase 1 — Prove the core loop (weeks 1–3)**
Earth Search v1 (no auth) + NASA GIBS (no auth). Point → STAC `/search` with a bbox and a descending-datetime sort → return the most recent Sentinel-2 and Sentinel-1 item → render. This validates the whole product thesis with zero credentials.

**Phase 2 — Production spine (weeks 3–8)**
CDSE account; Sentinel Hub Process API for rendering; **Catalog Subscriptions** to maintain a warm index of newest products rather than polling; a tile cache (a COG + TiTiler stack, or pre-rendered) so PU spend doesn't scale with traffic. Add Landsat via LandsatLook STAC.

**Phase 3 — Freshness layer (weeks 6–10)**
Geostationary: GOES-19/18 + Himawari-9 + Meteosat-12 + GMGSI global mosaic. VIIRS/MODIS NRT via GIBS. This is what lets you say "imagery from 8 minutes ago" for any point — a headline claim nothing else free gives you.

**Phase 4 — Resolution layer (weeks 8–16)**
Country→provider routing table for national orthophotos (start: US NAIP, NL, FR, CH, NZ, NO, JP — all clean licences and good APIs). Then the sparse VHR index: Umbra, ICEYE, Capella, Vantor (NC-flagged), OpenAerialMap.

**Phase 5 — The moat**
A STAC Index crawler that auto-discovers and registers new conformant catalogs; a per-pixel "best available" ranker scoring recency × resolution × cloud cover × licence-tier; and cloud-aware fusion that automatically falls back to SAR when optical is obscured.

**Key architectural call:** normalise **everything** to STAC internally, even sources that don't speak it (write thin adapters for GIBS, EUMETSAT, national WMTS, M2M). One item schema, one ranker, one renderer. Sources become plugins.

---

## 9. Open questions to resolve before committing architecture

1. **Commercial or not?** This single answer determines whether Maxar/Vantor, ESA TPM, EOX and GEE are in or out — roughly a third of the high-resolution catalog.
2. **Serve pixels or link out?** Serving raw imagery makes CDSE PU quota and AWS egress your dominant cost. Linking to provider viewers is nearly free but a much weaker product.
3. **Global uniform coverage, or best-effort with honest gaps?** Sub-metre free coverage will always be patchy; the UI should probably surface "best available here" rather than pretend uniformity.
4. **Latency SLA?** "Most current" means something different at 15 minutes (geostationary) vs 24 hours (Sentinel-2). Pick a headline number and design the index around it.

---

---

## 9b. Live validation run (18 Aug 2026)

I ran the Phase-1 loop for real against Earth Search v1 (no auth, ~1 s per query) — newest Sentinel-2 L2A and Sentinel-1 GRD at four test points:

| Location | Sentinel-2 age | Cloud | Sentinel-1 age |
|---|---|---|---|
| Kraków, PL (your browser link) | **56 h** | 0.08% | **26 h** |
| Sahara (23.4N, 12.5E) | 56 h | 0% | 193 h |
| Mid-Pacific (15S, 140W) | 23 h | 34% | **4.2 years** |
| Svalbard (78.2N, 15.6E) | **5.5 h** | 34% | 12.5 h |

Four findings that should shape the design:

1. **The core loop works today with zero credentials.** A STAC POST with a point geometry sorted by `-datetime` returns the freshest scene in about a second. Build Phase 1 immediately.
2. **Typical mid-latitude freshness is 1–3 days for optical, often better for SAR.** That's the number to put on the marketing page — not "real time."
3. **High latitudes are dramatically fresher** (5.5 h at Svalbard) because of converging polar orbits. Freshness is a strong function of latitude; the UI should reflect that rather than quoting one global number.
4. **⚠️ Open ocean is effectively uncovered by Sentinel-1** — the newest mid-Pacific GRD was from 2022, because S-1 doesn't routinely acquire over open water. For ~70% of Earth's surface, the SAR fallback silently isn't there, and optical over ocean is often just cloud. **Decide early how the portal handles maritime queries** — geostationary + Sentinel-3 are the honest answer there, at kilometre scale.

Reproduce with `probe.py` in this workspace.

---

## Sources

Copernicus: [Data Space Ecosystem](https://dataspace.copernicus.eu/), [APIs](https://documentation.dataspace.copernicus.eu/APIs.html), [Quotas](https://documentation.dataspace.copernicus.eu/Quotas.html), [Sentinel-2 docs](https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html), [Sentinel-1D opening](https://dataspace.copernicus.eu/news/2026-4-2-sentinel-1d-user-data-opening-and-future-plans), [S-1 orbital reconfiguration](https://dataspace.copernicus.eu/news/2026-5-28-sentinel-1-orbital-reconfiguration-dates), [Contributing Missions](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions), [CDSE STAC browser](https://browser.stac.dataspace.copernicus.eu/) · [Sentinel timeliness (CREODIAS)](https://creodias.eu/cases/timeliness-and-frequency-of-sentinel-satellite-products-explained/)

NASA/USGS: [GIBS access basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/), [GIBS API](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api), [LANCE](https://www.earthdata.nasa.gov/data/projects/lance), [FIRMS](https://firms.modaps.eosdis.nasa.gov/), [FIRMS ultra-real-time](https://www.earthdata.nasa.gov/news/feature-articles/firms-adds-ultra-real-time-data-from-modis-viirs), [Sentinel-1D at ASF](https://www.earthdata.nasa.gov/data/alerts-outages/sentinel-1d-data-available-download-asf-daac), [LandsatLook STAC](https://landsatlook.usgs.gov/stac-server/api.html), [Landsat Data Access](https://www.usgs.gov/landsat-missions/landsat-data-access), [Landsat Next](https://science.nasa.gov/mission/landsat/landsat-next/)

Catalogs: [Earth Search](https://element84.com/earth-search/), [Earth Search repo](https://github.com/Element84/earth-search), [Planetary Computer STAC](https://stacindex.org/catalogs/microsoft-pc), [AWS Registry of Open Data — satellite imagery](https://registry.opendata.aws/tag/satellite-imagery/), [STAC Index catalogs](https://stacindex.org/catalogs), [Digital Earth Africa OWS](https://ows.digitalearth.africa/), [DEA Knowledge Hub STAC](https://knowledge.dea.ga.gov.au/notebooks/How_to_guides/Downloading_data_with_STAC/), [Digital Earth Pacific](https://github.com/digitalearthpacific/data-access)

Open data programs: [Umbra Open Data](https://umbra.space/open-data/), [Umbra on AWS](https://registry.opendata.aws/umbra-open-data/), [Umbra catalog](https://open-data.umbra.space/browse/), [ICEYE Open Data](https://www.iceye.com/open-data-initiative), [Capella on AWS](https://registry.opendata.aws/capella_opendata/), [Maxar Open Data on AWS](https://registry.opendata.aws/maxar-open-data/), [Vantor Open Data Program](https://vantor.com/company/open-data-program/), [Wyvern Open Data](https://wyvern.space/open-data/), [Satellogic EarthView](https://registry.opendata.aws/satellogic-earthview/), [Open Data Directory 2026](https://spacefromspace.com/blog/the-open-data-directory-list-of-open-satellite-data-2026/)

Geostationary: [NOAA GOES on AWS](https://registry.opendata.aws/noaa-goes/), [GOES-19 operational](https://www.noaa.gov/news-release/noaas-goes-19-satellite-now-operational-providing-critical-new-data-to-forecasters), [GOES operational status](https://www.nesdis.noaa.gov/our-satellites/satellites-status/goes-operational-status), [Himawari on AWS](https://registry.opendata.aws/noaa-himawari/), [NOAA GMGSI](https://registry.opendata.aws/noaa-gmgsi/), [NOAA open data datasets](https://www.noaa.gov/nodd/datasets)

Aerial / tiles / other: [OpenAerialMap](https://openaerialmap.org/), [EOX::Maps](https://maps.eox.at/), [Sentinel-2 cloudless](https://cloudless.eox.at/), [Kartverket APIs](https://www.kartverket.no/en/api-and-data), [ESA Third Party Missions](https://earth.esa.int/eogateway/missions/third-party-missions), [ESA TPM Online Dissemination](http://tpm-ds.eo.esa.int/), [Google Earth Engine noncommercial](https://earthengine.google.com/noncommercial/), [GEE pricing](https://cloud.google.com/earth-engine/pricing), [EOS free imagery guide](https://eos.com/blog/free-satellite-imagery-sources/), [NICFI program end](https://nimbo.earth/stories/end-nicfi-satellite-tropical-forest-monitoring-alternative/)
