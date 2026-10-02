// Admin fun-effects tests (run via physics.test.mjs or directly: node 3d/js/engine/tests/admin.test.mjs).
import assert from 'node:assert/strict';
import { MatchSim } from '../core/sim.js';
import { PHASE, SP, PITCH, BALL_R, G } from '../core/constants.js';
import { PHYS } from '../core/physics.js';
import { encodeSnapshot, lerpView, viewFromSim } from '../core/snapshot.js';
import { ADMIN_EFFECTS, sanitizeName } from '../core/admin.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

const DT = 1 / 120;
const HL = PITCH.HL;
const NONE = { mx: 0, my: 0, aimX: 0, aimY: 0 };

function mk(ctrl = { home: 'p1', away: 'ai' }, seed = 7) {
  const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 3, controllers: ctrl, seed });
  sim.step(DT, [null, null]);
  return sim;
}
// open play with home player 5 on the ball near the centre
function openPlay(sim) {
  sim.phase = PHASE.PLAY; sim.sp.done = true;
  const c = sim.players[5];
  sim._teleport(c, -5, 0);
  const b = sim.ball;
  b.owner = c.idx; b.inHands = false; b.p.x = -4.55; b.p.z = 0; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0;
  sim.ctrl[0] = c.idx;
  return sim;
}
const run = (sim, secs, inp = [NONE, null]) => { for (let i = 0; i < secs * 120; i++) sim.step(DT, inp); };
function finite(sim) {
  const b = sim.ball;
  assert.ok(Number.isFinite(b.p.x + b.p.y + b.p.z + b.v.x + b.v.y + b.v.z), 'ball NaN');
  for (const p of sim.players) assert.ok(Number.isFinite(p.x + p.z + p.vx + p.vz + p.face + p.h), 'player NaN ' + p.idx);
}
const codes = (sim) => sim.admin.list.map((e) => e.code);

