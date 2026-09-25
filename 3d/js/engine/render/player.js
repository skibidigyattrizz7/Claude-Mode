// Low-poly procedural footballer: hierarchical rig built from primitives + procedural animation.
// Model space: faces +z, player's left = +x, y up. Units: metres.
import * as THREE from '../../../vendor/three.module.min.js';
import { ANIM } from '../core/constants.js';
import { shirtTexture } from './textures.js';

// ---------------------------------------------------------------- dimensions
const THIGH = 0.42, SHIN = 0.42, FOOT_H = 0.075, HIP_DY = -0.06, HIP_DX = 0.092;
const STAND_Y = -HIP_DY + THIGH + SHIN + FOOT_H; // pelvis height when standing straight (0.975)
const TORSO_H = 0.47;

// ---------------------------------------------------------------- pose layout
const P = {
  bodyY: 0, pitch: 1, roll: 2, yaw: 3, gl: 4, lift: 5,
  spX: 6, spY: 7, spZ: 8, nkX: 9, nkY: 10,
  lsX: 11, lsY: 12, lsZ: 13, leX: 14, rsX: 15, rsY: 16, rsZ: 17, reX: 18,
  lhX: 19, lhY: 20, lhZ: 21, lkX: 22, laX: 23, rhX: 24, rhY: 25, rhZ: 26, rkX: 27, raX: 28,
};
const NP = 29;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// ---------------------------------------------------------------- shared geometry
let GEO = null;
let GEO_REFS = 0;
function mergeColored(parts) {
  // parts: [{geo, color:[r,g,b]}] -> single non-indexed BufferGeometry with color attribute
  let n = 0;
  const gs = parts.map((p) => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; n += g.attributes.position.count; return { g, c: p.color }; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const { g, c } of gs) {
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = c[0]; col[(o + i) * 3 + 1] = c[1]; col[(o + i) * 3 + 2] = c[2]; }
    o += cnt;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const p of parts) p.geo.dispose();
  return out;
}

function buildGeometry() {
  const g = {};
  g.pelvis = new THREE.CylinderGeometry(0.158, 0.172, 0.22, 14, 1);
  g.pelvis.translate(0, -0.03, 0);
  g.torso = new THREE.CylinderGeometry(0.205, 0.158, TORSO_H, 16, 4);
  g.torso.translate(0, TORSO_H / 2, 0);
  // taper chest (pectoral bulge) a bit: push front vertices forward in upper-middle band
  {
    const p = g.torso.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / TORSO_H, z = p.getZ(i);
      const k = Math.sin(Math.PI * clamp((y - 0.35) / 0.6, 0, 1));
      if (z > 0) p.setZ(i, z * (1 + 0.12 * k));
      p.setX(i, p.getX(i) * (1 + 0.04 * k));
    }
    g.torso.computeVertexNormals();
  }
  g.shoulderCap = new THREE.SphereGeometry(0.078, 10, 8);
  g.neck = new THREE.CylinderGeometry(0.052, 0.06, 0.13, 10);
  g.neck.translate(0, 0.045, 0);
  // head with face features (vertex colours: white skin areas get skin tint from material colour)
  {
    const skull = new THREE.SphereGeometry(0.104, 16, 12); skull.scale(0.9, 1.1, 1.0); skull.translate(0, 0.1, 0);
    const jaw = new THREE.SphereGeometry(0.075, 10, 8); jaw.scale(1.0, 0.8, 1.0); jaw.translate(0, 0.035, 0.03);
    const nose = new THREE.ConeGeometry(0.018, 0.045, 6); nose.rotateX(Math.PI / 2 + 0.25); nose.translate(0, 0.09, 0.105);
    const earL = new THREE.SphereGeometry(0.024, 6, 5); earL.scale(0.5, 1, 0.8); earL.translate(0.093, 0.1, 0);
    const earR = earL.clone(); earR.translate(-0.186, 0, 0);
    const eyeL = new THREE.SphereGeometry(0.014, 6, 5); eyeL.translate(0.036, 0.118, 0.088);
    const eyeR = eyeL.clone(); eyeR.translate(-0.072, 0, 0);
    const browL = new THREE.BoxGeometry(0.038, 0.009, 0.01); browL.translate(0.036, 0.142, 0.094);
    const browR = browL.clone(); browR.translate(-0.072, 0, 0);
    const mouth = new THREE.BoxGeometry(0.035, 0.007, 0.01); mouth.translate(0, 0.045, 0.1);
    const W = [1, 1, 1], E = [0.06, 0.05, 0.05], B = [0.2, 0.14, 0.1], M = [0.55, 0.32, 0.3];
    g.head = mergeColored([
      { geo: skull, color: W }, { geo: jaw, color: W }, { geo: nose, color: [0.95, 0.9, 0.88] }, { geo: earL, color: [0.92, 0.88, 0.86] }, { geo: earR, color: [0.92, 0.88, 0.86] },
      { geo: eyeL, color: E }, { geo: eyeR, color: E }, { geo: browL, color: B }, { geo: browR, color: B }, { geo: mouth, color: M },
    ]);
  }
  // hair styles
  g.hair = [];
  { const h = new THREE.SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42); h.scale(0.92, 1.05, 1.02); h.translate(0, 0.1, -0.008); g.hair.push(h); } // short crop
  { const h = new THREE.SphereGeometry(0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62); h.scale(0.95, 1.08, 1.08); h.rotateX(-0.35); h.translate(0, 0.1, -0.012); g.hair.push(h); } // longer
  { const h = new THREE.SphereGeometry(0.14, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55); h.scale(1, 0.95, 1.0); h.translate(0, 0.11, -0.02); g.hair.push(h); } // afro
  { const h = new THREE.SphereGeometry(0.108, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.3); h.scale(0.92, 1.1, 1.0); h.translate(0, 0.106, -0.004); g.hair.push(h); } // buzz
  { const h = new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45); h.scale(0.9, 1.05, 1.05); h.translate(0, 0.108, -0.01);
    const bun = new THREE.SphereGeometry(0.045, 8, 6); bun.translate(0, 0.19, -0.08);
    g.hair.push(mergeColored([{ geo: h, color: [1, 1, 1] }, { geo: bun, color: [1, 1, 1] }])); } // top bun
  g.sleeve = new THREE.CylinderGeometry(0.07, 0.064, 0.19, 10); g.sleeve.translate(0, -0.07, 0);
  g.upperArm = new THREE.CapsuleGeometry(0.046, 0.22, 4, 8); g.upperArm.translate(0, -0.15, 0);
  g.foreArm = new THREE.CapsuleGeometry(0.04, 0.2, 4, 8); g.foreArm.translate(0, -0.13, 0);
  g.gkSleeve = new THREE.CylinderGeometry(0.05, 0.043, 0.24, 8); g.gkSleeve.translate(0, -0.12, 0);
  g.hand = new THREE.SphereGeometry(0.045, 8, 6); g.hand.scale(0.75, 1.15, 0.95); g.hand.translate(0, -0.29, 0.005);
  g.glove = new THREE.SphereGeometry(0.058, 8, 6); g.glove.scale(0.8, 1.2, 1.0); g.glove.translate(0, -0.3, 0.005);
  g.thighShort = new THREE.CylinderGeometry(0.098, 0.088, 0.2, 12); g.thighShort.translate(0, -0.075, 0);
  g.thigh = new THREE.CapsuleGeometry(0.068, 0.3, 4, 10); g.thigh.translate(0, -0.23, 0);
  g.knee = new THREE.SphereGeometry(0.056, 8, 6);
  g.sock = new THREE.CylinderGeometry(0.058, 0.042, 0.36, 10); g.sock.translate(0, -0.22, 0);
  // calf bulge
  {
    const p = g.sock.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = -p.getY(i) / 0.42; const k = Math.sin(Math.PI * clamp((y - 0.05) / 0.6, 0, 1));
      if (p.getZ(i) < 0) p.setZ(i, p.getZ(i) * (1 + 0.35 * k));
    }
    g.sock.computeVertexNormals();
  }
  g.shinSkin = new THREE.CylinderGeometry(0.052, 0.055, 0.06, 8); g.shinSkin.translate(0, -0.03, 0);
  {
    const b = new THREE.CapsuleGeometry(0.046, 0.17, 4, 8); b.rotateX(Math.PI / 2); b.scale(1, 0.85, 1); b.translate(0, -0.035, 0.055);
    g.boot = b;
    const s = new THREE.BoxGeometry(0.085, 0.012, 0.26); s.translate(0, -0.071, 0.055);
    g.sole = s;
  }
  // flat ground shadow blob
  g.blob = new THREE.PlaneGeometry(1, 1); g.blob.rotateX(-Math.PI / 2);
  return g;
}

