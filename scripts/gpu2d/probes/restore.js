const pw=require(process.env.PW);
(async()=>{const b=await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal']});const p=await (await b.newContext()).newPage();
  await p.route('http://127.0.0.1:8799/',async r=>{const res=await r.fetch();let body=await res.text();
    body=body.replace('window.ClearSkiesPortalBridge={','window.__tg=terrainGpu;window.__eg=elevGpu;window.ClearSkiesPortalBridge={');r.fulfill({response:res,body})});
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(3000);
  console.log(await p.evaluate(async()=>{const out=[];for(const [n,r] of [['terrain',window.__tg],['elev',window.__eg]]){if(!r){out.push(n+': not found');continue}
    const before=r.ready;const ext=r.gl.getExtension('WEBGL_lose_context');ext.loseContext();await new Promise(x=>setTimeout(x,100));const lost=r.ready;
    ext.restoreContext();await new Promise(x=>setTimeout(x,300));out.push(`${n}: ready ${before} -> lost ${lost} -> restored ${r.ready}`)}return out.join(' | ')}));await b.close()})();
