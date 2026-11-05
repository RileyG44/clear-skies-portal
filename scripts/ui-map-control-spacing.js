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
        return {dockTop:d.top,infoTop:i.top,gap:s.top-d.bottom,scrolls:dock.scrollHeight>dock.clientHeight+1};
      });
      let g=await geometry();
      assert(Math.abs(g.dockTop-g.infoTop)<1,`info aligns with toolbar at ${width}x${height}, installed=${installed}: ${JSON.stringify(g)}`);
      await page.locator('#mapReadout .map-info-toggle').click();await page.waitForTimeout(400);
      assert(Math.abs((await geometry()).infoTop-g.dockTop)<1,'expanded info keeps the shared top edge');
      await page.locator('#q').click();await page.waitForTimeout(550);
      g=await geometry();assert(g.gap>=11,`medium sheet clears the entire dock: ${JSON.stringify(g)}`);
      // Extra live controls (e.g. a rotated map's compass) must fit as well.
      await page.evaluate(()=>{document.getElementById('bearingReset').hidden=false});
      g=await geometry();assert(g.gap>=11,'additional tools keep the sheet gap');
      if(g.scrolls){
        const dock=page.locator('#mapDock'),box=await dock.boundingBox(),session=await context.newCDPSession(page);
        await dock.evaluate(el=>{el.scrollTop=0});
        const order=await dock.locator('button').evaluateAll(buttons=>buttons.map(button=>button.id));
        const x=box.x+box.width/2,y=box.y+box.height-25;
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        for(let step=1;step<=5;step++){
          await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*12,id:1}]});
          await page.waitForTimeout(30);
        }
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForTimeout(150);
        assert(await dock.evaluate(el=>el.scrollTop>0),'touch scrolls the constrained dock');
        assert.deepEqual(await dock.locator('button').evaluateAll(buttons=>buttons.map(button=>button.id)),order,'scrolling does not reorder tools');
        await page.locator('#serverToggle').scrollIntoViewIfNeeded();
        const button=await page.locator('#serverToggle').boundingBox(),current=await dock.boundingBox();
        assert(button.y>=current.y&&button.y+button.height<=current.y+current.height+1,'last tool is fully reachable');
        await page.locator('#serverToggle').click();
        assert(await page.locator('#serverPanel').isVisible(),'last tool still opens its panel');
        await session.detach();
      }
      assert.deepEqual(errors,[],'no browser errors');
      console.log(`PASS ${width}x${height}, installed=${installed}: alignment, info expansion, sheet clearance and tool access`);
      await context.close();
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
