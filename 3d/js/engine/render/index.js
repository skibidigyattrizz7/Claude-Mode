// Pitchside 3D — procedural Three.js match renderer.
// createRenderer(container, { home, away, stadium: 'day'|'night', quality: 'low'|'med'|'high' })
//   -> { render(view, dt), setCamera(mode), setControlled([homeIdx|-1, awayIdx|-1]), resize(), destroy(), domElement }
// `view` is produced by core/snapshot.js viewFromSim()/lerpView().
import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH, ANIM, PHASE, GOAL } from '../core/constants.js';
import { buildPitch, buildGoals, buildFlags } from './pitch.js';
import { buildStadium } from './stadium.js';
import { buildBall } from './ball.js';
import { CameraDirector } from './camera.js';
import { buildMarkers } from './markers.js';
import { buildOverlays, buildNightShadows } from './extras.js';
import { PlayerRig, KitMaterials, SharedMaterials, acquireGeometry, releaseGeometry } from './player.js';
import { radialTexture } from './textures.js';
import { AdminRender } from './admin.js';
import { resolveMatchKits, colorDist, CLASH_THRESHOLD } from '../core/kits.js';

const STRIDE = 7;

// Defers a unit of work to a spare moment on the main thread (falls back to a macrotask when
// requestIdleCallback isn't available), so building the stadium's crowd/ad boards doesn't delay
// the first rendered frame of the match.
const idle = (fn) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 500 });
  else setTimeout(fn, 0);
};
const HL = PITCH.HL, HW = PITCH.HW;

const QUALITY = {
  low: { pr: 1, antialias: false, shadows: false, shadowSize: 0, crowdSpacing: 1.05, crowdFill: 0.8, pitchTex: 2048, aniso: 4, roofShadow: false, trail: false, spots: false },
  med: { pr: 1.5, antialias: true, shadows: true, shadowSize: 2048, crowdSpacing: 0.72, crowdFill: 0.9, pitchTex: 4096, aniso: 8, roofShadow: false, trail: true, spots: true },
  high: { pr: 2, antialias: true, shadows: true, shadowSize: 4096, crowdSpacing: 0.54, crowdFill: 0.95, pitchTex: 4096, aniso: 16, roofShadow: false, trail: true, spots: true },
};

const REF_KITS = [
  { primary: '#101214', secondary: '#f2d200', number: '#f2d200', shorts: '#101214', socks: '#101214' },
  { primary: '#e8e21a', secondary: '#111111', number: '#111111', shorts: '#111111', socks: '#111111' },
  { primary: '#e0197d', secondary: '#111111', number: '#111111', shorts: '#111111', socks: '#e0197d' },
];

