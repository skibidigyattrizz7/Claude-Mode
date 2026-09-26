// 3D tunnel + walkout cinematic for pack opening. Read-only re-use of the engine's player rig
// (3d/js/engine/render/player.js, textures.js) — this file owns no engine code, it only
// instantiates the rig and drives its existing pose/update API. Kept low-poly + disposable
// per opening: a renderer is built here and destroyed by dispose(), never cached globally.
import * as THREE from '../../../vendor/three.module.min.js';
import { acquireGeometry, releaseGeometry, SharedMaterials, PlayerRig } from '../../engine/render/player.js';
import { ANIM } from '../../engine/core/constants.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/** Whether a WebGL context can be created at all (Chromebook / locked-down proxy safety net). */
export function supports3D() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch { return false; }
}

// ---------------------------------------------------------------- tiny WebAudio stingers
// Self-contained (no dependency on engine/ui/audio.js — that module belongs to the engine owner).
class PackAudio {
  constructor() { this.ctx = null; this.master = null; }
  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
    return this.ctx;
  }
  /** Short synthesised crowd swell (brown-noise burst through a lowpass). */
  roar(ms = 1400, peak = 0.5) {
    const ctx = this._ensure(); if (!ctx) return;
    try {
      const len = Math.max(1, Math.round((ctx.sampleRate * ms) / 1000));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.025 * w) / 1.025; d[i] = last * 3.2; }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
      const g = ctx.createGain(); g.gain.value = 0;
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + ms / 3000);
      g.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
      src.connect(f).connect(g).connect(this.master);
      src.start(t0); src.stop(t0 + ms / 1000 + 0.05);
    } catch { /* ignore */ }
  }
  /** Short arpeggio "sting" — theme.sting = { wave, freq:[f1,f2,f3] }. */
  sting(spec) {
    const ctx = this._ensure(); if (!ctx || !spec) return;
    try {
      const t0 = ctx.currentTime;
      (spec.freq || [220, 440]).forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = spec.wave || 'sine'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0;
        const at = t0 + i * 0.09;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.22, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        o.connect(g).connect(this.master);
        o.start(at); o.stop(at + 0.55);
      });
    } catch { /* ignore */ }
  }
  dispose() { try { this.ctx && this.ctx.close(); } catch { /* ignore */ } this.ctx = null; }
}

// ---------------------------------------------------------------- timeline runner
/** Runs a list of {dur, tick(u), onStart?, onEnd?} segments; skip() fast-forwards to the end. */
function timeline(segments, render) {
  let alive = true, skipping = false, raf = 0;
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
    let i = 0;
    const runSeg = () => {
      if (!alive) { resolve(); return; }
      if (i >= segments.length) { resolve(); return; }
      const s = segments[i];
      if (s.onStart) s.onStart();
      const t0 = performance.now();
      let last = t0;
      const dur = Math.max(1, s.dur);
      const frame = () => {
        if (!alive) { resolve(); return; }
        const now = performance.now();
        const u = skipping ? 1 : clamp01((now - t0) / dur);
        s.tick(u, Math.min(0.05, Math.max(0, (now - last) / 1000)));
        last = now;
        if (render) render();
        if (u >= 1) {
          if (s.onEnd) s.onEnd();
          i++;
          runSeg();
        } else raf = requestAnimationFrame(frame);
      };
      frame();
    };
    runSeg();
  });
  return {
    promise,
    skip() { skipping = true; },
    stop() { alive = false; cancelAnimationFrame(raf); finish(); },
  };
}

