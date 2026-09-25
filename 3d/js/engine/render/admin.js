// Visuals for the admin fun effects (view.ae / fx k='admin'): player scale, big heads, ice blocks,
// vanish puffs, confetti, disco light pools, the wall of keepers and the ball looks.
import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH } from '../core/constants.js';
import { ADMIN_SCALE } from '../core/admin.js';
import { makeCanvas, canvasTex, radialTexture } from './textures.js';

const STRIDE = 7;
const HL = PITCH.HL, HW = PITCH.HW;
const DISCO_COLS = [0xff2d95, 0x2de2ff, 0xfff02d, 0x7dff2d, 0xa24dff, 0xff7a1a];
const CONF_COLS = ['#ff3b3b', '#ffd400', '#2bd46b', '#2d8cff', '#ff4fd8', '#ffffff', '#ff8c1a'];

class Particles {
  constructor(scene, n, size, { map = null, colors = false, opacity = 1, additive = false } = {}) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(-500);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    if (colors) { this.col = new Float32Array(n * 3).fill(1); this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3)); }
    this.mat = new THREE.PointsMaterial({ size, map, vertexColors: colors, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.pts = new THREE.Points(this.geo, this.mat);
    this.pts.frustumCulled = false; this.pts.renderOrder = 7;
    scene.add(this.pts);
    this.next = 0; this.alive = 0;
  }
  spawn(x, y, z, vx, vy, vz, life, drag = 0.5, grav = 0, color = null) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.drag[i] = drag; this.grav[i] = grav;
    if (color && this.col) { this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b; }
    this.alive = Math.max(this.alive, life);
  }
  update(dt) {
    if (this.alive <= 0) return;
    this.alive -= dt;
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { p[i * 3 + 1] = -500; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      v[i * 3] *= k; v[i * 3 + 1] = v[i * 3 + 1] * k - this.grav[i] * dt; v[i * 3 + 2] *= k;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < 0.03) { p[i * 3 + 1] = 0.03; v[i * 3] *= 0.5; v[i * 3 + 2] *= 0.5; v[i * 3 + 1] = 0; }
    }
    this.geo.attributes.position.needsUpdate = true;
    if (this.col) this.geo.attributes.color.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.pos.fill(-500); this.alive = 0; this.geo.attributes.position.needsUpdate = true; }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

function beachTexture() {
  const c = makeCanvas(256, 128), g = c.getContext('2d');
  const cols = ['#ff3b3b', '#ffffff', '#ffd400', '#ffffff', '#2d8cff', '#ffffff'];
  for (let i = 0; i < 6; i++) { g.fillStyle = cols[i]; g.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 128); }
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 10); g.fillRect(0, 118, 256, 10);
  return canvasTex(c);
}

export class AdminRender {
  constructor(scene, { home, away, shadows }) {
    this.scene = scene;
    this.home = home; this.away = away;
    this.shadows = shadows;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.disposables = [];
    this.prevHidden = new Array(22).fill(false);
    this.lastPos = Array.from({ length: 22 }, () => ({ x: 0, z: 0 }));
    this.prevVanMask = 0;
    this.ice = null; this.puffs = null; this.confetti = null; this.disco = null; this.wall = null;
    this.ballMats = null;
    this.t = 0;
  }
  _track(o) { this.disposables.push(o); return o; }

