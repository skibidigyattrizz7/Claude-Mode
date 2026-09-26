// Match-rule helpers: tackles/fouls/cards, offside, shot outcome (goal vs save). DOM-free.
import { PITCH, BOX } from './constants.js';

// Is the tackler behind the victim? victimFace = facing angle (rad, dir = (cos,sin) in x/z).
// Returns true when the tackler comes from within a ~110 degree cone behind the victim.
export function isFromBehind(tackler, victim, victimFace) {
  const fx = Math.cos(victimFace), fz = Math.sin(victimFace);
  const tx = tackler.x - victim.x, tz = tackler.z - victim.z;
  const l = Math.hypot(tx, tz) || 1e-6;
  return (fx * tx + fz * tz) / l < -0.57;
}

/**
 * Decide whether a tackle is a foul, and which card.
 *  wonBall      – tackler touched the ball before any contact with the opponent
 *  contactFirst – tackler hit the opponent's body/legs before (or without) touching the ball
 *  fromBehind   – tackle came from behind the opponent
 *  slide        – slide tackle (vs standing)
 *  bodyContact  – there was contact with the opponent at all
 *  lastMan      – the victim was clean through on goal (denial of an obvious goal-scoring opportunity)
 * Front-on (or side) tackles that win the ball cleanly are never fouls.
 */
export function judgeTackle({ wonBall = false, contactFirst = false, fromBehind = false, slide = false, bodyContact = false, lastMan = false }) {
  if (wonBall && !contactFirst && !fromBehind) return { foul: false, card: null };
  if (contactFirst) {
    return { foul: true, card: slide ? (lastMan ? 'red' : 'yellow') : (lastMan ? 'yellow' : null) };
  }
  if (fromBehind && slide && (bodyContact || wonBall)) {
    return { foul: true, card: lastMan ? 'red' : 'yellow' };
  }
  if (fromBehind && !wonBall && bodyContact) {
    return { foul: true, card: lastMan ? 'yellow' : null };
  }
  return { foul: false, card: null };
}

// Is a foul at world position (x,z) inside the penalty area defended by the team attacking `dir`?
// (a team attacking +x defends the box at x = -52.5)
export function inOwnPenaltyArea(x, z, defendingDir) {
  const X = x * defendingDir + PITCH.HL; // 0 at own goal line
  return X >= -0.5 && X <= BOX.DEPTH && Math.abs(z) <= BOX.HW;
}

// Second-last opponent position along the attack direction (usually last outfield defender).
export function offsideLineX(defenderXs, dir) {
  const arr = defenderXs.map((x) => x * dir).sort((a, b) => b - a);
  const second = arr.length >= 2 ? arr[1] : -Infinity;
  return second * dir;
}

/**
 * Simple linear offside check evaluated at the moment of the pass.
 * receiverX, ballX: world x; defenderXs: all opponents incl. keeper; dir: attack direction (+1/-1)
 */
export function isOffside({ receiverX, ballX, defenderXs, dir, margin = 0.1 }) {
  const r = receiverX * dir;
  if (r <= 0) return false; // own half
  if (r <= ballX * dir + margin) return false; // not ahead of the ball
  const line = offsideLineX(defenderXs, dir) * dir;
  return r > line + margin;
}

/**
 * Tracks the outcome of a shot so a goal and a save are never both reported for it.
 * A keeper touch only counts as a save if the ball had not wholly crossed the line,
 * and the save is only confirmed after `confirmDelay` seconds without a goal.
 */
export class ShotTracker {
  constructor(confirmDelay = 1.0) {
    this.delay = confirmDelay;
    this.shot = null;
  }
  onShot(team, t, playerIdx) {
    this.shot = { team, t, by: playerIdx, touched: false, touchT: 0, onTarget: false };
  }
  // returns true if the touch is a valid (pending) save
  onKeeperTouch(t, ballWhollyOver) {
    if (!this.shot || ballWhollyOver) return false;
    this.shot.touched = true;
    this.shot.touchT = t;
    return true;
  }
  // a goal: cancels any pending save for the shot
  onGoal() {
    const s = this.shot;
    this.shot = null;
    return { goal: true, shot: s };
  }
  // ball went dead without a goal
  onDead(t) {
    return this.update(t, true);
  }
  // returns {save:true, shot} once a keeper touch is confirmed, or {expired} / null
  update(t, dead = false) {
    const s = this.shot;
    if (!s) return null;
    if (s.touched && (dead || t - s.touchT >= this.delay)) {
      this.shot = null;
      return { save: true, shot: s };
    }
    if (dead || t - s.t > 4) { this.shot = null; return { expired: true, shot: s }; }
    return null;
  }
}
