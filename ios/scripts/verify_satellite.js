/* Live provider / real WKWebView check, run with verify_shell_on_device.py
   --probe ios/scripts/verify_satellite.js. Does not capture the phone screen. */
return (async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = predicate(); if (value) return value; await wait(100); }
    throw new Error("Timed out: " + predicate.toString());
  };
  const shell = await until(() => window.CSPNativeShell);
  const bridge = window.ClearSkiesPortalBridge, map = bridge.map;
  const original = { route: window.CSPShell.current(), center: map.getCenter(), zoom: map.getZoom() };
  const preferenceKey = "clearskies.search.v1", savedPreferences = localStorage.getItem(preferenceKey);
  const failures = [], scenes = [], disclosures = [];
  let stage = "touch and disclosures";
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const sceneGroup = () => shell.describe().items.find(item => item.pane && item.title === "Satellite scenes");
  const saved = ["days", "cloud", "vis", "viewable"].map(id => {
    const el = document.getElementById(id); return { el, value: el.value, checked: el.checked };
  });
  const observe = event => {
    const layer = event.layer;
    if (/titiler\.xyz|planetarycomputer\.microsoft\.com/.test(layer._url || "")) scenes.push(layer);
  };
  const rendered = layer => Object.values(layer?._tiles || {}).filter(tile => tile.current && tile.loaded && tile.el.naturalWidth >= 256);
  const evidence = layer => ({
    zoom: map.getZoom(), tileZoom: layer._tileZoom, nativeMax: layer.options.maxNativeZoom,
    opacity: layer.options.opacity, loaded: rendered(layer).length,
    pixels: [...new Set(rendered(layer).map(tile => tile.el.naturalWidth))],
    tileURL: rendered(layer)[0]?.el.src || layer._url,
    health: { ...layer._cspHealth }
  });
  try {
    const mapStyle = getComputedStyle(map.getContainer()), fieldStyle = getComputedStyle(document.getElementById("q"));
    check(mapStyle.webkitUserSelect === "none", "Map permits document text selection");
    check(mapStyle.webkitTouchCallout === "none", "Map permits the WebKit copy callout");
    check(fieldStyle.webkitUserSelect === "text", "Editable fields lost text selection");

    shell.open("satellite"); shell.setView({ sheet: "medium", page: "satellite", panel: null });
    if (!sceneGroup()?.open) shell.act(sceneGroup()?.ref, "open", true);
    for (const open of [false, true, false, true]) {
      shell.act(sceneGroup()?.ref, "open", open);
      const group = sceneGroup();
      disclosures.push({ requested: open, actual: group?.open });
      check(group?.open === open, "Satellite scenes failed to " + (open ? "reopen" : "collapse"));
    }

    stage = "catalog search";
    document.getElementById("days").value = "365";
    document.getElementById("cloud").value = "101";
    document.getElementById("vis").value = "rgb";
    document.getElementById("viewable").checked = true;
    map.setView([46.8523, -121.7603], 12, { animate: false });
    map.on("layeradd", observe);
    // The map gesture searches without choosing a source/date for the user.
    map.fire("dblclick", { latlng: map.getCenter() });
    await until(() => document.querySelector("#results .item") && !/Querying|…/.test(document.getElementById("status").textContent), 45000);
    stage = "finding AWS scene";
    check(!document.getElementById("mosaic").checked, "A new search should start with Auto Fill disabled");
    let inAWS = false;
    const candidates = [];
    for (const el of document.getElementById("results").children) {
      if (el.matches(".grp")) inAWS = el.textContent.includes("AWS Earth Search");
      else if (inAWS && el.matches(".item") && el.querySelector(".ttl")?.textContent.includes("Sentinel-2")) candidates.push(el);
    }
    const selected = candidates.find(el => /0% cloud/.test(el.textContent)) || candidates[0];
    if (!selected) throw new Error("No live AWS Sentinel-2 result was available");
    const acquisition = selected.querySelector(".dt").textContent.trim();
    stage = "scene application";
    selected.click();
    const primary = await until(() => scenes.find(layer => map.hasLayer(layer) && layer.options.opacity > 0 && rendered(layer).length > 0));
    const initial = evidence(primary);
    check(initial.pixels.includes(512), "Selected scene did not decode 512px imagery");
    check(initial.tileURL.includes("tilesize=512") && !initial.tileURL.includes("@2x"), "AWS scene used the obsolete retina endpoint");
    check(!document.getElementById("mosaic").checked, "Scene application required Auto Fill");

    stage = "displayed-scene panel";
    for (let repeat = 0; repeat < 2; repeat++) {
      shell.closePanel("ctl");
      check(document.getElementById("ctl").hidden, "Displayed-scene panel did not close");
      shell.tool("mapInfoToggle");
      check(!document.getElementById("ctl").hidden && !!shell.describePanel("ctl"), "Displayed-scene panel did not reopen");
    }
    shell.closePanel("ctl");
    shell.setView({ sheet: "closed", page: null, panel: null });
    stage = "zoom refinement";
    map.setZoom(14, { animate: false });
    await until(() => primary._tileZoom === 14 && !primary._cspHealth.pending &&
      rendered(primary).some(tile => tile.coords.z === 14 && tile.el.naturalWidth === 512));
    const refined = evidence(primary);
    check(refined.tileZoom > initial.tileZoom, "Zoom did not request finer scene tiles");
    check(map.hasLayer(primary) && primary.options.opacity > 0, "Zoom lost the selected dated scene");

    stage = "Auto Fill context and refinement";
    document.getElementById("mosaic").click();
    map.setZoom(8, { animate: false });
    const context = await until(() => Object.values(map._layers).find(layer =>
      layer.options?.className === "mosaic-context" && layer.options.opacity > 0 && rendered(layer).length), 20000);
    const overview = evidence(context);
    map.setZoom(14, { animate: false });
    await until(() => primary._tileZoom === 14 && !primary._cspHealth.pending && rendered(primary).length);
    const autoFill = { enabled: document.getElementById("mosaic").checked, overview, detail: evidence(primary) };
    check(autoFill.enabled && primary.options.zIndex > context.options.zIndex,
      "Auto Fill context obscures the higher-resolution selected scene");
    return { passed: failures.length === 0, failures, build: window.CSP_BUILD, acquisition, disclosures, initial, refined, autoFill };
  } catch (error) {
    return { passed: false, failures: [...failures, String(error) + " " + String(error.stack || "")], stage, disclosures,
      status: document.getElementById("status")?.textContent, sceneName: document.getElementById("ctlName")?.textContent,
      groups: [...document.querySelectorAll("#results .grp")].map(el => el.textContent),
      results: document.querySelectorAll("#results .item").length,
      filters: saved.map(({el}) => ({id:el.id, value:el.value, checked:el.checked})),
      center: map.getCenter(), scenes: scenes.map(evidence) };
  } finally {
    map.off("layeradd", observe);
    document.getElementById("clr").click();
    for (const { el, value, checked } of saved) { el.value = value; el.checked = checked; }
    if (savedPreferences === null) localStorage.removeItem(preferenceKey);
    else localStorage.setItem(preferenceKey, savedPreferences);
    map.setView(original.center, original.zoom, { animate: false });
    shell.open(original.route); shell.setView({ sheet: "closed", page: null, panel: null });
  }
})();
