/* CR-003 r1: run in the real browser or Debug WKWebView. This leaves the
   fixture selected so Apple's share sheet can be verified with a real tap.
   The raster is synthetic verification data, not a scientific reference. */
return (async () => {
  const B = window.ClearSkiesPortalBridge, C = window.CSPShareState, R = window.CSPLidarRender;
  const failures = [], reports = [], originalAlert = window.alert;
  const canonical = value => !value || typeof value !== "object" ? value : Array.isArray(value)
    ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  const same = (a, b) => JSON.stringify(canonical(C.pack(a))) === JSON.stringify(canonical(C.pack(b)));
  const check = (condition, message) => { if (!condition) failures.push(message); };
  window.alert = message => reports.push(message);
  try {
    // The ready event precedes optional GPU initialization by one frame.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await B.restoreSession({center:[47.66,-117.4], zoom:12, mode:"2d",
      location:{lat:47.66,lng:-117.4,label:"Spokane ⛰️"}});
    const state = B.captureShareState(), width = 25, height = 21;
    Object.assign(state.controls, {terStyle:"slope",terSrc:"auto",terOp:"58",
      terContrast:"123",terSaturation:"75",terBrightness:"97",elevSh:true,elevAlpha:"49",fire:false});
    state.view.bearing = 32;
    state.terrainLook = {contrast:123,saturation:75,brightness:97};
    state.studio.state.base.slope = R.normalizeLayer({...R.defaultLayer("slope"),palette:"magma"}, "slope");
    state.studio.state.look = R.matchLook(state.studio.state,"slope");
    state.overlays = [{id:"places",opacity:37,lineWidth:null,timeSlice:null}];
    Object.assign(state.alerts, {nws:false,quakes:false,volcanoes:false,fires:false});
    state.imagery = null; state.pointCloud = null;
    state.markup = [{doc:{type:"FeatureCollection",markup:{id:"share-fixture",name:"Share roundtrip fixture",
      color:"#ff2d55",created:1,updated:1},features:[{type:"Feature",id:"fixture-circle",
      geometry:{type:"Point",coordinates:[-117.4,47.66]},
      properties:{kind:"circle",radius:50,width:2,color:"#ff2d55",fill:.2}}]},opacity:67,rank:1}];
    const grid = Float32Array.from({length:width*height}, (_,i) =>
      150 + .3 * (i%width-12)**2 + .04 * (Math.floor(i/width)-10));
    grid[3] = NaN;
    // The page runs analysis in research-worker.js, so the fixture does too.
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker("research-worker.js");
      worker.onmessage = ({data:{id, ok, error, ...output}}) => { worker.terminate(); ok ? resolve(output) : reject(Error(error)); };
      worker.postMessage({id:1, product:"curvature", scale:"fine", grid:grid.slice(), width, height, resolution:2});
    });
    const bounds = [-117.405,47.655,-117.395,47.665];
    state.research = {live:false,layers:[{id:"a101",product:"curvature",params:{scale:"fine"},
      style:{palette:"standard",blend:"multiply",opacity:.64,relief:0,reverse:true,visible:true},
      last:{result,engine:"browser worker",bounds,capture:{elevation:grid,width,height,resolution:2,hillshade:null,
        raster:{grid:null,width,height,resolution:2,bounds,z:12,factor:1,
          provenance:["Synthetic share-roundtrip fixture"],provisional:false}}}}]};
    state.order = ["markup:share-fixture","analysis:a101","terrain","elevation-spectrum","overlay:places","basemap"];
    const restored = await B.restoreShareState(await C.decode(await C.encode(state)));
    const current = B.captureShareState();
    const differences = Object.keys(state).filter(key=>!same(state[key],current[key]));
    check(restored.complete, "Fixture restoration was incomplete: " + restored.warnings.join(" "));
    check(same(state,current), "Restoration changed included display state");
    check(Number.isNaN(current.research.layers[0].last.capture.elevation[3]), "Nodata changed");
    const url = await B.shareURL(), decoded = await C.decode(new URL(url).hash.slice(5));
    check(same(decoded,current), "The share URL changed included state");
    for (const change of [s=>s.version=9,s=>s.controls.terOp="999",s=>s.order.push("unsupported-layer")]) {
      const bad = await C.decode(await C.encode(current)); change(bad);
      let rejected = false;
      try { await B.restoreShareState(bad); } catch (_) { rejected = true; }
      check(rejected && same(current,B.captureShareState()), "Invalid state mutated the map");
    }
    check(reports.length===0, "Unexpected restoration warning");
    return {passed:failures.length===0,failures,differences,
      changedControls:Object.keys(state.controls).filter(key=>state.controls[key]!==current.controls[key])
        .map(key=>({key,before:state.controls[key],after:current.controls[key]})),
      studioDifference:differences.includes("studio")?{before:state.studio,after:current.studio}:null,
      build:window.CSP_BUILD,url,urlLength:url.length,
      layers:B.activeLayers().map(layer=>({id:layer.id,opacity:layer.opacity,visible:layer.visible})),
      restored,nodataPreserved:true};
  } catch (error) {
    return {passed:false,failures:[...failures,error.message],reports};
  } finally {
    window.alert = originalAlert;
  }
})();
