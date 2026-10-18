const pw=require(process.env.PW);const which=process.env.B||'chrome';const fs=require('fs');
(async()=>{
  const b=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  const p=await (await b.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2})).newPage();
  const logs=[];p.on('console',m=>{if(m.type()!=='log')logs.push(m.type()+' '+m.text().slice(0,160))});p.on('pageerror',e=>logs.push('PAGEERR '+e));p.on('crash',()=>logs.push('PAGE CRASH'));
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(3500);
  await p.evaluate(()=>document.querySelector('#sideToggle')?.click());
  await p.evaluate(`ClearSkiesPortalBridge.map.setView([47.858,-118.33],${process.env.Z0||15},{animate:false})`);
  await p.evaluate(`(()=>{const s=document.querySelector('#terStyle');s.value='hs';s.dispatchEvent(new Event('change',{bubbles:true}));${process.env.SPEC?"const e=document.querySelector('#elevSh');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));":""}})()`);
  await p.waitForTimeout(3000);
  if(process.env.MODE==='3d'){await p.evaluate(()=>document.querySelector('#terMode3d').click());await p.waitForTimeout(9000);}
  const zoom=()=>p.evaluate(m=>m==='3d'?ClearSkiesPortalBridge.map3d().getZoom():ClearSkiesPortalBridge.map.getZoom(),process.env.MODE);const cam=()=>p.evaluate(()=>{const m=ClearSkiesPortalBridge.map3d();if(!m)return '';const T=m._camera?.transform||{};return 'elev '+Math.round(T.elevation)+' alt '+Math.round(m.getCameraAltitude?.()??-1)+' pitch '+Math.round(m.getPitch())+' freeze '+m.elevationFreeze+' minEl '+Math.round(T.minElevationForCurrentTile)})
  if(process.env.MODE==='3d') await p.evaluate(()=>{window.__el=[];const m=ClearSkiesPortalBridge.map3d();
    const hook=T=>{if(!T||T.__h)return;T.__h=1;const o=T.setElevation;T.setElevation=function(v){if(v===0&&this.elevation>0&&window.__el.length<4)window.__el.push(new Error('zero').stack.split('\n').slice(1,9).join(' <- '));return o.call(this,v)}};
    const proto=Object.getPrototypeOf(m._camera.transform);const o=proto.setElevation;proto.setElevation=function(v){if(v===0&&this.elevation>0&&window.__el.length<4)window.__el.push(new Error('zero').stack.split('\n').slice(1,9).map(s=>s.trim().replace(/http:\/\/127.0.0.1:8799\//,'')).join(' <- '));return o.call(this,v)}});
  await p.mouse.move(640,420);
  let worst={white:0};
  for(let i=0;i<+(process.env.STEPS||90);i++){
    await p.mouse.wheel(0,i<+(process.env.IN||60)?-60:60);await p.waitForTimeout(90);
    if(i%3===0){const buf=await p.screenshot();
      const r=await p.evaluate(async(b64)=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
        const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
        const d=g.getImageData(300,200,c.width-900,c.height-400).data;let w=0,n=d.length/4,sum=0;for(let i=0;i<d.length;i+=4){sum+=(d[i]+d[i+1]+d[i+2])/3;if(d[i]>245&&d[i+1]>245&&d[i+2]>245)w++}
        return {white:+(w/n).toFixed(2),mean:Math.round(sum/n)}},buf.toString('base64'));
      const z=await zoom();
      if(r.mean>215)fs.writeFileSync(`/tmp/csp-shot/bright-${process.env.MODE}-${i}.png`,buf);if(r.white>worst.white){worst={...r,z};fs.writeFileSync(`/tmp/csp-shot/wheel-${which}-${process.env.MODE}-worst.png`,buf)}
      if(r.white>0.2||i%15===0||i>=+(process.env.IN||60)-3)console.log(i,'z',z.toFixed(2),JSON.stringify(r),await cam());
    }
  }
  if(process.env.MODE==='3d')console.log(await p.evaluate(()=>window.__el.join('\n\n')));
  console.log('worst',JSON.stringify(worst));
  console.log([...new Set(logs)].filter(l=>!/GL Driver|willRead|503/.test(l)).slice(0,12).join('\n'));await b.close();
})();
