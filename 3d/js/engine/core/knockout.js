// Knockout finish for MatchSim: penalty shootout after extra time (extra time itself is handled by
// the sim's period logic: halves 3 and 4 are 15 game-minutes each). Alternate takers, best of five
// then sudden death; everybody shoots at the +x goal. DOM-free.
import { PHASE, SP, BALL_R } from './constants.js';
import { stepBall, classifyBall, predictBall } from './physics.js';
import * as AI from './ai.js';
import { ps } from './playstyles.js';

export const tally = (so) => [so.kicks[0].reduce((a, b) => a + b, 0), so.kicks[1].reduce((a, b) => a + b, 0)];

// Is the shootout decided? (best of five, then sudden death with equal kicks)
export function decided(so) {
  const [a, b] = tally(so);
  const na = so.kicks[0].length, nb = so.kicks[1].length;
  if (na <= 5 && nb <= 5) {
    if (a + (5 - na) < b || b + (5 - nb) < a) return true;
    return na === 5 && nb === 5 && a !== b;
  }
  return na === nb && a !== b;
}

const penSkill = (m) => m.a.sho * 0.7 + m.a.pas * 0.1 + ps(m, 'deadball') * 8 + ps(m, 'finesse') * 2;

export function startShootout(sim) {
  const first = sim.firstKickoff;
  const order = [0, 1].map((team) => {
    const out = sim.teamList[team].filter((m) => !m.isGK && !m.sentOff).sort((a, b) => penSkill(b) - penSkill(a)).map((m) => m.idx);
    const g = sim.gk(team);
    if (g && !g.sentOff) out.push(g.idx);
    return out;
  });
  sim.shootout = { first, kicks: [[], []], order, team: first, taker: -1, resolved: true, done: false };
  sim.pendingShot = [null, null];
  sim.fxPush('cut');
  nextPenalty(sim);
}

export function nextPenalty(sim) {
  const so = sim.shootout;
  const team = so.kicks[0].length === so.kicks[1].length ? so.first : 1 - so.first;
  const ord = so.order[team];
  const taker = ord[so.kicks[team].length % ord.length];
  // everyone shoots at the +x goal
  sim.dir = team === 0 ? [1, -1] : [-1, 1];
  so.team = team; so.taker = taker; so.resolved = false; so.kickT = -1;
  sim._setupSetPiece({ type: SP.PENALTY, team, x: 0, z: 0, taker, shootout: true });
}

// PLAY phase during a shootout: only the ball and the keeper move until the kick is resolved.
export function stepPlay(sim, dt) {
  const so = sim.shootout, b = sim.ball, t = sim.t;
  if (so.resolved) return;
  if (so.kickT < 0) so.kickT = t;
  if (b.owner < 0 && (!sim.path || t >= sim.nextPredict)) { sim.path = predictBall(b, 2, 0.02); sim.nextPredict = t + 0.08; }
  const g = sim.gk(1 - so.team);
  for (const p of sim.players) {
    if (p.sentOff) continue;
    if (p === g) { if (!sim.isHumanCtrl(p) || !(p.act && p.act.type === 'dive')) AI.think(sim, p, dt); }
    else { p.des.x = 0; p.des.z = 0; }
  }
  sim._movePlayers(dt);
  sim._collide();
  if (b.owner >= 0) {
    // keeper holds it
    if (sim.players[b.owner].isGK && sim.players[b.owner].team !== so.team) return record(sim, false);
    b.owner = -1;
  }
  stepBall(b, dt, sim.physEv);
  sim._physFx();
  if (!g.sentOff && sim._gkTouch(g)) {
    if (b.owner >= 0) return record(sim, false);
  }
  const c = classifyBall(b.p);
  if (c) return record(sim, c.type === 'goal' && c.side === 1);
  const el = t - so.kickT;
  const away = b.v.x < -0.5 && b.p.x < 52.5 - 1.5;
  const dead = Math.hypot(b.v.x, b.v.y, b.v.z) < 0.6 && b.p.y < BALL_R + 0.05;
  if (el > 3.2 || (el > 0.5 && (away || dead))) record(sim, false);
}

export function record(sim, ok) {
  const so = sim.shootout;
  if (so.resolved) return;
  so.resolved = true;
  so.kicks[so.team].push(ok ? 1 : 0);
  sim.fxPush('pen', { team: so.team, ok: ok ? 1 : 0, pi: so.taker, h: tally(so)[0], a: tally(so)[1] });
  sim.fxPush('whistle', { n: 1 });
  if (ok) sim.fxPush('net', { x: sim.ball.p.x, y: sim.ball.p.y, z: sim.ball.p.z, s: 12 });
  sim.emit({ type: 'penalty', team: sim.sideName(so.team), scored: ok, playerId: sim.players[so.taker].data.id, pens: tally(so) });
  if (decided(so)) so.done = true;
  // short pause, then the next kick (or the end)
  sim.phase = PHASE.STOP; sim.phaseT = sim.t; sim.stopDur = ok ? 1.9 : 1.6;
  sim.pending = { type: SP.PENALTY, team: 1 - so.team, x: 0, z: 0, shootout: true };
  sim.buffer = [null, null];
}

export function afterKick(sim) {
  if (sim.shootout.done) sim._fullTime();
  else nextPenalty(sim);
}
