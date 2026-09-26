// Team + player AI: shape (tactics-driven width / depth / mentality), pressing styles, marking with
// runner tracking and passing-lane cover, support runs (in behind, overlaps, box runs), carrier
// decisions with a pass-interception model, goalkeeping (angle bisector, 1v1 rushes, claiming loose
// balls and crosses), set-piece takers. Operates on a MatchSim instance. DOM-free.
import { PITCH, GOAL, BOX, BALL_R, SP } from './constants.js';
import { clamp, lerp, segDist, hypot2 } from './mathx.js';
import { isOffside, inOwnPenaltyArea } from './rules.js';
import { leadPass, rollSpeedFor, rollTimeTo } from './passing.js';
import { passArrive, throughLead } from './assist.js';
import { ps } from './playstyles.js';
import { instr } from './tactics.js';

const HL = PITCH.HL, HW = PITCH.HW;
const tacOf = (sim, team) => (sim.tac && sim.tac[team]) || { defensiveStyle: 'balanced', buildUp: 'balanced', chanceCreation: 'balanced', width: 5, depth: 5, playersInBox: 5, corners: 3, freeKicks: 3, mentality: 0, instructions: {} };

// ------------------------------------------------------------------ team level
export function teamThink(sim, team) {
  const info = sim.info[team];
  const b = sim.ball;
  const owner = sim.owner();
  const mates = sim.teamList[team];
  const opps = sim.teamList[1 - team];
  const tac = tacOf(sim, team);
  const human = sim.human[team];
  const gp = human ? sim.gp[team] : null;
  const wasAtt = info.attacking;
  info.ballX = sim.X(team, b.p.x);
  info.attacking = owner ? owner.team === team : b.lastTeam === team;
  if (wasAtt && !info.attacking) info.lostT = sim.t;
  if (!wasAtt && info.attacking) info.wonT = sim.t;
  const xs = opps.map((o) => sim.X(team, o.x)).sort((a, c) => c - a);
  info.offLine = Math.max(xs[1] ?? HL, HL, info.ballX);
  info.chaser = -1; info.chaser2 = -1; info.chaseT = Infinity;
  const ctrlIdx = human ? sim.ctrl[team] : -1;
  if (!owner) {
    // an opposition pass has to be READ before anyone commits to cutting it out (no psychic
    // interceptions): each outfielder gets a reaction delay from difficulty, defending and the
    // Anticipate / Intercept PlayStyles, with the odd misread. Until then he holds his position.
    const pp = sim.pendingPass;
    const oppPass = !!pp && pp.team !== team && b.kicker >= 0 && sim.players[b.kicker].team !== team && b.kickT === pp.t;
    if (oppPass && info.readKick !== b.kickT) {
      info.readKick = b.kickT;
      for (const m of mates) m.readAt = b.kickT + readDelay(sim, m);
    }
    // human teams: the controlled player is the user's call; the AI picks its own best chaser
    // (a teammate still goes for a loose ball / cuts out a pass rather than leaving it to the user),
    // except for our own pass, which the reception assist handles.
    const ownPass = b.intended >= 0 && sim.players[b.intended].team === team;
    const skipCtrl = human && !ownPass;
    let best = Infinity, second = Infinity, ctrlT = Infinity;
    for (const m of mates) {
      m.ic = sim.intercept(m);
      if (m.isGK && !sim.gkMayChase(m)) continue;
      if (oppPass && !m.isGK && sim.t < (m.readAt || 0)) continue;
      if (skipCtrl && m.idx === ctrlIdx) { ctrlT = m.ic.t; continue; }
      if (m.ic.t < best) { second = best; info.chaser2 = info.chaser; best = m.ic.t; info.chaser = m.idx; }
      else if (m.ic.t < second) { second = m.ic.t; info.chaser2 = m.idx; }
    }
    // the user is clearly first to it: one AI teammate only follows up if he is close behind
    if (skipCtrl && ctrlT + 0.7 < best && !oppPass) { info.chaser2 = -1; if (ctrlT + 1.4 < best) info.chaser = -1; }
    info.chaseT = Math.min(best, ctrlT);
  }
  // pressers (tactics: defensive style; human teams: aiDefending assisted / tactical) plus ONE
  // cover player who sits goal-side behind whoever engages the carrier (presser + cover).
  info.press1 = -1; info.press2 = -1; info.contain = false; info.cover = -1; info.coverPt = null;
  if (owner && owner.team !== team && !b.inHands) {
    const px = owner.x + owner.vx * 0.35, pz = owner.z + owner.vz * 0.35;
    const ranked = mates.filter((m) => !m.isGK && m.idx !== ctrlIdx && !m.sentOff)
      .map((m) => ({ m, d: Math.hypot(m.x - px, m.z - pz) / m.vmax, dist: Math.hypot(m.x - px, m.z - pz) }))
      .sort((a, c) => a.d - c.d);
    const oX = sim.X(team, owner.x);
    const ownThird = oX < 40;
    let engaged = null; // who is (or will be) on the ball: the presser or the user
    if (human) {
      info.contain = true;
      // is the user already engaging the carrier? then no AI double-press: cover him instead
      const c = sim.players[ctrlIdx];
      const cd = c && !c.isGK ? Math.hypot(c.x - px, c.z - pz) : 99;
      const userOn = cd < 7 || (ranked[0] && cd / c.vmax < ranked[0].d + 0.25);
      if (userOn) engaged = c;
      if (gp.aiDefending === 'assisted') {
        if (!userOn && ranked[0]) info.press1 = ranked[0].m.idx;
        const r2 = userOn ? ranked[0] : ranked[1];
        if (r2 && ownThird && r2.dist < 3) info.press2 = r2.m.idx;
      } else if (ranked[0] && ranked[0].dist < 3 && !(userOn && cd < 2.5)) info.press1 = ranked[0].m.idx;
    } else {
      const style = tac.defensiveStyle;
      const afterLoss = style === 'pressAfterLoss' && sim.t - (info.lostT || -9) < 5;
      const drop = style === 'dropBack' && !afterLoss;
      if (ranked[0] && !(drop && oX > 60 && ranked[0].dist > 6)) info.press1 = ranked[0].m.idx;
      const pr2 = style === 'constantPressure' || afterLoss ? 6 : drop ? 0 : 3.5;
      if (ranked[1] && (sim.diffFor(team).press >= 0.75 || ownThird || style === 'constantPressure' || afterLoss) && ranked[1].d < pr2) info.press2 = ranked[1].m.idx;
    }
    if (info.press1 >= 0) engaged = sim.players[info.press1];
    // cover: in our half, the best-placed free teammate takes the space behind the engaged player
    if (engaged && oX < 68 && info.press2 < 0) {
      const own = sim.ownGoalX(team);
      const gx = own - owner.x, gz = -owner.z * 0.6, gl = Math.hypot(gx, gz) || 1;
      const back = ownThird ? 5 : 7;
      const pt = { x: owner.x + (gx / gl) * back, z: owner.z + (gz / gl) * back };
      let bc = null, bs = 1e9;
      for (const r of ranked) {
        const m = r.m;
        if (m.idx === info.press1 || m === engaged) continue;
        // prefer players already goal-side of the ball (they don't have to recover)
        const s = Math.hypot(m.x - pt.x, m.z - pt.z) + (sim.X(team, m.x) > oX ? 8 : 0);
        if (s < bs) { bs = s; bc = m; }
      }
      if (bc && bs < 18) { info.cover = bc.idx; info.coverPt = pt; }
    }
  }
  for (const m of mates) if (!m.isGK) m.home = formationTarget(sim, m, info);
  if (!info.attacking && (!human || gp.autoMarking)) assignMarking(sim, team, info);
  if (info.attacking && owner && owner.team === team) planRuns(sim, team, info, owner);
}

