// Human kick assistance, FC-style. Builds kick plans ({vel, spin, from, info}) that MatchSim._execute
// then applies errors to. info.errYaw / info.errSpeed / info.errMul scale the standard error model
// (0 = perfect), info.onFrame asks _execute to keep an assisted shot inside the goal frame.
//   passAssist / throughAssist / lobAssist:
//     assisted  teammate nearest the aim inside a wide ~70 deg cone, automatic power, leads the
//               receiver and arrives at his feet with no error (only an interception stops it)
//     semi      same targeting but a ~35 deg cone, speed follows the held power, small error
//     manual    no target lock: exactly along the stick with the held power
//   shotAssist:
//     assisted  aimed broadly at goal -> target snapped inside the frame (never sails over)
//     precision exactly where aimed; if that point is inside the frame: +12% speed, 60% less error
//     manual    exactly where aimed, full error model (attributes, power, pressure, body angle)
// DOM-free.
import { GOAL, BALL_R } from './constants.js';
import { clamp } from './mathx.js';
import { leadPass, rollSpeedFor, rollTimeTo, groundVel } from './passing.js';
import { ps } from './playstyles.js';

const ZERO = () => ({ x: 0, y: 0, z: 0 });
export const CONE_COS = { assisted: Math.cos((70 * Math.PI) / 180), semi: Math.cos((35 * Math.PI) / 180) };

export function passMode(sim, team, kind) {
  const g = sim.gp[team];
  if (kind === 'through') return g.throughAssist;
  if (kind === 'lob' || kind === 'cross') return g.lobAssist;
  return g.passAssist;
}

// Firm ground passes: arrival speed at the receiver grows with distance and passing quality.
export function passArrive(p, dist) {
  return clamp(6 + dist * 0.09 + (p.a.pas - 70) * 0.03 + ps(p, 'pinged') * 1.2, 5.5, 11.5);
}

// Teammate closest to the aim direction inside the assist cone (-1 if none).
export function pickReceiver(sim, p, dir, mode, kind) {
  const minCos = CONE_COS[mode] ?? CONE_COS.assisted;
  const team = p.team;
  const maxD = kind === 'ground' ? 52 : kind === 'through' ? 58 : 72;
  let best = -1, bs = -1e9;
  for (const m of sim.teamList[team]) {
    if (m === p || m.sentOff) continue;
    const dx = m.x - p.x, dz = m.z - p.z, dist = Math.hypot(dx, dz);
    if (dist < 2 || dist > maxD) continue;
    const cos = (dx * dir.x + dz * dir.z) / dist;
    if (cos < minCos) continue;
    const ang = Math.acos(clamp(cos, -1, 1));
    let s = -ang * 4 - dist * 0.012 + Math.min(sim.openness(m), 6) * 0.03;
    if (kind === 'through') s += (sim.X(team, m.x) - sim.X(team, p.x)) * 0.01 + (m.run && m.run.until > sim.t ? 0.25 : 0);
    if (kind === 'cross' && sim.X(team, m.x) > 84 && Math.abs(m.z) < 18) s += 0.6;
    if (m.isGK) s -= 1.5;
    if (s > bs) { bs = s; best = m.idx; }
  }
  return best;
}

const fromBall = (sim, groundY) => {
  const b = sim.ball.p;
  return { x: b.x, y: groundY ? BALL_R : b.y, z: b.z };
};

// ---------------------------------------------------------------- ground pass / gk throw
export function humanGround(sim, p, aim, power, kind = 'ground') {
  const mode = passMode(sim, p.team, 'ground');
  const from = fromBall(sim, kind === 'gkthrow');
  const info = { kind, pass: true, shot: false, target: -1, point: null, power, assist: mode };
  if (mode !== 'manual') {
    const tgt = pickReceiver(sim, p, aim, mode, 'ground');
    if (tgt >= 0) {
      const m = sim.players[tgt];
      const dist = Math.hypot(m.x - from.x, m.z - from.z);
      const arrive = kind === 'gkthrow' ? 5 : passArrive(p, dist);
      const L = leadPass(from, m, sim._recvVel(m), arrive, kind === 'gkthrow' ? 20 : 30);
      const pt = sim._clampPt(L);
      const dd = Math.hypot(pt.x - from.x, pt.z - from.z);
      let speed = Math.min(30, rollSpeedFor(dd, arrive));
      if (mode === 'semi') {
        const ideal = clamp((dist - 5) / 34, 0.05, 1);
        speed *= clamp(1 + (power - ideal) * 0.45, 0.75, 1.3);
        info.errYaw = 0.45; info.errSpeed = 0.4;
      } else { info.errYaw = 0; info.errSpeed = 0; }
      info.target = tgt; info.point = pt;
      return { vel: groundVel(from, pt.x, pt.z, speed), spin: ZERO(), from, info };
    }
  }
  // manual (or nobody inside the cone): exactly along the stick, distance from the held power
  const dist = kind === 'gkthrow' ? 6 + power * 24 : 5 + power * 38;
  const pt = { x: from.x + aim.x * dist, z: from.z + aim.z * dist };
  const speed = Math.min(30, rollSpeedFor(dist, mode === 'manual' ? 1.5 : 3));
  info.point = pt; info.errYaw = 0; info.errSpeed = 0.35;
  return { vel: groundVel(from, pt.x, pt.z, speed), spin: ZERO(), from, info };
}

