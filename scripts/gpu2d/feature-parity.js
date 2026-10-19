'use strict';
/* Spec §9.9. Exports are the files the app downloads. The harness does not
   blit the WebGL canvas. Cross-flag compare is a coarse RGB grid plus size. */
const fs = require('fs');
const path = require('path');
const h = require('./harness-lib');

const EXPORTS = [
  { scale: 1, bearing: 0, readout: false },
  { scale: 2, bearing: 0, readout: false },
  { scale: 4, bearing: 0, readout: false },
  { scale: 1, bearing: 37, readout: false },
  { scale: 2, bearing: 37, readout: false },
  { scale: 4, bearing: 37, readout: false },
  { scale: 1, bearing: 0, readout: true, optional: true }
];

async function statusText(page) {
  await h.expandSidebar(page);
  await h.openPane(page, 'terrain');
  return page.evaluate(() => ({
    load: (document.querySelector('#terrainLoadStatus')?.textContent || '').trim().slice(0, 500),
    summary: (document.querySelector('#terrainSourceSummary')?.textContent || '').trim().slice(0, 800),
    panel: (document.querySelector('#terrainSourcePanelBody')?.textContent || '').trim().slice(0, 500),
    state: document.querySelector('#terrainLoadStatus')?.dataset.state || ''
  }));
}

async function cursorText(page) {
  const box = await h.mapBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  try {
    await page.waitForFunction(() => {
      const elev = document.querySelector('#cursorElevation')?.textContent || '';
      const coords = document.querySelector('#cursorCoordinates')?.textContent || '';
      return coords.includes('°') && elev && !elev.includes('…') && !elev.startsWith('Move');
    }, { timeout: 10000 });
  } catch (error) {}
  return page.evaluate(() => ({
    coordinates: document.querySelector('#cursorCoordinates')?.textContent || '',
    elevation: document.querySelector('#cursorElevation')?.textContent || ''
  }));
}

async function researchText(page) {
  await h.expandSidebar(page);
  await h.openPane(page, 'research');
  await page.evaluate(() => {
    document.querySelector('#researchReset')?.click();
    document.querySelector('#researchLayers .ls-add-button')?.click();
    document.querySelector('#researchLayers [data-add-product="lrm"]')?.click();
  });
  try {
    await page.waitForFunction(() => {
      const out = document.querySelector('#researchOut');
      if (!out) return false;
      const text = out.textContent || '';
      const busy = !!out.querySelector('.spin') || /Reading elevation|Analyzing this view|Updating for this view/.test(text);
      return text.length > 40 && !busy;
    }, { timeout: 90000 });
  } catch (error) {
    const text = await page.locator('#researchOut').innerText().catch(() => '');
    return { error: String(error.message || error), text: text.slice(0, 800), warn: /warn|failed|unavailable/i.test(text) };
  }
  return page.evaluate(() => {
    const out = document.querySelector('#researchOut');
    const text = out ? out.innerText : '';
    const provenance = (text.match(/Elevation used\s+([^\n]+)/) || [])[1] || '';
    return { text: text.slice(0, 800), warn: !!(out && out.querySelector('.warn')), provenance };
  });
}

