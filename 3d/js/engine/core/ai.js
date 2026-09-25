// Team + player AI: shape, pressing, marking, support runs, carrier decisions, goalkeeping,
// set-piece takers. Operates on a MatchSim instance. DOM-free.
import { PITCH, GOAL, BOX, BALL_R, SP } from './constants.js';
import { clamp, lerp, segDist, hypot2 } from './mathx.js';
import { isOffside, inOwnPenaltyArea } from './rules.js';

const HL = PITCH.HL, HW = PITCH.HW;

// ------------------------------------------------------------------ team level
export function teamThink(sim, team) {
  const info = sim.info[team];
  const b = sim.ball;
  const owner = sim.owner();
  const mates = sim.teamList[team];
  const opps = sim.teamList[1 - team];
  info.ballX = sim.X(team, b.p.x);
  info.attacking = owner ? owner.team === team : b.lastTeam === team;
  // opponents' offside line in our frame
  const xs = opps.map((o) => sim.X(team, o.x)).sort((a, c) => c - a);
  info.offLine = Math.max(xs[1] ?? HL, HL, info.ballX);
  // our own defensive line (deepest outfield) – used for trap / cover
  // loose ball chasers
  info.chaser = -1; info.chaser2 = -1; info.chaseT = Infinity;
  if (!owner) {
    let best = Infinity, second = Infinity;
    for (const m of mates) {
      m.ic = sim.intercept(m);
      if (m.isGK && !sim.gkMayChase(m)) continue;
      if (m.ic.t < best) { second = best; info.chaser2 = info.chaser; best = m.ic.t; info.chaser = m.idx; }
      else if (m.ic.t < second) { second = m.ic.t; info.chaser2 = m.idx; }
    }
    info.chaseT = best;
  }
  // pressers
  info.press1 = -1; info.press2 = -1;
  if (owner && owner.team !== team && !(b.inHands)) {
    const px = owner.x + owner.vx * 0.35, pz = owner.z + owner.vz * 0.35;
    const ranked = mates.filter((m) => !m.isGK)
      .map((m) => ({ m, d: Math.hypot(m.x - px, m.z - pz) / m.vmax }))
      .sort((a, c) => a.d - c.d);
    if (ranked[0]) info.press1 = ranked[0].m.idx;
    const ownThird = sim.X(team, owner.x) < 40;
    if (ranked[1] && (sim.diffFor(team).press >= 0.75 || ownThird) && ranked[1].d < 3.5) info.press2 = ranked[1].m.idx;
  }
  // home positions
  for (const m of mates) if (!m.isGK) m.home = formationTarget(sim, m, info);
  // marking when defending
  if (!info.attacking) assignMarking(sim, team, info);
  // attacking runs
  if (info.attacking && owner && owner.team === team) planRuns(sim, team, info, owner);
}

export function formationTarget(sim, p, info) {
  const team = p.team, d = sim.dir[team], s = p.sd;
  const bx = info.ballX, bz = sim.ball.p.z;
  const att = info.attacking;
  const lineX = att ? clamp(bx - 30, 20, 60) : clamp(bx - 19, 11, 46);
  const block = att ? 48 : 34;
  let X = lineX + ((s.d - 0.19) / 0.51) * block;
  if (p.group === 'DEF') {
    X = lineX + (s.d - 0.19) * 25;
    const wide = Math.abs(s.l) > 0.6;
    if (att && wide && bx > 50 && Math.sign(bz * d * s.l) > 0) X += 14; // overlap on ball side
    else if (att && wide && bx > 60) X += 6;
  }
  if (p.group === 'FWD' || s.r === 'CAM') {
    if (!(p.run && p.run.until > sim.t)) X = Math.min(X, info.offLine - 0.8);
  }
  X = clamp(X, 4, 101);
  const width = att ? 30 : 21;
  let z = s.l * d * width + bz * (att ? 0.22 : 0.42);
  if (!att && p.group === 'DEF') z = s.l * d * 17 + bz * 0.35;
  z = clamp(z, -31.5, 31.5);
  // space seeking for midfielders/forwards when attacking
  if (att && p.space && p.space.until > sim.t) {
    X = lerp(X, sim.X(team, p.space.x), 0.6);
    z = lerp(z, p.space.z, 0.6);
  }
  return { x: sim.wx(team, X), z };
}

