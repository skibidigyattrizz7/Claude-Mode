// Set pieces in the top-down view: throw-ins, corners, goal kicks and indirect free kicks,
// with a human aiming UI (reticle, power bar, curve) or AI execution. Penalties and direct
// free kicks near goal are handed to the first-person KickScene via match.kickRequest.
import { PITCH, CY, GOAL, BALL_R, PEN_SPOT } from './constants.js';
import { placeBall, solveKick } from './physics.js';
import { choosePassTarget, clampToPitch } from './passing.js';
import { formationPos } from './ai.js';
import { stepPlayer, topSpeed } from './player.js';
import { clamp, dist, norm } from './util.js';

export const SP_LABEL = { throw: 'Throw-in', corner: 'Corner kick', goalkick: 'Goal kick', freekick: 'Free kick', fk3d: 'Free kick', penalty: 'Penalty' };

export function beginSetPiece(m, r) {
  m.state = 'setpiece'; m.stateT = 0;
  m.owner = null; m.pass = null; m.shot = null; m.pendingSave = null; m.kickRequest = null;
  const bx = clamp(r.x, 0, PITCH.L), by = clamp(r.y, 0, PITCH.W);
  placeBall(m.ball, bx, by); m.ball.kickId++;
  const sp = m.sp = { ...r, x: bx, y: by, t: 0, phase: 'setup', taker: null, human: null, aim: null, power: 0, charging: false, curve: 0, aiT: 0 };
  for (const p of m.players) { if (!p.sentOff) { p.state = 'run'; p.tk = null; p.skill = null; p.charging = false; p.saveIntent = false; p.ai.pendingDive = null; } }
  const dir = m.attackDir(r.team);
  const mates = m.mates(r.team);
  const gk = mates.find((p) => p.role === 'GK');
  let taker;
  if (r.type === 'goalkick') taker = gk;
  else if (r.type === 'penalty' || r.type === 'fk3d') taker = mates.filter((p) => p.role !== 'GK').sort((a, b) => b.attrs.shooting - a.attrs.shooting)[0];
  else taker = mates.filter((p) => p.role !== 'GK').sort((a, b) => dist(a, sp) - dist(b, sp))[0];
  sp.taker = taker;
  const h = m.humans.find((hh) => hh.team === r.team);
  if (h) { sp.human = h; if (taker.role !== 'GK') m.setHumanPlayer(h, taker); }
  if (r.type === 'penalty' || r.type === 'fk3d') {
    m.banner(r.type === 'penalty' ? 'PENALTY!' : 'FREE KICK', m.teams[r.team].name, '#ffffff', 1.6);
    sp.phase = 'kickscene';
    return;
  }
  // default aim point
  const side = m.attackSide(r.team);
  const gx = side === 1 ? PITCH.L : 0;
  if (r.type === 'corner') sp.aim = { x: gx - dir * (PEN_SPOT - 2), y: CY + (by < CY ? -2 : 2) };
  else if (r.type === 'throw') sp.aim = clampToPitch({ x: bx + dir * 8, y: by < CY ? by + 9 : by - 9 }, 2, 2);
  else if (r.type === 'goalkick') sp.aim = clampToPitch({ x: bx + dir * 35, y: CY + (by < CY ? -10 : 10) }, 3, 3);
  else sp.aim = clampToPitch({ x: bx + dir * 20, y: by + (CY - by) * 0.4 }, 3, 3);
  placeTargets(m, sp);
}

