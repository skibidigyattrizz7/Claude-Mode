// Player entity: creation, speeds, stamina and per-state motion (tackles, slides, skills, dives).
import { clamp, turnToward, angDiff } from './util.js';
import { PITCH } from './constants.js';

let NEXT_ID = 1;

export function makePlayer(team, idx, info) {
  return {
    id: NEXT_ID++, team, idx, role: info.role, num: info.num, name: info.name,
    attrs: { ...info.attrs },
    x: 0, y: 0, vx: 0, vy: 0, facing: 0,
    want: { x: 0, y: 0 }, sprint: false, faceWant: null,
    stamina: 1, speedMul: 1, anim: Math.random() * 6,
    state: 'run', stateT: 0, stateDur: 0,
    tk: null, skill: null, invuln: 0, kickCD: 0, tackleCD: 0, recover: 0,
    charge: 0, charging: false, shotMod: null,
    human: -1, sentOff: false, yellows: 0,
    saveIntent: false, saveKick: -1, holdT: 0,
    ai: { decT: 0, dribDir: null, kickSeen: -1, pendingDive: null, mark: null, tackT: 0 },
  };
}

export function jogSpeed(p) { return (5.0 + 0.9 * p.attrs.pace) * p.speedMul; }

export function topSpeed(p, sprint) {
  const base = sprint && p.stamina > 0.04 ? 6.9 + 1.7 * p.attrs.pace : 5.0 + 0.9 * p.attrs.pace;
  const fatigue = p.stamina < 0.3 ? 0.8 + 0.66 * p.stamina : 1;
  return base * fatigue * p.speedMul;
}

const SKILLS = {
  stepover: { dur: 0.5, inv: [0.0, 0.45], cost: 0.05 },
  roulette: { dur: 0.55, inv: [0.05, 0.55], cost: 0.06 },
  dragback: { dur: 0.42, inv: [0.08, 0.42], cost: 0.04 },
  heelflick: { dur: 0.35, inv: [0.0, 0.35], cost: 0.05 },
};
export const SKILL_NAMES = { stepover: 'Step-over', roulette: 'Roulette', dragback: 'Drag-back', heelflick: 'Heel flick' };

/** Start a skill move; type chosen from input direction relative to facing. */
export function startSkill(p, moveX, moveY, sprinting) {
  if (p.state !== 'run' || p.stamina < 0.05) return null;
  let type = 'stepover';
  const mag = Math.hypot(moveX, moveY);
  if (sprinting && mag > 0.3) type = 'heelflick';
  else if (mag > 0.3) {
    const d = angDiff(p.facing, Math.atan2(moveY, moveX));
    if (Math.abs(d) > 2.2) type = 'dragback';
    else if (Math.abs(d) > 0.7) type = 'roulette';
  }
  const S = SKILLS[type];
  const side = mag > 0.3 ? Math.sign(angDiff(p.facing, Math.atan2(moveY, moveX))) || 1 : (Math.random() < 0.5 ? -1 : 1);
  p.state = 'skill'; p.stateT = 0; p.stateDur = S.dur;
  p.skill = { type, side, f0: p.facing, inv: S.inv };
  p.stamina = Math.max(0, p.stamina - S.cost);
  return type;
}

/** Is the player currently protected from standing tackles by a skill move? */
export function isEvading(p) {
  if (p.state !== 'skill' || !p.skill) return false;
  return p.stateT >= p.skill.inv[0] && p.stateT <= p.skill.inv[1];
}

function approach(p, tx, ty, accel, dt) {
  const dx = tx - p.vx, dy = ty - p.vy;
  const d = Math.hypot(dx, dy);
  const m = accel * dt;
  if (d <= m) { p.vx = tx; p.vy = ty; } else { p.vx += (dx / d) * m; p.vy += (dy / d) * m; }
}

