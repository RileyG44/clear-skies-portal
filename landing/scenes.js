/* ClearSkies landing scenes.
 *
 * One procedural landscape (a meandering canyon river cut into ridged uplands)
 * is generated once and shown three ways, one per concept direction:
 *   sweep     – an airborne LiDAR pass that reveals the point cloud, then strips
 *               the canopy returns away to bare earth on the next pass.
 *   watershed – water traces itself downhill over a dark hillshade until the
 *               drainage network glows, like a relative elevation model.
 *   relight   – a solid terrain the visitor relights by moving the sun.
 * The download page uses ambient(), a slow, quiet version of the point cloud.
 *
 * The terrain is synthetic. The HUD says so; ClearSkies never labels
 * overview or invented data as LiDAR.
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

function rawHeight(x, z) {
  const wx = x + 0.4 * (fbm(x * 1.2 + 3.1, z * 1.2 - 1.7, 3, 7) - 0.5);
  const wz = z + 0.4 * (fbm(x * 1.2 - 4.2, z * 1.2 + 2.3, 3, 11) - 0.5);
  let h = 0.5 * fbm(wx * 1.5, wz * 1.5, 5, 1) + 0.5 * ridged(wx * 2.4, wz * 2.4, 6, 3);
  h = Math.pow(h, 1.6) * 1.5;
  const d = Math.abs(z - riverZ(x));
  const floor = 0.02 + 0.06 * (x + 1) * 0.5;            // the river runs toward -x
  const wall = Math.pow(smooth(0.012, 0.34, d), 0.75);
  return floor + h * wall;
}

/* A sampled grid over [-1,1]²: bilinear height and gradient lookups. */
export function makeField(N = 257) {
  const data = new Float32Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h = rawHeight(-1 + 2 * i / (N - 1), -1 + 2 * j / (N - 1));
    data[j * N + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  for (let k = 0; k < data.length; k++) data[k] = (data[k] - lo) / (hi - lo);   // normalise 0..1
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

export const VS = 0.42;                    // vertical scale of the 0..1 height in scene units
export const KM_PER_UNIT = 3.2;            // the 2-unit tile reads as a 6.4 km square
export const ftAt = h => Math.round(2140 + h * 3260);

function terrainGeometry(field, segs) {
  const g = new THREE.PlaneGeometry(2, 2, segs, segs);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) p.setY(k, field.sample(p.getX(k), p.getZ(k)) * VS);
  g.computeVertexNormals();
  return g;
}

/* ---------- direction A: the LiDAR sweep ---------- */

function sweepScene(field, quality) {
  const scene = new THREE.Scene();
  const G = quality > 1 ? 330 : 210;
  const pos = [], canopy = [], rnd = [], shade = [];
  const light = [-0.55, 0.7, -0.45];
  const rng = mulberry(7);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -1 + 2 * (i + rng() * 0.9) / G, z = -1 + 2 * (j + rng() * 0.9) / G;
    const h = field.sample(x, z), [gx, gz] = field.grad(x, z);
    const n = norm([-gx * VS, 1, -gz * VS]);
    const s = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
    pos.push(x, h * VS, z); canopy.push(0); rnd.push(rng()); shade.push(s);
    const forest = smooth(0.48, 0.62, fbm(x * 2.6 + 9, z * 2.6 - 4, 3, 99)) * smooth(0.05, 0.16, Math.abs(z - riverZ(x)));
    if (rng() < forest * 0.85) {
      const tall = 0.018 + 0.05 * fbm(x * 9, z * 9, 2, 5) * (0.6 + rng() * 0.6);
      pos.push(x + (rng() - 0.5) * 0.006, h * VS, z + (rng() - 0.5) * 0.006);
      canopy.push(tall * (0.55 + 0.45 * rng())); rnd.push(rng()); shade.push(s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aCanopy", new THREE.Float32BufferAttribute(canopy, 1));
  geo.setAttribute("aRand", new THREE.Float32BufferAttribute(rnd, 1));
  geo.setAttribute("aShade", new THREE.Float32BufferAttribute(shade, 1));
  const uniforms = {
    uScan: { value: -2 }, uAhead: { value: 0 }, uBehind: { value: 1 },
    uPx: { value: 1 }, uSize: { value: quality > 1 ? 1.6 : 2.2 }, uTime: { value: 0 }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aCanopy; attribute float aRand; attribute float aShade;
      uniform float uScan, uAhead, uBehind, uPx, uSize, uTime;
      varying vec3 vCol; varying float vAlpha;
      vec3 rem(float t){                       // navy → teal → mint → cream, bright in the valleys
        vec3 c0=vec3(.035,.06,.19), c1=vec3(.05,.33,.50), c2=vec3(.36,.86,.73), c3=vec3(.93,.99,.84);
        t=clamp(t,0.,1.);
        return t<.45?mix(c0,c1,t/.45):t<.78?mix(c1,c2,(t-.45)/.33):mix(c2,c3,(t-.78)/.22);
      }
      // state of a point in one mode: x = ground alpha, y = canopy visible
      vec2 modeState(float m){ return m<.5?vec2(.07,0.):m<1.5?vec2(1.,1.):vec2(1.,0.); }
      void main(){
        float d = uScan - position.x;
        float side = smoothstep(0., .22 + aRand*.12, d);
        vec2 a = modeState(uAhead), b = modeState(uBehind);
        vec2 st = mix(a, b, side);
        float isCanopy = step(.0001, aCanopy);
        float vis = mix(st.x, st.x*st.y, isCanopy);
        vec3 p = position; p.y += aCanopy * mix(.0, 1., st.y);
        float h = position.y / ${VS.toFixed(3)};
        vec3 ground = rem(1. - h*1.18) * (.42 + .9*aShade);
        vec3 leaf = vec3(.62,.95,.84) * (.35 + .4*aRand);
        vCol = mix(ground, leaf, isCanopy);
        float flash = exp(-abs(d)*55.);
        vCol += vec3(.75,1.,.95) * flash * 1.4;
        vAlpha = clamp(vis*.62 + flash*.6, 0., 1.);
        vec4 mv = modelViewMatrix * vec4(p,1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPx * (1. + flash*1.6) * (2.2 / -mv.z);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vAlpha;
      void main(){
        vec2 c = gl_PointCoord - .5; float r = dot(c,c);
        if (r > .25) discard;
        gl_FragColor = vec4(vCol, vAlpha * (1. - r*2.4));
      }`
  });
  scene.add(new THREE.Points(geo, mat));

  /* The scanner: a sensor above, its swath fanning across the track, and the
     bright line where the pulses meet the ground. */
  const fanGeo = new THREE.BufferGeometry();
  const fanPos = new Float32Array(9), fanV = new Float32Array([0, 1, 1]);
  fanGeo.setAttribute("position", new THREE.BufferAttribute(fanPos, 3));
  fanGeo.setAttribute("aV", new THREE.BufferAttribute(fanV, 1));
  const fanMat = new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aV; varying float vV; void main(){ vV=aV; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uOn; varying float vV; void main(){ gl_FragColor=vec4(.45,.95,.85,(.006+.06*vV*vV)*uOn); }`
  });
  const fan = new THREE.Mesh(fanGeo, fanMat);
  scene.add(fan);
  const LN = 160, linePos = new Float32Array(LN * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xd8fff1, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.Line(lineGeo, lineMat));

  const PASS = 10, GAP = 3.2;
  const MODES = [null, { label: "Pass {n} · All returns", sub: "First returns include canopy and structures" },
                       { label: "Pass {n} · Bare earth", sub: "Ground class only, canopy removed" }];
  let lastPass = -1;
  return {
    scene, camera: { radius: 2.35, polar: 0.98, height: 0.06 },
    status: "Airborne scan",
    update(t, ctx) {
      uniforms.uPx.value = ctx.px; uniforms.uTime.value = t;
      const cycle = PASS + GAP, n = Math.floor(t / cycle), local = t - n * cycle;
      if (n !== lastPass) {
        lastPass = n;
        uniforms.uAhead.value = n === 0 ? 0 : (n % 2 === 1 ? 1 : 2);
        uniforms.uBehind.value = n % 2 === 0 ? 1 : 2;
        const m = MODES[uniforms.uBehind.value];
        ctx.setStatus(m.label.replace("{n}", String(n + 1).padStart(2, "0")), m.sub);
      }
      const k = Math.min(1, local / PASS);
      const sx = -1.25 + 2.5 * easeInOut(k);
      uniforms.uScan.value = local < PASS ? sx : 3;
      const on = local < PASS ? Math.min(1, local * 2, (PASS - local) * 2) : 0;
      fanMat.uniforms.uOn.value = on; lineMat.opacity = on * 0.9;
      const cx = Math.max(-1, Math.min(1, sx));
      fanPos.set([cx - 0.05, 1.05, 0, cx, field.sample(cx, -1) * VS, -1, cx, field.sample(cx, 1) * VS, 1]);
      fanGeo.attributes.position.needsUpdate = true;
      for (let i = 0; i < LN; i++) {
        const z = -1 + 2 * i / (LN - 1);
        linePos[i * 3] = cx; linePos[i * 3 + 1] = field.sample(cx, z) * VS + 0.004; linePos[i * 3 + 2] = z;
      }
      lineGeo.attributes.position.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); fanGeo.dispose(); fanMat.dispose(); lineGeo.dispose(); lineMat.dispose(); }
  };
}

/* ---------- direction B: the watershed ---------- */

function watershedScene(field, quality) {
  const scene = new THREE.Scene();
  const geo = terrainGeometry(field, quality > 1 ? 300 : 180);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: new THREE.Vector3(-0.5, 0.75, -0.42).normalize() } },
    vertexShader: `varying vec3 vN; varying float vH; void main(){ vN=normal; vH=position.y/${VS.toFixed(3)}; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLight; varying vec3 vN; varying float vH;
      void main(){
        float dif = max(dot(normalize(vN), uLight), 0.);
        vec3 base = mix(vec3(.05,.17,.30), vec3(.018,.03,.10), smoothstep(.0,.55,vH));
        vec3 c = base * (.28 + 1.05*dif);
        float f = fract(vH*26.); float line = smoothstep(.0,.05,f)*smoothstep(.12,.05,f);   // 26 contour intervals
        c += vec3(.10,.34,.38) * line * .22;
        gl_FragColor = vec4(c,1.);
      }`
  });
  scene.add(new THREE.Mesh(geo, mat));

  // Trace water downhill from scattered starts.
  const rng = mulberry(21);
  const P = quality > 1 ? 3400 : 1800, STEP = 0.0065;
  const pos = [], arc = [], delay = [];
  let drops = 0;
  for (let k = 0; k < P; k++) {
    let x = -0.98 + 1.96 * rng(), z = -0.98 + 1.96 * rng();
    if (field.sample(x, z) < 0.12 && rng() < 0.8) continue;      // start mostly on the uplands
    let vx = 0, vz = 0, s = 0, prev = [x, field.sample(x, z) * VS + 0.004, z], stuck = 0, hPrev = field.sample(x, z);
    const d0 = rng() * 7;
    for (let i = 0; i < 300; i++) {
      const [gx, gz] = field.grad(x, z), gl = Math.hypot(gx, gz) + 1e-6;
      vx = vx * 0.62 - gx / gl * 0.38; vz = vz * 0.62 - gz / gl * 0.38;
      const vl = Math.hypot(vx, vz) + 1e-6;
      x += vx / vl * STEP; z += vz / vl * STEP;
      if (Math.abs(x) > 0.995 || Math.abs(z) > 0.995) break;
      const h = field.sample(x, z);
      stuck = h > hPrev + 1e-4 ? stuck + 1 : 0;
      if (stuck > 5) break;
      hPrev = h;
      const cur = [x, h * VS + 0.004, z];
      pos.push(...prev, ...cur); arc.push(s, s + STEP); delay.push(d0, d0);
      s += STEP; prev = cur;
    }
    drops++;
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  fgeo.setAttribute("aS", new THREE.Float32BufferAttribute(arc, 1));
  fgeo.setAttribute("aDelay", new THREE.Float32BufferAttribute(delay, 1));
  const uniforms = { uTime: { value: 0 } };
  const fmat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aS; attribute float aDelay; uniform float uTime; varying float vAge;
      void main(){
        float head = mod(uTime*.3 + aDelay, 7.) - .4;
        vAge = head - aS;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
    fragmentShader: /* glsl */`
      varying float vAge;
      void main(){
        if (vAge < 0.) discard;
        float trail = exp(-vAge*.9);
        vec3 c = mix(vec3(.18,.62,.62), vec3(.86,1.,.78), exp(-vAge*10.));
        gl_FragColor = vec4(c, min(1., trail*.28));
      }`
  });
  scene.add(new THREE.LineSegments(fgeo, fmat));
  return {
    scene, camera: { radius: 2.3, polar: 0.9, height: 0.04 },
    init(ctx) { ctx.setStatus("Flow accumulation", `${drops.toLocaleString()} raindrops traced downhill · 26 contour intervals`); },
    update(t) { uniforms.uTime.value = t + 4; },
    dispose() { geo.dispose(); mat.dispose(); fgeo.dispose(); fmat.dispose(); }
  };
}

