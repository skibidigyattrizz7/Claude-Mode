// Pure-logic unit tests for the match engine. Run with:  node 3d/js/engine/tests/physics.test.mjs
import assert from 'node:assert/strict';
import { createBall, stepBall, classifyBall, wholeBallOver, keeperCanSave, magnusAccel, predictBall } from '../core/physics.js';
import { judgeTackle, isFromBehind, isOffside, inOwnPenaltyArea, ShotTracker } from '../core/rules.js';
import { leadPass, rollTimeTo, rollSpeedFor, rollDistAt, solveLob, solveShot } from '../core/passing.js';
import { BALL_R, GOAL, PITCH, PHASE, SP } from '../core/constants.js';
import { MatchSim } from '../core/sim.js';
import { encodeSnapshot, lerpView } from '../core/snapshot.js';
import { assignSlots } from '../core/formations.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const HL = PITCH.HL;
const ball = (x, y, z, vx = 0, vy = 0, vz = 0, w = { x: 0, y: 0, z: 0 }) => { const b = createBall(); b.p = { x, y, z }; b.v = { x: vx, y: vy, z: vz }; b.w = { ...w }; return b; };
const run = (b, secs, ev) => { for (let i = 0; i < secs * 120; i++) stepBall(b, 1 / 120, ev); return b; };

console.log('goal line');
test('ball centre on the line is not a goal', () => {
  assert.equal(classifyBall({ x: HL, y: 0.5, z: 0 }), null);
});
test('ball over the line by less than its radius is not a goal', () => {
  assert.equal(classifyBall({ x: HL + BALL_R * 0.9, y: 0.5, z: 0 }), null);
  assert.equal(wholeBallOver({ x: HL + 0.1, y: 0.5, z: 0 }, 1), false);
});
test('whole ball over the line between posts and under bar is a goal', () => {
  assert.deepEqual(classifyBall({ x: HL + BALL_R + 0.01, y: 0.5, z: 1 }), { type: 'goal', side: 1 });
  assert.deepEqual(classifyBall({ x: -HL - BALL_R - 0.01, y: 2.0, z: -3 }), { type: 'goal', side: -1 });
});
test('whole ball over the line outside the posts / over the bar is a goal kick/corner', () => {
  assert.equal(classifyBall({ x: HL + 0.2, y: 0.5, z: GOAL.HW + 0.5 }).type, 'byline');
  assert.equal(classifyBall({ x: HL + 0.2, y: GOAL.H + 0.3, z: 0 }).type, 'byline');
});
test('keeper can save only before the whole ball has crossed', () => {
  assert.equal(keeperCanSave({ x: HL + 0.05, y: 1, z: 0 }, 1), true);
  assert.equal(keeperCanSave({ x: HL + 0.2, y: 1, z: 0 }, 1), false);
  assert.equal(keeperCanSave({ x: -HL - 0.2, y: 1, z: 0 }, 1), true); // other end irrelevant
});
test('shot tracker: keeper touch then goal reports goal only, never both', () => {
  const st = new ShotTracker(1.0);
  st.onShot(0, 10, 5);
  assert.equal(st.onKeeperTouch(10.4, false), true);
  const g = st.onGoal();
  assert.equal(g.goal, true);
  assert.equal(st.update(12, false), null);
  assert.equal(st.update(12, true), null);
});
test('shot tracker: keeper touch after ball wholly over the line is not a save', () => {
  const st = new ShotTracker(1.0);
  st.onShot(0, 10, 5);
  assert.equal(st.onKeeperTouch(10.4, true), false);
  const r = st.update(11.6, false);
  assert.ok(!r || !r.save);
});
test('shot tracker: confirmed save when no goal follows', () => {
  const st = new ShotTracker(1.0);
  st.onShot(1, 3, 12);
  st.onKeeperTouch(3.5, false);
  assert.equal(st.update(4.0, false), null);
  assert.equal(st.update(4.6, false).save, true);
});
test('ball driven into the goal ends up in the net, not through it', () => {
  const b = ball(HL - 5, 1, 0, 25, 0, 0);
  const ev = [];
  run(b, 1.5, ev);
  assert.ok(b.p.x > HL && b.p.x < HL + GOAL.DEPTH + 0.01, 'x=' + b.p.x);
  assert.ok(ev.some((e) => e.k === 'net'));
});
test('ball hitting the post bounces back', () => {
  const b = ball(HL - 4, 1, GOAL.HW + 0.06, 20, 0, 0);
  const ev = [];
  run(b, 0.4, ev);
  assert.ok(ev.some((e) => e.k === 'post'));
  assert.ok(b.v.x < 0, 'vx=' + b.v.x);
});
test('ball hitting the crossbar is deflected', () => {
  const b = ball(HL - 4, GOAL.H + 0.06, 0, 20, 0.4, 0);
  const ev = [];
  run(b, 0.3, ev);
  assert.ok(ev.some((e) => e.k === 'post'));
});