/** Advance one player's motion for dt according to its state. */
export function stepPlayer(p, dt) {
  if (p.sentOff) { p.vx = p.vy = 0; return; }
  p.stateT += dt;
  p.kickCD = Math.max(0, p.kickCD - dt);
  p.tackleCD = Math.max(0, p.tackleCD - dt);
  p.recover = Math.max(0, p.recover - dt);
  const sp = Math.hypot(p.vx, p.vy);

  switch (p.state) {
    case 'tackle': {
      const dir = p.tk.dir;
      const v = p.stateT < 0.2 ? Math.max(p.tk.speed0, 3) + 1.8 : Math.max(0, sp - 18 * dt);
      p.vx = Math.cos(dir) * v; p.vy = Math.sin(dir) * v; p.facing = dir;
      if (p.stateT >= p.stateDur) { p.state = 'run'; p.recover = 0.25; }
      break;
    }
    case 'slide': {
      const dir = p.tk.dir;
      const k = clamp(1 - p.stateT / p.stateDur, 0, 1);
      const v = Math.max(8, p.tk.speed0 + 2) * Math.sqrt(k);
      p.vx = Math.cos(dir) * v; p.vy = Math.sin(dir) * v; p.facing = dir;
      if (p.stateT >= p.stateDur) { p.state = 'down'; p.stateT = 0; p.stateDur = 0.55; }
      break;
    }
    case 'down':
    case 'hold':
      approach(p, 0, 0, 25, dt);
      if (p.state === 'down' && p.stateT >= p.stateDur) { p.state = 'run'; p.recover = 0.2; }
      break;
    case 'dive':
      // velocity set by keeper AI at dive start; decelerate at the end
      if (p.stateT > p.stateDur * 0.6) approach(p, 0, 0, 14, dt);
      if (p.stateT >= p.stateDur) { p.state = 'down'; p.stateT = 0; p.stateDur = 0.45; }
      break;
    case 'skill': {
      const s = p.skill, t = p.stateT;
      const f0 = s.f0;
      if (s.type === 'stepover') {
        // feint: shuffle, then burst diagonally
        if (t < 0.28) { approach(p, Math.cos(f0) * 2.5, Math.sin(f0) * 2.5, 30, dt); p.facing = f0 + Math.sin(t * 22) * 0.5; }
        else { const a = f0 + s.side * 0.75; approach(p, Math.cos(a) * 7.5, Math.sin(a) * 7.5, 40, dt); p.facing = turnToward(p.facing, a, 12 * dt); }
      } else if (s.type === 'roulette') {
        p.facing = f0 + s.side * (t / p.stateDur) * Math.PI * 2;
        const a = f0 + s.side * Math.PI / 2;
        approach(p, Math.cos(a) * 4.2, Math.sin(a) * 4.2, 30, dt);
      } else if (s.type === 'dragback') {
        p.facing = turnToward(p.facing, f0 + Math.PI, 14 * dt);
        approach(p, -Math.cos(f0) * 2.2, -Math.sin(f0) * 2.2, 30, dt);
      } else {
        approach(p, Math.cos(f0) * 7.8, Math.sin(f0) * 7.8, 30, dt);
      }
      if (t >= p.stateDur) { p.state = 'run'; p.skill = null; }
      break;
    }
    default: {
      // 'run' and 'celebrate'
      let tx = p.want.x, ty = p.want.y;
      const max = topSpeed(p, p.sprint);
      const wm = Math.hypot(tx, ty);
      if (wm > max) { tx *= max / wm; ty *= max / wm; }
      const accel = (wm < sp ? 26 : 19) * (p.recover > 0 ? 0.4 : 1);
      approach(p, tx, ty, accel, dt);
      const nsp = Math.hypot(p.vx, p.vy);
      if (nsp > 0.6) p.facing = turnToward(p.facing, Math.atan2(p.vy, p.vx), 11 * dt);
      else if (p.faceWant != null) p.facing = turnToward(p.facing, p.faceWant, 8 * dt);
    }
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  // keep players around the field
  p.x = clamp(p.x, -3, PITCH.L + 3); p.y = clamp(p.y, -3, PITCH.W + 3);
  const nsp = Math.hypot(p.vx, p.vy);
  p.anim += nsp * dt * 2.3;
  // stamina
  const jog = jogSpeed(p);
  if (p.sprint && nsp > jog * 1.02 && p.state === 'run') p.stamina -= dt * (0.085 - 0.035 * p.attrs.stamina);
  else p.stamina += dt * (nsp < 2 ? 0.05 : 0.028);
  p.stamina = clamp(p.stamina, 0, 1);
}
