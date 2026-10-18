const pw=require(process.env.PW);const which=process.env.B||'chrome';
const fs=require('fs');
(async()=>{
  const b=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-webgpu']});
  const p=await (await b.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2})).newPage();
  const logs=[];p.on('console',m=>{if(m.type()!=='log')logs.push(m.type()+' '+m.text().slice(0,180))});p.on('pageerror',e=>logs.push('PAGEERR '+e));p.on('crash',()=>logs.push('PAGE CRASH'));
  await p.addInitScript(()=>{window.__lost=0;const o=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,a){const c=o.call(this,t,a);if(c&&/webgl/.test(t)&&!this.__h){this.__h=1;this.addEventListener('webglcontextlost',()=>{window.__lost++;console.warn('CONTEXT LOST '+t+' '+this.width+'x'+this.height)})}return c}});
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(3500);
  console.log('GPU:',await p.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2');const e=g?.getExtension('WEBGL_debug_renderer_info');return g?g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER):'none'}));
  await p.evaluate(()=>document.querySelector('#sideToggle')?.click());
  await p.evaluate(`ClearSkiesPortalBridge.map.setView([47.858,-118.33],16,{animate:false})`);
  await p.evaluate(`(()=>{const s=document.querySelector('#terStyle');s.value='hs';s.dispatchEvent(new Event('change',{bubbles:true}));const e=document.querySelector('#elevSh');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await p.waitForTimeout(4000);
  const measure=async(tag)=>{const buf=await p.screenshot();fs.writeFileSync(`/tmp/csp-shot/${which}-${tag}.png`,buf);
    return p.evaluate(async(b64)=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
      const d=g.getImageData(200,200,c.width-600,c.height-400).data;let w=0,n=d.length/4,sum=0,sq=0;
      for(let i=0;i<d.length;i+=4){const l=(d[i]+d[i+1]+d[i+2])/3;sum+=l;sq+=l*l;if(d[i]>240&&d[i+1]>240&&d[i+2]>240)w++}
      const m=sum/n;return `white ${(w/n).toFixed(2)} mean ${Math.round(m)} sd ${Math.round(Math.sqrt(Math.max(0,sq/n-m*m)))} lost ${window.__lost}`},buf.toString('base64'))};
  for(const z of [17,19,21,23,25,26,26.5,27,27.25,27.5,27.75,28]){
    await p.evaluate(`ClearSkiesPortalBridge.map.setZoom(${z},{animate:false})`);await p.waitForTimeout(2500);console.log('2d',z,await measure('2d-'+z));}
  await p.evaluate(`ClearSkiesPortalBridge.map.setZoom(16,{animate:false})`);await p.waitForTimeout(2000);
  await p.evaluate(()=>document.querySelector('#terMode3d').click());await p.waitForTimeout(9000);
  for(const z of [17,19,20,21,21.25,21.5,21.75,22]){
    await p.evaluate(`ClearSkiesPortalBridge.map3d().jumpTo({zoom:${z}})`);await p.waitForTimeout(3500);console.log('3d',z,await measure('3d-'+z));}
  console.log([...new Set(logs)].filter(l=>!/GL Driver|willRead/.test(l)).slice(0,20).join('\n'));await b.close();
})();
