// Match engine: state machine (kickoff/play/goal/replay/set pieces/half-time/full-time),
// possession, human control, kicking, tackles and fouls, keeper saves, stats and replay.
import { PITCH, CX, CY, GOAL, PEN_SPOT, CIRCLE_R, BALL_R, DIFFICULTY } from './constants.js';
import { FORMATION, chooseKits } from './data.js';
import { makeBall, placeBall, stepBallWorld, simulatePath } from './physics.js';
import { goalScored, keeperMaySave, outOfPlay, restartFor, judgeTackle, isFromBehind, inPenaltyArea, applyCard, tackleSweep } from './rules.js';
import { choosePassTarget, passVelocity, leadTarget, clampToPitch, planPass } from './passing.js';
import { planShot, shotVelocity } from './shooting.js';
import { makePlayer, stepPlayer, topSpeed, jogSpeed, startSkill, isEvading, SKILL_NAMES } from './player.js';
import { TeamAI } from './ai.js';
import { beginSetPiece, updateSetPiece } from './setpieces.js';
import { clamp, dist, norm, gauss, angDiff } from './util.js';
import { GAMEPLAY_DEFAULTS } from './settings.js';
import { touchHeaviness, heavyTouchSpeed, shoulderWinChance, timedFinishGrade, savedKickRestart, TIMED_WINDOW } from './feel.js';
import { solveKick } from './physics.js';

const HUMAN_PROF = { react: 0.3, acc: 0.85, speed: 1, keeper: 1, press: 0.9, careful: 0.9 };
export const STATE_CODES = ['run', 'tackle', 'slide', 'down', 'dive', 'hold', 'skill', 'celebrate'];

const mkStats = () => ({ poss: 0, shots: 0, onTarget: 0, passAtt: 0, passCmp: 0, interceptions: 0, fouls: 0, corners: 0, yellows: 0, reds: 0 });

/** Ring buffer of the last few seconds (ball + players) for goal replays. */
class Replay {
  constructor(n) {
    this.n = n; this.stride = 4 + n * 5; this.cap = 600;           // 10 s at 60 Hz
    this.buf = new Float32Array(this.cap * this.stride);
    this.len = 0; this.head = 0; this.tick = 0; this.frames = 0; this.start = 0; this.pos = 0;
  }
  clear() { this.len = 0; this.head = 0; }
  record(m) {
    if ((this.tick++ & 1) === 1) return;          // 60 Hz snapshots
    const o = this.head * this.stride, B = this.buf, b = m.ball;
    B[o] = b.x; B[o + 1] = b.y; B[o + 2] = b.z; B[o + 3] = b.rot;
    m.players.forEach((p, i) => {
      const k = o + 4 + i * 5;
      B[k] = p.x; B[k + 1] = p.y; B[k + 2] = p.facing; B[k + 3] = p.anim;
      B[k + 4] = Math.max(0, STATE_CODES.indexOf(p.state)) + (p.sentOff ? 100 : 0);
    });
    this.head = (this.head + 1) % this.cap; this.len = Math.min(this.len + 1, this.cap);
  }
  begin(seconds) {
    this.frames = Math.min(this.len, Math.round(seconds * 60));
    this.start = (this.head - this.frames + this.cap) % this.cap;
    this.pos = 0;
    return this.frames > 30;
  }
  apply(m) {
    const f0 = Math.floor(this.pos), a = this.pos - f0;
    const f1 = Math.min(f0 + 1, this.frames - 1);
    const o0 = ((this.start + f0) % this.cap) * this.stride, o1 = ((this.start + f1) % this.cap) * this.stride, B = this.buf;
    const L = (i) => B[o0 + i] + (B[o1 + i] - B[o0 + i]) * a;
    const b = m.ball; b.x = L(0); b.y = L(1); b.z = L(2); b.rot = L(3);
    m.players.forEach((p, i) => {
      const k = 4 + i * 5;
      p.x = L(k); p.y = L(k + 1);
      p.facing = B[o0 + k + 2] + angDiff(B[o0 + k + 2], B[o1 + k + 2]) * a;
      p.anim = L(k + 3);
      const code = B[o0 + k + 4];
      p.sentOff = code >= 100;
      p.state = STATE_CODES[code % 100] || 'run';
    });
  }
  get done() { return this.pos >= this.frames - 1; }
}

export class Match {
  /**
   * @param o {home, away, humans:[{ctrl, team}], settings, difficulty, minutes, mode, knockout, noClock}
   */
  constructor(o) {
    this.o = o;
    this.mode = o.mode || 'quick';
    this.settings = o.settings;
    this.teams = [o.home, o.away];
    const k = chooseKits(o.home, o.away);
    this.kits = k.kits; this.gkKits = k.gk;
    this.humans = (o.humans || []).map((h) => ({ ctrl: h.ctrl, team: h.team, player: null, lastSwitch: -9 }));
    this.prof = [0, 1].map((t) => (this.isHumanTeam(t) ? HUMAN_PROF : DIFFICULTY[o.difficulty] || DIFFICULTY.Normal));
    this.passive = [false, false];
    this.ball = makeBall(); this.ball.kickId = 0;
    this.players = [];
    for (let t = 0; t < 2; t++) {
      this.teams[t].squad.forEach((info, i) => {
        const p = makePlayer(t, i, info);
        p.speedMul = this.isHumanTeam(t) ? 1 : this.prof[t].speed;
        this.players.push(p);
      });
    }
    this.ai = [new TeamAI(this, 0), new TeamAI(this, 1)];
    this.owner = null; this.lastTouch = null; this.pass = null; this.shot = null; this.sp = null;
    this.score = [0, 0]; this.half = 1; this.clock = 0; this.added = [null, null]; this.stoppages = 0;
    this.stats = [mkStats(), mkStats()];
    this.time = 0; this.state = 'kickoff'; this.stateT = 0;
    this.banners = []; this.events = []; this.goals = [];
    this.firstKick = Math.random() < 0.5 ? 0 : 1;
    this.ballPath = [];
    this.replay = new Replay(this.players.length);
    this.pendingSave = null; this.kickRequest = null; this.pendingRestart = null;
    this.aimWorld = [null, null]; this.mouseClick = false; this.skipRequest = false;
    this.ctrls = o.ctrls || [];
    this.minutes = o.minutes || 4;
    this.noClock = !!o.noClock;
    this.paused = false;
    this.autoKicks = !!o.autoKicks;      // resolve penalties / direct free kicks without the 3D scene
    this.irSnap = null;                  // saved match state while an instant replay plays
    this.setupKickoff(this.firstKick);
  }

  // ---------- helpers ----------
  isHumanTeam(t) { return this.humans.some((h) => h.team === t); }
  attackDir(t) { const base = t === 0 ? 1 : -1; return this.half === 1 ? base : -base; }
  attackSide(t) { return this.attackDir(t) > 0 ? 1 : 0; }
  ownSide(t) { return 1 - this.attackSide(t); }
  defenderOfSide(side) { return this.ownSide(0) === side ? 0 : 1; }
  goalCenter(side) { return { x: side === 0 ? 0 : PITCH.L, y: CY }; }
  mates(t) { return this.players.filter((p) => p.team === t && !p.sentOff); }
  opps(t) { return this.mates(1 - t); }
  keeper(t) { return this.players.find((p) => p.team === t && p.role === 'GK' && !p.sentOff); }
  kitOf(p) { return p.role === 'GK' ? this.gkKits[p.team] : this.kits[p.team]; }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  banner(text, sub = '', color = '#ffffff', dur = 2) {
    this.banners = this.banners.filter((b) => b.text !== text);
    this.banners.push({ text, sub, color, t: 0, dur });
  }
  get minute() { return Math.floor(this.clock / 60); }
  humanFor(p) { return this.humans.find((h) => h.player === p); }
  /** Gameplay (assist) settings of a human controller. */
  gp(h) {
    const g = this.settings && this.settings.gameplay;
    const d = g ? g[h.ctrl === 1 ? 'p2' : 'p1'] : null;
    return d || { ...GAMEPLAY_DEFAULTS, shot: (this.settings && this.settings.assist) || 'Assisted' };
  }
  /** Settings that steer a team's AI teammates (the first human on it), null for a CPU team. */
  gpTeam(t) { const h = this.humans.find((hh) => hh.team === t); return h ? this.gp(h) : null; }

