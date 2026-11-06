'use strict';
/* Native phone chrome regressions and bounded animation measurements.
   node scripts/run-ui.js native-parity
   CSP_UI_BROWSER=webkit node scripts/run-ui.js native-parity */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {launchUIBrowser}=require('./lib/browser.js');
const base=process.argv[2]||'http://127.0.0.1:8765/';
(async()=>{
 const browser=await launchUIBrowser(),output=process.env.CSP_UI_OUTPUT||'.codex-audits/native-parity';fs.mkdirSync(output,{recursive:true});
 const measurements=[];
 try{
  for(const dark of [false,true]){
   const context=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,serviceWorkers:'block'});
   await context.addInitScript(dark=>{
    localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
    localStorage.setItem('clearskies.mapTheme.v1',dark?'dark':'light');
   },dark);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/markup**',route=>route.fulfill({json:{layers:[],deleted:{}}}));
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.getElementById('cspGrabber')&&!document.getElementById('app').inert);
   await page.evaluate(()=>{
    const root=document.documentElement;root.classList.add('csp-standalone','csp-round-screen');
    root.style.setProperty('--safe-top','59px');root.style.setProperty('--safe-bottom','34px');root.style.setProperty('--screen-radius','55px');
   });
   await page.locator('#q').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('#side').evaluate(el=>getComputedStyle(el).transitionDuration.split(',')[0]),'0.35s','the open-sheet selector honors native timing');
   const corners=await page.locator('#side').evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopLeftRadius,s.borderBottomLeftRadius]});
   assert.deepEqual(corners,['32px','51px'],'fixed top and concentric bottom corners');
   assert(await page.locator('#mapReadout').isVisible(),'map info stays on the map at medium');
   await page.locator('#mapReadout .map-info-toggle').click();await page.waitForTimeout(300);
   assert(!await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'map info interaction preserves the open menu');
   await page.locator('#mapReadout .map-info-toggle').click();await page.waitForTimeout(300);
   await page.locator('[data-route="terrain"]').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('#cspWorkspaceTitle').textContent(),'Terrain & LiDAR');
   assert.equal(await page.locator('#cspWorkspaceDescription').textContent(),'Style terrain, adjust lighting and download data');
   const header=await page.locator('#cspWorkspaceHeader').evaluate(el=>({height:el.getBoundingClientRect().height,title:getComputedStyle(document.getElementById('cspWorkspaceTitle')).fontSize}));
   assert(header.height<=64&&header.title==='15px','native inline navigation header');
   assert.notEqual(await page.locator('#side').evaluate(el=>getComputedStyle(el).backdropFilter),'none','Terrain retains glass');
   await page.screenshot({path:path.join(output,`terrain-${dark?'dark':'light'}.png`)});
   // Capture real touch events for interactive edge-pop when the browser supports CDP.
   if((process.env.CSP_UI_BROWSER||'chrome')!=='webkit'){
    const cdp=await context.newCDPSession(page),side=await page.locator('#side').boundingBox();
    const x=side.x+5,y=side.y+110;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let n=1;n<=6;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+n*15,y,id:1}]});await page.waitForTimeout(16)}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>document.body.dataset.cspView==='nav');await cdp.detach();
   }else await page.locator('#cspBack').click();
   await page.locator('#cspSearchClose').click();await page.waitForTimeout(400);
   assert(await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'home close returns to the search capsule');
   await page.locator('#q').click();await page.waitForTimeout(400);
   await page.locator('[data-route="elevation"]').click();await page.waitForTimeout(400);
   await page.locator('#cspPageClose').click();await page.waitForTimeout(400);
   assert(await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'page close returns to capsule');
   await page.locator('#q').click();await page.waitForTimeout(400);
   await page.locator('#cspBack').click();await page.waitForTimeout(400);
   await page.locator('#q').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('#cspSearchClose').getAttribute('aria-label'),'Dismiss keyboard');
   await page.locator('#cspSearchClose').click();await page.waitForTimeout(150);
   assert(!await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'keyboard dismiss preserves the menu');
   await page.locator('#cspSearchClose').click();await page.waitForTimeout(400);
   await page.locator('#q').click();await page.waitForTimeout(400);
   const result=await page.evaluate(async()=>{
    const samples=[],frames=[],longTasks=[],start=performance.now();let last=start;
    const observer=typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))):null;
    observer?.observe({type:'longtask'});
    const measure=()=>new Promise(resolve=>{
     const begin=performance.now();document.getElementById('cspGrabber').click();
     const frame=now=>{
      frames.push(now-last);last=now;
      const sheet=document.getElementById('side'),dock=document.getElementById('mapDock');
      samples.push({at:now-begin,height:sheet.getBoundingClientRect().height,opacity:+getComputedStyle(dock).opacity});
      if(now-begin<450)requestAnimationFrame(frame);else resolve();
     };requestAnimationFrame(frame);
    });
    for(let i=0;i<4;i++)await measure();observer?.disconnect();
    const sorted=frames.slice(2).sort((a,b)=>a-b);
    return {longTasksSupported:!!observer,samples,frames:frames.length,p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted),longTasks,duration:performance.now()-start};
   });
   measurements.push({browser:process.env.CSP_UI_BROWSER||'chrome',dark,...result});
   assert(result.frames>20,'animation produces a usable frame sample');
   assert.deepEqual(errors,[],'no browser or resize-observer errors');
   console.log(`PASS native chrome ${dark?'dark':'light'}: headers, glass, corners, dismissal, map info; ${result.frames} frames, p95 ${result.p95.toFixed(1)}ms (host browser)`);
   await context.close();
  }
 }finally{await browser.close()}
 fs.writeFileSync(path.join(output,`motion-${process.env.CSP_UI_BROWSER||'chrome'}.json`),JSON.stringify(measurements,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
