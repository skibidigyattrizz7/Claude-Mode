// Procedural CanvasTexture helpers for the renderer (pitch, ball, net, kits, ads, labels).
import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH, BOX, SIX, PEN_SPOT, CIRCLE_R, GOAL } from '../core/constants.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTex(canvas, { srgb = true, repeat = false, aniso = 1, mips = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}

// Deterministic small hash noise
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const PITCH_MARGIN = 9; // metres of textured grass beyond the lines

// Big pitch texture: mowed stripes + grass noise + all markings.
// Canvas covers x: -HL-M..HL+M (width), z: -HW-M..HW+M (height)
export function pitchTexture(size, aniso) {
  const M = PITCH_MARGIN;
  const LW = PITCH.L + 2 * M, LH = PITCH.W + 2 * M;
  const W = size, H = Math.round(size * LH / LW);
  const ppm = W / LW;
  const cv = makeCanvas(W, H);
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const stripeW = PITCH.L / 18; // 18 stripes between goal lines
  // base colours (sRGB)
  const light = [86, 150, 58], dark = [70, 128, 46];
  for (let py = 0; py < H; py++) {
    const zm = py / ppm - LH / 2;
    for (let px = 0; px < W; px++) {
      const xm = px / ppm - LW / 2;
      let s = Math.floor((xm + PITCH.HL) / stripeW);
      // subtle cross-mow checker
      const cz = Math.floor((zm + PITCH.HW) / (PITCH.W / 10));
      let shade = (s & 1) ? 1 : 0;
      const chk = ((s + cz) & 1) ? 0.035 : -0.035;
      const base = shade ? light : dark;
      const n1 = valueNoise(xm * 0.35, zm * 0.35) - 0.5; // large patches
      const n2 = valueNoise(xm * 3.1, zm * 3.1) - 0.5; // mid
      const n3 = hash2(px, py) - 0.5; // fine blades
      const k = 1 + n1 * 0.12 + n2 * 0.07 + n3 * 0.1 + chk;
      // worn goalmouth areas
      const gx = PITCH.HL - Math.abs(xm), gz = Math.abs(zm);
      let wear = 0;
      if (gx > -1 && gx < 7 && gz < 7) wear = Math.max(0, 1 - Math.hypot(Math.max(0, gx - 1.5) / 5.5, gz / 7)) * 0.35;
      const o = (py * W + px) * 4;
      d[o] = Math.min(255, base[0] * k + wear * 40);
      d[o + 1] = Math.min(255, base[1] * k * (1 - wear * 0.3));
      d[o + 2] = Math.min(255, base[2] * k + wear * 10);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // markings
  const X = (xm) => (xm + LW / 2) * ppm;
  const Z = (zm) => (zm + LH / 2) * ppm;
  g.strokeStyle = 'rgba(245,248,240,0.93)';
  g.fillStyle = 'rgba(245,248,240,0.93)';
  g.lineWidth = 0.12 * ppm;
  g.lineJoin = 'miter';
  const HL = PITCH.HL, HW = PITCH.HW;
  const rect = (x0, z0, x1, z1) => { g.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0)); };
  // outer lines drawn inward (line width belongs to the pitch)
  const e = 0.06;
  rect(-HL + e, -HW + e, HL - e, HW - e);
  g.beginPath(); g.moveTo(X(0), Z(-HW + e)); g.lineTo(X(0), Z(HW - e)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), CIRCLE_R * ppm, 0, Math.PI * 2); g.stroke();
  const spot = (x, z, r) => { g.beginPath(); g.arc(X(x), Z(z), r * ppm, 0, Math.PI * 2); g.fill(); };
  spot(0, 0, 0.16);
  for (const sgn of [-1, 1]) {
    const gl = sgn * (HL - e);
    // penalty box
    rect(Math.min(gl, gl - sgn * BOX.DEPTH), -BOX.HW, Math.max(gl, gl - sgn * BOX.DEPTH), BOX.HW);
    rect(Math.min(gl, gl - sgn * SIX.DEPTH), -SIX.HW, Math.max(gl, gl - sgn * SIX.DEPTH), SIX.HW);
    const px = sgn * (HL - PEN_SPOT);
    spot(px, 0, 0.14);
    // D arc: part of circle r=9.15 around penalty spot outside the box
    const bx = sgn * (HL - BOX.DEPTH);
    const a = Math.acos((Math.abs(bx - px)) / CIRCLE_R);
    g.beginPath();
    if (sgn > 0) g.arc(X(px), Z(0), CIRCLE_R * ppm, Math.PI - a, Math.PI + a);
    else g.arc(X(px), Z(0), CIRCLE_R * ppm, -a, a);
    g.stroke();
    // corner arcs r=1
    for (const zs of [-1, 1]) {
      g.beginPath();
      const cx = X(sgn * HL), cz = Z(zs * HW);
      const a0 = sgn > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : (zs > 0 ? -Math.PI / 2 : 0);
      g.arc(cx, cz, 1 * ppm, a0, a0 + Math.PI / 2);
      g.stroke();
      // 9.15 m corner marks off the pitch
      g.beginPath();
      g.moveTo(X(sgn * (HL - 9.15)), Z(zs * (HW + 0.3))); g.lineTo(X(sgn * (HL - 9.15)), Z(zs * (HW + 0.8)));
      g.moveTo(X(sgn * (HL + 0.3)), Z(zs * (HW - 9.15))); g.lineTo(X(sgn * (HL + 0.8)), Z(zs * (HW - 9.15)));
      g.stroke();
    }
  }
  const tex = canvasTex(cv, { aniso });
  tex.userData = { LW, LH };
  return tex;
}

