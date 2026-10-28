/* ============================================================ pane manager
   Every sidebar block is a pane: collapsible, resizable by its bottom edge,
   and reorderable by dragging its header. Layout persists in localStorage so
   the arrangement survives a reload. ------------------------------------- */
const PANE_KEY="clearskies.panes.v1";
const panesEl=document.getElementById("panes");
const DEFAULT_ORDER=["filters","alerts","summary","passes","terrain","elevation","research","overlays","results"];
const DEFAULT_STATE=()=>({order:[...DEFAULT_ORDER], min:{filters:true, alerts:false, terrain:true, elevation:true, research:true, overlays:true}, h:{}, grow:"results"});
let paneState=DEFAULT_STATE();

function paneEl(name){ return panesEl.querySelector(`.pane[data-pane="${name}"]`) }
function setCount(name, txt){ const e=document.getElementById("n_"+name); if(e) e.textContent=txt||"" }
function showPane(name, on){ const p=paneEl(name); if(p) p.style.display = on ? "" : "none" }

/* Which sections are open is a property of the session, not a preference.
   Order, heights and which pane grows are things you arrange once and want
   back; a section left open is just where you happened to be, and restoring
   every one of them means the app opens as a wall of expanded controls you have
   to close before you can see the list of sections at all.

   sessionStorage draws exactly that line. It survives backgrounding the app,
   navigating, and rotating - so anything mid-session is remembered - and it is
   gone when the app is closed and opened again, which is when a clean start is
   what you want. */
const PANE_SESSION_KEY="clearskies.panes.session.v1";
const ALL_COLLAPSED=()=>Object.fromEntries(DEFAULT_ORDER.map(name=>[name,true]));

function loadPanes(){
  try{
    const s=JSON.parse(localStorage.getItem(PANE_KEY));
    if(s && Array.isArray(s.order)) paneState={...paneState, ...s};
  }catch(e){}
  /* Collapsed state comes from the session, never from the durable record - an
     older build stored it in localStorage, and reading that back would restore
     the wall of open panels this exists to prevent. */
  paneState.min=ALL_COLLAPSED();
  try{
    const session=JSON.parse(sessionStorage.getItem(PANE_SESSION_KEY));
    if(session && typeof session==="object") paneState.min={...paneState.min,...session};
  }catch(e){}
  // Put the newly introduced alert centre beside Filters without disturbing
  // any other ordering the user has already arranged.
  if(!paneState.order.includes("alerts")){
    const filters=paneState.order.indexOf("filters");
    paneState.order.splice(filters<0?0:filters+1,0,"alerts");
  }
  // Elevation was split out of the terrain pane; it starts beside it.
  if(!paneState.order.includes("elevation")){
    const terrain=paneState.order.indexOf("terrain");
    paneState.order.splice(terrain<0?paneState.order.length:terrain+1,0,"elevation");
  }
  // Any other pane introduced by a future update goes to the end.
  DEFAULT_ORDER.forEach(n=>{ if(!paneState.order.includes(n)) paneState.order.push(n) });
  paneState.order=paneState.order.filter(n=>DEFAULT_ORDER.includes(n));
}
function savePanes(){
  const {min,...durable}=paneState;
  try{ localStorage.setItem(PANE_KEY, JSON.stringify(durable)) }catch(e){}
  try{ sessionStorage.setItem(PANE_SESSION_KEY, JSON.stringify(min)) }catch(e){}
}

function applyPanes(){
  paneState.order.forEach(n=>{ const p=paneEl(n); if(p) panesEl.appendChild(p) });
  DEFAULT_ORDER.forEach(n=>{
    const p=paneEl(n); if(!p) return;
    p.classList.toggle("min", !!paneState.min[n]);
    const hd=p.querySelector(".pane-h");
    if(hd) hd.setAttribute("aria-expanded", String(!paneState.min[n]));
    const disclosure=p.querySelector(".pane-x");
    if(disclosure) disclosure.setAttribute("aria-expanded",String(!paneState.min[n]));
    const h=paneState.h[n];
    if(h && !paneState.min[n]){ p.classList.add("sized"); p.classList.remove("grow"); p.style.height=h+"px" }
    else { p.style.height=""; p.classList.remove("sized"); p.classList.toggle("grow", paneState.grow===n && !paneState.min[n]) }
  });
  // something must absorb the slack; fall back to the last expanded pane
  if(!panesEl.querySelector(".pane.grow")){
    const cand=[...paneState.order].reverse().find(n=>!paneState.min[n] && !paneState.h[n]);
    if(cand) paneEl(cand).classList.add("grow");
  }
}

