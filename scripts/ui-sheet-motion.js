'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {launchUIBrowser}=require('./lib/browser.js');
const base=process.argv[2]||'http://127.0.0.1:8765/';
(async()=>{
 const browser=await launchUIBrowser();
 try{
  const context=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false})));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/markup**',r=>r.fulfill({json:{layers:[],deleted:{}}}));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('cspGrabber')&&!document.getElementById('app').inert);
  await page.evaluate(()=>{
   document.documentElement.classList.add('csp-standalone','csp-round-screen');
   document.documentElement.style.setProperty('--safe-top','59px');
   document.documentElement.style.setProperty('--safe-bottom','34px');
   document.documentElement.style.setProperty('--screen-radius','55px');
  });
  await page.waitForTimeout(450);
  const action=label=>page.evaluate(label=>[...document.querySelectorAll('.csp-sheet-actions button')].find(b=>b.textContent===label).click(),label);
  const transition=label=>page.evaluate(label=>new Promise(resolve=>{
   const sheet=document.getElementById('side');
   const rect=()=>{const r=sheet.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
   const before=rect();
   [...document.querySelectorAll('.csp-sheet-actions button')].find(b=>b.textContent===label).click();
   const immediate=rect(),frames=[],start=performance.now();
   const frame=now=>{frames.push({...rect(),at:now-start});if(now-start<420)requestAnimationFrame(frame);else resolve({before,immediate,frames})};
   requestAnimationFrame(frame);
  }),label);
  const continuous=(result,name)=>{
   for(const edge of ['top','bottom'])assert(Math.abs(result.before[edge]-result.immediate[edge])<2,`${name}: ${edge} is continuous on the opening frame`);
   assert(result.frames.length>5,`${name}: sampled the spring`);
  };
  const opening=await transition('Collapse');continuous(opening,'capsule to medium');
  assert(Math.abs(opening.frames.at(-1).height-500)<2);
  assert(opening.frames.some(r=>r.bottom>opening.before.bottom+3&&r.bottom<928-3),'bottom inset animates instead of jumping');
  await page.locator('[data-route="terrain"]').click();await page.waitForTimeout(450);
  await action('Expand');await page.waitForTimeout(90);
  const reversal=await transition('Collapse');continuous(reversal,'spring reversal');
  assert(Math.abs(reversal.frames.at(-1).height-500)<2);
  const closing=await transition('Close');continuous(closing,'medium to capsule');
  assert(Math.abs(closing.frames.at(-1).height-52)<2);
  // Pause transitions for a deterministic evidence image in both engines.
  await action('Collapse');await page.waitForTimeout(450);await action('Expand');
  await page.evaluate(()=>{for(const id of ['side','mapDock'])for(const animation of document.getElementById(id).getAnimations()){animation.pause();animation.currentTime=170}});
  const alignment=await page.evaluate(()=>{
   const sheet=document.getElementById('side').getBoundingClientRect(),head=document.getElementById('cspWorkspaceHeader').getBoundingClientRect();
   return Math.abs(sheet.top-head.top);
  });
  assert(alignment<2,'navigation bar follows the rounded visible top');
  const output=process.env.CSP_UI_OUTPUT||'.codex-audits/native-parity';fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,`sheet-motion-${process.env.CSP_UI_BROWSER||'chrome'}.png`)});
  await page.evaluate(()=>{for(const id of ['side','mapDock'])for(const animation of document.getElementById(id).getAnimations())animation.finish()});
  await action('Collapse');await page.waitForTimeout(450);await action('Expand');await page.waitForTimeout(60);
  await page.setViewportSize({width:844,height:430});await page.waitForTimeout(450);
  assert(!await page.locator('#side').evaluate(el=>el.style.clipPath||el.style.height),'rotation leaves no transient geometry');
  await page.setViewportSize({width:430,height:932});await page.waitForTimeout(450);
  await action('Collapse');await page.waitForTimeout(450);await action('Expand');await page.waitForTimeout(60);
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
  assert.equal(await page.locator('#side').evaluate(el=>el.getAnimations().length),0,'Reduce Motion finishes the active spring');
  assert.deepEqual(errors,[]);
  console.log('PASS sheet motion: continuous capsule edges, spring reversal, aligned header, rotation and Reduce Motion');
  await context.close();
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
