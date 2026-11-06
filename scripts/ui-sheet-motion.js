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
  await page.locator('#q').click();await page.waitForTimeout(500);
  await page.locator('[data-route="terrain"]').click();await page.waitForTimeout(500);
  const sample=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{
   const sheet=document.getElementById('side'),s=getComputedStyle(sheet),r=sheet.getBoundingClientRect();
   const clip=s.clipPath.startsWith('inset(')?parseFloat(s.clipPath.slice(6))||0:0;
   const head=document.getElementById('cspWorkspaceHeader').getBoundingClientRect();
   resolve({height:r.height,visible:r.height-clip,top:r.top+clip,bottom:r.bottom,head:head.top,holding:sheet.classList.contains('csp-sheet-clip')});
  })));
  const action=label=>page.evaluate(label=>[...document.querySelectorAll('.csp-sheet-actions button')].find(b=>b.textContent===label).click(),label);
  await action('Expand');await page.waitForTimeout(70);const first=await sample();
  await page.waitForTimeout(100);const next=await sample();
  assert(first.holding&&next.holding,'animation holds the layout box');
  assert(Math.abs(first.height-next.height)<1,'the blurred sheet does not resize on animation frames');
  assert(next.visible>first.visible+5,'the visible sheet rises');
  assert(Math.abs(first.head-first.top)<2&&Math.abs(next.head-next.top)<2,`the navigation bar follows the rounded visible top: ${JSON.stringify({first,next})}`);
  const output=process.env.CSP_UI_OUTPUT||'.codex-audits/native-parity';fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,`sheet-motion-${process.env.CSP_UI_BROWSER||'chrome'}.png`)});
  // Reversing while moving must start from the painted position.
  const reverse=await page.evaluate(()=>{
   const sheet=document.getElementById('side');
   const visible=()=>{const clip=getComputedStyle(sheet).clipPath;return sheet.offsetHeight-(clip.startsWith('inset(')?parseFloat(clip.slice(6))||0:0)};
   const before=visible();[...document.querySelectorAll('.csp-sheet-actions button')].find(b=>b.textContent==='Collapse').click();
   return {before,after:visible()};
  });
  assert(Math.abs(reverse.before-reverse.after)<2,'reversal starts at the visible height');
  await page.waitForTimeout(500);const medium=await sample();
  assert(!medium.holding&&Math.abs(medium.height-466)<2,'medium releases its animation layer');
  await action('Expand');await page.waitForTimeout(70);
  await page.setViewportSize({width:844,height:430});await page.waitForTimeout(100);
  assert(!await page.locator('#side').evaluate(el=>el.classList.contains('csp-sheet-clip')||el.style.clipPath||el.style.height),'rotation clears transient geometry');
  await page.setViewportSize({width:430,height:932});await page.waitForTimeout(200);
  await action('Collapse');await page.waitForTimeout(500);
  await action('Expand');await page.waitForTimeout(70);
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
  assert(!await page.locator('#side').evaluate(el=>el.classList.contains('csp-sheet-clip')),'changing Reduce Motion finishes the current animation');
  assert.deepEqual(errors,[]);
  console.log('PASS sheet motion: stable blur box, aligned header, interrupted spring, rotation and Reduce Motion');
  await context.close();
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