/** Compute where every player should stand for the restart. */
function placeTargets(m, sp) {
  const dir = m.attackDir(sp.team);
  const side = m.attackSide(sp.team);
  const gx = side === 1 ? PITCH.L : 0;
  const boxSpots = [
    { x: gx - dir * 7, y: CY - 3 }, { x: gx - dir * 11, y: CY + 2 }, { x: gx - dir * 5, y: CY + 3 }, { x: gx - dir * 14, y: CY - 5 },
  ];
  let bi = 0;
  const attackers = m.mates(sp.team);
  const defenders = m.opps(sp.team);
  for (const p of attackers) {
    if (p === sp.taker) continue;
    if (sp.type === 'corner' && p.role !== 'GK' && p.role !== 'DF' && bi < boxSpots.length) p.spTarget = boxSpots[bi++];
    else if (sp.type === 'corner' && p.role === 'DF' && bi < 4 && p.idx === 1) p.spTarget = boxSpots[bi++];
    else { const f = formationPos(m, p, 1); p.spTarget = f; }
  }
  // defenders: mark attackers in the box for corners, otherwise shape
  const markables = attackers.filter((a) => a.spTarget && sp.type === 'corner' && Math.abs(a.spTarget.x - gx) < 16);
  let mi = 0;
  for (const p of defenders) {
    if (p.role === 'GK') { p.spTarget = { x: gx - dir * 0.6, y: CY }; continue; }
    if (sp.type === 'corner' && mi < markables.length) {
      const a = markables[mi++].spTarget;
      p.spTarget = { x: a.x + dir * 0.9, y: a.y + (a.y < CY ? -0.4 : 0.4) };
    } else p.spTarget = formationPos(m, p, -1);
  }
  // taker stands behind the ball; everybody else keeps their distance
  const tgt = sp.aim;
  const n = norm(tgt.x - sp.x, tgt.y - sp.y);
  if (sp.type === 'throw') sp.taker.spTarget = { x: sp.x, y: sp.y < CY ? -0.35 : PITCH.W + 0.35 };
  else sp.taker.spTarget = { x: sp.x - n.x * 0.7, y: sp.y - n.y * 0.7 };
  const minD = sp.type === 'throw' ? 3 : 9.15;
  for (const p of m.players) {
    if (p.sentOff || p === sp.taker || !p.spTarget) continue;
    let t = clampToPitch(p.spTarget, 0.8, 0.8);
    if (p.team !== sp.team || sp.type === 'goalkick') {
      const dx = t.x - sp.x, dy = t.y - sp.y, d = Math.hypot(dx, dy);
      if (d < minD) {
        const u = d > 0.1 ? { x: dx / d, y: dy / d } : { x: -dir, y: 0 };
        t = clampToPitch({ x: sp.x + u.x * minD, y: sp.y + u.y * minD }, 0.8, 0.8);
      }
    }
    if (sp.type === 'goalkick' && p.team !== sp.team) {
      // opponents must be outside the penalty area
      const ownGx = side === 1 ? 0 : PITCH.L;
      if (Math.abs(t.x - ownGx) < 17.5) t.x = ownGx + dir * 17.5;
    }
    p.spTarget = t;
  }
}

function walk(p, t, dt) {
  const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
  const sp = Math.min(topSpeed(p, d > 6), d * 3);
  p.want.x = d > 0.1 ? (dx / d) * sp : 0; p.want.y = d > 0.1 ? (dy / d) * sp : 0;
  p.sprint = d > 6;
  stepPlayer(p, dt);
}

export function updateSetPiece(m, dt) {
  const sp = m.sp;
  if (!sp) { m.state = 'play'; return; }
  sp.t += dt;
  if (sp.phase === 'kickscene' || sp.phase === 'waiting') {
    for (const p of m.players) { if (!p.sentOff) { p.want.x *= 0.9; p.want.y *= 0.9; stepPlayer(p, dt); } }
    if (sp.phase === 'kickscene' && sp.t > 1.4) {
      const def = 1 - sp.team;
      const hk = m.humans.find((h) => h.team === def);
      m.kickRequest = {
        kind: sp.type === 'penalty' ? 'penalty' : 'freekick', team: sp.team, x: sp.x, y: sp.y,
        side: m.attackSide(sp.team), shooter: sp.taker, keeper: m.keeper(def),
        humanShooter: sp.human ? sp.human.ctrl : null, humanKeeper: sp.type === 'penalty' && hk ? hk.ctrl : null,
      };
      sp.phase = 'waiting';
    }
    return;
  }
  // players walk to their spots
  for (const p of m.players) {
    if (p.sentOff) continue;
    if (p.spTarget) walk(p, p.spTarget, dt); else stepPlayer(p, dt);
    p.faceWant = Math.atan2(m.ball.y - p.y, m.ball.x - p.x);
  }
  if (sp.phase === 'setup') {
    if (sp.t > 1.3) {
      for (const p of m.players) if (p.spTarget && !p.sentOff && dist(p, p.spTarget) > 1.5) { p.x = p.spTarget.x; p.y = p.spTarget.y; p.vx = p.vy = 0; }
      sp.phase = 'aim'; sp.t = 0;
    }
    return;
  }
  const taker = sp.taker;
  taker.facing = Math.atan2(sp.aim.y - sp.y, sp.aim.x - sp.x);
  if (sp.type === 'throw') { placeBall(m.ball, taker.x, taker.y); m.ball.z = 2.0; }
  if (sp.human) humanAim(m, sp, dt);
  else {
    sp.aiT += dt;
    if (sp.aiT > 0.9 + m.prof[sp.team].react) aiExecute(m, sp);
  }
}

