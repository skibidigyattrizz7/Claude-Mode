// Pass target selection and pass velocity planning (pure).
import { PITCH, PHYS } from './constants.js';
import { integrate, makeBall } from './physics.js';
import { angleBetween, clamp, distToSegment, norm, DEG, gauss } from './util.js';

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

/**
 * Arrival speed we want for a ground pass of length d: a firm, zipped pass that reaches the
 * receiver quickly (never dribbling in), still controllable; through balls keep rolling into
 * the runner's stride.
 */
export const arriveSpeedFor = (d, kind) => (kind === 'through' ? clamp(5.5 + d * 0.08, 6, 8.5) : clamp(7 + d * 0.16, 8, 12.5));

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

export const lobTimeFor = (d) => clamp(0.95 + d / 24, 1.25, 2.5);

/** Keep a target point inside the pitch with a margin. */
export function clampToPitch(p, mx = 1.2, my = 1.2) {
  return { x: clamp(p.x, mx, PITCH.L - mx), y: clamp(p.y, my, PITCH.W - my) };
}

/** Time for a rolling ball launched at v0 to cover distance s (Infinity if it stops short). */
export function rollTimeTo(v0, s) {
  const K = PHYS.ROLL_K;
  const tStop = Math.log((v0 + CK) / CK) / K;
  const distAt = (t) => ((v0 + CK) / K) * (1 - Math.exp(-K * t)) - CK * t;
  if (distAt(tStop) < s) return Infinity;
  let lo = 0, hi = tStop;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (distAt(mid) < s) lo = mid; else hi = mid; }
  return hi;
}

const OPP_RUN = 6.0, OPP_REACT = 0.45, OPP_REACH = 0.7;

/**
 * Risk (0..1) that an opponent intercepts a pass from `a` to `b`, from a race between the
 * ball (real rolling times) and each opponent (reaction + running) to points along the lane.
 * kind 'lob' only considers opponents who can reach the landing spot in time.
 */
export function laneRisk(a, b, opps, kind = 'ground') {
  const D = Math.max(0.5, Math.hypot(b.x - a.x, b.y - a.y));
  let risk = 0;
  if (kind === 'lob') {
    const T = lobTimeFor(D);
    for (const o of opps) {
      if (o.sentOff) continue;
      const to = Math.max(0, Math.hypot(o.x - b.x, o.y - b.y) - 1.2) / OPP_RUN + OPP_REACT;
      risk = Math.max(risk, clamp(0.5 + (T - to) / 0.8, 0, 1) * 0.85);
    }
    return risk;
  }
  const v0 = groundPassSpeed(D, arriveSpeedFor(D, kind)).v0;
  const N = Math.max(4, Math.min(12, Math.ceil(D / 2.5)));
  const ts = [];
  for (let i = 1; i <= N; i++) ts.push(rollTimeTo(v0, (D * i) / N));
  for (const o of opps) {
    if (o.sentOff) continue;
    for (let i = 1; i <= N; i++) {
      const f = i / N;
      const px = a.x + (b.x - a.x) * f, py = a.y + (b.y - a.y) * f;
      const to = Math.max(0, Math.hypot(o.x - px, o.y - py) - OPP_REACH) / OPP_RUN + OPP_REACT;
      const margin = ts[i - 1] - to;        // > 0: the opponent gets there before the ball
      risk = Math.max(risk, clamp(0.5 + margin / 0.45, 0, 1));
      if (risk >= 1) return 1;
    }
  }
  return risk;
}

const CONES = { ground: 45 * DEG, through: 55 * DEG, lob: 50 * DEG };
const WIDE_CONE = 80 * DEG;

const RUN_SPEED = 7.2;   // how fast a receiver sprints onto a through ball

/**
 * Where to play the ball so the receiver meets it.
 * ground/lob: lead a moving receiver by (part of) his velocity, capped so a change of
 * direction doesn't leave the ball in empty space.
 * through: into space ahead of the runner, at the first point he can reach before the ball.
 */