export function formationTarget(sim, p, info) {
  const team = p.team, d = sim.dir[team], s = p.sd;
  const tac = tacOf(sim, team);
  const bx = info.ballX, bz = sim.ball.p.z;
  const att = info.attacking;
  const ment = tac.mentality || 0;
  const depthOff = (tac.depth - 5) * (att ? 1.4 : 2.2) + ment * 3 + (tac.defensiveStyle === 'constantPressure' ? 3 : tac.defensiveStyle === 'dropBack' ? -4 : 0);
  const lineX = att ? clamp(bx - 30 + depthOff, 18, 64) : clamp(bx - 19 + depthOff, 9, 50);
  const block = att ? 48 + ment * 3 : 34;
  let X = lineX + ((s.d - 0.19) / 0.51) * block;
  const wide = Math.abs(s.l) > 0.6;
  const aIns = instr(sim, p, 'attack'), dIns = instr(sim, p, 'defend'), sIns = instr(sim, p, 'support');
  if (p.group === 'DEF') {
    X = lineX + (s.d - 0.19) * 25;
    const sideBall = Math.sign(bz * d * s.l) > 0;
    if (att && wide && sIns !== 'stayBack' && dIns !== 'stayBack') {
      if ((bx > 50 && sideBall) || sIns === 'overlap') X += 14; // overlap on the ball side
      else if (bx > 60) X += 6;
    }
    if (dIns === 'stayBack' || sIns === 'stayBack') X = Math.min(X, 45);
  }
  if (att && aIns === 'comeShort') X -= 6;
  if (!att && aIns === 'stayForward') X = Math.max(X, 50);
  if (p.group === 'FWD' || s.r === 'CAM') {
    if (!(p.run && p.run.until > sim.t)) X = Math.min(X, info.offLine - 0.8);
  }
  X = clamp(X, 4, 101);
  // width: in possession the wide players hug the touchline (stretch the play)
  const dw = 21 + (tac.width - 5) * 1.8;
  let z;
  if (att) {
    z = s.l * d * 30 + bz * 0.22;
    if ((wide || sIns === 'stayWide') && sIns !== 'cutInside') {
      const sgn = Math.sign(s.l * d) || 1;
      const farSide = Math.sign(bz) === -sgn && Math.abs(bz) > 12;
      z = sgn * (farSide ? HW - 8 : HW - 2.2);
    }
    if (sIns === 'cutInside' && X > 70) z *= 0.55;
  } else {
    z = s.l * d * dw + bz * 0.42;
    if (p.group === 'DEF') z = s.l * d * (17 + (tac.width - 5) * 1.2) + bz * 0.35;
  }
  z = clamp(z, -HW + 1.2, HW - 1.2);
  if (att && p.space && p.space.until > sim.t) {
    X = lerp(X, sim.X(team, p.space.x), 0.6);
    z = lerp(z, p.space.z, 0.6);
  }
  return { x: sim.wx(team, X), z };
}

function assignMarking(sim, team, info) {
  const human = sim.human[team];
  const tactical = human && sim.gp[team].aiDefending === 'tactical';
  const ctrl = human ? sim.ctrl[team] : -1;
  const opps = sim.teamList[1 - team].filter((o) => !o.isGK);
  const mates = sim.teamList[team].filter((m) => !m.isGK && m.idx !== info.press1 && m.idx !== info.press2 && m.idx !== ctrl && (m.group !== 'FWD' || instr(sim, m, 'defend') === 'markPlayer'));
  const own = { x: sim.ownGoalX(team), z: 0 };
  opps.sort((a, c) => sim.X(team, a.x) - sim.X(team, c.x));
  const used = new Set();
  const owner = sim.owner();
  const lineX = Math.min(...mates.filter((m) => m.group === 'DEF').map((m) => sim.X(team, m.home.x)), 60);
  for (const o of opps) {
    if (owner === o) continue;
    const oX = sim.X(team, o.x);
    const running = o.run && o.run.until > sim.t;
    if (oX > 70 && !running) continue; // far from our goal: zonal only
    let best = null, bd = running ? 20 : 14;
    for (const m of mates) {
      if (used.has(m.idx)) continue;
      const dd = Math.hypot(m.home.x - o.x, m.home.z - o.z);
      if (dd < bd) { bd = dd; best = m; }
    }
    if (!best) continue;
    used.add(best.idx);
    // track runners: aim at where the runner is going, goal side
    const tx = running ? o.x + (o.run.x - o.x) * 0.35 : o.x, tz = running ? o.z + (o.run.z - o.z) * 0.35 : o.z;
    const gx = own.x - tx, gz = own.z - tz;
    const gl = Math.hypot(gx, gz) || 1;
    let mark = { x: tx + (gx / gl) * 1.7, z: tz + (gz / gl) * 1.7 };
    // cover the passing lane from the carrier
    if (owner && owner.team !== team) {
      const lane = instr(sim, best, 'defend') === 'cutPasses' ? 0.6 : human ? (tactical ? 0 : 0.45) : 0.3;
      const cx = owner.x - o.x, cz = owner.z - o.z, cl = Math.hypot(cx, cz) || 1;
      const lp = { x: o.x + (cx / cl) * Math.min(2.8, cl * 0.4), z: o.z + (cz / cl) * Math.min(2.8, cl * 0.4) };
      mark = { x: lerp(mark.x, lp.x, lane), z: lerp(mark.z, lp.z, lane) };
    }
    // offside trap: don't follow a runner beyond our line when the ball is far
    if (!running && oX < lineX - 2 && info.ballX > lineX + 25) continue;
    let w = oX < 40 || running ? 0.85 : 0.5;
    if (tactical) w *= 0.6;
    if (instr(sim, best, 'defend') === 'markPlayer') w = 0.95;
    best.home = { x: lerp(best.home.x, mark.x, w), z: lerp(best.home.z, mark.z, w) };
  }
}