function humanAim(m, sp, dt) {
  const h = sp.human;
  const c = m.ctrls[h.ctrl];
  if (!c) return;
  const mv = c.move();
  const aw = m.aimWorld[h.ctrl];
  if (aw) sp.aim = { x: aw.x, y: aw.y };
  else { sp.aim.x += mv.x * 16 * dt; sp.aim.y += mv.y * 16 * dt; }
  const maxD = sp.type === 'throw' ? 26 : 60;
  const dx = sp.aim.x - sp.x, dy = sp.aim.y - sp.y, d = Math.hypot(dx, dy);
  if (d > maxD) { sp.aim.x = sp.x + (dx / d) * maxD; sp.aim.y = sp.y + (dy / d) * maxD; }
  sp.aim = clampToPitch(sp.aim, 0.5, 0.5);
  if (sp.type !== 'throw') {
    if (c.isHeld('lob')) sp.curve = clamp(sp.curve - dt * 1.6, -1, 1);
    if (c.isHeld('through')) sp.curve = clamp(sp.curve + dt * 1.6, -1, 1);
  }
  if (sp.t < 0.25) return;   // ignore inputs held over from before the restart
  const pressedPass = c.wasPressed('pass') || (h.ctrl === 0 && m.mouseClick);
  if (c.isHeld('shoot')) { sp.charging = true; sp.power = Math.min(1, sp.power + dt / 1.1); }
  else if (sp.charging) { executeSetPiece(m, 'long', sp.aim, sp.power, sp.curve); return; }
  if (pressedPass) executeSetPiece(m, 'short', sp.aim, 0.5, 0);
}

function aiExecute(m, sp) {
  const dir = m.attackDir(sp.team);
  const side = m.attackSide(sp.team);
  const gx = side === 1 ? PITCH.L : 0;
  const mates = m.mates(sp.team).filter((p) => p !== sp.taker);
  if (sp.type === 'corner') {
    const tgt = { x: gx - dir * (5 + Math.random() * 7), y: CY + (Math.random() - 0.5) * 9 };
    const inswing = curveTowardGoal(sp, tgt, { x: gx, y: CY });
    executeSetPiece(m, 'long', tgt, 0.55 + Math.random() * 0.3, inswing * (0.4 + Math.random() * 0.5));
    return;
  }
  if (sp.type === 'goalkick') {
    if (Math.random() < 0.55) {
      const fw = mates.find((p) => p.role === 'FW') || mates[0];
      executeSetPiece(m, 'long', clampToPitch({ x: fw.x + dir * 4, y: fw.y }, 3, 3), 0.8, 0);
    } else {
      const df = mates.filter((p) => p.role === 'DF').sort((a, b) => dist(a, sp) - dist(b, sp))[0] || mates[0];
      sp.aim = { x: df.x, y: df.y };
      executeSetPiece(m, 'short', sp.aim, 0.5, 0);
    }
    return;
  }
  // throw-ins and indirect free kicks: find the best open teammate
  const opps = m.opps(sp.team);
  let best = null, bs = -1e9;
  for (const q of mates) {
    if (q.role === 'GK') continue;
    const d = dist(q, sp);
    if (d < 3 || d > (sp.type === 'throw' ? 22 : 40)) continue;
    const space = Math.min(...opps.map((o) => dist(o, q)));
    const s = Math.min(space, 7) + ((q.x - sp.x) * dir) / 8 - d / 20;
    if (s > bs) { bs = s; best = q; }
  }
  if (!best) best = mates[0];
  sp.aim = { x: best.x, y: best.y };
  const far = sp.type === 'freekick' && Math.abs(gx - sp.x) < 40 && Math.random() < 0.5;
  if (far) executeSetPiece(m, 'long', { x: gx - dir * (8 + Math.random() * 6), y: CY + (Math.random() - 0.5) * 12 }, 0.7, 0);
  else executeSetPiece(m, 'short', sp.aim, 0.5, 0);
}

/** Curve sign that bends the ball towards `toward` (inswinger). */
function curveTowardGoal(from, tgt, toward) {
  const tx = tgt.x - from.x, ty = tgt.y - from.y;
  const side = -ty * (toward.x - from.x) + tx * (toward.y - from.y);
  return side >= 0 ? 1 : -1;
}