export function leadTarget(from, mate, kind, attackDir = 1, full = false) {
  const vx = mate.vx || 0, vy = mate.vy || 0;
  const ballTime = (tgt) => {
    const d = Math.hypot(tgt.x - from.x, tgt.y - from.y);
    return kind === 'lob' ? lobTimeFor(d) : groundPassSpeed(d, arriveSpeedFor(d, kind)).t;
  };
  if (kind === 'through') {
    // Into space ahead of the runner: he sprints on (at least RUN_SPEED) towards goal and the
    // ball is aimed where he will be when it arrives: lead = runner speed x arrival time.
    const sp = Math.hypot(vx, vy);
    let dir = sp > 1.5 ? norm(vx, vy) : { x: attackDir, y: 0 };
    dir = norm(dir.x + attackDir * 0.6, dir.y);
    const run = Math.max(RUN_SPEED, sp);
    let L = 6, tgt = null, t = 0;
    for (let i = 0; i < 8; i++) {
      tgt = clampToPitch({ x: mate.x + dir.x * L, y: mate.y + dir.y * L }, 4, 2.5);
      t = ballTime(tgt);
      L = clamp(run * Math.max(0, t - 0.25), 4, 28);
    }
    tgt = clampToPitch({ x: mate.x + dir.x * L, y: mate.y + dir.y * L }, 4, 2.5);
    return { target: tgt, t: ballTime(tgt) };
  }
  // full lead (assisted passing): the ball meets the runner exactly where he will be
  let tgt = { x: mate.x, y: mate.y }, t = 0;
  for (let i = 0; i < (full ? 6 : 3); i++) {
    t = ballTime(tgt);
    const lead = full ? Math.min(kind === 'lob' ? 14 : 11, Math.hypot(vx, vy) * t) : Math.min(kind === 'lob' ? 7 : 5, Math.hypot(vx, vy) * t * 0.7);
    const sp = Math.hypot(vx, vy);
    tgt = sp > 0.3 ? { x: mate.x + (vx / sp) * lead, y: mate.y + (vy / sp) * lead } : { x: mate.x, y: mate.y };
    tgt = clampToPitch(tgt, 1.5, 1.5);
  }
  return { target: tgt, t: ballTime(tgt) };
}

/**
 * Choose the best teammate in the aim direction.
 * Score = alignment with aim (cone ~45°) - distance cost - interception risk.
 * Returns {mate, target, score} or null if nobody is in the cone.
 */
export function choosePassTarget(passer, mates, opps, aimDir, kind = 'ground', attackDir = 1, opts = {}) {
  const maxD = kind === 'lob' ? 60 : kind === 'through' ? 50 : 42;
  const alignW = opts.alignW || 1.8;
  const scan = (cone) => {
    let best = null;
    for (const m of mates) {
      if (m === passer || m.sentOff) continue;
      const dx = m.x - passer.x, dy = m.y - passer.y;
      const d = Math.hypot(dx, dy);
      if (d < 2.5 || d > maxD) continue;
      const ang = angleBetween(aimDir.x, aimDir.y, dx, dy);
      if (ang > cone) continue;
      const plan = leadTarget(passer, m, kind, attackDir, !!opts.fullLead);
      const risk = laneRisk(passer, plan.target, opps, kind);
      let score = alignW * (1 - ang / cone) - 0.014 * d - 1.5 * risk;
      if (kind === 'through') score += 0.3 * clamp(((m.vx || 0) * attackDir) / 6, -1, 1);
      if (kind === 'lob' && d < 12) score -= 0.5;
      if (!best || score > best.score) best = { mate: m, target: plan.target, t: plan.t, score };
    }
    return best;
  };
  // Nobody inside the normal cone: look a little wider rather than passing to nobody.
  return scan(opts.cone || CONES[kind] || CONES.ground) || scan(opts.wide || WIDE_CONE);
}

// ---------- pass assistance (Assisted / Semi / Manual) ----------

/** Targeting cones (degrees) and how much the aim direction dominates the choice. */
export const PASS_CONES = {
  Assisted: { ground: 70, through: 75, lob: 75, wide: 120, alignW: 1.2 },
  Semi: { ground: 28, through: 32, lob: 32, wide: 42, alignW: 2.6 },
};
export const PASS_MODES = ['Assisted', 'Semi', 'Manual'];

