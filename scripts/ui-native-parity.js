'use strict';
/* Native phone chrome regressions and bounded animation measurements.
   node scripts/run-ui.js native-parity
   CSP_UI_BROWSER=webkit node scripts/run-ui.js native-parity */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {launchUIBrowser}=require('./lib/browser.js');
const base=process.argv[2]||'http://127.0.0.1:8765/';
(async()=>{
 const browser=await launchUIBrowser(),output=process.env.CSP_UI_OUTPUT||'.codex-audits/native-parity';fs.mkdirSync(output,{recursive:true});
 const measurements=[];
 try{
  for(const dark of [false,true]){
   const context=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,serviceWorkers:'block'});
   await context.addInitScript(dark=>{
    localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
    localStorage.setItem('clearskies.mapTheme.v1',dark?'dark':'light');
   },dark);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/markup**',route=>route.fulfill({json:{layers:[],deleted:{}}}));
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.getElementById('cspGrabber')&&!document.getElementById('app').inert);
   await page.evaluate(()=>{
    const root=document.documentElement;root.classList.add('csp-standalone','csp-round-screen');
    root.style.setProperty('--safe-top','59px');root.style.setProperty('--safe-bottom','34px');root.style.setProperty('--screen-radius','55px');
   });
   await page.locator('#q').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('#cspGrabber').getAttribute('aria-hidden'),'true','the grabber is not an accessible control');
   assert.equal(await page.locator('#cspGrabber').getAttribute('tabindex'),'-1');
   await page.evaluate(()=>document.getElementById('mapReadout').classList.add('sheet-compact'));
   assert(Number(await page.locator('#mapDock').evaluate(el=>getComputedStyle(el).opacity))>0.5,'compact map info does not hide the toolbar');
   await page.evaluate(()=>document.getElementById('mapReadout').classList.remove('sheet-compact'));
   assert.equal(await page.locator('#side').evaluate(el=>getComputedStyle(el).transitionDuration.split(',')[0]),'0.35s','the open-sheet selector honors native timing');
   const corners=await page.locator('#side').evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopLeftRadius,s.borderBottomLeftRadius]});
   assert.deepEqual(corners,['32px','51px'],'fixed top and concentric bottom corners');
   assert(await page.locator('#mapReadout').isVisible(),'map info stays on the map at medium');
   await page.locator('#mapReadout .map-info-toggle').click();await page.waitForTimeout(300);
   assert(!await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'map info interaction preserves the open menu');
   await page.locator('#mapReadout .map-info-toggle').click();await page.waitForTimeout(300);
   await page.locator('[data-route="terrain"]').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('#cspWorkspaceTitle').textContent(),'Terrain & LiDAR');
   assert.equal(await page.locator('#cspWorkspaceDescription').textContent(),'Style terrain, adjust lighting and download data');
   const header=await page.locator('#cspWorkspaceHeader').evaluate(el=>({height:el.getBoundingClientRect().height,title:getComputedStyle(document.getElementById('cspWorkspaceTitle')).fontSize}));
   assert(header.height<=64&&header.title==='15px','native inline navigation header');
   assert.notEqual(await page.locator('#side').evaluate(el=>getComputedStyle(el).backdropFilter),'none','Terrain retains glass');
   const studio=await page.evaluate(()=>{
     const card=document.querySelector('.ls-preset-card'),save=document.querySelector('.ls-save-look'),arrows=document.querySelector('.ls-preset-navigation');
     return {border:card?getComputedStyle(card).borderTopStyle:null,save:save?getComputedStyle(save).display:null,arrows:arrows?getComputedStyle(arrows).display:null};
   });
   assert.equal(studio.border,'none','portrait presets sit on the sheet glass');
   assert.equal(studio.save,'none','portrait presets hide the studio save control');
   assert.equal(studio.arrows,'none','portrait presets hide the carousel arrows');
   if(studio.border==='none'){
    const portrait=await page.evaluate(()=>{
     const chosen=document.querySelector('.ls-look[aria-checked="true"]')||document.querySelector('.ls-look');
     if(chosen&&chosen.getAttribute('aria-checked')!=='true'){
      document.querySelectorAll('.ls-look').forEach(el=>el.setAttribute('aria-checked','false'));
      chosen.setAttribute('aria-checked','true');
     }
     const selected=document.querySelector('.ls-look[aria-checked="true"] .ls-look-name');
     const thumb=document.querySelector('.ls-look:not([aria-checked="true"]) .ls-look-preview')||document.querySelector('.ls-look-preview');
     const status=document.querySelector('.ls-preset-status');
     const probe=document.createElement('i');probe.style.color='var(--ui-accent)';document.body.append(probe);
     const accent=getComputedStyle(probe).color;probe.remove();
     const top=node=>node?node.getBoundingClientRect().top:0;
     const value=document.getElementById('terStyle')?.value;
     const chip=document.querySelector(`.csp-style-chip[data-value="${value}"]`);
     const chipBox=chip?.getBoundingClientRect();
     const layers=document.querySelector('.ls-layers-disclosure');
     const group=document.getElementById('cspCustomizeGroup');
     const probeLayer=document.createElement('li');
     probeLayer.className='ls-layer';
     probeLayer.innerHTML='<div class="ls-layer-main"><span class="ls-swatch"></span></div>';
     document.getElementById('cspWorkspace').append(probeLayer);
     const swatch=probeLayer.querySelector('.ls-swatch')?.getBoundingClientRect();
     probeLayer.remove();
     return {
      title:document.querySelector('.ls-preset-card .menu-section-title')?.textContent||'',
      kicker:document.querySelector('.ls-phone-kicker')?.textContent||'',
      layers:layers?.querySelector('summary')?.innerText||'',
      layersOpen:!!layers?.open,
      count:document.querySelector('.ls-layers-head .pane-n')?.textContent||'',
      effects:!!document.querySelector('.ls-layers-disclosure .ls-effects'),
      customize:!!document.querySelector('.ls-customize'),
      heading:document.getElementById('terLidarHeading')?.firstChild?.nodeValue||'',
      appearance:document.querySelector('.terrain-phone-appearance .ls-disclosure-title')?.textContent||'',
      lighting:document.querySelector('.terrain-phone-lighting .ls-disclosure-title')?.textContent||'',
      appearanceOpen:!!document.querySelector('.terrain-phone-appearance')?.open,
      lightingOpen:!!document.querySelector('.terrain-phone-lighting')?.open,
      name:selected?getComputedStyle(selected).color:'',
      accent,
      shadow:thumb?getComputedStyle(thumb).boxShadow:'',
      status:status?getComputedStyle(status).display:'',
      chip:chipBox?{w:Math.round(chipBox.width),h:Math.round(chipBox.height),on:chip.getAttribute('aria-checked')}:null,
      swatch:swatch?{w:Math.round(swatch.width),h:Math.round(swatch.height)}:null,
      grouped:!!group&&[layers,document.querySelector('.terrain-phone-appearance'),document.querySelector('.terrain-phone-lighting')].every(node=>node&&node.parentElement===group),
      radius:group?getComputedStyle(group).borderRadius:'',
      rowRadius:group?getComputedStyle(group.querySelector('summary')).borderRadius:'',
      src:document.getElementById('terSrc')?.closest('#cspTerrainDownloads')?'downloads':'',
      downloads:document.querySelector('#cspTerrainDownloads .ls-disclosure-title')?.textContent||'',
      about:document.querySelector('#cspTerrainAbout .ls-disclosure-title')?.textContent||'',
      aboutKicker:document.getElementById('cspAboutKicker')?.textContent||'',
      dataKicker:document.getElementById('cspDataKicker')?.textContent||'',
      resetKicker:document.getElementById('cspResetKicker')?.textContent||'',
      opacityLabel:document.querySelector('label[for="terOp"]')?.textContent||'',
      mapCard:document.getElementById('cspStyleChips')?.parentElement?.id||'',
      opacityCard:document.querySelector('.terrain-opacity-control')?.parentElement?.id||'',
      legendCard:document.getElementById('terLegend')?.parentElement?.id||'',
      mapRadius:document.getElementById('cspMapDisplay')?getComputedStyle(document.getElementById('cspMapDisplay')).borderRadius:'',
      opacityRadius:document.querySelector('.terrain-opacity-control')?getComputedStyle(document.querySelector('.terrain-opacity-control')).borderRadius:'',
      trackRow:document.getElementById('terOp')?getComputedStyle(document.getElementById('terOp')).gridRowStart:'',
      kickerMargin:document.getElementById('cspDataKicker')?getComputedStyle(document.getElementById('cspDataKicker')).marginTop:'',
      sourceTop:top(document.getElementById('cspTerrainDownloads')),
      lightingTop:top(document.querySelector('.terrain-phone-lighting')),
      order:[
        top(document.querySelector('.ls-preset-card')),
        top(document.getElementById('terLidarHeading')),
        top(document.getElementById('cspStyleChips')),
        top(document.querySelector('.terrain-opacity-control')),
        top(document.querySelector('.ls-phone-kicker')),
        top(layers),
        top(document.querySelector('.terrain-phone-appearance')),
        top(document.querySelector('.terrain-phone-lighting'))
      ]
     };
    });
    assert.equal(portrait.title,'Quick presets','portrait presets use the native section name');
    assert.equal(portrait.kicker,'Customize terrain','customize terrain is a section label');
    assert.match(portrait.layers,/Layers & colors/,'layers disclosure uses the native name');
    assert.match(portrait.layers,/Mix layers, edit palettes and apply terrain effects/,'the mix sentence sits on layers');
    assert.equal(portrait.layersOpen,false,'layers starts collapsed');
    assert.equal(portrait.count,'','the phone layer card drops the studio count');
    assert.equal(portrait.effects,true,'effects stay inside the layers disclosure');
    assert.equal(portrait.customize,false,'the phone sheet does not keep the desktop customize disclosure');
    assert.match(portrait.heading,/^Map display /,'portrait map display uses the native section name');
    assert.equal(portrait.appearance,'Color & contrast','color and contrast is its own disclosure');
    assert.equal(portrait.lighting,'Lighting & 3D relief','lighting is its own disclosure');
    assert.equal(portrait.appearanceOpen,false,'color and contrast starts collapsed');
    assert.equal(portrait.lightingOpen,false,'lighting starts collapsed');
    assert.deepEqual(portrait.order,portrait.order.slice().sort((a,b)=>a-b),'presets, map display, opacity, then one customize card');
    assert.equal(portrait.grouped,true,'the three customize disclosures share one card');
    assert.equal(portrait.radius,'12px','the customize card has one corner radius');
    assert.equal(portrait.rowRadius,'0px','customize rows are not separate rounded cards');
    assert.equal(portrait.src,'downloads','the source select sits in terrain downloads');
    assert.equal(portrait.downloads,'Terrain downloads','terrain downloads uses the native name');
    assert.equal(portrait.dataKicker,'Data & downloads','downloads keep their own section');
    assert.equal(portrait.about,'Sources & scale','about this terrain names sources and scale');
    assert.equal(portrait.aboutKicker,'About this terrain','about this terrain is its own section');
    assert.equal(portrait.resetKicker,'Reset','reset is its own section');
    assert.equal(portrait.opacityLabel,'Terrain opacity','map display keeps the opacity row');
    assert.equal(portrait.mapCard,'cspMapDisplay','chips sit in the map display card');
    assert.equal(portrait.opacityCard,'cspMapDisplay','opacity sits in the map display card');
    assert.equal(portrait.legendCard,'cspMapDisplay','the legend sits in the map display card');
    assert.equal(portrait.mapRadius,'12px','map display has one corner radius');
    assert.equal(portrait.opacityRadius,'0px','the opacity row is not its own card');
    assert.equal(portrait.trackRow,'2','the opacity track sits under its title');
    assert.equal(portrait.kickerMargin,'20px','phone sections use the native section spacing');
    assert(portrait.sourceTop>portrait.lightingTop,'the source card follows customize');
    assert.deepEqual(portrait.chip,{w:70,h:62,on:'true'},'map display is a 70 by 62 chip row');
    assert.deepEqual(portrait.swatch,{w:30,h:12},'a closed layer swatch is the native capsule');
    assert.equal(portrait.name,portrait.accent,'a selected preset caption uses the tint');
    assert.match(portrait.shadow,/0\.5px/,'an unselected preset thumb uses the hairline stroke');
    assert.equal(portrait.status,'','the phone sheet does not render the studio status');
   }
   await page.screenshot({path:path.join(output,`terrain-${dark?'dark':'light'}.png`)});
   await page.locator('.csp-style-chip[data-value="c25"]').click();
   await page.waitForFunction(()=>{
     const row=document.getElementById('cspStyleChips');
     const chip=row?.querySelector('[data-value="c25"]');
     if(!row||!chip) return false;
     const mid=(chip.getBoundingClientRect().left+chip.getBoundingClientRect().right)/2;
     const center=(row.getBoundingClientRect().left+row.getBoundingClientRect().right)/2;
     return Math.abs(mid-center)<8;
   });
   const chips=await page.evaluate(()=>{
     const row=document.getElementById('cspStyleChips');
     const chip=row.querySelector('[data-value="c25"]');
     const mid=(chip.getBoundingClientRect().left+chip.getBoundingClientRect().right)/2;
     const center=(row.getBoundingClientRect().left+row.getBoundingClientRect().right)/2;
     row.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
     return {centered:Math.abs(mid-center)<8,value:document.getElementById('terStyle').value};
   });
   assert.equal(chips.centered,true,'the selected map display chip scrolls to the center');
   assert.equal(chips.value,'c10','arrow keys move the map display choice');
   await page.locator('.csp-style-chip[data-value="off"]').click();
   await page.evaluate(()=>{
     document.getElementById('cspTerrainDownloads').open=true;
     document.getElementById('cspTerrainAbout').open=true;
   });
   const opened=await page.evaluate(()=>{
     const hint=document.getElementById('terSrcHint');
     const heading=document.querySelector('#cspTerrainDownloads h4');
     const about=document.querySelector('#cspTerrainAbout h4');
     const label=document.querySelector('#cspTerrainDownloads label[for="terSrc"]');
     return {
       hint:hint?getComputedStyle(hint).display:'',
       heading:heading?getComputedStyle(heading).display:'',
       about:about?getComputedStyle(about).display:'',
       label:label?getComputedStyle(label).fontSize:''
     };
   });
   assert.equal(opened.hint,'block','the source hint shows inside terrain downloads');
   assert.equal(opened.heading,'none','terrain downloads hides the desktop heading');
   assert.equal(opened.about,'none','sources and scale hides the desktop heading');
   assert.equal(opened.label,'15px','the source row uses the list title size');
   for(const width of [375,393,430]){
    await page.setViewportSize({width,height:932});await page.waitForTimeout(450);
    const picker=await page.evaluate(()=>{
     const label=document.querySelector('label[for="terSrc"]'),select=document.getElementById('terSrc'),s=getComputedStyle(select);
     const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=s.font;
     return {labelRight:label.getBoundingClientRect().right,left:select.getBoundingClientRect().left,
      available:select.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),text:ctx.measureText(select.selectedOptions[0].textContent).width};
    });
    assert(picker.labelRight<=picker.left,`source picker does not overlap at ${width}px: ${JSON.stringify(picker)}`);
    assert(picker.available>=picker.text,`source picker value fits at ${width}px: ${JSON.stringify(picker)}`);
    if(!dark&&width!==430){
     await page.locator('#terSrc').scrollIntoViewIfNeeded();
     await page.screenshot({path:path.join(output,`downloads-${width}.png`)});
    }
   }
   await page.evaluate(()=>{
     document.getElementById('cspTerrainDownloads').open=false;
     document.getElementById('cspTerrainAbout').open=false;
   });
   // Capture real touch events for interactive edge-pop when the browser supports CDP.
   if((process.env.CSP_UI_BROWSER||'chrome')!=='webkit'){
    const cdp=await context.newCDPSession(page),side=await page.locator('#side').boundingBox();
    const x=side.x+5,y=side.y+110;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let n=1;n<=6;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+n*15,y,id:1}]});await page.waitForTimeout(16)}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>document.body.dataset.cspView==='nav');await cdp.detach();
   }else await page.locator('#cspBack').click();
   await page.locator('#cspSearchClose').click();await page.waitForTimeout(400);
   assert(await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'home close returns to the search capsule');
   await page.locator('#q').click();await page.waitForTimeout(400);
   await page.locator('[data-route="elevation"]').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('.ev-toggle-text strong').first().evaluate(el=>getComputedStyle(el).fontSize),'15px','portrait elevation rows use the home title size');
   const elevation=await page.evaluate(()=>({
     units:document.querySelector('#elevUnitsDisclosure > summary')?.innerText||'',
     unitsOpen:!!document.getElementById('elevUnitsDisclosure')?.open,
     bands:document.querySelector('#elevBandsDisclosure > summary')?.innerText||'',
     bandsOpen:!!document.getElementById('elevBandsDisclosure')?.open,
     color:document.querySelector('#elevColorDisclosure > summary')?.innerText||'',
     colorOpen:!!document.getElementById('elevColorDisclosure')?.open,
     intro:getComputedStyle(document.querySelector('.ev-intro')).display
   }));
   assert.match(elevation.units,/Units/,'elevation units are their own disclosure');
   assert.equal(elevation.unitsOpen,false,'units starts collapsed');
   assert.match(elevation.bands,/Highlight elevations/,'highlight elevations folds to a summary');
   assert.equal(elevation.bandsOpen,false,'highlight elevations starts collapsed');
   assert.match(elevation.color,/Color by elevation/,'color by elevation is a fold header');
   assert.match(elevation.color,/Off/,'color by elevation reads off until the switch is on');
   assert.equal(elevation.colorOpen,false,'color by elevation starts collapsed');
   assert.equal(elevation.intro,'none','the phone highlight card drops the studio intro');
   await page.locator('#lb_elevSh').click();
   const flipped=await page.evaluate(()=>({
     on:document.getElementById('elevSh').checked,
     open:document.getElementById('elevColorDisclosure').open
   }));
   assert.equal(flipped.on,true,'the color switch turns on without opening the fold');
   assert.equal(flipped.open,false,'the color fold stays closed when the switch turns on');
   await page.locator('#lb_elevSh').click();
   await page.evaluate(()=>{document.getElementById('elevColorDisclosure').open=true});
   for(const width of [375,393,430]){
    await page.setViewportSize({width,height:932});await page.waitForTimeout(450);
    const color=await page.evaluate(()=>{
     const select=document.getElementById('elevPalette'),s=getComputedStyle(select),ctx=document.createElement('canvas').getContext('2d');ctx.font=s.font;
     const left=document.getElementById('elevColorDisclosure').getBoundingClientRect().left;
     const top=selector=>document.querySelector(selector).getBoundingClientRect().top;
     return {available:select.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),text:ctx.measureText(select.selectedOptions[0].textContent).width,
      inset:document.getElementById('elevRangePreview').getBoundingClientRect().left-left,
      mid:document.getElementById('elevMidColor').nextElementSibling.textContent,
      help:document.getElementById('elevSpanHint').parentElement.id,
      order:['#elevVal','#elevSpan','.elev-spectrum-scale','#cspColorPresetRow','#elevPaletteBox','#elevAlpha','#cspColorRangeHelp','.ev-actions'].map(top)};
    });
    assert(color.available>=color.text,`elevation preset fits at ${width}px: ${JSON.stringify(color)}`);
    assert(Math.abs(color.inset-16)<1,'elevation scale has the native inset');
    assert.equal(color.mid,'Reference');assert.equal(color.help,'cspColorRangeHelp');
    assert.deepEqual(color.order,color.order.slice().sort((a,b)=>a-b),'elevation controls follow the native order');
    if(!dark&&width!==430){
     await page.locator('#elevPalette').scrollIntoViewIfNeeded();
     await page.screenshot({path:path.join(output,`elevation-${width}.png`)});
    }
   }
   await page.setViewportSize({width:844,height:430});await page.waitForTimeout(450);
   assert.equal(await page.locator('#elevPalette').count(),1,'rotation keeps one live palette control');
   assert(await page.locator('#elevSpectrumMore .ev-color-row #elevPalette').count(),'landscape restores the original controls');
   await page.setViewportSize({width:430,height:932});await page.waitForTimeout(450);
   assert.equal(await page.locator('#cspColorPresetRow #elevPalette').count(),1,'portrait restores the native picker row');
   assert(await page.evaluate(()=>document.getElementById('elevColorDisclosure')?.open),'rotation keeps the open color fold open');
   await page.locator('#elevVal').click();
   await page.waitForTimeout(250);
   assert.equal(await page.locator('#cspPageClose').getAttribute('aria-label'),'Dismiss keyboard','page close points at the focused field');
   await page.locator('#cspPageClose').click();await page.waitForTimeout(200);
   assert(!await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'page close dismisses the keyboard and leaves the sheet up');
   assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'elevVal');
   await page.locator('#cspPageClose').click();await page.waitForTimeout(400);
   assert(await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'page close returns to capsule');
   await page.locator('#q').click();await page.waitForTimeout(400);
   await page.locator('#cspBack').click();await page.waitForTimeout(400);
   await page.locator('#q').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('#cspSearchClose').getAttribute('aria-label'),'Dismiss keyboard');
   const pinned=await page.evaluate(()=>{
     const sheet=document.getElementById('side'),previous=sheet.style.transition;
     sheet.style.transition='none';
     const before=sheet.getBoundingClientRect();
     document.body.style.setProperty('--sheet-keyboard','160px');
     const after=sheet.getBoundingClientRect();
     document.body.style.removeProperty('--sheet-keyboard');
     sheet.style.transition=previous;
     return {before:before.top,top:after.top,bottom:after.bottom,height:after.height,inner:innerHeight};
   });
   assert(Math.abs(pinned.top-pinned.before)<1,`keyboard inset keeps the expanded top: ${JSON.stringify(pinned)}`);
   assert(pinned.inner-pinned.bottom>150,`sheet sits above the keyboard inset: ${JSON.stringify(pinned)}`);
   await page.locator('#cspSearchClose').click();await page.waitForTimeout(150);
   assert(!await page.locator('body').evaluate(el=>el.classList.contains('collapsed')),'keyboard dismiss preserves the menu');
   await page.locator('#cspSearchClose').click();await page.waitForTimeout(400);
   await page.locator('#q').click();await page.waitForTimeout(400);
   const result=await page.evaluate(async()=>{
    const samples=[],frames=[],longTasks=[],start=performance.now();let last=start;
    const observer=typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))):null;
    observer?.observe({type:'longtask'});
    const measure=()=>new Promise(resolve=>{
     const begin=performance.now();
     const detent=document.body.classList.contains('collapsed')?'peek':document.body.dataset.cspDetent||'medium';
     [...document.querySelectorAll('.csp-sheet-actions button')].find(button=>button.textContent===(detent==='large'?'Collapse':'Expand')).click();
     const frame=now=>{
      frames.push(now-last);last=now;
      const sheet=document.getElementById('side'),dock=document.getElementById('mapDock');
      samples.push({at:now-begin,height:sheet.getBoundingClientRect().height,opacity:+getComputedStyle(dock).opacity});
      if(now-begin<450)requestAnimationFrame(frame);else resolve();
     };requestAnimationFrame(frame);
    });
    for(let i=0;i<4;i++)await measure();observer?.disconnect();
    const sorted=frames.slice(2).sort((a,b)=>a-b);
    return {longTasksSupported:!!observer,samples,frames:frames.length,p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted),longTasks,duration:performance.now()-start};
   });
   measurements.push({browser:process.env.CSP_UI_BROWSER||'chrome',dark,...result});
   assert(result.frames>20,'animation produces a usable frame sample');
   assert.deepEqual(errors,[],'no browser or resize-observer errors');
   console.log(`PASS native chrome ${dark?'dark':'light'}: headers, glass, corners, dismissal, map info; ${result.frames} frames, p95 ${result.p95.toFixed(1)}ms (host browser)`);
   await context.close();
  }
 }finally{await browser.close()}
 fs.writeFileSync(path.join(output,`motion-${process.env.CSP_UI_BROWSER||'chrome'}.json`),JSON.stringify(measurements,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