/** Take the restart. kind: 'short' (pass/throw to a teammate) or 'long' (to the aim point). */
export function executeSetPiece(m, kind, aim, power, curve) {
  const sp = m.sp;
  const taker = sp.taker;
  const b = m.ball;
  const dir = { x: aim.x - sp.x, y: aim.y - sp.y };
  const aimDir = norm(dir.x, dir.y);
  m.sp = null; m.state = 'play'; m.stateT = 0;
  for (const p of m.players) p.spTarget = null;
  taker.state = 'run';
  const h = sp.human;
  if (sp.type === 'throw') {
    const from = { x: taker.x + aimDir.x * 0.3, y: clamp(taker.y, 0.05, PITCH.W - 0.05), z: 2.0 };
    b.x = from.x; b.y = from.y; b.z = 2.0;
    let target = aim, receiver = null;
    if (kind === 'short') {
      const sel = choosePassTarget(taker, m.mates(sp.team), m.opps(sp.team), aimDir, 'ground', m.attackDir(sp.team));
      if (sel) { target = sel.target; receiver = sel.mate; }
      else target = clampToPitch({ x: sp.x + aimDir.x * 10, y: sp.y + aimDir.y * 10 }, 1, 1);
    } else receiver = nearestMate(m, sp.team, aim, taker);
    const d = Math.hypot(target.x - from.x, target.y - from.y);
    const hs = kind === 'short' ? clamp(d / 0.85, 6, 15) : 9 + power * 10;
    const v = solveKick(from, { x: target.x, y: target.y, z: 0.5 }, hs, { loft: true });
    m.kick(taker, v.vx, v.vy, Math.min(v.vz, 12), 0, 0, 0.3);
    b.z = 2.0;
    m.pass = { from: taker, receiver, target, team: sp.team, kind: 'throw', t: m.time, eta: v.t };
    m.stats[sp.team].passAtt++;
    if (receiver && h) m.setHumanPlayer(h, receiver);
    m.emit('setpieceTaken', { type: sp.type, kind });
    return;
  }
  if (kind === 'short') {
    m.owner = taker;           // doPass requires the taker to be on the ball
    m.doPass(taker, 'ground', null, aimDir);
    m.emit('setpieceTaken', { type: sp.type, kind });
    return;
  }
  const hs = 13 + power * 17;
  const tz = sp.type === 'corner' ? 1.3 : 0.4;
  const v = solveKick({ x: b.x, y: b.y, z: BALL_R }, { x: aim.x, y: aim.y, z: tz }, hs, { spin: curve * 1.3, loft: true });
  const receiver = nearestMate(m, sp.team, aim, taker);
  m.kick(taker, v.vx, v.vy, Math.min(v.vz, 17), curve * 1.3, 0, 0.5 + power * 0.5);
  m.pass = { from: taker, receiver, target: aim, team: sp.team, kind: 'lob', t: m.time, eta: v.t };
  m.stats[sp.team].passAtt++;
  if (receiver) {
    receiver.ai.decT = 0.1;
    if (h) m.setHumanPlayer(h, receiver);
  }
  m.emit('setpieceTaken', { type: sp.type, kind });
}

function nearestMate(m, team, pt, exclude) {
  let best = null, bd = 1e9;
  for (const p of m.mates(team)) {
    if (p === exclude || p.role === 'GK') continue;
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Predicted flight of the current set-piece aim for drawing the arc (top-down). */
export function predictSetPiece(m) {
  const sp = m.sp;
  if (!sp || sp.phase !== 'aim' || !sp.aim) return null;
  const power = sp.charging ? sp.power : 0.6;
  const b = m.ball;
  if (sp.type === 'throw') {
    const hs = 9 + power * 10;
    const v = solveKick({ x: b.x, y: b.y, z: 2 }, { x: sp.aim.x, y: sp.aim.y, z: 0.5 }, hs, { loft: true });
    return { v, from: { x: b.x, y: b.y, z: 2 }, spin: 0 };
  }
  const hs = 13 + power * 17;
  const tz = sp.type === 'corner' ? 1.3 : 0.4;
  const v = solveKick({ x: b.x, y: b.y, z: BALL_R }, { x: sp.aim.x, y: sp.aim.y, z: tz }, hs, { spin: sp.curve * 1.3, loft: true });
  return { v, from: { x: b.x, y: b.y, z: BALL_R }, spin: sp.curve * 1.3 };
}
