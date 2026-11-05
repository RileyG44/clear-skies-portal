"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const {execFileSync}=require("node:child_process");

async function main(){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"csp-landing-"));
  try{
    const web=path.join(temporary,"web"),read=name=>fs.readFileSync(path.join(web,name),"utf8");
    execFileSync("python3",["scripts/assemble-site.py",__dirname,web,"--pages"]);
    assert.equal(read("map.html"),fs.readFileSync("index.html","utf8"),"the public map keeps the original app shell and relative asset paths");
    assert.equal(JSON.parse(read("manifest.json")).start_url,"./map.html","installed web apps launch the map directly");
    const site=JSON.parse(read("site.json"));
    assert.equal(new Set(site.web).size,site.web.length,"public shell assets are unique");
    for(const name of [...site.web,...site.vendor])assert(fs.existsSync(path.join(web,name)),`shipped asset missing: ${name}`);
    for(const name of site.landing)assert.equal(readBytes(name).equals(fs.readFileSync(path.join("landing",name))),true,`landing asset bytes: ${name}`);
    function readBytes(name){return fs.readFileSync(path.join(web,name))}

    const landing=read("index.html"),route=landing.match(/<script>([\s\S]*?)<\/script>/)[1];
    function destination({hash="",search="",standalone=false,ios=false}={}){
      let next=null;
      vm.runInNewContext(route,{location:{hash,search,replace:value=>next=value},matchMedia:()=>({matches:standalone}),navigator:{standalone:ios}});
      return next;
    }
    assert.equal(destination(),null,"ordinary website visits stay on the landing page");
    assert.equal(destination({search:"?date=2026-10-10"}),null,"seasonal preview dates stay on the landing page");
    assert.equal(destination({hash:"#csp=1.payload&theme=dark",search:"?reload=1"}),"map.html?reload=1#csp=1.payload&theme=dark","legacy share payloads and queries survive");
    assert.equal(destination({hash:"#engine=https%3A%2F%2Fengine.test"}),"map.html#engine=https%3A%2F%2Fengine.test","legacy engine links still open the map");
    assert.equal(destination({standalone:true}),"map.html","existing installed PWAs with a root start URL reach the map");
    assert.equal(destination({ios:true}),"map.html","existing iOS home-screen launches reach the map");
    assert(landing.includes('--brand:Pacifico')&&landing.includes('font-weight:400'),"the landing wordmark uses bundled Pacifico Regular");
    for(const name of ["index.html","download.html","explore.html"]){
      const html=read(name);
      assert(html.includes('href="map.html"'),`${name} links to the map`);
      assert(!html.includes('https://rileyg44.github.io/clear-skies-portal/'),`${name} cannot link the web app back to the landing page`);
    }

    // Exercise the real production minifier: import maps are JSON, not JS.
    execFileSync(process.execPath,["scripts/minify-site.js",web]);
    for(const name of ["index.html","download.html","explore.html"]){
      const html=read(name);
      for(const [,attrs,code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
        if(attrs.includes('type="importmap"'))assert(JSON.parse(code).imports.three);
        else if(!attrs.includes('src='))await require("esbuild").transform(code,{loader:"js"});
      }
    }

    const base="https://portal.test/clear-skies-portal/",events={},cache=new Map(),pending=[];
    const absolute=value=>new URL(typeof value==="string"?value:value.url,base).href;
    let offline=false,status=200;
    const context={URL,Response,Headers,
      self:{location:{origin:new URL(base).origin,href:base+"sw.js"},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{}},
      caches:{match:async key=>cache.get(absolute(key))?.clone(),open:async()=>({
        addAll:async names=>{for(const name of names){const file=name==="./"?"index.html":name.replace(/^\.\//,"").split("?")[0];cache.set(absolute(name),new Response(readBytes(file),{headers:{"Content-Type":file.endsWith(".html")?"text/html":"application/octet-stream"}}))}},
        put:async(key,response)=>cache.set(absolute(key),response)
      })},
      fetch:async req=>{
        if(offline)throw Error("offline");
        if(String(req).endsWith("site.json"))return new Response(read("site.json"));
        const url=new URL(req.url||req,base),name=url.pathname.slice(new URL(base).pathname.length)||"index.html";
        return new Response(read(name),{status,headers:{"Content-Type":"text/html"}});
      }};
    vm.runInNewContext(fs.readFileSync("sw.js","utf8"),context);
    let install;
    events.install({waitUntil:p=>install=p});await install;
    cache.set(base+"csp-map-theme",new Response("dark"));
    async function navigate(name){
      let result;
      events.fetch({request:{url:base+name,method:"GET",mode:"navigate"},respondWith:p=>result=p,waitUntil:p=>pending.push(p)});
      const response=await result;
      await Promise.all(pending.splice(0));
      return response;
    }
    const map=await (await navigate("map.html?reload=1")).text();
    assert(map.includes('data-ui-theme="dark"'),"the map keeps its saved splash theme");
    for(const name of ["","index.html","download.html","explore.html"]){
      const page=await (await navigate(name)).text();
      assert(!page.includes('data-ui-theme="dark"'),`${name} keeps its marketing theme`);
    }
    offline=true;
    const offlineMap=await (await navigate("map.html?reload=2")).text();
    assert(offlineMap.includes("window.CSPBoot"),"marketing navigation never replaces the offline map");
    assert(offlineMap.includes('data-ui-theme="dark"'),"the offline map keeps the saved theme");
    assert.equal(await (await navigate("")).text(),read("index.html"),"the offline landing page retains its own cache entry");
    assert.equal(await (await navigate("download.html")).text(),read("download.html"));
    offline=false;status=503;
    assert.equal((await navigate("map.html")).status,503);
    offline=true;
    assert((await (await navigate("map.html")).text()).includes("window.CSPBoot"),"HTTP errors cannot overwrite a good cached map");
    console.log("Landing routing passed: public assembly, production minification, shared links, installed launches and isolated offline documents");
  }finally{fs.rmSync(temporary,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