export function acquireGeometry() {
  if (!GEO) GEO = buildGeometry();
  GEO_REFS++;
  return GEO;
}
export function releaseGeometry() {
  GEO_REFS--;
  if (GEO_REFS <= 0 && GEO) {
    for (const k in GEO) { const v = GEO[k]; if (Array.isArray(v)) v.forEach((x) => x.dispose()); else v.dispose(); }
    GEO = null; GEO_REFS = 0;
  }
}

// ---------------------------------------------------------------- materials
const SKINS = ['#f1c7a5', '#e0ac85', '#c68863', '#a86b45', '#8a5634', '#6b3f24', '#4e2c19', '#f5d0b5'];
const HAIRS = ['#1b1210', '#2b1c14', '#4a3222', '#6b4a2e', '#b58a4c', '#d9b77a', '#141414', '#7a2e1a'];
const BOOTS = ['#111111', '#f2f2f2', '#ff3d6e', '#1ec8ff', '#ffd400', '#7cff4f', '#ff7a00', '#2a2a2a'];

export class KitMaterials {
  constructor(kit) {
    const std = (c, r = 0.78) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
    this.shirt = std(kit.primary);
    this.shorts = std(kit.shorts || kit.primary);
    this.socks = std(kit.socks || kit.primary);
    this.trim = std(kit.secondary || kit.primary);
    this.glove = std('#e8e8e8', 0.6);
    this.list = [this.shirt, this.shorts, this.socks, this.trim, this.glove];
  }
  dispose() { this.list.forEach((m) => m.dispose()); }
}

export class SharedMaterials {
  constructor() {
    this.skins = SKINS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, vertexColors: false }));
    this.heads = SKINS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, vertexColors: true }));
    this.hairs = HAIRS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    this.boots = BOOTS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.1 }));
    this.sole = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.8 });
    this.blob = null;
  }
  dispose() { [...this.skins, ...this.heads, ...this.hairs, ...this.boots, this.sole].forEach((m) => m.dispose()); }
}

