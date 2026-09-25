// Pitchside 3D — match engine entry point.
// export function createMatch(container, opts) -> MatchHandle   (see docs/3D_CONTRACT.md)
import { loadKeybinds, DEFAULT_KEYBINDS } from '../shared/keybinds.js';
import { MatchSim } from './core/sim.js';
import { viewFromSim, encodeSnapshot, lerpView } from './core/snapshot.js';
import { DT, PHASE, SP, PITCH } from './core/constants.js';
import { predictBall } from './core/physics.js';
import { InputManager, emptyInput } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { MatchAudio } from './ui/audio.js';

const SIDES = ['home', 'away'];
const SP_TOAST = { [SP.THROW]: 'THROW-IN', [SP.CORNER]: 'CORNER', [SP.GOALKICK]: 'GOAL KICK', [SP.FREEKICK]: 'FREE KICK' };
const BOOL_KEYS = ['sprint', 'pass', 'through', 'lob', 'shoot', 'switchP', 'tackle', 'skill', 'finesse'];

function sanitizeInput(i) {
  const o = emptyInput();
  if (!i || typeof i !== 'object') return o;
  const num = (v) => (Number.isFinite(+v) ? Math.max(-1, Math.min(1, +v)) : 0);
  o.mx = num(i.mx); o.my = num(i.my); o.aimX = num(i.aimX); o.aimY = num(i.aimY);
  o.shootPower = Math.max(0, num(i.shootPower));
  for (const k of BOOL_KEYS) o[k] = !!i[k];
  return o;
}

function mergeBinds(b) {
  return { p1: { ...DEFAULT_KEYBINDS.p1, ...((b && b.p1) || {}) }, p2: { ...DEFAULT_KEYBINDS.p2, ...((b && b.p2) || {}) } };
}

