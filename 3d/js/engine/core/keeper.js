// Goalkeeper AI (operates on a MatchSim; DOM-free, seeded RNG only so it stays deterministic on the host).
//   * shots: react from reflexes, then dive to the predicted crossing (plan / startDive in sim.js)
//   * sweeping: loose balls and through balls behind the defence that he reaches before any attacker (ball-path
//     prediction against everybody's run time), claimed with his hands inside the box or cleared with his feet outside it
//   * crosses / high balls: jump-catch or punch inside the box (`gkjump` act, resolved in sim._gkTouch)
//   * one-on-ones: come out on the ball-to-goal line, set as the shooter closes, lunge at his feet when it is on
//     (sim.gkSmother: a real contest against the dribbler, see sim._gkLungeResolve)
// The human's keeper is only ever driven from here while it is NOT the controlled player (sim calls think() for AI
// players only), so a human who switches to the keeper is never overridden.
import { PITCH, GOAL, BOX } from './constants.js';
import { clamp, segDist } from './mathx.js';
import { inOwnPenaltyArea } from './rules.js';
import { ps } from './playstyles.js';
import { goTo, gkDistribute, headerCheck } from './ai.js';

const HW = PITCH.HW;

// Numbers derived from the keeper's attributes (pos / spd / han / ref / div) and the difficulty.
export function keeperTraits(sim, p) {
  const a = p.a, diff = sim.diffFor(p.team);
  const rush = ps(p, 'rushout');
  return {
    // seconds after a ball is played before he reacts to it (good positioning + high difficulty read it earlier)
    read: Math.max(0.05, 0.06 + (100 - a.pos) * 0.003 + diff.react * 0.28 - rush * 0.03),
    // how much earlier than the first attacker he must get to a ball outside his box before he leaves his line
    margin: clamp(0.5 - (a.pos - 50) * 0.006 - rush * 0.08 - diff.level * 0.02, 0.12, 0.6),
    // furthest point from his goal line (metres) he will sweep to
    sweepX: BOX.DEPTH + 5.5 + (a.pos - 60) * 0.16 + rush * 4 + diff.level * 0.8,
    // highest ball (m) he can take with a jump inside the box
    hiY: p.h + 0.75,
    pos: a.pos, han: a.han, div: a.div, cc: ps(p, 'crossclaimer'), rush,
  };
}

// The first point on the predicted ball path that he can get to before the ball does (with time to spare):
// {t (s until the ball is there), x, y, z, inBox} or null.
function reachPlan(sim, p, T) {
  const path = sim.path;
  if (!path) return null;
  const b = sim.ball, team = p.team, t = sim.t, dir = sim.dir[team];
  const el = t - (sim.pathT == null ? t : sim.pathT);
  const start = Math.max(0, b.kickT + T.read - t);
  const vG = Math.max(3, p.vmax * sim.stamFactor(p) * 0.94);
  let prevY = b.p.y;
  for (const s of path) {
    const st = s.t - el;
    const rising = s.y > prevY + 0.02;
    prevY = s.y;
    if (st < 0.02 || rising) continue;
    if (st > 2.6) break;
    const X = sim.X(team, s.x);
    if (X < 0.2) break;
    if (X > T.sweepX || Math.abs(s.z) > HW - 1) continue;
    const inBox = inOwnPenaltyArea(s.x, s.z, dir);
    if (s.y > (inBox ? T.hiY : p.h + 0.2)) continue; // outside the box: feet, chest or a header only
    const dist = Math.hypot(s.x - p.x, s.z - p.z);
    const tg = start + 0.06 + Math.max(0, dist - (inBox ? 0.9 : 0.55)) / vG + (dist > 1.5 ? 0.12 : 0);
    if (tg <= st) return { t: st, x: s.x, y: s.y, z: s.z, inBox, dist };
  }
  return null;
}

