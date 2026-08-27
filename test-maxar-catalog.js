"use strict";
const assert=require("assert");
const catalog=require("./maxar-catalog.json");

/* The Maxar coverage index ships as a static file, so nothing at runtime
   revalidates it. These are the invariants the overlay relies on. */

assert.equal(catalog.schema,1,"schema version must be pinned");
assert.equal(catalog.license,"CC-BY-NC-4.0","the non-commercial licence must be recorded, not assumed");
assert.equal(catalog.commercialUse,false,"the index must state that commercial use is not permitted");
assert(/maxar-opendata/.test(catalog.source),"the index must record where it came from");
assert(Array.isArray(catalog.events)&&catalog.events.length>=40,
       `expected the Open Data Program's full event list, got ${catalog.events?.length}`);

const seen=new Set();
let footprints=0;
for(const event of catalog.events){
  assert(event.id&&typeof event.id==="string",`every event needs an id: ${JSON.stringify(event)}`);
  assert(!seen.has(event.id),`duplicate event ${event.id}`);
  seen.add(event.id);
  assert(event.title&&!/[-_]/.test(event.title),`${event.id}: title must be readable, got ${event.title}`);
  assert(/^https:\/\/maxar-opendata\.s3\.amazonaws\.com\//.test(event.url),
         `${event.id}: url must point at the Open Data bucket`);
  assert(Array.isArray(event.footprints)&&event.footprints.length,
         `${event.id}: every event must draw at least one footprint`);
  for(const box of event.footprints){
    assert.equal(box.length,4,`${event.id}: a footprint is [west, south, east, north]`);
    const [west,south,east,north]=box;
    assert(box.every(Number.isFinite),`${event.id}: footprint values must be finite`);
    assert(west>=-180&&east<=180&&south>=-90&&north<=90,`${event.id}: footprint must be within lon/lat bounds`);
    assert(east>west&&north>south,`${event.id}: footprint must be a non-empty box`);
    footprints++;
  }
}
assert(footprints>=200,`expected a useful number of footprints, got ${footprints}`);

/* Nepal is the case this was checked against by hand: three activations, one of
   which reaches the Kathmandu valley. If a future sync loses them, the index has
   silently regressed for the area that motivated adding it. */
const nepal=catalog.events.filter(event=>/^Nepal-/.test(event.id));
assert(nepal.length>=3,`expected the three Nepal activations, got ${nepal.length}`);
const kathmandu={lon:85.3240,lat:27.7172};
const covers=box=>kathmandu.lon>=box[0]&&kathmandu.lon<=box[2]&&kathmandu.lat>=box[1]&&kathmandu.lat<=box[3];
assert(nepal.some(event=>event.footprints.some(covers)),
       "a Nepal footprint must still reach the Kathmandu valley");

/* An event's own union must contain the strips it lists, or the overlay would
   draw footprints outside the extent the popup claims. */
for(const event of catalog.events){
  const [west,south,east,north]=event.bbox;
  for(const box of event.footprints){
    assert(box[0]>=west-1e-6&&box[2]<=east+1e-6&&box[1]>=south-1e-6&&box[3]<=north+1e-6,
           `${event.id}: a footprint falls outside the event extent`);
  }
}

console.log(`maxar catalog checks passed (${catalog.events.length} events, ${footprints} footprints)`);
