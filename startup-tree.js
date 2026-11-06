/* Prepare today's landing-page maple off the UI thread. Only its GL renderer
   waits for the map's first requests; the drawing never holds map readiness. */
import { pageDate } from "./phenology.js";

const yieldToMap = () => new Promise(resolve => setTimeout(resolve, 0));

export function prepareStartupTree(splash) {
  if (!splash || splash.done || splash.prepared) return;
  const date = pageDate();
  let worker, timer, cancel;
  const stop = () => { clearTimeout(timer); worker?.terminate(); worker = null; };
  splash.dispose = () => { stop(); cancel?.(null); };
  splash.prepared = new Promise((resolve, reject) => {
    cancel = resolve;
    try {
      worker = new Worker(new URL("./startup-tree-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data);
      worker.onerror = event => { event.preventDefault(); reject(new Error("Tree preparation unavailable")); };
      timer = setTimeout(() => reject(new Error("Tree preparation timed out")), 5000);
      worker.postMessage(date.getTime());
    } catch (error) { reject(error); }
  }).catch(async () => {
    stop();
    /* Module workers or OffscreenCanvas may be unavailable in an older host.
       Keep the same drawing, yielding between its CPU-heavy stages. */
    if (splash.done) return null;
    const [{ buildMaple }, { SPECIES }, { BAKED }] = await Promise.all([import("./maple.js"), import("./maple-species.js"), import("./maple-tree-vine.js")]);
    await yieldToMap();
    if (splash.done) return null;
    const tree = buildMaple(date, SPECIES.vine, { treeOnly: true, baked: BAKED });
    await yieldToMap();
    if (splash.done) return null;
    return { tree, atlas: tree.leafCount ? tree.leafAtlas() : null };
  }).catch(error => { console.warn("Start-up tree unavailable", error); return null; }).finally(stop);
}

export async function drawStartupTree(splash) {
  const canvas = document.getElementById("cspSplashTree");
  if (!canvas || !splash || splash.done) return;
  prepareStartupTree(splash);
  const [prepared, { createSketch }] = await Promise.all([splash.prepared, import("./sketch.js")]);
  if (splash.done) return;
  if (!prepared) { splash.skipTree(); return; }
  const { tree, atlas } = prepared;
  tree.leafAtlas = () => atlas;
  const v = tree.view, room = 1.04;
  canvas.style.aspectRatio = `${v.w} / ${v.h}`;
  await yieldToMap();
  if (splash.done) return;
  const sketch = createSketch(canvas, null, {
    build: () => tree, view: { cx: v.cx, cy: v.cy, w: v.w * room, h: v.h * room },
    drawSeconds: 1.5, interactive: false,
    still: document.documentElement.classList.contains("csp-reduce-motion")
  });
  if (!sketch) { splash.skipTree(); return; }
  splash.freeze = () => sketch.freeze();
  splash.dispose = () => sketch.dispose();
  if (splash.done) { sketch.dispose(); return; }
  requestAnimationFrame(() => { if (splash.done) return; canvas.classList.add("on"); splash.tree(1800); });
}