export function createRenderer(container, opts = {}) {
  const home = opts.home || {}, away = opts.away || {};
  const night = opts.stadium === 'night';
  const q = QUALITY[opts.quality] || QUALITY.med;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = night ? 0.88 : 1.0;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = opts.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const dom = renderer.domElement;
  dom.style.display = 'block';
  dom.style.width = '100%';
  dom.style.height = '100%';
  container.appendChild(dom);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(night ? 0x05070d : 0x9cc3e6);
  scene.fog = new THREE.Fog(night ? 0x0a0e18 : 0xc9d9e6, 260, 1500);
  const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.4, 3200);
  camera.position.set(0, 23, 70);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(night ? 0x8898c0 : 0xd6e8ff, night ? 0x1b261b : 0x4b6a3a, night ? 0.22 : 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(night ? 0xe8efff : 0xfff1dc, night ? 0.85 : 2.9);
  const sunDir = night ? new THREE.Vector3(0.15, 1, 0.35).normalize() : new THREE.Vector3(-0.38, 0.8, 0.46).normalize();
  sun.castShadow = q.shadows;
  if (q.shadows) {
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const e = 42;
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
  }
  scene.add(sun, sun.target);
  const spots = [];
  if (night) {
    const n = q.spots ? 4 : 0;
    for (let i = 0; i < n; i++) {
      const xs = i & 1 ? 1 : -1, zs = i & 2 ? 1 : -1;
      const s = new THREE.SpotLight(0xf4f6ff, 1.25, 0, 0.5, 0.9, 0);
      s.position.set(xs * 85, 60, zs * 64);
      s.target.position.set(xs * 12, 0, zs * 6);
      scene.add(s, s.target);
      spots.push(s);
    }
    if (!n) hemi.intensity = 1.0;
  } else {
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45);
    fill.position.set(30, 40, -80);
    scene.add(fill);
  }

  // ---------------------------------------------------------------- world
  const pitch = buildPitch(scene, q, maxAniso, track);
  const goals = buildGoals(scene, q, track);
  const flags = buildFlags(scene, q, track);
  const stadium = buildStadium(scene, opts, q, track, idle);
  const ball = buildBall(scene, q, track);
  const markers = buildMarkers(scene, track);
  const director = new CameraDirector(camera);
  const overlays = buildOverlays(scene, track);
  const adm = new AdminRender(scene, { home, away, shadows: q.shadows });
  const nightShadows = night ? buildNightShadows(scene, stadium.towers, 25, track) : null;
  const figs = Array.from({ length: 25 }, () => ({ x: 0, z: 0, h: 1.8, vis: false }));

  // ---------------------------------------------------------------- players
  const geo = acquireGeometry();
  const shared = new SharedMaterials();
  // Resolved once per match: home keeps its kit, away falls back away -> third -> a freshly
  // generated contrasting kit if it would otherwise clash (perceptual colour distance, not an
  // exact-match check), and both GK kits are nudged away from both outfield kits. Idempotent,
  // so calling it here again after engine/index.js already resolved home/away is harmless.
  const resolved = resolveMatchKits(home, away);
  const kits = {
    h: new KitMaterials(resolved.home),
    hg: new KitMaterials(resolved.homeGk),
    a: new KitMaterials(resolved.away),
    ag: new KitMaterials(resolved.awayGk),
  };
  // referee kit that doesn't clash with either team or either goalkeeper
  let refKit = REF_KITS[0];
  for (const k of REF_KITS) {
    const ok = [resolved.home, resolved.away, resolved.homeGk, resolved.awayGk].every((tk) => colorDist(tk.primary, k.primary) > CLASH_THRESHOLD);
    if (ok) { refKit = k; break; }
  }
  kits.r = new KitMaterials(refKit);
  const blobTex = track(radialTexture('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)'));
  const blobMat = track(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, opacity: q.shadows ? 0.55 : 0.85 }));
  const rigs = [];
  const playerGroup = new THREE.Group();
  scene.add(playerGroup);
  // weather (opts.weather 'rain' | 'snow'): falling particles around the camera
  let weatherFx = null;
  if (opts.weather === 'rain' || opts.weather === 'snow') {
    const snow = opts.weather === 'snow';
    const N = snow ? 2600 : 3200, BX = 60, BY = 30, BZ = 60;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * BX; pos[i * 3 + 1] = Math.random() * BY; pos[i * 3 + 2] = (Math.random() - 0.5) * BZ; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: snow ? 0xffffff : 0xaec4e0, size: snow ? 0.16 : 0.07, transparent: true, opacity: snow ? 0.9 : 0.55, depthWrite: false });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 6;
    scene.add(pts);
    disposables.push(geo, mat);
    if (!snow) scene.fog = new THREE.Fog(0x8a96a8, 70, 230);
    weatherFx = {
      update(dt, cam) {
        const vy = snow ? 1.4 : 16, drift = snow ? 0.5 : 1.5;
        for (let i = 0; i < N; i++) {
          let y = pos[i * 3 + 1] - vy * dt * (0.8 + (i % 5) * 0.1);
          pos[i * 3] += drift * dt * (snow ? Math.sin(i + y) : 1);
          if (y < 0) { y += BY; pos[i * 3] = (Math.random() - 0.5) * BX; pos[i * 3 + 2] = (Math.random() - 0.5) * BZ; }
          pos[i * 3 + 1] = y;
        }
        pts.position.set(cam.position.x * 0.9, 0, cam.position.z * 0.6);
        geo.attributes.position.needsUpdate = true;
      },
    };
  }
  const makeRig = (kitMats, isGK) => {
    const r = new PlayerRig(geo, shared, kitMats, { isGK, shadows: q.shadows });
    const blob = new THREE.Mesh(geo.blob, blobMat);
    blob.position.y = 0.015; blob.scale.set(1.1, 1, 1.1); blob.renderOrder = 1;
    r.root.add(blob);
    r.blob = blob;
    playerGroup.add(r.root);
    return r;
  };
  for (let i = 0; i < 22; i++) {
    const team = i < 11 ? 0 : 1, gk = i % 11 === 0;
    rigs.push(makeRig(team === 0 ? (gk ? kits.hg : kits.h) : (gk ? kits.ag : kits.a), gk));
  }
  const refs = [0, 1, 2].map(() => makeRig(kits.r, false));
  refs.forEach((r, i) => r.setIdentity({ id: 'ref' + i, name: '', number: '' }, refKit, 'ref' + i));
  const refState = [
    { x: -10, z: 8, face: 0, spd: 0 },
    { x: 20, z: -(HW + 0.9), face: Math.PI / 2, spd: 0 },
    { x: -20, z: HW + 0.9, face: -Math.PI / 2, spd: 0 },
  ];

  let rosterVer = -1;
  const rosterData = (idx, subs) => {
    const team = idx < 11 ? 0 : 1, i = idx % 11;
    const t = team ? away : home;
    let pd = (t.players || [])[i];
    if (subs) for (const s of subs) if (s[0] === team && s[1] === i && t.bench && t.bench[s[2]]) pd = t.bench[s[2]];
    return pd || { id: `${team}-${i}`, name: '', number: i + 1 };
  };
  const applyRoster = (subs) => {
    for (let i = 0; i < 22; i++) {
      const team = i < 11 ? 0 : 1, gk = i % 11 === 0;
      const kit = team === 0 ? (gk ? resolved.homeGk : resolved.home) : (gk ? resolved.awayGk : resolved.away);
      rigs[i].setIdentity(rosterData(i, subs), kit, 'p' + i);
    }
  };
  applyRoster(null);

  // ---------------------------------------------------------------- state
  let t = 0;
  let controlled = null; // [h, a] or null -> use view.c
  let lastFx = 0;
  const excite = [0, 0, 0];
  let scorer = -1, scorerT = -99, goalSign = 0;
  let lastView = null;
  let destroyed = false;

  const resize = () => {
    if (destroyed) return;
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();

  const tmpV = new THREE.Vector3();
  const updateRefs = (view, dt) => {
    const b = view.b, p = view.p;
    const bx = b[0], bz = b[2];
    // main referee: diagonal system, keep ~12 m from ball
    const r0 = refState[0];
    let tx = bx * 0.85 - Math.sign(bx || 1) * 4, tz = clamp(-bx * 0.32 + bz * 0.3, -HW + 6, HW - 6);
    const dx = tx - bx, dz = tz - bz, dd = Math.hypot(dx, dz);
    if (dd < 11) { const k = 11 / (dd || 1); tx = bx + dx * k; tz = bz + dz * k; }
    moveRef(r0, clamp(tx, -HL + 3, HL - 3), clamp(tz, -HW + 2, HW - 2), dt, 7.2);
    r0.face = Math.atan2(bz - r0.z, bx - r0.x);
    // assistants: second-last defender or ball, own half each
    const dirHome = view.dir || 1;
    for (const k of [1, 2]) {
      const sgn = k === 1 ? 1 : -1; // AR1 covers +x half (far side), AR2 covers -x half (near side)
      // team defending the +x goal: home attacks +x if dir=1 => away (team 1) defends +x
      const defTeam = (sgn > 0) === (dirHome > 0) ? 1 : 0;
      const xs = [];
      for (let i = defTeam * 11; i < defTeam * 11 + 11; i++) if (!((view.so || 0) & (1 << i))) xs.push(p[i * STRIDE] * sgn);
      xs.sort((a, c) => c - a);
      const second = xs.length > 1 ? xs[1] : 0;
      const line = Math.max(second, bx * sgn, 0);
      const r = refState[k];
      const tzA = k === 1 ? -(HW + 0.9) : HW + 0.9;
      moveRef(r, sgn * clamp(line, 0, HL), tzA, dt, 7.5);
      r.z = tzA;
      r.face = k === 1 ? Math.PI / 2 : -Math.PI / 2;
    }
  };
  function moveRef(r, tx, tz, dt, vmax) {
    const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz);
    const want = Math.min(vmax, d * 1.4);
    r.spd += (want - r.spd) * (1 - Math.exp(-dt * 2.5));
    if (d > 0.05) { const s = Math.min(d, r.spd * dt); r.x += (dx / d) * s; r.z += (dz / d) * s; }
    else r.spd *= 0.9;
  }

  let lastReplayFx = 0;
  const processFx = (view) => {
    const fx = view.fx;
    if (!fx) return;
    // live ids increase monotonically; replay frames re-emit fx with ids offset by 1e9
    for (const f of fx) {
      const rep = f.id >= 1e9;
      if (rep ? f.id <= lastReplayFx : f.id <= lastFx) continue;
      if (rep) lastReplayFx = f.id; else lastFx = f.id;
      if (f.k === 'goal') {
        const team = f.team ?? 0;
        excite[team] = 1; excite[2] = Math.max(excite[2], 0.5);
        scorer = f.pi ?? -1; scorerT = t;
        const b = view.b;
        goalSign = b[0] > 0 ? 1 : -1;
        const net = goals.nets[b[0] > 0 ? 1 : 0];
        // ripple on the back netting behind the ball
        const hy = clamp(b[1], 0.2, 2.3), sg = b[0] > 0 ? 1 : -1;
        net.hit(sg * (HL + GOAL.DEPTH - GOAL.DEPTH * 0.45 * (hy / GOAL.H)), hy, clamp(b[2], -3.4, 3.4), 26, t);
      } else if (f.k === 'net') {
        const net = goals.nets[(f.x ?? view.b[0]) > 0 ? 1 : 0];
        net.hit(f.x ?? view.b[0], f.y ?? view.b[1], f.z ?? view.b[2], f.s ?? 15, t);
      } else if (f.k === 'post') {
        excite[0] = Math.max(excite[0], 0.35); excite[1] = Math.max(excite[1], 0.35);
      } else if (f.k === 'admin' && !rep) {
        adm.onFx(f, view);
        excite[2] = Math.max(excite[2], 0.6);
      }
    }
    // a restarted simulation (new match in the same renderer) resets ids
    const last = fx.length ? fx[fx.length - 1].id : 0;
    if (last && last < 1e9 && last < lastFx - 200) lastFx = last;
  };

  const dbg = { noDraw: false };
  const ctx = { dt: 0, t: 0, ballX: 0, ballY: 0, ballZ: 0, scorer: -1, idx: 0 };

  function render(view, dt) {
    if (destroyed) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    t += dt;
    if (view) lastView = view; else view = lastView;
    if (view && view.p) {
      if (view.rv !== undefined && view.rv !== rosterVer) { rosterVer = view.rv; applyRoster(view.subs); }
      processFx(view);
      const b = view.b;
      ctx.dt = dt; ctx.t = t; ctx.ballX = b[0]; ctx.ballY = b[1]; ctx.ballZ = b[2];
      const inGoalPhase = view.ph === PHASE.GOAL || view.ph === PHASE.REPLAY;
      ctx.scorer = inGoalPhase && t - scorerT < 60 ? scorer : -1;
      const p = view.p;
      const so = view.so || 0;
      const n = Math.min(22, Math.floor(p.length / STRIDE));
      for (let i = 0; i < n; i++) {
        const o = i * STRIDE;
        const r = rigs[i];
        const anim = p[o + 3];
        const hidden = (so & (1 << i)) || anim === ANIM.SENTOFF;
        r.root.visible = !hidden;
        if (hidden) continue;
        ctx.idx = i;
        r.update(p[o], p[o + 1], p[o + 2], anim, p[o + 4], p[o + 5], p[o + 6], ctx);
      }
      const admLook = adm.update(view, rigs, dt);
      updateRefs(view, dt);
      for (let k = 0; k < 3; k++) {
        const s = refState[k];
        ctx.idx = -1;
        refs[k].update(s.x, s.z, s.face, ANIM.RUN, 0, 0, s.spd, ctx);
      }
      ball.update(b, dt, t, camera, { owner: view.bo ?? -1, marker: view.ph === PHASE.PLAY, trail: q.trail, scale: admLook.scale, mat: adm.ballMaterial(admLook.look), gm: admLook.gm });
      for (const net of goals.nets) net.update(t, b);
      // crowd excitement
      for (let k = 0; k < 3; k++) excite[k] = Math.max(0, excite[k] - dt * (view.ph === PHASE.GOAL ? 0.03 : 0.12));
      // camera
      let ctrlPos = null;
      const c = controlled || view.c || [-1, -1];
      const ci = c[0] >= 0 ? 0 : c[1] >= 0 ? 1 : -1;
      if (ci >= 0) {
        const idx = c[ci];
        const d = (view.dir || 1) * (ci === 0 ? 1 : -1);
        ctrlPos = { x: p[idx * STRIDE], z: p[idx * STRIDE + 1], dir: d };
      }
      if (view.replay && director.mode !== 'replay') { director.prevMode = director.mode; director.setMode('replay'); }
      else if (!view.replay && director.prevMode && view.ph !== PHASE.REPLAY) { director.setMode(director.prevMode); director.prevMode = null; }
      let focus = null;
      if (view.ph === PHASE.GOAL && scorer >= 0 && scorer < 22 && t - scorerT > 0.8) focus = { x: p[scorer * STRIDE], z: p[scorer * STRIDE + 1] };
      director.update(view, dt, { ctrlPos, goalSign, focus });
      overlays.update(view, rigs, t, c);
      if (nightShadows) {
        for (let i = 0; i < 25; i++) {
          const r = i < 22 ? rigs[i] : refs[i - 22];
          const f = figs[i];
          f.vis = r.root.visible; f.x = r.root.position.x; f.z = r.root.position.z; f.h = 1.8 * (r.body.position.y / 0.975) * r.scale;
        }
        nightShadows.update(figs);
      }
      // markers
      const showMk = !view.replay && view.ph !== PHASE.REPLAY && view.ph !== PHASE.GOAL && view.ph !== PHASE.HALFTIME && view.ph !== PHASE.FULLTIME;
      for (let s = 0; s < 2; s++) {
        const idx = c[s];
        if (showMk && idx >= 0 && idx < 22 && rigs[idx].root.visible) {
          const pd = rosterData(idx, view.subs);
          const loc = view.local && view.local[s];
          markers.update(s, rigs[idx], `${pd.number ?? ''}  ${pd.name || ''}`.trim(), t, camera, loc === 'p1' ? 0 : loc === 'p2' ? 1 : s);
        } else markers.update(s, null);
      }
      // shadow frustum follows the action (texel-snapped)
      if (q.shadows) {
        const lk = director.look;
        const texel = (2 * 42) / q.shadowSize;
        const cx = Math.round(lk.x / texel) * texel, cz = Math.round(lk.z / texel) * texel;
        sun.target.position.set(cx, 0, cz);
        sun.position.set(cx + sunDir.x * 150, sunDir.y * 150, cz + sunDir.z * 150);
      }
    } else {
      director.update({ b: [0, 0, 0, 0, 0, 0], ph: PHASE.KICKOFF }, dt, {});
    }
    flags.update(t);
    stadium.update(t, dt, excite);
    if (weatherFx) weatherFx.update(dt, camera);
    if (!dbg.noDraw) renderer.render(scene, camera);
  }

  function setCamera(mode) {
    if (mode === 'broadcast' || mode === 'pro' || mode === 'replay') director.setMode(mode);
  }
  function setControlled(ids) {
    controlled = Array.isArray(ids) ? [ids[0] ?? -1, ids[1] ?? -1] : null;
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const r of [...rigs, ...refs]) r.dispose();
    adm.dispose();
    for (const k in kits) kits[k].dispose();
    shared.dispose();
    releaseGeometry();
    const seen = new Set();
    scene.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) {
        if (seen.has(m)) continue;
        seen.add(m);
        for (const key in m) { const v = m[key]; if (v && v.isTexture) v.dispose(); }
        if (m.uniforms) for (const u in m.uniforms) { const v = m.uniforms[u].value; if (v && v.isTexture) v.dispose(); }
        m.dispose();
      }
      if (o.isInstancedMesh) o.dispose();
    });
    for (const d of disposables) if (d && d.dispose) d.dispose();
    disposables.length = 0;
    renderer.dispose();
    renderer.forceContextLoss?.();
    if (dom.parentNode) dom.parentNode.removeChild(dom);
    scene.clear();
  }

  const projV = new THREE.Vector3(), fwdV = new THREE.Vector3();
  function project(x, y, z) {
    projV.set(x, y, z).project(camera);
    const w = dom.clientWidth || container.clientWidth, h = dom.clientHeight || container.clientHeight;
    const vis = projV.z > -1 && projV.z < 1 && Math.abs(projV.x) <= 1.05 && Math.abs(projV.y) <= 1.05;
    return { x: (projV.x + 1) * 0.5 * w, y: (1 - projV.y) * 0.5 * h, visible: vis };
  }
  function getCameraYaw() {
    camera.getWorldDirection(fwdV);
    return Math.atan2(fwdV.z, fwdV.x);
  }

  return {
    render, setCamera, setControlled, resize, destroy, project, getCameraYaw, domElement: dom,
    // dev-only hooks (harness / debugging)
    _debug: {
      set noDraw(v) { dbg.noDraw = v; },
      scene, camera, renderer, rigs, refs, director, goals, adm,
      setCameraOverride(pos, look, fov) { director.override = pos ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look), fov } : null; },
      info: () => renderer.info,
    },
  };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