// Tiled rough grass / apron texture for the surround
export function apronTexture() {
  const S = 256, cv = makeCanvas(S, S), g = cv.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = hash2(x, y) * 0.18 + valueNoise(x / 16, y / 16) * 0.15;
    const o = (y * S + x) * 4;
    d[o] = 58 * (0.9 + n); d[o + 1] = 104 * (0.9 + n); d[o + 2] = 44 * (0.9 + n); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(cv, { repeat: true, aniso: 4 });
}

// Classic truncated-icosahedron football pattern (equirectangular).
export function ballTexture() {
  const W = 512, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  const t = (1 + Math.sqrt(5)) / 2;
  const iv = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const fc = faces.map(([a, b, c]) => { const x = iv[a][0] + iv[b][0] + iv[c][0], y = iv[a][1] + iv[b][1] + iv[c][1], z = iv[a][2] + iv[b][2] + iv[c][2]; const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
  const centres = iv.map((v) => [...v, 1]).concat(fc.map((v) => [...v, 0]));
  for (let py = 0; py < H; py++) {
    const lat = (0.5 - (py + 0.5) / H) * Math.PI;
    for (let px = 0; px < W; px++) {
      const lon = ((px + 0.5) / W) * Math.PI * 2;
      // match THREE.SphereGeometry mapping
      const x = -Math.cos(lon) * Math.cos(lat), y = Math.sin(lat), z = Math.sin(lon) * Math.cos(lat);
      let b1 = -2, b2 = -2, k1 = 0;
      for (const c of centres) {
        const dd = c[0] * x + c[1] * y + c[2] * z;
        if (dd > b1) { b2 = b1; b1 = dd; k1 = c[3]; } else if (dd > b2) b2 = dd;
      }
      const seam = b1 - b2 < 0.012;
      let col = k1 ? 22 : 246;
      if (seam) col = k1 ? 40 : 150;
      const o = (py * W + px) * 4;
      d[o] = col; d[o + 1] = col; d[o + 2] = col + (k1 ? 0 : 2); d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTex(cv, { aniso: 4 });
}

export function netTexture() {
  const S = 64, cv = makeCanvas(S, S), g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  // diamond-ish square mesh
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(S, S); g.moveTo(S, 0); g.lineTo(0, S);
  g.stroke();
  const t = canvasTex(cv, { repeat: true, aniso: 4 });
  return t;
}

export function radialTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)', S = 128) {
  const cv = makeCanvas(S, S), g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return canvasTex(cv, {});
}

export function ringTexture(color = '#ffffff', S = 256) {
  const cv = makeCanvas(S, S), g = cv.getContext('2d');
  g.strokeStyle = color; g.lineWidth = S * 0.07;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2); g.stroke();
  g.lineWidth = S * 0.025; g.globalAlpha = 0.6;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.28, 0, Math.PI * 2); g.stroke();
  return canvasTex(cv, {});
}

