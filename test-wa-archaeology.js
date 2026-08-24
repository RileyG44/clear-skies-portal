"use strict";

const assert=require("assert/strict");
const archaeology=require("./wa-archaeology");

const stats=archaeology.validate();
assert(stats.sites>=30,"research index should cover the major statewide public record");
assert(stats.sources>=20,"research index should retain broad source provenance");

const collection=archaeology.featureCollection();
assert.equal(collection.type,"FeatureCollection");
assert.equal(collection.features.length,stats.sites);

for(const feature of collection.features){
  const p=feature.properties;
  assert.equal(feature.geometry.type,"Point");
  assert(Array.isArray(p.sources)&&p.sources.length>0,`${feature.id} needs a source`);
  assert(p.sources.every(s=>/^https:\/\//.test(s.url)),`${feature.id} sources must be HTTPS`);
  assert(["public-site","generalized","estimated"].includes(p.precision),`${feature.id} needs an explicit precision class`);
  assert(Number.isFinite(p.uncertaintyMi)&&p.uncertaintyMi>=0,`${feature.id} needs location uncertainty`);
  assert(p.access&&p.summary,`${feature.id} needs stewardship and research context`);
}

const byId=Object.fromEntries(collection.features.map(f=>[f.id,f.properties]));
assert.equal(byId["manis-mastodon"].precision,"generalized","restricted Manis address must remain generalized");
assert.equal(byId["ridge-bottom-45gr27"].precision,"generalized","Moses Lake village must not imply a survey coordinate");
assert.equal(byId["mae-valley-westshore"].researchLead,true,"Mae Valley must be labeled as a lead, not a verified site");
assert.equal(byId["buffalo-eddy"].precision,"public-site","official visitor coordinates should remain usable");

const fresh=archaeology.featureCollection();
fresh.features[0].geometry.coordinates[0]=0;
assert.notEqual(archaeology.featureCollection().features[0].geometry.coordinates[0],0,"callers must receive fresh GeoJSON geometry");

console.log(`WA archaeology checks passed (${stats.sites} public-safe entries, ${stats.sources} sources)`);