function planRuns(sim, team, info, owner) {
  const t = sim.t, rng = sim.rng;
  const tac = tacOf(sim, team);
  const cX = sim.X(team, owner.x);
  const runMul = (tac.chanceCreation === 'forwardRuns' ? 1.8 : tac.chanceCreation === 'possession' ? 0.6 : 1) * (tac.buildUp === 'counter' && t - (info.wonT || -9) < 6 ? 2 : 1) * (1 + (tac.mentality || 0) * 0.2);
  const crossing = cX > 70 && Math.abs(owner.z) > 14;
  const boxN = Math.round(1 + tac.playersInBox * 0.4);
  let inBox = 0;
  for (const m of sim.teamList[team]) if (m !== owner && sim.X(team, m.x) > 88 && Math.abs(m.z) < 16) inBox++;
  const d = sim.dir[team];
  for (const m of sim.teamList[team]) {
    if (m === owner || m.isGK || sim.isHumanCtrl(m)) continue;
    if (m.run && m.run.until > t) continue;
    const mX = sim.X(team, m.x);
    const aIns = instr(sim, m, 'attack'), sIns = instr(sim, m, 'support');
    // runs in behind the last line
    const behindOk = m.group === 'FWD' || m.sd.r === 'CAM' || (m.group === 'MID' && Math.abs(m.sd.l) > 0.6) || aIns === 'getInBehind';
    if (behindOk && aIns !== 'comeShort' && cX > 34 && mX > info.offLine - 7 && mX < info.offLine + 0.5) {
      const facing = Math.cos(owner.face) * d > 0.2;
      if (rng() < 0.05 * runMul * (0.6 + m.a.pac / 120) * (facing ? 1.4 : 0.7) * (aIns === 'getInBehind' ? 1.8 : 1)) {
        const X = clamp(info.offLine + 8 + rng() * 9, 60, 100);
        const z = clamp(m.z * 0.7 + (rng() - 0.5) * 12, -28, 28);
        m.run = { x: sim.wx(team, X), z, until: t + 2.6 };
        continue;
      }
    }
    // overlap: the full-back on the carrier's side runs past a wide carrier
    if (m.group === 'DEF' && Math.abs(m.sd.l) > 0.6 && Math.sign(m.z) === Math.sign(owner.z) && Math.abs(owner.z) > 15 && cX > 45 && cX < 88 && mX < cX - 2
      && instr(sim, m, 'defend') !== 'stayBack' && sIns !== 'stayBack' && rng() < 0.035 * runMul * (sIns === 'overlap' ? 2 : 1)) {
      m.run = { x: sim.wx(team, clamp(cX + 12 + rng() * 6, 55, 98)), z: Math.sign(owner.z) * (HW - 3), until: t + 3 };
      continue;
    }
    // attack the box when a cross is coming
    if (crossing && inBox < boxN && (m.group === 'FWD' || m.group === 'MID') && mX > 60 && sim.X(team, m.x) < 88 && rng() < 0.2) {
      inBox++;
      const spots = [[94, -2], [97, 3], [91, 6], [89, -7], [95, 0]];
      const sp = spots[m.idx % spots.length];
      m.run = { x: sim.wx(team, sp[0]), z: sp[1] * (Math.sign(-owner.z) || 1), until: t + 2.4 };
      continue;
    }
    if ((m.group === 'MID' || m.group === 'FWD') && (!m.space || m.space.until < t) && rng() < 0.08) {
      let best = null, bs = -1e9;
      for (let k = 0; k < 6; k++) {
        const a = rng() * Math.PI * 2, r = 3 + rng() * 6;
        const cx = m.home.x + Math.cos(a) * r, cz = clamp(m.home.z + Math.sin(a) * r, -31, 31);
        const sp = sim.openAt(cx, cz, 1 - team);
        const s = Math.min(sp, 10) - r * 0.2;
        if (s > bs) { bs = s; best = { x: cx, z: cz }; }
      }
      if (best) m.space = { ...best, until: t + 1.4 };
    }
  }
}

// ------------------------------------------------------------------ player level
const LOCK = new Set(['slide', 'dive', 'fall', 'down', 'sentoff', 'tackle', 'celeb', 'gkjump']);

