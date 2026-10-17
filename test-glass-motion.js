'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('ui-system.css','utf8');
const start=source.indexOf('let map3dGlassTimer='),end=source.indexOf('function setTerrainModeUi(',start);
assert(start>=0&&end>start,'the motion lifecycle must exist');
let now=0,sequence=0,writes=[];
const timers=new Map(),classes=new Set(['terrain-3d']);
const env={map3d:{},document:{body:{classList:{contains:name=>classes.has(name),
  add(name){writes.push(['add',name]);classes.add(name)},remove(name){writes.push(['remove',name]);classes.delete(name)}}}},
  setTimeout(fn,delay){const id=++sequence;timers.set(id,{at:now+delay,fn});return id},clearTimeout:id=>timers.delete(id)};
vm.runInNewContext(source.slice(start,end),env);
const advance=ms=>{now+=ms;for(const [id,timer] of timers) if(timer.at<=now){timers.delete(id);timer.fn()}};
env.mark3dGlassMotion();
assert(classes.has('map3d-moving'),'the first movement immediately disables glass');
for(let frame=0;frame<120;frame++){
  advance(16);env.mark3dGlassMotion();env.mark3dGlassMotion(); // movestart + move per synchronous jumpTo
  assert(classes.has('map3d-moving'),'continuous movement never restores blur');
}
assert.equal(writes.length,1,'frame events must not rewrite the DOM class');
assert.equal(timers.size,1,'movement keeps only one quiet timer');
advance(199);assert(classes.has('map3d-moving'),'blur stays disabled until the quiet interval completes');
advance(1);assert(!classes.has('map3d-moving'),'blur returns after 200 ms without movement');
assert.equal(writes.length,2,'a whole gesture causes only two class writes');
env.mark3dGlassMotion();advance(100);env.reset3dGlassMotion();
assert.equal(timers.size,0,'exit cancels the pending quiet timer');
assert(!classes.has('map3d-moving'),'exit immediately restores glass');
const afterExit=writes.length;advance(500);assert.equal(writes.length,afterExit,'no stale callback writes after exit');
classes.delete('terrain-3d');env.mark3dGlassMotion();
assert.equal(writes.length,afterExit,'2D events cannot activate the override');
assert.equal(timers.size,0,'2D events do not start a quiet timer');
classes.add('terrain-3d');env.map3d=null;env.mark3dGlassMotion();
assert.equal(timers.size,0,'startup without a camera cannot start motion');
env.map3d={};env.mark3dGlassMotion();advance(200);env.mark3dGlassMotion();
assert(classes.has('map3d-moving'),'a later gesture activates glass suppression again');
env.reset3dGlassMotion();env.reset3dGlassMotion();assert.equal(timers.size,0,'cleanup is idempotent');
assert(source.includes('map3d.on("movestart",mark3dGlassMotion);map3d.on("move",mark3dGlassMotion)'),
  'the real camera must register both first-motion and continuous-motion hooks');
