"use strict";
// Real Electron welcome/configuration flow in disposable user data. No public
// terrain providers are needed; package completeness is verified separately.
const fs=require("fs"),os=require("os"),path=require("path"),assert=require("assert/strict");
const {spawn}=require("child_process"),{once}=require("events"),{chromium}=require("playwright-core");
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"csp-setup-flow-"));
const userData=path.join(scratch,"profile"),entry=path.join(scratch,"entry.cjs");
fs.mkdirSync(userData);
fs.writeFileSync(entry,`const {app}=require("electron");app.setPath("userData",${JSON.stringify(userData)});app.setPath("sessionData",${JSON.stringify(userData)});require(${JSON.stringify(path.resolve("electron/main.js"))});`);
const appEnv={...process.env,CSP_ELECTRON_OWN_SERVER:"1",CSP_DNR_ARCHIVE_DIR:"off"};
// On Windows an empty value still enables Electron's Node-only mode.
delete appEnv.ELECTRON_RUN_AS_NODE;

async function launch(){
  const child=spawn(require("electron"),[entry,"--remote-debugging-port=0"],{
    env:appEnv,
  });
  let log="";child.stdout.on("data",data=>{log+=data;});
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`Electron launch timed out: ${log}`)),20000);
    child.stderr.on("data",data=>{
      log+=data;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);
      if(match){clearTimeout(timer);resolve(match[1]);}
    });
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("exit",code=>{clearTimeout(timer);reject(Error(`Electron exited (${code}): ${log}`));});
  }).catch(error=>{child.kill();throw error;});
  const browser=await chromium.connectOverCDP(endpoint);
  const context=browser.contexts()[0];
  await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/,route=>route.abort());
  async function findPage(pattern){
    for(let i=0;i<200;i++){
      const page=context.pages().find(candidate=>pattern.test(candidate.url()));
      if(page){await page.waitForLoadState("domcontentloaded");return page;}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const session=await browser.newBrowserCDPSession();
    throw Error(`Missing Electron page ${pattern}: ${JSON.stringify(await session.send("Target.getTargets"))}\n${log}`);
  }
  async function map(){
    const root=await browser.newBrowserCDPSession();
    for(let i=0;i<200;i++){
      const {targetInfos}=await root.send("Target.getTargets");
      const target=targetInfos.find(target=>target.type==="page"&&/^http:\/\/127\.0\.0\.1:\d+\/$/.test(target.url));
      if(target){
        const url=new URL(endpoint);url.pathname="/devtools/page/"+target.targetId;
        return {url:()=>target.url,async evaluate(fn){
          const socket=new WebSocket(url);
          await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
          try{return await new Promise((resolve,reject)=>{
            socket.addEventListener("message",event=>{const message=JSON.parse(event.data);if(message.id!==1)return;
              if(message.error||message.result?.exceptionDetails)reject(Error(JSON.stringify(message)));else resolve(message.result.result.value);});
            socket.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression:`(${fn.toString()})()`,awaitPromise:true,returnByValue:true}}));
          });}finally{socket.close();}
        }};
      }
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error("Background map did not load");
  }
  const page=await (fs.existsSync(path.join(userData,"setup-v3.json"))?map():findPage(/\/setup\/index\.html$/));
  return {page,map,async reopen(){
    const second=spawn(require("electron"),[entry,"--setup"],{env:appEnv,stdio:"ignore"});
    await once(second,"exit");return findPage(/\/setup\/index\.html$/);
  },async close(){
    const session=await browser.newBrowserCDPSession();
    const exited=once(child,"exit"),timer=setTimeout(()=>child.kill(),5000);
    session.send("Browser.close").catch(()=>{});
    await exited;clearTimeout(timer);
    await browser.close();
  }};
}

