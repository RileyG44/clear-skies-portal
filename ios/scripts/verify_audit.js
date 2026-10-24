// App-scoped integration checks for the Opus audit repairs. Values/preferences
// are restored. This does not tap the Photos permission prompt or save a photo.
const failures = [], checks = [], diagnostics = {};
const assert = (condition, text) => { if (!condition) failures.push(text); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const S = CSPNativeShell, route = CSPShell.current();
const storageKeys = ['clearskies.terrain.v2', 'clearskies.appearance.v1', 'clearskies.controlAccent.v1', 'clearskies.workspace.v1'];
const saved = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
const colors = ['elevLowColor', 'elevMidColor', 'elevHighColor', 'elevBelowColor', 'elevAboveColor']
  .map(id => document.getElementById(id)).filter(Boolean);
const originalColors = colors.map(input => input.value);
const originalTerrainStyle = document.querySelector("#terStyle").value;
const originalStyle = document.documentElement.getAttribute('style');
const input = (selector, value) => {
  const el = document.querySelector(selector);
  if (!el) { failures.push(`Missing appearance input ${selector}`); return; }
  el.value = value; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}));
};
const originalAppearance = JSON.parse(saved['clearskies.appearance.v1'] || '{}');
try {
  const configuration = await window.webkit.messageHandlers.cspNative.postMessage({type:'debug.configuration'});
  assert(configuration.photosAddUsage.includes('Save Image'), 'Shipped Photos add-only description is missing');
  assert(configuration.interFont === 'Inter-Regular', 'Native Inter font is not registered');
  checks.push('Shipped Photos add-only description and native Inter registration');
  await wait(2500);
  for (const color of colors) S.act('#' + color.id, 'commit', '#123456');
  await wait(200);
  const preferences = JSON.parse(localStorage.getItem('clearskies.terrain.v2') || '{}');
  assert(preferences.elevationSpectrumColors?.every(value => value === '#123456'), 'Spectrum colors were not persisted');
  assert(JSON.stringify(preferences.elevationBands).includes('#123456'), 'Band colors were not persisted');
  checks.push('Native color commit persists spectrum and threshold colors');

  S.open("appearance"); await wait(2500); S.describe();
  input('[data-accent-custom]', '#123456'); input('[data-color-custom="track"]', '#654321');
  input('[data-color-custom="button"]', '#112233'); input('[data-font-color]', '#334455');
  input('[data-font-select]', 'inter');
  document.querySelector('[data-text-size="1.12"]')?.click();
  S.act('#terStyle','select','hs');
  S.open("terrain"); S.setView({sheet:"large",page:"terrain",panel:null});
  await wait(2500);
  const page = S.describe(), looks = [];
  const walk = items => { for (const item of items || []) { if (item.kind === 'looks') looks.push(...item.options); walk(item.items); } };
  walk(page.items);
  diagnostics.page = {route:page.route,items:page.items.length,looks:looks.length,first:looks[0]};
  assert(looks.length >= 11 && looks.every(look => look.src?.startsWith('csp-image:')), 'Look previews are still embedded in page updates');
  const styled = await window.webkit.messageHandlers.cspNative.postMessage({type:'debug.configuration'});
  diagnostics.native = styled;
  assert(styled.sliders.length > 0, 'No actual native slider was presented');
  assert(styled.sliders.every(slider => slider.fill === '#123456' && slider.track === '#654321'), 'Native slider colors disagree with Appearance controls');
  assert(styled.sliders.every(slider => slider.height >= 44), 'Native sliders have undersized hit targets');
  checks.push('Preview references and actual native slider fill/track colors');
  S.open("layers"); await wait(1500);
  const layerSliders = await window.webkit.messageHandlers.cspNative.postMessage({type:'debug.configuration'});
  diagnostics.layerSliders = layerSliders.sliders;
  assert(layerSliders.sliders.length > 0, 'No native layer opacity slider was presented');
  assert(layerSliders.sliders.every(slider => slider.fill === '#123456' && slider.track === '#654321' && slider.height >= 44), 'Layer opacity sliders do not mirror Appearance or hit target size');
  checks.push('Layer opacity sliders mirror Appearance colors and 44-point targets');
} catch (error) { failures.push(error.stack || String(error)); }
finally {
  S.act('#terStyle','select',originalTerrainStyle);
  colors.forEach((input, index) => S.act('#' + input.id, 'commit', originalColors[index]));
  S.open("appearance"); await wait(1200); document.querySelector('[data-appearance-reset]')?.click();
  const old = originalAppearance;
  if (old.toggle || saved['clearskies.controlAccent.v1']) input('[data-accent-custom]', old.toggle || saved['clearskies.controlAccent.v1']);
  for (const key of ['track','button','locationDot']) if (old[key]) input(`[data-color-custom="${key}"]`, old[key]);
  if (old.fontColor) input('[data-font-color]', old.fontColor);
  input('[data-font-select]', old.font || 'system');
  document.querySelector(`[data-text-size="${old.textSize || 1}"]`)?.click();
  if (originalStyle === null) document.documentElement.removeAttribute('style'); else document.documentElement.setAttribute('style', originalStyle);
  S.open(route);
  for (const [key,value] of Object.entries(saved)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key,value); }
}
return {passed:!failures.length,build:globalThis.CSP_BUILD,checks,failures,diagnostics};
