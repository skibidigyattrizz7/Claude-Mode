// Pure simulation for dead-ball kicks seen in the first-person view (penalties and
// direct free kicks): keeper body model, defensive wall, shot error and outcome logic.
// Goal is always the one at x = L (side 1).
import { PITCH, CY, GOAL, BALL_R, PHYS, PEN_SPOT } from './constants.js';
import { makeBall, stepBallWorld, solveKick, simulatePath } from './physics.js';
import { goalScored, keeperMaySave } from './rules.js';
import { clamp, gauss, lerp } from './util.js';

const GX = PITCH.L;

/** Distance from point p to segment ab in 3D. */
function segDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

const ease = (p) => 1 - (1 - p) * (1 - p) * (1 - p);

/** Goalkeeper body model: standing pose or a dive towards a point on the goal plane. */
export class KeeperModel {
  constructor(y = CY, keeping = 0.7, x = GX - 0.35) {
    this.x = x; this.y0 = y; this.y = y; this.keeping = keeping;
    this.state = 'ready'; this.t = 0; this.p = 0; this.diveT = 0.5;
    this.ty = y; this.tz = 1; this.dir = 0; this.sway = 0; this.touched = false;
  }
  /** Commit a dive toward (ty,tz); reach is limited by the keeper's ability. */
  dive(ty, tz, duration) {
    if (this.state === 'dive') return;
    const maxReach = 2.7 + 0.9 * this.keeping;
    const dy = clamp(ty - this.y, -maxReach, maxReach);
    this.ty = this.y + dy;
    this.tz = clamp(tz, 0.15, 2.45 + 0.2 * this.keeping);
    this.dir = Math.sign(dy) || 0;
    this.diveT = duration || clamp(0.5 - 0.12 * this.keeping, 0.32, 0.55);
    this.state = 'dive'; this.t = 0; this.p = 0;
  }
  update(dt) {
    this.t += dt;
    if (this.state === 'dive') this.p = clamp(this.t / this.diveT, 0, 1);
    else this.sway = Math.sin(this.t * 3.2) * 0.12;
  }
  /** Hand point and feet point describing the body capsule. */
  pose() {
    const e = ease(this.p);
    const y = this.state === 'dive' ? this.y : this.y + this.sway;
    if (this.state !== 'dive' || Math.abs(this.ty - this.y) < 0.6) {
      // standing or a small step / jump in the middle
      const hz = lerp(1.9, Math.max(1.9, this.tz + 0.3), e);
      const hy = lerp(y, this.ty, e);
      return { feet: { x: this.x, y: hy, z: lerp(0.05, Math.max(0, this.tz - 1.6), e) }, hands: { x: this.x, y: hy, z: hz }, wide: 0.75 };
    }
    const hands = { x: this.x, y: lerp(y + this.dir * 0.5, this.ty, e), z: lerp(1.3, this.tz, e) };
    const feet = { x: this.x, y: lerp(y, y + (this.ty - y) * 0.25, e), z: lerp(0.05, Math.max(0.05, this.tz * 0.35), e) };
    return { feet, hands, wide: 0.3 };
  }
  /** Does the ball touch the keeper? */
  hit(b) {
    const { feet, hands, wide } = this.pose();
    const r = 0.26 + BALL_R;
    if (segDist(b, feet, hands) < r) return true;
    // arms spread when standing
    if (wide > 0.5) {
      const a = { x: this.x, y: hands.y - wide, z: 1.25 }, c = { x: this.x, y: hands.y + wide, z: 1.25 };
      if (segDist(b, a, c) < 0.14 + BALL_R) return true;
    }
    return Math.hypot(b.x - hands.x, b.y - hands.y, b.z - hands.z) < 0.24 + BALL_R;
  }
}

/** A player standing in a defensive wall (may jump when the kick is taken). */
export function makeWallPlayer(x, y, rng = Math.random) {
  return { x, y, jump: 0, willJump: rng() < 0.85, delay: 0.02 + rng() * 0.16, t: 0, active: false };
}

export function updateWall(w, dt) {
  if (!w.active) return;
  w.t += dt;
  const tt = w.t - w.delay;
  w.jump = w.willJump && tt > 0 && tt < 0.55 ? Math.sin((tt / 0.55) * Math.PI) * 0.5 : 0;
}

export function wallHit(w, b) {
  const top = w.jump + 1.85 + (w.jump > 0.05 ? 0.2 : 0);
  if (b.z < w.jump - BALL_R || b.z > top + BALL_R) return false;
  return Math.hypot(b.x - w.x, b.y - w.y) < 0.27 + BALL_R;
}