function hashStr(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------- Player
export class PlayerRig {
  constructor(geo, shared, kitMats, opts = {}) {
    this.geo = geo; this.shared = shared; this.kit = kitMats;
    this.isGK = !!opts.isGK;
    this.shadows = opts.shadows !== false;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.body.rotation.order = 'YXZ';
    this.root.add(this.body);
    const sh = (m) => { m.castShadow = this.shadows; return m; };
    const mesh = (g, m, parent, cast = true) => { const x = new THREE.Mesh(g, m); if (cast) sh(x); parent.add(x); return x; };
    this.torsoMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 });
    // pelvis
    this.pelvis = new THREE.Group(); this.body.add(this.pelvis);
    this.mPelvis = mesh(geo.pelvis, kitMats.shorts, this.pelvis);
    this.mPelvis.scale.set(1, 1, 0.72);
    // spine
    this.spine = new THREE.Group(); this.spine.position.y = 0.06; this.pelvis.add(this.spine);
    this.mTorso = mesh(geo.torso, this.torsoMat, this.spine);
    this.mTorso.scale.set(1, 1, 0.64);
    this.neck = new THREE.Group(); this.neck.position.set(0, TORSO_H - 0.01, 0); this.spine.add(this.neck);
    this.mNeck = mesh(geo.neck, shared.skins[0], this.neck, false);
    this.head = new THREE.Group(); this.head.position.y = 0.08; this.neck.add(this.head);
    this.mHead = mesh(geo.head, shared.heads[0], this.head);
    this.mHair = mesh(geo.hair[0], shared.hairs[0], this.head, false);
    // arms
    this.arms = [];
    for (const s of [1, -1]) {
      const sh0 = new THREE.Group(); sh0.position.set(0.19 * s, TORSO_H - 0.06, -0.005); sh0.rotation.order = 'ZXY'; this.spine.add(sh0);
      const cap = mesh(geo.shoulderCap, kitMats.shirt, sh0, false); cap.position.y = -0.01;
      const sleeve = mesh(geo.sleeve, kitMats.shirt, sh0);
      const upper = mesh(geo.upperArm, shared.skins[0], sh0, false);
      const elbow = new THREE.Group(); elbow.position.y = -0.29; sh0.add(elbow);
      const fore = mesh(geo.foreArm, shared.skins[0], elbow, false);
      const gks = this.isGK ? mesh(geo.gkSleeve, kitMats.shirt, elbow, false) : null;
      const hand = mesh(this.isGK ? geo.glove : geo.hand, this.isGK ? kitMats.glove : shared.skins[0], elbow, false);
      this.arms.push({ sh: sh0, elbow, upper, fore, hand, gks, sleeve, cap });
    }
    // legs
    this.legs = [];
    for (const s of [1, -1]) {
      const hip = new THREE.Group(); hip.position.set(HIP_DX * s, HIP_DY, 0); hip.rotation.order = 'ZXY'; this.pelvis.add(hip);
      mesh(geo.thighShort, kitMats.shorts, hip);
      const thigh = mesh(geo.thigh, shared.skins[0], hip, false);
      const knee = new THREE.Group(); knee.position.y = -THIGH; hip.add(knee);
      const kneeCap = mesh(geo.knee, shared.skins[0], knee, false);
      const skin = mesh(geo.shinSkin, shared.skins[0], knee, false);
      const sock = mesh(geo.sock, kitMats.socks, knee);
      const ankle = new THREE.Group(); ankle.position.y = -SHIN; knee.add(ankle);
      const boot = mesh(geo.boot, shared.boots[0], ankle);
      const sole = mesh(geo.sole, shared.sole, ankle, false);
      this.legs.push({ hip, knee, ankle, thigh, kneeCap, skin, sock, boot, sole });
    }
    // state
    this.pose = new Float32Array(NP);
    this.target = new Float32Array(NP);
    this.from = new Float32Array(NP);
    this.blendT = 1; this.blendDur = 0.12;
    this.curAnim = -1;
    this.cyc = Math.random() * 6.28;
    this.face = 0; this.faceInit = false;
    this.px = 0; this.pz = 0; this.vx = 0; this.vz = 0; this.spd = 0;
    this.turn = 0;
    this.seed = 0;
    this.leftFoot = false;
    this.scale = 1;
    this.visible = true;
    this.celebAlt = 0;
    this.headYaw = 0;
    this._setStand();
  }

  _setStand() {
    const p = this.pose; p.fill(0); p[P.bodyY] = STAND_Y; p[P.gl] = 1;
    p[P.lsZ] = 0.1; p[P.rsZ] = -0.1;
  }

  // appearance: skin/hair/boots from player identity; shirt texture from kit + number/name
  setIdentity(pd, kit, idxSeed) {
    const id = pd ? (pd.id ?? pd.name ?? idxSeed) : idxSeed;
    const h = hashStr(id);
    this.seed = h;
    const sh = this.shared;
    const skin = h % SKINS.length;
    const hairI = (h >>> 5) % HAIRS.length;
    const hairStyle = (h >>> 9) % 6; // 5 = bald
    const bootI = (h >>> 13) % BOOTS.length;
    this.leftFoot = ((h >>> 17) % 5) === 0;
    this.scale = 0.95 + ((h >>> 19) % 100) / 100 * 0.09;
    this.root.scale.setScalar(this.scale);
    const skinM = sh.skins[skin];
    this.mNeck.material = skinM;
    this.mHead.material = sh.heads[skin];
    if (hairStyle >= 5) this.mHair.visible = false;
    else { this.mHair.visible = true; this.mHair.geometry = this.geo.hair[hairStyle]; this.mHair.material = sh.hairs[hairI]; }
    for (const a of this.arms) { a.upper.material = skinM; a.fore.material = skinM; if (!this.isGK) a.hand.material = skinM; }
    for (const l of this.legs) { l.thigh.material = skinM; l.kneeCap.material = skinM; l.skin.material = skinM; l.boot.material = sh.boots[bootI]; }
    // shirt
    const key = `${kit.primary}|${kit.secondary}|${kit.number}|${pd ? pd.number : ''}|${pd ? pd.name : ''}`;
    if (key !== this._shirtKey) {
      this._shirtKey = key;
      if (this.torsoMat.map) this.torsoMat.map.dispose();
      this.torsoMat.map = shirtTexture(kit, pd ? pd.number : '', pd ? pd.name : '', { pattern: kit.pattern || 0 });
      this.torsoMat.needsUpdate = true;
    }
  }

  setKit(kitMats) {
    this.kit = kitMats;
    this.mPelvis.material = kitMats.shorts;
    for (const a of this.arms) { a.cap.material = kitMats.shirt; a.sleeve.material = kitMats.shirt; if (a.gks) a.gks.material = kitMats.shirt; if (this.isGK) a.hand.material = kitMats.glove; }
    for (const l of this.legs) { l.sock.material = kitMats.socks; l.hip.children[0].material = kitMats.shorts; }
  }

  setShadows(on) {
    this.root.traverse((o) => { if (o.isMesh && o.castShadow !== undefined && o.userData.noShadow !== true) o.castShadow = on && o._castOk !== false; });
  }

  dispose() {
    if (this.torsoMat.map) this.torsoMat.map.dispose();
    this.torsoMat.dispose();
  }

  // ------------------------------------------------------------ per-frame update
  // x,z world; face = sim heading (radians; dir = (cos,sin)); anim/animT/animP; speed; ctx: {dt, t, ballX, ballY, ballZ, scorer}
  update(x, z, face, anim, animT, animP, speed, ctx) {
    const dt = ctx.dt;
    // velocity estimate from positions (for backpedal / strafe)
    if (!this.faceInit || Math.hypot(x - this.px, z - this.pz) > 3) {
      this.faceInit = true; this.face = face; this.px = x; this.pz = z; this.vx = 0; this.vz = 0;
    }
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * 10);
      this.vx += ((x - this.px) / dt - this.vx) * k;
      this.vz += ((z - this.pz) / dt - this.vz) * k;
    }
    this.px = x; this.pz = z;
    // smoothed heading
    const dF = wrap(face - this.face);
    const kf = 1 - Math.exp(-dt * 16);
    const step = dF * kf;
    this.face = wrap(this.face + step);
    this.turn = lerp(this.turn, dt > 0 ? step / dt : 0, 1 - Math.exp(-dt * 6));
    this.spd = lerp(this.spd, speed, 1 - Math.exp(-dt * 8));

    this.root.position.set(x, 0, z);
    this.root.rotation.y = Math.PI / 2 - this.face;

    // locomotion cycle
    const s = this.spd;
    const fx = Math.cos(this.face), fz = Math.sin(this.face);
    const vmag = Math.hypot(this.vx, this.vz);
    let fwd = 1, side = 0;
    if (vmag > 0.5) { fwd = (this.vx * fx + this.vz * fz) / vmag; side = (this.vx * -fz + this.vz * fx) / vmag; }
    const freq = 0.72 + 0.17 * s;
    this.cyc += dt * freq * Math.PI * 2 * (fwd < -0.35 ? -1 : 1) * (s > 0.15 ? 1 : 0.0);
    // head tracking the ball
    const bx = ctx.ballX - x, bz = ctx.ballZ - z;
    const angB = Math.atan2(bz, bx);
    const rel = clamp(-wrap(angB - this.face), -1.2, 1.2); // positive = to player's left (+x model)
    this.headYaw = lerp(this.headYaw, rel, 1 - Math.exp(-dt * 5));

    // target pose
    const T = this.target;
    this._locomotion(T, s, fwd, side, ctx.t);
    if (anim !== ANIM.RUN) this._oneShot(T, anim, animT, animP, s, ctx);

    // crossfade on anim change
    if (anim !== this.curAnim) {
      this.from.set(this.pose);
      const low = this.pose[P.bodyY] < 0.7 && this.pose[P.gl] < 0.5;
      this.blendDur = low ? 0.42 : anim === ANIM.DIVE || anim === ANIM.SLIDE || anim === ANIM.FALL ? 0.08 : 0.12;
      this.blendT = 0;
      this.curAnim = anim;
    }
    this.blendT += dt;
    const w = this.blendT >= this.blendDur ? 1 : smooth(this.blendT / this.blendDur);
    const Pz = this.pose;
    if (w >= 1) Pz.set(T);
    else for (let i = 0; i < NP; i++) Pz[i] = this.from[i] + (T[i] - this.from[i]) * w;
    this._apply();
  }

  _locomotion(T, s, fwd, side, t) {
    T.fill(0);
    const run = sstep(0.25, 1.4, s);
    const sprint = sstep(4.5, 8.2, s);
    const ph = this.cyc;
    const back = fwd < -0.35 ? 1 : 0;
    const lat = Math.abs(side) > 0.75 && !back ? Math.abs(side) : 0;
    const ampH = lerp(0.3, 0.78, clamp((s - 1) / 7, 0, 1)) * run * (back ? 0.6 : 1) * (1 - lat * 0.55);
    const kSw = lerp(0.55, 1.95, clamp((s - 1) / 7.5, 0, 1)) * (back ? 0.6 : 1);
    const legs = [[P.lhX, P.lkX, P.laX, P.lhZ, ph, 1], [P.rhX, P.rkX, P.raX, P.rhZ, ph + Math.PI, -1]];
    for (const [hX, kX, aX, hZ, f, sgn] of legs) {
      const sn = Math.sin(f), cs = Math.cos(f);
      T[hX] = -ampH * sn - 0.06 * run - 0.08 * sprint;
      T[kX] = 0.06 + run * (kSw * Math.pow(Math.max(0, Math.cos(f + 0.55)), 1.3) + 0.28 * Math.max(0, -cs) * (0.5 + sprint));
      T[aX] = run * (-0.25 * Math.max(0, Math.cos(f + 0.9)) + 0.18 * Math.max(0, Math.sin(f)));
      T[hZ] = sgn * (0.035 + lat * run * (0.12 + 0.12 * Math.sin(f)));
    }
    const ampA = lerp(0.08, 0.95, clamp(s / 8, 0, 1)) * (0.25 + 0.75 * run);
    T[P.lsX] = ampA * Math.sin(ph) + 0.05;
    T[P.rsX] = ampA * Math.sin(ph + Math.PI) + 0.05;
    T[P.lsZ] = 0.1 + 0.05 * run; T[P.rsZ] = -0.1 - 0.05 * run;
    const elb = -(0.18 + run * (0.55 + 0.85 * sprint));
    T[P.leX] = elb - 0.15 * run * Math.max(0, -Math.sin(ph));
    T[P.reX] = elb - 0.15 * run * Math.max(0, Math.sin(ph));
    const breath = Math.sin(t * 1.9 + (this.seed % 100)) * 0.012 * (1 - run);
    T[P.spX] = 0.03 + 0.025 * s * (back ? -0.6 : 1) + breath;
    T[P.spY] = -0.14 * run * Math.sin(ph);
    T[P.spZ] = 0;
    T[P.nkX] = -0.02 - 0.02 * s * (back ? 0 : 1);
    T[P.nkY] = this.headYaw * 0.7;
    T[P.spY] += this.headYaw * 0.25 * (1 - run);
    // idle weight shift
    T[P.roll] = clamp(-this.turn * s * 0.035, -0.3, 0.3) + (1 - run) * Math.sin(t * 0.7 + this.seed) * 0.015;
    T[P.gl] = 1;
    T[P.lift] = run * (0.012 + 0.05 * sprint) * Math.pow(Math.abs(Math.sin(ph)), 2);
    T[P.bodyY] = STAND_Y;
  }

  _oneShot(T, anim, u, pp, s, ctx) {
    const R = this.leftFoot ? -1 : 1; // kicking leg side: 1 = right
    // kicking leg indices (right leg by default)
    const KH = R > 0 ? P.rhX : P.lhX, KK = R > 0 ? P.rkX : P.lkX, KA = R > 0 ? P.raX : P.laX, KZ = R > 0 ? P.rhZ : P.lhZ;
    const SH = R > 0 ? P.lhX : P.rhX, SK = R > 0 ? P.lkX : P.rkX;
    const OAX = R > 0 ? P.lsX : P.rsX, OAZ = R > 0 ? P.lsZ : P.rsZ, OAE = R > 0 ? P.leX : P.reX; // opposite arm
    const KAX = R > 0 ? P.rsX : P.lsX, KAZ = R > 0 ? P.rsZ : P.lsZ; // kick-side arm
    const oz = R > 0 ? 1 : -1; // abduction sign for opposite (left) arm
    switch (anim) {
      case ANIM.KICK: {
        const pw = clamp(pp || 0.6, 0.3, 1);
        const b = easeOut(seg(u, 0, 0.12)), st = easeIn(seg(u, 0.12, 0.21)), fo = seg(u, 0.21, 0.38);
        const back = 0.5 + 0.4 * pw, thru = -(0.75 + 0.85 * pw);
        let h = lerp(0, back, b); h = lerp(h, thru, st); h = lerp(h, thru * 0.55, smooth(fo));
        let k = lerp(0.3, 1.25 + 0.35 * pw, b); k = lerp(k, 0.1, st); k = lerp(k, 0.35, fo);
        T[KH] = h; T[KK] = k; T[KA] = 0.3 * st; T[KZ] = -oz * 0.08;
        T[SH] = -0.3; T[SK] = 0.38; T[R > 0 ? P.laX : P.raX] = 0.1;
        T[OAX] = -0.45; T[OAZ] = oz * (0.9 + 0.3 * pw); T[OAE] = -0.3;
        T[KAX] = 0.35; T[KAZ] = -oz * 0.45;
        T[P.spX] = 0.12 - 0.22 * pw * st; T[P.spY] = R * (-0.25 * b + 0.45 * st);
        T[P.nkX] = 0.35; T[P.nkY] = 0;
        T[P.roll] = R * 0.1 * b; T[P.lift] = 0;
        break;
      }
      case ANIM.WINDUP: {
        const p = clamp(pp, 0, 1);
        T[KH] = lerp(T[KH], 0.35 + 0.35 * p, 0.8); T[KK] = lerp(T[KK], 0.9 + 0.6 * p, 0.8);
        T[OAZ] = oz * (0.3 + 0.7 * p); T[OAX] = -0.3 * p;
        T[P.spY] = -R * 0.2 * p; T[P.nkX] = 0.25 * p;
        break;
      }
      case ANIM.TACKLE: {
        const a = easeOut(seg(u, 0, 0.12)) * (1 - seg(u, 0.3, 0.42));
        T[KH] = lerp(T[KH], -1.15, a); T[KK] = lerp(T[KK], 0.08, a); T[KZ] = lerp(T[KZ], -oz * 0.3, a); T[KA] = lerp(T[KA], -0.3, a);
        T[SH] = lerp(T[SH], -0.35, a); T[SK] = lerp(T[SK], 0.85, a);
        T[P.spX] = lerp(T[P.spX], 0.4, a); T[OAZ] = lerp(T[OAZ], oz * 0.9, a); T[KAZ] = lerp(T[KAZ], -oz * 0.6, a);
        T[P.lift] = 0;
        break;
      }
      case ANIM.SLIDE: {
        // 0..0.72 slide, 0.72..(1.22) lying ('down')
        const a = easeOut(seg(u, 0, 0.16));
        const d = seg(u, 0.72, 1.0);
        T[P.gl] = 1 - a;
        T[P.bodyY] = lerp(STAND_Y, 0.23, a);
        T[P.pitch] = lerp(0, -1.18 - 0.2 * d, a);
        T[P.roll] = R * 0.38 * a;
        T[KH] = lerp(T[KH], -0.22, a); T[KK] = lerp(T[KK], 0.05, a); T[KA] = -0.2 * a; T[KZ] = 0;
        T[SH] = lerp(T[SH], 0.15, a); T[SK] = lerp(T[SK], 1.75, a);
        T[P.spX] = lerp(T[P.spX], 0.55 - 0.2 * d, a); T[P.spY] = 0;
        T[P.nkX] = 0.35 * a;
        T[OAX] = lerp(T[OAX], 0.7, a); T[OAZ] = lerp(T[OAZ], oz * 0.75, a); T[OAE] = -0.1;
        T[KAX] = lerp(T[KAX], -1.1, a); T[KAZ] = lerp(T[KAZ], -oz * 0.7, a);
        T[P.lift] = 0;
        break;
      }
      case ANIM.HEAD: {
        const jh = pp || 0.35;
        const v = clamp(u / 0.6, 0, 1);
        const j = Math.sin(Math.PI * v);
        T[P.lift] = jh * j; T[P.gl] = 1;
        T[P.lkX] = 0.15 + 0.75 * j; T[P.rkX] = 0.15 + 0.65 * j; T[P.lhX] = -0.25 * j; T[P.rhX] = -0.1 * j;
        T[P.lsX] = -0.9 * j; T[P.lsZ] = 0.9 * j + 0.1; T[P.leX] = -1.1 * j;
        T[P.rsX] = -0.9 * j; T[P.rsZ] = -0.9 * j - 0.1; T[P.reX] = -1.1 * j;
        const nod = seg(v, 0.35, 0.6);
        T[P.nkX] = lerp(-0.45, 0.45, nod) * j; T[P.spX] = lerp(-0.2, 0.35, nod) * j;
        T[P.nkY] = 0;
        break;
      }
      case ANIM.DIVE: {
        const side = Math.sign(pp) || 1;
        const hgt = Math.max(0, Math.abs(pp) - 1);
        const cosF = Math.cos(this.face);
        const dr = (Math.abs(cosF) > 0.2 ? Math.sign(side * cosF) : side) || 1; // +1 = player's right
        const F = 0.4;
        const load = seg(u, 0, 0.1);
        const fl = seg(u, 0.08, F + 0.05);
        const land = seg(u, F + 0.05, F + 0.3);
        const rise = seg(u, F + 0.75, F + 1.05);
        const high = clamp((hgt - 1.2) / 1.0, 0, 1);
        const peak = clamp(hgt * 0.8, 0.35, 1.65);
        const rollMax = lerp(1.45, 1.05, high);
        let y = lerp(STAND_Y - 0.2 * load, STAND_Y, 0);
        y = STAND_Y - 0.22 * load * (1 - fl);
        const flightY = lerp(STAND_Y - 0.2, peak, easeOut(fl)) ;
        y = fl > 0 ? flightY : y;
        y = lerp(y, 0.2, easeIn(land));
        y = lerp(y, 0.62, rise);
        const roll = dr * lerp(lerp(0.12 * load, rollMax, easeOut(fl)), 1.5, land) * (1 - 0.5 * rise);
        T[P.gl] = fl > 0 ? 0 : 1;
        T[P.bodyY] = y; T[P.roll] = roll; T[P.pitch] = -0.1 * fl + 0.25 * rise;
        const reach = easeOut(fl) * (1 - 0.6 * rise);
        // arms stretch "overhead" (toward the dive side after roll)
        T[P.lsZ] = lerp(0.3, 2.85 - (dr > 0 ? 0.25 : 0), reach); T[P.lsX] = lerp(-0.3, -0.25, reach); T[P.leX] = lerp(-0.6, -0.1, reach);
        T[P.rsZ] = lerp(-0.3, -2.85 + (dr < 0 ? 0.25 : 0), reach); T[P.rsX] = lerp(-0.3, -0.25, reach); T[P.reX] = lerp(-0.6, -0.1, reach);
        // legs: lead leg straight, trailing bent
        const leadH = dr > 0 ? P.rhX : P.lhX, leadK = dr > 0 ? P.rkX : P.lkX, trH = dr > 0 ? P.lhX : P.rhX, trK = dr > 0 ? P.lkX : P.rkX;
        T[leadH] = lerp(-0.35 * load, -0.15, fl); T[leadK] = lerp(0.6 * load, 0.15, fl);
        T[trH] = lerp(-0.35 * load, -0.55, fl); T[trK] = lerp(0.6 * load, 1.1, fl);
        T[P.lhZ] = dr < 0 ? 0.25 * fl : 0.05; T[P.rhZ] = dr > 0 ? -0.25 * fl : -0.05;
        T[P.spX] = 0.25 * load + 0.1 * fl; T[P.spZ] = -dr * 0.15 * fl; T[P.spY] = 0;
        T[P.nkY] = 0; T[P.nkX] = 0;
        T[P.lift] = 0;
        break;
      }
      case ANIM.CELEB: {
        let kind = Math.round(pp) % 3;
        if (ctx.scorer >= 0 && ctx.idx !== ctx.scorer) kind = 3 + (this.seed % 2);
        if (kind === 0) {
          T[P.lsZ] = 1.45; T[P.rsZ] = -1.45; T[P.lsX] = 0.1; T[P.rsX] = 0.1; T[P.leX] = -0.05; T[P.reX] = -0.05;
          T[P.roll] = 0.28 * Math.sin(u * 1.8); T[P.spX] = 0.05; T[P.nkX] = -0.25;
        } else if (kind === 1) {
          const k = sstep(0.35, 0.6, u) * (1 - sstep(2.6, 3.0, u));
          if (k > 0) {
            T[P.gl] = 1 - k; T[P.bodyY] = lerp(T[P.bodyY], 0.6, k);
            T[P.lhX] = lerp(T[P.lhX], 0.25, k); T[P.rhX] = lerp(T[P.rhX], 0.25, k);
            T[P.lkX] = lerp(T[P.lkX], 1.72, k); T[P.rkX] = lerp(T[P.rkX], 1.72, k); T[P.laX] = 0.6 * k; T[P.raX] = 0.6 * k;
            T[P.lhZ] = 0.12 * k; T[P.rhZ] = -0.12 * k;
            T[P.pitch] = -0.45 * k; T[P.spX] = lerp(T[P.spX], -0.2, k); T[P.nkX] = -0.5 * k;
            T[P.lsX] = lerp(T[P.lsX], -2.5, k); T[P.lsZ] = lerp(T[P.lsZ], 0.7, k); T[P.leX] = lerp(T[P.leX], -0.2, k);
            T[P.rsX] = lerp(T[P.rsX], -2.5, k); T[P.rsZ] = lerp(T[P.rsZ], -0.7, k); T[P.reX] = lerp(T[P.reX], -0.2, k);
            T[P.lift] = 0;
          }
          if (u > 2.8) { T[P.lsZ] = 1.3; T[P.rsZ] = -1.3; }
        } else if (kind === 2) {
          const cyc = (u % 0.9) / 0.9;
          const j = cyc < 0.5 ? Math.sin(Math.PI * cyc * 2) : 0;
          T[P.lift] += 0.42 * j; T[P.lkX] += 0.5 * j; T[P.rkX] += 0.5 * j;
          T[P.rsX] = -2.9; T[P.rsZ] = -0.2; T[P.reX] = -0.35 - 0.6 * (1 - j);
          T[P.lsX] = -0.2; T[P.lsZ] = 0.35; T[P.leX] = -1.4;
          T[P.nkX] = -0.35;
        } else {
          // teammates: arms up, little jumps
          const cyc = ((u + (this.seed % 7) * 0.13) % 0.75) / 0.75;
          const j = cyc < 0.45 ? Math.sin(Math.PI * cyc / 0.45) : 0;
          if (kind === 3) { T[P.lsX] = -2.7; T[P.rsX] = -2.7; T[P.lsZ] = 0.35; T[P.rsZ] = -0.35; T[P.leX] = -0.3; T[P.reX] = -0.3; T[P.lift] += 0.25 * j * (s < 2 ? 1 : 0); }
          else { T[P.lsX] = -1.2; T[P.rsX] = -1.2; T[P.lsZ] = -0.3 + 0.25 * Math.sin(u * 16); T[P.rsZ] = 0.3 - 0.25 * Math.sin(u * 16); T[P.leX] = -0.9; T[P.reX] = -0.9; }
          T[P.nkX] = -0.2;
        }
        break;
      }
      case ANIM.THROW: {
        const a = seg(u, 0.02, 0.28), r = seg(u, 0.3, 0.45);
        const ax = lerp(-2.95, -1.35, easeIn(a)) + 0.35 * r;
        T[P.lsX] = ax; T[P.rsX] = ax; T[P.lsZ] = 0.28; T[P.rsZ] = -0.28;
        T[P.leX] = lerp(-1.5, -0.1, a); T[P.reX] = lerp(-1.5, -0.1, a);
        T[P.spX] = lerp(-0.28, 0.35, easeIn(a)) - 0.1 * r; T[P.nkX] = lerp(-0.2, 0.2, a);
        T[P.lhX] = -0.35; T[P.lkX] = 0.15; T[P.rhX] = 0.3; T[P.rkX] = 0.3; T[P.laX] = 0; T[P.raX] = -0.3;
        T[P.lift] = 0; T[P.roll] = 0; T[P.spY] = 0; T[P.nkY] = 0;
        break;
      }
      case ANIM.FALL: {
        const f = easeIn(seg(u, 0, 0.38));
        const up = seg(u, 0.95, 1.4);
        const dirB = (this.seed % 3) === 0 ? -1 : 1; // some fall backwards
        T[P.gl] = 1 - f;
        T[P.bodyY] = lerp(lerp(STAND_Y, 0.16, f), 0.55, up);
        T[P.pitch] = dirB * lerp(lerp(0, 1.48, f), 0.6, up);
        T[P.roll] = 0.25 * f * ((this.seed % 2) ? 1 : -1) * (1 - up);
        T[P.lsX] = lerp(T[P.lsX], dirB > 0 ? -2.2 : 0.8, f); T[P.rsX] = lerp(T[P.rsX], dirB > 0 ? -2.0 : 0.9, f);
        T[P.lsZ] = 0.5 * f + 0.1; T[P.rsZ] = -0.5 * f - 0.1; T[P.leX] = -0.5; T[P.reX] = -0.5;
        T[P.lhX] = lerp(T[P.lhX], 0.15 * dirB, f); T[P.rhX] = lerp(T[P.rhX], -0.1, f); T[P.lkX] = lerp(T[P.lkX], 0.5, f); T[P.rkX] = lerp(T[P.rkX], 0.2, f);
        if (up > 0) { T[P.lkX] = lerp(T[P.lkX], 1.6, up); T[P.rkX] = lerp(T[P.rkX], 1.2, up); T[P.lhX] = lerp(T[P.lhX], -0.6, up); }
        T[P.spX] = lerp(T[P.spX], -0.1 * dirB, f); T[P.nkX] = dirB > 0 ? -0.5 * f : 0.4 * f;
        T[P.lift] = 0;
        break;
      }
      case ANIM.HOLD: {
        T[P.lsX] = -0.95; T[P.rsX] = -0.95; T[P.lsZ] = -0.22; T[P.rsZ] = 0.22; T[P.leX] = -1.45; T[P.reX] = -1.45;
        T[P.lsY] = 0.3; T[P.rsY] = -0.3;
        T[P.spX] += 0.08; T[P.nkX] = 0.1;
        break;
      }
      case ANIM.SKILL: {
        const idx = Math.round(pp) % 10;
        const sd = pp >= 10 ? -1 : 1;
        const L = sd > 0; // side leg: right leg for side>0 ... choose leg that moves over the ball
        const hX = L ? P.rhX : P.lhX, kX = L ? P.rkX : P.lkX, hZ = L ? P.rhZ : P.lhZ, aX = L ? P.raX : P.laX;
        const zs = L ? -1 : 1;
        T[P.lsZ] = 0.75; T[P.rsZ] = -0.75; T[P.leX] = -0.4; T[P.reX] = -0.4;
        if (idx === 0) { // step-over
          const v = clamp(u / 0.55, 0, 1);
          T[hX] = -0.55 * Math.sin(Math.PI * v); T[kX] = 0.9 * Math.sin(Math.PI * v);
          T[hZ] = zs * (-0.35 + 0.8 * v) * Math.sin(Math.PI * v);
          T[P.roll] = -zs * 0.18 * Math.sin(Math.PI * v); T[P.spY] = zs * 0.3 * Math.sin(Math.PI * v);
          T[P.lift] = 0;
        } else if (idx === 1) { // roulette spin
          const v = clamp(u / 0.62, 0, 1);
          T[P.yaw] = sd * Math.PI * 2 * smooth(v);
          T[hX] = -0.4 * Math.sin(Math.PI * 2 * v); T[kX] = 0.6 * Math.abs(Math.sin(Math.PI * 2 * v));
          T[aX] = 0.4 * Math.sin(Math.PI * v);
          T[P.lsZ] = 1.0; T[P.rsZ] = -1.0; T[P.spX] = 0.15;
        } else if (idx === 2) { // ball roll (sole drag)
          const v = clamp(u / 0.45, 0, 1);
          T[hX] = -0.35; T[kX] = 0.65; T[aX] = -0.45;
          T[hZ] = zs * lerp(0.25, -0.35, smooth(v));
          T[P.roll] = zs * 0.12; T[P.spX] = 0.18;
        } else { // heel flick
          const v = clamp(u / 0.4, 0, 1);
          T[hX] = lerp(-0.5, 0.65, smooth(v)); T[kX] = lerp(0.3, 1.5, smooth(v)); T[aX] = 0.3;
          T[P.spX] = 0.25; T[P.nkX] = 0.3;
        }
        break;
      }
      case ANIM.WALL: {
        const jh = pp || 0.35;
        const v = clamp(u / 0.6, 0, 1);
        const j = u > 0 && u < 0.6 ? Math.sin(Math.PI * v) : 0;
        T[P.lsX] = -0.4; T[P.lsZ] = -0.32; T[P.leX] = -0.75; T[P.lsY] = 0.25;
        T[P.rsX] = -0.4; T[P.rsZ] = 0.32; T[P.reX] = -0.75; T[P.rsY] = -0.25;
        T[P.lhX] = -0.2 * j; T[P.rhX] = -0.2 * j; T[P.lkX] = 0.1 + 0.6 * j; T[P.rkX] = 0.1 + 0.6 * j;
        T[P.lhZ] = 0; T[P.rhZ] = 0;
        T[P.lift] = jh * j; T[P.spX] = 0.08; T[P.nkX] = -0.1;
        break;
      }
      case ANIM.CHEST: {
        const k = Math.sin(Math.PI * clamp(u / 0.3, 0, 1));
        T[P.spX] = lerp(T[P.spX], -0.38, k); T[P.nkX] = 0.45 * k;
        T[P.lsX] = 0.45 * k; T[P.rsX] = 0.45 * k; T[P.lsZ] = 0.1 + 0.6 * k; T[P.rsZ] = -0.1 - 0.6 * k; T[P.leX] = -0.8 * k; T[P.reX] = -0.8 * k;
        T[P.lkX] += 0.25 * k; T[P.rkX] += 0.25 * k;
        break;
      }
      case ANIM.GKREADY: {
        const bob = Math.sin(ctx.t * 5 + this.seed) * 0.02;
        T[P.lhX] = -0.55; T[P.rhX] = -0.55; T[P.lkX] = 0.95 + bob; T[P.rkX] = 0.95 + bob; T[P.laX] = -0.35; T[P.raX] = -0.35;
        T[P.lhZ] = 0.2; T[P.rhZ] = -0.2; T[P.lhY] = -0.2; T[P.rhY] = 0.2;
        T[P.spX] = 0.5; T[P.nkX] = -0.42; T[P.nkY] = this.headYaw * 0.5;
        T[P.lsX] = -0.55; T[P.rsX] = -0.55; T[P.lsZ] = 0.5; T[P.rsZ] = -0.5; T[P.leX] = -0.55; T[P.reX] = -0.55;
        T[P.lift] = 0; T[P.roll] = 0; T[P.spY] = 0;
        break;
      }
      default: break;
    }
  }

  _legDrop(hX, kX, hZ, pitch) {
    const c = Math.cos(hZ);
    return c * (-HIP_DY + THIGH * Math.cos(pitch + hX) + SHIN * Math.cos(pitch + hX + kX)) + FOOT_H * Math.cos(pitch + hX + kX) * 0.8 + 0.015;
  }

  _apply() {
    const p = this.pose;
    const pitch = p[P.pitch];
    const lock = Math.max(this._legDrop(p[P.lhX], p[P.lkX], p[P.lhZ], pitch), this._legDrop(p[P.rhX], p[P.rkX], p[P.rhZ], pitch));
    const y = lerp(p[P.bodyY], lock + p[P.lift], p[P.gl]);
    this.body.position.y = y;
    this.body.rotation.set(pitch, p[P.yaw], p[P.roll]);
    this.spine.rotation.set(p[P.spX], p[P.spY], p[P.spZ]);
    this.head.rotation.set(p[P.nkX], p[P.nkY], 0);
    const [aL, aR] = this.arms;
    aL.sh.rotation.set(p[P.lsX], p[P.lsY], p[P.lsZ]); aL.elbow.rotation.x = p[P.leX];
    aR.sh.rotation.set(p[P.rsX], p[P.rsY], p[P.rsZ]); aR.elbow.rotation.x = p[P.reX];
    const [lL, lR] = this.legs;
    lL.hip.rotation.set(p[P.lhX], p[P.lhY], p[P.lhZ]); lL.knee.rotation.x = p[P.lkX]; lL.ankle.rotation.x = p[P.laX];
    lR.hip.rotation.set(p[P.rhX], p[P.rhY], p[P.rhZ]); lR.knee.rotation.x = p[P.rkX]; lR.ankle.rotation.x = p[P.raX];
  }

  // world position of the head top (for markers)
  headHeight() { return (this.body.position.y + 0.9) * this.scale; }
}

export { STAND_Y };
