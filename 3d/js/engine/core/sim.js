// Authoritative match simulation (fixed timestep). No DOM, no THREE — runs in node for tests.
import { PITCH, GOAL, BOX, SIX, PEN_SPOT, CIRCLE_R, BALL_R, ANIM, PHASE, SP, DIFFICULTY, halfLen, halfBase } from './constants.js';
import { GAMEPLAY_DEFAULTS } from '../../shared/gameplay.js';
import { humanGround, humanThrough, humanLob, humanShot, passArrive } from './assist.js';
import { parsePlaystyles, ps } from './playstyles.js';
import { computeRatings, playerOfMatch } from './ratings.js';
import * as KO from './knockout.js';
import * as HSP from './humansp.js';
import { clamp, lerp, wrapAngle, angleTo, mulberry32, segDist } from './mathx.js';
import { createBall, stepBall, classifyBall, keeperCanSave, predictBall, behindLine } from './physics.js';
import { judgeTackle, isFromBehind, isOffside, inOwnPenaltyArea, ShotTracker } from './rules.js';
import { leadPass, rollSpeedFor, solveLob, solveShot, groundVel } from './passing.js';
import { FORMATIONS, assignSlots, roleGroup } from './formations.js';
import * as AI from './ai.js';

const HL = PITCH.HL, HW = PITCH.HW;
const HUMAN_AI = { ...DIFFICULTY.world, err: 1 };
const HOLD_KEYS = ['pass', 'through', 'lob', 'shoot', 'finesse', 'tackle', 'switchP', 'skill', 'jockey'];
const KICK_KEYS = ['pass', 'through', 'lob', 'shoot', 'finesse'];
export const REPLAY_LEN = 12; // max wait; the UI ends replays earlier via skipReplay()
const EMPTY_IN = { mx: 0, my: 0, aimX: 0, aimY: 0, cx: 0, cy: 0, kx: 0, ky: 0, sprint: false, pass: false, through: false, lob: false, shoot: false, shootPower: 0, switchP: false, tackle: false, skill: false, finesse: false, jockey: false };
const GP_ENUMS = {
  passAssist: ['assisted', 'semi', 'manual'], throughAssist: ['assisted', 'semi', 'manual'], lobAssist: ['assisted', 'semi', 'manual'],
  shotAssist: ['assisted', 'precision', 'manual'], autoSwitch: ['auto', 'airballs', 'manual'], autoSwitchAssist: ['none', 'low', 'high'],
  aiDefending: ['assisted', 'tactical'], passReceiverLock: ['off', 'earlyRelease', 'lateRelease'], switchOnPass: ['instant', 'release', 'receive'],
};
// Merge per-side gameplay settings over the defaults, rejecting unknown values.
export function mergeGameplay(g) {
  const o = { ...GAMEPLAY_DEFAULTS };
  if (g && typeof g === 'object') {
    for (const k in GAMEPLAY_DEFAULTS) {
      if (!(k in g)) continue;
      const v = g[k], def = GAMEPLAY_DEFAULTS[k];
      if (GP_ENUMS[k]) { if (GP_ENUMS[k].includes(v)) o[k] = v; }
      else if (typeof def === 'boolean') o[k] = !!v;
    }
  }
  return o;
}
const SKILL_KINDS = ['stepover', 'roulette', 'ballroll', 'heel'];

const faceVec = (p) => ({ x: Math.cos(p.face), z: Math.sin(p.face) });
const newStats = () => ({ goals: 0, assists: 0, kp: 0, shots: 0, sot: 0, passes: 0, passAtt: 0, tackles: 0, int: 0, saves: 0, fouls: 0, conceded: 0, touches: 0, yellow: 0, red: 0, og: 0, err: 0, mins: 0 });

