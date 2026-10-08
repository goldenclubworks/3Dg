import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { galvanizedTextures, flutedSheetTextures, grassTextures, soilTextures, noiseNormal } from './textures.js';
import { buildGreenhouse, createMaterials } from './greenhouse.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
const quality = isMobile ? 'mobile' : 'high';

/* ---------- Renderer / Szene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 2 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2500);
camera.position.set(6.8, 3.0, 7.8);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.minDistance = 0.4; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI / 2 - 0.015;

/* ---------- Himmel, Sonne, Umgebungslicht ---------- */
const pmrem = new THREE.PMREMGenerator(renderer);
const mkSky = (scale) => {
  const s = new Sky(); s.scale.setScalar(scale);
  const u = s.material.uniforms;
  u.turbidity.value = 2.6; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  return s;
};
const sky = mkSky(1200); scene.add(sky);
const envSky = mkSky(50); const envScene = new THREE.Scene(); envScene.add(envSky);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
sun.castShadow = true; scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x5b6a4a, 0.15));
scene.environmentIntensity = 0.55;
let envRT = null;
function setSun(elevDeg, azDeg = 135) {
  const phi = THREE.MathUtils.degToRad(90 - elevDeg), theta = THREE.MathUtils.degToRad(azDeg);
  const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms.sunPosition.value.copy(dir);
  envSky.material.uniforms.sunPosition.value.copy(dir);
  sun.position.copy(dir).multiplyScalar(60);
  sun.intensity = 1.5 + 4.2 * Math.sin(THREE.MathUtils.degToRad(elevDeg));
  sun.color.setHSL(0.09, 0.9, 0.62 + 0.3 * Math.sin(THREE.MathUtils.degToRad(elevDeg)));
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
  scene.environment = envRT.texture;
}

/* ---------- Texturen & Material ---------- */
const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
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
grass.repeat.set(220, 220); grass.anisotropy = aniso;
const gGeo = new THREE.PlaneGeometry(1800, 1800, 1, 1).rotateX(-Math.PI / 2);
{ const uv = gGeo.attributes.uv, p = gGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 5, -p.getZ(i) / 5); }
grass.repeat.set(1, 1);
const groundMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, metalness: 0 });
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
  gh.group.traverse((o) => { if (o.isMesh && o.name === 'erde') o.receiveShadow = true; });
  scene.add(gh.group);
  gh.setLeaf('door', open.door); gh.setLeaf('window', open.window);
  // Schattenkamera
  const ext = Math.max(state.length / 2, 3) + 3;
  const sc = sun.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 140;
  sc.updateProjectionMatrix();
  sun.shadow.mapSize.set(isMobile ? 2048 : 4096, isMobile ? 2048 : 4096);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01; sun.shadow.radius = 2.5;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  // UI
  $('#i-len').textContent = state.length;
  $('#d-len').textContent = state.length.toFixed(2).replace('.', ',') + ' m';
  $('#d-area').textContent = (3 * state.length).toFixed(0) + ' m²';
  $('#d-arch').textContent = gh.dims.arches + ' Stück';
}

/* ---------- Kamera-Ansichten ---------- */
let tween = null;
function goTo(pos, target, ms = 900) {
  tween = { t: 0, ms, p0: camera.position.clone(), p1: new THREE.Vector3(...pos), t0: controls.target.clone(), t1: new THREE.Vector3(...target) };
}
const views = {
  orbit: () => goTo([6.8 + state.length * 0.25, 3.0, 7.8 + state.length * 0.35], [0, 0.9, 0]),
  front: () => goTo([0, 1.3, state.length / 2 + 6.5], [0, 1.0, 0]),
  inside: () => goTo([0.4, 1.25, state.length / 2 - 1.2], [0, 1.1, -state.length / 2]),
  top: () => goTo([0.01, 9 + state.length * 0.9, 3.0], [0, 0, 0]),
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
const toggle = (kind, btn) => { gh.setLeaf(kind, !gh.isOpen(kind)); btn.setAttribute('aria-pressed', String(gh.isOpen(kind))); };
$('#b-door').addEventListener('click', (e) => toggle('door', e.currentTarget));
$('#b-win').addEventListener('click', (e) => toggle('window', e.currentTarget));
$('#sun').addEventListener('change', (e) => setSun(+e.target.value));

// Klick auf Tür/Fenster
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(gh.leaves, true);
  if (!hits.length) return;
  let o = hits[0].object; while (o && !o.userData.kind) o = o.parent;
  if (o) toggle(o.userData.kind, $(o.userData.kind === 'door' ? '#b-door' : '#b-win'));
});

/* ---------- Export / AR ---------- */
async function exportGLB() {
  const saved = gh.leaves.map((l) => [l, l.userData.open, l.rotation.x, l.rotation.y]);
  gh.leaves.forEach((l) => { l.rotation.set(0, 0, 0); });
  const buf = await new GLTFExporter().parseAsync(gh.group, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
  saved.forEach(([l, , rx, ry]) => { l.rotation.x = rx; l.rotation.y = ry; });
  return buf;
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

/* ---------- Loop ---------- */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (tween) {
    tween.t += dt * 1000;
    const k = Math.min(1, tween.t / tween.ms), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (k >= 1) tween = null;
  }
  controls.update(); gh.update(dt);
  renderer.render(scene, camera);
});

setSun(38);
rebuild();
$('#loading').classList.add('done');
window.__app = { exportGLB, THREE, scene, camera, controls, renderer, state, rebuild, gh: () => gh, views, setSun };
