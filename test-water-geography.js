'use strict';
// The land/water mask decodes in slices during GPU start-up. A sliced decode
// must produce exactly the bytes of a one-shot decode, and strip uploads must
// cover the texture exactly once.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fresh=()=>{delete require.cache[require.resolve('./water-geography.js')];return require('./water-geography.js')};

const whole=fresh().bytes(),hash=crypto.createHash('sha256').update(whole).digest('hex');
const sliced=fresh();let steps=0;
while(!sliced.decodeStep(0))steps++;
assert(steps>1,'a zero budget decodes in more than one step');
assert.equal(crypto.createHash('sha256').update(sliced.bytes()).digest('hex'),hash,'sliced decode matches the one-shot mask');
assert.equal(sliced.decodeStep(0),true,'a decoded mask stays decoded');

const calls=[];
const gl={TEXTURE_2D:1,RGBA8:2,RGBA:3,UNSIGNED_BYTE:4,TEXTURE_MIN_FILTER:5,TEXTURE_MAG_FILTER:6,NEAREST:7,TEXTURE_WRAP_S:8,TEXTURE_WRAP_T:9,CLAMP_TO_EDGE:10,
  createTexture:()=>({}),bindTexture(){},texParameteri(){},deleteTexture(){},
  texStorage2D:(_t,_l,_f,w,h)=>calls.push(['storage',w,h]),
  texSubImage2D:(_t,_l,x,y,w,h,_f,_ty,data)=>calls.push(['rows',y,h,data.length,w])};
const texture=sliced.allocate(gl);
for(let row=0;row<sliced.ROWS;row+=256)sliced.uploadRows(gl,texture,row,Math.min(256,sliced.ROWS-row));
const [storage,...strips]=calls;
assert.deepEqual(storage,['storage',sliced.WIDTH/8,sliced.ROWS]);
let next=0;
for(const [,y,h,length,w] of strips){assert.equal(y,next);assert.equal(length,w*h*4);next+=h}
assert.equal(next,sliced.ROWS,'strips cover every texture row exactly once');
console.log(`water geography: sliced decode (${steps+1} steps) matches, strip uploads cover the mask`);
