/* Generates build/icon.icns with no dependencies — the project ships none,
   so the icon is drawn pixel by pixel and PNG-encoded with zlib.
   Run: node build/make-icon.js   (then iconutil, see the npm script)

   The iPhone app needs the same artwork full-bleed and opaque, because iOS
   masks the corners itself and rejects an App Store icon with alpha:
     node build/make-icon.js --ios ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png
   That samples the inset macOS square across the whole canvas. */
const fs = require("fs"), zlib = require("zlib"), path = require("path");

const IOS_OUT = process.argv.includes("--ios") ? process.argv[process.argv.indexOf("--ios") + 1] : null;
if (process.argv.includes("--ios") && !IOS_OUT) throw new Error("--ios needs an output path");

const WINDOWS = process.argv.includes("--windows");
const S = WINDOWS ? 256 : 1024;      // output size; geometry stays in master coordinates
const MARGIN = 100, R = 180;         // macOS icons sit inset in their canvas
const X0 = MARGIN, X1 = 1024 - MARGIN, Y0 = MARGIN, Y1 = 1024 - MARGIN;

const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const mix = (a,b,t) => a + (b-a)*clamp(t,0,1);

/* signed distance to the rounded rect: negative inside */
function sdRoundRect(x,y){
  const cx = clamp(x, X0+R, X1-R), cy = clamp(y, Y0+R, Y1-R);
  const dx = x-cx, dy = y-cy, d = Math.hypot(dx,dy);
  if (x > X0+R && x < X1-R) return Math.max(Y0-y, y-Y1);
  if (y > Y0+R && y < Y1-R) return Math.max(X0-x, x-X1);
  return d - R;
}

const px = Buffer.alloc(S*S*4);
function over(i, r, g, b, a){                 // src-over compositing
  const dr = px[i], dg = px[i+1], db = px[i+2], da = px[i+3]/255;
  const oa = a + da*(1-a);
  if (oa <= 0){ px[i]=px[i+1]=px[i+2]=px[i+3]=0; return; }
  px[i]   = (r*a + dr*da*(1-a))/oa;
  px[i+1] = (g*a + dg*da*(1-a))/oa;
  px[i+2] = (b*a + db*da*(1-a))/oa;
  px[i+3] = oa*255;
}

const EARTH_CX = 512, EARTH_CY = 1265, EARTH_R = 545;   // limb sweeps the lower third
const SUN_CX = 707, SUN_CY = 322, SUN_R = 58;

for (let y = 0; y < S; y++){
  for (let x = 0; x < S; x++){
    const i = (y*S + x)*4;
    // Pixel centre in the macOS master; for iOS, the inset square scaled to fill.
    const cx = IOS_OUT ? X0 + (x+0.5)*(X1-X0)/S : (x+0.5)*1024/S;
    const cy = IOS_OUT ? Y0 + (y+0.5)*(Y1-Y0)/S : (y+0.5)*1024/S;
    const inside = IOS_OUT ? 1 : clamp(0.5 - sdRoundRect(cx, cy)*S/1024, 0, 1);
    if (inside <= 0) continue;

    // night sky, deep at the top easing to a lit horizon
    const t = (cy-0.5 - Y0) / (Y1 - Y0);
    over(i, mix(9,26,t*1.15), mix(20,63,t*1.15), mix(38,104,t*1.15), inside);

    // stars, fixed so the icon is byte-identical every build
    for (const [sx,sy,sr,sa] of [[236,250,4,.95],[330,392,3,.7],[190,455,2.5,.6],
                                 [420,205,3,.8],[560,300,2.5,.55],[820,470,3,.65],
                                 [274,600,2.5,.5],[880,250,2.5,.6],[640,150,2,.5]]){
      const d = Math.hypot(cx-sx, cy-sy);
      const a = clamp(sr - d, 0, 1) * sa * inside;
      if (a > 0) over(i, 226, 240, 255, a);
    }

    // sun low over the limb, with a soft bloom
    const ds = Math.hypot(cx-SUN_CX, cy-SUN_CY);
    const bloom = clamp(1 - (ds - SUN_R)/190, 0, 1);
    if (bloom > 0) over(i, 150, 205, 255, bloom*bloom*0.30*inside);
    const sa2 = clamp(SUN_R - ds + 0.5, 0, 1) * inside;
    if (sa2 > 0) over(i, 247, 251, 255, sa2);

    // the planet
    const de = Math.hypot(cx-EARTH_CX, cy-EARTH_CY);
    const ea = clamp(EARTH_R - de + 0.5, 0, 1) * inside;
    if (ea > 0){
      const shade = clamp((EARTH_R - de)/EARTH_R, 0, 1);
      over(i, mix(96,20,shade), mix(178,70,shade), mix(255,132,shade), ea);
    }
    // bright atmosphere hugging the limb
    const rim = clamp(1 - Math.abs(de - EARTH_R)/13, 0, 1);
    if (rim > 0) over(i, 170, 222, 255, rim*0.92*inside);
    const halo = clamp(1 - (de - EARTH_R)/74, 0, 1);
    if (halo > 0 && de > EARTH_R) over(i, 96, 178, 255, halo*halo*0.34*inside);
  }
}

