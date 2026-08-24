"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname,"..");
const read = name => fs.readFileSync(path.join(root,name),"utf8");

const index = read("index.html");
const inline = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert(inline.length>=2,"expected Leaflet and application inline scripts");
inline.forEach((match,i)=>new vm.Script(match[1],{filename:`index.html#inline-${i+1}`}));

// Exercise the STAC normalizer as JavaScript, not just as parsed source. This
// catches accidental cross-function locals (for example nativeMax) that only
// fail when a real catalog feature is normalized in the browser.
function namedFunction(source,name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  const body=source.indexOf("{",start);
  let depth=0, quote=null, escaped=false;
  for(let i=body;i<source.length;i++){
    const ch=source[i];
    if(quote){
      if(escaped) escaped=false;
      else if(ch==="\\") escaped=true;
      else if(ch===quote) quote=null;
      continue;
    }
    if(ch==='"'||ch==="'"||ch==='`'){ quote=ch; continue; }
    if(ch==="{") depth++;
    else if(ch==="}" && --depth===0) return source.slice(start,i+1);
  }
  throw new Error(`unterminated function ${name}`);
}
const normSandbox={
  COLL:{"sentinel-2-l2a":{label:"Sentinel-2",gsd:10,kind:"Optical"}},
  LOC:null, TITILER:"https://example.invalid/", NISAR_GIBS:"",
  safeHttpUrl:value=>value||null
};
vm.runInNewContext(`${namedFunction(index,"norm")}; normalized=norm({
  id:"scene-1", collection:"sentinel-2-l2a", bbox:[-122,46,-121,47],
  geometry:{type:"Polygon",coordinates:[]},
  properties:{datetime:"2026-08-22T12:00:00Z","eo:cloud_cover":4}, assets:{}
},{key:"pc",name:"Planetary Computer"});`,normSandbox,{filename:"index.html#norm-test"});
assert.equal(normSandbox.normalized.nativeMax,null,"ordinary STAC scenes default nativeMax to null");

new vm.Script(read("sw.js"),{filename:"sw.js"});
new vm.Script(read("mosaic-core.js"),{filename:"mosaic-core.js"});
const versionSandbox={};
vm.runInNewContext(read("version.js"),versionSandbox,{filename:"version.js"});
assert.match(versionSandbox.CSP_BUILD,/^\d{4}-\d{2}-\d{2}[a-z]$/,"build version must be date plus revision letter");
assert(index.includes(`<script src="version.js?build=${versionSandbox.CSP_BUILD}"></script>`),
       "page must cache-bust and load the shared build version");
assert(index.includes('<script src="mosaic-core.js"></script>'),"index must load the tested mosaic core");
assert(read("sw.js").includes(`const CSP_BUILD = "${versionSandbox.CSP_BUILD}";`),
       "service worker cache namespace must use the page build version");
assert(index.includes('register("sw.js",{updateViaCache:"none"})'),
       "service-worker imports must bypass stale HTTP cache during update checks");
assert(index.includes('id="snapshot"'),"map snapshot control must be present");
assert(index.includes('getDisplayMedia'),"map snapshot control must use browser surface capture");
assert(index.includes('body.print-map'),"map snapshot control must have a print fallback");
assert(index.includes('id="srvConnect"'),"terrain engine needs an explicit connect control");
assert(index.includes('id="srvCopyLink"'),"terrain engine needs a private setup-link control");
assert(index.includes('takeSharedServerBase'),"private setup links must be consumed from URL fragments");
assert(index.includes('id="elevSpan"'),"elevation spectrum needs a configurable colour span");
const elevSandbox={};
vm.runInNewContext(`${namedFunction(index,"elevRampRgb")}; center=elevRampRgb(500,500,300); lower=elevRampRgb(200,500,300); upper=elevRampRgb(800,500,300);`,elevSandbox,{filename:"index.html#elevation-spectrum-test"});
assert.deepEqual(Array.from(elevSandbox.center),[247,247,242],"reference elevation must be white");
assert(elevSandbox.lower[0]>elevSandbox.lower[2],"lower elevations must trend red");
assert(elevSandbox.upper[2]>elevSandbox.upper[0],"higher elevations must trend blue");
assert(read(".github/workflows/ci.yml").includes("index.html mosaic-core.js version.js"),
       "Pages artifact must include mosaic-core.js beside index.html");
for(const script of ["scripts/launch-terrain-engine.sh","scripts/install-mac-service.sh"]){
  const source=read(script);
  assert.match(source,/127\.0\.0\.1/,`${script} must keep the engine loopback-only`);
}

const manifest=JSON.parse(read("manifest.json"));
const sources=JSON.parse(read("sources.json"));
const pkg=JSON.parse(read("package.json"));
assert(Array.isArray(sources.sources)&&sources.sources.length>0,"sources.json needs active sources");
assert(!pkg.dependencies||Object.keys(pkg.dependencies).length===0,"runtime dependencies are intentionally forbidden");
for(const icon of manifest.icons||[])
  assert(fs.existsSync(path.join(root,icon.src)),`missing manifest icon: ${icon.src}`);

console.log(`static checks passed (${inline.length} inline scripts, ${sources.sources.length} sources, build ${versionSandbox.CSP_BUILD})`);
