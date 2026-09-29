'use strict';
/* Stress test for the sidebar search row and coordinate shortcuts.

   Drives a running portal through phone, landscape, tablet, iPad and desktop
   sizes (and the resizable desktop rail at its limits, and dark) with an empty
   field, a long query and a selected point, and checks the geometry that used
   to break: locate and search on one row with the field, the go button inside
   the field, the three shortcuts on one row, 44px targets and 16px text on
   touch, nothing past the panel edge, no sideways scrolling. A crop of every
   case is written for a visual pass.

     node server.js &
     node scripts/ui-stress.js [http://127.0.0.1:8765/] [output-dir]

   Needs Playwright (npm i --no-save playwright && npx playwright install
   chromium); it is deliberately not a dependency of the app. */
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('ui-stress needs Playwright: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = path.resolve(process.argv[3] || '.ui-stress'); fs.mkdirSync(OUT, { recursive: true });
const query = '';

const viewports = [
  ['320x568', 320, 568, 'phone'], ['360x740', 360, 740, 'phone'], ['375x667', 375, 667, 'phone'],
  ['390x844', 390, 844, 'phone'], ['430x932', 430, 932, 'phone'], ['568x320-land', 568, 320, 'phone'], ['667x375-land', 667, 375, 'phone'], ['844x390-land', 844, 390, 'phone'], ['932x430-land', 932, 430, 'phone'],
  ['700x900', 700, 900, 'phone'], ['761x1000', 761, 1000, 'tablet'], ['820x1180-ipad', 820, 1180, 'tablet'],
  ['1024x768', 1024, 768, 'tablet'], ['1050x800', 1050, 800, 'tablet'], ['1051x800', 1051, 800, 'desktop'],
  ['1180x820-ipad-land', 1180, 820, 'desktop-touch'], ['1280x800', 1280, 800, 'desktop'],
  ['1440x900', 1440, 900, 'desktop'], ['1920x1080', 1920, 1080, 'desktop'], ['2560x1440', 2560, 1440, 'desktop'],
];
const states = ['empty', 'long', 'point'];

function measure() {
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, vis: cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0 && b.width > 0 }; };
  const $ = s => document.querySelector(s);
  const nav = $('#cspNav'), q = $('#q'), go = $('#go'), loc = $('#loc'), ca = $('.csp-coordinate-actions');
  const btns = [...ca.querySelectorAll('button')].filter(b => !b.hidden).map(b => ({ ...r(b), label: getComputedStyle(b.querySelector('span')).display !== 'none', overflow: b.scrollWidth > b.clientWidth + 1 }));
  return { nav: r(nav), q: r(q), go: r(go), loc: r(loc), iw: r($('#iw')), ca: ca.hidden ? null : r(ca), btns,
    navOverflow: nav.scrollWidth > nav.clientWidth + 1, docOverflow: document.documentElement.scrollWidth > innerWidth,
    font: getComputedStyle(q).fontFamily, qFont: parseFloat(getComputedStyle(q).fontSize),
    interLoaded: [...document.fonts].some(f => f.family.includes('Inter') && f.status === 'loaded'),
    view: document.body.dataset.cspView, collapsed: document.body.classList.contains('collapsed') };
}

function check(m, kind, state) {
  const f = [];
  const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
  if (!m.q.vis) f.push('search field not visible');
  if (!m.loc.vis) f.push('locate not visible');
  // one row: field and locate share a vertical centre
  if (!near((m.q.t + m.q.b) / 2, (m.loc.t + m.loc.b) / 2)) f.push(`locate off the field's row (field ${m.q.t.toFixed(0)}, locate ${m.loc.t.toFixed(0)})`);
  if (m.loc.l < m.q.r - 0.5) f.push('locate overlaps the field');
  if (m.loc.r > m.nav.r - 4) f.push(`locate runs past the panel (${m.loc.r.toFixed(0)} > ${m.nav.r.toFixed(0)})`);
  if (m.q.l < m.nav.l + 4) f.push('field runs past the panel');
  if (m.q.w < 120) f.push(`field too narrow (${m.q.w.toFixed(0)}px)`);
  if (state === 'empty' && m.go.vis) f.push('go shown with an empty field');
  if (state !== 'empty') {
    if (!m.go.vis) f.push('go hidden with text in the field');
    if (!(m.go.l >= m.q.l && m.go.r <= m.q.r + 0.5 && m.go.t >= m.q.t - 0.5 && m.go.b <= m.q.b + 0.5)) f.push('go not inside the field');
  }
  const touch = kind !== 'desktop';
  const minTarget = touch ? 44 : 30;
  if (m.loc.h < (touch ? 44 : 32)) f.push(`locate target ${m.loc.h}px`);
  if (touch && m.qFont < 16) f.push(`field font ${m.qFont}px would zoom iOS`);
  if (state === 'point') {
    if (!m.ca) f.push('coordinate actions missing after a point');
    else {
      if (m.btns.length !== 3) f.push(`${m.btns.length} coordinate buttons`);
      const tops = new Set(m.btns.map(b => Math.round(b.t)));
      if (tops.size > 1) f.push('coordinate buttons on more than one row');
      if (m.ca.t < m.q.b) f.push('coordinate row overlaps the search row');
      for (const b of m.btns) {
        if (b.r > m.nav.r - 4 || b.l < m.nav.l + 4) f.push('coordinate button past the panel');
        if (b.overflow) f.push('coordinate label overflows');
        if (b.h < (touch ? 40 : 28)) f.push(`coordinate target ${b.h}px`);
      }
    }
  }
  if (m.navOverflow) f.push('panel scrolls sideways');
  if (m.docOverflow) f.push('page scrolls sideways');
  return f;
}