export function think(sim, p, dt) {
  if (p.act && LOCK.has(p.act.type)) return;
  if (p.isGK) return gkThink(sim, p, dt);
  const t = sim.t, b = sim.ball, info = sim.info[p.team];
  const owner = sim.owner();
  if (owner === p) return carrier(sim, p, dt);
  if (p.fooledUntil > t) { p.des.x *= 0.9; p.des.z *= 0.9; return; }
  if (!owner) {
    // a through ball: the intended receiver keeps running onto the lead point (his run target,
    // set in sim._release()) rather than stopping to face the ball — that's the whole point of the
    // pass. This takes priority over both the intended-receiver and chaser branches below, which
    // would otherwise pull him back onto the ball's current position.
    if (b.throughBall && b.intended === p.idx && p.run && p.run.until > t) {
      goTo(sim, p, p.run, 'sprint', 0.3);
      headerCheck(sim, p);
      return;
    }
    // the intended receiver stops whatever run he was on and moves to meet the ball, facing it.
    if (b.intended === p.idx && !b.throughBall) {
      // lofted balls: wait for it to drop (control at the feet/chest); ground balls: meet it early
      const ic = sim.intercept(p, b.p.y > 1 || b.v.y > 2 ? 1.3 : undefined);
      goTo(sim, p, ic, 'sprint', 0);
      headerCheck(sim, p);
      return;
    }
    if (info.chaser === p.idx || (info.chaser2 === p.idx && info.chaseT > 1.2 && sim.X(p.team, b.p.x) < 30)) {
      const ic = p.ic || sim.intercept(p);
      goTo(sim, p, ic, 'sprint', 0);
      headerCheck(sim, p);
      return;
    }
  }
  if (p.run && p.run.until > t) {
    goTo(sim, p, p.run, 'sprint', 0.3);
    if (Math.hypot(p.run.x - p.x, p.run.z - p.z) < 1) p.run = null;
    headerCheck(sim, p);
    return;
  }
  if (owner && owner.team !== p.team && !b.inHands) {
    if (info.press1 === p.idx || info.press2 === p.idx) return press(sim, p, owner, info.press1 === p.idx, info.contain);
  }
  headerCheck(sim, p);
  const d = Math.hypot(p.home.x - p.x, p.home.z - p.z);
  goTo(sim, p, p.home, d > 22 ? 'sprint' : d > 8 ? 'run' : 'jog', 0.5);
}

export function goTo(sim, p, pt, mode, stopR = 0.3) {
  const dx = pt.x - p.x, dz = pt.z - p.z;
  const d = Math.hypot(dx, dz);
  const f = sim.stamFactor(p);
  const vmax = p.vmax * f * (mode === 'sprint' ? 1 : mode === 'run' ? 0.8 : 0.58);
  if (d < stopR) {
    p.des.x = 0; p.des.z = 0; p.sprint = false;
  } else {
    const s = Math.min(vmax, d * 1.8 + 0.3);
    p.des.x = (dx / d) * s; p.des.z = (dz / d) * s;
    p.sprint = mode === 'sprint' && d > 4;
  }
  const b = sim.ball.p;
  p.faceBall = Math.atan2(b.z - p.z, b.x - p.x);
}

// jump for a dropping ball that will pass at head height (timing from height and leap)
export function headerCheck(sim, p) {
  const b = sim.ball;
  if (b.owner >= 0 || p.act || b.p.y < 1.1) return;
  const hd = Math.hypot(b.p.x - p.x, b.p.z - p.z);
  if (hd > 3.2) return;
  const hv = Math.hypot(b.v.x, b.v.z) || 1;
  const tc = hd / Math.max(2, hv);
  if (tc > 0.42) return;
  const yAt = b.p.y + b.v.y * tc - 4.9 * tc * tc;
  if (yAt > p.h + 0.05 && yAt < p.h + 0.3 + p.jump * 1.2) sim.startJump(p);
}

function press(sim, p, owner, primary, contain) {
  const t = sim.t, team = p.team, diff = sim.diffFor(team);
  const tac = tacOf(sim, team);
  const own = { x: sim.ownGoalX(team), z: 0 };
  const gx = own.x - owner.x, gz = own.z - owner.z;
  const gl = Math.hypot(gx, gz) || 1;
  const d = Math.hypot(owner.x - p.x, owner.z - p.z);
  const intense = tac.defensiveStyle === 'constantPressure' ? 1.15 : tac.defensiveStyle === 'dropBack' ? 0.85 : 1;
  if (primary) {
    // contain (human teams): hold a goal-side position and only engage when very close
    const jockey = contain ? 2.2 : d > 4 ? 0.2 : 1.0;
    const tgt = { x: owner.x + owner.vx * 0.25 + (gx / gl) * jockey, z: owner.z + owner.vz * 0.25 + (gz / gl) * jockey };
    goTo(sim, p, tgt, d > 3 ? 'sprint' : 'run', 0.1);
    p.des.x *= (diff.press * 0.25 + 0.75) * intense; p.des.z *= (diff.press * 0.25 + 0.75) * intense;
    const range = contain ? 1.4 : 2.1;
    if (d < range && t > p.cool.tackle && t > p.nextThink) {
      p.nextThink = t + diff.think * (0.6 + sim.rng() * 0.6);
      const behind = sim.fromBehind(p, owner);
      const pT = (0.3 + p.a.def / 250 + diff.level * 0.05 + ps(p, 'anticipate') * 0.05) * (contain ? 0.55 : 1);
      const reckless = 0.35 * (1.1 - p.a.def / 110) + 0.06;
      if (sim.rng() < pT) {
        if (!behind || sim.rng() < reckless) sim.startTackle(p);
        else if (sim.rng() < 0.16 - diff.level * 0.03 + ps(p, 'slidetackle') * 0.04) sim.startSlide(p);
      }
    } else if (!contain && d > 1.8 && d < 3.2 && t > p.cool.tackle && t > p.nextThink && !sim.fromBehind(p, owner)) {
      p.nextThink = t + diff.think;
      if (sim.rng() < 0.06 + p.a.def / 1400 + ps(p, 'slidetackle') * 0.03 && Math.hypot(owner.vx, owner.vz) > 3) {
        p.face = Math.atan2(owner.z + owner.vz * 0.3 - p.z, owner.x + owner.vx * 0.3 - p.x);
        sim.startSlide(p);
      }
    }
  } else {
    let tgt = null, best = 1e9;
    for (const o of sim.teamList[owner.team]) {
      if (o === owner || o.isGK) continue;
      const dd = Math.hypot(o.x - owner.x, o.z - owner.z);
      if (dd < 25 && dd < best) { best = dd; tgt = o; }
    }
    const pt = tgt ? { x: (owner.x + tgt.x) / 2, z: (owner.z + tgt.z) / 2 } : { x: owner.x + gx / gl * 4, z: owner.z + gz / gl * 4 };
    goTo(sim, p, pt, 'run', 0.4);
  }
}

