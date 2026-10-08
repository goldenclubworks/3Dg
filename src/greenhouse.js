// Parametrisches Foliengewächshaus-Modell: 3 m breit, 2 m hoch, Länge 4/6/8/10 m (Module à 2 m)
// Koordinaten: x = Breite, y = oben, z = Länge. Maße in Metern.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const D = {
  R: 1.5,            // Außenradius inkl. Platte
  SHEET: 0.006,      // Plattendicke (6 mm Hohlkammer)
  WALL: 0.5,         // senkrechtes Stück unter dem Halbkreis  -> 0.5 + 1.5 = 2.0 m Firsthöhe
  ARCH_D: 0.04,      // Bogenprofil: 40 mm entlang der Länge
  ARCH_T: 0.02,      // 20 mm radial
  BASE_H: 0.05,
  FLUTE: 0.04,       // Texturperiode der Hohlkammerplatte (4 Kammern)
};
D.RO = D.R - D.SHEET;      // Außenkante Bogen
D.RI = D.RO - D.ARCH_T;    // Innenkante Bogen

export const SPACINGS = { standard: 'Standard (1 m)', dense: 'Verstärkt (0,67 m)' };

const Y = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();

/* ---------- Materialien ---------- */
export function createMaterials(tex, envIntensity = 1) {
  const galv = new THREE.MeshStandardMaterial({
    name: 'verzinkter_stahl', map: tex.galv, roughnessMap: null, color: 0xdfe5ea,
    metalness: 0.88, roughness: 0.38, envMapIntensity: envIntensity,
  });
  const metal = new THREE.MeshStandardMaterial({
    name: 'schrauben_zink', color: 0xc9cfd4, metalness: 1, roughness: 0.28, envMapIntensity: envIntensity,
  });
  const rubber = new THREE.MeshStandardMaterial({
    name: 'druckscheibe_kunststoff', color: 0x23282c, metalness: 0, roughness: 0.62, bumpMap: tex.noise, bumpScale: 0.4,
  });
  const sheet = new THREE.MeshStandardMaterial({
    name: 'polycarbonat_hohlkammer', map: tex.sheet.map, normalMap: tex.sheet.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9), color: 0xeaf6ff, metalness: 0, roughness: 0.1,
    transparent: true, depthWrite: false, side: THREE.FrontSide, envMapIntensity: 1.4,
  });
  // Fresnel: an streifenden Winkeln wird die Platte opaker (Spiegelung des Himmels sichtbar)
  const fresnel = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
        `float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
         diffuseColor.a = mix(diffuseColor.a, 1.0, fr * 0.7);
         #include <opaque_fragment>`);
    };
  };
  fresnel(sheet);
  const sheetDouble = sheet.clone();
  fresnel(sheetDouble);
  sheetDouble.name = 'polycarbonat_hohlkammer_flach';
  sheetDouble.side = THREE.DoubleSide;
  const soil = new THREE.MeshStandardMaterial({
    name: 'erde', map: tex.soil.map, color: 0x80604a, bumpMap: tex.soil.bump, bumpScale: 2.2, roughness: 0.96, metalness: 0,
  });
  return { galv, metal, rubber, sheet, sheetDouble, soil };
}

/* ---------- Geometrie-Helfer ---------- */
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  // UVs in Metern (2 Kacheln pro Meter), damit die Zinkblumen nicht gestreckt werden
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}

function placed(geo, pos, rotZ = 0, dir = null) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  if (dir) q.setFromUnitVectors(Y, dir);
  else q.setFromEuler(new THREE.Euler(0, 0, rotZ));
  m.compose(pos, q, new THREE.Vector3(1, 1, 1));
  return geo.clone().applyMatrix4(m);
}

