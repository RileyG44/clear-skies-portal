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

const potreeRequired=["build/potree/potree.js","build/potree/potree.css","build/potree/workers/EptLaszipDecoderWorker.js","build/potree/workers/laz-perf.wasm","libs/copc/index.js","SOURCE.json"];
for(const asset of potreeRequired){if(!fs.existsSync(path.join(vendor,"potree",asset)))throw new Error(`missing pinned Potree asset: ${asset}`)}
console.log(`synced ${files.length} package assets; verified ${potreeRequired.length} pinned Potree assets`);
