"use strict";

const fs=require("fs");
const path=require("path");

const root=path.resolve(__dirname,"..");
require("./build-dnr-runtime.js");
const vendor=path.join(root,"vendor");
fs.mkdirSync(vendor,{recursive:true});

/* site.json lists the vendored browser files; each comes from a package.
   Icons are copied one by one from Lucide, so the shell ships only the
   symbols it uses rather than the library's all-icons runtime. */
const SOURCES=[
  ["vendor/maplibre-gl","node_modules/maplibre-gl/dist/maplibre-gl"],
  ["vendor/leaflet-rotate","node_modules/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate"],
  ["vendor/lerc/","node_modules/lerc/"],
  ["vendor/icons/","node_modules/lucide-static/icons/"],
  ["vendor/fonts/","node_modules/@fontsource-variable/inter/files/"]
];
const synced=require("../site.json").vendor;
for(const target of [...synced,"vendor/lerc/README.md"]){
  const [prefix,source]=SOURCES.find(([prefix])=>target.startsWith(prefix));
  fs.mkdirSync(path.dirname(path.join(root,target)),{recursive:true});
  fs.copyFileSync(path.join(root,source+target.slice(prefix.length)),path.join(root,target));
}

/* Inter stands in for SF Pro where the system does not provide it. SF Pro's
   licence limits it to Apple platforms, so it cannot be shipped; Apple devices
   resolve -apple-system first and never download this file. One variable
   Latin face covers every weight the interface uses. */
const fontDir=path.join(vendor,"fonts");
fs.copyFileSync(path.join(root,"node_modules/@fontsource-variable/inter/LICENSE"),path.join(fontDir,"Inter-LICENSE.txt"));

const potreeRequired=["build/potree/potree.js","build/potree/potree.css","build/potree/workers/EptLaszipDecoderWorker.js","build/potree/workers/laz-perf.wasm","libs/copc/index.js","SOURCE.json"];
for(const asset of potreeRequired){if(!fs.existsSync(path.join(vendor,"potree",asset)))throw new Error(`missing pinned Potree asset: ${asset}`)}
console.log(`synced ${synced.length} vendored browser files; verified ${potreeRequired.length} pinned Potree assets`);
