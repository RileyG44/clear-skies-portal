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

console.log(`synced ${files.length} browser renderer assets`);