function assignMarking(sim, team, info) {
  const opps = sim.teamList[1 - team].filter((o) => !o.isGK);
  const mates = sim.teamList[team].filter((m) => !m.isGK && m.idx !== info.press1 && m.idx !== info.press2 && m.group !== 'FWD');
  const own = { x: sim.ownGoalX(team), z: 0 };
  // most dangerous first (closest to our goal)
  opps.sort((a, c) => sim.X(team, a.x) - sim.X(team, c.x));
  const used = new Set();
  const owner = sim.owner();
  for (const o of opps) {
    if (owner === o) continue;
    const oX = sim.X(team, o.x);
    if (oX > 70) continue; // far from our goal: zonal only
    let best = null, bd = 14;
    for (const m of mates) {
      if (used.has(m.idx)) continue;
      const dd = Math.hypot(m.home.x - o.x, m.home.z - o.z);
      if (dd < bd) { bd = dd; best = m; }
    }
    if (!best) continue;
    used.add(best.idx);
    const gx = own.x - o.x, gz = own.z - o.z;
    const gl = Math.hypot(gx, gz) || 1;
    const mark = { x: o.x + (gx / gl) * 1.7, z: o.z + (gz / gl) * 1.7 };
    // offside trap: don't follow a runner who is already beyond our line when the ball is far
    const lineX = Math.min(...mates.filter((m) => m.group === 'DEF').map((m) => sim.X(team, m.home.x)), 60);
    if (oX < lineX - 2 && info.ballX > lineX + 25) continue;
    const w = oX < 40 ? 0.8 : 0.5;
    best.home = { x: lerp(best.home.x, mark.x, w), z: lerp(best.home.z, mark.z, w) };
  }
}