  // ---------- kickoff ----------
  setupKickoff(team) {
    this.state = 'kickoff'; this.stateT = 0; this.kickoffTeam = team;
    this.owner = null; this.pass = null; this.shot = null; this.sp = null; this.pendingSave = null;
    placeBall(this.ball, CX, CY); this.ball.kickId++;
    for (const p of this.players) {
      p.state = 'run'; p.tk = null; p.skill = null; p.vx = p.vy = 0; p.want.x = p.want.y = 0;
      p.charging = false; p.saveIntent = false; p.ai.pendingDive = null;
      if (p.sentOff) { this.parkSentOff(p); continue; }
      const f = FORMATION[p.idx], dir = this.attackDir(p.team);
      const fx = f.x * 0.5 * 0.95;
      let x = dir > 0 ? fx * PITCH.L : PITCH.L - fx * PITCH.L, y = f.y * PITCH.W;
      if (p.team === team && p.role === 'FW') { x = CX - dir * 0.35; y = CY; }
      else if (p.team === team && p.idx === 4) { x = CX - dir * 2; y = CY + 7; }
      else if (Math.hypot(x - CX, y - CY) < CIRCLE_R + 0.6) x = CX - dir * (CIRCLE_R + 0.8);
      p.x = x; p.y = y; p.facing = dir > 0 ? 0 : Math.PI;
    }
    this.kickTaker = this.mates(team).find((p) => p.role === 'FW') || this.mates(team).find((p) => p.role !== 'GK');
    for (const h of this.humans) {
      if (h.team === team) this.setHumanPlayer(h, this.kickTaker);
      else this.switchPlayer(h, true);
    }
  }

  parkSentOff(p) { p.x = CX + (p.team ? 6 : -6) + p.idx * 0.9; p.y = -2.2; p.vx = p.vy = 0; }

  // ---------- main update ----------
  update(dt) {
    if (this.paused) return;
    this.time += dt;
    this.stateT += dt;
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < b.dur);
    const clockRuns = ['play', 'setpiece', 'foul', 'out'].includes(this.state);
    if (clockRuns && !this.noClock) this.clock += dt * (5400 / (this.minutes * 60));

