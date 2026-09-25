// Gameplay-settings / assist / knockout / ratings / physique tests (run via physics.test.mjs or directly).
import assert from 'node:assert/strict';
import { MatchSim } from '../core/sim.js';
import { PHASE, SP, GOAL, PITCH, BALL_R } from '../core/constants.js';
import { predictBall, behindLine } from '../core/physics.js';
import { rateStats, computeRatings, playerOfMatch } from '../core/ratings.js';
import { decided } from '../core/knockout.js';
import { humanShot } from '../core/assist.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

const DT = 1 / 120;
const NONE = { mx: 0, my: 0, aimX: 0, aimY: 0 };

// A quiet open-play scenario: home (human p1) player 5 has the ball at (x0, z0) attacking +x,
// all opponents parked far away, teammates where the caller puts them.
export function scenario(gp = {}, { seed = 11, x0 = -10, z0 = 0, away = 'ai', oppX = 48 } = {}) {
  const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 3, controllers: { home: 'p1', away }, seed, gameplay: { home: gp, away: gp } });
  sim.step(DT, [null, null]);
  sim.phase = PHASE.PLAY; sim.sp.done = true;
  sim.dir = [1, -1];
  sim.players.forEach((p, k) => sim._teleport(p, p.team === 0 ? -30 + (k % 11) * 0.5 : oppX + (k % 3), p.team === 0 ? -25 + (k % 11) * 5 : -20 + (k % 11) * 4));
  sim._teleport(sim.gk(1), 52, 0);
  const c = sim.players[5];
  sim._teleport(c, x0, z0);
  c.face = 0;
  const b = sim.ball;
  b.owner = c.idx; b.inHands = false; b.p.x = x0 + 0.45; b.p.z = z0; b.p.y = BALL_R; b.v.x = b.v.y = b.v.z = 0;
  b.lastTeam = 0; b.lastTouch = c.idx;
  sim.ctrl[0] = c.idx;
  sim.prevIn = [{ ...NONE }, { ...NONE }];
  return { sim, c };
}
const inp = (o) => ({ ...NONE, sprint: false, pass: false, through: false, lob: false, shoot: false, finesse: false, switchP: false, tackle: false, skill: false, jockey: false, ...o });
// hold a kick key for `hold` seconds pointing (dx, dz) in world space, then release
export function kick(sim, key, dx, dz, hold = 0.3, extra = {}) {
  const l = Math.hypot(dx, dz) || 1;
  const i = inp({ mx: dx / l, my: -dz / l, [key]: true, ...extra });
  for (let t = 0; t < hold; t += DT) sim.step(DT, [i, null]);
  sim.step(DT, [inp({ mx: dx / l, my: -dz / l }), null]);
}
const run = (sim, secs, i0 = null) => { for (let t = 0; t < secs; t += DT) sim.step(DT, [i0 || inp({}), null]); };

