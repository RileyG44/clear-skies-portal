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
const flat=items=>items.flatMap(item=>[item,...(item.toggle?[{kind:'toggle',...item.toggle}]:[]),...flat(item.items||[])]);
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
  assert.deepEqual([...rows.filter(i=>i.ref?.startsWith('#')).map(i=>i.ref)].sort(),flat(input).filter(i=>i.ref).map(i=>i.ref).sort());
  assert(flat(result[0].items).some(i=>i.ref==='#elevPalette'));
  assert.notEqual(rows.find(i=>i.ref==='#elevSpectrumReset').title,rows.find(i=>i.ref==='#elevBandsReset').title,'reset scope must be distinguishable');
});
test('elevation reads as two folding tasks with the scale beside its colors and one row per highlight',()=>{
  const c=fixture(),input=[
    {kind:'group',title:'Color by elevation',items:[
      {kind:'picker',ref:'#elevUnit',value:'ft',options:[{value:'ft',title:'feet'},{value:'m',title:'metres'}]},
      {kind:'toggle',ref:'#elevSh',title:'Show on map',value:true},
      {kind:'gradient',ref:'#elevRangePreview',stops:[]},
      {kind:'slider',ref:'#elevSlide',title:'Reference elevation ft'},{kind:'slider',ref:'#elevSpanSlide',title:'Color span ± ft'},
      {kind:'picker',ref:'#elevPalette'},{kind:'color',ref:'#elevLowColor'},{kind:'color',ref:'#elevMidColor'},{kind:'color',ref:'#elevHighColor'},
      {kind:'button',ref:'#elevPaletteReverse'},{kind:'slider',ref:'#elevAlpha'},
      {kind:'button',ref:'#elevPaletteReset'},{kind:'button',ref:'#elevSpectrumReset'}]},
    {kind:'group',title:'Highlight elevations',items:[
      {kind:'toggle',ref:'#elevBelowOn',title:'Highlight ground below',value:true},{kind:'color',ref:'#elevBelowColor',value:'#f85c6c'},
      {kind:'field',ref:'#elevBelowVal',value:'1000',unit:'ft'},
      {kind:'toggle',ref:'#elevAboveOn',value:false},{kind:'color',ref:'#elevAboveColor'},{kind:'field',ref:'#elevAboveVal',value:'1500',unit:'ft'},
      {kind:'slider',ref:'#elevBandAlpha'},{kind:'field',ref:'#elevBandFeather'},{kind:'toggle',ref:'#elevBandOutline'},
      {kind:'button',ref:'#elevBandsReset'}]}];
  const result=c.nativePageItems('elevation',input),color=result[0].items,bands=result[1].items;
  assert(result.slice(0,2).every(section=>section.collapsible),'both tasks fold');
  assert.equal(result[0].detail.length>0,true,'a folded task still says its state');
  assert.equal(result[0].toggle.ref,'#elevSh','the coloring switch stays in the folded row');
  const at=ref=>color.findIndex(i=>i.ref===ref);
  assert(at('#elevSlide')<at('#elevRangePreview')&&at('#elevSpanSlide')<at('#elevRangePreview'),'heights come before the scale');
  assert.equal(at('#elevPalette'),at('#elevRangePreview')+1,'the scale sits directly above the colors it shows');
  assert.equal(color[at('#elevPalette')+1].kind,'wells');
  assert.equal(color.find(i=>i.ref==='#elevSlide').title,'Reference elevation','units are shown once, beside the value');
  const below=bands.find(i=>i.ref==='#elevBelowVal');
  assert.equal(below.kind,'threshold');assert.equal(below.toggle.ref,'#elevBelowOn');assert.equal(below.well.ref,'#elevBelowColor');
  assert(!bands.some(i=>i.ref==='#elevBelowOn'||i.ref==='#elevBelowColor'),'one row per highlight');
  assert(flat(result).some(i=>i.ref==='#elevUnit'),'units stay reachable');
});
test('satellite puts results before reference layers and acquisition estimates',()=>{
  const c=fixture(),result=c.nativePageItems('satellite',[
    {kind:'scenesearch',ref:'#cspSatQuery'},{kind:'chips',ref:'@filters',items:[{kind:'picker',ref:'#days'}]},
    {kind:'group',pane:true,title:'Estimated next acquisitions',items:[]},
    {kind:'group',pane:true,title:'Reference imagery & coverage',items:[]},
    {kind:'group',pane:true,title:'Satellite scenes',items:[{kind:'button',role:'group',title:'AWS · 44',detail:'▾ hide'}]}]);
  assert.deepEqual(result.map(i=>i.title||i.kind).join('|'),'scenesearch|chips|Satellite scenes|Reference imagery & coverage|Estimated next acquisitions');
  const group=flat(result[2].items).find(i=>i.role==='group');
  assert.equal(group.expanded,true,'provider groups read as open or closed');assert.equal(group.detail,undefined);
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
