'use strict';
/* Interaction regressions from the sidebar review. Uses the optional browser
   runtime documented in README, with real DOM, routing and search controllers.
   node scripts/ui-review-regressions.js [http://127.0.0.1:8765/] */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {launchUIBrowser}=require('./lib/browser.js');
const base=process.argv[2]||'http://127.0.0.1:8765/';
const output=process.env.CSP_UI_OUTPUT||path.join(__dirname,'..','.codex-audits');
const places=Array.from({length:6},(_,i)=>({type:'Feature',geometry:{type:'Point',coordinates:[-119.28,47.13+i*.01]},
  properties:{name:'Place '+(i+1),county:'Grant County',state:'Washington',country:'United States of America',osm_value:'town'}}));
const scenes=Array.from({length:3},(_,i)=>({type:'Feature',id:'review-scene-'+i,collection:'sentinel-2-l2a',geometry:null,
  properties:{datetime:'2026-10-16T12:00:00Z','eo:cloud_cover':4},assets:{}}));
(async()=>{
  const browser=await launchUIBrowser();fs.mkdirSync(output,{recursive:true});
  async function create(width,height,touch=false,unsupportedPicker=false){
    const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
      localStorage.setItem('clearskies.mapTheme.v1','light');
    });
    const page=await context.newPage(),errors=[],fixture={mode:'places',pending:null};
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const request=route.request(),url=request.url();
      if(url.includes('/api/markup')) return route.fulfill({json:{layers:[],deleted:{}}});
      if(unsupportedPicker&&url.includes('/ui-system.css')){
        const response=await route.fetch();
        const css=(await response.text()).replaceAll('::picker(select)','::csp-unsupported-picker').replaceAll('(appearance:base-select)','(appearance:csp-native-fallback)');
        return route.fulfill({response,body:css});
      }
      if(url.includes('/api/?limit=6&q=')){
        if(fixture.pending) await fixture.pending;
        return fixture.mode==='error'?route.fulfill({status:503,body:'unavailable'}):route.fulfill({json:{features:fixture.mode==='empty'?[]:places}});
      }
      if(request.method()==='POST'&&request.postData()?.includes('"collections"')){
        const body=request.postDataJSON();
        return route.fulfill({json:{type:'FeatureCollection',features:body.collections.includes('sentinel-2-l2a')?scenes:[]}});
      }
      return route.continue();
    });
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.ClearSkiesPortalBridge&&document.querySelector('.csp-nav-button'));
    const navigate=async key=>{
      await page.evaluate(route=>{document.querySelector(`.csp-nav-button[data-route="${route}"]`).click();document.body.classList.remove('collapsed');document.body.dataset.cspDetent='large'},key);
      await page.waitForTimeout(450);
    };
    return {context,page,fixture,navigate,finish:async()=>{assert.deepEqual(errors,[],'no page errors');await context.close()}};
  }
  try{
    const desktop=await create(1440,900),{page:d}=desktop;
    await desktop.navigate('satellite');
    await d.locator('#q').fill('47.13, -119.28');await d.locator('#q').press('Enter');
    await d.waitForFunction(()=>window.ClearSkiesPortalBridge.searchState().version===1);
    assert.equal(await d.locator('#cspSatQuery').inputValue(),'47.13, -119.28');
    await d.locator('#q').fill('47.60, -122.33');await d.locator('#q').press('Enter');
    await d.waitForFunction(()=>window.ClearSkiesPortalBridge.searchState().version===2);
    assert.equal(await d.locator('#cspSatQuery').inputValue(),'47.60, -122.33','external committed location replaces the previous location');
    await d.locator('#cspSatQuery').fill('46.5, -120.5');
    await d.locator('#q').fill('47.7, -122.4');await d.locator('#q').press('Enter');
    assert.equal(await d.locator('#cspSatQuery').inputValue(),'46.5, -120.5','external location changes preserve unfinished Satellite drafts');
    await desktop.navigate('conditions');await desktop.navigate('satellite');
    assert.equal(await d.locator('#cspSatQuery').inputValue(),'46.5, -120.5','draft survives navigation');
    assert((await d.locator('#cspSatNote').textContent()).includes('47.7, -122.4'),'a retained draft identifies the actual committed map location');
    await d.locator('#cspSatQuery').press('Enter');
    await d.waitForFunction(()=>window.ClearSkiesPortalBridge.searchState().label==='46.5, -120.5');
    await d.locator('#q').fill('Unsubmitted global draft');
    assert.equal(await d.evaluate(()=>ClearSkiesPortalBridge.searchLabel()),'46.5, -120.5','unsubmitted global text does not change the committed label');
    await d.locator('#q').press('Escape');
    // Real run(), render() and selection paths use fixture STAC responses.
    await d.waitForFunction(()=>document.querySelector('#results.csp-results-enter .item'));
    await d.waitForTimeout(550);
    await d.locator('#results .item').first().evaluate(el=>el.click());
    assert(await d.locator('#results > :is(.item,.grp)').evaluateAll(els=>els.every(el=>getComputedStyle(el).animationName==='none')),'selection does not replay the result cascade');
    await d.locator('#results .grp').first().evaluate(el=>el.click());
    assert(await d.locator('#results > .grp').evaluateAll(els=>els.every(el=>getComputedStyle(el).animationName==='none')),'group changes do not replay the cascade');
    await d.locator('#q').fill('Places in global search');await d.locator('#ac .r').first().waitFor();
    await d.locator('#ac .r').first().click();
    assert.equal(await d.locator('#cspSatQuery').inputValue(),await d.locator('#q').inputValue(),'both search fields share place lookup and selection');
    assert((await d.evaluate(()=>ClearSkiesPortalBridge.searchLabel())).startsWith('Place 1'));
    await desktop.navigate('settings');
    assert.equal(await d.locator('#cspCustomView > .csp-card').last().getAttribute('id'),'cspMapSources');
    assert.equal(await d.locator('#status').evaluate(el=>el.parentElement.id),'cspWorkspaceScroll','status returns to its original host off Satellite');
    await desktop.navigate('satellite');
    assert(await d.locator('.csp-sat-card > #status').count(),'scene progress stays near the search field');
    await d.evaluate(()=>ClearSkiesPortalBridge.openPane('overlays'));await d.locator('#ov_imagery').check();
    const alignment=await d.evaluate(()=>({checkbox:document.getElementById('ov_imagery').getBoundingClientRect().left,track:document.getElementById('ovOpacity_imagery').getBoundingClientRect().left}));
    assert(Math.abs(alignment.checkbox-alignment.track)<1,'opacity track aligns with its checkbox');
    await desktop.navigate('settings');
    await d.evaluate(()=>document.documentElement.style.setProperty('--csp-text-zoom','1.12'));
    const nav=await d.locator('#cspNav').boundingBox();await d.mouse.move(nav.x+100,nav.y+200);
    await d.waitForTimeout(900);
    const halo=await d.locator('.csp-cursor-halo').evaluate(el=>{
      const box=el.getBoundingClientRect(),nav=document.getElementById('cspNav').getBoundingClientRect();
      return {x:box.left+box.width/2-nav.left,y:box.top+box.height/2-nav.top};
    });
    assert(Math.abs(halo.x-100)<1&&Math.abs(halo.y-200)<1,'halo coordinates honor text zoom');
    for(const mode of ['app','system']){
      if(mode==='app') await d.evaluate(()=>document.documentElement.classList.add('csp-reduce-motion'));
      else await d.emulateMedia({reducedMotion:'reduce'});
      await d.mouse.move(nav.x+120,nav.y+180);await d.waitForTimeout(100);
      assert(await d.locator('.csp-halo-layer').evaluate(el=>getComputedStyle(el).display==='none'),'reduced motion hides the halo');
      assert.equal(await d.locator('.csp-lens,.csp-cursor-halo.on').count(),0,'preference changes clear active lens and spring state');
      if(mode==='app') await d.evaluate(()=>document.documentElement.classList.remove('csp-reduce-motion'));
      else await d.emulateMedia({reducedMotion:'no-preference'});
    }
    await d.evaluate(()=>document.documentElement.style.removeProperty('--csp-text-zoom'));
    await d.setViewportSize({width:1440,height:500});
    const analyze=d.locator('.csp-nav-button[data-route="analyze"]');await analyze.scrollIntoViewIfNeeded();
    const row=await analyze.boundingBox();await d.mouse.move(row.x+row.width*.3,row.y+row.height/2);
    const origin=await analyze.locator('img').evaluate(el=>el.style.transformOrigin);
    await d.mouse.move(row.x+row.width*.7,row.y+row.height/2);
    assert.equal(await analyze.locator('img').evaluate(el=>el.style.transformOrigin),origin,'lens origin stays fixed while crossing the row');
    await d.locator('#cspNavScroll').evaluate(el=>el.scrollTop+=70);
    await d.waitForFunction(()=>!document.querySelector('.csp-lens'));
    await desktop.finish();console.log('PASS desktop: committed state, draft preservation, steady results, credits, slider and reduced-motion/zoom halo');

    const mobile=await create(390,844,true),{page:m,fixture}=mobile;await mobile.navigate('satellite');
    const query=m.locator('#cspSatQuery'),options=m.locator('#cspSatSuggest [role=option]');
    const suggest=async text=>{await query.fill(text);await options.first().waitFor();await m.waitForTimeout(230)};
    await suggest('Places');
    await m.evaluate(()=>{window.reviewFirstOption=document.getElementById('cspSatOption0')});
    await query.press('ArrowUp');
    assert.equal(await query.getAttribute('aria-activedescendant'),'cspSatOption5');
    assert(await m.evaluate(()=>reviewFirstOption===document.getElementById('cspSatOption0')),'keyboard highlighting preserves option nodes');
    await suggest('Places to scroll');
    const cdp=await mobile.context.newCDPSession(m),box=await options.first().boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await m.waitForTimeout(170);
    assert.equal(await m.evaluate(()=>ClearSkiesPortalBridge.searchState().version),0,'touch-start never commits a suggestion');
    for(const dy of [-20,-50,-90]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y+dy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await m.waitForTimeout(100);
    assert.equal(await m.evaluate(()=>ClearSkiesPortalBridge.searchState().version),0,'a swipe is cancelled without committing a place');
    assert(await m.locator('#cspSatSuggest').evaluate(el=>el.scrollTop>0),'the suggestion list scrolls naturally');
    await suggest('Places to tap');
    await m.evaluate(()=>{window.reviewSelectClicks=[];document.addEventListener('click',event=>{if(event.target.tagName==='SELECT') reviewSelectClicks.push(event.target.id)},true)});
    await options.first().tap();
    await m.waitForFunction(()=>ClearSkiesPortalBridge.searchState().version===1);
    assert.deepEqual(await m.evaluate(()=>reviewSelectClicks),[],'tap does not click through to a filter');
    await suggest('Places click activation');await options.first().evaluate(el=>el.click());
    await m.waitForFunction(()=>ClearSkiesPortalBridge.searchState().version===2);
    let release;fixture.pending=new Promise(resolve=>release=resolve);
    await query.fill('Pending lookup');await m.locator('#cspSatNote').filter({hasText:'Searching places'}).waitFor();
    fixture.mode='empty';release();fixture.pending=null;
    await m.locator('#cspSatNote').filter({hasText:'No matching suggestions'}).waitFor();
    assert.equal(await m.locator('#cspSatSuggest .note').count(),0,'status is outside the listbox');
    fixture.mode='error';await query.fill('Failed lookup');
    await m.locator('#cspSatNote').filter({hasText:'unavailable'}).waitFor();
    await query.evaluate(el=>el.blur());await m.locator('#days').click();
    // Measure touch targets after the picker's scale-in animation settles.
    await m.locator('#days').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))));
    assert(await m.locator('#days option').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height>=44&&parseFloat(getComputedStyle(el).fontSize)>=16)),'phone options retain touch sizing');
    await m.keyboard.press('Escape');await m.waitForTimeout(250);await m.screenshot({path:path.join(output,'review-fixed-mobile.png')});
    await mobile.finish();console.log('PASS phone: touch scroll, tap, click-only activation, ArrowUp, lookup feedback and 44px picker options');

    for(const [width,height] of [[320,568],[844,390]]){
      const small=await create(width,height,true),{page:s}=small;
      await s.evaluate(()=>{document.body.classList.remove('collapsed');document.body.dataset.cspView='nav';document.body.dataset.cspDetent='medium'});await s.waitForTimeout(500);
      const layout=await s.evaluate(()=>{const nav=document.getElementById('cspNav'),scroll=document.getElementById('cspNavScroll'),foot=nav.querySelector('.foot');return {space:scroll.clientHeight,gap:nav.getBoundingClientRect().bottom-foot.getBoundingClientRect().bottom,height:foot.getBoundingClientRect().height,metadata:foot.querySelector('.foot-meta')?getComputedStyle(foot.querySelector('.foot-meta')).display:'absent',rows:[...foot.querySelectorAll('.csp-nav-button')].map(el=>el.getBoundingClientRect().height)}});
      assert(layout.height<=80&&Math.abs(layout.gap)<1&&['none','absent'].includes(layout.metadata),'compact utilities stay pinned');
      assert(layout.rows.every(h=>h>=44),'utility targets remain at least 44px');
      if(width===844) assert(layout.space>=220,'landscape keeps useful space for the tool list');
      await s.screenshot({path:path.join(output,`review-fixed-nav-${width}.png`)});
      if(width===320){
        await small.navigate('satellite');await s.locator('#days').selectOption('custom');
        assert(await s.locator('.csp-sat-filters .csp-field-row > label').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height<25)),'short field labels stay on one line');
        const shortcuts=await s.locator('#dpre button').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,font:parseFloat(getComputedStyle(el).fontSize),fits:el.scrollWidth<=el.clientWidth+1,visible:el.textContent,name:el.getAttribute('aria-label')||el.textContent})));
        assert(Math.max(...shortcuts.map(s=>s.top))-Math.min(...shortcuts.map(s=>s.top))<1&&shortcuts.every(s=>s.font>=12&&s.fits&&s.name.includes(s.visible)),'readable one-line shortcuts retain visible accessible names');
        await s.locator('#dpre').scrollIntoViewIfNeeded();
        await s.screenshot({path:path.join(output,'review-fixed-dates-320.png')});
      }
      await small.finish();console.log(`PASS ${width}×${height}: compact pinned footer and usable navigation`);
    }
    const fallback=await create(390,844,true,true),{page:f}=fallback;
    await fallback.navigate('satellite');
    await f.evaluate(()=>document.body.classList.add('terrain-3d','map3d-moving'));
    assert(await f.locator('#side,#ctl,#mapDock').evaluateAll(els=>els.every(el=>getComputedStyle(el).backdropFilter==='none')),'unsupported picker selectors cannot discard ordinary motion safeguards');
    await fallback.finish();console.log('PASS picker fallback: terrain-motion safeguards survive unsupported selectors');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