function planRuns(sim, team, info, owner) {
  const t = sim.t, rng = sim.rng;
  const cX = sim.X(team, owner.x);
  for (const m of sim.teamList[team]) {
    if (m === owner || m.isGK || sim.isHumanCtrl(m)) continue;
    if (m.run && m.run.until > t) continue;
    const mX = sim.X(team, m.x);
    if ((m.group === 'FWD' || m.sd.r === 'CAM' || (m.group === 'MID' && Math.abs(m.sd.l) > 0.6)) && cX > 38 && mX > info.offLine - 6 && mX < info.offLine + 0.5) {
      if (rng() < 0.05 * (0.6 + m.a.pac / 120)) {
        const X = clamp(info.offLine + 9 + rng() * 8, 60, 100);
        const z = clamp(m.z * 0.7 + (rng() - 0.5) * 12, -28, 28);
        m.run = { x: sim.wx(team, X), z, until: t + 2.6 };
      }
    }
    // space finding for midfielders
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
const LOCK = new Set(['slide', 'dive', 'fall', 'down', 'sentoff', 'tackle', 'celeb']);

export function think(sim, p, dt) {
  if (p.act && LOCK.has(p.act.type)) return;
  if (p.isGK) return gkThink(sim, p, dt);
  const t = sim.t, b = sim.ball, info = sim.info[p.team];
  const owner = sim.owner();
  if (owner === p) return carrier(sim, p, dt);
  if (p.fooledUntil > t) { p.des.x *= 0.9; p.des.z *= 0.9; return; }
  if (!owner) {
    if (b.intended === p.idx || info.chaser === p.idx || (info.chaser2 === p.idx && info.chaseT > 1.2 && sim.X(p.team, b.p.x) < 30)) {
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
    if (info.press1 === p.idx || info.press2 === p.idx) return press(sim, p, owner, info.press1 === p.idx);
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

function headerCheck(sim, p) {
  const b = sim.ball;
  if (b.owner >= 0 || p.act || b.p.y < 1.2) return;
  const hd = Math.hypot(b.p.x - p.x, b.p.z - p.z);
  if (hd > 3) return;
  const hv = Math.hypot(b.v.x, b.v.z) || 1;
  const tc = hd / Math.max(2, hv);
  if (tc > 0.4) return;
  const yAt = b.p.y + b.v.y * tc - 4.9 * tc * tc;
  if (yAt > 1.85 && yAt < 2.95) sim.startJump(p);
}

function press(sim, p, owner, primary) {
  const t = sim.t, team = p.team, diff = sim.diffFor(team);
  const own = { x: sim.ownGoalX(team), z: 0 };
  const gx = own.x - owner.x, gz = own.z - owner.z;
  const gl = Math.hypot(gx, gz) || 1;
  const d = Math.hypot(owner.x - p.x, owner.z - p.z);
  if (primary) {
    const jockey = d > 4 ? 0.2 : 1.0;
    const tgt = { x: owner.x + owner.vx * 0.25 + (gx / gl) * jockey, z: owner.z + owner.vz * 0.25 + (gz / gl) * jockey };
    goTo(sim, p, tgt, d > 3 ? 'sprint' : 'run', 0.1);
    p.des.x *= diff.press * 0.25 + 0.75; p.des.z *= diff.press * 0.25 + 0.75;
    // tackle decisions
    if (d < 2.1 && t > p.cool.tackle && t > p.nextThink) {
      p.nextThink = t + diff.think * (0.6 + sim.rng() * 0.6);
      const behind = sim.fromBehind(p, owner);
      const pT = 0.3 + p.a.def / 250 + diff.level * 0.05;
      const reckless = 0.35 * (1.1 - p.a.def / 110) + 0.06;
      if (sim.rng() < pT) {
        if (!behind || sim.rng() < reckless) sim.startTackle(p);
        else if (sim.rng() < 0.16 - diff.level * 0.03) sim.startSlide(p);
      }
    } else if (d > 1.8 && d < 3.2 && t > p.cool.tackle && t > p.nextThink && !sim.fromBehind(p, owner)) {
      p.nextThink = t + diff.think;
      if (sim.rng() < 0.06 + p.a.def / 1400 && Math.hypot(owner.vx, owner.vz) > 3) {
        p.face = Math.atan2(owner.z + owner.vz * 0.3 - p.z, owner.x + owner.vx * 0.3 - p.x);
        sim.startSlide(p);
      }
    }
  } else {
    // cut the passing lane: between carrier and most dangerous nearby opponent
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
  // execute dribble
  const dr = p.drib;
  let dx = dr.x, dz = dr.z;
  // live avoidance
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
  // stay inside pitch
  if (Math.abs(p.z) > HW - 3) dz -= Math.sign(p.z) * 0.8;
  const Xp = sim.X(team, p.x);
  if (Xp > 101) dx -= sim.dir[team] * 0.8;
  const l = Math.hypot(dx, dz) || 1;
  const sp = p.vmax * sim.stamFactor(p) * (dr.sprint ? 1 : 0.72) * sim.dribbleFactor(p, dr.sprint);
  p.des.x = (dx / l) * sp; p.des.z = (dz / l) * sp;
  p.sprint = dr.sprint;
  if (p.holdStart == null) p.holdStart = t;
}

function decideCarrier(sim, p, pressure) {
  const t = sim.t, team = p.team, rng = sim.rng, diff = sim.diffFor(team), d = sim.dir[team];
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
    opts.push({ type: 'shoot', s: q * (D < 17 ? 2.1 : 1.35) + noise() });
  }
  // --- passes
  for (const m of mates) {
    if (m === p) continue;
    const dx = m.x - p.x, dz = m.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 5 || dist > 48) continue;
    if (m.isGK && (X > 40 || pressure > 3)) continue;
    const mX = sim.X(team, m.x);
    const off = isOffside({ receiverX: m.x, ballX: b.p.x, defenderXs: opps.map((o) => o.x), dir: d });
    if (off && rng() > 0.15 - diff.level * 0.04) continue;
    const progress = mX - X;
    let lane = 99;
    for (const o of opps) {
      const sd = segDist(o.x, o.z, p.x, p.z, m.x, m.z);
      if (sd.t > 0.08 && sd.t < 0.97) lane = Math.min(lane, sd.d / (0.4 + sd.t * dist * 0.06));
    }
    const open = sim.openness(m);
    let s = 0.28 + progress * 0.016 + Math.min(open, 9) * 0.035 + Math.min(lane, 4) * 0.07 - (lane < 1 ? 0.55 : 0);
    if (dist > 30) s -= (dist - 30) * 0.015;
    if (progress < -10) s -= 0.15;
    if (X > 80 && mX > 88 && Math.abs(m.z) < 14) s += 0.15; // into the box
    s += (a.pas - 70) / 400;
    const kind = lane < 1.2 && dist > 14 ? 'lob' : 'ground';
    opts.push({ type: 'pass', s: s + noise(), m, kind });
    // through ball to a runner
    if (m.run && m.run.until > t && !off && progress > 3) {
      const ts = 0.55 + Math.min(open, 8) * 0.03 + (a.pas - 60) / 300 + (lane > 1.5 ? 0.15 : -0.3);
      opts.push({ type: 'through', s: ts + noise(), m });
    }
  }
  // --- cross
  if (X > 84 && Math.abs(p.z) > 13) {
    const inBox = mates.filter((m) => m !== p && sim.X(team, m.x) > 86 && Math.abs(m.z) < 15).length;
    opts.push({ type: 'cross', s: 0.45 + inBox * 0.22 + (a.pas - 60) / 250 + noise() });
  }
  // --- dribble
  const space = sim.spaceAhead(p);
  let ds = 0.42 + (a.dri / 100) * 0.35 + Math.min(space, 10) * 0.035 - (pressure < 2 ? 0.3 : 0);
  if (X < 25 && pressure < 4) ds -= 0.3;
  if (held < 0.6 && pressure > 2.5) ds += 0.25;
  if (held > 3.5) ds -= 0.35;
  opts.push({ type: 'dribble', s: ds + noise() });
  // --- clearance
  if (X < 22 && pressure < 2.2) opts.push({ type: 'clear', s: 0.75 + noise() });
  opts.sort((u, v) => v.s - u.s);
  const o = opts[0];
  switch (o.type) {
    case 'shoot': aiShoot(sim, p, D); break;
    case 'pass':
      if (o.kind === 'lob') sim.aiKick(p, 'lob', { target: o.m.idx, power: 0.6 });
      else sim.aiKick(p, 'ground', { target: o.m.idx, power: 0.6 });
      break;
    case 'through': sim.aiKick(p, 'through', { target: o.m.idx, power: 0.6 }); break;
    case 'cross': sim.aiKick(p, 'cross', { power: 0.7 }); break;
    case 'clear': {
      const z = clamp(p.z * 1.4 + (rng() - 0.5) * 44, -40, 40);
      sim.aiKick(p, 'lob', { point: { x: sim.wx(team, clamp(X + 40, 40, 80)), z }, power: 0.9, elev: 0.62, noClamp: true });
      break;
    }
    default: {
      // dribble target: towards goal with some width preference
      const tx = sim.wx(team, Math.min(X + 12, 100));
      let tz = X > 80 ? p.z * 0.5 : p.z * 0.85;
      const ddx = tx - p.x, ddz = tz - p.z, dl = Math.hypot(ddx, ddz) || 1;
      const sprint = space > 5 && sim.stamFactor(p) > 0.85;
      p.drib = { x: ddx / dl, z: ddz / dl, sprint, t0: t };
      if (pressure < 1.5 && rng() < (p.a.dri - 55) / 250 && sim.human[team] === false) {
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
  const finesse = D > 13 && D < 26 && p.a.sho > 70 && rng() < 0.35;
  const power = clamp(0.55 + D / 45 + rng() * 0.08, 0.5, 0.88);
  sim.aiKick(p, finesse ? 'finesse' : 'shot', { tz, ty, power });
}

// ------------------------------------------------------------------ goalkeeper
function gkThink(sim, p, dt) {
  const t = sim.t, team = p.team, d = sim.dir[team], b = sim.ball, info = sim.info[team];
  const gl = sim.ownGoalX(team);
  if (b.owner === p.idx) return gkDistribute(sim, p);
  const owner = sim.owner();
  // shot reaction
  if (b.owner < 0) {
    const vTo = -d * b.v.x;
    if (vTo > 4 && !p.gkPlan && sim.X(team, b.p.x) < 45 && b.lastTeam !== team && sim.path) {
      const plan = sim.planSave(p);
      if (plan) p.gkPlan = plan;
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
        else if (Math.abs(dz) > 0.75 || pl.y > 2.2) {
          if (timeLeft < 0.48) { pl.acted = true; sim.startDive(p, pl); }
        }
      }
      if (!pl.acted && timeLeft < 0.62 && Math.abs(dz) > 0.5) { p.des.x *= 0.5; p.des.z *= 0.5; return; }
      if (!pl.acted || pl.step) {
        goTo(sim, p, { x: pl.x, z: pl.z }, 'run', 0.05);
        const sh = Math.hypot(p.des.x, p.des.z), cap = 2.6 + p.a.spd * 0.01;
        if (sh > cap) { p.des.x *= cap / sh; p.des.z *= cap / sh; }
        return;
      }
      if (p.act) return;
    }
  }
  if (p.act) return;
  // rush for loose balls near/in the box
  if (!owner && info.chaser === p.idx) {
    goTo(sim, p, p.ic || sim.intercept(p), 'sprint', 0);
    return;
  }
  // one-on-one
  if (owner && owner.team !== team) {
    const oX = sim.X(team, owner.x);
    if (oX < 17 && Math.abs(owner.z) < 18) {
      const dd = Math.hypot(owner.x - p.x, owner.z - p.z);
      const defendersCloser = sim.teamList[team].some((m) => !m.isGK && Math.hypot(m.x - owner.x, m.z - owner.z) < 2);
      if (!defendersCloser) {
        if (dd < 2.0 && t > p.cool.tackle) { sim.gkSmother(p, owner); return; }
        goTo(sim, p, { x: owner.x + (gl - owner.x) * 0.15, z: owner.z * 0.85 }, 'sprint', 0.1);
        return;
      }
    }
  }
  // positioning on the angle
  const bx = b.p.x, bz = b.p.z;
  const tx = bx - gl, tz = bz;
  const dist = Math.hypot(tx, tz) || 1;
  const far = sim.X(team, bx) > 52;
  let depth = clamp(0.8 + (dist - 5) * 0.085, 0.7, far ? 13 : 5.2);
  const posErr = (100 - p.a.pos) * 0.006;
  let x = gl + (tx / dist) * depth;
  let z = (tz / dist) * depth;
  z = clamp(z * (1 + posErr), -(GOAL.HW - 0.4) - (depth > 3 ? 4 : 0), GOAL.HW - 0.4 + (depth > 3 ? 4 : 0));
  if (d * (x - gl) < 0.3) x = gl + d * 0.3;
  goTo(sim, p, { x, z }, dist < 30 ? 'run' : 'jog', 0.15);
  p.ready = dist < 30;
}

function gkDistribute(sim, p) {
  const t = sim.t, team = p.team, rng = sim.rng;
  if (p.holdStart == null) p.holdStart = t;
  p.des.x = 0; p.des.z = 0;
  if (t - p.holdStart < 1.3 + (p.idx % 3) * 0.4) return;
  // choose short throw to open defender or punt upfield
  let best = null, bs = -1e9;
  for (const m of sim.teamList[team]) {
    if (m === p) continue;
    const dist = Math.hypot(m.x - p.x, m.z - p.z);
    const open = sim.openness(m);
    const X = sim.X(team, m.x);
    const s = dist < 32 ? open * 0.3 - dist * 0.03 : -9;
    if (open > 6 && s > bs) { bs = s; best = { m, kind: 'gkthrow' }; }
    const ls = X > 50 ? open * 0.15 + (X - 50) * 0.02 - 0.6 : -9;
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
  const p = sim.players[sp.taker], team = sp.team, rng = sim.rng, d = sim.dir[team];
  const mates = sim.teamList[team].filter((m) => m !== p);
  const opps = sim.teamList[1 - team];
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
      const m = nearestOpen(24) || mates[0];
      sim.aiKick(p, 'throw', { target: m.idx, power: 0.6 });
      break;
    }
    case SP.GOALKICK: {
      if (rng() < 0.5) {
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
      const zs = Math.sign(sp.z) || 1;
      const choices = [
        { X: 99.5, z: zs * 2.4 }, { X: 94, z: 0 }, { X: 98, z: -zs * 3 }, { X: 92.5, z: -zs * 5 },
      ];
      const c = choices[Math.floor(rng() * choices.length)];
      const pt = { x: sim.wx(team, c.X), z: c.z + (rng() - 0.5) * 2 };
      sim.aiKick(p, 'cross', { point: pt, power: 0.75, curve: rng() < 0.5 ? 1 : -1 });
      break;
    }
    case SP.FREEKICK: {
      const gx = sim.goalX(team);
      const D = Math.hypot(gx - p.x, p.z);
      const X = sim.X(team, p.x);
      const ang = Math.abs(Math.atan2(p.z, Math.abs(gx - p.x)));
      if (D < 29 && ang < 0.8) {
        const side = rng() < 0.6 ? -Math.sign(p.z || 1) : Math.sign(p.z || 1);
        sim.aiKick(p, 'fk', { tz: side * (GOAL.HW - 0.5 - rng() * 0.7), ty: 1.7 + rng() * 0.55, power: 0.7 });
      } else if (X > 68) {
        const pt = { x: sim.wx(team, 93 + rng() * 5), z: (rng() - 0.5) * 12 };
        sim.aiKick(p, 'cross', { point: pt, power: 0.7 });
      } else {
        const m = nearestOpen(35) || mates[0];
        sim.aiKick(p, Math.hypot(m.x - p.x, m.z - p.z) > 25 ? 'lob' : 'ground', { target: m.idx, power: 0.6 });
      }
      break;
    }
    case SP.PENALTY: {
      const side = rng() < 0.5 ? 1 : -1;
      const tz = side * (1.7 + rng() * 1.85);
      const ty = 0.3 + rng() * 1.5;
      sim.aiKick(p, 'penalty', { tz, ty, power: 0.62 + rng() * 0.2 });
      break;
    }
  }
}

export { inOwnPenaltyArea, hypot2, BOX, BALL_R };
