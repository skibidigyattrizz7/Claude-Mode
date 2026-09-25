// Human set pieces and human goalkeeping for MatchSim. DOM-free.
//  - Penalties and direct free kicks: a crosshair on the goal mouth (WHERE; movement keys / left
//    stick + right stick / mouse), a power bar from the held kick key (HOW HARD) and a shrinking
//    timing ring under the ball (WHEN: releasing while it is smallest gives the best accuracy).
//  - Free kicks add a ball contact point (left/right side = curl, low = lift, high = dip, dead
//    centre with power = knuckle) moved with switch/tackle (left/right) and skill/jockey (up/down)
//    or the d-pad.
//  - Human keeper: pick a dive side for penalties; in open play dive with the tackle key.
import { SP, GOAL, PHASE } from './constants.js';
import { clamp, wrapAngle, angleTo } from './mathx.js';
import { solveShot } from './passing.js';
import { ps } from './playstyles.js';

const KICK_KEYS = ['pass', 'through', 'lob', 'shoot', 'finesse'];
const HOLD_KEYS = ['pass', 'through', 'lob', 'shoot', 'finesse', 'tackle', 'switchP', 'skill', 'jockey'];

export function initSetPiece(sim, sp, taker) {
  sp.kx = 0; sp.ky = 0; sp.t0 = sim.t;
  sp.period = clamp(1.35 - (taker.a.sho - 60) * 0.004 - ps(taker, 'deadball') * 0.1, 0.9, 1.5);
  sp.cross = false;
  if (sp.type === SP.PENALTY) { sp.cross = true; sp.aimZ = 0; sp.aimY = 1.0; }
  else if (sp.type === SP.FREEKICK && !sp.indirect) {
    const gx = sim.goalX(sp.team);
    const D = Math.hypot(gx - sp.ball.x, sp.ball.z);
    const ang = Math.abs(Math.atan2(sp.ball.z, Math.abs(gx - sp.ball.x)));
    if (D < 35 && ang < 1.05) { sp.cross = true; sp.aimZ = -(Math.sign(sp.ball.z) || 1) * 2.3; sp.aimY = 1.85; }
  }
}

// timing ring radius 1 (big) .. 0 (smallest, best), cycling
export function ring(sim, sp) {
  const u = (sim.t - (sp.t0 ?? sim.t)) / (sp.period || 1.3);
  return Math.abs(Math.cos(Math.PI * u));
}
export const timingMul = (r) => 0.45 + 1.6 * r;

export function step(sim, team, dt, inp, el) {
  const sp = sim.sp, p = sim.players[sp.taker];
  const prev = sim.prevIn[team] || {};
  const H = sim.holds[team];
  for (const k of HOLD_KEYS) if (inp[k]) H[k] = (H[k] || 0) + dt;
  const released = (k) => !inp[k] && !!prev[k];
  const mv = sim._worldMove(inp);
  const cw = { x: +inp.cx || 0, z: -(+inp.cy || 0) };
  const d = sim.dir[team];
  if (sp.cross) {
    const cz = mv.z + cw.z, cu = (mv.x + cw.x) * d;
    sp.aimZ = clamp(sp.aimZ + cz * 3.2 * dt, -GOAL.HW - 1.5, GOAL.HW + 1.5);
    sp.aimY = clamp(sp.aimY + cu * 1.9 * dt, 0.15, GOAL.H + 1.2);
    sp.aim = Math.atan2(sp.aimZ - sp.ball.z, sim.goalX(team) - sp.ball.x);
    if (sp.type === SP.FREEKICK) {
      const kx = (+inp.kx || 0) + (inp.tackle ? 1 : 0) - (inp.switchP ? 1 : 0);
      const ky = (+inp.ky || 0) + (inp.skill ? 1 : 0) - (inp.jockey ? 1 : 0);
      sp.kx += kx * 1.7 * dt; sp.ky += ky * 1.7 * dt;
      const l = Math.hypot(sp.kx, sp.ky);
      if (l > 1) { sp.kx /= l; sp.ky /= l; }
      sp.curve = sp.kx;
    }
  } else {
    if (mv.l > 0.2) sp.aim = wrapAngle(angleTo(sp.aim, Math.atan2(mv.z, mv.x), 1.3 * dt));
    if (inp.switchP) sp.curve = clamp(sp.curve - 1.4 * dt, -1, 1);
    if (inp.tackle) sp.curve = clamp(sp.curve + 1.4 * dt, -1, 1);
    sp.kx = sp.curve;
  }
  const heldKey = KICK_KEYS.find((k) => inp[k]);
  const power = heldKey ? clamp(H[heldKey] / 1, 0.05, 1) : 0.6;
  const r = ring(sim, sp);
  sim.aimInfo[team] = { setPiece: true, type: sp.type, aim: sp.aim, curve: sp.curve, aimZ: sp.aimZ, aimY: sp.aimY, power, held: !!heldKey, cross: sp.cross, kx: sp.kx, ky: sp.ky, ring: r };
  // preview trajectory (no error) for deliveries; crosshair shots only show the crosshair
  if (!sp.cross || (heldKey && heldKey !== 'shoot' && heldKey !== 'finesse')) {
    const pk = sim._setPiecePlan(p, sp, heldKey || sim._defaultSpKey(sp), power);
    sim.aimInfo[team].preview = pk ? { vel: pk.vel, spin: pk.spin, from: pk.from || { ...sim.ball.p } } : null;
  }
  const quick = sp.quick && el > 0.05;
  if (el < 0.5 && !quick) { for (const k of HOLD_KEYS) if (!inp[k]) H[k] = 0; return; }
  for (const k of KICK_KEYS) {
    if (released(k) && (H[k] || 0) > 0) {
      const pw = clamp(H[k] / 1, 0.05, 1);
      const plan = sim._setPiecePlan(p, sp, k, pw, r);
      sim.aimInfo[team] = null;
      if (plan) sim._execute(p, plan);
      break;
    }
  }
  for (const k of HOLD_KEYS) if (!inp[k]) H[k] = 0;
}

