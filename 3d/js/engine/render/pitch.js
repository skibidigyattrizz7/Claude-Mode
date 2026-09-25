// Pitch surface, markings, goals with deformable nets, corner flags.
import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH, GOAL } from '../core/constants.js';
import { pitchTexture, apronTexture, netTexture, PITCH_MARGIN } from './textures.js';

const HL = PITCH.HL, HW = PITCH.HW;

export function buildPitch(scene, q, maxAniso, track) {
  const group = new THREE.Group();
  scene.add(group);
  const tex = track(pitchTexture(q.pitchTex, Math.min(maxAniso, q.aniso)));
  const { LW, LH } = tex.userData;
  const geo = track(new THREE.PlaneGeometry(LW, LH, 1, 1));
  geo.rotateX(-Math.PI / 2);
  const mat = track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
  const pitch = new THREE.Mesh(geo, mat);
  pitch.receiveShadow = q.shadows;
  group.add(pitch);
  // apron (surround) below — large, darker, tiled
  const aTex = track(apronTexture());
  aTex.repeat.set(60, 60);
  const aGeo = track(new THREE.PlaneGeometry(360, 360));
  aGeo.rotateX(-Math.PI / 2);
  const aMat = track(new THREE.MeshStandardMaterial({ map: aTex, roughness: 0.95, color: 0xb8c4b0 }));
  const apron = new THREE.Mesh(aGeo, aMat);
  apron.position.y = -0.03;
  apron.receiveShadow = q.shadows;
  group.add(apron);
  // perimeter track strip (dark) outside textured grass margin
  const trackMat = track(new THREE.MeshStandardMaterial({ color: 0x3b4a3a, roughness: 1 }));
  return { group, pitch, apron, LW, LH, trackMat };
}

