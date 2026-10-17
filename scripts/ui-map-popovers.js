'use strict';
/* Dock popover regression checks. Uses the same optional Playwright setup as
   ui-snapshot.js; no browser tooling is added to the application's lockfile.
   node scripts/ui-map-popovers.js [http://127.0.0.1:8765/] */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.argv[2]||'http://127.0.0.1:8765/';
const output=path.join(__dirname,'..','.codex-audits');
// A closing panel is already logically hidden and ignores input while its
// native display transition finishes painting the last 200 ms.
const visible=async(page,selector)=>!await page.locator(selector).evaluate(el=>el.hidden)&&await page.locator(selector).isVisible();
const inside=async(page,selector)=>{
  const r=await page.locator(selector).boundingBox(),s=page.viewportSize();
  assert(r&&r.x>=0&&r.y>=0&&r.x+r.width<=s.width+1&&r.y+r.height<=s.height+1,`${selector} is inside ${s.width}x${s.height}: ${JSON.stringify(r)}`);
  assert(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${selector} has no horizontally clipped controls`);
};
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch();
  try{
    for(const [label,width,height,touch] of [['desktop',1320,761,false],['desktop-dark',1320,761,false],['mobile',390,844,true],['mobile-dark',390,844,true],['small-mobile',320,568,true],['landscape',844,390,true],['reduced-motion',1320,761,false]]){
      if(process.env.POPOVER_CASE&&process.env.POPOVER_CASE!==label)continue;
      const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,serviceWorkers:'block',reducedMotion:label==='reduced-motion'?'reduce':'no-preference'});
      await context.addInitScript(dark=>{
        localStorage.setItem('clearskies.alerts.v1',JSON.stringify({nws:false,quakes:false,volcanoes:false,fires:false}));
        localStorage.setItem('clearskies.mapTheme.v1',dark?'dark':'light');
      },label.includes('dark'));
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      // Browser tests must never sync their temporary drawing layers to a
      // person's terrain engine. Persistence itself has separate unit tests.
      await page.route('**/api/markup**',route=>route.fulfill({json:route.request().method()==='GET'?{layers:[],deleted:{}}:{ok:true}}));
      await page.goto(base,{waitUntil:'domcontentloaded'});
      await page.locator('#quickDraw').click();
      await page.locator('#mkBar').waitFor({state:'visible'});
      await page.waitForTimeout(220);
      await inside(page,'#mkBar');
      assert.equal(await page.locator('#mkBar [data-tool]').count(),8);
      assert.equal(await page.locator('#quickDraw').getAttribute('aria-expanded'),'true');
      const firstId=await page.locator('#mkBar [data-layer-select]').inputValue();
      await page.locator('#mkBar [data-edit-detail="name"]').click();
      await page.locator('#mkBar [data-layer-detail="name"]').fill('North rim <A>');
      await page.locator('#mkBar [data-layer-detail="description"]').fill('Research notes\nSecond line');
      if(label==='desktop-dark'||label==='mobile')await page.screenshot({path:path.join(output,`markup-editing-${label}.png`)});
      await page.locator('#mkBar [data-act="save-layer-details"]').click();
      assert.equal(await page.locator('#mkBar [data-edit-detail="name"]').textContent(),'North rim <A>');
      assert.equal(await page.locator('#mkBar [data-edit-detail="description"]').textContent(),'Research notes\nSecond line');
      await page.locator('#mkBar [data-act="edit-layer-details"]').click();
      await page.locator('#mkBar [data-layer-detail="name"]').fill('Discard me');await page.keyboard.press('Escape');
      assert.equal(await page.locator('#mkBar [data-edit-detail="name"]').textContent(),'North rim <A>','Escape cancels metadata edits');
      // Create another layer through the actual layer-panel component without
      // involving unrelated mobile sheet navigation in this component test.
      await page.evaluate(()=>{const mount=document.createElement('div');mount.id='markupTestPanel';mount.style='position:fixed;left:0;top:0;width:300px;max-height:100dvh;overflow:auto;background:white;z-index:20000';document.body.append(mount);window.CSPMarkup.renderPanel(mount)});
      await page.locator('#markupTestPanel [data-act="new"]').click();
      await page.locator('#markupTestPanel .mk-new-name').fill('Second layer');
      await page.locator('#markupTestPanel [data-act="create"]').click();
      await page.evaluate(()=>document.getElementById('markupTestPanel').remove());
      assert.equal(await page.locator('#mkBar [data-layer-select] option').count(),2);
      await page.locator('#mkBar [data-edit-detail="description"]').click();
      await page.locator('#mkBar [data-layer-detail="description"]').fill('Other layer notes');
      await page.locator('#mkBar [data-layer-select]').selectOption(firstId);
      assert.equal(await page.locator('#mkBar [data-edit-detail="name"]').textContent(),'North rim <A>');
      assert.equal(await page.evaluate(()=>[...window.CSPMarkup._layers.values()].find(layer=>layer.doc.markup.name==='Second layer').doc.markup.description),'Other layer notes','switching saves details to their original layer');
      // Width reads label, slider, value; the value opens a field for a typed number.
      const typeWidth=async value=>{await page.locator('#mkBar [data-edit-ground="width"]').click();await page.locator('#mkPop .mk-value-input').fill(value);await page.locator('#mkPop .mk-value-input').press('Enter')};
      const rows=await page.locator('#mkBar .mk-slider:has(input[type=range])').evaluateAll(els=>els.map(el=>{const r=el.querySelector('input[type=range]').getBoundingClientRect();return [Math.round(r.left),Math.round(r.right)]}));
      assert(rows.length>=2&&rows.every(r=>Math.abs(r[0]-rows[0][0])<=1&&Math.abs(r[1]-rows[0][1])<=1),`width and opacity tracks line up: ${JSON.stringify(rows)}`);
      await typeWidth('50000.125');
      assert(await page.locator('#mkPop').evaluate(el=>el.hidden),'Return applies the typed width and closes the field');
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.editGround),'width','Return restores focus to the width value');
      await page.locator('#mkBar [data-edit-ground="width"]').click();
      assert.equal(await page.locator('#mkPop .mk-value-input').inputValue(),'50000.125','reopening retains an exact large fractional width');
      await page.locator('#mkPop .mk-value-input').press('Enter');
      assert.equal(await page.locator('#mkBar [data-ground-range="width"]').inputValue(),'1000');
      assert.equal(await page.locator('#mkBar [data-edit-ground="width"]').textContent(),`${(50000).toLocaleString('en-US')} ft`);
      await page.locator('#mkBar [data-ground-range="width"]').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
      assert.equal(await page.locator('#mkBar [data-ground-range="width"]').inputValue(),'998','keyboard range steps keep focus');
      await page.locator('#mkBar [data-ground-range="width"]').fill('500');
      assert(Number(await page.locator('#mkBar .mk-ground[data-ground="width"]').getAttribute('data-feet'))<50000.125);
      await page.locator('#mkBar [data-edit-ground="width"]').click();
      await inside(page,'#mkPop');
      await page.locator('#mkPop .mk-value-input').fill('wide');await page.locator('#mkPop .mk-value-input').press('Enter');
      assert(!await page.locator('#mkPop').evaluate(el=>el.hidden),'an invalid width keeps the field open');
      assert.equal(await page.locator('#mkPop .mk-value-input').getAttribute('aria-invalid'),'true');
      await page.keyboard.press('Escape');
      assert(await page.locator('#mkPop').evaluate(el=>el.hidden),'Escape discards the typed width');
      await typeWidth('0.125');
      await page.locator('#mkBar [data-edit-ground="width"]').click();
      assert.equal(await page.locator('#mkPop .mk-value-input').inputValue(),'0.125','reopening retains an exact small fractional width');
      await page.locator('#mkPop .mk-value-input').fill('21.125');
      await page.locator('#mkBar [data-tool="pan"]').click();
      assert.equal(await page.locator('#mkBar [data-tool="pan"]').getAttribute('aria-pressed'),'true','the first tap commits the width and activates the next tool');
      await page.locator('#mkBar [data-tool="pen"]').click();
      await page.locator('#mkBar [data-edit-ground="width"]').click();
      await page.locator('#mkPop .mk-value-input').fill('22.125');
      // Dispatch the trigger directly: the compact value bubble can cover Colour.
      await page.locator('#mkBar [data-pop="color"]').dispatchEvent('click');
      assert.equal(await page.locator('#mkPop').getAttribute('data-kind'),'color','the first tap commits width and opens Colour');
      await inside(page,'#mkPop');
      await page.locator('#mkPop [data-pick="#ff3b30"]').first().click();
      await typeWidth('20');
      const feedback=await page.evaluate(()=>{document.querySelector('#mkBar [data-tool="pan"]').click();return document.querySelector('#mkBar [data-tool="pan"]').getAnimations().length});
      assert.equal(feedback>0,label!=='reduced-motion','tool feedback honors Reduce Motion');
      for(const tool of ['pen','highlight','eraser','shape','text','pin','select','pan']){
        await page.locator(`#mkBar [data-tool="${tool}"]`).click();
        await inside(page,'#mkBar');
        if(tool==='shape'){
          assert(await visible(page,'#mkPop'));
          await inside(page,'#mkPop');
          await page.locator('#mkPop [data-shape="rect"]').first().click();
        }
      }
      await page.locator('#mkBar [data-tool="pen"]').click();
      await page.locator('#mkBar [data-pop="color"]').click();
      await inside(page,'#mkPop');
      await page.locator('#mkPop [data-pick="#ff3b30"]').first().click();
      await page.locator('#mkBar [data-style="opacity"]').fill('65');
      assert.equal(await page.locator('#mkBar [data-style="opacity"]+output').textContent(),'65%');
      const before=await page.evaluate(()=>[...window.CSPMarkup._layers.values()].reduce((sum,layer)=>sum+layer.doc.features.length,0));
      const stroke=await page.evaluate(()=>{
        const r=document.getElementById('mkBar').getBoundingClientRect();
        for(const x of [12,r.right+3,r.left-6,innerWidth-24,innerWidth/2])
          for(const y of [innerHeight-80,60,150,innerHeight/2])
            if(x>0&&x<innerWidth-6&&y>0&&y<innerHeight-35&&document.elementFromPoint(x,y)?.closest('#mkCapture'))return{x,y};
        return null;
      });
      assert(stroke,'there is exposed map next to the tools');
      await page.mouse.move(stroke.x,stroke.y);await page.mouse.down();
      await page.mouse.move(stroke.x+5,stroke.y+30,{steps:6});await page.mouse.up();
      assert(!await visible(page,'#mkBar'),'drawing dismisses the popover to keep the map clear');
      assert.equal(await page.evaluate(()=>[...window.CSPMarkup._layers.values()].reduce((sum,layer)=>sum+layer.doc.features.length,0)),before+1,'the stroke is retained');
      await page.locator('#quickDraw').click();
      await page.waitForTimeout(220);
      await page.screenshot({path:path.join(output,`markup-popover-${label}.png`)});
      const markupSurface=await page.locator('#mkBar').evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.borderRadius,s.backdropFilter]});
      const exit=await page.evaluate(()=>{const el=document.getElementById('mkBar');el.querySelector('.tool-close').click();return{hidden:el.hidden,animations:el.getAnimations().length,discrete:CSS.supports('transition-behavior:allow-discrete'),display:getComputedStyle(el).display}});
      assert(exit.hidden,'the panel closes logically before its visual exit');
      if(exit.discrete&&label!=='reduced-motion')assert(exit.animations>0,'popover animates out');
      if(label==='reduced-motion')assert.equal(exit.display,'none','Reduce Motion closes immediately');
      await page.locator('#quickDraw').click();await page.waitForTimeout(220);
      await page.locator('#snapshot').click();
      await page.locator('#snapshotPanel').waitFor({state:'visible'});
      await page.waitForTimeout(220);
      assert(!await visible(page,'#mkBar'),'camera closes markup tools');
      assert(!await visible(page,'#snapSel'),'camera opens settings before area selection');
      await inside(page,'#snapshotPanel');
      const cameraSurface=await page.locator('#snapshotPanel').evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.borderRadius,s.backdropFilter]});
      assert.deepEqual(markupSurface,cameraSurface,'markup and camera use the same popover surface');
      await page.screenshot({path:path.join(output,`camera-popover-${label}.png`)});
      const actions=await page.locator('#snapshotPanel .snapshot-action').evaluateAll(els=>els.map(el=>({id:el.id,box:el.getBoundingClientRect().toJSON()})));
      assert.deepEqual(actions.map(action=>action.id),['snapshotCapture','snapshotSelect'],'Capture comes first, then Select Area');
      assert(Math.abs(actions[0].box.top-actions[1].box.top)<1&&actions[0].box.right<=actions[1].box.left,'Capture and Select Area sit side by side');
      assert.equal(await page.locator('#snapshotPanel .csp-switch input#snapshotReadout').count(),1,'map info is a switch');
      await page.locator('#snapshotScale').selectOption('4');
      await page.locator('#snapshotSelect').click();
      await page.locator('#snapSel').waitFor({state:'visible'});
      assert(await visible(page,'#snapSel'),'Select Area opens the rectangle');
      assert(!await visible(page,'#snapshotPanel'));
      assert.deepEqual(await page.locator('#snapSelBar button').evaluateAll(els=>els.map(el=>el.id)),['snapSelCancel','snapSelSave'],'the rectangle carries only cancel and capture');
      await page.keyboard.press('Escape');
      assert(!await visible(page,'#snapSel'));
      await page.locator('#snapshot').click();
      await page.locator('#terrainSourceToggle').click();
      assert(!await visible(page,'#snapshotPanel'),'Layers replaces camera');
      assert(await visible(page,'#terrainSourcePanel'));
      await page.locator('#mapModeToggle').click();
      assert(!await visible(page,'#terrainSourcePanel'),'Map view replaces Layers');
      assert(await visible(page,'#mapModeMenu'));
      await page.locator('#quickDraw').click();
      assert(!await visible(page,'#mapModeMenu'),'Markup replaces Map view');
      await page.locator('#mkBar .tool-close').click();
      assert(!await visible(page,'#mkBar'));
      assert.equal(await page.locator('#quickDraw').getAttribute('aria-expanded'),'false');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'quickDraw','Close restores focus');
      assert.equal(await page.locator('#quickDraw').getAttribute('aria-pressed'),'true','closing the window keeps the drawing mode');
      await page.locator('#quickDraw').click();
      assert(await visible(page,'#mkBar'),'the drawing button reopens the controls');
      await page.locator('#mkBar [data-ground-range="width"]').focus();
      await page.keyboard.press('Escape');
      assert(!await visible(page,'#mkBar'),'Escape works while a markup input is focused');
      await page.locator('#quickDraw').click();
      await page.locator('#mkBar [data-act="done"]').click();
      assert.equal(await page.locator('#quickDraw').getAttribute('aria-pressed'),'false','Done ends drawing mode');
      await page.locator('#snapshot').click();
      await page.keyboard.press('Escape');
      assert(!await visible(page,'#snapshotPanel'));
      assert.equal(await page.evaluate(()=>document.activeElement.id),'snapshot');
      await page.locator('#snapshot').click();
      await page.locator('#snapshotClose').click();
      await page.setViewportSize({width:Math.max(320,width-100),height});
      await page.locator('#quickDraw').click();await page.waitForTimeout(250);await inside(page,'#mkBar');
      await page.locator('#mkBar [data-act="done"]').click();
      await page.locator('#snapshot').focus();await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'snapshotScale','keyboard opening focuses camera controls');
      await page.keyboard.press('Escape');
      await page.locator('#quickDraw').focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#mkBar [data-tool="pen"]').evaluate(el=>el===document.activeElement),true,'keyboard opening focuses the selected drawing tool');
      await page.locator('#mkBar [data-act="done"]').click();
      if(width>1050){
        await page.locator('.csp-nav-button[data-route="export"]').click();
        await page.locator('.csp-available-row').filter({hasText:'Export map image'}).click();
        assert(await visible(page,'#snapshotPanel'),'sidebar Export opens the same camera panel');
        await page.locator('#snapshotClose').click();
        await page.locator('.csp-nav-button[data-route="layers"]').click();
        await page.locator('#snapshot').click();
        assert(await visible(page,'#snapshotPanel'),'camera remains available after leaving the Export route');
        assert.equal(await page.locator('#snapshotPanel').count(),1,'there is only one live set of export controls');
      }
      // Appearance: the sidebar footer opens it; a swatch recolours every switch
      // knob and slider fill, and the choice is applied again at boot. Drawing
      // above may have collapsed the sidebar, so reopen it first — route
      // changes below use DOM clicks that bypass visibility.
      await page.evaluate(()=>{if(document.body.classList.contains('collapsed')) document.querySelector('#sideToggle')?.click()});
      await page.waitForTimeout(200);
      const subtitle=await page.evaluate(()=>{const el=document.querySelector('#cspWorkspaceDescription');const header=document.querySelector('#cspWorkspaceHeader');return {text:el.textContent.trim(),visible:!!el.offsetParent,line:getComputedStyle(header).borderBottomWidth}});
      assert(subtitle.text.length>0&&subtitle.line!=='0px','the workspace subtitle and its hairline are present');
      await page.locator('#cspAppearanceNav button').evaluate(el=>el.click());
      assert.equal(await page.evaluate(()=>document.body.dataset.cspRoute),'appearance','the footer item opens Appearance');
      assert.equal(await page.locator('#cspAppearanceCard [data-theme-preset]').count(),5,'Appearance offers theme presets');
      await page.locator('#cspAppearanceCard [data-theme-preset="sunset"]').evaluate(el=>el.click());
      assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim()),'#ff453a','a theme preset recolours buttons');
      await page.locator('#cspSettingsNav button').evaluate(el=>el.click());
      assert.equal(await page.evaluate(()=>document.body.dataset.cspRoute),'settings','the footer item opens Settings');
      assert.equal(await page.locator('[data-open-engine]').count(),1,'Settings carries the terrain engine controls');
      await page.locator('#cspAppearanceNav button').evaluate(el=>el.click());
      await page.locator('#cspAccentPicker [data-accent="#ff9f0a"]').evaluate(el=>el.click());
      await page.waitForTimeout(300);
      const accent=await page.locator('#cspCustomView .csp-switch span').evaluate(el=>({
        on:getComputedStyle(document.documentElement).getPropertyValue('--csp-control-on').trim(),
        knob:getComputedStyle(el,'::after').backgroundColor,
        knobSize:parseFloat(getComputedStyle(el,'::after').height),track:el.getBoundingClientRect().height,
        checked:document.querySelector('#cspAccentPicker [aria-checked="true"]')?.dataset.accent}));
      assert.deepEqual([accent.on,accent.knob,accent.checked],['#ff9f0a','rgb(255, 159, 10)','#ff9f0a'],'a swatch recolours the switches');
      assert(accent.knobSize>accent.track,'the knob is larger than its groove');
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.CSPMarkup?._layers.size===2);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--csp-control-on').trim()),'#ff9f0a','the switch colour is applied at boot');
      await page.locator('#quickDraw').click();
      assert.equal(await page.locator('#mkBar [data-edit-detail="name"]').textContent(),'North rim <A>','metadata and active layer survive reload');
      assert.equal(await page.locator('#mkBar [data-edit-detail="description"]').textContent(),'Research notes\nSecond line');
      const mark=await page.evaluate(id=>{const f=window.CSPMarkup._layers.get(id).doc.features[0];window.CSPMarkup._select(f.properties.fid);return{id:f.properties.fid,width:f.properties.width}},firstId);
      assert(await page.locator('#mkBar [data-act="undo"]').isDisabled(),'a reloaded layer starts with an empty undo history');
      await page.locator('#mkBar [data-ground-range]').evaluate(el=>{for(const value of [300,400,600]){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}el.dispatchEvent(new Event('change',{bubbles:true}))});
      assert(!await page.locator('#mkBar [data-act="undo"]').isDisabled(),'width changes immediately enable Undo');
      const widthAfter=await page.evaluate(([id,fid])=>window.CSPMarkup._layers.get(id).doc.features.find(f=>f.properties.fid===fid).properties.width,[firstId,mark.id]);
      assert.notEqual(widthAfter,mark.width);
      await page.locator('#mkBar [data-act="undo"]').click();
      assert.equal(await page.evaluate(([id,fid])=>window.CSPMarkup._layers.get(id).doc.features.find(f=>f.properties.fid===fid).properties.width,[firstId,mark.id]),mark.width,'one Undo restores a whole slider drag');
      await page.locator('#mkBar [data-act="redo"]').click();
      assert.equal(await page.evaluate(([id,fid])=>window.CSPMarkup._layers.get(id).doc.features.find(f=>f.properties.fid===fid).properties.width,[firstId,mark.id]),widthAfter);
      // With the tools closed, the selected mark carries its own actions on the
      // map. Bring the mark into the open part of the map first; off screen or
      // under the phone sheet the bar correctly stays hidden.
      await page.evaluate(([id,fid])=>{
        const f=window.CSPMarkup._layers.get(id).doc.features.find(x=>x.properties.fid===fid),c=f.geometry.coordinates.flat(2);
        window.ClearSkiesPortalBridge.map.setView([c[1],c[0]],window.ClearSkiesPortalBridge.map.getZoom(),{animate:false});
        window.CSPMarkup._select(fid);
      },[firstId,mark.id]);
      await page.locator('#mkBar .tool-close').click();
      assert(await visible(page,'.mk-selbar'),'a selected mark shows its actions once the tools close');
      await inside(page,'.mk-selbar');
      assert.deepEqual(await page.locator('.mk-selbar [data-sel]').evaluateAll(els=>els.map(el=>el.dataset.sel)),['style','duplicate','delete']);
      const features=()=>page.evaluate(id=>window.CSPMarkup._layers.get(id).doc.features.length,firstId);
      const kept=await features(),query=await page.locator('#q').inputValue();
      await page.locator('.mk-selbar [data-sel="delete"]').click();
      assert.equal(await features(),kept-1,'Delete removes the mark in place');
      assert.equal(await page.locator('#q').inputValue(),query,'the Delete tap does not reach the map underneath');
      assert.equal(await page.locator('.mk-selbar .mk-sel-note').textContent(),'Mark deleted');
      await page.locator('.mk-selbar [data-sel="undo"]').click();
      assert.equal(await features(),kept,'Undo beside it restores the mark');
      await page.evaluate(fid=>window.CSPMarkup._select(fid),mark.id);
      await page.locator('.mk-selbar [data-sel="style"]').click();
      assert(await visible(page,'#mkBar'),'Style opens the tools for the selected mark');
      assert(!await visible(page,'.mk-selbar'),'the panel and the map bar are not shown together');
      assert.deepEqual(errors,[],`${label} has no JavaScript errors`);
      console.log(`PASS ${label}: all tools, visible controls, shared surface, panel switching, capture, focus and resizing`);
      await context.close();
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
