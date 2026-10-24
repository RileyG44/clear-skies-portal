// Debug-only, app-scoped DOM gesture verification. This checks actual handlers
// in WKWebView; synthetic events do not constitute a physical finger test.
const failures = [], checks = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const surface = document.querySelector('#snapSel'), box = document.querySelector('#snapSelBox');
const map = ClearSkiesPortalBridge.map;
const beforeCenter = map.getCenter(), beforeZoom = map.getZoom();
const originalRaf = window.requestAnimationFrame, originalCapture = surface.setPointerCapture;
const rect = () => { const r = box.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
const equal = (a, b, name) => assert(Object.keys(b).every(key => Math.abs(a[key] - b[key]) < 0.1), `${name}: ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);
const pointer = (type, x, y, id = 1) => (document.elementFromPoint(x, y) || surface).dispatchEvent(new PointerEvent(type,
  { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1,
    button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, clientX: x, clientY: y }));
try {
  assert(surface.hidden, 'Selection must be closed at probe start');
  // iOS can suspend rAF in a background web view. Only this selection setup
  // uses a timer, and synthetic pointers cannot acquire native pointer capture.
  window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
  surface.setPointerCapture = () => {};
  cspStartSnapshotSelect(); await wait(40); window.requestAnimationFrame = originalRaf;
  const start = rect(), x = start.x + start.w + 18, y = start.y + start.h + 18;
  assert(start.w > 100 && start.h > 100, 'Selection did not lay out');
  assert(getComputedStyle(box.querySelector('[data-h="se"]')).width === '44px', 'Handle target is smaller than 44 CSS pixels');
  pointer('pointerdown', x, y);
  pointer('pointerdown', start.x + 60, start.y + 60, 2);
  pointer('pointermove', start.x + 80, start.y + 80, 2);
  equal(rect(), start, 'Second pointer must not replace the active resize');
  pointer('pointermove', x - 20, y - 25); pointer('pointerup', x - 20, y - 25);
  const resized = rect();
  equal(resized, { ...start, w: start.w - 20, h: start.h - 25 }, 'Corner resize retains the opposite corner and grab offset');
  checks.push('Corner hit tolerance, preserved anchor/offset, second-pointer ownership');
  const edgeX = resized.x + resized.w * 0.25, edgeY = resized.y - 10;
  pointer('pointerdown', edgeX, edgeY); pointer('pointermove', edgeX, edgeY + 12); pointer('pointerup', edgeX, edgeY + 12);
  const edged = rect(); equal(edged, { ...resized, y: resized.y + 12, h: resized.h - 12 }, 'Edge resizing between visible handles');
  const middleX = edged.x + edged.w / 2, middleY = edged.y + edged.h / 2;
  pointer('pointerdown', middleX, middleY); pointer('pointermove', middleX + 8, middleY + 9);
  equal(rect(), { ...edged, x: edged.x + 8, y: edged.y + 9 }, 'Selection interior moves the rectangle');
  pointer('pointercancel', middleX + 8, middleY + 9); equal(rect(), edged, 'Cancelled drag restores the rectangle');
  checks.push('Whole-edge resize, interior move and cancellation');
  const center = map.getCenter();
  assert(Math.abs(center.lat - beforeCenter.lat) < 1e-10 && Math.abs(center.lng - beforeCenter.lng) < 1e-10 && map.getZoom() === beforeZoom,
    'Selection gestures moved the underlying map');
  checks.push('Underlying map camera remains unchanged');
} catch (error) { failures.push(error.stack || String(error)); }
finally {
  window.requestAnimationFrame = originalRaf; surface.setPointerCapture = originalCapture;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}
return { passed: failures.length === 0, build: globalThis.CSP_BUILD, checks, failures, method: 'Synthetic touch PointerEvents against installed WKWebView handlers' };
