/* ---------------------------------------------------------------- config */
const PC  = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const ES  = "https://earth-search.aws.element84.com/v1/search";
const CDSE= "https://stac.dataspace.copernicus.eu/v1/search";
const TITILER = "https://titiler.xyz/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=";

/* per-collection display metadata: label, ground sample distance (m), sensor kind */
/* vis = how the default rendering looks:
   rgb     natural color, as the human eye would see it
   sar     radar backscatter (greyscale / false composite)
   false   false color or infrared composite
   terrain elevation                                        */
const COLL = {
  "sentinel-2-l2a": {label:"Sentinel-2 L2A",  gsd:10,  kind:"Optical", vis:"rgb"},
  "sentinel-2-c1-l2a":{label:"Sentinel-2 C1", gsd:10,  kind:"Optical", vis:"rgb"},
  "sentinel-1-grd": {label:"Sentinel-1 GRD",  gsd:10,  kind:"SAR",     vis:"sar"},
  "sentinel-1-rtc": {label:"Sentinel-1 RTC",  gsd:10,  kind:"SAR",     vis:"sar"},
  "landsat-c2-l2":  {label:"Landsat 8/9 C2",  gsd:30,  kind:"Optical", vis:"rgb"},
  "landsat-c2-l1":  {label:"Landsat C2 L1",   gsd:30,  kind:"Optical", vis:"rgb"},
  "naip":           {label:"NAIP aerial",     gsd:0.6, kind:"Aerial",  vis:"rgb"},
  "hls2-s30":       {label:"HLS S30 (harmonised)", gsd:30, kind:"Optical", vis:"rgb"},
  "hls2-l30":       {label:"HLS L30 (harmonised)", gsd:30, kind:"Optical", vis:"rgb"},
  "aster-l1t":      {label:"ASTER L1T",       gsd:15,  kind:"VNIR",    vis:"false"},
  "goes-cmi":       {label:"GOES ABI",        gsd:500, kind:"Geostationary", vis:"rgb"},
  "cop-dem-glo-30": {label:"Copernicus DEM",  gsd:30,  kind:"Terrain", vis:"terrain"},
  "NISAR_L2_GCOV_PROVISIONAL_V1_1":{label:"NISAR GCOV (provisional)", gsd:20, kind:"L-band SAR", vis:"sar"},
  "NISAR_L2_GCOV_BETA_V1_1":       {label:"NISAR GCOV (beta)",        gsd:20, kind:"L-band SAR", vis:"sar"}
};
const VIS_LABEL={rgb:"Natural color", sar:"Radar", false:"False color", terrain:"Terrain", night:"Night lights"};

/* GIBS raster layer that renders NISAR L2 GCOV; CMR tells us where/when a granule exists */
const NISAR_GIBS="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance"
                +"/default/{DATE}/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png";

/* GIBS daily global layers - always available, date-addressed */
const GIBS = [
  {id:"VIIRS_NOAA21_CorrectedReflectance_TrueColor", label:"VIIRS NOAA-21 true color", gsd:375, vis:"rgb"},
  {id:"VIIRS_NOAA20_CorrectedReflectance_TrueColor", label:"VIIRS NOAA-20 true color", gsd:375, vis:"rgb"},
  {id:"VIIRS_SNPP_CorrectedReflectance_TrueColor",   label:"VIIRS Suomi-NPP true color", gsd:375, vis:"rgb"},
  {id:"MODIS_Terra_CorrectedReflectance_TrueColor",  label:"MODIS Terra true color", gsd:250, vis:"rgb"},
  {id:"MODIS_Aqua_CorrectedReflectance_TrueColor",   label:"MODIS Aqua true color", gsd:250, vis:"rgb"},
  {id:"VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1", label:"VIIRS NOAA-20 false color (snow/fire)", gsd:375, vis:"false"},
  {id:"MODIS_Terra_CorrectedReflectance_Bands721", label:"MODIS Terra false color (burn/snow)", gsd:250, vis:"false"},
  {id:"VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance", label:"VIIRS NOAA-20 night lights", gsd:750, vis:"night", tms:"GoogleMapsCompatible_Level8"},
  {id:"VIIRS_NOAA21_DayNightBand", label:"VIIRS NOAA-21 night lights", gsd:750, vis:"night", tms:"GoogleMapsCompatible_Level8"},
  {id:"VIIRS_Black_Marble", label:"Black Marble night composite", gsd:500, vis:"night", tms:"GoogleMapsCompatible_Level8", fixed:"2016-01-01"}
];

const SOURCES = [
  {key:"pc",   name:"Microsoft Planetary Computer", api:PC,
   colls:["sentinel-2-l2a","sentinel-1-grd","landsat-c2-l2","naip","hls2-s30","hls2-l30","aster-l1t","cop-dem-glo-30"]},
  {key:"es",   name:"AWS Earth Search (Element 84)", api:ES,
   colls:["sentinel-2-l2a","sentinel-1-grd","landsat-c2-l2","naip","cop-dem-glo-30"]},
  {key:"cdse", name:"Copernicus Data Space", api:CDSE,
   colls:["sentinel-2-l2a","sentinel-1-grd"]},
  {key:"nisar", name:"NISAR (NASA-ISRO L-band SAR)", api:"https://cmr.earthdata.nasa.gov/stac/ASF/search",
   colls:["NISAR_L2_GCOV_PROVISIONAL_V1_1","NISAR_L2_GCOV_BETA_V1_1"]}
];

