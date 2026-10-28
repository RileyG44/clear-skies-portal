/* Markup (annotation) layers: one GeoJSON file per layer in the user's markup
   folder, never in the cache. Saves are last-edit-wins; deletes leave a
   tombstone so an older copy on another device cannot bring a layer back. */
"use strict";
const fsp = require("fs").promises;
const path = require("path");
const {HttpError,readBody,readJson,send,jsonBody} = require("./http.js");

let MARKUP = null, MARKUP_TOMBSTONES = null;
function init(dir){ MARKUP=dir; MARKUP_TOMBSTONES=path.join(MARKUP,".deleted.json") }
const MARKUP_ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_MARKUP_BODY=8*1024*1024, MAX_MARKUP_FEATURES=20000;
function markupPath(id){
  if(!MARKUP_ID.test(id)) throw new HttpError(400,"invalid markup layer id");
  return path.join(MARKUP,id+".geojson");
}
function validMarkupLayer(doc,id){
  const meta=doc&&doc.markup;
  if(!doc||doc.type!=="FeatureCollection"||!Array.isArray(doc.features)||!meta||typeof meta!=="object")
    throw new HttpError(400,"markup layer must be a GeoJSON FeatureCollection with a markup header");
  if(meta.id!==id) throw new HttpError(400,"markup layer id does not match its address");
  if(typeof meta.name!=="string"||!meta.name.trim()||meta.name.length>120) throw new HttpError(400,"markup layer needs a name");
  if(meta.description!==undefined&&(typeof meta.description!=="string"||meta.description.length>1000)) throw new HttpError(400,"markup description must be text up to 1000 characters");
  if(!/^#[0-9a-f]{6}$/i.test(String(meta.color||""))) throw new HttpError(400,"markup layer colour must be #rrggbb");
  if(!Number.isFinite(meta.updated)) throw new HttpError(400,"markup layer needs an updated time");
  if(doc.features.length>MAX_MARKUP_FEATURES) throw new HttpError(413,"too many markup features");
  for(const f of doc.features)
    if(!f||f.type!=="Feature"||!f.geometry||typeof f.geometry.type!=="string"||!f.properties||typeof f.properties!=="object")
      throw new HttpError(400,"markup features must be GeoJSON Features with properties");
  return doc;
}
async function markupTombstones(){
  try{ return JSON.parse(await fsp.readFile(MARKUP_TOMBSTONES,"utf8"))||{} }catch(e){ return {} }
}
async function markupWrite(file,text){
  await fsp.mkdir(MARKUP,{recursive:true});
  const tmp=file+"."+process.pid+"."+Date.now()+".tmp";
  await fsp.writeFile(tmp,text);await fsp.rename(tmp,file);
}
async function markupRead(id){
  try{ return JSON.parse(await fsp.readFile(markupPath(id),"utf8")) }
  catch(e){ if(e&&e.code==="ENOENT") return null; throw e }
}
async function markupList(){
  let names=[];
  try{ names=(await fsp.readdir(MARKUP)).filter(n=>n.endsWith(".geojson")) }catch(e){ if(e.code!=="ENOENT") throw e }
  const layers=[];
  for(const name of names){
    try{
      const doc=JSON.parse(await fsp.readFile(path.join(MARKUP,name),"utf8")),m=doc.markup||{};
      layers.push({id:m.id,name:m.name,color:m.color,updated:m.updated,count:(doc.features||[]).length});
    }catch(e){}
  }
  return {layers:layers.filter(l=>l.id&&MARKUP_ID.test(l.id)),deleted:await markupTombstones()};
}

/* Paths these routes do not recognise fall through to the static 404. */
const routes={
  "/api/markup":async(req,res)=>{
    if(req.method!=="GET") return false;
    return send(res,200,"application/json",jsonBody(await markupList()),{"Cache-Control":"no-store"});
  },
  "/api/markup/":async(req,res,{p})=>{
    const m=/^\/api\/markup\/([^/]+)(\/delete)?$/.exec(p);
    if(!m) return false;
    const id=m[1],file=markupPath(id);
    if(m[2]){
      if(req.method!=="POST") return send(res,405,"application/json",jsonBody({error:"method not allowed"}),{"Allow":"POST"});
      const body=await readJson(req,{}),at=Number(body.at)||Date.now();
      const stones=await markupTombstones();stones[id]=Math.max(stones[id]||0,at);
      await markupWrite(MARKUP_TOMBSTONES,JSON.stringify(stones));
      try{ await fsp.mkdir(path.join(MARKUP,".trash"),{recursive:true});await fsp.rename(file,path.join(MARKUP,".trash",`${id}-${Date.now()}.geojson`)) }
      catch(e){ if(e.code!=="ENOENT") throw e }
      return send(res,200,"application/json",jsonBody({ok:true,deleted:stones[id]}),{"Cache-Control":"no-store"});
    }
    if(req.method==="GET"){
      const doc=await markupRead(id);
      if(!doc) return send(res,404,"application/json",jsonBody({error:"no such markup layer"}),{"Cache-Control":"no-store"});
      return send(res,200,"application/geo+json",jsonBody(doc),{"Cache-Control":"no-store"});
    }
    if(req.method==="POST"){
      let doc;
      try{ doc=JSON.parse((await readBody(req,MAX_MARKUP_BODY)).toString()) }
      catch(e){ if(e instanceof HttpError) throw e; throw new HttpError(400,"invalid JSON body") }
      validMarkupLayer(doc,id);
      const stones=await markupTombstones();
      if(stones[id]&&stones[id]>=doc.markup.updated)
        return send(res,410,"application/json",jsonBody({error:"markup layer was deleted",deleted:stones[id]}),{"Cache-Control":"no-store"});
      const stored=await markupRead(id);
      if(stored&&stored.markup&&stored.markup.updated>doc.markup.updated)
        return send(res,409,"application/geo+json",jsonBody(stored),{"Cache-Control":"no-store"});
      await markupWrite(file,JSON.stringify(doc));
      return send(res,200,"application/json",jsonBody({ok:true,updated:doc.markup.updated}),{"Cache-Control":"no-store"});
    }
    return send(res,405,"application/json",jsonBody({error:"method not allowed"}),{"Allow":"GET, POST"});
  }
};

module.exports={init,routes};
