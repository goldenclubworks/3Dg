import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { galvanizedTextures, flutedSheetTextures, grassTextures, soilTextures, noiseNormal } from './textures.js';
import { buildGreenhouse, createMaterials } from './greenhouse.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const params = new URLSearchParams(location.search);
const isMobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const quality = params.get('q') || (isMobile ? 'mobile' : 'high');
const lockQuality = params.has('fixed');

/* ---------- Renderer / Szene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = Math.min(devicePixelRatio, 2);
const dprMax = dpr;
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;             // Schatten nur neu berechnen, wenn sich die Szene ändert

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2500);
camera.position.set(6.8, 3.0, 7.8);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.4; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI / 2 - 0.015;
controls.rotateSpeed = isMobile ? 0.7 : 1;

/* ---------- Render-on-demand ---------- */
let dirty = 3, shadowDirty = true;
const invalidate = (scene_ = false) => { dirty = Math.max(dirty, 3); if (scene_) shadowDirty = true; };
controls.addEventListener('change', () => invalidate());

/* ---------- HDR-Himmel (Float-Umgebung), Sonne ---------- */
const pmrem = new THREE.PMREMGenerator(renderer);
const mkSky = (scale) => {
  const s = new Sky(); s.scale.setScalar(scale);
  const u = s.material.uniforms;
  u.turbidity.value = 2.4; u.rayleigh.value = 1.15; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  u.cloudCoverage.value = 0.42; u.cloudDensity.value = 0.45;
  return s;
};
const sky = mkSky(1200); scene.add(sky);
const envSky = mkSky(50); const envScene = new THREE.Scene(); envScene.add(envSky);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
sun.castShadow = true; scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x5b6a4a, 0.12));
scene.environmentIntensity = 0.6;
let envRT = null;
function setSun(elevDeg, azDeg = 135) {
  const phi = THREE.MathUtils.degToRad(90 - elevDeg), theta = THREE.MathUtils.degToRad(azDeg);
  const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms.sunPosition.value.copy(dir);
  envSky.material.uniforms.sunPosition.value.copy(dir);
  const e = Math.sin(THREE.MathUtils.degToRad(elevDeg));
  sun.position.copy(dir).multiplyScalar(60);
  sun.intensity = 1.5 + 4.2 * e;
  sun.color.setHSL(0.09, 0.9, 0.62 + 0.3 * e);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 100, { size: isMobile ? 256 : 512 });
  scene.environment = envRT.texture;
  invalidate(true);
}

/* ---------- Texturen & Material ---------- */
const aniso = Math.min(isMobile ? 4 : 16, renderer.capabilities.getMaxAnisotropy());
const tex = {
  galv: galvanizedTextures(isMobile ? 512 : 1024),
  sheet: flutedSheetTextures(),
  soil: soilTextures(isMobile ? 512 : 1024),
  noise: noiseNormal(),
};
for (const t of [tex.galv, tex.sheet.map, tex.sheet.normalMap, tex.soil.map, tex.soil.bump]) t.anisotropy = aniso;
const mats = createMaterials(tex);

