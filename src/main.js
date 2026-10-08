import * as THREE from 'three';
import qrcode from 'qrcode-generator';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { galvanizedTextures, flutedSheetTextures, grassTextures, soilTextures, noiseNormal } from './textures.js';
import { buildGreenhouse, createMaterials } from './greenhouse.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const params = new URLSearchParams(location.search);
const ua = navigator.userAgent;
const isTouchPhone = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const quality = params.get('q') || (isMobile ? 'mobile' : 'high');
const lockQuality = params.has('fixed');

/* ---------- Stimmung (ruhig, nicht grell) ---------- */
const LOOK = { exposure: 0.62, sunElev: 30, sunAz: 140, envIntensity: 0.6, sunBase: 1.0, sunGain: 2.8 };

/* ---------- Renderer / Szene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = Math.min(devicePixelRatio, 2);
const dprMax = dpr;
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = LOOK.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;             // Schatten nur neu berechnen, wenn sich die Szene ändert

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2500);
camera.rotation.order = 'YXZ';
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
  u.turbidity.value = 3.2; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = 0.5; u.cloudDensity.value = 0.5;
  return s;
};
const sky = mkSky(1200); scene.add(sky);
const envSky = mkSky(50); const envScene = new THREE.Scene(); envScene.add(envSky);
const sun = new THREE.DirectionalLight(0xffeedd, 3);
sun.castShadow = true; scene.add(sun, sun.target);
sun.shadow.intensity = 0.45;                       // weiche, helle Schatten statt harter Konturen
scene.add(new THREE.HemisphereLight(0xd3e2f2, 0x4f5a42, 0.2));
scene.environmentIntensity = LOOK.envIntensity;
let envRT = null;
function setSun(elevDeg, azDeg = LOOK.sunAz) {
  const phi = THREE.MathUtils.degToRad(90 - elevDeg), theta = THREE.MathUtils.degToRad(azDeg);
  const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms.sunPosition.value.copy(dir);
  envSky.material.uniforms.sunPosition.value.copy(dir);
  const e = Math.sin(THREE.MathUtils.degToRad(elevDeg));
  sun.position.copy(dir).multiplyScalar(60);
  sun.intensity = LOOK.sunBase + LOOK.sunGain * e;
  sun.color.setHSL(0.085, 0.75, 0.66 + 0.2 * e);
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
    diffuseColor.rgb *= mix(vec3(0.62, 0.74, 0.5), vec3(1.1, 1.06, 0.86), mn);`);
};
const ground = new THREE.Mesh(gGeo, groundMat);
ground.receiveShadow = false;                       // kein Gewächshaus-Schatten auf dem Rasen
ground.name = 'boden';
scene.add(ground);
scene.fog = new THREE.Fog(0xb9c7d2, 70, 620);

// weicher Kontaktschatten direkt am Rahmen (ersetzt den harten Sonnenschatten)
const contactTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'); x.filter = 'blur(14px)'; x.fillStyle = '#000';
  x.fillRect(56, 56, 144, 144);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
contact.position.y = 0.004; contact.renderOrder = 1; contact.name = 'kontaktschatten';
scene.add(contact);

/* ---------- Gewächshaus ---------- */
let gh = null;
const state = { length: 4, spacing: 'dense' };
function rebuild() {
  const open = gh ? { door: gh.isOpen('door'), window: gh.isOpen('window') } : { door: false, window: false };
  if (gh) { scene.remove(gh.group); gh.dispose(); }
  gh = buildGreenhouse({ length: state.length, spacing: state.spacing, mats, quality });
  scene.add(gh.group);
  gh.setLeaf('door', open.door, true); gh.setLeaf('window', open.window, true);
  contact.scale.set(3 + 1.9, 1, state.length + 1.9);
  // Schatten nur für das Innere (Bögen auf der Erde): kleine, scharfe Shadow-Map
  const ext = Math.max(state.length / 2, 3) + 1.5;
  const sc = sun.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 140;
  sc.updateProjectionMatrix();
  const ms = isMobile ? 2048 : 4096;
  sun.shadow.mapSize.set(ms, ms);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01; sun.shadow.radius = 3;
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
  ao.blendIntensity = 0.8;
  // transparente Platten, Himmel und Kontaktschatten dürfen nicht in die AO-Tiefe/Normalen-Pässe
  const baseRender = ao.render.bind(ao);
  ao.render = (...a) => {
    const hidden = [sky, contact, ...gh.sheetMeshes].filter((o) => o.visible);
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
const fit = () => Math.min(1.8, Math.max(1, 0.74 / camera.aspect));
const views = {
  orbit: (ms) => { const f = fit(); goTo([(6.8 + state.length * 0.25) * f, 3.0 + (f - 1) * 1.3, (7.8 + state.length * 0.35) * f], [0, 0.9, 0], ms); },
  front: (ms) => { const f = fit(); goTo([0, 1.3 + (f - 1) * 0.8, state.length / 2 + 6.5 * f], [0, 1.0, 0], ms); },
  inside: (ms) => goTo([0.4, 1.25, state.length / 2 - 1.2], [0, 1.1, -state.length / 2], ms),
  top: (ms) => { const f = fit(); goTo([0.01, (9 + state.length * 0.9) * f, 3.0], [0, 0, 0], ms); },
};

/* ---------- Begehen (Ego-Perspektive: rein- und umherlaufen) ---------- */
const EYE = 1.62, BODY = 0.24;
const walk = { on: false, yaw: 0, pitch: 0, keys: new Set(), joy: { x: 0, y: 0 }, look: null, saved: null, hintT: 0 };
const doorLeaf = (zSign) => gh.leaves.filter((l) => l.userData.kind === 'door')[zSign > 0 ? 0 : 1];
function canStand(x, z) {
  const hz = state.length / 2;
  if (Math.hypot(x, z) > 60) return false;
  const inside = Math.abs(x) < 1.5 - BODY - 0.04 && Math.abs(z) < hz - 0.12;
  const outside = Math.abs(x) > 1.5 + 0.06 + BODY || Math.abs(z) > hz + 0.08 + BODY;
  if (inside || outside) return true;
  // Türöffnung (nur wenn die Tür dieser Seite offen ist)
  const sgn = z > 0 ? 1 : -1;
  const open = doorLeaf(sgn).userData.target > 0.5;
  return open && Math.abs(x) < 0.45 - 0.12 && Math.abs(z) > hz - 0.2 - BODY && Math.abs(z) < hz + 0.1 + BODY;
}
function enterWalk() {
  if (walk.on) return;
  walk.saved = { pos: camera.position.clone(), target: controls.target.clone() };
  tween = null; controls.enabled = false; walk.on = true;
  document.body.classList.add('walking');
  camera.fov = 68; camera.near = 0.03; camera.updateProjectionMatrix();
  const hz = state.length / 2;
  camera.position.set(0.25, EYE, hz + 3.2);
  walk.yaw = 0.06; walk.pitch = -0.05;
  applyLook();
  if (isMobile) $('#hint').textContent = 'Ziehen = umsehen · Joystick = gehen · Tür antippen = öffnen';
  $('#hint').classList.add('show'); clearTimeout(walk.hintT); walk.hintT = setTimeout(() => $('#hint').classList.remove('show'), 7000);
  invalidate(true);
}
function exitWalk() {
  if (!walk.on) return;
  walk.on = false; walk.keys.clear(); walk.joy.x = walk.joy.y = 0; walk.look = null;
  document.body.classList.remove('walking');
  camera.fov = 38; camera.near = 0.05; camera.updateProjectionMatrix();
  camera.rotation.set(0, 0, 0);
  controls.enabled = true;
  camera.position.copy(walk.saved.pos); controls.target.copy(walk.saved.target); controls.update();
  views.orbit();
}
function applyLook() { camera.rotation.set(walk.pitch, walk.yaw, 0); }
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3();
function updateWalk(dt) {
  let mx = walk.joy.x, my = walk.joy.y;                        // my>0 = vorwärts
  const k = walk.keys;
  if (k.has('w') || k.has('arrowup')) my += 1;
  if (k.has('s') || k.has('arrowdown')) my -= 1;
  if (k.has('d') || k.has('arrowright')) mx += 1;
  if (k.has('a') || k.has('arrowleft')) mx -= 1;
  const len = Math.hypot(mx, my);
  if (len < 0.01) return false;
  if (len > 1) { mx /= len; my /= len; }
  const speed = (k.has('shift') ? 3.2 : 1.6) * dt;
  fwd.set(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
  rgt.set(Math.cos(walk.yaw), 0, -Math.sin(walk.yaw));
  const dx = (fwd.x * my + rgt.x * mx) * speed, dz = (fwd.z * my + rgt.z * mx) * speed;
  const p = camera.position;
  if (canStand(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; }
  else if (canStand(p.x + dx, p.z)) p.x += dx;
  else if (canStand(p.x, p.z + dz)) p.z += dz;
  // Türen öffnen sich automatisch, wenn man davor oder dahinter steht
  const hz = state.length / 2;
  for (const s of [1, -1]) {
    const l = doorLeaf(s);
    if (l.userData.target < 0.5 && Math.abs(p.x) < 1.1 && Math.abs(p.z - s * hz) < 1.7) { l.userData.target = 1; $('#b-door').setAttribute('aria-pressed', 'true'); shadowDirty = true; }
  }
  return true;
}
addEventListener('keydown', (e) => {
  if (!walk.on) return;
  const key = e.key.toLowerCase();
  if (key === 'escape') { exitWalk(); return; }
  if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { walk.keys.add(key); e.preventDefault(); }
});
addEventListener('keyup', (e) => walk.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => walk.keys.clear());
// Umsehen: Ziehen mit Maus oder Finger
canvas.addEventListener('pointerdown', (e) => { if (walk.on && !walk.look) { walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', (e) => {
  const l = walk.look; if (!walk.on || !l || l.id !== e.pointerId) return;
  const dx = e.clientX - l.x, dy = e.clientY - l.y; l.x = e.clientX; l.y = e.clientY; l.moved += Math.abs(dx) + Math.abs(dy);
  const s = e.pointerType === 'touch' ? 0.0042 : 0.0032;
  walk.yaw -= dx * s; walk.pitch = THREE.MathUtils.clamp(walk.pitch - dy * s, -1.25, 1.25);
  applyLook(); invalidate();
});
const endLook = (e) => { if (walk.look && walk.look.id === e.pointerId) walk.look = null; };
canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
// Joystick (Touch)
{
  const joy = $('#joy'), knob = $('#joy-knob'); let jid = null; const R = 48;
  const set = (e) => {
    const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    walk.joy.x = dx / R; walk.joy.y = -dy / R;
  };
  joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); set(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) set(e); });
  const end = (e) => { if (e.pointerId !== jid) return; jid = null; knob.style.transform = ''; walk.joy.x = walk.joy.y = 0; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
}
$('#b-walk').addEventListener('click', enterWalk);
$('#b-exit').addEventListener('click', exitWalk);

/* ---------- UI ---------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3800);
}
const segPress = (root, v) => root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
$('#len').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.length = +b.dataset.v; segPress($('#len'), state.length); rebuild(); views.orbit(); scheduleAR(); });
$('#spc').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.spacing = b.dataset.v; segPress($('#spc'), state.spacing); rebuild(); scheduleAR(); });
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

/* ---------- AR (iOS Quick Look/USDZ, Android Scene Viewer/WebXR, per model-viewer) ---------- */
const ar = { mv: null, ready: false, building: false, again: false, timer: 0, urls: [] };
const arBtn = $('#b-ar');
const arLabel = () => { arBtn.textContent = ar.ready || !isTouchPhone ? 'In AR ansehen' : 'AR lädt …'; };
function scheduleAR(delay = 1800) {
  if (!isTouchPhone) return;                         // AR-Dateien nur auf Geräten erzeugen, die AR können
  ar.ready = false; arLabel();
  clearTimeout(ar.timer);
  ar.timer = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(buildAR, { timeout: 4000 }) : buildAR()), delay);
}
async function ensureMV() {
  if (ar.mv) return ar.mv;
  await import('@google/model-viewer');
  const mv = document.createElement('model-viewer');
  mv.setAttribute('ar', ''); mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  mv.setAttribute('ar-scale', 'fixed'); mv.setAttribute('ar-placement', 'floor');
  mv.setAttribute('loading', 'eager'); mv.setAttribute('alt', 'Gewächshaus in AR');
  mv.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(mv);
  ar.mv = mv; return mv;
}
async function buildAR() {
  if (ar.building) { ar.again = true; return; }
  ar.building = true;
  try {
    const arMats = { ...mats, sheetDouble: mats.sheetDouble.clone() };      // USDZ kennt keine Doppelseitigkeit
    arMats.sheetDouble.side = THREE.FrontSide;
    const g = buildGreenhouse({ length: state.length, spacing: state.spacing, mats: arMats, quality: 'ar' });
    const glb = await new GLTFExporter().parseAsync(g.group, { binary: true, onlyVisible: true, maxTextureSize: 512 });
    const usdz = await new USDZExporter().parseAsync(g.group, { quickLookCompatible: true, maxTextureSize: 512 });
    g.dispose();
    const mv = await ensureMV();
    ar.urls.forEach((u) => URL.revokeObjectURL(u));
    const glbUrl = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const usdzUrl = URL.createObjectURL(new Blob([usdz], { type: 'model/vnd.usdz+zip' }));
    ar.urls = [glbUrl, usdzUrl];
    mv.setAttribute('ios-src', usdzUrl);
    mv.src = glbUrl;
    await new Promise((r) => { if (mv.loaded) r(); else mv.addEventListener('load', r, { once: true }); setTimeout(r, 6000); });
    ar.ready = true;
  } catch (e) { console.warn('AR-Vorbereitung fehlgeschlagen', e); }
  finally { ar.building = false; arLabel(); if (ar.again) { ar.again = false; scheduleAR(300); } }
}
function showModal(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) $('#modal').hidden = true; });
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}
arBtn.addEventListener('click', () => {
  if (isTouchPhone) {
    if (!ar.ready) { toast('AR-Modell wird vorbereitet … gleich nochmal tippen.'); if (!ar.building) scheduleAR(100); return; }
    if (ar.mv && ar.mv.canActivateAR) { ar.mv.activateAR(); return; }
    showModal(`<h2>AR wird hier nicht unterstützt</h2><p>Öffne diese Seite auf dem iPhone in <b>Safari</b> (oder Chrome/Brave) bzw. auf Android in <b>Chrome</b> oder <b>Brave</b>. Dafür muss Google Play Services für AR installiert sein.</p><button class="solid" data-close>OK</button>`);
    return;
  }
  const url = location.origin + location.pathname;
  showModal(`<h2>Auf dem Handy in AR ansehen</h2><div class="qr">${qrSvg(url)}</div><p>QR-Code mit dem Handy scannen. Dann „In AR ansehen“ tippen und das Gewächshaus im Garten platzieren. Im Maßstab 1:1 kannst du hineinlaufen und dich umsehen.</p><p class="small">iPhone: Safari oder Brave/Chrome · Android: Chrome oder Brave</p><button class="solid" data-close>Schließen</button>`);
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
  if (walk.on) { if (updateWalk(dt)) moving = true; }
  else if (controls.update()) invalidate();
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

setSun(LOOK.sunElev);
$('#sun').value = LOOK.sunElev;
rebuild();
views.orbit(1);
$('#loading').classList.add('done');
if (isTouchPhone) setTimeout(() => scheduleAR(0), 2500);
arLabel();
if (params.has('debug')) window.__app = { THREE, scene, camera, controls, renderer, state, rebuild, gh: () => gh, views, setSun, invalidate, enterWalk, exitWalk, walk, ar, buildAR, LOOK, info: () => ({ quality, useAO, dpr }) };
