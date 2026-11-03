/* Debug-app integration probe: verifies the native menu's live controls,
   placement, scientific metadata and exact-value edits without downloads or exports. */
return (async () => {
  const S = CSPNativeShell, failures = [], pages = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) failures.push(message); };
  const flatten = items => (items || []).flatMap(item => [item, ...flatten(item.items)]);
  const refs = value => {
    const found = [];
    const visit = v => {
      if (!v || typeof v !== 'object') return;
      if (v.kind !== 'sun' && typeof v.ref === 'string' && /^[#@]/.test(v.ref)) found.push(v.ref);
      for (const key of ['eye','rename','remove']) if (typeof v[key] === 'string' && /^[#@]/.test(v[key])) found.push(v[key]);
      Object.values(v).filter(v => v && typeof v === 'object').forEach(v => Array.isArray(v) ? v.forEach(visit) : visit(v));
    };
    visit(value); return found;
  };
  const visible = el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const originalRoute = CSPShell.current(), originalSession = ClearSkiesPortalBridge.sessionState();
  const originalValues = Object.fromEntries(['terOp','terSunAz','terSunAlt','elevSpan','snapshotScale'].map(id => [id,document.getElementById(id).value]));
  const groups = S.groups(), routes = groups.flatMap(group => group.routes);
  check(routes.length === 13 && new Set(routes.map(r => r.key)).size === 13, 'All 13 tools must remain reachable exactly once');
  check(routes.every(r => r.title && r.description && !/browser/i.test(r.description)), 'Native route titles and purpose subtitles must describe the app');
  try {
    for (const {key: route} of routes) {
      S.open(route); S.setView({sheet:'large',page:route,panel:null}); await wait(150);
      const page = S.describe(), rows = flatten(page.items), represented = refs(page);
      check(page.route === route && rows.length > 0, route + ': missing page');
      const repeated = represented.filter((ref,index) => represented.indexOf(ref) !== index);
      check(!repeated.length, route + ': duplicate controls ' + repeated.join(', '));
      if (!['export','settings'].includes(route)) {
        for (const el of document.querySelectorAll('#cspWorkspaceScroll input:not([type=hidden]),#cspWorkspaceScroll select,#cspWorkspaceScroll textarea,#cspWorkspaceScroll button')) {
          if (!visible(el) || el.closest('.ls-preset-navigation') || el.closest('summary') || el.matches('.csp-layer-handle,.csp-sat-center')) continue;
          const ref = el.id ? '#' + el.id : '@' + el.getAttribute('data-cspn');
          check(represented.includes(ref), route + ': missing live control ' + ref + ' (' + el.tagName + '.' + el.className + ': ' + el.textContent.trim().slice(0,80) + ')');
        }
      }
      // Exercise actual label.ovrow markup, not a synthetic provenance item.
      for (const el of document.querySelectorAll('#cspWorkspaceScroll .ovrow')) {
        if (!visible(el)) continue;
        const input = el.querySelector('input'), name = el.querySelector('.nm')?.textContent.trim();
        const provider = el.querySelector('.via')?.textContent.trim();
        const toggle = rows.find(item => item.ref === '#' + input?.id);
        check(toggle?.title === name, route + ': provider leaked into layer name ' + name);
        if (provider) check(flatten(page.items.at(-1)?.items).some(item => item.title === name && item.detail === provider), route + ': source disclosure lost ' + name + ' / ' + provider);
      }
      if (route === 'terrain') {
        check(page.title === 'Terrain & LiDAR', 'Overview terrain must not be presented as LiDAR alone');
        for (const ref of ['#terStyle','#terSrc','#terOp','#terSunAz','#terSunAlt','#terAmbient','#terExaggeration','#terWarm','#dnrSelect','#dnrViewport','#terrainInspectSource','#terReset'])
          check(represented.includes(ref), 'terrain: missing ' + ref);
        const sources = rows.find(item => item.ref === 'terrain:provenance');
        check(refs(sources).includes('#terrainInspectSource'), 'Survey inspection belongs in Sources & scale');
        check(!refs(rows.find(item => item.ref === 'terrain:downloads')).includes('#terrainInspectSource'), 'Sources must not be mixed into downloads');
        check(rows.find(item => item.ref === 'terrain:lighting')?.kind === 'disclosure', 'Lighting needs a named submenu');
      }
      if (route === 'elevation') {
        check(rows.find(item => item.ref === '#elevSpectrumReset')?.title === 'Reset spectrum', 'Spectrum reset scope is unclear');
        check(rows.find(item => item.ref === '#elevBandsReset')?.title === 'Reset highlights', 'Highlight reset scope is unclear');
        check(rows.find(item => item.ref === 'elevation:palette')?.kind === 'disclosure', 'Spectrum colors should stay with spectrum settings');
      }
      if (route === 'export') {
        for (const ref of ['#snapshotScale','#snapshotReadout','#snapshotCapture','#snapshotSelect']) check(represented.includes(ref),'Export image missing '+ref);
        check(!represented.includes('#terWarm'), 'Image export must not launch a terrain download');
      }
      if (route === 'settings') {
        check(!rows.some(item => item.title === 'Default export resolution' || item.title === 'Map info in exports'), 'Settings duplicates image export controls');
        check(rows.some(item => item.kind === 'route' && item.id === 'export'), 'Settings needs a link to the shared image export editor');
        check(rows.at(-1)?.title !== 'Map sources', 'Credits should be in the final Sources & scale disclosure');
      }
      pages.push({route,title:page.title,items:page.items,controls:represented.length});
    }
    S.open('terrain'); S.setView({sheet:'large',page:'terrain',panel:null});
    S.act('#terOp','commit',43); S.act('#terSunAz','commit',72); S.act('#terSunAlt','commit',31); await wait(150);
    const terrain = flatten(S.describe().items), sun = terrain.find(item => item.kind === 'sun');
    check(terrain.find(item => item.ref === '#terOp')?.value === 43,'Terrain opacity no longer edits the live input');
    check(sun?.azimuth?.value === 72 && sun?.altitude?.value === 31,'Sun controls lost their source inputs');
    S.open('elevation'); S.setView({sheet:'large',page:'elevation',panel:null}); S.act('#elevSpan','commit',1200); await wait(150);
    check(document.getElementById('elevSpan').value === '1200','Exact elevation span was lost');
    S.open('export'); S.setView({sheet:'large',page:'export',panel:null}); S.act('#snapshotScale','select','2'); await wait(100);
    check(flatten(S.describe().items).find(item => item.ref === '#snapshotScale')?.value === '2','Export resolution lost live state');
  } catch (error) { failures.push(error.stack || String(error)); }
  finally {
    for (const [id,value] of Object.entries(originalValues)) S.act('#'+id,document.getElementById(id).matches('select')?'select':'commit',value);
    await ClearSkiesPortalBridge.restoreSession(originalSession);
    S.open(originalRoute); S.setView({sheet:'large',page:originalRoute,panel:null});
  }
  return {passed:!failures.length,failures,groups,pages};
})();