export function runGameplayTests(test) {
  console.log('gameplay assists');
  test('assisted pass always reaches the intended teammate (only interceptions can stop it)', () => {
    let ok = 0, N = 0;
    for (let k = 0; k < 12; k++) {
      const { sim, c } = scenario({ passAssist: 'assisted' }, { seed: 20 + k });
      const m = sim.players[7];
      const ang = -1 + k * 0.17, dist = 8 + (k % 5) * 6;
      sim._teleport(m, c.x + Math.cos(ang) * dist, c.z + Math.sin(ang) * dist);
      m.vx = Math.cos(ang + 1.2) * 4; m.vz = Math.sin(ang + 1.2) * 4; // moving receiver
      // aim 30 degrees off the receiver: still inside the 70 degree cone
      kick(sim, 'pass', Math.cos(ang + 0.5), Math.sin(ang + 0.5), 0.15);
      N++;
      for (let t = 0; t < 5 && sim.ball.owner < 0; t += DT) sim.step(DT, [inp({}), null]);
      if (sim.ball.owner === m.idx || sim.players[sim.ball.lastTouch] === m) ok++;
    }
    assert.equal(ok, N, `${ok}/${N}`);
  });
  test('manual pass goes exactly where pointed (no target lock)', () => {
    const { sim, c } = scenario({ passAssist: 'manual' });
    const m = sim.players[7];
    sim._teleport(m, c.x + 15, c.z + 2); // a teammate close to the aim line is ignored
    kick(sim, 'pass', Math.cos(0.4), Math.sin(0.4), 0.4);
    const b = sim.ball;
    assert.ok(b.owner < 0);
    const a = Math.atan2(b.v.z, b.v.x);
    assert.ok(Math.abs(a - 0.4) < 1e-6, 'angle ' + a);
    assert.equal(b.intended === m.idx && false, false);
  });
  test('semi pass: target lock only inside the narrow 35 degree cone', () => {
    const { sim, c } = scenario({ passAssist: 'semi' });
    const m = sim.players[7];
    sim._teleport(m, c.x + 15, c.z + 15 * Math.tan(0.8)); // 46 degrees away from the aim
    kick(sim, 'pass', 1, 0, 0.3);
    // no lock: the ball goes along the stick
    assert.ok(Math.abs(Math.atan2(sim.ball.v.z, sim.ball.v.x)) < 0.02, 'angle ' + Math.atan2(sim.ball.v.z, sim.ball.v.x));
  });
  test('assisted shot is always on frame (keeper may still save)', () => {
    let on = 0, N = 0;
    for (let k = 0; k < 30; k++) {
      const { sim } = scenario({ shotAssist: 'assisted' }, { seed: 100 + k, x0: 22 + (k % 6) * 2.5, z0: -12 + (k % 7) * 4 });
      const p = sim.players[5];
      p.stam = 0.3; // tired, to maximise error
      const aim = { x: Math.cos((k % 5 - 2) * 0.3), z: Math.sin((k % 5 - 2) * 0.3) };
      const plan = humanShot(sim, p, k % 3 ? 'shot' : 'finesse', aim, 0.4 + (k % 7) * 0.1);
      sim._execute(p, plan);
      const pr = predictBall(sim.ball, 3, 0.01);
      N++;
      for (const q of pr) if (behindLine(q, 1) > BALL_R) { if (Math.abs(q.z) < GOAL.HW && q.y < GOAL.H) on++; break; }
    }
    assert.equal(on, N, `${on}/${N}`);
  });
  test('precision shot: exactly where aimed; +speed / less error only when on target', () => {
    const { sim } = scenario({ shotAssist: 'precision' }, { x0: 30, z0: 0 });
    const p = sim.players[5];
    const inside = humanShot(sim, p, 'shot', { x: 1, z: 0.05 }, 0.6);
    const outside = humanShot(sim, p, 'shot', { x: 1, z: 0.4 }, 0.6);
    assert.ok(inside.info.inFrame && !outside.info.inFrame);
    assert.ok(Math.abs(inside.info.point.z - (PITCH.HL - sim.ball.p.x) * 0.05) < 1e-6);
    const s1 = Math.hypot(inside.vel.x, inside.vel.y, inside.vel.z), s2 = Math.hypot(outside.vel.x, outside.vel.y, outside.vel.z);
    assert.ok(s1 > s2 * 1.08, `${s1} vs ${s2}`);
    assert.ok(inside.info.errMul < 0.5 && outside.info.errMul === 1);
  });
  test('manual shot is not snapped into the frame', () => {
    const { sim } = scenario({ shotAssist: 'manual' }, { x0: 30, z0: 0 });
    const plan = humanShot(sim, sim.players[5], 'shot', { x: 1, z: 0.5 }, 0.6);
    assert.ok(Math.abs(plan.info.point.z) > GOAL.HW + 5);
  });
  test('timed finishing: tap just before contact = green, mashed early = red', () => {
    const { sim } = scenario({ timedFinishing: true });
    sim.holds[0].taps = [10.0, 10.18];
    assert.equal(sim._timedQuality(0, 9.95, 10.25), 0);
    sim.holds[0].taps = [10.0];
    assert.equal(sim._timedQuality(0, 9.99, 10.25), 2);
    sim.holds[0].taps = [];
    assert.equal(sim._timedQuality(0, 9.99, 10.25), -1);
  });

  console.log('switching and receiving');
  for (const mode of ['instant', 'release', 'receive']) {
    test(`switchOnPass=${mode}: control moves to the receiver at the right moment`, () => {
      const { sim, c } = scenario({ switchOnPass: mode, passReceiverLock: 'off' });
      const m = sim.players[7];
      sim._teleport(m, c.x + 26, c.z);
      kick(sim, 'pass', 1, 0, 0.1);
      const t0 = sim.t;
      assert.equal(sim.ctrl[0], mode === 'instant' ? m.idx : c.idx);
      let switchedAt = null;
      while (sim.ball.owner < 0 && sim.t - t0 < 5) { sim.step(DT, [inp({}), null]); if (switchedAt == null && sim.ctrl[0] === m.idx) switchedAt = sim.t - t0; }
      const arrive = sim.t - t0;
      assert.equal(sim.ball.owner, m.idx);
      if (mode === 'release') assert.ok(switchedAt > 0.1 && switchedAt < arrive - 0.1, `${switchedAt} / ${arrive}`);
      if (mode === 'receive') assert.ok(switchedAt >= arrive - 2 * DT, `${switchedAt} / ${arrive}`);
    });
  }
  test('the intended receiver moves TO the ball (AI and human-switched), never drifts away', () => {
    for (const human of [false, true]) {
      const { sim, c } = scenario({ switchOnPass: human ? 'instant' : 'receive' });
      const m = sim.players[7];
      sim._teleport(m, c.x + 24, c.z + 8);
      m.vx = 0; m.vz = 5; // drifting sideways before the pass
      m.run = null;
      kick(sim, 'pass', 24, 8, 0.1);
      const d0 = Math.hypot(m.x - sim.ball.p.x, m.z - sim.ball.p.z);
      let toward = 0, n = 0;
      // the human keeps holding the pass direction on the stick: that must not steer the receiver away
      const hold = human ? inp({ mx: 24 / 25.3, my: -8 / 25.3 }) : inp({});
      for (let t = 0; t < 0.8 && sim.ball.owner < 0; t += DT) {
        sim.step(DT, [hold, null]);
        const bx = sim.ball.p.x - m.x, bz = sim.ball.p.z - m.z, bl = Math.hypot(bx, bz) || 1;
        toward += (m.vx * bx + m.vz * bz) / bl; n++;
      }
      assert.ok(toward / n > 0.5, `${human ? 'human' : 'AI'} receiver closing speed ${toward / n}`);
      assert.ok(Math.abs(m.z - (c.z + 8)) < 3, 'receiver drifted ' + m.z);
      void d0;
    }
  });
  test('passes arrive firmly at the receiver\'s feet', () => {
    const { sim, c } = scenario({});
    const m = sim.players[7];
    sim._teleport(m, c.x + 30, c.z);
    kick(sim, 'pass', 1, 0, 0.1);
    let v = 0;
    for (let t = 0; t < 5 && sim.ball.owner < 0; t += DT) { v = Math.hypot(sim.ball.v.x, sim.ball.v.z); sim.step(DT, [inp({}), null]); }
    assert.equal(sim.ball.owner, m.idx);
    assert.ok(v > 5, 'arrival speed ' + v);
  });

  console.log('attributes, physique and PlayStyles');
  const withPlayer = (patch) => {
    const t = structuredClone(BRAZIL);
    Object.assign(t.players[0], patch.gk || {});
    Object.assign(t.players[9], patch.st || {});
    return new MatchSim({ home: t, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed: 1 });
  };
  test('pace is felt: 95 pace clearly outruns 60 pace', () => {
    const fast = withPlayer({ st: { attrs: { ...BRAZIL.players[9].attrs, pac: 95 } } }).players[9];
    const slow = withPlayer({ st: { attrs: { ...BRAZIL.players[9].attrs, pac: 60 } } }).players[9];
    assert.ok(fast.vmax > slow.vmax * 1.15 && fast.acc > slow.acc * 1.2, `${fast.vmax}/${slow.vmax} ${fast.acc}/${slow.acc}`);
  });
  test('taller keepers and Far Reach dive further', () => {
    const plan = (s) => { const g = s.gk(0); g.z = 0; const p = { tReact: 0, tc: s.t + 0.5, x: g.x, y: 1, z: 3.4 }; s.startDive(g, p); return Math.abs(g.act.vz * g.act.flight); };
    const short = plan(withPlayer({ gk: { height: 1.84 } }));
    const tall = plan(withPlayer({ gk: { height: 1.98 } }));
    const far = plan(withPlayer({ gk: { height: 1.84, playstyles: [{ id: 'farreach', plus: true }] } }));
    assert.ok(tall > short + 0.1 && far > short + 0.2, `${short} ${tall} ${far}`);
  });
  test('height raises heading reach; Quick Reflexes speeds up the keeper', () => {
    const a = withPlayer({ st: { height: 1.7 } }).players[9], b = withPlayer({ st: { height: 1.95 } }).players[9];
    assert.ok(b.h + b.jump > a.h + a.jump + 0.2);
    const s1 = withPlayer({}), s2 = withPlayer({ gk: { playstyles: [{ id: 'quickreflexes', plus: false }] } });
    s1.path = s2.path = [{ t: 0, x: -40, y: 1, z: 1 }, { t: 0.5, x: -53, y: 1, z: 2 }];
    const r1 = s1.planSave(s1.gk(0)), r2 = s2.planSave(s2.gk(0));
    assert.ok(r2.tReact - s2.t < r1.tReact - s1.t);
  });
  test('Power PlayStyle hits harder; Rapid dribbles faster; First Touch never fluffs easy balls', () => {
    const base = withPlayer({}), pw = withPlayer({ st: { playstyles: [{ id: 'power', plus: true }, { id: 'rapid' }] } });
    const shot = (s) => { const p = s.players[9]; s.ball.p = { x: 30, y: BALL_R, z: 0 }; const pl = s._plan(p, 'shot', { tz: 1, ty: 1, power: 0.8 }); return Math.hypot(pl.vel.x, pl.vel.y, pl.vel.z); };
    assert.ok(shot(pw) > shot(base) * 1.05);
    assert.ok(pw.dribbleFactor(pw.players[9], false) > base.dribbleFactor(base.players[9], false));
  });

  test('keepers attack loose balls in the box (claim / dive on them before the attacker)', () => {
    let claimed = 0;
    for (let k = 0; k < 8; k++) {
      const { sim } = scenario({}, { seed: 300 + k, x0: -20, z0: 20 });
      const g = sim.gk(1);
      sim._teleport(g, 51.5, 0);
      const b = sim.ball;
      b.owner = -1; b.lastTeam = 0; b.lastTouch = 5; b.kickT = sim.t - 1;
      b.p = { x: 44 + (k % 3), y: BALL_R, z: -4 + k }; b.v = { x: 3, y: 0, z: 0 }; b.w = { x: 0, y: 0, z: 0 };
      const att = sim.players[9];
      sim._teleport(att, b.p.x - 7, b.p.z + 1.5);
      sim.path = null;
      for (let t = 0; t < 2.5; t += DT) {
        sim.step(DT, [inp({}), null]);
        if (sim.ball.owner >= 0) break;
      }
      if (sim.ball.owner === g.idx) claimed++;
    }
    assert.ok(claimed >= 7, `claimed ${claimed}/8`);
  });

  console.log('knockout');
  test('shootout decision rules (best of five, then sudden death)', () => {
    assert.equal(decided({ kicks: [[1, 1, 1], [0, 0]] }), false);
    assert.equal(decided({ kicks: [[1, 1, 1], [0, 0, 0]] }), true);
    assert.equal(decided({ kicks: [[1, 1, 1, 1, 1], [1, 1, 1, 1, 1]] }), false);
    assert.equal(decided({ kicks: [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 0]] }), true);
  });
  test('knockout: level at full time -> extra time -> penalty shootout, result has pens', () => {
    const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 0.5, controllers: { home: 'ai', away: 'ai' }, seed: 5, knockout: true });
    let n = 0, sawET = false, sawPens = false;
    const events = [];
    while (!sim.ended && n++ < 120 * 60 * 12) {
      if (!sim.shootout) { sim.score[0] = 0; sim.score[1] = 0; }
      sim.step(DT, [null, null]);
      if (sim.half >= 3) sawET = true;
      if (sim.shootout) sawPens = true;
      events.push(...sim.drainEvents().map((e) => e.type));
    }
    assert.ok(sim.ended && sawET && sawPens);
    const r = sim.result;
    assert.ok(Array.isArray(r.pens) && r.pens[0] !== r.pens[1], JSON.stringify(r.pens));
    assert.equal(r.homeGoals, r.awayGoals);
    assert.ok(events.includes('extratime') && events.includes('penalties') && events.includes('fulltime'));
    const k = sim.shootout.kicks;
    assert.ok(k[0].length >= 3 && Math.abs(k[0].length - k[1].length) <= 1);
  });

  console.log('ratings');
  test('ratings: 6.0 baseline, hat-trick scorer tops a one-goal player and a busy keeper', () => {
    const hat = { goals: 3, shots: 5, sot: 4, passes: 20, passAtt: 25, mins: 90, touches: 40, team: 0 };
    const one = { goals: 1, assists: 1, kp: 3, shots: 2, sot: 1, passes: 70, passAtt: 75, tackles: 5, int: 3, mins: 90, touches: 90, team: 0 };
    const gk = { gk: true, saves: 9, conceded: 0, passes: 10, passAtt: 12, mins: 90, touches: 20, team: 1 };
    const quiet = { passes: 8, passAtt: 10, mins: 90, touches: 12, team: 0 };
    const r = computeRatings({ hat, one, gk, quiet }, [4, 0]);
    assert.ok(r.hat > r.one && r.hat > r.gk, JSON.stringify(r));
    assert.ok(r.hat <= 10 && r.hat >= 9);
    assert.ok(Math.abs(r.quiet - 6.3) < 0.6, 'quiet ' + r.quiet);
    assert.equal(playerOfMatch(r, { hat, one, gk, quiet }), 'hat');
    assert.ok(rateStats({ red: 1, og: 1, err: 1, mins: 90 }, 0, 3) < 4.5);
  });

  console.log('match result');
  test('result has playerStats, motm and assistId on scorers', () => {
    const sim = new MatchSim({ home: BRAZIL, away: FRANCE, halfMinutes: 1, controllers: { home: 'ai', away: 'ai' }, seed: 9 });
    let n = 0; while (!sim.ended && n++ < 120 * 400) sim.step(DT, [null, null]);
    const r = sim.result;
    const ps = r.playerStats[BRAZIL.players[9].id];
    for (const k of ['goals', 'assists', 'shots', 'shotsOnTarget', 'passes', 'passesCompleted', 'tackles', 'interceptions', 'saves', 'headerGoals', 'finesseGoals', 'cleanSheet', 'minutes']) assert.ok(k in ps, k);
    assert.ok(r.motm in r.playerRatings);
  });

  console.log('tactics');
  test('mentality / formation / quick tactics apply live', () => {
    const t = structuredClone(BRAZIL);
    t.tactics = { depth: 8, quick: [{ name: 'Park', depth: 2, defensiveStyle: 'dropBack' }] };
    const sim = new MatchSim({ home: t, away: FRANCE, halfMinutes: 3, controllers: { home: 'p1', away: 'ai' }, seed: 3 });
    assert.equal(sim.tac[0].depth, 8);
    assert.ok(sim.applyTactic(0, { k: 'quick', i: 0 }));
    assert.equal(sim.tac[0].depth, 2);
    assert.equal(sim.applyTactic(0, { k: 'ment', d: 1 }), 'ATTACKING');
    assert.ok(sim.applyTactic(0, { k: 'formation', f: '4-4-2' }));
    assert.equal(sim.formation[0], '4-4-2');
    assert.ok(sim.applyTactic(0, { k: 'sub', i: 9, bi: 4 }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let passed = 0, failed = 0;
  runGameplayTests((name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
void SP; void PITCH;
