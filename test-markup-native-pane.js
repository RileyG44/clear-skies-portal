'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const markup = fs.readFileSync('markup.js', 'utf8');
// Exercise the actual map-dismissal listener: native map input retains tools,
// while the existing browser/Electron popover behavior stays intact.
const listener = markup.slice(markup.indexOf('mapEl.addEventListener("pointerdown",event=>{'), markup.indexOf('function setTool(next)'));
for (const native of [false, true]) {
  let callback, dismissed = 0;
  vm.runInNewContext(listener, {window:{CSPNativeHost:native ? {} : undefined},toolsOpen:true,
    mapEl:{addEventListener(_, fn){callback=fn}},setToolsOpen(){dismissed++}});
  callback({target:{closest:()=>null}});
  assert.equal(dismissed, native ? 0 : 1);
  callback({target:{closest:()=>({})}});
  assert.equal(dismissed, native ? 0 : 1, 'pane/dock touches never dismiss tools');
}
// The panel describes all four live control groups plus auxiliary choices.
const adapter = fs.readFileSync('ios/Resources/native-shell.js','utf8');
const describe = adapter.slice(adapter.indexOf('  function markupItems('), adapter.indexOf('  // Toolbar panels use task-sized'));
let pop = {hidden:false,getAttribute:()=> 'Shapes'};
const context = {$(selector){return selector==='#mkPop' ? pop : {selector}},
  $$(selector, root){return [{textContent:'Pin',getAttribute:()=> 'true'}]},
  refOf:()=> 'pin-control',clean:x=>String(x||''),iconOf:()=> 'map-pin',
  walk(root, items){items.push({ref:root.selector||'shape-choice'})},
  panelGroup:(ref,title,items)=>({ref,title,items})};
vm.runInNewContext(describe,context);
let items=[];context.markupItems(items,{});
assert.equal(items.length,5);assert.equal(items[0].title,'Shapes');
assert.deepEqual(items.slice(1).map(x=>x.items[0].ref||x.items[0].kind),['choices','.mk-context','.mk-opts','.mk-footer']);
pop.hidden=true;items=[];context.markupItems(items,{});assert.equal(items.length,4);
// A panel without a body selector must describe the panel root itself.
const panelFn=adapter.slice(adapter.indexOf('  function describePanel('),adapter.indexOf('  function describePanel(')+1500);
const panelEnd=panelFn.indexOf('\n  }')+4;
let describedRoot;
const root={hidden:false};
const panelContext={PANELS:{mkBar:{title:'Markup',stateless:true,items(items,body){describedRoot=body}}},
  document:{getElementById:()=>root},$:()=>null,clean:x=>x,walkBody(){}};
vm.runInNewContext(panelFn.slice(0,panelEnd),panelContext);
assert.equal(panelContext.describePanel('mkBar').title,'Markup');
assert.equal(describedRoot,root);
console.log('Native markup pane: map touch behavior and live control/auxiliary groups passed');
