// Pass target selection and pass velocity planning (pure).
import { PITCH, PHYS } from './constants.js';
import { integrate, makeBall } from './physics.js';
import { angleBetween, clamp, distToSegment, norm, DEG } from './util.js';

const CK = PHYS.ROLL_C / PHYS.ROLL_K;

/** Closed-form rolling: distance travelled and time while slowing from v0 to va. */
export function rollDistance(v0, va) {
  if (v0 <= va) return { d: 0, t: 0 };
  const t = Math.log((v0 + CK) / (va + CK)) / PHYS.ROLL_K;
  return { d: (v0 - va) / PHYS.ROLL_K - CK * t, t };
}

/** Initial ground speed so the ball covers distance d and arrives at speed va. */
export function groundPassSpeed(d, va) {
  let lo = va, hi = 80;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid, va).d >= d) hi = mid; else lo = mid;
  }
  return { v0: hi, t: rollDistance(hi, va).t };
}

/** Arrival speed we want for a ground pass of length d (firmer for longer passes). */
export const arriveSpeedFor = (d, kind) => (kind === 'through' ? 2.2 : clamp(4 + d * 0.16, 4.5, 9));

/** Lofted ball: find horizontal speed & vz so the ball lands at distance d after ~T seconds. */
export function lobParams(d, T) {
  const vz = (PHYS.G * T) / 2 * 1.04;
  let lo = 1, hi = 60;
  let land = { d: 0, t: T };
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    land = lobLanding(mid, vz);
    if (land.d >= d) hi = mid; else lo = mid;
  }
  land = lobLanding(hi, vz);
  return { vh: hi, vz, t: land.t };
}

function lobLanding(vh, vz) {
  const b = makeBall(0, 0);
  b.vx = vh; b.vz = vz; b.z = 0.01;
  let t = 0;
  while (t < 6) {
    integrate(b, PHYS.DT); t += PHYS.DT;
    if (b.z <= 0 && b.vz <= 0.01 && t > 0.05) break;
    if (b.z <= 0 && t > 0.05) break;
  }
  return { d: b.x, t };
}

export const lobTimeFor = (d) => clamp(0.75 + d / 30, 0.9, 2.2);

/** Keep a target point inside the pitch with a margin. */
export function clampToPitch(p, mx = 1.2, my = 1.2) {
  return { x: clamp(p.x, mx, PITCH.L - mx), y: clamp(p.y, my, PITCH.W - my) };
}

/**
 * Risk (0..1) that an opponent intercepts a pass from `a` to `b`.
 * kind 'lob' only considers opponents near the landing spot.
 */
export function laneRisk(a, b, opps, kind = 'ground') {
  let risk = 0;
  for (const o of opps) {
    if (o.sentOff) continue;
    if (kind === 'lob') {
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      risk = Math.max(risk, clamp(1 - (d - 1) / 3, 0, 1) * 0.8);
      continue;
    }
    const { d, t } = distToSegment(o, a, b);
    // Opponents closer to the passer have less time to react; far along the lane more time.
    const reach = 0.9 + t * 1.8;
    const r = clamp(1 - (d - reach * 0.4) / reach, 0, 1) * (t < 0.05 ? 0.3 : 1);
    risk = Math.max(risk, r);
  }
  return risk;
}

const CONES = { ground: 45 * DEG, through: 55 * DEG, lob: 50 * DEG };

/** Predict where the receiver will be when the ball arrives (lead by velocity). */
export function leadTarget(from, mate, kind, attackDir = 1) {
  let tgt = { x: mate.x, y: mate.y };
  let plan = null;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(tgt.x - from.x, tgt.y - from.y);
    let t;
    if (kind === 'lob') t = lobTimeFor(d);
    else t = groundPassSpeed(d, arriveSpeedFor(d, kind)).t;
    if (kind === 'through') {
      const sp = Math.hypot(mate.vx || 0, mate.vy || 0);
      const dir = sp > 1.5 ? norm(mate.vx, mate.vy) : { x: attackDir, y: 0 };
      const run = Math.max(sp, 6.5) * t * 0.9;
      tgt = { x: mate.x + dir.x * run, y: mate.y + dir.y * run };
      tgt = clampToPitch(tgt, 5, 2.5);
    } else {
      tgt = { x: mate.x + (mate.vx || 0) * t, y: mate.y + (mate.vy || 0) * t };
      tgt = clampToPitch(tgt, 1.2, 1.2);
    }
    plan = { target: tgt, t };
  }
  return plan;
}

/**
 * Choose the best teammate in the aim direction.
 * Score = alignment with aim (cone ~45°) - distance cost - interception risk.
 * Returns {mate, target, score} or null if nobody is in the cone.
 */
export function choosePassTarget(passer, mates, opps, aimDir, kind = 'ground', attackDir = 1) {
  const cone = CONES[kind] || CONES.ground;
  const maxD = kind === 'lob' ? 60 : kind === 'through' ? 45 : 40;
  let best = null;
  for (const m of mates) {
    if (m === passer || m.sentOff) continue;
    const dx = m.x - passer.x, dy = m.y - passer.y;
    const d = Math.hypot(dx, dy);
    if (d < 2.5 || d > maxD) continue;
    const ang = angleBetween(aimDir.x, aimDir.y, dx, dy);
    if (ang > cone) continue;
    const plan = leadTarget(passer, m, kind, attackDir);
    const risk = laneRisk(passer, plan.target, opps, kind);
    let score = 1.8 * (1 - ang / cone) - 0.014 * d - 1.5 * risk;
    if (kind === 'through') score += 0.3 * clamp(((m.vx || 0) * attackDir) / 6, -1, 1);
    if (kind === 'lob' && d < 12) score -= 0.5;
    if (!best || score > best.score) best = { mate: m, target: plan.target, t: plan.t, score };
  }
  return best;
}

/**
 * Launch velocity for a pass from ball position `from` to `target`.
 * ground/through: rolling pass arriving at a controllable speed.
 * lob: aerial ball landing on target.
 */
export function passVelocity(from, target, kind = 'ground', arrive = null) {
  const dx = target.x - from.x, dy = target.y - from.y;
  const d = Math.max(0.5, Math.hypot(dx, dy));
  const ux = dx / d, uy = dy / d;
  if (kind === 'lob') {
    const p = lobParams(d, lobTimeFor(d));
    return { vx: ux * p.vh, vy: uy * p.vh, vz: p.vz, t: p.t };
  }
  const va = arrive != null ? arrive : arriveSpeedFor(d, kind);
  const { v0, t } = groundPassSpeed(d, va);
  return { vx: ux * v0, vy: uy * v0, vz: 0, t };
}
