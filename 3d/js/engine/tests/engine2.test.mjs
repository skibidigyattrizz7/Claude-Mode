// Tests for: tackle-lob buffer fix, geometric steals, touch dribbling, offside candidates, advantage, stick deadzone.
import assert from 'node:assert/strict';
import { PHASE, BALL_R } from '../core/constants.js';
import { offsideCandidates } from '../core/rules.js';
import { scenario } from './gameplay.test.mjs';

const DT = 1 / 120;
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

const { stickRadial } = await import('../ui/input.js').catch(() => ({}));
if (stickRadial) {
  test('stickRadial deadzone and rescale', () => {
    assert.equal(stickRadial(0.1, 0.1).m, 0);
    const half = stickRadial(0.55, 0).m;
    assert.ok(half > 0.4 && half < 0.6, 'half push = about half speed: ' + half);
    assert.equal(stickRadial(1, 0).m, 1);
    const d = stickRadial(0.3, 0.3);
    assert.ok(Math.abs(d.x - d.y) < 1e-9);
  });
}

test('offsideCandidates flags only attackers beyond the line and the ball', () => {
  const c = offsideCandidates({ attackers: [{ idx: 1, x: 32 }, { idx: 2, x: 20 }, { idx: 3, x: -5 }], ballX: 10, defenderXs: [45, 30, 20], dir: 1 });
  assert.deepEqual(c, [1]);
});

function setup() {
  const { sim, c } = scenario({}, { x0: 0, z0: 0 });
  const d = sim.players[11 + 3];
  return { sim, c, d };
}

test('steal geometry: goal-side facing defender beats a defender behind a shielding carrier', () => {
  const { sim, c, d } = setup();
  sim._teleport(d, 1.2, 0); d.face = Math.PI; d.vx = -3; c.vx = 3;
  const front = sim._stealGeo(d, c);
  sim._teleport(d, -1.2, 0); d.face = 0; d.vx = 3; c.shieldT = sim.t;
  const behind = sim._stealGeo(d, c);
  assert.ok(front > behind + 0.3, `front ${front} behind ${behind}`);
  assert.ok(behind < 0.25);
});

test('touch dribbling: sprinting knocks the ball ahead, jogging keeps it close', () => {
  const run = (vx) => {
    const { sim, c } = setup();
    let maxGap = 0;
    for (let i = 0; i < 240; i++) {
      c.vx = vx; c.x += vx * DT; sim.t += DT;
      sim._dribble(DT);
      maxGap = Math.max(maxGap, Math.hypot(sim.ball.p.x - c.x, sim.ball.p.z - c.z));
    }
    return maxGap;
  };
  const jog = run(3.5), sprint = run(8);
  assert.ok(jog < 0.8, 'jog gap ' + jog);
  assert.ok(sprint > jog + 0.4, `sprint gap ${sprint} vs jog ${jog}`);
});

test('a tackle tap (gamepad B = lob + tackle) never buffers a lob', () => {
  const { sim } = scenario({}, { x0: 0, z0: 0 });
  const p = sim.players[8]; // teammate, not the carrier
  sim.ctrl[0] = p.idx;
  const base = { mx: 0, my: 0, aimX: 0, aimY: 0, sprint: false, pass: false, through: false, shoot: false, finesse: false, switchP: false, skill: false, jockey: false };
  for (let i = 0; i < 20; i++) sim.step(DT, [{ ...base, lob: true, tackle: true }, null]);
  for (let i = 0; i < 20; i++) sim.step(DT, [{ ...base, lob: false, tackle: false }, null]);
  assert.ok(!(sim.buffer[0] && sim.buffer[0].k === "lob"));
});

test('advantage: whistle held 2 s when the fouled team keeps the ball, given if the foul side wins it', () => {
  const mk = () => {
    const { sim, c } = scenario({}, { x0: 25, z0: 0 });
    const off = sim.players[11 + 2], victim = c;
    sim._teleport(off, 26, 1);
    return { sim, off, victim };
  };
  let { sim, off, victim } = mk();
  sim._foul(off, victim, null);
  assert.equal(sim.phase, PHASE.PLAY);
  assert.ok(sim.adv);
  for (let i = 0; i < 360; i++) sim.step(DT, [null, null]);
  assert.equal(sim.adv, null);
  ({ sim, off, victim } = mk());
  sim._foul(off, victim, null);
  sim.ball.owner = off.idx; sim.ball.inHands = false;
  sim._advantage();
  assert.equal(sim.phase, PHASE.STOP);
  // penalty area foul: no advantage
  ({ sim, off, victim } = mk());
  sim._teleport(victim, 50, 0); sim._teleport(off, 51, 0);
  sim._foul(off, victim, null);
  assert.equal(sim.phase, PHASE.STOP);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
