// Frozen L1 contract from the existing JS engine. Regenerate deliberately when
// changing the scientific contract, never to make a native mismatch disappear.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const R = require('../../../research-analysis.js');
const F = require('../../../glacial-segment-features.js');
const C = require('../../../glacial-moraine-classifier.js');
const root = __dirname;
fs.mkdirSync(root, {recursive:true});
const gauss = (d,s) => Math.exp(-0.5*(d/s)*(d/s));
const arc = (x,y) => {
  const d = Math.hypot(x+40,y-100)-150;
  const angle = Math.atan2(y-100,x+40);
  let z = 100+10*((y-100)/100)**2+0.01*x+8*gauss(Math.max(0,Math.abs(angle)-0.45),0.08)*gauss(d,d<0?3:5);
  for(const t of [-0.3,-0.1,0.1,0.3]) z -= 2*gauss(Math.hypot(x-(-40+136*Math.cos(t)),y-(100+136*Math.sin(t))),2.5);
  return z;
};
const cases = [
  ['arc',200,200,5,arc],
  ['arc-coarse',200,200,12.03125,arc],
  ['fault-step',200,200,5,(x,y)=>100+0.01*x+8/(1+Math.exp(-(x-0.5*y-50)/3))],
  ['rolling-hills',200,200,5,(x,y)=>100+15*Math.sin(2*Math.PI*x/70)*Math.sin(2*Math.PI*y/85)],
  ['dunes',200,200,5,(x,y)=>{const p=((x+6*Math.sin(y/25))%22+22)%22;return 100+0.005*y+(p<16?5*p/16:5*(22-p)/6);}],
  ['hummocky-belt',200,200,5,(x,y)=>{
    const envelope=gauss(Math.max(0,Math.abs(x-100)-55),12)*gauss(Math.max(0,Math.abs(y-100)-55),12);
    return 100+envelope*(4+3*Math.cos(x*2*Math.PI/13)*Math.cos(y*2*Math.PI/15));
  }],
  ['ring',200,200,5,(x,y)=>100+8*gauss(Math.hypot(x-100,y-100)-55,4)],
  ['branched',200,200,5,(x,y)=>100+7*gauss(Math.min(Math.abs(x-100),Math.abs(y-100)),4)],
  ['missing-data',200,200,5,(x,y)=>x>93&&x<101||Math.hypot(x-115,y-100)<8?NaN:arc(x,y)],
  ['flat',33,29,5,()=>100],
  ['tiny-spacing',33,29,0.01,(x,y)=>100+x/100+y/100],
  ['minimum-view',3,3,100,(x,y)=>100+x+y],
  ['maximum-view',1024,512,5,(x,y)=>100+4*Math.sin(x/25)*Math.cos(y/31)+0.002*x],
];
const manifest=[];
for(const [name,width,height,resolution,fn] of cases){
  const grid=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)grid[y*width+x]=fn(x,y);
  const start=performance.now();
  const result=R.run({product:'moraine',scale:'balanced',width,height,resolution,grid});
  const frame=Buffer.from(R.encodeResult(result));
  const bytes=Buffer.concat([Buffer.from(grid.buffer),frame]);
  fs.writeFileSync(path.join(root,name+'.bin.zlib'),zlib.deflateSync(bytes,{level:9}));
  manifest.push({name,width,height,resolution});
  const counts={background:0,unsupported:0,possible:0,likely:0};
  for(const v of result.data)counts[v===1?'likely':v===Math.fround(0.55)?'possible':v===0?'background':'unsupported']++;
  console.log(name,Math.round(performance.now()-start)+'ms',counts,result.metadata.belt);
}
fs.writeFileSync(path.join(root,'cases.json'),JSON.stringify(manifest,null,2)+'\n');
const empty=R.run({product:'moraine',scale:'fine',width:3,height:3,resolution:5,grid:new Float32Array(9).fill(100)});
fs.writeFileSync(path.join(root,'../../crates/csk-science/src/moraine/metadata.json'),JSON.stringify({config:C.DEFAULT_CONFIG,featureMetadata:F.METADATA,screeningNotice:empty.notice},null,2)+'\n');
