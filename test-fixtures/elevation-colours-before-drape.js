/* Frozen pre-worker implementation: the equivalence test must not track production edits. */
function elevationColours(elev,count,settings,out,width=count,stride=width,offset=0){
  for(let i=0;i<count;i++){
    const v=elev[offset+Math.floor(i/width)*stride+(i%width)],o=i*4;
    if(v!==v) continue;
    let pr=0,pg=0,pb=0,pa=0;
    const over=(r,g,b,a)=>{ pr=r*a+pr*(1-a);pg=g*a+pg*(1-a);pb=b*a+pb*(1-a);pa=a+pa*(1-a) };
    if(settings.spectrumOn){
      const d=(v-settings.level)/Math.max(1,settings.span),t=Math.min(1,Math.abs(d));
      const smooth=t*t*(3-2*t),hi=d>=0,a=settings.spectrumAlpha*(.15+.85*t);
      over((255+((hi?70:248)-255)*smooth)/255,
           (255+((hi?160:92)-255)*smooth)/255,
           (250+((hi?255:108)-250)*smooth)/255,a);
    }
    const band=settings.bandCompiled.rgba(v,"premultiplied"),ba=band[3]/255;
    if(ba>0){ pr=band[0]/255+pr*(1-ba);pg=band[1]/255+pg*(1-ba);
              pb=band[2]/255+pb*(1-ba);pa=ba+pa*(1-ba) }
    if(pa>0){ out[o]=Math.round(pr/pa*255);out[o+1]=Math.round(pg/pa*255);
              out[o+2]=Math.round(pb/pa*255);out[o+3]=Math.round(pa*255) }
  }
  return out;
}
module.exports=elevationColours;
