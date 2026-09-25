// Ball rigid-body physics: gravity, quadratic drag, Magnus lift from spin, bounce with
// restitution on grass, rolling resistance, posts/crossbar/net collisions. DOM-free.
import { BALL_R, GOAL, PITCH, G } from './constants.js';

export const PHYS = {
  drag: 0.0125,        // quadratic drag coefficient (1/m): a = -k|v|v
  magnus: 0.0042,      // Magnus coefficient: a = k (w x v)
  spinDecay: 0.35,     // 1/s in air
  restHi: 0.62,        // restitution for hard impacts on grass
  restLo: 0.42,        // restitution for soft impacts
  bounceGrip: 0.8,     // horizontal speed kept on a bounce
  roll0: 1.1,          // rolling resistance, constant part (m/s^2)
  roll1: 0.32,         // rolling resistance, linear part (1/s)
  postE: 0.7,          // woodwork restitution
  netE: 0.12,          // net restitution (very soft)
};

export function createBall() {
  return { p: { x: 0, y: BALL_R, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } };
}

export function cloneBallState(b) {
  return { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } };
}

// Magnus acceleration for velocity v and spin w (both {x,y,z}).
export function magnusAccel(v, w, out = { x: 0, y: 0, z: 0 }) {
  const k = PHYS.magnus;
  out.x = k * (w.y * v.z - w.z * v.y);
  out.y = k * (w.z * v.x - w.x * v.z);
  out.z = k * (w.x * v.y - w.y * v.x);
  return out;
}

const _m = { x: 0, y: 0, z: 0 };

// Advance the ball by dt. `ev` (optional array) receives {k:'bounce'|'post'|'net', ...} events.
export function stepBall(b, dt, ev) {
  const v = b.v;
  const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const n = Math.max(1, Math.ceil((sp * dt) / 0.07));
  const h = dt / n;
  for (let i = 0; i < n; i++) subStep(b, h, ev);
  if (!Number.isFinite(b.p.x + b.p.y + b.p.z + b.v.x + b.v.y + b.v.z)) {
    b.p.x = 0; b.p.y = BALL_R; b.p.z = 0; b.v.x = b.v.y = b.v.z = 0; b.w.x = b.w.y = b.w.z = 0;
  }
}

function subStep(b, dt, ev) {
  const p = b.p, v = b.v, w = b.w;
  const px = p.x, py = p.y, pz = p.z;
  const grounded = p.y <= BALL_R + 1e-4 && Math.abs(v.y) < 0.35;
  if (grounded) {
    p.y = BALL_R; v.y = 0;
    const s = Math.sqrt(v.x * v.x + v.z * v.z);
    if (s > 0) {
      const ns = Math.max(0, s - (PHYS.roll0 + PHYS.roll1 * s) * dt);
      v.x *= ns / s; v.z *= ns / s;
    }
    // rolling without slipping
    w.x = v.z / BALL_R; w.z = -v.x / BALL_R; w.y *= Math.exp(-4 * dt);
    p.x += v.x * dt; p.z += v.z * dt;
  } else {
    const s = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    magnusAccel(v, w, _m);
    const k = PHYS.drag * s;
    v.x += (-k * v.x + _m.x) * dt;
    v.y += (-G - k * v.y + _m.y) * dt;
    v.z += (-k * v.z + _m.z) * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    const d = Math.exp(-PHYS.spinDecay * dt);
    w.x *= d; w.y *= d; w.z *= d;
    if (p.y < BALL_R) {
      p.y = BALL_R;
      if (v.y < 0) {
        const vin = -v.y;
        const e = vin > 6 ? PHYS.restHi : PHYS.restLo + (PHYS.restHi - PHYS.restLo) * (vin / 6);
        v.y = vin > 0.9 ? vin * e : 0;
        // grass grip: blend toward rolling speed implied by spin
        const rx = -w.z * BALL_R, rz = w.x * BALL_R;
        v.x = v.x * PHYS.bounceGrip + (rx - v.x) * 0.08;
        v.z = v.z * PHYS.bounceGrip + (rz - v.z) * 0.08;
        w.y *= 0.6;
        if (ev && vin > 1.5) ev.push({ k: 'bounce', s: vin });
      }
    }
  }
  collideGoals(b, px, py, pz, ev);
}