// Lead point for a through ball: the runner and the ball arrive together, preferring deeper
// points that no opponent can reach first.
export function throughLead(sim, m, from, rx, rz, arrive) {
  const opps = sim.teamList[1 - m.team];
  let best = null, bs = -1e9;
  for (let L = 2; L <= 20; L += 1) {
    const pt = sim._clampPt({ x: m.x + rx * L, z: m.z + rz * L }, 2.5);
    if (sim.X(m.team, pt.x) > 101) continue;
    const dd = Math.hypot(pt.x - from.x, pt.z - from.z);
    const speed = Math.min(30, rollSpeedFor(dd, arrive));
    const tb = rollTimeTo(speed, dd);
    const tr = 0.2 + Math.hypot(pt.x - m.x, pt.z - m.z) / (m.vmax * 0.95);
    let margin = 9;
    for (const o of opps) {
      const to = 0.25 + Math.max(0, Math.hypot(o.x - pt.x, o.z - pt.z) - 1) / (o.vmax * 0.95);
      margin = Math.min(margin, to - Math.max(tb, tr));
    }
    const s = -Math.abs(tr - tb) * 2 + L * 0.04 + clamp(margin, -1, 1.5) * 1.2;
    if (s > bs) { bs = s; best = { pt, speed, margin, tb }; }
  }
  return best;
}

export function humanThrough(sim, p, aim, power) {
  const mode = passMode(sim, p.team, 'through');
  const from = fromBall(sim);
  const d = sim.dir[p.team];
  const info = { kind: 'through', pass: true, shot: false, target: -1, point: null, power, run: true, assist: mode };
  if (mode !== 'manual') {
    const tgt = pickReceiver(sim, p, aim, mode, 'through');
    if (tgt >= 0) {
      const m = sim.players[tgt];
      let rx = d * 0.8 + aim.x * 0.45, rz = aim.z * 0.45 + (m.vz / m.vmax) * 0.2;
      const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      const arrive = 3.4 + ps(p, 'incisive') * 0.6;
      let pt, speed;
      if (mode === 'assisted') {
        const r = throughLead(sim, m, from, rx, rz, arrive);
        pt = r.pt; speed = r.speed;
        info.errYaw = 0; info.errSpeed = 0;
      } else {
        const lead = 3 + power * 14;
        pt = sim._clampPt({ x: m.x + rx * lead, z: m.z + rz * lead }, 2.5);
        speed = Math.min(30, rollSpeedFor(Math.hypot(pt.x - from.x, pt.z - from.z), arrive));
        info.errYaw = 0.5; info.errSpeed = 0.45;
      }
      info.target = tgt; info.point = pt;
      return { vel: groundVel(from, pt.x, pt.z, speed), spin: ZERO(), from, info };
    }
  }
  const dist = 10 + power * 28;
  const pt = { x: from.x + aim.x * dist, z: from.z + aim.z * dist };
  info.point = pt; info.errYaw = 0; info.errSpeed = 0.35;
  return { vel: groundVel(from, pt.x, pt.z, Math.min(30, rollSpeedFor(dist, 2.5))), spin: ZERO(), from, info };
}

