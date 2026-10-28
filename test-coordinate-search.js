'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=require("./test-fixtures/page-source.js");
const section=(start,end)=>{
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert(from>=0&&to>from,'missing coordinate section: '+start);
  return html.slice(from,to);
};
const field={value:''},status={innerHTML:'',dataset:{}};
const calls={locations:[],views:[],geocodes:[],runs:0,hidden:0,shown:0,aborts:0,timers:0};
const context={
  $:selector=>{assert.equal(selector,'#q');return field;},
  LOC:{lat:1,lng:2},statusEl:status,
  acHide:()=>calls.hidden++,acShow:()=>calls.shown++,acCancel:()=>calls.cancels=(calls.cancels||0)+1,
  setLoc:(lat,lng,keepLabel)=>{
    calls.locations.push([lat,lng,keepLabel]);
    if(!keepLabel) field.value=lat.toFixed(5)+', '+lng.toFixed(5);
  },
  map:{getZoom:()=>8,setView:(...args)=>calls.views.push(args)},
  geocode:async text=>{calls.geocodes.push(text);return {lat:47,lng:-119};},
  run:()=>calls.runs++,
  clearTimeout:()=>{},setTimeout:()=>{calls.timers++;return 1;},
  acAbort:{abort:()=>calls.aborts++},acTimer:null,acList:[{stale:true}],acIdx:0,
};
vm.createContext(context);
vm.runInContext(section('function parseCoordinates(','\nasync function geocode('),context);
vm.runInContext(section('function coordinateForActions(','\nfunction hideCoordinateMenu('),context);
vm.runInContext(section('function acInput(','\nfunction acKey('),context);
vm.runInContext(section('async function doSearch(','\n$("#go").onclick='),context);
const lat=47+39/60+41.81/3600,lng=-(118+42/60+26.17/3600);
let checked=0;
function expectPair(text,expectedLat,expectedLng){
  const result=context.parseCoordinates(text);
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
  assert.equal(context.parseCoordinates(text),null,'place/non-coordinate: '+text);checked++;
}
for(const text of [
  '91, -118','47, -181','90°0\'1"N 118°0\'0"W',
  '47°60\'0"N 118°42\'0"W','47°39\'60"N 118°42\'0"W',
  '47N 118S','N47S W118','-47N 118W','47N +118W',
  '47°39\'41.81"N',
]){
  assert.throws(()=>context.parseCoordinates(text),/Invalid coordinates/);checked++;
}
async function main(){
  field.value='47°39\'41.81"N 118°42\'26.17"W';
  context.acInput();
  assert.equal(calls.shown,0,'DMS must not trigger place autocomplete');
  assert.equal(calls.timers,0);assert.equal(calls.aborts,1);
  assert.equal(context.acList.length,0,'old place suggestions cannot hijack Enter');
  const typed=context.coordinateForActions();
  assert.equal(typed.lat,lat);assert.equal(typed.lng,lng);
  const links=context.coordinateLinks(typed);
  assert(links.maps.includes('47.661614%2C-118.707269'));
  assert(links.earth.includes('47.661614,-118.707269'));
  await context.doSearch();
  assert.equal(field.value,'47°39\'41.81"N 118°42\'26.17"W','search must preserve pasted coordinate precision');
  assert.equal(context.coordinateForActions().lat,lat);
  assert.equal(context.coordinateForActions().lng,lng);
  assert.equal(calls.geocodes.length,0,'DMS search must stay local');
  assert.equal(calls.locations[0][0],lat);assert.equal(calls.locations[0][1],lng);
  assert.equal(calls.views[0][1],10);assert.equal(calls.runs,1);
  field.value='47°60\'0"N 118°42\'0"W';
  context.acInput();assert.equal(calls.timers,0);
  assert.equal(context.coordinateForActions(),null,'invalid typed pair cannot use stale point');
  await context.doSearch();
  assert.match(status.innerHTML,/Invalid coordinates/);
  assert.equal(calls.locations.length,1);assert.equal(calls.geocodes.length,0);
  field.value='47.661614, -118.707269';await context.doSearch();
  assert.equal(calls.locations.length,2);assert.equal(calls.runs,2);
  field.value='Moses Lake, WA';
  assert.equal(context.coordinateForActions(),context.LOC,'place names preserve the selected point');
  await context.doSearch();
  assert.equal(calls.geocodes[0],'Moses Lake, WA');assert.equal(calls.runs,3);
  assert.equal(field.value,'Moses Lake, WA','a searched place name stays in the field instead of becoming coordinates');
  assert(calls.cancels>=1,'a search cancels pending suggestions so they cannot reopen the list');
  for(const nativeHost of [false,true]){
    let clears=0,focuses=0;
    const clearButton={},searchField={focus:()=>focuses++};
    vm.runInNewContext(section('$("#qClear").onclick=','\n/* Escape clears'),{
      NATIVE_HOST:nativeHost,
      $:selector=>selector==='#qClear'?clearButton:searchField,
      clearLoc:()=>clears++,
    });
    clearButton.onclick();
    assert.equal(clears,1,'Clear must still clear the selected location in either host');
    assert.equal(focuses,nativeHost?0:1,nativeHost
      ?'Native Clear must not steal focus into the off-screen web field'
      :'Web Clear must retain its existing search focus behavior');
  }
  console.log('coordinate search: '+checked+' parser cases + autocomplete, search, errors and Maps/Earth action checks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
