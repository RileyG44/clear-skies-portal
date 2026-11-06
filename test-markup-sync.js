'use strict';
/* Markup sync between two devices and one engine: an edit made on one device
   while another device saved the same layer is never thrown away. Runs the
   real syncAll/push/adopt code from markup.js against an in-memory engine
   with the same 409/410 rules as engine/markup-store.js. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('markup.js','utf8');
const start=source.indexOf('async function syncAll('),end=source.indexOf('function status(',start);
const sync=source.slice(start,end);
const slugCode=source.slice(source.indexOf('function slug('),source.indexOf('/* Arrow head',source.indexOf('function slug(')));
assert(start>0&&end>start&&slugCode.includes('function slug('));

function engine(){
  const docs=new Map(),stones={};
  const json=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>JSON.parse(JSON.stringify(body))});
  return {docs,
    async fetch(url,opts={}){
      if(url==='/api/markup') return json(200,{layers:[...docs.values()].map(d=>({id:d.markup.id,name:d.markup.name,updated:d.markup.updated})),deleted:stones});
      const m=/^\/api\/markup\/([^/]+)$/.exec(url);
      if(!m) return json(404,{});
      const id=m[1];
      if(!opts.method) return docs.has(id)?json(200,docs.get(id)):json(404,{});
      const doc=JSON.parse(opts.body);
      if(stones[id]>=doc.markup.updated) return json(410,{});
      const stored=docs.get(id);
      if(stored&&stored.markup.updated>doc.markup.updated) return json(409,stored);
      docs.set(id,JSON.parse(opts.body));return json(200,{ok:true});
    }};
}

function device(server,clock){
  const ctx={
    B:{api:p=>p},serverState:()=>({online:true}),status(){},changed(){},
    fetch:(...a)=>server.fetch(...a),
    layers:new Map(),pendingDeletes:new Map(),undoStacks:new Map(),redoStacks:new Map(),
    syncing:false,syncAgain:false,editing:null,gesture:null,selected:null,started:[],
    readView:()=>({}),writeView(){},applyOrder(){},renderLayer(){},deselect(){},stopEditing(){},
    startEditing(layer){ctx.editing=layer;ctx.started.push(layer)},
    nextRank:()=>Math.max(0,...[...ctx.layers.values()].map(l=>l.rank+1)),
    makeLayer(doc,view={}){
      const layer={doc,visible:view.on===true,opacity:view.op??100,rank:0,syncedAt:null,
        group:{remove(){}},renderer:{remove(){}},pane:{remove(){}}};
      ctx.layers.set(doc.markup.id,layer);return layer;
    },
    touch(layer){layer.doc.markup.updated=clock()},
    schedule3d(){},Date:{now:clock},Math,JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(slugCode+sync,ctx);
  return ctx;
}

(async()=>{
  let t=1000;const clock=()=>++t;
  const server=engine(),a=device(server,clock),b=device(server,clock);
  const mark=(name)=>({type:'Feature',geometry:{type:'Point',coordinates:[0,0]},properties:{fid:name,kind:'pin'}});
  const edit=(dev,id,name)=>{const l=dev.layers.get(id);l.doc.features.push(mark(name));dev.touch(l);return l};

  /* Device A makes a layer; both devices load it. */
  const doc={type:'FeatureCollection',markup:{id:'ridge-abc123',name:'Ridge',description:'',color:'#f00',created:1,updated:clock()},features:[]};
  a.makeLayer(doc,{on:true});
  await a.syncAll();await b.syncAll();
  assert.equal(server.docs.get('ridge-abc123').markup.name,'Ridge');
  assert.equal(b.layers.get('ridge-abc123').syncedAt,server.docs.get('ridge-abc123').markup.updated);

  /* Plain case: only one device edits, the other picks it up. No copies. */
  edit(a,'ridge-abc123','a1');await a.syncAll();await b.syncAll();
  assert.deepEqual(b.layers.get('ridge-abc123').doc.features.map(f=>f.properties.fid),['a1']);
  assert.equal(b.layers.size,1,'no conflict copy without a conflict');

  /* B edits first and saves; A edits later (newer clock) without having
     seen B's save. Before the fix A either overwrote B's marks (its copy was
     newer) or adopted B's copy and dropped its own. Now both survive. */
  edit(b,'ridge-abc123','b1');await b.syncAll();
  edit(a,'ridge-abc123','a2');
  await a.syncAll();
  const original=server.docs.get('ridge-abc123');
  assert.deepEqual(original.features.map(f=>f.properties.fid),['a1','b1'],"the other device's save is not overwritten");
  const saved=[...server.docs.values()].filter(d=>d.markup.id!=='ridge-abc123');
  assert.equal(saved.length,1,'the edits made here are saved as their own layer');
  assert.equal(saved[0].markup.name,'Ridge (conflict copy)');
  assert.deepEqual(saved[0].features.map(f=>f.properties.fid),['a1','a2']);
  assert.deepEqual(a.layers.get('ridge-abc123').doc.features.map(f=>f.properties.fid),['a1','b1']);

  /* The 409 race: B's save lands between A's listing and A's save. */
  const before=server.fetch;let raced=false;
  edit(a,'ridge-abc123','a3');
  server.fetch=async(url,opts)=>{
    if(!raced&&opts?.method==='POST'&&url==='/api/markup/ridge-abc123'){
      raced=true;const theirs=edit(b,'ridge-abc123','b2');
      await before(url,{method:'POST',body:JSON.stringify(theirs.doc)});theirs.syncedAt=theirs.doc.markup.updated;
    }
    return before(url,opts);
  };
  await a.syncAll();server.fetch=before;
  assert(raced);
  const local=a.layers.get('ridge-abc123');
  assert.deepEqual(local.doc.features.map(f=>f.properties.fid),['a1','b1','b2'],'the engine copy is shown after a 409');
  const kept=[...a.layers.values()].filter(l=>l.conflictCopy&&l.doc.features.some(f=>f.properties.fid==='a3'));
  assert.equal(kept.length,1,'a rejected save keeps its edits as a conflict copy');
  await a.syncAll();
  assert([...server.docs.values()].some(d=>d.features.some(f=>f.properties.fid==='a3')),'and the copy reaches the engine');

  /* Editing the layer when it conflicts moves the pen to the copy, with its
     undo history, so the next stroke lands in this device's version. */
  edit(b,'ridge-abc123','b3');await b.syncAll();
  const pen=edit(a,'ridge-abc123','a4');a.editing=pen;a.undoStacks.set('ridge-abc123',['[]']);
  await a.syncAll();
  assert.notEqual(a.editing,pen);assert(a.editing.conflictCopy);
  assert.deepEqual(a.undoStacks.get(a.editing.doc.markup.id),['[]']);
  assert.equal(a.undoStacks.has('ridge-abc123'),false);

  /* Mid-gesture, nothing is pulled and nothing is overwritten: wait. */
  edit(b,'ridge-abc123','b4');await b.syncAll();
  const held=edit(a,'ridge-abc123','a5');a.editing=held;a.gesture={};
  const n=a.layers.size;await a.syncAll();
  assert.equal(a.layers.size,n);
  assert(!server.docs.get('ridge-abc123').features.some(f=>f.properties.fid==='a5'),'held edits do not overwrite the engine');
  a.gesture=null;await a.syncAll();
  assert(server.docs.get('ridge-abc123').features.some(f=>f.properties.fid==='b4'));
  assert([...a.layers.values()].some(l=>l.conflictCopy&&l.doc.features.some(f=>f.properties.fid==='a5')));

  /* The same content on both sides is not a conflict. */
  const same=a.layers.get('ridge-abc123');const count=a.layers.size;
  const copy=JSON.parse(JSON.stringify(server.docs.get('ridge-abc123')));
  same.doc=JSON.parse(JSON.stringify(copy));same.doc.markup.updated=clock();
  copy.markup.updated=clock();server.docs.set('ridge-abc123',copy);
  await a.syncAll();
  assert.equal(a.layers.size,count,'identical edits do not make a copy');
  console.log('markup sync passed (no lost edits across devices, 409 race, editing moves to the copy, mid-gesture hold, identical edits)');
})().catch(e=>{console.error(e);process.exit(1)});
