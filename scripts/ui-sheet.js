'use strict';
/* Interaction test for the phone bottom sheet: the peek, medium and large
   detents, tap and drag between them, keyboard control of the grabber, the
   title strip on detail pages, and the landscape card that keeps the old
   hide-and-toggle behaviour. Companion to scripts/ui-stress.js.

     node server.js &
     node scripts/ui-sheet.js [http://127.0.0.1:8765/]

   Needs Playwright (npm i --no-save playwright && npx playwright install
   chromium); it is deliberately not a dependency of the app. */
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('ui-sheet needs Playwright: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }
const base = process.argv[2] || 'http://127.0.0.1:8765/';
(async () => {
  const browser = await chromium.launch();
  const results = []; const ok = (name, cond, info='') => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`);
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>{ if(!/_fadeAnimated/.test(e.message)) errs.push(e.message) });
  await page.goto(base, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2200);
  const st = () => page.evaluate(() => {
    const side=document.getElementById('side'), r=side.getBoundingClientRect(), q=document.getElementById('q').getBoundingClientRect();
    const mm=document.getElementById('cspMapMode').getBoundingClientRect();
    return { h:Math.round(r.height), top:Math.round(r.top), bottom:Math.round(r.bottom), collapsed:document.body.classList.contains('collapsed'),
      detent:document.body.dataset.cspDetent, inert:side.inert, qVisible:q.top>=r.top && q.bottom<=r.bottom+1 && q.height>0,
      toggleShown:getComputedStyle(document.getElementById('sideToggleDock')).display!=='none',
      modeBottom:Math.round(mm.bottom), modeOpacity:getComputedStyle(document.getElementById('cspMapMode')).opacity,
      navHidden:getComputedStyle(document.getElementById('cspNavScroll')).visibility, active:document.activeElement.id,
      label:document.getElementById('cspGrabber').getAttribute('aria-label') };
  });
  let s = await st();
  ok('loads open at medium (unchanged default)', !s.collapsed && s.detent==='medium', JSON.stringify(s));
  await page.tap('#map', {position:{x:200,y:30}}); await page.waitForTimeout(700);
  s = await st();
  ok('tap map collapses to peek', s.collapsed && s.h>=70 && s.h<=90 && s.bottom<=844, JSON.stringify(s));
  ok('peek is usable (not inert), search in view', !s.inert && s.qVisible);
  ok('sidebar toggle hidden on portrait phone', !s.toggleShown);
  ok('rows below strip hidden from AT', s.navHidden==='hidden');
  ok('map mode sits above the peek', s.modeBottom <= s.top - 4 && s.modeOpacity==='1', `mode bottom ${s.modeBottom}, sheet top ${s.top}`);
  ok('grabber says Show panel in peek', s.label==='Show panel');

  await page.tap('#q'); await page.waitForTimeout(700);
  s = await st(); ok('tap search in peek opens large and keeps focus', !s.collapsed && s.detent==='large' && s.active==='q', JSON.stringify(s));
  await page.evaluate(()=>document.activeElement.blur());

  await page.tap('#map', {position:{x:200,y:30}}); await page.waitForTimeout(700);
  s = await st(); ok('tap map returns to peek', s.collapsed && s.h<=90, JSON.stringify(s));

  // drag up from the peek strip (not the grabber): start on the strip's lower part
  let box = await (await page.$('#side')).boundingBox();
  let x = box.x + box.width/2, y = box.y + box.height - 12;
  await page.mouse.move(x,y); await page.mouse.down();
  for (let i=1;i<=12;i++) await page.mouse.move(x, y - i*30);
  await page.mouse.up(); await page.waitForTimeout(700);
  s = await st(); ok('drag up from peek opens', !s.collapsed && (s.detent==='medium'||s.detent==='large'), JSON.stringify(s));

  // drag the grabber down -> peek
  box = await (await page.$('#cspGrabber')).boundingBox(); x=box.x+box.width/2; y=box.y+box.height/2;
  await page.mouse.move(x,y); await page.mouse.down();
  for (let i=1;i<=14;i++) await page.mouse.move(x, y + i*50);
  await page.mouse.up(); await page.waitForTimeout(700);
  s = await st(); ok('drag grabber down lands on peek (not hidden)', s.collapsed && s.h>=70 && s.h<=90 && s.bottom<=844, JSON.stringify(s));

  // small drag up from peek that does not pass the threshold stays in peek
  box = await (await page.$('#side')).boundingBox(); x=box.x+box.width/2; y=box.y+box.height-12;
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x,y-20,{steps:3}); await page.mouse.up(); await page.waitForTimeout(600);
  s = await st(); ok('a small nudge springs back to peek', s.collapsed && s.h<=90, JSON.stringify(s));

  // tap grabber in peek -> medium; tap grabber again -> large
  await page.tap('#cspGrabber'); await page.waitForTimeout(600);
  s = await st(); ok('tap grabber in peek opens medium', !s.collapsed && s.detent==='medium', JSON.stringify(s));
  await page.tap('#cspGrabber'); await page.waitForTimeout(600);
  s = await st(); ok('tap grabber again goes large', !s.collapsed && s.detent==='large', JSON.stringify(s));

  // keyboard
  await page.focus('#cspGrabber');
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500);
  s = await st(); ok('ArrowDown large -> medium', s.detent==='medium' && !s.collapsed);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(600);
  s = await st(); ok('ArrowDown medium -> peek', s.collapsed);
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(600);
  s = await st(); ok('ArrowUp peek -> medium', !s.collapsed && s.detent==='medium');

  // detail page peek shows the title
  await page.click('.csp-nav-button[data-route="terrain"]'); await page.waitForTimeout(500);
  await page.tap('#map', {position:{x:200,y:30}}); await page.waitForTimeout(700);
  const title = await page.evaluate(()=>{const t=document.getElementById('cspWorkspaceTitle').getBoundingClientRect(), r=document.getElementById('side').getBoundingClientRect(); return {inside:t.top>=r.top&&t.bottom<=r.bottom+1, text:document.getElementById('cspWorkspaceTitle').textContent}});
  ok('detail page peek shows its title', title.inside, JSON.stringify(title));
  await ctx.close();

  // landscape keeps the card + toggle
  const ctx2 = await browser.newContext({ viewport:{width:844,height:390}, isMobile:true, hasTouch:true });
  const p2 = await ctx2.newPage(); await p2.goto(base, { waitUntil:'domcontentloaded' }); await p2.waitForTimeout(2000);
  const l = await p2.evaluate(()=>({toggle:getComputedStyle(document.getElementById('sideToggleDock')).display, grab:getComputedStyle(document.getElementById('cspGrabber')).display}));
  ok('wide landscape phone keeps the toggle, no grabber', l.toggle!=='none' && l.grab==='none', JSON.stringify(l));
  await ctx2.close();
  const ctx3 = await browser.newContext({ viewport:{width:667,height:375}, isMobile:true, hasTouch:true });
  const p3 = await ctx3.newPage(); await p3.goto(base, { waitUntil:'domcontentloaded' }); await p3.waitForTimeout(2000);
  await p3.evaluate(()=>document.getElementById('sideToggle').click()); await p3.waitForTimeout(600);
  const l3 = await p3.evaluate(()=>{const side=document.getElementById('side');return {collapsed:document.body.classList.contains('collapsed'), vis:getComputedStyle(side).visibility, inert:side.inert, toggle:getComputedStyle(document.getElementById('sideToggleDock')).display}});
  ok('small landscape phone: collapsed card hidden and inert, toggle shown', l3.collapsed && l3.vis==='hidden' && l3.inert && l3.toggle!=='none', JSON.stringify(l3));
  await ctx3.close();

  console.log(results.join('\n')); console.log(errs.length ? 'page errors: '+errs.join(' | ') : 'no page errors');
  await browser.close();
  process.exitCode = results.some(r => r.startsWith('FAIL')) || errs.length ? 1 : 0;
})();
