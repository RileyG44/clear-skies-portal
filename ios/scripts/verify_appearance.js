// Installed Debug app integration check. Native trait readback is excluded
// from Release. --page / --panel on the runner also exercise presented sheets.
const failures = [], checks = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const themeButton = document.querySelector('#mapTheme');
const original = document.documentElement.dataset.uiTheme;
const key = 'clearskies.mapTheme.v1', saved = localStorage.getItem(key);
const native = () => window.webkit.messageHandlers.cspNative.postMessage({ type: 'debug.appearance' });
const assert = (condition, message) => { if (!condition) failures.push(message); };
try {
  for (const theme of [original === 'dark' ? 'light' : 'dark', original]) {
    if (document.documentElement.dataset.uiTheme !== theme) CSPNativeShell.tool('mapTheme');
    let traits;
    for (let i = 0; i < 60; i++) {
      await wait(50); traits = await native();
      if (traits.hasWindow && (!traits.expectsSheet || traits.hasSheet) && traits.web === theme && traits.root === theme && traits.presented === theme) break;
    }
    assert(document.documentElement.dataset.uiTheme === theme, `Web chrome did not switch to ${theme}`);
    assert(document.querySelector('#map').dataset.basemapTheme === theme, `Map did not switch to ${theme}`);
    assert(themeButton.getAttribute('aria-pressed') === String(theme === 'dark'), `Theme button state disagrees with ${theme}`);
    assert(localStorage.getItem(key) === theme, `Theme choice was not saved as ${theme}`);
    assert(traits.hasWindow && (!traits.expectsSheet || traits.hasSheet) && traits.web === theme && traits.root === theme && traits.presented === theme,
      `Native appearance disagrees with ${theme}: ${JSON.stringify(traits)}`);
    checks.push({ theme, traits });
  }
} catch (error) { failures.push(`${error.message || error}\n${error.stack || ''}`); }
finally {
  if (document.documentElement.dataset.uiTheme !== original) CSPNativeShell.tool('mapTheme');
  if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
}
return { passed: failures.length === 0, build: globalThis.CSP_BUILD, checks, failures };
