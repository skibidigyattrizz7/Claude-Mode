// Team AI: formation shape, pressing, marking, support runs, decision making on the
// ball, and goalkeeper positioning / shot reading / distribution.
import { PITCH, CY, GOAL, BOX, PHYS } from './constants.js';
import { FORMATION } from './data.js';
import { clamp, dist, norm, angleBetween, DEG, gauss, distToSegment } from './util.js';
import { laneRisk, leadTarget } from './passing.js';
import { topSpeed, jogSpeed } from './player.js';
import { isFromBehind, inPenaltyArea, tackleSweep } from './rules.js';
import { simulatePath } from './physics.js';

/** Base formation position for p given the ball and possession phase. */
export function formationPos(m, p, phase = 0) {
  const f = FORMATION[p.idx];
  const dir = m.attackDir(p.team);
  const b = m.ball;
  const prog = dir > 0 ? b.x / PITCH.L : (PITCH.L - b.x) / PITCH.L;
  let fx = f.x + (prog - 0.45) * 0.55 + phase * 0.07;
  const maxX = p.role === 'DF' ? 0.6 : p.role === 'MF' ? 0.8 : 0.88;
  const minX = p.role === 'FW' ? 0.3 : 0.08;
  fx = clamp(fx, minX, maxX);
  let fy = f.y + (b.y / PITCH.W - 0.5) * 0.4;
  if (phase > 0 && p.role !== 'DF') fy = 0.5 + (fy - 0.5) * 1.15;
  if (phase < 0) fy = 0.5 + (fy - 0.5) * 0.85;
  fy = clamp(fy, 0.06, 0.94);
  return { x: dir > 0 ? fx * PITCH.L : PITCH.L - fx * PITCH.L, y: fy * PITCH.W };
}

function moveTo(p, tx, ty, sprintDist = 6, slow = false) {
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.3) { p.want.x = 0; p.want.y = 0; p.sprint = false; return d; }
  p.sprint = d > sprintDist && p.stamina > 0.25;
  const sp = Math.min(topSpeed(p, p.sprint), d * 2.2 + 0.5) * (slow ? 0.7 : 1);
  p.want.x = (dx / d) * sp; p.want.y = (dy / d) * sp;
  return d;
}

/**
 * Who presses / contains / covers while the opponent has the ball (pure).
 * @param field outfield players of the defending team (human-controlled ones have p.human >= 0)
 * @param carrier the opponent on the ball
 * @param o.mode null for a CPU team, else the human's AI-defending setting:
 *   'Assisted' - the nearest AI teammate always helps: he presses when he is closer than you,
 *                otherwise he contains (jockeys goal-side) while you engage; the next one covers.
 *   'Tactical' - you do the work: nobody presses for you; only when you are far away
 *                (> helpDist) does the nearest teammate contain so the carrier can't run free.
 * Returns {presser, container, cover}.
 */
export function defensiveRoles(field, carrier, o = {}) {
  const d = (p) => Math.hypot(p.x - carrier.x, p.y - carrier.y);
  const sorted = field.filter((p) => !p.sentOff && p.role !== 'GK').sort((a, b) => d(a) - d(b));
  const ai = sorted.filter((p) => !(p.human >= 0));
  const hum = sorted.find((p) => p.human >= 0);
  const hd = hum ? d(hum) : Infinity;
  let presser = null, container = null, cover = null;
  if (!o.mode) {
    presser = ai[0] || null;
    if (hum && sorted[0] === hum && presser && d(presser) > 9) presser = null;
    cover = ai.find((p) => p !== presser) || null;
  } else if (o.mode === 'Assisted') {
    const first = ai[0] || null;
    if (first) { if (d(first) < hd) presser = first; else container = first; }
    cover = ai.find((p) => p !== first) || null;
  } else {
    if (hd > (o.helpDist ?? 14)) container = ai[0] || null;
    cover = ai.find((p) => p !== container) || null;
  }
  return { presser, container, cover };
}

/**
 * Man-marking assignments (pure). The most dangerous attackers (closest to our goal) are picked
 * up first by the free defender whose zone (home spot) is nearest. With autoMarking off the
 * defenders hold their zones and nobody tracks runners.
 * @returns Map(defender -> attacker)
 */