// ---------- goal frame collisions ----------
function collideSeg(b, ax, ay, az, bx, by, bz, rad, ev) {
  const p = b.p, v = b.v;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = ((p.x - ax) * dx + (p.y - ay) * dy + (p.z - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
  let nx = p.x - cx, ny = p.y - cy, nz = p.z - cz;
  const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const minD = rad + BALL_R;
  if (d >= minD || d < 1e-6) return false;
  nx /= d; ny /= d; nz /= d;
  p.x = cx + nx * minD; p.y = cy + ny * minD; p.z = cz + nz * minD;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    const j = -(1 + PHYS.postE) * vn;
    v.x += j * nx; v.y += j * ny; v.z += j * nz;
    // tangential friction
    v.x *= 0.92; v.y *= 0.92; v.z *= 0.92;
    b.w.x *= 0.5; b.w.y *= 0.5; b.w.z *= 0.5;
    if (ev && -vn > 2) ev.push({ k: 'post', s: -vn, x: p.x, y: p.y, z: p.z });
  }
  return true;
}

function netHit(b, ev, s) {
  if (ev && s > 1.5) ev.push({ k: 'net', s, x: b.p.x, y: b.p.y, z: b.p.z });
}

function collideGoals(b, px, py, pz, ev) {
  const p = b.p;
  if (Math.abs(p.x) < PITCH.HL - 1.0) return;
  const s = p.x > 0 ? 1 : -1;
  const R = GOAL.POST_R;
  const gx = s * (PITCH.HL + R);
  const zp = GOAL.HW + R;
  const top = GOAL.H + R;
  // posts and crossbar
  collideSeg(b, gx, 0, -zp, gx, top, -zp, R, ev);
  collideSeg(b, gx, 0, zp, gx, top, zp, R, ev);
  collideSeg(b, gx, top, -zp, gx, top, zp, R, ev);
  // net volume (a box behind the goal line). u = distance behind line.
  const u = s * p.x - PITCH.HL;
  const pu = s * px - PITCH.HL;
  const v = b.v;
  const D = GOAL.DEPTH, W = GOAL.HW + 2 * R, H = GOAL.H + R;
  const inside = (uu, zz, yy) => uu > 0 && uu < D && Math.abs(zz) < W && yy < H;
  if (inside(pu, pz, py) || (pu <= 0 && u > 0 && Math.abs(p.z) < W && p.y < H)) {
    // ball is (or just entered) inside the goal: keep it within net walls
    let hit = 0;
    if (u > D - BALL_R) {
      p.x = s * (PITCH.HL + D - BALL_R); hit = Math.abs(v.x);
      if (s * v.x > 0) v.x = -v.x * PHYS.netE;
      v.y *= 0.5; v.z *= 0.5;
    }
    if (u > 0 && Math.abs(p.z) > W - BALL_R) {
      const sz = Math.sign(p.z);
      p.z = sz * (W - BALL_R); hit = Math.max(hit, Math.abs(v.z));
      if (sz * v.z > 0) v.z = -v.z * PHYS.netE;
      v.x *= 0.6; v.y *= 0.6;
    }
    if (u > 0 && p.y > H - BALL_R) {
      p.y = H - BALL_R; hit = Math.max(hit, Math.abs(v.y));
      if (v.y > 0) v.y = -v.y * PHYS.netE;
      v.x *= 0.6; v.z *= 0.6;
    }
    if (hit) netHit(b, ev, hit);
    return;
  }
  // outside the goal: side netting / roof / back from the outside
  if (u > -BALL_R && u < D + BALL_R && p.y < H + BALL_R) {
    const az = Math.abs(p.z), apz = Math.abs(pz);
    if (apz >= W + BALL_R - 1e-6 && az < W + BALL_R && u > 0) {
      const sz = Math.sign(p.z);
      p.z = sz * (W + BALL_R);
      const hit = Math.abs(v.z);
      if (sz * v.z < 0) v.z = -v.z * PHYS.netE;
      v.x *= 0.6; netHit(b, ev, hit);
    } else if (py >= H + BALL_R - 1e-6 && p.y < H + BALL_R && az < W && u > 0) {
      p.y = H + BALL_R;
      if (v.y < 0) { netHit(b, ev, -v.y); v.y = -v.y * 0.25; }
      v.x *= 0.85; v.z *= 0.85;
    } else if (pu >= D + BALL_R - 1e-6 && u < D + BALL_R && az < W && p.y < H) {
      p.x = s * (PITCH.HL + D + BALL_R);
      if (s * v.x < 0) { netHit(b, ev, Math.abs(v.x)); v.x = -v.x * PHYS.netE; }
    }
  }
}

// ---------- goal-line logic ----------
// Distance of the ball centre behind the goal line at end `side` (+1 or -1). >0 = behind the line.
export function behindLine(p, side) {
  return side * p.x - PITCH.HL;
}
// The whole ball has crossed the goal line at `side` (centre is more than one radius beyond).
export function wholeBallOver(p, side) {
  return behindLine(p, side) > BALL_R;
}
// Between the posts and under the bar (evaluated on the ball centre; frame collisions
// guarantee a ball whose centre is inside this window cannot overlap the woodwork).
export function inGoalMouth(p) {
  return Math.abs(p.z) < GOAL.HW && p.y < GOAL.H;
}
// Classify where the ball is relative to the field of play.
// returns null (in play) | {type:'goal', side} | {type:'byline', side} | {type:'touch', side}
export function classifyBall(p) {
  for (const side of [1, -1]) {
    if (wholeBallOver(p, side)) {
      return inGoalMouth(p) ? { type: 'goal', side } : { type: 'byline', side };
    }
  }
  if (Math.abs(p.z) > PITCH.HW + BALL_R) return { type: 'touch', side: Math.sign(p.z) };
  return null;
}
// A keeper may only save a ball that has not yet wholly crossed his goal line.
export function keeperCanSave(p, goalSide) {
  return !wholeBallOver(p, goalSide);
}

// Predict the ball trajectory (ignoring players). Returns array of {t,x,y,z,vx,vz,speed}.
export function predictBall(b, horizon = 3, sampleDt = 0.05, stepDt = 1 / 120) {
  const s = cloneBallState(b);
  const out = [];
  let t = 0, acc = 0;
  out.push({ t: 0, x: s.p.x, y: s.p.y, z: s.p.z, vx: s.v.x, vz: s.v.z });
  while (t < horizon) {
    stepBall(s, stepDt);
    t += stepDt; acc += stepDt;
    if (acc >= sampleDt - 1e-9) {
      acc = 0;
      out.push({ t, x: s.p.x, y: s.p.y, z: s.p.z, vx: s.v.x, vz: s.v.z });
      if (Math.abs(s.p.x) > PITCH.HL + 3 || Math.abs(s.p.z) > PITCH.HW + 3) break;
      if (s.p.y <= BALL_R + 1e-3 && s.v.x * s.v.x + s.v.z * s.v.z < 0.01) break;
    }
  }
  return out;
}
