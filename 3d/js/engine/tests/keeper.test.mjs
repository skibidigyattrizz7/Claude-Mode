// Goalkeeper AI tests: sweeping loose / through balls, claiming crosses, one-on-ones (advance, set, lunge at the feet with a
// real contest), human keeper not overridden, determinism, and a goals-per-match sanity check.
// Runs standalone: node 3d/js/engine/tests/keeper.test.mjs
import assert from 'node:assert/strict';
import { MatchSim } from '../core/sim.js';
import { PHASE, BALL_R, SP } from '../core/constants.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

const DT = 1 / 120;
const NONE = { mx: 0, my: 0, aimX: 0, aimY: 0, sprint: false, pass: false, through: false, lob: false, shoot: false, finesse: false, switchP: false, tackle: false, skill: false, jockey: false, power: false };
const GK_STRONG = { pos: 90, spd: 82, han: 90, div: 90, ref: 90 };
const GK_POOR = { pos: 50, spd: 55, han: 42, div: 52, ref: 50 };
const GK_HANDS = { pos: 80, spd: 72, han: 40, div: 65, ref: 65 }; // same reach, poor handling
const GK_AVG = { pos: 78, spd: 72, han: 76, div: 78, ref: 78 };

// Home (team 0, attacking +x) against a France keeper on the +x goal line. Everyone else is parked far from the box.
function mk({ seed = 1, keeper = GK_AVG, difficulty = 'pro', controllers = { home: 'ai', away: 'ai' } } = {}) {
  const away = structuredClone(FRANCE);
  Object.assign(away.players[0].attrs, keeper);
  const gameplay = { home: { autoSwitchAssist: 'none' }, away: { autoSwitchAssist: 'none' } }; // no reception assist driving a human's player
  const sim = new MatchSim({ home: structuredClone(BRAZIL), away, halfMinutes: 3, difficulty, controllers, seed, gameplay });
  sim.step(DT, [null, null]);
  sim.phase = PHASE.PLAY; sim.sp.done = true; sim.dir = [1, -1];
  sim.players.forEach((q, k) => { if (!q.isGK) sim._teleport(q, q.team === 0 ? -45 : -48, -30 + (k % 11) * 5); });
  sim._teleport(sim.gk(0), -51.5, 0);
  sim._teleport(sim.gk(1), 51.5, 0);
  return { sim, gk: sim.gk(1), att: sim.players[9], att2: sim.players[10] };
}
function give(sim, p, x, z, face = 0) {
  sim._teleport(p, x, z); p.face = face;
  const b = sim.ball;
  b.owner = p.idx; b.inHands = false; b.p.x = x + Math.cos(face) * 0.45; b.p.z = z + Math.sin(face) * 0.45; b.p.y = BALL_R;
  b.v.x = b.v.y = b.v.z = 0; b.lastTeam = p.team; b.lastTouch = p.idx;
}
function loose(sim, x, y, z, vx, vy, vz) {
  const b = sim.ball;
  b.owner = -1; b.inHands = false; b.p.x = x; b.p.y = y; b.p.z = z; b.v.x = vx; b.v.y = vy; b.v.z = vz; b.w.x = b.w.y = b.w.z = 0;
  b.lastTeam = 0; b.lastTouch = 9; b.kicker = 9; b.kickT = sim.t; b.intended = -1; b.throughBall = false;
  sim.path = null; sim.pendingPass = null; sim.nextPredict = 0;
}
// straight-at-goal dribble that ignores the attacker AI's own decisions (like a human running at the keeper)
function dribbleAtGoal(sim, att) {
  att.nextThink = 1e9; att.roundUntil = 1e9;
  let on = true;
  return () => {
    if (!on) return;
    const dx = 52.5 - att.x, dz = -att.z, l = Math.hypot(dx, dz) || 1;
    if (sim.ball.owner === att.idx) att.drib = { x: dx / l, z: dz / l, sprint: true, t0: sim.t };
    else { on = false; att.roundUntil = 0; att.nextThink = 0; }
  };
}

// The keeper's fate after a through ball: claimed in his hands / cleared with his feet / etc.
function throughBall(seed, keeper = GK_AVG) {
  const { sim, gk, att } = mk({ seed, keeper });
  sim._teleport(att, 30, 3); att.face = 0;
  loose(sim, 31, BALL_R, 2, 15, 0, 0);
  let got = null, firstAtt = false;
  for (let t = 0; t < 4 && sim.phase === PHASE.PLAY; t += DT) {
    sim.step(DT, [null, null]);
    if (sim.ball.owner === att.idx) firstAtt = true;
    if (sim.ball.owner === gk.idx) { got = { inHands: sim.ball.inHands, x: gk.x, t }; break; }
  }
  return { got, firstAtt, sim, gk };
}

