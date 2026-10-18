const pw=require(process.env.PW);const which=process.env.B||'chrome';
(async()=>{
  const b=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  const p=await (await b.newContext({viewport:{width:800,height:600}})).newPage();
  await p.addInitScript(()=>{const w=console.warn;console.warn=(...a)=>w(a.map(x=>{try{return typeof x==='object'?JSON.stringify(x):String(x)}catch{return String(x)}}).join(' '))});
  p.on('console',m=>{if(/self-test|GPU/.test(m.text()))console.log(which,m.text().slice(0,400))});
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(4000);await b.close();
})();
