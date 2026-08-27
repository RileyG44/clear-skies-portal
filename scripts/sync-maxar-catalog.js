"use strict";

/* Builds the Maxar (Vantor) Open Data coverage index.
 *
 * The Open Data Program publishes 30-50 cm optical imagery on disaster
 * activations - earthquakes, floods, cyclones, wildfires, conflict. It is a
 * STAC catalog of Cloud-Optimised GeoTIFFs on S3, with no key and no sign-up.
 * Coverage is opportunistic: a few dozen events, each a handful of strips. It
 * is emphatically not a global layer, so the portal treats it as a sparse index
 * of "is there anything much sharper than Sentinel-2 here, and when".
 *
 * One request per event is enough. A STAC collection's extent.spatial.bbox puts
 * the union first and each contributing acquisition after it, so the per-strip
 * footprints come free with the event metadata rather than costing a walk over
 * every item.
 *
 * LICENCE: CC-BY-NC-4.0. Non-commercial. That is recorded in the output so the
 * UI can gate it rather than relying on anyone remembering.
 */

const fs=require("fs");
const path=require("path");

const ROOT="https://maxar-opendata.s3.amazonaws.com/events";
const out=path.resolve(__dirname,"..","maxar-catalog.json");

async function get(url){
  const response=await fetch(url);
  if(!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function finiteBox(box){
  return Array.isArray(box)&&box.length>=4&&box.slice(0,4).every(Number.isFinite);
}

/* A readable label from the S3 event id, which is the only name the catalog
   carries: "Nepal-Floods-Sept-2024" -> "Nepal Floods Sept 2024". */
function title(id){
  return String(id).replace(/[-_]+/g," ").replace(/\s+/g," ").trim();
}

function year(id){
  const years=(String(id).match(/(?:19|20)\d{2}/g)||[]).map(Number);
  return years.length?Math.max(...years):0;
}

async function main(){
  const root=await get(`${ROOT}/catalog.json`);
  const children=(root.links||[]).filter(link=>link.rel==="child"&&link.href);
  const ids=children.map(link=>String(link.href).replace(/^\.\//,"").replace(/\/collection\.json$/,""));
  if(!ids.length) throw new Error("no events found in the Maxar Open Data root catalog");

  const events=[];
  const failures=[];
  let cursor=0;
  await Promise.all(Array.from({length:6},async()=>{
    for(;;){
      const index=cursor++;
      if(index>=ids.length) return;
      const id=ids[index];
      try{
        const collection=await get(`${ROOT}/${id}/collection.json`);
        const boxes=collection.extent?.spatial?.bbox||[];
        const union=boxes.find(finiteBox);
        if(!union){ failures.push(`${id}: no usable spatial extent`); continue }
        const interval=collection.extent?.temporal?.interval?.[0]||[];
        /* Skip the union when listing strips, but keep it as the sole footprint
           for a single-strip event so every event draws something. */
        const strips=boxes.slice(1).filter(finiteBox).map(box=>box.slice(0,4));
        events.push({
          id,
          title:title(id),
          year:year(id),
          bbox:union.slice(0,4),
          footprints:strips.length?strips:[union.slice(0,4)],
          start:interval[0]||null,
          end:interval[1]||null,
          license:collection.license||"CC-BY-NC-4.0",
          url:`${ROOT}/${id}/collection.json`
        });
      }catch(error){ failures.push(`${id}: ${error.message}`) }
    }
  }));

  events.sort((a,b)=>b.year-a.year||a.id.localeCompare(b.id));
  for(const line of failures) console.warn(line);

  const payload={
    schema:1,
    source:`${ROOT}/catalog.json`,
    license:"CC-BY-NC-4.0",
    commercialUse:false,
    attribution:"Maxar Open Data Program (CC-BY-NC-4.0)",
    generatedAt:new Date().toISOString(),
    events
  };
  fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
  const footprints=events.reduce((total,event)=>total+event.footprints.length,0);
  console.log(`wrote ${events.length} events and ${footprints} footprints to ${path.basename(out)}`);
  if(!events.length) throw new Error("refusing to publish an empty Maxar catalogue");
  if(failures.length>ids.length/4) throw new Error(`${failures.length} of ${ids.length} events failed to read`);
}

main().catch(error=>{console.error(error);process.exitCode=1});