/* ---------- Boden ---------- */
const grass = grassTextures(isMobile ? 1024 : 2048);
grass.anisotropy = aniso;
const gGeo = new THREE.PlaneGeometry(1800, 1800, 1, 1).rotateX(-Math.PI / 2);
{ const uv = gGeo.attributes.uv, p = gGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 5, -p.getZ(i) / 5); }
grass.repeat.set(1, 1);
const groundMat = new THREE.MeshStandardMaterial({ map: grass, bumpMap: grass, bumpScale: 1.2, roughness: 0.95, metalness: 0 });
groundMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 vWPos;
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
    float mn = 0.5*vn(vWPos.xz/41.0) + 0.3*vn(vWPos.xz/11.0) + 0.2*vn(vWPos.xz/2.7);
    diffuseColor.rgb *= mix(vec3(0.62, 0.7, 0.55), vec3(1.15, 1.12, 0.95), mn);`);
};
const ground = new THREE.Mesh(gGeo, groundMat);
ground.receiveShadow = true; ground.name = 'boden';
scene.add(ground);
scene.fog = new THREE.Fog(0xc4d4e0, 90, 700);

/* ---------- Gewächshaus ---------- */
let gh = null;
const state = { length: 4, spacing: 'dense' };
function rebuild() {
  const open = gh ? { door: gh.isOpen('door'), window: gh.isOpen('window') } : { door: false, window: false };
  if (gh) { scene.remove(gh.group); gh.dispose(); }
  gh = buildGreenhouse({ length: state.length, spacing: state.spacing, mats, quality });
  scene.add(gh.group);
  gh.setLeaf('door', open.door, true); gh.setLeaf('window', open.window, true);
  const ext = Math.max(state.length / 2, 3) + 3;
  const sc = sun.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 140;
  sc.updateProjectionMatrix();
  const ms = isMobile ? 2048 : 4096;
  sun.shadow.mapSize.set(ms, ms);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01; sun.shadow.radius = 2.5;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  $('#i-len').textContent = state.length;
  $('#d-len').textContent = state.length.toFixed(2).replace('.', ',') + ' m';
  $('#d-area').textContent = (3 * state.length) + ' m²';
  $('#d-arch').textContent = gh.dims.arches + ' Stück';
  invalidate(true);
}

/* ---------- Nachbearbeitung: Umgebungsverdunklung (nur Desktop) ---------- */
let composer = null, ao = null;
function setupComposer() {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  ao.blendIntensity = 0.85;
  // transparente Platten und Himmel dürfen nicht in die AO-Tiefe/Normalen-Pässe
  const baseRender = ao.render.bind(ao);
  ao.render = (...a) => {
    const hidden = [sky, ...gh.sheetMeshes].filter((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    try { baseRender(...a); } finally { hidden.forEach((o) => { o.visible = true; }); }
  };
  composer.addPass(ao);
  composer.addPass(new OutputPass());
}
let useAO = quality === 'high' && !params.has('noao');
if (useAO) { try { setupComposer(); } catch (e) { console.warn('AO nicht verfügbar', e); useAO = false; composer = null; } }

/* ---------- Kamera-Ansichten ---------- */
let tween = null;
function goTo(pos, target, ms = 900) {
  ms = Math.max(1, ms ?? 900);
  tween = { t: 0, ms, p0: camera.position.clone(), p1: new THREE.Vector3(...pos), t0: controls.target.clone(), t1: new THREE.Vector3(...target) };
  invalidate();
}
// Hochformat (Handy): weiter weg, damit das ganze Haus ins Bild passt
const fit = () => Math.min(2.1, Math.max(1, 0.95 / camera.aspect));
const views = {
  orbit: (ms) => { const f = fit(); goTo([(6.8 + state.length * 0.25) * f, 3.0 + (f - 1) * 1.3, (7.8 + state.length * 0.35) * f], [0, 0.9, 0], ms); },
  front: (ms) => { const f = fit(); goTo([0, 1.3 + (f - 1) * 0.8, state.length / 2 + 6.5 * f], [0, 1.0, 0], ms); },
  inside: (ms) => goTo([0.4, 1.25, state.length / 2 - 1.2], [0, 1.1, -state.length / 2], ms),
  top: (ms) => { const f = fit(); goTo([0.01, (9 + state.length * 0.9) * f, 3.0], [0, 0, 0], ms); },
};

/* ---------- UI ---------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3800);
}
const segPress = (root, v) => root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
$('#len').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.length = +b.dataset.v; segPress($('#len'), state.length); rebuild(); views.orbit(); });
$('#spc').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.spacing = b.dataset.v; segPress($('#spc'), state.spacing); rebuild(); });
$('#views').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) views[b.dataset.v](); });
const toggle = (kind, btn) => { gh.setLeaf(kind, !gh.isOpen(kind)); btn.setAttribute('aria-pressed', String(gh.isOpen(kind))); invalidate(true); };
$('#b-door').addEventListener('click', (e) => toggle('door', e.currentTarget));
$('#b-win').addEventListener('click', (e) => toggle('window', e.currentTarget));
$('#sun').addEventListener('change', (e) => setSun(+e.target.value));
$('#b-more').addEventListener('click', (e) => { const o = $('#bar').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); });

// Tür/Fenster per Tippen/Klick
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(gh.leaves, true);
  if (!hits.length) return;
  let o = hits[0].object; while (o && !o.userData.kind) o = o.parent;
  if (o) toggle(o.userData.kind, $(o.userData.kind === 'door' ? '#b-door' : '#b-win'));
});

/* ---------- Export / AR (eigene, schlankere Geometrie, geschlossene Tür) ---------- */
async function exportGLB() {
  const arGh = buildGreenhouse({ length: state.length, spacing: state.spacing, mats, quality: 'ar' });
  try {
    return await new GLTFExporter().parseAsync(arGh.group, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
  } finally { arGh.dispose(); }
}
$('#b-glb').addEventListener('click', async () => {
  const b = new Blob([await exportGLB()], { type: 'model/gltf-binary' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `gewaechshaus-3x${state.length}m.glb`; a.click();
  toast(`GLB exportiert (${(b.size / 1048576).toFixed(1)} MB)`);
});
$('#b-ar').addEventListener('click', async () => {
  toast('AR-Modell wird vorbereitet …');
  const url = URL.createObjectURL(new Blob([await exportGLB()], { type: 'model/gltf-binary' }));
  await import('@google/model-viewer');
  document.querySelectorAll('model-viewer').forEach((m) => m.remove());
  const mv = document.createElement('model-viewer');
  mv.setAttribute('src', url); mv.setAttribute('ar', ''); mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  mv.setAttribute('ar-scale', 'fixed'); mv.setAttribute('ar-placement', 'floor');
  mv.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
  document.body.append(mv);
  await mv.updateComplete;
  await new Promise((r) => mv.addEventListener('load', r, { once: true }));
  if (mv.canActivateAR) mv.activateAR();
  else toast('AR geht nur auf Smartphone/Tablet (iOS Safari, Android Chrome) über https.');
});

/* ---------- Größe, Schleife, adaptive Qualität ---------- */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(dpr); composer.setSize(w, h); }
  invalidate();
}
addEventListener('resize', resize); resize();

const timer = new THREE.Timer();
let acc = 0, nFrames = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  let moving = false;
  if (tween) {
    moving = true;
    tween.t += dt * 1000;
    const k = Math.min(1, tween.t / tween.ms), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (k >= 1) tween = null;
  }
  if (controls.update()) invalidate();
  if (gh.update(dt)) { moving = true; shadowDirty = true; }
  if (moving) invalidate();
  if (dirty <= 0) { acc = 0; nFrames = 0; return; }
  dirty--;
  if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
  if (useAO && composer) composer.render(); else renderer.render(scene, camera);

  // adaptive Qualität: bei dauerhaft niedriger Framerate erst AO aus, dann Auflösung senken
  if (!lockQuality && dt > 0) {
    acc += dt; nFrames++;
    if (nFrames >= 45) {
      const avg = acc / nFrames; acc = 0; nFrames = 0;
      if (avg > 0.03) {
        if (useAO) { useAO = false; }
        else if (dpr > (isMobile ? 1 : 1.25)) { dpr = Math.max(1, dpr - 0.25); resize(); }
      } else if (avg < 0.014 && dpr < dprMax && !useAO) { dpr = Math.min(dprMax, dpr + 0.25); resize(); }
    }
  }
});

setSun(38);
rebuild();
views.orbit(1);
$('#loading').classList.add('done');
window.__app = { exportGLB, THREE, scene, camera, controls, renderer, state, rebuild, gh: () => gh, views, setSun, invalidate, info: () => ({ quality, useAO, dpr }) };