async function verify(){
  await require("./prepare-startup-cache").prepare();
  let instance;
  try{
    instance=await launch();let page=instance.page;
    const openMap=async selector=>{
      const dismissed=page.waitForEvent("close",{timeout:45000});
      await page.locator(selector).click().catch(error=>{if(!page.isClosed())throw error;});
      await dismissed;page=await instance.map();
    };
    await page.locator("#finish:not([disabled])").waitFor();
    assert.equal(await page.locator("details").getAttribute("open"),null,"advanced setup starts collapsed");
    await page.locator(".welcome-learn").click();await page.waitForURL("**/setup/guide.html");
    if(process.platform==="darwin")assert.equal(await page.locator("#tailscale-download").getAttribute("href"),"https://tailscale.com/download/mac");
    await page.locator(".setup-back").click();await page.waitForURL("**/setup/index.html");
    await page.locator("#finish:not([disabled])").waitFor();
    const warmed=await instance.map();
    await warmed.evaluate(()=>{window.setupWarmToken="retained-map";});
    await openMap("#finish");
    assert.equal(await page.evaluate(()=>window.setupWarmToken),"retained-map","setup reveals the already-loaded map without reloading");
    assert.equal(await page.evaluate(()=>localStorage.getItem("clearskies.panShading.v1")),"auto");
    let health=await (await fetch(new URL("/api/health",page.url()))).json();
    assert.equal(health.cacheBudget.capGiB,15);assert.equal(health.memoryCache.limitMiB,256);
    assert.equal(health.cacheDisk.minFreeGiB,8);
    const seed=await fetch(new URL("/api/elev/overview/10/177/357.png",page.url()));
    assert.equal(seed.headers.get("X-Cache"),"hit","default terrain is bundled and ready before setup finishes");
    page=await instance.reopen();
    await page.locator("#finish:not([disabled])").waitFor();
    await page.locator("summary").click();
    for(const [key,value] of Object.entries({tileCacheGiB:23,dnrCacheGiB:40,memoryCacheMiB:128,minFreeGiB:4}))
      await page.locator(`[name="${key}"]`).fill(String(value));
    await page.locator('[name="workers"]').selectOption("2");
    await page.locator('[name="panShading"]').selectOption("on");
    await openMap("#apply-configuration");
    health=await (await fetch(new URL("/api/health",page.url()))).json();
    assert.equal(health.cacheBudget.capGiB,23);assert.equal(health.memoryCache.limitMiB,128);
    assert.equal(health.cacheDisk.minFreeGiB,4);assert.equal(health.terrain.workers,2);
    assert.equal(health.dnr.maxBytes,40*1073741824);
    assert.equal(await page.evaluate(()=>localStorage.getItem("clearskies.panShading.v1")),"on");
    await page.evaluate(()=>{localStorage.setItem("clearskies.panShading.v1","off");document.dispatchEvent(new CustomEvent("csp:pan-shading",{detail:{mode:"off"}}));});
    // Drain the IPC handler through a subsequent trusted setup request.
    page=await instance.reopen();
    assert.equal((await page.evaluate(()=>window.clearSkiesSetup.configuration())).config.panShading,"off");
    await instance.close();instance=null;
    const saved=JSON.parse(fs.readFileSync(path.join(userData,"desktop-config.json"),"utf8"));
    assert.equal(saved.tileCacheGiB,23);assert.equal(saved.panShading,"off");
    instance=await launch();page=instance.page;
    assert.equal(await page.evaluate(()=>localStorage.getItem("clearskies.panShading.v1")),"off");
    health=await (await fetch(new URL("/api/health",page.url()))).json();
    assert.equal(health.cacheBudget.capGiB,23);assert.equal(health.terrain.workers,2);
    console.log("Real Electron setup: background map retained, defaults, guide, advanced engine limits, in-app panning and restart persistence passed.");
  }finally{if(instance)await instance.close();fs.rmSync(scratch,{recursive:true,force:true});}
}
const deadline=setTimeout(()=>{console.error("Desktop setup verification timed out");process.exit(1);},120000);
verify().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