// ---------------------------------------------------------------- goals
class Net {
  constructor(sgn, mat, track) {
    this.sgn = sgn;
    const D = GOAL.DEPTH, H = GOAL.H, W = GOAL.HW;
    const x0 = sgn * HL;
    // parametric faces: (u,v) -> point, outward normal, fix weight
    const Dt = D * 0.55; // roof depth (top back bar), bottom depth = D
    const faces = [
      // back: sloping from roof back edge down to ground back edge
      { nu: 18, nv: 10, fn: (u, v) => [x0 + sgn * lerp(D, Dt, v), H * v, lerp(-W, W, u)], n: [sgn, 0.2, 0], len: [2 * W, Math.hypot(H, D - Dt)] },
      // roof
      { nu: 18, nv: 5, fn: (u, v) => [x0 + sgn * Dt * v, H, lerp(-W, W, u)], n: [0, 1, 0], len: [2 * W, Dt] },
      // left side (z = -W)
      { nu: 6, nv: 8, fn: (u, v) => [x0 + sgn * lerp(0, lerp(D, Dt, v), u), H * v, -W], n: [0, 0, -1], len: [D, H] },
      // right side (z = +W)
      { nu: 6, nv: 8, fn: (u, v) => [x0 + sgn * lerp(0, lerp(D, Dt, v), u), H * v, W], n: [0, 0, 1], len: [D, H] },
    ];
    const pos = [], uv = [], idx = [], nrm = [], fix = [];
    for (const f of faces) {
      const base = pos.length / 3;
      for (let j = 0; j <= f.nv; j++) {
        for (let i = 0; i <= f.nu; i++) {
          const u = i / f.nu, v = j / f.nv;
          const p = f.fn(u, v);
          pos.push(p[0], p[1], p[2]);
          uv.push(u * f.len[0] / 0.16, v * f.len[1] / 0.16);
          const nl = Math.hypot(...f.n);
          nrm.push(f.n[0] / nl, f.n[1] / nl, f.n[2] / nl);
          fix.push(Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * (f === faces[0] ? 1 : 1))));
        }
      }
      for (let j = 0; j < f.nv; j++) for (let i = 0; i < f.nu; i++) {
        const a = base + j * (f.nu + 1) + i, b = a + 1, c = a + f.nu + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    track(g);
    this.geo = g;
    this.base = new Float32Array(pos);
    this.nrm = new Float32Array(nrm);
    this.fix = new Float32Array(fix);
    // static sag
    const pa = g.attributes.position.array;
    for (let i = 0; i < this.fix.length; i++) {
      const s = this.fix[i] * 0.08;
      this.base[i * 3] += this.nrm[i * 3] * s * 0.6;
      this.base[i * 3 + 1] -= s * 0.5;
      this.base[i * 3 + 2] += this.nrm[i * 3 + 2] * s * 0.6;
    }
    pa.set(this.base);
    g.attributes.position.needsUpdate = true;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.renderOrder = 2;
    this.imps = [];
    this.active = false;
  }
  hit(x, y, z, s, t) {
    this.imps.push({ x, y, z, s: Math.min(1.6, 0.35 + s / 20), t0: t });
    if (this.imps.length > 6) this.imps.shift();
  }
  update(t, ball) {
    const inGoal = ball && Math.abs(ball[0]) > HL && Math.sign(ball[0]) === this.sgn && Math.abs(ball[2]) < GOAL.HW + 0.3 && ball[1] < GOAL.H + 0.3 && Math.abs(ball[0]) < HL + GOAL.DEPTH + 0.5;
    this.imps = this.imps.filter((m) => t - m.t0 < 2.2);
    if (!this.imps.length && !inGoal) {
      if (this.active) { this.geo.attributes.position.array.set(this.base); this.geo.attributes.position.needsUpdate = true; this.active = false; }
      return;
    }
    this.active = true;
    const pa = this.geo.attributes.position.array, b = this.base, n = this.nrm, fx = this.fix;
    const cnt = fx.length;
    for (let i = 0; i < cnt; i++) {
      const px = b[i * 3], py = b[i * 3 + 1], pz = b[i * 3 + 2];
      let d = 0;
      for (const m of this.imps) {
        const dt = t - m.t0;
        const r2 = (px - m.x) ** 2 + (py - m.y) ** 2 + (pz - m.z) ** 2;
        const spread = 0.35 + dt * 1.6;
        const env = Math.exp(-dt * 2.6);
        // bulge + travelling ripple
        d += m.s * env * (0.55 * Math.exp(-r2 / (spread * spread * 0.5)) + 0.18 * Math.sin(Math.sqrt(r2) * 7 - dt * 22) * Math.exp(-r2 / (spread * spread * 2)));
      }
      if (inGoal) {
        const r2 = (px - ball[0]) ** 2 + (py - ball[1]) ** 2 + (pz - ball[2]) ** 2;
        // how far the ball pushes beyond the resting surface
        d += 0.25 * Math.exp(-r2 / 0.18);
      }
      d *= fx[i];
      pa[i * 3] = px + n[i * 3] * d;
      pa[i * 3 + 1] = py + n[i * 3 + 1] * d;
      pa[i * 3 + 2] = pz + n[i * 3 + 2] * d;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
const lerp = (a, b, t) => a + (b - a) * t;

export function buildGoals(scene, q, track) {
  const group = new THREE.Group();
  scene.add(group);
  const R = GOAL.POST_R, H = GOAL.H, W = GOAL.HW, D = GOAL.DEPTH, Dt = D * 0.55;
  const postMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }));
  const barMat = track(new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.5, metalness: 0.3 }));
  const nt = track(netTexture());
  const netMat = track(new THREE.MeshStandardMaterial({ map: nt, color: 0xf4f4f4, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9, alphaTest: 0.02 }));
  const postGeo = track(new THREE.CylinderGeometry(R, R, H + R, 16));
  const barGeo = track(new THREE.CylinderGeometry(R, R, 2 * (W + R) + 2 * R, 16));
  const thin = (len) => track(new THREE.CylinderGeometry(0.025, 0.025, len, 8));
  const nets = [];
  for (const sgn of [-1, 1]) {
    const gx = sgn * (HL - 0.06);
    const g = new THREE.Group();
    for (const zs of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat); p.position.set(gx, (H + R) / 2, zs * (W + R)); p.castShadow = q.shadows; g.add(p);
    }
    const bar = new THREE.Mesh(barGeo, postMat); bar.rotation.x = Math.PI / 2; bar.position.set(gx, H + R, 0); bar.castShadow = q.shadows; g.add(bar);
    // stanchions / frame: back bottom bar, side ground bars, back uprights, roof side bars, top back bar
    const xb = sgn * (HL + D), xt = sgn * (HL + Dt);
    const addBar = (a, b) => {
      const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const len = v.length();
      const m = new THREE.Mesh(thin(len), barMat);
      m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
      g.add(m);
    };
    for (const zs of [-1, 1]) {
      addBar([gx, 0.02, zs * W], [xb, 0.02, zs * W]);
      addBar([xb, 0.02, zs * W], [xt, H, zs * W]);
      addBar([gx, H, zs * W], [xt, H, zs * W]);
    }
    addBar([xb, 0.02, -W], [xb, 0.02, W]);
    addBar([xt, H, -W], [xt, H, W]);
    const net = new Net(sgn, netMat, track);
    g.add(net.mesh);
    nets.push(net);
    group.add(g);
  }
  return { group, nets };
}

// ---------------------------------------------------------------- corner flags
export function buildFlags(scene, q, track) {
  const group = new THREE.Group();
  scene.add(group);
  const poleGeo = track(new THREE.CylinderGeometry(0.018, 0.018, 1.55, 8)); poleGeo.translate(0, 0.775, 0);
  const poleMat = track(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  const flagGeo = track(new THREE.PlaneGeometry(0.42, 0.32, 4, 1)); flagGeo.translate(0.21, 0, 0);
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffd400'; g.fillRect(0, 0, 64, 48);
  g.fillStyle = '#e8141c'; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) & 1) g.fillRect(i * 16, j * 16, 16, 16);
  const ft = track(new THREE.CanvasTexture(cv)); ft.colorSpace = THREE.SRGBColorSpace;
  const flagMat = track(new THREE.MeshStandardMaterial({ map: ft, side: THREE.DoubleSide, roughness: 0.8 }));
  const flags = [];
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(xs * HL, 0, zs * HW);
    pole.castShadow = q.shadows;
    const pivot = new THREE.Group(); pivot.position.y = 1.38; pole.add(pivot);
    const f = new THREE.Mesh(flagGeo, flagMat); pivot.add(f);
    group.add(pole);
    flags.push({ pivot, geo: flagGeo, ph: Math.random() * 6 });
  }
  return {
    group,
    update(t) {
      for (const f of flags) {
        f.pivot.rotation.y = 0.9 + Math.sin(t * 1.3 + f.ph) * 0.35 + Math.sin(t * 3.7 + f.ph) * 0.12;
        f.pivot.rotation.z = Math.sin(t * 2.1 + f.ph) * 0.05;
      }
    },
  };
}

export { PITCH_MARGIN };