const paneMotions=new WeakMap();

/* Safari can route wheel events from a nested flex scroller to the document
   instead of its nearest overflow ancestor unless the pointer is directly on
   the scrollbar. Explicitly hand vertical deltas to the hovered pane body,
   then chain to the pane stack only at that body's edge. Trackpads retain
   their pixel deltas; line/page-mode mice are normalized without animation. */
panesEl.addEventListener("wheel",event=>{
  if(event.ctrlKey||Math.abs(event.deltaY)<Math.abs(event.deltaX)) return;
  const unit=event.deltaMode===1?16:event.deltaMode===2?panesEl.clientHeight:1;
  const delta=event.deltaY*unit;
  const body=event.target.closest?.(".pane-b");
  const canScroll=(element,direction)=>element&&element.scrollHeight>element.clientHeight+1&&
    (direction<0?element.scrollTop>0:element.scrollTop+element.clientHeight<element.scrollHeight-1);
  const target=canScroll(body,delta)?body:canScroll(panesEl,delta)?panesEl:null;
  if(!target) return;
  event.preventDefault();event.stopPropagation();target.scrollTop+=delta;
},{passive:false});

function togglePaneAnimated(pane,focusTarget){
  if(!pane||paneMotions.has(pane)) return;
  const name=pane.dataset.pane, opening=!!paneState.min[name];
  const finishFocus=()=>requestAnimationFrame(()=>focusTarget?.focus({preventScroll:true}));
  /* Native disclosure rows animate in SwiftUI. Animating their offscreen
     web pane can leave a close pending and discard the next open action. */
  if(window.CSPNativeHost||matchMedia("(prefers-reduced-motion: reduce)").matches){
    paneState.min[name]=!opening; applyPanes(); savePanes(); reflowMap(); finishFocus(); return;
  }
  const head=pane.querySelector(".pane-h"), body=pane.querySelector(".pane-b");
  if(opening){
    const start=Math.ceil(head.getBoundingClientRect().height);
    paneState.min[name]=false; applyPanes(); savePanes();
    const end=Math.max(start,Math.ceil(pane.getBoundingClientRect().height));
    pane.style.overflow="hidden";
    body?.animate([{opacity:0,transform:"translateY(-6px)"},{opacity:1,transform:"translateY(0)"}],
      {duration:260,easing:"cubic-bezier(.2,.85,.25,1)"});
    const motion=pane.animate([{height:start+"px"},{height:end+"px"}],
      {duration:340,easing:"cubic-bezier(.2,.9,.25,1)"});
    paneMotions.set(pane,motion);
    motion.onfinish=()=>{ paneMotions.delete(pane); pane.style.overflow=""; reflowMap(); finishFocus() };
  }else{
    const start=Math.ceil(pane.getBoundingClientRect().height), end=Math.ceil(head.getBoundingClientRect().height);
    pane.style.overflow="hidden";
    body?.animate([{opacity:1,transform:"translateY(0)"},{opacity:0,transform:"translateY(-5px)"}],
      {duration:190,easing:"cubic-bezier(.4,0,1,1)"});
    const motion=pane.animate([{height:start+"px"},{height:end+"px"}],
      {duration:260,easing:"cubic-bezier(.4,0,.2,1)"});
    paneMotions.set(pane,motion);
    motion.onfinish=()=>{
      paneMotions.delete(pane); pane.style.overflow=""; paneState.min[name]=true;
      applyPanes(); savePanes(); reflowMap(); finishFocus();
    };
  }
}

/* A normal tap anywhere on a pane header opens or closes it. Reordering is a
   separate press-and-hold gesture, so a quick tap can never move a panel out
   from under the person's finger. The held card follows the pointer, a live
   placeholder reflows the stack, and displaced panes settle with FLIP motion. */
