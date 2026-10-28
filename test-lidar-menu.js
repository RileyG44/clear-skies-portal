'use strict';
/* The LiDAR menu: Presets first, and the shared azimuth/altitude dial that
   drives the two lighting inputs on the web and desktop (lidar-studio.js). */
const assert=require('node:assert/strict'),fs=require('node:fs');
const S=require('./lidar-studio.js');

function geometry(){
  const R=80;
  const at=(az,alt)=>S.sunFromPoint(...Object.values(S.sunPoint(az,alt,R)),R);
  assert.deepEqual(S.sunFromPoint(0,-R,R),{azimuth:0,altitude:5},'north is up, horizon at the rim (altitude floor 5)');
  assert.deepEqual(S.sunFromPoint(R/2,0,R),{azimuth:90,altitude:45},'east is clockwise from north');
  assert.deepEqual(S.sunFromPoint(0,R/2,R),{azimuth:180,altitude:45});
  assert.deepEqual(S.sunFromPoint(-R,0,R),{azimuth:270,altitude:5});
  assert.equal(S.sunFromPoint(0,0,R).altitude,90,'the zenith is the center');
  assert.equal(S.sunFromPoint(500,0,R).altitude,5,'outside the rim stays at the lowest allowed altitude');
  assert.equal(S.sunFromPoint(-0.01,-R,R).azimuth,359,'just west of north never wraps past 359');
  for(let az=0;az<360;az+=7)for(const alt of [5,20,45,61,89]) assert.deepEqual(at(az,alt),{azimuth:az,altitude:alt},`round trip ${az}/${alt}`);
  assert.deepEqual(S.sunPoint(0,90,R),{x:0,y:0});
  assert.equal(S.compassName(315),'NW');assert.equal(S.compassName(359),'N');assert.equal(S.compassName(100),'E');
}

/* Just enough DOM for the dial: elements, attributes, events and layout. */
class ClassList extends Set{remove(name){this.delete(name)}}
class Node{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.classList=new ClassList();this.textContent='';this.parentNode=null}
  setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')for(const c of String(v).split(' '))this.classList.add(c)}
  getAttribute(k){return this.attributes[k]??null}
  appendChild(n){n.parentNode=this;this.children.push(n);return n}
  append(...nodes){for(const n of nodes)this.appendChild(n)}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn)}
  dispatchEvent(event){for(const fn of this.listeners[type(event)]||[])fn(event);return true}
  setPointerCapture(id){this.captured=id}
  getBoundingClientRect(){return {left:100,top:200,width:200,height:200}}
  set className(v){this.classList=new ClassList(String(v).split(' '))}
}
const type=event=>event.type;
function fixture(){
  const doc=new Node('document');
  doc.createElement=tag=>new Node(tag);doc.createElementNS=(_,tag)=>new Node(tag);
  const input=(id,min,max,value)=>Object.assign(new Node('input'),{id,min:String(min),max:String(max),value:String(value),labels:[new Node('label')],disabled:false});
  const azimuth=input('terSunAz',0,359,315),altitude=input('terSunAlt',5,90,45);
  const events=[];
  for(const el of [azimuth,altitude])for(const t of ['input','change'])el.addEventListener(t,()=>events.push(`${el.id}:${t}:${el.value}`));
  const frames=[];
  const root=S.sunDial({azimuth,altitude,azimuthOutput:new Node('output'),altitudeOutput:new Node('output'),document:doc,schedule:fn=>frames.push(fn)});
  const face=root.children.find(n=>n.tagName==='svg');
  const pointer=(kind,x,y,extra={})=>face.dispatchEvent({type:kind,pointerId:1,button:0,clientX:x,clientY:y,preventDefault(){},...extra});
  const run=()=>{while(frames.length)frames.shift()()};
  return {doc,root,face,azimuth,altitude,events,pointer,run};
}