// ---------------------------------------------------------------- scene
export class TunnelScene {
  /**
   * @param canvas <canvas> to render into (sized by its CSS box; resize() reads clientWidth/Height)
   * @param opts { theme:{bg,particles,beam,wall,sting}, flare, accent }
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.theme = opts.theme || {};
    this.flare = opts.flare || '#ffc933';
    this.accent = opts.accent || this.flare;
    this.audio = new PackAudio();
    this.active = null; // current timeline() handle
    this.rig = null; this.shared = null; this._geoHeld = false;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const wallColor = new THREE.Color(this.theme.wall || '#0b1120');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111923');
    scene.fog = new THREE.Fog('#111923', 18, 65);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 60);
    camera.position.set(0, 1.55, 14);
    this.camera = camera;

    const hemi = new THREE.HemisphereLight(0xbfd4ff, wallColor.getHex(), 0.55);
    scene.add(hemi); this.hemi = hemi;
    const key = new THREE.DirectionalLight(0xffefdc, 2.6);
    key.position.set(-3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -7; key.shadow.camera.right = 7;
    key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
    key.shadow.normalBias = 0.025;
    scene.add(key); this.key = key;
    const glow = new THREE.PointLight(new THREE.Color(this.accent), 1.2, 10, 2);
    glow.position.set(0, 1.6, -1);
    scene.add(glow); this.glow = glow;
    const rim = new THREE.DirectionalLight(0xc6dcff, 1.8);
    rim.position.set(4, 4, -5); scene.add(rim);

    this._buildTunnel(wallColor);
    this._buildPack();
    this._buildParticles();
    this._buildStadium();

    this.t = 0;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  _buildStadium() {
    const stadium = new THREE.Group();
    const grass = new THREE.MeshStandardMaterial({ color: '#316d45', roughness: 1 });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), grass);
    pitch.rotation.x = -Math.PI / 2; pitch.position.y = -0.045; pitch.receiveShadow = true;
    stadium.add(pitch);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5, 0.1, 80), new THREE.MeshStandardMaterial({ color: '#20262a', roughness: 0.42, metalness: 0.45 }));
    platform.position.y = -0.02; platform.receiveShadow = true; stadium.add(platform);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.82, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: this.accent }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.04; stadium.add(rim);
    const seat = new THREE.MeshStandardMaterial({ color: '#37414a', roughness: 0.9 });
    const lamp = new THREE.MeshBasicMaterial({ color: '#fff1d5' });
    for (let tier = 0; tier < 9; tier++) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(54, 0.48, 1.15), seat);
      stand.position.set(0, 0.5 + tier * 0.56, -13 - tier * 0.95); stadium.add(stand);
    }
    for (let i = 0; i < 22; i++) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.15), lamp);
      light.position.set(-21 + i * 2, 7.2, -19); stadium.add(light);
    }
    this.boards = [];
    for (const side of [-1, 1]) {
      const board = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.65, 3.5, 0.14), new THREE.MeshStandardMaterial({ color: '#bba777', metalness: 0.7, roughness: 0.3 }));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 3.36), new THREE.MeshStandardMaterial({ color: this.theme.wall || '#253650', emissive: this.accent, emissiveIntensity: 0.12, roughness: 0.6 }));
      screen.position.z = 0.081;
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.08), lamp);
      stripe.position.set(0, -1.25, 0.09);
      board.add(frame, screen, stripe); board.position.set(side * 3.2, 1.8, -1.8);
      board.rotation.y = -side * 0.16;
      this.boards.push(board); stadium.add(board);
    }
    this.scene.add(stadium); stadium.visible = false; this.stadium = stadium;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || this.canvas.clientWidth || 300));
    const h = Math.max(1, Math.round(r.height || this.canvas.clientHeight || 300));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildTunnel(wallColor) {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.95, metalness: 0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 40), wallMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -6);
    const ceil = floor.clone(); ceil.position.y = 4.4; ceil.rotation.x = Math.PI / 2;
    const wallGeo = new THREE.PlaneGeometry(40, 4.4);
    const wL = new THREE.Mesh(wallGeo, wallMat); wL.position.set(-4, 2.2, -6); wL.rotation.y = Math.PI / 2;
    const wR = new THREE.Mesh(wallGeo, wallMat); wR.position.set(4, 2.2, -6); wR.rotation.y = -Math.PI / 2;
    g.add(floor, ceil, wL, wR);
    // light-strip fixtures: cheap unlit boxes that pulse to read as "beams sweeping"
    const beamColor = new THREE.Color(this.theme.beam || this.accent);
    const stripMat = new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: 0.85 });
    const strips = [];
    for (let i = 0; i < 9; i++) {
      const z = 14 - i * 3.3;
      const bL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.4), stripMat.clone());
      bL.position.set(-3.85, 3.6, z);
      const bR = bL.clone(); bR.position.x = 3.85;
      g.add(bL, bR); strips.push(bL, bR);
    }
    this.strips = strips;
    this.scene.add(g);
    this.tunnel = g;
  }

  _buildPack() {
    const g = new THREE.Group();
    g.position.set(0, 1.35, -1.4);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.flare), roughness: 0.32, metalness: 0.55, emissive: new THREE.Color(this.accent), emissiveIntensity: 0.18 });
    const half = (sign) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.92, 0.09), mat);
      m.position.x = sign * 0.16;
      return m;
    };
    const left = half(-1), right = half(1);
    g.add(left, right);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.76), new THREE.MeshStandardMaterial({ color: '#0b1120', roughness: 0.6, emissive: new THREE.Color(this.accent), emissiveIntensity: 0.08, transparent: true, opacity: 0 }));
    card.position.z = -0.02;
    g.add(card);
    this.scene.add(g);
    this.pack = { group: g, left, right, card };
  }

  _buildParticles() {
    const N = 140;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const palette = (this.theme.particles && this.theme.particles.length ? this.theme.particles : [this.flare, this.accent, '#ffffff']).map((c) => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      const c = palette[i % palette.length];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.particles = { points, pos, vel, N, life: 0 };
  }

  _emitParticles(origin) {
    const { pos, vel, N } = this.particles;
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.9 + Math.random() * 2.4, up = Math.random() * 2.2;
      pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
      vel[i * 3] = Math.cos(a) * s; vel[i * 3 + 1] = up; vel[i * 3 + 2] = Math.sin(a) * s * 0.6;
    }
    this.particles.points.geometry.attributes.position.needsUpdate = true;
    this.particles.points.material.opacity = 1;
    this.particles.life = 1;
  }

  _stepParticles(dt) {
    const p = this.particles; if (p.life <= 0) return;
    const { pos, vel, N } = p;
    for (let i = 0; i < N; i++) {
      vel[i * 3 + 1] -= 2.6 * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    p.points.geometry.attributes.position.needsUpdate = true;
    p.life -= dt * 0.6;
    p.points.material.opacity = clamp01(p.life);
  }

  _render(dt) {
    this.t += dt;
    for (let i = 0; i < this.strips.length; i++) {
      const s = this.strips[i];
      s.material.opacity = 0.45 + 0.4 * Math.sin(this.t * 1.8 - i * 0.5);
    }
    this._stepParticles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Camera glide + pack float/shake/rip. Resolves once the (blank, face-down) card is floating. */
  introSequence() {
    const { group, left, right, card } = this.pack;
    let last = performance.now();
    const render = () => { const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; this._render(dt); };
    const segs = [
      { // fly down the tunnel toward the pack
        dur: 1150,
        tick: (u) => {
          const e = easeInOut(u);
          this.camera.position.z = lerp(14, 2.6, e);
          this.camera.position.y = lerp(1.9, 1.55, e);
          this.camera.lookAt(group.position.x, group.position.y, group.position.z);
          group.position.y = 1.35 + Math.sin(u * Math.PI * 3) * 0.05 * (1 - e);
          group.rotation.y = Math.sin(u * 6) * 0.15 * (1 - e);
        },
      },
      { // shake — tension builds, lights dim slightly
        dur: 650,
        onStart: () => { this.audio.sting({ wave: 'sine', freq: [180] }); },
        tick: (u) => {
          const k = Math.sin(u * Math.PI);
          group.rotation.z = Math.sin(u * 30) * 0.025 * k;
          group.rotation.x = Math.sin(u * 18) * 0.018 * k;
          group.position.x = Math.sin(u * 24) * 0.012 * k;
          this.hemi.intensity = lerp(0.55, 0.3, k);
          this.glow.intensity = lerp(1.2, 2.2, k);
        },
      },
      { // rip — halves tear apart, particles burst, blank card slides out
        dur: 520,
        onStart: () => {
          this._emitParticles(group.position);
          this.audio.roar(900, 0.4);
          this.audio.sting(this.theme.sting);
        },
        tick: (u) => {
          const e = easeOut(u);
          left.position.x = lerp(-0.16, -0.62, e); left.rotation.z = lerp(0, 0.7, e); left.material.opacity = 1 - e;
          right.position.x = lerp(0.16, 0.62, e); right.rotation.z = lerp(0, -0.7, e); right.material.opacity = 1 - e;
          left.material.transparent = true; right.material.transparent = true;
          card.material.opacity = e;
          card.position.z = lerp(-0.02, 0.32, e);
          card.rotation.y = lerp(0, Math.PI * 0.06, e);
          this.hemi.intensity = lerp(0.3, 0.6, e);
        },
        onEnd: () => { left.visible = false; right.visible = false; },
      },
    ];
    this.active = timeline(segs, render);
    return this.active.promise;
  }

