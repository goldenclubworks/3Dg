import * as THREE from 'three';
import qrcode from 'qrcode-generator';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { galvanizedTextures, flutedSheetTextures, grassTextures, soilTextures, noiseNormal } from './textures.js';
import { buildGreenhouse, createMaterials, D, DOOR } from './greenhouse.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const params = new URLSearchParams(location.search);
const ua = navigator.userAgent;
const isTouchPhone = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = params.has('mobile') || matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const quality = params.get('q') || (isMobile ? 'mobile' : 'high');
const lockQuality = params.has('fixed');

/* ---------- Stimmung (ruhig, nicht grell) ---------- */
const LOOK = { exposure: 0.62, sunElev: 30, sunAz: 140, envIntensity: 0.36, sunBase: 1.0, sunGain: 2.8 };

/* ---------- Renderer / Szene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
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
// Der Himmel (Shader mit Wolken-fBm) ist pro Pixel teuer. Er wird deshalb nur bei Sonnenänderung
// in eine HDR-Cube-Map gebacken; pro Frame kostet der Hintergrund dann nur noch einen Texturzugriff.
const envSky = mkSky(50); const envScene = new THREE.Scene(); envScene.add(envSky);
const cubeRT = new THREE.WebGLCubeRenderTarget(isMobile ? 768 : 1024, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
const sun = new THREE.DirectionalLight(0xffeedd, 3);
sun.castShadow = true; scene.add(sun, sun.target);
sun.shadow.intensity = 0.45;                       // weiche, helle Schatten statt harter Konturen
scene.add(new THREE.HemisphereLight(0xd3e2f2, 0x4f5a42, 0.2));
scene.environmentIntensity = LOOK.envIntensity;
const skyMat = new THREE.ShaderMaterial({
  uniforms: { tCube: { value: null } }, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform samplerCube tCube; varying vec3 vDir; void main(){ gl_FragColor = vec4(textureCube(tCube, normalize(vDir)).rgb, 1.0); }',
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), skyMat);
skyDome.frustumCulled = false; skyDome.renderOrder = 1; skyDome.name = 'himmel';
scene.add(skyDome);
let envRT = null;
function setSun(elevDeg, azDeg = LOOK.sunAz) {
  const phi = THREE.MathUtils.degToRad(90 - elevDeg), theta = THREE.MathUtils.degToRad(azDeg);
  const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  envSky.material.uniforms.sunPosition.value.copy(dir);
  const e = Math.sin(THREE.MathUtils.degToRad(elevDeg));
  sun.position.copy(dir).multiplyScalar(60);
  sun.intensity = LOOK.sunBase + LOOK.sunGain * e;
  sun.color.setHSL(0.085, 0.75, 0.66 + 0.2 * e);
  cubeCam.update(renderer, envScene);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = envRT.texture;
  skyMat.uniforms.tCube.value = cubeRT.texture;
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
const mats = createMaterials(tex, { lite: isMobile });

/* ---------- Boden ---------- */
const grass = grassTextures(isMobile ? 1024 : 2048);
grass.anisotropy = aniso;
const gGeo = new THREE.PlaneGeometry(1800, 1800, 1, 1).rotateX(-Math.PI / 2);
{ const uv = gGeo.attributes.uv, p = gGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 5, -p.getZ(i) / 5); }
grass.repeat.set(1, 1);
const groundMat = new THREE.MeshLambertMaterial({ map: grass });
groundMat.onBeforeCompile = (sh) => {
  sh.uniforms.uNoise = { value: tex.noise };
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 vWPos; uniform sampler2D uNoise;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
    mat2 R1 = mat2(0.866, -0.5, 0.5, 0.866), R2 = mat2(0.5, 0.866, -0.866, 0.5);
    float n1 = texture2D(uNoise, R1 * vWPos.xz / 53.0).r, n2 = texture2D(uNoise, R2 * vWPos.xz / 13.0 + 0.37).r, n3 = texture2D(uNoise, R1 * vWPos.xz / 4.3 + 0.71).r;
    float mn = clamp((0.55 * n1 + 0.33 * n2 + 0.12 * n3 - 0.5) * 1.5 + 0.5, 0.0, 1.0);
    diffuseColor.rgb *= mix(vec3(0.72, 0.82, 0.6), vec3(1.08, 1.05, 0.9), mn);`);
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

/* ---------- Render-Pipeline ----------
   MSAA am Canvas kostete auf Apple-GPUs ~75 % der Frame-Zeit. Stattdessen:
   HDR-Target ohne MSAA -> OutputPass -> FXAA (GTAO kostete ~11 ms/Frame und ist entfernt; AO ist im Boden gebacken)
   (ein günstiger Vollbild-Pass; MSAA-Targets sind auf Apple-GPUs mehrfach teurer) */
let composer = null, fxaa = null;
{
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa);
}

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

/* ---------- Begehen (Ego-Perspektive, Körpergröße 1,75 m) ---------- */
const BODY_H = 1.75, HEAD_ABOVE_EYE = 0.12;            // Augen ~12 cm unter dem Scheitel
const EYE = BODY_H - HEAD_ABOVE_EYE;                    // 1,63 m
const BODY = 0.24, WALK = 1.4, RUN = 2.8;               // Radius, m/s
const SOIL_Y = 0.035;
const walk = { on: false, yaw: 0, pitch: 0, keys: new Set(), joy: { x: 0, y: 0 }, look: null, saved: null, hintT: 0, eye: EYE, promptT: 0 };
const doorLeaf = (zSign) => gh.leaves.filter((l) => l.userData.kind === 'door')[zSign > 0 ? 0 : 1];
const isInsideXZ = (x, z) => Math.abs(x) < D.R && Math.abs(z) < state.length / 2;
// lichte Höhe an einer Stelle (Bogen innen, unter dem Türkopfriegel niedriger)
function ceilAt(x, z) {
  const hz = state.length / 2, ax = Math.abs(x), az = Math.abs(z);
  if (ax >= D.R || az > hz + 0.12) return 9;
  let c = D.WALL + Math.sqrt(Math.max(0, D.RI * D.RI - Math.min(ax, D.RI) ** 2));
  if (az > hz - 0.3 && ax < 0.47) c = Math.min(c, DOOR.clear);
  return c;
}
function canStand(x, z) {
  const hz = state.length / 2;
  if (Math.hypot(x, z) > 60) return false;
  const inside = Math.abs(x) < D.R - BODY - 0.04 && Math.abs(z) < hz - 0.12;
  const outside = Math.abs(x) > D.R + 0.06 + BODY || Math.abs(z) > hz + 0.08 + BODY;
  if (inside || outside) return true;
  const open = doorLeaf(z > 0 ? 1 : -1).userData.target > 0.5;       // Durchgang nur bei offener Tür
  return open && Math.abs(x) < DOOR.width / 2 - 0.1 && Math.abs(z) > hz - 0.2 - BODY && Math.abs(z) < hz + 0.1 + BODY;
}
function enterWalk() {
  if (walk.on) return;
  walk.saved = { pos: camera.position.clone(), target: controls.target.clone() };
  tween = null; controls.enabled = false; walk.on = true;
  document.body.classList.add('walking');
  camera.fov = innerWidth < innerHeight ? 78 : 66; camera.near = 0.03; camera.updateProjectionMatrix();
  // Start VOR dem Gewächshaus (nicht darin): ca. 3 m vor der Tür, Blick auf die Tür
  const hz = state.length / 2;
  walk.eye = EYE;
  camera.position.set(0.2, EYE, hz + 3.3);
  walk.yaw = 0.05; walk.pitch = -0.04;
  applyLook();
  $('#hint').textContent = isMobile ? 'Ziehen = umsehen · Joystick = gehen · Tür antippen = öffnen' : 'Ziehen = umsehen · W A S D = gehen · Shift = schneller · Tür anklicken oder E = öffnen · Esc = beenden';
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
function nearestDoor(p, maxDist) {
  const hz = state.length / 2; let best = null, bd = maxDist;
  for (const s of [1, -1]) { const d = Math.hypot(p.x, p.z - s * hz); if (d < bd) { bd = d; best = doorLeaf(s); } }
  return best;
}
function toggleDoorLeaf(l) { gh.setLeaf('door', !(l.userData.target > 0.5)); invalidate(true); }
function updateWalk(dt) {
  const p = camera.position, k = walk.keys;
  let mx = walk.joy.x, my = walk.joy.y;                        // my>0 = vorwärts
  if (k.has('w') || k.has('arrowup')) my += 1;
  if (k.has('s') || k.has('arrowdown')) my -= 1;
  if (k.has('d') || k.has('arrowright')) mx += 1;
  if (k.has('a') || k.has('arrowleft')) mx -= 1;
  const len = Math.hypot(mx, my);
  let moved = false;
  fwd.set(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
  rgt.set(Math.cos(walk.yaw), 0, -Math.sin(walk.yaw));
  const hz = state.length / 2;
  if (len > 0.01) {
    if (len > 1) { mx /= len; my /= len; }
    const crouchSlow = walk.eye < 1.4 ? 0.7 : 1;
    const speed = (k.has('shift') ? RUN : WALK) * crouchSlow * dt;
    let dx = (fwd.x * my + rgt.x * mx) * speed, dz = (fwd.z * my + rgt.z * mx) * speed;
    // Türhilfe: vor einer offenen Tür sanft zur Mitte führen (Daumen-Joystick trifft 90 cm sonst schlecht)
    for (const s of [1, -1]) {
      const open = doorLeaf(s).userData.target > 0.5, rz = (p.z - s * hz) * s;
      if (open && rz > -0.5 && rz < 1.4 && Math.abs(p.x) < 0.7) dx += -p.x * Math.min(1, dt * 2.4) * (1 - Math.min(1, Math.abs(rz) / 1.6));
    }
    if (canStand(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; moved = true; }
    else if (canStand(p.x + dx, p.z)) { p.x += dx; moved = true; }
    else if (canStand(p.x, p.z + dz)) { p.z += dz; moved = true; }
    // Hinweis, wenn man vor einer geschlossenen Tür steht
    const near = nearestDoor(p, 1.9);
    if (near && near.userData.target < 0.5 && performance.now() > walk.promptT) { walk.promptT = performance.now() + 6000; toast(isMobile ? 'Tür antippen, um sie zu öffnen' : 'Tür anklicken oder E drücken, um sie zu öffnen'); }
  }
  // Augenhöhe: aufrecht 1,63 m; unter niedrigen Decken (Dachrand, Türkopf) duckt man sich weich
  const ahead = len > 0.01 ? 0.5 : 0;
  const c = Math.min(ceilAt(p.x, p.z), ceilAt(p.x + fwd.x * my * ahead + rgt.x * mx * ahead, p.z + fwd.z * my * ahead + rgt.z * mx * ahead));
  const floor = isInsideXZ(p.x, p.z) ? SOIL_Y : 0;
  const target = THREE.MathUtils.clamp(c - 0.04 - HEAD_ABOVE_EYE, 0.95, EYE + floor);
  const prevEye = walk.eye;
  walk.eye += (target - walk.eye) * (1 - Math.exp(-dt * 8));
  if (Math.abs(walk.eye - prevEye) > 1e-4) moved = true;
  p.y = walk.eye;
  return moved;
}
addEventListener('keydown', (e) => {
  if (!walk.on) return;
  const key = e.key.toLowerCase();
  if (key === 'escape') { exitWalk(); return; }
  if (key === 'e') { const d = nearestDoor(camera.position, 3.2); if (d) toggleDoorLeaf(d); return; }
  if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { walk.keys.add(key); e.preventDefault(); }
});
addEventListener('keyup', (e) => walk.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => walk.keys.clear());
// Umsehen: Ziehen mit Maus oder Finger
canvas.addEventListener('pointerdown', (e) => { if (walk.on && !walk.look) { walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', (e) => {
  const l = walk.look; if (!walk.on || !l || l.id !== e.pointerId) return;
  const dx = e.clientX - l.x, dy = e.clientY - l.y; l.x = e.clientX; l.y = e.clientY;
  const sens = (e.pointerType === 'touch' ? 0.0042 : 0.0032) * (camera.fov / 68);
  walk.yaw -= dx * sens; walk.pitch = THREE.MathUtils.clamp(walk.pitch - dy * sens, -1.3, 1.3);
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
    if (Math.hypot(walk.joy.x, walk.joy.y) < 0.12) { walk.joy.x = walk.joy.y = 0; }      // Totzone
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
$('#len').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.length = +b.dataset.v; segPress($('#len'), state.length); rebuild(); views.orbit(); ar.stale = true; });
$('#spc').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.spacing = b.dataset.v; segPress($('#spc'), state.spacing); rebuild(); ar.stale = true; });
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
// Zweistufig: Tippen 1 bereitet das Modell vor (kein Hintergrund-Ruckeln beim Drehen),
// Tippen 2 („AR starten“) ist eine frische Nutzergeste – nur so lässt iOS Quick Look zu.
const ar = { mv: null, ready: false, building: false, stale: true, urls: [] };
const arBtn = $('#b-ar');
async function ensureMV() {
  if (ar.mv) return ar.mv;
  await import('@google/model-viewer');
  const mv = document.createElement('model-viewer');
  mv.setAttribute('ar', ''); mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  mv.setAttribute('ar-scale', 'fixed'); mv.setAttribute('ar-placement', 'floor');   // nur auf Bodenflächen platzieren
  mv.setAttribute('loading', 'eager'); mv.setAttribute('alt', 'Gewächshaus in AR');
  mv.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(mv);
  ar.mv = mv; return mv;
}
async function buildAR() {
  if (ar.building) return;
  ar.building = true; ar.ready = false;
  try {
    const arMats = { ...mats, sheetDouble: mats.sheetDouble.clone() };      // USDZ kennt keine Doppelseitigkeit
    arMats.sheetDouble.side = THREE.FrontSide;
    const g = buildGreenhouse({ length: state.length, spacing: state.spacing, mats: arMats, quality: 'ar' });
    // Ursprung = Mitte der Türfront: Das Haus entsteht VOR dir und wächst von dir weg – nicht um dich herum
    const root = new THREE.Group(); g.group.position.z = -state.length / 2 - 0.05; root.add(g.group);
    const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize: 512 });
    const usdz = await new USDZExporter().parseAsync(root, { quickLookCompatible: true, maxTextureSize: 512 });
    g.dispose();
    const mv = await ensureMV();
    ar.urls.forEach((u) => URL.revokeObjectURL(u));
    const glbUrl = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const usdzUrl = URL.createObjectURL(new Blob([usdz], { type: 'model/vnd.usdz+zip' }));
    ar.urls = [glbUrl, usdzUrl];
    mv.setAttribute('ios-src', usdzUrl);
    mv.src = glbUrl;
    await new Promise((r) => { if (mv.loaded) r(); else mv.addEventListener('load', r, { once: true }); setTimeout(r, 8000); });
    ar.ready = true; ar.stale = false;
  } catch (e) { console.warn('AR-Vorbereitung fehlgeschlagen', e); }
  finally { ar.building = false; }
}
function showModal(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) $('#modal').hidden = true; });
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}
const nextFrames = (n = 2) => new Promise((r) => { const f = (k) => (k <= 0 ? r() : requestAnimationFrame(() => f(k - 1))); f(n); });
arBtn.addEventListener('click', async () => {
  if (!isTouchPhone) {
    const url = location.origin + location.pathname;
    showModal(`<h2>Auf dem Handy in AR ansehen</h2><div class="qr">${qrSvg(url)}</div><p>QR-Code mit dem Handy scannen, dort „In AR ansehen“ tippen und das Gewächshaus auf dem Boden platzieren. Im Maßstab 1:1 kannst du hineinlaufen und dich umsehen.</p><p class="small">iPhone: Safari oder Brave · Android: Chrome oder Brave</p><button class="solid" data-close>Schließen</button>`);
    return;
  }
  const L = state.length;
  showModal(`<h2>AR vorbereiten</h2><p>Du brauchst eine <b>freie, ebene Bodenfläche von mindestens 3 × ${L} m</b> plus etwa 1 m vor der Tür. Das Gewächshaus erscheint <b>vor dir</b> auf dem Boden und kann per Finger verschoben und gedreht werden.</p><div class="status" id="ar-status"><span class="spin"></span> Modell wird vorbereitet …</div><div class="row"><button class="ghost" data-close>Abbrechen</button><button class="solid" id="ar-go" disabled>AR starten</button></div>`);
  await nextFrames(2);
  if (ar.stale || !ar.ready) await buildAR();
  const st = $('#ar-status'), go = $('#ar-go'); if (!st || !go) return;           // Dialog wurde geschlossen
  if (!ar.ready) { st.textContent = 'Das Modell konnte nicht vorbereitet werden. Bitte Seite neu laden.'; return; }
  st.textContent = 'Bereit. Zum Platzieren den Boden mit der Kamera langsam abscannen.';
  go.disabled = false;
  go.addEventListener('click', () => {
    if (ar.mv && ar.mv.canActivateAR) { $('#modal').hidden = true; ar.mv.activateAR(); }
    else { st.textContent = 'AR wird von diesem Browser/Gerät nicht unterstützt. iPhone: Safari oder Brave · Android: Chrome oder Brave (mit Google-Play-Diensten für AR).'; go.disabled = true; }
  }, { once: true });
});

/* ---------- Größe, Schleife, adaptive Qualität ---------- */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  composer.setPixelRatio(dpr); composer.setSize(w, h);
  if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (w * dpr), 1 / (h * dpr));
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
  composer.render();

  // adaptive Qualität: bei dauerhaft niedriger Framerate erst AO aus, dann Auflösung senken
  if (!lockQuality && dt > 0) {
    acc += dt; nFrames++;
    if (nFrames >= 45) {
      const avg = acc / nFrames; acc = 0; nFrames = 0;
      if (avg > 0.024) {
        if (dpr > (isMobile ? 1.5 : 1.25)) { dpr = Math.max(1, dpr - 0.25); resize(); }
      } else if (avg < 0.014 && dpr < dprMax) { dpr = Math.min(dprMax, dpr + 0.25); resize(); }
    }
  }
});

setSun(LOOK.sunElev);
$('#sun').value = LOOK.sunElev;
rebuild();
views.orbit(1);
$('#loading').classList.add('done'); setTimeout(() => $('#loading').remove(), 800);
if (params.has('debug')) window.__app = { composer, THREE, scene, camera, controls, renderer, state, rebuild, gh: () => gh, views, setSun, invalidate, enterWalk, exitWalk, walk, ar, buildAR, LOOK, info: () => ({ quality, dpr }) };