/* ---------- direction C: relight ---------- */

function relightScene(field, quality) {
  const scene = new THREE.Scene();
  const geo = terrainGeometry(field, quality > 1 ? 360 : 200);
  const uniforms = { uSun: { value: new THREE.Vector3() }, uAmb: { value: 0.16 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vN; varying float vH; void main(){ vN=normal; vH=position.y/${VS.toFixed(3)}; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uAmb; varying vec3 vN; varying float vH;
      vec3 ramp(float t){                 // canyon floor cream → ember → oxblood uplands
        vec3 a=vec3(.97,.88,.76), b=vec3(.95,.55,.27), c=vec3(.76,.26,.11), d=vec3(.33,.07,.07), e=vec3(.15,.025,.04);
        t=clamp(t,0.,1.);
        return t<.07?mix(a,b,t/.07):t<.22?mix(b,c,(t-.07)/.15):t<.5?mix(c,d,(t-.22)/.28):mix(d,e,(t-.5)/.5);
      }
      void main(){
        vec3 n = normalize(vN);
        float dif = max(dot(n, uSun), 0.);
        float shade = uAmb + (1.-uAmb)*pow(dif, 1.25);
        vec3 col = ramp(vH) * shade * 1.18;
        col += vec3(1.,.62,.36) * pow(dif, 14.) * .10;          // grazing glint on lit faces
        gl_FragColor = vec4(col, 1.);
      }`
  });
  scene.add(new THREE.Mesh(geo, mat));
  let az = 300, alt = 28, lastMove = -10;
  return {
    scene, camera: { radius: 2.15, polar: 0.72, height: 0.02, still: true },
    usesPointerForSun: true,
    init(ctx) { ctx.showSun(true); ctx.setStatus("Terrain lighting", "Multidirectional hillshade off · ambient 16% · relief 1.0×"); },
    update(t, ctx) {
      if (ctx.pointerMoved) lastMove = t;
      let tAz, tAlt;
      if (t - lastMove < 3.5) { tAz = (ctx.pointer.x * 0.5 + 0.5) * 360; tAlt = 6 + (ctx.pointer.y * -0.5 + 0.5) * 62; }
      else { tAz = (az + 0.02 * 60 * ctx.dt * 6) % 360; tAlt = 18 + 12 * Math.sin(t * 0.25); }
      let dA = ((tAz - az + 540) % 360) - 180;
      az = (az + dA * Math.min(1, ctx.dt * 4) + 360) % 360; alt += (tAlt - alt) * Math.min(1, ctx.dt * 4);
      const ar = THREE.MathUtils.degToRad(az), lr = THREE.MathUtils.degToRad(alt);
      // azimuth clockwise from north (-z)
      uniforms.uSun.value.set(Math.sin(ar) * Math.cos(lr), Math.sin(lr), -Math.cos(ar) * Math.cos(lr));
      ctx.setSun(az, alt);
    },
    dispose() { geo.dispose(); mat.dispose(); }
  };
}

/* ---------- download page: an ambient point cloud ---------- */

function ambientScene(field, quality, palette) {
  const scene = new THREE.Scene();
  const G = quality > 1 ? 240 : 160, pos = [], col = [];
  const rng = mulberry(3);
  const P = palette === "relight"
    ? [[.15, .025, .04], [.55, .14, .08], [.95, .55, .27], [.97, .88, .76]]
    : [[.035, .06, .19], [.05, .33, .50], [.36, .86, .73], [.93, .99, .84]];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -1 + 2 * (i + rng()) / G, z = -1 + 2 * (j + rng()) / G, h = field.sample(x, z);
    pos.push(x, h * VS, z);
    const t = Math.min(1, Math.max(0, 1 - h * 1.15)) * 3, k = Math.min(2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) col.push(P[k][c] + (P[k + 1][c] - P[k][c]) * f);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: quality > 1 ? 0.0085 : 0.011, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  scene.add(new THREE.Points(geo, mat));
  return {
    scene, camera: { radius: 2.5, polar: 1.0, height: 0.0, spin: 0.035 },
    update() {}, dispose() { geo.dispose(); mat.dispose(); }
  };
}

/* ---------- the stage: renderer, camera rig, pointer, HUD hooks ---------- */

const BUILDERS = { sweep: sweepScene, watershed: watershedScene, relight: relightScene };

export function createStage(canvas, hud = {}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" }); }
  catch (e) { hud.onNoWebGL && hud.onNoWebGL(); return null; }
  const quality = (Math.min(innerWidth, innerHeight) > 700 && (navigator.hardwareConcurrency || 4) >= 4) ? 2 : 1;
  const field = makeField(quality > 1 ? 257 : 193);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
  const ray = new THREE.Raycaster();
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, moved: false, inside: false };
  let current = null, name = null, t0 = performance.now(), last = t0, shift = 0, raf = 0, visible = true;

  const ctx = {
    px: 1, pointer, dt: 0, pointerMoved: false,
    setStatus: (a, b) => hud.status && hud.status(a, b),
    setSun: (az, alt) => hud.sun && hud.sun(az, alt),
    showSun: on => hud.showSun && hud.showSun(on)
  };

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.px = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ctx.px);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    shift = w > 900 ? (hud.shift ?? 0.32) : 0;   // push the terrain right of the copy on wide screens
  }

  function set(next, opts = {}) {
    if (current) { current.scene.traverse(o => o.geometry && o.geometry.dispose()); current.dispose(); }
    hud.showSun && hud.showSun(false);
    name = next;
    const build = next === "ambient" ? (f, q) => ambientScene(f, q, opts.palette) : BUILDERS[next];
    current = build(field, quality);
    current.scene.background = new THREE.Color(opts.background ?? (next === "relight" ? 0x0d0306 : 0x02050d));
    t0 = performance.now();
    current.init && current.init(ctx);
    if (reduced) render(next === "sweep" ? 8.5 : 30);
  }

  function render(t) {
    const c = current.camera;
    const spin = c.spin ?? 0.012;
    const az = 0.62 + (reduced ? 0 : t * spin) + (c.still ? 0 : pointer.sx * 0.18);
    const polar = c.polar + (c.still ? 0 : pointer.sy * 0.06);
    camera.position.set(Math.sin(az) * Math.sin(polar) * c.radius, Math.cos(polar) * c.radius + c.height, Math.cos(az) * Math.sin(polar) * c.radius);
    camera.lookAt(0, c.height + 0.08, 0);
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = -shift;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    ctx.dt = Math.min(0.05, ctx.dt);
    current.update(t, ctx);
    renderer.render(current.scene, camera);
    readout();
  }

  // March the pointer ray across the height field for the coordinate readout.
  function readout() {
    if (!hud.readout) return;
    if (!pointer.inside) { hud.readout(null); return; }
    ray.setFromCamera({ x: pointer.x, y: pointer.y }, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let prevAbove = true;
    for (let s = 0.6; s < 6; s += 0.01) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (Math.abs(x) > 1 || Math.abs(z) > 1) { if (s > 4) break; continue; }
      const h = field.sample(x, z);
      if (y <= h * VS && prevAbove) {
        hud.readout({ e: (x + 1) * KM_PER_UNIT, n: (1 - z) * KM_PER_UNIT, ft: ftAt(h) });
        return;
      }
    }
    hud.readout(null);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    ctx.dt = (now - last) / 1000; last = now;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, ctx.dt * 2.5);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, ctx.dt * 2.5);
    render((now - t0) / 1000);
    ctx.pointerMoved = false;
  }

  addEventListener("pointermove", e => {
    pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = -(e.clientY / innerHeight * 2 - 1);
    pointer.moved = ctx.pointerMoved = true; pointer.inside = e.pointerType === "mouse";
    if (reduced && current) render(30);
  }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer.inside = false; });
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; last = performance.now(); });
  addEventListener("resize", () => { resize(); if (reduced && current) render(30); });
  resize();
  if (!reduced) raf = requestAnimationFrame(loop);
  return { set, get name() { return name; }, reduced };
}

/* ---------- helpers ---------- */
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
function easeInOut(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