// ------------------------------------------------------------------ ball carrier
function carrier(sim, p, dt) {
  const t = sim.t, team = p.team, rng = sim.rng, diff = sim.diffFor(team);
  const b = sim.ball;
  if (b.inHands) return;
  const pressure = sim.pressureOn(p);
  if (!p.drib || t >= p.nextThink || (pressure < 1.4 && t > p.drib.t0 + 0.25)) {
    p.nextThink = t + diff.think * (1.1 + rng() * 0.9) * (pressure < 2.5 ? 0.6 : 1);
    decideCarrier(sim, p, pressure);
    if (sim.ball.owner !== p.idx) return;
  }
  const dr = p.drib;
  let dx = dr.x, dz = dr.z;
  for (const o of sim.teamList[1 - team]) {
    const ox = o.x - p.x, oz = o.z - p.z;
    const od = Math.hypot(ox, oz);
    if (od < 5 && od > 0.01) {
      const ahead = (ox * dx + oz * dz) / od;
      if (ahead > 0.2) {
        const w = (5 - od) / 5 * 0.9;
        dx -= (ox / od) * w; dz -= (oz / od) * w;
      }
    }
  }
  if (Math.abs(p.z) > HW - 3) dz -= Math.sign(p.z) * 0.8;
  const Xp = sim.X(team, p.x);
  if (Xp > 101) dx -= sim.dir[team] * 0.8;
  const l = Math.hypot(dx, dz) || 1;
  const sp = p.vmax * sim.stamFactor(p) * (dr.sprint ? 1 : 0.72) * sim.dribbleFactor(p, dr.sprint);
  p.des.x = (dx / l) * sp; p.des.z = (dz / l) * sp;
  p.sprint = dr.sprint;
  if (p.holdStart == null) p.holdStart = t;
}

// Interception model: minimum over opponents of (time they need to reach the ball's path) minus
// (time the ball gets there). > 0.3 s is safe, < 0 means the pass will be cut out.
export function laneMargin(sim, from, pt, speed, team, recv = null) {
  const opps = sim.teamList[1 - team];
  const dx = pt.x - from.x, dz = pt.z - from.z, d = Math.hypot(dx, dz) || 1;
  let minM = 9;
  const n = Math.max(3, Math.ceil(d / 4));
  const dists = [0.7, 1.6, 2.8];
  for (let k = 1; k <= n; k++) if (d * k / n > 3.2) dists.push(d * k / n);
  for (const dist of dists) {
    if (dist > d) break;
    const f = dist / d;
    const tb = rollTimeTo(speed, dist);
    if (!Number.isFinite(tb)) break;
    const x = from.x + dx * f, z = from.z + dz * f;
    // once the receiver (checking toward the ball) can claim it, the rest of the path is his
    if (recv && 0.15 + Math.max(0, Math.hypot(recv.x - x, recv.z - z) - 0.6) / (recv.vmax * 0.9) <= tb) {
      for (const o of opps) {
        const od = Math.max(0, Math.hypot(o.x - x, o.z - z) - 0.8);
        const m = 0.32 + od / (o.vmax * 0.92) - tb;
        if (m < minM) minM = m;
      }
      break;
    }
    for (const o of opps) {
      const la = Math.min(tb, 0.35);
      const raw = Math.hypot(o.x + o.vx * la - x, o.z + o.vz * la - z) - 0.8 - ps(o, 'intercept') * 0.18;
      // already standing in the lane: blocked; otherwise reaction + run
      const m = raw < 0 ? -0.5 + raw : 0.28 + raw / (o.vmax * 0.92) - tb;
      if (m < minM) minM = m;
    }
  }
  return minM;
}

