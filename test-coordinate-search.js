"use strict";
const assert=require("node:assert/strict");
const {parseCoordinates,coordinateLinks,createController}=require("./location-search.js");

function fixture(nativeHost=false){
  const field={value:"",focus:()=>calls.focuses++};
  const status={innerHTML:"",dataset:{}};
  const results={style:{display:"none"},innerHTML:"",querySelectorAll:()=>[]};
  const selected={lat:1,lng:2},pending=[],timers=new Map();
  const calls={locations:[],views:[],geocodes:[],runs:0,aborts:0,timers:0,focuses:0,clears:0,picks:[]};
  let focused=true,nextTimer=0;
  const search=createController({
    input:field,results,status,selected:()=>selected,nativeHost:()=>nativeHost,tap:"click",
    select:(lat,lng,keepLabel)=>{
      calls.locations.push([lat,lng,keepLabel]);
      if(!keepLabel)field.value=lat.toFixed(5)+", "+lng.toFixed(5);
    },
    map:{getZoom:()=>8,setView:(...args)=>calls.views.push(args)},
    search:()=>calls.runs++,pick:place=>calls.picks.push(place),isFocused:()=>focused,
    clearLocation:()=>calls.clears++,
    lookup:async text=>{calls.geocodes.push(text);return {lat:47,lng:-119}},
    suggest:(text,signal)=>{
      signal.addEventListener("abort",()=>calls.aborts++);
      return new Promise((resolve,reject)=>pending.push({text,resolve,reject,signal}));
    },
    clock:{clearTimeout:id=>timers.delete(id),setTimeout:fn=>{calls.timers++;timers.set(++nextTimer,fn);return nextTimer}}
  });
  function begin(text){
    field.value=text;search.input();
    const [id,fn]=[...timers].at(-1);timers.delete(id);
    return fn();
  }
  return {search,field,status,results,selected,calls,pending,begin,setFocused:on=>focused=on};
}
const f=fixture();
const {search,field,status,calls,results,selected}=f;
const lat=47+39/60+41.81/3600,lng=-(118+42/60+26.17/3600);
let checked=0;
function expectPair(text,expectedLat,expectedLng){
  const result=parseCoordinates(text);
  assert(result,'should recognize '+text);
  assert(Math.abs(result.lat-expectedLat)<1e-10,'latitude for '+text);
  assert(Math.abs(result.lng-expectedLng)<1e-10,'longitude for '+text);
  checked++;
}
for(const text of [
  '47°39\'41.81"N 118°42\'26.17"W',
  '47°39′41.81″N, 118°42′26.17″W',
  ' 47°39’41.81”n\u00a0 118°42’26.17”w ',
  'N47°39\'41.81" W118°42\'26.17"',
  '47° 39\' 41.81" N\n118° 42\' 26.17" W',
  '47º39\'41.81"N118º42\'26.17"W',
  '118°42\'26.17"W 47°39\'41.81"N',
  '47°39\'41.81" -118°42\'26.17"',
]) expectPair(text,lat,lng);
expectPair('47.661614, -118.707269',47.661614,-118.707269);
expectPair('+47.661614   −118.707269',47.661614,-118.707269);
expectPair('47.661614°N 118.707269°W',47.661614,-118.707269);
expectPair('W118.707269 N47.661614',47.661614,-118.707269);
expectPair('47°39.696833333333\'N 118°42.436166666667\'W',lat,lng);
expectPair('33°51\'31.2"S 151°12\'50.4"E',-33.85866666666667,151.214);
expectPair('90°0\'0"N 180°0\'0"W',90,-180);
expectPair('-0°30\'0" -0°30\'0"',-.5,-.5);
expectPair('.5, -.25',.5,-.25);
for(const text of ['', 'Moses Lake, WA','London','North Bend','47 Main Street','47118']){
  assert.equal(parseCoordinates(text),null,'place/non-coordinate: '+text);checked++;
}
for(const text of [
  '91, -118','47, -181','90°0\'1"N 118°0\'0"W',
  '47°60\'0"N 118°42\'0"W','47°39\'60"N 118°42\'0"W',
  '47N 118S','N47S W118','-47N 118W','47N +118W',
  '47°39\'41.81"N',
]){
  assert.throws(()=>parseCoordinates(text),/Invalid coordinates/);checked++;
}
async function main(){
  // Seed a real pending autocomplete request. Coordinates must cancel it and
  // an eventual response must not reopen stale suggestions after Enter.
  const stale=f.begin("Old place");
  calls.timers=0;
  field.value='47°39\'41.81"N 118°42\'26.17"W';
  search.input();
  assert.equal(results.style.display,'none','DMS must not trigger place autocomplete');
  assert.equal(calls.timers,0);assert.equal(calls.aborts,1);
  assert.equal(results.style.display,'none','old place suggestions cannot hijack Enter');
  const typed=search.coordinates();
  assert.equal(typed.lat,lat);assert.equal(typed.lng,lng);
  const links=coordinateLinks(typed);
  assert(links.maps.includes('47.661614%2C-118.707269'));
  assert(links.earth.includes('47.661614,-118.707269'));
  await search.search();
  assert.equal(field.value,'47°39\'41.81"N 118°42\'26.17"W','search must preserve pasted coordinate precision');
  assert.equal(search.coordinates().lat,lat);
  assert.equal(search.coordinates().lng,lng);
  assert.equal(calls.geocodes.length,0,'DMS search must stay local');
  assert.equal(calls.locations[0][0],lat);assert.equal(calls.locations[0][1],lng);
  assert.equal(calls.views[0][1],10);assert.equal(calls.runs,1);
  field.value='47°60\'0"N 118°42\'0"W';
  search.input();assert.equal(calls.timers,0);
  assert.equal(search.coordinates(),null,'invalid typed pair cannot use stale point');
  await search.search();
  assert.match(status.innerHTML,/Invalid coordinates/);
  assert.equal(calls.locations.length,1);assert.equal(calls.geocodes.length,0);
  field.value='47.661614, -118.707269';await search.search();
  assert.equal(calls.locations.length,2);assert.equal(calls.runs,2);
  field.value='Moses Lake, WA';
  assert.equal(search.coordinates(),selected,'place names preserve the selected point');
  await search.search();
  assert.equal(calls.geocodes[0],'Moses Lake, WA');assert.equal(calls.runs,3);
  assert.equal(field.value,'Moses Lake, WA','a searched place name stays in the field instead of becoming coordinates');
  f.pending[0].resolve([{primary:"stale",secondary:"",kind:"place"}]);
  await stale;
  assert.equal(results.style.display,"none","completed search rejects overtaken suggestions");
  for(const nativeHost of [false,true]){
    const f=fixture(nativeHost);f.search.clear();
    assert.equal(f.calls.clears,1,'Clear must still clear the selected location in either host');
    assert.equal(f.calls.focuses,nativeHost?0:1,nativeHost
      ?'Native Clear must not steal focus into the off-screen web field'
      :'Web Clear must retain its existing search focus behavior');
  }
  await concurrencyChecks();
  console.log('coordinate search: '+checked+' parser cases + autocomplete, search, errors and Maps/Earth action checks passed');
}

