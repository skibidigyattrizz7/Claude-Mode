// Laws of the game as pure functions: goal-line decision, keeper legality,
// out-of-play restarts and tackle/foul judgement. Unit tested in tests/logic.test.mjs.
import { PITCH, CY, GOAL, BALL_R, BOX } from './constants.js';
import { angleBetween } from './util.js';

/**
 * THE single authoritative goal decision.
 * A goal is scored when the WHOLE ball has crossed the goal line, between the posts
 * and under the crossbar. Returns the goal side (0 = goal at x=0, 1 = goal at x=L) or -1.
 */
export function goalScored(b) {
  if (Math.abs(b.y - CY) >= GOAL.W / 2) return -1;   // centre must be inside the posts' inner edges
  if (b.z >= GOAL.H) return -1;                       // under the crossbar
  if (b.x < -BALL_R) return 0;                        // fully over line at x = 0
  if (b.x > PITCH.L + BALL_R) return 1;               // fully over line at x = L
  return -1;
}

/** Has the whole ball crossed the goal line of `side` (anywhere along the line)? */
export function ballOverLine(b, side) {
  return side === 0 ? b.x < -BALL_R : b.x > PITCH.L + BALL_R;
}

/**
 * A keeper may only save/touch the ball while it has NOT wholly crossed the line.
 * Once over the line it is either a goal (inside the frame) or out of play.
 */
export function keeperMaySave(b, side) {
  return !ballOverLine(b, side) && goalScored(b) === -1;
}

/**
 * Resolve a keeper intervention attempt. Always checks the goal first so a ball
 * that is already in can never be reported as saved.
 * Returns 'goal' | 'save' | 'none'.
 */
export function resolveKeeperContact(b, side, keeperTouches) {
  if (goalScored(b) === side) return 'goal';
  if (keeperTouches && keeperMaySave(b, side)) return 'save';
  return 'none';
}

/** Out of play detection (goal takes priority). */
export function outOfPlay(b) {
  if (goalScored(b) !== -1) return null;
  if (b.y < -BALL_R) return { type: 'side', x: b.x, y: 0 };
  if (b.y > PITCH.W + BALL_R) return { type: 'side', x: b.x, y: PITCH.W };
  if (b.x < -BALL_R) return { type: 'end', side: 0, y: b.y };
  if (b.x > PITCH.L + BALL_R) return { type: 'end', side: 1, y: b.y };
  return null;
}

/**
 * Decide the restart after the ball left the field.
 * @param out result of outOfPlay
 * @param lastTouchTeam team (0/1) that touched the ball last
 * @param defenderOfSide function(side) -> team that defends that goal
 */
export function restartFor(out, lastTouchTeam, defenderOfSide) {
  if (!out) return null;
  if (out.type === 'side') {
    const x = Math.min(PITCH.L - 0.5, Math.max(0.5, out.x));
    return { type: 'throw', team: 1 - lastTouchTeam, x, y: out.y };
  }
  const defTeam = defenderOfSide(out.side);
  const gx = out.side === 0 ? 0 : PITCH.L;
  const inward = out.side === 0 ? 1 : -1;
  const upper = out.y < CY;
  if (lastTouchTeam === defTeam) {
    return { type: 'corner', team: 1 - defTeam, x: gx + inward * 0.4, y: upper ? 0.4 : PITCH.W - 0.4 };
  }
  return { type: 'goalkick', team: defTeam, x: gx + inward * 5.5, y: CY + (upper ? -4.5 : 4.5) };
}

/** Is point inside the penalty area of goal side? */
export function inPenaltyArea(p, side) {
  const inX = side === 0 ? p.x >= 0 && p.x <= BOX.D : p.x <= PITCH.L && p.x >= PITCH.L - BOX.D;
  return inX && Math.abs(p.y - CY) <= BOX.W / 2;
}

/**
 * Is the tackler clearly behind the opponent? Angle between the opponent's facing
 * and the vector from the opponent to the tackler greater than ~120 degrees.
 */
export function isFromBehind(tackler, victim, thresholdDeg = 120) {
  const fx = Math.cos(victim.facing), fy = Math.sin(victim.facing);
  const a = angleBetween(fx, fy, tackler.x - victim.x, tackler.y - victim.y);
  return a > (thresholdDeg * Math.PI) / 180;
}

/**
 * Foul judgement. Rules:
 *  - The tackler reaches the ball first            -> always clean
 *  - Tackler contacts the body before the ball     -> foul ("Late challenge", or "From behind")
 *  - From clearly behind, misses the ball and makes contact / reaches the man -> foul ("From behind")
 *  - Otherwise (a clean miss with no contact)      -> no foul
 * Cards: yellow for a reckless slide from behind.
 * @param t {type:'stand'|'slide', firstContact:'ball'|'body'|null, bodyContact:boolean, nearVictim:boolean, fromBehind:boolean}
 */
export function judgeTackle(t) {
  if (t.firstContact === 'ball') return { foul: false, reason: null, card: null };
  const reachedMan = t.firstContact === 'body' || t.bodyContact || t.nearVictim;
  if (t.fromBehind && reachedMan) {
    return { foul: true, reason: 'From behind', card: t.type === 'slide' ? 'yellow' : null };
  }
  if (t.firstContact === 'body' || t.bodyContact) {
    return { foul: true, reason: 'Late challenge', card: null };
  }
  return { foul: false, reason: null, card: null };
}

/** Apply a card to a player record; returns 'yellow' | 'red'. Second yellow => red. */
export function applyCard(player, card) {
  if (card === 'red') { player.sentOff = true; return 'red'; }
  player.yellows = (player.yellows || 0) + 1;
  if (player.yellows >= 2) { player.sentOff = true; return 'red'; }
  return 'yellow';
}
