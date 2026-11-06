'use strict';
/* Phone map controls: shared safe-area alignment and clearance from the sheet.
   node scripts/run-ui.js map-control-spacing */
const assert=require('node:assert/strict');
const {launchUIBrowser}=require('./lib/browser.js');
const base=process.argv[2]||'http://127.0.0.1:8765/';
(async()=>{
  const browser=await launchUIBrowser();
  try{
    for(const [width,height,installed] of [[320,568,false],[390,844,false],[320,568,true],[390,844,true],[430,932,true]]){
      const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,serviceWorkers:'block'});
      await context.addInitScript(()=>{
        localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
      });
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/markup**',route=>route.fulfill({json:{layers:[],deleted:{}}}));
      await page.goto(base,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.getElementById('cspGrabber')&&document.body.classList.contains('collapsed')&&!document.getElementById('app').inert);
      if(installed)await page.evaluate(()=>{
        document.documentElement.classList.add('csp-standalone','csp-round-screen');
        document.documentElement.style.setProperty('--safe-top','59px');
        document.documentElement.style.setProperty('--safe-bottom','34px');
        document.documentElement.style.setProperty('--screen-radius','47px');
      });
      await page.waitForTimeout(500);
      const geometry=()=>page.evaluate(()=>{
        const dock=document.getElementById('mapDock'),info=document.getElementById('mapReadout'),sheet=document.getElementById('side');
        const d=dock.getBoundingClientRect(),i=info.getBoundingClientRect(),s=sheet.getBoundingClientRect();
        return {dockTop:d.top,infoTop:i.top,gap:s.top-d.bottom,scrolls:dock.scrollHeight>dock.clientHeight+1,dockHeight:d.height,sheetHeight:s.height,buttons:[...dock.querySelectorAll('button:not([hidden])')].map(button=>{const r=button.getBoundingClientRect();return {id:button.id,height:r.height,inside:r.top>=d.top&&r.bottom<=d.bottom+1}})};
      });
      let g=await geometry();
      assert(Math.abs(g.dockTop-g.infoTop)<1,`info aligns with toolbar at ${width}x${height}, installed=${installed}: ${JSON.stringify(g)}`);
      await page.locator('#mapReadout .map-info-toggle').click();await page.waitForTimeout(400);
      assert(Math.abs((await geometry()).infoTop-g.dockTop)<1,'expanded info keeps the shared top edge');
      await page.locator('#mapReadout .map-info-toggle').click();await page.waitForTimeout(300);
      await page.locator('#q').click();await page.waitForTimeout(550);
      g=await geometry();assert(g.gap>=11,`medium sheet clears the entire dock: ${JSON.stringify(g)}`);
      // Extra live controls (e.g. a rotated map's compass) must fit as well.
      await page.evaluate(()=>{document.getElementById('bearingReset').hidden=false});await page.waitForTimeout(700);
      g=await geometry();assert(g.gap>=11,'additional tools keep the sheet gap');
      assert(!g.scrolls,'toolbar never scrolls or clips');
      assert(g.buttons.every(button=>button.height===48&&button.inside),`every tool keeps its full 48px target: ${JSON.stringify(g)}`);
      const fs=require('node:fs'),path=require('node:path');
      const output=process.env.CSP_UI_OUTPUT||'.codex-audits/native-parity';fs.mkdirSync(output,{recursive:true});
      if(width===430&&installed)await page.screenshot({path:path.join(output,'phone-medium.png')});
      const mediumDockHeight=g.dockHeight;
      await page.evaluate(()=>document.getElementById('cspGrabber').click());await page.waitForTimeout(400);
      assert.equal(await page.locator('#mapDock').evaluate(el=>getComputedStyle(el).opacity),'0','expanded menu hides the toolbar');
      assert(await page.locator('#mapDock').evaluate(el=>el.inert&&el.getAttribute('aria-hidden')==='true'),'hidden tools leave touch, keyboard and accessibility navigation');
      if(width===430&&installed)await page.screenshot({path:path.join(output,'phone-large.png')});
      await page.evaluate(()=>document.getElementById('cspGrabber').click());await page.waitForTimeout(700);
      g=await geometry();assert.equal(g.dockHeight,mediumDockHeight,'menu changes never reduce toolbar height');
      assert.equal(await page.locator('#mapDock').evaluate(el=>getComputedStyle(el).opacity),'1','medium menu restores the entire toolbar');
      const button=await page.locator('#serverToggle').boundingBox();
      assert(button.y+button.height<height-g.sheetHeight-4,'last toolbar button remains above the menu');
      await page.locator('#serverToggle').click();
      assert(await page.locator('#serverPanel').isVisible(),'last tool remains usable without scrolling');
      assert.deepEqual(errors,[],'no browser errors');
      console.log(`PASS ${width}x${height}, installed=${installed}: alignment, info expansion, sheet clearance and full toolbar access`);
      await context.close();
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
