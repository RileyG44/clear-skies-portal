'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const adapter=fs.readFileSync('ios/Resources/native-shell.js','utf8');
const source=adapter.slice(adapter.indexOf('  const NATIVE_ROUTES ='),adapter.indexOf('  function describePage()'));
function fixture(){
  const context={window:{},nativeContents:()=>[],describeRoot:()=>[],elementFor:()=>null, $:()=>null};
  vm.createContext(context);vm.runInContext(source,context);
  return context;
}
const flat=items=>items.flatMap(item=>[item,...flat(item.items||[])]);
test('a layer source moves to the final disclosure while scientific warnings stay beside controls',()=>{
  const c=fixture(),input=[{kind:'header',title:'Geology'},
    {kind:'toggle',ref:'#faults',title:'Faults',value:true,provenance:'USGS · 1:24,000'},
    {kind:'text',style:'warning',title:'Regional screening; not a parcel-scale assessment.'}];
  const original=JSON.stringify(input),result=c.nativePageItems('geology',input);
  assert.equal(JSON.stringify(input),original,'formatting must not mutate live descriptors');
  assert.equal(result[1].ref,'#faults');assert.equal(result[1].value,true);
  assert.equal(result[2].style,'warning','scientific warnings must not be buried with credits');
  const details=flat(result.at(-1).items);
  assert.equal(details[0].kind,'disclosure');
  assert.equal(details[1].detail,'USGS · 1:24,000','provider and scale must survive intact');
});
test('spectrum colors stay with spectrum controls without losing either reset or highlight inputs',()=>{
  const c=fixture(),input=[
    {kind:'group',title:'Elevation spectrum',items:[{kind:'toggle',ref:'#elevSh'},{kind:'button',ref:'#elevSpectrumReset',title:'Reset'}]},
    {kind:'group',title:'Palette & colors',items:[{kind:'picker',ref:'#elevPalette'}]},
    {kind:'group',title:'Elevation highlights',items:[{kind:'field',ref:'#elevBelowVal'},{kind:'button',ref:'#elevBandsReset',title:'Reset'}]}
  ];
  const original=JSON.stringify(input),result=c.nativePageItems('elevation',input),rows=flat(result);
  assert.equal(JSON.stringify(input),original);
  assert.deepEqual(rows.filter(i=>i.ref?.startsWith('#')).map(i=>i.ref).sort(),flat(input).filter(i=>i.ref).map(i=>i.ref).sort());
  assert(flat(result[0].items).some(i=>i.ref==='#elevPalette'));
  assert.notEqual(rows.find(i=>i.ref==='#elevSpectrumReset').title,rows.find(i=>i.ref==='#elevBandsReset').title,'reset scope must be distinguishable');
});
test('one custom color editor is retained when its swatch row already owns the same input',()=>{
  const c=fixture(),result=c.nativePageItems('appearance',[
    {kind:'swatches',ref:'@swatches',custom:{ref:'@color',value:'#123456'}},
    {kind:'color',ref:'@color',value:'#123456'},
    {kind:'color',ref:'@other',value:'#ffffff'}
  ]);
  assert.equal(result.length,2);assert.equal(result[0].custom.ref,'@color');assert.equal(result[1].ref,'@other');
});
test('settings replaces copied export preferences with one route to the shared editor',()=>{
  const c=fixture(),result=c.nativePageItems('settings',[
    {kind:'header',title:'Terrain engine'},{kind:'button',ref:'@engine',title:'Open controls'},
    {kind:'header',title:'Export'},{kind:'picker',ref:'@duplicateScale'},
    {kind:'header',title:'Accessibility & data'},{kind:'toggle',ref:'@motion'},
    {kind:'header',title:'Map sources'},{kind:'text',title:'Credits'}
  ]),rows=flat(result);
  assert.equal(rows.filter(i=>i.kind==='route'&&i.id==='export').length,1);
  assert(!rows.some(i=>i.ref==='@duplicateScale'));
  assert(rows.some(i=>i.ref==='@engine'));assert(rows.some(i=>i.ref==='@motion'));
});
test('add-layer shortcuts use the same task names as the home menu',()=>{
  const c=fixture(),result=c.nativePageItems('layers',[
    {kind:'button',role:'navigate',ref:'@terrain',title:'LiDAR'},
    {kind:'button',role:'navigate',ref:'@markup',title:'Markup'}
  ]);
  assert.equal(result[0].title,'Terrain & LiDAR');
  assert.equal(result[1].title,'Draw & annotate');
  assert.equal(result[0].ref,'@terrain');
});