/** Build a wall for a free kick at ball position: count players 9.15m away covering the near post. */
export function buildWall(ball, n, rng = Math.random) {
  const nearPostY = ball.y < CY ? CY - GOAL.W / 2 + 0.6 : CY + GOAL.W / 2 - 0.6;
  const aimY = lerp(nearPostY, CY, 0.25);
  const dx = GX - ball.x, dy = aimY - ball.y;
  const L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;
  const cx = ball.x + ux * 9.15, cy = ball.y + uy * 9.15;
  const px = -uy, py = ux;
  const out = [];
  // wall extends from the line to the near post side outward
  const s = ball.y < CY ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 0.58 + s * 0.3;
    out.push(makeWallPlayer(cx + px * off, cy + py * off, rng));
  }
  return out;
}

/** Horizontal kick speed from a 0..1 power value. */
export const penaltySpeed = (power) => 14 + clamp(power, 0, 1) * 17;
export const freeKickSpeed = (power) => 15 + clamp(power, 0, 1) * 18;

/**
 * Apply human-style error to an intended target on the goal plane.
 * Too much power drives the ball high (can clear the bar); aim near posts can go wide.
 */
export function kickError(target, power, skill, rng = Math.random, extra = 1) {
  const over = Math.max(0, power - 0.82);
  const sdY = (0.14 + (1 - skill) * 0.3 + over * 1.3) * extra;
  const sdZ = (0.1 + (1 - skill) * 0.12 + over * 1.2) * extra;
  return {
    y: target.y + gauss(rng) * sdY,
    z: Math.max(0.05, target.z + gauss(rng) * sdZ + over * rng() * 3.2),
  };
}

/** AI penalty taker picks a spot with randomness (mostly corners, sometimes centre). */
export function aiPenaltyChoice(rng = Math.random) {
  const r = rng();
  let y, z;
  if (r < 0.1) { y = CY + gauss(rng) * 0.5; z = 0.3 + rng() * 1.4; }
  else {
    const side = rng() < 0.5 ? -1 : 1;
    y = CY + side * (1.7 + rng() * 1.85);
    z = rng() < 0.6 ? 0.15 + rng() * 0.6 : 0.8 + rng() * 1.2;
  }
  const power = 0.55 + rng() * 0.37;
  return { y, z, power };
}

/** AI keeper guess for a penalty. `read` chance grows with keeping and weak kicks. */
export function keeperPenaltyGuess(rng, keeping, actual, power) {
  const read = rng() < 0.1 + 0.12 * keeping - 0.1 * Math.max(0, power - 0.6);
  if (read && actual) return { y: actual.y + gauss(rng) * 0.45, z: actual.z + gauss(rng) * 0.3 };
  const r = rng();
  if (r < 0.12) return { y: CY, z: 1.0 + rng() * 0.6 };
  const side = r < 0.56 ? -1 : 1;
  return { y: CY + side * (1.5 + rng() * 2.0), z: 0.3 + rng() * 1.5 };
}

/** Kick state for simulation (used by the scene and the unit test). */
export function makeKickState(ballPos, keeper, walls = []) {
  const ball = makeBall(ballPos.x, ballPos.y);
  ball.z = BALL_R;
  return { ball, keeper, walls, t: 0, result: null, pending: null, events: [], done: false, touchedWall: false, post: false, startX: ballPos.x };
}

export function launch(state, target, hs, opts = {}) {
  const v = solveKick(state.ball, { x: GX, y: target.y, z: target.z }, hs, opts);
  Object.assign(state.ball, { vx: v.vx, vy: v.vy, vz: v.vz, spin: opts.spin || 0, topspin: opts.topspin || 0, knuckle: opts.knuckle || 0, kPhase: Math.random() * 6 });
  for (const w of state.walls) w.active = true;
  return v;
}