async function concurrencyChecks(){
  const f=fixture(),place=name=>({primary:name,secondary:"region",kind:"place",lat:4,lng:5});
  const a=f.begin("First place"),b=f.begin("Second place");
  assert(f.pending[0].signal.aborted,"superseded requests abort");
  f.pending[1].resolve([place("second")]);await b;
  f.pending[0].resolve([place("first")]);await a;
  assert.match(f.results.innerHTML,/second/);assert.doesNotMatch(f.results.innerHTML,/first/);
  const key=name=>f.search.key({key:name,preventDefault(){}});
  key("ArrowDown");key("Enter");
  assert.equal(f.calls.picks[0].primary,"second","Enter uses the current suggestion");
  key("Escape");assert.equal(f.results.style.display,"none");
  const unfocused=f.begin("Blurred place");f.setFocused(false);
  f.pending[2].resolve([place("unfocused")]);await unfocused;
  assert.doesNotMatch(f.results.innerHTML,/unfocused/,"unfocused lookup cannot replace suggestions");
  f.setFocused(true);
  const cancelled=f.begin("Cancelled place");f.search.cancel();f.search.hide();
  f.pending[3].reject(Error("late failure"));await cancelled;
  assert.equal(f.results.style.display,"none","cancelled failure cannot reopen suggestions");
  const failed=f.begin("Broken provider");f.pending[4].reject(Error("unavailable"));await failed;
  assert.match(f.results.innerHTML,/Place search unavailable/);
  assert.match(f.results.innerHTML,/double-click/);
}

main().catch(error=>{console.error(error);process.exitCode=1;});
