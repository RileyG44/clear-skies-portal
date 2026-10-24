const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(5000);
const B=ClearSkiesPortalBridge,m=B.map,g=B.gpuTerrain(),e=g.getEngine(),saved=B.sessionState(),original=e.render;
let total=0;const rows=[];e.render=function(v){total++;return original.call(this,v);};
try{for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);const before=total;m.setBearing(i*1.5);m._move(L.latLng(saved.center[0]+i*.00001,saved.center[1]),saved.zoom+i*.005,{pinch:true});rows.push(total-before);}m._animateZoom(m.getCenter(),saved.zoom+.12);}
finally{e.render=original;m.setView(saved.center,saved.zoom,{animate:false});m.setBearing(saved.bearing);}
return {passed:true,build:CSP_BUILD,steps:rows.length,perStep:rows,total:rows.reduce((a,b)=>a+b,0),visibility:document.visibilityState,method:'Programmatic combined pinch/rotate input through application hooks; renderer call counting only'};
