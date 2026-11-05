/* ClearSkies landing scenes.
 *
 * One procedural landscape (a meandering river cut into ridged uplands, with
 * an old road bench and a ring earthwork hidden in the micro-relief) is
 * generated once and shown several ways:
 *   autumn   – the hero: a point-cloud forest mid colour-change on rolling
 *              hills, swaying in a breeze the cursor stirs.
 *   forest   – the Explore page's point-cloud demo. A segmented point-cloud forest, each tree its own
 *              colour, is classified away: every return lifts into the sky,
 *              most burn out, a few stay as stars, and the bare earth beneath
 *              lights up. Clear the canopy, clear the skies. Then the stars
 *              fall back into trees and it begins again.
 *   relight  – a solid terrain with the app's four lighting controls (Explore).
 *   ambient  – a quiet bare-earth point cloud behind the download page.
 *
 * The terrain and trees are synthetic; nothing here is survey data.
 */
import * as THREE from "three";

/* ---------- noise and the height field ---------- */

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct, seed) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function ridged(x, y, oct, seed) {
  let s = 0, a = 0.5, f = 1, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(vnoise(x * f, y * f, seed + i * 31) * 2 - 1);
    r *= r; r *= w; w = Math.min(1, r * 1.7);
    s += a * r; n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const riverZ = x => 0.2 * Math.sin(x * 3.3 + 0.4) + 0.07 * Math.sin(x * 8.1 + 1.3) + 0.025 * Math.sin(x * 17 + 2);
const roadZ = x => -0.5 + 0.16 * Math.sin(x * 2.2 + 1.0) + 0.04 * Math.sin(x * 6.3);

function rawHeight(x, z) {
  const wx = x + 0.4 * (fbm(x * 1.2 + 3.1, z * 1.2 - 1.7, 3, 7) - 0.5);
  const wz = z + 0.4 * (fbm(x * 1.2 - 4.2, z * 1.2 + 2.3, 3, 11) - 0.5);
  let h = 0.5 * fbm(wx * 1.5, wz * 1.5, 5, 1) + 0.5 * ridged(wx * 2.4, wz * 2.4, 6, 3);
  h = Math.pow(h, 1.6) * 1.5;
  const d = Math.abs(z - riverZ(x));
  const floor = 0.02 + 0.06 * (x + 1) * 0.5;            // the river runs toward -x
  h = floor + h * Math.pow(smooth(0.012, 0.34, d), 0.75);
  // Features only bare earth shows: an old road bench and a ring earthwork.
  const dr = (z - roadZ(x)) / 0.013;
  h += -0.018 * Math.exp(-dr * dr) + 0.008 * Math.exp(-(dr - 1.6) * (dr - 1.6));
  const rr = (Math.hypot(x - 0.42, z - 0.36) - 0.085) / 0.011;
  h += 0.016 * Math.exp(-rr * rr);
  return h;
}

/* A sampled grid over [-1,1]²: bilinear height and gradient lookups. */
export function makeField(N = 257) {
  const data = new Float32Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h = rawHeight(-1 + 2 * i / (N - 1), -1 + 2 * j / (N - 1));
    data[j * N + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  for (let k = 0; k < data.length; k++) data[k] = (data[k] - lo) / (hi - lo);
  const sample = (x, z) => {
    const fx = Math.min(N - 1.001, Math.max(0, (x + 1) * 0.5 * (N - 1)));
    const fz = Math.min(N - 1.001, Math.max(0, (z + 1) * 0.5 * (N - 1)));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = data[j * N + i], b = data[j * N + i + 1], c = data[(j + 1) * N + i], d = data[(j + 1) * N + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const e = 2 / (N - 1);
  const grad = (x, z) => [(sample(x + e, z) - sample(x - e, z)) / (2 * e), (sample(x, z + e) - sample(x, z - e)) / (2 * e)];
  return { N, data, sample, grad };
}

export const VS = 0.34;                    // vertical scale of the 0..1 height in scene units
const GLSL_VS = VS.toFixed(3);

/* Shared GLSL: the relative-elevation ramp, bright in the valleys. */
const REM = /* glsl */`
  vec3 rem(float t){
    vec3 c0=vec3(.035,.06,.19), c1=vec3(.05,.33,.50), c2=vec3(.36,.86,.73), c3=vec3(.93,.99,.84);
    t=clamp(t,0.,1.);
    return t<.45?mix(c0,c1,t/.45):t<.78?mix(c1,c2,(t-.45)/.33):mix(c2,c3,(t-.78)/.22);
  }`;

/* Tree colours sampled from segmented-forest LiDAR renders: one per tree. */
const TREE_COLOURS = ["#3a1ed0", "#5326de", "#2a52e0", "#1f8fd6", "#2fb9ad", "#79cf48", "#c9d63a", "#f3cf34", "#f6a02c", "#f46a26", "#ee3b22", "#e02a1c"]
  .map(h => new THREE.Color(h));

/* ---------- the forest ---------- */

function forestScene(field, quality, { auto = true } = {}) {
  const scene = new THREE.Scene();
  const rng = mulberry(11);
  const big = quality > 1;
  const light = [-0.55, 0.7, -0.45];

  // Bare-earth ground returns.
  const G = big ? 360 : 230;
  const gPos = [], gShade = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -1 + 2 * (i + rng()) / G, z = -1 + 2 * (j + rng()) / G;
    const h = field.sample(x, z), [gx, gz] = field.grad(x, z);
    const n = norm([-gx * VS * 1.8, 1, -gz * VS * 1.8]);
    gPos.push(x, h * VS, z);
    gShade.push(Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]));
  }
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute("position", new THREE.Float32BufferAttribute(gPos, 3));
  gGeo.setAttribute("aShade", new THREE.Float32BufferAttribute(gShade, 1));

  // Trees: mostly conifers with whorled branch tiers, some broadleaf crowns.
  const TREES = big ? 1150 : 560, DENS = big ? 2600 : 1900;
  const pos = [], seed = [], col = [];
  let planted = 0;
  for (let tries = 0; planted < TREES && tries < TREES * 6; tries++) {
    const x = -0.98 + 1.96 * rng(), z = -0.98 + 1.96 * rng();
    const river = Math.abs(z - riverZ(x));
    const meadow = fbm(x * 2.2 + 4, z * 2.2 - 7, 3, 41);
    if (river < 0.06 || (meadow > 0.62 && rng() < 0.85)) continue;
    planted++;
    const base = field.sample(x, z) * VS;
    const H = 0.05 + 0.1 * Math.pow(rng(), 1.4) * (0.7 + 0.6 * smooth(0.06, 0.3, river));
    const tr = rng();
    const c = TREE_COLOURS[Math.floor(rng() * TREE_COLOURS.length)];
    const conifer = rng() < 0.8;
    const count = Math.round(DENS * H * (conifer ? 1 : 1.2));
    const R = H * (conifer ? 0.17 + 0.08 * rng() : 0.3 + 0.08 * rng());
    const crownBase = H * (conifer ? 0.15 + 0.2 * rng() : 0.35 + 0.15 * rng());
    const tiers = 7 + Math.floor(rng() * 6), rot = rng() * 6.28, lean = (rng() - 0.5) * 0.08;
    for (let k = 0; k < count; k++) {
      let px, py, pz;
      const pr = rng();
      if (pr < 0.06) {                                   // trunk
        py = rng() * H * 0.9; px = (rng() - 0.5) * 0.002; pz = (rng() - 0.5) * 0.002;
      } else if (conifer) {
        const f = 1 - Math.sqrt(rng());
        const tier = (f * tiers + tr * 3) % 1;
        const rmax = R * Math.pow(1 - f, 0.95);
        const r = rmax * (0.3 + 0.7 * Math.sqrt(rng())) * (0.55 + 0.45 * smooth(0, 0.75, tier));
        const arm = (Math.floor(rng() * 6) + rng() * 0.4) / 6 * 6.283 + rot + f * 4;
        py = crownBase + f * (H - crownBase) - r * 0.35;
        px = Math.cos(arm) * r; pz = Math.sin(arm) * r;
      } else {
        const u = rng() * 6.283, v = Math.acos(2 * rng() - 1), s = Math.pow(rng(), 0.3);
        const lump = 0.8 + 0.35 * vnoise(u * 2, v * 3, planted);
        px = Math.sin(v) * Math.cos(u) * R * s * lump; pz = Math.sin(v) * Math.sin(u) * R * s * lump;
        py = H * 0.62 + Math.cos(v) * H * 0.34 * s * lump;
        if (py < crownBase) py = crownBase + rng() * 0.01;
      }
      const hf = Math.min(1, py / H);
      pos.push(x + px + lean * py, base + py, z + pz);
      seed.push(tr, rng(), x, hf);
      const shadeK = 0.72 + 0.4 * rng();
      col.push(c.r * shadeK, c.g * shadeK, c.b * shadeK);
    }
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  tGeo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 4));
  tGeo.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));

  const WAVE = 0.6;                                     // classification sweep speed, units per second
  const uniforms = {
    uTime: { value: 0 }, uClearT: { value: -100 }, uGrow: { value: 1 }, uGrowing: { value: 0 },
    uWave: { value: WAVE }, uPx: { value: 1 }, uSize: { value: big ? 1.25 : 1.7 }, uColorMode: { value: 0 }
  };
  const tMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; attribute vec3 aColor;
      uniform float uTime, uClearT, uGrow, uGrowing, uWave, uPx, uSize, uColorMode;
      varying vec3 vCol;
      float h1(float n){ return fract(sin(n*12.9898)*43758.5453); }
      ${REM}
      void main(){
        float tr=aSeed.x, pr=aSeed.y, hf=aSeed.w;
        // Tops lift first; each tree goes when the sweep reaches it.
        float age = uClearT - (aSeed.z + 1.3)/uWave - (1.-hf)*.5 - pr*.35 - tr*.3;
        float pClear = smoothstep(0., 2.1, age);
        float d = tr*.42 + pr*.1;
        float pGrow = 1. - smoothstep(d, d + .48, uGrow);
        float p = mix(pClear, pGrow, uGrowing);
        float e = p*p*(3.-2.*p), arc = sin(e*3.14159);
        float r1=h1(pr*91.7+tr), r2=h1(pr*53.3+1.7), r3=h1(pr*17.1+3.1);
        vec3 sky = position + vec3(.18 + (r1-.5)*.25, .3 + r2*.45, (r3-.5)*.25);
        vec3 swirl = vec3(sin(pr*40.+uTime*.7), .5*sin(pr*23.+uTime*.9), cos(pr*33.+uTime*.6)) * .05 * arc;
        vec3 p3 = mix(position, sky, e) + swirl;
        float isStar = 0.;
        float gone = step(.2 + .6*h1(pr*3.3), p);
        vec3 base = aColor;
        if (uColorMode > .5 && uColorMode < 1.5) base = rem(1. - position.y/${GLSL_VS}*.95) * 1.1;   // elevation
        if (uColorMode > 1.5) base = vec3(.28,.78,.34) * (.6 + .5*h1(tr*9.1));                    // class 5, high vegetation
        vec3 c = base * (.55 + .6*hf);
        c = mix(c, vec3(.84,.95,1.), smoothstep(.35,.95,p)) + base*arc*.8;
        float tw = .55 + .45*sin(uTime*2.3 + pr*90.);
        vCol = c * mix(1., tw*.9+.2, smoothstep(.85,1.,p));
        vec4 mv = modelViewMatrix * vec4(p3,1.);
        gl_Position = gone > .5 ? vec4(2.,2.,2.,1.) : projectionMatrix * mv;
        gl_PointSize = uSize*uPx*(2.2/-mv.z) * (1. + arc*.4);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main(){ vec2 c = gl_PointCoord - .5; if (dot(c,c) > .25) discard; gl_FragColor = vec4(vCol,1.); }`
  });

  const gMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute float aShade;
      uniform float uClearT, uGrow, uGrowing, uWave, uPx, uSize, uColorMode;
      varying vec3 vCol;
      ${REM}
      void main(){
        float a = uClearT - (position.x + 1.3)/uWave - .55;
        float rev = mix(smoothstep(0., 1.4, a), 1. - smoothstep(.15, .85, uGrow), uGrowing);
        float h = position.y / ${GLSL_VS};
        vec3 lit = rem(1. - h*1.12) * (.3 + 1.05*aShade);
        if (uColorMode > 1.5) lit = vec3(.62,.44,.28) * (.3 + 1.0*aShade);       // class 2, ground
        vec3 hidden = vec3(.03,.055,.11) * (.35 + .8*aShade);
        vCol = mix(hidden, lit, rev) + vec3(.55,1.,.9) * exp(-(a+.2)*(a+.2)*10.) * .5 * (1.-uGrowing);
        vec4 mv = modelViewMatrix * vec4(position,1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize*uPx*(2.2/-mv.z)*1.15;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main(){ vec2 c = gl_PointCoord - .5; if (dot(c,c) > .25) discard; gl_FragColor = vec4(vCol,1.); }`
  });
  scene.add(new THREE.Points(gGeo, gMat));
  scene.add(new THREE.Points(tGeo, tMat));

  // The sweep: a thin curtain of light standing on the terrain.
  const CN = 120, cPos = new Float32Array(CN * 2 * 3), cV = new Float32Array(CN * 2), cIdx = [];
  for (let i = 0; i < CN; i++) { cV[i * 2] = 0; cV[i * 2 + 1] = 1; if (i < CN - 1) { const a = i * 2; cIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
  cGeo.setAttribute("aV", new THREE.BufferAttribute(cV, 1));
  cGeo.setIndex(cIdx);
  const cMat = new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aV; varying float vV; void main(){ vV=aV; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uOn; varying float vV; void main(){ gl_FragColor=vec4(.5,1.,.88, pow(1.-vV,3.)*.32*uOn); }`
  });
  const curtain = new THREE.Mesh(cGeo, cMat);
  curtain.frustumCulled = false;
  scene.add(curtain);

  // Timeline: stars fall into trees, the forest stands, the sweep clears it, bare earth holds.
  const GROW = 3.4, STAND = 2.4, CLEAR = 8.2, HOLD = 4.6, CYCLE = GROW + STAND + CLEAR + HOLD;
  let manual = { phase: "stand", t0: 0 };
  function applyPhase(phase, local) {
    if (phase === "grow") { uniforms.uGrowing.value = 1; uniforms.uGrow.value = Math.min(1, local / GROW); uniforms.uClearT.value = -100; }
    else if (phase === "stand") { uniforms.uGrowing.value = 0; uniforms.uGrow.value = 1; uniforms.uClearT.value = -100; }
    else if (phase === "clear") { uniforms.uGrowing.value = 0; uniforms.uClearT.value = local; }
    else { uniforms.uGrowing.value = 0; uniforms.uClearT.value = 100; }
  }
  return {
    scene, camera: auto ? { radius: 2.2, polar: 1.13, height: 0.03, spin: 0.012 } : { radius: 2.75, polar: 1.0, height: 0.02, spin: 0.03 },
    start: auto ? GROW : 0,
    still: auto ? GROW + STAND + 4.6 : 0,
    // Explore page: "all" regrows the canopy, "bare" sweeps it away.
    setReturns(which, t) {
      const from = manual.phase;
      if (which === "bare" && from !== "clear" && from !== "hold") manual = { phase: "clear", t0: t };
      if (which === "all" && (from === "clear" || from === "hold")) manual = { phase: "grow", t0: t };
    },
    setColour(mode) { uniforms.uColorMode.value = { tree: 0, elevation: 1, class: 2 }[mode] ?? 0; },
    update(t, ctx) {
      uniforms.uPx.value = ctx.px; uniforms.uTime.value = t;
      let phase, local;
      if (auto) {
        const tc = t % CYCLE;
        if (tc < GROW) { phase = "grow"; local = tc; }
        else if (tc < GROW + STAND) { phase = "stand"; local = tc - GROW; }
        else if (tc < GROW + STAND + CLEAR) { phase = "clear"; local = tc - GROW - STAND; }
        else { phase = "hold"; local = 0; }
      } else {
        local = t - manual.t0;
        if (manual.phase === "clear" && local > CLEAR) manual = { phase: "hold", t0: t };
        if (manual.phase === "grow" && local > GROW) manual = { phase: "stand", t0: t };
        phase = manual.phase;
      }
      applyPhase(phase, local);
      const wx = phase === "clear" ? local * WAVE - 1.3 : 9;
      const on = wx > -1 && wx < 1 ? Math.min(1, (wx + 1) * 4, (1 - wx) * 4) : 0;
      cMat.uniforms.uOn.value = on;
      if (on > 0) {
        for (let i = 0; i < CN; i++) {
          const z = -1 + 2 * i / (CN - 1), y = field.sample(wx, z) * VS;
          cPos.set([wx, y, z, wx, y + 0.42, z], i * 6);
        }
        cGeo.attributes.position.needsUpdate = true;
      }
    },
    dispose() { gGeo.dispose(); gMat.dispose(); tGeo.dispose(); tMat.dispose(); cGeo.dispose(); cMat.dispose(); }
  };
}


/* ---------- the autumn forest: the hero ---------- */

/* A point-cloud forest in the middle of the fall colour change, standing on
   rolling hills that recede into the dark. Conifers stay green; broadleaf
   crowns are part-way through turning brown, orange, red and purple. A breeze
   moves through it, and the cursor stirs gusts that ripple out across the
   canopy. The sky above is left black for the copy. */
const EVERGREEN = ["#2c7a38", "#3a8a3e", "#4f9a44", "#2f6e52", "#467a2c"].map(h => new THREE.Color(h));
const FALL = ["#f0711e", "#f7962a", "#de3a22", "#c02a22", "#9a3a9c", "#7d3590", "#93592a", "#ad7034", "#e8aa30"].map(h => new THREE.Color(h));
const LEAF_GREEN = new THREE.Color("#5a8a2e");
const LITTER = ["#7a4e24", "#94602c", "#a8461f", "#55642a", "#7e3646"].map(h => new THREE.Color(h));

function autumnScene(field, quality) {
  const scene = new THREE.Scene();
  const big = quality > 1;
  const NEAR = 0.6, FAR = 34, SPAN0 = 1.4, SPANK = 1.05;   // visible half-width ≈ SPAN0 + SPANK·distance
  const hill = (x, z) => {
    const d = Math.max(0, -z);
    // ridges stack upward with distance so each fold of the hills shows behind the last
    return 0.006 * Math.pow(d, 1.6) + (fbm(x * 0.13 + 10, z * 0.15 + 3, 4, 77) - 0.42) * (0.25 + 0.75 * smooth(1, 6, d) + 0.05 * d) * 2.1 + 0.1 * fbm(x * 0.8, z * 0.8, 3, 9);
  };
  const eyeGround = hill(0, -1);
  // Sun low from the upper left: lit slopes brighten, so the folds of the hills read.
  const slopeLight = (x, z) => {
    const e = 0.05, gx = (hill(x + e, z) - hill(x - e, z)) / (2 * e), gz = (hill(x, z + e) - hill(x, z - e)) / (2 * e);
    const n = norm([-gx, 1, -gz]);
    return 0.45 + 0.95 * Math.max(0, n[0] * -0.6 + n[1] * 0.55 + n[2] * 0.58);
  };
  const uniforms = {
    uTime: { value: 0 }, uPx: { value: 1 }, uSize: { value: big ? 1.0 : 1.25 }, uWind: { value: null },
    uNear: { value: NEAR }, uFar: { value: FAR }, uSpan0: { value: SPAN0 }, uSpanK: { value: SPANK }
  };
  const WX = 96, WZ = 48, wind = new Float32Array(WX * WZ), windV = new Float32Array(WX * WZ);
  const windTex = new THREE.DataTexture(wind, WX, WZ, THREE.RedFormat, THREE.FloatType);
  windTex.magFilter = windTex.minFilter = THREE.LinearFilter;
  windTex.needsUpdate = true;
  uniforms.uWind.value = windTex;

  const rng = mulberry(29);
  const pos = [], seed = [], tree = [], col = [];
  const push = (x, y, z, c, tr, pr, bx, bz, hf, H) => { pos.push(x, y, z); seed.push(tr, pr, bx, hf); tree.push(bz, H); col.push(c.r, c.g, c.b); };

  // Trees: denser and more detailed near the viewer, thinning into the distance.
  const TREES = big ? 3000 : 1900, DENS = big ? 3000 : 2200;
  for (let n = 0; n < TREES; n++) {
    const d = 1.3 + (FAR - 1.3) * Math.pow(rng(), 1.5);
    const half = SPAN0 + SPANK * d;
    const x = (rng() * 2 - 1) * half, z = -d;
    if (fbm(x * 0.35 + 5, z * 0.35, 3, 61) > 0.6 && rng() < 0.9) { n--; continue; }   // meadows let the hills show
    const base = hill(x, z);
    const lit = slopeLight(x, z);
    const conifer = rng() < 0.42;
    const H = (conifer ? 0.2 + 0.2 * rng() : 0.14 + 0.14 * rng()) * (0.85 + 0.3 * rng());
    const tr = rng();
    const count = Math.max(30, Math.round(DENS * H * (conifer ? 1 : 1.35) / Math.pow(Math.max(d, 1.8) / 2.4, 1.05)));
    const c = conifer ? EVERGREEN[Math.floor(rng() * EVERGREEN.length)] : FALL[Math.floor(rng() * FALL.length)];
    const turn = 0.45 + 0.55 * rng();                     // how far this crown has turned
    const R = H * (conifer ? 0.16 + 0.08 * rng() : 0.34 + 0.1 * rng());
    const crownBase = H * (conifer ? 0.12 + 0.2 * rng() : 0.3 + 0.15 * rng());
    const tiers = 7 + Math.floor(rng() * 6), rot = rng() * 6.28;
    for (let k = 0; k < count; k++) {
      let px, py, pz, pc = c;
      if (rng() < 0.05) { py = rng() * H * 0.9; px = (rng() - 0.5) * 0.006; pz = (rng() - 0.5) * 0.006; pc = LITTER[0]; }
      else if (conifer) {
        const f = 1 - Math.sqrt(rng());
        const tier = (f * tiers + tr * 3) % 1;
        const rmax = R * Math.pow(1 - f, 0.9);
        const r = rmax * (0.3 + 0.7 * Math.sqrt(rng())) * (0.55 + 0.45 * smooth(0, 0.8, tier));
        const a = (Math.floor(rng() * 6) + rng() * 0.4) / 6 * 6.283 + rot + f * 4;
        px = Math.cos(a) * r; pz = Math.sin(a) * r; py = crownBase + f * (H - crownBase) - r * 0.35;
      } else {
        const u = rng() * 6.283, v = Math.acos(2 * rng() - 1), s = Math.pow(rng(), 0.35);
        const lump = 0.78 + 0.4 * vnoise(u * 2 + tr * 9, v * 3, 5);
        px = Math.sin(v) * Math.cos(u) * R * s * lump; pz = Math.sin(v) * Math.sin(u) * R * s * lump;
        py = H * 0.62 + Math.cos(v) * H * 0.36 * s * lump;
        if (py < crownBase) py = crownBase + rng() * 0.02;
        if (rng() > turn) pc = LEAF_GREEN;                 // leaves that haven't turned yet
        else if (rng() < 0.2) pc = FALL[Math.floor(rng() * FALL.length)];
      }
      const kk = (0.72 + 0.4 * rng()) * lit;
      push(x + px, base + py, z + pz, { r: pc.r * kk, g: pc.g * kk, b: pc.b * kk }, tr, rng(), x, z, Math.max(0, Math.min(1, py / H)), H);
    }
  }
  // Ground returns: leaf litter and grass over the hills.
  const GROUND = big ? 200000 : 90000;
  for (let i = 0; i < GROUND; i++) {
    const d = NEAR + (FAR - NEAR) * Math.pow(rng(), 1.9);
    const x = (rng() * 2 - 1) * (SPAN0 + SPANK * d), z = -d;
    const c = LITTER[Math.floor(rng() * LITTER.length)], kk = (0.6 + 0.6 * rng()) * slopeLight(x, z) * 1.25;
    push(x, hill(x, z) + rng() * 0.01, z, { r: c.r * kk, g: c.g * kk, b: c.b * kk }, 0, rng(), x, z, 0, 0.01);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 4));
  geo.setAttribute("aTree", new THREE.Float32BufferAttribute(tree, 2));
  geo.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; attribute vec2 aTree; attribute vec3 aColor;
      uniform sampler2D uWind; uniform float uTime, uPx, uSize, uNear, uFar, uSpan0, uSpanK;
      varying vec3 vCol;
      void main(){
        float hf = aSeed.w, bx = aSeed.z, bz = aTree.x, H = aTree.y, dist = -bz;
        vec2 wuv = vec2(.5 + .5 * bx / (uSpan0 + uSpanK*dist), (dist - uNear)/(uFar - uNear));
        float gust = texture2D(uWind, clamp(wuv, 0., 1.)).r;
        float breeze = .25*(.5 + sin(uTime*.8 + bx*2.1 + bz*.7 + aSeed.x*6.)*.6 + sin(uTime*.33 - bx*.4 + bz*.3)*.9);
        float bend = pow(hf, 1.7) * H * .32;
        vec3 p = position;
        p.x += (breeze + gust) * bend;
        p.y -= abs(gust) * bend * .15;
        p.x += sin(uTime*5.3 + aSeed.y*60.) * .0035 * hf * H;
        p.y += cos(uTime*4.1 + aSeed.y*40.) * .0025 * hf * H;
        float fog = exp(-max(dist - 5., 0.) * .05);
        vCol = mix(vec3(.012,.012,.03), aColor * 1.45, fog);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.2 * uPx, uSize * uPx * (3.4 / -mv.z));
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main(){ vec2 c = gl_PointCoord - .5; if (dot(c,c) > .25) discard; gl_FragColor = vec4(vCol, 1.); }`
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  const ray = new THREE.Raycaster();
  let prev = null, vel = 0;
  return {
    scene, start: 0, still: 6,
    camera3d(cam, aspect, t, sx, sy, horizon) {
      const narrow = aspect < 0.9;
      const eye = eyeGround + 0.95;
      cam.fov = narrow ? 46 : 38;
      cam.position.set(sx * 0.12, eye + sy * 0.03, 1.6);
      // Tilt up until the farthest ridges sit just below the copy (horizon = fraction of the
      // window from the top where the forest may begin); the far ridges rise about 2.8° above eye level.
      const top = 1 - 2 * (horizon ?? (narrow ? 0.6 : 0.55));
      const pitch = Math.atan(-top * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) + THREE.MathUtils.degToRad(2.8);
      cam.lookAt(sx * 0.12, eye + Math.tan(pitch) * 11.6, -10);
      cam.updateProjectionMatrix();
    },
    update(t, ctx) {
      uniforms.uTime.value = t; uniforms.uPx.value = ctx.px;
      const dt = Math.min(0.05, ctx.dt || 0.016);
      let hit = null;
      if (ctx.pointerNdc && ctx.camera) {
        ray.setFromCamera(ctx.pointerNdc, ctx.camera);
        const o = ray.ray.origin, dir = ray.ray.direction;
        for (let s = 0.3; s < FAR + 4; s *= 1.04) {          // march to the first hill or canopy height it meets
          const x = o.x + dir.x * s, y = o.y + dir.y * s, z = o.z + dir.z * s;
          if (-z > NEAR && y < hill(x, z) + 0.3) { hit = { x, z, d: -z }; break; }
        }
      }
      if (hit && prev) vel = vel * 0.6 + ((ctx.pointerNdc.x - prev) / Math.max(dt, 1e-3)) * 0.4; else vel *= 0.85;
      prev = ctx.pointerNdc ? ctx.pointerNdc.x : null;
      const steps = 3, h = dt / steps, K = 14, C = 2.4, S = 18;
      for (let s = 0; s < steps; s++) {
        if (hit && Math.abs(vel) > 0.01) {
          const ci = (0.5 + 0.5 * hit.x / (SPAN0 + SPANK * hit.d)) * (WX - 1), cj = (hit.d - NEAR) / (FAR - NEAR) * (WZ - 1);
          const rx = 5, rz = 3;
          for (let j = Math.max(0, Math.floor(cj - rz * 2)); j < Math.min(WZ, Math.ceil(cj + rz * 2)); j++)
            for (let i = Math.max(0, Math.floor(ci - rx * 2)); i < Math.min(WX, Math.ceil(ci + rx * 2)); i++) {
              const q = ((i - ci) / rx) ** 2 + ((j - cj) / rz) ** 2;
              windV[j * WX + i] += Math.max(-3, Math.min(3, vel)) * Math.exp(-q) * 2.2 * h;
            }
        }
        for (let j = 0; j < WZ; j++) for (let i = 0; i < WX; i++) {
          const k = j * WX + i, w = wind[k];
          const lap = (i > 0 ? wind[k - 1] : w) + (i < WX - 1 ? wind[k + 1] : w) + (j > 0 ? wind[k - WX] : w) + (j < WZ - 1 ? wind[k + WX] : w) - 4 * w;
          windV[k] += (-K * w - C * windV[k] + S * lap) * h;
        }
        for (let k = 0; k < wind.length; k++) wind[k] = Math.max(-1.2, Math.min(1.2, wind[k] + windV[k] * h));
      }
      windTex.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); windTex.dispose(); }
  };
}

/* ---------- relight: the app's terrain lighting controls ---------- */

function relightScene(field, quality) {
  const scene = new THREE.Scene();
  const g = new THREE.PlaneGeometry(2, 2, quality > 1 ? 320 : 200, quality > 1 ? 320 : 200);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) p.setY(k, field.sample(p.getX(k), p.getZ(k)) * VS);
  g.computeVertexNormals();
  const uniforms = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uAmb: { value: 0.18 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vN; varying float vH; void main(){ vN=normal; vH=position.y/${GLSL_VS}; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uAmb; varying vec3 vN; varying float vH;
      ${REM}
      void main(){
        vec3 n = normalize(vN);
        float dif = max(dot(n, uSun), 0.);
        vec3 col = rem(1. - vH*1.1) * (uAmb + (1.-uAmb)*pow(dif, 1.2)) * 1.12;
        gl_FragColor = vec4(col, 1.);
      }`
  });
  const mesh = new THREE.Mesh(g, mat);
  scene.add(mesh);
  let relief = 1;
  return {
    scene, camera: { radius: 2.75, polar: 0.86, height: 0.0, spin: 0.02 },
    // The normals are baked at 1× relief; rescale them with the mesh so lighting stays true.
    setLight(az, alt, amb) {
      const ar = THREE.MathUtils.degToRad(az), lr = THREE.MathUtils.degToRad(alt);
      uniforms.uSun.value.set(Math.sin(ar) * Math.cos(lr), Math.sin(lr) / relief, -Math.cos(ar) * Math.cos(lr)).normalize();
      uniforms.uAmb.value = amb;
      this._l = [az, alt, amb];
    },
    setRelief(r) { relief = r; mesh.scale.y = r; if (this._l) this.setLight(...this._l); },
    update() {},
    dispose() { g.dispose(); mat.dispose(); }
  };
}

/* ---------- download page: a quiet bare-earth cloud ---------- */

function ambientScene(field, quality) {
  const scene = new THREE.Scene();
  const G = quality > 1 ? 240 : 160, pos = [], col = [];
  const rng = mulberry(3);
  const P = [[.035, .06, .19], [.05, .33, .50], [.36, .86, .73], [.93, .99, .84]];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -1 + 2 * (i + rng()) / G, z = -1 + 2 * (j + rng()) / G, h = field.sample(x, z);
    pos.push(x, h * VS, z);
    const t = Math.min(1, Math.max(0, 1 - h * 1.15)) * 3, k = Math.min(2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) col.push(P[k][c] + (P[k + 1][c] - P[k][c]) * f);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: quality > 1 ? 0.0085 : 0.011, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(geo, mat));
  return { scene, camera: { radius: 2.5, polar: 1.0, height: 0.0, spin: 0.035 }, update() {}, dispose() { geo.dispose(); mat.dispose(); } };
}

const BUILDERS = { autumn: autumnScene, forest: forestScene, relight: relightScene, ambient: ambientScene };
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const qualityFor = el => ((el.clientWidth > 700 || Math.min(innerWidth, innerHeight) > 700) && (navigator.hardwareConcurrency || 4) >= 4) ? 2 : 1;
let sharedField = null;
const getField = q => sharedField || (sharedField = makeField(q > 1 ? 385 : 257));

function orbit(camera, c, t, sx = 0, sy = 0, shift = 0, reduced = false) {
  const az = 0.62 + (reduced ? 0 : t * (c.spin ?? 0.012)) + sx;
  const polar = c.polar + sy;
  camera.position.set(Math.sin(az) * Math.sin(polar) * c.radius, Math.cos(polar) * c.radius + c.height, Math.cos(az) * Math.sin(polar) * c.radius);
  camera.lookAt(0, c.height + 0.08, 0);
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[8] = -shift;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/* ---------- full-window stage (landing and download backgrounds) ---------- */

export function createStage(canvas, opts = {}) {
  const reduced = reducedMotion();
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
  catch (e) { opts.onNoWebGL && opts.onNoWebGL(); return null; }
  const quality = qualityFor(canvas), field = getField(quality);
  const persp = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  ortho.position.set(0, 0, 5);
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, inside: false };
  const ctx = { px: 1, dt: 0.016, pointerWorld: null };
  let current = null, t0 = performance.now(), last = t0, shift = 0, visible = true, aspect = 1;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.px = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ctx.px);
    renderer.setSize(w, h, false);
    aspect = w / h;
    persp.aspect = aspect;
    ortho.left = -aspect; ortho.right = aspect; ortho.updateProjectionMatrix();
    shift = w > 900 ? (opts.shift ?? 0.3) : 0;
    if (current && current.resize) current.resize(aspect, w < 700);
  }
  function render(t) {
    let cam = ortho;
    if (current.camera3d) { cam = persp; current.camera3d(persp, aspect, t, pointer.sx, pointer.sy, opts.horizon && opts.horizon()); }
    else if (!current.ortho) { cam = persp; orbit(persp, current.camera, t, pointer.sx * 0.16, pointer.sy * 0.05, shift, reduced); }
    ctx.pointerWorld = pointer.inside ? { x: pointer.x * aspect, y: pointer.y } : null;
    ctx.pointerNdc = pointer.inside ? { x: pointer.x, y: pointer.y } : null;
    ctx.camera = cam;
    current.update(t, ctx);
    renderer.render(current.scene, cam);
  }
  function set(name) {
    if (current) current.dispose();
    current = BUILDERS[name](field, quality);
    current.scene.background = new THREE.Color(opts.background ?? 0x02050d);
    if (current.resize) current.resize(aspect, canvas.clientWidth < 700);
    t0 = performance.now() - (current.start ?? 0) * 1000;
    if (reduced) render(current.still ?? 30);
  }
  function loop(now) {
    requestAnimationFrame(loop);
    if (!visible || !current) return;
    ctx.dt = Math.min(0.05, (now - last) / 1000); last = now;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, ctx.dt * 2.5);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, ctx.dt * 2.5);
    render((now - t0) / 1000);
  }
  addEventListener("pointermove", e => {
    pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = -(e.clientY / innerHeight * 2 - 1); pointer.inside = true;
  }, { passive: true });
  const leave = () => { pointer.inside = false; };
  document.documentElement.addEventListener("pointerleave", leave);
  addEventListener("pointerup", e => { if (e.pointerType !== "mouse") leave(); });
  addEventListener("blur", leave);
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; last = performance.now(); });
  addEventListener("resize", () => { resize(); if (reduced && current) render(current.still ?? 30); });
  resize();
  if (!reduced) requestAnimationFrame(loop);
  return { set };
}

/* ---------- inline demo canvases (Explore page) ---------- */

export function createDemo(canvas, name, opts = {}) {
  const reduced = reducedMotion();
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { opts.onNoWebGL && opts.onNoWebGL(); return null; }
  const quality = qualityFor(canvas), field = getField(quality);
  const demo = BUILDERS[name](field, quality, { auto: false });
  demo.scene.background = new THREE.Color(opts.background ?? 0x02050d);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 50);
  const ctx = { px: 1 };
  let drag = null, yaw = 0, pitch = 0, visible = false, last = performance.now(), t = 0, dirty = true;

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.px = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ctx.px); renderer.setSize(w, h, false);
    camera.aspect = w / h; dirty = true;
  };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = performance.now(); }, { rootMargin: "100px" }).observe(canvas);
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => {
    if (!drag) return;
    yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
    pitch = Math.max(-0.35, Math.min(0.3, drag.pitch - (e.clientY - drag.y) * 0.004));
    dirty = true;
  });
  const end = () => { drag = null; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const animating = !reduced || name === "forest";
    if (!animating && !dirty) return;
    if (animating) t += dt;
    orbit(camera, demo.camera, reduced ? 0 : t, yaw, pitch, 0, reduced);
    demo.update(t, ctx);
    renderer.render(demo.scene, camera);
    dirty = false;
  }
  requestAnimationFrame(frame);
  return {
    setReturns: w => { demo.setReturns && demo.setReturns(w, t); },
    setColour: m => { demo.setColour && demo.setColour(m); dirty = true; },
    setLight: (az, alt, amb) => { demo.setLight && demo.setLight(az, alt, amb); dirty = true; },
    setRelief: r => { demo.setRelief && demo.setRelief(r); dirty = true; }
  };
}

/* ---------- helpers ---------- */
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