(async () => {
  const browser = await chromium.launch();
  const rows = []; let fails = 0;
  const cases = [];
  for (const [name, w, h, kind] of viewports) for (const state of states) cases.push({ name, w, h, kind, state });
  // extra: dark, and the desktop rail resized to its limits
  cases.push({ name: '1440x900-dark', w: 1440, h: 900, kind: 'desktop', state: 'point', dark: true });
  cases.push({ name: '390x844-dark', w: 390, h: 844, kind: 'phone', state: 'point', dark: true });
  cases.push({ name: '1280x800-side520', w: 1280, h: 800, kind: 'desktop', state: 'point', side: 520 });
  cases.push({ name: '1920x1080-side880', w: 1920, h: 1080, kind: 'desktop', state: 'point', side: 880 });
  for (const c of cases) {
    const touch = c.kind !== 'desktop';
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, isMobile: c.kind === 'phone', hasTouch: touch, colorScheme: c.dark ? 'dark' : 'light' });
    const page = await ctx.newPage();
    /* A Leaflet race when a basemap provider fails (the tile loader's error
       handler can remove the layer mid-callback) is unrelated to this layout
       and fires whenever tile hosts are unreachable, so it is not counted. */
    const errs = []; page.on('pageerror', e => { if (!/_fadeAnimated/.test(e.message)) errs.push(e.message); });
    await page.goto(base + query, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    if (c.dark && await page.evaluate(() => document.documentElement.dataset.uiTheme) !== 'dark') { await page.click('#mapTheme'); await page.waitForTimeout(300); }
    if (await page.evaluate(() => document.body.classList.contains('collapsed'))) { await page.click('#sideToggle'); await page.waitForTimeout(500); }
    if (c.kind !== 'desktop' && c.kind !== 'desktop-touch' && await page.evaluate(() => document.body.dataset.cspView === 'detail')) { await page.click('#cspBack'); await page.waitForTimeout(300); }
    if (c.side) { await page.evaluate(w => { document.documentElement.style.setProperty('--side-w', w + 'px'); document.getElementById('side').style.width = w + 'px'; }, c.side); }
    if (c.state === 'long') await page.fill('#q', 'Mount Rainier National Park Paradise Visitor Center, Washington, United States');
    if (c.state === 'point') {
      // a map click is what ordinarily populates the point; clicking beside the open phone sheet closes it, so use the coordinate search the app also accepts
      await page.fill('#q', '46.853, -121.76');
      await page.press('#q', 'Enter');
      await page.waitForTimeout(900);
      if (await page.evaluate(() => document.body.classList.contains('collapsed'))) { await page.click('#sideToggle'); await page.waitForTimeout(500); }
      if (await page.evaluate(() => document.body.dataset.cspView === 'detail' && getComputedStyle(document.getElementById('cspBack')).display !== 'none')) { await page.click('#cspBack'); await page.waitForTimeout(300); }
    }
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(350);
    const m = await page.evaluate(measure);
    const f = check(m, c.kind, c.state);
    if (errs.length) f.push('page error: ' + errs[0]);
    fails += f.length ? 1 : 0;
    const label = `${c.name}${c.state === 'point' || c.name.includes('-dark') || c.side ? '' : ''} ${c.state}`;
    rows.push(`${f.length ? 'FAIL' : 'ok  '}  ${label.padEnd(34)} field ${m.q.w.toFixed(0).padStart(4)}x${m.q.h.toFixed(0)}  locate ${m.loc.w.toFixed(0)}  coord ${m.btns.length ? m.btns.map(b => b.w.toFixed(0) + (b.label ? 'L' : 'i')).join('/') : '-'}  ${f.join('; ')}`);
    const clipTop = Math.max(0, m.q.t - 14), clipBottom = (m.ca ? m.ca.b : m.q.b) + 12;
    await page.screenshot({ path: `${OUT}/${c.name}-${c.state}.png`, clip: { x: Math.max(0, m.nav.l), y: clipTop, width: Math.min(m.nav.w, c.w - Math.max(0, m.nav.l)), height: Math.max(20, clipBottom - clipTop) } });
    await ctx.close();
  }
  console.log(rows.join('\n'));
  console.log(`\n${cases.length} cases, ${fails} failing; crops in ${OUT}`);
  await browser.close();
  process.exitCode = fails ? 1 : 0;
})();