// Crosshair shot for a penalty or a direct free kick. ringV = timing ring value at release.
export function crosshairPlan(sim, p, sp, key, power, ringV) {
  const team = p.team, gx = sim.goalX(team);
  const a = p.a, db = ps(p, 'deadball');
  const from = { ...sim.ball.p };
  const tm = timingMul(ringV ?? ring(sim, sp));
  if (sp.type === SP.PENALTY) {
    const plan = sim._plan(p, 'penalty', { tz: sp.aimZ, ty: sp.aimY, power });
    if (!plan) return null;
    // error grows with power, with how close to the post/bar the aim is, and with bad timing
    const edge = Math.min(GOAL.HW - Math.abs(sp.aimZ), GOAL.H - sp.aimY);
    const edgeMul = 1 + clamp((0.8 - edge) / 0.8, 0, 1.4) * 0.9;
    plan.info.errMul = edgeMul * tm * (1 - db * 0.15);
    plan.info.timing = ringV;
    return plan;
  }
  const kx = sp.kx || 0, ky = sp.ky || 0;
  const speed = 16.5 + power * (10 + a.sho * 0.06 + db * 1.5) + (key === 'shoot' ? 1.5 : 0);
  const W = 20 + a.sho * 0.25 + db * 6 + (key === 'finesse' ? 7 : 0) + ps(p, 'finesse') * 3;
  const dx = gx - from.x, dz = sp.aimZ - from.z, dl = Math.hypot(dx, dz) || 1;
  const fx = dx / dl, fz = dz / dl;
  const top = ky * 26;
  const spin = { x: fz * top, y: kx * W, z: -fx * top };
  const knuckle = Math.abs(kx) < 0.22 && Math.abs(ky) < 0.22 && power > 0.7;
  if (knuckle) { spin.x = 0; spin.y = 0; spin.z = 0; }
  let ty = sp.aimY;
  if (power > 0.82) ty += (power - 0.82) * 14;
  const vel = solveShot(from, { x: gx, y: ty, z: sp.aimZ }, speed, spin);
  if (!vel || !Number.isFinite(vel.x + vel.y + vel.z)) return null;
  return {
    vel, spin, from,
    info: { kind: 'fk', pass: false, shot: true, target: -1, power: Math.min(power, 0.85), point: { x: gx, z: sp.aimZ }, errMul: (1 - db * 0.18) * tm * (knuckle ? 1.35 : 1), knuckle, timing: ringV },
  };
}

// defending human keeper during a penalty: the direction held when the kick is struck
export function keeperPenaltyInput(sim, sp, team, inp) {
  const mv = sim._worldMove(inp);
  const g = sim.gk(team);
  if (sim.human[team]) sim.ctrl[team] = g.idx;
  if (mv.l > 0.35) {
    const side = Math.abs(mv.z) > 0.3 ? Math.sign(mv.z) : 0;
    const high = mv.x * sim.dir[1 - team] > 0.35; // pushing toward the goal line/taker = high
    if (!sp.gkIn || sp.gkIn.side !== side || sp.gkIn.high !== high) sp.gkIn = { side, high, t: sim.t };
  } else sp.gkIn = null;
}

// apply the human keeper's choice at the moment of the kick (plan = sim.planSave result)
export function keeperPenaltyPlan(sim, g, sp, plan) {
  const gi = sp.gkIn;
  if (!gi || !gi.side) { plan.z = g.z; plan.y = gi && gi.high ? 1.9 : 1.1; plan.step = true; return plan; }
  const reach = 1.4 + g.a.div * 0.012 + (g.h - 1.85) * 1.5 + ps(g, 'farreach') * 0.25;
  plan.z = g.z + gi.side * Math.min(reach + 0.8, 3.0);
  plan.y = gi.high ? 1.85 : 0.45;
  // committing much too early lets the ball be placed; a late pick reacts slower
  plan.tReact = sim.t + (sim.t - gi.t > 0.9 ? -0.1 : 0.02);
  return plan;
}

// human keeper dive in open play (tackle key): toward the stick side, or the predicted crossing
export function humanDive(sim, g, mv, inp) {
  if (g.act || sim.t < g.cool.tackle) return;
  const owner = sim.owner();
  if (owner && owner.team !== g.team && Math.hypot(owner.x - g.x, owner.z - g.z) < 2.4) { sim.gkSmother(g, owner); return; }
  let plan = sim.path && sim.ball.owner < 0 ? sim.planSave(g) : null;
  const t = sim.t;
  if (!plan) plan = { tReact: t, tc: t + 0.4, x: g.x, y: 1.0, z: g.z, gz: g.z, gy: 1.0 };
  const side = Math.abs(mv.z) > 0.3 ? Math.sign(mv.z) : Math.sign(plan.z - g.z) || 1;
  const reach = 1.4 + g.a.div * 0.012 + (g.h - 1.85) * 1.5 + ps(g, 'farreach') * 0.25;
  if (Math.abs(mv.z) > 0.3) plan.z = g.z + side * Math.max(0.9, Math.min(reach + 0.6, Math.abs(plan.z - g.z) || reach));
  if (inp && inp.sprint) plan.y = Math.max(plan.y, 1.8);
  plan.acted = true;
  g.gkPlan = plan;
  sim.startDive(g, plan);
  g.cool.tackle = t + 1.2;
}

export { PHASE };
