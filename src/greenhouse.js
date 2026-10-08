// Parametrisches Foliengewächshaus-Modell: 3 m breit, 2 m hoch, Länge 4/6/8/10 m (Module à 2 m)
// Koordinaten: x = Breite, y = oben, z = Länge. Maße in Metern.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const D = {
  R: 1.5,            // Außenradius inkl. Platte
  SHEET: 0.006,      // Plattendicke (6 mm Hohlkammer)
  WALL: 0.5,         // senkrechtes Stück unter dem Halbkreis  -> 0.5 + 1.5 = 2.0 m Firsthöhe
  ARCH_D: 0.04,      // Bogenprofil: 40 mm entlang der Länge
  ARCH_T: 0.02,      // 20 mm radial
  LEG_H: 0.05,       // Grundrahmen: senkrechter Schenkel
  LEG_T: 0.0025,     // Blechstärke Winkelprofil
  FLANGE: 0.04,      // Grundrahmen: waagerechter Schenkel (nach außen)
  FOOT: 0.002,       // Plattenunterkante (Endprofil darunter)
  FLUTE: 0.04,       // Texturperiode der Hohlkammerplatte (4 Kammern)
};
D.RO = D.R - D.SHEET;      // Außenkante Bogen
D.RI = D.RO - D.ARCH_T;    // Innenkante Bogen

export const TIERS = {
  high:   { Na: 180, rb: 3, arch: 140, bevel: 3, crease: 0.62, lathe: 24, cyl: 24, pitch: 0.3 },
  mobile: { Na: 96,  rb: 2, arch: 72,  bevel: 2, crease: 0.95, lathe: 12, cyl: 14, pitch: 0.36 },
  ar:     { Na: 48,  rb: 1, arch: 40,  bevel: 1, crease: 1.2,  lathe: 8,  cyl: 8,  pitch: 0.55, cross: false },
};

const Y = new THREE.Vector3(0, 1, 0);

/* ---------- Materialien ---------- */
export function createMaterials(tex, envIntensity = 1) {
  const galv = new THREE.MeshStandardMaterial({
    name: 'verzinkter_stahl', map: tex.galv, color: 0xe3e8ec,
    metalness: 0.86, roughness: 0.4, envMapIntensity: envIntensity,
  });
  const metal = new THREE.MeshStandardMaterial({
    name: 'schrauben_zink', color: 0xcdd2d6, metalness: 1, roughness: 0.26, envMapIntensity: envIntensity,
  });
  const rubber = new THREE.MeshStandardMaterial({
    name: 'druckscheibe_kunststoff', color: 0x25292d, metalness: 0, roughness: 0.6, bumpMap: tex.noise, bumpScale: 0.4,
  });
  const cap = new THREE.MeshStandardMaterial({
    name: 'endprofil', color: 0xdfe3e5, metalness: 0, roughness: 0.45,
  });
  const sheet = new THREE.MeshPhysicalMaterial({
    name: 'polycarbonat_hohlkammer', map: tex.sheet.map, normalMap: tex.sheet.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9), color: 0xdcebf5, metalness: 0, roughness: 0.08,
    clearcoat: 0.2, clearcoatRoughness: 0.05,
    transparent: true, depthWrite: false, side: THREE.FrontSide, envMapIntensity: 1.0,
  });
  // Fresnel: an streifenden Winkeln wird die Platte opaker (Himmelsspiegelung sichtbar)
  const fresnel = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
        `float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 4.0);
         diffuseColor.a = mix(diffuseColor.a, 1.0, fr * 0.5);
         #include <opaque_fragment>`);
    };
  };
  fresnel(sheet);
  const sheetDouble = sheet.clone();
  sheetDouble.name = 'polycarbonat_hohlkammer_flach';
  sheetDouble.side = THREE.DoubleSide;
  fresnel(sheetDouble);
  const soil = new THREE.MeshStandardMaterial({
    name: 'erde', map: tex.soil.map, color: 0x6b4e3b, bumpMap: tex.soil.bump, bumpScale: 2.2, roughness: 0.96, metalness: 0,
  });
  return { galv, metal, rubber, cap, sheet, sheetDouble, soil };
}