console.log('ball physics');
test('gravity + bounce with restitution below 1', () => {
  const b = ball(0, 3, 0);
  let maxAfter = 0, bounced = false;
  for (let i = 0; i < 240; i++) { const vy = b.v.y; stepBall(b, 1 / 120); if (vy < 0 && b.v.y > 0) bounced = true; if (bounced) maxAfter = Math.max(maxAfter, b.p.y); }
  assert.ok(bounced);
  assert.ok(maxAfter < 3 * 0.6 && maxAfter > 0.4, 'rebound height ' + maxAfter);
});
test('rolling ball decelerates and stops', () => {
  const b = ball(0, BALL_R, 0, 10, 0, 0);
  run(b, 12);
  assert.ok(Math.hypot(b.v.x, b.v.z) < 0.01);
  assert.ok(b.p.x > 10 && b.p.x < 40, 'rolled ' + b.p.x);
});
test('rolling distance matches the analytic model used for passing', () => {
  const b = ball(0, BALL_R, 0, 15, 0, 0);
  run(b, 1.5);
  const expect = rollDistAt(15, 1.5);
  assert.ok(Math.abs(b.p.x - expect) < 0.15, `${b.p.x} vs ${expect}`);
});
test('Magnus: sidespin +y on a ball moving +x curls towards -z', () => {
  const a = magnusAccel({ x: 20, y: 0, z: 0 }, { x: 0, y: 40, z: 0 });
  assert.ok(a.z < 0 && Math.abs(a.x) < 1e-9);
  const b = ball(0, 1, 0, 25, 3, 0, { x: 0, y: 40, z: 0 });
  run(b, 0.8);
  assert.ok(b.p.z < -0.8, 'curl z=' + b.p.z);
  const c = ball(0, 1, 0, 25, 3, 0, { x: 0, y: -40, z: 0 });
  run(c, 0.8);
  assert.ok(c.p.z > 0.8);
});
test('Magnus: topspin makes the ball dip', () => {
  const plain = ball(0, 0.5, 0, 25, 6, 0);
  const top = ball(0, 0.5, 0, 25, 6, 0, { x: 0, y: 0, z: -40 });
  run(plain, 0.6); run(top, 0.6);
  assert.ok(top.p.y < plain.p.y - 0.3, `top ${top.p.y} plain ${plain.p.y}`);
});
test('air drag slows a fast shot', () => {
  const b = ball(0, 5, 0, 30, 0, 0);
  run(b, 0.5);
  assert.ok(b.v.x < 28 && b.v.x > 20);
});

