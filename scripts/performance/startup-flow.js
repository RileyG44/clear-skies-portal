/* Actual Three.js startup checks, run against an assembled production site.
   node scripts/performance/startup-flow.js <assembled-site> <evidence-directory>
   Needs Google Chrome and playwright-core (already a dev dependency). The
   temporary HTTP server is a test fixture; it closes with the browser. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright-core');
const root = path.resolve(process.argv[2] || '_site');
const output = path.resolve(process.argv[3] || 'artifacts/startup-flow');
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(path.join(root, 'map.html'), 'utf8');
const boot = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('window.CSPBoot'));
const tree = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/)[1];
const harness = `<!doctype html><html><head><meta name="theme-color" content="#fff"><style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style><style>body{margin:0}#app{position:fixed;inset:0;background:#608268}</style><script>${boot}</script>${html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0]}</head><body><div id="app" inert><input id="q"><div id="map"></div></div><div id="cspSplash"><canvas id="cspSplashTree"></canvas></div><section id="cspStartup"><p id="cspStartupMessage"></p><a id="cspStartupRetry">Reload</a></section><script type="module">${tree}</script></body></html>`;
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/harness.html'){res.setHeader('Content-Type','text/html');res.end(harness);return}
  const file=path.join(root,name);
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);
  });
});
const pixels=page=>page.evaluate(()=>new Promise(resolve=>{
  const timeout=setTimeout(()=>resolve({timeout:true}),2000);window.captureTreeFrame=value=>{clearTimeout(timeout);resolve(value)};
  dispatchEvent(new Event('resize'));
}));
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
  try{
    for(const settings of [{name:'phone',width:390,height:844},{name:'desktop',width:1440,height:900},{name:'system-reduce',width:390,height:844,reduced:true},{name:'app-reduce',width:390,height:844,appReduce:true},{name:'worker-fallback',width:390,height:844,workerFail:true}]){
      const context=await browser.newContext({viewport:{width:settings.width,height:settings.height},deviceScaleFactor:2,reducedMotion:settings.reduced?'reduce':'no-preference'});
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('page error',e.message)});
      await page.addInitScript(({appReduce,workerFail})=>{
        if(workerFail)window.Worker=class{constructor(){throw new Error('Module worker unavailable')}};
        if(appReduce)localStorage.setItem('clearskies.reduceMotion.v1','1');
        window.treeFrames=0;
        const draw=WebGL2RenderingContext.prototype.drawElementsInstanced;
        WebGL2RenderingContext.prototype.drawElementsInstanced=function(...args){if(this.canvas.id==='cspSplashTree')window.treeFrames++;const result=draw.apply(this,args);
          if(this.canvas.id==='cspSplashTree'&&window.captureTreeFrame){const capture=window.captureTreeFrame;window.captureTreeFrame=null;const gl=this;
            queueMicrotask(()=>{const c=gl.canvas,p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);let ink=0,hash=0;for(let i=0;i<p.length;i+=4){if(Math.min(p[i],p[i+1],p[i+2])<240)ink++;hash=(Math.imul(hash,31)+p[i]+p[i+1]+p[i+2])|0}capture({ink,hash,frames:window.treeFrames})});}
          return result};
      },settings);
      await page.goto(url+'/harness.html');
      await page.evaluate(()=>document.documentElement.dispatchEvent(new Event('csp:ready')));
      await page.waitForSelector('#cspSplashTree.on');
      const a=await pixels(page);assert(!a.timeout,'capture must occur during an actual GL draw');
      await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'q','Tab cannot reach controls behind the cover');await page.waitForTimeout(700);const b=await pixels(page);
      const reduced=settings.reduced||settings.appReduce;
      if(reduced){assert(a.ink>100);assert.equal(a.hash,b.hash,'Reduce Motion tree stays still');assert(b.frames-a.frames<=8)}
      else{assert(b.ink>a.ink+100,'tree progressively draws');assert(b.frames>a.frames+10);await page.waitForTimeout(1300);const c=await pixels(page);await page.waitForTimeout(200);const d=await pixels(page);assert(c.ink>a.ink+100,'tree grows its crown');;assert.notEqual(c.hash,d.hash,'finished tree keeps moving in the breeze')}
      await page.screenshot({path:`${output}/${settings.name}-tree.png`});
      assert(await page.locator('#cspSplash').count(),'delayed map stays covered');
      await page.evaluate(()=>{document.documentElement.classList.remove('csp-map-staging');CSPBoot.settlePicture()});
      if(!reduced){
        await page.waitForTimeout(250);
        const opacity=await page.locator('#cspSplash').evaluate(el=>+getComputedStyle(el).opacity);
        assert(opacity>.5&&opacity<1,'tree and plate share a measured, gradual dissolve');
        assert(await page.locator('#app').evaluate(el=>el.inert),'hidden controls stay inert through the fade');
        const before=await page.evaluate(()=>treeFrames);await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>treeFrames),before,'the frozen tree leaves the reveal GPU to the map');
        await page.screenshot({path:`${output}/${settings.name}-fade.png`});
      }
      await page.waitForSelector('#cspSplash',{state:'detached'});
      assert.equal(await page.locator('#app').evaluate(el=>el.inert),false,'controls unlock after cover removal');
      const frames=await page.evaluate(()=>treeFrames);
      await page.evaluate(()=>{dispatchEvent(new Event('resize'));document.dispatchEvent(new Event('visibilitychange'))});
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>treeFrames),frames,'disposed tree cannot start rendering again');
      assert.deepEqual(errors,[]);
      console.log(settings.name,JSON.stringify({first:a,later:b,frames,fade:reduced?'instant':'intermediate opacity verified'}));
      await context.close();
    }
    // The worker returns exactly the same seasonal strokes and bone data
    // as the page's builder; it changes scheduling, not the drawing.
    const parity=await browser.newPage();await parity.goto(url+'/harness.html');
    const seasons=await parity.evaluate(async()=>{
      const {buildMaple}=await import('./maple.js');const result=[];
      for(const day of ['2026-01-15','2026-07-01','2026-11-05']){
        const date=new Date(day+'T12:00:00'),expected=buildMaple(date,undefined,{treeOnly:true});
        const actual=await new Promise((resolve,reject)=>{const w=new Worker('./startup-tree-worker.js',{type:'module'});w.onmessage=e=>{w.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data)};w.onerror=reject;w.postMessage(date.getTime())});
        const same=(a,b)=>a?.length===b?.length&&(!a||a.every((v,i)=>v===b[i]));
        if(!['seg','sty','bon','col','leafData'].every(k=>same(expected[k],actual.tree[k]))||!Object.keys(expected.bones).every(k=>same(expected.bones[k],actual.tree.bones[k])))throw Error('Worker drawing differs for '+day);
        result.push({day,strokes:expected.count,bones:expected.nb,atlasBytes:actual.atlas?.data.length||0});
      }return result;
    });console.log('seasonal worker parity',JSON.stringify(seasons));await parity.close();
    const slow=await browser.newPage();await slow.goto(url+'/harness.html');
    await slow.evaluate(()=>document.documentElement.dispatchEvent(new Event('csp:ready')));
    await slow.waitForTimeout(8500);
    assert(await slow.locator('#cspSplash').count(),'a slow map stays covered past the old 8 second cap');
    assert.equal(await slow.evaluate(()=>CSPBoot.splash.done),false);
    await slow.waitForSelector('#cspStartup.failed',{timeout:8000});
    assert.equal(await slow.evaluate(()=>document.documentElement.classList.contains('csp-map-staging')),true,'recovery keeps the unfinished picture staged');
    console.log('slow-map recovery passed');await slow.close();
    // A blocked main thread used to race the removal timer. The cover must
    // still paint intermediate opacity after it gets its first animation frame.
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(url+'/harness.html');
    await page.evaluate(()=>document.documentElement.dispatchEvent(new Event('csp:ready')));
    await page.waitForSelector('#cspSplashTree.on');
    await page.evaluate(()=>{CSPBoot.splash.finish();const until=performance.now()+500;while(performance.now()<until){}});
    assert.equal(await page.locator('#cspSplash').count(),1,'cover survives the blocked first fade frame');
    await page.waitForTimeout(150);
    const busyOpacity=await page.locator('#cspSplash').evaluate(el=>+getComputedStyle(el).opacity);
    assert(busyOpacity>0&&busyOpacity<1);
    await page.waitForSelector('#cspSplash',{state:'detached'});
    console.log('busy frame fade passed',busyOpacity);
    await page.close();
    // Actual assembled application, using its real map readiness coordinator.
    const live=await browser.newPage({viewport:{width:390,height:844}});const liveErrors=[];
    live.on('pageerror',e=>liveErrors.push(e.message));
    await live.goto(url+'/map.html',{waitUntil:'domcontentloaded'});
    await live.waitForSelector('#cspSplashTree.on',{timeout:15000});
    await live.waitForSelector('#cspSplash',{state:'detached',timeout:20000});
    const state=await live.evaluate(()=>({classes:document.documentElement.className,ready:CSPBoot.done,failed:CSPBoot.failed}));
    assert(state.ready&&!state.failed);assert(!/csp-map-staging|csp-splash|csp-terrain-pending/.test(state.classes));assert.deepEqual(liveErrors,[]);
    console.log('full app passed',state);
    await live.close();
  }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