// ---------------------------------------------------------------- lob / cross
export function humanLob(sim, p, aim, power, kind = 'lob') {
  const mode = passMode(sim, p.team, kind);
  const from = fromBall(sim);
  let pt = null, tgt = -1, ey = 0, es = 0;
  if (mode !== 'manual') {
    tgt = pickReceiver(sim, p, aim, mode, kind);
    if (tgt >= 0) {
      const m = sim.players[tgt];
      const rv = sim._recvVel(m);
      const dist = Math.hypot(m.x - from.x, m.z - from.z);
      // flight time of a lofted ball ~ distance / 16..19 m/s
      const tf = 0.35 + dist / 18.5;
      const lead = kind === 'cross' ? sim.dir[p.team] * 0.8 : 0;
      pt = { x: m.x + rv.x * tf + lead, z: m.z + rv.z * tf };
      if (mode === 'semi') {
        const ideal = clamp((dist - 12) / 40, 0.05, 1);
        const k = clamp(1 + (power - ideal) * 0.35, 0.8, 1.22);
        pt = { x: from.x + (pt.x - from.x) * k, z: from.z + (pt.z - from.z) * k };
        ey = 0.5; es = 0.5;
      }
    } else if (kind === 'cross' && mode === 'assisted') {
      const c = sim._crossPoint(p, -1);
      pt = { x: c.x, z: c.z }; tgt = c.target ?? -1;
    }
  }
  if (!pt) {
    const dist = kind === 'cross' ? 12 + power * 40 : 10 + power * 45;
    pt = { x: from.x + aim.x * dist, z: from.z + aim.z * dist };
    ey = 0; es = 0.4;
  }
  const plan = sim._plan(p, kind, { point: pt, target: tgt, power, noClamp: mode === 'manual', human: true });
  if (!plan) return null;
  plan.info.errYaw = ey; plan.info.errSpeed = es; plan.info.assist = mode;
  return plan;
}

// ---------------------------------------------------------------- shots
export function humanShot(sim, p, kind, aim, power) {
  const mode = sim.gp[p.team].shotAssist;
  const team = p.team;
  const from = fromBall(sim);
  const gx = sim.goalX(team), s = Math.sign(gx);
  const gvx = gx - from.x, gvz = -from.z, gl = Math.hypot(gvx, gvz) || 1;
  const cosG = (aim.x * gvx + aim.z * gvz) / gl;
  if (mode === 'assisted' && cosG > 0.2) {
    const nx = gvx / gl, nz = gvz / gl;
    const lat = aim.x * -nz + aim.z * nx;
    const gk = sim.gk(1 - team);
    let tz;
    if (Math.abs(lat) < 0.25) tz = kind === 'finesse' ? -(Math.sign(from.z) || 1) * (GOAL.HW - 0.6) : (gk.z > 0 ? -1 : 1) * GOAL.HW * 0.55;
    else tz = nx * lat * 6.5;
    tz = clamp(tz, -(GOAL.HW - 0.45), GOAL.HW - 0.45);
    const ty = clamp(kind === 'finesse' ? 0.8 + power * 0.9 : 0.3 + power * 1.3, 0.25, GOAL.H - 0.4);
    const plan = sim._plan(p, kind, { tz, ty, power });
    if (plan) { plan.info.onFrame = true; plan.info.assist = 'assisted'; plan.info.inFrame = true; }
    return plan;
  }
  // precision / manual / assisted aimed away from goal: exactly where aimed
  let ty = kind === 'finesse' ? 0.8 + power * 0.9 : 0.3 + power * 1.3;
  const over = mode === 'manual' ? 0.8 : 0.85;
  if (power > over) ty += (power - over) * (mode === 'manual' ? 18 : 16);
  const toGoal = aim.x * s > 0.05;
  let tz, tx;
  if (toGoal) { tx = gx; tz = from.z + (aim.z * (gx - from.x)) / aim.x; }
  else { tx = from.x + aim.x * 35; tz = from.z + aim.z * 35; }
  tz = clamp(tz, -60, 60);
  const inFrame = toGoal && Math.abs(tz) < GOAL.HW - 0.12 && ty < GOAL.H - 0.1;
  const bonus = mode === 'precision' && inFrame;
  const plan = sim._plan(p, kind, { tz, ty, tx, power, speedMul: bonus ? 1.12 : 1 });
  if (!plan) return null;
  plan.info.errMul = mode === 'precision' ? (inFrame ? 0.4 : 1) : mode === 'manual' ? 1.15 : 1;
  plan.info.assist = mode === 'assisted' ? 'assisted-off' : mode;
  plan.info.inFrame = inFrame;
  return plan;
}
