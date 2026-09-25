// Pure "game feel" helpers: contextual first touch, shoulder duels, timed finishing and
// saved-kick restarts. No DOM; unit tested in tests/logic.test.mjs.
import { clamp } from './util.js';

/**
 * How heavy is a first touch? 0 = cushioned dead at the feet, 1 = knocked well away.
 * Fast balls, sprinting onto the ball, pressure and balls arriving in the air make it heavier;
 * better dribblers take cleaner touches.
 * @param o {relSpeed (m/s ball vs player), dribbling 0..1, sprinting, pressure 0..1, height (m)}
 */
export function touchHeaviness(o) {
  const dr = clamp(o.dribbling ?? 0.6, 0, 1);
  const skill = 1.25 - dr;                                  // 0.25 (great) .. 1.25 (poor)
  let h = clamp((o.relSpeed - (8 + 8 * dr)) / 12, 0, 0.6);  // pace of the ball
  if (o.sprinting) h += 0.14 * skill;
  h += clamp(o.pressure || 0, 0, 1) * 0.2 * skill;
  if ((o.height || 0) > 0.3) h += 0.1 * skill;
  return clamp(h, 0, 0.9);
}

/** Speed (m/s) the ball is pushed away from the receiver by a heavy touch of heaviness h. */
export const heavyTouchSpeed = (h) => 2.2 + 7 * h;

/**
 * Shoulder-to-shoulder duel: probability that the challenger knocks the carrier off the ball.
 * Strength decides it; a carrier who shields (or is much quicker) is harder to move.
 */
export function shoulderWinChance(challenger, carrier, o = {}) {
  const sc = challenger.attrs?.strength ?? 0.6, sv = carrier.attrs?.strength ?? 0.6;
  let p = 0.42 + 0.9 * (sc - sv);
  if (o.shielding) p -= 0.22;
  if (o.sideOn === false) p -= 0.15;                         // barging in at an angle
  p += (o.speedEdge || 0) * 0.04;                             // momentum of the challenger
  return clamp(p, 0.05, 0.9);
}

/**
 * Timed finishing: judge the second tap relative to the moment of contact.
 * delta = tapTime - contactTime (s), or null when there was no second tap.
 * Returns {grade: 'perfect'|'early'|'late'|'none', errMul, speedMul}.
 */
export const TIMED_WINDOW = 0.07;
export function timedFinishGrade(delta) {
  if (delta == null) return { grade: 'none', errMul: 1, speedMul: 1 };
  if (Math.abs(delta) <= TIMED_WINDOW) return { grade: 'perfect', errMul: 0.35, speedMul: 1.06 };
  return { grade: delta < 0 ? 'early' : 'late', errMul: 1.7, speedMul: 0.97 };
}

/**
 * Restart after the keeper saves a penalty / direct free kick (resolved in the first-person
 * view): he holds it, turns it round the post for a corner, or parries it back into play.
 * @param caught the keeper held the ball; y where the ball was saved (pitch y)
 */
export function savedKickRestart(caught, y, rng = Math.random, midY = 27) {
  if (caught) return { type: 'catch', y };
  const r = rng();
  const s = y < midY ? -1 : 1;
  if (r < 0.42) return { type: 'corner', upper: y < midY };
  return { type: 'parry', dy: s * (2 + rng() * 6), dist: 4 + rng() * 6, speed: 4 + rng() * 5 };
}
