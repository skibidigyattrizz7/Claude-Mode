// Procedural stadium: renderer/scene/lights, striped pitch with markings, goals with deformable
// nets, stands with an instanced animated crowd, ad boards, floodlights, sky and fog.
import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH, GOAL, BOX, SIX, PEN_SPOT, CIRCLE_R } from '../core/constants.js';

const HL = PITCH.HL, HW = PITCH.HW;

export function createRenderer(container, stadium) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = stadium === 'night' ? 1.05 : 1.0;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.5, 1200);
  camera.position.set(0, 22, 60);
  camera.lookAt(0, 0, 0);
  return { renderer, scene, camera };
}

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = opts.aniso || 4;
  return t;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- geometry helpers
function mergeGeoms(list) {
  // list of {geo, matrix?, color?} (non-indexed or indexed BufferGeometry) -> merged BufferGeometry
  const pos = [], nor = [], col = [], idx = [];
  let off = 0;
  const hasColor = list.some((l) => l.color);
  const c = new THREE.Color();
  for (const { geo, matrix, color } of list) {
    const g = geo.index ? geo : geo;
    const p = g.attributes.position, n = g.attributes.normal;
    const m = matrix || new THREE.Matrix4();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    if (color) c.set(color);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      if (hasColor) col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (hasColor) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------- pitch
function buildPitch(root, night) {
  const grassTex = canvasTex(2048, 1024, (g, w, h) => {
    const stripes = 22;
    // outer run-off area occupies the margin; pitch is 105x68 mapped into the texture of 121x80m
    const W = 121, H = 80;
    const sx = w / W, sy = h / H;
    g.fillStyle = night ? '#2f7a33' : '#3f8f3a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < stripes; i++) {
      const x0 = (W / 2 - HL + (i * PITCH.L) / stripes) * sx;
      g.fillStyle = i % 2 ? (night ? '#327f36' : '#46993f') : (night ? '#2b7130' : '#3a8636');
      g.fillRect(x0, (H / 2 - HW - 3) * sy, (PITCH.L / stripes) * sx + 1, (PITCH.W + 6) * sy);
    }
    // subtle cross-mow
    for (let j = 0; j < 12; j++) {
      g.fillStyle = j % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)';
      g.fillRect(0, (H / 2 - HW + (j * PITCH.W) / 12) * sy, w, (PITCH.W / 12) * sy);
    }
    // grain noise
    const r = rand(7);
    for (let i = 0; i < 60000; i++) {
      const a = r() * 0.08;
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,160,${a * 0.7})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    // worn goalmouths / centre
    const wear = (cx, cy, rx, ry) => {
      const gr = g.createRadialGradient(cx * sx, cy * sy, 0, cx * sx, cy * sy, rx * sx);
      gr.addColorStop(0, 'rgba(120,110,60,0.22)'); gr.addColorStop(1, 'rgba(120,110,60,0)');
      g.fillStyle = gr; g.save(); g.translate(cx * sx, cy * sy); g.scale(1, ry / rx); g.translate(-cx * sx, -cy * sy);
      g.beginPath(); g.arc(cx * sx, cy * sy, rx * sx, 0, Math.PI * 2); g.fill(); g.restore();
    };
    wear(W / 2 - HL + 3, H / 2, 6, 4); wear(W / 2 + HL - 3, H / 2, 6, 4); wear(W / 2, H / 2, 5, 5);
  }, { aniso: 8 });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(121, 80), new THREE.MeshLambertMaterial({ map: grassTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  root.add(grass);
  // surrounding track / concrete
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 200), new THREE.MeshLambertMaterial({ color: night ? 0x1d3b22 : 0x2d5530 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true;
  root.add(apron);
  root.add(buildLines());
}

function buildLines() {
  const W = 0.12, Y = 0.012;
  const pos = [];
  const quad = (ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * W / 2, nz = (dx / l) * W / 2;
    pos.push(ax + nx, Y, az + nz, bx + nx, Y, bz + nz, bx - nx, Y, bz - nz);
    pos.push(ax + nx, Y, az + nz, bx - nx, Y, bz - nz, ax - nx, Y, az - nz);
  };
  const line = (ax, az, bx, bz) => quad(ax, az, bx, bz);
  const arc = (cx, cz, r, a0, a1, seg = 48) => {
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
      const r0 = r - W / 2, r1 = r + W / 2;
      const p = (rr, t) => [cx + Math.cos(t) * rr, Y, cz + Math.sin(t) * rr];
      pos.push(...p(r0, t0), ...p(r1, t1), ...p(r1, t0));
      pos.push(...p(r0, t0), ...p(r0, t1), ...p(r1, t1));
    }
  };
  const disc = (cx, cz, r) => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      pos.push(cx, Y, cz, cx + Math.cos(a1) * r, Y, cz + Math.sin(a1) * r, cx + Math.cos(a0) * r, Y, cz + Math.sin(a0) * r);
    }
  };
  const e = W / 2;
  line(-HL - e, -HW, HL + e, -HW); line(-HL - e, HW, HL + e, HW);
  line(-HL, -HW, -HL, HW); line(HL, -HW, HL, HW);
  line(0, -HW, 0, HW);
  arc(0, 0, CIRCLE_R, 0, Math.PI * 2, 96);
  disc(0, 0, 0.18);
  for (const s of [-1, 1]) {
    const gx = s * HL;
    const bx = gx - s * BOX.DEPTH, sx = gx - s * SIX.DEPTH;
    line(gx, -BOX.HW, bx, -BOX.HW); line(gx, BOX.HW, bx, BOX.HW); line(bx, -BOX.HW - e, bx, BOX.HW + e);
    line(gx, -SIX.HW, sx, -SIX.HW); line(gx, SIX.HW, sx, SIX.HW); line(sx, -SIX.HW - e, sx, SIX.HW + e);
    const px = gx - s * PEN_SPOT;
    disc(px, 0, 0.15);
    const a = Math.acos((BOX.DEPTH - PEN_SPOT) / CIRCLE_R);
    const base = s > 0 ? Math.PI : 0;
    arc(px, 0, CIRCLE_R, base - a, base + a, 32);
    for (const zs of [-1, 1]) {
      const a0 = s > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : (zs > 0 ? -Math.PI / 2 : 0);
      arc(gx, zs * HW, 1, a0 + (s > 0 ? 0 : 0), a0 + Math.PI / 2, 10);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xf4f4ee, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  // triangles above are wound either way; render both sides
  m.material.side = THREE.DoubleSide;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- goals + nets
class GoalNet {
  constructor(root, side) {
    this.side = side;
    const s = side;
    const R = GOAL.POST_R;
    const post = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
    const frame = new THREE.MeshStandardMaterial({ color: 0xbcbcbc, roughness: 0.6 });
    const gx = s * (PITCH.HL + R);
    const g = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(R, R, GOAL.H + R, 12);
    for (const zs of [-1, 1]) {
      const m = new THREE.Mesh(postGeo, post);
      m.position.set(gx, (GOAL.H + R) / 2, zs * (GOAL.HW + R));
      m.castShadow = true; g.add(m);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2 * (GOAL.HW + 2 * R), 12), post);
    bar.rotation.x = Math.PI / 2; bar.position.set(gx, GOAL.H + R, 0); bar.castShadow = true; g.add(bar);
    // rear frame
    const D = GOAL.DEPTH, bx = s * (PITCH.HL + D);
    const thin = (a, b) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, dir.length(), 6), frame);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(m);
    };
    const W = GOAL.HW + 2 * R, H = GOAL.H + R;
    for (const zs of [-1, 1]) {
      thin(new THREE.Vector3(gx, H, zs * W), new THREE.Vector3(bx, H, zs * W));
      thin(new THREE.Vector3(bx, H, zs * W), new THREE.Vector3(bx, 0, zs * W));
      thin(new THREE.Vector3(gx, 0.02, zs * W), new THREE.Vector3(bx, 0.02, zs * W));
    }
    thin(new THREE.Vector3(bx, H, -W), new THREE.Vector3(bx, H, W));
    thin(new THREE.Vector3(bx, 0.02, -W), new THREE.Vector3(bx, 0.02, W));
    root.add(g);
    // net: grid vertices on 4 faces (back, two sides, roof); LineSegments
    const verts = [], normals = [], segs = [];
    const step = 0.2;
    const addFace = (nu, nv, fn, normal) => {
      const base = verts.length / 3;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const p = fn(i / nu, j / nv);
        verts.push(p.x, p.y, p.z); normals.push(normal.x, normal.y, normal.z);
      }
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const k = base + j * (nu + 1) + i;
        if (i < nu) segs.push(k, k + 1);
        if (j < nv) segs.push(k, k + nu + 1);
      }
    };
    const nz = Math.round((2 * W) / step), ny = Math.round(H / step), nx = Math.round(D / step);
    addFace(nz, ny, (u, v) => ({ x: bx, y: v * H, z: -W + u * 2 * W }), { x: s, y: 0, z: 0 });
    for (const zs of [-1, 1]) addFace(nx, ny, (u, v) => ({ x: gx + s * u * (D - R), y: v * H, z: zs * W }), { x: 0, y: 0, z: zs });
    addFace(nx, nz, (u, v) => ({ x: gx + s * u * (D - R), y: H, z: -W + v * 2 * W }), { x: 0, y: 1, z: 0 });
    this.rest = new Float32Array(verts);
    this.norm = new Float32Array(normals);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.Float32BufferAttribute(verts, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setIndex(segs);
    this.geo = geo;
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf0f0f0, transparent: true, opacity: 0.55 }));
    root.add(this.lines);
    this.hits = [];
    this.dirty = false;
  }
  hit(x, y, z, s) {
    this.hits.push({ x, y, z, a: Math.min(0.6, 0.08 + s * 0.025), t: 0 });
    if (this.hits.length > 4) this.hits.shift();
  }
  update(dt, ball) {
    // ball pressing into the net
    let press = null;
    if (ball) {
      const u = this.side * ball.x - PITCH.HL;
      if (u > 0.4 && u < GOAL.DEPTH + 0.3 && Math.abs(ball.z) < GOAL.HW + 0.4 && ball.y < GOAL.H + 0.3) press = ball;
    }
    if (!this.hits.length && !press) {
      if (this.dirty) { this.geo.attributes.position.array.set(this.rest); this.geo.attributes.position.needsUpdate = true; this.dirty = false; }
      return;
    }
    for (const h of this.hits) h.t += dt;
    this.hits = this.hits.filter((h) => h.t < 1.6);
    const arr = this.geo.attributes.position.array, rest = this.rest, n = this.norm;
    for (let i = 0; i < arr.length; i += 3) {
      const x = rest[i], y = rest[i + 1], z = rest[i + 2];
      let d = 0;
      for (const h of this.hits) {
        const r2 = (x - h.x) ** 2 + (y - h.y) ** 2 + (z - h.z) ** 2;
        if (r2 > 4) continue;
        d += h.a * Math.exp(-r2 / 0.35) * Math.exp(-h.t * 3.2) * Math.cos(h.t * 16 - Math.sqrt(r2) * 5);
      }
      if (press) {
        const r2 = (x - press.x) ** 2 + (y - press.y) ** 2 + (z - press.z) ** 2;
        if (r2 < 0.5) d += 0.12 * Math.exp(-r2 / 0.08);
      }
      arr[i] = x + n[i] * d; arr[i + 1] = y + n[i + 1] * d; arr[i + 2] = z + n[i + 2] * d;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.dirty = true;
  }
}

