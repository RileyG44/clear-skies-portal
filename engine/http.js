/* HTTP plumbing shared by every route: CORS, request bodies, compression and
   responses, including static files. */
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const zlib = require("zlib");

const MAX_BODY = 256*1024;
const MIME = {".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",
  ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".svg":"image/svg+xml",".wasm":"application/wasm",".md":"text/markdown; charset=utf-8",".txt":"text/plain; charset=utf-8",".woff2":"font/woff2"};

const CORS_ORIGINS = new Set(["https://rileyg44.github.io"]);
for(const value of String(process.env.CSP_CORS_ORIGINS||"").split(",")){
  const origin=value.trim(); if(origin) CORS_ORIGINS.add(origin);
}

class HttpError extends Error {
  constructor(status, message){ super(message); this.status=status }
}

function allowedOrigin(req){
  const origin=req.headers.origin;
  if(!origin) return null;
  if(CORS_ORIGINS.has(origin)) return origin;
  try{
    const u=new URL(origin);
    if((u.protocol==="http:"||u.protocol==="https:") &&
       (u.hostname==="localhost"||u.hostname==="127.0.0.1"||u.hostname==="[::1]")) return origin;
  }catch(e){}
  return null;
}

async function readBody(req, limit=MAX_BODY){
  const chunks=[]; let size=0, tooLarge=false;
  for await (const chunk of req){
    size+=chunk.length;
    if(size>limit){ tooLarge=true; continue }
    chunks.push(chunk);
  }
  if(tooLarge) throw new HttpError(413, `request body exceeds ${limit} bytes`);
  return Buffer.concat(chunks);
}

async function readJson(req, fallback){
  const text=(await readBody(req)).toString().trim();
  if(!text && fallback!==undefined) return fallback;
  try{ return JSON.parse(text) }
  catch(e){ throw new HttpError(400,"invalid JSON body") }
}

/* Text bodies (JSON, scripts, styles, markup) go out compressed when the
   client accepts it: the page reaches this engine over Tailscale, often from
   a phone, and JSON and the app shell shrink 4-10x. Compression runs on
   libuv's thread pool, never on the event loop that is serving tiles. Images
   are already compressed and pass straight through. */
const COMPRESSIBLE=/^(?:text\/|application\/(?:json|javascript|xml|geo\+json|manifest\+json|vnd\.geo\+json)|image\/svg\+xml)/;
const COMPRESS_MIN=1024;
function pickEncoding(req){
  const ae=String(req&&req.headers&&req.headers["accept-encoding"]||"");
  return /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gzip" : null;
}
function compress(body,encoding,level){
  return new Promise((resolve,reject)=>{
    const done=(error,out)=>error?reject(error):resolve(out);
    if(encoding==="br") zlib.brotliCompress(body,{params:{
      [zlib.constants.BROTLI_PARAM_QUALITY]:level==="static"?9:5,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]:body.length}},done);
    else zlib.gzip(body,{level:level==="static"?9:5},done);
  });
}
function send(res, status, type, body, extra={}){
  if(res.destroyed||res.writableEnded) return;
  const origin=allowedOrigin(res.req);
  const headers={"Content-Type":type,"X-Content-Type-Options":"nosniff",...extra};
  const vary=[];
  if(origin){
    headers["Access-Control-Allow-Origin"]=origin;
    headers["Access-Control-Expose-Headers"]="X-Coverage, X-Cache, X-CSP-Error, X-Elevation-Source, X-Ground-Res, X-Sources, X-DNR-Status, X-DNR-Revision, X-DNR-Sources, Retry-After";
    vary.push("Origin");
  }
  if(COMPRESSIBLE.test(type)) vary.push("Accept-Encoding");
  if(vary.length) headers.Vary=vary.join(", ");
  const encoding=COMPRESSIBLE.test(type) && !headers["Content-Encoding"] && Buffer.isBuffer(body) && body.length>=COMPRESS_MIN && res.req && res.req.method!=="HEAD"
    ? pickEncoding(res.req) : null;
  if(!encoding){ res.writeHead(status,headers).end(body); return }
  compress(body,encoding,"dynamic").then(out=>{
    if(res.destroyed||res.writableEnded) return;
    headers["Content-Encoding"]=encoding;
    res.writeHead(status,headers).end(out);
  },()=>{ if(!res.destroyed&&!res.writableEnded) res.writeHead(status,headers).end(body) });
}

/* Static files: an ETag from size and mtime (or the content, for bytes the
   caller built), so a reload revalidates with a
   304 instead of re-downloading the 640 KB app shell, and the compressed form
   is made once per file version (at a higher level, since it is reused) rather
   than on every request. `no-cache` still asks on every load, so a deploy is
   picked up immediately - it just costs a round trip, not the whole body. */
const staticCompressed=new Map();          // path|etag|encoding -> Buffer
async function sendStatic(req,res,f,built=null){
  let size, etag;
  if(built){
    size=built.length; etag=`"${crypto.createHash("sha1").update(built).digest("base64url").slice(0,20)}"`;
  }else{
    let st; try{ st=await fs.promises.stat(f) }catch(e){ return send(res,404,"text/plain",Buffer.from("not found")) }
    if(!st.isFile()) return send(res,404,"text/plain",Buffer.from("not found"));
    size=st.size; etag=`"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  }
  const type=MIME[path.extname(f).toLowerCase()]||"application/octet-stream";
  const encoding=COMPRESSIBLE.test(type)&&size>=COMPRESS_MIN ? pickEncoding(req) : null;
  const tag=encoding ? etag.slice(0,-1)+"-"+encoding+'"' : etag;
  const extra={"Cache-Control":"no-cache","ETag":tag};
  const inm=String(req.headers["if-none-match"]||"");
  if(inm && inm.split(/\s*,\s*/).some(value=>value===tag||value==="W/"+tag||value==="*")){
    const origin=allowedOrigin(req), headers={...extra,"Vary":"Accept-Encoding"};
    if(origin){ headers["Access-Control-Allow-Origin"]=origin; headers.Vary+=", Origin" }
    return res.writeHead(304,headers).end();
  }
  let buf=built; if(!buf) try{ buf=await fs.promises.readFile(f) }catch(e){ return send(res,404,"text/plain",Buffer.from("not found")) }
  if(!encoding) return send(res,200,type,buf,extra);
  const key=`${f}|${etag}|${encoding}`;
  let out=staticCompressed.get(key);
  if(!out){
    try{ out=await compress(buf,encoding,"static") }catch(e){ return send(res,200,type,buf,extra) }
    for(const k of [...staticCompressed.keys()])      // drop superseded versions of this file
      if(k.startsWith(f+"|") && !k.startsWith(`${f}|${etag}|`)) staticCompressed.delete(k);
    staticCompressed.set(key,out);
  }
  return send(res,200,type,out,{...extra,"Content-Encoding":encoding});
}

const jsonBody = value => Buffer.from(JSON.stringify(value));

module.exports={MIME,HttpError,allowedOrigin,readBody,readJson,pickEncoding,compress,send,sendStatic,jsonBody};
