// Pitchside 3D — match engine entry point.
// export function createMatch(container, opts) -> MatchHandle   (see docs/3D_CONTRACT.md)
import { loadKeybinds, DEFAULT_KEYBINDS } from '../shared/keybinds.js';
import { MatchSim, mergeGameplay } from './core/sim.js';
import { viewFromSim, encodeSnapshot, lerpView } from './core/snapshot.js';
import { DT, PHASE, SP, PITCH, halfBase, GOAL } from './core/constants.js';
import { predictBall } from './core/physics.js';
import { InputManager, emptyInput, EXTRA_BINDS } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { MatchAudio } from './ui/audio.js';
import { Commentary } from './ui/commentary.js';

const SIDES = ['home', 'away'];
const SP_TOAST = { [SP.THROW]: 'THROW-IN', [SP.CORNER]: 'CORNER', [SP.GOALKICK]: 'GOAL KICK', [SP.FREEKICK]: 'FREE KICK' };
const BOOL_KEYS = ['sprint', 'pass', 'through', 'lob', 'shoot', 'switchP', 'tackle', 'skill', 'finesse', 'jockey', 'keeper'];
const NUM_KEYS = ['mx', 'my', 'aimX', 'aimY', 'cx', 'cy', 'kx', 'ky'];
const SKIP_ACTIONS = ['pass', 'shoot', 'lob', 'through', 'finesse', 'skill', 'switchP', 'tackle'];
const TAC_KINDS = ['quick', 'ment', 'set', 'formation', 'swap', 'sub', 'takers'];

function sanitizeInput(i) {
  const o = emptyInput();
  if (!i || typeof i !== 'object') return o;
  const num = (v) => (Number.isFinite(+v) ? Math.max(-1, Math.min(1, +v)) : 0);
  for (const k of NUM_KEYS) o[k] = num(i[k]);
  o.shootPower = Math.max(0, num(i.shootPower));
  for (const k of BOOL_KEYS) o[k] = !!i[k];
  // optional tactics command from a remote side: {seq, cmd:{k, ...}}
  if (i.tac && typeof i.tac === 'object' && Number.isFinite(+i.tac.seq) && i.tac.cmd && TAC_KINDS.includes(i.tac.cmd.k)) {
    try { o.tac = { seq: +i.tac.seq, cmd: JSON.parse(JSON.stringify(i.tac.cmd)) }; } catch { /* ignore */ }
  }
  return o;
}

function mergeBinds(b) {
  return {
    p1: { ...DEFAULT_KEYBINDS.p1, ...EXTRA_BINDS.p1, ...((b && b.p1) || {}) },
    p2: { ...DEFAULT_KEYBINDS.p2, ...EXTRA_BINDS.p2, ...((b && b.p2) || {}) },
  };
}