export function markTargets(defenders, attackers, homeOf, ownGoal, o = {}) {
  const marks = new Map();
  if (o.autoMarking === false) return marks;
  const maxD = o.maxD ?? 18;
  const free = defenders.filter((p) => !(p.human >= 0) && !p.sentOff);
  const threats = attackers.filter((a) => !a.sentOff).sort((a, b) => dist(a, ownGoal) - dist(b, ownGoal));
  const homes = new Map(free.map((p) => [p, homeOf(p)]));
  for (const a of threats) {
    let best = null, bd = maxD;
    for (const p of free) {
      if (marks.has(p)) continue;
      const dd = dist(homes.get(p), a);
      if (dd < bd) { bd = dd; best = p; }
    }
    if (best) marks.set(best, a);
  }
  return marks;
}

export class TeamAI {
  constructor(m, team) { this.m = m; this.team = team; this.path = []; this.markT = 0; }

  get prof() { return this.m.prof[this.team]; }

  /** Earliest point on the predicted ball path player p can reach. */
  interceptPoint(p) {
    const sp = topSpeed(p, true) * 0.95;
    for (const pt of this.m.ballPath) {
      if (pt.z > 2.2) continue;
      const d = Math.hypot(pt.x - p.x, pt.y - p.y) - 0.5;
      if (d / sp <= pt.t + 0.05) return { x: pt.x, y: pt.y, t: pt.t };
    }
    const last = this.m.ballPath[this.m.ballPath.length - 1] || this.m.ball;
    return { x: last.x, y: last.y, t: 9 };
  }

  update(dt) {
    const m = this.m, team = this.team;
    const mates = m.mates(team);
    const own = m.owner;
    const inPoss = own && own.team === team;
    const oppPoss = own && own.team !== team;
    const field = mates.filter((p) => p.role !== 'GK');

    // Who chases a loose ball / presses the carrier?
    let chaser = null, presser = null, cover = null, container = null;
    const gp = m.gpTeam ? m.gpTeam(team) : null;
    this.gp = gp;
    if (!own) {
      let bestT = 1e9;
      for (const p of field) {
        if (m.pass && m.pass.receiver && m.pass.receiver.team === team && m.pass.receiver !== p) continue;
        const ip = this.interceptPoint(p);
        const t = ip.t + Math.hypot(ip.x - p.x, ip.y - p.y) * 0.02;
        if (t < bestT) { bestT = t; chaser = p; }
      }
      if (chaser && chaser.human >= 0) chaser = null;  // human handles it
    } else if (oppPoss) {
      ({ presser, container, cover } = defensiveRoles(field, own, { mode: gp ? gp.defending : null }));
    }

    // Marking assignments (refresh a few times per second)
    this.markT -= dt;
    if (oppPoss && this.markT <= 0) { this.assignMarks(field, own); this.markT = 0.4; }

    for (const p of mates) {
      if (p.sentOff) continue;
      if (p.human < 0) { p.jockey = false; p.shield = false; }
      if (p.role === 'GK') { updateKeeper(m, p, dt, this.prof); continue; }
      if (p.human >= 0) continue;
      if (p.state !== 'run') { p.want.x = p.want.y = 0; continue; }
      p.faceWant = Math.atan2(m.ball.y - p.y, m.ball.x - p.x);
      if (p.ai.runT > 0) p.ai.runT -= dt;
      if (m.pass && m.pass.receiver === p && !own) { this.receive(p); continue; }
      if (own === p) { this.carrier(p, dt); continue; }
      if (inPoss) this.support(p, own, dt);
      else if (oppPoss) {
        if (p === presser) this.press(p, own, dt);
        else if (p === container) this.contain(p, own, dt);
        else if (p === cover) this.coverPos(p, own);
        else this.mark(p, own);
      } else {
        if (p === chaser) { const ip = this.interceptPoint(p); moveTo(p, ip.x, ip.y, 2); }
        else { const f = formationPos(m, p, 0); moveTo(p, f.x, f.y, 10); }
      }
    }
    this.separate(mates);
  }

  receive(p) {
    const m = this.m, b = m.ball;
    const pt = m.pass.target;
    const dBall = Math.hypot(b.x - p.x, b.y - p.y);
    if (dBall < 5) { const ip = this.interceptPoint(p); moveTo(p, ip.x, ip.y, 3); }
    else moveTo(p, pt.x, pt.y, 4);
  }