/** Manual passing: launch speed (ground) or carry distance (lob) from the hold-time power 0..1. */
export function manualPassSpeed(kind, power) {
  const f = clamp(power, 0, 1);
  if (kind === 'lob') return 8 + 44 * f;                  // metres to the landing spot
  return (kind === 'through' ? 10 : 9) + 19 * f;         // m/s along the ground: never a weak roll
}

/** The hold-time power that would play a perfect pass of length d (inverse of manualPassSpeed). */
export function idealPassPower(kind, d) {
  if (kind === 'lob') return clamp((d - 8) / 44, 0, 1);
  const v0 = groundPassSpeed(d, arriveSpeedFor(d, kind)).v0;
  return clamp((v0 - (kind === 'through' ? 10 : 9)) / 19, 0, 1);
}

function rotate(v, a, s = 1) {
  const c = Math.cos(a), n = Math.sin(a);
  return { ...v, vx: (v.vx * c - v.vy * n) * s, vy: (v.vx * n + v.vy * c) * s };
}

/**
 * Plan a human pass for an assist mode.
 *  Assisted: wide cone around the aim, automatic power, leads the runner so the ball arrives at
 *            his feet; no error (only an interception stops it).
 *  Semi:     narrower cone (the aim matters more), power from the hold time blended with the
 *            ideal pass, small error from the passing attribute.
 *  Manual:   no targeting at all: exactly along the aim with the power you hold.
 * @param o {passer, from, mates, opps, aimDir, kind, attackDir, mode, power, passing}
 * Returns {mate, target, v:{vx,vy,vz,t}, mode, err}
 */
export function planPass(o, rng = Math.random) {
  const mode = PASS_MODES.includes(o.mode) ? o.mode : 'Assisted';
  const kind = o.kind || 'ground';
  const from = o.from;
  const f = clamp(o.power ?? 0.5, 0, 1);
  const aim = norm(o.aimDir.x, o.aimDir.y);
  const alongAim = () => {
    if (kind === 'lob') {
      const d = manualPassSpeed('lob', f);
      const target = { x: from.x + aim.x * d, y: from.y + aim.y * d };
      const v = passVelocity(from, target, 'lob');
      return { mate: null, target, v, mode, err: 0 };
    }
    const v0 = manualPassSpeed(kind, f);
    const r = rollDistance(v0, 0);
    return { mate: null, target: { x: from.x + aim.x * r.d, y: from.y + aim.y * r.d }, v: { vx: aim.x * v0, vy: aim.y * v0, vz: 0, t: r.t }, mode, err: 0 };
  };
  if (mode === 'Manual') return alongAim();
  const C = PASS_CONES[mode];
  const sel = choosePassTarget(o.passer, o.mates, o.opps, aim, kind, o.attackDir ?? 1,
    { cone: C[kind] * DEG, wide: C.wide * DEG, alignW: C.alignW, fullLead: mode === 'Assisted' });
  if (!sel) {
    if (mode === 'Semi') return alongAim();
    // assisted pass into space along the aim
    const L = kind === 'lob' ? 24 : kind === 'through' ? 18 : 13;
    const target = clampToPitch({ x: from.x + aim.x * L, y: from.y + aim.y * L }, 1.5, 1.5);
    return { mate: null, target, v: passVelocity(from, target, kind, kind === 'lob' ? null : 1.8), mode, err: 0 };
  }
  const v = passVelocity(from, sel.target, kind);
  if (mode === 'Assisted') return { mate: sel.mate, target: sel.target, v, mode, err: 0 };
  // Semi-assisted: the hold time decides the weight of the pass
  const d = Math.hypot(sel.target.x - from.x, sel.target.y - from.y);
  const scale = clamp(1 + (f - idealPassPower(kind, d)) * 0.55, 0.8, 1.3);
  const err = gauss(rng) * 0.035 * (1.25 - clamp(o.passing ?? 0.7, 0, 1));
  const vv = rotate(v, err, scale);
  return { mate: sel.mate, target: { x: from.x + (sel.target.x - from.x) * scale, y: from.y + (sel.target.y - from.y) * scale }, v: vv, mode, err, scale };
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