/* ---- minimal PNG encoder ---- */
const CRC = (() => { const t = new Int32Array(256);
  for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c; }
  return t; })();
function crc32(buf){ let c = -1; for (let i=0;i<buf.length;i++) c = CRC[(c^buf[i])&0xFF] ^ (c>>>8); return (c^-1)>>>0; }
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type,"ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// RGBA for macOS; RGB for iOS, where every pixel is opaque anyway.
const CH = IOS_OUT ? 3 : 4;
const raw = Buffer.alloc(S*(S*CH+1));
for (let y=0;y<S;y++){
  raw[y*(S*CH+1)] = 0;
  if (CH === 4) px.copy(raw, y*(S*4+1)+1, y*S*4, (y+1)*S*4);
  else for (let x=0;x<S;x++) px.copy(raw, y*(S*3+1)+1+x*3, (y*S+x)*4, (y*S+x)*4+3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S,0); ihdr.writeUInt32BE(S,4);
ihdr[8]=8; ihdr[9]=CH === 4 ? 6 : 2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, {level:9})),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = WINDOWS ? path.join(__dirname,"icon.ico") : IOS_OUT ? path.resolve(IOS_OUT) : path.join(__dirname, "icon-1024.png");
if(WINDOWS){
  // ICO supports an embedded PNG at 256px. No platform-specific tools needed.
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
  header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);
  header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  fs.writeFileSync(out,Buffer.concat([header,png]));
  // Branded NSIS welcome/finish artwork, 24-bit BMP at its native 164 x 314.
  const w=164,h=314,stride=Math.ceil(w*3/4)*4,bmp=Buffer.alloc(54+stride*h);
  bmp.write("BM");bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);
  bmp.writeUInt32LE(40,14);bmp.writeInt32LE(w,18);bmp.writeInt32LE(h,22);
  bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let rgb=[mix(11,23,y/h),mix(22,52,y/h),mix(38,80,y/h)];
    if(x>=18&&x<146&&y>=36&&y<164){
      const i=((y-36)*2*S+(x-18)*2)*4,a=px[i+3]/255;
      rgb=rgb.map((v,c)=>mix(v,px[i+c],a));
    }
    const j=54+(h-1-y)*stride+x*3;
    bmp[j]=rgb[2];bmp[j+1]=rgb[1];bmp[j+2]=rgb[0];
  }
  fs.writeFileSync(path.join(__dirname,"installerSidebar.bmp"),bmp);
}else fs.writeFileSync(out, png);
console.log(`wrote ${out} (${(png.length/1024).toFixed(1)} KB)`);
