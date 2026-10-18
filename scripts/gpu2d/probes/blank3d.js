const pw=require(process.env.PW);const fs=require('fs');
(async()=>{
  const b=await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  const p=await (await b.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2})).newPage();
  const logs=[];p.on('console',m=>{if(m.type()!=='log')logs.push(m.type()+' '+m.text().slice(0,200))});p.on('pageerror',e=>logs.push('PAGEERR '+e));
  const reqs=[];p.on('response',r=>{const u=r.url();if(/\/api\//.test(u)&&!/health|status/.test(u))reqs.push(r.status()+' '+u.replace('http://127.0.0.1:8799','').slice(0,90))});
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(3500);
  await p.evaluate(()=>document.querySelector('#sideToggle')?.click());
  await p.evaluate(`ClearSkiesPortalBridge.map.setView([47.858,-118.33],${process.env.Z0||15},{animate:false})`);
  await p.evaluate(`(()=>{const s=document.querySelector('#terStyle');s.value='hs';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await p.waitForTimeout(2500);await p.evaluate(()=>document.querySelector('#terMode3d').click());await p.waitForTimeout(9000);
  const dump=async(tag)=>{
    const st=await p.evaluate(()=>{const m=ClearSkiesPortalBridge.map3d(),tm=m.style.tileManagers||m.style.sourceCaches;const o={zoom:+m.getZoom().toFixed(2),pitch:Math.round(m.getPitch())};
      for(const [k,sc] of Object.entries(tm)){const z={};const ts=sc._inViewTiles?.getAllTiles?.()||[];for(const t of ts){const kk=t.tileID.overscaledZ+'/'+t.tileID.canonical.z+':'+t.state;z[kk]=(z[kk]||0)+1}o[k]=z}
      const T=m.transform||m._transform||m.painter?.transform||{};o.tkeys=Object.keys(m).filter(k=>/ransform/.test(k)).join(",");o.T={elev:T.elevation,center:T.center&&[T.center.lng,T.center.lat],camZ:T.cameraPosition?.[2]??T.getCameraPosition?.()?.altitude,minEl:T.minElevationForCurrentTile,
        scale:T.scale,worldSize:T.worldSize,camAlt:m.getCameraAltitude?.(),fov:T.fov,nearZ:T.nearZ,farZ:T.farZ,mvp0:T.modelViewProjectionMatrix?.[0]??T._viewProjMatrix?.[0]};
      const tr=m.terrain;o.terrainTiles=tr?.tileManager?._renderableTilesKeys?.length??tr?.sourceCache?._renderableTilesKeys?.length;
      return JSON.stringify(o)});
    const buf=await p.screenshot();const mean=await p.evaluate(async(b64)=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);const d=g.getImageData(300,200,1600,1000).data;let s=0;for(let i=0;i<d.length;i+=4)s+=(d[i]+d[i+1]+d[i+2])/3;return Math.round(s/(d.length/4))},buf.toString('base64'));
    console.log(tag,'mean',mean,st);};
  for(const z of (process.env.ZS||'15,15.5,16,16.5,17,17.25,17.5,18').split(',')){reqs.length=0;await p.evaluate(`ClearSkiesPortalBridge.map3d().jumpTo({zoom:${z}})`);await p.waitForTimeout(4000);await dump('z'+z);
    const bad=reqs.filter(r=>!r.startsWith('200'));console.log('   reqs',reqs.length,'non200',bad.length,bad.slice(0,3).join(' | '));}
  console.log([...new Set(logs)].filter(l=>!/GL Driver|willRead/.test(l)).slice(0,12).join('\n'));await b.close();
})();