/* ---------- Geometrie-Helfer ---------- */
function uvMeters(g) {
  // triplanare UVs in Metern (2 Kacheln/m), damit Zinkblumen nicht gestreckt werden
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function makeBox(tier) {
  return (w, h, d, r = 0.0016) => {
    const rr = Math.min(r, Math.min(w, h, d) / 2.6);
    return uvMeters(new RoundedBoxGeometry(w, h, d, tier.rb, rr));
  };
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
  const n = g.index ? g.toNonIndexed() : g;
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

/* ---------- Bogenprofil (Rechteckrohr 40x20, Kanten gebrochen) ---------- */
function archRingGeo(tier) {
  const { RO, RI, WALL, ARCH_D } = D;
  const b = 0.0016;                       // Kantenradius
  const ro = RO - b, ri = RI + b, y0 = D.FOOT + b;
  const s = new THREE.Shape();
  s.moveTo(-ro, y0); s.lineTo(-ro, WALL);
  s.absarc(0, WALL, ro, Math.PI, 0, true);
  s.lineTo(ro, y0); s.lineTo(ri, y0); s.lineTo(ri, WALL);
  s.absarc(0, WALL, ri, 0, Math.PI, false);
  s.lineTo(-ri, y0); s.closePath();
  const depth = ARCH_D - 2 * b;
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: tier.bevel, curveSegments: tier.arch,
  });
  g.translate(0, 0, -depth / 2);
  return uvMeters(toCreasedNormals(g, tier.crease));
}

/* ---------- Plattenstreifen entlang des Bogenprofils ---------- */
function stations(Na) {
  const st = [{ w: -1, y: D.FOOT }, { w: -1, y: D.WALL }];
  for (let j = 1; j < Na; j++) st.push({ th: Math.PI - (Math.PI * j) / Na });
  st.push({ w: 1, y: D.WALL }, { w: 1, y: D.FOOT });
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

/** Rückseite für Formate ohne Doppelseitigkeit (USDZ): gespiegelte Dreiecke + umgekehrte Normalen */
function flipGeo(g) {
  const f = g.clone();
  const idx = f.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i), b = idx.getX(i + 2); idx.setX(i, b); idx.setX(i + 2, a); }
  const n = f.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return f;
}