  /** Player rig walks out of the tunnel, does 1-2 skills, settles hands-behind-back. */
  walkoutSequence(playerLike, kit) {
    if (!this.rig) {
      const geo = acquireGeometry(); this._geoHeld = true;
      this.shared = new SharedMaterials();
      this.rig = new PlayerRig(geo, this.shared, null, { shadows: true });
      this.rig.setIdentity(playerLike, kit, playerLike && (playerLike.id || playerLike.name) || 'walkout');
      this.scene.add(this.rig.root);
    }
    const rig = this.rig;
    this.tunnel.visible = false;
    this.pack.group.visible = false;
    this.stadium.visible = true;
    this.hemi.intensity = 1.1;
    const face = Math.PI / 2; // Camera is at +z; walk toward it.
    let tSec = 0;
    const ctxFor = (dt, x, z) => ({ dt, t: (tSec += dt), ballX: x, ballY: 0, ballZ: z - 5, scorer: -1, idx: 0 });
    let last = performance.now();
    const render = () => { const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; this._render(dt); };
    const segs = [
      {
        dur: 2400,
        onStart: () => { this.audio.roar(1800, 0.3); },
        tick: (u, dt) => {
          const e = easeInOut(u), x = lerp(0.5, 1.55, e), z = lerp(-3.4, 0.6, e);
          const speed = Math.sin(Math.PI * u) * 2.1;
          rig.update(x, z, face, ANIM.RUN, 0, 0, speed, ctxFor(dt, x, z));
          this.camera.position.set(lerp(-0.45, 0, e), lerp(1.7, 1.45, e), Math.max(6.4, 3.6 / this.camera.aspect) + (1 - e) * 1.2);
          this.camera.lookAt(0, 1.15, 0);
          this.boards.forEach((b, i) => { b.position.x = (i ? 1 : -1) * lerp(1.2, 3.2, e); });
        },
      },
      {
        dur: 650,
        tick: (u, dt) => { rig.update(1.55, 0.6, face, ANIM.RUN, 0, 0, 0, ctxFor(dt, 1.55, 0.6)); },
      },
    ];
    this.active = timeline(segs, render);
    return this.active.promise;
  }