assert(!source.includes('map3d.on("moveend",reset3dGlassMotion)'), 'synchronous jumpTo moveend must not restore blur');
assert.match(source,/function exitTerrain3d\(\)\{\s*reset3dGlassMotion\(\)/,'exit must clean up even when there is no map');
assert.match(source,/function setTerrainModeUi\(on,status\)\{\s*if\(!on\) reset3dGlassMotion\(\)/,'failed startup must clean up too');
// Every non-none backdrop rule in the shipped chrome needs a targeted motion
// override. This includes legacy hard-coded blur and collapsed phone fields.
const motionStart=css.indexOf('.csp-glass body.terrain-3d.map3d-moving{');
assert(motionStart>=0,'motion materials must be scoped to the glass UI');
const motionCss=css.slice(motionStart);
// Read leaf rules inside media/supports blocks too; comments and @supports
// conditions are not declarations. Expand selector lists and :is so adding a
// blurred surface anywhere in shipped CSS requires a corresponding override.
const rules=text=>Array.from(text.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g),m=>({selector:m[1].trim(),declarations:m[2]}));
function selectors(text){
  let depth=0,start=0,list=[];
  for(let i=0;i<text.length;i++){
    if(text[i]==='('||text[i]==='[') depth++;
    else if(text[i]===')'||text[i]===']') depth--;
    else if(text[i]===','&&!depth){list.push(text.slice(start,i).trim());start=i+1}
  }
  list.push(text.slice(start).trim());
  return list.flatMap(selector=>{
    const group=/:is\(([^()]*)\)/.exec(selector);
    return group?selectors(group[1]).flatMap(part=>selectors(selector.slice(0,group.index)+part+selector.slice(group.index+group[0].length))):[selector];
  });
}
const filterValues=rule=>Array.from(rule.declarations.matchAll(/(?:^|;)\s*(?:-webkit-)?backdrop-filter\s*:\s*([^;]+)/g),m=>m[1].trim());
const motionRules=rules(motionCss),filterRules=motionRules.filter(rule=>filterValues(rule).length===2&&filterValues(rule).every(value=>/^none(?:\s*!important)?$/.test(value)));
assert(filterRules.length,'motion must directly disable both backdrop properties');
const targets=filterRules.flatMap(rule=>selectors(rule.selector)).map(selector=>selector.replace(/^body\.terrain-3d\.map3d-moving\s+/,''));
function covers(selector,target){
  // The override's last compound must match the blurred element itself, not
  // just one of its ancestors. A broader class covers additional classes on
  // the same element (e.g. .leaflet-tooltip.csp-point-tip).
  const actual=selector.split(/\s+|[>+~]/).filter(Boolean),required=target.split(/\s+/);
  const matches=(compound,wanted)=>{
    const tokens=value=>value.match(/[#.]?[\w-]+/g)||[];
    return tokens(wanted).every(token=>tokens(compound).includes(token));
  };
  if(!matches(actual.pop()||'',required.pop())) return false;
  let at=actual.length-1;
  while(required.length){const wanted=required.pop();while(at>=0&&!matches(actual[at],wanted)) at--;if(at--<0) return false}
  return true;
}
const styleBlocks=Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),m=>m[1]).join('\n');
const styles=[['index.html',styleBlocks],['ui-system.css',css],['ui-theme.css',fs.readFileSync('ui-theme.css','utf8')]];
let blurRules=0;
for(const [file,text] of styles) for(const rule of rules(text)) if(filterValues(rule).some(value=>!/^none(?:\s*!important)?$/.test(value))){
  blurRules++;
  for(const selector of selectors(rule.selector)) assert(targets.some(target=>covers(selector,target)),`${file}: missing motion filter override for ${selector}`);
}
assert(blurRules>0,'coverage must discover the shipped blur rules');
assert(!covers('#side .new-blur','#side'),'an ancestor override does not cover a newly blurred child');
for(const rule of motionRules) if(/(?:^|;)\s*(?:background-color:|--glass-|--lg-|--sheet-|--ui-frost)/.test(rule.declarations))
  assert(rule.selector.startsWith('.csp-glass body.'),'motion fills and material variables must leave classic colours intact');
assert(motionCss.includes('.map-tool:not(:hover):not(.active):not([aria-pressed="true"])'),'motion must preserve hover and selected map-tool feedback');
assert.match(motionCss,/@media \(max-width:760px\)\{[\s\S]*?\.csp-glass body\.csp-redesign\.terrain-3d\.map3d-moving #side\{transition:none!important\}/,'phone motion fills must switch without a background fade');
assert(motionCss.includes('-webkit-backdrop-filter:none!important;backdrop-filter:none!important'), 'both browser filter properties must be overridden');
assert(motionCss.includes('--map3d-motion-fill:var(--ui-surface);--map3d-motion-panel:var(--ui-rail)'), 'motion must reuse the themed opaque fallback palette');
assert(!/transition:.*backdrop-filter/.test(motionCss),'backdrop filters must never animate');
console.log(`3D glass motion checks passed (continuous jumpTo, quiet interval, DOM writes, exit, 2D isolation, classic/state preservation and ${blurRules} blur rules)`);