// ---------------------------------------------------------------- stands & crowd
function personGeometry() {
  const torso = new THREE.BoxGeometry(0.46, 0.62, 0.3);
  const head = new THREE.BoxGeometry(0.22, 0.24, 0.22);
  const m1 = new THREE.Matrix4().makeTranslation(0, 0.31, 0);
  const m2 = new THREE.Matrix4().makeTranslation(0, 0.75, 0);
  return mergeGeoms([{ geo: torso, matrix: m1 }, { geo: head, matrix: m2 }]);
}

function buildStands(root, home, away, night) {
  const stepGeos = [];
  const seats = []; // {x,y,z,rotY,team}
  const concrete = night ? '#4a4d55' : '#8c8f96';
  const concrete2 = night ? '#3c3f46' : '#74777e';
  const rows = 22, rowH = 0.62, rowD = 0.95;
  const box = new THREE.BoxGeometry(1, 1, 1);
  // stand descriptor: centre offset along the normal, length, facing direction
  const stands = [
    { axis: 'x', sign: 1, len: 118, start: HW + 7.5, team: 0 },
    { axis: 'x', sign: -1, len: 118, start: HW + 7.5, team: -1 },
    { axis: 'z', sign: 1, len: 82, start: HL + 8.5, team: 1 },
    { axis: 'z', sign: -1, len: 82, start: HL + 8.5, team: 0 },
  ];
  for (const st of stands) {
    for (let r = 0; r < rows; r++) {
      const depth = st.start + r * rowD + rowD / 2;
      const y = 1.2 + r * rowH;
      const m = new THREE.Matrix4();
      if (st.axis === 'x') m.compose(new THREE.Vector3(0, y / 2, st.sign * depth), new THREE.Quaternion(), new THREE.Vector3(st.len, y, rowD));
      else m.compose(new THREE.Vector3(st.sign * depth, y / 2, 0), new THREE.Quaternion(), new THREE.Vector3(rowD, y, st.len));
      stepGeos.push({ geo: box, matrix: m, color: r % 2 ? concrete : concrete2 });
      const spacing = 0.72;
      const n = Math.floor(st.len / spacing);
      for (let i = 0; i < n; i++) {
        const u = -st.len / 2 + (i + 0.5) * spacing;
        if (Math.abs(u) < 3 && r < 4 && st.axis === 'x' && st.sign > 0) continue; // tunnel
        if (st.axis === 'x') seats.push({ x: u, y, z: st.sign * depth, rotY: st.sign > 0 ? Math.PI : 0, team: st.team, u, r });
        else seats.push({ x: st.sign * depth, y, z: u, rotY: st.sign > 0 ? -Math.PI / 2 : Math.PI / 2, team: st.team, u, r });
      }
    }
    // back wall + roof
    const back = st.start + rows * rowD;
    const topY = 1.2 + rows * rowH;
    const wall = new THREE.Matrix4(), roof = new THREE.Matrix4();
    if (st.axis === 'x') {
      wall.compose(new THREE.Vector3(0, (topY + 6) / 2, st.sign * (back + 0.5)), new THREE.Quaternion(), new THREE.Vector3(st.len + 2, topY + 6, 1));
      roof.compose(new THREE.Vector3(0, topY + 6, st.sign * (back - 9)), new THREE.Quaternion().setFromEuler(new THREE.Euler(st.sign * 0.12, 0, 0)), new THREE.Vector3(st.len + 4, 0.5, 21));
    } else {
      wall.compose(new THREE.Vector3(st.sign * (back + 0.5), (topY + 6) / 2, 0), new THREE.Quaternion(), new THREE.Vector3(1, topY + 6, st.len + 2));
      roof.compose(new THREE.Vector3(st.sign * (back - 9), topY + 6, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -st.sign * 0.12)), new THREE.Vector3(21, 0.5, st.len + 4));
    }
    stepGeos.push({ geo: box, matrix: wall, color: night ? '#2a2c33' : '#5b5f69' });
    stepGeos.push({ geo: box, matrix: roof, color: night ? '#1b1d22' : '#c9ccd2' });
  }
  // corner fill blocks
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(sx * (HL + 20), 8, sz * (HW + 19)), new THREE.Quaternion(), new THREE.Vector3(24, 16, 24));
    stepGeos.push({ geo: box, matrix: m, color: night ? '#26282e' : '#6d717a' });
  }
  const standGeo = mergeGeoms(stepGeos);
  const standMesh = new THREE.Mesh(standGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  standMesh.receiveShadow = true;
  root.add(standMesh);

  // crowd
  const geo = personGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0.1 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uExcite = uniforms.uExcite;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;\nuniform float uExcite;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = aPhase * 6.2831;
        float jump = max(0.0, sin(uTime * (5.0 + aPhase * 3.0) + ph));
        transformed.y += jump * uExcite * 0.45 + sin(uTime * 1.3 + ph) * 0.03;
        transformed.x += sin(uTime * 2.0 + ph) * 0.04 * (0.3 + uExcite);`);
  };
  const count = seats.length;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const phase = new Float32Array(count);
  const r = rand(99);
  const hc = [new THREE.Color(home.kit.primary), new THREE.Color(home.kit.secondary)];
  const ac = [new THREE.Color(away.kit.primary), new THREE.Color(away.kit.secondary)];
  const misc = ['#d9d9d9', '#2b2b2b', '#6b7a8f', '#a33', '#e0c090', '#355', '#fff'].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const col = new THREE.Color();
  let k = 0;
  for (const seat of seats) {
    const empty = r() < 0.06;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seat.rotY + (r() - 0.5) * 0.4);
    const sc = empty ? 0.0001 : 0.9 + r() * 0.25;
    s.set(sc, sc * (0.9 + r() * 0.2), sc);
    p.set(seat.x + (r() - 0.5) * 0.15, seat.y, seat.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(k, m);
    let team = seat.team;
    if (team < 0) team = seat.u < 0 ? 0 : 1;
    const pal = team === 0 ? hc : ac;
    const x = r();
    col.copy(x < 0.62 ? pal[0] : x < 0.8 ? pal[1] : misc[Math.floor(r() * misc.length)]);
    col.offsetHSL(0, 0, (r() - 0.5) * 0.12);
    if (night) col.multiplyScalar(0.75);
    mesh.setColorAt(k, col);
    phase[k] = r();
    k++;
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  return { uniforms, mesh };
}

// ---------------------------------------------------------------- ad boards
function buildBoards(root, home, away) {
  const brands = ['PITCHSIDE', 'VOLTA COLA', 'NOVA AIR', 'KESTREL BANK', 'ORBIT TYRES', 'LUMEN TV', 'FJORD WATER', 'ARCADIA', 'HALCYON', 'ZEPHYR SPORTS'];
  const tex = canvasTex(4096, 128, (g, w, h) => {
    const n = brands.length;
    const cw = w / n;
    const cols = [['#0b2a5c', '#ffffff'], ['#c8102e', '#ffffff'], ['#101010', '#35e0a0'], ['#f5c400', '#101010'], ['#0f5132', '#ffffff'], ['#2b0f5c', '#ffd24d'], ['#e8f4ff', '#004c97'], ['#111', '#ff6a00'], ['#6d0f24', '#fff'], ['#003b46', '#8ff0ff']];
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i][0]; g.fillRect(i * cw, 0, cw, h);
      g.fillStyle = cols[i][1];
      g.font = 'bold 74px Arial, Helvetica, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(brands[i], i * cw + cw / 2, h / 2 + 4);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(i * cw, 0, 3, h);
    }
  }, { repeat: true, aniso: 8 });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const back = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const boards = [];
  const mk = (len, x, z, rotY, repeat) => {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(repeat, 1);
    const m2 = mat.clone(); m2.map = t;
    const geo = new THREE.BoxGeometry(len, 0.9, 0.12);
    const mesh = new THREE.Mesh(geo, [back, back, back, back, m2, back]);
    mesh.position.set(x, 0.45, z); mesh.rotation.y = rotY;
    mesh.castShadow = true;
    root.add(mesh);
    boards.push(t);
  };
  mk(110, 0, -(HW + 4.2), 0, 3);
  mk(110, 0, HW + 4.2, Math.PI, 3);
  for (const s of [-1, 1]) {
    mk(26, s * (HL + 4.5), -(GOAL.HW + 14), -s * Math.PI / 2, 0.7);
    mk(26, s * (HL + 4.5), GOAL.HW + 14, -s * Math.PI / 2, 0.7);
  }
  return boards;
}

// ---------------------------------------------------------------- floodlights / details
function buildFloodlights(root, night) {
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
  const panelMat = new THREE.MeshBasicMaterial({ color: night ? 0xfffbe8 : 0xdadfe6 });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x33363c });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 42, 8), poleMat);
    pole.position.y = 21; g.add(pole);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.6), frameMat);
    frame.position.y = 43; g.add(frame);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), panelMat);
      lamp.position.set(-3.3 + i * 2.2, 42 + j * 2.2, 0.31);
      g.add(lamp);
    }
    g.position.set(sx * (HL + 26), 0, sz * (HW + 30));
    g.lookAt(0, 30, 0);
    root.add(g);
    if (night) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff4d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(26, 26, 1);
      glow.position.set(sx * (HL + 26), 43, sz * (HW + 30));
      root.add(glow);
    }
  }
}

let _glow = null;
function glowTexture() {
  if (_glow) return _glow;
  _glow = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,245,210,0.6)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  return _glow;
}

function buildCornerFlags(root) {
  const pole = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const flag = new THREE.MeshLambertMaterial({ color: 0xff9f1a, side: THREE.DoubleSide });
  const flags = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), pole);
    p.position.set(sx * HL, 0.75, sz * HW); p.castShadow = true; root.add(p);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), flag);
    f.position.set(sx * HL + 0.2, 1.33, sz * HW); root.add(f);
    flags.push(f);
  }
  return flags;
}

function buildDugouts(root, night) {
  const mat = new THREE.MeshLambertMaterial({ color: night ? 0x2a3140 : 0x3d4a63 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc4e8, transparent: true, opacity: 0.35 });
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 2), mat); base.position.y = 0.25; g.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(9, 2, 0.15), mat); back.position.set(0, 1.2, 0.95); g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 2.2), glass); roof.position.set(0, 2.2, 0); g.add(roof);
    g.position.set(s * 12, 0, HW + 5.8);
    root.add(g);
  }
}

function skyTexture(night) {
  return canvasTex(8, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    if (night) { gr.addColorStop(0, '#02040b'); gr.addColorStop(0.55, '#0b1630'); gr.addColorStop(1, '#1d2a44'); }
    else { gr.addColorStop(0, '#2f6fbf'); gr.addColorStop(0.55, '#8fbde8'); gr.addColorStop(1, '#dfeaf2'); }
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- public
export function buildStadium(scene, { home, away, stadium = 'day' }) {
  const night = stadium === 'night';
  const root = new THREE.Group();
  scene.add(root);
  scene.background = skyTexture(night);
  scene.fog = new THREE.Fog(night ? 0x0b1224 : 0xbcd3e6, 160, 520);
  // lights
  const hemi = new THREE.HemisphereLight(night ? 0x7b8cc8 : 0xdfefff, night ? 0x1b2a1b : 0x4a6a3a, night ? 0.9 : 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(night ? 0xfff2dd : 0xfff4e0, night ? 2.0 : 2.4);
  if (night) sun.position.set(-20, 70, 30); else sun.position.set(-60, 80, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -64; sc.right = 64; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun); scene.add(sun.target);
  if (night) {
    const fill = new THREE.DirectionalLight(0xe8eeff, 0.9);
    fill.position.set(40, 60, -35);
    scene.add(fill);
  }
  buildPitch(root, night);
  const nets = [new GoalNet(root, 1), new GoalNet(root, -1)];
  const crowd = buildStands(root, home, away, night);
  const boards = buildBoards(root, home, away);
  buildFloodlights(root, night);
  const flags = buildCornerFlags(root);
  buildDugouts(root, night);
  let t = 0, excite = 0.1;
  return {
    root,
    hitNet(x, y, z, s) { nets[x > 0 ? 0 : 1].hit(x, y, z, s); },
    update(dt, ballPos, excitement) {
      t += dt;
      excite += (excitement - excite) * Math.min(1, dt * 1.5);
      crowd.uniforms.uTime.value = t;
      crowd.uniforms.uExcite.value = excite;
      for (const b of boards) b.offset.x = (t * 0.02) % 1;
      for (const n of nets) n.update(dt, ballPos);
      for (let i = 0; i < flags.length; i++) flags[i].rotation.y = Math.sin(t * 3 + i) * 0.3;
    },
  };
}

export { canvasTex };
