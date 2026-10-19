/* Clear Skies Portal — LiDAR Studio panel.
 *
 * The colour and layer controls for LiDAR terrain: a gallery of looks, a
 * layer stack (the base layer chosen in the style grid plus up to three
 * blended overlays), a palette and gradient editor per layer, and terrain
 * effects. All state lives in CSPLidarRender's model; this file is only the
 * view. The host (index.html) supplies the active style, the GPU's view
 * samples for range fitting, and redraws when onChange fires.
 *
 *   const studio = CSPLidarStudio.mount(container, {
 *     getStyle, setStyle, onChange, sample, gpuAvailable, storage
 *   });
 *   studio.stack(style[, {flat}]) -> shader stack or null (legacy look)
 *   studio.refresh()      -> re-read the host after outside changes
 *   studio.fitFromView()  -> update auto ranges from the visible terrain
 *   studio.legend(style)  -> {caption, bar, ticks} or null */
(function(root,factory){
  "use strict";
  if(typeof module==="object"&&module.exports) module.exports=factory(require("./lidar-render.js"));
  else root.CSPLidarStudio=factory(root.CSPLidarRender);
})(typeof globalThis!=="undefined"?globalThis:this,function(R){
  "use strict";
  if(!R) throw new Error("lidar-render.js must load before lidar-studio.js");

  const STORAGE_KEY="clearskies.lidarStudio.v1";
  const icon=name=>`vendor/icons/${name}.svg`;
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));

  /* Slider mappings. Curve and relief are logarithmic so the neutral value
     sits in the middle and both directions feel even. */
  const curveToSlider=gamma=>Math.round(-Math.log2(gamma)*50);
  const sliderToCurve=value=>+Math.pow(2,-value/50).toFixed(3);
  const reliefToSlider=exag=>Math.round(Math.log2(exag)*100);
  const sliderToRelief=value=>+Math.pow(2,value/100).toFixed(3);
  const curveLabel=gamma=>Math.abs(gamma-1)<.02?"Even":gamma<1?`Lift lows ${Math.round((1/gamma-1)*100)}%`:`Lift highs ${Math.round((gamma-1)*100)}%`;
  const detailLabel=detail=>detail===0?"Natural":detail<0?`Smooth ${Math.round(-detail*100)}%`:`Sharpen ${Math.round(detail*100)}%`;
  const feet=metres=>Math.round(metres*R.FT);
  const distanceLabel=metres=>{const ft=metres*R.FT;return ft>=5280*.75?`${(ft/5280).toFixed(ft>=52800?0:1)} mi`:`${Math.round(ft).toLocaleString()} ft`};

  function mount(container,host){
    if(!container) return null;
    host=host||{};
    const storage=host.storage!==undefined?host.storage:(()=>{try{return globalThis.localStorage}catch(_){return null}})();
    let state=load(),fitted={},flatFitted={},remFloor=null,expanded=null,selectedStop=0,saveTimer=0,commitFrame=0,destroyed=false,previousMix=null;
    const previews=new Map();let previewQueue=[],previewTimer=0;
    const dem=R.previewTerrain(168,112);

    function load(){
      try{return R.normalizeState(JSON.parse(storage&&storage.getItem(STORAGE_KEY)||"null"))}catch(_){return R.emptyState()}
    }
    function save(){
      clearTimeout(saveTimer);
      saveTimer=setTimeout(()=>{try{storage&&storage.setItem(STORAGE_KEY,JSON.stringify(state))}catch(_){}},250);
    }
    const style=()=>{const s=host.getStyle?host.getStyle():"hs";return s&&s!=="off"&&R.STYLES[s]?s:null};
    const gpu=()=>host.gpuAvailable?!!host.gpuAvailable():true;

    /* ------------------------------------------------------------ layers */
    function layerFor(key){
      if(key==="base"){const s=style();return s?R.baseLayer(state,s):null}
      const index=+String(key).split(":")[1];return state.overlays[index]||null;
    }
    function setLayer(key,layer){
      if(key==="base"){const s=style();if(s) state.base[s]=layer}
      else state.overlays[+key.split(":")[1]]=layer;
    }
    function updateLayer(key,patch,{rerender=false}={}){
      const current=layerFor(key);if(!current) return;
      setLayer(key,R.normalizeLayer(Object.assign({},current,patch),current.style));
      if(patch.auto===false||patch.style) delete fitted[key];
      commit({rerender});
    }
    /* Push to the map on the next frame, so a dragged slider costs one redraw
       per frame however fast input events arrive. */
    function commit({rerender=false}={}){
      state.look=R.matchLook(state,style()||"hs");
      save();
      if(rerender) render();else refreshSummaries();
      if(!commitFrame) commitFrame=requestAnimationFrame(()=>{commitFrame=0;if(!destroyed) host.onChange&&host.onChange()});
    }

    /* -------------------------------------------------------------- DOM */
    container.classList.add("ls");
    container.innerHTML="";
    const el=(tag,cls,html)=>{const n=document.createElement(tag);if(cls) n.className=cls;if(html!==undefined) n.innerHTML=html;return n};

    function render(){
      const s=style(),scroll=container.closest(".pane-b")?.scrollTop;
      state.look=s?R.matchLook(state,s):null;
      container.innerHTML="";
      container.toggleAttribute("data-disabled",!gpu());
      if(!gpu()){
        container.append(el("p","control-hint ls-note","Colour layers, looks and effects need GPU rendering, which this browser doesn’t provide. The classic styles below still work."));
        return;
      }
      container.append(renderLooks(),renderLayers(s),renderEffects(s));
      if(scroll!==undefined) container.closest(".pane-b").scrollTop=scroll;
    }

    /* ------------------------------------------------------------- looks */
    function allLooks(){ return R.LOOKS.map(l=>Object.assign({user:false},l)).concat(state.userLooks.map(l=>Object.assign({user:true,blurb:"Your saved look."},l))) }
    function renderLooks(){
      const wrap=el("div","ls-section ls-looks-section");
      const head=el("div","ls-head",`<h3 class="menu-section-title">Looks</h3>`);
      const saveButton=el("button","linkbtn ls-save-look","Save current");saveButton.type="button";
      saveButton.disabled=!style();saveButton.title=style()?"Save these colours, layers and effects as a look":"Choose a layer first";
      head.append(saveButton);wrap.append(head);
      wrap.append(el("p","control-hint","Presets replace the whole layer mix. Customize each layer below."));
      const strip=el("div","ls-looks");strip.setAttribute("role","radiogroup");strip.setAttribute("aria-label","Looks");
      const current=style()?state.look:null,looks=allLooks();
      looks.forEach(look=>{
        const button=el("button","ls-look");button.type="button";button.setAttribute("role","radio");
        button.dataset.look=look.id;button.setAttribute("aria-checked",String(current===look.id));
        button.tabIndex=(current===look.id||(!looks.some(l=>l.id===current)&&look===looks[0]))?0:-1;
        button.title=`Apply ${look.name} · replaces the current layer mix`;
        const canvas=document.createElement("canvas");canvas.width=dem.width;canvas.height=dem.height;canvas.className="ls-look-preview";
        canvas.setAttribute("aria-hidden","true");
        const name=el("span","ls-look-name",esc(look.name));
        button.append(canvas,name);
        if(look.user){
          const remove=el("span","ls-look-remove",`<img src="${icon("x")}" alt="">`);
          remove.setAttribute("role","button");remove.setAttribute("aria-label",`Delete look ${look.name}`);remove.dataset.removeLook=look.id;
          button.append(remove);
        }
        strip.append(button);paintPreview(canvas,look);
      });
      wrap.append(strip);
      const blurb=el("p","control-hint ls-look-blurb");blurb.setAttribute("aria-live","polite");
      const active=looks.find(l=>l.id===current);
      blurb.textContent=!style()?"Pick a look to start, or choose a layer above.":active?active.blurb:"Custom · your own mix of colours and layers.";
      wrap.append(blurb);
      if(previousMix){
        const undo=el("button","linkbtn ls-undo-look","Undo preset");undo.type="button";
        undo.onclick=()=>{
          const previous=previousMix,looks=state.userLooks;previousMix=null;state=previous.state;state.userLooks=looks;fitted={};flatFitted={};remFloor=null;expanded=null;
          host.setStyle&&host.setStyle(previous.style);
          if(Number.isFinite(previous.opacity)&&host.setOpacity)host.setOpacity(previous.opacity);
          save();render();host.onChange&&host.onChange();
        };
        wrap.append(undo);
      }
      const saveRow=el("form","ls-save-row");saveRow.hidden=true;
      saveRow.innerHTML=`<input type="text" maxlength="40" placeholder="Name this look" aria-label="Look name" required><button type="submit" class="ls-pill ls-pill-primary">Save</button><button type="button" class="ls-pill" data-cancel>Cancel</button>`;
      wrap.append(saveRow);
      saveButton.onclick=()=>{saveRow.hidden=false;saveRow.querySelector("input").focus()};
      saveRow.querySelector("[data-cancel]").onclick=()=>{saveRow.hidden=true;saveButton.focus()};
      saveRow.onsubmit=event=>{
        event.preventDefault();
        const nameValue=saveRow.querySelector("input").value.trim();const s=style();if(!nameValue||!s) return;
        const id="user-"+Date.now().toString(36);
        const opacity=host.getOpacity?host.getOpacity():undefined;
        state.userLooks.push({id,name:nameValue.slice(0,40),scene:R.captureScene(state,s),...(Number.isFinite(opacity)?{opacity}:{})});
        state.userLooks=state.userLooks.slice(-24);state.look=id;save();render();
        container.querySelector(`[data-look="${id}"]`)?.focus();
      };
      strip.addEventListener("click",event=>{
        const remove=event.target.closest("[data-remove-look]");
        if(remove){event.stopPropagation();state.userLooks=state.userLooks.filter(l=>l.id!==remove.dataset.removeLook);commit({rerender:true});return}
        const button=event.target.closest(".ls-look");if(button) applyLook(button.dataset.look);
      });
      strip.addEventListener("keydown",event=>{
        const buttons=[...strip.querySelectorAll(".ls-look")],index=buttons.indexOf(event.target.closest(".ls-look"));
        if(index<0) return;
        const columns=Math.max(1,getComputedStyle(strip).gridTemplateColumns.trim().split(/\s+/).length);
        const step={ArrowRight:1,ArrowDown:columns,ArrowLeft:-1,ArrowUp:-columns}[event.key];
        if(event.key==="Delete"||event.key==="Backspace"){const r=buttons[index].querySelector("[data-remove-look]");if(r){event.preventDefault();r.click()}return}
        if(!step&&event.key!=="Home"&&event.key!=="End") return;
        const target=event.key==="Home"?0:event.key==="End"?buttons.length-1:
          event.key==="ArrowDown"||event.key==="ArrowUp"?clamp(index+step,0,buttons.length-1):(index+step+buttons.length)%buttons.length;
        event.preventDefault();const next=buttons[target];
        next.focus();applyLook(next.dataset.look);
      });
      return wrap;
    }
    function applyLook(id){
      const look=allLooks().find(l=>l.id===id);if(!look) return;
      previousMix={state:JSON.parse(JSON.stringify(state)),style:host.getStyle?host.getStyle():style(),opacity:host.getOpacity?host.getOpacity():undefined};
      const result=R.applyScene(state,look.scene,look.id);
      state=result.state;fitted={};flatFitted={};remFloor=null;expanded=null;save();
      if(host.getStyle&&host.getStyle()!==result.style&&host.setStyle) host.setStyle(result.style);
      /* Looks are designed at their own strength; the classic look keeps the
         usual see-through terrain. */
      if(Number.isFinite(look.opacity)&&host.setOpacity) host.setOpacity(look.opacity);
      render();
      container.querySelector(`[data-look="${id}"]`)?.focus({preventScroll:true});
      host.onChange&&host.onChange();
    }
    function paintPreview(canvas,look){
      const key=JSON.stringify(look.scene),cached=previews.get(key);
      if(cached){canvas.getContext("2d").putImageData(cached,0,0);return}
      previewQueue.push({canvas,key,scene:look.scene});
      if(!previewTimer) previewTimer=setTimeout(drainPreviews,30);
    }
    /* One preview per slice of idle time keeps the panel responsive while
       the gallery fills in. */
    function drainPreviews(){
      previewTimer=0;
      const job=previewQueue.shift();if(!job||destroyed) return;
      let image=previews.get(job.key);
      if(!image){
        try{image=new ImageData(R.renderScenePreview(job.scene,dem,host.lighting&&host.lighting()),dem.width,dem.height)}catch(_){image=null}
        if(image) previews.set(job.key,image);
      }
      if(image&&job.canvas.isConnected) job.canvas.getContext("2d").putImageData(image,0,0);
      if(previewQueue.length) previewTimer=(globalThis.requestIdleCallback||setTimeout)(drainPreviews,{timeout:120});
    }

    /* ------------------------------------------------------------ layers */
    function layerKeys(){
      if(!style())return [];
      const keys=["base"];
      state.overlays.forEach((_,i)=>keys.push("overlay:"+i));
      return keys;
    }
    function layerTitle(key,layer){
      const label=(R.STYLES[layer.style]||{}).label||layer.style;
      return key==="base"?label:label;
    }
    function layerMeta(key,layer){
      const palette=layer.stops?"Custom":(R.PALETTES[layer.palette]||{}).name||"";
      if(key==="base") return `${layer.visible?"Bottom layer":"Hidden"} · ${Math.round(layer.opacity*100)}% · ${palette}`;
      const blend=(R.BLENDS.find(b=>b.id===layer.blend)||R.BLENDS[0]).label;
      return `${blend} · ${Math.round(layer.opacity*100)}% · ${palette}`;
    }
    function renderLayers(s){
      const wrap=el("div","ls-section");
      const head=el("div","ls-head",`<h3 class="menu-section-title">Layers</h3><span class="pane-n">${layerKeys().length} of ${R.MAX_LAYERS}</span>`);
      wrap.append(head);
      wrap.append(el("p","control-hint","Open a layer to edit colors, opacity and blending. Layers at the top draw over those below."));
      if(!s)wrap.append(el("p","control-hint","Add your first layer, or choose a preset above."));
      const list=el("ol","ls-layers");list.setAttribute("aria-label","Terrain layers, top first");
      const keys=layerKeys().reverse();
      keys.forEach(key=>list.append(renderLayer(key)));
      wrap.append(list);
      const add=el("div","ls-add");
      const addButton=el("button","ls-add-button",`<img src="${icon("plus")}" alt="" aria-hidden="true"><span>Add layer</span>`);
      addButton.type="button";addButton.disabled=layerKeys().length>=R.MAX_LAYERS;addButton.setAttribute("aria-haspopup","menu");addButton.setAttribute("aria-expanded","false");
      if(addButton.disabled) addButton.title=`Up to ${R.MAX_LAYERS} layers`;
      const menu=el("div","ls-menu");menu.setAttribute("role","menu");menu.hidden=true;
      const choices=s?R.OVERLAY_STYLES:Object.keys(R.STYLES).filter(id=>id!=="contour"&&!R.STYLES[id].registered);
      choices.forEach(id=>{
        const spec=R.STYLES[id];if(!spec) return;
        const item=el("button","ls-menu-item",`<span class="ls-swatch" style="background:${R.gradientCss(R.PALETTES[spec.palette].stops)}"></span><span>${esc(spec.label)}</span>`);
        item.type="button";item.setAttribute("role","menuitem");item.dataset.addStyle=id;menu.append(item);
      });
      const closeMenu=()=>{menu.hidden=true;addButton.setAttribute("aria-expanded","false")};
      addButton.onclick=()=>{menu.hidden=!menu.hidden;addButton.setAttribute("aria-expanded",String(!menu.hidden));if(!menu.hidden) menu.querySelector("button")?.focus()};
      menu.addEventListener("click",event=>{
        const item=event.target.closest("[data-add-style]");if(!item) return;
        addOverlay(item.dataset.addStyle);closeMenu();
      });
      menu.addEventListener("keydown",event=>{
        const items=[...menu.querySelectorAll("button")],index=items.indexOf(document.activeElement);
        if(event.key==="Escape"){event.preventDefault();closeMenu();addButton.focus();return}
        const step={ArrowDown:1,ArrowUp:-1}[event.key];if(!step) return;
        event.preventDefault();items[(index+step+items.length)%items.length].focus();
      });
      menu.addEventListener("focusout",event=>{if(!add.contains(event.relatedTarget)) closeMenu()});
      add.append(addButton,menu);wrap.append(add);
      return wrap;
    }
    /* New overlays get a sensible starting blend: hillshade multiplies so it
       sculpts whatever is beneath, lines draw normally, colour layers tint. */
    function addOverlay(styleId){
      if(layerKeys().length>=R.MAX_LAYERS) return;
      const spec=R.STYLES[styleId]||R.STYLES.hs,layer=R.defaultLayer(styleId);
      if(!style()){
        state.base[styleId]=layer;state.overlays=[];fitted={};flatFitted={};remFloor=null;
        host.setStyle&&host.setStyle(styleId);expanded="base";selectedStop=0;commit({rerender:true});return;
      }
      if(spec.family==="shade"){layer.blend="multiply";layer.opacity=.75}
      else if(spec.family!=="lines"){layer.blend="color";layer.opacity=.7;if(styleId==="tint"){layer.palette="viridis";layer.auto=true;layer.param=0}}
      state.overlays.push(layer);
      expanded="overlay:"+(state.overlays.length-1);selectedStop=0;
      commit({rerender:true});
      container.querySelector(`[data-key="${expanded}"] .ls-layer-main`)?.focus();
    }
    function renderLayer(key){
      const layer=layerFor(key),li=el("li","ls-layer");li.dataset.key=key;
      const open=expanded===key;
      li.classList.toggle("is-open",open);li.classList.toggle("is-hidden",!layer.visible);
      const row=el("div","ls-layer-row");
      const eye=el("button","ls-icon-button ls-eye",`<img src="${icon(layer.visible?"eye":"eye-off")}" alt="">`);
      eye.type="button";eye.setAttribute("aria-pressed",String(layer.visible));
      eye.setAttribute("aria-label",`${layer.visible?"Hide":"Show"} ${layerTitle(key,layer)}`);
      eye.title=`${layer.visible?"Hide":"Show"} this layer`;
      eye.onclick=()=>{updateLayer(key,{visible:!layer.visible},{rerender:true});container.querySelector(`[data-key="${key}"] .ls-eye`)?.focus()};
      const main=el("button","ls-layer-main");main.type="button";main.setAttribute("aria-expanded",String(open));
      main.title="Edit colors, opacity and blending";
      main.setAttribute("aria-controls",`ls-editor-${key.replace(":","-")}`);
      main.innerHTML=`<span class="ls-swatch" data-swatch style="background:${R.gradientCss(R.paletteStops(layer),layer.reverse)}"></span>`+
        `<span class="ls-layer-text"><span class="ls-layer-name">${esc(layerTitle(key,layer))}</span><span class="ls-layer-meta" data-meta>${esc(layerMeta(key,layer))}</span></span>`+
        `<img class="ls-chevron" src="${icon("chevron-down")}" alt="" aria-hidden="true">`;
      main.onclick=()=>{expanded=open?null:key;selectedStop=0;render();container.querySelector(`[data-key="${key}"] .ls-layer-main`)?.focus()};
      row.append(eye,main);li.append(row);
      if(open) li.append(renderEditor(key,layer));
      return li;
    }

    /* ------------------------------------------------------------ editor */
    function renderEditor(key,layer){
      const spec=R.STYLES[layer.style]||R.STYLES.hs,editor=el("div","ls-editor");
      editor.id=`ls-editor-${key.replace(":","-")}`;
      const type=el("select","ls-select");type.setAttribute("aria-label","Layer type");
      const types=key==="base"?Object.keys(R.STYLES).filter(id=>id!=="contour"&&!R.STYLES[id].registered):R.OVERLAY_STYLES;
      types.forEach(id=>{const option=document.createElement("option");option.value=id;option.textContent=R.STYLES[id].label;type.append(option)});
      type.value=layer.style;
      type.onchange=()=>{
        delete fitted[key];delete flatFitted[key];
        if(key==="base")host.setStyle&&host.setStyle(type.value);
        else setLayer(key,Object.assign(R.defaultLayer(type.value),{opacity:layer.opacity,blend:layer.blend,visible:layer.visible}));
        commit({rerender:true});container.querySelector(`[data-key="${key}"] [aria-label="Layer type"]`)?.focus();
      };
      editor.append(field("Layer type",type));
      if(spec.hint) editor.append(el("p","control-hint ls-hint",esc(spec.hint)));
      const mix=el("div","ls-sliders ls-mix-controls");
      const blend=el("select","ls-select");blend.setAttribute("aria-label","Blend mode");
      R.BLENDS.forEach(b=>{const o=document.createElement("option");o.value=b.id;o.textContent=b.label;blend.append(o)});
      blend.value=layer.blend;blend.onchange=()=>updateLayer(key,{blend:blend.value});
      mix.append(field("Blend",blend));
      mix.append(slider("Layer opacity",0,100,Math.round(layer.opacity*100),`${Math.round(layer.opacity*100)}%`,value=>{
        updateLayer(key,{opacity:value/100});return `${value}%`;
      },"",()=>100));
      editor.append(mix);

      /* Palette chips */
      const palettes=el("div","ls-palettes");palettes.setAttribute("role","radiogroup");palettes.setAttribute("aria-label","Palette");
      const ids=R.palettesFor(layer.style);
      const chosen=layer.stops?"custom":layer.palette;
      const chips=ids.concat(layer.stops?["custom"]:[]).map(id=>{
        const stops=id==="custom"?layer.stops:R.PALETTES[id].stops;
        const chip=el("button","ls-palette",`<span class="ls-palette-bar" style="background:${R.gradientCss(stops)}"></span><span class="ls-palette-name">${esc(id==="custom"?"Custom":R.PALETTES[id].name)}</span>`);
        chip.type="button";chip.setAttribute("role","radio");chip.dataset.palette=id;chip.setAttribute("aria-checked",String(chosen===id));
        chip.tabIndex=chosen===id?0:-1;palettes.append(chip);return chip;
      });
      if(!chips.some(c=>c.tabIndex===0)&&chips[0]) chips[0].tabIndex=0;
      const choosePalette=id=>{
        if(id==="custom") return;
        const palette=R.PALETTES[id],patch={palette:id,stops:null};
        if(palette.domain){patch.min=palette.domain[0];patch.max=palette.domain[1];patch.auto=false}
        else if(spec.auto&&layer.palette&&R.PALETTES[layer.palette]&&R.PALETTES[layer.palette].domain) patch.auto=true;
        if(spec.param==="shade") patch.param=palette.shade?1:(layer.param&&!R.PALETTES[layer.palette]?.shade?layer.param:0);
        selectedStop=0;updateLayer(key,patch,{rerender:true});
        container.querySelector(`[data-key="${key}"] [data-palette="${id}"]`)?.focus();
      };
      palettes.addEventListener("click",event=>{const chip=event.target.closest("[data-palette]");if(chip) choosePalette(chip.dataset.palette)});
      palettes.addEventListener("keydown",event=>{
        const list=[...palettes.querySelectorAll("[data-palette]")],index=list.indexOf(event.target.closest("[data-palette]"));
        const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];if(index<0||!step) return;
        event.preventDefault();choosePalette(list[(index+step+list.length)%list.length].dataset.palette);
      });
      editor.append(field("Palette",palettes,"ls-field-wide"));

      /* Gradient editor */
      editor.append(renderRamp(key,layer));

      /* Range */
      if(spec.family!=="lines"&&spec.unit!=="shade"){
        const range=el("div","ls-range");
        const unit=spec.unit==="m"?"ft":spec.unit==="deg"?"°":"";
        const fit=fitted[key],shown=layer.auto&&fit?fit:[layer.min,layer.max];
        const number=(which,value)=>{
          const input=el("input");input.type="number";input.step=spec.unit==="m"?"10":spec.unit==="deg"?"1":"0.05";
          input.value=String(+R.toDisplay(layer.style,value).toFixed(spec.unit==="index"?2:0));
          input.disabled=layer.auto;input.setAttribute("aria-label",`${which==="min"?"Lowest":"Highest"} value${unit?" in "+(unit==="°"?"degrees":unit):""}`);
          input.onchange=()=>{
            const v=R.fromDisplay(layer.style,+input.value);if(!Number.isFinite(v)) return;
            const current=layerFor(key);
            updateLayer(key,which==="min"?{min:v,max:Math.max(current.max,v+1e-3)}:{max:v,min:Math.min(current.min,v-1e-3)},{rerender:true});
          };
          return input;
        };
        const inputs=el("div","ls-range-inputs");
        inputs.append(number("min",shown[0]),el("span","ls-range-dash","to"),number("max",shown[1]));
        if(unit) inputs.append(el("span","ls-unit",unit));
        range.append(inputs);
        if(spec.auto){
          const auto=el("label","ls-check",`<input type="checkbox" ${layer.auto?"checked":""}><span>Fit to view</span>`);
          auto.title="Stretch the palette across the terrain on screen. Updates as you pan.";
          auto.querySelector("input").onchange=event=>{
            const current=layerFor(key),fit=fitted[key];
            const patch={auto:event.target.checked};
            if(!event.target.checked&&fit){patch.min=fit[0];patch.max=fit[1]}
            updateLayer(key,patch,{rerender:true});
            if(event.target.checked) fitFromView(true);
          };
          range.append(auto);
        }
        editor.append(field("Range",range,"ls-field-wide"));
      }

      /* Curve and bands */
      const tools=el("div","ls-sliders");
      if(spec.family!=="lines"){
        tools.append(slider("Curve",-100,100,curveToSlider(layer.gamma),curveLabel(layer.gamma),value=>{
          const gamma=sliderToCurve(value);updateLayer(key,{gamma});return curveLabel(gamma);
        },"Bend the palette toward low or high values. Lift lows to pull out detail along rivers.",()=>0));
        tools.append(slider("Bands",0,24,layer.steps,layer.steps?`${layer.steps} bands`:"Smooth",value=>{
          const steps=value===1?2:value;updateLayer(key,{steps});return steps?`${steps} bands`:"Smooth";
        },"Split the palette into flat colour bands, like a stepped elevation map.",()=>0));
      }
      if(spec.param==="shade") tools.append(slider("Built-in shading",0,100,Math.round(layer.param*100),`${Math.round(layer.param*100)}%`,value=>{
        updateLayer(key,{param:value/100});return `${value}%`;
      },"Shade this colour layer by itself. Add a Hillshade layer instead for blend control.",()=>0));
      if(spec.param==="interval"){
        const input=el("input");input.type="number";input.min="1";input.max="5000";input.step="1";input.value=String(layer.param);
        input.setAttribute("aria-label","Contour interval in feet");
        input.onchange=()=>updateLayer(key,{param:clamp(+input.value||20,1,5000)});
        const wrap=el("div","ls-range-inputs");wrap.append(input,el("span","ls-unit","ft"));
        tools.append(field("Interval",wrap));
      }
      editor.append(tools);

      /* Actions */
      const actions=el("div","ls-actions");
      const reverse=pill("Reverse",()=>{updateLayer(key,{reverse:!layerFor(key).reverse},{rerender:true});container.querySelector(`[data-key="${key}"] [data-action="reverse"]`)?.focus()});
      reverse.dataset.action="reverse";reverse.setAttribute("aria-pressed",String(layer.reverse));
      actions.append(reverse);
      if(key!=="base"){
        const index=+key.split(":")[1];
        const up=pill("",()=>moveOverlay(index,1),"arrow-up","Move layer up");up.disabled=index>=state.overlays.length-1;
        const down=pill("",()=>moveOverlay(index,-1),"arrow-down","Move layer down");down.disabled=index===0;
        const remove=pill("Remove",()=>{state.overlays.splice(index,1);expanded=null;commit({rerender:true});container.querySelector(".ls-add-button")?.focus()},"trash-2");
        actions.append(up,down,remove);
      }
      const reset=pill("Reset",()=>{
        const fresh=R.defaultLayer(layer.style);
        if(key!=="base"){fresh.blend=layer.blend;fresh.opacity=layer.opacity}
        delete fitted[key];setLayer(key,fresh);commit({rerender:true});
      },"rotate-ccw","Reset this layer’s colours");
      actions.append(reset);
      editor.append(actions);
      return editor;
    }
    function moveOverlay(index,direction){
      const target=index+direction;if(target<0||target>=state.overlays.length) return;
      const list=state.overlays;[list[index],list[target]]=[list[target],list[index]];
      const a=fitted["overlay:"+index],b=fitted["overlay:"+target];fitted["overlay:"+index]=b;fitted["overlay:"+target]=a;
      expanded="overlay:"+target;commit({rerender:true});
      container.querySelector(`[data-key="${expanded}"] .ls-layer-main`)?.focus();
    }
    function pill(label,onclick,iconName,aria){
      const b=el("button","ls-pill",(iconName?`<img src="${icon(iconName)}" alt="" aria-hidden="true">`:"")+(label?`<span>${esc(label)}</span>`:""));
      b.type="button";b.onclick=onclick;if(aria){b.setAttribute("aria-label",aria);b.title=aria}return b;
    }
    function field(label,control,cls){
      const wrap=el("div","ls-field"+(cls?" "+cls:""));
      const name=el("div","ls-field-label",esc(label));wrap.append(name,control);
      return wrap;
    }
    /* A labelled range with a live value; double-click resets it. */
    function slider(label,min,max,value,text,oninput,hint,resetValue){
      const wrap=el("div","ls-slider");
      const id="ls-"+Math.random().toString(36).slice(2,8);
      wrap.innerHTML=`<div class="elev-label-row"><label for="${id}">${esc(label)}</label><output for="${id}">${esc(text)}</output></div>`+
        `<input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}">`+(hint?`<p class="control-hint">${esc(hint)}</p>`:"");
      const input=wrap.querySelector("input"),output=wrap.querySelector("output");
      input.addEventListener("input",()=>{output.textContent=oninput(+input.value)});
      if(resetValue) input.addEventListener("dblclick",()=>{input.value=String(resetValue());input.dispatchEvent(new Event("input",{bubbles:true}))});
      return wrap;
    }

    /* Gradient bar with draggable colour stops. Click the bar to add a
       colour; drag a stop to move it; pick or delete the selected stop. */
    function renderRamp(key,layer){
      const wrap=el("div","ls-ramp-wrap");
      const bar=el("div","ls-ramp");bar.setAttribute("role","group");bar.setAttribute("aria-label","Palette colours. Click to add a colour.");
      const stops=()=>R.paletteStops(layerFor(key)).map(s=>s.slice());
      const paint=()=>{
        const current=layerFor(key),list=R.paletteStops(current);
        bar.style.background=`${R.gradientCss(list,current.reverse)},repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/10px 10px`;
        bar.querySelectorAll(".ls-stop").forEach((handle,index)=>{
          const [position,colour]=list[index];const shown=current.reverse?1-position:position;
          handle.style.left=`${shown*100}%`;handle.style.setProperty("--stop",colour.slice(0,7));
          handle.setAttribute("aria-valuenow",String(Math.round(position*100)));
          handle.setAttribute("aria-valuetext",`${colour.slice(0,7)} at ${Math.round(position*100)}%`);
          handle.classList.toggle("is-selected",index===selectedStop);
        });
        const swatch=container.querySelector(`[data-key="${key}"] [data-swatch]`);
        if(swatch) swatch.style.background=R.gradientCss(list,current.reverse);
        const chosen=list[selectedStop];
        if(chosen){colour.value=chosen[1].slice(0,7);position.textContent=`${Math.round(chosen[0]*100)}%`}
        remove.disabled=list.length<=2;
      };
      /* Editing any stop turns the palette into Custom. */
      const writeStops=(list,{rerender=false}={})=>{
        const current=layerFor(key);
        setLayer(key,R.normalizeLayer(Object.assign({},current,{stops:list,palette:"custom"}),current.style));
        commit({rerender});
        if(!rerender){paint();markCustom()}
      };
      const markCustom=()=>{
        const group=container.querySelector(`[data-key="${key}"] .ls-palettes`);if(!group) return;
        group.querySelectorAll("[data-palette]").forEach(chip=>{chip.setAttribute("aria-checked","false");chip.tabIndex=-1});
        let custom=group.querySelector('[data-palette="custom"]');
        if(!custom){
          custom=el("button","ls-palette",`<span class="ls-palette-bar"></span><span class="ls-palette-name">Custom</span>`);
          custom.type="button";custom.setAttribute("role","radio");custom.dataset.palette="custom";group.append(custom);
        }
        custom.setAttribute("aria-checked","true");custom.tabIndex=0;
        custom.querySelector(".ls-palette-bar").style.background=R.gradientCss(R.paletteStops(layerFor(key)));
      };
      stops().forEach((_,index)=>{
        const handle=el("button","ls-stop");handle.type="button";handle.setAttribute("role","slider");
        handle.setAttribute("aria-valuemin","0");handle.setAttribute("aria-valuemax","100");handle.setAttribute("aria-label",`Colour stop ${index+1}`);
        handle.dataset.index=String(index);bar.append(handle);
      });
      const toPosition=clientX=>{const rect=bar.getBoundingClientRect();let t=clamp((clientX-rect.left)/Math.max(1,rect.width),0,1);return layerFor(key).reverse?1-t:t};
      bar.addEventListener("pointerdown",event=>{
        const handle=event.target.closest(".ls-stop");
        if(!handle){
          /* Add a stop with the colour already shown at that point. */
          const t=toPosition(event.clientX),list=stops();if(list.length>=R.MAX_STOPS) return;
          const tuples=list.map(([p,c])=>[p,...R.parseHex(c)]);
          const rgba=R._test.rampColour(tuples,t);
          list.push([t,R.toHex(rgba)]);list.sort((a,b)=>a[0]-b[0]);
          selectedStop=list.findIndex(s=>s[0]===t);writeStops(list,{rerender:true});
          container.querySelector(`[data-key="${key}"] .ls-stop[data-index="${selectedStop}"]`)?.focus();
          return;
        }
        event.preventDefault();
        let index=+handle.dataset.index;selectedStop=index;handle.focus();paint();
        handle.setPointerCapture(event.pointerId);
        const move=e=>{const moved=R.moveStop(stops(),index,toPosition(e.clientX));index=selectedStop=moved.index;writeStops(moved.stops)};
        const up=()=>{handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",up);handle.removeEventListener("pointercancel",up);
          /* Re-sort after a drag so stops keep their order. */
          const list=stops(),moved=list[index];list.sort((a,b)=>a[0]-b[0]);selectedStop=list.indexOf(moved);writeStops(list,{rerender:true});
          container.querySelector(`[data-key="${key}"] .ls-stop[data-index="${selectedStop}"]`)?.focus();};
        handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",up);handle.addEventListener("pointercancel",up);
      });
      bar.addEventListener("keydown",event=>{
        const handle=event.target.closest(".ls-stop");if(!handle) return;
        const index=+handle.dataset.index,list=stops();
        const flip=layerFor(key).reverse?-1:1;
        const step={ArrowRight:.01,ArrowUp:.01,ArrowLeft:-.01,ArrowDown:-.01}[event.key];
        if(step){event.preventDefault();const moved=R.moveStop(list,index,list[index][0]+step*flip*(event.shiftKey?10:1));selectedStop=moved.index;writeStops(moved.stops);
          bar.querySelector(`[data-index="${selectedStop}"]`)?.focus();return}
        if(event.key==="Delete"||event.key==="Backspace"){event.preventDefault();remove.click()}
      });
      bar.addEventListener("focusin",event=>{const h=event.target.closest(".ls-stop");if(h){selectedStop=+h.dataset.index;paint()}});

      const controls=el("div","ls-stop-controls");
      const colourLabel=el("label","ls-colour");
      const colour=el("input");colour.type="color";colour.setAttribute("aria-label","Selected stop colour");
      colourLabel.append(colour,el("span","","Colour"));
      const position=el("span","ls-stop-position");
      const remove=pill("",()=>{
        const list=stops();if(list.length<=2) return;
        list.splice(selectedStop,1);selectedStop=Math.max(0,selectedStop-1);writeStops(list,{rerender:true});
        container.querySelector(`[data-key="${key}"] .ls-stop[data-index="${selectedStop}"]`)?.focus();
      },"trash-2","Delete selected colour");
      colour.addEventListener("input",()=>{
        const list=stops();if(!list[selectedStop]) return;
        const alpha=list[selectedStop][1].slice(7);list[selectedStop][1]=colour.value+alpha;writeStops(list);
      });
      controls.append(colourLabel,position,remove);
      wrap.append(bar,controls,el("p","control-hint ls-hint","Click the bar to add a colour. Drag a stop to move it."));
      paint();
      return field("Colours",wrap,"ls-field-wide");
    }

    /* ----------------------------------------------------------- effects */
    function renderEffects(s){
      const wrap=el("div","ls-section");
      wrap.append(el("div","ls-head",`<h3 class="menu-section-title">Effects</h3>`));
      if(!s){wrap.append(el("p","control-hint","Effects apply once a layer is on."));return wrap}
      const e=state.effects,grid=el("div","ls-sliders");
      const setEffect=patch=>{state.effects=R.normalizeEffects(Object.assign({},state.effects,patch));commit()};
      grid.append(slider("Relief depth",-200,300,reliefToSlider(e.reliefExag),`${e.reliefExag.toFixed(2)}×`,value=>{
        const reliefExag=sliderToRelief(value);setEffect({reliefExag});return `${reliefExag.toFixed(2)}×`;
      },"Deepen or flatten the shading in every shaded layer.",()=>0));
      grid.append(slider("Detail",-100,300,Math.round(e.detail*100),detailLabel(e.detail),value=>{
        const detail=value/100;setEffect({detail});
        detailSize.hidden=detail===0;return detailLabel(detail);
      },"Smooth away noise, or sharpen tiny features like old roads and channels.",()=>0));
      const detailSize=slider("Detail size",1,100,Math.round(Math.sqrt((e.detailRadius-1)/499)*100),distanceLabel(e.detailRadius),value=>{
        const detailRadius=+(1+499*Math.pow(value/100,2)).toFixed(1);setEffect({detailRadius});return distanceLabel(detailRadius);
      },"How large a feature counts as detail.");
      detailSize.hidden=e.detail===0;grid.append(detailSize);
      const usesRem=s==="rem"||state.overlays.some(l=>l.visible&&l.style==="rem");
      if(usesRem) grid.append(slider("Valley width",0,100,Math.round(Math.sqrt((e.remRadius-50)/19950)*100),distanceLabel(e.remRadius),value=>{
        const remRadius=Math.round(50+19950*Math.pow(value/100,2));setEffect({remRadius});return distanceLabel(remRadius);
      },"How far relative elevation looks for the valley floor. Widen it for big rivers, narrow it for creeks."));
      wrap.append(grid);
      const reset=el("button","linkbtn ls-reset","Reset colours &amp; layers");reset.type="button";
      reset.onclick=()=>{
        const keep=state.userLooks;state=R.emptyState();state.userLooks=keep;fitted={};flatFitted={};expanded=null;
        commit({rerender:true});
      };
      wrap.append(reset);
      return wrap;
    }

    /* Row summaries follow every edit without rebuilding the open editor. */
    function refreshSummaries(){
      container.querySelectorAll(".ls-layer").forEach(li=>{
        const key=li.dataset.key,layer=layerFor(key);if(!layer) return;
        const swatch=li.querySelector("[data-swatch]"),meta=li.querySelector("[data-meta]");
        if(swatch) swatch.style.background=R.gradientCss(R.paletteStops(layer),layer.reverse);
        if(meta) meta.textContent=layerMeta(key,layer);
      });
      const current=style()?state.look:null;
      const looks=[...container.querySelectorAll(".ls-look")];
      const active=looks.find(button=>button.dataset.look===current)||looks[0];
      looks.forEach(button=>{button.setAttribute("aria-checked",String(button.dataset.look===current));button.tabIndex=button===active?0:-1});
      const blurb=container.querySelector(".ls-look-blurb");
      if(blurb){const active=allLooks().find(l=>l.id===current);blurb.textContent=!style()?"Pick a look to start, or choose a layer above.":active?active.blurb:"Custom · your own mix of colours and layers."}
    }

    /* ------------------------------------------------------- range fitting */
    function autoKeys(){
      return layerKeys().filter(key=>{const layer=layerFor(key);return layer&&layer.visible&&layer.auto});
    }
    /* Reads the visible terrain and re-stretches auto layers. Small changes
       are ignored so panning does not make colours shimmer. */
    function fitFromView(force){
      const keys=autoKeys(),s=style();
      if(!s||!host.sample) return false;
      const values=host.sample();if(!values) return false;
      if(values.heights&&values.heights.length){const h=R.fitRange(values.heights,"tint");if(h) remFloor=h[0]}
      /* The 3D drape has no valley-floor field: there relative elevation is
         measured from the view's lowest ground, so it gets its own range. */
      if(remFloor!==null&&values.heights) for(const key of keys) if(layerFor(key).style==="rem")
        flatFitted[key]=R.fitRange(Array.from(values.heights,h=>Math.max(0,h-remFloor)),"rem");
      let changed=false;
      for(const key of keys){
        const layer=layerFor(key),source=layer.style==="rem"?values.relative:values.heights;
        if(!source||source.length<16) continue;
        const next=R.fitRange(source,layer.style),prev=fitted[key];
        if(!next) continue;
        const span=Math.max(1e-6,next[1]-next[0]);
        if(force||!prev||Math.abs(prev[0]-next[0])>span*.04||Math.abs(prev[1]-next[1])>span*.04){fitted[key]=next;changed=true}
      }
      if(changed){
        const open=expanded&&fitted[expanded]&&container.querySelector(`[data-key="${expanded}"] .ls-range-inputs`);
        if(open){const [a,b]=open.querySelectorAll("input"),layer=layerFor(expanded);
          if(a&&b&&layer){a.value=String(Math.round(R.toDisplay(layer.style,fitted[expanded][0])));b.value=String(Math.round(R.toDisplay(layer.style,fitted[expanded][1])))}}
        host.onChange&&host.onChange();
      }
      return changed;
    }

    /* flat: for renderers without the valley-floor field (3D). */
    function stack(s,options){
      const flat=options&&options.flat;
      return R.buildStack(state,s||style(),flat?Object.assign({},fitted,flatFitted):fitted,{remFlatBase:remFloor||0});
    }
    function needsFit(){ return autoKeys().length>0 }
    function legend(s){
      s=s||style();const st=stack(s);if(!st) return null;
      const visible=layerKeys().map(key=>({key,layer:layerFor(key)})).filter(entry=>entry.layer.visible&&entry.layer.opacity>0);
      if(!visible.length)return {hidden:true};
      const {key,layer}=visible[0];s=layer.style;const spec=R.STYLES[s];
      const range=layer.auto&&fitted[key]?fitted[key]:[layer.min,layer.max];
      const overlays=visible.slice(1).map(entry=>(R.STYLES[entry.layer.style]||{}).label).filter(Boolean);
      const caption=`${spec.label}${layer.stops?" · custom colours":` · ${(R.PALETTES[layer.palette]||{}).name||""}`}${overlays.length?` + ${overlays.join(" + ")}`:""}`;
      let ticks;
      if(spec.unit==="shade") ticks=["shadow","relief","illuminated"];
      else if(spec.family==="lines") ticks=["intermediate","index"];
      else ticks=[R.formatValue(s,range[0]),R.formatValue(s,(range[0]+range[1])/2),R.formatValue(s,range[1])+(layer.auto?" · fitted":"")];
      return {caption,bar:R.gradientCss(R.paletteStops(layer),layer.reverse),ticks};
    }

    render();
    return {
      stack,legend,fitFromView,needsFit,
      refresh(){render()},
      state:()=>JSON.parse(JSON.stringify(state)),
      applyLook,
      destroy(){destroyed=true;clearTimeout(saveTimer);container.innerHTML=""}
    };
  }

  return Object.freeze({mount,STORAGE_KEY});
});
