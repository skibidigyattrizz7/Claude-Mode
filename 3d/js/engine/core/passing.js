// Pass / shot kinematics helpers: rolling-ball travel times, receiver lead, lofted pass and
// shot solvers (numerical, using the real ball physics). DOM-free.
import { PHYS, stepBall, cloneBallState, createBall } from './physics.js';
import { BALL_R } from './constants.js';

const A = () => PHYS.roll0, B = () => PHYS.roll1;

// speed after rolling time t from speed v0 (dv/dt = -(a + b v))
export function rollSpeedAt(v0, t) {
  const a = A(), b = B(), c = a / b;
  return Math.max(0, (v0 + c) * Math.exp(-b * t) - c);
}
export function rollStopTime(v0) {
  const a = A(), b = B(), c = a / b;
  return Math.log((v0 + c) / c) / b;
}
export function rollDistAt(v0, t) {
  const a = A(), b = B(), c = a / b;
  t = Math.min(t, rollStopTime(v0));
  return ((v0 + c) * (1 - Math.exp(-b * t))) / b - c * t;
}
export function rollMaxDist(v0) { return rollDistAt(v0, rollStopTime(v0)); }
// time for a ground ball launched at v0 to travel d metres (Infinity if it stops short)
export function rollTimeTo(v0, d) {
  if (rollMaxDist(v0) < d) return Infinity;
  let lo = 0, hi = rollStopTime(v0);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (rollDistAt(v0, m) < d) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
// launch speed such that a rolling ball arrives at distance d with speed `arrive`
export function rollSpeedFor(d, arrive = 4) {
  const a = A(), b = B(), c = a / b;
  // closed form: d = (v0 - va)/b - c * ln((v0+c)/(va+c))/b  -> bisection on v0
  let lo = arrive, hi = 80;
  for (let i = 0; i < 50; i++) {
    const v0 = (lo + hi) / 2;
    const t = Math.log((v0 + c) / (arrive + c)) / b;
    const x = (v0 - arrive) / b - c * t;
    if (x < d) lo = v0; else hi = v0;
  }
  return (lo + hi) / 2;
}

/**
 * Lead a moving receiver with a ground pass.
 * from {x,z}, recv {x,z}, vel {x,z} (receiver velocity), arrive speed, maxSpeed.
 * Returns {x, z, speed, t} – the point where ball and receiver meet.
 */
export function leadPass(from, recv, vel, arrive = 5, maxSpeed = 26) {
  let tx = recv.x, tz = recv.z, speed = 10, t = 0;
  for (let i = 0; i < 6; i++) {
    const d = Math.hypot(tx - from.x, tz - from.z);
    speed = Math.min(maxSpeed, rollSpeedFor(d, arrive));
    t = rollTimeTo(speed, d);
    if (!Number.isFinite(t)) t = rollStopTime(speed);
    tx = recv.x + vel.x * t;
    tz = recv.z + vel.z * t;
  }
  return { x: tx, z: tz, speed, t };
}

// Simulate a free ball until first bounce (or until time limit) and return landing info.
function flight(from, vel, spin, maxT = 6) {
  const b = createBall();
  b.p.x = from.x; b.p.y = from.y ?? BALL_R; b.p.z = from.z;
  b.v.x = vel.x; b.v.y = vel.y; b.v.z = vel.z;
  if (spin) { b.w.x = spin.x; b.w.y = spin.y; b.w.z = spin.z; }
  const dt = 1 / 120;
  let t = 0, maxY = 0;
  while (t < maxT) {
    const vy0 = b.v.y;
    stepBall(b, dt);
    t += dt;
    maxY = Math.max(maxY, b.p.y);
    if (t > 0.05 && vy0 < 0 && (b.v.y >= 0 || b.p.y <= BALL_R + 1e-3)) break;
  }
  return { x: b.p.x, z: b.p.z, t, maxY };
}

/**
 * Lofted pass: find launch speed for elevation `elev` (rad) so the ball first lands at `to`.
 * Returns {vel:{x,y,z}, t} (horizontal direction corrected for sidespin curl).
 */
export function solveLob(from, to, elev = 0.6, spinY = 0) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const d = Math.hypot(dx, dz) || 1e-3;
  let yaw = Math.atan2(dz, dx);
  let speed = Math.sqrt((9.81 * d) / Math.sin(2 * elev)) * 1.05;
  let res = null;
  for (let it = 0; it < 5; it++) {
    let lo = speed * 0.5, hi = speed * 2.2;
    for (let i = 0; i < 16; i++) {
      const s = (lo + hi) / 2;
      const vel = { x: Math.cos(yaw) * Math.cos(elev) * s, y: Math.sin(elev) * s, z: Math.sin(yaw) * Math.cos(elev) * s };
      const f = flight(from, vel, { x: 0, y: spinY, z: 0 });
      const got = (f.x - from.x) * Math.cos(yaw) + (f.z - from.z) * Math.sin(yaw);
      if (got < d) lo = s; else hi = s;
      res = { vel, t: f.t, land: f };
    }
    speed = (lo + hi) / 2;
    if (!spinY) break;
    // correct yaw for curl
    const la = Math.atan2(res.land.z - from.z, res.land.x - from.x);
    const err = Math.atan2(Math.sin(Math.atan2(dz, dx) - la), Math.cos(Math.atan2(dz, dx) - la));
    if (Math.abs(err) < 0.004) break;
    yaw += err;
  }
  return res;
}