function decideCarrier(sim, p, pressure) {
  const t = sim.t, team = p.team, rng = sim.rng, diff = sim.diffFor(team), d = sim.dir[team];
  const tac = tacOf(sim, team);
  const b = sim.ball;
  const a = p.a;
  const X = sim.X(team, p.x);
  const gx = sim.goalX(team);
  const D = Math.hypot(gx - p.x, p.z);
  const opps = sim.teamList[1 - team];
  const mates = sim.teamList[team];
  const opts = [];
  const noise = () => (rng() - 0.5) * 2 * diff.noise;
  const held = t - (p.gainT || t);
  const riskW = 0.35 + diff.level * 0.1;
  const ment = tac.mentality || 0;
  const counter = tac.buildUp === 'counter' && t - (sim.info[team].wonT || -9) < 6;
  // --- shoot
  if (D < 30 && X > 70) {
    let blockers = 0;
    for (const o of opps) {
      if (o.isGK) continue;
      const sd = segDist(o.x, o.z, p.x, p.z, gx, 0);
      if (sd.t > 0.05 && sd.d < 1.3) blockers++;
    }
    const ang = Math.abs(Math.atan2(p.z, Math.abs(gx - p.x)));
    let q = (a.sho / 100) * clamp(1 - (D - 9) / 22, 0, 1) * (1 / (1 + blockers * 0.7)) * Math.max(0.2, Math.cos(ang));
    if (D < 20) q += 0.12;
    if (D < 12 && ang < 0.9) q += 0.35;
    if (D < 7) q += 0.3;
    opts.push({ type: 'shoot', s: q * (D < 17 ? 2.1 : 1.35) + ment * 0.04 + noise() });
  }
  // --- passes (receiver choice with lane checks)
  const offs = opps.map((o) => o.x);
  for (const m of mates) {
    if (m === p) continue;
    const dx = m.x - p.x, dz = m.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 5 || dist > 50) continue;
    if (m.isGK && (X > 40 || pressure > 3)) continue;
    const mX = sim.X(team, m.x);
    const off = isOffside({ receiverX: m.x, ballX: b.p.x, defenderXs: offs, dir: d });
    if (off && rng() > 0.12 - diff.level * 0.04) continue;
    const progress = mX - X;
    const arrive = passArrive(p, dist);
    const L = leadPass(b.p, m, sim._recvVel(m), arrive, 30);
    const pt = sim._clampPt(L);
    const speed = Math.min(30, rollSpeedFor(Math.hypot(pt.x - b.p.x, pt.z - b.p.z), arrive));
    const margin = laneMargin(sim, b.p, pt, speed, team, m);
    const open = sim.openness(m);
    let s = 0.3 + progress * (0.016 + (tac.chanceCreation === 'directPassing' ? 0.006 : 0) + ment * 0.003 + (counter ? 0.008 : 0))
      + Math.min(open, 9) * 0.03 + clamp(margin, -1, 1.2) * riskW - (margin < 0.05 ? 0.55 : 0);
    if (open < 1.6) s -= 0.2;
    if (dist > 30) s -= (dist - 30) * 0.015;
    if (tac.buildUp === 'shortPassing' && dist > 22) s -= 0.15;
    if (tac.chanceCreation === 'possession') s += clamp(margin, 0, 1) * 0.15 - Math.max(0, progress) * 0.004;
    if (progress < -10) s -= 0.15;
    if (X > 80 && mX > 88 && Math.abs(m.z) < 14) s += 0.15;
    s += (a.pas - 70) / 400;
    opts.push({ type: 'pass', s: s + noise(), m, kind: 'ground' });
    // lofted pass over a blocked lane (switch of play / long ball)
    if (margin < 0.05 && dist > 16) {
      const landOk = Math.min(...opps.map((o) => Math.hypot(o.x - m.x, o.z - m.z))) > 6;
      let ls = -0.12 + progress * 0.012 + Math.min(open, 9) * 0.035 + (landOk ? 0.1 : -0.5) + (a.pas - 70) / 300 + (tac.buildUp === 'longBall' ? 0.2 : 0);
      if (Math.abs(m.z - p.z) > 30) ls += 0.08;
      opts.push({ type: 'pass', s: ls + noise(), m, kind: 'lob' });
    }
    // through ball to a runner
    if (m.run && m.run.until > t && !off && progress > 3) {
      const rdx = m.run.x - m.x, rdz = m.run.z - m.z, rl = Math.hypot(rdx, rdz) || 1;
      const tl = throughLead(sim, m, b.p, rdx / rl, rdz / rl, 3.4);
      if (tl) {
        const ts = 0.45 + Math.min(open, 8) * 0.03 + (a.pas - 60) / 300 + clamp(tl.margin, -1, 1) * 0.6 - (tl.margin < 0.15 ? 0.7 : 0) + ps(p, 'incisive') * 0.1
          + (tac.chanceCreation === 'directPassing' || counter ? 0.15 : 0);
        opts.push({ type: 'through', s: ts + noise(), m });
      }
    }
  }
  // --- cross
  if (X > 82 && Math.abs(p.z) > 13) {
    const inBox = mates.filter((m) => m !== p && sim.X(team, m.x) > 86 && Math.abs(m.z) < 15).length;
    opts.push({ type: 'cross', s: 0.42 + inBox * 0.22 + (a.pas - 60) / 250 + ps(p, 'whipped') * 0.08 + (tac.playersInBox - 5) * 0.02 + noise() });
  }
  // --- dribble
  const space = sim.spaceAhead(p);
  let ds = 0.42 + (a.dri / 100) * 0.35 + Math.min(space, 10) * 0.035 - (pressure < 2 ? 0.3 : 0) + (counter ? 0.1 : 0);
  if (X < 25 && pressure < 4) ds -= 0.3;
  if (held < 0.6 && pressure > 2.5) ds += 0.25;
  if (held > 3.5) ds -= 0.35;
  opts.push({ type: 'dribble', s: ds + noise() });
  // --- clearance
  if (X < 22 && pressure < 2.2) opts.push({ type: 'clear', s: 0.75 + noise() });
  // --- under pressure near the touchline: put it out of play
  if (Math.abs(p.z) > HW - 7 && pressure < 1.5 && X < 75) opts.push({ type: 'touch', s: 0.5 + (70 - a.dri) / 150 + noise() });
  opts.sort((u, v) => v.s - u.s);
  const o = opts[0];
  switch (o.type) {
    case 'shoot': aiShoot(sim, p, D); break;
    case 'pass':
      if (o.kind === 'lob') sim.aiKick(p, 'lob', { target: o.m.idx, power: 0.6 });
      else sim.aiKick(p, 'ground', { target: o.m.idx, power: 0.5 + diff.level * 0.1 });
      break;
    case 'through': sim.aiKick(p, 'through', { target: o.m.idx, power: 0.6 }); break;
    case 'touch': {
      const pt = { x: p.x + d * (6 + rng() * 14), z: Math.sign(p.z) * (HW + 6) };
      sim.aiKick(p, 'lob', { point: pt, power: 0.7, elev: 0.35, noClamp: true, clear: true });
      break;
    }
    case 'cross': sim.aiKick(p, 'cross', { power: 0.7 }); break;
    case 'clear': {
      const wide = Math.abs(p.z) > 10 && rng() < 0.4;
      const z = wide ? Math.sign(p.z) * (HW + 5) : clamp(p.z * 1.4 + (rng() - 0.5) * 44, -40, 40);
      sim.aiKick(p, 'lob', { point: { x: sim.wx(team, clamp(X + (wide ? 22 : 40), 30, 80)), z }, power: 0.9, elev: 0.6, noClamp: true, clear: true });
      break;
    }
    default: {
      const tx = sim.wx(team, Math.min(X + 12, 100));
      const sIns = instr(sim, p, 'support');
      let tz = X > 80 || sIns === 'cutInside' ? p.z * 0.5 : p.z * 0.85;
      const ddx = tx - p.x, ddz = tz - p.z, dl = Math.hypot(ddx, ddz) || 1;
      const sprint = space > 5 && sim.stamFactor(p) > 0.85;
      p.drib = { x: ddx / dl, z: ddz / dl, sprint, t0: t };
      if (pressure < 1.5 && rng() < (p.a.dri - 55) / 250 + ps(p, 'trickster') * 0.05 && sim.human[team] === false) {
        sim.doSkill(p, rng() < 0.5 ? { x: -Math.sin(p.face), z: Math.cos(p.face) } : null);
      }
    }
  }
}

