/* Clear Skies Portal — analysis layer stack.
 *
 * Surface-analysis rasters (sky-view factor, openness, drainage, sun, wind…)
 * as a stack of up to MAX_LAYERS layers, each with its own palette, relief
 * shading, blend mode and opacity. This file is the view and the small pure
 * model; index.html owns the rasters and the map. The same view is mounted in
 * the Analyze panel and in the LiDAR Studio's Layers list, and it reuses the
 * studio's look (ls-* classes) so the two stacks read as one.
 *
 *   const view = CSPAnalysisLayers.mount(container, host);
 *   host.layers()            -> layer descriptors, top first (see describe())
 *   host.catalog()           -> [{group, items:[{id, label, hint, swatch}]}]
 *   host.add(product)        host.update(id, patch)
 *   host.remove(id)          host.move(id, +1 up | -1 down)
 *   view.refresh()           -> re-read the host; rebuilds only when needed
 *   view.expand(id)          -> open one layer's editor */
(function(root,factory){
  "use strict";
  if(typeof module==="object"&&module.exports) module.exports=factory();
  else root.CSPAnalysisLayers=factory();
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const MAX_LAYERS=3;
  const BLENDS=Object.freeze([
    {id:"normal",label:"Normal"},{id:"multiply",label:"Multiply"},{id:"screen",label:"Screen"},
    {id:"overlay",label:"Overlay"},{id:"soft-light",label:"Soft light"},{id:"hard-light",label:"Hard light"},
    {id:"darken",label:"Darken"},{id:"lighten",label:"Lighten"},{id:"color",label:"Colour"},{id:"luminosity",label:"Luminosity"}
  ]);
  const BLEND_IDS=new Set(BLENDS.map(blend=>blend.id));
  const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
  const finite=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)?n:fallback};
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const icon=name=>`vendor/icons/${name}.svg`;

  /* ------------------------------------------------------------------ model
     A layer's saved style. defaults come from the product's look: the
     blend it reads best with, its first palette and its strength. */
  function normalizeStyle(raw,defaults){
    const base=Object.assign({palette:"",reverse:false,relief:0,blend:"normal",opacity:.82,visible:true},defaults||{});
    const out=Object.assign({},base);
    if(!raw||typeof raw!=="object") return out;
    if(typeof raw.palette==="string"&&raw.palette) out.palette=raw.palette;
    out.reverse=!!raw.reverse;
    out.relief=Math.round(clamp(finite(raw.relief,base.relief),0,100));
    out.blend=BLEND_IDS.has(raw.blend)?raw.blend:base.blend;
    out.opacity=clamp(finite(raw.opacity,base.opacity),0,1);
    out.visible=raw.visible!==false;
    return out;
  }
  /* Palettes on offer for a product: its own first, then the studio's
     palettes that make sense for a continuous value. Products drawn as
     classes or categories keep their own sets. */
  function paletteChoices(own,studio,continuous){
    const list=own.slice();
    if(!continuous||!studio) return list;
    const seen=new Set(list.map(p=>p.name.toLowerCase()));
    for(const [id,palette] of Object.entries(studio)){
      if(/^default-|^style-/.test(id)||palette.domain||!palette.stops) continue;
      const kinds=palette.kinds||[];
      if(!kinds.includes("sequential")&&!kinds.includes("diverging")) continue;
      if(palette.stops.some(stop=>/^#[0-9a-f]{8}$/i.test(stop[1]))) continue;
      if(seen.has(palette.name.toLowerCase())) continue;
      seen.add(palette.name.toLowerCase());
      list.push({id:"studio:"+id,name:palette.name,stops:palette.stops,studio:true});
    }
    return list;
  }
  /* The stops a palette id resolves to, or null for non-ramp palettes. */
  function studioStops(id,studio){
    if(typeof id!=="string"||!id.startsWith("studio:")||!studio) return null;
    const palette=studio[id.slice(7)];return palette&&palette.stops?palette.stops:null;
  }
  function gradientCss(stops,reverse){
    const list=stops.map(([t,c])=>[reverse?1-t:t,String(c).slice(0,7)]).sort((a,b)=>a[0]-b[0]);
    return `linear-gradient(90deg,${list.map(([t,c])=>`${c} ${+(t*100).toFixed(2)}%`).join(",")})`;
  }
  function blendLabel(id){ return (BLENDS.find(b=>b.id===id)||BLENDS[0]).label }

  /* ------------------------------------------------------------------- view */
  function mount(container,host){
    if(!container||typeof document==="undefined") return null;
    host=host||{};
    let expanded=null,signature="",destroyed=false,menuOpen=false;
    const el=(tag,cls,html)=>{const n=document.createElement(tag);if(cls) n.className=cls;if(html!==undefined) n.innerHTML=html;return n};
    container.classList.add("ls","al");

    const layers=()=>host.layers?host.layers():[];
    const find=id=>layers().find(layer=>layer.id===id);
    const structure=()=>JSON.stringify([expanded,layers().map(l=>[l.id,l.product,l.palette,l.reverse,l.visible,l.relief===null,(l.params||[]).map(p=>p.value)])]);

    function meta(layer){
      if(layer.status==="busy") return layer.message||"Analyzing this view…";
      if(layer.status==="error") return layer.message||"Could not analyze this view";
      const palette=(layer.palettes||[]).find(p=>p.id===layer.palette);
      return [blendLabel(layer.blend),`${Math.round(layer.opacity*100)}%`,palette&&layer.palettes.length>1?palette.name:""].filter(Boolean).join(" · ");
    }
    function render(){
      if(destroyed) return;
      const focus=document.activeElement&&container.contains(document.activeElement)?focusKey(document.activeElement):null;
      signature=structure();
      container.innerHTML="";
      const list=layers();
      const wrap=el("div","ls-section al-section");
      const head=el("div","ls-head",`<h3 class="menu-section-title">${esc(host.title||"Analysis layers")}</h3><span class="pane-n">${list.length} of ${MAX_LAYERS}</span>`);
      wrap.append(head);
      if(host.note) wrap.append(el("p","control-hint al-note",esc(host.note)));
      if(list.length){
        const ol=el("ol","ls-layers");ol.setAttribute("aria-label","Analysis layers, top first");
        list.forEach((layer,index)=>ol.append(renderLayer(layer,index,list.length)));
        wrap.append(ol);
      }else if(host.empty) wrap.append(el("p","control-hint al-empty",esc(host.empty)));
      wrap.append(renderAdd(list.length));
      container.append(wrap);
      if(focus) restoreFocus(focus);
    }
    const focusKey=node=>{
      const li=node.closest("[data-layer]"),id=li&&li.dataset.layer;
      const tag=node.dataset.focus||(node.classList.contains("ls-layer-main")?"main":node.classList.contains("ls-add-button")?"add":"");
      return tag?{id,tag,palette:node.dataset.palette}:null;
    };
    function restoreFocus({id,tag,palette}){
      const scope=id?container.querySelector(`[data-layer="${id}"]`):container;if(!scope) return;
      const target=palette?scope.querySelector(`[data-palette="${palette}"]`):
        tag==="main"?scope.querySelector(".ls-layer-main"):tag==="add"?container.querySelector(".ls-add-button"):scope.querySelector(`[data-focus="${tag}"]`);
      target?.focus({preventScroll:true});
    }

    function renderLayer(layer,index,count){
      const li=el("li","ls-layer al-layer");li.dataset.layer=layer.id;
      const open=expanded===layer.id;
      li.classList.toggle("is-open",open);li.classList.toggle("is-hidden",!layer.visible);
      li.classList.toggle("is-busy",layer.status==="busy");li.classList.toggle("is-error",layer.status==="error");
      const row=el("div","ls-layer-row");
      const eye=el("button","ls-icon-button ls-eye",`<img src="${icon(layer.visible?"eye":"eye-off")}" alt="">`);
      eye.type="button";eye.dataset.focus="eye";eye.setAttribute("aria-pressed",String(layer.visible));
      eye.setAttribute("aria-label",`${layer.visible?"Hide":"Show"} ${layer.label}`);
      eye.onclick=()=>change(layer.id,{visible:!layer.visible},true);
      const main=el("button","ls-layer-main");main.type="button";main.setAttribute("aria-expanded",String(open));
      main.setAttribute("aria-controls",`al-editor-${layer.id}`);
      main.innerHTML=`<span class="ls-swatch" data-swatch style="background:${layer.swatch||"none"}"></span>`+
        `<span class="ls-layer-text"><span class="ls-layer-name">${esc(layer.label)}</span><span class="ls-layer-meta" data-meta>${esc(meta(layer))}</span></span>`+
        `<img class="ls-chevron" src="${icon("chevron-down")}" alt="" aria-hidden="true">`;
      main.onclick=()=>{expanded=open?null:layer.id;render()};
      row.append(eye,main);li.append(row);
      if(open) li.append(renderEditor(layer,index,count));
      return li;
    }
    function renderEditor(layer,index,count){
      const editor=el("div","ls-editor");editor.id=`al-editor-${layer.id}`;
      if(layer.hint) editor.append(el("p","control-hint ls-hint",esc(layer.hint)));
      const params=layer.params||[];
      if(params.length){
        const grid=el("div","ls-sliders");
        for(const param of params){
          const select=el("select","ls-select");select.dataset.focus="param-"+param.key;select.setAttribute("aria-label",param.label);
          for(const [value,label] of param.options){const o=document.createElement("option");o.value=String(value);o.textContent=label;select.append(o)}
          select.value=String(param.value);
          select.onchange=()=>change(layer.id,{params:{[param.key]:select.value}},true);
          const f=field(param.label,select);if(param.hint) f.append(el("p","control-hint",esc(param.hint)));
          grid.append(f);
        }
        editor.append(grid);
      }
      const palettes=layer.palettes||[];
      if(palettes.length>1){
        const group=el("div","ls-palettes");group.setAttribute("role","radiogroup");group.setAttribute("aria-label","Palette");
        palettes.forEach(palette=>{
          const chip=el("button","ls-palette",`<span class="ls-palette-bar" style="background:${palette.css}"></span><span class="ls-palette-name">${esc(palette.name)}</span>`);
          chip.type="button";chip.setAttribute("role","radio");chip.dataset.palette=palette.id;
          chip.setAttribute("aria-checked",String(palette.id===layer.palette));chip.tabIndex=palette.id===layer.palette?0:-1;
          group.append(chip);
        });
        if(!group.querySelector('[tabindex="0"]')) group.querySelector("[data-palette]").tabIndex=0;
        group.addEventListener("click",event=>{const chip=event.target.closest("[data-palette]");if(chip) change(layer.id,{palette:chip.dataset.palette},true)});
        group.addEventListener("keydown",event=>{
          const chips=[...group.querySelectorAll("[data-palette]")],at=chips.indexOf(event.target.closest("[data-palette]"));
          const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];if(at<0||!step) return;
          event.preventDefault();change(layer.id,{palette:chips[(at+step+chips.length)%chips.length].dataset.palette},true);
        });
        editor.append(field("Palette",group,"ls-field-wide"));
      }
      const tools=el("div","ls-sliders");
      if(layer.relief!==null&&layer.relief!==undefined) tools.append(slider("Relief shading",0,100,layer.relief,`${layer.relief}%`,value=>{
        change(layer.id,{relief:value});return `${value}%`;
      },"Mix hillshade into the colours so the layer keeps the shape of the ground.",0));
      const blend=el("select","ls-select");blend.dataset.focus="blend";blend.setAttribute("aria-label","Blend mode");
      BLENDS.forEach(b=>{const o=document.createElement("option");o.value=b.id;o.textContent=b.label;blend.append(o)});
      blend.value=layer.blend;blend.onchange=()=>change(layer.id,{blend:blend.value});
      const blendField=field("Blend",blend);
      blendField.append(el("p","control-hint","Blends with the terrain and map beneath. Multiply darkens, Screen lightens, Colour tints."));
      tools.append(blendField);
      tools.append(slider("Opacity",0,100,Math.round(layer.opacity*100),`${Math.round(layer.opacity*100)}%`,value=>{
        change(layer.id,{opacity:value/100});return `${value}%`;
      },"",100));
      editor.append(tools);
      const actions=el("div","ls-actions");
      if(layer.reverse!==null&&layer.reverse!==undefined){
        const reverse=pill("Reverse",()=>change(layer.id,{reverse:!layer.reverse},true));
        reverse.dataset.focus="reverse";reverse.setAttribute("aria-pressed",String(!!layer.reverse));actions.append(reverse);
      }
      const up=pill("",()=>{host.move&&host.move(layer.id,1)},"arrow-up","Move layer up");up.dataset.focus="up";up.disabled=index===0;
      const down=pill("",()=>{host.move&&host.move(layer.id,-1)},"arrow-down","Move layer down");down.dataset.focus="down";down.disabled=index>=count-1;
      const remove=pill("Remove",()=>{expanded=null;host.remove&&host.remove(layer.id);container.querySelector(".ls-add-button")?.focus()},"trash-2");
      actions.append(up,down,remove);
      editor.append(actions);
      return editor;
    }
    /* Patch the layer; structural changes rebuild, sliders only touch the
       row summary so a drag stays smooth. */
    function change(id,patch,rebuild){
      host.update&&host.update(id,patch);
      if(rebuild) render();else refreshSummaries();
    }

    function renderAdd(count){
      const add=el("div","ls-add");
      const button=el("button","ls-add-button",`<img src="${icon("plus")}" alt="" aria-hidden="true"><span>${count?"Add analysis":"Choose an analysis"}</span>`);
      button.type="button";button.disabled=count>=MAX_LAYERS;button.setAttribute("aria-haspopup","menu");button.setAttribute("aria-expanded",String(menuOpen));
      if(button.disabled) button.title=`Up to ${MAX_LAYERS} analysis layers. Remove one to add another.`;
      const menu=el("div","ls-menu al-menu");menu.setAttribute("role","menu");menu.hidden=!menuOpen||button.disabled;
      for(const group of (host.catalog?host.catalog():[])){
        menu.append(el("div","al-menu-group",esc(group.group)));
        for(const item of group.items){
          const entry=el("button","ls-menu-item al-menu-item",`<span class="ls-swatch" style="background:${item.swatch||"none"}"></span><span class="al-menu-text"><span>${esc(item.label)}</span>${item.hint?`<span class="al-menu-hint">${esc(item.hint)}</span>`:""}</span>`);
          entry.type="button";entry.setAttribute("role","menuitem");entry.dataset.addProduct=item.id;menu.append(entry);
        }
      }
      const close=()=>{menuOpen=false;menu.hidden=true;button.setAttribute("aria-expanded","false")};
      button.onclick=()=>{menuOpen=menu.hidden;menu.hidden=!menuOpen;button.setAttribute("aria-expanded",String(menuOpen));if(menuOpen) menu.querySelector("button")?.focus()};
      menu.addEventListener("click",event=>{
        const item=event.target.closest("[data-add-product]");if(!item) return;
        close();const id=host.add&&host.add(item.dataset.addProduct);
        if(id){expanded=id;render();container.querySelector(`[data-layer="${id}"] .ls-layer-main`)?.focus()}
      });
      menu.addEventListener("keydown",event=>{
        const items=[...menu.querySelectorAll("button")],at=items.indexOf(document.activeElement);
        if(event.key==="Escape"){event.preventDefault();close();button.focus();return}
        const step={ArrowDown:1,ArrowUp:-1}[event.key];if(!step) return;
        event.preventDefault();items[(at+step+items.length)%items.length].focus();
      });
      menu.addEventListener("focusout",event=>{if(!add.contains(event.relatedTarget)) close()});
      add.append(button,menu);
      return add;
    }

    function refreshSummaries(){
      const byId=new Map(layers().map(layer=>[layer.id,layer]));
      container.querySelectorAll("[data-layer]").forEach(li=>{
        const layer=byId.get(li.dataset.layer);if(!layer) return;
        li.classList.toggle("is-busy",layer.status==="busy");li.classList.toggle("is-error",layer.status==="error");
        const swatch=li.querySelector("[data-swatch]"),text=li.querySelector("[data-meta]");
        if(swatch&&layer.swatch) swatch.style.background=layer.swatch;
        if(text){const value=meta(layer);if(text.textContent!==value) text.textContent=value}
      });
    }
    function refresh(){ if(destroyed) return;if(structure()!==signature) render();else refreshSummaries() }
    function field(label,control,cls){
      const wrap=el("div","ls-field"+(cls?" "+cls:""));wrap.append(el("div","ls-field-label",esc(label)),control);return wrap;
    }
    function pill(label,onclick,iconName,aria){
      const b=el("button","ls-pill",(iconName?`<img src="${icon(iconName)}" alt="" aria-hidden="true">`:"")+(label?`<span>${esc(label)}</span>`:""));
      b.type="button";b.onclick=onclick;if(aria){b.setAttribute("aria-label",aria);b.title=aria}return b;
    }
    /* A labelled range with a live value; double-click resets it. */
    function slider(label,min,max,value,text,oninput,hint,resetValue){
      const wrap=el("div","ls-slider"),id="al-"+Math.random().toString(36).slice(2,8);
      wrap.innerHTML=`<div class="elev-label-row"><label for="${id}">${esc(label)}</label><output for="${id}">${esc(text)}</output></div>`+
        `<input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}" data-focus="${esc(label)}">`+(hint?`<p class="control-hint">${esc(hint)}</p>`:"");
      const input=wrap.querySelector("input"),output=wrap.querySelector("output");
      input.addEventListener("input",()=>{output.textContent=oninput(+input.value)});
      if(resetValue!==undefined) input.addEventListener("dblclick",()=>{input.value=String(resetValue);input.dispatchEvent(new Event("input",{bubbles:true}))});
      return wrap;
    }

    render();
    return {
      refresh,
      expand(id){expanded=id;render()},
      destroy(){destroyed=true;container.innerHTML=""}
    };
  }

  return Object.freeze({MAX_LAYERS,BLENDS,normalizeStyle,paletteChoices,studioStops,gradientCss,mount});
});