/**
 * Shot/driven kick through a target point in 3D with given speed and spin.
 * target {x,y,z}: the point the ball should pass through (e.g. on the goal line).
 * Iteratively corrects the aim for gravity, drag and Magnus curl.
 */
export function solveShot(from, target, speed, spin = { x: 0, y: 0, z: 0 }) {
  const aim = { x: target.x, y: target.y, z: target.z };
  {
    // ballistic first guess: compensate gravity drop over the estimated flight time
    const d0 = Math.hypot(target.x - from.x, target.z - from.z);
    const te = d0 / (speed * 0.82);
    aim.y += 0.5 * 9.81 * te * te;
  }
  let vel = null;
  const planeN = { x: target.x - from.x, z: target.z - from.z };
  const nl = Math.hypot(planeN.x, planeN.z) || 1e-3;
  planeN.x /= nl; planeN.z /= nl;
  const planeD = target.x * planeN.x + target.z * planeN.z;
  for (let it = 0; it < 10; it++) {
    const dx = aim.x - from.x, dy = aim.y - (from.y ?? BALL_R), dz = aim.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1e-3;
    vel = { x: (dx / l) * speed, y: (dy / l) * speed, z: (dz / l) * speed };
    // simulate until crossing target plane
    const b = createBall();
    b.p.x = from.x; b.p.y = from.y ?? BALL_R; b.p.z = from.z;
    b.v = { ...vel }; b.w = { ...spin };
    const dt = 1 / 120;
    let t = 0, hit = null;
    let prevS = b.p.x * planeN.x + b.p.z * planeN.z - planeD;
    while (t < 4) {
      const pp = { ...b.p };
      stepBall(b, dt);
      t += dt;
      const s = b.p.x * planeN.x + b.p.z * planeN.z - planeD;
      if (prevS < 0 && s >= 0) {
        const f = -prevS / (s - prevS || 1e-6);
        hit = { x: pp.x + (b.p.x - pp.x) * f, y: pp.y + (b.p.y - pp.y) * f, z: pp.z + (b.p.z - pp.z) * f, t };
        break;
      }
      prevS = s;
    }
    if (!hit) break;
    const ey = target.y - hit.y, ez = target.z - hit.z, ex = target.x - hit.x;
    if (Math.abs(ey) < 0.03 && Math.abs(ez) < 0.03 && Math.abs(ex) < 0.03) break;
    aim.x += ex; aim.y += ey; aim.z += ez;
  }
  return vel;
}

// Kick velocity for a ground pass to (tx,tz) with launch speed s.
export function groundVel(from, tx, tz, s) {
  const dx = tx - from.x, dz = tz - from.z;
  const l = Math.hypot(dx, dz) || 1e-3;
  return { x: (dx / l) * s, y: 0, z: (dz / l) * s };
}

export { cloneBallState };
