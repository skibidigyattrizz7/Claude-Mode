// THE NII (secretcard.js `cursed`, owner request Sep 29): the anti-secret card's in-match effects.
// Run directly: node 3d/js/engine/tests/cursed.test.mjs
import assert from 'node:assert/strict';
import { MatchSim } from '../core/sim.js';
import { PHASE, BALL_R } from '../core/constants.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

const DT = 1 / 120;

// Home striker (idx 9) flagged `cursed: true`, floor stats like the real card.
function mkSim(seed = 1) {
  const home = structuredClone(BRAZIL);
  const pd = home.players[9];
  pd.attrs = { pac: 1, sho: 1, pas: 1, dri: 1, def: 1, phy: 1, div: 1, han: 1, kic: 1, ref: 1, spd: 1, pos: 1 };
  pd.ovr = 1; pd.cursed = true;
  const sim = new MatchSim({ home, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed });
  sim.step(DT, [null, null]);
  sim.phase = PHASE.PLAY; sim.sp.done = true; sim.dir = [1, -1];
  return { sim, p: sim.players[9] };
}
const giveBall = (sim, p, x, z) => {
  sim._teleport(p, x, z); p.face = 0;
  const b = sim.ball;
  b.owner = p.idx; b.inHands = false; b.p.x = x + 0.45; b.p.z = z; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
  p.gainT = sim.t;
};

export function runCursedTests(test) {
  console.log('THE NII (cursed tier)');

  test('cursed: flag carried, and he can barely move', () => {
    const { sim, p } = mkSim();
    assert.equal(p.cursed, true);
    assert.equal(p.glitch, false);
    const mate = sim.players[10];
    assert.ok(p.vmax < mate.vmax * 0.2, `vmax ${p.vmax} vs ${mate.vmax}`);
  });

  test('cursed: any shot goes in his own goal and counts as 10', () => {
    for (let s = 0; s < 6; s++) {
      const { sim, p } = mkSim(s + 1);
      giveBall(sim, p, 30 - s * 5, (s % 3 - 1) * 5); // right in front of the opponent's goal
      const before = [...sim.score];
      sim.aiKick(p, s % 2 ? 'shot' : 'finesse', { tz: 0, ty: 1, power: 0.9 });
      for (let t = 0; t < 3 && sim.phase === PHASE.PLAY; t += DT) sim.step(DT, [null, null]);
      assert.equal(sim.phase, PHASE.GOAL, `seed ${s}: no goal`);
      assert.deepEqual(sim.score, [before[0], before[1] + 10], `seed ${s}: score ${sim.score}`);
      const ogs = sim.scorers.filter((x) => x.ownGoal && x.playerId === p.data.id).length;
      assert.equal(ogs, 10);
    }
  });

  test('cursed: every pass goes to an opponent', () => {
    const { sim, p } = mkSim(3);
    giveBall(sim, p, 0, 0);
    const opp = sim.teamList[1].reduce((a, o) => (Math.hypot(o.x - p.x, o.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? o : a));
    const mate = sim.players[10];
    const plan = sim._cursePlan(p, sim._plan(p, 'ground', { target: mate.idx, power: 0.6 }));
    assert.equal(plan.info.target, opp.idx);
  });

  test('cursed: loses the ball almost at once', () => {
    const { sim, p } = mkSim(4);
    giveBall(sim, p, 0, 0);
    for (let t = 0; t < 0.4; t += DT) sim.step(DT, [null, null]);
    assert.notEqual(sim.ball.owner, p.idx, 'still on the ball');
    assert.ok(sim.ball.owner < 0 || sim.players[sim.ball.owner].team === 1, 'ball should head to the opponent');
  });

  test('cursed: a normal teammate is unaffected', () => {
    const { sim } = mkSim(5);
    assert.equal(sim.players[10].cursed, false);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let passed = 0, failed = 0;
  runCursedTests((name, fn) => {
    try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack)); }
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
