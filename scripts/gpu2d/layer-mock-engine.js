/* TEST ONLY: injected by layer-browser.js; never registered or loaded by app. */
(function(root){
 'use strict';
 const merc=ll=>root.CSPGpuTerrainLayer.mercator(ll);
 const sample=(lng,lat)=>({value:300+80*Math.sin(lng*100)+40*Math.cos(lat*100),rank:2,label:'Mock native elevation',z:15});
 class Store{
  constructor(options){this.options=options;this.listeners=new Set();this.wants=[];}
  on(event,fn){this.listeners.add(fn);return this;}off(event,fn){this.listeners.delete(fn);return this;}
  want(tiles){this.wants=tiles;}get(){return undefined;}finestFor(){return undefined;}
  sampleAt(lng,lat){return sample(lng,lat);}
  gridForView({bounds,zoom,maxSide}){const width=Math.min(64,maxSide),height=width,grid=new Float32Array(width*height);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)grid[y*width+x]=sample(bounds.getWest()+x/width*(bounds.getEast()-bounds.getWest()),bounds.getNorth()-y/height*(bounds.getNorth()-bounds.getSouth())).value;
   return {grid,width,height,bounds,resolution:5,z:Math.round(zoom),factor:1,provenance:['Mock native elevation'],provisional:false};}
  settled(tiles){return {complete:tiles.length,total:tiles.length,ratio:tiles.length?1:0,refining:false};}
  provenance(){return {ranks:{2:100},labels:['Mock native elevation'],surveys:[],sampleMeters:{2:5}};}
  clear(){}destroy(){this.listeners.clear();}
 }
 function needed(view){const z=Math.round(view.zoom)+view.dz,n=2**z,span=Math.ceil(Math.hypot(...view.cssSize)/(256*2**(view.zoom-z))/2)+1;
  const x=Math.floor(view.centerMerc[0]*n),y=Math.floor(view.centerMerc[1]*n),tiles=[];
  for(let yy=y-span;yy<=y+span;yy++)for(let xx=x-span;xx<=x+span;xx++)tiles.push({z,x:xx,y:yy});return tiles;}
 function screen(view,m){const world=256*2**view.zoom,a=view.bearing*Math.PI/180,dx=(m[0]-view.centerMerc[0])*world,dy=(m[1]-view.centerMerc[1])*world;
  return [view.cssSize[0]/2+Math.cos(a)*dx-Math.sin(a)*dy,view.cssSize[1]/2+Math.sin(a)*dx+Math.cos(a)*dy];}
 function paint(canvas,view,state){
  const ctx=canvas.getContext('2d'),dpr=view.dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,...view.cssSize);
  const tiles=needed(view),spectrum=state?.spectrum,visible=state?.terrain?.style!=='off'||spectrum?.spectrumOn||spectrum?.below?.enabled||spectrum?.above?.enabled;
  if(!visible)return;
  for(const tile of tiles){const n=2**tile.z,points=[[tile.x/n,tile.y/n],[(tile.x+1)/n,tile.y/n],[(tile.x+1)/n,(tile.y+1)/n],[tile.x/n,(tile.y+1)/n]].map(m=>screen(view,m));
   ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
   const value=sample(tile.x/n*360-180,Math.atan(Math.sinh(Math.PI*(1-2*tile.y/n)))*180/Math.PI).value;
   ctx.fillStyle=`rgba(${Math.round(value/2)},90,180,.25)`;ctx.fill();ctx.strokeStyle='#ff00ff';ctx.lineWidth=1;ctx.stroke();
   ctx.fillStyle='#ff00ff';ctx.font='9px monospace';ctx.fillText(`${tile.z}/${tile.x}/${tile.y}`,points[0][0]+3,points[0][1]+12);
  }
 }
 root.CSPGpuTerrainStore={VERSION:'mock',ElevationTileStore:Store};
 root.CSPGpuTerrainEngine={VERSION:'mock',create({canvas,store}){
  let state,frames=0,lastView=null;const engine={
   invalidate(){},setState(value){state=value;},render(view){lastView=structuredClone(view);frames++;store.want(needed(view));paint(canvas,view,state);return {coverage:1,missing:0};},
   neededTiles(view){const tiles=needed(view);store.want(tiles);return tiles;},
   createSnapshot(){return {release(){}};},
   async renderToCanvas(view,w,h){const out=document.createElement('canvas');out.width=w;out.height=h;paint(out,view,state);return out;},
   async readProvenance(){return store.provenance();},stats(){return {textures:0,textureBytes:0,drawCalls:1,lastFrameMs:0,frames,lastView,state};},destroy(){}};
  return engine;
 }};
 root.__gpuLayerMock={screen,merc};
})(globalThis);