// Shirt (torso) texture: kit colours + back number/name, small front number & crest.
// THREE.CylinderGeometry: u=0 -> +z (front), u=0.25 -> +x (player's left), u=0.5 -> back.
export function shirtTexture(kit, number, name, opts = {}) {
  const W = 512, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = kit.primary; g.fillRect(0, 0, W, H);
  const pattern = opts.pattern || 0;
  if (pattern === 1) { // vertical stripes
    g.fillStyle = kit.secondary;
    for (let i = 0; i < 16; i += 2) g.fillRect(i * W / 16, 0, W / 16, H);
  } else if (pattern === 2) { // chest band
    g.fillStyle = kit.secondary; g.fillRect(0, H * 0.3, W, H * 0.12);
  }
  // side panels
  g.fillStyle = kit.secondary; g.globalAlpha = 0.85;
  g.fillRect(W * 0.235, 0, W * 0.03, H); g.fillRect(W * 0.735, 0, W * 0.03, H);
  g.globalAlpha = 1;
  // collar trim
  g.fillStyle = kit.secondary; g.fillRect(0, 0, W, H * 0.045);
  // subtle fabric shading
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const numStr = String(number ?? '');
  const outline = contrastOutline(kit.number, kit.primary);
  // back number
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${H * 0.5}px "Arial Black", Impact, Arial, sans-serif`;
  g.lineWidth = 6; g.strokeStyle = outline; g.lineJoin = 'round';
  g.strokeText(numStr, W * 0.5, H * 0.6);
  g.fillStyle = kit.number; g.fillText(numStr, W * 0.5, H * 0.6);
  // name above number
  const surname = String(name || '').split(/[\s.]+/).filter(Boolean).pop() || '';
  g.font = `bold ${H * 0.11}px Arial, sans-serif`;
  const nm = surname.toUpperCase();
  const tw = g.measureText(nm).width;
  const maxW = W * 0.2;
  g.save(); g.translate(W * 0.5, H * 0.22); if (tw > maxW) g.scale(maxW / tw, 1);
  g.lineWidth = 3; g.strokeText(nm, 0, 0); g.fillText(nm, 0, 0); g.restore();
  // front: small number on right chest (player's right = -x => u ~ 0.92), crest on left chest (u ~ 0.08)
  g.font = `bold ${H * 0.16}px "Arial Black", Arial, sans-serif`;
  g.lineWidth = 3; g.strokeText(numStr, W * 0.925, H * 0.32); g.fillText(numStr, W * 0.925, H * 0.32);
  g.fillStyle = kit.secondary;
  g.beginPath(); g.moveTo(W * 0.06, H * 0.22); g.lineTo(W * 0.1, H * 0.22); g.lineTo(W * 0.1, H * 0.34); g.lineTo(W * 0.08, H * 0.4); g.lineTo(W * 0.06, H * 0.34); g.closePath(); g.fill();
  const t = canvasTex(cv, { aniso: 4 });
  return t;
}

function lum(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
function contrastOutline(fg, bg) {
  const a = lum(fg), b = lum(bg);
  if (Math.abs(a - b) > 0.35) return 'rgba(0,0,0,0.25)';
  return a > 0.5 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)';
}
export function luminance(hex) { return lum(hex); }

export function labelTexture(text, { color = '#fff', bg = 'rgba(10,14,24,0.72)', accent = '#3aa0ff', w = 512, h = 128 } = {}) {
  const cv = makeCanvas(w, h), g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.font = `bold ${h * 0.46}px Arial, sans-serif`;
  const tw = Math.min(w - 20, g.measureText(text).width + h * 0.6);
  const x0 = (w - tw) / 2;
  g.fillStyle = bg;
  roundRect(g, x0, h * 0.14, tw, h * 0.66, h * 0.16); g.fill();
  g.fillStyle = accent; g.fillRect(x0 + h * 0.1, h * 0.72, tw - h * 0.2, h * 0.06);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h * 0.46, tw - h * 0.3);
  return canvasTex(cv, { mips: false });
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

export const SPONSORS = [
  { t: 'PITCHSIDE 3D', bg: '#0b1d3a', fg: '#ffffff', ac: '#35c3ff' },
  { t: 'VOLTRA ENERGY', bg: '#ffcc00', fg: '#111111', ac: '#111111' },
  { t: 'NORDIX BANK', bg: '#0a5c36', fg: '#ffffff', ac: '#8fffc1' },
  { t: 'AEROFIZZ', bg: '#e21b3c', fg: '#ffffff', ac: '#ffd1d9' },
  { t: 'KITEWAY AIR', bg: '#1b2a8f', fg: '#ffffff', ac: '#ff9f1a' },
  { t: 'SOLACE MOBILE', bg: '#6a1b9a', fg: '#ffffff', ac: '#f3c1ff' },
  { t: 'ORBITA WATCHES', bg: '#111111', fg: '#e8c872', ac: '#e8c872' },
  { t: 'GREENLINE', bg: '#8bc34a', fg: '#0d2b00', ac: '#0d2b00' },
  { t: 'PIXELFORGE', bg: '#ff6f00', fg: '#ffffff', ac: '#222' },
  { t: 'TERRA TYRES', bg: '#222831', fg: '#ffd369', ac: '#ffd369' },
];

// LED board strip: sequence of sponsor panels; tiled horizontally.
export function adStripTexture(offset = 0, panelW = 512, H = 64, count = 8) {
  const cv = makeCanvas(panelW * count, H), g = cv.getContext('2d');
  for (let i = 0; i < count; i++) {
    const s = SPONSORS[(i + offset) % SPONSORS.length];
    const x = i * panelW;
    g.fillStyle = s.bg; g.fillRect(x, 0, panelW, H);
    g.fillStyle = s.ac; g.fillRect(x, H - 5, panelW, 5);
    g.fillStyle = s.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic bold ${H * 0.58}px Arial, sans-serif`;
    g.fillText(s.t, x + panelW / 2, H * 0.48, panelW - 30);
    // LED pixel grid hint
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let yy = 0; yy < H; yy += 4) g.fillRect(x, yy, panelW, 1);
  }
  const t = canvasTex(cv, { repeat: true, aniso: 8 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function skyTexture(night) {
  const W = 16, H = 512, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H);
  if (night) {
    gr.addColorStop(0, '#02040b'); gr.addColorStop(0.45, '#070d1f'); gr.addColorStop(0.5, '#1b2440'); gr.addColorStop(0.53, '#34405e'); gr.addColorStop(1, '#0b0f18');
  } else {
    gr.addColorStop(0, '#2f6fbf'); gr.addColorStop(0.35, '#6aa6e0'); gr.addColorStop(0.5, '#cfe3f3'); gr.addColorStop(0.53, '#e8eef2'); gr.addColorStop(1, '#8a9aa6');
  }
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return canvasTex(cv, {});
}

// Stand concrete / seats texture (tiled) — rows of seats
export function seatTexture(c1, c2) {
  const W = 64, H = 64, cv = makeCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = c1; g.fillRect(0, 0, W, H);
  g.fillStyle = c2; g.fillRect(0, H * 0.55, W, H * 0.45);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H * 0.5, W, 3);
  for (let x = 0; x < W; x += 8) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 1, H * 0.55); }
  return canvasTex(cv, { repeat: true, aniso: 4 });
}

export const _consts = { PITCH, GOAL };