function flatten(g) {
  let n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

function mergedMesh(geos, mat, name) {
  if (!geos.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(geos.map(flatten)), mat);
  mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/* ---------- Bogenprofil (Rechteckrohr 40x20) ---------- */
function archRingGeo() {
  const { RO, RI, WALL, ARCH_D } = D;
  const s = new THREE.Shape();
  s.moveTo(-RO, 0); s.lineTo(-RO, WALL);
  s.absarc(0, WALL, RO, Math.PI, 0, true);
  s.lineTo(RO, 0); s.lineTo(RI, 0); s.lineTo(RI, WALL);
  s.absarc(0, WALL, RI, 0, Math.PI, false);
  s.lineTo(-RI, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: ARCH_D, bevelEnabled: false, curveSegments: 120 });
  g.translate(0, 0, -ARCH_D / 2);
  return toCreasedNormals(g, 0.45);
}

/* ---------- Plattenstreifen entlang des Bogenprofils ---------- */
function stations(Na) {
  const st = [{ w: -1, y: 0 }, { w: -1, y: D.WALL }];
  for (let j = 1; j < Na; j++) st.push({ th: Math.PI - (Math.PI * j) / Na });
  st.push({ w: 1, y: D.WALL }, { w: 1, y: 0 });
  return st;
}
function stationAt(s, r) {
  if (s.th === undefined) return { x: s.w * r, y: s.y, nx: s.w, ny: 0 };
  return { x: r * Math.cos(s.th), y: D.WALL + r * Math.sin(s.th), nx: Math.cos(s.th), ny: Math.sin(s.th) };
}
function stationArc(s) {
  if (s.th !== undefined) return D.WALL + D.R * (Math.PI - s.th);
  return s.w < 0 ? s.y : D.WALL + Math.PI * D.R + (D.WALL - s.y);
}

function roofSurface(r, z0, z1, outward, st) {
  const n = st.length, pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = stationAt(st[i], r), sArc = stationArc(st[i]);
    for (const z of [z0, z1]) {
      pos.push(p.x, p.y, z);
      nor.push(outward ? p.nx : -p.nx, outward ? p.ny : -p.ny, 0);
      uv.push(z / D.FLUTE, sArc * 10);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, c = a + 1, b = a + 2, d = a + 3;
    if (outward) idx.push(a, c, b, c, d, b); else idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function roofSheetGeo(z0, z1, st) {
  return mergeGeometries([
    roofSurface(D.R, z0, z1, true, st),
    roofSurface(D.R - D.SHEET, z0, z1, false, st),
  ]);
}

function flutedPlane(shape, flipUV = false) {
  const g = new THREE.ShapeGeometry(shape, 96);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / D.FLUTE, p.getY(i) * 10);
  return g;
}

function rectPlane(w, h, cx = 0, cy = 0) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  g.translate(cx, cy, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / D.FLUTE, p.getY(i) * 10);
  return g;
}

/* ---------- Schrauben, Muttern ---------- */
function screwParts() {
  const rub = [], met = [];
  rub.push(new THREE.CylinderGeometry(0.0135, 0.0135, 0.003, 22).translate(0, 0.0015, 0));
  const prof = [[0, 0.0074], [0.0035, 0.0073], [0.0066, 0.0064], [0.0079, 0.0052], [0.0092, 0.0047], [0.0096, 0.0035], [0.0, 0.0035]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  met.push(new THREE.LatheGeometry(prof, 20));
  const cross1 = new THREE.BoxGeometry(0.0064, 0.0005, 0.0012).translate(0, 0.0072, 0);
  const cross2 = new THREE.BoxGeometry(0.0012, 0.0005, 0.0064).translate(0, 0.0072, 0);
  rub.push(cross1, cross2);
  return { rub, met };
}

function nutParts() {
  const met = [];
  met.push(new THREE.CylinderGeometry(0.013, 0.013, 0.0022, 20).translate(0, 0.0011, 0));
  met.push(new THREE.CylinderGeometry(0.0105, 0.0105, 0.0065, 6).translate(0, 0.0055, 0));
  met.push(new THREE.CylinderGeometry(0.003, 0.003, 0.012, 10).translate(0, 0.0118, 0));
  return met;
}

/* ---------- Scharnier ---------- */
function hingeStatic(pos, axis) {
  // Scharnierblatt (fest) + Zylinder
  const geos = [];
  const barrel = new THREE.CylinderGeometry(0.0038, 0.0038, 0.04, 14);
  if (axis === 'y') {
    geos.push(barrel.translate(pos.x, pos.y, pos.z));
    geos.push(new THREE.BoxGeometry(0.026, 0.04, 0.0016).translate(pos.x + 0.015, pos.y, pos.z + 0.0012));
  } else {
    barrel.rotateZ(Math.PI / 2);
    geos.push(barrel.translate(pos.x, pos.y, pos.z));
    geos.push(new THREE.BoxGeometry(0.04, 0.026, 0.0016).translate(pos.x, pos.y + 0.015, pos.z + 0.0012));
  }
  return geos;
}
function hingeLeaf(axis) {
  return axis === 'y'
    ? new THREE.BoxGeometry(0.026, 0.04, 0.0016).translate(-0.015, 0, 0.0012)
    : new THREE.BoxGeometry(0.04, 0.026, 0.0016).translate(0, -0.015, 0.0012);
}

/* ===================================================================== */
export function buildGreenhouse({ length = 4, spacing = 'dense', mats, quality = 'high' }) {
  const L = length, hz = L / 2;
  const group = new THREE.Group();
  group.name = `gewaechshaus_${L}m`;
  const parts = { galv: [], metal: [], rubber: [] };
  const Na = quality === 'high' ? 160 : 96;
  const st = stations(Na);
  const ring = archRingGeo();
  const screw = screwParts(), nut = nutParts();

  /* --- Bogenpositionen --- */
  const segs = spacing === 'dense' ? Math.round(L / (2 / 3)) : Math.round(L);
  const innerZ = [];
  for (let k = 1; k < segs; k++) innerZ.push(-hz + (k * L) / segs);
  const frontZ = [-hz + D.ARCH_D / 2, hz - D.ARCH_D / 2];

  for (const z of [...innerZ, ...frontZ]) parts.galv.push(placed(ring, new THREE.Vector3(0, 0, z)));

  /* --- Grundrahmen (Hohlprofil 40x50) --- */
  const bw = 0.04, bh = D.BASE_H, ox = D.R + bw / 2, oz = hz + bw / 2;
  for (const sx of [-1, 1]) parts.galv.push(boxGeo(bw, bh, L + 2 * bw).translate(sx * ox, bh / 2, 0));
  for (const sz of [-1, 1]) parts.galv.push(boxGeo(2 * D.R, bh, bw).translate(0, bh / 2, sz * oz));

  /* --- Längsstreben (5 Linien: First, 2×Schulter, 2×unten) --- */
  const rodAngles = [90, 48, 132, 7.8, 172.2];
  const rc = D.RI - 0.01;
  const rodLen = L - 2 * D.ARCH_D;
  for (const aDeg of rodAngles) {
    const a = THREE.MathUtils.degToRad(aDeg);
    const c = new THREE.Vector3(rc * Math.cos(a), D.WALL + rc * Math.sin(a), 0);
    parts.galv.push(placed(boxGeo(0.04, 0.02, rodLen), c, a - Math.PI / 2));
    // Schrauben M6 + Mutter innen an jedem Bogen
    const radial = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const inward = radial.clone().negate();
    for (const z of [...innerZ, -hz + D.ARCH_D * 1.5, hz - D.ARCH_D * 1.5]) {
      const p = new THREE.Vector3(0, D.WALL, z).addScaledVector(radial, D.RI - 0.02);
      for (const g of nut) parts.metal.push(placed(g, p, 0, inward));
    }
  }

  /* --- Schrauben mit Druckscheibe auf Dach-Platten (entlang jedes Bogens) --- */
  const arcLen = 2 * D.WALL + Math.PI * D.R;
  const pitch = 0.3;
  const nScr = Math.round(arcLen / pitch);
  const seamsAt = [];                    // Plattenstöße alle 2 m
  for (let z = -hz + 2; z < hz - 0.01; z += 2) seamsAt.push(z);
  const addScrew = (p, dir) => {
    for (const g of screw.rub) parts.rubber.push(placed(g, p, 0, dir));
    for (const g of screw.met) parts.metal.push(placed(g, p, 0, dir));
  };
  const screwZ = [];
  for (const z of innerZ) {
    if (seamsAt.some((s) => Math.abs(s - z) < 0.01)) screwZ.push(z - 0.014, z + 0.014); else screwZ.push(z);
  }
  for (const z of screwZ) {
    for (let i = 0; i <= nScr; i++) {
      const s = (i / nScr) * arcLen;
      let p, n;
      if (s < D.WALL) { p = new THREE.Vector3(-D.R, s, z); n = new THREE.Vector3(-1, 0, 0); }
      else if (s > D.WALL + Math.PI * D.R) { p = new THREE.Vector3(D.R, D.WALL - (s - D.WALL - Math.PI * D.R), z); n = new THREE.Vector3(1, 0, 0); }
      else { const th = Math.PI - (s - D.WALL) / D.R; p = new THREE.Vector3(D.R * Math.cos(th), D.WALL + D.R * Math.sin(th), z); n = new THREE.Vector3(Math.cos(th), Math.sin(th), 0); }
      if (p.y < 0.08) continue;
      addScrew(p, n);
    }
  }

  /* --- Dach-Platten: 2-m-Streifen (6 m Platte um den Bogen) --- */
  const roofSheets = new THREE.Group(); roofSheets.name = 'dachplatten';
  const edges = [-hz, ...seamsAt, hz];
  const roofGeos = [];
  for (let i = 0; i < edges.length - 1; i++) {
    roofGeos.push(roofSheetGeo(edges[i] + 0.003, edges[i + 1] - 0.003, st));
  }
  const roofMesh = new THREE.Mesh(mergeGeometries(roofGeos), mats.sheet);
  roofMesh.name = 'dachplatten'; roofMesh.renderOrder = 3; roofMesh.receiveShadow = false; roofMesh.castShadow = false;
  roofSheets.add(roofMesh);

  /* --- Stirnseiten --- */
  const leaves = [];
  const frontSheets = new THREE.Group(); frontSheets.name = 'stirnplatten';
  const DW = 0.9;                // lichte Türbreite
  const postX = DW / 2 + 0.015;  // Mitte der Pfosten
  const yWinTop = 1.85, yWinBot = 1.435, yDoorTop = 1.406, yDoorBot = 0.056;
  const braceY = 0.70;
  const archInnerY = (x) => D.WALL + Math.sqrt(D.RI * D.RI - x * x);

  const buildFront = (sign) => {
    const zF = hz;                                 // wir bauen für +z und drehen für −z
    const mY = sign > 0 ? new THREE.Matrix4() : new THREE.Matrix4().makeRotationY(Math.PI);
    const addS = (key, g) => parts[key].push(g.applyMatrix4(mY));
    const zc = zF - D.ARCH_D / 2;                  // Mitte Bogenring
    const zb = zF - 0.025;                         // Mitte Pfosten / Querstreben (30 mm)

    // Pfosten
    for (const sx of [-1, 1]) {
      const xTop = sx * postX, top = archInnerY(Math.abs(xTop)) + 0.004;
      addS('galv', boxGeo(0.03, top - D.BASE_H, 0.03).translate(xTop, (top + D.BASE_H) / 2, zb));
    }
    // Kopfriegel der Tür, oberer Fensterriegel
    addS('galv', boxGeo(DW, 0.03, 0.03).translate(0, (yDoorTop + yWinBot) / 2, zb));
    addS('galv', boxGeo(DW, 0.03, 0.03).translate(0, yWinTop + 0.015, zb));
    // Querstreben links/rechts
    for (const sx of [-1, 1]) {
      const x0 = postX + 0.015, x1 = D.RI - 0.004, len = x1 - x0;
      addS('galv', boxGeo(len, 0.03, 0.03).translate(sx * (x0 + len / 2), braceY, zb));
    }
    // Türscharniere (fest), Fensterscharniere (fest)
    const pivotZ = zF - 0.003;
    for (const hy of [0.3, 1.15]) for (const g of hingeStatic(new THREE.Vector3(DW / 2, hy, pivotZ), 'y')) addS('metal', g);
    for (const hx of [-0.3, 0.3]) for (const g of hingeStatic(new THREE.Vector3(hx, yWinTop, pivotZ), 'x')) addS('metal', g);
    // Stirnplatten-Schrauben entlang des Rings
    const rr = D.RI - 0.022;
    const nS = Math.round((D.WALL * 2 + Math.PI * rr) / 0.3);
    const sL = D.WALL * 2 + Math.PI * rr;
    for (let i = 0; i <= nS; i++) {
      const s = (i / nS) * sL; let p;
      if (s < D.WALL) p = new THREE.Vector3(-rr, s, 0);
      else if (s > D.WALL + Math.PI * rr) p = new THREE.Vector3(rr, D.WALL - (s - D.WALL - Math.PI * rr), 0);
      else { const th = Math.PI - (s - D.WALL) / rr; p = new THREE.Vector3(rr * Math.cos(th), D.WALL + rr * Math.sin(th), 0); }
      if (p.y < 0.1 || (Math.abs(p.x) < 0.52 && p.y < 1.95)) continue;
      p.z = zF - 0.02 + 0.004;
      const q = new THREE.Vector3(0, 0, 1);
      for (const g of screw.rub) addS('rubber', placed(g, p, 0, q));
      for (const g of screw.met) addS('metal', placed(g, p, 0, q));
    }
    // Schrauben an den Querstreben
    for (const sx of [-1, 1]) for (const f of [0.18, 0.55, 0.9]) {
      const x = sx * (postX + 0.015 + f * (D.RI - 0.02 - postX - 0.015));
      const p = new THREE.Vector3(x, braceY, zF - 0.02 + 0.004);
      for (const g of screw.rub) addS('rubber', placed(g, p, 0, new THREE.Vector3(0, 0, 1)));
      for (const g of screw.met) addS('metal', placed(g, p, 0, new THREE.Vector3(0, 0, 1)));
    }

    /* Stirn-Platte (mit Aussparung für Tür+Fenster) */
    const Rs = D.RI + 0.01, dx = DW / 2, topCut = yWinTop + 0.015;
    const sh = new THREE.Shape();
    sh.moveTo(-Rs, 0); sh.lineTo(-dx, 0); sh.lineTo(-dx, topCut); sh.lineTo(dx, topCut); sh.lineTo(dx, 0);
    sh.lineTo(Rs, 0); sh.lineTo(Rs, D.WALL); sh.absarc(0, D.WALL, Rs, 0, Math.PI, false); sh.lineTo(-Rs, 0);
    const fp = new THREE.Mesh(flutedPlane(sh), mats.sheetDouble);
    fp.position.set(0, 0, zF - 0.02); fp.rotation.y = sign > 0 ? 0 : Math.PI;
    fp.name = 'stirnplatte'; fp.renderOrder = 3;
    if (sign < 0) fp.position.z = -(zF - 0.02);
    frontSheets.add(fp);

    /* Tür (Drehpunkt rechts, öffnet nach außen) */
    const doorPivot = new THREE.Group();
    doorPivot.position.set(DW / 2, yDoorBot, pivotZ);
    const leafW = DW - 0.004, leafH = yDoorTop - yDoorBot;
    const dparts = [];
    dparts.push(boxGeo(0.03, leafH, 0.03).translate(-0.015, leafH / 2, -0.017));
    dparts.push(boxGeo(0.03, leafH, 0.03).translate(-leafW + 0.015, leafH / 2, -0.017));
    dparts.push(boxGeo(leafW - 0.06, 0.03, 0.03).translate(-leafW / 2, 0.015, -0.017));
    dparts.push(boxGeo(leafW - 0.06, 0.03, 0.03).translate(-leafW / 2, leafH - 0.015, -0.017));
    const dMesh = new THREE.Mesh(mergeGeometries(dparts.map(flatten)), mats.galv);
    dMesh.castShadow = dMesh.receiveShadow = true; dMesh.name = 'tuerrahmen';
    doorPivot.add(dMesh);
    const dSheet = new THREE.Mesh(rectPlane(leafW - 0.04, leafH - 0.04, -leafW / 2, leafH / 2), mats.sheetDouble);
    dSheet.position.z = -0.017; dSheet.renderOrder = 3; dSheet.name = 'tuerplatte';
    doorPivot.add(dSheet);
    // Scharnierblätter, Griff, Riegel
    const dm = [];
    for (const hy of [0.3, 1.15]) dm.push(hingeLeaf('y').translate(0, hy - yDoorBot, pivotZ - pivotZ));
    for (const g of dm) { const m = new THREE.Mesh(g, mats.metal); m.castShadow = true; doorPivot.add(m); }
    const handle = new THREE.Mesh(mergeGeometries([
      new THREE.BoxGeometry(0.022, 0.1, 0.002).translate(-leafW + 0.035, 0.7, 0.0),
      new THREE.BoxGeometry(0.012, 0.075, 0.012).translate(-leafW + 0.035, 0.7, 0.007),
      new THREE.BoxGeometry(0.03, 0.02, 0.003).translate(-leafW + 0.02, 0.45, 0.0),
    ].map(flatten)), mats.metal);
    handle.castShadow = true; doorPivot.add(handle);
    doorPivot.userData = { kind: 'door', open: 0, target: 0, max: THREE.MathUtils.degToRad(105) };
    leaves.push(doorPivot);

    /* Fenster (oben angeschlagen, öffnet nach außen) */
    const winPivot = new THREE.Group();
    winPivot.position.set(0, yWinTop, pivotZ);
    const wH = yWinTop - yWinBot - 0.004, wW = DW - 0.004;
    const wparts = [];
    wparts.push(boxGeo(0.03, wH, 0.03).translate(-wW / 2 + 0.015, -wH / 2, -0.017));
    wparts.push(boxGeo(0.03, wH, 0.03).translate(wW / 2 - 0.015, -wH / 2, -0.017));
    wparts.push(boxGeo(wW - 0.06, 0.03, 0.03).translate(0, -0.015, -0.017));
    wparts.push(boxGeo(wW - 0.06, 0.03, 0.03).translate(0, -wH + 0.015, -0.017));
    const wMesh = new THREE.Mesh(mergeGeometries(wparts.map(flatten)), mats.galv);
    wMesh.castShadow = wMesh.receiveShadow = true; wMesh.name = 'fensterrahmen';
    winPivot.add(wMesh);
    const wSheet = new THREE.Mesh(rectPlane(wW - 0.04, wH - 0.04, 0, -wH / 2), mats.sheetDouble);
    wSheet.position.z = -0.017; wSheet.renderOrder = 3; wSheet.name = 'fensterplatte';
    winPivot.add(wSheet);
    for (const hx of [-0.3, 0.3]) { const m = new THREE.Mesh(hingeLeaf('x').translate(hx, 0, 0), mats.metal); m.castShadow = true; winPivot.add(m); }
    const latch = new THREE.Mesh(mergeGeometries([
      new THREE.BoxGeometry(0.05, 0.02, 0.002).translate(0, -wH + 0.03, 0.0),
      new THREE.BoxGeometry(0.012, 0.03, 0.01).translate(0, -wH + 0.03, 0.006),
    ].map(flatten)), mats.metal);
    winPivot.add(latch);
    winPivot.userData = { kind: 'window', open: 0, target: 0, max: THREE.MathUtils.degToRad(55) };
    leaves.push(winPivot);

    const fg = new THREE.Group();
    fg.name = sign > 0 ? 'stirnseite_vorn' : 'stirnseite_hinten';
    fg.add(doorPivot, winPivot);
    if (sign < 0) fg.rotation.y = Math.PI;
    group.add(fg);
  };
  buildFront(1); buildFront(-1);

  /* --- Bodenplatte / Erde --- */
  const soilGeo = new THREE.PlaneGeometry(2 * D.R, L, 1, 1);
  soilGeo.rotateX(-Math.PI / 2);
  const uvs = soilGeo.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * (2 * D.R) / 1.4, uvs.getY(i) * L / 1.4);
  const soil = new THREE.Mesh(soilGeo, mats.soil);
  soil.position.y = D.BASE_H - 0.004; soil.receiveShadow = true; soil.name = 'erde';

  /* --- zusammenbauen --- */
  const frame = mergedMesh(parts.galv, mats.galv, 'rahmen_stahl');
  const metals = mergedMesh(parts.metal, mats.metal, 'schrauben_scharniere');
  const rubbers = mergedMesh(parts.rubber, mats.rubber, 'druckscheiben');
  for (const m of [frame, metals, rubbers, soil, roofSheets, frontSheets]) if (m) group.add(m);

  return {
    group, leaves, length: L,
    dims: { width: 3, height: 2, length: L, arches: innerZ.length + 2, sheets: Math.round(L / 2) + 1 },
    setLeaf(kind, open) { leaves.forEach((l) => { if (l.userData.kind === kind) l.userData.target = open ? 1 : 0; }); },
    isOpen(kind) { return leaves.some((l) => l.userData.kind === kind && l.userData.target > 0.5); },
    update(dt) {
      for (const l of leaves) {
        const u = l.userData;
        u.open += (u.target - u.open) * Math.min(1, dt * 5);
        if (Math.abs(u.target - u.open) < 0.0005) u.open = u.target;
        if (u.kind === 'door') l.rotation.y = u.open * u.max;
        else l.rotation.x = -u.open * u.max;
      }
    },
    dispose() { group.traverse((o) => o.geometry && o.geometry.dispose()); },
  };
}