// Should he go for the ball? Compares the time the ball reaches his interception point with the first attacker's (and
// team-mates') arrival. Returns the plan (with .aerial) or null.
function evalSweep(sim, p, T) {
  const b = sim.ball, team = p.team, t = sim.t;
  if (b.owner >= 0 || !sim.path) return null;
  if (b.lastTeam === team && b.intended >= 0 && b.intended !== p.idx) return null;
  const sh = sim.shotTracker.shot;
  if (sh && sh.team !== team && Math.abs(sh.t - b.kickT) < 0.3) return null; // a shot: the save machinery handles it
  const plan = reachPlan(sim, p, T);
  if (!plan) return null;
  const el = t - (sim.pathT == null ? t : sim.pathT);
  let oppT = 99, ownT = 99;
  for (const o of sim.teamList[1 - team]) { if (!o.sentOff) oppT = Math.min(oppT, sim.intercept(o).t - el); }
  for (const m of sim.teamList[team]) { if (!m.sentOff && !m.isGK) ownT = Math.min(ownT, sim.intercept(m).t - el); }
  const aerial = plan.y > 1.15;
  const cur = !!(p.sweep && p.sweep.kickT === b.kickT && p.sweep.until > t);
  let need;
  if (aerial && plan.inBox) need = -(0.05 + T.cc * 0.12 + (T.han - 70) * 0.0012 + (cur ? 0.08 : 0)); // "keeper's": he comes for a cross even when it is close
  else if (plan.inBox) need = -0.12 - (cur ? 0.08 : 0);
  else need = T.margin - (cur ? 0.1 : 0);
  if (plan.t + need > oppT) return null;
  if (ownT + 0.15 < plan.t && !(aerial && plan.inBox)) return null; // a defender is comfortably first
  plan.aerial = aerial;
  return plan;
}

function nearestOppTo(sim, team, x, z) {
  let near = 99;
  for (const o of sim.teamList[1 - team]) near = Math.min(near, Math.hypot(o.x - x, o.z - z));
  return near;
}

export function gkThink(sim, p, dt) {
  const t = sim.t, team = p.team, b = sim.ball, gl = sim.ownGoalX(team), dir = sim.dir[team];
  if (b.owner === p.idx) return gkHold(sim, p);
  const owner = sim.owner();
  const T = keeperTraits(sim, p);

  // ---- loose ball / cross: sweep it up, jump-catch or punch it
  if (!owner) {
    const R = evalSweep(sim, p, T);
    if (R) {
      p.sweep = { kickT: b.kickT, until: t + 0.3 };
      p.sweepUntil = t + 0.3;
      p.gkPlan = null;
      p.ready = false;
      if (R.aerial && R.inBox) {
        if (R.t < 0.34 && R.dist < 1.7 && !p.act) {
          let crowd = 0;
          for (const o of sim.teamList[1 - team]) if (Math.hypot(o.x - R.x, o.z - R.z) < 2.2) crowd++;
          const punchNow = sim.rng() < sim.gkPunchP(p, crowd, R.y);
          p.act = { type: 'gkjump', t0: t, dur: 0.7, punch: punchNow ? 1 : 0, punchNow, claim: 1, jh: 0.5 };
          return;
        }
      } else if (R.aerial) {
        headerCheck(sim, p); // a dropping ball outside his box: he heads it clear (no hands out there)
      } else if (R.inBox && b.p.y < 0.7 && t > p.cool.tackle) {
        // an attacker is about to get there as well: lunge at it
        const bd = Math.hypot(b.p.x - p.x, b.p.z - p.z), bs = Math.hypot(b.v.x, b.v.z);
        if (bd < 3.2 && bd > 0.7 && bs < 9 && nearestOppTo(sim, team, b.p.x, b.p.z) < 3 && inOwnPenaltyArea(b.p.x, b.p.z, dir)) { sim.gkDiveAtBall(p); return; }
      }
      goTo(sim, p, R, 'sprint', 0.05);
      return;
    }
    p.sweep = null; p.sweepUntil = 0;
    // a scramble in the box: nobody clearly first, he still attacks a ball that is close to him
    const bd = Math.hypot(b.p.x - p.x, b.p.z - p.z), bs = Math.hypot(b.v.x, b.v.z);
    if (b.p.y < 0.7 && bs < 9 && bd < 3.2 && bd > 0.7 && t > p.cool.tackle && inOwnPenaltyArea(b.p.x, b.p.z, dir) && b.lastTeam !== team
      && nearestOppTo(sim, team, b.p.x, b.p.z) < 3) { sim.gkDiveAtBall(p); return; }
  }

  // ---- shots (and anything else heading for the goal): react, then dive to the predicted crossing
  if (b.owner < 0) {
    const vTo = -dir * b.v.x;
    // a new kick replaces any stale plan (rebounds, deflections, second shots)
    if (vTo > 4 && (!p.gkPlan || p.gkPlan.kickT !== b.kickT) && sim.X(team, b.p.x) < 45 && b.lastTeam !== team && sim.path && !(p.act && p.act.type === 'dive')) {
      const plan = sim.planSave(p);
      if (plan) { plan.kickT = b.kickT; p.gkPlan = plan; }
    }
  }
  if (p.gkPlan) {
    const pl = p.gkPlan;
    if (t > pl.tc + 0.6 || b.owner >= 0) p.gkPlan = null;
    else if (t >= pl.tReact) {
      if (!pl.acted && sim.path && t - (pl.refT || 0) > 0.09) {
        const np = sim.planSave(p);
        if (np) Object.assign(pl, { tc: np.tc, x: np.x, y: np.y, z: np.z, gz: np.gz, gy: np.gy, refT: t });
      }
      const dz = pl.z - p.z, timeLeft = pl.tc - t;
      const wide = Math.abs(pl.gz) > GOAL.HW + 0.5 || pl.gy > GOAL.H + 0.6;
      if (!pl.acted) {
        if (wide && Math.abs(dz) > 1.6) pl.acted = true;
        else if (Math.abs(dz) > 0.75 || pl.y > p.h + 0.3) {
          if (timeLeft < 0.45) { pl.acted = true; sim.startDive(p, pl); }
        }
      }
      if (!pl.acted && timeLeft < 0.6 && Math.abs(dz) > 0.5) { p.des.x *= 0.5; p.des.z *= 0.5; p.ready = true; return; }
      if (!pl.acted || pl.step) {
        goTo(sim, p, { x: pl.x, z: pl.z }, 'run', 0.05);
        const sh = Math.hypot(p.des.x, p.des.z), cap = 2.8 + p.a.spd * 0.012;
        if (sh > cap) { p.des.x *= cap / sh; p.des.z *= cap / sh; }
        p.ready = true;
        return;
      }
      if (p.act) return;
    }
  }
  if (p.act) return;

  // ---- one-on-one against the man with the ball
  if (owner && owner.team !== team && !b.inHands) {
    if (oneOnOne(sim, p, owner, T)) return;
    p.oo = null;
  } else p.oo = null;

  // ---- positioning on the angle bisector between the posts (near-post coverage)
  const bx = b.p.x, bz = b.p.z;
  const dA = Math.hypot(bx - gl, bz + GOAL.HW), dB = Math.hypot(bx - gl, bz - GOAL.HW);
  const zP = -GOAL.HW + (2 * GOAL.HW * dA) / (dA + dB);
  const tx = bx - gl, tz = bz - zP;
  const dist = Math.hypot(tx, tz) || 1;
  const far = sim.X(team, bx) > 52;
  const sweeperK = 1 + (T.pos - 70) * 0.004 + T.rush * 0.1; // a sweeper-keeper (good positioning / Rush Out) holds a higher line
  const depth = clamp((0.8 + (dist - 5) * 0.085) * sweeperK, 0.7, far ? 13 * sweeperK : 5.2);
  const posErr = (100 - p.a.pos) * 0.004;
  let x = gl + (tx / dist) * depth;
  let z = zP + (tz / dist) * depth * (1 + posErr);
  z = clamp(z, -(GOAL.HW - 0.3) - (depth > 3 ? 4 : 0), GOAL.HW - 0.3 + (depth > 3 ? 4 : 0));
  if (dir * (x - gl) < 0.3) x = gl + dir * 0.3;
  goTo(sim, p, { x, z }, dist < 30 ? 'run' : 'jog', 0.15);
  p.ready = dist < 30;
}

