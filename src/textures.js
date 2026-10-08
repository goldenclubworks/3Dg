// Prozedurale Texturen (keine externen Dateien nötig, alles 1k–2k, kachelbar)
import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// kachelbares Value-Noise + fBm
function makeNoise(seed, period) {
  const r = rng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const sm = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => g[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = sm(x - xi), ty = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function fbm(noises, x, y, base, octaves) {
  let v = 0, amp = 0.5, f = base, norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * noises[o](x * f, y * f);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return v / norm;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(tex, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Feuerverzinkter Stahl: Zinkblumen (Spangle) + feine Streifen in Walzrichtung */
export function galvanizedTextures(size = 1024) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const r = rng(11);
  const px = ctx.createImageData(size, size);
  const n = [1, 2, 3, 4].map((i) => makeNoise(100 + i, 16 * 2 ** (i - 1)));
  const cellN = 38;
  const pts = Array.from({ length: cellN * cellN }, (_, i) => {
    const cx = (i % cellN), cy = Math.floor(i / cellN);
    return [(cx + r()) / cellN, (cy + r()) / cellN, 0.78 + r() * 0.22];
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Voronoi für Zinkkristalle
      const cx = Math.floor(u * cellN), cy = Math.floor(v * cellN);
      let best = 9, tone = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = (cx + dx + cellN) % cellN, gy = (cy + dy + cellN) % cellN;
        const p = pts[gy * cellN + gx];
        let px_ = p[0] + (cx + dx - gx) / cellN, py_ = p[1] + (cy + dy - gy) / cellN;
        const d = (u - px_) ** 2 + (v - py_) ** 2;
        if (d < best) { best = d; tone = p[2]; }
      }
      const f = fbm(n, x / size, y / size, 16, 4);
      const streak = makeStreak(x, size);
      let l = 0.70 * tone + 0.16 * f + streak * 0.05;
      l = Math.min(1, l);
      const i = (y * size + x) * 4;
      px.data[i] = 170 * l + 18; px.data[i + 1] = 178 * l + 18; px.data[i + 2] = 184 * l + 20; px.data[i + 3] = 255;
    }
  }
  ctx.putImageData(px, 0, 0);
  return finish(new THREE.CanvasTexture(c), { repeat: [2, 2] });
}
function makeStreak(x, size) {
  return Math.sin(x * 0.9) * 0.5 + Math.sin(x * 0.173) * 0.5;
}

/** Hohlkammerplatte (Polycarbonat): Farbe+Alpha (Stege) und Normal-Map. 1 Periode = 40 mm (4 Kammern à 10 mm) */
export function flutedSheetTextures() {
  const W = 1024, H = 8;
  const col = canvas(W, H), cx = col.getContext('2d');
  const nrm = canvas(W, H), nx = nrm.getContext('2d');
  const cimg = cx.createImageData(W, H), nimg = nx.createImageData(W, H);
  const chambers = 4;
  for (let x = 0; x < W; x++) {
    const t = (x / W) * chambers;
    const f = t - Math.floor(t);            // 0..1 innerhalb einer Kammer
    const wall = Math.exp(-Math.pow((f < 0.5 ? f : 1 - f) / 0.035, 2)); // Steg bei f=0/1
    const lens = Math.sin(f * Math.PI);     // leichte Wölbung der Oberfläche
    const a = 0.34 + 0.50 * wall + 0.10 * (1 - lens);
    const shade = 232 - 70 * wall;
    // Normal: Steigung der Oberfläche in u
    const slope = Math.cos(f * Math.PI) * 0.35 + (f < 0.04 || f > 0.96 ? 0 : 0);
    const nxv = Math.max(-1, Math.min(1, slope));
    const nz = Math.sqrt(1 - nxv * nxv);
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      cimg.data[i] = shade; cimg.data[i + 1] = Math.min(255, shade + 6); cimg.data[i + 2] = Math.min(255, shade + 10);
      cimg.data[i + 3] = Math.round(a * 255);
      nimg.data[i] = Math.round((nxv * 0.5 + 0.5) * 255); nimg.data[i + 1] = 128;
      nimg.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255); nimg.data[i + 3] = 255;
    }
  }
  cx.putImageData(cimg, 0, 0); nx.putImageData(nimg, 0, 0);
  const map = finish(new THREE.CanvasTexture(col), { aniso: 16 });
  const normalMap = finish(new THREE.CanvasTexture(nrm), { srgb: false, aniso: 16 });
  return { map, normalMap };
}

/** Rasen, 2k, kachelbar */
export function grassTextures(size = 2048) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = [1, 2, 3, 4, 5].map((i) => makeNoise(300 + i, 8 * 2 ** (i - 1)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const f = fbm(n, x / size, y / size, 8, 5);
    const g = fbm(n, x / size + 0.25, y / size + 0.5, 8, 3);
    const i = (y * size + x) * 4;
    const l = 0.55 + f * 0.55;
    img.data[i] = (70 + 44 * g) * l; img.data[i + 1] = (96 + 44 * f) * l; img.data[i + 2] = (44 + 22 * g) * l; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const r = rng(7);
  const blade = (x, y) => {
    const len = 6 + r() * 14, ang = -Math.PI / 2 + (r() - 0.5) * 1.1;
    const h = 70 + r() * 40, s = 40 + r() * 30, l = 14 + r() * 26;
    ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${0.35 + r() * 0.4})`;
    ctx.lineWidth = 0.8 + r() * 1.4;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + (r() - 0.5) * 4, y + Math.sin(ang) * len * 0.5, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  };
  for (let i = 0; i < 90000; i++) {
    const x = r() * size, y = r() * size;
    blade(x, y);
    if (x < 24) blade(x + size, y);
    if (y < 24) blade(x, y + size);
    if (x > size - 24) blade(x - size, y);
    if (y > size - 24) blade(x, y - size);
  }
  return finish(new THREE.CanvasTexture(c), { repeat: [90, 90], aniso: 16 });
}

/** Erdboden im Gewächshaus (Farbe + Bump) */
export function soilTextures(size = 1024) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = [1, 2, 3, 4, 5].map((i) => makeNoise(500 + i, 8 * 2 ** (i - 1)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const f = fbm(n, x / size, y / size, 8, 5);
    const i = (y * size + x) * 4;
    const l = 0.4 + f * 0.9;
    img.data[i] = 70 * l; img.data[i + 1] = 52 * l; img.data[i + 2] = 40 * l; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const r = rng(21);
  for (let i = 0; i < 700; i++) {
    const x = r() * size, y = r() * size, rr = 0.8 + r() * 3.2, l = 22 + r() * 22;
    ctx.fillStyle = `hsla(${25 + r() * 15},${8 + r() * 10}%,${l}%,0.9)`;
    ctx.beginPath(); ctx.ellipse(x, y, rr, rr * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2); ctx.fill();
  }
  const map = finish(new THREE.CanvasTexture(c), { repeat: [3, 4] });
  const bump = finish(new THREE.CanvasTexture(c), { srgb: false, repeat: [3, 4] });
  return { map, bump };
}

/** Feine Verwitterungsmaske für Gummi/Kunststoffteile */
export function noiseNormal(size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = [1, 2, 3].map((i) => makeNoise(900 + i, 8 * 2 ** (i - 1)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fbm(n, x / size, y / size, 8, 3) * 255;
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(c), { srgb: false, repeat: [4, 4] });
}
