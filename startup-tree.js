/* The start-up screen's tree: the landing page's vine maple (landing/maple.js), drawn
   for today, without its soil section or notes, still, on plain white in the middle of
   the screen. index.html owns that screen (#cspSplash) and decides when it lifts; this
   only draws into it, fades the tree in, and gives the GL context back once it has
   lifted. site.json's tree list ships the maple's modules beside this file. */
import { createSketch } from "./sketch.js";
import { buildMaple } from "./maple.js";
import { pageDate } from "./phenology.js";

export function drawStartupTree(splash) {
  const canvas = document.getElementById("cspSplashTree");
  if (!canvas || !splash || splash.done) return;
  const T = buildMaple(pageDate(), undefined, { treeOnly: true });
  if (splash.done) return;
  const v = T.view, room = 1.04;          // a little white round the drawing
  canvas.style.aspectRatio = `${v.w} / ${v.h}`;
  const sketch = createSketch(canvas, null, {
    build: () => T, view: { cx: v.cx, cy: v.cy, w: v.w * room, h: v.h * room }, still: true
  });
  if (!sketch) return;                    // no WebGL: the screen stays plain white
  splash.dispose = () => sketch.dispose();
  if (splash.done) { sketch.dispose(); return; }
  requestAnimationFrame(() => { if (splash.done) return; canvas.classList.add("on"); splash.tree(); });
}