// Attacker through on goal: narrow the angle on the line between the ball and the middle of the goal, set as the shooter
// closes, lunge at his feet (or pounce on a heavy touch, see the loose-ball branch above) at a moment that varies with
// the keeper's attributes. Returns true when it handled the keeper this tick.
function oneOnOne(sim, p, owner, T) {
  const t = sim.t, team = p.team, b = sim.ball, gl = sim.ownGoalX(team), dir = sim.dir[team];
  const oX = sim.X(team, owner.x);
  if (oX > 36 || Math.abs(owner.z) > 30) return false;
  // is somebody goal-side of him and in the way? then it is not a one-on-one (the old "covered" rule, but only
  // defenders between him and the goal count: a trailing defender does not cover anything)
  let cover = 0;
  for (const m of sim.teamList[team]) {
    if (m.isGK || m.sentOff) continue;
    if (sim.X(team, m.x) > oX + 0.5) continue;
    const sd = segDist(m.x, m.z, owner.x, owner.z, gl, 0);
    if (sd.d < 3.2 && Math.hypot(m.x - owner.x, m.z - owner.z) < 11) cover++;
  }
  if (cover > 0 && oX > 13) return false;
  if (!p.oo || p.oo.who !== owner.idx) {
    // per-encounter randomness: how early / late this keeper commits
    p.oo = { who: owner.idx, t0: t, rushAt: 2.5 + sim.rng() * 1.0 + (T.div - 70) * 0.012 + T.rush * 0.3 };
  }
  const bp = { x: b.p.x + owner.vx * 0.18, z: b.p.z + owner.vz * 0.18 };
  const gd = Math.hypot(bp.x - gl, bp.z);
  const ux = (bp.x - gl) / (gd || 1), uz = bp.z / (gd || 1);
  const dd = Math.hypot(owner.x - p.x, owner.z - p.z);
  const bd = Math.hypot(b.p.x - p.x, b.p.z - p.z);
  const closing = Math.max(0, -((owner.vx - p.vx) * (owner.x - p.x) + (owner.vz - p.vz) * (owner.z - p.z)) / (dd || 1));
  // lunge at the feet: inside the box only (hands), after a short read, once the ball is inside his reach for the dive
  if (t > p.cool.tackle && t - p.oo.t0 > 0.2 && inOwnPenaltyArea(p.x, p.z, dir) && inOwnPenaltyArea(b.p.x, b.p.z, dir)
    && bd - closing * 0.16 < p.oo.rushAt && bd > 0.6) {
    sim.gkSmother(p, owner);
    return true;
  }
  // narrow the angle: further out the closer the shooter is to goal, capped by how brave the keeper is
  // From range he holds the old, shot-friendly depth (a driven shot from 15 m gives him no time to react if he is too far
  // out); as the shooter gets inside about 11 m he closes the gap to `gap` metres off the ball, on the line.
  const maxOut = 5.6 + (T.pos - 60) * 0.06 + T.rush * 1.5;
  const gap = 4.4 + (100 - T.pos) * 0.03 - T.rush * 0.6; // how far off the ball he wants to be when set
  const rangeOut = clamp((0.8 + (gd - 5) * 0.085) * (1 + (T.pos - 70) * 0.004 + T.rush * 0.1), 0.7, 5.2);
  const closeOut = clamp(gd - gap, 1.1, maxOut);
  const w = clamp((13 - gd) / 4, 0, 1);
  const out = clamp(rangeOut + (closeOut - rangeOut) * w, 1.1, maxOut);
  const target = { x: gl + ux * out, z: uz * out };
  goTo(sim, p, target, 'sprint', 0.12);
  // do not run into the shooter: ease off as he closes so the keeper stays big and set
  if (dd < 7.5) {
    const cap = clamp((dd - 2.6) * 1.1 + 1.2, 0.8, p.vmax);
    const sh = Math.hypot(p.des.x, p.des.z);
    if (sh > cap) { p.des.x *= cap / sh; p.des.z *= cap / sh; }
    p.sprint = false;
  }
  p.ready = true; // eyes on the ball, side-on shuffle (sim._movePlayers)
  if (dd < 9.5) p.gkSetT = t;
  return true;
}

