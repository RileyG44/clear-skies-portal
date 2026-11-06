'use strict';
/* Bounded host-browser profile. Optional CSP_SHEET_BASELINE=<git ref> intercepts
   only the sheet implementation to compare identical app/data/browser state.
   This measures main-thread rendering cost, never iPhone GPU performance. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {launchUIBrowser}=require('./lib/browser.js');
const base=process.argv[2]||'http://127.0.0.1:8765/';
(async()=>{
 const browser=await launchUIBrowser(),output=process.env.CSP_UI_OUTPUT||'.codex-audits/sheet-performance';
 fs.mkdirSync(output,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript(()=>{
   localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
   localStorage.setItem('clearskies.mapTheme.v1','light');
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/markup**',route=>route.fulfill({json:{layers:[],deleted:{}}}));
  if(process.env.CSP_SHEET_BASELINE){
   for(const file of ['ui-system.js','ui-system.css']){
    const body=execFileSync('git',['show',`${process.env.CSP_SHEET_BASELINE}:${file}`],{encoding:'utf8'});
    await page.route(`**/${file}?*`,route=>route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':'text/css'}));
   }
  }
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('cspGrabber')&&!document.getElementById('app').inert);
  await page.evaluate(()=>{
   document.documentElement.classList.add('csp-standalone','csp-round-screen');
   document.documentElement.style.setProperty('--safe-top','59px');
   document.documentElement.style.setProperty('--safe-bottom','34px');
   document.documentElement.style.setProperty('--screen-radius','55px');
   document.getElementById('q').click();
  });
  await page.waitForTimeout(600);
  await page.locator('[data-route="terrain"]').click();await page.waitForTimeout(600);
  // Include open detail controls, which cost more than the unopened home list.
  await page.evaluate(()=>{for(const el of document.querySelectorAll('.terrain-phone-disclosure,#cspTerrainDownloads'))el.open=true});
  await page.waitForTimeout(500);
  const cdp=(process.env.CSP_UI_BROWSER||'chrome')==='webkit'?null:await context.newCDPSession(page);
  const metrics=async()=>cdp?Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value])):{};
  const trace=[];
  if(cdp){
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await cdp.send('Performance.enable');
   cdp.on('Tracing.dataCollected',event=>trace.push(...event.value));
   await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});
  }
  const before=await metrics();
  const frames=await page.evaluate(async()=>{
   const results=[];
   for(let i=0;i<6;i++){
    const action=i%2?'Collapse':'Expand',samples=[];
    const start=performance.now();let last=start;
    performance.mark(`sheet-${i}-start`);
    [...document.querySelectorAll('.csp-sheet-actions button')].find(button=>button.textContent===action).click();
    await new Promise(resolve=>{
     const frame=now=>{samples.push(now-last);last=now;if(now-start<450)requestAnimationFrame(frame);else resolve()};
     requestAnimationFrame(frame);
    });
    performance.mark(`sheet-${i}-end`);
    const sheet=document.getElementById('side'),s=getComputedStyle(sheet),r=sheet.getBoundingClientRect();
    const clip=s.clipPath.startsWith('inset(')?parseFloat(s.clipPath.slice(6)):0;
    results.push({action,gaps:samples,visibleHeight:r.height-(clip||0),boxHeight:r.height,clip:s.clipPath,holding:sheet.classList.contains('csp-sheet-clip')});
   }
   return results;
  });
  const after=await metrics();
  if(cdp){const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await complete}
  const totals={};
  for(const event of trace){
   if(event.ph==='X'&&['Layout','UpdateLayoutTree','Paint','PrePaint'].includes(event.name)){
    const row=totals[event.name]??={count:0,ms:0};row.count++;row.ms+=event.dur/1000;
   }
  }
  const delta={};for(const key of ['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','TaskDuration'])delta[key]=(after[key]||0)-(before[key]||0);
  const gaps=frames.flatMap(f=>f.gaps.slice(1)).sort((a,b)=>a-b);
  const result={variant:process.env.CSP_SHEET_BASELINE||'current',browser:process.env.CSP_UI_BROWSER||'chrome',cpuThrottle:cdp?4:null,scope:'host browser main thread; not a device GPU trace',delta,totals,p95:gaps[Math.floor(gaps.length*.95)],max:Math.max(...gaps),frames,errors};
  const label=process.env.CSP_SHEET_BASELINE?'baseline':'current';
  fs.writeFileSync(path.join(output,`${label}-${result.browser}.json`),JSON.stringify(result,null,2));
  if(cdp)fs.writeFileSync(path.join(output,`${label}-trace.json`),JSON.stringify({traceEvents:trace}));
  assert.deepEqual(errors,[]);
  for(const frame of frames){assert(!frame.holding,'sheet releases its frozen box');assert(Math.abs(frame.visibleHeight-(frame.action==='Expand'?786:500))<2,`correct resting detent ${JSON.stringify(frame)}`)}
  console.log(JSON.stringify({variant:result.variant,browser:result.browser,cpuThrottle:result.cpuThrottle,delta,totals,p95:result.p95,max:result.max}));
  await context.close();
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