let hdrag=null;
const paneLive=$("#paneLive");
const PANE_REORDER_HOLD_MS=260;
function clearPaneHold(d){ if(d?.holdTimer){ clearTimeout(d.holdTimer); d.holdTimer=0 } }
function visiblePanes(exclude){
  return [...panesEl.querySelectorAll(".pane")].filter(p=>p!==exclude&&p.style.display!=="none");
}
function paneRects(exclude){ return new Map(visiblePanes(exclude).map(p=>[p,p.getBoundingClientRect()])) }
function animatePaneFlip(before,exclude){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  visiblePanes(exclude).forEach(p=>{
    const a=before.get(p),b=p.getBoundingClientRect();if(!a||Math.abs(a.top-b.top)<.5) return;
    p.animate([{transform:`translateY(${a.top-b.top}px)`},{transform:"translateY(0)"}],
      {duration:280,easing:"cubic-bezier(.2,.85,.25,1)"});
  });
}
function removeCloneIds(root){ root.removeAttribute?.("id");root.querySelectorAll?.("[id]").forEach(el=>el.removeAttribute("id")) }
function startPaneDrag(d){
  const r=d.p.getBoundingClientRect(),placeholder=document.createElement("div"),ghost=d.p.cloneNode(true);
  placeholder.className="pane-placeholder";placeholder.style.height=Math.round(r.height)+"px";
  d.panesBefore=paneRects(d.p);d.startOrder=[...panesEl.querySelectorAll(".pane")].map(p=>p.dataset.pane);
  panesEl.insertBefore(placeholder,d.p);
  d.p.classList.add("pane-drag-source");d.p.style.width=Math.round(r.width)+"px";
  removeCloneIds(ghost);ghost.classList.remove("pane-drag-source","grow","sized");ghost.classList.add("pane-drag-ghost");
  ghost.setAttribute("aria-hidden","true");ghost.inert=true;
  /* An expanded tools pane can be taller than the viewport. Its moving card is
     deliberately clipped to a compact preview while the exact-height slot
     remains in the stack, like rearranging an iOS widget. */
  Object.assign(ghost.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:Math.min(r.height,260)+"px"});
  document.body.appendChild(ghost);
  Object.assign(d,{moved:true,placeholder,ghost,grabY:d.y0-r.top,top:r.top});
  document.body.classList.add("pane-reordering");navigator.vibrate?.(8);
}
function movePanePlaceholder(d,y){
  const list=visiblePanes(d.p),before=paneRects(d.p);
  let placed=false;
  for(const target of list){
    const r=target.getBoundingClientRect();
    if(y<r.top+r.height/2){ panesEl.insertBefore(d.placeholder,target);placed=true;break }
  }
  if(!placed) panesEl.appendChild(d.placeholder);
  animatePaneFlip(before,d.p);
}
function finishPaneDrag(e,cancel=false){
  const d=hdrag;if(!d||d.pointerId!==e.pointerId) return;
  clearPaneHold(d);hdrag=null;
  if(!d.moved){
    if(!cancel&&!d.movedBeforeHold) togglePaneAnimated(d.p,d.hd);
    return;
  }
  if(cancel){
    d.p.classList.remove("pane-drag-source");d.p.style.width="";
    d.placeholder.remove();d.startOrder.forEach(name=>{ const p=paneEl(name);if(p) panesEl.appendChild(p) });
  }else{
    panesEl.insertBefore(d.p,d.placeholder);d.placeholder.remove();
    d.p.classList.remove("pane-drag-source");d.p.style.width="";
    const final=d.p.getBoundingClientRect(),visual=d.ghost.getBoundingClientRect();
    if(!matchMedia("(prefers-reduced-motion: reduce)").matches)
      d.p.animate([{transform:`translateY(${visual.top-final.top}px) scale(1.012)`},{transform:"translateY(0) scale(1)"}],
        {duration:300,easing:"cubic-bezier(.2,.9,.25,1)"});
    paneState.order=[...panesEl.querySelectorAll(".pane")].map(p=>p.dataset.pane);
    savePanes();paneLive.textContent=`${d.p.querySelector(".pane-t")?.textContent||"Pane"} moved.`;navigator.vibrate?.(5);
  }
  d.ghost.remove();document.body.classList.remove("pane-reordering");applyPanes();reflowMap();
}
panesEl.querySelectorAll(".pane-h").forEach(hd=>{
  const pane=hd.parentElement,body=pane.querySelector(".pane-b"),disclosure=pane.querySelector(".pane-x");
  const contentId=`pane-${pane.dataset.pane}-content`,title=pane.querySelector(".pane-t")?.textContent||"pane";
  if(body) body.id=contentId;
  hd.tabIndex=0;hd.setAttribute("role","button");hd.setAttribute("aria-controls",contentId);
  hd.setAttribute("aria-label",`Toggle ${title}. Press and hold to reorder.`);
  disclosure.tabIndex=0;disclosure.setAttribute("role","button");disclosure.setAttribute("aria-controls",contentId);
  const toggle=e=>{ e?.preventDefault();e?.stopPropagation();togglePaneAnimated(pane,disclosure) };
  disclosure.addEventListener("click",toggle);
  disclosure.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" ") toggle(e) });
  hd.addEventListener("keydown",e=>{
    if(!e.altKey&&(e.key==="Enter"||e.key===" ")){ e.preventDefault();togglePaneAnimated(pane,hd);return }
    if(!e.altKey||(e.key!=="ArrowUp"&&e.key!=="ArrowDown")) return;
    e.preventDefault();const visible=visiblePanes(),old=visible.indexOf(pane),next=old+(e.key==="ArrowUp"?-1:1);
    if(next<0||next>=visible.length) return;
    const before=paneRects();
    if(next>old) panesEl.insertBefore(pane,visible[next].nextSibling);else panesEl.insertBefore(pane,visible[next]);
    animatePaneFlip(before,pane);paneState.order=[...panesEl.querySelectorAll(".pane")].map(p=>p.dataset.pane);savePanes();
    paneLive.textContent=`${title} moved ${e.key==="ArrowUp"?"up":"down"}.`;requestAnimationFrame(()=>hd.focus({preventScroll:true}));
  });
  hd.addEventListener("pointerdown",e=>{
    if(e.button!==0||e.target.closest(".pane-x,button,input,select,a")) return;
    e.preventDefault();hdrag={p:pane,hd,pointerId:e.pointerId,x0:e.clientX,y0:e.clientY,moved:false,movedBeforeHold:false,holdTimer:0};
    try{ hd.setPointerCapture(e.pointerId) }catch(err){}
    const d=hdrag;
    d.holdTimer=setTimeout(()=>{
      if(hdrag!==d||d.movedBeforeHold) return;
      startPaneDrag(d);
    },PANE_REORDER_HOLD_MS);
  });
});
/* Pointer capture is not reliable once the source card leaves normal layout in
   Safari. Capture at the document boundary as well, so mouse, Pencil and touch
   drops always settle the placeholder instead of leaving the UI in drag mode. */