  /** Fast-forward whichever sequence is currently running. */
  skipAll() { if (this.active) this.active.skip(); }

  hold() {
    let last = performance.now();
    const frame = () => {
      if (this.disposed) return;
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (this.rig) this.rig.update(1.55, 0.6, Math.PI / 2, ANIM.RUN, 0, 0, 0, { dt, t: now / 1000, ballX: 1.55, ballY: 0, ballZ: 5, scorer: -1, idx: 0 });
      this._render(dt); this.idleFrame = requestAnimationFrame(frame);
    };
    frame();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.idleFrame);
    if (this.active) { this.active.stop(); this.active = null; }
    window.removeEventListener('resize', this._onResize);
    if (this.rig) { this.scene.remove(this.rig.root); this.rig.dispose(); this.rig = null; }
    if (this._geoHeld) { releaseGeometry(); this._geoHeld = false; }
    if (this.shared) { this.shared.dispose(); this.shared = null; }
    this.audio.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => m.dispose && m.dispose()); }
    });
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------- end-of-reveal walkout figure (NEW animation)
const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
/**
 * The player standing beside the revealed card (packopen_fut.js, walkouts only). A small transparent
 * WebGL canvas: he walks in a few eased steps from the side, turns to camera, celebrates ONCE, then
 * stands with the rig's own idle breathing / weight shift. Fixed camera, no shadows, pixel ratio <= 1.5.
 * Throws from the constructor when WebGL is unavailable (the caller just skips the figure).
 */
