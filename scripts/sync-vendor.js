"use strict";

const fs=require("fs");
const path=require("path");

const root=path.resolve(__dirname,"..");
const vendor=path.join(root,"vendor");
fs.mkdirSync(vendor,{recursive:true});

const files=[
  ["node_modules/maplibre-gl/dist/maplibre-gl.mjs","maplibre-gl.mjs"],
  ["node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs","maplibre-gl-shared.mjs"],
  ["node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs","maplibre-gl-worker.mjs"],
  ["node_modules/maplibre-gl/dist/maplibre-gl.css","maplibre-gl.css"],
  ["node_modules/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate.umd.min.js","leaflet-rotate.umd.min.js"]
];

for(const [source,target] of files)
  fs.copyFileSync(path.join(root,source),path.join(vendor,target));

/* Keep the interface icon set local and tiny. Lucide is the source library,
   but shipping its all-icons runtime for a small navigation set
   would slow the very first paint for no benefit. The build copies only the
   audited symbols used by the portal shell. */
const iconNames=[
  "arrow-left","chevron-down","chevron-right","chevron-up","cloud-sun","download","history","image",
  "layers","map-pinned","mountain-snow","radio","rotate-ccw","satellite","scan-search",
  "search","settings-2","sliders-horizontal","tags","triangle-alert"
];
const iconDir=path.join(vendor,"icons");
fs.mkdirSync(iconDir,{recursive:true});
for(const name of iconNames)
  fs.copyFileSync(path.join(root,"node_modules/lucide-static/icons",`${name}.svg`),path.join(iconDir,`${name}.svg`));

const potreeRequired=["build/potree/potree.js","build/potree/potree.css","build/potree/workers/EptLaszipDecoderWorker.js","build/potree/workers/laz-perf.wasm","libs/copc/index.js","SOURCE.json"];
for(const asset of potreeRequired){if(!fs.existsSync(path.join(vendor,"potree",asset)))throw new Error(`missing pinned Potree asset: ${asset}`)}
console.log(`synced ${files.length} package assets and ${iconNames.length} interface icons; verified ${potreeRequired.length} pinned Potree assets`);