document.addEventListener("pointermove",e=>{
  const d=hdrag;if(!d||d.pointerId!==e.pointerId) return;
  if(!d.moved){
    if(Math.hypot(e.clientX-d.x0,e.clientY-d.y0)>=7){ d.movedBeforeHold=true;clearPaneHold(d) }
    return;
  }
  e.preventDefault();
  const scrollRect=panesEl.getBoundingClientRect();
  if(e.clientY<scrollRect.top+46) panesEl.scrollTop-=14;else if(e.clientY>scrollRect.bottom-46) panesEl.scrollTop+=14;
  d.ghost.style.top=Math.round(e.clientY-d.grabY)+"px";movePanePlaceholder(d,e.clientY);
},{capture:true,passive:false});
document.addEventListener("pointerup",e=>finishPaneDrag(e,false),true);
document.addEventListener("pointercancel",e=>finishPaneDrag(e,true),true);
window.addEventListener("blur",()=>{ if(hdrag) finishPaneDrag({pointerId:hdrag.pointerId},true) });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&hdrag) finishPaneDrag({pointerId:hdrag.pointerId},true) });

/* resize by the bottom edge */
let rz=null;
panesEl.querySelectorAll(".pane-rz").forEach(g=>{
  g.addEventListener("pointerdown", e=>{
    e.preventDefault(); e.stopPropagation();
    const p=g.parentElement;
    rz={p, g, name:p.dataset.pane, y0:e.clientY, h0:p.getBoundingClientRect().height};
    try{ g.setPointerCapture(e.pointerId) }catch(err){}
    g.classList.add("act"); document.body.classList.add("rowdrag");
  });
  g.addEventListener("pointermove", e=>{
    if(!rz || rz.g!==g) return;
    const nh=Math.max(56, Math.min(760, rz.h0 + (e.clientY - rz.y0)));
    rz.p.classList.add("sized"); rz.p.classList.remove("grow");
    rz.p.style.height=nh+"px";
  });
  const finish=()=>{
    if(!rz || rz.g!==g) return;
    paneState.h[rz.name]=Math.round(rz.p.getBoundingClientRect().height);
    if(paneState.grow===rz.name) paneState.grow=null;
    g.classList.remove("act"); document.body.classList.remove("rowdrag");
    rz=null; applyPanes(); savePanes(); map.invalidateSize({pan:false});
  };
  g.addEventListener("pointerup", finish);
  g.addEventListener("pointercancel", finish);
  g.addEventListener("dblclick", ()=>{
    const n=g.parentElement.dataset.pane;
    delete paneState.h[n]; applyPanes(); savePanes(); map.invalidateSize({pan:false});
  });
});

document.getElementById("resetPanes").onclick=()=>{
  paneState=DEFAULT_STATE();
  applyPanes(); savePanes(); map.invalidateSize({pan:false});
};

loadPanes(); applyPanes();
showPane("summary", false); showPane("passes", false);