async function oneExport(session, args, item, repeat) {
  const page = session.page;
  await h.collapseSidebar(page);
  await h.setView(page, { ...h.CENTER, zoom: 15, bearing: item.bearing });
  const settled = await h.waitSettled(page, { timeout: 20000, quietMs: 300 });
  await page.evaluate(() => { if (window.cspOpenSnapshotPanel) window.cspOpenSnapshotPanel(); });
  await page.evaluate(({ scale, readout }) => {
    const scaleEl = document.querySelector('#snapshotScale');
    if (scaleEl) {
      scaleEl.value = String(scale);
      scaleEl.dispatchEvent(new Event('input', { bubbles: true }));
      scaleEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const read = document.querySelector('#snapshotReadout');
    if (read) {
      read.checked = !!readout;
      read.dispatchEvent(new Event('input', { bubbles: true }));
      read.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, item);
  await page.waitForTimeout(250);
  const meta = await page.locator('#snapshotMeta').innerText().catch(() => '');
  const disabled = await page.locator('#snapshotCapture').isDisabled().catch(() => true);
  const name = `rep${repeat}-s${item.scale}-b${item.bearing}-read${item.readout ? 1 : 0}.png`;
  if (disabled) return { ...item, name, settled: settled.ok, error: 'capture disabled', meta: meta.slice(0, 300) };
  try {
    const pending = page.waitForEvent('download', { timeout: item.scale >= 4 ? 180000 : 90000 });
    await page.locator('#snapshotCapture').click();
    const download = await pending;
    const tmp = await download.path();
    const buf = fs.readFileSync(tmp);
    const size = h.pngSize(buf);
    const img = h.decodePng(buf);
    const grid = h.sampleGrid(img, 16, 10);
    const dest = h.refFile(args, 'export', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    let compare = null;
    if (args.gpu2d === 1) {
      const ref = h.refFile({ ...args, gpu2d: 0 }, 'export', name);
      if (fs.existsSync(ref)) {
        const other = h.decodePng(fs.readFileSync(ref));
        const otherSize = h.pngSize(fs.readFileSync(ref));
        compare = {
          ref: otherSize,
          grid: h.gridDiff(h.sampleGrid(other, 16, 10), grid),
          sameBytes: fs.statSync(ref).size === buf.length
        };
      }
    }
    return {
      ...item, name, settled: settled.ok,
      bytes: buf.length, sha256: h.sha256(buf),
      width: size && size.width, height: size && size.height,
      compare, meta: meta.slice(0, 240)
    };
  } catch (error) {
    return { ...item, name, settled: settled.ok, error: String(error.message || error), meta: meta.slice(0, 300) };
  }
}

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('feature-parity', args, async (session, repeat) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: true, zoom: 15, bearing: 0, opacity: 100 });
    const status = await statusText(page);
    const cursor = await cursorText(page);
    const exportsDone = [];
    for (const item of EXPORTS) {
      const result = await oneExport(session, args, item, repeat);
      exportsDone.push(result);
      console.log('export', result.name, result.error || (result.width + 'x' + result.height));
    }
    let research = null;
    try { research = await researchText(page); }
    catch (error) { research = { error: String(error.message || error) }; }
    let provenance = research && research.provenance ? research.provenance : '';
    if (!provenance && status.summary) provenance = status.summary.slice(0, 240);
    const engineProvenance = await page.evaluate(() => {
      try {
        const layer = window.ClearSkiesPortalBridge.gpuTerrain && window.ClearSkiesPortalBridge.gpuTerrain();
        if (layer && typeof layer.provenance === 'function') return layer.provenance();
      } catch (error) { return { error: String(error.message || error) }; }
      return null;
    });
    const required = exportsDone.filter((item) => !item.optional);
    const failed = required.filter((item) => item.error);
    const cursorOk = /°/.test(cursor.coordinates || '') && (cursor.elevation || '').length > 0;
    const statusOk = !!(status.load || status.summary);
    return {
      settled,
      status, cursor, research,
      provenance,
      engineProvenance,
      exportMethod: 'App download via #snapshotCapture. SNAPSHOT_DISK is forced false and showSaveFilePicker is cleared so headless does not open a file picker. Rotated exports use the app snapshot transform (snapshotDomMatrix on the integrated page). The harness compares the PNG. It does not drawImage the live WebGL canvas.',
      exports: exportsDone.map((item) => ({
        scale: item.scale, bearing: item.bearing, readout: item.readout, optional: !!item.optional,
        width: item.width || null, height: item.height || null, bytes: item.bytes || null,
        sha256: item.sha256 || null, error: item.error || null,
        compare: item.compare || null, meta: item.meta || ''
      })),
      gate: {
        applies: info.path === 'on',
        pass: info.path === 'on' ? (failed.length === 0 && cursorOk && statusOk && !(research && research.warn && research.error)) : null,
        failed: failed.map((item) => item.name),
        cursorOk, statusOk,
        rule: 'When the path is on: cursor readout, status text, and the six required exports (1x/2x/4x at bearings 0 and 37, readout off) succeed. Research errors are recorded and do not by themselves fail the export gate. Cross-flag grid diffs are reported and are not a 3/255 full-pixel gate.'
      },
      headline: {
        cursorOk,
        statusOk,
        researchWarn: !!(research && research.warn),
        researchError: !!(research && research.error),
        exportsOk: required.length - failed.length,
        exportsFailed: failed.length,
        provenance: provenance.slice(0, 120)
      }
    };
  });
  if (args.gpu2d === 1 && !args.keepShots && !args.help) {
    fs.rmSync(path.dirname(h.refFile(args, 'export', 'done')), { recursive: true, force: true });
    fs.rmSync(path.dirname(h.refFile({ ...args, gpu2d: 0 }, 'export', 'done')), { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