export class WalkoutFigure {
  constructor(canvas, { player, kit, accent = '#ffc933' } = {}) {
    this.canvas = canvas; this.disposed = false; this.raf = 0;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    const scene = new THREE.Scene(); this.scene = scene;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    camera.position.set(0, 1.1, 5.0); camera.lookAt(0, 1.05, 0);
    this.camera = camera;
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2418, 1.1));
    const key = new THREE.DirectionalLight(0xfff1de, 2.3); key.position.set(-2.5, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 2.2); rim.position.set(2.5, 3, -4); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.6); fill.position.set(3, 1.5, 3); scene.add(fill);

    const geo = acquireGeometry(); this._geoHeld = true;
    this.shared = new SharedMaterials();
    this.rig = new PlayerRig(geo, this.shared, null, { shadows: false });
    this.rig.setIdentity(player || null, kit || { primary: '#2a3a55', secondary: '#ffffff', number: 10 }, (player && (player.id || player.name)) || 'walkout');
    scene.add(this.rig.root);
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || 200)), h = Math.max(1, Math.round(r.height || 400));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Timeline (seconds): 0-1.7 walk in from the right, 1.7-2.2 turn to camera, 2.3-4.0 one celebration, then idle. */
  play() {
    const WALK = 1.7, TURN_END = 2.2, CEL0 = 2.3, CEL1 = 4.0;
    const x0 = 1.9, faceCam = Math.PI / 2, faceLeft = Math.PI;
    const t0 = performance.now(); let last = t0, x = x0;
    const frame = (now) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000)); last = now;
      const t = (now - t0) / 1000;
      let anim = ANIM.RUN, animT = 0, speed = 0, face = faceCam;
      if (t < WALK) {
        const u = t / WALK;
        const nx = x0 * (1 - smooth01(u));
        speed = dt > 0 ? Math.abs(nx - x) / dt : 0; x = nx;
        speed = Math.min(1.9, speed);
        face = faceLeft;
      } else {
        x = 0;
        face = t < TURN_END ? lerp(faceLeft, faceCam, smooth01((t - WALK) / (TURN_END - WALK))) : faceCam;
        if (t >= CEL0 && t < CEL1) { anim = ANIM.CELEB; animT = t - CEL0; }
      }
      // look at the camera (+z) once he has turned; ahead of him while walking
      const lookX = t < WALK ? x - 3 : 0, lookZ = t < WALK ? 0.5 : 5;
      this.rig.update(x, 0, face, anim, animT, 0, speed, { dt, t, ballX: lookX, ballY: 1, ballZ: lookZ, scorer: -1, idx: 0 });
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(frame);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResize);
    if (this.rig) { this.scene.remove(this.rig.root); this.rig.dispose(); this.rig = null; }
    if (this._geoHeld) { releaseGeometry(); this._geoHeld = false; }
    if (this.shared) { this.shared.dispose(); this.shared = null; }
    this.scene.traverse((o) => { if (o.material && o.material.dispose) o.material.dispose(); });
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* ignore */ }
  }
}
