'use strict';
/* Scene-search integration checks. Uses the optional Playwright runtime from
   ui-map-popovers.js; the app's dependencies stay unchanged.
   node scripts/ui-satellite-search.js [http://127.0.0.1:8765/] */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.argv[2]||'http://127.0.0.1:8765/';
const output=path.join(__dirname,'..','.codex-audits');
const place={primary:'Moses Lake',secondary:'Grant, Washington, United States',kind:'town',lat:47.13,lng:-119.28};
(async()=>{
  const browser=await chromium.launch();fs.mkdirSync(output,{recursive:true});
  try{
    for(const [label,width,height,touch] of [['desktop',1440,900,false],['dark',1440,900,false],['mobile',390,844,true],['small-mobile',320,568,true],['classic',1440,900,false]]){
      const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,serviceWorkers:'block'});
      await context.addInitScript(dark=>{
        localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
        localStorage.setItem('clearskies.mapTheme.v1',dark?'dark':'light');
      },label==='dark');
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/markup**',route=>route.fulfill({json:{layers:[],deleted:{}}}));
      const url=new URL(base);if(label==='classic')url.searchParams.set('ui','classic');
      await page.goto(url.href,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.ClearSkiesPortalBridge&&document.querySelector('.csp-nav-button'));
      const navigate=route=>page.evaluate(key=>{
        document.querySelector(`.csp-nav-button[data-route="${key}"]`).click();
        document.body.classList.remove('collapsed');document.body.dataset.cspDetent='large';
      },route);
      await navigate('satellite');
      if(label==='classic'){
        assert.equal(await page.locator('#cspSatQuery').count(),0,'classic keeps its original search/filter layout');
        assert(await page.locator('.pane[data-pane="filters"]').isVisible());
        assert.equal(await page.locator('#days').evaluate(el=>el.previousElementSibling.tagName),'LABEL');
        await context.close();console.log('PASS classic: original filters preserved');continue;
      }
      const input=page.locator('#cspSatQuery');
      // All search controls are the original inputs, moved rather than copied.
      assert.equal(await page.locator('#days').count(),1);
      await page.locator('[data-quick="clear"]').click();assert.equal(await page.locator('#cloud').inputValue(),'10');
      await page.locator('#cloud').selectOption('60');
      assert.equal(await page.locator('[data-quick="clear"]').getAttribute('aria-pressed'),'false');
      await page.locator('#days').selectOption('custom');
      for(const id of ['dFrom','dTo']){
        assert(await page.locator('#'+id).isVisible());
        assert((await page.locator('#'+id).boundingBox()).width>=100,'custom dates have room for the date and picker');
      }
      await page.locator('#dFrom').fill('2026-01-01');await page.locator('#dTo').fill('2026-02-01');
      await page.screenshot({path:path.join(output,`satellite-${label}.png`)});
      await page.evaluate(()=>{window.sceneDays=document.getElementById('days')});
      await navigate('conditions');
      assert(await page.locator('#days').evaluate(el=>el===window.sceneDays&&el.closest('[data-pane="filters"]')));
      await navigate('satellite');
      assert.equal(await page.locator('#dFrom').inputValue(),'2026-01-01');
      assert(await page.locator('#days').evaluate(el=>el===window.sceneDays&&!!el.closest('.csp-sat-filters')));
      // Only the suggestion service and search actions are fixtures. Real DOM,
      // routing, keys, focus, controls and request lifecycle remain under test.
      await page.evaluate(sample=>{
        const bridge=window.ClearSkiesPortalBridge;window.sceneCalls=[];
        bridge.placeSuggestions=async()=>[sample];
        bridge.searchPlace=value=>window.sceneCalls.push({place:value.primary});
        bridge.searchText=value=>window.sceneCalls.push({text:value});
      },place);
      await input.fill('Moses');await page.locator('#cspSatSuggest [role="option"]').waitFor();
      await input.press('ArrowDown');await input.press('Enter');
      assert.deepEqual(await page.evaluate(()=>window.sceneCalls.pop()),{place:'Moses Lake'});
      await input.fill('Moses');await page.locator('#cspSatSuggest [role="option"]').waitFor();
      await input.fill('47.13, -119.28');await input.press('Enter');
      assert.deepEqual(await page.evaluate(()=>window.sceneCalls.pop()),{text:'47.13, -119.28'},'typing clears stale choices before Enter');
      await page.evaluate(()=>{
        window.ClearSkiesPortalBridge.placeSuggestions=(text,signal)=>new Promise(resolve=>{window.scenePending={resolve,signal}});
      });
      await input.fill('Pending');await page.waitForFunction(()=>window.scenePending);
      await input.press('Escape');
      assert(await page.evaluate(()=>window.scenePending.signal.aborted),'Escape cancels an in-flight lookup');
      await page.evaluate(sample=>window.scenePending.resolve([sample]),place);
      await page.waitForTimeout(50);
      assert.equal(await input.getAttribute('aria-expanded'),'false','a late result cannot reopen dismissed suggestions');
      await page.evaluate(()=>{window.scenePending=null});
      await input.fill('Pending again');await page.waitForFunction(()=>window.scenePending);await navigate('settings');
      assert(await page.evaluate(()=>window.scenePending.signal.aborted),'leaving Satellite cancels its lookup');
      assert.equal(await page.locator('#cspNav #cspMapSources').count(),0);
      assert.equal(await page.locator('#cspSettingsNav .csp-nav-dot').count(),0);
      assert(await page.locator('#cspWorkspace #cspMapSources a').count()>0,'Settings retains source credits');
      await navigate('satellite');
      if(touch){
        await input.evaluate(el=>el.blur());
        await page.evaluate(()=>{document.body.dataset.cspDetent='medium'});
        await input.focus();
        assert.equal(await page.locator('body').getAttribute('data-csp-detent'),'large','scene search rises above a phone keyboard');
      }
      const overflow=await page.locator('.csp-sat-card').evaluate(el=>el.scrollWidth>el.clientWidth+1);
      assert.equal(overflow,false,'search controls stay within their card');
      assert.deepEqual(errors,[],`${label} has no page errors`);
      console.log(`PASS ${label}: filters, custom dates, navigation, keyboard selection, stale results, cancellation, credits and layout`);
      await context.close();
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