export function createMatch(container, opts = {}) {
  const home = opts.home, away = opts.away;
  if (!container || !home || !away) throw new Error('createMatch(container, {home, away, ...}) requires a container and two teams');
  const controllers = { home: 'p1', away: 'ai', ...(opts.controllers || {}) };
  const netRole = opts.netRole || 'local';
  const binds = mergeBinds(opts.keybinds || loadKeybinds());
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : () => {};
  const stadium = opts.stadium === 'night' ? 'night' : 'day';
  const weather = ['rain', 'snow'].includes(opts.weather) ? opts.weather : 'clear';
  const touch = typeof window !== 'undefined' && 'ontouchstart' in window;
  const quality = opts.quality || (touch ? 'med' : 'high');
  const local = SIDES.map((s) => (controllers[s] === 'p1' || controllers[s] === 'p2' ? controllers[s] : null));
  const localCount = local.filter(Boolean).length;
  const timeScale = Math.max(1, Math.min(20, +opts.timeScale || 1)); // dev/testing only
  const gpIn = opts.gameplay || {};
  const gp = [mergeGameplay(gpIn.home), mergeGameplay(gpIn.away)];
  // settings that are purely local UI follow the first local human side
  const uiSide = local[0] ? 0 : local[1] ? 1 : 0;
  const uiGp = gp[uiSide];

  // ---------------------------------------------------------------- DOM
  let restorePos = null;
  if (getComputedStyle(container).position === 'static') { restorePos = container.style.position; container.style.position = 'relative'; }
  const root = document.createElement('div');
  root.className = 'ps3d-root';
  root.tabIndex = 0;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;z-index:1;will-change:transform;';
  root.appendChild(stage);
  container.appendChild(root);

  // ---------------------------------------------------------------- state
  let destroyed = false, paused = false, menuOpen = false, ended = false, endCalled = false;
  let camMode = opts.camera === 'pro' && localCount === 1 ? 'pro' : 'broadcast';
  let spCam = false;
  let R = null;
  let raf = 0, last = performance.now(), acc = 0;
  const remoteInputs = [null, null];
  const remoteTacSeq = [-1, -1];
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
  let shake = 0;
  let tacSeq = 0;
  const tacOut = { p1: null, p2: null };
  const aimCache = [null, null];

  const sim = netRole === 'guest' ? null : new MatchSim({
    home, away, halfMinutes: opts.halfMinutes || 3, difficulty: opts.difficulty || 'pro',
    controllers: { home: controllers.home, away: controllers.away }, seed: opts.seed,
    gameplay: { home: gp[0], away: gp[1] }, knockout: !!opts.knockout, weather, maxSubs: opts.maxSubs,
  });

  const audio = new MatchAudio();
  audio.setVolume(Number.isFinite(+opts.volume) ? Math.max(0, Math.min(1, +opts.volume)) : 1);
  const commentary = new Commentary(uiGp.commentary, home, away);
  const hud = new Hud(root, {
    home, away, binds, slots: local, touch,
    onResume: () => resume(),
    onCamera: () => toggleCamera(),
    onQuit: () => quit(),
    onReplay: () => instantReplay(),
    onTactic: (side, cmd) => localTactic(side, cmd),
    teamInfo: (side) => teamInfo(side),
    gameplay: gp,
  });
  hud.camMode = camMode;
  const input = new InputManager(root, binds, {
    touch,
    onCommand: (cmd, arg, slot) => {
      if (destroyed) return;
      audio.unlock();
      if (cmd === 'pause') { if (menuOpen) resume(); else openMenu(); }
      else if (cmd === 'camera') toggleCamera();
      else if (cmd === 'tac') {
        const side = local.indexOf(slot || 'p1');
        if (side >= 0) localTactic(side, arg);
      } else if (cmd === 'any') {
        const isAction = arg === 'pad' || arg === 'touch' || ['p1', 'p2'].some((s) => SKIP_ACTIONS.some((a) => binds[s][a] === arg));
        if (!isAction || menuOpen) return;
        if (replay && !replay.instant) endReplay(true);
        else if (sim && !replay) sim.skipCutscene();
      }
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
      R = create(stage, { home, away, stadium, quality, weather });
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
    [o.cx, o.cy] = conv(raw.cx || 0, raw.cy || 0);
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

  // ---------------------------------------------------------------- tactics
  function localTactic(side, cmd) {
    if (!cmd || !local[side]) return null;
    if (sim) {
      const label = sim.applyTactic(side, cmd);
      if (label) hud.toast(label, '#46d17a', 1.6);
      return label;
    }
    // guest: forwarded to the host with the next input (optional `tac` field)
    tacOut[local[side]] = { seq: ++tacSeq, cmd };
    hud.toast('TACTICS SENT', '#46d17a', 1.2);
    return 'SENT';
  }

  function teamInfo(side) {
    if (sim) return sim.teamInfo(side);
    const t = side === 0 ? home : away;
    return {
      formation: t.formation, tac: t.tactics || {}, subsMade: 0, maxSubs: 5, windows: 0, pending: [], guest: true,
      players: t.players.slice(0, 11).map((d, i) => ({ i, id: d.id, name: d.name, pos: d.pos, role: d.pos, ovr: d.ovr, stam: 1, sentOff: false })),
      bench: (t.bench || []).map((d, bi) => ({ bi, id: d.id, name: d.name, pos: d.pos, ovr: d.ovr, used: false })),
    };
  }

  // ---------------------------------------------------------------- replay
  function startReplay(gt) {
    const fr = frames.filter((f) => f.t >= gt - 4.8 && f.t <= gt + 1.7);
    replayDone.add(gt);
    if (fr.length < 20) { if (sim) sim.skipReplay(); return; }
    replay = { frames: fr, clock: 0, t0: fr[0].t, gt, seen: new Set() };
    if (R) R.setCamera('replay');
  }
  // instant replay of the last ~8 s from the pause menu
  function instantReplay() {
    if (!lastView) return;
    const tEnd = lastView.t;
    const fr = frames.filter((f) => f.t >= tEnd - 8);
    if (fr.length < 10) { hud.toast('NOTHING TO REPLAY', '#ff9f1a'); return; }
    hud.showMenu(false);
    replay = { frames: fr, clock: 0, t0: fr[0].t, gt: tEnd - 1.5, seen: new Set(), instant: true };
    if (R) R.setCamera('replay');
  }
  function endReplay(skipped) {
    if (!replay) return;
    const inst = replay.instant;
    replay = null;
    if (R) R.setCamera(camMode);
    spCam = false;
    if (inst) { if (menuOpen) hud.showMenu(true, { camera: camMode }); return; }
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
  const minuteOf = (view) => Math.floor((halfBase(view.h) + view.cl) / 60) + 1;
  function doShake(a) { if (uiGp.cameraShake) shake = Math.max(shake, a); }

  function processFx(view) {
    for (const f of view.fx || []) {
      if (f.id <= lastFx) continue;
      lastFx = f.id;
      const minute = minuteOf(view);
      switch (f.k) {
        case 'kick': audio.kick(f.s); break;
        case 'whistle': audio.whistle(f.n); break;
        case 'net': audio.net(f.s); break;
        case 'post': audio.post(); hud.toast('WOODWORK!', '#ffe14d'); doShake(0.5); commentary.say('post', {}); break;
        case 'save': audio.ooh(); hud.toast('SAVE!', '#46d17a'); commentary.say('save', { name: playerData(f.pi).name }); break;
        case 'punch': audio.ooh(); hud.toast('PUNCHED CLEAR', '#46d17a', 1.2); break;
        case 'rocket': doShake(0.25); break;
        case 'timed': hud.timed(f.q, f.pi); break;
        case 'goal': {
          audio.goal();
          doShake(1);
          const pd = playerData(f.pi);
          const cap = (halfBase(view.h) + (view.h <= 2 ? 2700 : 900)) / 60 + (view.ad || 0);
          hud.bannerMsg('GOAL!', `${pd.name || ''}${f.og ? ' (OG)' : ''}  ${Math.min(minute, cap)}'`, 'goal', 3.2);
          commentary.say('goal', { name: pd.name, og: !!f.og, score: view.sc, team: f.team });
          if (!sim) safe(onEvent, { type: 'goal', team: SIDES[f.team], playerId: pd.id, playerName: pd.name, minute, ownGoal: !!f.og, score: [...view.sc] });
          break;
        }
        case 'foul': {
          if (f.pen) { hud.bannerMsg('PENALTY!', '', '', 2.2); audio.cheer(0.6); commentary.say('penalty', {}); }
          else hud.toast('FOUL', '#ff9f1a');
          if (!sim) { const pd = playerData(f.pi); safe(onEvent, { type: 'foul', team: SIDES[f.pi < 11 ? 0 : 1], playerId: pd.id, playerName: pd.name, minute, penalty: !!f.pen }); }
          break;
        }
        case 'card': {
          const pd = playerData(f.pi);
          const red = f.c === 'r';
          hud.bannerMsg(red ? 'RED CARD' : 'YELLOW CARD', pd.name || '', red ? 'red' : 'yellow', 2.2, red ? '#e11d2a' : '#ffd400');
          commentary.say(red ? 'red' : 'yellow', { name: pd.name });
          if (!sim) safe(onEvent, { type: 'card', card: red ? 'red' : 'yellow', team: SIDES[f.pi < 11 ? 0 : 1], playerId: pd.id, playerName: pd.name, minute });
          break;
        }
        case 'offside': hud.toast('OFFSIDE', '#ffd400'); break;
        case 'setpiece':
          if (f.type === SP.KICKOFF) {
            if (view.h === 1 && view.cl < 1 && view.sc[0] + view.sc[1] === 0) { hud.bannerMsg('KICK-OFF', `${home.name} v ${away.name}`, '', 2); commentary.say('kickoff', {}); }
          } else if (f.type !== SP.PENALTY && SP_TOAST[f.type]) hud.toast(SP_TOAST[f.type]);
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
          hud.bannerMsg(f.et ? 'EXTRA TIME · HALF TIME' : 'HALF TIME', `${home.short} ${view.sc[0]} - ${view.sc[1]} ${away.short}`, '', 3.2);
          hud.showStats(view, f.et ? 'EXTRA TIME · HALF TIME' : 'HALF TIME', 3.4);
          commentary.say('halftime', { score: view.sc });
          if (!sim && !f.et) safe(onEvent, { type: 'halftime', score: [...view.sc], minute: 45 });
          break;
        case 'etbreak':
          hud.bannerMsg('EXTRA TIME', `${home.short} ${view.sc[0]} - ${view.sc[1]} ${away.short}`, '', 3.2);
          commentary.say('extratime', {});
          break;
        case 'shootout':
          hud.bannerMsg('PENALTIES', 'Best of five, then sudden death', '', 3.2);
          commentary.say('shootout', {});
          break;
        case 'pen': {
          const pd = playerData(f.pi);
          if (f.ok) { audio.goal(); hud.bannerMsg('SCORED', `${pd.name || ''}  ${f.h} - ${f.a}`, 'goal', 1.6); }
          else { audio.ooh(); hud.bannerMsg('MISSED', `${pd.name || ''}  ${f.h} - ${f.a}`, 'red', 1.6); }
          commentary.say(f.ok ? 'penscored' : 'penmissed', { name: pd.name });
          break;
        }
        case 'fulltime': {
          const pens = view.fin && view.fin.pens;
          hud.bannerMsg('FULL TIME', `${home.short} ${view.sc[0]} - ${view.sc[1]} ${away.short}${pens ? `  (${pens[0]} - ${pens[1]} pens)` : ''}`, '', 4);
          hud.showStats(view, 'FULL TIME', 6);
          commentary.say('fulltime', { score: view.sc, pens });
          if (!sim) safe(onEvent, { type: 'fulltime', score: [...view.sc], minute: view.h <= 2 ? 90 : 120 });
          break;
        }
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

  // held kick key -> aim-line preview (host only; throttled)
  function aimTraj(s, slot, view, c, nowMs) {
    const key = input.heldKick[slot];
    if (!sim || !key || !gp[s].showAimLine || view.bo !== view.c[s]) { aimCache[s] = null; return null; }
    const ac = aimCache[s];
    if (ac && nowMs - ac.at < 90) return ac.traj;
    const l = Math.hypot(c.mx, c.my);
    const f = view.p[view.c[s] * 7 + 2];
    const aim = l > 0.2 ? { x: c.mx / l, z: -c.my / l } : { x: Math.cos(f), z: Math.sin(f) };
    const plan = sim.previewKick(s, key, aim, input.power[slot] || 0.1);
    let traj = null;
    if (plan) {
      const pr = predictBall({ p: { ...(plan.from || sim.ball.p) }, v: plan.vel, w: plan.spin }, key === 'shoot' || key === 'finesse' ? 1.2 : 1.8, 0.06);
      traj = [];
      for (const q of pr) traj.push(q.x, q.y, q.z);
    }
    aimCache[s] = { at: nowMs, traj };
    return traj;
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
        acc += dt * timeScale;
        const ins = [sideInput(0, canon), sideInput(1, canon)];
        let n = 0;
        const maxSteps = 14 * timeScale;
        while (acc >= DT && n < maxSteps) { sim.step(DT, ins); acc -= DT; n++; }
        if (n >= maxSteps) acc = 0;
        for (const e of sim.drainEvents()) safe(onEvent, e);
      }
      view = viewFromSim(sim);
    } else {
      view = guestView(nowMs);
    }
    if (!view) { hud.update(null, { dt }); return; }
    lastView = view;
    recAcc += dt;
    if (recAcc >= 1 / 30 && !replay) {
      recAcc = 0;
      frames.push({ t: view.t, v: view });
      while (frames.length && frames[0].t < view.t - 9) frames.shift();
    }
    processFx(view);
    if (!replay && view.ph === PHASE.REPLAY && !replayDone.has(view.gt)) startReplay(view.gt);
    if (replay && !replay.instant && view.ph !== PHASE.REPLAY && view.ph !== PHASE.GOAL) endReplay(false);
    const playReplay = replay && (!paused || replay.instant);
    let rv = playReplay ? replayView(dt) : null;
    if (replay && !playReplay) rv = replay.lastV || null;
    if (replay && rv) replay.lastV = rv;
    const out = rv || { ...view };
    // set-piece crosshair (penalties / direct free kicks) -> 3rd-person camera behind the taker
    let wantSpCam = false, spCtrl = null;
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
        if (idx >= 0 && (view.bo === idx || out.pw[s] > 0) && view.ph === PHASE.PLAY && gp[s].showAimLine) {
          if (l > 0.2) out.aim[s] = { x: c.mx / l, z: -c.my / l };
          else { const f = view.p[idx * 7 + 2]; out.aim[s] = { x: Math.cos(f), z: Math.sin(f) }; }
          const tr = aimTraj(s, slot, view, c, nowMs);
          if (tr) out.traj = tr;
        }
        if (sim && sim.aimInfo[s] && sim.aimInfo[s].setPiece) {
          const ai = sim.aimInfo[s];
          if (ai.preview && (!ai.cross || gp[s].showAimLine)) {
            const pr = predictBall({ p: ai.preview.from, v: ai.preview.vel, w: ai.preview.spin }, 2.6, 0.06);
            const arr = [];
            for (const q of pr) arr.push(q.x, q.y, q.z);
            out.traj = arr;
          }
        }
      }
      const sa = view.sa;
      if (sa && view.spk >= 0 && local[view.spk] && view.ph === PHASE.SETPIECE) {
        if (sa[6]) {
          const gx = (view.spk === 0 ? view.dir : -view.dir) * PITCH.HL;
          out.penAim = { x: gx, y: sa[2], z: sa[1] };
          wantSpCam = true; spCtrl = view.spk;
        }
      } else if (view.ph === PHASE.SETPIECE && view.spt === SP.PENALTY && view.spk >= 0 && local[1 - view.spk]) {
        wantSpCam = true; spCtrl = view.spk; // local keeper: watch from behind the taker
      }
    }
    if (R) {
      if (wantSpCam && localCount >= 1 && !replay) {
        const tk = view.spk;
        const takerIdx = sim && sim.sp ? sim.sp.taker : view.bo;
        const ctl = [-1, -1];
        ctl[tk] = takerIdx >= 0 ? takerIdx : view.c[tk];
        R.setControlled(ctl);
        if (!spCam) { R.setCamera('pro'); spCam = true; }
      } else {
        if (spCam) { spCam = false; if (!replay) R.setCamera(camMode); }
        R.setControlled([view.c[0], view.c[1]]);
      }
      // camera shake (goals, woodwork, rockets) applied to the stage, decays quickly
      if (shake > 0.01 && !paused) {
        const a = shake * 6;
        stage.style.transform = `translate(${(Math.random() - 0.5) * a}px, ${(Math.random() - 0.5) * a}px)`;
        shake *= Math.exp(-dt * 7);
      } else if (stage.style.transform) { stage.style.transform = ''; shake = 0; }
      try { R.render(out, dt); } catch (e) { if (!frame.warned) { frame.warned = true; console.error('[pitchside-engine] render error', e); } }
    }
    hud.update(out, {
      dt, local, replay: !!rv, power: out.pw || [0, 0], playerData, live: view, gp,
      project: R && typeof R.project === 'function' ? (x, y, z) => R.project(x, y, z) : null,
    });
    commentary.update(dt, hud);
    audio.update(dt, excitement(view), paused || menuOpen);
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
    commentary.stop();
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
    if (v && v.fin && v.fin.pens) res.pens = v.fin.pens;
    if (abandoned) res.abandoned = true;
    return res;
  }

  function openMenu() {
    if (ended) return;
    menuOpen = true; paused = true;
    hud.showMenu(true, { camera: camMode, localSides: local.map((s, i) => (s ? i : -1)).filter((i) => i >= 0) });
  }
  function resume() {
    if (replay && replay.instant) endReplay(true);
    menuOpen = false; paused = false;
    hud.showMenu(false);
    last = performance.now();
    root.focus({ preventScroll: true });
  }
  function toggleCamera() {
    camMode = camMode === 'broadcast' && localCount === 1 ? 'pro' : 'broadcast';
    if (R && !replay && !spCam) R.setCamera(camMode);
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
    // private debugging aid (not part of the contract)
    _debug: { get renderer() { return R; }, get sim() { return sim; }, get view() { return lastView; }, get hud() { return hud; } },
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
      commentary.stop();
      if (R) { try { R.destroy(); } catch (e) { console.error(e); } R = null; }
      root.remove();
      if (restorePos != null) container.style.position = restorePos;
    },
    setRemoteInput(side, inp) {
      const i = SIDES.indexOf(side);
      if (i < 0) return;
      const o = sanitizeInput(inp);
      if (o.tac && sim && o.tac.seq > remoteTacSeq[i]) {
        remoteTacSeq[i] = o.tac.seq;
        const label = sim.applyTactic(i, o.tac.cmd);
        if (label) hud.toast(`${(i === 0 ? home : away).short || ''} ${label}`, '#9fb6de', 1.4);
      }
      delete o.tac;
      remoteInputs[i] = o;
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
      // latest tactics command stays attached (with its sequence number) so a lost packet is harmless
      if (tacOut[slot]) o.tac = tacOut[slot];
      return o;
    },
  };
}

export { GOAL };