/** Advance the kick. Goal check ALWAYS precedes any keeper contact. */
export function stepKick(s, dt) {
  if (s.done) return;
  const sub = 4, h = dt / sub;
  for (let i = 0; i < sub && !s.done; i++) {
    s.t += h;
    s.keeper && s.keeper.update(h);
    for (const w of s.walls) updateWall(w, h);
    const ev = [];
    stepBallWorld(s.ball, h, ev);
    for (const e of ev) { s.events.push(e); if (e === 'post' || e === 'bar') s.post = true; }
    const b = s.ball;
    // 1) authoritative goal-line decision
    if (goalScored(b) === 1) { s.result = 'goal'; s.done = true; break; }
    // 2) keeper — only while the ball has not crossed the line
    if (s.keeper && !s.keeper.touched && keeperMaySave(b, 1) && s.keeper.hit(b)) {
      s.keeper.touched = true;
      s.pending = 'save';
      s.events.push('save');
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      const side = Math.sign(b.y - s.keeper.y) || (Math.random() < 0.5 ? -1 : 1);
      b.vx = -Math.abs(b.vx) * 0.25 - 1; b.vy = side * (2 + sp * 0.15); b.vz = 2 + Math.random() * 2;
      b.spin = 0; b.knuckle = 0;
    }
    // 3) wall
    for (const w of s.walls) {
      if (!s.touchedWall && wallHit(w, b)) {
        s.touchedWall = true; s.pending = s.pending || 'wall'; s.events.push('wall');
        b.vx = -b.vx * 0.3; b.vy = b.vy * 0.4 + (Math.random() - 0.5) * 4; b.vz = Math.abs(b.vz) * 0.4 + 1.5;
        b.spin = 0; b.knuckle = 0;
      }
    }
    // 4) out of play / finished
    if (b.x > GX + BALL_R || b.y < -1 || b.y > PITCH.W + 1) {
      s.result = s.pending || (s.post ? 'post' : 'miss'); s.done = true; break;
    }
    if (s.t > 3.2 || (Math.hypot(b.vx, b.vy) < 0.4 && b.z <= 0.01 && s.t > 0.4) || (b.x < s.startX - 1 && s.t > 0.3)) {
      s.result = s.pending || (s.post ? 'post' : 'miss'); s.done = true; break;
    }
  }
}

/**
 * AI keeper read of a direct free kick. The keeper only picks the flight up once the ball
 * has cleared the wall, misjudges curl / dip / knuckle a little, and needs time to dive,
 * so a well struck kick into the corner can beat him.
 * Returns {at, y, z, dur}: when (s after the kick) and where to dive.
 */
export function aiFreeKickDive(ball, keeper, hasWall, rng = Math.random) {
  const path = simulatePath({ ...ball, knuckle: 0 }, 2.5, (bb) => bb.x >= keeper.x, 1);
  const P = path[path.length - 1] || { y: CY, z: 1 };
  const kp = keeper.keeping;
  const trick = 1 + Math.abs(ball.spin || 0) * 0.35 + (ball.topspin ? 0.3 : 0) + (ball.knuckle ? 1.2 : 0);
  const mis = (0.22 + 0.5 * (1 - kp)) * trick;
  const y = P.y + gauss(rng) * mis, z = P.z + gauss(rng) * mis * 0.6;
  const at = 0.36 + (hasWall ? 0.2 : 0) - 0.14 * kp + rng() * 0.12;
  const dur = clamp(0.3 + Math.abs(y - keeper.y) * 0.1, 0.32, 0.7) / (0.85 + 0.3 * kp);
  return { at, y, z, dur };
}

/** Full AI-vs-AI penalty used to validate conversion rates. */
export function penaltyOutcomeSim(rng, shooterSkill = 0.75, keeping = 0.7) {
  const c = aiPenaltyChoice(rng);
  const t = kickError({ y: c.y, z: c.z }, c.power, shooterSkill, rng);
  const keeper = new KeeperModel(CY, keeping);
  const s = makeKickState({ x: GX - PEN_SPOT, y: CY }, keeper);
  s.startX = s.ball.x;
  launch(s, t, penaltySpeed(c.power));
  const g = keeperPenaltyGuess(rng, keeping, t, c.power);
  let dived = false;
  for (let i = 0; i < 600 && !s.done; i++) {
    if (!dived && s.t > 0.04) { keeper.dive(g.y, g.z); dived = true; }
    stepKick(s, PHYS.DT);
  }
  return s.result || 'miss';
}

/** Predicted (ideal) path for drawing the trajectory arc. */
export function predictKick(ballPos, target, hs, opts = {}) {
  const b = makeBall(ballPos.x, ballPos.y);
  b.z = BALL_R;
  const v = solveKick(b, { x: GX, y: target.y, z: target.z }, hs, opts);
  Object.assign(b, { vx: v.vx, vy: v.vy, vz: v.vz, spin: opts.spin || 0, topspin: opts.topspin || 0 });
  return simulatePath(b, 2.5, (bb) => bb.x >= GX, 3);
}