function crossInto(seed, keeper) {
  const { sim, gk } = mk({ seed, keeper });
  sim._teleport(sim.players[9], 44, 8); sim._teleport(sim.players[10], 47, -3);
  loose(sim, 40, 0.5, 20, 9, 8, -12);
  let out = 'none', fx = 0, jumped = false;
  for (let t = 0; t < 3.5 && sim.phase === PHASE.PLAY; t += DT) {
    sim.step(DT, [null, null]);
    if (gk.act && gk.act.type === 'gkjump') jumped = true;
    if (sim.ball.owner === gk.idx && sim.ball.inHands) { out = 'catch'; break; }
    for (const f of sim.fx) if (f.id > fx) { fx = f.id; if (f.k === 'punch') out = 'punch'; else if (f.k === 'parry' && t > 0.5 && out === 'none') out = 'fumble'; else if (f.k === 'goal') out = 'goal'; }
    if (out !== 'none') break;
  }
  return { out, jumped };
}

function oneOnOne(seed, keeper, attAttrs = null) {
  const { sim, gk, att } = mk({ seed, keeper });
  if (attAttrs) Object.assign(att.a, attAttrs);
  const z0 = ((seed * 7) % 15) - 7, x0 = 26 + (seed % 4) * 2;
  give(sim, att, x0, z0, Math.atan2(-z0, 52.5 - x0));
  const steer = dribbleAtGoal(sim, att);
  let lunged = false, out = null, atShoot = null;
  for (let t = 0; t < 8 && sim.phase === PHASE.PLAY; t += DT) {
    steer();
    const had = !!gk.lunge;
    sim.step(DT, [null, null]);
    if (!atShoot && att.x > 42.5) atShoot = { gkX: 52.5 - gk.x, gkZ: gk.z, lineZ: att.z * (1 - (52.5 - gk.x) / (52.5 - att.x)), ball: sim.ball.p.z };
    if (gk.lunge) lunged = true;
    if (had && !gk.lunge) {
      if (sim.ball.owner === gk.idx) out = 'win';
      else if (sim.phase !== PHASE.PLAY) out = 'foul';
      else if (sim.ball.owner === att.idx) out = 'rounded';
      else out = 'touch';
      break;
    }
  }
  if (!out) out = sim.score[0] ? 'goal' : 'none';
  return { out, lunged, atShoot, sim };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack)); }
}

console.log('sweeper keeper');
test('a through ball into the space behind the defence that the keeper reaches first is claimed', () => {
  let claimed = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = throughBall(seed);
    assert.ok(!r.firstAtt, 'the attacker must not get it first, seed ' + seed);
    if (r.got && r.got.inHands) claimed++;
    assert.ok(r.got, 'seed ' + seed + ' keeper gets it');
    assert.ok(52.5 - r.got.x < 16.5 + 1, 'claimed with hands inside his box: ' + (52.5 - r.got.x));
  }
  assert.equal(claimed, 6);
});
test('the keeper comes off his line for it (sprints out several metres)', () => {
  const { sim, gk } = mk({ seed: 3 });
  const att = sim.players[9];
  sim._teleport(att, 30, 3); loose(sim, 31, BALL_R, 2, 15, 0, 0);
  let minX = 99;
  for (let t = 0; t < 1.5 && sim.ball.owner < 0; t += DT) { sim.step(DT, [null, null]); minX = Math.min(minX, gk.x); }
  assert.ok(51.5 - minX > 3, 'came out ' + (51.5 - minX).toFixed(1) + ' m');
});
test('a ball the attacker reaches first is not chased recklessly', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const { sim, gk, att } = mk({ seed });
    sim._teleport(att, 36, 3); att.face = 0; att.vx = 5;
    loose(sim, 37.6, BALL_R, 3, 4, 0, 0); // a slow ball, right at the attacker's feet, 15 m from the keeper
    let sweeps = 0, maxOut = 0;
    for (let t = 0; t < 0.45 && sim.ball.owner < 0; t += DT) {
      sim.step(DT, [null, null]);
      if (gk.sweepUntil > sim.t) sweeps++;
      maxOut = Math.max(maxOut, 51.5 - gk.x);
    }
    assert.equal(sweeps, 0, 'never committed to it, seed ' + seed);
    assert.ok(maxOut < 3, 'stayed near his line: ' + maxOut.toFixed(1));
  }
});
test('a keeper outside his box uses his feet, never his hands, and clears it', () => {
  const { sim, gk } = mk({ seed: 2, keeper: GK_STRONG });
  sim._teleport(sim.players[9], 10, 0);
  loose(sim, 27, BALL_R, 0, 15, 0, 0); // will roll well beyond the box edge (x 36) toward the keeper
  let outsideHands = false, played = false, everOwned = false;
  for (let t = 0; t < 5; t += DT) {
    sim.step(DT, [null, null]);
    if (sim.ball.owner === gk.idx) { everOwned = true; if (52.5 - gk.x > 16.9 && sim.ball.inHands) outsideHands = true; }
    if (everOwned && sim.ball.owner !== gk.idx && sim.ball.lastTouch === gk.idx) { played = true; break; }
  }
  assert.ok(!outsideHands, 'no handling outside the box');
  assert.ok(!everOwned || played, 'he plays it away rather than holding it at his feet');
});

