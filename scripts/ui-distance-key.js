'use strict';
/* Map info distance key. Opens the info tile, checks the bar against the
   live map scale, and screenshots light and dark on desktop and phone.
   node scripts/ui-distance-key.js [http://127.0.0.1:8765/] */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {launchUIBrowser}=require('./lib/browser.js');
const base=process.argv[2]||'http://127.0.0.1:8765/';
const output=process.env.CSP_UI_OUTPUT||path.join(__dirname,'..','.codex-audits');
const metresOf=label=>{
  const text=String(label).trim(),unit=text.endsWith('mi')?1609.344:text.endsWith('ft')?0.3048:null;
  assert(unit,`labelled distance has units: ${text}`);
  const number=Number(text.slice(0,text.lastIndexOf(' ')).replace(/[^\d.]/g,''));
  assert(number>0,`labelled distance is a number: ${text}`);
  return number*unit;
};
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await launchUIBrowser();
  try{
    for(const [label,width,height,touch,dark] of [
      ['desktop',1320,800,false,false],
      ['desktop-dark',1320,800,false,true],
      ['mobile',390,844,true,false],
      ['mobile-dark',390,844,true,true]
    ]){
      const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,serviceWorkers:'block',deviceScaleFactor:1});
      await context.addInitScript(theme=>{localStorage.setItem('clearskies.mapTheme.v1',theme)},dark?'dark':'light');
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.ClearSkiesPortalBridge?.map?.getCenter&&document.querySelector('#mapReadout .map-info-toggle'));
      await page.evaluate(()=>{if(!document.body.classList.contains('collapsed'))document.getElementById('sideToggle')?.click()});
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('mapReadout')).visibility!=='hidden');
      await page.locator('#mapReadout .map-info-toggle').click();
      await page.waitForFunction(()=>document.getElementById('mapReadout').classList.contains('expanded')&&document.querySelector('#mapReadout .distance-label')?.textContent);
      const order=await page.evaluate(()=>[...document.querySelectorAll('#mapInfoContent .map-distance-key, #mapInfoContent .map-colour-keys')].map(el=>el.classList[0]));
      assert.deepEqual(order,['map-distance-key','map-colour-keys'],`${label} distance key is above the colour keys`);
      const above=await page.evaluate(()=>{
        const keys=[...document.querySelectorAll('#mapReadout .map-colour-key')];
        if(!keys.length)return true;
        const bar=document.querySelector('#mapReadout .map-distance-key').getBoundingClientRect();
        return keys.every(key=>bar.bottom<=key.getBoundingClientRect().top+1);
      });
      assert(above,`${label} distance key sits above every colour key`);
      const check=async where=>{
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const reading=await page.evaluate(()=>{
          const map=window.ClearSkiesPortalBridge.map,center=map.getCenter(),origin=map.project(center);
          return {label:document.querySelector('#mapReadout .distance-label').textContent.trim(),
            width:document.querySelector('#mapReadout .distance-bar').getBoundingClientRect().width,
            mpp:map.distance(center,map.unproject(origin.add([1,0])))};
        });
        const labelled=metresOf(reading.label),shown=reading.mpp*reading.width;
        assert(Math.abs(shown-labelled)/labelled<0.03,`${label} ${where}: bar ${shown.toFixed(1)} m, label ${reading.label} (${labelled.toFixed(1)} m)`);
        return reading.label;
      };
      const wide=await check('opening view');
      await page.waitForTimeout(400);
      const fit=await page.evaluate(()=>{
        const card=document.getElementById('mapReadout').getBoundingClientRect();
        const bar=document.querySelector('#mapReadout .distance-bar').getBoundingClientRect();
        const text=document.querySelector('#mapReadout .distance-label').getBoundingClientRect();
        return {barBottom:bar.bottom,cardBottom:card.bottom,labelRight:text.right,cardRight:card.right,barTop:bar.top,cardTop:card.top};
      });
      assert(fit.barTop>=fit.cardTop-0.5&&fit.barBottom<=fit.cardBottom+0.5&&fit.labelRight<=fit.cardRight+0.5,
        `${label} scale bar is clipped by the info card: ${JSON.stringify(fit)}`);
      await page.screenshot({path:path.join(output,`distance-key-${label}.png`)});
      if(label==='desktop'){
        await page.evaluate(()=>{window.ClearSkiesPortalBridge.map.setView([47.6,-122.3],14,{animate:false})});
        await page.waitForFunction(previous=>document.querySelector('#mapReadout .distance-label').textContent.trim()!==previous,wide);
        const close=await check('city zoom');
        assert(close.endsWith('ft'),`a close view is in feet: ${close}`);
        await page.screenshot({path:path.join(output,'distance-key-desktop-feet.png')});
        await page.evaluate(()=>{window.ClearSkiesPortalBridge.map.setView([0,-100],8,{animate:false})});
        const equator=metresOf(await check('equator'));
        await page.evaluate(()=>{window.ClearSkiesPortalBridge.map.setView([65,-100],8,{animate:false})});
        const north=metresOf(await check('65° N'));
        assert(equator>north,'the same zoom covers more ground at the equator');
        const before=await page.evaluate(()=>document.querySelector('#mapReadout .distance-label').textContent.trim());
        await page.evaluate(()=>{const map=window.ClearSkiesPortalBridge.map;map.fire('zoomanim',{center:map.getCenter(),zoom:map.getZoom()+0.8,noUpdate:true})});
        await page.waitForFunction(previous=>document.querySelector('#mapReadout .distance-label').textContent.trim()!==previous,before);
        const preview=await page.evaluate(()=>{
          const map=window.ClearSkiesPortalBridge.map,lat=map.getCenter().lat,zoom=map.getZoom()+0.8;
          const mpp=40075016.68557849*Math.cos(lat*Math.PI/180)/map.options.crs.scale(zoom);
          return {label:document.querySelector('#mapReadout .distance-label').textContent.trim(),
            width:document.querySelector('#mapReadout .distance-bar').getBoundingClientRect().width,mpp};
        });
        const previewMetres=metresOf(preview.label);
        assert(Math.abs(preview.mpp*preview.width-previewMetres)/previewMetres<0.03,`zoom preview bar does not match ${preview.label}`);
        await page.evaluate(()=>{window.ClearSkiesPortalBridge.map.fire('zoomend')});
        await page.waitForFunction(previous=>document.querySelector('#mapReadout .distance-label').textContent.trim()===previous,before);
        await check('zoom settled');
        await page.evaluate(()=>{const box=document.getElementById('elevSh');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}))});
        await page.waitForFunction(()=>document.querySelector('#mapReadout .map-colour-key .key-name')?.textContent);
        const stacked=await page.evaluate(()=>{
          const bar=document.querySelector('#mapReadout .map-distance-key').getBoundingClientRect();
          return [...document.querySelectorAll('#mapReadout .map-colour-key')].every(key=>bar.bottom<=key.getBoundingClientRect().top+1);
        });
        assert(stacked,'the distance key stays above the elevation colour key');
        const header=await page.evaluate(()=>{
          const root=document.getElementById('mapReadout'),toggle=root.querySelector('.map-info-toggle');
          const title=toggle.querySelector('.map-info-title');
          const box=root.getBoundingClientRect(),bar=root.querySelector('.distance-bar').getBoundingClientRect();
          return {expanded:root.classList.contains('expanded'),title:getComputedStyle(title).display,
            toggleTop:toggle.getBoundingClientRect().top,cardTop:box.top,barBottom:bar.bottom,cardBottom:box.bottom,
            animations:root.getAnimations().length};
        });
        assert(header.expanded&&header.title==='block'&&header.toggleTop>=header.cardTop-0.5&&header.barBottom<=header.cardBottom+0.5&&header.animations===0,
          `the open info card clips its header or scale: ${JSON.stringify(header)}`);
        await page.screenshot({path:path.join(output,'distance-key-desktop-keys.png')});
      }
      assert.deepEqual(errors,[],`${label} page errors: ${errors.join('\n')}`);
      await context.close();
    }
  }finally{await browser.close()}
  console.log('distance key checks passed');
})().catch(error=>{console.error(error);process.exit(1)});