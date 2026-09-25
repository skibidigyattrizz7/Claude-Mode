// Shot planning with three assist modes (pure). The result is a target point on the
// goal plane plus speed/spin; physics.solveKick converts it into a launch velocity.
import { PITCH, CY, GOAL, BALL_R, SHOT_TYPES } from './constants.js';
import { clamp, gauss, angleBetween, lerp, DEG } from './util.js';
import { solveKick } from './physics.js';

export const ASSIST_MODES = ['Assisted', 'Precision', 'Manual'];

export const goalLineX = (side) => (side === 0 ? 0 : PITCH.L);

/** Where does the aim ray hit the goal line? Returns y or null if aiming away from it. */
export function aimPointOnGoal(from, aimDir, goalSide) {
  const gx = goalLineX(goalSide);
  if (Math.abs(aimDir.x) < 1e-6) return null;
  const t = (gx - from.x) / aimDir.x;
  if (t <= 0) return null;
  return from.y + aimDir.y * t;
}

const INNER = GOAL.W / 2 - BALL_R;   // lateral limit for "on target"

export function isOnTarget(y, z) {
  return Math.abs(y - CY) < INNER && z < GOAL.H - BALL_R && z >= 0;
}

/** Snap a point to the nearest point inside the frame (with margin). */
export function snapInsideFrame(y, z, margin = 0.2) {
  return {
    y: clamp(y, CY - GOAL.W / 2 + BALL_R + margin, CY + GOAL.W / 2 - BALL_R - margin),
    z: clamp(z, 0.12, GOAL.H - BALL_R - margin),
  };
}

/**
 * Plan a shot.
 * @param o {from:{x,y}, aimDir:{x,y}, goalSide, mode, power(0..1), type, shooting(0..1),
 *           sprinting, pressure(0..1), errMul}
 * Returns {target:{x,y,z}, speed, spin, topspin, onTarget, snapped, sd, aimY, bonus}
 */
export function planShot(o, rng = Math.random) {
  const T = SHOT_TYPES[o.type] || SHOT_TYPES.driven;
  const gx = goalLineX(o.goalSide);
  const power = clamp(o.power, 0, 1);
  const toGoal = { x: gx - o.from.x, y: CY - o.from.y };
  const angOff = angleBetween(o.aimDir.x, o.aimDir.y, toGoal.x, toGoal.y);
  const broadly = angOff < 50 * DEG;
  let aimY = aimPointOnGoal(o.from, o.aimDir, o.goalSide);
  let z = T.z + T.zPow * power;
  let speed = lerp(T.min, T.max, power);
  // Base error: angular standard deviation (radians)
  const shooting = clamp(o.shooting ?? 0.7, 0, 1);
  const over = Math.max(0, power - 0.8);
  let sd = 0.03 * (1.35 - shooting) * (1 + 3.5 * over) * (o.sprinting ? 1.25 : 1) * (1 + 0.5 * (o.pressure || 0)) * T.err * (o.errMul || 1);
  let zsd = 0.22 * (1 + 4 * over) * T.err * (o.errMul || 1);
  let zBias = over * 2.2;   // overpowered shots rise
  let snapped = false, bonus = false;
  const mode = o.mode || 'Assisted';

  if (mode === 'Assisted' && broadly) {
    if (aimY == null) aimY = CY;
    const s = snapInsideFrame(aimY, z, 0.25);
    aimY = s.y; z = s.z;
    snapped = true;
    sd *= 0.35; zsd *= 0.35; zBias = 0;
  } else if (mode === 'Precision') {
    if (aimY != null && isOnTarget(aimY, z)) {
      bonus = true;
      sd *= 0.5; zsd *= 0.5; zBias *= 0.5;
      speed *= 1.1;
    }
  }
  // Aiming completely away from the goal: shoot along the aim direction.
  let target;
  const D = Math.hypot(toGoal.x, toGoal.y);
  if (aimY == null) {
    target = { x: o.from.x + o.aimDir.x * 30, y: o.from.y + o.aimDir.y * 30, z };
  } else {
    const dist = Math.hypot(gx - o.from.x, aimY - o.from.y);
    target = { x: gx, y: aimY + gauss(rng) * sd * dist, z: z + zBias * rng() + gauss(rng) * zsd };
    if (target.z < 0.05) target.z = 0.05;
    if (snapped) {
      const s = snapInsideFrame(target.y, target.z, 0.12);
      target.y = s.y; target.z = s.z;
    }
  }
  // Finesse: curl the ball back towards the centre of the goal.
  let spin = 0;
  if (T.curl) {
    const tx = target.x - o.from.x, ty = target.y - o.from.y;
    const side = -ty * toGoal.x + tx * toGoal.y;   // >0: goal centre lies to the right of travel
    spin = (side >= 0 ? 1 : -1) * T.curl * clamp(D / 20, 0.4, 1);
  }
  const onTarget = aimY != null && isOnTarget(target.y, target.z) && target.x === gx;
  return { target, speed, spin, topspin: o.type === 'chip' ? 0 : 0, onTarget, snapped, sd, aimY, bonus, type: o.type };
}

/** Convert a planned shot into a launch velocity (vx, vy, vz, spin). */
export function shotVelocity(from, plan) {
  const loft = plan.type === 'chip';
  const hs = plan.speed * (loft ? 1 : 0.985);
  const v = solveKick({ x: from.x, y: from.y, z: from.z || 0.11 }, plan.target, hs, { spin: plan.spin, topspin: plan.topspin, loft });
  return v;
}