console.log('passing');
test('pass lead: target point is ahead of a moving receiver and timing matches', () => {
  const from = { x: 0, z: 0 };
  const recv = { x: 10, z: 10 }, vel = { x: 6, z: 0 };
  const L = leadPass(from, recv, vel, 5);
  assert.ok(L.x > recv.x + 1, 'lead x ' + L.x);
  assert.ok(Math.abs(L.z - recv.z) < 1e-6);
  const d = Math.hypot(L.x, L.z);
  const tBall = rollTimeTo(L.speed, d);
  const tRecv = (L.x - recv.x) / vel.x;
  assert.ok(Math.abs(tBall - tRecv) < 0.05, `${tBall} vs ${tRecv}`);
});
test('pass lead: stationary receiver gets the ball at his feet', () => {
  const L = leadPass({ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 0, z: 0 }, 5);
  assert.ok(Math.abs(L.x - 20) < 1e-6);
  const b = ball(0, BALL_R, 0, L.speed, 0, 0);
  run(b, L.t);
  assert.ok(Math.abs(b.p.x - 20) < 0.3 && Math.abs(Math.hypot(b.v.x, b.v.z) - 5) < 0.4);
});
test('rollSpeedFor inverts the rolling model', () => {
  const v0 = rollSpeedFor(25, 3);
  const t = rollTimeTo(v0, 25);
  assert.ok(Number.isFinite(t));
});
test('lob solver lands the ball near the target', () => {
  const r = solveLob({ x: 0, y: BALL_R, z: 0 }, { x: 30, z: 5 }, 0.6);
  const b = ball(0, BALL_R, 0, r.vel.x, r.vel.y, r.vel.z);
  let land = null;
  for (let i = 0; i < 600 && !land; i++) { const vy = b.v.y; stepBall(b, 1 / 120); if (vy < 0 && b.v.y >= 0) land = { ...b.p }; }
  assert.ok(land && Math.hypot(land.x - 30, land.z - 5) < 0.5, JSON.stringify(land));
});
test('shot solver with curl passes through the target', () => {
  const spin = { x: 0, y: -45, z: 0 };
  const v = solveShot({ x: 30, y: BALL_R, z: 10 }, { x: HL, y: 1.5, z: -3 }, 24, spin);
  const pr = predictBall({ p: { x: 30, y: BALL_R, z: 10 }, v, w: spin }, 2, 0.005);
  const s = pr.find((q) => q.x >= HL);
  assert.ok(Math.abs(s.z + 3) < 0.25 && Math.abs(s.y - 1.5) < 0.25, JSON.stringify(s));
});

console.log('rules');
test('front-on tackle that wins the ball is clean', () => {
  assert.deepEqual(judgeTackle({ wonBall: true, fromBehind: false, slide: true, bodyContact: true }), { foul: false, card: null });
  assert.deepEqual(judgeTackle({ wonBall: true, fromBehind: false, slide: false }), { foul: false, card: null });
});
test('body before ball is a foul', () => {
  assert.equal(judgeTackle({ contactFirst: true, bodyContact: true }).foul, true);
  assert.equal(judgeTackle({ contactFirst: true, slide: true, bodyContact: true }).card, 'yellow');
});
test('mistimed slide from behind is a foul and a yellow; red if last man', () => {
  assert.deepEqual(judgeTackle({ fromBehind: true, slide: true, bodyContact: true }), { foul: true, card: 'yellow' });
  assert.deepEqual(judgeTackle({ fromBehind: true, slide: true, bodyContact: true, lastMan: true }), { foul: true, card: 'red' });
});
test('missed standing tackle from the front with no contact is not a foul', () => {
  assert.equal(judgeTackle({ wonBall: false, fromBehind: false, bodyContact: false }).foul, false);
});
test('isFromBehind geometry', () => {
  assert.equal(isFromBehind({ x: -1, z: 0 }, { x: 0, z: 0 }, 0), true);
  assert.equal(isFromBehind({ x: 1, z: 0 }, { x: 0, z: 0 }, 0), false);
  assert.equal(isFromBehind({ x: 0, z: 1 }, { x: 0, z: 0 }, 0), false);
});
test('offside: beyond second-last defender at the moment of the pass', () => {
  const defs = [50, 30, 28, 20, 10];
  assert.equal(isOffside({ receiverX: 32, ballX: 10, defenderXs: defs, dir: 1 }), true);
  assert.equal(isOffside({ receiverX: 29, ballX: 10, defenderXs: defs, dir: 1 }), false);
  assert.equal(isOffside({ receiverX: 30, ballX: 10, defenderXs: defs, dir: 1 }), false); // level = onside
  assert.equal(isOffside({ receiverX: 32, ballX: 35, defenderXs: defs, dir: 1 }), false); // behind the ball
  assert.equal(isOffside({ receiverX: -5, ballX: -20, defenderXs: [-2, -1], dir: 1 }), false); // own half
  assert.equal(isOffside({ receiverX: -32, ballX: -10, defenderXs: defs.map((x) => -x), dir: -1 }), true);
});
test('penalty area test', () => {
  assert.equal(inOwnPenaltyArea(-HL + 10, 5, 1), true);
  assert.equal(inOwnPenaltyArea(-HL + 20, 5, 1), false);
  assert.equal(inOwnPenaltyArea(HL - 10, 5, -1), true);
});