  // ---------------------------------------------------------------- lazily built pieces
  _puffs() {
    if (!this.puffs) this.puffs = new Particles(this.group, 360, 1.1, { map: this._track(radialTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)')), opacity: 0.85 });
    return this.puffs;
  }
  _confetti() {
    if (!this.confetti) this.confetti = new Particles(this.group, 1400, 0.42, { colors: true });
    return this.confetti;
  }
  _iceMeshes() {
    if (!this.ice) {
      const geo = this._track(new THREE.BoxGeometry(0.95, 2.15, 0.95));
      const mat = this._track(new THREE.MeshStandardMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.42, roughness: 0.08, metalness: 0.1, emissive: 0x16384d, depthWrite: false }));
      this.ice = Array.from({ length: 22 }, () => { const m = new THREE.Mesh(geo, mat); m.visible = false; m.renderOrder = 5; this.group.add(m); return m; });
    }
    return this.ice;
  }
  _discoPools() {
    if (!this.disco) {
      const tex = this._track(radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'));
      const geo = this._track(new THREE.PlaneGeometry(1, 1)); geo.rotateX(-Math.PI / 2);
      this.disco = DISCO_COLS.map((c, i) => {
        const mat = this._track(new THREE.MeshBasicMaterial({ map: tex, color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
        const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; m.visible = false; m.scale.set(16, 1, 16); m.position.y = 0.03;
        m.userData = { ph: i * 1.7, sp: 0.25 + (i % 3) * 0.12 };
        this.group.add(m);
        return m;
      });
      // beams from the stand roofs
      const bg = this._track(new THREE.CylinderGeometry(0.4, 5, 1, 12, 1, true)); bg.translate(0, -0.5, 0);
      this.beams = DISCO_COLS.map((c) => {
        const mat = this._track(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const m = new THREE.Mesh(bg, mat); m.visible = false; m.renderOrder = 6;
        this.group.add(m);
        return m;
      });
    }
    return this.disco;
  }
  _wallFigures() {
    if (!this.wall) {
      const body = this._track(new THREE.CapsuleGeometry(0.28, 0.9, 4, 10)); body.translate(0, 0.95, 0);
      const arms = this._track(new THREE.CapsuleGeometry(0.08, 1.05, 4, 8)); arms.rotateZ(Math.PI / 2); arms.translate(0, 1.55, 0);
      const head = this._track(new THREE.SphereGeometry(0.15, 12, 10)); head.translate(0, 1.82, 0);
      const skin = this._track(new THREE.MeshStandardMaterial({ color: 0xd9a27a, roughness: 0.7 }));
      const mk = (col) => this._track(new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, emissive: col, emissiveIntensity: 0.15 }));
      const kits = [mk((this.home.gkKit && this.home.gkKit.primary) || '#222'), mk((this.away.gkKit && this.away.gkKit.primary) || '#2a2')];
      this.wall = [];
      for (let side = 0; side < 2; side++) {
        for (let k = 0; k < 6; k++) {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(body, kits[0]), new THREE.Mesh(arms, kits[0]), new THREE.Mesh(head, skin));
          g.children.forEach((c) => { c.castShadow = this.shadows; });
          g.visible = false;
          this.group.add(g);
          this.wall.push(g);
        }
      }
      this.wallKits = kits;
    }
    return this.wall;
  }

  // ---------------------------------------------------------------- events
  onFx(f, view) {
    if (f.e === 'cf') this.fireConfetti();
    else if (f.e === 'su' || f.e === 'wn') this.fireConfetti(0.5);
    void view;
  }
  fireConfetti(k = 1) {
    const c = this._confetti();
    const col = new THREE.Color();
    const cannons = [[-HL + 2, -HW - 2], [HL - 2, -HW - 2], [-HL + 2, HW + 2], [HL - 2, HW + 2], [0, -HW - 3], [0, HW + 3]];
    const per = Math.floor((c.n / cannons.length) * k);
    for (const [x, z] of cannons) {
      for (let i = 0; i < per; i++) {
        col.set(CONF_COLS[(Math.random() * CONF_COLS.length) | 0]);
        const tx = x * 0.35 - x, tz = -z * 0.6;
        const l = Math.hypot(tx, tz) || 1;
        const sp = 14 + Math.random() * 16;
        c.spawn(x, 1.5, z, (tx / l) * sp * 0.6 + (Math.random() - 0.5) * 8, 16 + Math.random() * 14, (tz / l) * sp * 0.6 + (Math.random() - 0.5) * 8, 5 + Math.random() * 3, 0.9, 5, col);
      }
    }
  }
  puff(x, z, s = 1) {
    const p = this._puffs();
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 2.2;
      p.spawn(x + Math.cos(a) * 0.2, 0.3 + Math.random() * 1.6 * s, z + Math.sin(a) * 0.2, Math.cos(a) * r, 0.6 + Math.random() * 1.8, Math.sin(a) * r, 0.55 + Math.random() * 0.45, 2.2, -0.5);
    }
  }

  // ---------------------------------------------------------------- per frame
  // Returns ball look {scale, look, gm} for the ball renderer.
  update(view, rigs, dt) {
    this.t += dt;
    const ae = view.ae || [];
    const has = (code, team) => ae.some((a) => a[0] === code && (team == null || a[1] === 2 || a[1] === team));
    const p = view.p, so = view.so || 0;
    // vanish / erase puffs: players entering or leaving the pitch through an admin effect
    let van = 0;
    for (const a of ae) if (a[0] === 'va' || a[0] === 'eg') van |= +a[3] || 0;
    const vmask = van | this.prevVanMask;
    for (let i = 0; i < 22; i++) {
      const hidden = !!(so & (1 << i));
      if (hidden !== this.prevHidden[i] && (vmask & (1 << i)) && !view.replay) {
        const lp = hidden ? this.lastPos[i] : { x: p[i * STRIDE], z: p[i * STRIDE + 1] };
        if (Math.abs(lp.x) < HL + 8) this.puff(lp.x, lp.z, 1);
      }
      this.prevHidden[i] = hidden;
      if (!hidden) { this.lastPos[i].x = p[i * STRIDE]; this.lastPos[i].z = p[i * STRIDE + 1]; }
    }
    this.prevVanMask = van;
    // player scale / big heads / ice
    const frozen = [has('fr', 0), has('fr', 1)];
    const anyIce = frozen[0] || frozen[1];
    if (anyIce) this._iceMeshes();
    for (let i = 0; i < 22 && i < rigs.length; i++) {
      const r = rigs[i], team = i < 11 ? 0 : 1;
      const s = has('sh', team) ? ADMIN_SCALE.sh : has('gi', team) ? ADMIN_SCALE.gi : 1;
      if (s !== 1 || r._admS !== undefined) {
        r.root.scale.setScalar(r.scale * s);
        r._admS = s === 1 ? undefined : s;
      }
      const hb = has('bh', team) ? 2.3 : 1;
      if (r.head && (hb !== 1 || r._admH)) { r.head.scale.setScalar(hb); r._admH = hb !== 1; }
      if (this.ice) {
        const m = this.ice[i];
        m.visible = frozen[team] && r.root.visible;
        if (m.visible) {
          const sc = r.scale * s;
          m.position.set(r.root.position.x, 1.07 * sc, r.root.position.z);
          m.scale.setScalar(sc);
          m.rotation.y = r.root.rotation.y;
        }
      }
    }
    // disco pools + beams
    const disco = has('di');
    if (disco || this.disco) {
      const pools = this._discoPools();
      const tt = this.t;
      pools.forEach((m, k) => {
        m.visible = disco;
        const bm = this.beams[k];
        bm.visible = disco;
        if (!disco) return;
        const u = m.userData;
        const x = Math.sin(tt * u.sp + u.ph) * 40, z = Math.cos(tt * u.sp * 1.3 + u.ph * 0.7) * 24;
        m.position.x = x; m.position.z = z;
        m.material.color.setHex(DISCO_COLS[(k + Math.floor(tt * 2)) % DISCO_COLS.length]);
        const sx = (k % 2 ? -1 : 1) * 60, sy = 44, sz = (k < 3 ? -1 : 1) * 55;
        bm.position.set(sx, sy, sz);
        const dx = x - sx, dy = -sy, dz = z - sz, L = Math.hypot(dx, dy, dz);
        bm.scale.set(1, L, 1);
        bm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
        bm.material.color.copy(m.material.color);
      });
    }
    // wall of keepers (in front of the goal each target team attacks)
    const wk = [has('wk', 0), has('wk', 1)];
    if (wk[0] || wk[1] || this.wall) {
      const figs = this._wallFigures();
      const zs = [-3.1, -2.3, -1.5, 1.5, 2.3, 3.1];
      for (let team = 0; team < 2; team++) {
        const s = (team === 0 ? 1 : -1) * (view.dir || 1);
        const kit = this.wallKits[1 - team];
        for (let k = 0; k < 6; k++) {
          const g = figs[team * 6 + k];
          g.visible = wk[team];
          if (!g.visible) continue;
          g.children[0].material = kit; g.children[1].material = kit;
          const hop = Math.abs(Math.sin(this.t * 5 + k * 1.3)) * 0.18;
          g.position.set(s * (HL - 0.3), hop, zs[k]);
          g.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        }
      }
    }
    if (this.puffs) this.puffs.update(dt);
    if (this.confetti) this.confetti.update(dt);
    // ball look
    let scale = 1, look = '';
    if (has('gb')) scale = 3.2; else if (has('tb')) scale = 0.5;
    if (has('bb')) { look = 'beach'; scale = Math.max(scale, 2.4); } else if (has('bw')) { look = 'bowling'; scale = scale === 1 ? 1.9 : scale; }
    return { scale, look, gm: has('mo') ? 0.17 : 1 };
  }

  ballMaterial(look) {
    if (!look) return null;
    if (!this.ballMats) {
      this.ballMats = {
        beach: this._track(new THREE.MeshStandardMaterial({ map: this._track(beachTexture()), roughness: 0.35 })),
        bowling: this._track(new THREE.MeshStandardMaterial({ color: 0x1b1f3a, roughness: 0.12, metalness: 0.35, emissive: 0x0a0d24 })),
      };
    }
    return this.ballMats[look] || null;
  }

  reset() {
    if (this.puffs) this.puffs.clear();
    if (this.confetti) this.confetti.clear();
  }
  dispose() {
    if (this.puffs) this.puffs.dispose();
    if (this.confetti) this.confetti.dispose();
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.disposables.length = 0;
    this.scene.remove(this.group);
  }
}