function flutedPlane(shape, seg) {
  const g = new THREE.ShapeGeometry(shape, seg);
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
function screwParts(tier) {
  const rub = [], met = [];
  rub.push(new THREE.CylinderGeometry(0.0135, 0.0135, 0.003, tier.cyl).translate(0, 0.0015, 0));
  const prof = [[0, 0.0074], [0.0035, 0.0073], [0.0066, 0.0064], [0.0079, 0.0052], [0.0092, 0.0047], [0.0096, 0.0035], [0.0, 0.0035]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  met.push(new THREE.LatheGeometry(prof, tier.lathe));
  if (tier.cross !== false) {
    rub.push(new THREE.BoxGeometry(0.0064, 0.0005, 0.0012).translate(0, 0.0072, 0));
    rub.push(new THREE.BoxGeometry(0.0012, 0.0005, 0.0064).translate(0, 0.0072, 0));
  }
  return { rub, met };
}

function nutParts(tier) {
  return [
    new THREE.CylinderGeometry(0.013, 0.013, 0.0022, tier.cyl).translate(0, 0.0011, 0),
    new THREE.CylinderGeometry(0.0105, 0.0105, 0.0065, 6).translate(0, 0.0055, 0),
    new THREE.CylinderGeometry(0.003, 0.003, 0.012, 8).translate(0, 0.0118, 0),
  ];
}

/* ---------- Scharnier ---------- */
function hingeStatic(pos, axis, tier) {
  const geos = [];
  const barrel = new THREE.CylinderGeometry(0.0038, 0.0038, 0.04, tier.cyl);
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
  const tier = TIERS[quality] || TIERS.high;
  const boxGeo = makeBox(tier);
  const twoSided = quality === 'ar';
  const twin = (mesh, parent) => {
    if (!twoSided) return;
    const t = mesh.clone(); t.geometry = flipGeo(mesh.geometry); t.name = mesh.name + '_rueck'; parent.add(t);
  };
  const L = length, hz = L / 2;
  const group = new THREE.Group();
  group.name = `gewaechshaus_${L}m`;
  const parts = { galv: [], metal: [], rubber: [], cap: [] };
  const st = stations(tier.Na);
  const ring = archRingGeo(tier);
  const screw = screwParts(tier), nut = nutParts(tier);

  /* --- Bogenpositionen --- */
  const segs = spacing === 'dense' ? Math.round(L / (2 / 3)) : Math.round(L);
  const innerZ = [];
  for (let k = 1; k < segs; k++) innerZ.push(-hz + (k * L) / segs);
  const frontZ = [-hz + D.ARCH_D / 2, hz - D.ARCH_D / 2];
  for (const z of [...innerZ, ...frontZ]) parts.galv.push(placed(ring, new THREE.Vector3(0, 0, z)));

  const addScrew = (p, dir, withRubber = true) => {
    if (withRubber) for (const g of screw.rub) parts.rubber.push(placed(g, p, 0, dir));
    for (const g of screw.met) parts.metal.push(placed(g, p, 0, dir));
  };

  /* --- Grundrahmen: Winkelprofil (senkrechter Schenkel außen am Bogen, Fuß nach außen) --- */
  {
    const t = D.LEG_T, lh = D.LEG_H, fw = D.FLANGE, rt = 0.0008;
    const bx = (w, h, d, x, y, z) => parts.galv.push(boxGeo(w, h, d, rt).translate(x, y, z));
    for (const sx of [-1, 1]) {
      bx(t, lh, L + 2 * t, sx * (D.R + t / 2), lh / 2, 0);                                 // Schenkel längs
      bx(fw + t, t, L + 2 * (t + fw), sx * (D.R + (fw + t) / 2), t / 2, 0);                 // Fuß längs
    }
    for (const sz of [-1, 1]) {
      bx(2 * D.R, lh, t, 0, lh / 2, sz * (hz + t / 2));                                    // Schenkel quer
      bx(2 * D.R, t, fw + t, 0, t / 2, sz * (hz + (fw + t) / 2));                          // Fuß quer
    }
    // Befestigungsschrauben der Bögen im Winkelprofil (Kopf außen)
    for (const z of [...innerZ, ...frontZ]) for (const sx of [-1, 1]) {
      addScrew(new THREE.Vector3(sx * (D.R + t), 0.032, z), new THREE.Vector3(sx, 0, 0), false);
    }
  }

  /* --- Längsstreben (5 Linien: First, 2×Schulter, 2×unten) --- */
  const rodAngles = [90, 48, 132, 7.8, 172.2];
  const rc = D.RI - 0.01;
  const rodLen = L - 2 * D.ARCH_D;
  for (const aDeg of rodAngles) {
    const a = THREE.MathUtils.degToRad(aDeg);
    const c = new THREE.Vector3(rc * Math.cos(a), D.WALL + rc * Math.sin(a), 0);
    parts.galv.push(placed(boxGeo(0.04, 0.02, rodLen, 0.0016), c, a - Math.PI / 2));
    const radial = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const inward = radial.clone().negate();
    for (const z of [...innerZ, -hz + D.ARCH_D * 1.5, hz - D.ARCH_D * 1.5]) {
      const p = new THREE.Vector3(0, D.WALL, z).addScaledVector(radial, D.RI - 0.02);
      for (const g of nut) parts.metal.push(placed(g, p, 0, inward));
    }
  }

  /* --- Schrauben mit Druckscheibe auf Dach-Platten --- */
  const arcLen = 2 * D.WALL + Math.PI * D.R;
  const nScr = Math.round(arcLen / tier.pitch);
  const seamsAt = [];                    // Plattenstöße alle 2 m
  for (let z = -hz + 2; z < hz - 0.01; z += 2) seamsAt.push(z);
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
      if (p.y < 0.09) continue;
      addScrew(p, n);
    }
  }

  /* --- Dach-Platten: 2-m-Streifen (6 m Platte um den Bogen) --- */
  const roofSheets = new THREE.Group(); roofSheets.name = 'dachplatten';
  const edges = [-hz, ...seamsAt, hz];
  const roofGeos = [];
  for (let i = 0; i < edges.length - 1; i++) roofGeos.push(roofSheetGeo(edges[i] + 0.003, edges[i + 1] - 0.003, st));
  const roofMesh = new THREE.Mesh(mergeGeometries(roofGeos), mats.sheet);
  roofMesh.name = 'dachplatten'; roofMesh.renderOrder = 3;
  roofSheets.add(roofMesh);

  /* --- Endprofile (U-Kappen) an den offenen Plattenenden am Fuß --- */
  {
    const tw = 0.0022, cw = D.SHEET + 2 * tw;
    for (const sx of [-1, 1]) {
      // Bodenplatte unter der Platte + innere Wange (die äußere Wange liegt hinter dem Winkelprofil)
      parts.cap.push(boxGeo(cw, D.FOOT, L - 0.01, 0.0004).translate(sx * (D.R - D.SHEET / 2 + 0.0005), D.FOOT / 2, 0));
      parts.cap.push(boxGeo(tw, 0.022, L - 0.01, 0.0006).translate(sx * (D.R - D.SHEET - tw / 2), 0.011, 0));
    }
  }

  /* --- Stirnseiten --- */
  const leaves = [];
  const frontSheets = new THREE.Group(); frontSheets.name = 'stirnplatten';
  const DW = 0.9;                // lichte Türbreite
  const postX = DW / 2 + 0.015;  // Mitte der Pfosten
  const yWinTop = 1.85, yWinBot = 1.435, yDoorTop = 1.406, yDoorBot = 0.056;
  const braceY = 0.70;
  const archInnerY = (x) => D.WALL + Math.sqrt(D.RI * D.RI - x * x);
  const baseTop = D.LEG_H;

  const buildFront = (sign) => {
    const zF = hz;                                 // wir bauen für +z und drehen für −z
    const mY = sign > 0 ? new THREE.Matrix4() : new THREE.Matrix4().makeRotationY(Math.PI);
    const addS = (key, g) => parts[key].push(g.applyMatrix4(mY));
    const zb = zF - 0.025;                         // Mitte Pfosten / Querstreben (30 mm)

    // Pfosten
    for (const sx of [-1, 1]) {
      const xTop = sx * postX, top = archInnerY(Math.abs(xTop)) + 0.004;
      addS('galv', boxGeo(0.03, top - baseTop, 0.03).translate(xTop, (top + baseTop) / 2, zb));
    }
    // Kopfriegel der Tür, oberer Fensterriegel
    addS('galv', boxGeo(DW, 0.03, 0.03).translate(0, (yDoorTop + yWinBot) / 2, zb));
    addS('galv', boxGeo(DW, 0.03, 0.03).translate(0, yWinTop + 0.015, zb));
    // Querstreben links/rechts
    for (const sx of [-1, 1]) {
      const x0 = postX + 0.015, x1 = D.RI - 0.004, len = x1 - x0;
      addS('galv', boxGeo(len, 0.03, 0.03).translate(sx * (x0 + len / 2), braceY, zb));
    }
    // Scharniere (fest)
    const pivotZ = zF - 0.003;
    for (const hy of [0.3, 1.15]) for (const g of hingeStatic(new THREE.Vector3(DW / 2, hy, pivotZ), 'y', tier)) addS('metal', g);
    for (const hx of [-0.3, 0.3]) for (const g of hingeStatic(new THREE.Vector3(hx, yWinTop, pivotZ), 'x', tier)) addS('metal', g);

    // Stirnplatten-Schrauben entlang des Rings
    const rr = D.RI - 0.022;
    const sL = D.WALL * 2 + Math.PI * rr;
    const nS = Math.round(sL / tier.pitch);
    const zUp = new THREE.Vector3(0, 0, 1);
    const addFS = (p) => {
      for (const g of screw.rub) addS('rubber', placed(g, p, 0, zUp));
      for (const g of screw.met) addS('metal', placed(g, p, 0, zUp));
    };
    for (let i = 0; i <= nS; i++) {
      const s = (i / nS) * sL; let p;
      if (s < D.WALL) p = new THREE.Vector3(-rr, s, 0);
      else if (s > D.WALL + Math.PI * rr) p = new THREE.Vector3(rr, D.WALL - (s - D.WALL - Math.PI * rr), 0);
      else { const th = Math.PI - (s - D.WALL) / rr; p = new THREE.Vector3(rr * Math.cos(th), D.WALL + rr * Math.sin(th), 0); }
      if (p.y < 0.1 || (Math.abs(p.x) < 0.52 && p.y < 1.95)) continue;
      p.z = zF - 0.02 + 0.004;
      addFS(p);
    }
    for (const sx of [-1, 1]) for (const f of [0.18, 0.55, 0.9]) {
      addFS(new THREE.Vector3(sx * (postX + 0.015 + f * (D.RI - 0.02 - postX - 0.015)), braceY, zF - 0.02 + 0.004));
    }

    // Endprofil am Fuß der seitlichen Stirnplatten (Innenseite)
    for (const sx of [-1, 1]) {
      const x0 = postX + 0.015, x1 = D.RI, len = x1 - x0;
      addS('cap', boxGeo(len, D.FOOT, D.SHEET + 0.0044, 0.0004).translate(sx * (x0 + len / 2), D.FOOT / 2, zF - 0.02));
      addS('cap', boxGeo(len, 0.02, 0.0022, 0.0006).translate(sx * (x0 + len / 2), 0.011, zF - 0.02 - D.SHEET / 2 - 0.0033));
    }

    // Türhaken: Öse am Pfosten (innen)
    addS('metal', new THREE.TorusGeometry(0.0055, 0.0016, 8, 16).rotateY(Math.PI / 2).translate(-postX + 0.004, yDoorBot + 0.9, zF - 0.043));

    /* Stirn-Platte (mit Aussparung für Tür+Fenster) */
    const Rs = D.RI + 0.01, dx = DW / 2, topCut = yWinTop + 0.015;
    const sh = new THREE.Shape();
    sh.moveTo(-Rs, 0); sh.lineTo(-dx, 0); sh.lineTo(-dx, topCut); sh.lineTo(dx, topCut); sh.lineTo(dx, 0);
    sh.lineTo(Rs, 0); sh.lineTo(Rs, D.WALL); sh.absarc(0, D.WALL, Rs, 0, Math.PI, false); sh.lineTo(-Rs, 0);
    const fp = new THREE.Mesh(flutedPlane(sh, tier.Na), mats.sheetDouble);
    fp.position.set(0, 0, sign > 0 ? zF - 0.02 : -(zF - 0.02));
    fp.rotation.y = sign > 0 ? 0 : Math.PI;
    fp.name = 'stirnplatte'; fp.renderOrder = 3;
    frontSheets.add(fp); twin(fp, frontSheets);

    /* Tür (Drehpunkt rechts, öffnet nach außen) */
    const doorPivot = new THREE.Group();
    doorPivot.position.set(DW / 2, yDoorBot, pivotZ);
    const leafW = DW - 0.004, leafH = yDoorTop - yDoorBot;
    const dparts = [
      boxGeo(0.03, leafH, 0.03).translate(-0.015, leafH / 2, -0.017),
      boxGeo(0.03, leafH, 0.03).translate(-leafW + 0.015, leafH / 2, -0.017),
      boxGeo(leafW - 0.06, 0.03, 0.03).translate(-leafW / 2, 0.015, -0.017),
      boxGeo(leafW - 0.06, 0.03, 0.03).translate(-leafW / 2, leafH - 0.015, -0.017),
    ];
    const dMesh = new THREE.Mesh(mergeGeometries(dparts.map(flatten)), mats.galv);
    dMesh.castShadow = dMesh.receiveShadow = true; dMesh.name = 'tuerrahmen';
    doorPivot.add(dMesh);
    const dSheet = new THREE.Mesh(rectPlane(leafW - 0.04, leafH - 0.04, -leafW / 2, leafH / 2), mats.sheetDouble);
    dSheet.position.z = -0.017; dSheet.renderOrder = 3; dSheet.name = 'tuerplatte';
    doorPivot.add(dSheet); twin(dSheet, doorPivot);
    const dm = [];
    for (const hy of [0.3, 1.15]) dm.push(hingeLeaf('y').translate(0, hy - yDoorBot, 0));
    // Griff + Riegel außen, Haken innen
    dm.push(new THREE.BoxGeometry(0.022, 0.1, 0.002).translate(-leafW + 0.035, 0.7, 0.0));
    dm.push(new THREE.BoxGeometry(0.012, 0.075, 0.012).translate(-leafW + 0.035, 0.7, 0.007));
    dm.push(new THREE.BoxGeometry(0.03, 0.02, 0.003).translate(-leafW + 0.02, 0.45, 0.0));
    dm.push(new THREE.BoxGeometry(0.05, 0.004, 0.003).translate(-leafW + 0.027, 0.9, -0.0345));      // Haken-Arm
    dm.push(new THREE.TorusGeometry(0.0045, 0.0014, 6, 12).rotateY(Math.PI / 2).translate(-leafW, 0.9, -0.0345));
    const dMetal = new THREE.Mesh(mergeGeometries(dm.map(flatten)), mats.metal);
    dMetal.castShadow = true; doorPivot.add(dMetal);
    doorPivot.userData = { kind: 'door', open: 0, target: 0, max: THREE.MathUtils.degToRad(105) };
    leaves.push(doorPivot);

    /* Fenster (oben angeschlagen, öffnet nach außen) + Haltearme */
    const winPivot = new THREE.Group();
    winPivot.position.set(0, yWinTop, pivotZ);
    const wH = yWinTop - yWinBot - 0.004, wW = DW - 0.004;
    const wparts = [
      boxGeo(0.03, wH, 0.03).translate(-wW / 2 + 0.015, -wH / 2, -0.017),
      boxGeo(0.03, wH, 0.03).translate(wW / 2 - 0.015, -wH / 2, -0.017),
      boxGeo(wW - 0.06, 0.03, 0.03).translate(0, -0.015, -0.017),
      boxGeo(wW - 0.06, 0.03, 0.03).translate(0, -wH + 0.015, -0.017),
    ];
    const wMesh = new THREE.Mesh(mergeGeometries(wparts.map(flatten)), mats.galv);
    wMesh.castShadow = wMesh.receiveShadow = true; wMesh.name = 'fensterrahmen';
    winPivot.add(wMesh);
    const wSheet = new THREE.Mesh(rectPlane(wW - 0.04, wH - 0.04, 0, -wH / 2), mats.sheetDouble);
    wSheet.position.z = -0.017; wSheet.renderOrder = 3; wSheet.name = 'fensterplatte';
    winPivot.add(wSheet); twin(wSheet, winPivot);
    const wm = [hingeLeaf('x').translate(-0.3, 0, 0), hingeLeaf('x').translate(0.3, 0, 0)];
    wm.push(new THREE.BoxGeometry(0.05, 0.02, 0.002).translate(0, -wH + 0.03, 0.0));
    wm.push(new THREE.BoxGeometry(0.012, 0.03, 0.01).translate(0, -wH + 0.03, 0.006));
    const wMetal = new THREE.Mesh(mergeGeometries(wm.map(flatten)), mats.metal);
    wMetal.castShadow = true; winPivot.add(wMetal);

    // Haltearm (Schiebearm): fest am Pfosten, gleitet am Fensterrahmen
    const fg = new THREE.Group();
    fg.name = sign > 0 ? 'stirnseite_vorn' : 'stirnseite_hinten';
    const stays = [];
    for (const sx of [-1, 1]) {
      const F = new THREE.Vector3(sx * postX, 1.62, zF + 0.0015);
      const W = new THREE.Vector3(sx * (wW / 2 - 0.015), -0.13, 0.0045);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1, 0.002).translate(0, 0.5, 0), mats.metal);
      bar.castShadow = true; bar.position.copy(F);
      const pinF = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 10).rotateX(Math.PI / 2), mats.metal);
      pinF.position.set(F.x, F.y, zF - 0.003);
      fg.add(bar, pinF);
      stays.push({ bar, F, W });
    }
    fg.add(doorPivot, winPivot);
    winPivot.userData = { kind: 'window', open: 0, target: 0, max: THREE.MathUtils.degToRad(55), stays };
    leaves.push(winPivot);
    if (sign < 0) fg.rotation.y = Math.PI;
    group.add(fg);
  };
  buildFront(1); buildFront(-1);

  /* --- Erde --- */
  const soilGeo = new THREE.PlaneGeometry(2 * D.R, L, 1, 1);
  soilGeo.rotateX(-Math.PI / 2);
  const uvs = soilGeo.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * (2 * D.R) / 1.4, uvs.getY(i) * L / 1.4);
  const soil = new THREE.Mesh(soilGeo, mats.soil);
  soil.position.y = 0.035; soil.receiveShadow = true; soil.name = 'erde';

  /* --- zusammenbauen --- */
  const frame = mergedMesh(parts.galv, mats.galv, 'rahmen_stahl');
  const metals = mergedMesh(parts.metal, mats.metal, 'schrauben_scharniere');
  const rubbers = mergedMesh(parts.rubber, mats.rubber, 'druckscheiben');
  const caps = mergedMesh(parts.cap, mats.cap, 'endprofile');
  for (const m of [frame, metals, rubbers, caps, soil, roofSheets, frontSheets]) if (m) group.add(m);

  const sheetMeshes = [];
  group.traverse((o) => { if (o.isMesh && o.material && o.material.transparent) sheetMeshes.push(o); });

  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  const apply = (l) => {
    const u = l.userData;
    if (u.kind === 'door') { l.rotation.y = u.open * u.max; return; }
    l.rotation.x = -u.open * u.max;
    for (const s of u.stays) {
      tmp.copy(s.W).applyEuler(l.rotation).add(l.position);   // Anschlag am Fensterrahmen (lokal in der Stirn-Gruppe)
      dir.subVectors(tmp, s.F);
      const len = dir.length();
      s.bar.quaternion.setFromUnitVectors(Y, dir.normalize());
      s.bar.scale.y = len + 0.035;
    }
  };
  leaves.forEach(apply);

  return {
    group, leaves, length: L, sheetMeshes,
    dims: { width: 3, height: 2, length: L, arches: innerZ.length + 2, sheets: Math.round(L / 2) + 1 },
    setLeaf(kind, open, instant = false) {
      leaves.forEach((l) => {
        if (l.userData.kind !== kind) return;
        l.userData.target = open ? 1 : 0;
        if (instant) { l.userData.open = l.userData.target; apply(l); }
      });
    },
    isOpen(kind) { return leaves.some((l) => l.userData.kind === kind && l.userData.target > 0.5); },
    /** true, solange sich etwas bewegt (für Render-on-demand) */
    update(dt) {
      let moving = false;
      for (const l of leaves) {
        const u = l.userData;
        if (u.open === u.target) continue;
        u.open += (u.target - u.open) * Math.min(1, dt * 5);
        if (Math.abs(u.target - u.open) < 0.0005) u.open = u.target;
        moving = true;
        apply(l);
      }
      return moving;
    },
    dispose() { group.traverse((o) => o.geometry && o.geometry.dispose()); },
  };
}