function aiShoot(sim, p, D) {
  const rng = sim.rng, team = p.team;
  const gk = sim.gk(1 - team);
  const side = gk && Math.abs(gk.z) > 0.3 ? -Math.sign(gk.z) : rng() < 0.5 ? 1 : -1;
  const tz = side * (GOAL.HW - 0.3 - rng() * 1.0);
  const ty = 0.3 + rng() * (D < 12 ? 1.2 : 1.7);
  const gkOff = gk ? Math.abs(gk.x - sim.ownGoalX(1 - team)) : 0;
  // chip an advanced keeper
  if (gk && gkOff > 5 && D < 24 && D > 9 && rng() < 0.12 + ps(p, 'chip') * 0.15) return sim.aiKick(p, 'chip', { tz: tz * 0.5, ty: 1.9, power: 0.5 });
  const finesse = D > 13 && D < 26 && p.a.sho > 70 && rng() < 0.3 + ps(p, 'finesse') * 0.15;
  const low = !finesse && D > 12 && rng() < 0.2 + ps(p, 'lowdriven') * 0.2;
  const power = clamp(0.55 + D / 45 + rng() * 0.08, 0.5, 0.88);
  sim.aiKick(p, finesse ? 'finesse' : low ? 'lowdriven' : 'shot', { tz, ty, power });
}