console.log('crosses and high balls');
test('a cross into the box is caught by a good handler (jump-catch)', () => {
  let catches = 0, jumps = 0;
  for (let seed = 1; seed <= 12; seed++) { const r = crossInto(seed, GK_STRONG); if (r.out === 'catch') catches++; if (r.jumped) jumps++; }
  assert.ok(catches >= 10, 'catches ' + catches);
  assert.ok(jumps >= 10, 'jump-catch animation ' + jumps);
});
test('weaker handlers punch more and fumble sometimes; every cross is dealt with (catch / punch / spill, no goal)', () => {
  const tally = (kp) => { const c = { catch: 0, punch: 0, fumble: 0, none: 0, goal: 0 }; for (let seed = 1; seed <= 30; seed++) c[crossInto(seed, kp).out]++; return c; };
  const weak = tally(GK_HANDS), strong = tally(GK_STRONG);
  if (process.env.KDEBUG) console.log('weak', JSON.stringify(weak), 'strong', JSON.stringify(strong));
  assert.ok(weak.punch > strong.punch + 4, `weak punches ${weak.punch} vs strong ${strong.punch}`);
  assert.ok(weak.fumble >= 1, 'fumbles ' + weak.fumble);
  assert.ok(weak.catch >= 5 && strong.catch > weak.catch, `catches weak ${weak.catch} strong ${strong.catch}`);
  assert.equal(weak.goal + strong.goal, 0);
  assert.equal(weak.none + strong.none, 0);
});

console.log('one on ones');
test('the keeper advances on the ball-to-goal line and lunges at the feet; sometimes he wins it, sometimes he is rounded', () => {
  const tally = { win: 0, rounded: 0, touch: 0, foul: 0, none: 0, goal: 0 };
  let lunges = 0, advanced = 0, onLine = 0, n = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = oneOnOne(seed, GK_AVG);
    tally[r.out]++; if (r.lunged) lunges++;
    if (r.atShoot) { n++; if (r.atShoot.gkX > 2.6) advanced++; if (Math.abs(r.atShoot.gkZ - r.atShoot.lineZ) < 1.6) onLine++; }
  }
  assert.ok(lunges >= 36, 'lunges ' + lunges);
  assert.ok(tally.win >= 6, 'keeper wins ' + tally.win);
  assert.ok(tally.rounded >= 6, 'attacker rounds him ' + tally.rounded);
  assert.ok(tally.win < 30 && tally.rounded < 30, JSON.stringify(tally));
  assert.ok(advanced >= n * 0.8, 'advanced ' + advanced + '/' + n);
  assert.ok(onLine >= n * 0.7, 'on the line ' + onLine + '/' + n);
});
test('the contest depends on attributes: an elite keeper wins more lunges than a poor one', () => {
  const wins = (kp) => { let w = 0; for (let seed = 1; seed <= 50; seed++) if (oneOnOne(seed, kp).out === 'win') w++; return w; };
  const strong = wins(GK_STRONG), weak = wins(GK_POOR);
  assert.ok(strong > weak + 5, `strong ${strong} weak ${weak}`);
});
test('a rounded keeper is beaten (the goal is open), and a lunge can also concede a penalty', () => {
  let rounded = 0, scored = 0, pens = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = oneOnOne(seed, GK_AVG);
    if (r.out === 'foul') { pens++; assert.equal(r.sim.pending.type, SP.PENALTY); assert.equal(r.sim.pending.team, 0); }
    if (r.out !== 'rounded') continue;
    rounded++;
    for (let t = 0; t < 4 && r.sim.phase === PHASE.PLAY; t += DT) r.sim.step(DT, [null, null]);
    if (r.sim.score[0] > 0) scored++;
  }
  assert.ok(rounded >= 10, 'rounded ' + rounded);
  assert.ok(scored >= rounded * 0.5, `scored ${scored} of ${rounded}`);
  assert.ok(pens <= 12, 'penalties ' + pens);
});
test('a loose ball in the box with an attacker closing: the keeper lunges (loose-ball contest) or claims it', () => {
  let acted = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { sim, gk, att } = mk({ seed, keeper: GK_AVG });
    sim._teleport(att, 47.6, 3.2);
    loose(sim, 49.2, BALL_R, 1.6, -0.8, 0, -0.6); // a heavy touch, a few metres in front of the keeper, the attacker right behind it
    for (let t = 0; t < 2.5 && sim.phase === PHASE.PLAY; t += DT) {
      sim.step(DT, [null, null]);
      if (gk.lunge || (sim.ball.owner === gk.idx)) { acted++; break; }
    }
  }
  assert.ok(acted >= 9, 'acted ' + acted);
});

