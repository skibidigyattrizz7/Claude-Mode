// Match engine: state machine (kickoff/play/goal/replay/set pieces/half-time/full-time),
// possession, human control, kicking, tackles and fouls, keeper saves, stats and replay.
import { PITCH, CX, CY, GOAL, PEN_SPOT, CIRCLE_R, BALL_R, DIFFICULTY } from './constants.js';
import { FORMATION, chooseKits } from './data.js';
import { makeBall, placeBall, stepBallWorld, simulatePath } from './physics.js';
import { goalScored, keeperMaySave, outOfPlay, restartFor, judgeTackle, isFromBehind, inPenaltyArea, applyCard, tackleSweep } from './rules.js';
import { choosePassTarget, passVelocity, leadTarget, clampToPitch } from './passing.js';
import { planShot, shotVelocity } from './shooting.js';
import { makePlayer, stepPlayer, topSpeed, startSkill, isEvading, SKILL_NAMES } from './player.js';
import { TeamAI } from './ai.js';
import { beginSetPiece, updateSetPiece } from './setpieces.js';
import { clamp, dist, norm, gauss, angDiff } from './util.js';

const HUMAN_PROF = { react: 0.3, acc: 0.85, speed: 1, keeper: 1, press: 0.9, careful: 0.9 };
export const STATE_CODES = ['run', 'tackle', 'slide', 'down', 'dive', 'hold', 'skill', 'celebrate'];

const mkStats = () => ({ poss: 0, shots: 0, onTarget: 0, passAtt: 0, passCmp: 0, fouls: 0, corners: 0, yellows: 0, reds: 0 });

