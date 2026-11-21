// "The Shawky" (secretcard.js `glitch`, owner request Sep 28) in-match power tests: run via
// physics.test.mjs or directly (node 3d/js/engine/tests/glitch.test.mjs). Mirrors the style of the
// existing "admin cards score from anywhere / never miss a pass / win the ball from anywhere" tests in
// gameplay.test.mjs, but for the stronger `p.glitch` tier (core/teams.js toMatchPlayer -> sim.js
// `_applyData` -> ai.js / _plan / _gkTouch / _resolveStanding / _slideContact / _contests / _glitchSteal).
import assert from 'node:assert/strict';
import { MatchSim } from '../core/sim.js';
import { PHASE, GOAL, BALL_R } from '../core/constants.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

const DT = 1 / 120;

// One home player (idx 9, a striker) flagged `glitch: true`; everything else from the sample team.
function mkSim({ attrs = {}, extraHome = {}, seed = 1 } = {}) {
  const home = structuredClone(BRAZIL);
  const pd = home.players[9];
  pd.attrs = { ...(pd.attrs || {}), ...attrs };
  Object.assign(pd, { glitch: true, rawOvr: 999 }, extraHome);
  const sim = new MatchSim({ home, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed });
  sim.step(DT, [null, null]);
  sim.phase = PHASE.PLAY; sim.sp.done = true; sim.dir = [1, -1];
  return { sim, p: sim.players[9] };
}
const parkEveryoneElse = (sim, shooter) => {
  sim.players.forEach((q) => { if (q !== shooter) sim._teleport(q, q.team === 0 ? -50 : -50, -30); });
};
const shotAt = (sim, p, x, z, kind = 'shot', o = {}) => {
  sim._teleport(sim.gk(1), 52.5, 0);
  sim._teleport(p, x, z); p.face = 0;
  const b = sim.ball;
  b.owner = p.idx; b.inHands = false; b.p.x = x + 0.45; b.p.z = z; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
  sim.aiKick(p, kind, { tz: 0, ty: 1, power: 0.9, ...o });
};