console.log('control and determinism');
test('a human-controlled keeper is not overridden by the keeper AI', () => {
  const { sim, gk } = mk({ seed: 4, controllers: { home: 'ai', away: 'p1' } });
  const att = sim.players[9];
  sim._teleport(att, 30, 3); loose(sim, 31, BALL_R, 2, 15, 0, 0);
  const keeperOn = { ...NONE, keeper: true };
  let moved = 0;
  for (let t = 0; t < 1.6 && sim.ball.owner < 0; t += DT) { sim.step(DT, [null, { ...keeperOn }]); moved = Math.max(moved, Math.hypot(gk.x - 51.5, gk.z)); }
  assert.equal(sim.ctrl[1], gk.idx, 'the human is on the keeper');
  assert.ok(moved < 0.4, 'the AI did not run him out: ' + moved.toFixed(2));
  assert.ok(!(gk.sweepUntil > sim.t));
  // and when he gives the stick a push, he moves
  const { sim: s2, gk: g2 } = mk({ seed: 4, controllers: { home: 'ai', away: 'p1' } });
  loose(s2, 20, BALL_R, 20, 0, 0, 0);
  for (let t = 0; t < 1; t += DT) s2.step(DT, [null, { ...keeperOn, mx: 0, my: 1 }]);
  assert.ok(Math.abs(g2.z) > 1 || Math.abs(g2.x - 51.5) > 1, 'moves with the stick');
});
test('the keeper AI also works on the human side (home keeper is AI-driven when the human is not on him)', () => {
  const { sim } = mk({ seed: 5, controllers: { home: 'p1', away: 'ai' } });
  sim.dir = [-1, 1];
  const home = sim.gk(0), att = sim.players[20];
  sim._teleport(sim.gk(0), 51.5, 0); sim._teleport(sim.gk(1), -51.5, 0);
  sim._teleport(att, 30, 3); att.face = 0;
  loose(sim, 31, BALL_R, 2, 15, 0, 0);
  sim.ball.lastTeam = 1; sim.ball.kicker = att.idx; sim.ball.lastTouch = att.idx;
  let minX = 99, got = false;
  for (let t = 0; t < 3 && sim.phase === PHASE.PLAY; t += DT) {
    sim.step(DT, [null, null]);
    minX = Math.min(minX, home.x);
    if (sim.ball.owner === home.idx) { got = true; break; }
  }
  assert.ok(51.5 - minX > 3, 'came out ' + (51.5 - minX).toFixed(1));
  assert.ok(got, 'claimed it');
});
test('deterministic: the same seed gives the same one-on-one, frame for frame', () => {
  const run = (seed) => {
    const { sim, gk, att } = mk({ seed });
    give(sim, att, 30, 5, Math.atan2(-5, 22.5));
    const steer = dribbleAtGoal(sim, att);
    const trace = [];
    for (let k = 0; k < 480 && sim.phase === PHASE.PLAY; k++) { steer(); sim.step(DT, [null, null]); if (k % 24 === 0) trace.push([gk.x, gk.z, att.x, sim.ball.p.x, sim.ball.p.y, sim.ball.owner].map((v) => +v.toFixed(5)).join(',')); }
    return trace.join('|') + '#' + sim.rng().toFixed(9);
  };
  assert.equal(run(9), run(9));
  assert.notEqual(run(9), run(10));
});

console.log('match sanity');
test('AI vs AI matches keep a sensible goal count (not goalless, not a basketball score)', () => {
  let goals = 0, matches = 0, zero = 0, maxG = 0;
  for (let seed = 0; seed < 8; seed++) {
    const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 3, difficulty: 'pro', controllers: { home: 'ai', away: 'ai' }, seed: 1000 + seed });
    let k = 0;
    while (!sim.ended && k < 120 * 60 * 8) { sim.step(DT, [null, null]); k++; }
    const g = sim.score[0] + sim.score[1];
    goals += g; matches++; if (!g) zero++; maxG = Math.max(maxG, g);
  }
  const avg = goals / matches;
  assert.ok(avg > 0.8 && avg < 5, 'avg goals/match ' + avg.toFixed(2));
  assert.ok(zero <= 3, 'goalless matches ' + zero);
  assert.ok(maxG <= 12, 'max ' + maxG);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
