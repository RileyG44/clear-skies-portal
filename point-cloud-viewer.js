"use strict";

(function(){
  const CORE=()=>window.CSPPointCloudCore;
  const $=selector=>document.querySelector(selector);
  const RUNTIME=[
    "vendor/potree/libs/jquery/jquery-3.1.1.min.js",
    "vendor/potree/libs/other/BinaryHeap.js",
    "vendor/potree/libs/tween/tween.min.js",
    "vendor/potree/libs/proj4/proj4.js",
    "vendor/potree/libs/copc/index.js",
    "vendor/potree/build/potree/potree.js"
  ];
  let runtimePromise=null;
  function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(`Could not load ${src}`));document.head.appendChild(s)})}
  function loadRuntime(){
    if(runtimePromise)return runtimePromise;
    runtimePromise=(async()=>{
      if(!$("link[data-potree]")){const link=document.createElement("link");link.rel="stylesheet";link.href="vendor/potree/build/potree/potree.css";link.dataset.potree="";document.head.appendChild(link)}
      for(const src of RUNTIME)await loadScript(src);
      if(!window.Potree?.Viewer)throw new Error("Potree did not initialise");
      return window.Potree;
    })();return runtimePromise;
  }
  async function catalog(){
    const key="csp-point-cloud-catalog-v1",ttl=30*864e5;
    try{const hit=JSON.parse(localStorage.getItem(key)||"null");if(hit&&Date.now()-hit.savedAt<ttl&&hit.data?.projects?.length)return hit.data}catch(e){}
    const response=await fetch("./point-cloud-catalog.json",{cache:"no-cache"});if(!response.ok)throw new Error(`Coverage index HTTP ${response.status}`);
    const data=await response.json();try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),data}))}catch(e){}return data;
  }
  function setOutput(id,value){const out=$(id);if(out)out.value=out.textContent=value}
  function setStatus(text,state=""){$("#pcStatus").textContent=text;$("#pcStatus").dataset.state=state}
  function projectBounds(bounds){return {west:bounds.getWest(),east:bounds.getEast(),south:bounds.getSouth(),north:bounds.getNorth()}}
  function classVisibility(cloud,visible){
    if(!cloud)return;const scheme=cloud.material.classification;
    const known=new Set(Object.keys(visible).filter(code=>code!=="other"));
    for(const code of Object.keys(scheme)){if(code==="DEFAULT")scheme[code].visible=!!visible.other;else scheme[code].visible=known.has(code)?!!visible[code]:!!visible.other}
    cloud.material.recomputeClassification();
  }
  function trackWorkers(Potree){
    const pool=Potree?.workerPool;if(!pool||pool._cspTracking)return;
    pool._cspTracking=true;pool._cspWorkers=new Set();const get=pool.getWorker.bind(pool),giveBack=pool.returnWorker.bind(pool);
    pool.getWorker=function(url){const worker=get(url);pool._cspWorkers.add(worker);return worker};
    pool.returnWorker=function(url,worker){pool._cspWorkers.add(worker);return giveBack(url,worker)};
  }
  function terminateWorkers(Potree){
    const pool=Potree?.workerPool;if(!pool)return;
    for(const worker of pool._cspWorkers||[])try{worker.terminate()}catch(e){}
    const pools=pool.workers||{};for(const list of Object.values(pools))for(const worker of list||[])try{worker.terminate()}catch(e){}
    pool.workers={};pool._cspWorkers=new Set();
  }
  function destroyViewer(state){
    const viewer=state.viewer;if(!viewer)return;
    try{viewer.renderer.setAnimationLoop(null)}catch(e){}
    for(const cloud of [...(viewer.scene?.pointclouds||[])]){
      for(const node of cloud.visibleNodes||[])try{node.sceneNode?.geometry?.dispose()}catch(e){}
      try{cloud.material?.dispose()}catch(e){}try{viewer.scene.removePointCloud(cloud)}catch(e){}
    }
    try{viewer.renderer.dispose()}catch(e){}try{viewer.renderer.forceContextLoss()}catch(e){}
    terminateWorkers(window.Potree);state.viewer=null;state.cloud=null;state.project=null;
    for(const child of [...$("#pcCanvas").children])if(!child.classList.contains("pc-head"))child.remove();
  }
  function install({map,onBearingChange,beforeOpen,onLayoutChange}={}){
    const panel=$("#pointCloudPanel"),canvas=$("#pcCanvas"),state={viewer:null,cloud:null,project:null,loadingProject:null,catalog:null,wanted:false,loadToken:0,suppress2d:0,suppress3d:0,cameraTimer:0,plan:true,user3dActive:false,user3dUntil:0,syncGuard:CORE().createSyncGuard()};
    window.L?.DomEvent?.disableClickPropagation(panel);window.L?.DomEvent?.disableScrollPropagation(panel);
    const linked=()=>$("#pcLinked").checked;
    function removeCloud(){if(state.cloud){try{state.viewer?.scene?.removePointCloud(state.cloud)}catch(e){}for(const node of state.cloud.visibleNodes||[])try{node.sceneNode?.geometry?.dispose()}catch(e){}}state.cloud=null;state.project=null}
    async function ensureViewer(){
      if(state.viewer)return state.viewer;const Potree=await loadRuntime();if(!state.wanted)return null;
      trackWorkers(Potree);const viewer=state.viewer=new Potree.Viewer(canvas);holdCamera(viewer);viewer.setFOV(60);viewer.setPointBudget(3_000_000);viewer.setEDLEnabled(true);viewer.setEDLStrength(1);viewer.setEDLRadius(1.4);viewer.setBackground("gradient");
      viewer.addEventListener("camera_changed",()=>{
        if(!linked()||state.syncGuard.active==="2d"||performance.now()<state.suppress3d||(!state.user3dActive&&performance.now()>state.user3dUntil))return;
        clearTimeout(state.cameraTimer);state.cameraTimer=setTimeout(syncToMap,120);
      });
      applyControls();return viewer;
    }
    /* Wheel and drag input lives in the controls as pending deltas that Potree
       drains a frame later. Whenever the camera is written directly, that
       pending input is stale - it was sized against the camera that has just
       been replaced - so applying it moves the view by an amount that no longer
       means anything. Dropping it is the difference between a sync that lands
       and one that gets dragged somewhere arbitrary a frame afterwards. */
    function dropPendingInput(viewer){
      const controls=viewer?.controls;if(!controls)return;
      controls.radiusDelta=0;controls.yawDelta=0;controls.pitchDelta=0;
      controls.panDelta?.set?.(0,0);
      controls.stopTweens?.();
    }
    function holdCamera(viewer){
      const view=viewer?.scene?.view;if(!view)return view;
      CORE().limitPitch(view);
      CORE().installRadiusFloor(view,()=>dropPendingInput(viewer));
      return view;
    }
    function syncFromMap(){
      if(!state.viewer||!state.cloud||!linked())return;const view=state.viewer.scene.view,box=state.cloud.boundingBox||state.cloud.pcoGeometry?.boundingBox;
      /* Aim at the ground actually under the map centre. The bounding-box
         midpoint used before is a project-wide average, which on high terrain
         sits well below the surface - harmless while zoomed out, but the camera
         descends onto it as the radius shrinks and ends up inside the hill. */
      const ground=CORE().projectBounds(projectBounds(map.getBounds()));
      const z=CORE().groundHeightFromNodes(state.cloud.visibleNodes,(ground.west+ground.east)/2,(ground.south+ground.north)/2,(box?.min?.z+box?.max?.z)/2||0);
      /* A freshly loaded cloud opens looking straight down. After that the sync
         keeps whatever tilt the user has orbited to, so panning the 2D map does
         not yank the 3D view back to plan every time. */
      /* Re-assert the horizon clamp on every sync: Potree recreates scene.view
         with its own wide-open limits whenever a scene is swapped in, and a view
         that has slipped under the ground must be lifted back out before its
         tilt is read, not after. */
      holdCamera(state.viewer);
      const pitch=state.plan?90:CORE().pitchDegreesFromView(view.pitch);
      const rect=canvas.getBoundingClientRect(),camera=CORE().cameraForBounds(projectBounds(map.getBounds()),{bearing:map.getBearing?.()||0,targetZ:z,fov:state.viewer.getFOV?.()||60,aspect:rect.width/Math.max(1,rect.height),pitch});
      state.plan=false;
      state.suppress3d=performance.now()+300;
      state.syncGuard.run("2d",()=>{
        /* Not view.setView(position,target): Potree infers yaw from the look
           vector, and straight down carries no yaw, so the bearing would be
           dropped and the view would land at an arbitrary rotation. Set the
           camera state directly instead. */
        view.position.set(camera.position.x,camera.position.y,camera.position.z);
        view.yaw=camera.yaw;
        view.pitch=camera.pitch;
        view.radius=camera.radius;
        dropPendingInput(state.viewer);
      });
    }
    function syncToMap(){
      if(!state.viewer||!state.cloud||!linked())return;const view=state.viewer.scene.view,target=view.getPivot(),bearing=((view.yaw*180/Math.PI)%360+360)%360;
      const next=CORE().mapViewForCamera(target,view.radius,{height:map.getSize().y,fov:state.viewer.getFOV?.()||60,bearing});
      state.suppress2d=performance.now()+300;state.syncGuard.run("3d",()=>{map.setView([next.lat,next.lon],Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),next.zoom)),{animate:false});map.setBearing?.(next.bearing);onBearingChange?.()});
    }
    async function loadCurrent(){
      if(!state.wanted)return;const center=map.getCenter(),item=CORE().chooseCoverage(state.catalog?.projects,center.lng,center.lat);
      if(!item){state.loadToken++;state.loadingProject=null;removeCloud();setStatus("No USGS point-cloud coverage at this map centre.","empty");return}
      if(state.project===item.project&&state.cloud){syncFromMap();return}
      if(state.loadingProject===item.project)return;
      const viewer=await ensureViewer();if(!viewer||!state.wanted)return;const token=++state.loadToken;setStatus(`Loading ${item.project}…`,"loading");
      state.loadingProject=item.project;removeCloud();
      window.Potree.loadPointCloud(item.url,item.project,event=>{
        if(token!==state.loadToken||!state.wanted)return;state.loadingProject=null;state.plan=true;const cloud=state.cloud=event.pointcloud;state.project=item.project;cloud.material.size=1;cloud.material.pointSizeType=window.Potree.PointSizeType.ADAPTIVE;cloud.material.activeAttributeName="elevation";viewer.scene.addPointCloud(cloud);applyControls();syncFromMap();setStatus(`${item.project} · ${(item.points/1e9).toFixed(1)} billion points available`,"ready");
      });
    }
    async function open(){
      if(state.wanted)return;beforeOpen?.();state.wanted=true;panel.hidden=false;applyDetent(detent,false);document.body.classList.add("point-cloud-open");$("#terModePoints").setAttribute("aria-pressed","true");onLayoutChange?.("right");setStatus("Loading Washington coverage index…","loading");
      try{state.catalog=state.catalog||await catalog();await ensureViewer();await loadCurrent()}catch(error){console.warn("Point cloud:",error);setStatus(error.message||"Point cloud could not start.","error")}
    }
    function close(){state.wanted=false;state.loadingProject=null;state.user3dActive=false;state.user3dUntil=0;state.loadToken++;clearTimeout(state.cameraTimer);destroyViewer(state);panel.hidden=true;document.body.classList.remove("point-cloud-open");$("#terModePoints").setAttribute("aria-pressed","false");onLayoutChange?.("right")}
    function applyControls(){
      const viewer=state.viewer,cloud=state.cloud;if(viewer){viewer.setPointBudget(+$("#pcBudget").value*1e6);viewer.setEDLEnabled($("#pcEdl").checked);viewer.setEDLStrength(+$("#pcEdlStrength").value);viewer.setEDLRadius(+$("#pcEdlRadius").value)}
      if(cloud){cloud.material.size=+$("#pcSize").value;cloud.material.pointSizeType=$("#pcSizeMode").value==="fixed"?window.Potree.PointSizeType.FIXED:window.Potree.PointSizeType.ADAPTIVE;cloud.material.activeAttributeName=$("#pcColour").value;const visible={};document.querySelectorAll("[data-pc-class]").forEach(input=>visible[input.dataset.pcClass]=input.checked);classVisibility(cloud,visible)}
      setOutput("#pcBudgetOut",`${$("#pcBudget").value} M`);setOutput("#pcSizeOut",(+$("#pcSize").value).toFixed(1));setOutput("#pcEdlStrengthOut",(+$("#pcEdlStrength").value).toFixed(1));setOutput("#pcEdlRadiusOut",(+$("#pcEdlRadius").value).toFixed(1));
    }
    map.on("moveend rotate",()=>{if(!state.wanted||state.syncGuard.active==="3d"||performance.now()<state.suppress2d||!linked())return;loadCurrent()});
    canvas.addEventListener("pointerdown",()=>{state.user3dActive=true;state.user3dUntil=Infinity},true);
    addEventListener("pointerup",()=>{if(!state.user3dActive)return;state.user3dActive=false;state.user3dUntil=performance.now()+350},true);
    addEventListener("pointercancel",()=>{state.user3dActive=false;state.user3dUntil=0},true);
    canvas.addEventListener("wheel",()=>{state.user3dUntil=performance.now()+500},{capture:true,passive:true});
    $("#terModePoints").addEventListener("click",()=>state.wanted?close():open());$("#pcClose").addEventListener("click",close);$("#pcLinked").addEventListener("change",()=>{if(linked())syncFromMap()});
    for(const id of ["#pcBudget","#pcSize","#pcSizeMode","#pcColour","#pcEdl","#pcEdlStrength","#pcEdlRadius"])$(id).addEventListener("input",applyControls);
    document.querySelectorAll("[data-pc-class]").forEach(input=>input.addEventListener("change",applyControls));
    $("#pcBareEarth").addEventListener("click",()=>{document.querySelectorAll("[data-pc-class]").forEach(x=>x.checked=x.dataset.pcClass==="2");applyControls()});
    $("#pcAllReturns").addEventListener("click",()=>{document.querySelectorAll("[data-pc-class]").forEach(x=>x.checked=true);applyControls()});
    $("#pcReset").addEventListener("click",()=>{$("#pcBudget").value=3;$("#pcSize").value=1;$("#pcSizeMode").value="adaptive";$("#pcColour").value="elevation";$("#pcEdl").checked=true;$("#pcEdlStrength").value=1;$("#pcEdlRadius").value=1.4;document.querySelectorAll("[data-pc-class]").forEach(x=>x.checked=true);applyControls();syncFromMap()});
    function drag(handle,move){handle.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();handle.setPointerCapture(event.pointerId);const onMove=e=>move(e);const stop=()=>{handle.removeEventListener("pointermove",onMove);handle.removeEventListener("pointerup",stop);handle.removeEventListener("pointercancel",stop)};handle.addEventListener("pointermove",onMove);handle.addEventListener("pointerup",stop);handle.addEventListener("pointercancel",stop)})}
    let preferredWidth=+localStorage.getItem("csp-pc-width")||560;
    const narrow=()=>matchMedia("(max-width:760px)").matches;

    /* ---------------------------------------------------------- mobile sheet
       On a phone the panel is a detented bottom sheet rather than a fixed slab.
       Peek keeps the map usable with the status line still legible, half is the
       working view, full is for the controls. Heights are resolved to pixels so
       the drag, the snap and the CSS transition are all working in the same
       units - mixing dvh into the drag maths makes the snap disagree with the
       finger by however much the browser toolbar happens to be occupying. */
    const DETENTS=["peek","half","full"];
    const SHEET_KEY="csp-pc-detent";
    let detent=localStorage.getItem(SHEET_KEY);
    if(!DETENTS.includes(detent)) detent="half";

    function peekHeight(){
      /* Measured, not guessed: the header wraps differently with the status
         text and the safe-area inset varies by device. */
      const grabber=$("#pcGrabber"),head=panel.querySelector(".pc-head");
      const measured=(grabber?.offsetHeight||26)+(head?.offsetHeight||44)+12;
      return Math.round(measured+safeBottom());
    }
    function safeBottom(){
      return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom"))||0;
    }
    function maxHeight(){ return Math.round(innerHeight*0.94) }
    function detentHeight(name){
      if(name==="peek") return peekHeight();
      if(name==="full") return maxHeight();
      return Math.round(Math.min(maxHeight(),Math.max(peekHeight()+120,innerHeight*0.58)));
    }
    function resizeViewer(){
      const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);
      state.viewer?.renderer?.setSize(width,height);
    }
    function applyDetent(name,persist){
      detent=DETENTS.includes(name)?name:"half";
      panel.dataset.detent=detent;
      $("#pcGrabber")?.setAttribute("aria-label",
        detent==="full"?"Collapse the point-cloud sheet":"Expand the point-cloud sheet");
      if(!narrow()){ panel.style.removeProperty("--pc-sheet"); return }
      panel.style.setProperty("--pc-sheet",`${detentHeight(detent)}px`);
      if(persist!==false) try{ localStorage.setItem(SHEET_KEY,detent) }catch(e){}
      /* The transition runs for 340ms; Potree resizes itself from renderArea
         every frame, so this is only to get the first frame right at the new
         size rather than one frame late. */
      resizeViewer();
      setTimeout(resizeViewer,360);
    }
    function nearestDetent(height,velocity){
      /* A deliberate flick moves exactly one detent, which is what makes a
         sheet feel like it obeys you rather than snapping wherever it likes.
         Below that threshold, fall back to whichever detent is closest. */
      const index=DETENTS.indexOf(detent);
      if(velocity<-0.5) return DETENTS[Math.min(DETENTS.length-1,index+1)];
      if(velocity>0.5) return index===0?null:DETENTS[index-1];
      let best=DETENTS[0],gap=Infinity;
      for(const name of DETENTS){
        const distance=Math.abs(detentHeight(name)-height);
        if(distance<gap){ gap=distance;best=name }
      }
      return best;
    }
    /* Only the grabber and the header drag the sheet. Dragging from the
       scrolling control list as well would mean arbitrating between a scroll
       and a drag on every touch, and getting that wrong costs you the ability
       to scroll at all - a 70px always-visible handle is the honest trade. */
    function startSheetDrag(event){
      if(!narrow()||event.button>0) return;
      if(event.target.closest("#pcClose, .pc-link")) return;
      const startY=event.clientY,startHeight=panel.getBoundingClientRect().height;
      const lowest=peekHeight(),highest=maxHeight();
      let lastY=startY,lastAt=event.timeStamp||performance.now(),velocity=0,moved=false;
      panel.classList.add("pc-dragging");
      const target=event.currentTarget;
      try{ target.setPointerCapture(event.pointerId) }catch(e){}
      const onMove=move=>{
        const now=move.timeStamp||performance.now(),dt=Math.max(1,now-lastAt);
        velocity=(move.clientY-lastY)/dt;                       // px/ms, down positive
        lastY=move.clientY;lastAt=now;
        let height=startHeight+(startY-move.clientY);
        if(Math.abs(startY-move.clientY)>3) moved=true;
        /* Rubber band past the top stop so the sheet reads as elastic rather
           than jammed, and never past the bottom stop into a negative height. */
        if(height>highest) height=highest+(height-highest)*0.22;
        panel.style.setProperty("--pc-sheet",`${Math.max(24,height)}px`);
        resizeViewer();
      };
      const finish=end=>{
        lastPointerAt=performance.now();
        target.removeEventListener("pointermove",onMove);
        target.removeEventListener("pointerup",finish);
        target.removeEventListener("pointercancel",finish);
        panel.classList.remove("pc-dragging");
        if(!moved){ cycleDetent(); return }
        const height=panel.getBoundingClientRect().height;
        const next=nearestDetent(height,velocity);
        /* A firm flick down from the smallest detent dismisses, which is the
           gesture a sheet is expected to answer. */
        if(next===null||(velocity>0.5&&height<=lowest+8)){ close(); return }
        applyDetent(next);
      };
      target.addEventListener("pointermove",onMove);
      target.addEventListener("pointerup",finish);
      target.addEventListener("pointercancel",finish);
      event.preventDefault();
    }
    /* Wraps rather than bouncing between the top two: peek is where the map is
       usable again, so it has to be reachable by tapping and not only by
       knowing that the sheet can be dragged. */
    function cycleDetent(){
      const index=DETENTS.indexOf(detent);
      applyDetent(DETENTS[(index+1)%DETENTS.length]);
    }
    $("#pcGrabber")?.addEventListener("pointerdown",startSheetDrag);
    panel.querySelector(".pc-head")?.addEventListener("pointerdown",startSheetDrag);
    /* A touch tap reports click.detail === 0, exactly like a keyboard
       activation, so telling them apart that way cycled the sheet twice and it
       landed back where it started. Time since the pointer sequence is the
       distinguishing signal: a keyboard press has no pointer sequence at all. */
    let lastPointerAt=0;
    $("#pcGrabber")?.addEventListener("click",()=>{
      if(performance.now()-lastPointerAt>400) cycleDetent();
    });

    /* Below the breakpoint the panel is a full-width bottom sheet laid out by
       CSS (left/right pinned to the safe area). An inline width would override
       that -- and did: the saved desktop width was applied unconditionally at
       startup, so a 560px panel sat on a 375px phone and hung off the right
       edge. Clear it on narrow viewports, and re-apply on the way back so
       rotating a phone does not strand either state. */
    /* The single place the panel's inline width is written, so the breakpoint
       check cannot be forgotten at one call site the way it was at startup. */
    function setPanelWidth(px){
      if(narrow()) panel.style.removeProperty("width");
      else panel.style.width=`${px}px`;
      resizeViewer();
    }
    /* One entry point for both axes: the width rule below the breakpoint and
       the sheet height above it are the same decision, and splitting them is
       how the startup bug that stranded a 560px panel on a phone happened. */
    function applyPanelWidth(){ setPanelWidth(preferredWidth); applyDetent(detent,false) }

    function fitAgainstLeft(leftEdge,gap=12){
      if(narrow()||panel.hidden){ if(narrow()) applyPanelWidth(); return }
      const css=getComputedStyle(document.documentElement),safeRight=parseFloat(css.getPropertyValue("--safe-right"))||0;
      setPanelWidth(Math.max(380,Math.min(preferredWidth,innerWidth-safeRight-8-leftEdge-gap)));
    }
    drag($("#pcWidthHandle"),event=>{if(narrow())return;preferredWidth=Math.max(380,Math.min(innerWidth-300,innerWidth-event.clientX-8));setPanelWidth(preferredWidth);localStorage.setItem("csp-pc-width",preferredWidth);onLayoutChange?.("right")});
    drag($("#pcSplitHandle"),event=>{const r=panel.getBoundingClientRect(),split=Math.max(.35,Math.min(.78,(event.clientY-r.top)/r.height));panel.style.setProperty("--pc-split",`${split*100}%`);localStorage.setItem("csp-pc-split",split)});
    const split=+localStorage.getItem("csp-pc-split");applyPanelWidth();if(split)panel.style.setProperty("--pc-split",`${split*100}%`);
    addEventListener("resize",()=>{applyPanelWidth();onLayoutChange?.("right")});
    /* iOS Safari changes the viewport when its toolbar collapses, and that
       arrives on visualViewport rather than as a window resize. Potree resizes
       its own renderer from renderArea every frame, so the canvas is not the
       concern -- this is here so the breakpoint is re-evaluated and the 2D
       sidebar is re-fitted when the viewport changes without a window resize.
       Coalesced, because visualViewport scroll fires continuously while the
       toolbar animates. */
    let vvTimer=0;
    const onVisualViewport=()=>{clearTimeout(vvTimer);vvTimer=setTimeout(()=>{applyPanelWidth();onLayoutChange?.("right")},120)};
    visualViewport?.addEventListener("resize",onVisualViewport);
    visualViewport?.addEventListener("scroll",onVisualViewport);
    /* iOS fires orientationchange before the new viewport metrics settle, so
       re-run once the layout has actually changed. */
    addEventListener("orientationchange",()=>setTimeout(()=>{applyPanelWidth();onLayoutChange?.("right")},250));
    matchMedia("(max-width:760px)").addEventListener?.("change",applyPanelWidth);
    return {open,close,fitAgainstLeft,get active(){return state.wanted}};
  }
  window.CSPPointCloud={install};
})();
