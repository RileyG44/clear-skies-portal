"use strict";
const assert=require("assert/strict");
const M=require("./mosaic-core.js");

const triangle={geom:{type:"Polygon",coordinates:[[[0,0],[10,0],[0,10],[0,0]]]},bbox:[0,0,10,10]};
assert.equal(M.itemContains(triangle,1,1),true);
assert.equal(M.itemContains(triangle,9,9),false,"polygon coverage must not inherit its bbox corners");

const holed={geom:{type:"Polygon",coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]]}};
assert.equal(M.itemContains(holed,2,2),true);
assert.equal(M.itemContains(holed,5,5),false,"polygon holes must remain uncovered");

const cov=M.makeCoverageGrid({w:0,s:0,e:10,n:10},40);
M.cellsGained(cov,triangle,true);
assert(M.coveredFraction(cov)>0.45&&M.coveredFraction(cov)<0.55,"triangle should cover about half the view");

const dateline={geom:{type:"Polygon",coordinates:[[[179,-1],[-179,-1],[-179,1],[179,1],[179,-1]]]}};
assert.equal(M.itemContains(dateline,0,0),false,"a dateline polygon must not wrap across Greenwich");
assert.equal(M.itemContains(dateline,179.5,0),true);
assert.equal(M.itemContains(dateline,-179.5,0),true);
const datelineCov=M.makeCoverageGrid({w:178,s:-2,e:-178,n:2},40);
M.cellsGained(datelineCov,dateline,true);
assert(M.coveredFraction(datelineCov)>0.23&&M.coveredFraction(datelineCov)<0.27,
       "a 2 by 2 degree dateline polygon should cover a quarter of this viewport");

const common={coll:"sentinel-2-l2a",date:"2026-08-19T18:59:09Z",props:{"grid:code":"MGRS-10TFT",platform:"sentinel-2b","sat:relative_orbit":13}};
const left={...common,id:"left",bbox:[-121.688,46.4,-121.242,47.1]};
const right={...common,id:"right",bbox:[-120.636,46.4,-120.197,47.1]};
assert.notEqual(M.patchKey(left),M.patchKey(right),"disjoint acquisitions in one MGRS cell must both be usable");

const pc={...left,id:"pc",srcKey:"pc",props:{...left.props,"s2:product_uri":"S2B_EXAMPLE.SAFE"}};
const es={...left,id:"es",srcKey:"es",props:{...left.props,"s2:product_uri":"S2B_EXAMPLE.SAFE"}};
assert.equal(M.productKey(pc),M.productKey(es),"provider renditions of one product must deduplicate");

assert.equal(Math.round(M.metersPerPixel(47,8)),417);
assert(M.nativeZoomForGsd(10,47)>=13);
assert.equal(M.bboxContains([-2,-2,2,2],[-1,-1,1,1]),true);
assert.deepEqual(M.splitBbox([178,-2,-178,2]),[[178,-2,180,2],[-180,-2,-178,2]]);
assert.deepEqual(M.splitBbox([-182,-2,-178,2]),[[178,-2,180,2],[-180,-2,-178,2]]);

console.log("mosaic core checks passed");
