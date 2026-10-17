'use strict';
/* Phone sheet/footer and toolbar motion regressions. Uses the same optional
   Playwright runtime as ui-map-popovers.js.
   node scripts/ui-sheet-chrome.js [http://127.0.0.1:8765/] */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.argv[2]||'http://127.0.0.1:8765/';
(async()=>{
  const browser=await chromium.launch();
  try{
    for(const label of ['light','dark','system-reduced','app-reduced']){
      const reduced=label.endsWith('reduced');
      const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:label==='system-reduced'?'reduce':'no-preference'});
      await context.addInitScript(mode=>{
        localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
        localStorage.setItem('clearskies.mapTheme.v1',mode==='dark'?'dark':'light');
        if(mode==='app-reduced') localStorage.setItem('clearskies.reduceMotion.v1','1');
      },label);
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/markup**',route=>route.fulfill({json:{layers:[],deleted:{}}}));
      await page.goto(base,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.getElementById('cspGrabber')&&document.body.classList.contains('collapsed'));
      await page.locator('#q').click();
      await page.waitForFunction(()=>!document.body.classList.contains('collapsed'));
      await page.waitForTimeout(500);
      if(label==='light') await page.evaluate(()=>{
        document.documentElement.classList.add('csp-round-screen');
        document.documentElement.style.setProperty('--safe-bottom','34px');
        document.documentElement.style.setProperty('--screen-radius','47px');
      });
      const state=()=>page.locator('#mapDock').evaluate(dock=>({opacity:+getComputedStyle(dock).opacity,
        transform:getComputedStyle(dock).transform,transition:getComputedStyle(dock).transitionDuration,
        inert:dock.inert,hidden:dock.getAttribute('aria-hidden'),detent:document.body.dataset.cspDetent}));
      const step=()=>page.evaluate(()=>{
        const dock=document.getElementById('mapDock');getComputedStyle(dock).opacity;
        document.getElementById('cspGrabber').click();
        return getComputedStyle(dock).opacity;
      });
      const footer=await page.locator('#cspNav').evaluate(nav=>{
        const settings=document.getElementById('cspSettingsNav'),foot=nav.querySelector('.foot');
        return {gap:nav.getBoundingClientRect().bottom-settings.getBoundingClientRect().bottom,
          sheetGap:document.getElementById('side').getBoundingClientRect().bottom-settings.getBoundingClientRect().bottom,
          meta:getComputedStyle(foot.querySelector('.foot-meta')).display,height:foot.getBoundingClientRect().height};
      });
      assert(footer.gap<=10&&footer.meta==='none'&&footer.height<130,'Settings sits at the bottom without a metadata shelf');
      assert(footer.sheetGap<45,'the home-indicator inset is reserved once');
      await step();await page.waitForTimeout(90);let mid=await state();
      if(reduced) assert.equal(mid.opacity,0,'Reduce Motion hides without a spatial transition');
      else assert(mid.opacity>0&&mid.opacity<1,`toolbar fades out rather than snapping: ${JSON.stringify(mid)}`);
      await page.waitForTimeout(350);let settled=await state();
      assert.equal(settled.opacity,0);assert(settled.inert&&settled.hidden==='true','hidden tools leave keyboard and accessibility navigation');
      await step();await page.waitForTimeout(90);mid=await state();
      if(reduced){assert.equal(mid.opacity,1);assert(['none','matrix(1, 0, 0, 1, 0, 0)'].includes(mid.transform))}
      else assert(mid.opacity>0&&mid.opacity<1,`toolbar eases back in: ${JSON.stringify(mid)}`);
      await page.waitForTimeout(350);settled=await state();
      assert.equal(settled.opacity,1);assert(!settled.inert&&settled.hidden==='false');
      if(!reduced){
        const session=await context.newCDPSession(page),grab=await page.locator('#cspGrabber').boundingBox();
        const x=grab.x+grab.width/2,y=grab.y+10;
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        await page.waitForTimeout(30);
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-60,id:1}]});
        mid=await state();
        assert(mid.opacity>0&&mid.opacity<1,'toolbar visibility follows the finger before a detent is chosen');
        assert(mid.transition.split(',').every(value=>parseFloat(value)===0),'direct dragging has no trailing transition');
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-220,id:1}]});
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(()=>document.body.dataset.cspDetent==='large');
        await page.waitForTimeout(450);assert.equal((await state()).opacity,0);
        await step();await page.waitForTimeout(450);assert.equal((await state()).opacity,1);
        await session.detach();
      }
      await page.evaluate(()=>document.querySelector('.csp-nav-button[data-route="settings"]').click());
      assert.equal(await page.locator('[data-device-build]').textContent(),await page.evaluate(()=>window.CSP_BUILD));
      await page.locator('[data-build-details]').click();
      assert(await page.locator('.csp-device-card #buildDiag').isVisible(),'build diagnostics remain available in Settings');
      await page.locator('[data-build-details]').click();assert.equal(await page.locator('#buildDiag').count(),0);
      await page.locator('[data-reset-layout]').evaluate(button=>{
        window.resetForwarded=0;document.getElementById('resetPanes').onclick=()=>window.resetForwarded++;
        button.click();
      });
      assert.equal(await page.evaluate(()=>window.resetForwarded),1,'Settings retains the existing layout reset action');
      await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(100);
      assert(await page.locator('#cspNav .foot-meta').isVisible(),'desktop keeps its compact build/reset row');
      assert(!(await state()).inert,'leaving the phone layout restores tool accessibility');
      assert.deepEqual(errors,[],`${label} has no page errors`);
      console.log(`PASS ${label}: compact footer, hide/reveal motion, drag tracking, accessibility and Settings utilities`);
      await context.close();
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