function interaction(){
  // Face center is (200,300); radius 80 in a 200-unit box of 200px.
  const f=fixture();
  assert.equal(f.root.getAttribute('role'),'group');assert.equal(f.azimuth.getAttribute('aria-label'),'Sun azimuth');
  assert.match(f.azimuth.getAttribute('aria-valuetext'),/315 degrees NW/);
  f.pointer('pointerdown',200,260);                       // north, half radius
  assert.equal(f.face.captured,1,'the dial keeps the pointer while dragging');
  assert.deepEqual([f.azimuth.value,f.altitude.value],['0','45']);
  f.pointer('pointermove',240,300);f.pointer('pointermove',264,300);
  assert.equal(f.azimuth.value,'0','moves are applied once per frame');
  f.run();
  assert.deepEqual([f.azimuth.value,f.altitude.value],['90','18'],'the last move in the frame wins');
  f.pointer('pointerup',264,300);
  const changes=f.events.filter(e=>e.includes(':change:'));
  assert.deepEqual(changes,['terSunAz:change:90','terSunAlt:change:18'],'release commits each value once');
  assert(f.events.filter(e=>e.startsWith('terSunAz:input')).length>=2,'dragging sends live input');
  const sun=f.root.children[0].children.find(n=>n.attributes.class==='sun-dial-sun');
  const point=S.sunPoint(90,18,80);
  assert.equal(sun.getAttribute('transform'),`translate(${point.x} ${point.y})`,'the drawn sun follows the inputs');

  // A cancelled gesture restores the values from before it.
  f.events.length=0;
  f.pointer('pointerdown',200,380);f.run();
  assert.deepEqual([f.azimuth.value,f.altitude.value],['180','5']);
  f.pointer('pointercancel',200,380);
  assert.deepEqual([f.azimuth.value,f.altitude.value],['90','18'],'cancel restores');
  assert(f.events.includes('terSunAz:change:90'),'the restored value is committed for saving');

  // Escape cancels a drag too; a non-primary button never starts one.
  f.pointer('pointerdown',200,300);f.run();assert.equal(f.altitude.value,'90');
  for(const fn of f.doc.listeners.keydown)fn({key:'Escape',preventDefault(){}});
  assert.deepEqual([f.azimuth.value,f.altitude.value],['90','18']);
  f.pointer('pointerdown',200,300,{button:2});f.run();assert.equal(f.altitude.value,'18');

  // Keyboard and resets change the inputs directly; the dial follows.
  f.azimuth.value='200';f.azimuth.dispatchEvent({type:'input'});
  const moved=S.sunPoint(200,18,80);
  assert.equal(sun.getAttribute('transform'),`translate(${moved.x} ${moved.y})`);
  assert.match(f.azimuth.getAttribute('aria-valuetext'),/200 degrees SSW/);
  f.azimuth.disabled=true;f.pointer('pointerdown',200,260);f.run();assert.equal(f.azimuth.value,'200','a disabled dial ignores pointers');
}

function markup(){
  const html=require("./test-fixtures/page-source.js");
  const studio=html.indexOf('id="terStudio"'),lidar=html.indexOf('id="terLidar"');
  assert(studio>0&&lidar>studio,'Presets come before Terrain mode & data');
  for(const id of ['terSunAz','terSunAlt','terSunAzOut','terSunAltOut','terAmbient','terExaggeration','terLightReset'])
    assert(html.includes(`id="${id}"`),`${id} stays the lighting state owner`);
  const ui=fs.readFileSync('ui-system.js','utf8');
  assert(/CSPLidarStudio\?\.sunDial\?\.\(\{azimuth,altitude/.test(ui),'the web mounts the shared dial on the original inputs');
  const layout=fs.readFileSync('ios/Sources/Shell/Items/ItemList.swift','utf8');
  assert(!/"Looks"|#terAppearance|#terLighting/.test(layout),'native LiDAR no longer uses the obsolete layout');
  const adapter=fs.readFileSync('ios/Resources/native-shell.js','utf8');
  assert(/closest\("\.ls-preset-option"\)/.test(adapter),'native preset delete is read beside the preset button');
  assert(!/Delete Look/.test(fs.readFileSync('ios/Sources/Shell/Items/LidarViews.swift','utf8')));
}

geometry();interaction();markup();
console.log('LiDAR menu checks passed (Presets first, dial geometry, live/commit/cancel events, keyboard sync, native preset delete wiring)');