export function runAdminTests(test) {
  console.log('admin effects');
  test('admin: whitelist only, owner-only needs owner level, bad params never throw', () => {
    const sim = mk();
    for (const bad of ['nope', '__proto__', 'constructor', 'toString', 42, null, undefined, { id: 'vanish' }]) {
      assert.equal(sim.admin.apply(bad, {}).ok, false);
    }
    assert.equal(sim.admin.apply('end', {}).ok, false);
    assert.equal(sim.admin.apply('win', { level: 'mod' }).ok, false);
    assert.equal(sim.admin.apply('moon', { seconds: 'abc', target: 'eval(1)', by: {} }).ok, true);
    assert.equal(sim.admin.apply('moon', { seconds: 9999 }).ok, true);
    const e = sim.admin.list.find((x) => x.code === 'mo');
    assert.ok(Math.abs(e.until - sim.t - 120) < 1e-6, 'seconds clamped to 120');
    assert.equal(sanitizeName('<img src=x onerror=alert(1)>'), 'img srcx onerror');
    assert.equal(sanitizeName('A'.repeat(40)).length, 16);
    assert.equal(sim.admin.apply('rename', { name: '<<>>' }).ok, false);
    for (const d of ADMIN_EFFECTS) assert.ok(d.id && d.code && d.label && Array.isArray(d.params));
  });

  test('admin: vanish removes N outfield players, then they respawn on the pitch', () => {
    const sim = openPlay(mk());
    const before = sim.teamList[1].length;
    assert.ok(sim.admin.apply('vanish', { target: 'opponent', by: 'home', count: 4, seconds: 3 }).ok);
    assert.equal(sim.teamList[1].length, before - 4);
    const gone = sim.players.filter((p) => p.admVanish);
    assert.equal(gone.length, 4);
    assert.ok(gone.every((p) => p.team === 1 && !p.isGK));
    const v = viewFromSim(sim);
    for (const p of gone) assert.ok(v.so & (1 << p.idx), 'hidden in view');
    const ae = v.ae.find((a) => a[0] === 'va');
    assert.equal(ae[1], 1); assert.ok(ae[3] > 0, 'mask');
    run(sim, 1.5); finite(sim);
    assert.ok(gone.every((p) => p.x === -1000));
    run(sim, 2); finite(sim);
    assert.equal(sim.teamList[1].length, before);
    assert.ok(gone.every((p) => !p.sentOff && Math.abs(p.x) <= HL + 5 && Math.abs(p.z) <= PITCH.HW + 5));
    assert.ok(!codes(sim).includes('va'));
    // never leaves fewer than 4 outfielders, even when spammed
    for (let k = 0; k < 5; k++) sim.admin.apply('vanish', { target: 'home', count: 6 });
    assert.ok(sim.teamList[0].filter((p) => !p.isGK).length >= 4);
    run(sim, 3); finite(sim);
  });

  test('admin: erase goalkeeper empties the net, goal kick still works, keeper returns', () => {
    const sim = openPlay(mk({ home: 'ai', away: 'ai' }));
    assert.ok(sim.admin.apply('erasegk', { target: 'away', seconds: 4 }).ok);
    const g = sim.gk(1);
    assert.ok(g.sentOff && g.admVanish);
    // goal kick for the keeper-less team: an outfielder takes it
    sim._setupSetPiece({ type: SP.GOALKICK, team: 1, x: sim.ownGoalX(1), z: 1 });
    assert.ok(!sim.players[sim.sp.taker].isGK);
    run(sim, 2); finite(sim);
    run(sim, 2.5); finite(sim);
    assert.ok(!g.sentOff, 'keeper back');
    assert.ok(Math.abs(g.x) > 40, 'on his goal line');
  });

  test('admin: ball physics effects change PHYS and restore on expiry', () => {
    const sim = openPlay(mk());
    const g0 = PHYS.g, drag0 = PHYS.drag;
    sim.admin.apply('moon', { seconds: 1 });
    run(sim, 0.1);
    assert.ok(Math.abs(PHYS.g - G * 0.17) < 1e-9);
    run(sim, 1.2);
    assert.equal(PHYS.g, g0); assert.equal(PHYS.drag, drag0);
    sim.admin.apply('bowling', { seconds: 5 });
    run(sim, 0.05);
    assert.equal(sim.admin.kickMul, 0.5);
    assert.ok(PHYS.roll0 > 4);
    sim.admin.apply('beachball', { seconds: 5 }); // replaces bowling (exclusive)
    run(sim, 0.05);
    assert.deepEqual(codes(sim).filter((c) => c === 'bw' || c === 'bb'), ['bb']);
    assert.ok(PHYS.magnus > 0.01);
    sim.admin.apply('giantball', { seconds: 5 }); sim.admin.apply('tinyball', { seconds: 5 });
    assert.ok(codes(sim).includes('tb') && !codes(sim).includes('gb'));
    sim.admin.apply('bounce', { seconds: 5 });
    run(sim, 0.05);
    assert.ok(PHYS.restHi >= 0.8);
    run(sim, 3); finite(sim);
    sim.admin.apply('reset', {});
    run(sim, 0.02);
    assert.equal(PHYS.g, g0); assert.equal(PHYS.drag, drag0); assert.equal(sim.admin.kickMul, 1);
  });

  test('admin: bowling ball barely rolls compared to a normal ball', () => {
    const dist = (fx) => {
      const sim = openPlay(mk());
      if (fx) sim.admin.apply(fx, { seconds: 30 });
      sim.step(DT, [NONE, null]);
      const p = sim.players[5];
      sim._release(p, { x: 12, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { kind: 'pass' });
      const x0 = sim.ball.p.x;
      sim.players.forEach((q) => { if (q !== p) sim._teleport(q, q.x, q.team ? 30 : -30); });
      for (let i = 0; i < 240; i++) { sim.ball.owner = -1; sim.admin.step(DT); sim._updateBall(DT); }
      return sim.ball.p.x - x0;
    };
    const normal = dist(null), heavy = dist('bowling');
    assert.ok(heavy < normal * 0.4, `bowling ${heavy} vs ${normal}`);
    dist('reset');
  });

  test('admin: shrink / giant scale reach exactly and restore', () => {
    const sim = openPlay(mk());
    const h0 = sim.players.map((p) => p.h);
    sim.admin.apply('shrink', { target: 'away', seconds: 1 });
    run(sim, 0.05);
    assert.ok(Math.abs(sim.players[12].h - h0[12] * 0.7) < 1e-9);
    assert.equal(sim.players[3].h, h0[3]);
    sim.admin.apply('giant', { target: 'away', seconds: 1 }); // replaces shrink
    run(sim, 0.05);
    assert.ok(Math.abs(sim.players[12].h - h0[12] * 1.3) < 1e-9);
    run(sim, 1.2);
    sim.players.forEach((p, i) => assert.equal(p.h, h0[i]));
  });

  test('admin: slow-mo, turbo and freeze set per-player speed multipliers', () => {
    const sim = openPlay(mk());
    sim.admin.apply('slowmo', { target: 'opponent', by: 'home', seconds: 5 });
    sim.admin.apply('turbo', { target: 'mine', by: 'home', seconds: 5 });
    run(sim, 0.05, [{ ...NONE, mx: 1 }, null]);
    assert.equal(sim.admin.spd[14], 0.5);
    assert.equal(sim.admin.spd[sim.ctrl[0]], 1.5);
    // freeze the home team: ball owner loses the ball, nobody moves
    const c = sim.players[sim.ctrl[0]];
    const b = sim.ball; b.owner = c.idx; b.inHands = false;
    sim.admin.apply('freeze', { target: 'home', seconds: 30 });
    assert.equal(sim.admin.list.find((e) => e.code === 'fr').until - sim.t, 5);
    const pos = sim.teamList[0].map((p) => [p.x, p.z]);
    run(sim, 1, [{ ...NONE, mx: 1, my: 1 }, null]);
    if (sim.phase === PHASE.PLAY) {
      assert.ok(sim.teamList[0].every((p, i) => Math.hypot(p.x - pos[i][0], p.z - pos[i][1]) < 0.05), 'frozen');
      assert.ok(b.owner < 0 || sim.players[b.owner].team === 1);
    }
    finite(sim);
    run(sim, 4.5);
    assert.ok(!codes(sim).includes('fr'));
  });

  test('admin: reverse controls mirror the target human input only', () => {
    const sim = mk({ home: 'p1', away: 'p2' });
    sim.admin.apply('reverse', { target: 'opponent', by: 'home', seconds: 5 });
    const out = sim.admin.mapInputs([{ mx: 0.5, my: -1, aimX: 1, aimY: 0 }, { mx: 0.5, my: -1, aimX: 1, aimY: 0 }]);
    assert.equal(out[0].mx, 0.5);
    assert.equal(out[1].mx, -0.5); assert.equal(out[1].my, 1); assert.equal(out[1].aimX, -1);
  });

  test('admin: butterfingers keeper spills a caught ball', () => {
    const sim = openPlay(mk({ home: 'ai', away: 'ai' }));
    sim.admin.apply('butterfingers', { target: 'away', seconds: 10 });
    const g = sim.gk(1);
    sim._teleport(g, sim.ownGoalX(1) + sim.dir[1] * 3, 0);
    sim._gain(g, 'hands');
    assert.ok(sim.ball.inHands);
    sim.step(DT, [null, null]);
    assert.ok(!sim.ball.inHands && sim.ball.owner !== g.idx, 'spilled');
    assert.ok(sim.fx.some((f) => f.k === 'admin' && f.e === 'spill'));
    run(sim, 2); finite(sim);
  });

  test('admin: wall of keepers blocks the sides of the goal, middle still open', () => {
    const shoot = (z, wall) => {
      const sim = openPlay(mk({ home: 'ai', away: 'ai' }));
      if (wall) sim.admin.apply('wall', { target: 'home', seconds: 20 });
      sim.players.forEach((p) => sim._teleport(p, p.x, p.team ? 30 : -30));
      sim._teleport(sim.gk(1), 0, 30);
      const s = sim.dir[0];
      const b = sim.ball; b.owner = -1; b.p.x = s * (HL - 6); b.p.y = 0.5; b.p.z = z; b.v.x = s * 20; b.v.y = 1; b.v.z = 0;
      b.lastTeam = 0; b.lastTouch = 5;
      for (let i = 0; i < 120 && sim.phase === PHASE.PLAY; i++) sim.step(DT, [null, null]);
      return sim.phase === PHASE.GOAL;
    };
    assert.equal(shoot(2.5, false), true);
    assert.equal(shoot(2.5, true), false);
    assert.equal(shoot(0.3, true), true);
  });

  test('admin: magnet ball drifts to the admin player', () => {
    const sim = openPlay(mk());
    const c = sim.players[sim.ctrl[0]];
    sim.players.forEach((p) => { if (p !== c) sim._teleport(p, p.x, p.team ? 30 : -30); });
    sim._teleport(c, -20, 0);
    const b = sim.ball; b.owner = -1; b.p.x = 0; b.p.z = 0; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0;
    sim.admin.apply('magnet', { by: 'home', seconds: 10 });
    const d0 = Math.hypot(b.p.x - c.x, b.p.z - c.z);
    run(sim, 1, [NONE, null]);
    assert.ok(Math.hypot(b.p.x - c.x, b.p.z - c.z) < d0 - 2 || b.owner === c.idx);
  });

  test('admin: score +1 / -1 / swap / edit / rename', () => {
    const sim = openPlay(mk());
    sim.admin.apply('scoreup', { target: 'mine', by: 'home' });
    sim.admin.apply('scoreup', { target: 'mine', by: 'home' });
    sim.admin.apply('scoredown', { target: 'opponent', by: 'home' });
    assert.deepEqual(sim.score, [2, 0]);
    sim.admin.apply('swap', {});
    assert.deepEqual(sim.score, [0, 2]);
    sim.admin.apply('editscore', { home: 7, away: '150', homeName: 'Legends!', awayName: '' });
    assert.deepEqual(sim.score, [7, 99]);
    const rn = sim.admin.list.find((e) => e.code === 'rn');
    assert.equal(rn.param, 'LEGENDS!'); assert.equal(rn.tg, 0);
    assert.ok(sim.fx.some((f) => f.k === 'admin' && f.e === 'su'));
    assert.equal(sim.scorers.length, 0, 'no fake scorers');
  });

  test('admin: instant red card walks off, no stats, no match event', () => {
    const sim = openPlay(mk());
    sim.drainEvents();
    const r = sim.admin.apply('redcard', { target: 'opponent', by: 'home', player: 4 });
    assert.ok(r.ok);
    const p = sim.players[15];
    assert.ok(p.sentOff && p.admWalk);
    assert.equal(p.st.red || 0, 0);
    assert.ok(!sim.teamList[1].includes(p));
    assert.equal(sim.drainEvents().filter((e) => e.type === 'card').length, 0);
    assert.ok(sim.fx.some((f) => f.k === 'card' && f.adm && f.pi === 15));
    const v = viewFromSim(sim);
    assert.equal(v.so & (1 << 15), 0, 'visible while walking off');
    run(sim, 20); finite(sim);
    assert.equal(p.x, -1000);
    assert.ok(viewFromSim(sim).so & (1 << 15));
  });

  test('admin: end match / instant win (owner) finish with an admin-flagged result', () => {
    const sim = openPlay(mk());
    sim.score = [0, 2];
    assert.equal(sim.admin.apply('win', { by: 'home', level: 'mod' }).ok, false);
    assert.ok(sim.admin.apply('win', { by: 'home', level: 'owner' }).ok);
    assert.equal(sim.phase, PHASE.FULLTIME);
    assert.ok(sim.score[0] > sim.score[1]);
    assert.equal(sim.result.admin, true);
    assert.equal(sim.admin.apply('moon', {}).ok, false, 'nothing after full time');
    const s2 = openPlay(mk());
    assert.ok(s2.admin.apply('end', { level: 'owner' }).ok);
    assert.ok(s2.ended && s2.result.admin);
  });

  test('admin: effects expire, snapshot round-trip < 4 KB, lerp keeps ae', () => {
    const sim = openPlay(mk());
    const all = ['vanish', 'erasegk', 'giantball', 'beachball', 'moon', 'bounce', 'shrink', 'bigheads', 'slowmo', 'turbo', 'reverse', 'freeze', 'butterfingers', 'wall', 'magnet', 'disco', 'rename'];
    for (const id of all) assert.ok(sim.admin.apply(id, { target: 'everyone', seconds: 3, name: 'Muppets FC' }).ok, id);
    run(sim, 0.2, [NONE, null]);
    const snap = JSON.parse(JSON.stringify(encodeSnapshot(sim)));
    assert.ok(Array.isArray(snap.ae) && snap.ae.length >= 15);
    for (const a of snap.ae) { assert.equal(typeof a[0], 'string'); assert.ok([0, 1, 2].includes(a[1])); assert.ok(a[2] >= 0 && a[2] <= 3); }
    assert.ok(snap.ae.some((a) => a[0] === 'rn' && a[3] === 'MUPPETS FC'));
    const size = JSON.stringify(snap).length;
    assert.ok(size < 4096, 'snapshot ' + size);
    assert.equal(snap.adm, 1);
    const l = lerpView(snap, snap, 0.5);
    assert.deepEqual(l.ae, snap.ae);
    run(sim, 3.5, [NONE, null]); finite(sim);
    assert.equal(sim.admin.list.length, 0);
    assert.equal(encodeSnapshot(sim).ae, undefined);
    assert.equal(PHYS.g, G);
    assert.ok(sim.players.every((p) => !p.admVanish));
  });

  test('admin: chaos soak (random effects, 90 s AI vs AI) never NaN or stuck', () => {
    const sim = mk({ home: 'ai', away: 'ai' }, 99);
    const ids = ADMIN_EFFECTS.map((e) => e.id).filter((id) => id !== 'end' && id !== 'win');
    let lastPhaseChange = sim.t, lastPhase = sim.phase, lastSp = sim.sp;
    const targets = ['opponent', 'mine', 'everyone', 'home', 'away'];
    for (let s = 0; s < 90 * 120; s++) {
      if (s % 240 === 0) {
        const id = ids[Math.floor(sim.rng() * ids.length)];
        sim.admin.apply(id, { target: targets[s % 5], by: s % 2 ? 'home' : 'away', seconds: 2 + (s % 7), count: 1 + (s % 6), name: 'X' + s, player: s % 11 });
      }
      sim.step(DT, [null, null]);
      if (sim.phase !== lastPhase || sim.sp !== lastSp) { lastPhase = sim.phase; lastSp = sim.sp; lastPhaseChange = sim.t; }
      if (sim.phase === PHASE.SETPIECE || sim.phase === PHASE.STOP || sim.phase === PHASE.KICKOFF) assert.ok(sim.t - lastPhaseChange < 16, 'stuck in phase ' + sim.phase);
      if (s % 120 === 0) finite(sim);
    }
    sim.admin.apply('reset', {});
    sim.step(DT, [null, null]);
    assert.equal(PHYS.g, G);
    sim.admin.dispose();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let passed = 0, failed = 0;
  runAdminTests((name, fn) => {
    try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack)); }
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
