/* Clear Skies Portal — typed coordinates. Reads decimal pairs and degree,
   minute, second forms with hemisphere letters before or after either value,
   in either order; returns {lat,lng}, null for text that is not a coordinate,
   and throws for one that is but is out of range. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  root.CSPCoordinates=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function parse(value){
    const text=String(value??"").trim().replace(/[º˚]/g,"°")
      .replace(/[′’‘`]/g,"'").replace(/[″“”]/g,'"').replace(/[−–]/g,"-");
    if(!text) return null;
    const invalid=()=>{ throw new Error("Invalid coordinates: latitude must be within ±90°, longitude within ±180°, and minutes/seconds below 60.") };
    const valid=(lat,lng)=>{
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) invalid();
      return {lat,lng};
    };
    const number="(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
    const decimal=new RegExp("^([+-]?"+number+")\\s*(?:,|\\s)\\s*([+-]?"+number+")$").exec(text);
    if(decimal) return valid(+decimal[1],+decimal[2]);
    const magnitude="([+-]?"+number+")\\s*(?:°\\s*(?:("+number+")\\s*'\\s*(?:("+number+")\\s*\"\\s*)?)?)?";
    const angles={suffix:magnitude+"\\s*([NSEW])",prefix:"([NSEW])\\s*"+magnitude,plain:magnitude};
    let pair,styles;
    for(const candidate of [["suffix","suffix"],["prefix","prefix"],["prefix","suffix"],["suffix","prefix"],["plain","plain"]]){
      if(candidate[0]==="plain"&&!text.includes("°")) continue;
      const separator=candidate[0]==="plain"?"(?:\\s*[,;]\\s*|\\s+)":"\\s*[,;]?\\s*";
      pair=new RegExp("^"+angles[candidate[0]]+separator+angles[candidate[1]]+"$","i").exec(text);
      if(pair){ styles=candidate;break }
    }
    if(!pair){
      if(/^[\s\d+\-.°,;'"NSEW]+$/i.test(text)&&/[°'"]|\d\s*[NSEW]|[NSEW]\s*\d/i.test(text)) invalid();
      return null;
    }
    const readAngle=(offset,style)=>{
      const hemi=(style==="plain"?"":pair[offset+(style==="prefix"?0:3)]).toUpperCase();
      const start=offset+(style==="prefix"?1:0),raw=pair[start],degrees=Number(raw);
      const minutes=Number(pair[start+1]||0),seconds=Number(pair[start+2]||0);
      if(minutes>=60||seconds>=60) invalid();
      if(hemi&&((raw.startsWith("-")&&/[NE]/.test(hemi))||(raw.startsWith("+")&&/[SW]/.test(hemi)))) invalid();
      const negative=hemi?/[SW]/.test(hemi):raw.startsWith("-");
      return {value:(negative?-1:1)*(Math.abs(degrees)+minutes/60+seconds/3600),axis:hemi?(/[NS]/.test(hemi)?"lat":"lng"):null};
    };
    const first=readAngle(1,styles[0]),second=readAngle(styles[0]==="plain"?4:5,styles[1]);
    first.axis=first.axis||(second.axis==="lat"?"lng":"lat");
    second.axis=second.axis||(first.axis==="lat"?"lng":"lat");
    if(first.axis===second.axis) invalid();
    return first.axis==="lat"?valid(first.value,second.value):valid(second.value,first.value);
  }

  return {parse};
});