// ------------------------------------------------------------------ goalkeeper
function gkThink(sim, p, dt) {
  const t = sim.t, team = p.team, d = sim.dir[team], b = sim.ball, info = sim.info[team];
  const gl = sim.ownGoalX(team);
  if (b.owner === p.idx) return gkDistribute(sim, p);
  const owner = sim.owner();
  if (b.owner < 0) {
    const vTo = -d * b.v.x;
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
  // loose ball in or near the box: attack it — dive on it when an attacker is closing in
  if (!owner) {
    const ic = p.ic || sim.intercept(p);
    const icX = sim.X(team, ic.x);
    const claim = info.chaser === p.idx || (icX < 18 && Math.abs(ic.z) < 21 && ic.t < oppBestT(sim, team) + 0.15);
    if (claim && icX < 20 && Math.abs(ic.z) < 23) {
      const bd = Math.hypot(b.p.x - p.x, b.p.z - p.z);
      const bs = Math.hypot(b.v.x, b.v.z);
      let near = 99;
      for (const o of sim.teamList[1 - team]) near = Math.min(near, Math.hypot(o.x - b.p.x, o.z - b.p.z));
      if (bd < 3.2 && bd > 0.7 && b.p.y < 0.7 && bs < 9 && near < 3 && t > p.cool.tackle) { sim.gkDiveAtBall(p); return; }
      goTo(sim, p, ic, 'sprint', 0);
      p.ready = false;
      return;
    }
  }
  // one-on-one: narrow the angle, smother at the attacker's feet, pounce on a heavy touch
  if (owner && owner.team !== team) {
    const oX = sim.X(team, owner.x);
    if (oX < 17 && Math.abs(owner.z) < 18) {
      const dd = Math.hypot(owner.x - p.x, owner.z - p.z);
      const ballAhead = Math.hypot(b.p.x - owner.x, b.p.z - owner.z);
      let covered = false;
      for (const m of sim.teamList[team]) {
        if (m.isGK) continue;
        const sd = segDist(m.x, m.z, owner.x, owner.z, gl, 0);
        if (sd.t > 0.05 && sd.d < 1.6) { covered = true; break; }
      }
      if (!covered || oX < 12) {
        const rush = ps(p, 'rushout');
        if (dd < 2.1 + rush * 0.3 + ballAhead * 0.3 && t > p.cool.tackle) { sim.gkSmother(p, owner); return; }
        const gd = Math.hypot(owner.x - gl, owner.z);
        const out = clamp(gd * (0.3 + rush * 0.08), 1.2, 7);
        const ux = (owner.x - gl) / (gd || 1), uz = owner.z / (gd || 1);
        goTo(sim, p, { x: gl + ux * out, z: uz * out }, 'sprint', 0.1);
        p.ready = dd < 8;
        return;
      }
    }
  }
  // positioning on the angle bisector between the posts (near-post coverage)
  const bx = b.p.x, bz = b.p.z;
  const dA = Math.hypot(bx - gl, bz + GOAL.HW), dB = Math.hypot(bx - gl, bz - GOAL.HW);
  const zP = -GOAL.HW + (2 * GOAL.HW * dA) / (dA + dB);
  const tx = bx - gl, tz = bz - zP;
  const dist = Math.hypot(tx, tz) || 1;
  const far = sim.X(team, bx) > 52;
  const depth = clamp(0.8 + (dist - 5) * 0.085, 0.7, far ? 13 : 5.2);
  const posErr = (100 - p.a.pos) * 0.004;
  let x = gl + (tx / dist) * depth;
  let z = zP + (tz / dist) * depth * (1 + posErr);
  z = clamp(z, -(GOAL.HW - 0.3) - (depth > 3 ? 4 : 0), GOAL.HW - 0.3 + (depth > 3 ? 4 : 0));
  if (d * (x - gl) < 0.3) x = gl + d * 0.3;
  goTo(sim, p, { x, z }, dist < 30 ? 'run' : 'jog', 0.15);
  p.ready = dist < 30;
}

function oppBestT(sim, team) {
  let best = 99;
  for (const o of sim.teamList[1 - team]) { const ic = o.ic || sim.intercept(o); if (ic.t < best) best = ic.t; }
  return best;
}

export function gkDistribute(sim, p) {
  const t = sim.t, team = p.team, rng = sim.rng;
  if (p.holdStart == null) p.holdStart = t;
  p.des.x = 0; p.des.z = 0;
  if (t - p.holdStart < 1.3 + (p.idx % 3) * 0.4) return;
  const tac = tacOf(sim, team);
  let best = null, bs = -1e9;
  for (const m of sim.teamList[team]) {
    if (m === p) continue;
    const dist = Math.hypot(m.x - p.x, m.z - p.z);
    const open = sim.openness(m);
    const X = sim.X(team, m.x);
    const s = dist < 32 ? open * 0.3 - dist * 0.03 + (tac.buildUp === 'shortPassing' ? 0.5 : 0) : -9;
    if (open > 6 && s > bs) { bs = s; best = { m, kind: 'gkthrow' }; }
    const ls = X > 50 ? open * 0.15 + (X - 50) * 0.02 - 0.6 + (tac.buildUp === 'longBall' ? 0.6 : 0) : -9;
    if (ls > bs) { bs = ls; best = { m, kind: 'punt' }; }
  }
  if (!best || rng() < 0.25) {
    const f = sim.teamList[team].filter((m) => m.group !== 'DEF' && !m.isGK);
    best = { m: f[Math.floor(rng() * f.length)] || sim.teamList[team][1], kind: 'punt' };
  }
  sim.aiKick(p, best.kind, { target: best.m.idx, power: 0.7 });
}

// ------------------------------------------------------------------ set pieces
export function takeSetPiece(sim, sp) {
  const p = sim.players[sp.taker], team = sp.team, rng = sim.rng;
  const mates = sim.teamList[team].filter((m) => m !== p);
  const tac = tacOf(sim, team);
  const nearestOpen = (maxD, minD = 4) => {
    let best = null, bs = -1e9;
    for (const m of mates) {
      if (m.isGK) continue;
      const dist = Math.hypot(m.x - p.x, m.z - p.z);
      if (dist > maxD || dist < minD) continue;
      const s = sim.openness(m) - dist * 0.1 + (sim.X(team, m.x) - sim.X(team, p.x)) * 0.05;
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  };
  switch (sp.type) {
    case SP.KICKOFF: {
      let best = null, bd = 1e9;
      for (const m of mates) { const dd = Math.hypot(m.x - p.x, m.z - p.z); if (!m.isGK && dd < bd) { bd = dd; best = m; } }
      sim.aiKick(p, 'ground', { target: best.idx, power: 0.4 });
      break;
    }
    case SP.THROW: {
      const m = nearestOpen(24 + ps(p, 'longthrow') * 10) || nearestOpen(40, 2) || mates[0];
      sim.aiKick(p, 'throw', { target: m.idx, power: 0.6 });
      break;
    }
    case SP.GOALKICK: {
      if (rng() < (tac.buildUp === 'longBall' ? 0.75 : tac.buildUp === 'shortPassing' ? 0.25 : 0.5)) {
        const f = mates.filter((m) => m.group !== 'DEF' && !m.isGK);
        const m = f[Math.floor(rng() * f.length)] || mates[0];
        sim.aiKick(p, 'punt', { target: m.idx, power: 0.8, fromGround: true });
      } else {
        const m = nearestOpen(30, 6) || mates[0];
        sim.aiKick(p, 'ground', { target: m.idx, power: 0.6 });
      }
      break;
    }
    case SP.CORNER: {
      const zs = Math.sign(sp.ball.z) || 1;
      if (rng() < 0.12 + (3 - tac.corners) * 0.04) {
        const m = nearestOpen(16, 3);
        if (m) { sim.aiKick(p, 'ground', { target: m.idx, power: 0.5 }); break; }
      }
      const choices = [{ X: 99.5, z: zs * 2.4 }, { X: 94, z: 0 }, { X: 98, z: -zs * 3 }, { X: 92.5, z: -zs * 5 }];
      const c = choices[Math.floor(rng() * choices.length)];
      const pt = { x: sim.wx(team, c.X), z: c.z + (rng() - 0.5) * 2 };
      // aim at the best header in that zone
      let tgt = -1, bd = 5;
      for (const m of mates) { const dd = Math.hypot(m.x - pt.x, m.z - pt.z) - (m.h - 1.8) * 4 - ps(m, 'aerial') * 1.5; if (!m.isGK && dd < bd) { bd = dd; tgt = m.idx; } }
      if (tgt >= 0) { const m = sim.players[tgt]; pt.x = m.x + sim.dir[team] * 0.6; pt.z = m.z; }
      sim.aiKick(p, 'cross', { point: pt, target: tgt, power: 0.75, curve: rng() < 0.5 ? 1 : -1 });
      break;
    }
    case SP.FREEKICK: {
      const gx = sim.goalX(team);
      const D = Math.hypot(gx - p.x, p.z);
      const X = sim.X(team, p.x);
      const ang = Math.abs(Math.atan2(p.z, Math.abs(gx - p.x)));
      if (D < 29 && ang < 0.8 && !sp.indirect && !sp.quick) {
        const side = rng() < 0.6 ? -Math.sign(p.z || 1) : Math.sign(p.z || 1);
        sim.aiKick(p, 'fk', { tz: side * (GOAL.HW - 0.5 - rng() * 0.7), ty: 1.7 + rng() * 0.55, power: 0.7 });
      } else if (X > 68 && !sp.quick) {
        const pt = { x: sim.wx(team, 93 + rng() * 5), z: (rng() - 0.5) * 12 };
        sim.aiKick(p, 'cross', { point: pt, power: 0.7 });
      } else {
        const m = nearestOpen(35) || mates[0];
        sim.aiKick(p, Math.hypot(m.x - p.x, m.z - p.z) > 25 ? 'lob' : 'ground', { target: m.idx, power: 0.6 });
      }
      break;
    }
    case SP.PENALTY: {
      let side = rng() < 0.5 ? 1 : -1;
      // a human keeper who committed early gets sent the wrong way
      const gi = sp.gkIn;
      if (gi && gi.side && sim.t - gi.t > 0.45 && rng() < 0.65) side = -gi.side;
      const tz = side * (1.7 + rng() * 1.85);
      const ty = 0.3 + rng() * 1.5;
      sim.aiKick(p, 'penalty', { tz, ty, power: 0.62 + rng() * 0.2 });
      break;
    }
  }
}

export { inOwnPenaltyArea, hypot2, BOX, BALL_R };
