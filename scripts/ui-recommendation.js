'use strict';
/* Actual recommendation renderer in the real DOM, with selection/publication
   fixtures. The scientific scene-selection code is unchanged. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {launchUIBrowser}=require('./lib/browser.js');
const source=fs.readFileSync('app/results.js','utf8');
const render=source.slice(source.indexOf('function summarise(pool)'),source.indexOf('/* A "photo"'));
(async()=>{
 const browser=await launchUIBrowser();
 try{
  const context=await browser.newContext({viewport:{width:430,height:932},isMobile:true,serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false})));
  const page=await context.newPage();
  await page.goto(process.argv[2]||'http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('cspGrabber')&&!document.getElementById('app').inert);
  await page.locator('#q').click();await page.waitForTimeout(450);
  await page.locator('[data-route="satellite"]').click();await page.waitForTimeout(450);
  await page.evaluate(()=>{document.body.dataset.cspDetent='large'});await page.waitForTimeout(450);
  await page.evaluate(render=>{
   const item={id:'a',src:'Sentinel 2',label:'Test scene',date:'2026-11-05',gsd:10,cloud:2,tiles:'test'};
   window.recommendationSelections=[];
   const escape=value=>{const span=document.createElement('span');span.textContent=value;return span.innerHTML};
   const draw=new Function('pool','bestPhoto','ago','res','esc','displayedScene','SEL','ITEMS','showPane','setCount','$','select',render+';summarise(pool)');
   window.drawRecommendation=state=>{
    const control=document.getElementById('ctlName');control.dataset.state=state==='loading'?'loading':'';
    draw([item],()=>item,()=> '1 day ago',()=> '10 m',escape,()=>state==='shown'?item:null,state==='loading'?0:null,[item],()=>{},()=>{},s=>document.querySelector(s),i=>window.recommendationSelections.push(i));
   };
   window.drawRecommendation('ready');
  },render);
  const card=page.locator('.csp-best-recommendation');
  assert.equal(await card.locator('strong').textContent(),'Test scene · 2026-11-05');
  await card.locator('strong').click();assert.deepEqual(await page.evaluate(()=>window.recommendationSelections),[],'the title is descriptive text');
  const show=page.getByRole('button',{name:'Show',exact:true});await show.click();
  assert.deepEqual(await page.evaluate(()=>window.recommendationSelections),[0],'Show selects the recommended scene');
  await show.focus();await page.evaluate(()=>window.drawRecommendation('ready'));
  assert.equal(await page.evaluate(()=>document.activeElement?.className),'csp-best-show','refresh retains Show focus');
  await page.evaluate(()=>window.drawRecommendation('loading'));
  assert(await page.getByRole('button',{name:'Loading…',exact:true}).isDisabled(),'pending imagery is not labeled shown');
  assert(!await page.locator('.csp-best-shown').isVisible());
  await page.evaluate(()=>window.drawRecommendation('shown'));
  assert(await page.locator('.csp-best-shown').isVisible(),'only published imagery is labeled shown');
  assert(!await page.locator('.csp-best-show').isVisible());
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.drawRecommendation('ready'));
  assert.equal(await page.locator('.csp-best-main').evaluate(el=>el.tagName),'BUTTON','desktop retains its whole-card action');
  console.log('PASS recommendation: separate Show action, focus preservation and honest loading/publication states');
  await context.close();
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
