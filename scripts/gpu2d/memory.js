'use strict';
/* Spec §9.7. One hundred pans at zoom 15. No pixel readback. */
const h = require('./harness-lib');
const FINE_POINTER_BUDGET = 192 * 1024 * 1024;

function lawn() {
  const moves = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const lat = 47.858 + (row - 4.5) * 0.004;
      const along = (row % 2 ? col : 9 - col) - 4.5;
      const lng = -118.33 + along * 0.006;
      moves.push({ lat, lng, zoom: 15, bearing: 0 });
    }
  }
  return moves;
}

function heapBytes(sample) {
  if (sample && sample.cdp && typeof sample.cdp.jsHeapUsed === 'number') return sample.cdp.jsHeapUsed;
  if (sample && sample.memory && typeof sample.memory.used === 'number') return sample.memory.used;
  return null;
}

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('memory', args, async (session) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: true, zoom: 15, bearing: 0, opacity: 100 });
    const start = await h.heapSample(session);
    const moves = lawn();
    let mid = null;
    for (let i = 0; i < moves.length; i++) {
      await h.setView(page, moves[i]);
      await page.waitForTimeout(120);
      if (i === 49) mid = await h.heapSample(session);
    }
    await page.waitForTimeout(400);
    const end = await h.heapSample(session);
    const startHeap = heapBytes(start);
    const endHeap = heapBytes(end);
    const textureBytes = end.engine && typeof end.engine.textureBytes === 'number' ? end.engine.textureBytes : null;
    const canvasDelta = (end.canvases || 0) - (start.canvases || 0);
    const on = info.path === 'on';
    const texturePass = textureBytes == null ? null : textureBytes <= FINE_POINTER_BUDGET;
    const canvasPass = end.canvases != null && end.canvases <= (start.canvases || 0) + 2;
    const heapPass = startHeap == null || endHeap == null ? null : endHeap <= startHeap * 1.35 + 8 * 1024 * 1024;
    return {
      settled,
      moves: moves.length,
      pattern: '10 by 10 lawnmower, 0.004° lat by 0.006° lng, zoom 15, 120 ms between moves.',
      budgetBytes: FINE_POINTER_BUDGET,
      budgetNote: 'Spec default fine-pointer texture budget, 192 MB. Coarse-pointer default is 64 MB. This machine is measured against 192 MB.',
      start, mid, end,
      textureBytes,
      canvasDelta,
      heapDelta: startHeap == null || endHeap == null ? null : endHeap - startHeap,
      gate: {
        applies: on,
        pass: on ? (texturePass !== false && canvasPass && heapPass !== false) : null,
        texturePass, canvasPass, heapPass,
        rule: 'When the path is on: engine texture bytes stay within 192 MB, canvas count does not grow by more than 2 over the stress, and JS heap stays within 35% plus 8 MB of the start sample. WebKit often has no heap figure; heapPass is then null.'
      },
      headline: {
        canvasesStart: start.canvases,
        canvasesEnd: end.canvases,
        canvasDelta,
        textureBytes,
        heapStart: startHeap,
        heapEnd: endHeap,
        glCreated: end.glCreated,
        glLost: end.glLost
      }
    };
  }, { memory: true });
}

main().catch((error) => { console.error(error); process.exit(1); });