console.log('simulation');
test('formation slot assignment keeps GK at 0 and fills all slots', () => {
  const s = assignSlots(BRAZIL.players, '4-3-3');
  assert.equal(s[0], 0);
  assert.equal(new Set(s).size, 11);
});
test('AI vs AI match runs to full time with sane state and snapshots < 4KB', () => {
  const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 1, difficulty: 'pro', controllers: { home: 'ai', away: 'ai' }, seed: 7 });
  let maxSnap = 0, n = 0;
  while (!sim.ended && n < 120 * 400) {
    sim.step(1 / 120, [null, null]); n++;
    if (n % 240 === 0) {
      maxSnap = Math.max(maxSnap, JSON.stringify(encodeSnapshot(sim)).length);
      for (const p of sim.players) assert.ok(Number.isFinite(p.x + p.z + p.face));
      assert.ok(Number.isFinite(sim.ball.p.x + sim.ball.p.y + sim.ball.p.z));
    }
  }
  assert.equal(sim.phase, PHASE.FULLTIME);
  assert.ok(maxSnap < 4096, 'snapshot ' + maxSnap);
  const r = sim.result;
  assert.equal(r.homeGoals, sim.score[0]);
  assert.equal(r.stats.possession[0] + r.stats.possession[1], 100);
  for (const id in r.playerRatings) assert.ok(r.playerRatings[id] >= 4 && r.playerRatings[id] <= 10);
});
test('snapshot roundtrip through JSON and interpolation', () => {
  const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed: 3 });
  for (let i = 0; i < 600; i++) sim.step(1 / 120, [null, null]);
  const a = JSON.parse(JSON.stringify(encodeSnapshot(sim)));
  for (let i = 0; i < 6; i++) sim.step(1 / 120, [null, null]);
  const b = JSON.parse(JSON.stringify(encodeSnapshot(sim)));
  const m = lerpView(a, b, 0.5);
  assert.equal(m.p.length, 22 * 7);
  assert.ok(Math.abs(m.p[0] - (a.p[0] + b.p[0]) / 2) < 0.011);
});
test('AI penalty conversion is around 75%', () => {
  let goals = 0;
  const N = 80;
  for (let i = 0; i < N; i++) {
    const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed: 500 + i });
    sim.step(1 / 120, [null, null]);
    sim._setupSetPiece({ type: SP.PENALTY, team: i % 2, x: 0, z: 0 });
    for (let k = 0; k < 120 * 5; k++) {
      sim.step(1 / 120, [null, null]);
      if (sim.phase === PHASE.GOAL) { goals++; break; }
      if (sim.phase === PHASE.STOP || (sim.phase === PHASE.PLAY && sim.fx.some((f) => f.k === 'parry'))) break;
      if (sim.phase === PHASE.PLAY && sim.ball.owner >= 0 && sim.players[sim.ball.owner].isGK) break;
    }
  }
  const rate = goals / N;
  assert.ok(rate > 0.6 && rate < 0.9, 'rate ' + rate);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