// The keeper has the ball. In his hands: hold it a moment, then distribute (gkDistribute). At his feet (a sweep, a
// back-pass): no idling, he plays it or clears it almost at once.
function gkHold(sim, p) {
  const b = sim.ball, t = sim.t;
  if (b.inHands) return gkDistribute(sim, p);
  p.des.x = 0; p.des.z = 0;
  const pressed = sim.pressureOn(p) < 3.5;
  if (t - p.gainT < (pressed ? 0.12 : 0.4)) return;
  gkFeetPlay(sim, p);
}

// Ball at the keeper's feet: a short pass to a free team-mate when it is safe, else a clearance.
export function gkFeetPlay(sim, p) {
  const team = p.team, rng = sim.rng;
  const pressed = sim.pressureOn(p) < 4;
  let best = null, bs = -1e9;
  if (!pressed) {
    for (const m of sim.teamList[team]) {
      if (m === p || m.sentOff) continue;
      const dist = Math.hypot(m.x - p.x, m.z - p.z);
      if (dist < 6 || dist > 32) continue;
      const open = sim.openness(m);
      const s = open * 0.3 - dist * 0.03;
      if (open > 6 && s > bs) { bs = s; best = m; }
    }
  }
  if (best) return sim.aiKick(p, 'ground', { target: best.idx, power: 0.55 });
  const wide = Math.abs(p.z) > 10 && rng() < 0.4;
  const z = wide ? Math.sign(p.z) * (HW + 5) : clamp(p.z * 1.4 + (rng() - 0.5) * 44, -40, 40);
  sim.aiKick(p, 'lob', { point: { x: sim.wx(team, clamp(sim.X(team, p.x) + (wide ? 22 : 40), 30, 80)), z }, power: 0.9, elev: 0.6, noClamp: true, clear: true });
}