  separate(mates) {
    for (const a of mates) {
      if (a.human >= 0 || a.role === 'GK' || a === this.m.owner) continue;
      for (const b of mates) {
        if (a === b || b.sentOff) continue;
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d < 4 && d > 0.01) { a.want.x += (dx / d) * (4 - d) * 0.8; a.want.y += (dy / d) * (4 - d) * 0.8; }
      }
    }
  }

  assignMarks(field, carrier) {
    const m = this.m;
    const opps = m.opps(this.team).filter((o) => o.role !== 'GK' && o !== carrier);
    const gc = m.goalCenter(m.ownSide(this.team));
    const marks = markTargets(field, opps, (p) => formationPos(m, p, -1), gc, { autoMarking: this.gp ? this.gp.autoMarking : true });
    for (const p of field) if (p.human < 0) p.ai.mark = marks.get(p) || null;
  }

  mark(p, carrier) {
    const m = this.m;
    const o = p.ai.mark;
    const gc = m.goalCenter(m.ownSide(this.team));
    if (o && !o.sentOff) {
      const n = norm(gc.x - o.x, gc.y - o.y);
      const tb = norm(m.ball.x - o.x, m.ball.y - o.y);
      // track a runner: stay goal-side and match his run
      const running = (o.vx * n.x + o.vy * n.y) < -2;
      const gap = running ? 1.2 : 1.8;
      let tx = o.x + n.x * gap + tb.x * 0.8 + (running ? o.vx * 0.25 : 0);
      let ty = o.y + n.y * gap + tb.y * 0.8 + (running ? o.vy * 0.25 : 0);
      if (this.gp && this.gp.defending === 'Assisted' && carrier) {
        // cover the passing lane from the carrier to my man
        const lx = carrier.x + (o.x - carrier.x) * 0.7, ly = carrier.y + (o.y - carrier.y) * 0.7;
        tx = tx * 0.6 + lx * 0.4; ty = ty * 0.6 + ly * 0.4;
      }
      moveTo(p, tx, ty, running ? 3 : 5);
    } else {
      const f = formationPos(m, p, -1);
      moveTo(p, f.x, f.y, 8);
    }
  }

  /** Contain: jockey goal-side of the carrier, facing him, without diving in. */
  contain(p, c, dt) {
    const m = this.m;
    const gc = m.goalCenter(m.ownSide(this.team));
    const n = norm(gc.x - c.x, gc.y - c.y);
    const d = dist(p, c);
    const tx = c.x + n.x * 2.3 + c.vx * 0.2, ty = c.y + n.y * 2.3 + c.vy * 0.2;
    moveTo(p, tx, ty, 5);
    if (d < 5) { p.jockey = true; p.sprint = d > 3.2; p.faceWant = Math.atan2(c.y - p.y, c.x - p.x); }
    // only nick the ball when it's clearly there to be won from the front
    p.ai.tackT -= dt;
    if (p.ai.tackT > 0 || p.tackleCD > 0 || c.state === 'hold') return;
    p.ai.tackT = this.prof.react * (0.8 + Math.random());
    const b = m.ball, dBall = Math.hypot(b.x - p.x, b.y - p.y), toBall = Math.atan2(b.y - p.y, b.x - p.x);
    if (dBall < 1.25 && !isFromBehind(p, c) && tackleSweep({ x: p.x + Math.cos(toBall) * 0.3, y: p.y + Math.sin(toBall) * 0.3 }, toBall, 0.8, b, [c], false).first === 'ball' && Math.random() < 0.3 + 0.3 * p.attrs.tackling) {
      p.facing = toBall; m.startTackle(p, 'stand', toBall);
    }
  }

  coverPos(p, carrier) {
    const m = this.m;
    const gc = m.goalCenter(m.ownSide(this.team));
    const n = norm(gc.x - carrier.x, gc.y - carrier.y);
    moveTo(p, carrier.x + n.x * 6, carrier.y + n.y * 6, 5);
  }

  press(p, c, dt) {
    const m = this.m, prof = this.prof;
    const gc = m.goalCenter(m.ownSide(this.team));
    const n = norm(gc.x - c.x, gc.y - c.y);
    const d = dist(p, c);
    // approach goal-side of the carrier, then close in on the ball
    const tx = d > 3 ? c.x + n.x * 1.4 : m.ball.x + n.x * 0.4;
    const ty = d > 3 ? c.y + n.y * 1.4 : m.ball.y + n.y * 0.4;
    moveTo(p, tx, ty, 3);
    p.want.x *= prof.press > 1 ? 1 : 0.85 + 0.15 * prof.press;
    p.want.y *= prof.press > 1 ? 1 : 0.85 + 0.15 * prof.press;
    p.ai.tackT -= dt;
    if (p.ai.tackT > 0 || p.tackleCD > 0) return;
    p.ai.tackT = prof.react * (0.6 + Math.random() * 0.8);
    const b = m.ball;
    const dBall = Math.hypot(b.x - p.x, b.y - p.y);
    const toBall = Math.atan2(b.y - p.y, b.x - p.x);
    if (c.state === 'hold') return;            // never challenge a keeper holding the ball
    const behind = isFromBehind(p, c);
    const careful = Math.random() < prof.careful;
    // would the lunge meet the ball before the man? (careless AI sometimes goes in anyway)
    const clean = (reach, lunge) => {
      const from = { x: p.x + Math.cos(toBall) * lunge, y: p.y + Math.sin(toBall) * lunge };
      return tackleSweep(from, toBall, reach, b, [c], false).first === 'ball';
    };
    const reckless = !careful && Math.random() < 0.1;
    if (dBall < 1.35 && ((!behind && clean(0.8, 0.3)) || reckless)) {
      if (Math.random() < 0.35 + 0.5 * p.attrs.tackling * prof.press) { p.facing = toBall; m.startTackle(p, 'stand', toBall); }
    } else if (dBall < 3.2 && dBall > 1.6 && Math.random() < 0.12 * prof.press && ((!behind && clean(1.0, 1.4)) || reckless) && p.stamina > 0.2) {
      p.facing = toBall; m.startTackle(p, 'slide', toBall);
    }
  }

  support(p, carrier, dt = 0) {
    const m = this.m;
    const dir = m.attackDir(this.team);
    let f = formationPos(m, p, 1);
    const prog = dir > 0 ? carrier.x : PITCH.L - carrier.x;
    const gx = dir > 0 ? PITCH.L : 0;
    const wideSide = (q) => (FORMATION[q.idx].y < 0.4 ? -1 : FORMATION[q.idx].y > 0.6 ? 1 : 0);
    const cw = wideSide(carrier), pw = wideSide(p);
    const carrierWide = carrier.role === 'MF' && cw !== 0 && Math.abs(carrier.y - CY) > 10;
    const finalThird = prog > PITCH.L * 0.62;
    let sprint = 7;
    if (p.ai.runT > 0 && p.ai.runTo) {
      // give-and-go: keep running after playing the ball
      moveTo(p, p.ai.runTo.x, p.ai.runTo.y, 2);
      return;
    }
    // width: the wide midfielders stretch the pitch in possession (and receive near the line)
    if (p.role === 'MF' && pw !== 0 && p !== carrier) {
      const far = Math.sign(carrier.y - CY) === -pw && Math.abs(carrier.y - CY) > 8;
      f = { x: f.x, y: pw < 0 ? (far ? 5.5 : 3.2) : PITCH.W - (far ? 5.5 : 3.2) };
      if (carrierWide && finalThird) f = { x: gx - dir * 8, y: CY - cw * 6 };      // attack the far post
    }
    // overlap: the full-back bombs on outside the winger who has the ball
    if (p.role === 'DF' && carrierWide && pw === cw && prog > PITCH.L * 0.4 && prog < PITCH.L * 0.85) {
      const other = m.mates(this.team).find((q) => q.role === 'DF' && q !== p);
      if (!other || wideSide(other) !== pw) {
        f = { x: clamp(carrier.x + dir * 8, 3, PITCH.L - 3), y: cw < 0 ? 2.5 : PITCH.W - 2.5 };
        sprint = 3;
      }
    }
    // underlap: the central midfielder runs into the half-space inside the winger
    if (p.role === 'MF' && pw === 0 && carrierWide && prog > PITCH.L * 0.5) {
      f = { x: clamp(carrier.x + dir * 7, 4, PITCH.L - 4), y: CY + cw * 7 };
      sprint = 4;
    }
    if (p.role === 'FW' && carrierWide && finalThird) {
      // attack the near post for the cross
      f = { x: gx - dir * 6.5, y: CY + cw * 2.5 };
      moveTo(p, f.x, f.y, 3);
      return;
    }
    // come short to help a team-mate under pressure
    const press = Math.min(...m.opps(this.team).map((o) => dist(o, carrier)));
    if (press < 2.8 && p.role === 'MF' && dist(p, carrier) < 16 && p === this.nearestSupport(carrier)) {
      const away = norm(p.x - carrier.x, p.y - carrier.y);
      f = { x: carrier.x + away.x * 7 - dir * 2, y: clamp(carrier.y + away.y * 7, 3, PITCH.W - 3) };
      moveTo(p, f.x, f.y, 4);
      return;
    }
    if (p.role === 'FW' && prog > PITCH.L * 0.3) {
      // run in behind: beyond the deepest defender
      const defs = m.opps(this.team).filter((o) => o.role !== 'GK');
      let deepest = dir > 0 ? 0 : PITCH.L;
      for (const o of defs) deepest = dir > 0 ? Math.max(deepest, o.x) : Math.min(deepest, o.x);
      const gx = dir > 0 ? PITCH.L - 7 : 7;
      const rx = dir > 0 ? Math.min(gx, deepest + 2.5) : Math.max(gx, deepest - 2.5);
      f = { x: rx, y: clamp(CY + (p.y - CY) * 0.6 + Math.sin(m.time * 0.4 + p.id) * 6, 12, PITCH.W - 12) };
    } else if (dist(p, carrier) < 9) {
      // open an angle away from the carrier
      const n = norm(p.x - carrier.x, p.y - carrier.y);
      f = { x: f.x + n.x * 4, y: f.y + n.y * 4 };
    }
    moveTo(p, f.x, clamp(f.y, 1.5, PITCH.W - 1.5), sprint);
  }

  nearestSupport(carrier) {
    let best = null, bd = 1e9;
    for (const q of this.m.mates(this.team)) {
      if (q === carrier || q.role !== 'MF' || q.human >= 0) continue;
      const d = dist(q, carrier);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  /** Decision making for an AI player on the ball. */
  carrier(p, dt) {
    const m = this.m, prof = this.prof;
    const dir = m.attackDir(this.team);
    const side = m.attackSide(this.team);
    const gc = m.goalCenter(side);
    const opps = m.opps(this.team);
    p.ai.decT -= dt;
    if (p.ai.decT <= 0) {
      p.ai.decT = prof.react * (0.6 + Math.random() * 0.8);
      const choice = this.decide(p, dir, side, gc, opps);
      if (choice.kind === 'shoot') { m.aiShoot(p, choice); return; }
      if (choice.kind === 'pass') { m.doPass(p, choice.pass, choice.mate, null); return; }
      if (choice.kind === 'clear') { m.clearBall(p); return; }
      if (choice.kind === 'cross') { m.doPass(p, 'lob', choice.mate, null); return; }
      if (choice.kind === 'skill') { m.startSkillMove(p, choice.mx, choice.my, false); return; }
      p.ai.dribDir = choice.dir;
    }
    // dribble steering
    let d = p.ai.dribDir || { x: dir, y: 0 };
    const toGoal = norm(gc.x - p.x, gc.y - p.y);
    d = norm(d.x * 0.6 + toGoal.x * 0.4, d.y * 0.6 + toGoal.y * 0.4);
    for (const o of opps) {
      const dx = p.x - o.x, dy = p.y - o.y, od = Math.hypot(dx, dy);
      if (od < 4.5 && od > 0.01) { d.x += (dx / od) * (4.5 - od) * 0.25; d.y += (dy / od) * (4.5 - od) * 0.25; }
    }
    if (p.y < 2.5) d.y += 0.5; if (p.y > PITCH.W - 2.5) d.y -= 0.5;
    if ((dir > 0 && p.x > PITCH.L - 3) || (dir < 0 && p.x < 3)) d.x -= dir * 0.8;
    d = norm(d.x, d.y);
    let nearest = 99, nOpp = null;
    for (const o of opps) { const od = dist(o, p); if (od < nearest) { nearest = od; nOpp = o; } }
    p.sprint = nearest > 4 && p.stamina > 0.3;
    // shield the ball from a defender tight behind: turn the body, slow down, look for a pass
    if (nOpp && nearest < 1.8 && isFromBehind(nOpp, p, 100) && p.role !== 'GK') {
      p.shield = true; p.sprint = false;
      p.faceWant = Math.atan2(p.y - nOpp.y, p.x - nOpp.x);
      p.ai.decT = Math.min(p.ai.decT, 0.25);
    }
    const sp = topSpeed(p, p.sprint) * 0.92;
    p.want.x = d.x * sp; p.want.y = d.y * sp;
  }

  decide(p, dir, side, gc, opps) {
    const m = this.m, prof = this.prof;
    const noise = () => (Math.random() - 0.5) * (1.2 - prof.acc) * 0.8;
    const dGoal = dist(p, gc);
    const nearestOpp = Math.min(...opps.map((o) => dist(o, p)));
    const pressure = clamp(1 - (nearestOpp - 1) / 5, 0, 1);
    const options = [];
    // shooting
    if (dGoal < 30) {
      const ang = angleBetween(dir, 0, gc.x - p.x, gc.y - p.y);
      const open = laneRisk(p, gc, opps.filter((o) => o.role !== 'GK'));
      let s = 1.45 - dGoal / 19 - ang * 0.5 - open * 0.5 + p.attrs.shooting * 0.3;
      if (inPenaltyArea(p, side)) s += 0.35;
      options.push({ kind: 'shoot', score: s + noise(), dGoal });
    }
    // passing
    for (const mate of m.mates(this.team)) {
      if (mate === p || mate.role === 'GK' || mate.sentOff) continue;
      const d = dist(p, mate);
      if (d < 4 || d > 38) continue;
      for (const kind of ['ground', 'through', 'lob']) {
        if (kind === 'through' && (mate.role === 'DF' || (mate.vx * dir) < 2)) continue;
        if (kind === 'lob' && d < 16) continue;
        const plan = leadTarget(p, mate, kind, dir);
        const risk = laneRisk(p, plan.target, opps, kind);
        const gain = ((plan.target.x - p.x) * dir) / 22;
        const space = Math.min(...opps.map((o) => dist(o, plan.target)));
        const tGoal = dist(plan.target, gc);
        let s = 0.45 + gain * 0.8 + clamp(space / 7, 0, 1) * 0.45 - risk * 1.5 - (tGoal < 20 ? -0.2 : 0) - (kind === 'lob' ? 0.45 : 0);
        s += pressure * 0.25;
        if (gain < -0.3) s -= 0.2;
        options.push({ kind: 'pass', pass: kind, mate, score: s + noise() });
      }
    }
    // clearance: under pressure deep in our own half, get rid of it (often into touch)
    const ownGoal = m.goalCenter(1 - side);
    const dOwn = dist(p, ownGoal);
    if (dOwn < 26 && pressure > 0.5 && p.role !== 'GK') {
      options.push({ kind: 'clear', score: 0.55 + pressure * 0.6 + (inPenaltyArea(p, 1 - side) ? 0.45 : 0) - p.attrs.passing * 0.25 + noise() });
    }
    // cross from wide areas in the final third to a team-mate attacking the box
    if (Math.abs(p.y - CY) > 11 && dGoal < 28) {
      let tgt = null, bs = 0;
      for (const mate of m.mates(this.team)) {
        if (mate === p || mate.role === 'GK' || !inPenaltyArea(mate, side)) continue;
        const sc = 1 - Math.abs(mate.y - CY) / 20;
        if (sc > bs) { bs = sc; tgt = mate; }
      }
      if (tgt) options.push({ kind: 'cross', mate: tgt, score: 0.75 + bs * 0.35 + pressure * 0.2 + noise() });
    }
    // dribbling
    let ahead = 0;
    for (const o of opps) {
      const dx = (o.x - p.x) * dir;
      if (dx > 0 && dx < 7 && Math.abs(o.y - p.y) < 3.5) ahead++;
    }
    const drib = 0.62 + (ahead === 0 ? 0.35 : -0.25 * ahead) + (p.attrs.dribbling - 0.5) * 0.3 - pressure * 0.35;
    const toGoal = norm(gc.x - p.x, gc.y - p.y);
    options.push({ kind: 'dribble', score: drib + noise(), dir: toGoal });
    if (pressure > 0.7 && Math.random() < 0.18 * p.attrs.dribbling) {
      options.push({ kind: 'skill', score: 1.2, mx: toGoal.x + (Math.random() - 0.5), my: toGoal.y + (Math.random() - 0.5) });
    }
    options.sort((a, b) => b.score - a.score);
    return options[0];
  }
}

/** Goalkeeper positioning, shot reading (decides save intent) and distribution. */
export function updateKeeper(m, gk, dt, prof) {
  const side = m.ownSide(gk.team);
  const gx = side === 0 ? 0 : PITCH.L;
  const inward = side === 0 ? 1 : -1;
  const b = m.ball;
  const kp = clamp(gk.attrs.keeping * (gk.human >= 0 ? 1 : 1) * (m.isHumanTeam(gk.team) ? 1 : prof.keeper), 0.1, 1.15);

  if (gk.state === 'hold') {
    gk.holdT += dt;
    gk.faceWant = inward > 0 ? 0 : Math.PI;
    if (gk.holdT > 1.3) m.keeperDistribute(gk);
    return;
  }
  if (gk.state !== 'run') return;

  // --- read shots: any fast free ball heading at our goal
  const speed = Math.hypot(b.vx, b.vy);
  if (!m.owner && speed > 7 && b.vx * inward < 0 && b.kickId !== gk.ai.kickSeen) {
    gk.ai.kickSeen = b.kickId;
    const lineX = side === 0 ? Math.max(gk.x, 0.2) : Math.min(gk.x, PITCH.L - 0.2);
    const path = simulatePath(b, 1.8, (bb) => (bb.x - lineX) * inward <= 0, 1);
    const P = path[path.length - 1];
    if (P && (P.x - lineX) * inward <= 0.05 && Math.abs(P.y - CY) < GOAL.W / 2 + 1.2 && P.z < GOAL.H + 0.6) {
      const react = clamp(0.24 - 0.12 * kp, 0.06, 0.3) + Math.random() * 0.06;
      gk.ai.pendingDive = { at: m.time + react, P, tHit: m.time + P.t, kick: b.kickId, speed, lineX };
    } else gk.ai.pendingDive = null;
  }
  const pd = gk.ai.pendingDive;
  if (pd && m.time >= pd.at) {
    gk.ai.pendingDive = null;
    if (pd.kick === b.kickId && !m.owner) {
      const P = pd.P;
      const tAvail = Math.max(0.02, pd.tHit - m.time);
      const D = Math.abs(P.y - gk.y);
      const reach = 1.0 + 0.8 * kp;
      const diveSpeed = 4.5 + 3.2 * kp;
      const reachable = D - reach <= diveSpeed * tAvail;
      const nearPost = Math.abs(P.y - CY) > GOAL.W / 2 - 1.1;
      const high = P.z > 1.75;
      let prob = 0.96 - Math.max(0, pd.speed - 13) * 0.022 - (nearPost ? 0.16 : 0) - (high ? 0.1 : 0) - (D > 2.2 ? 0.1 : 0);
      prob *= 0.78 + 0.25 * kp;
      if (!reachable) prob = 0.05;
      if (D < 0.7) prob = Math.max(prob, 0.9 * (0.8 + 0.2 * kp));
      gk.saveIntent = Math.random() < clamp(prob, 0.03, 0.97);
      gk.saveKick = pd.kick;
      const s = Math.sign(P.y - gk.y) || 1;
      const bodyY = gk.saveIntent ? P.y - s * Math.min(D, reach * 0.7) : P.y - s * (reach + 0.9);
      const bodyX = pd.lineX + inward * 0.15;
      if (D > 0.9) {
        gk.state = 'dive'; gk.stateT = 0; gk.stateDur = 0.75;
        gk.dive = { dir: s, z: P.z };
        const t = Math.max(0.12, tAvail);
        const vy = clamp((bodyY - gk.y) / t, -diveSpeed * 1.4, diveSpeed * 1.4);
        const vx = clamp((bodyX - gk.x) / t, -3, 3);
        gk.vx = vx; gk.vy = vy;
        gk.facing = inward > 0 ? 0 : Math.PI;
      }
      m.emit('keeperDive', { gk, save: gk.saveIntent });
    }
    return;
  }

  // --- positioning on the ball–goal angle
  const gc = { x: gx, y: CY };
  const toBall = norm(b.x - gc.x, b.y - gc.y);
  const db = dist(b, gc);
  let out = clamp(0.8 + db * 0.07, 0.8, 4.2);
  let tx = gc.x + toBall.x * out, ty = gc.y + toBall.y * out;
  ty = clamp(ty, CY - GOAL.W / 2 - 0.6, CY + GOAL.W / 2 + 0.6);
  tx = side === 0 ? clamp(tx, 0.3, 5.5) : clamp(tx, PITCH.L - 5.5, PITCH.L - 0.3);

  const own = m.owner;
  const inBox = inPenaltyArea(b, side);
  gk.ai.claim = false;
  let rush = false;
  const cross = !own ? crossLanding(m, gk, side) : null;
  if (cross) {
    // come for the cross: claim (or punch) it at the highest point
    tx = cross.x; ty = cross.y; gk.ai.claim = true; rush = true;
  } else if (!own && inBox && speed < 12) {
    // collect loose balls in the box if we are the closest
    const opps = m.opps(gk.team);
    const myD = dist(gk, b);
    const oppD = Math.min(...opps.map((o) => dist(o, b)));
    if (myD < oppD + 1.5 || myD < 3) { tx = b.x; ty = b.y; rush = true; }
  } else if (own && own.team !== gk.team && dist(own, gc) < 22) {
    const n = norm(own.x - gc.x, own.y - gc.y);
    const through = isThrough(m, gk, own, gc);
    if (through && dist(own, gc) < 20) {
      // 1v1: rush out and spread, to smother at the striker's feet
      const d = clamp(dist(own, gc) - 1.3, 1, BOX.D - 0.5);
      tx = gc.x + n.x * d; ty = gc.y + n.y * d; rush = true;
      const db = dist(gk, b);
      if (db < 2.4 && gk.tackleCD <= 0 && inBox && Math.random() < (0.18 + 0.22 * kp) * dt * 10) {
        m.startTackle(gk, 'slide', Math.atan2(b.y - gk.y, b.x - gk.x));
        return;
      }
    } else if (inBox && dist(own, gc) < 13) {
      // narrow the angle
      const d = clamp(dist(own, gc) - 2.2, 1, 9);
      tx = gc.x + n.x * d; ty = gc.y + n.y * d;
      if (dist(gk, own) < 1.6 && gk.tackleCD <= 0 && Math.random() < 0.05 + 0.1 * kp) {
        m.startTackle(gk, 'stand', Math.atan2(b.y - gk.y, b.x - gk.x));
        return;
      }
    }
  }
  const dx = tx - gk.x, dy = ty - gk.y, d = Math.hypot(dx, dy);
  const sp = Math.min(d * 3 + (rush ? 2 : 0), topSpeed(gk, d > 4 || rush));
  gk.sprint = d > 4 || rush;
  gk.want.x = d > 0.05 ? (dx / d) * sp : 0; gk.want.y = d > 0.05 ? (dy / d) * sp : 0;
  gk.faceWant = Math.atan2(b.y - gk.y, b.x - gk.x);
}

/** Is the carrier clean through on goal (no outfield defender between him and the goal)? */
export function isThrough(m, gk, carrier, gc) {
  const dc = dist(carrier, gc);
  for (const d of m.mates(gk.team)) {
    if (d === gk || d.role === 'GK') continue;
    if (dist(d, gc) > dc + 0.5) continue;
    if (distToSegment(d, carrier, gc).d < 2.8) return false;
  }
  return true;
}

/**
 * A high ball dropping into our six-yard / near-post area that the keeper can get to:
 * returns the point where it comes down through catching height, or null.
 */
export function crossLanding(m, gk, side) {
  const b = m.ball;
  if (m.shot || !m.pass || m.pass.team === gk.team || m.pass.kind === 'ground' || m.pass.kind === 'through') return null;
  const gx = side === 0 ? 0 : PITCH.L;
  let high = b.z > 1.2;
  for (const pt of m.ballPath) {
    if (pt.z > 2.2) high = true;
    if (high && pt.z < 2.6 && pt.t > 0.15) {
      if (Math.abs(pt.x - gx) > 10 || Math.abs(pt.y - CY) > 10) return null;
      const reachT = Math.max(0, Math.hypot(pt.x - gk.x, pt.y - gk.y) - 1) / 7 + 0.1;
      return reachT <= pt.t + 0.25 ? { x: pt.x, y: pt.y, t: pt.t } : null;
    }
  }
  return null;
}