function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class MatchSim {
  constructor(o) {
    this.opts = o;
    this.rng = mulberry32(o.seed ?? ((Math.random() * 2 ** 31) | 0));
    this.diff = DIFFICULTY[o.difficulty] || DIFFICULTY.pro;
    this.teamsData = [o.home, o.away];
    const c = o.controllers || { home: 'p1', away: 'ai' };
    this.controllers = [c.home || 'ai', c.away || 'ai'];
    this.human = this.controllers.map((k) => k !== 'ai');
    this.halfMinutes = o.halfMinutes || 3;
    this.gp = [mergeGameplay(o.gameplay && o.gameplay.home), mergeGameplay(o.gameplay && o.gameplay.away)];
    this.knockout = !!o.knockout;
    this.shootout = null;
    this.breakNext = 'half';
    this.switchT = [-9, -9];
    this.switchAuto = [false, false];
    this.recvLock = [null, null];
    this.pendingSwitch = [null, null];
    this.pendingShot = [null, null];
    this.tfBlock = [0, 0];
    this.tfLate = [null, null];
    this.nextSw = [-1, -1];
    this.passLink = [null, null];
    this.lastLoss = [null, null];
    this.nextAuto = 0;
    this.gameRate = 2700 / (this.halfMinutes * 60);
    this.players = [];
    this.pstats = {};
    this.bench = [[...(o.home.bench || [])], [...(o.away.bench || [])]];
    this.benchUsed = [new Set(), new Set()];
    for (let team = 0; team < 2; team++) {
      const td = this.teamsData[team];
      const list = td.players.slice(0, 11);
      const slotOf = assignSlots(list, td.formation);
      const form = FORMATIONS[td.formation] || FORMATIONS['4-3-3'];
      for (let i = 0; i < 11; i++) {
        const pd = list[i] || list[list.length - 1];
        this.players.push(this._mkPlayer(team, i, pd, slotOf[i] ?? i, form, td.chemistry));
      }
    }
    this.teamList = [this.players.slice(0, 11), this.players.slice(11)];
    this.ball = createBall();
    Object.assign(this.ball, { owner: -1, inHands: false, lastTouch: -1, lastTeam: 0, kicker: -1, kickT: -9, intended: -1 });
    this.dir = [1, -1];
    this.t = 0;
    this.half = 1;
    this.clock = 0;
    this.added = 0;
    this.addedSet = false;
    this.stoppage = 0;
    this.score = [0, 0];
    this.scorers = [];
    this.stats = { poss: [0, 0], shots: [0, 0], sot: [0, 0], passes: [0, 0], fouls: [0, 0], corners: [0, 0] };
    this.ctrl = [-1, -1];
    this.prevIn = [{ ...EMPTY_IN }, { ...EMPTY_IN }];
    this.holds = [{}, {}];
    this.buffer = [null, null];
    this.inputs = [null, null];
    this.info = [{ ballX: 52.5, attacking: false, offLine: 52.5 }, { ballX: 52.5, attacking: false, offLine: 52.5 }];
    this.fx = [];
    this.fxId = 0;
    this.events = [];
    this.physEv = [];
    this.path = null;
    this.nextPredict = 0;
    this.nextTeamThink = 0;
    this.shotTracker = new ShotTracker(1.0);
    this.pendingPass = null;
    this.pendingOffside = null;
    this.lastPasser = [null, null];
    this.subs = [];
    this.subsMade = [0, 0];
    this.lastSubT = [-999, -999];
    this.rosterVer = 0;
    this.aimInfo = [null, null];
    this.skipReq = false;
    this.ended = false;
    this.result = null;
    this.firstKickoff = 0;
    this.phaseT = 0;
    this._setupKickoff(0);
  }

  // ------------------------------------------------------------------ players
  _mkPlayer(team, i, pd, slotIdx, form, chem) {
    const sd = form[slotIdx] || form[i];
    const p = {
      idx: team * 11 + i, team, i, data: pd, slot: slotIdx, sd, role: sd.r, group: roleGroup(sd.r), isGK: slotIdx === 0,
      x: 0, z: 0, vx: 0, vz: 0, face: 0, speed: 0, des: { x: 0, z: 0 }, sprint: false,
      stam: 1, stamMax: 1, act: null, anim: ANIM.RUN, animT: 0, animP: 0,
      cool: { touch: 0, tackle: 0, steal: 0 }, sentOff: false, pendingOff: false, yellow: 0, fooledUntil: 0, burst: 0,
      nextThink: 0, home: { x: 0, z: 0 }, run: null, drib: null, space: null, ic: null, gkPlan: null, holdStart: null, gainT: 0,
      faceBall: null, ready: false,
    };
    this._applyData(p, pd, chem);
    return p;
  }
  _applyData(p, pd, chem) {
    p.data = pd;
    const a = { pac: 60, sho: 55, pas: 60, dri: 60, def: 55, phy: 65, div: 50, han: 50, kic: 50, ref: 50, spd: 50, pos: 50, ...(pd.attrs || {}) };
    const k = 1 + clamp(((chem ?? 50) - 50) / 1000, -0.05, 0.05);
    for (const key in a) a[key] = clamp((+a[key] || 50) * k, 1, 99);
    p.a = a;
    // V2.1 physique + PlayStyles (defaults when absent)
    p.h = clamp(Number.isFinite(+pd.height) && +pd.height > 1.4 ? +pd.height : 1.8, 1.55, 2.08);
    p.w = clamp(Number.isFinite(+pd.weight) && +pd.weight > 40 ? +pd.weight : 75, 50, 110);
    p.ps = parsePlaystyles(pd.playstyles);
    const pace = p.isGK ? a.spd * 0.6 + a.pac * 0.4 : a.pac;
    // attributes must be felt: top speed and acceleration spread widely with pace
    p.vmax = 4.95 + pace * 0.046 - Math.max(0, p.w - 85) * 0.012;
    p.acc = 3.6 + pace * 0.072 + ps(p, 'quickstep') * 0.9 - (p.w - 75) * 0.025 - (p.h - 1.8) * 2.5;
    // agility (turning) from dribbling/pace, strength from physical + body mass
    p.agil = clamp((a.dri * 0.6 + a.pac * 0.4) / 100 - (p.h - 1.8) * 0.4 - Math.max(0, p.w - 80) * 0.004, 0.3, 1.05);
    p.str = a.phy * 0.75 + (p.w - 75) * 0.9 + (p.h - 1.8) * 25 + ps(p, 'bruiser') * 10;
    // standing reach / jump used for headers and keeper handling
    p.jump = 0.28 + a.phy * 0.0025 + (p.isGK ? a.div * 0.002 : 0) + ps(p, 'aerial') * 0.08;
    p.hash = strHash(String(pd.id ?? pd.name ?? p.idx));
    p.st = this.pstats[pd.id] || (this.pstats[pd.id] = { ...newStats(), team: p.team, gk: p.isGK, def: p.group === 'DEF' });
  }

  // ------------------------------------------------------------------ helpers
  X(team, x) { return x * this.dir[team] + HL; }
  wx(team, X) { return (X - HL) * this.dir[team]; }
  goalX(team) { return this.dir[team] * HL; }
  ownGoalX(team) { return -this.dir[team] * HL; }
  gk(team) { return this.players[team * 11]; }
  owner() { return this.ball.owner >= 0 ? this.players[this.ball.owner] : null; }
  diffFor(team) { return this.human[team] ? HUMAN_AI : this.diff; }
  isHumanCtrl(p) { return this.human[p.team] && this.ctrl[p.team] === p.idx; }
  stamFactor(p) { return (0.8 + 0.2 * p.stam) * (p.burst > this.t ? 1.1 : 1); }
  dribbleFactor(p, sprint) { return Math.min(1, (sprint ? 0.84 : 0.93) * (0.9 + p.a.dri * 0.0012) + ps(p, 'rapid') * 0.035); }
  fromBehind(tackler, victim) { return isFromBehind(tackler, victim, victim.face); }
  minute() { return Math.floor((halfBase(this.half) + this.clock) / 60) + 1; }
  // minute a goal is credited to (capped at the end of the period + added time)
  goalMinute() { return Math.min(this.minute(), (halfBase(this.half) + halfLen(this.half)) / 60 + (this.addedSet ? this.added : 0)); }
  sideName(team) { return team === 0 ? 'home' : 'away'; }
  openness(m) { return this.openAt(m.x, m.z, 1 - m.team); }
  openAt(x, z, oppTeam) {
    let best = 99;
    for (const o of this.teamList[oppTeam]) best = Math.min(best, Math.hypot(o.x - x, o.z - z));
    return best;
  }
  pressureOn(p) {
    let best = 99;
    for (const o of this.teamList[1 - p.team]) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < best) best = d;
    }
    return best;
  }
  spaceAhead(p) {
    const d = this.dir[p.team];
    let best = 20;
    for (const o of this.teamList[1 - p.team]) {
      const dx = o.x - p.x, dz = o.z - p.z;
      if (dx * d > 0 && Math.abs(dz) < Math.abs(dx) * 0.9 + 1) best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  }
  gkMayChase(g) {
    const ic = g.ic;
    if (!ic) return false;
    return inOwnPenaltyArea(ic.x, ic.z, this.dir[g.team]) && this.X(g.team, ic.x) > 0.5;
  }
  intercept(p, maxH = 2.2) {
    const path = this.path;
    const b = this.ball.p;
    if (!path || !path.length) return { t: Math.hypot(b.x - p.x, b.z - p.z) / p.vmax, x: b.x, z: b.z };
    const vm = p.vmax * this.stamFactor(p) * 0.95;
    for (const s of path) {
      if (s.y > maxH) continue;
      const d = Math.max(0, Math.hypot(s.x - p.x, s.z - p.z) - 0.5);
      const tt = 0.12 + d / vm;
      if (tt <= s.t) return { t: s.t, x: s.x, z: s.z };
    }
    const l = path[path.length - 1];
    return { t: l.t + Math.hypot(l.x - p.x, l.z - p.z) / vm, x: l.x, z: l.z };
  }
  _jumpH(p) {
    const a = p.act;
    if (!a || (a.type !== 'head' && a.type !== 'wall')) return 0;
    const u = clamp((this.t - a.t0) / 0.6, 0, 1);
    return (a.jh || 0.45) * Math.sin(Math.PI * u);
  }
  nearestToBall(team, exclude = -1, allowGK = false) {
    let best = null, bd = 1e9;
    const b = this.ball.p;
    for (const m of this.teamList[team]) {
      if (m.idx === exclude || (m.isGK && !allowGK)) continue;
      const d = Math.hypot(m.x - b.x, m.z - b.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  fxPush(k, data = {}) {
    this.fx.push({ id: ++this.fxId, t: this.t, k, ...data });
  }
  emit(evt) { this.events.push(evt); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------------ main step
  step(dt, inputs) {
    this.t += dt;
    this.inputs = inputs || [null, null];
    const ph = this.phase;
    if (ph === PHASE.PLAY || ph === PHASE.STOP || ph === PHASE.SETPIECE) this._clock(dt);
    switch (this.phase) {
      case PHASE.PLAY: this._stepPlay(dt); break;
      case PHASE.STOP: this._stepStop(dt); break;
      case PHASE.KICKOFF: case PHASE.SETPIECE: this._stepSetPiece(dt); break;
      case PHASE.GOAL: this._stepGoal(dt); break;
      case PHASE.REPLAY: this._stepIdle(dt); if (this.skipReq || this.t - this.phaseT > REPLAY_LEN) this._setupKickoff(this.kickoffTeam); break;
      case PHASE.HALFTIME: this._stepIdle(dt); if (this.skipReq || this.t - this.phaseT > 3.5) { this.skipReq = false; this._afterBreak(); } break;
      case PHASE.FULLTIME: this._stepIdle(dt); break;
    }
    this._updateAnims();
    for (let team = 0; team < 2; team++) {
      const inp = this.inputs[team];
      if (this.human[team]) this.prevIn[team] = inp ? { ...inp } : { ...EMPTY_IN };
    }
    if (this.fx.length > 40 || (this.fx.length && this.t - this.fx[0].t > 3)) this.fx = this.fx.filter((f) => this.t - f.t < 3);
  }

  skipReplay() { if (this.phase === PHASE.REPLAY || this.phase === PHASE.GOAL) this.skipReq = true; }
  // skippable cut-scenes: goal celebration / replay / half-time break
  skipCutscene() {
    if (this.phase === PHASE.GOAL && this.t - this.phaseT < 0.6) return false;
    if (this.phase === PHASE.REPLAY || this.phase === PHASE.GOAL) { this.skipReq = true; return true; }
    if (this.phase === PHASE.HALFTIME && this.t - this.phaseT > 0.8) { this.skipReq = true; return true; }
    return false;
  }

  _clock(dt) {
    if (this.shootout) return;
    this.clock += dt * this.gameRate;
    for (const p of this.players) if (!p.sentOff) p.st.mins += (dt * this.gameRate) / 60;
    const HLEN = halfLen(this.half);
    if (!this.addedSet && this.clock >= HLEN) {
      this.addedSet = true;
      this.added = this.half <= 2 ? clamp(Math.round(1 + this.stoppage + this.rng() * 1.5), 1, 6) : clamp(Math.round(this.stoppage * 0.5 + this.rng() * 1.2), 0, 2);
      if (this.added > 0) this.fxPush('added', { n: this.added });
    }
    if (this.addedSet && this.clock >= HLEN + this.added * 60) {
      const over = this.clock - (HLEN + this.added * 60);
      if (this.phase === PHASE.PLAY) {
        if (Math.abs(this.ball.p.x) < 32 || over > 45) this._endHalf();
      } else if (this.phase === PHASE.SETPIECE && this.sp && this.sp.type !== SP.PENALTY && over > 25) {
        this._endHalf();
      }
    }
  }

  _stepPlay(dt) {
    const t = this.t, b = this.ball;
    if (b.owner < 0 && (!this.path || t >= this.nextPredict)) {
      this.path = predictBall(b, 3, 0.05);
      this.nextPredict = t + 0.1;
    }
    if (t >= this.nextTeamThink) {
      AI.teamThink(this, 0); AI.teamThink(this, 1);
      this.nextTeamThink = t + 0.1;
    }
    for (let team = 0; team < 2; team++) if (this.human[team]) this._human(team, dt, this.inputs[team] || EMPTY_IN);
    for (const p of this.players) {
      if (p.sentOff) { this._walkOff(p); continue; }
      if (!this.isHumanCtrl(p)) AI.think(this, p, dt);
    }
    this._movePlayers(dt);
    this._collide();
    this._updateBall(dt);
    if (this.phase !== PHASE.PLAY) return;
    this._tackles();
    if (this.phase !== PHASE.PLAY) return;
    this._interactions();
    if (this.phase !== PHASE.PLAY) return;
    this._contests();
    const r = this.shotTracker.update(t, false);
    if (r) this._shotResolved(r);
    const o = this.owner();
    this.stats.poss[o ? o.team : b.lastTeam] += dt;
  }

  _stepStop(dt) {
    const b = this.ball;
    if (b.owner < 0) { stepBall(b, dt); this._clampDeadBall(); }
    else this._dribble(dt);
    for (const p of this.players) {
      if (p.sentOff) { this._walkOff(p); continue; }
      p.des.x *= 0.9; p.des.z *= 0.9;
      p.faceBall = Math.atan2(b.p.z - p.z, b.p.x - p.x);
    }
    this._movePlayers(dt);
    this._collide();
    if (this.t - this.phaseT >= this.stopDur) {
      const pd = this.pending;
      const over = !this.shootout && this.addedSet && this.clock >= halfLen(this.half) + this.added * 60;
      if (pd.shootout) KO.afterKick(this);
      else if (over && pd.type !== SP.PENALTY) this._endHalf();
      else this._setupSetPiece(pd);
    }
  }

  _stepIdle(dt) {
    const b = this.ball;
    if (b.owner < 0) { stepBall(b, dt, this.physEv); this._physFx(); }
    for (const p of this.players) {
      if (p.sentOff) { this._walkOff(p); continue; }
      p.des.x *= 0.9; p.des.z *= 0.9;
    }
    this._movePlayers(dt);
    this._collide();
  }

  _clampDeadBall() {
    const p = this.ball.p;
    if (Math.abs(p.x) > HL + 6 || Math.abs(p.z) > HW + 6) {
      this.ball.v.x *= 0.5; this.ball.v.z *= 0.5; this.ball.v.y = Math.min(0, this.ball.v.y);
      p.x = clamp(p.x, -HL - 6, HL + 6); p.z = clamp(p.z, -HW - 6, HW + 6);
    }
  }

  _walkOff(p) {
    p.des.x = 0; p.des.z = 0; p.x = -1000; p.z = -1000;
  }

  // ------------------------------------------------------------------ human control
  _worldMove(inp) {
    let x = +inp.mx || 0, z = -(+inp.my || 0);
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    return { x, z, l: Math.min(1, l) };
  }

  _setCtrl(team, idx, auto = false) {
    if (this.ctrl[team] === idx) return;
    this.ctrl[team] = idx;
    this.switchT[team] = this.t;
    this.switchAuto[team] = auto;
    this.holds[team].armed = false;
  }

  // human keeper control: holding the keeper key while defending, or (manualKeeper) a shot coming in
  _keeperMode(team, inp) {
    const b = this.ball, g = this.gk(team);
    if (!g || g.sentOff) return false;
    const o = this.owner();
    if (inp.keeper && (!o || o.team !== team)) return true;
    if (!this.gp[team].manualKeeper) return false;
    const sh = this.shotTracker.shot;
    if (sh && sh.team !== team && b.owner < 0 && this.t - sh.t < 1.6 && -this.dir[team] * b.v.x > 3) return true;
    const cur = this.players[this.ctrl[team]];
    return !!(cur && cur.isGK && g.act && g.act.type === 'dive');
  }

  _assistActive(team) {
    const win = { none: 0, low: 0.35, high: 0.85 }[this.gp[team].autoSwitchAssist] || 0;
    return this.t - this.switchT[team] < win;
  }

  // where an AI brain would take the controlled player right now (used by switch assist)
  _assistTarget(p) {
    const o = this.owner(), team = p.team;
    if (o && o.team !== team && !this.ball.inHands) {
      const gx = this.ownGoalX(team) - o.x, gz = -o.z, gl = Math.hypot(gx, gz) || 1;
      return { x: o.x + o.vx * 0.3 + (gx / gl) * 1.6, z: o.z + o.vz * 0.3 + (gz / gl) * 1.6 };
    }
    if (this.ball.owner < 0) return this.intercept(p);
    return null;
  }

  _human(team, dt, inp) {
    const t = this.t, b = this.ball;
    const prev = this.prevIn[team] || EMPTY_IN;
    const H = this.holds[team];
    const gp = this.gp[team];
    const pressed = (k) => !!inp[k] && !prev[k];
    const released = (k) => !inp[k] && !!prev[k];
    for (const k of HOLD_KEYS) if (inp[k]) H[k] = (H[k] || 0) + dt;
    if (pressed('shoot') || pressed('finesse')) { (H.taps || (H.taps = [])).push(t); if (H.taps.length > 6) H.taps.shift(); }
    let p = this.players[this.ctrl[team]];
    if (!p || p.sentOff || p.team !== team) { p = this.nearestToBall(team); this._setCtrl(team, p.idx); }
    const keeperMode = this._keeperMode(team, inp);
    // a controlled keeper without the ball hands control back to an outfielder
    if (p.isGK && b.owner !== p.idx && !(b.owner < 0 && b.intended === p.idx) && !keeperMode) {
      p = this.nearestToBall(team, p.idx); this._setCtrl(team, p.idx);
    }
    if (keeperMode && !p.isGK && b.owner !== p.idx) { p = this.gk(team); this._setCtrl(team, p.idx); }
    // pending switch-on-pass ('release' when the ball is halfway)
    const ps0 = this.pendingSwitch[team];
    if (ps0 && t >= ps0.at) {
      this.pendingSwitch[team] = null;
      if (b.owner < 0 && b.intended === ps0.idx) { this._setCtrl(team, ps0.idx); p = this.players[ps0.idx]; }
    }
    const mv = this._worldMove(inp);
    const hasMove = mv.l > 0.2;
    let aim;
    const al = Math.hypot(inp.aimX || 0, inp.aimY || 0);
    if (al > 0.3) aim = { x: inp.aimX / al, z: -inp.aimY / al };
    else if (hasMove) aim = { x: mv.x / mv.l, z: mv.z / mv.l };
    else aim = faceVec(p);
    const own = b.owner === p.idx;
    const lock = this.recvLock[team];
    const lockOn = lock && t < lock.until && b.owner < 0 && b.intended === lock.idx;
    if (pressed('switchP') && !own && !lockOn && !keeperMode) {
      this._switch(team, hasMove ? mv : null);
      p = this.players[this.ctrl[team]];
    }
    const locked = p.act && ['slide', 'dive', 'fall', 'down', 'tackle', 'throw', 'sentoff'].includes(p.act.type);
    const opp = this.owner();
    const oppHas = !!opp && opp.team !== team && !b.inHands;
    const jockey = !!inp.jockey && !own && oppHas && !p.isGK;
    const ctrlSprint = !!inp.jockey && own && !!inp.sprint && !b.inHands;
    const shield = !!inp.jockey && own && !inp.sprint && !b.inHands && !p.isGK;
    const style = gp.gameplayStyle === 'authentic' ? 0.93 : 1;
    if (!locked) {
      let spMul = (inp.sprint ? 1 : 0.7) * style;
      if (own) spMul *= this.dribbleFactor(p, inp.sprint);
      if (ctrlSprint) spMul = 0.86 * this.dribbleFactor(p, false);
      if (jockey) spMul = 0.56 * (1 + ps(p, 'jockey') * 0.12);
      if (shield) spMul = 0.42;
      const smax = p.vmax * this.stamFactor(p) * spMul;
      const assist = !own && !jockey && this._assistActive(team) ? this._assistTarget(p) : null;
      if (jockey && gp.jockeyAssist) {
        // contain: stay goal-side of the carrier, mirroring him; the stick adds side-steps
        const gx = this.ownGoalX(team) - opp.x, gz = -opp.z, gl = Math.hypot(gx, gz) || 1;
        const tx = opp.x + opp.vx * 0.3 + (gx / gl) * 1.8, tz = opp.z + opp.vz * 0.3 + (gz / gl) * 1.8;
        let dx = (tx - p.x) * 3, dz = (tz - p.z) * 3;
        if (hasMove) { dx += mv.x * smax * 0.8; dz += mv.z * smax * 0.8; }
        const l = Math.hypot(dx, dz);
        if (l > smax) { dx *= smax / l; dz *= smax / l; }
        p.des.x = dx; p.des.z = dz;
      } else if (hasMove) {
        let mx = mv.x, mz = mv.z;
        if (assist && gp.autoSwitchAssist === 'high') {
          const ax = assist.x - p.x, az = assist.z - p.z, a2 = Math.hypot(ax, az) || 1;
          mx = mx * 0.65 + (ax / a2) * 0.35; mz = mz * 0.65 + (az / a2) * 0.35;
          const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
        }
        p.des.x = mx * smax; p.des.z = mz * smax;
      } else if (!own && b.owner < 0 && b.intended === p.idx) {
        AI.goTo(this, p, this.intercept(p), 'run', 0);
      } else if (assist) {
        AI.goTo(this, p, assist, 'run', 0.3);
      } else { p.des.x = 0; p.des.z = 0; }
      p.sprint = !!inp.sprint && hasMove && !jockey && !shield && !ctrlSprint;
      p.faceBall = own ? null : Math.atan2(b.p.z - p.z, b.p.x - p.x);
      if (jockey) {
        p.jockeyT = t;
        if (gp.jockeyAssist) { p.faceHold = Math.atan2(opp.z - p.z, opp.x - p.x); p.faceHoldT = t + 0.05; }
      }
      if (ctrlSprint) p.ctrlSprintT = t;
      if (shield) {
        p.shieldT = t;
        let near = null, nd = 3.5;
        for (const o of this.teamList[1 - team]) { const dd = Math.hypot(o.x - p.x, o.z - p.z); if (dd < nd) { nd = dd; near = o; } }
        if (near && !hasMove) { p.faceHold = Math.atan2(p.z - near.z, p.x - near.x); p.faceHoldT = t + 0.05; }
      }
    }
    // human keeper: dive with the tackle key
    if (p.isGK && !own && pressed('tackle') && !locked) { HSP.humanDive(this, p, mv, inp); return this._humanEnd(team, H, inp, aim); }
    if (own) {
      const pw = (k, full = 1) => clamp((H[k] || 0) / full, 0.05, 1);
      const pend = this.pendingShot[team];
      // shot modifiers collected while charging
      if (inp.shoot) {
        const m = H.mods || (H.mods = {});
        if (inp.finesse) m.fin = true;
        if (inp.switchP) m.chip = true;
        if (inp.jockey) m.triv = true;
      } else if (!prev.shoot) H.mods = null;
      if (inp.pass && inp.jockey) H.flair = true;
      if (b.inHands) {
        p.des.x *= 0.5; p.des.z *= 0.5;
        if (t - p.gainT > 6) { p.holdStart = t - 10; AI.gkDistribute(this, p); return this._humanEnd(team, H, inp, aim); }
        if (released('pass') || released('through')) this._humanKick(p, 'gkthrow', aim, pw('pass', 0.9));
        else if (released('lob') || released('shoot') || released('finesse')) this._humanKick(p, 'punt', aim, pw(released('lob') ? 'lob' : 'shoot'));
      } else if (pend) {
        p.windup = 1;
        if (t >= pend.tc) { this.pendingShot[team] = null; this._strikeShot(p, pend); }
      } else if (!locked) {
        const tfb = t < this.tfBlock[team];
        if (released('pass')) { const fl = H.flair || inp.jockey; H.flair = false; this._humanKick(p, 'ground', aim, pw('pass', 0.9), { flair: fl }); }
        else if (released('through')) this._humanKick(p, 'through', aim, pw('through', 0.9));
        else if (released('lob')) this._humanKick(p, this._isCrossZone(p) ? 'cross' : 'lob', aim, pw('lob', 1));
        else if (released('shoot') && !tfb) {
          const m = H.mods || {};
          H.mods = null;
          if (inp.finesse || m.fin) H.skipFin = true;
          const power = pw('shoot', 1);
          const kind = m.chip ? 'chip' : m.fin ? (power < 0.45 ? 'lowdriven' : 'powershot') : m.triv ? 'trivela' : 'shot';
          this._shootRelease(p, kind, aim, kind === 'lowdriven' ? 0.78 : power);
        } else if (released('finesse') && !tfb) {
          if (H.skipFin || inp.shoot) H.skipFin = false;
          else this._shootRelease(p, 'finesse', aim, pw('finesse', 1));
        } else if (pressed('skill')) this.doSkill(p, hasMove ? mv : null);
        p.windup = inp.shoot ? pw('shoot') : inp.finesse && !inp.shoot ? pw('finesse') : 0;
        // arcade auto-shot: a clear sight of goal close in
        if (gp.autoShots && !inp.shoot && !inp.pass && this._autoShotChance(p)) this._shootRelease(p, 'shot', this._goalAim(p), 0.62);
      }
    } else {
      p.windup = 0;
      this.pendingShot[team] = null;
      H.mods = null;
      for (const k of KICK_KEYS) {
        if (!released(k)) continue;
        if ((k === 'shoot' || k === 'finesse') && t < this.tfBlock[team]) continue;
        this.buffer[team] = { k, power: clamp((H[k] || 0) / 1, 0.1, 1), aim, until: t + 0.9, idx: p.idx, tRel: t };
      }
      // late timed-finishing tap (just after contact): red, a slight deviation
      const late = this.tfLate[team];
      if (late && (pressed('shoot') || pressed('finesse'))) {
        this.tfLate[team] = null;
        if (t - late.tc < 0.12 && b.owner < 0 && b.kicker === late.idx) {
          const g = this.rng.gauss, sp = Math.hypot(b.v.x, b.v.z) || 1, yaw = g() * 0.05;
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          const vx = b.v.x * c - b.v.z * sn, vz = b.v.x * sn + b.v.z * c;
          b.v.x = vx; b.v.z = vz; b.v.y += g() * 0.05 * sp;
          this.path = null;
          this.fxPush('timed', { pi: late.idx, q: 2 });
        }
      }
      if (!locked && !p.act && !p.isGK) {
        if (pressed('tackle')) {
          if (t - (H.lastTap || -9) < 0.3) { this.startSlide(p); H.armed = false; }
          else H.armed = true;
          H.lastTap = t;
        }
        if (H.armed && inp.tackle && (H.tackle || 0) >= 0.22) { H.armed = false; this.startSlide(p); }
        if (H.armed && released('tackle')) { H.armed = false; this.startTackle(p); }
        // auto-tackle: poke when the ball comes within reach while defending
        if (gp.autoTackle && oppHas && !H.armed && t > (H.autoTk || 0) && Math.hypot(b.p.x - p.x, b.p.z - p.z) < 1.05) {
          H.autoTk = t + 0.45;
          if (this.rng() < 0.55) this.startTackle(p);
        }
      } else if (released('tackle')) H.armed = false;
    }
    return this._humanEnd(team, H, inp, aim);
  }

  _humanEnd(team, H, inp, aim) {
    for (const k of HOLD_KEYS) if (!inp[k]) H[k] = 0;
    this.aimInfo[team] = { x: aim.x, z: aim.z };
  }

  _goalAim(p) {
    const gx = this.goalX(p.team), dx = gx - p.x, dz = -p.z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  _autoShotChance(p) {
    const X = this.X(p.team, p.x);
    if (X < 88 || Math.abs(p.z) > 12 || this.t - p.gainT > 0.6) return false;
    const gx = this.goalX(p.team);
    for (const o of this.teamList[1 - p.team]) {
      if (o.isGK) continue;
      const sd = segDist(o.x, o.z, p.x, p.z, gx, 0);
      if (sd.t > 0.05 && sd.d < 1.1) return false;
    }
    return true;
  }

  // shoot key released: strike now, or (timed finishing) after a short backswing
  _shootRelease(p, kind, aim, power) {
    const team = p.team, t = this.t;
    const back = kind === 'powershot' ? 0.42 : 0.24;
    if (this.gp[team].timedFinishing || kind === 'powershot') {
      this.pendingShot[team] = { kind, aim, power, tRel: t, tc: t + back, idx: p.idx };
      this.tfBlock[team] = t + back + 0.35;
      p.windup = 1;
      return;
    }
    this._humanKick(p, kind, aim, power);
  }

  _strikeShot(p, pend) {
    if (this.ball.owner !== p.idx) return;
    const q = this.gp[p.team].timedFinishing ? this._timedQuality(p.team, pend.tRel, this.t) : -1;
    this._humanKick(p, pend.kind, pend.aim, pend.power, { timed: q });
  }

  // timed finishing: a second tap within ~0.12 s before contact = green (0), slightly early =
  // amber (1), mashed early = red (2), no tap = -1 (then a late tap may still turn it red)
  _timedQuality(team, tRel, tc) {
    const taps = (this.holds[team].taps || []).filter((x) => x > tRel + 1e-6 && x <= tc + 1e-6);
    let q = -1;
    if (taps.length) {
      const last = taps[taps.length - 1];
      q = tc - last <= 0.12 ? 0 : tc - last <= 0.2 ? 1 : 2;
    }
    this.holds[team].taps = [];
    if (q < 0) this.tfLate[team] = { tc, idx: this.ctrl[team] };
    return q;
  }

  _isCrossZone(p) {
    return this.X(p.team, p.x) > 76 && Math.abs(p.z) > 12;
  }

  // who the switch key would select (also drawn as the next-player indicator)
  _switchCandidate(team, dir = null) {
    const cur = this.players[this.ctrl[team]];
    if (!cur) return -1;
    const b = this.ball;
    const tgt = b.owner < 0 && this.path ? this.intercept(cur) : { x: b.p.x, z: b.p.z };
    let best = null, bs = 1e9;
    for (const m of this.teamList[team]) {
      if (m === cur || m.isGK) continue;
      let s = Math.hypot(m.x - tgt.x, m.z - tgt.z);
      // prefer goal-side players when defending
      if (b.owner >= 0 && this.players[b.owner].team !== team && this.X(team, m.x) < this.X(team, b.p.x)) s -= 3;
      if (dir) {
        const dx = m.x - cur.x, dz = m.z - cur.z, dl = Math.hypot(dx, dz) || 1;
        s -= 12 * ((dx * dir.x + dz * dir.z) / dl / (dir.l || 1));
      }
      if (s < bs) { bs = s; best = m; }
    }
    return best ? best.idx : -1;
  }

  _switch(team, dir) {
    const i = this._switchCandidate(team, dir);
    if (i >= 0) this._setCtrl(team, i);
  }

  // automatic switching (gameplay setting autoSwitch: auto | airballs | manual)
  _autoSwitch(team) {
    const g = this.gp[team], t = this.t, b = this.ball;
    if (g.autoSwitch === 'manual' || this.phase !== PHASE.PLAY) return;
    if (t - this.switchT[team] < 0.9) return;
    const lock = this.recvLock[team];
    if (lock && t < lock.until) return;
    const cur = this.players[this.ctrl[team]];
    if (!cur || cur.isGK) return;
    if (b.owner >= 0) {
      const o = this.players[b.owner];
      if (o.team === team || g.autoSwitch !== 'auto') return;
      const dc = Math.hypot(cur.x - o.x, cur.z - o.z);
      if (dc < 12) return;
      const n = this._switchCandidate(team);
      if (n >= 0) {
        const m = this.players[n];
        if (Math.hypot(m.x - o.x, m.z - o.z) < dc - 6) this._setCtrl(team, n, true);
      }
      return;
    }
    if (b.intended >= 0 && this.players[b.intended].team === team) return;
    let air = b.p.y > 1.3;
    if (!air && this.path) for (const s of this.path) { if (s.t > 1.2) break; if (s.y > 2.2) { air = true; break; } }
    if (g.autoSwitch === 'airballs' && !air) return;
    const info = this.info[team];
    if (info.chaser < 0 || info.chaser === cur.idx) return;
    const ch = this.players[info.chaser];
    if (ch.isGK || !ch.ic) return;
    const ic = cur.ic || this.intercept(cur);
    if (ch.ic.t < ic.t - 0.6) this._setCtrl(team, ch.idx, true);
  }

  _humanKick(p, kind, aim, power, extra = {}) {
    let plan;
    switch (kind) {
      case 'ground': plan = humanGround(this, p, aim, power, 'ground'); break;
      case 'gkthrow': plan = humanGround(this, p, aim, power, 'gkthrow'); break;
      case 'through': plan = humanThrough(this, p, aim, power); break;
      case 'lob': case 'cross': plan = humanLob(this, p, aim, power, kind); break;
      case 'shot': case 'finesse': case 'lowdriven': case 'powershot': case 'trivela': case 'chip':
        plan = humanShot(this, p, kind, aim, power); break;
      default: plan = this._plan(p, kind, { dir: aim, power, human: true });
    }
    if (!plan) return;
    if (extra.flair && plan.info.pass) plan.info.flair = true;
    if (extra.timed != null && extra.timed >= 0) {
      plan.info.timed = extra.timed;
      this.fxPush('timed', { pi: p.idx, q: extra.timed });
    }
    this._execute(p, plan);
  }

  // ------------------------------------------------------------------ actions
  startTackle(p) {
    if (p.act || this.t < p.cool.tackle) return;
    const o = this.owner();
    if (o && o.team !== p.team) p.face = Math.atan2(this.ball.p.z - p.z, this.ball.p.x - p.x);
    p.act = { type: 'tackle', t0: this.t, dur: 0.42 };
    p.cool.tackle = this.t + 0.7;
  }
  startSlide(p) {
    if (p.act || this.t < p.cool.tackle) return;
    const f = faceVec(p);
    const v0 = Math.max(Math.hypot(p.vx, p.vz) * 1.05, 6.2);
    p.act = { type: 'slide', t0: this.t, dur: 0.72, dx: f.x, dz: f.z, v0, next: { type: 'down', dur: 0.5 } };
    p.cool.tackle = this.t + 1.4;
  }
  startJump(p) {
    if (p.act) return;
    p.act = { type: 'head', t0: this.t, dur: 0.65, jh: 0.3 + p.a.phy * 0.003 };
  }
  doSkill(p, dir) {
    const t = this.t;
    if (p.act || this.ball.owner !== p.idx || this.ball.inHands) return;
    const f = faceVec(p), r = { x: -f.z, z: f.x };
    let kind = 'stepover', side = 1;
    if (dir && Math.hypot(dir.x, dir.z) > 0.2) {
      const fwd = dir.x * f.x + dir.z * f.z, lat = dir.x * r.x + dir.z * r.z;
      side = lat >= 0 ? 1 : -1;
      if (fwd > 0.6) kind = 'heel';
      else if (fwd < -0.45) kind = 'roulette';
      else kind = 'ballroll';
    }
    const dur = { stepover: 0.55, roulette: 0.62, ballroll: 0.45, heel: 0.4 }[kind];
    p.act = { type: 'skill', kind, side, t0: t, dur };
    p.skillIdx = SKILL_KINDS.indexOf(kind);
    p.skillSide = side;
    for (const o of this.teamList[1 - p.team]) {
      if (Math.hypot(o.x - p.x, o.z - p.z) > 3.8) continue;
      const pr = clamp(0.32 + (p.a.dri - o.a.def) * 0.012, 0.08, 0.85);
      if (this.rng() < pr) { o.fooledUntil = t + 0.5 + p.a.dri * 0.003; o.des.x = -o.des.x * 0.4; o.des.z = -o.des.z * 0.4; }
    }
    if (p.a.dri < 62 && this.rng() < 0.15) {
      // fumbled skill: ball runs loose
      const b = this.ball;
      b.owner = -1; b.v.x = f.x * 4 + (this.rng() - 0.5) * 3; b.v.z = f.z * 4 + (this.rng() - 0.5) * 3; b.v.y = 0;
      p.cool.touch = t + 0.3; this.path = null;
    }
  }
  _skillMove(p, a, at) {
    const f = faceVec(p), r = { x: -f.z, z: f.x };
    let vx = 0, vz = 0;
    switch (a.kind) {
      case 'stepover': vx = f.x * 1.8; vz = f.z * 1.8; if (at > a.dur - 0.05) p.burst = this.t + 0.8; break;
      case 'roulette': vx = r.x * a.side * 3.0 + f.x * 0.6; vz = r.z * a.side * 3.0 + f.z * 0.6; break;
      case 'ballroll': vx = r.x * a.side * 3.6; vz = r.z * a.side * 3.6; break;
      case 'heel': vx = f.x * 4.2; vz = f.z * 4.2; if (at > a.dur - 0.05) p.burst = this.t + 0.8; break;
    }
    p.vx = vx; p.vz = vz;
  }

  // ------------------------------------------------------------------ kicking
  aiKick(p, kind, o = {}) {
    const plan = this._plan(p, kind, o);
    if (plan) this._execute(p, plan);
  }

  _choose(p, dir, power, kind) {
    let best = -1, bs = -1e9;
    const d = this.dir[p.team];
    for (const m of this.teamList[p.team]) {
      if (m === p) continue;
      const dx = m.x - p.x, dz = m.z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 2.5 || dist > 62) continue;
      const cos = (dx * dir.x + dz * dir.z) / dist;
      if (cos < 0.62) continue;
      const want = kind === 'ground' ? 5 + power * 34 : kind === 'through' ? 10 + power * 30 : 14 + power * 42;
      let s = cos * 3 - Math.abs(dist - want) * 0.045 + Math.min(this.openness(m), 8) * 0.06;
      if (kind === 'through') s += dx * d * 0.03;
      if (m.isGK) s -= 1.5;
      if (s > bs) { bs = s; best = m.idx; }
    }
    return best;
  }

  _recvVel(m) {
    if (this.isHumanCtrl(m)) return { x: m.vx * 0.8, z: m.vz * 0.8 };
    if (m.run && m.run.until > this.t) return { x: m.vx, z: m.vz };
    return { x: m.vx * 0.4, z: m.vz * 0.4 };
  }

  _clampPt(pt, margin = 1.5) {
    return { x: clamp(pt.x, -HL + margin, HL - margin), z: clamp(pt.z, -HW + margin, HW - margin) };
  }

  _crossPoint(p, target) {
    const team = p.team;
    if (target >= 0) {
      const m = this.players[target];
      return { x: m.x + this.dir[team] * 1.5, z: m.z * 0.85 };
    }
    let best = null, bs = -1e9;
    for (const m of this.teamList[team]) {
      if (m === p || m.isGK) continue;
      const X = this.X(team, m.x);
      if (X < 84 || Math.abs(m.z) > 16) continue;
      const s = this.openness(m) - Math.abs(m.z) * 0.1;
      if (s > bs) { bs = s; best = m; }
    }
    if (best) return { x: best.x + this.dir[team] * 1.5, z: best.z * 0.85, target: best.idx };
    return { x: this.wx(team, 94), z: -Math.sign(p.z || 1) * 2 };
  }

  // Build a kick plan (velocity + spin + metadata). Errors are applied in _execute.
  _plan(p, kind, o = {}) {
    const b = this.ball, team = p.team, d = this.dir[team], a = p.a;
    const from = { x: b.p.x, y: b.p.y, z: b.p.z };
    const power = clamp(o.power ?? 0.6, 0, 1);
    const dir = o.dir || faceVec(p);
    let target = o.target ?? -1;
    let vel, spin = { x: 0, y: 0, z: 0 };
    const info = { kind, pass: false, shot: false, target: -1, point: null, power };
    switch (kind) {
      case 'ground': case 'gkthrow': {
        if (kind === 'gkthrow') { from.y = BALL_R; }
        if (target < 0 && !o.point) target = this._choose(p, dir, power, 'ground');
        if (target >= 0) {
          const m = this.players[target];
          const L = leadPass(from, m, this._recvVel(m), kind === 'gkthrow' ? 4 : 4.5 + power * 2.5, kind === 'gkthrow' ? 19 : 27);
          const pt = this._clampPt(L);
          info.point = pt;
          vel = groundVel(from, pt.x, pt.z, L.speed * (o.human ? lerp(0.95, 1.18, power) : 1));
        } else {
          const dist = 6 + power * 28;
          const pt = o.point || { x: from.x + dir.x * dist, z: from.z + dir.z * dist };
          const dd = Math.hypot(pt.x - from.x, pt.z - from.z);
          vel = groundVel(from, pt.x, pt.z, Math.min(27, rollSpeedFor(dd, 1.5)));
          info.point = pt;
        }
        info.pass = true; info.target = target;
        break;
      }
      case 'through': {
        if (target < 0) target = this._choose(p, dir, power, 'through');
        let pt;
        if (target >= 0) {
          const m = this.players[target];
          const lead = 5 + power * 10;
          let rx = d * 0.85 + dir.x * 0.35, rz = dir.z * 0.35 + (m.vz / m.vmax) * 0.25;
          const rl = Math.hypot(rx, rz) || 1;
          pt = { x: m.x + (rx / rl) * lead + m.vx * 0.3, z: m.z + (rz / rl) * lead + m.vz * 0.3 };
        } else {
          const dist = 12 + power * 22;
          pt = { x: from.x + dir.x * dist, z: from.z + dir.z * dist };
        }
        pt = this._clampPt(pt, 2.5);
        const dd = Math.hypot(pt.x - from.x, pt.z - from.z);
        vel = groundVel(from, pt.x, pt.z, Math.min(27, rollSpeedFor(dd, 3.0)));
        info.pass = true; info.target = target; info.point = pt; info.run = true;
        break;
      }
      case 'lob': case 'cross': case 'throw': case 'punt': {
        let pt = o.point ? { ...o.point } : null;
        if (kind === 'throw') from.y = 2.05;
        if (kind === 'punt' && !o.fromGround) from.y = 0.9;
        if (!pt) {
          if (kind === 'cross') {
            pt = this._crossPoint(p, target);
            if (pt.target != null) target = pt.target;
            if (o.human) { const k = 0.8 + power * 0.4; pt = { x: from.x + (pt.x - from.x) * k, z: from.z + (pt.z - from.z) * k }; }
          } else {
            if (target < 0) target = this._choose(p, dir, power, 'lob');
            if (target >= 0) {
              const m = this.players[target];
              const te = Math.hypot(m.x - from.x, m.z - from.z) / 16;
              const rv = this._recvVel(m);
              pt = { x: m.x + rv.x * te, z: m.z + rv.z * te };
            } else {
              const dist = kind === 'throw' ? 6 + power * 16 : kind === 'punt' ? 30 + power * 25 : 12 + power * 36;
              pt = { x: from.x + dir.x * dist, z: from.z + dir.z * dist };
            }
          }
        } else if (kind === 'cross' && target < 0) {
          // pick the attacker nearest the chosen landing point as intended receiver
          let bd = 6;
          for (const m of this.teamList[team]) {
            const dd = Math.hypot(m.x - pt.x, m.z - pt.z);
            if (m !== p && !m.isGK && dd < bd) { bd = dd; target = m.idx; }
          }
        }
        if (kind === 'throw') {
          const dd = Math.hypot(pt.x - from.x, pt.z - from.z);
          if (dd > 26) pt = { x: from.x + ((pt.x - from.x) / dd) * 26, z: from.z + ((pt.z - from.z) / dd) * 26 };
        }
        if (!o.noClamp) pt = this._clampPt(pt, 1);
        const dist = Math.hypot(pt.x - from.x, pt.z - from.z);
        const elev = o.elev ?? (kind === 'cross' ? 0.4 : kind === 'throw' ? 0.42 : kind === 'punt' ? 0.62 : dist > 30 ? 0.55 : 0.72);
        let spinY = 0;
        if (kind === 'cross') {
          const fx = (pt.x - from.x) / (dist || 1), fz = (pt.z - from.z) / (dist || 1);
          const gxx = this.goalX(team) - from.x, gzz = -from.z;
          const side = Math.sign(gxx * -fz + gzz * fx) || 1; // goal to the right of the path?
          const curve = o.curve ?? side * 0.8;
          spinY = -curve * 32;
        }
        const res = solveLob(from, pt, elev, spinY);
        vel = res.vel; spin.y = spinY;
        info.pass = kind !== 'punt' || target >= 0; info.target = target; info.point = pt;
        info.noOffside = kind === 'throw';
        break;
      }
      case 'shot': case 'finesse': case 'penalty': case 'fk': case 'header': {
        const gx = this.goalX(team), s = Math.sign(gx);
        let tz = o.tz, ty = o.ty;
        if (tz == null) {
          const nx = gx - from.x, nz = -from.z, nl = Math.hypot(nx, nz) || 1;
          const pz = nx / nl;
          const px = -nz / nl;
          const lat = dir.x * px + dir.z * pz;
          const gkp = this.gk(1 - team);
          if (Math.abs(lat) < 0.25) {
            tz = kind === 'finesse' ? -(Math.sign(from.z) || 1) * (GOAL.HW - 0.6) : (gkp.z > 0 ? -1 : 1) * GOAL.HW * 0.55;
          } else tz = clamp(pz * lat * 6.5, -(GOAL.HW - 0.3), GOAL.HW - 0.3);
        }
        if (ty == null) {
          ty = kind === 'finesse' ? 0.8 + power * 0.9 : kind === 'header' ? 0.5 + power * 0.8 : 0.3 + power * 1.3;
          if (power > 0.85 && kind !== 'header') ty += (power - 0.85) * 16;
        } else if (kind === 'penalty' && power > 0.86) ty += (power - 0.86) * 12;
        let speed;
        if (kind === 'finesse') speed = 11 + power * (10 + a.sho * 0.06);
        else if (kind === 'penalty') speed = 15 + power * (10 + a.sho * 0.07);
        else if (kind === 'fk') speed = 22 + power * (3 + a.sho * 0.03);
        else if (kind === 'header') speed = clamp(8 + a.phy * 0.04 + Math.hypot(b.v.x, b.v.y, b.v.z) * 0.25, 8, 19);
        else speed = 12 + power * (12 + a.sho * 0.09);
        const dist = Math.hypot(gx - from.x, tz - from.z) || 1;
        const fx = (gx - from.x) / dist, fz = (tz - from.z) / dist;
        const topW = kind === 'fk' ? 22 : kind === 'header' ? 0 : 8;
        spin = { x: fz * topW, y: 0, z: -fx * topW };
        if (kind === 'finesse' || kind === 'fk') {
          const want = kind === 'fk' ? -Math.sign(tz || 1) : Math.sign(from.z - tz) || 1;
          const W = kind === 'fk' ? 34 : 22 + a.sho * 0.3;
          spin.y = -want * s * W;
        }
        vel = solveShot(from, { x: gx, y: ty, z: tz }, speed, spin);
        info.shot = true; info.target = -1; info.point = { x: gx, z: tz };
        break;
      }
      default: return null;
    }
    if (!vel || !Number.isFinite(vel.x + vel.y + vel.z)) return null;
    return { vel, spin, info, from };
  }

  _errMul(p) { return this.human[p.team] ? 1 : this.diff.err; }

  _applyErr(vel, sYaw, sPitch, sSpeed, keepFlat) {
    const g = this.rng.gauss;
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    const h = Math.hypot(vel.x, vel.z);
    const yaw = Math.atan2(vel.z, vel.x) + g() * sYaw;
    const pitch = keepFlat ? 0 : Math.atan2(vel.y, h) + g() * sPitch;
    const s = sp * (1 + g() * sSpeed);
    return { x: Math.cos(yaw) * Math.cos(pitch) * s, y: Math.sin(pitch) * s, z: Math.sin(yaw) * Math.cos(pitch) * s };
  }

  _execute(p, plan) {
    const { info } = plan;
    let vel = plan.vel;
    const a = p.a, em = this._errMul(p);
    const fatigue = 1 - p.stam;
    const press = this.pressureOn(p) < 1.6 ? 1.25 : 1;
    const kdir = Math.atan2(vel.z, vel.x);
    const turn = Math.abs(wrapAngle(kdir - p.face)) > 1.2 ? 1.5 : 1;
    const k = info.kind;
    if (k === 'ground' || k === 'through' || k === 'gkthrow') {
      const s = (0.009 + (100 - a.pas) * 0.001) * (1 + fatigue * 0.6) * turn * press * em;
      vel = this._applyErr(vel, s, 0, 0.03 + (100 - a.pas) * 0.0012, true);
    } else if (k === 'lob' || k === 'cross' || k === 'throw' || k === 'punt') {
      const pa = k === 'punt' ? (a.kic + a.pas) / 2 : a.pas;
      const s = (0.018 + (100 - pa) * 0.0015) * (1 + fatigue * 0.5) * turn * em;
      vel = this._applyErr(vel, s, s * 0.6, 0.035 + (100 - pa) * 0.0012, false);
    } else if (k === 'penalty') {
      const s = (0.008 + (100 - a.sho) * 0.0007) * (1 + Math.max(0, info.power - 0.72) * 3) * em;
      vel = this._applyErr(vel, s, s * 0.7, 0.02, false);
    } else if (k === 'header') {
      const s = (0.03 + (100 - (a.sho + a.phy) / 2) * 0.0012) * em;
      vel = this._applyErr(vel, s, s * 0.8, 0.06, false);
    } else {
      const s = (0.02 + (100 - a.sho) * 0.0024) * (1 + Math.max(0, info.power - 0.75) * 2.2) * (1 + fatigue * 0.5) * press * turn * em;
      vel = this._applyErr(vel, s, s * 0.75, 0.03, false);
    }
    if (plan.from && plan.from.y !== this.ball.p.y) this.ball.p.y = plan.from.y;
    this._release(p, vel, plan.spin, info);
  }

  _release(p, vel, spin, info) {
    const b = this.ball, t = this.t;
    const wasSetPiece = this.phase === PHASE.SETPIECE || this.phase === PHASE.KICKOFF;
    b.owner = -1; b.inHands = false;
    b.v = { x: vel.x, y: vel.y, z: vel.z };
    b.w = { x: spin.x, y: spin.y, z: spin.z };
    b.lastTouch = p.idx; b.lastTeam = p.team; b.kicker = p.idx; b.kickT = t;
    b.intended = info.target ?? -1;
    p.cool.touch = t + 0.3;
    this.path = null; this.nextPredict = 0;
    p.holdStart = null; p.drib = null; p.windup = 0;
    p.face = Math.atan2(vel.z, vel.x);
    p.faceLock = t + 0.25;
    const k = info.kind;
    if (k === 'throw' || k === 'gkthrow') p.act = { type: 'throw', t0: t, dur: 0.45 };
    else if (k === 'header') { if (!p.act || p.act.type !== 'head') p.act = { type: 'head', t0: t - 0.25, dur: 0.45, jh: 0.2 }; }
    else if (!p.act || p.act.type === 'kick' || p.act.type === 'skill' || p.act.type === 'chest') p.act = { type: 'kick', t0: t, dur: 0.38, pw: k === 'shot' || k === 'fk' || k === 'penalty' || k === 'punt' ? 1 : k === 'ground' ? 0.4 : 0.7 };
    this.fxPush('kick', { s: Math.round(Math.hypot(vel.x, vel.y, vel.z)) });
    this.pendingOffside = null;
    if (info.pass) {
      this.pendingPass = { from: p.idx, team: p.team, t };
      p.st.passAtt++;
      this.lastPasser[p.team] = { idx: p.idx, t };
      if (info.target >= 0) {
        const m = this.players[info.target];
        const noOff = info.noOffside || (wasSetPiece && this.sp && [SP.THROW, SP.CORNER, SP.GOALKICK].includes(this.sp.type));
        if (!noOff) {
          const off = isOffside({ receiverX: m.x, ballX: b.p.x, defenderXs: this.teamList[1 - p.team].map((o) => o.x), dir: this.dir[p.team] });
          if (off) this.pendingOffside = { idx: m.idx, team: m.team, x: m.x, z: m.z };
        }
        if (info.run && info.point && !this.isHumanCtrl(m)) m.run = { x: info.point.x, z: info.point.z, until: t + 3.5 };
        if (this.human[p.team] && this.ctrl[p.team] === p.idx && !m.isGK) this.ctrl[p.team] = m.idx;
      }
    } else if (!info.shot) {
      this.pendingPass = null;
    }
    if (info.shot) {
      this.pendingPass = null;
      this.shotTracker.onShot(p.team, t, p.idx);
      this.stats.shots[p.team]++;
      p.st.shots++;
      const pr = predictBall(b, 3, 0.02);
      const side = this.dir[p.team];
      for (const s of pr) {
        if (behindLine(s, side) > BALL_R) {
          if (Math.abs(s.z) < GOAL.HW && s.y < GOAL.H) { this.stats.sot[p.team]++; p.st.sot++; this.shotTracker.shot.onTarget = true; }
          break;
        }
      }
    }
    if (wasSetPiece) this._setPieceTaken(p, info);
  }

  // ------------------------------------------------------------------ movement
  _movePlayers(dt) {
    const t = this.t;
    for (const p of this.players) {
      if (p.sentOff) continue;
      let locked = false, mul = 1;
      const a = p.act;
      if (a) {
        const at = t - a.t0;
        if (at >= a.dur) {
          p.act = a.next ? { ...a.next, t0: t } : null;
        } else {
          switch (a.type) {
            case 'slide': { const k = Math.max(0, 1 - at / a.dur); p.vx = a.dx * a.v0 * k; p.vz = a.dz * a.v0 * k; locked = true; break; }
            case 'dive': { if (at < a.flight) { p.vx = a.vx; p.vz = a.vz; } else { p.vx *= 0.8; p.vz *= 0.8; } locked = true; break; }
            case 'tackle': {
              const s = at < 0.2 ? Math.max(3.2, Math.hypot(p.vx, p.vz)) : Math.hypot(p.vx, p.vz) * 0.9;
              p.vx = Math.cos(p.face) * s; p.vz = Math.sin(p.face) * s; locked = true; break;
            }
            case 'fall': case 'down': case 'throw': case 'wall': { p.vx *= 0.85; p.vz *= 0.85; locked = true; break; }
            case 'skill': if (this.ball.owner === p.idx) { this._skillMove(p, a, at); locked = true; } break;
            case 'kick': mul = 0.55; break;
            case 'head': case 'chest': mul = 0.6; break;
          }
        }
      }
      if (!locked) {
        let dx = p.des.x * mul - p.vx, dz = p.des.z * mul - p.vz;
        const dv = Math.hypot(dx, dz);
        const braking = p.des.x * p.vx + p.des.z * p.vz < 0 || Math.hypot(p.des.x, p.des.z) < Math.hypot(p.vx, p.vz);
        const acc = p.acc * (braking ? 1.7 : 1) * (0.7 + 0.3 * p.stam) * (this.ball.owner === p.idx ? 0.85 : 1);
        const maxDv = acc * dt;
        if (dv > maxDv) { dx *= maxDv / dv; dz *= maxDv / dv; }
        p.vx += dx; p.vz += dz;
      }
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.x = clamp(p.x, -HL - 5, HL + 5); p.z = clamp(p.z, -HW - 4.5, HW + 4.5);
      const sp = Math.hypot(p.vx, p.vz);
      if (!locked || (a && a.type === 'tackle')) {
        let tf = p.face;
        if (p.faceLock > t) tf = p.face;
        else if (sp > 0.8) tf = Math.atan2(p.vz, p.vx);
        else if (p.faceBall != null) tf = p.faceBall;
        const own = this.ball.owner === p.idx;
        const rate = Math.max(2.5, (own ? 6 + p.a.dri * 0.05 : 10) - sp * 0.45);
        p.face = wrapAngle(angleTo(p.face, tf, rate * dt));
      }
      p.speed = sp;
      this._stamina(p, dt, sp);
    }
  }

  _stamina(p, dt, sp) {
    const sprinting = p.sprint && sp > p.vmax * 0.8;
    const phy = p.a.phy;
    if (sprinting) p.stam -= dt * (0.05 + (100 - phy) * 0.0004);
    else p.stam += dt * (sp < 2 ? 0.05 : 0.025);
    const gm = (dt * this.gameRate) / 60;
    if (this.phase === PHASE.PLAY) p.stamMax -= gm * (0.0026 + (100 - phy) * 0.00003) + (sprinting ? dt * 0.0015 : 0);
    p.stamMax = clamp(p.stamMax, 0.35, 1);
    p.stam = clamp(p.stam, 0, p.stamMax);
  }

  _collide() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.sentOff || (a.act && (a.act.type === 'slide' || a.act.type === 'dive'))) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.sentOff || (b.act && (b.act.type === 'slide' || b.act.type === 'dive'))) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.5184 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), ov = 0.72 - d;
        const wa = b.a.phy / (a.a.phy + b.a.phy);
        const nx = dx / d, nz = dz / d;
        a.x -= nx * ov * wa; a.z -= nz * ov * wa;
        b.x += nx * ov * (1 - wa); b.z += nz * ov * (1 - wa);
      }
    }
  }

  // ------------------------------------------------------------------ ball
  _dribble(dt) {
    const b = this.ball, p = this.players[b.owner];
    if (b.inHands) {
      const low = p.act && (p.act.type === 'dive' || p.act.type === 'down');
      b.p.x = p.x + Math.cos(p.face) * 0.3; b.p.z = p.z + Math.sin(p.face) * 0.3; b.p.y = low ? 0.35 : 1.05;
      b.v.x = p.vx; b.v.z = p.vz; b.v.y = 0;
      return;
    }
    const sp = Math.hypot(p.vx, p.vz);
    let fx = Math.cos(p.face), fz = Math.sin(p.face);
    let side = 0;
    if (p.act && p.act.type === 'skill' && p.act.kind === 'ballroll') side = 0.18 * p.act.side;
    const reach = 0.42 + sp * 0.05 * (1.3 - p.a.dri / 100);
    const off = reach + Math.max(0, Math.sin(this.t * (2 + sp * 1.4) + p.idx)) * 0.14 * Math.min(1, sp / 4);
    const tx = p.x + fx * off - fz * side, tz = p.z + fz * off + fx * side;
    const k = Math.min(1, dt * 16);
    b.p.x += (tx - b.p.x) * k; b.p.z += (tz - b.p.z) * k; b.p.y = BALL_R;
    b.v.x = p.vx; b.v.z = p.vz; b.v.y = 0;
    b.w.x = b.v.z / BALL_R; b.w.y = 0; b.w.z = -b.v.x / BALL_R;
  }

  _updateBall(dt) {
    const b = this.ball;
    if (b.owner >= 0) {
      const p = this.players[b.owner];
      if (!b.inHands && p.act && ['fall', 'down', 'slide', 'dive'].includes(p.act.type)) {
        b.owner = -1; b.inHands = false; b.v.y = 0; this.path = null;
        stepBall(b, dt);
      } else this._dribble(dt);
    } else {
      stepBall(b, dt, this.physEv);
      this._physFx();
    }
    const c = classifyBall(b.p);
    if (c) this._ballOut(c);
  }

  _physFx() {
    for (const e of this.physEv) {
      if (e.k === 'post') this.fxPush('post', { s: Math.round(e.s) });
      else if (e.k === 'net') this.fxPush('net', { x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), s: Math.round(e.s) });
    }
    this.physEv.length = 0;
  }

  _ballOut(c) {
    const b = this.ball;
    if (c.type === 'goal') return this._goal(c.side);
    b.owner = -1; b.inHands = false;
    if (c.type === 'touch') {
      const x = clamp(b.p.x, -HL + 1, HL - 1);
      this.fxPush('out');
      this._stop(SP.THROW, 1 - b.lastTeam, x, c.side * HW, 1.2);
    } else {
      const defTeam = this.dir[0] === -c.side ? 0 : 1;
      if (b.lastTeam === defTeam) {
        this.stats.corners[1 - defTeam]++;
        this._stop(SP.CORNER, 1 - defTeam, c.side * HL, Math.sign(b.p.z || 1) * HW, 1.6);
      } else {
        this._stop(SP.GOALKICK, defTeam, c.side * HL, Math.sign(b.p.z || 1), 1.6);
      }
    }
  }

  _goal(side) {
    const b = this.ball, t = this.t;
    const scoring = this.dir[0] === side ? 0 : 1;
    this.score[scoring]++;
    let toucher = this.players[b.lastTouch] || this.nearestToBall(scoring);
    const shot = this.shotTracker.shot;
    // a shot deflected/parried in by the defending side still belongs to the shooter
    if (toucher.team !== scoring && shot && shot.team === scoring && t - shot.t < 4) toucher = this.players[shot.by];
    const og = toucher.team !== scoring;
    this.shotTracker.onGoal();
    const minute = Math.min(this.minute(), this.half * 45 + (this.addedSet ? this.added : 0));
    if (!og) {
      toucher.st.goals++;
      const lp = this.lastPasser[scoring];
      if (lp && lp.idx !== toucher.idx && t - lp.t < 12) this.players[lp.idx].st.assists++;
    }
    this.gk(1 - scoring).st.conceded++;
    this.scorers.push({ playerId: toucher.data.id, team: this.sideName(scoring), minute, ownGoal: og, name: toucher.data.name });
    this.emit({ type: 'goal', team: this.sideName(scoring), playerId: toucher.data.id, playerName: toucher.data.name, minute, ownGoal: og, score: [...this.score] });
    this.fxPush('goal', { team: scoring, pi: toucher.idx, og: og ? 1 : 0 });
    this.phase = PHASE.GOAL; this.phaseT = t; this.goalT = t; this.skipReq = false;
    this.kickoffTeam = 1 - scoring;
    this.stoppage += 0.5;
    this.pendingPass = null; this.pendingOffside = null; b.intended = -1;
    const celeb = og ? this.nearestToBall(scoring) : toucher;
    this.celeb = celeb.idx;
    celeb.celebKind = Math.floor(this.rng() * 3);
    for (const p of this.players) { p.run = null; p.gkPlan = null; if (p.act && p.act.type !== 'dive') p.act = null; }
  }

  _stepGoal(dt) {
    const b = this.ball, t = this.t;
    if (b.owner >= 0) { b.owner = -1; b.inHands = false; }
    stepBall(b, dt, this.physEv); this._physFx();
    const sc = this.players[this.celeb];
    const scoringTeam = sc.team;
    const endX = this.goalX(scoringTeam);
    for (const p of this.players) {
      if (p.sentOff) continue;
      if (p === sc) {
        const tgt = { x: endX * 0.8, z: Math.sign(p.z || 1) * (HW - 4) };
        AI.goTo(this, p, tgt, 'run', 1.5);
        if (!p.act || p.act.type !== 'celeb') p.act = { type: 'celeb', t0: t, dur: 30 };
      } else if (p.team === scoringTeam && !p.isGK) {
        const d = Math.hypot(sc.x - p.x, sc.z - p.z);
        if (d < 30) AI.goTo(this, p, sc, d > 6 ? 'run' : 'jog', 2.2);
        else { p.des.x *= 0.9; p.des.z *= 0.9; }
        if (d < 5 && (!p.act || p.act.type !== 'celeb')) p.act = { type: 'celeb', t0: t, dur: 30 };
      } else { p.des.x *= 0.9; p.des.z *= 0.9; }
    }
    this._movePlayers(dt);
    this._collide();
    if (this.t - this.phaseT > 3.4 || this.skipReq) {
      this.phase = PHASE.REPLAY; this.phaseT = t;
      this.replayFrom = this.goalT;
    }
  }

  // ------------------------------------------------------------------ contacts
  _interactions() {
    const b = this.ball, t = this.t;
    if (b.owner >= 0) return;
    for (let team = 0; team < 2; team++) {
      const g = this.gk(team);
      if (!g.sentOff && this._gkTouch(g)) return;
    }
    let best = null, bd = 1e9, bz = null;
    for (const p of this.players) {
      if (p.sentOff || p.cool.touch > t) continue;
      if (p.act && ['fall', 'down', 'dive', 'slide', 'sentoff', 'throw'].includes(p.act.type)) continue;
      const dx = b.p.x - p.x, dz = b.p.z - p.z;
      const hd = Math.hypot(dx, dz);
      if (hd > 1.3) continue;
      const y = b.p.y, jump = this._jumpH(p);
      const bs = Math.hypot(b.v.x, b.v.z);
      let zone = null, reach = 0;
      if (y < 0.7) { zone = 'feet'; reach = 0.55 + (bs < 3 ? (3 - bs) * 0.13 : 0); }
      else if (y < 1.45 + jump) { zone = 'chest'; reach = 0.45; }
      else if (y < 2.05 + jump) { zone = 'head'; reach = 0.42; }
      if (!zone || hd > reach) continue;
      if (hd < bd) { bd = hd; best = p; bz = zone; }
    }
    if (best) this._touch(best, bz);
  }

  _touch(p, zone) {
    const b = this.ball, t = this.t;
    if (this.pendingOffside) {
      if (this.pendingOffside.idx === p.idx) return this._offside(p);
      this.pendingOffside = null;
    }
    if (zone === 'head') return this._header(p);
    const rel = Math.hypot(b.v.x - p.vx, b.v.y, b.v.z - p.vz);
    const human = this.isHumanCtrl(p);
    if (human) {
      const buf = this.buffer[p.team];
      const inp = this.inputs[p.team] || EMPTY_IN;
      let kind = null, power = 0.6, aim = this.aimInfo[p.team] || faceVec(p);
      if (buf && buf.until > t && buf.idx === p.idx) { kind = buf.k; power = buf.power; aim = buf.aim; }
      else if (inp.shoot) { kind = 'shoot'; power = clamp((this.holds[p.team].shoot || 0.3), 0.2, 1); }
      if (kind) {
        this.buffer[p.team] = null;
        this.holds[p.team].shoot = 0;
        this._gain(p, 'feet', true);
        const map = { pass: 'ground', through: 'through', lob: this._isCrossZone(p) ? 'cross' : 'lob', shoot: 'shot', finesse: 'finesse' };
        this._humanKick(p, map[kind], aim, power);
        return;
      }
    } else if (this._aiFirstTime(p, zone, rel)) return;
    const ctrlMax = zone === 'feet' ? 13 + p.a.dri * 0.11 : 9 + p.a.dri * 0.06;
    if (rel > ctrlMax) return this._deflect(p, zone);
    let heavy = clamp(((rel - 6) / 22) * (1.25 - p.a.dri / 100) + (this.pressureOn(p) < 1.5 ? 0.08 : 0), 0, 0.45);
    if (human) heavy *= 0.6;
    if (this.rng() < heavy) {
      // heavy first touch: the ball bounces off the player and runs loose
      const g = this.rng.gauss;
      b.v.x = b.v.x * 0.3 + p.vx * 0.9 + g() * 1.8; b.v.z = b.v.z * 0.3 + p.vz * 0.9 + g() * 1.8; b.v.y = Math.abs(b.v.y) * 0.2;
      b.lastTouch = p.idx; b.lastTeam = p.team; b.intended = -1;
      p.cool.touch = t + 0.3; this.pendingPass = null; this.path = null;
      this.fxPush('kick', { s: 4 });
      return;
    }
    this._gain(p, zone === 'chest' ? 'chest' : 'feet');
  }

  _aiFirstTime(p, zone, rel) {
    if (zone !== 'feet' && zone !== 'chest') return false;
    const X = this.X(p.team, p.x);
    if (X < 86 || Math.abs(p.z) > 14 || this.ball.lastTeam !== p.team) return false;
    if (this.rng() > 0.35 + p.a.sho / 250) return false;
    this._gain(p, 'feet', true);
    const gk = this.gk(1 - p.team);
    const tz = (gk.z > 0 ? -1 : 1) * (GOAL.HW - 0.6 - this.rng() * 1.2);
    this.aiKick(p, 'shot', { tz, ty: 0.3 + this.rng() * 1.2, power: 0.7 });
    return true;
  }

  _gain(p, how, silent = false) {
    const b = this.ball, t = this.t;
    const prevTeam = b.lastTeam;
    b.owner = p.idx; b.inHands = how === 'hands'; b.intended = -1;
    b.lastTouch = p.idx; b.lastTeam = p.team;
    b.v.y = 0;
    if (b.inHands) { b.v.x = 0; b.v.z = 0; b.w.x = b.w.y = b.w.z = 0; }
    p.gainT = t; p.holdStart = null; p.drib = null; p.run = null;
    p.nextThink = t + 0.1 + this.diffFor(p.team).react * 0.6;
    p.st.touches++;
    const pp = this.pendingPass;
    if (pp) {
      if (pp.team === p.team && pp.from !== p.idx) { this.stats.passes[p.team]++; this.players[pp.from].st.passes++; }
      this.pendingPass = null;
    }
    const r = this.shotTracker.update(t, true);
    if (r) this._shotResolved(r);
    if (how === 'chest' && !silent) p.act = { type: 'chest', t0: t, dur: 0.3 };
    if (this.human[p.team] && (!p.isGK || how === 'hands')) this.ctrl[p.team] = p.idx;
    if (prevTeam !== p.team) {
      const o = 1 - p.team;
      if (this.human[o]) {
        const c = this.players[this.ctrl[o]];
        if (!c || c.sentOff || Math.hypot(c.x - p.x, c.z - p.z) > 16) {
          const n = this.nearestToBall(o);
          if (n) this.ctrl[o] = n.idx;
        }
      }
    }
    if (!silent) this.fxPush('touch', { s: 1 });
  }

  _deflect(p, zone) {
    const b = this.ball, t = this.t;
    let nx = b.p.x - p.x, nz = b.p.z - p.z;
    const hl = Math.hypot(nx, nz) || 1e-3;
    nx /= hl; nz /= hl;
    let ny = zone === 'head' ? 0.5 : zone === 'chest' ? 0.15 : 0.05;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    const rvx = b.v.x - p.vx, rvy = b.v.y, rvz = b.v.z - p.vz;
    const vn = rvx * nx + rvy * ny + rvz * nz;
    if (vn < 0) {
      const j = -(1 + 0.35) * vn;
      b.v.x += j * nx; b.v.y += j * ny; b.v.z += j * nz;
    }
    const g = this.rng.gauss;
    b.v.x = b.v.x * 0.7 + g() * 1.2; b.v.z = b.v.z * 0.7 + g() * 1.2; b.v.y = Math.abs(b.v.y * 0.7) + Math.abs(g()) * 1.2;
    b.w.x *= 0.3; b.w.y *= 0.3; b.w.z *= 0.3;
    b.lastTouch = p.idx; b.lastTeam = p.team;
    b.intended = -1;
    p.cool.touch = t + 0.25;
    this.pendingPass = null;
    this.path = null;
    this.fxPush('kick', { s: 8 });
  }

  _header(p) {
    const b = this.ball, team = p.team;
    const X = this.X(team, p.x);
    const human = this.isHumanCtrl(p);
    const inp = this.inputs[team] || EMPTY_IN;
    const buf = this.buffer[team];
    let kind = 'auto';
    if (human) {
      if (inp.shoot || inp.finesse || (buf && buf.until > this.t && (buf.k === 'shoot' || buf.k === 'finesse'))) kind = 'goal';
      else if (inp.pass || inp.lob || inp.through || (buf && buf.until > this.t)) kind = 'pass';
      this.buffer[team] = null;
    }
    if (kind === 'auto') kind = X > 85 && Math.abs(p.z) < 17 ? 'goal' : X < 42 ? 'clear' : 'pass';
    b.owner = p.idx; // temporarily, so the plan uses current ball state
    const prevTeam = b.lastTeam;
    b.owner = -1;
    b.lastTouch = p.idx; b.lastTeam = p.team;
    const pp = this.pendingPass;
    if (pp && pp.team === team && pp.from !== p.idx) { this.stats.passes[team]++; this.players[pp.from].st.passes++; }
    this.pendingPass = null;
    const r = this.shotTracker.update(this.t, true);
    if (r) this._shotResolved(r);
    void prevTeam;
    if (kind === 'goal') {
      const gk = this.gk(1 - team);
      const tz = (gk.z > 0 ? -1 : 1) * (GOAL.HW - 0.5 - this.rng() * 1.4);
      const plan = this._plan(p, 'header', { tz: human ? undefined : tz, ty: 0.25 + this.rng() * 1.3, power: 0.7, dir: human ? this.aimInfo[team] : undefined });
      if (plan) return this._execute(p, plan);
    }
    let vel;
    if (kind === 'clear') {
      const d = this.dir[team];
      const z = clamp(p.z * 1.6 + (this.rng() - 0.5) * 20, -30, 30);
      const tx = p.x + d * 22, dx = tx - p.x, dz = z - p.z, dl = Math.hypot(dx, dz) || 1;
      const s = 13 + p.a.phy * 0.03;
      vel = { x: (dx / dl) * s * 0.8, y: s * 0.6, z: (dz / dl) * s * 0.8 };
      this._execute(p, { vel, spin: { x: 0, y: 0, z: 0 }, info: { kind: 'header', pass: false, shot: false, target: -1, power: 0.6 } });
      return;
    }
    const dir = human ? this.aimInfo[team] || faceVec(p) : { x: this.dir[team], z: 0 };
    let target = this._choose(p, dir, 0.3, 'lob');
    if (target < 0) target = this._choose(p, faceVec(p), 0.3, 'lob');
    let tx, tz;
    if (target >= 0) { tx = this.players[target].x; tz = this.players[target].z; }
    else { tx = p.x + dir.x * 12; tz = p.z + dir.z * 12; }
    const dx = tx - p.x, dz = tz - p.z, dl = Math.hypot(dx, dz) || 1;
    const s = clamp(dl * 0.75, 6, 14);
    vel = { x: (dx / dl) * s * 0.9, y: s * 0.35, z: (dz / dl) * s * 0.9 };
    this._execute(p, { vel, spin: { x: 0, y: 0, z: 0 }, info: { kind: 'header', pass: true, shot: false, target, power: 0.5, noOffside: false } });
  }

  _gkTouch(g) {
    const b = this.ball, t = this.t;
    if (g.cool.touch > t) return false;
    const d = this.dir[g.team];
    if (!inOwnPenaltyArea(g.x, g.z, d)) return false;
    if (!keeperCanSave(b.p, -d)) return false;
    // no handling of a deliberate pass from a team-mate
    if (b.lastTeam === g.team && b.kicker !== g.idx && this.pendingPass && this.pendingPass.team === g.team) return false;
    let hit = false, stretched = false;
    if (g.act && g.act.type === 'dive') {
      const at = t - g.act.t0;
      if (at > g.act.flight + 0.35) return false;
      const e = clamp(at / g.act.flight, 0, 1);
      const a = g.act;
      const body = { x: g.x, y: lerp(0.9, clamp(a.h * 0.6, 0.35, 1.4), e), z: g.z };
      const hands = { x: g.x + a.hx * e, y: lerp(1.3, a.h, e), z: g.z + a.side * (0.35 + 0.65 * e) };
      hit = segDist3(b.p, body, hands) < 0.3;
      stretched = e > 0.6;
    } else if (!g.act || ['head', 'kick', 'chest'].includes(g.act.type)) {
      const hd = Math.hypot(b.p.x - g.x, b.p.z - g.z);
      hit = hd < 0.62 && b.p.y < 2.35 + this._jumpH(g);
    } else return false;
    if (!hit) return false;
    const speed = Math.hypot(b.v.x, b.v.y, b.v.z);
    const catchV = (13 + g.a.han * 0.13) * (stretched ? 0.7 : 1) * this.diffFor(g.team).gk;
    const shot = this.shotTracker.shot;
    const valid = shot && shot.team !== g.team ? this.shotTracker.onKeeperTouch(t, false) : false;
    if (speed < catchV || speed < 7) {
      this._gain(g, 'hands');
      if (valid) this._shotResolved(this.shotTracker.update(t, true));
    } else {
      // parry away from goal
      const side = g.act && g.act.type === 'dive' ? g.act.side : Math.sign(b.p.z - g.z) || 1;
      const k = 0.25 + this.rng() * 0.2;
      if (this.X(g.team, g.x) > 1.3 && Math.abs(b.p.z) > 1.2 && this.rng() < 0.45) {
        // tipped wide of the post
        b.v.x = -d * (1.5 + this.rng() * 2);
        b.v.z = Math.sign(b.p.z) * (7 + this.rng() * 4);
        b.v.y = 1.5 + this.rng() * 3;
      } else {
        b.v.x = d * (2 + speed * k);
        b.v.z = side * (2 + speed * (0.15 + this.rng() * 0.2));
        b.v.y = 1 + this.rng() * 4;
      }
      b.w.x = b.w.y = b.w.z = 0;
      b.lastTouch = g.idx; b.lastTeam = g.team; b.intended = -1;
      g.cool.touch = t + 0.5;
      this.pendingPass = null; this.path = null;
      this.fxPush('parry', { pi: g.idx });
    }
    return true;
  }

  _shotResolved(r) {
    if (!r || !r.save) return;
    const g = this.gk(1 - r.shot.team);
    g.st.saves++;
    this.fxPush('save', { pi: g.idx });
  }

  planSave(g) {
    const team = g.team, t = this.t;
    const gX = this.X(team, g.x);
    let cross = null, goal = null;
    let prev = null;
    for (const s of this.path) {
      const sX = this.X(team, s.x);
      if (!cross && sX <= gX + 0.3) cross = interp(prev, s, team, this, gX + 0.3);
      if (sX <= 0) { goal = interp(prev, s, team, this, 0); break; }
      prev = s;
    }
    if (!cross) return null;
    const react = 0.12 + this.diffFor(team).react * 0.3 + (100 - g.a.ref) * 0.005;
    return { tReact: t + react, tc: t + cross.t, x: cross.x, y: cross.y, z: cross.z, gz: goal ? goal.z : cross.z, gy: goal ? goal.y : cross.y };
  }

  startDive(g, plan) {
    const t = this.t;
    const side = Math.sign(plan.z - g.z) || 1;
    const need = Math.abs(plan.z - g.z) - 0.85;
    const maxBody = (0.55 + g.a.div * 0.01) * this.diffFor(g.team).gk * (plan.pen ? 0.72 : 1);
    const timeLeft = Math.max(0.2, plan.tc - t);
    const flight = clamp(timeLeft, 0.28, 0.5);
    const vmax = 3.2 + g.a.div * 0.02 + g.a.spd * 0.005;
    const travel = clamp(need, 0.1, Math.min(maxBody, vmax * flight));
    const h = clamp(plan.y, 0.15, 2.2 + g.a.div * 0.003);
    g.act = { type: 'dive', t0: t, dur: flight + 0.9, flight, side, h, vz: (side * travel) / flight, vx: ((plan.x - g.x) / flight) * 0.4, hx: 0 };
    g.animP = side * (1 + h);
  }

  gkSmother(g, owner) {
    const t = this.t;
    g.cool.tackle = t + 1.5;
    const side = Math.sign(owner.z - g.z) || 1;
    g.act = { type: 'dive', t0: t, dur: 1.1, flight: 0.3, side, h: 0.3, vz: (owner.z - g.z) / 0.3 * 0.6, vx: (owner.x - g.x) / 0.3 * 0.6, hx: 0 };
    g.animP = side * 1.3;
    const pr = clamp(0.3 + (g.a.div + g.a.pos) / 400 - owner.a.dri / 300, 0.12, 0.7);
    if (this.rng() < pr) {
      this.ball.owner = -1;
      g.act = null;
      this._gain(g, 'hands');
      g.act = { type: 'down', t0: t, dur: 0.6 };
    }
  }

  // ------------------------------------------------------------------ tackles
  _tackles() {
    const t = this.t;
    for (const p of this.players) {
      const a = p.act;
      if (!a || p.sentOff) continue;
      if (a.type === 'tackle' && !a.done && t - a.t0 >= 0.12) { a.done = true; this._resolveStanding(p); if (this.phase !== PHASE.PLAY) return; }
      else if (a.type === 'slide' && !a.res && t - a.t0 < 0.62) { this._slideContact(p, a); if (this.phase !== PHASE.PLAY) return; }
    }
  }

  _winBall(p, slide) {
    const b = this.ball, t = this.t;
    const prev = this.owner();
    if (prev) prev.cool.touch = t + 0.4;
    b.owner = -1; b.inHands = false;
    if (!slide && this.rng() < 0.4 + p.a.def / 400) { this._gain(p, 'feet'); return; }
    const f = faceVec(p);
    const s = slide ? 5 + this.rng() * 3 : 3 + this.rng() * 2;
    b.v.x = f.x * s + (this.rng() - 0.5) * 2.5; b.v.z = f.z * s + (this.rng() - 0.5) * 2.5; b.v.y = slide ? 0.5 : 0;
    b.lastTouch = p.idx; b.lastTeam = p.team; b.intended = -1;
    p.cool.touch = t + 0.15;
    this.pendingPass = null; this.path = null;
    this.fxPush('kick', { s: 6 });
  }

  _lastMan(victim, offender) {
    const team = victim.team;
    const X = this.X(team, victim.x);
    if (X < 72 || Math.abs(victim.z) > 22) return false;
    for (const m of this.teamList[offender.team]) {
      if (m === offender || m.isGK) continue;
      if (this.X(team, m.x) > X - 1) return false;
    }
    return true;
  }

  _resolveStanding(p) {
    const b = this.ball, t = this.t;
    const f = faceVec(p);
    const foot = { x: p.x + f.x * 0.85, z: p.z + f.z * 0.85 };
    const owner = this.owner();
    if ((owner && owner.team === p.team) || b.inHands) return;
    const victim = owner;
    const bd = Math.hypot(b.p.x - foot.x, b.p.z - foot.z);
    const reach = bd < 0.85 && b.p.y < 0.6;
    const behind = victim ? this.fromBehind(p, victim) : false;
    let won = false;
    if (reach) {
      if (!victim) won = true;
      else {
        const pr = clamp(0.5 + (p.a.def - victim.a.dri) * 0.012 + (behind ? -0.2 : 0.12) + (victim.act && victim.act.type === 'skill' ? -0.15 : 0), 0.1, 0.93);
        won = this.rng() < pr;
      }
    }
    const contact = victim ? Math.hypot(victim.x - p.x, victim.z - p.z) < 1.25 && (!won && this.rng() < 0.7) : false;
    if (won) { this._winBall(p, false); p.st.tackles++; }
    if (victim) {
      const j = judgeTackle({ wonBall: won, contactFirst: !won && contact && !reach, fromBehind: behind, slide: false, bodyContact: contact, lastMan: this._lastMan(victim, p) });
      if (j.foul) this._foul(p, victim, j.card);
    }
  }

  _slideContact(p, a) {
    const b = this.ball;
    const f = { x: a.dx, z: a.dz };
    const foot = { x: p.x + f.x * 0.95, z: p.z + f.z * 0.95 };
    if (!a.ballDone && !b.inHands && Math.hypot(b.p.x - foot.x, b.p.z - foot.z) < 0.75 && b.p.y < 0.5) {
      const o = this.owner();
      if (!o || o.team !== p.team) {
        a.ballDone = true;
        this._winBall(p, true);
        p.st.tackles++;
      }
    }
    for (const o of this.teamList[1 - p.team]) {
      if (o.act && (o.act.type === 'fall' || o.act.type === 'dive')) continue;
      const d1 = Math.hypot(o.x - foot.x, o.z - foot.z), d2 = Math.hypot(o.x - p.x, o.z - p.z);
      if (d1 < 0.6 || d2 < 0.55) {
        a.res = true;
        const behind = this.fromBehind(p, o);
        const j = judgeTackle({ wonBall: !!a.ballDone, contactFirst: !a.ballDone, fromBehind: behind, slide: true, bodyContact: true, lastMan: this._lastMan(o, p) });
        if (j.foul || this.rng() < 0.4) { o.act = { type: 'fall', t0: this.t, dur: 1.3 }; }
        if (j.foul) this._foul(p, o, j.card);
        return;
      }
    }
  }

  _contests() {
    const o = this.owner(), b = this.ball, t = this.t;
    if (!o || b.inHands || (o.act && o.act.type === 'skill')) return;
    for (const d of this.teamList[1 - o.team]) {
      if (d.act || d.fooledUntil > t || d.cool.steal > t || d.isGK) continue;
      const bd = Math.hypot(b.p.x - d.x, b.p.z - d.z);
      const pd = Math.hypot(o.x - d.x, o.z - d.z);
      if (bd < 0.8) {
        d.cool.steal = t + 0.35;
        let pr = clamp(0.2 + (d.a.def - o.a.dri) * 0.007 + (this.fromBehind(d, o) ? -0.12 : 0), 0.03, 0.45);
        if (this.isHumanCtrl(d)) pr *= 0.6;
        if (this.isHumanCtrl(o)) pr *= 0.8;
        if (this.rng() < pr) { this._winBall(d, false); d.st.tackles++; return; }
      } else if (pd < 0.85 && o.speed > 2.5 && d.speed > 2.5) {
        d.cool.steal = t + 0.3;
        const pr = clamp(0.08 + (d.a.phy - o.a.phy) * 0.006, 0.02, 0.28);
        if (this.rng() < pr) {
          if (this.fromBehind(d, o) && this.rng() < 0.6) {
            // barging through the back of the carrier: body before ball
            const j = judgeTackle({ contactFirst: true, bodyContact: true, fromBehind: true, lastMan: this._lastMan(o, d) });
            if (j.foul) { this._foul(d, o, j.card); return; }
          }
          b.owner = -1; b.v.x = o.vx * 1.15; b.v.z = o.vz * 1.15; b.v.y = 0;
          o.cool.touch = t + 0.45; o.vx *= 0.6; o.vz *= 0.6;
          this.path = null;
          return;
        }
      }
    }
  }

  // ------------------------------------------------------------------ fouls & stoppages
  _foul(off, victim, card) {
    off.st.fouls++;
    this.stats.fouls[off.team]++;
    victim.act = { type: 'fall', t0: this.t, dur: 1.4 };
    const pen = inOwnPenaltyArea(victim.x, victim.z, this.dir[off.team]);
    this.emit({ type: 'foul', team: this.sideName(off.team), playerId: off.data.id, playerName: off.data.name, victimId: victim.data.id, minute: this.minute(), penalty: pen });
    this.fxPush('foul', { pi: off.idx, pen: pen ? 1 : 0 });
    this.fxPush('whistle', { n: 1 });
    // referee discretion: most non-last-man bookable fouls only get a warning
    if (card === 'yellow' && !this._lastMan(victim, off) && this.rng() < 0.55) card = null;
    if (card) this._card(off, card);
    this.stoppage += 0.15;
    this._stop(pen ? SP.PENALTY : SP.FREEKICK, victim.team, victim.x, victim.z, pen ? 2.2 : 1.8);
  }

  _card(p, card) {
    if (p.isGK && card === 'red') card = 'yellow';
    if (card === 'yellow') {
      p.yellow++; p.st.yellow++;
      if (p.yellow >= 2) card = 'red';
    }
    if (card === 'red') { p.pendingOff = true; p.st.red = 1; }
    this.stoppage += 0.25;
    this.emit({ type: 'card', card, team: this.sideName(p.team), playerId: p.data.id, playerName: p.data.name, minute: this.minute(), second: p.yellow >= 2 });
    this.fxPush('card', { pi: p.idx, c: card === 'red' ? 'r' : 'y' });
  }

  _offside(p) {
    this.fxPush('offside', { pi: p.idx });
    this.fxPush('whistle', { n: 1 });
    this.pendingOffside = null;
    this._stop(SP.FREEKICK, 1 - p.team, p.x, p.z, 1.4, { indirect: true });
  }

  _stop(type, team, x, z, dur = 1.3, extra = {}) {
    const b = this.ball;
    this.phase = PHASE.STOP; this.phaseT = this.t; this.stopDur = dur;
    this.pending = { type, team, x, z, ...extra };
    if (b.owner >= 0) { b.owner = -1; b.inHands = false; }
    if (type === SP.FREEKICK || type === SP.PENALTY) { b.v.x *= 0.3; b.v.z *= 0.3; }
    this.pendingPass = null; this.pendingOffside = null; b.intended = -1;
    const r = this.shotTracker.update(this.t, true);
    if (r) this._shotResolved(r);
    for (const p of this.players) { p.run = null; p.gkPlan = null; p.windup = 0; }
    this.buffer = [null, null];
  }

  // ------------------------------------------------------------------ set pieces
  _teleport(p, x, z) {
    p.x = x; p.z = z; p.vx = 0; p.vz = 0; p.des.x = 0; p.des.z = 0;
    if (p.act && p.act.type !== 'sentoff') p.act = null;
    p.run = null; p.gkPlan = null; p.drib = null; p.space = null; p.fooledUntil = 0;
  }

  _applySendOffs() {
    let changed = false;
    for (const p of this.players) {
      if (p.pendingOff && !p.sentOff) { p.sentOff = true; p.pendingOff = false; changed = true; p.x = -1000; p.z = -1000; }
    }
    if (changed) {
      this.teamList = [this.players.slice(0, 11).filter((p) => !p.sentOff), this.players.slice(11).filter((p) => !p.sentOff)];
      for (let team = 0; team < 2; team++) {
        const c = this.players[this.ctrl[team]];
        if (c && c.sentOff) this.ctrl[team] = this.teamList[team][1]?.idx ?? this.teamList[team][0].idx;
      }
    }
  }

  _autoSubs() {
    if (this.half < 2 || this.clock < 15 * 60) return;
    for (let team = 0; team < 2; team++) {
      if (this.subsMade[team] >= 3 || this.clock - this.lastSubT[team] < 6 * 60) continue;
      const bench = this.bench[team];
      if (!bench.length) continue;
      let worst = null;
      for (const p of this.teamList[team]) {
        if (p.isGK || p.pendingOff) continue;
        if (!worst || p.stamMax < worst.stamMax) worst = p;
      }
      if (!worst || worst.stamMax > 0.8) continue;
      let bi = -1;
      for (let i = 0; i < bench.length; i++) {
        if (this.benchUsed[team].has(i) || bench[i].pos === 'GK') continue;
        if (bi < 0) bi = i;
        if (roleGroup(bench[i].pos) === worst.group) { bi = i; break; }
      }
      if (bi < 0) continue;
      this.benchUsed[team].add(bi);
      const outP = worst.data, inP = bench[bi];
      const keepYellow = 0;
      this._applyData(worst, inP, this.teamsData[team].chemistry);
      worst.stam = 1; worst.stamMax = 1; worst.yellow = keepYellow;
      this.subsMade[team]++; this.lastSubT[team] = this.clock;
      this.subs.push([team, worst.i, bi]);
      this.rosterVer++;
      this.stoppage += 0.25;
      this.emit({ type: 'sub', team: this.sideName(team), outId: outP.id, inId: inP.id, outName: outP.name, inName: inP.name, minute: this.minute() });
      this.fxPush('sub', { team, i: worst.i, bi });
    }
  }

  _arrangeShape(attTeam, spotX) {
    for (let team = 0; team < 2; team++) {
      const info = { ...this.info[team], ballX: this.X(team, spotX), attacking: team === attTeam };
      info.offLine = Math.max(52.5, info.ballX);
      for (const p of this.teamList[team]) {
        if (p.isGK) {
          const gl = this.ownGoalX(team);
          const bx = this.X(team, spotX);
          this._teleport(p, gl + this.dir[team] * clamp(bx * 0.1, 1, 12), 0);
        } else {
          const h = AI.formationTarget(this, p, info);
          this._teleport(p, h.x, h.z);
        }
      }
    }
  }

  _pushAway(team, x, z, r) {
    for (const p of this.teamList[team]) {
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d < r) {
        const k = d < 0.01 ? { x: 1, z: 0 } : { x: dx / d, z: dz / d };
        p.x = x + k.x * r; p.z = clamp(z + k.z * r, -HW + 0.5, HW - 0.5);
      }
    }
  }

  _bestTaker(team, score) {
    let best = null, bs = -1e9;
    for (const m of this.teamList[team]) {
      if (m.isGK) continue;
      const s = score(m);
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  _setupSetPiece(pd) {
    this._applySendOffs();
    this._autoSubs();
    const { type, team } = pd;
    const d = this.dir[team], t = this.t;
    const opp = 1 - team;
    const b = this.ball;
    this.fxPush('cut');
    const sp = { type, team, t0: t, taker: -1, aim: 0, curve: 0, aimZ: 0, aimY: 1.2, aiDelay: 1.1 + this.rng() * 0.9, ball: { x: 0, y: BALL_R, z: 0 }, indirect: !!pd.indirect, wall: [] };
    let spot, taker;
    switch (type) {
      case SP.THROW: {
        spot = { x: clamp(pd.x, -HL + 1, HL - 1), z: Math.sign(pd.z) * HW };
        this._arrangeShape(team, spot.x);
        taker = null; let bd = 1e9;
        for (const m of this.teamList[team]) { if (m.isGK) continue; const dd = Math.hypot(m.x - spot.x, m.z - spot.z) - (m.group === 'DEF' ? 4 : 0); if (dd < bd) { bd = dd; taker = m; } }
        this._teleport(taker, spot.x, spot.z + Math.sign(spot.z) * 0.35);
        this._pushAway(opp, spot.x, spot.z, 3);
        // make sure someone is available nearby
        const near = this.teamList[team].filter((m) => m !== taker && !m.isGK).sort((a1, a2) => Math.hypot(a1.x - spot.x, a1.z - spot.z) - Math.hypot(a2.x - spot.x, a2.z - spot.z));
        if (near[0]) this._teleport(near[0], spot.x + d * 6, spot.z - Math.sign(spot.z) * 7);
        if (near[1]) this._teleport(near[1], spot.x - d * 7, spot.z - Math.sign(spot.z) * 9);
        sp.aim = Math.atan2(-Math.sign(spot.z), d * 0.6);
        sp.ball = { x: spot.x, y: 2.05, z: spot.z };
        break;
      }
      case SP.CORNER: {
        const s = Math.sign(pd.x), zs = Math.sign(pd.z);
        spot = { x: s * (HL - 0.4), z: zs * (HW - 0.4) };
        this._arrangeShape(team, spot.x);
        taker = this._bestTaker(team, (m) => m.a.pas + (['LW', 'RW', 'LM', 'RM', 'CAM'].includes(m.role) ? 6 : 0) - (m.group === 'DEF' && Math.abs(m.sd.l) < 0.5 ? 20 : 0));
        this._teleport(taker, spot.x + s * 0.6, spot.z + zs * 0.6);
        const attackers = this.teamList[team].filter((m) => m !== taker && !m.isGK).sort((a1, a2) => (a2.a.phy + (a2.group === 'FWD' ? 10 : 0) + (a2.role === 'CB' ? 8 : 0)) - (a1.a.phy + (a1.group === 'FWD' ? 10 : 0) + (a1.role === 'CB' ? 8 : 0)));
        const spots = [[99, zs * 3], [95, 0.5], [97.5, -zs * 3.5], [92, zs * 5], [91, -zs * 6], [87, 0], [74, zs * 12]];
        attackers.forEach((m, i) => {
          if (i < spots.length) this._teleport(m, this.wx(team, spots[i][0] + (this.rng() - 0.5)), spots[i][1] + (this.rng() - 0.5) * 1.5);
          else this._teleport(m, this.wx(team, 55), (i - 8) * 10);
        });
        // defenders: mark attackers in box goal-side, plus GK on line
        const defs = this.teamList[opp].filter((m) => !m.isGK);
        const g = this.gk(opp);
        this._teleport(g, this.wx(team, 104.3), zs * 0.8);
        const inBox = attackers.filter((m) => this.X(team, m.x) > 85);
        defs.forEach((m, i) => {
          if (i < inBox.length) { const a1 = inBox[i]; this._teleport(m, a1.x + d * 0.9, a1.z * 0.95); }
          else if (i === inBox.length) this._teleport(m, this.wx(team, 104), zs * 3.2);
          else if (i === inBox.length + 1) this._teleport(m, this.wx(team, 93), zs * 9);
          else this._teleport(m, this.wx(team, 80 - i * 3), (i % 2 ? 1 : -1) * 8);
        });
        this._pushAway(opp, spot.x, spot.z, CIRCLE_R);
        sp.aim = Math.atan2(-zs * 6 - spot.z, this.wx(team, 94) - spot.x);
        sp.ball = { x: spot.x, y: BALL_R, z: spot.z };
        break;
      }
      case SP.GOALKICK: {
        const zs = pd.z || 1;
        spot = { x: this.ownGoalX(team) + d * SIX.DEPTH, z: zs * 5 };
        this._arrangeShape(opp, spot.x);
        taker = this.gk(team);
        this._teleport(taker, spot.x - d * 0.6, spot.z);
        for (const m of this.teamList[opp]) {
          if (this.X(team, m.x) < BOX.DEPTH + 1 && Math.abs(m.z) < BOX.HW + 1) this._teleport(m, this.wx(team, BOX.DEPTH + 2 + this.rng() * 4), m.z);
        }
        sp.aim = Math.atan2(0, d);
        sp.ball = { x: spot.x, y: BALL_R, z: spot.z };
        break;
      }
      case SP.FREEKICK: {
        spot = { x: clamp(pd.x, -HL + 1, HL - 1), z: clamp(pd.z, -HW + 1, HW - 1) };
        this._arrangeShape(team, spot.x);
        const gx = this.goalX(team);
        const D = Math.hypot(gx - spot.x, spot.z);
        const X = this.X(team, spot.x);
        if (X > 55 && !pd.indirect) taker = this._bestTaker(team, (m) => m.a.sho * 0.6 + m.a.pas * 0.4 - Math.hypot(m.x - spot.x, m.z - spot.z) * 0.1);
        else { taker = null; let bd = 1e9; for (const m of this.teamList[team]) { const dd = Math.hypot(m.x - spot.x, m.z - spot.z) + (m.isGK && X > 20 ? 50 : 0); if (dd < bd) { bd = dd; taker = m; } } }
        const ux = (gx - spot.x) / D, uz = -spot.z / D;
        this._teleport(taker, spot.x - ux * 0.7, spot.z - uz * 0.7);
        if (X > 55) {
          // attackers into the box
          const atts = this.teamList[team].filter((m) => m !== taker && !m.isGK && m.group !== 'DEF').slice(0, 4);
          atts.forEach((m, i) => this._teleport(m, this.wx(team, 89 + (i % 2) * 4), (i - 1.5) * 4.5));
        }
        if (D < 33 && !pd.indirect) {
          const n = D < 20 ? 5 : D < 26 ? 4 : 3;
          const wx0 = spot.x + ux * CIRCLE_R, wz0 = spot.z + uz * CIRCLE_R;
          const px = -uz, pz = ux;
          const shift = Math.sign(spot.z * px || 1) * 0.3; // cover the near post side
          const cands = this.teamList[opp].filter((m) => !m.isGK).sort((a1, a2) => Math.hypot(a1.x - wx0, a1.z - wz0) - Math.hypot(a2.x - wx0, a2.z - wz0)).slice(0, n);
          cands.forEach((m, i) => {
            const off = (i - (n - 1) / 2) * 0.62 + shift * n * 0.3;
            this._teleport(m, wx0 + px * off, wz0 + pz * off);
            m.face = Math.atan2(-uz, -ux);
            sp.wall.push(m.idx);
          });
        }
        this._pushAway(opp, spot.x, spot.z, CIRCLE_R);
        const g = this.gk(opp);
        this._teleport(g, this.wx(team, 104), clamp(spot.z * 0.12, -1.5, 1.5));
        sp.aim = Math.atan2(uz, ux);
        sp.ball = { x: spot.x, y: BALL_R, z: spot.z };
        break;
      }
      case SP.PENALTY: {
        spot = { x: this.wx(team, 105 - PEN_SPOT), z: 0 };
        taker = this._bestTaker(team, (m) => m.a.sho);
        this._teleport(taker, spot.x - d * 1.6, -0.6);
        const g = this.gk(opp);
        this._teleport(g, this.wx(team, 104.7), 0);
        let k = 0;
        for (const m of this.players) {
          if (m.sentOff || m === taker || m === g) continue;
          const i = k++;
          this._teleport(m, this.wx(team, 83 - (i % 3) * 2), -18 + (i / 20) * 36);
        }
        sp.aim = Math.atan2(0, d);
        sp.aimZ = 0; sp.aimY = 1.0;
        sp.ball = { x: spot.x, y: BALL_R, z: spot.z };
        sp.aiDelay = 1.8;
        break;
      }
    }
    for (const p of this.players) if (!p.sentOff) p.face = Math.atan2(sp.ball.z - p.z, sp.ball.x - p.x);
    taker.face = sp.aim;
    sp.taker = taker.idx;
    this.sp = sp;
    b.owner = taker.idx; b.inHands = false; b.intended = -1;
    b.p.x = sp.ball.x; b.p.y = sp.ball.y; b.p.z = sp.ball.z;
    b.v.x = b.v.y = b.v.z = 0; b.w.x = b.w.y = b.w.z = 0;
    b.lastTeam = team; b.lastTouch = taker.idx;
    this.path = null;
    this.phase = PHASE.SETPIECE; this.phaseT = t;
    if (this.human[team]) this.ctrl[team] = taker.idx;
    if (this.human[opp]) { const n = this.nearestToBall(opp); if (n) this.ctrl[opp] = n.idx; }
    this.holds = [{}, {}];
    if (type !== SP.THROW && type !== SP.GOALKICK) this.fxPush('whistle', { n: 0 });
    this.fxPush('setpiece', { type, team });
  }

  _setupKickoff(team) {
    this._applySendOffs();
    const t = this.t;
    this.fxPush('cut');
    for (let tm = 0; tm < 2; tm++) {
      const d = this.dir[tm];
      for (const p of this.teamList[tm]) {
        if (p.isGK) { this._teleport(p, -d * (HL - 1), 0); continue; }
        let X = clamp(p.sd.d * 95, 8, 48);
        let z = p.sd.l * d * 25;
        let x = this.wx(tm, X);
        if (tm !== team && Math.hypot(x, z) < CIRCLE_R + 0.5) {
          const r = Math.hypot(x, z) || 1;
          x = (x / r) * (CIRCLE_R + 0.5); z = (z / r) * (CIRCLE_R + 0.5);
          if (x * d > -0.5) x = -d * (CIRCLE_R + 0.5);
        }
        this._teleport(p, x, z);
      }
    }
    const fw = this.teamList[team].filter((m) => !m.isGK).sort((a, b) => b.sd.d - a.sd.d || Math.abs(a.sd.l) - Math.abs(b.sd.l));
    const d = this.dir[team];
    const taker = fw[0];
    this._teleport(taker, -d * 0.35, 0);
    if (fw[1]) this._teleport(fw[1], -d * 1.5, 3.5);
    for (const p of this.players) if (!p.sentOff) p.face = Math.atan2(-p.z, -p.x);
    taker.face = d > 0 ? 0 : Math.PI;
    const b = this.ball;
    b.owner = taker.idx; b.inHands = false; b.intended = -1;
    b.p.x = 0; b.p.y = BALL_R; b.p.z = 0; b.v.x = b.v.y = b.v.z = 0; b.w.x = b.w.y = b.w.z = 0;
    b.lastTeam = team; b.lastTouch = taker.idx;
    this.path = null;
    this.sp = { type: SP.KICKOFF, team, t0: t, taker: taker.idx, aim: Math.atan2(3.5, -d * 1.2), curve: 0, aimZ: 0, aimY: 1, aiDelay: 1.2, ball: { x: 0, y: BALL_R, z: 0 }, wall: [] };
    this.phase = PHASE.KICKOFF; this.phaseT = t;
    if (this.human[team]) this.ctrl[team] = taker.idx;
    if (this.human[1 - team]) { const n = this.nearestToBall(1 - team); if (n) this.ctrl[1 - team] = n.idx; }
    this.holds = [{}, {}];
    this.fxPush('whistle', { n: 0 });
    this.fxPush('setpiece', { type: SP.KICKOFF, team });
    for (const p of this.players) if (p.act && p.act.type === 'celeb') p.act = null;
  }

  _stepSetPiece(dt) {
    const sp = this.sp, t = this.t, b = this.ball;
    const taker = this.players[sp.taker];
    // hold ball at spot
    if (b.owner === taker.idx) {
      if (sp.type === SP.THROW) { b.p.x = taker.x; b.p.z = Math.sign(taker.z) * (HW - 0.05); b.p.y = 2.05; }
      else { b.p.x = sp.ball.x; b.p.y = sp.ball.y; b.p.z = sp.ball.z; }
      b.v.x = b.v.y = b.v.z = 0;
      if (sp.type !== SP.THROW) {
        const f = { x: Math.cos(sp.aim), z: Math.sin(sp.aim) };
        const tx = sp.ball.x - f.x * 0.75, tz = sp.ball.z - f.z * 0.75;
        taker.x += (tx - taker.x) * Math.min(1, dt * 6); taker.z += (tz - taker.z) * Math.min(1, dt * 6);
      }
    }
    for (const p of this.players) {
      if (p.sentOff) { this._walkOff(p); continue; }
      p.des.x = 0; p.des.z = 0; p.vx = 0; p.vz = 0;
      if (p !== taker) p.faceBall = Math.atan2(b.p.z - p.z, b.p.x - p.x);
    }
    taker.face = sp.aim; taker.faceBall = sp.aim;
    const el = t - sp.t0;
    const humanTaker = this.human[sp.team] && this.ctrl[sp.team] === sp.taker;
    if (humanTaker) {
      this._humanSetPiece(sp.team, dt, this.inputs[sp.team] || EMPTY_IN, el);
      if (this.phase === PHASE.SETPIECE || this.phase === PHASE.KICKOFF) {
        if (el > 12) { this.aimInfo[sp.team] = null; AI.takeSetPiece(this, sp); }
      }
    } else if (el > sp.aiDelay) {
      AI.takeSetPiece(this, sp);
    }
    // non-taker human: allow switching only
    for (let team = 0; team < 2; team++) {
      if (!this.human[team] || (humanTaker && team === sp.team)) continue;
      const inp = this.inputs[team] || EMPTY_IN, prev = this.prevIn[team] || EMPTY_IN;
      if (inp.switchP && !prev.switchP) this._switch(team, null);
    }
    this._movePlayers(dt);
  }

  _humanSetPiece(team, dt, inp, el) {
    const sp = this.sp, p = this.players[sp.taker];
    const prev = this.prevIn[team] || EMPTY_IN;
    const H = this.holds[team];
    for (const k of HOLD_KEYS) if (inp[k]) H[k] = (H[k] || 0) + dt;
    const released = (k) => !inp[k] && !!prev[k] && (H[k + 'Start'] ?? 0) >= 0;
    const mv = this._worldMove(inp);
    const d = this.dir[team];
    if (sp.type === SP.PENALTY) {
      sp.aimZ = clamp(sp.aimZ + mv.z * 3.2 * dt, -GOAL.HW + 0.2, GOAL.HW - 0.2);
      sp.aimY = clamp(sp.aimY + mv.x * d * 1.8 * dt, 0.2, GOAL.H - 0.2);
      sp.aim = Math.atan2(sp.aimZ - sp.ball.z, this.goalX(team) - sp.ball.x);
    } else {
      if (mv.l > 0.2) sp.aim = wrapAngle(angleTo(sp.aim, Math.atan2(mv.z, mv.x), 1.3 * dt));
      if (inp.switchP) sp.curve = clamp(sp.curve - 1.4 * dt, -1, 1);
      if (inp.tackle) sp.curve = clamp(sp.curve + 1.4 * dt, -1, 1);
    }
    const heldKey = KICK_KEYS.find((k) => inp[k]);
    const power = heldKey ? clamp(H[heldKey] / 1, 0.05, 1) : 0.6;
    this.aimInfo[team] = { setPiece: true, type: sp.type, aim: sp.aim, curve: sp.curve, aimZ: sp.aimZ, aimY: sp.aimY, power, held: !!heldKey };
    // preview trajectory (no error)
    const pk = this._setPiecePlan(p, sp, heldKey || this._defaultSpKey(sp), power);
    this.aimInfo[team].preview = pk ? { vel: pk.vel, spin: pk.spin, from: pk.from || { ...this.ball.p } } : null;
    if (el < 0.5) { for (const k of HOLD_KEYS) if (!inp[k]) H[k] = 0; return; }
    for (const k of KICK_KEYS) {
      if (released(k) && (H[k] || 0) > 0) {
        const pw = clamp(H[k] / 1, 0.05, 1);
        const plan = this._setPiecePlan(p, sp, k, pw);
        this.aimInfo[team] = null;
        if (plan) this._execute(p, plan);
        break;
      }
    }
    for (const k of HOLD_KEYS) if (!inp[k]) H[k] = 0;
  }

  _defaultSpKey(sp) {
    if (sp.type === SP.PENALTY) return 'shoot';
    if (sp.type === SP.CORNER) return 'lob';
    if (sp.type === SP.FREEKICK) {
      const D = Math.hypot(this.goalX(sp.team) - sp.ball.x, sp.ball.z);
      return D < 32 ? 'shoot' : 'lob';
    }
    return 'pass';
  }

  _setPiecePlan(p, sp, key, power) {
    const dir = { x: Math.cos(sp.aim), z: Math.sin(sp.aim) };
    const team = p.team;
    if (sp.type === SP.PENALTY) {
      return this._plan(p, 'penalty', { tz: sp.aimZ, ty: sp.aimY, power });
    }
    if (sp.type === SP.THROW) {
      return this._plan(p, 'throw', { dir, power: key === 'lob' ? Math.max(0.6, power) : power * 0.7 });
    }
    if (sp.type === SP.GOALKICK || sp.type === SP.CORNER) {
      // no shooting from a goal kick / corner: every other key means a lofted delivery
      if (key !== 'pass' && key !== 'through') key = 'lob';
    }
    if (key === 'pass') return this._plan(p, 'ground', { dir, power, human: true });
    if (key === 'through') return this._plan(p, 'through', { dir, power });
    if (key === 'finesse') return this._plan(p, 'finesse', { dir, power });
    if (key === 'lob' || (key === 'shoot' && (sp.type === SP.CORNER || sp.type === SP.GOALKICK))) {
      const dist = sp.type === SP.CORNER ? 14 + power * 26 : sp.type === SP.GOALKICK ? 25 + power * 40 : 12 + power * 38;
      const pt = { x: sp.ball.x + dir.x * dist, z: sp.ball.z + dir.z * dist };
      const kind = sp.type === SP.CORNER || (sp.type === SP.FREEKICK && this.X(team, pt.x) > 85) ? 'cross' : sp.type === SP.GOALKICK ? 'punt' : 'lob';
      return this._plan(p, kind, { point: pt, power, curve: sp.curve, fromGround: true, elev: sp.type === SP.GOALKICK ? 0.6 : undefined });
    }
    // direct free-kick shot: yaw from aim, power sets pace and elevation, curve = sidespin
    const sho = p.a.sho;
    const speed = 17 + power * (9 + sho * 0.06);
    const el = 0.12 + power * 0.22;
    const vel = { x: dir.x * Math.cos(el) * speed, y: Math.sin(el) * speed, z: dir.z * Math.cos(el) * speed };
    const right = { x: -dir.z, z: dir.x };
    void right;
    const W = 20 + sho * 0.3;
    const top = 12 + power * 22;
    const spin = { x: dir.z * top, y: -sp.curve * W, z: -dir.x * top };
    return { vel, spin, from: { ...this.ball.p }, info: { kind: 'shot', pass: false, shot: true, target: -1, power: Math.min(power, 0.8), point: null } };
  }

  _setPieceTaken(p, info) {
    const sp = this.sp;
    const t = this.t;
    this.phase = PHASE.PLAY; this.phaseT = t;
    sp.done = true;
    this.aimInfo[sp.team] = null;
    p.cool.touch = t + 0.4;
    for (const i of sp.wall) { const w = this.players[i]; if (!w.sentOff) w.act = { type: 'wall', t0: t + 0.05 + this.rng() * 0.1, dur: 0.7, jh: 0.35 + w.a.phy * 0.002 }; }
    if (sp.type === SP.PENALTY) {
      const g = this.gk(1 - sp.team);
      this.path = predictBall(this.ball, 2, 0.02);
      const plan = this.planSave(g);
      if (plan) {
        const pc = clamp(0.34 + (g.a.ref - 70) * 0.006, 0.22, 0.5);
        const r = this.rng();
        if (r > pc) {
          if (r > 0.88) { plan.z = 0; plan.y = 1.2; }
          else { plan.z = -Math.sign(plan.z || 1) * (1.5 + this.rng() * 1.5); plan.y = 0.3 + this.rng() * 1.6; }
        }
        plan.tReact = t + 0.02;
        plan.pen = true;
        g.gkPlan = plan;
        if (Math.abs(plan.z) < 0.6) plan.step = true;
        else this.startDive(g, plan);
        plan.acted = true;
      }
    }
    if (sp.type === SP.KICKOFF && this.clock === 0 && this.half === 1) this.fxPush('start');
    void info;
  }

  // ------------------------------------------------------------------ halves
  _endHalf() {
    const b = this.ball;
    b.owner = -1; b.inHands = false;
    this.pendingShot = [null, null];
    const h = this.half, level = this.score[0] === this.score[1];
    const brk = (next) => { this.phase = PHASE.HALFTIME; this.phaseT = this.t; this.breakNext = next; this.skipReq = false; };
    if (h === 1 || h === 3) {
      this.fxPush('whistle', { n: 2 });
      brk('half');
      if (h === 1) this.emit({ type: 'halftime', score: [...this.score], minute: 45 });
      else this.emit({ type: 'extratime-halftime', score: [...this.score], minute: 105 });
      this.fxPush('halftime', h === 3 ? { et: 1 } : {});
    } else if (this.knockout && level && h === 2) {
      this.fxPush('whistle', { n: 2 });
      brk('half');
      this.emit({ type: 'extratime', score: [...this.score], minute: 90 });
      this.fxPush('etbreak');
    } else if (this.knockout && level && h === 4) {
      this.fxPush('whistle', { n: 2 });
      brk('shootout');
      this.emit({ type: 'penalties', score: [...this.score], minute: 120 });
      this.fxPush('shootout');
    } else this._fullTime();
  }

  _fullTime() {
    this.ball.owner = -1; this.ball.inHands = false;
    this.fxPush('whistle', { n: 3 });
    this.phase = PHASE.FULLTIME; this.phaseT = this.t;
    this.ended = true;
    this.result = this.buildResult(false);
    this.emit({ type: 'fulltime', score: [...this.score], minute: this.half <= 2 ? 90 : 120, ...(this.result.pens ? { pens: [...this.result.pens] } : {}) });
    this.fxPush('fulltime');
  }

  _afterBreak() {
    if (this.breakNext === 'shootout') KO.startShootout(this);
    else this._nextHalf();
  }

  _nextHalf() {
    this.half++; this.clock = 0; this.added = 0; this.addedSet = false; this.stoppage = 0;
    this.dir = [-this.dir[0], -this.dir[1]];
    for (const p of this.players) p.stam = Math.min(p.stamMax, p.stam + (this.half === 2 ? 0.4 : 0.25));
    this._setupKickoff(this.half === 3 ? this.firstKickoff : 1 - this.firstKickoff);
  }

  // ------------------------------------------------------------------ results
  buildResult(abandoned) {
    const pt = this.stats.poss[0] + this.stats.poss[1] || 1;
    const ph = Math.round((this.stats.poss[0] / pt) * 100);
    const ratings = this.ratings();
    const res = {
      homeGoals: this.score[0], awayGoals: this.score[1],
      scorers: this.scorers.map((s) => ({ playerId: s.playerId, team: s.team, minute: s.minute, ...(s.ownGoal ? { ownGoal: true } : {}) })),
      stats: {
        possession: [ph, 100 - ph], shots: [...this.stats.shots], shotsOnTarget: [...this.stats.sot], passes: [...this.stats.passes],
      },
      playerRatings: ratings,
      motm: playerOfMatch(ratings, this.pstats),
    };
    if (this.shootout && this.shootout.done) res.pens = KO.tally(this.shootout);
    if (this.half > 2) res.extraTime = true;
    if (abandoned) res.abandoned = true;
    return res;
  }

  ratings() { return computeRatings(this.pstats, this.score); }

  // ------------------------------------------------------------------ anim state
  _updateAnims() {
    const t = this.t;
    for (const p of this.players) {
      const a = p.act;
      let code = ANIM.RUN, at = 0, pp = 0;
      if (p.sentOff) code = ANIM.SENTOFF;
      else if (a) {
        at = t - a.t0;
        switch (a.type) {
          case 'kick': code = ANIM.KICK; pp = a.pw ?? 0.5; break;
          case 'slide': code = ANIM.SLIDE; break;
          case 'down': code = a.fromDive ? ANIM.DIVE : ANIM.SLIDE; at += 0.72; break;
          case 'head': code = ANIM.HEAD; pp = a.jh || 0.4; break;
          case 'wall': code = ANIM.WALL; pp = a.jh || 0.4; break;
          case 'dive': code = ANIM.DIVE; pp = p.animP; break;
          case 'celeb': code = ANIM.CELEB; pp = p.celebKind ?? 0; break;
          case 'throw': code = ANIM.THROW; break;
          case 'fall': code = ANIM.FALL; break;
          case 'tackle': code = ANIM.TACKLE; break;
          case 'skill': code = ANIM.SKILL; pp = (p.skillIdx || 0) + (p.skillSide < 0 ? 10 : 0); break;
          case 'chest': code = ANIM.CHEST; break;
        }
        if (at < 0) { code = ANIM.RUN; at = 0; }
      } else if (this.ball.owner === p.idx && this.ball.inHands) code = ANIM.HOLD;
      else if (this.ball.owner === p.idx && (this.phase === PHASE.SETPIECE) && this.sp && this.sp.type === SP.THROW) code = ANIM.THROW, at = 0;
      else if (p.windup > 0) { code = ANIM.WINDUP; pp = p.windup; }
      else if (p.isGK && p.ready && p.speed < 2) code = ANIM.GKREADY;
      p.anim = code; p.animT = at; p.animP = code === ANIM.DIVE ? p.animP : pp;
    }
  }
}

function interp(prev, s, team, sim, X0) {
  if (!prev) return { ...s };
  const a = sim.X(team, prev.x), b = sim.X(team, s.x);
  const f = clamp((a - X0) / ((a - b) || 1e-6), 0, 1);
  return { t: prev.t + (s.t - prev.t) * f, x: prev.x + (s.x - prev.x) * f, y: prev.y + (s.y - prev.y) * f, z: prev.z + (s.z - prev.z) * f };
}

function segDist3(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l2 = dx * dx + dy * dy + dz * dz || 1e-9;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t), p.z - (a.z + dz * t));
}

export { PHASE, SP, ANIM };
