/* Validation for the map parameters the routes accept. */
"use strict";

function validBbox(value){
  if(!Array.isArray(value)||value.length!==4) return null;
  const b=value.map(Number), [w,s,e,n]=b;
  if(b.some(v=>!Number.isFinite(v))||w < -180||e > 180||s < -85.051129||n > 85.051129||w>=e||s>=n)
    return null;
  return b;
}

function csvNumbers(value,count){
  if(typeof value!=="string"||value.length>240||!/^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)*$/.test(value)) return null;
  const out=value.split(",").map(Number);
  return out.length===count&&out.every(Number.isFinite)?out:null;
}

function validMercBbox(value){
  const b=csvNumbers(value,4); if(!b) return null;
  const [w,s,e,n]=b, limit=20037508.35;
  return Math.abs(w)<=limit&&Math.abs(e)<=limit&&Math.abs(s)<=limit&&Math.abs(n)<=limit&&w<e&&s<n ? b : null;
}

const DEP_RULES = new Set(["Hillshade Gray","Hillshade Multidirectional","Hillshade Elevation Tinted",
  "Slope Map","Aspect Map","Preset 2ft Contour Interval","Preset 5ft Contour Interval",
  "Preset 10ft Contour Interval","Contour Smoothed 25"]);

/* Exported map images come at 256 px, or 512 for high-density screens - the
   same area, twice the pixels. Nothing else, so the cache keys stay few. */
function exportPixels(u){ return u.searchParams.get("size")==="512"?512:256 }

module.exports={validBbox,csvNumbers,validMercBbox,DEP_RULES,exportPixels};