export function runGlitchTests(test) {
  console.log('"The Shawky" (glitch tier)');

  test('glitch: p.glitch maxes every boost area and is carried from ovr>99 + glitch:true', () => {
    const { p } = mkSim();
    assert.equal(p.glitch, true);
    assert.ok(p.boost && p.boost.pac === 1 && p.boost.sho === 1 && p.boost.pas === 1 && p.boost.def === 1 && p.boost.dri === 1);
  });

  test('glitch: scores from anywhere on the pitch, unsaveable, even against a 99 keeper', () => {
    let goals = 0;
    const TRIALS = 8;
    for (let s = 0; s < TRIALS; s++) {
      const { sim, p } = mkSim({ seed: s + 1 });
      parkEveryoneElse(sim, p);
      const gk = sim.gk(1);
      Object.assign(gk.a, { div: 99, han: 99, ref: 99, spd: 99, pos: 99 });
      gk.boost = { gk: 1 }; // an elite (even admin-tier) keeper — still can't save it
      // deep in his own half — nowhere near a normal "shoot" range
      shotAt(sim, p, -45 + (s % 5), (s % 3 - 1) * 6, 'shot', { tz: (s % 2 ? 1 : -1) * 2 });
      for (let t = 0; t < 5 && sim.phase === PHASE.PLAY; t += DT) sim.step(DT, [null, null]);
      if (sim.phase === PHASE.GOAL) goals++;
    }
    assert.equal(goals, TRIALS, `expected every shot to score, got ${goals}/${TRIALS}`);
  });

  test('glitch: every shot targets a top corner, just under the bar', () => {
    const { sim, p } = mkSim();
    parkEveryoneElse(sim, p);
    sim._teleport(sim.gk(1), 52.5, 0);
    sim._teleport(p, 10, 3); p.face = 0;
    const b = sim.ball;
    b.owner = p.idx; b.inHands = false; b.p.x = 10.45; b.p.z = 3; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
    const plan = sim._plan(p, 'shot', { tz: 0, ty: 0.3, power: 0.5 }); // caller aims low/central — glitch overrides it
    assert.ok(plan.info.glitch, 'info.glitch not set');
    assert.ok(Math.abs(Math.abs(plan.info.glitchTo.z) - (GOAL.HW - 0.42)) < 1e-9, 'not a top-corner z');
    assert.ok(Math.abs(plan.info.glitchTo.y - (GOAL.H - 0.26)) < 1e-9, 'not just under the bar');
    assert.ok(plan.info.glitchTo.y < GOAL.H, 'target must stay under the crossbar');
  });

  test('glitch: penalties always score (in-match and shootout share _gkTouch)', () => {
    let goals = 0;
    const TRIALS = 6;
    for (let s = 0; s < TRIALS; s++) {
      const { sim, p } = mkSim({ seed: s + 3 });
      parkEveryoneElse(sim, p);
      const gk = sim.gk(1);
      gk.boost = { gk: 1 };
      sim._teleport(p, 52.5 - 11, 0); p.face = 0;
      const b = sim.ball;
      b.owner = p.idx; b.inHands = false; b.p.x = 52.5 - 11 + 0.45; b.p.z = 0; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
      // a human-aimed penalty straight down the middle, low — glitch still redirects it to the top bins
      sim.aiKick(p, 'penalty', { tz: 0, ty: 0.4, power: 1 });
      for (let t = 0; t < 3 && sim.phase === PHASE.PLAY; t += DT) sim.step(DT, [null, null]);
      if (sim.phase === PHASE.GOAL) goals++;
    }
    assert.equal(goals, TRIALS, `expected every penalty to score, got ${goals}/${TRIALS}`);
  });

  test('glitch: perfectly accurate, faster ground passes/through balls from anywhere', () => {
    const { sim, p } = mkSim();
    parkEveryoneElse(sim, p);
    sim._teleport(p, -20, 5); p.face = 0;
    const b = sim.ball;
    b.owner = p.idx; b.inHands = false; b.p.x = -19.55; b.p.z = 5; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
    const plain = sim._plan(p, 'ground', { point: { x: 30, z: 5 }, power: 0.6 });
    // normal (non-glitch) speed for the same distance, for comparison
    const normalP = structuredClone(sim.players[10]);
    const err = Math.abs(Math.atan2(plain.vel.z, plain.vel.x));
    assert.ok(err < 1e-9, `pass should be dead straight, err=${err}`);
    void normalP;
    // 30 separate rng seeds: the *executed* (error-applied) pass is still dead-on every time
    for (let s = 0; s < 30; s++) {
      const { sim: sim2, p: p2 } = mkSim({ seed: s + 10 });
      parkEveryoneElse(sim2, p2);
      sim2._teleport(p2, -20, 0); p2.face = 0;
      const b2 = sim2.ball;
      b2.owner = p2.idx; b2.inHands = false; b2.p.x = -19.55; b2.p.z = 0; b2.p.y = BALL_R; b2.v.x = b2.v.y = b2.v.z = 0; b2.lastTeam = 0;
      sim2.aiKick(p2, 'ground', { point: { x: 30, z: 0 }, power: 0.6 });
      const e = Math.abs(Math.atan2(sim2.ball.v.z, sim2.ball.v.x));
      assert.ok(e < 1e-9, `executed pass error seed ${s}: ${e}`);
    }
    // a flat pass is notably faster than the same pass from a normal (non-glitch) player
    const normalHome = structuredClone(BRAZIL);
    const simN = new MatchSim({ home: normalHome, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed: 1 });
    simN.step(DT, [null, null]); simN.phase = PHASE.PLAY; simN.sp.done = true; simN.dir = [1, -1];
    const pn = simN.players[9];
    const planN = simN._plan(pn, 'ground', { point: { x: 30, z: 5 }, power: 0.6 });
    const spdG = Math.hypot(plain.vel.x, plain.vel.z), spdN = Math.hypot(planN.vel.x, planN.vel.z);
    assert.ok(spdG > spdN * 1.4, `glitch pass ${spdG} vs normal ${spdN} (want notably faster / "instant")`);
  });

  test('glitch: can never be dispossessed — standing tackles, slide tackles and 50/50 contests all fail', () => {
    let wonAgainst = 0;
    const TRIALS = 25;
    for (let s = 0; s < TRIALS; s++) {
      const { sim, p } = mkSim({ attrs: { dri: 40 }, seed: s + 1 }); // deliberately poor dribbling — should not matter
      parkEveryoneElse(sim, p);
      const tackler = sim.players[13]; // an opposing defender, elite (even admin-tier) at defending
      Object.assign(tackler.a, { def: 99 });
      tackler.boost = { def: 1 };
      sim._teleport(p, 0, 0); p.face = 0;
      sim._teleport(tackler, 0.3, 0); tackler.face = Math.PI;
      const b = sim.ball;
      b.owner = p.idx; b.inHands = false; b.p.x = 0.45; b.p.z = 0; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
      sim.startTackle(tackler);
      for (let t = 0; t < 0.4 && sim.phase === PHASE.PLAY; t += DT) sim.step(DT, [null, null]);
      if (sim.phase === PHASE.PLAY) {
        const owner = sim.owner();
        if (!owner || owner.idx !== p.idx) wonAgainst++;
      }
    }
    assert.equal(wonAgainst, 0, `${wonAgainst}/${TRIALS} tackles took the ball off him`);
  });

  test('glitch: steals the ball from an opponent even far away, without a tackle action', () => {
    let stolen = 0;
    const TRIALS = 10;
    for (let s = 0; s < TRIALS; s++) {
      const { sim, p } = mkSim({ attrs: { def: 40 }, seed: s + 1 }); // deliberately poor defending — should not matter
      parkEveryoneElse(sim, p);
      const carrier = sim.players[16]; // an opposing attacker, far from p
      sim._teleport(carrier, 20, 0); carrier.face = Math.PI;
      sim._teleport(p, 8, 0); p.face = 0; // ~12 m away — well beyond any normal tackle reach
      const b = sim.ball;
      b.owner = carrier.idx; b.inHands = false; b.p.x = 19.55; b.p.z = 0; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 1;
      // no tackle action ever started — this must come from _glitchSteal, not the tackle state machine.
      // He may immediately shoot-and-score off the steal (see the "shoots from anywhere" test/power) —
      // that also counts as a landed steal, so check ownership every frame, not just at the end.
      let got = false;
      for (let t = 0; t < 0.5 && sim.phase === PHASE.PLAY && !got; t += DT) {
        sim.step(DT, [null, null]);
        const owner = sim.owner();
        if (owner && owner.idx === p.idx) got = true;
      }
      if (got || sim.scorers.some((sc) => sc.playerId === p.data.id)) stolen++;
    }
    assert.equal(stolen, TRIALS, `expected every far-away steal to land, got ${stolen}/${TRIALS}`);
  });

  test('glitch: AI shoots (and scores) from literally anywhere, not just the opposition half', () => {
    let goals = 0;
    const TRIALS = 4;
    for (let s = 0; s < TRIALS; s++) {
      const { sim, p } = mkSim({ seed: s + 20 });
      parkEveryoneElse(sim, p);
      sim._teleport(p, -48, 0); p.face = 1; // deep in his own half
      const b = sim.ball;
      b.owner = p.idx; b.inHands = false; b.p.x = -47.55; b.p.z = 0; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
      sim.nextTeamThink = 0;
      for (let t = 0; t < 6 && sim.phase === PHASE.PLAY; t += DT) sim.step(DT, [null, null]);
      if (sim.phase === PHASE.GOAL) goals++;
    }
    assert.equal(goals, TRIALS, `expected the AI to shoot & score from his own half every time, got ${goals}/${TRIALS}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let passed = 0, failed = 0;
  runGlitchTests((name, fn) => {
    try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack)); }
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