/** Ring buffer of the last few seconds (ball + players) for goal replays. */
class Replay {
  constructor(n) {
    this.n = n; this.stride = 4 + n * 5; this.cap = 330;
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
        if (this.stateT > 1.3) beginSetPiece(this, this.pendingRestart);
        break;
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
    this.updateHumans(dt);
    for (let t = 0; t < 2; t++) {
      if (this.passive[t]) this.passiveTeam(t);
      else this.ai[t].update(dt);
    }
    for (const p of this.players) stepPlayer(p, dt);
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
          const push = (0.7 - d) / 2, nx = dx / d, ny = dy / d;
          if (a.state !== 'slide' && a.state !== 'dive') { a.x -= nx * push; a.y -= ny * push; }
          if (b.state !== 'slide' && b.state !== 'dive') { b.x += nx * push; b.y += ny * push; }
        }
      }
    }
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

  switchPlayer(h, auto) {
    const others = new Set(this.humans.filter((o) => o !== h).map((o) => o.player));
    const b = this.ball;
    const cands = this.mates(h.team).filter((p) => p.role !== 'GK' && !others.has(p))
      .sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y));
    if (!cands.length) return;
    let p = cands[0];
    if (!auto && p === h.player && cands[1]) p = cands[1];
    if (p !== h.player) { this.setHumanPlayer(h, p); this.emit('switch', { p }); }
  }

  aimDirFor(h, p, mv) {
    const aw = this.aimWorld[h.ctrl];
    if (aw) { const d = norm(aw.x - p.x, aw.y - p.y); if (d.x || d.y) return d; }
    if (Math.hypot(mv.x, mv.y) > 0.2) return norm(mv.x, mv.y);
    return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  }

  updateHumans(dt) {
    for (const h of this.humans) {
      if (!h.player || h.player.sentOff) this.switchPlayer(h, true);
      const p = h.player; if (!p) continue;
      const c = this.ctrls[h.ctrl]; if (!c) continue;
      const pressed = (a) => c.wasPressed(a) || (a === 'pass' && h.ctrl === 0 && this.mouseClick);
      const mv = c.move();
      const mag = Math.hypot(mv.x, mv.y);
      const sprint = c.isHeld('sprint');
      const aim = this.aimDirFor(h, p, mv);
      p.aimDir = aim;
      if (pressed('switch')) { this.switchPlayer(h, false); continue; }

      // movement (with receiver assist when the player isn't steering)
      let assisted = false;
      if (this.pass && this.pass.receiver === p && !this.owner) {
        // receiver assist: run onto the ball unless the player clearly steers somewhere else
        const ip = this.ai[p.team].interceptPoint(p);
        const dx = ip.x - p.x, dy = ip.y - p.y, d = Math.hypot(dx, dy);
        const agrees = mag < 0.15 || d < 0.3 || (mv.x * dx + mv.y * dy) / (mag * d) > 0.35;
        if (agrees) {
          assisted = true;
          const sp = Math.min(topSpeed(p, d > 5 || sprint), d * 2.5);
          p.want.x = d > 0.2 ? (dx / d) * sp : 0; p.want.y = d > 0.2 ? (dy / d) * sp : 0; p.sprint = d > 5 || (sprint && d > 1);
        }
      }
      if (!assisted) {
        const sp = topSpeed(p, sprint);
        p.want.x = mv.x * sp; p.want.y = mv.y * sp; p.sprint = sprint && mag > 0.2;
      }
      if (mag < 0.1) p.faceWant = this.owner === p ? Math.atan2(aim.y, aim.x) : Math.atan2(this.ball.y - p.y, this.ball.x - p.x);

      // shot charging (also used for first-time volleys when not on the ball)
      if (c.isHeld('shoot')) {
        if (!p.charging) { p.charging = true; p.charge = 0; p.shotMod = null; }
        p.charge = Math.min(1, p.charge + dt / 1.05);
        if (pressed('lob')) p.shotMod = 'chip';
        if (pressed('through')) p.shotMod = 'finesse';
      }
      if (this.owner === p) {
        if (!c.isHeld('shoot') && p.charging) {
          const type = p.shotMod || (p.charge >= 0.9 ? 'power' : 'driven');
          this.doShot(p, { aimDir: aim, power: p.charge, type, mode: this.settings.assist, sprinting: p.sprint });
          p.charging = false;
        } else if (!p.charging) {
          if (pressed('pass')) this.doPass(p, 'ground', null, aim);
          else if (pressed('through')) this.doPass(p, 'through', null, aim);
          else if (pressed('lob')) this.doPass(p, 'lob', null, aim);
          else if (pressed('skill')) this.startSkillMove(p, mv.x, mv.y, sprint);
        }
      } else {
        if (!c.isHeld('shoot')) p.charging = false;
        if (pressed('tackle')) this.startTackle(p, 'stand', null);
        else if (pressed('slide')) this.startTackle(p, 'slide', null);
      }

      // auto-switch while defending when someone else is much closer
      const own = this.owner;
      if ((!own || own.team !== h.team) && this.time - h.lastSwitch > 1.1 && !(this.pass && this.pass.team === h.team)) {
        const b = this.ball;
        const others = new Set(this.humans.filter((o) => o !== h).map((o) => o.player));
        let best = null, bd = 1e9;
        for (const q of this.mates(h.team)) {
          if (q.role === 'GK' || others.has(q)) continue;
          const d = Math.hypot(q.x - b.x, q.y - b.y);
          if (d < bd) { bd = d; best = q; }
        }
        const cur = Math.hypot(p.x - b.x, p.y - b.y);
        if (best && best !== p && cur > bd + 7 && mag < 0.9) this.setHumanPlayer(h, best);
      }
    }
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

  doPass(p, kind, mate, aimDir) {
    if (this.owner !== p && !(this.sp && this.sp.taker === p)) return;
    const b = this.ball;
    const from = { x: b.x, y: b.y };
    const dir = this.attackDir(p.team);
    let sel = null;
    if (mate) { const lt = leadTarget(from, mate, kind, dir); sel = { mate, target: lt.target }; }
    else sel = choosePassTarget(p, this.mates(p.team), this.opps(p.team), aimDir, kind, dir);
    let target, receiver = null, arrive = null;
    if (sel) { target = sel.target; receiver = sel.mate; }
    else {
      const L = kind === 'lob' ? 24 : kind === 'through' ? 18 : 13;
      target = clampToPitch({ x: from.x + aimDir.x * L, y: from.y + aimDir.y * L }, 1.5, 1.5);
      arrive = kind === 'lob' ? null : 1.8;
    }
    const v = passVelocity(from, target, kind, arrive);
    const human = p.human >= 0;
    const acc = human ? 0.55 : 1.5 - this.prof[p.team].acc;
    const err = gauss() * 0.028 * (1.3 - p.attrs.passing) * acc;
    const c = Math.cos(err), s = Math.sin(err);
    const sm = 1 + gauss() * 0.02 * acc;
    this.kick(p, (v.vx * c - v.vy * s) * sm, (v.vx * s + v.vy * c) * sm, v.vz * sm, 0, 0, kind === 'lob' ? 0.6 : 0.4);
    this.pass = { from: p, receiver, target, team: p.team, kind, t: this.time, eta: v.t };
    this.stats[p.team].passAtt++;
    if (receiver) {
      receiver.ai.decT = 0.2;
      const h = this.humanFor(p);
      if (h) this.setHumanPlayer(h, receiver);   // control follows the ball
    }
    this.emit('pass', { kind, p, receiver });
  }

  doShot(p, o) {
    const side = this.attackSide(p.team);
    const b = this.ball;
    const from = { x: b.x, y: b.y };
    let near = 99;
    for (const q of this.opps(p.team)) near = Math.min(near, dist(q, p));
    const pressure = clamp(1 - (near - 0.8) / 3, 0, 1);
    const plan = planShot({ from, aimDir: o.aimDir, goalSide: side, mode: o.mode, power: o.power, type: o.type,
      shooting: p.attrs.shooting, sprinting: o.sprinting, pressure, errMul: o.errMul || 1 });
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
    p.tk = { type, dir, first: null, body: false, near: null, victim, evaded: false, judged: false, tripped: false, speed0: Math.hypot(p.vx, p.vy) };
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
        if (slide) {
          this.owner = null; this.pass = null;
          const a = tk.dir + (Math.random() - 0.5) * 0.8;
          b.vx = Math.cos(a) * (5 + Math.random() * 3); b.vy = Math.sin(a) * (5 + Math.random() * 3); b.vz = 0.5;
          this.lastTouch = p; b.kickId++;
        } else if (victim && victim !== p) {
          if (Math.random() < 0.6 + 0.35 * (p.attrs.tackling - victim.attrs.dribbling)) this.setOwner(p);
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
      if (isGK) reach = b.z < 2.4 ? (p.state === 'dive' ? 1.1 : 0.9) : 0;
      else reach = b.z < 0.6 ? (this.pass && this.pass.receiver === p ? 0.8 : 0.58) : b.z < 1.6 ? 0.5 : b.z < 2.3 ? 0.48 : 0;
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
      this.doShot(p, { aimDir: aim, power: human ? Math.max(0.35, p.charge) : 0.7, type, mode: human ? this.settings.assist : 'Manual', sprinting: false, errMul: human ? 1.1 : 1.3 });
      return;
    }
    if (b.z > 1.5) {
      // cushioned header / chest down to feet
      b.vx = p.vx * 0.5 + Math.cos(p.facing) * 1.5; b.vy = p.vy * 0.5 + Math.sin(p.facing) * 1.5; b.vz = Math.min(0, b.vz) * 0.2;
      this.lastTouch = p; p.kickCD = 0.12; b.kickId++;
      this.emit('header', { p });
      return;
    }
    const trapLimit = 15 + 6 * p.attrs.dribbling;
    if (relSpeed < trapLimit) { this.setOwner(p); return; }
    // too hot to handle: deflection off the body
    const n = norm(b.x - p.x, b.y - p.y);
    const vn = b.vx * n.x + b.vy * n.y;
    if (vn < 0) { b.vx -= 1.4 * vn * n.x; b.vy -= 1.4 * vn * n.y; }
    b.vx *= 0.5; b.vy *= 0.5; b.vz = Math.abs(b.vz) * 0.4 + 0.5;
    this.lastTouch = p; p.kickCD = 0.2; b.kickId++;
    this.emit('deflect', { p });
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
      if (res.caught && gk) {
        gk.x = gx + inward * 1.5; gk.y = CY;
        placeBall(this.ball, gk.x, gk.y);
        this.state = 'play'; this.stateT = 0;
        this.setOwner(gk, true); gk.state = 'hold'; gk.holdT = 0;
        this.banner('SAVED!', gk.name, '#8ecae6', 1.6);
        return;
      }
      this.banner('SAVED!', gk ? gk.name : '', '#8ecae6', 1.6);
      this.stats[team].corners++;
      beginSetPiece(this, { type: 'corner', team, x: gx + inward * 0.4, y: res.y != null && res.y < CY ? 0.4 : PITCH.W - 0.4 });
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
}