export function createMatch(container, opts = {}) {
  const home = opts.home, away = opts.away;
  if (!container || !home || !away) throw new Error('createMatch(container, {home, away, ...}) requires a container and two teams');
  const controllers = { home: 'p1', away: 'ai', ...(opts.controllers || {}) };
  const netRole = opts.netRole || 'local';
  const binds = opts.keybinds ? mergeBinds(opts.keybinds) : loadKeybinds();
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : () => {};
  const stadium = opts.stadium === 'night' ? 'night' : 'day';
  const touch = typeof window !== 'undefined' && 'ontouchstart' in window;
  const quality = opts.quality || (touch ? 'med' : 'high');
  const local = SIDES.map((s) => (controllers[s] === 'p1' || controllers[s] === 'p2' ? controllers[s] : null));
  const localCount = local.filter(Boolean).length;

  // ---------------------------------------------------------------- DOM
  let restorePos = null;
  if (getComputedStyle(container).position === 'static') { restorePos = container.style.position; container.style.position = 'relative'; }
  const root = document.createElement('div');
  root.className = 'ps3d-root';
  root.tabIndex = 0;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;z-index:1;';
  root.appendChild(stage);
  container.appendChild(root);

  // ---------------------------------------------------------------- state
  let destroyed = false, paused = false, menuOpen = false, ended = false, endCalled = false;
  let camMode = 'broadcast';
  let R = null;
  let raf = 0, last = performance.now(), acc = 0;
  const remoteInputs = [null, null];
  const snaps = [];
  let timeOffset = null;
  let lastFx = 0;
  let replay = null;
  const replayDone = new Set();
  const frames = [];
  let recAcc = 0;
  let ftSeenAt = 0;
  let lastView = null;
  let rosterVer = -1, roster = null;

  const sim = netRole === 'guest' ? null : new MatchSim({
    home, away, halfMinutes: opts.halfMinutes || 3, difficulty: opts.difficulty || 'pro',
    controllers: { home: controllers.home, away: controllers.away }, seed: opts.seed,
  });

  const audio = new MatchAudio();
  const hud = new Hud(root, {
    home, away, binds, slots: local,
    onResume: () => resume(),
    onCamera: () => toggleCamera(),
    onQuit: () => quit(),
  });
  const input = new InputManager(root, binds, {
    touch,
    onCommand: (cmd) => {
      if (destroyed) return;
      audio.unlock();
      if (cmd === 'pause') { if (menuOpen) resume(); else openMenu(); }
      else if (cmd === 'camera') toggleCamera();
      else if (cmd === 'any' && replay) endReplay(true);
    },
  });

  // renderer (owned by the render module; loaded asynchronously)
  import('./render/index.js')
    .then((m) => m.createRenderer)
    .catch((err) => {
      console.warn('[pitchside-engine] render/index.js unavailable, using fallback renderer:', err && err.message);
      return import('./fallback/index.js').then((m) => m.createRenderer);
    })
    .then((create) => {
      if (destroyed) return;
      R = create(stage, { home, away, stadium, quality });
      if (R.domElement && R.domElement.parentNode !== stage && !stage.contains(R.domElement)) stage.appendChild(R.domElement);
      R.setCamera(camMode);
      hud.setLoaded();
      R.resize();
    })
    .catch((err) => console.error('[pitchside-engine] renderer failed to start', err));

  const onResize = () => { if (R) R.resize(); };
  window.addEventListener('resize', onResize);
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onResize); ro.observe(container); }

  // ---------------------------------------------------------------- helpers
  const safe = (fn, arg) => { try { fn(arg); } catch (e) { console.error('[pitchside-engine] callback error', e); } };

  function playerData(idx) {
    const v = lastView;
    const rv = v ? v.rv || 0 : 0;
    if (!roster || rv !== rosterVer) {
      roster = [...home.players.slice(0, 11), ...away.players.slice(0, 11)];
      for (const [team, i, bi] of (v && v.subs) || []) {
        const bench = (team === 0 ? home.bench : away.bench) || [];
        if (bench[bi]) roster[team * 11 + i] = bench[bi];
      }
      rosterVer = rv;
    }
    return roster[idx] || { name: '', number: '' };
  }

  function camYaw(view) {
    if (R && typeof R.getCameraYaw === 'function') { const y = R.getCameraYaw(); if (Number.isFinite(y)) return y; }
    if (camMode === 'pro' && view) {
      const s = local[0] ? 0 : 1;
      const d = s === 0 ? view.dir : -view.dir;
      return d > 0 ? 0 : Math.PI;
    }
    return -Math.PI / 2;
  }

  // screen-relative device input -> canonical InputState (relative to the standard broadcast view)
  function toCanonical(raw, yaw) {
    const o = { ...raw };
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const rx = -fz, rz = fx;
    const conv = (a, b) => {
      const wx = a * rx + b * fx, wz = a * rz + b * fz;
      return [wx, -wz];
    };
    [o.mx, o.my] = conv(raw.mx, raw.my);
    [o.aimX, o.aimY] = conv(raw.aimX, raw.aimY);
    return o;
  }

  function sideInput(i, canon) {
    const c = controllers[SIDES[i]];
    if (c === 'p1' || c === 'p2') return canon[c];
    if (c === 'remote') return remoteInputs[i];
    return null;
  }

  function guestView(nowMs) {
    if (!snaps.length) return null;
    const nowS = nowMs / 1000;
    const latest = snaps[snaps.length - 1];
    const off = latest.snap.t - latest.at / 1000;
    timeOffset = timeOffset == null ? off : timeOffset + (off - timeOffset) * 0.05;
    if (Math.abs(off - timeOffset) > 1) timeOffset = off;
    const rt = nowS + timeOffset - 0.1;
    if (rt >= latest.snap.t) return latest.snap;
    for (let i = snaps.length - 2; i >= 0; i--) {
      const a = snaps[i].snap;
      if (a.t <= rt) {
        const b = snaps[i + 1].snap;
        return lerpView(a, b, (rt - a.t) / ((b.t - a.t) || 1));
      }
    }
    return snaps[0].snap;
  }

  // ---------------------------------------------------------------- replay
  function startReplay(gt) {
    const fr = frames.filter((f) => f.t >= gt - 4.8 && f.t <= gt + 1.7);
    replayDone.add(gt);
    if (fr.length < 20) { if (sim) sim.skipReplay(); return; }
    replay = { frames: fr, clock: 0, t0: fr[0].t, gt, seen: new Set() };
    if (R) R.setCamera('replay');
  }
  function endReplay(skipped) {
    if (!replay) return;
    replay = null;
    if (R) R.setCamera(camMode);
    if (sim && (sim.phase === PHASE.REPLAY || sim.phase === PHASE.GOAL)) sim.skipReplay();
    void skipped;
  }
  function replayView(dt) {
    const rp = replay;
    const tt0 = rp.t0 + rp.clock;
    const slow = tt0 > rp.gt - 1.2 && tt0 < rp.gt + 0.4 ? 0.45 : 1;
    rp.clock += dt * slow;
    const tt = rp.t0 + rp.clock;
    const fr = rp.frames;
    if (tt >= fr[fr.length - 1].t) { endReplay(false); return null; }
    let i = 0;
    while (i < fr.length - 2 && fr[i + 1].t <= tt) i++;
    const a = fr[i], b = fr[i + 1];
    const v = lerpView(a.v, b.v, (tt - a.t) / ((b.t - a.t) || 1));
    v.replay = true;
    v.aim = [null, null]; v.traj = null; v.penAim = null; v.pw = [0, 0];
    v.local = local;
    // replay the net ripple / kick sounds
    for (const f of a.v.fx || []) {
      if (f.t > tt || rp.seen.has(f.id) || f.t < tt - 0.3) continue;
      rp.seen.add(f.id);
      if (f.k === 'kick') audio.kick(f.s);
      else if (f.k === 'net') audio.net(f.s);
    }
    v.fx = (a.v.fx || []).filter((f) => f.t <= tt).map((f) => ({ ...f, id: 1e9 + f.id }));
    return v;
  }

  // ---------------------------------------------------------------- fx -> HUD / audio / events
  function processFx(view) {
    for (const f of view.fx || []) {
      if (f.id <= lastFx) continue;
      lastFx = f.id;
      const minute = Math.floor(((view.h - 1) * 2700 + view.cl) / 60) + 1;
      switch (f.k) {
        case 'kick': audio.kick(f.s); break;
        case 'whistle': audio.whistle(f.n); break;
        case 'net': audio.net(f.s); break;
        case 'post': audio.post(); hud.toast('WOODWORK!', '#ffe14d'); break;
        case 'save': audio.ooh(); hud.toast('SAVE!', '#46d17a'); break;
        case 'goal': {
          audio.goal();
          const pd = playerData(f.pi);
          hud.bannerMsg('GOAL!', `${pd.name || ''}${f.og ? ' (OG)' : ''}  ${Math.min(minute, view.h * 45 + (view.ad || 0))}'`, 'goal', 3.2);
          if (!sim) safe(onEvent, { type: 'goal', team: SIDES[f.team], playerId: pd.id, playerName: pd.name, minute, ownGoal: !!f.og, score: [...view.sc] });
          break;
        }
        case 'foul': {
          if (f.pen) { hud.bannerMsg('PENALTY!', '', '', 2.2); audio.cheer(0.6); }
          else hud.toast('FOUL', '#ff9f1a');
          if (!sim) { const pd = playerData(f.pi); safe(onEvent, { type: 'foul', team: SIDES[f.pi < 11 ? 0 : 1], playerId: pd.id, playerName: pd.name, minute, penalty: !!f.pen }); }
          break;
        }
        case 'card': {
          const pd = playerData(f.pi);
          const red = f.c === 'r';
          hud.bannerMsg(red ? 'RED CARD' : 'YELLOW CARD', pd.name || '', red ? 'red' : 'yellow', 2.2, red ? '#e11d2a' : '#ffd400');
          if (!sim) safe(onEvent, { type: 'card', card: red ? 'red' : 'yellow', team: SIDES[f.pi < 11 ? 0 : 1], playerId: pd.id, playerName: pd.name, minute });
          break;
        }
        case 'offside': hud.toast('OFFSIDE', '#ffd400'); break;
        case 'setpiece':
          if (f.type === SP.KICKOFF) { if (view.h === 1 && view.cl < 1 && view.sc[0] + view.sc[1] === 0) hud.bannerMsg('KICK-OFF', `${home.name} v ${away.name}`, '', 2); }
          else if (f.type !== SP.PENALTY && SP_TOAST[f.type]) hud.toast(SP_TOAST[f.type]);
          break;
        case 'sub': {
          const team = f.team === 0 ? home : away;
          const inP = (team.bench || [])[f.bi];
          hud.toast(`SUBSTITUTION ${team.short || ''}: ${inP ? inP.name : ''} ON`, '#46d17a', 2.5);
          if (!sim) safe(onEvent, { type: 'sub', team: SIDES[f.team], inId: inP && inP.id, minute });
          break;
        }
        case 'added': hud.toast(`+${f.n} MIN ADDED TIME`, '#16a34a', 2.5); break;
        case 'halftime':
          hud.bannerMsg('HALF TIME', `${home.short} ${view.sc[0]} - ${view.sc[1]} ${away.short}`, '', 3.2);
          hud.showStats(view, 'HALF TIME', 3.4);
          if (!sim) safe(onEvent, { type: 'halftime', score: [...view.sc], minute: 45 });
          break;
        case 'fulltime':
          hud.bannerMsg('FULL TIME', `${home.short} ${view.sc[0]} - ${view.sc[1]} ${away.short}`, '', 4);
          hud.showStats(view, 'FULL TIME', 6);
          if (!sim) safe(onEvent, { type: 'fulltime', score: [...view.sc], minute: 90 });
          break;
        case 'cut': hud.fade(); break;
      }
    }
  }

  function excitement(view) {
    const bx = view.b[0];
    let e = Math.max(0, 1 - (PITCH.HL - Math.abs(bx)) / 32) * 0.55;
    if (view.ph === PHASE.GOAL) e = 1;
    if (view.spt === SP.PENALTY) e = Math.max(e, 0.6);
    return e;
  }

  // ---------------------------------------------------------------- main loop
  function frame(nowMs) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
    last = nowMs;
    input.poll();
    const yaw = camYaw(lastView);
    const raw = { p1: input.read('p1', 'frame'), p2: input.read('p2', 'frame') };
    const canon = { p1: toCanonical(raw.p1, yaw), p2: toCanonical(raw.p2, yaw) };
    let view;
    if (sim) {
      if (!paused && !ended) {
        acc += dt;
        const ins = [sideInput(0, canon), sideInput(1, canon)];
        let n = 0;
        while (acc >= DT && n < 14) { sim.step(DT, ins); acc -= DT; n++; }
        if (n >= 14) acc = 0;
        for (const e of sim.drainEvents()) safe(onEvent, e);
      }
      view = viewFromSim(sim);
    } else {
      view = guestView(nowMs);
    }
    if (!view) { hud.update(null, { dt }); return; }
    lastView = view;
    // record for replays
    recAcc += dt;
    if (recAcc >= 1 / 30 && !replay) {
      recAcc = 0;
      frames.push({ t: view.t, v: view });
      while (frames.length && frames[0].t < view.t - 9) frames.shift();
    }
    processFx(view);
    // replay control
    if (!replay && view.ph === PHASE.REPLAY && !replayDone.has(view.gt)) startReplay(view.gt);
    if (replay && view.ph !== PHASE.REPLAY && view.ph !== PHASE.GOAL) endReplay(false);
    let rv = replay && !paused ? replayView(dt) : null;
    if (replay && paused) rv = replay.lastV || null;
    if (replay && rv) replay.lastV = rv;
    // local-only render extras
    const out = rv || { ...view };
    if (!rv) {
      out.local = local;
      out.aim = [null, null];
      out.pw = [0, 0];
      out.traj = null; out.penAim = null;
      for (let s = 0; s < 2; s++) {
        const slot = local[s];
        if (!slot) continue;
        out.pw[s] = input.power[slot] || 0;
        const idx = view.c[s];
        const c = canon[slot];
        const l = Math.hypot(c.mx, c.my);
        if (idx >= 0 && (view.bo === idx || out.pw[s] > 0) && view.ph === PHASE.PLAY) {
          if (l > 0.2) out.aim[s] = { x: c.mx / l, z: -c.my / l };
          else { const f = view.p[idx * 7 + 2]; out.aim[s] = { x: Math.cos(f), z: Math.sin(f) }; }
        }
        if (sim && sim.aimInfo[s] && sim.aimInfo[s].setPiece) {
          const ai = sim.aimInfo[s];
          if (ai.preview) {
            const pr = predictBall({ p: ai.preview.from, v: ai.preview.vel, w: ai.preview.spin }, 2.6, 0.06);
            const arr = [];
            for (const q of pr) arr.push(q.x, q.y, q.z);
            out.traj = arr;
          }
          if (ai.type === SP.PENALTY) out.penAim = { x: sim.goalX(s), y: ai.aimY, z: ai.aimZ };
        }
      }
    }
    if (R) {
      R.setControlled([view.c[0], view.c[1]]);
      try { R.render(out, dt); } catch (e) { if (!frame.warned) { frame.warned = true; console.error('[pitchside-engine] render error', e); } }
    }
    hud.update(out, {
      dt, local, replay: !!rv, power: out.pw || [0, 0], playerData,
      project: R && typeof R.project === 'function' ? (x, y, z) => R.project(x, y, z) : null,
    });
    audio.update(dt, excitement(view), paused || menuOpen);
    // end of match
    if (!endCalled) {
      if (sim && sim.ended && sim.t - sim.phaseT > 4.5) finish(sim.result);
      else if (!sim && view.ph === PHASE.FULLTIME && view.fin) {
        if (!ftSeenAt) ftSeenAt = nowMs;
        else if (nowMs - ftSeenAt > 4500) finish(view.fin);
      }
    }
  }
  raf = requestAnimationFrame(frame);

  function finish(result) {
    if (endCalled) return;
    endCalled = true; ended = true;
    safe(onEnd, result);
  }

  function currentResult(abandoned) {
    if (sim) return sim.buildResult(abandoned);
    const v = lastView;
    const st = (v && v.st) || [50, 0, 0, 0, 0, 0, 0];
    const res = {
      homeGoals: v ? v.sc[0] : 0, awayGoals: v ? v.sc[1] : 0,
      scorers: ((v && v.scr) || []).map(([playerId, team, minute, og]) => ({ playerId, team: SIDES[team], minute, ...(og ? { ownGoal: true } : {}) })),
      stats: { possession: [st[0], 100 - st[0]], shots: [st[1], st[2]], shotsOnTarget: [st[3], st[4]], passes: [st[5], st[6]] },
      playerRatings: (v && v.fin && v.fin.playerRatings) || {},
    };
    if (abandoned) res.abandoned = true;
    return res;
  }

  function openMenu() {
    if (ended) return;
    menuOpen = true; paused = true;
    hud.showMenu(true, { camera: camMode });
  }
  function resume() {
    menuOpen = false; paused = false;
    hud.showMenu(false);
    last = performance.now();
    root.focus({ preventScroll: true });
  }
  function toggleCamera() {
    camMode = camMode === 'broadcast' && localCount === 1 ? 'pro' : 'broadcast';
    if (R && !replay) R.setCamera(camMode);
    hud.toast(camMode === 'pro' ? 'PRO CAMERA' : 'BROADCAST CAMERA', '#9fb6de', 1.2);
    return camMode;
  }
  function quit() {
    menuOpen = false;
    hud.showMenu(false);
    paused = true;
    finish(currentResult(true));
  }

  // ---------------------------------------------------------------- handle
  return {
    pause() { paused = true; },
    resume() { resume(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      input.dispose();
      hud.dispose();
      audio.dispose();
      if (R) { try { R.destroy(); } catch (e) { console.error(e); } R = null; }
      root.remove();
      if (restorePos != null) container.style.position = restorePos;
    },
    setRemoteInput(side, inp) {
      const i = SIDES.indexOf(side);
      if (i >= 0) remoteInputs[i] = sanitizeInput(inp);
    },
    getSnapshot() {
      return sim ? encodeSnapshot(sim) : null;
    },
    applySnapshot(snap) {
      if (sim || !snap || !Array.isArray(snap.p)) return;
      const lastS = snaps[snaps.length - 1];
      if (lastS && snap.t <= lastS.snap.t) return;
      snaps.push({ snap, at: performance.now() });
      if (snaps.length > 40) snaps.shift();
    },
    getLocalInput(side) {
      const i = SIDES.indexOf(side);
      const slot = (i >= 0 && local[i]) || (controllers[side] === 'p2' ? 'p2' : 'p1');
      const raw = input.read(slot, 'net');
      const o = toCanonical(raw, camYaw(lastView));
      o.shootPower = input.power[slot] || 0;
      return o;
    },
  };
}