    switch (this.state) {
      case 'kickoff': this.updateKickoff(dt); break;
      case 'play': this.updatePlay(dt); break;
      case 'goal': this.updateGoal(dt); break;
      case 'replay': this.updateReplay(dt); break;
      case 'foul':
      case 'out':
        this.idlePlayers(dt, 0.4);
        if (!this.owner) { stepBallWorld(this.ball, dt, []); this.adBoards(); }
        if (this.stateT > 0.3 && this.quickRestartWanted(this.pendingRestart)) beginSetPiece(this, this.pendingRestart, { quick: true });
        else if (this.stateT > 1.3) beginSetPiece(this, this.pendingRestart);
        break;
      case 'ireplay': this.updateInstantReplay(dt); break;
      case 'setpiece': updateSetPiece(this, dt); break;
      case 'halftime':
        this.idlePlayers(dt, 0);
        if (this.stateT > 4 || (this.skipRequest && this.stateT > 1)) this.startSecondHalf();
        break;
      default: break;
    }
    this.skipRequest = false;
  }

  /** A ball that has left the field bounces off the advertising boards around the pitch. */
  adBoards() {
    const b = this.ball, M = 5.6;
    if (b.z > 1) return;
    if (b.x < -M) { b.x = -M; b.vx = Math.abs(b.vx) * 0.3; }
    if (b.x > PITCH.L + M) { b.x = PITCH.L + M; b.vx = -Math.abs(b.vx) * 0.3; }
    if (b.y < -M) { b.y = -M; b.vy = Math.abs(b.vy) * 0.3; }
    if (b.y > PITCH.W + M) { b.y = PITCH.W + M; b.vy = -Math.abs(b.vy) * 0.3; }
  }

  idlePlayers(dt, speedFrac) {
    for (const p of this.players) {
      if (p.sentOff) continue;
      if (p.state === 'run') { p.want.x *= speedFrac; p.want.y *= speedFrac; p.sprint = false; }
      stepPlayer(p, dt);
    }
  }

  updateKickoff(dt) {
    for (const p of this.players) { p.want.x = p.want.y = 0; p.faceWant = Math.atan2(CY - p.y, CX - p.x); stepPlayer(p, dt); }
    if (this.stateT > 1.2) {
      this.state = 'play'; this.stateT = 0;
      this.emit('whistle');
      if (this.kickTaker) { this.kickTaker.facing = this.attackDir(this.kickTaker.team) > 0 ? 0 : Math.PI; this.setOwner(this.kickTaker, true); }
      // first touch goes backwards to a teammate for AI kickoffs
      if (!this.isHumanTeam(this.kickoffTeam)) {
        const mate = this.mates(this.kickoffTeam).find((p) => p.idx === 4);
        if (mate) this.doPass(this.kickTaker, 'ground', mate, null);
      }
    }
  }

  checkHalfEnd() {
    if (this.noClock) return false;
    const end = (this.half === 1 ? 45 : 90) * 60;
    const idx = this.half - 1;
    if (this.clock >= end && this.added[idx] == null) {
      this.added[idx] = clamp(Math.round(1 + this.stoppages * 0.35 + Math.random() * 1.5), 1, 5);
      this.stoppages = 0;
      this.emit('addedTime', { min: this.added[idx] });
    }
    if (this.added[idx] != null && this.clock >= end + this.added[idx] * 60) {
      if (this.half === 1) {
        this.state = 'halftime'; this.stateT = 0;
        this.banner('HALF TIME', `${this.teams[0].code} ${this.score[0]} - ${this.score[1]} ${this.teams[1].code}`, '#ffd166', 4);
        this.emit('whistleLong'); this.emit('halftime');
      } else {
        this.state = 'fulltime'; this.stateT = 0;
        this.banner('FULL TIME', '', '#ffd166', 5);
        this.emit('whistleEnd'); this.emit('fulltime');
      }
      return true;
    }
    return false;
  }

  startSecondHalf() {
    this.half = 2; this.clock = 45 * 60;
    this.setupKickoff(1 - this.firstKick);
    this.emit('secondHalf');
  }

  predict() {
    this.ballPath = this.owner ? [{ x: this.ball.x, y: this.ball.y, z: 0, t: 0 }] : simulatePath(this.ball, 2.2, null, 6, true);
  }

  updatePlay(dt) {
    if (this.checkHalfEnd()) return;
    this.predict();
    for (const p of this.players) p.onBall = this.owner === p;
    this.updateHumans(dt);
    for (let t = 0; t < 2; t++) {
      if (this.passive[t]) this.passiveTeam(t);
      else this.ai[t].update(dt);
    }
    for (const p of this.players) stepPlayer(p, dt);
    for (const p of this.players) if (p.timedFx) { p.timedFx.t += dt; if (p.timedFx.t > 1.2) p.timedFx = null; }
    this.playerCollisions();
    this.updateBall(dt);
    // 1) Goal line — authoritative and always before any keeper interaction
    const g = goalScored(this.ball);
    if (g !== -1) { this.onGoal(g); return; }
    // 2) Out of play
    const out = outOfPlay(this.ball);
    if (out) { this.onOut(out); return; }
    // 3) Keeper saves (only legal while the ball has not crossed the line)
    this.keeperContacts();
    if (this.state !== 'play') return;
    this.tackleContacts();
    if (this.state !== 'play') return;
    this.ballContacts();
    // stats & bookkeeping
    const pt = this.owner ? this.owner.team : this.lastTouch ? this.lastTouch.team : -1;
    if (pt >= 0) this.stats[pt].poss += dt;
    if (this.pass && this.time - this.pass.t > this.pass.eta + 2.5) this.pass = null;
    if (this.pendingSave) this.checkPendingSave();
    this.replay.record(this);
  }

  passiveTeam(t) {
    for (const p of this.mates(t)) {
      if (p.human >= 0) continue;
      if (p.role === 'GK') { this.ai[t].update(0); continue; }
      if (this.owner === p) { p.want.x = this.attackDir(t) * 2.5; p.want.y = 0; p.sprint = false; continue; }
      const f = this.ai[t] && FORMATION[p.idx];
      const dir = this.attackDir(t);
      const tx = dir > 0 ? f.x * PITCH.L : PITCH.L - f.x * PITCH.L, ty = f.y * PITCH.W;
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      p.want.x = d > 0.5 ? (dx / d) * 3 : 0; p.want.y = d > 0.5 ? (dy / d) * 3 : 0; p.sprint = false;
      p.faceWant = Math.atan2(this.ball.y - p.y, this.ball.x - p.x);
    }
  }

  playerCollisions() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]; if (a.sentOff) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]; if (b.sentOff) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d < 0.7 && d > 1e-4) {
          // the stronger player gives less ground (a shielding carrier even less)
          const sa = (a.attrs.strength ?? 0.6) + (a.shield ? 0.3 : 0), sb = (b.attrs.strength ?? 0.6) + (b.shield ? 0.3 : 0);
          const wa = clamp(sb / (sa + sb), 0.2, 0.8);
          const push = 0.7 - d, nx = dx / d, ny = dy / d;
          if (a.state !== 'slide' && a.state !== 'dive') { a.x -= nx * push * wa; a.y -= ny * push * wa; }
          if (b.state !== 'slide' && b.state !== 'dive') { b.x += nx * push * (1 - wa); b.y += ny * push * (1 - wa); }
          if (this.owner && a.team !== b.team && (this.owner === a || this.owner === b)) this.shoulderDuel(this.owner === a ? b : a, this.owner);
        }
      }
    }
  }

  /** Running alongside the carrier and leaning in: strength decides who keeps the ball. */
  shoulderDuel(ch, carrier) {
    if (ch.state !== 'run' || carrier.state !== 'run' || ch.role === 'GK' || carrier.role === 'GK') return;
    if ((ch.ai.shoulderT || 0) > this.time) return;
    const vc = Math.hypot(carrier.vx, carrier.vy), vh = Math.hypot(ch.vx, ch.vy);
    if (vc < 2.5 || vh < 2.5) return;
    if ((ch.vx * carrier.vx + ch.vy * carrier.vy) / (vc * vh) < 0.45) return;      // not running together
    const side = Math.acos(clamp(((ch.x - carrier.x) * Math.cos(carrier.facing) + (ch.y - carrier.y) * Math.sin(carrier.facing)) / Math.max(0.05, dist(ch, carrier)), -1, 1));
    if (side < 0.85 || side > 2.2) return;                                          // shoulder, not front/back
    ch.ai.shoulderT = this.time + 0.9;
    const pWin = shoulderWinChance(ch, carrier, { shielding: carrier.shield, speedEdge: vh - vc });
    const won = Math.random() < pWin;
    if (won) {
      const b = this.ball;
      this.owner = null; this.lastTouch = carrier; b.kickId++;
      const away = norm(carrier.x - ch.x, carrier.y - ch.y);
      b.vx = carrier.vx * 0.9 + away.x * 1.2; b.vy = carrier.vy * 0.9 + away.y * 1.2; b.vz = 0;
      carrier.kickCD = 0.35; carrier.recover = 0.45;
      carrier.vx *= 0.6; carrier.vy *= 0.6;
    } else {
      ch.recover = 0.45; ch.vx *= 0.55; ch.vy *= 0.55;
    }
    this.emit('shoulder', { p: ch, victim: carrier, won });
  }

  updateBall(dt) {
    const o = this.owner;
    if (o) {
      if (o.sentOff || o.state === 'down' || o.state === 'slide' || o.state === 'dive') { this.owner = null; return; }
      const b = this.ball;
      if (o.state === 'hold') {
        b.x = o.x + Math.cos(o.facing) * 0.35; b.y = o.y + Math.sin(o.facing) * 0.35; b.z = 1.0;
        b.vx = o.vx; b.vy = o.vy; b.vz = 0; return;
      }
      let f = o.facing;
      if (o.state === 'skill' && o.skill) {
        const s = o.skill;
        if (s.type === 'dragback') f = s.f0;
        if (s.type === 'roulette') f = s.f0 + s.side * Math.PI / 2;
        if (s.type === 'stepover') f = o.stateT < 0.28 ? s.f0 : o.facing;
        if (s.type === 'heelflick' && o.stateT > 0.08) {
          // flick the ball over and ahead, then chase it
          this.owner = null;
          b.vx = Math.cos(s.f0) * 8.5; b.vy = Math.sin(s.f0) * 8.5; b.vz = 3.6; b.z = 0.25;
          o.kickCD = 0.35; this.lastTouch = o; b.kickId++;
          return;
        }
      }
      const sp = Math.hypot(o.vx, o.vy);
      const off = 0.48 + Math.min(0.28, sp * 0.03) + 0.07 * Math.abs(Math.sin(o.anim * 0.5));
      b.x = o.x + Math.cos(f) * off; b.y = o.y + Math.sin(f) * off; b.z = 0;
      b.vx = o.vx; b.vy = o.vy; b.vz = 0; b.spin = 0; b.topspin = 0;
      b.rot += sp * dt / BALL_R;
    } else {
      const ev = [];
      stepBallWorld(this.ball, dt, ev);
      for (const e of ev) {
        this.emit(e);
        if ((e === 'post' || e === 'bar') && this.shot) this.banner(e === 'post' ? 'OFF THE POST!' : 'OFF THE BAR!', '', '#ffffff', 1.6);
      }
    }
  }

  // ---------- humans ----------
  setHumanPlayer(h, p) {
    if (!p) return;
    if (h.player && h.player !== p) { h.player.human = -1; h.player.charging = false; }
    h.player = p; p.human = h.ctrl; h.lastSwitch = this.time;
  }

  /** Candidate the switch button would select next (nearest to the ball, not the current one). */
  switchCandidate(h, auto = false) {
    const others = new Set(this.humans.filter((o) => o !== h).map((o) => o.player));
    const b = this.ball;
    const cands = this.mates(h.team).filter((p) => p.role !== 'GK' && !others.has(p))
      .sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y));
    if (!cands.length) return null;
    let p = cands[0];
    if (!auto && p === h.player && cands[1]) p = cands[1];
    return p;
  }

  switchPlayer(h, auto) {
    const p = this.switchCandidate(h, auto);
    if (p && p !== h.player) { this.setHumanPlayer(h, p); this.emit('switch', { p }); }
  }

  aimDirFor(h, p, mv) {
    const aw = this.aimWorld[h.ctrl];
    if (aw) { const d = norm(aw.x - p.x, aw.y - p.y); if (d.x || d.y) return d; }
    if (Math.hypot(mv.x, mv.y) > 0.2) return norm(mv.x, mv.y);
    return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  }

  /** Where a high ball will come down (first point of the predicted path below head height). */
  airLanding() {
    const b = this.ball;
    if (this.owner) return null;
    let high = b.z > 1.3;
    for (const pt of this.ballPath) {
      if (pt.z > 1.8) high = true;
      if (high && pt.z < 1.4 && pt.t > 0.2) return pt;
    }
    return null;
  }

  nearestMateTo(h, pt) {
    const others = new Set(this.humans.filter((o) => o !== h).map((o) => o.player));
    let best = null, bd = 1e9;
    for (const q of this.mates(h.team)) {
      if (q.role === 'GK' || others.has(q)) continue;
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd) { bd = d; best = q; }
    }
    return { p: best, d: bd };
  }

  updateHumans(dt) {
    for (const h of this.humans) {
      if (!h.player || h.player.sentOff) this.switchPlayer(h, true);
      const p = h.player; if (!p) continue;
      const c = this.ctrls[h.ctrl]; if (!c) continue;
      const g = this.gp(h);
      const pressed = (a) => c.wasPressed(a) || (a === 'pass' && h.ctrl === 0 && this.mouseClick);
      const held = (a) => c.isHeld(a) || (a === 'pass' && h.ctrl === 0 && this.mouseDown);
      const mv = c.move();
      const mag = Math.hypot(mv.x, mv.y);
      const sprint = c.isHeld('sprint');
      const aim = this.aimDirFor(h, p, mv);
      p.aimDir = aim;
      // receiver lock: stay on the player the pass is going to until it arrives
      const locked = g.receiverLock && this.pass && this.pass.team === h.team && this.pass.receiver === p && !this.owner;
      h.next = this.switchCandidate(h, false);
      if (pressed('switch') && !locked) { this.switchPlayer(h, false); p.passHold = null; continue; }

      const own = this.owner;
      const defending = !!own && own.team !== h.team;
      const jockeyHeld = c.isHeld('jockey');
      p.jockey = false; p.shield = false;

      // movement (with receiver assist when the player isn't steering)
      let assisted = false;
      if (this.pass && this.pass.receiver === p && !this.owner) {
        // receiver assist: run onto the ball unless the player clearly steers somewhere else
        // get onto the ball's line a touch early (no parallel chasing of a pass)
        const ip = this.ai[p.team].interceptPoint(p, 0.15, 0.12);
        const dx = ip.x - p.x, dy = ip.y - p.y, d = Math.hypot(dx, dy);
        // the stick is still held from the pass itself for a moment: ignore it, and afterwards
        // only a clear steer away (> ~110 degrees) takes the receiver off the ball's line
        const since = this.time - this.pass.t;
        const agrees = since < 0.45 || mag < 0.15 || d < 0.3 || (mv.x * dx + mv.y * dy) / (mag * d) > (locked ? -0.8 : -0.35);
        if (agrees) {
          assisted = true;
          const sp = Math.min(topSpeed(p, d > 3 || sprint), d * 6);
          p.want.x = d > 0.2 ? (dx / d) * sp : 0; p.want.y = d > 0.2 ? (dy / d) * sp : 0; p.sprint = d > 5 || (sprint && d > 1);
        }
      }
      if (!assisted && jockeyHeld && defending && p.state === 'run') {
        // jockey: face the carrier, side-step; with no input stay goal-side of him (sticky)
        p.jockey = true;
        p.faceWant = Math.atan2(own.y - p.y, own.x - p.x);
        if (mag < 0.15 && dist(p, own) < 10) {
          const gc = this.goalCenter(this.ownSide(h.team));
          const n = norm(gc.x - own.x, gc.y - own.y);
          const tx = own.x + n.x * 1.8 + own.vx * 0.15, ty = own.y + n.y * 1.8 + own.vy * 0.15;
          const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
          const sp = Math.min(5.4, d * 4);
          p.want.x = d > 0.1 ? (dx / d) * sp : 0; p.want.y = d > 0.1 ? (dy / d) * sp : 0;
        } else { const sp = topSpeed(p, sprint); p.want.x = mv.x * sp; p.want.y = mv.y * sp; }
        p.sprint = sprint;
        assisted = true;
      }
      if (!assisted) {
        const sp = topSpeed(p, sprint);
        p.want.x = mv.x * sp; p.want.y = mv.y * sp; p.sprint = sprint && mag > 0.2;
      }
      if (own === p && jockeyHeld) {
        // shield: back into the nearest opponent, ball on the far side
        let near = null, nd = 4;
        for (const o of this.opps(h.team)) { const d = dist(o, p); if (d < nd) { nd = d; near = o; } }
        p.shield = true; p.sprint = false;
        p.faceWant = near ? Math.atan2(p.y - near.y, p.x - near.x) : Math.atan2(aim.y, aim.x);
      } else if (!p.jockey && mag < 0.1) p.faceWant = own === p ? Math.atan2(aim.y, aim.x) : Math.atan2(this.ball.y - p.y, this.ball.x - p.x);

      // timed finishing: the shot is struck a moment after release; tap Shoot again at contact
      if (p.windup) {
        const w = p.windup;
        w.t += dt;
        p.want.x *= 0.5; p.want.y *= 0.5; p.sprint = false;
        if (pressed('shoot') && w.tap == null) w.tap = w.t - w.contact;
        if (own !== p) { p.windup = null; }
        else if (w.t >= w.contact && (w.tap != null || w.t >= w.contact + TIMED_WINDOW)) {
          const gr = timedFinishGrade(w.tap);
          p.windup = null;
          p.timedFx = { grade: gr.grade, t: 0 };
          this.doShot(p, { ...w.o, errMul: (w.o.errMul || 1) * gr.errMul, speedMul: gr.speedMul });
          if (gr.grade !== 'none') this.emit('timedFinish', { p, grade: gr.grade });
          continue;
        }
        continue;
      }
      if (p.timedFx && p.timedFx.grade === 'none' && pressed('shoot') && p.timedFx.t < 0.35 && !c.isHeld('pass')) {
        p.timedFx = { grade: 'late', t: 0 };
      }

      // shot charging (also used for first-time volleys when not on the ball)
      if (c.isHeld('shoot') && !p.passHold) {
        if (!p.charging) { p.charging = true; p.charge = 0; p.shotMod = null; }
        p.charge = Math.min(1, p.charge + dt / 1.05);
        if (pressed('lob')) p.shotMod = 'chip';
        if (pressed('through')) p.shotMod = 'finesse';
      }
      if (own === p) {
        if (!c.isHeld('shoot') && p.charging) {
          const type = p.shotMod || (p.charge >= 0.9 ? 'power' : 'driven');
          const o = { aimDir: aim, power: p.charge, type, mode: g.shot, sprinting: p.sprint, realism: g.shotError };
          p.charging = false;
          if (g.timedFinishing) p.windup = { t: 0, contact: 0.2, tap: null, o };
          else this.doShot(p, o);
        } else if (!p.charging) {
          if (p.passHold) {
            // Semi / Manual passing: the longer you hold, the harder the pass
            const ph = p.passHold;
            ph.t += dt;
            if (!held(ph.kind === 'ground' ? 'pass' : ph.kind) || ph.t >= 1.0) {
              p.passHold = null;
              this.doPass(p, ph.kind, null, aim, { mode: ph.mode, power: Math.min(1, ph.t / 1.0) });
            }
          } else {
            const kind = pressed('pass') ? 'ground' : pressed('through') ? 'through' : pressed('lob') ? 'lob' : null;
            if (kind) {
              const mode = g[kind === 'ground' ? 'passGround' : kind === 'through' ? 'passThrough' : 'passLob'];
              if (mode === 'Assisted') this.doPass(p, kind, null, aim, { mode });
              else p.passHold = { kind, mode, t: 0 };
            } else if (pressed('skill')) this.startSkillMove(p, mv.x, mv.y, sprint);
          }
        }
      } else {
        p.passHold = null;
        if (!c.isHeld('shoot')) p.charging = false;
        if (pressed('tackle')) this.startTackle(p, 'stand', null);
        else if (pressed('slide')) this.startTackle(p, 'slide', null);
        else if (g.autoTackle && defending) this.autoTackle(p, own);
      }

      // automatic switching
      if (locked || g.autoSwitch === 'Manual' || this.time - h.lastSwitch < 0.6) continue;
      const land = this.airLanding();
      if (land && !(this.pass && this.pass.team === h.team && this.pass.receiver)) {
        // a high ball: take the player best placed where it comes down
        const n = this.nearestMateTo(h, land);
        if (n.p && n.p !== p && Math.hypot(p.x - land.x, p.y - land.y) > n.d + 3 && mag < 0.9) { this.setHumanPlayer(h, n.p); continue; }
      }
      if (g.autoSwitch !== 'Auto') continue;
      // auto-switch while defending when someone else is much closer
      if ((!own || own.team !== h.team) && this.time - h.lastSwitch > 1.1 && !(this.pass && this.pass.team === h.team)) {
        const n = this.nearestMateTo(h, this.ball);
        const cur = Math.hypot(p.x - this.ball.x, p.y - this.ball.y);
        if (n.p && n.p !== p && cur > n.d + 7 && mag < 0.9) this.setHumanPlayer(h, n.p);
      }
    }
  }

  /** Auto tackle: nick the ball when it is clearly there to be won from the front. */
  autoTackle(p, carrier) {
    if (p.state !== 'run' || p.tackleCD > 0 || carrier.state === 'hold') return;
    if ((p.ai.autoTkT || 0) > this.time) return;
    const b = this.ball;
    const dBall = Math.hypot(b.x - p.x, b.y - p.y);
    if (dBall > 1.3) return;
    p.ai.autoTkT = this.time + 0.3;
    const toBall = Math.atan2(b.y - p.y, b.x - p.x);
    if (isFromBehind(p, carrier)) return;
    const from = { x: p.x + Math.cos(toBall) * 0.3, y: p.y + Math.sin(toBall) * 0.3 };
    if (tackleSweep(from, toBall, 0.8, b, [carrier], false).first !== 'ball') return;
    this.startTackle(p, 'stand', toBall);
  }

  // ---------- actions ----------
  kick(p, vx, vy, vz, spin = 0, topspin = 0, strength = 0.6) {
    const b = this.ball;
    this.owner = null;
    b.vx = vx; b.vy = vy; b.vz = vz; b.spin = spin; b.topspin = topspin; b.knuckle = 0;
    if (vz > 0) b.z = Math.max(b.z, 0.03);
    p.kickCD = 0.28; this.lastTouch = p; b.kickId++;
    p.charging = false; p.charge = 0;
    if (p.state === 'hold') { p.state = 'run'; }
    this.emit('kick', { strength });
  }

  setOwner(p, silent = false) {
    if (this.pass) {
      if (p.team === this.pass.team && p !== this.pass.from) { this.stats[p.team].passCmp++; this.emit('passDone', { p, kind: this.pass.kind }); }
      else if (p.team !== this.pass.team) { this.stats[p.team].interceptions++; this.emit('interception', { p }); }
      this.pass = null;
    }
    this.shot = null;
    this.owner = p; this.lastTouch = p; this.ball.kickId++;
    p.ai.decT = this.prof[p.team].react * 0.6;
    p.ai.dribDir = null;
    if (p.human < 0 && p.role !== 'GK') {
      const hs = this.humans.filter((h) => h.team === p.team);
      if (hs.length) {
        const h = hs.sort((a, c) => (a.player ? dist(a.player, p) : 99) - (c.player ? dist(c.player, p) : 99))[0];
        this.setHumanPlayer(h, p);
      }
    }
    if (!silent) this.emit('control', { p });
  }

  /**
   * Play a pass. AI passes name the mate; human passes go through the pass assistance
   * (opts.mode Assisted / Semi / Manual, opts.power = hold-time power for Semi / Manual).
   */
  doPass(p, kind, mate, aimDir, opts = {}) {
    if (this.owner !== p && !(this.sp && this.sp.taker === p)) return;
    const b = this.ball;
    const from = { x: b.x, y: b.y };
    const dir = this.attackDir(p.team);
    const human = p.human >= 0;
    let target, receiver = null, v, mode = 'ai';
    if (mate || !human) {
      let sel = null;
      if (mate) { const lt = leadTarget(from, mate, kind, dir); sel = { mate, target: lt.target }; }
      else sel = choosePassTarget(p, this.mates(p.team), this.opps(p.team), aimDir, kind, dir);
      let arrive = null;
      if (sel) { target = sel.target; receiver = sel.mate; }
      else {
        const L = kind === 'lob' ? 24 : kind === 'through' ? 18 : 13;
        target = clampToPitch({ x: from.x + aimDir.x * L, y: from.y + aimDir.y * L }, 1.5, 1.5);
        arrive = kind === 'lob' ? null : 1.8;
      }
      const v0 = passVelocity(from, target, kind, arrive);
      const acc = human ? 0.55 : 1.5 - this.prof[p.team].acc;
      const err = gauss() * 0.028 * (1.3 - p.attrs.passing) * acc;
      const c = Math.cos(err), sn = Math.sin(err);
      const sm = 1 + gauss() * 0.02 * acc;
      v = { vx: (v0.vx * c - v0.vy * sn) * sm, vy: (v0.vx * sn + v0.vy * c) * sm, vz: v0.vz * sm, t: v0.t };
    } else {
      mode = opts.mode || 'Assisted';
      const plan = planPass({ passer: p, from, mates: this.mates(p.team), opps: this.opps(p.team), aimDir, kind, attackDir: dir, mode, power: opts.power ?? 0.5, passing: p.attrs.passing });
      target = plan.target; receiver = plan.mate; v = plan.v;
    }
    this.kick(p, v.vx, v.vy, v.vz, 0, 0, kind === 'lob' ? 0.6 : 0.4);
    this.pass = { from: p, receiver, target, team: p.team, kind, t: this.time, eta: v.t, mode };
    this.stats[p.team].passAtt++;
    if (!receiver && human) {
      // manual / into space: the team-mate who gets there first goes for it
      this.predict();
      let best = null, bt = 1e9;
      for (const q of this.mates(p.team)) {
        if (q === p || q.role === 'GK') continue;
        const ip = this.ai[p.team].interceptPoint(q);
        if (ip.t < bt) { bt = ip.t; best = q; }
      }
      if (best && bt < 8) receiver = best; this.pass.receiver = receiver;
    }
    if (receiver) {
      receiver.ai.decT = 0.2;
      const h = this.humanFor(p);
      if (h) this.setHumanPlayer(h, receiver);   // control follows the ball
    }
    // give-and-go: an AI passer keeps running into space after playing it forward
    if (!human && receiver && p.role !== 'GK' && (target.x - from.x) * dir > 4 && Math.random() < 0.5) {
      p.ai.runT = 1.6;
      p.ai.runTo = clampToPitch({ x: p.x + dir * 12, y: p.y + (CY - p.y) * 0.2 }, 3, 3);
    }
    this.emit('pass', { kind, p, receiver });
  }

  /** Hoof it clear: long and high towards the wing, sometimes deliberately into touch. */
  clearBall(p) {
    const b = this.ball, dir = this.attackDir(p.team);
    const touch = Math.random() < 0.5;
    const up = b.y < CY;
    const ty = touch ? (up ? -5 : PITCH.W + 5) : (up ? 4 + Math.random() * 7 : PITCH.W - 4 - Math.random() * 7);
    const tx = clamp(b.x + dir * (24 + Math.random() * 16), 3, PITCH.L - 3);
    const v = solveKick({ x: b.x, y: b.y, z: Math.max(b.z, BALL_R) }, { x: tx, y: ty, z: 0.5 }, 17 + Math.random() * 5, { loft: true });
    this.pass = null;
    this.kick(p, v.vx, v.vy, Math.min(v.vz, 15), 0, 0, 0.85);
    this.emit('clearance', { p });
  }

  doShot(p, o) {
    const side = this.attackSide(p.team);
    const b = this.ball;
    const from = { x: b.x, y: b.y };
    let near = 99;
    for (const q of this.opps(p.team)) near = Math.min(near, dist(q, p));
    const pressure = clamp(1 - (near - 0.8) / 3, 0, 1);
    const plan = planShot({ from, aimDir: o.aimDir, goalSide: side, mode: o.mode, power: o.power, type: o.type,
      shooting: p.attrs.shooting, sprinting: o.sprinting, pressure, errMul: o.errMul || 1, realism: o.realism });
    if (o.speedMul) plan.speed *= o.speedMul;
    const v = shotVelocity({ x: from.x, y: from.y, z: Math.max(b.z, BALL_R) }, plan);
    this.kick(p, v.vx, v.vy, Math.min(v.vz, 16), v.spin || 0, 0, 0.35 + 0.65 * o.power);
    this.shot = { team: p.team, side, shooter: p, t: this.time, plan, counted: false };
    this.stats[p.team].shots++;
    this.emit('shot', { p, kind: o.type });
  }

  aiShoot(p) {
    const side = this.attackSide(p.team);
    const gc = this.goalCenter(side);
    const b = this.ball;
    const d = dist(b, gc);
    const gk = this.keeper(1 - p.team);
    const prof = this.prof[p.team];
    let ty = CY + (gk && gk.y < CY ? 1 : -1) * (GOAL.W / 2 - 0.55);
    if (Math.random() < 0.3) ty = CY + (Math.random() - 0.5) * (GOAL.W - 1.2);
    let type = 'driven';
    const gkOff = gk ? Math.abs(gk.x - gc.x) : 0;
    if (gkOff > 5 && d > 14 && Math.random() < 0.45) type = 'chip';
    else if (d > 11 && d < 24 && Math.random() < 0.35) type = 'finesse';
    const power = clamp(0.45 + d / 55 + Math.random() * 0.2, 0.4, type === 'chip' ? 0.7 : 0.92);
    const aimDir = norm(gc.x - b.x, ty - b.y);
    this.doShot(p, { aimDir, power, type, mode: 'Manual', sprinting: p.sprint, errMul: 2.6 - prof.acc * 1.2 });
  }

  startSkillMove(p, mx, my, sprint) {
    if (this.owner !== p) return;
    const t = startSkill(p, mx, my, sprint);
    if (t) this.emit('skill', { p, name: SKILL_NAMES[t] });
  }

  startTackle(p, type, dirAngle) {
    if (p.state !== 'run' || p.tackleCD > 0 || this.owner === p) return;
    const b = this.ball;
    // auto-direct the tackle at the ball when it's close
    let dir = dirAngle;
    if (dir == null) {
      const db = Math.hypot(b.x - p.x, b.y - p.y);
      dir = db < (type === 'slide' ? 4.5 : 2.6) ? Math.atan2(b.y - p.y, b.x - p.x) : p.facing;
    }
    const opps = this.opps(p.team);
    let victim = null, vd = 4.5;
    for (const o of opps) { const d = dist(o, p); if ((o === this.owner ? d - 1 : d) < vd) { vd = d; victim = o; } }
    p.state = type === 'slide' ? 'slide' : 'tackle';
    p.stateT = 0; p.stateDur = type === 'slide' ? 0.7 : 0.3;
    p.facing = dir;
    p.tk = { type, dir, first: null, body: false, near: null, victim, evaded: false, judged: false, tripped: false, speed0: Math.hypot(p.vx, p.vy), jockey: !!p.jockey };
    if (victim && victim === this.owner && type === 'stand' && isEvading(victim)) p.tk.evaded = true;
    p.tackleCD = type === 'slide' ? 1.3 : 0.55;
    p.stamina = Math.max(0, p.stamina - 0.03);
    this.emit('tackleStart', { p, kind: type });
  }

  tackleContacts() {
    const b = this.ball;
    for (const p of this.players) {
      if (p.sentOff || (p.state !== 'tackle' && p.state !== 'slide') || !p.tk) continue;
      const tk = p.tk;
      const slide = tk.type === 'slide';
      const active = slide ? p.stateT > 0.03 && p.stateT < 0.6 : p.stateT > 0.04 && p.stateT < 0.27;
      if (!active) {
        if (!tk.judged && p.stateT >= (slide ? 0.6 : 0.27)) {
          tk.judged = true;
          // a challenge from clearly behind that misses the ball but reaches the man in possession
          if (!tk.first && tk.near && tk.nearHadBall) {
            const v = judgeTackle({ type: tk.type, firstContact: null, bodyContact: false, nearVictim: true, fromBehind: isFromBehind(p, tk.near) });
            if (v.foul) { this.callFoul(p, tk.near, v); return; }
          }
        }
        continue;
      }
      const reach = slide ? 1.05 : 0.9;
      const playable = !tk.first && !tk.evaded && b.z < 0.7 && !(this.owner && this.owner.team === p.team);
      const victims = this.opps(p.team).filter((v) => v.state !== 'down' && !(tk.evaded && v === tk.victim && isEvading(v)));
      // remember a near miss on the man in possession (used for the "from behind" rule)
      const fx = p.x + Math.cos(tk.dir) * reach, fy = p.y + Math.sin(tk.dir) * reach;
      for (const v of victims) {
        if (!tk.near && this.owner === v && Math.hypot(fx - v.x, fy - v.y) < 0.45) { tk.near = v; tk.nearHadBall = true; }
      }
      const sw = tackleSweep(p, tk.dir, reach, playable ? b : null, victims, slide);
      if (!tk.first && sw.first === 'ball') {
        tk.first = 'ball';
        const victim = this.owner;
        this.emit('tackleWon', { p, kind: tk.type });
        if (slide && p.role === 'GK' && inPenaltyArea(b, this.ownSide(p.team))) {
          // keeper smothers at the striker's feet
          this.setOwner(p, true); p.state = 'hold'; p.stateT = 0; p.holdT = 0; p.tk = null;
          this.banner('SMOTHERED!', p.name, '#8ecae6', 1.4);
          this.emit('save', { gk: p });
          continue;
        } else if (slide) {
          this.owner = null; this.pass = null;
          const a = tk.dir + (Math.random() - 0.5) * 0.8;
          b.vx = Math.cos(a) * (5 + Math.random() * 3); b.vy = Math.sin(a) * (5 + Math.random() * 3); b.vz = 0.5;
          this.lastTouch = p; b.kickId++;
        } else if (victim && victim !== p) {
          if (Math.random() < 0.6 + 0.35 * (p.attrs.tackling - victim.attrs.dribbling) + (tk.jockey ? 0.12 : 0)) this.setOwner(p);
          else { this.owner = null; b.vx = Math.cos(tk.dir) * 4; b.vy = Math.sin(tk.dir) * 4; this.lastTouch = p; b.kickId++; victim.kickCD = 0.3; }
        } else this.setOwner(p);
      } else if (!tk.first && sw.first === 'body') {
        tk.first = 'body'; tk.body = true;
        const v = sw.victim;
        const verdict = judgeTackle({ type: tk.type, firstContact: 'body', bodyContact: true, fromBehind: isFromBehind(p, v) });
        if (verdict.foul) { this.callFoul(p, v, verdict); return; }
      } else if (tk.first === 'ball' && slide && sw.victim && !tk.tripped && sw.victim.role !== 'GK') {
        // won the ball cleanly, the follow-through takes the man down (no foul)
        tk.tripped = true; sw.victim.state = 'down'; sw.victim.stateT = 0; sw.victim.stateDur = 0.5;
      }
    }
  }

  callFoul(fouler, victim, verdict) {
    if (this.state !== 'play') return;
    this.stats[fouler.team].fouls++; this.stoppages++;
    victim.state = 'down'; victim.stateT = 0; victim.stateDur = 1.1;
    if (this.owner === victim) this.owner = null;
    let sub = verdict.reason;
    if (verdict.card) {
      const res = applyCard(fouler, verdict.card);
      if (res === 'red') {
        this.stats[fouler.team].reds++;
        this.banner('RED CARD', `#${fouler.num} ${fouler.name} — second yellow`, '#ff3b3b', 2.8);
        this.sendOff(fouler);
      } else {
        this.stats[fouler.team].yellows++;
        this.banner('YELLOW CARD', `#${fouler.num} ${fouler.name}`, '#ffd60a', 2.4);
      }
      this.emit('card', { card: res, p: fouler });
    }
    const side = this.ownSide(fouler.team);
    const spot = { x: clamp(victim.x, 0.6, PITCH.L - 0.6), y: clamp(victim.y, 0.6, PITCH.W - 0.6) };
    let r;
    if (inPenaltyArea(spot, side)) {
      r = { type: 'penalty', team: victim.team, x: side === 0 ? PEN_SPOT : PITCH.L - PEN_SPOT, y: CY };
      sub = verdict.reason + ' — PENALTY!';
    } else {
      const gc = this.goalCenter(side);
      const direct = dist(spot, gc) < 31 && Math.abs(spot.y - CY) < 19;
      r = { type: direct ? 'fk3d' : 'freekick', team: victim.team, x: spot.x, y: spot.y };
    }
    this.banner('FOUL', sub, '#ffffff', 2.2);
    this.state = 'foul'; this.stateT = 0; this.pendingRestart = r;
    this.pass = null; this.shot = null;
    this.emit('whistle'); this.emit('foul', { reason: verdict.reason, fouler, victim });
  }

  sendOff(p) {
    p.sentOff = true;
    if (this.owner === p) this.owner = null;
    const h = this.humanFor(p);
    p.human = -1;
    this.parkSentOff(p);
    if (h) { h.player = null; this.switchPlayer(h, true); }
  }

  keeperContacts() {
    if (this.owner) return;
    const b = this.ball;
    for (const gk of this.players) {
      if (gk.role !== 'GK' || gk.sentOff) continue;
      if (!(gk.saveIntent && gk.saveKick === b.kickId)) continue;
      const side = this.ownSide(gk.team);
      if (!keeperMaySave(b, side)) continue;           // never "save" a ball that is already in
      const kp = gk.attrs.keeping;
      const reachR = gk.state === 'dive' ? 1.05 + 0.5 * kp : 1.0;
      const dh = Math.hypot(b.x - gk.x, b.y - gk.y);
      if (dh < reachR && b.z < 2.5 + 0.25 * kp) { this.keeperSave(gk, side); return; }
    }
  }

  keeperSave(gk, side) {
    const b = this.ball;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const kp = gk.attrs.keeping;
    gk.saveIntent = false;
    const att = 1 - gk.team;
    if (this.shot && !this.shot.counted) { this.stats[att].onTarget++; this.shot.counted = true; }
    const catchP = clamp(1.25 - sp / 24, 0.12, 0.92) * (0.75 + 0.3 * kp);
    const inward = side === 0 ? 1 : -1;
    if (Math.random() < catchP) {
      if (Math.random() < 0.07 * (1.2 - kp)) {
        // fumble!
        this.owner = null; this.lastTouch = gk; b.kickId++;
        b.vx = inward * (1 + Math.random() * 2); b.vy = (Math.random() - 0.5) * 4; b.vz = 1; b.z = Math.max(b.z, 0.3);
        this.banner('FUMBLE!', gk.name, '#ffb703', 1.5);
      } else {
        this.setOwner(gk, true);
        gk.state = 'hold'; gk.stateT = 0; gk.holdT = 0;
      }
    } else {
      // parry away from goal, towards the side
      const s = Math.sign(b.y - CY) || (Math.random() < 0.5 ? -1 : 1);
      b.vx = inward * (2 + sp * 0.22) * (0.5 + Math.random() * 0.6);
      b.vy = s * (3 + sp * 0.25) * (0.6 + Math.random() * 0.5);
      b.vz = 1.2 + Math.random() * 2.5; b.spin = 0;
      this.owner = null; this.lastTouch = gk; b.kickId++;
    }
    this.pendingSave = { t: this.time, gk };
    this.emit('save', { gk });
  }

  /** Confirm "SAVED!" only once the ball is safe — never for a ball that ends up in the goal. */
  checkPendingSave() {
    const ps = this.pendingSave;
    if (this.time - ps.t < 0.45) return;
    if (this.time - ps.t > 3) { this.pendingSave = null; return; }
    let danger = false;
    if (!this.owner) {
      const path = simulatePath(this.ball, 1.5, (bb) => goalScored(bb) !== -1, 4, true);
      const last = path[path.length - 1];
      danger = last && goalScored(last) !== -1;
    }
    if (!danger) { this.banner('SAVED!', `${ps.gk.name}`, '#8ecae6', 1.6); this.emit('saveConfirmed'); this.pendingSave = null; }
  }

  keeperDistribute(gk) {
    const dir = this.attackDir(gk.team);
    const mates = this.mates(gk.team).filter((p) => p !== gk);
    const opps = this.opps(gk.team);
    let best = null, bs = -1e9;
    for (const m of mates) {
      const d = dist(gk, m);
      const space = Math.min(...opps.map((o) => dist(o, m)));
      const s = Math.min(space, 8) - Math.abs(d - 18) * 0.15 + (m.role === 'DF' ? 1 : 0);
      if (s > bs) { bs = s; best = m; }
    }
    gk.state = 'run';
    this.ball.z = 0.9;
    if (best && bs > 3.5) this.doPass(gk, 'ground', best, null);
    else {
      const fw = mates.find((p) => p.role === 'FW') || best;
      if (fw) this.doPass(gk, 'lob', fw, null);
      else { const v = passVelocity(this.ball, { x: this.ball.x + dir * 30, y: CY }, 'lob'); this.kick(gk, v.vx, v.vy, v.vz); }
    }
  }

  /** Free-ball contacts: traps, headers, volleys, deflections and keeper handling. */
  ballContacts() {
    if (this.owner) return;
    const b = this.ball;
    const bs = Math.hypot(b.vx, b.vy);
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.sentOff || p.kickCD > 0) continue;
      if (p.state === 'down' || p.state === 'slide' || p.state === 'tackle' || p.state === 'hold') continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      const isGK = p.role === 'GK' && inPenaltyArea(b, this.ownSide(p.team));
      let reach;
      // a player closing down a pass that isn't his own team's gets the same committed reach as
      // the intended receiver: without this he arrives at the interception point but can only
      // nudge the ball, never actually win it, no matter how well he reads the lane.
      const committed = this.pass && (this.pass.receiver === p || this.pass.team !== p.team);
      if (isGK) reach = b.z < (p.ai.claim ? 2.8 : 2.4) ? (p.state === 'dive' || p.ai.claim ? 1.1 : 0.9) : 0;
      else reach = b.z < 0.6 ? (committed ? 1.0 : 0.58) : b.z < 1.6 ? 0.5 : b.z < 2.3 ? 0.48 : 0;
      if (d < reach && d < bd) {
        // keepers that did not read a hard shot cannot magically stop it
        if (isGK && bs > 12 && this.shot && this.shot.team !== p.team && !(p.saveIntent && p.saveKick === b.kickId)) continue;
        best = p; bd = d;
      }
    }
    if (!best) return;
    const p = best;
    const isGK = p.role === 'GK' && inPenaltyArea(b, this.ownSide(p.team));
    const relSpeed = Math.hypot(b.vx - p.vx, b.vy - p.vy);
    const attackingBox = inPenaltyArea(b, this.attackSide(p.team)) || dist(b, this.goalCenter(this.attackSide(p.team))) < 20;
    const human = p.human >= 0;
    if (isGK) {
      if (relSpeed > 20) { this.keeperSave(p, this.ownSide(p.team)); return; }
      if (b.z > 1.4 && this.pass && this.pass.team !== p.team) {
        // high ball into a crowd: punch it clear rather than risk the catch
        const crowd = this.opps(p.team).some((o) => Math.hypot(o.x - b.x, o.y - b.y) < 1.8);
        if ((crowd && Math.random() < 0.65) || Math.random() < 0.12) {
          const out = this.attackDir(p.team);
          const a = Math.atan2((b.y - CY) * 0.6 + (Math.random() - 0.5) * 6, out * 6);
          const sp = 12 + Math.random() * 5;
          b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.vz = 4.5 + Math.random() * 2; b.spin = 0;
          this.lastTouch = p; p.kickCD = 0.5; b.kickId++; this.pass = null;
          this.banner('PUNCHED CLEAR', p.name, '#8ecae6', 1.3);
          this.emit('punch', { gk: p });
          return;
        }
      }
      this.setOwner(p); p.state = 'hold'; p.stateT = 0; p.holdT = 0;
      if (this.shot && this.shot.team !== p.team && !this.shot.counted) { this.stats[this.shot.team].onTarget++; this.shot.counted = true; }
      return;
    }
    // first-time volleys / headers for a charging human, or AI in front of goal
    const wantsShot = (human && p.charging) || (!human && attackingBox && (b.z > 0.3 || relSpeed > 6) && Math.random() < 0.55 && !this.isHumanTeam(p.team));
    if (wantsShot && attackingBox) {
      const side = this.attackSide(p.team);
      const gc = this.goalCenter(side);
      const aim = human ? p.aimDir || norm(gc.x - p.x, gc.y - p.y) : norm(gc.x - b.x, CY + (Math.random() - 0.5) * 5 - b.y);
      const type = b.z > 1.6 ? 'header' : b.z > 0.3 ? 'volley' : 'driven';
      this.lastTouch = p;
      this.doShot(p, { aimDir: aim, power: human ? Math.max(0.35, p.charge) : 0.7, type, mode: human ? this.gp(this.humanFor(p) || { ctrl: 0 }).shot : 'Manual', realism: human ? this.gp(this.humanFor(p) || { ctrl: 0 }).shotError : true, sprinting: false, errMul: human ? 1.1 : 1.3 });
      return;
    }
    // first-time clearance in our own box under pressure (AI, or a human with auto clearances)
    const ownBox = inPenaltyArea(b, this.ownSide(p.team));
    if (ownBox && !p.charging) {
      const hh = this.humanFor(p);
      const autoClear = hh ? this.gp(hh).autoClear : Math.random() < 0.5;
      const danger = this.opps(p.team).some((o) => Math.hypot(o.x - b.x, o.y - b.y) < 2.8);
      const fromMate = this.pass && this.pass.team === p.team && this.pass.receiver === p;
      if (autoClear && danger && !fromMate) { this.lastTouch = p; this.clearBall(p); return; }
    }
    if (b.z > 1.5) {
      // cushioned header / chest down to feet
      b.vx = p.vx * 0.5 + Math.cos(p.facing) * 1.5; b.vy = p.vy * 0.5 + Math.sin(p.facing) * 1.5; b.vz = Math.min(0, b.vz) * 0.2;
      this.lastTouch = p; p.kickCD = 0.12; b.kickId++;
      this.emit('header', { p });
      return;
    }
    const intended = this.pass && this.pass.receiver === p;
    const trapLimit = (intended ? 21 : 16) + 6 * p.attrs.dribbling;
    if (relSpeed < trapLimit) {
      // cutting out a firm pass often only gets a toe to it: the ball deflects away
      if (this.pass && this.pass.team !== p.team && relSpeed > 9 && b.z < 0.6 && Math.random() < 0.3 + (relSpeed - 9) * 0.04 - p.attrs.tackling * 0.15) {
        const a = Math.atan2(b.vy, b.vx) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.9);
        const sp = relSpeed * (0.35 + Math.random() * 0.25);
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.vz = Math.random() * 1.5; b.spin = 0;
        this.lastTouch = p; p.kickCD = 0.25; b.kickId++; this.pass = null;
        this.emit('deflect', { p, block: true });
        return;
      }
      // contextual first touch: fast balls, sprinting and pressure make it heavier
      const assistedPass = this.pass && this.pass.receiver === p && this.pass.mode === 'Assisted';
      if (!assistedPass) {
        let near = 99;
        for (const o of this.opps(p.team)) near = Math.min(near, dist(o, p));
        const pressure = clamp(1 - (near - 0.8) / 2.5, 0, 1);
        const hv = touchHeaviness({ relSpeed, dribbling: p.attrs.dribbling, sprinting: p.sprint && Math.hypot(p.vx, p.vy) > jogSpeed(p), pressure, height: b.z });
        if (Math.random() < hv * 0.55) { this.heavyTouch(p, hv); return; }
      }
      this.setOwner(p); return;
    }
    // too hot to handle: deflection off the body
    const n = norm(b.x - p.x, b.y - p.y);
    const vn = b.vx * n.x + b.vy * n.y;
    if (vn < 0) { b.vx -= 1.4 * vn * n.x; b.vy -= 1.4 * vn * n.y; }
    b.vx *= 0.5; b.vy *= 0.5; b.vz = Math.abs(b.vz) * 0.4 + 0.5;
    this.lastTouch = p; p.kickCD = 0.2; b.kickId++;
    this.emit('deflect', { p });
  }

  /** A heavy first touch: the ball bounces off the foot and runs away from the receiver. */
  heavyTouch(p, hv) {
    const b = this.ball;
    const inc = norm(b.vx - p.vx, b.vy - p.vy);
    const f = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    const d = norm(inc.x * 0.6 + f.x * 0.4 + (Math.random() - 0.5) * 0.5, inc.y * 0.6 + f.y * 0.4 + (Math.random() - 0.5) * 0.5);
    const sp = heavyTouchSpeed(hv) + Math.hypot(p.vx, p.vy) * 0.5;
    b.vx = d.x * sp; b.vy = d.y * sp; b.vz = b.z > 0.3 ? 1.2 : 0.3; b.spin = 0;
    this.lastTouch = p; p.kickCD = 0.22; b.kickId++;
    this.emit('heavyTouch', { p, h: hv });
  }

  // ---------- restarts ----------
  onOut(out) {
    const lt = this.lastTouch ? this.lastTouch.team : 0;
    const r = restartFor(out, lt, (s) => this.defenderOfSide(s));
    if (r.type === 'corner') this.stats[r.team].corners++;
    const label = { throw: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK' }[r.type];
    this.banner(label, this.teams[r.team].name, '#ffffff', 1.4);
    if (this.shot && r.type !== 'throw') this.emit('miss');
    this.state = 'out'; this.stateT = 0; this.pendingRestart = r;
    this.owner = null; this.pass = null; this.shot = null; this.pendingSave = null;
    this.emit('whistle');
    this.emit('out', { restart: r });
  }

  onGoal(side) {
    const team = 1 - this.defenderOfSide(side);
    this.score[team]++;
    if (this.shot && !this.shot.counted && this.shot.team === team) { this.stats[team].onTarget++; this.shot.counted = true; }
    const scorer = this.lastTouch;
    const og = !!scorer && scorer.team !== team;
    const minute = Math.max(1, Math.ceil(this.clock / 60));
    this.goals.push({ team, name: scorer ? scorer.name : '', og, min: minute });
    this.banner('GOAL!', `${scorer ? scorer.name : ''}${og ? ' (OG)' : ''}  ${minute}'`, this.kits[team].shirt, 3.2);
    this.state = 'goal'; this.stateT = 0;
    this.pendingSave = null; this.owner = null; this.pass = null; this.shot = null;
    this.scoringTeam = team; this.stoppages++;
    this.celebrator = og ? null : scorer;
    this.emit('goal', { team, scorer, og });
  }

  updateGoal(dt) {
    const ev = [];
    stepBallWorld(this.ball, dt, ev);
    if (this.stateT < 0.9) this.replay.record(this);
    const side = this.attackSide(this.scoringTeam);
    const flag = { x: side === 1 ? PITCH.L - 1 : 1, y: this.celebrator && this.celebrator.y < CY ? 1 : PITCH.W - 1 };
    for (const p of this.players) {
      if (p.sentOff) continue;
      if (p === this.celebrator || (p.team === this.scoringTeam && this.celebrator && dist(p, this.celebrator) < 15 && p.role !== 'GK')) {
        const tgt = p === this.celebrator ? flag : this.celebrator;
        const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
        p.state = p.state === 'run' ? 'run' : p.state;
        p.want.x = d > 1.5 ? (dx / d) * 6.5 : 0; p.want.y = d > 1.5 ? (dy / d) * 6.5 : 0; p.sprint = true;
      } else { p.want.x *= 0.9; p.want.y *= 0.9; p.sprint = false; }
      stepPlayer(p, dt);
      p.stamina = Math.min(1, p.stamina + dt * 0.1);
    }
    if (this.stateT > 2.9 || (this.skipRequest && this.stateT > 1)) {
      if (this.noReplay || !this.replay.begin(2.8)) this.afterGoal();
      else { this.state = 'replay'; this.stateT = 0; this.emit('replayStart'); }
    }
  }

  updateReplay(dt) {
    this.replay.pos = Math.min(this.replay.frames - 1, this.replay.pos + dt * 60 * 0.7);   // ~4 s slow-motion replay
    this.replay.apply(this);
    if (this.replay.done || (this.skipRequest && this.stateT > 0.3)) { this.emit('replayEnd'); this.afterGoal(); }
  }

  afterGoal() {
    this.replay.clear();
    this.noReplay = false;
    if (this.checkHalfEnd()) return;
    this.setupKickoff(1 - this.scoringTeam);
  }

  /** Called by the scene when a penalty / direct free kick resolved in the first-person view. */
  resumeFromKick(res) {
    const r = this.sp || this.pendingRestart;
    const team = r.team, def = 1 - team;
    const side = this.attackSide(team);
    const gx = side === 1 ? PITCH.L : 0, inward = side === 1 ? -1 : 1;
    this.stats[team].shots++;
    this.sp = null; this.kickRequest = null;
    this.lastTouch = res.shooter || this.mates(team)[6] || this.mates(team)[0];
    for (const p of this.players) if (!p.sentOff) { p.state = 'run'; p.vx = p.vy = 0; }
    if (res.result === 'goal') {
      this.stats[team].onTarget++;
      placeBall(this.ball, gx - inward * 1.2, CY + (Math.random() - 0.5) * 4);
      this.noReplay = true;
      this.state = 'play';
      this.onGoal(side);
      return;
    }
    if (res.result === 'save') {
      this.stats[team].onTarget++;
      const gk = this.keeper(def);
      const sy = clamp(res.y != null ? res.y : CY, CY - GOAL.W / 2, CY + GOAL.W / 2);
      const out = savedKickRestart(!!res.caught && !!gk, sy, Math.random, CY);
      this.lastSavedRestart = out.type;
      if (out.type === 'catch') {
        gk.x = gx + inward * 1.5; gk.y = CY;
        placeBall(this.ball, gk.x, gk.y);
        this.state = 'play'; this.stateT = 0;
        this.setOwner(gk, true); gk.state = 'hold'; gk.holdT = 0;
        this.banner('SAVED!', `${gk.name} holds on`, '#8ecae6', 1.6);
        return;
      }
      if (out.type === 'corner' || !gk) {
        this.banner('SAVED!', `${gk ? gk.name : ''} turns it behind`, '#8ecae6', 1.6);
        this.stats[team].corners++;
        beginSetPiece(this, { type: 'corner', team, x: gx + inward * 0.4, y: out.upper ? 0.4 : PITCH.W - 0.4 });
        return;
      }
      // parried back into play: everyone was waiting on the edge of the box — scramble!
      this.arrangeRebound(team, gx, inward);
      gk.x = gx + inward * 0.9; gk.y = sy; gk.vx = gk.vy = 0;
      gk.state = 'down'; gk.stateT = 0; gk.stateDur = 0.7; gk.facing = inward > 0 ? 0 : Math.PI;
      placeBall(this.ball, gk.x + inward * 0.8, sy);
      const n = norm(inward * out.dist, out.dy);
      this.ball.vx = n.x * out.speed; this.ball.vy = n.y * out.speed; this.ball.vz = 1.5; this.ball.z = 0.4;
      this.ball.kickId++;
      this.lastTouch = gk; this.owner = null; this.pass = null; this.shot = null;
      this.state = 'play'; this.stateT = 0;
      this.banner('SAVED!', `${gk.name} parries — rebound!`, '#8ecae6', 1.6);
      return;
    }
    if (res.result === 'wall') {
      // loose ball bouncing back off the wall
      const bx = r.x + (gx - r.x) * 0.3, by = r.y + (CY - r.y) * 0.3;
      placeBall(this.ball, bx, by);
      this.ball.vx = (r.x - bx) * 0.5 + (Math.random() - 0.5) * 3; this.ball.vy = (r.y - by) * 0.5 + (Math.random() - 0.5) * 3;
      this.ball.kickId++;
      this.lastTouch = this.mates(def)[1] || this.lastTouch;
      this.state = 'play'; this.stateT = 0;
      this.banner('BLOCKED', 'Off the wall', '#ffffff', 1.4);
      return;
    }
    // miss / post: goal kick
    beginSetPiece(this, { type: 'goalkick', team: def, x: gx + inward * 5.5, y: CY + (Math.random() < 0.5 ? -4.5 : 4.5) });
  }

  /** Line both teams up around the edge of the box for a rebound (after a parried kick). */
  arrangeRebound(team, gx, inward) {
    const att = this.mates(team).filter((p) => p.role !== 'GK');
    const def = this.mates(1 - team).filter((p) => p.role !== 'GK');
    att.forEach((p, i) => {
      p.x = gx + inward * (13 + (i % 3) * 2.5); p.y = CY + (i - (att.length - 1) / 2) * 5.5;
      p.vx = p.vy = 0; p.state = 'run'; p.facing = inward > 0 ? Math.PI : 0;
    });
    def.forEach((p, i) => {
      const a = att[i % Math.max(1, att.length)];
      p.x = a ? a.x - inward * 1.6 : gx + inward * 10; p.y = a ? a.y + 0.8 : CY;
      p.vx = p.vy = 0; p.state = 'run'; p.facing = inward > 0 ? Math.PI : 0;
    });
  }

  // ---------- quick restarts ----------
  /** Did a human on the restarting team tap Pass to take a throw-in / free kick quickly? */
  quickRestartWanted(r) {
    if (!r || !(r.type === 'throw' || r.type === 'freekick')) return false;
    return this.humans.some((h) => h.team === r.team && this.ctrls[h.ctrl] && (this.ctrls[h.ctrl].wasPressed('pass') || (h.ctrl === 0 && this.mouseClick)));
  }

  // ---------- instant replay (pause menu) ----------
  canInstantReplay() { return ['play', 'out', 'foul', 'setpiece'].includes(this.state) && this.replay.len > 60 && !this.sp?.phase?.startsWith('kick') && this.sp?.phase !== 'waiting'; }

  startInstantReplay() {
    if (!this.canInstantReplay() || !this.replay.begin(8)) return false;
    const b = this.ball;
    this.irSnap = {
      state: this.state, stateT: this.stateT,
      ball: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, rot: b.rot, spin: b.spin, topspin: b.topspin },
      players: this.players.map((p) => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, anim: p.anim, state: p.state, stateT: p.stateT, sentOff: p.sentOff })),
    };
    this.state = 'ireplay'; this.stateT = 0;
    this.emit('replayStart');
    return true;
  }

  updateInstantReplay(dt) {
    this.replay.pos = Math.min(this.replay.frames - 1, this.replay.pos + dt * 60 * 0.75);
    this.replay.apply(this);
    if (this.replay.done || (this.skipRequest && this.stateT > 0.3)) this.endInstantReplay();
  }

  endInstantReplay() {
    const s = this.irSnap; if (!s) return;
    Object.assign(this.ball, s.ball);
    this.players.forEach((p, i) => Object.assign(p, s.players[i]));
    this.state = s.state; this.stateT = s.stateT;
    this.irSnap = null;
    this.emit('replayEnd');
  }
}
