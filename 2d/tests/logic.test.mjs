// Pure-logic tests. Run with: node 2d/tests/logic.test.mjs
import { PITCH, CY, GOAL, BALL_R, PHYS, POST_R } from '../js/constants.js';
import { makeBall, stepBallWorld, integrate, solveKick } from '../js/physics.js';
import { goalScored, keeperMaySave, resolveKeeperContact, outOfPlay, restartFor, judgeTackle, isFromBehind, applyCard, tackleSweep } from '../js/rules.js';
import { choosePassTarget, passVelocity, groundPassSpeed, leadTarget, laneRisk } from '../js/passing.js';
import { planShot, shotVelocity, isOnTarget } from '../js/shooting.js';
import { defaultBinds, setBind, saveBinds, loadBinds, STORAGE_KEY, keyLabel } from '../js/keybinds.js';
import { makeRng } from '../js/util.js';
import { chooseKits, TEAMS, teamByCode, kitsClash } from '../js/data.js';
import { newTournament, recordUserResult, nextUserFixture, standings } from '../js/tournament.js';
import { penaltyOutcomeSim, KeeperModel, buildWall, makeKickState, launch, stepKick, kickError, freeKickSpeed, aiFreeKickDive } from '../js/kickphys.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('Goal-line detection');
test('ball on the line (partly over) is NOT a goal', () => {
  const b = makeBall(PITCH.L + BALL_R * 0.5, CY); b.z = 0.3;
  assert(goalScored(b) === -1);
  assert(keeperMaySave(b, 1), 'keeper may still save while ball is on the line');
});
test('ball wholly over the line between posts under bar IS a goal', () => {
  const b = makeBall(PITCH.L + BALL_R + 0.01, CY + 1); b.z = 1;
  assert(goalScored(b) === 1);
  assert(!keeperMaySave(b, 1), 'no save after the ball crossed');
  assert(resolveKeeperContact(b, 1, true) === 'goal', 'keeper touch after crossing must still be a goal');
});
test('left goal detection', () => {
  const b = makeBall(-BALL_R - 0.02, CY - 2); b.z = 0.2;
  assert(goalScored(b) === 0);
});
test('over the bar / wide is not a goal but out of play', () => {
  const b = makeBall(PITCH.L + 0.5, CY); b.z = GOAL.H + 0.3;
  assert(goalScored(b) === -1);
  assert(outOfPlay(b).type === 'end');
  const w = makeBall(PITCH.L + 0.5, CY + GOAL.W / 2 + 1);
  assert(goalScored(w) === -1 && outOfPlay(w).type === 'end');
});
test('save before line is a save; resolve order never reports SAVED for a goal', () => {
  const b = makeBall(PITCH.L - 0.5, CY); b.z = 0.5;
  assert(resolveKeeperContact(b, 1, true) === 'save');
  b.x = PITCH.L + 0.3;
  assert(resolveKeeperContact(b, 1, true) === 'goal');
});
test('simulated shot into the net registers a goal the moment it crosses', () => {
  const b = makeBall(PITCH.L - 12, CY); b.vx = 25; b.vy = 1; b.vz = 2;
  let goalAt = null, maxX = 0;
  for (let i = 0; i < 240; i++) {
    stepBallWorld(b, PHYS.DT, []);
    maxX = Math.max(maxX, b.x);
    if (goalScored(b) === 1) { goalAt = b.x; break; }
  }
  assert(goalAt !== null, 'should be a goal');
  assert(goalAt > PITCH.L + BALL_R && goalAt < PITCH.L + BALL_R + 0.35, 'detected right after crossing, x=' + goalAt);
});
test('ball hitting the post bounces out (no goal)', () => {
  const b = makeBall(PITCH.L - 8, CY + GOAL.W / 2 + POST_R); b.z = 0.5; b.vx = 25; b.vz = 1.2;
  let goal = false, hitPost = false;
  const ev = [];
  for (let i = 0; i < 180; i++) {
    stepBallWorld(b, PHYS.DT, ev);
    if (goalScored(b) !== -1) goal = true;
  }
  hitPost = ev.includes('post');
  assert(hitPost, 'post collision expected');
  assert(!goal, 'must not be a goal');
  assert(b.vx < 0 || b.x < PITCH.L, 'ball rebounds');
});
test('net stops the ball', () => {
  const b = makeBall(PITCH.L - 5, CY); b.vx = 30; b.vz = 1;
  for (let i = 0; i < 240; i++) stepBallWorld(b, PHYS.DT, []);
  assert(b.x <= PITCH.L + GOAL.D, 'ball stays inside the net, x=' + b.x);
  assert(goalScored(b) === 1, 'still a goal');
});

console.log('Out of play / restarts');
test('restart awards correct team', () => {
  const defOf = (side) => (side === 0 ? 0 : 1);
  const r1 = restartFor({ type: 'end', side: 1, y: 5 }, 1, defOf);     // defender touched last
  assert(r1.type === 'corner' && r1.team === 0);
  const r2 = restartFor({ type: 'end', side: 1, y: 5 }, 0, defOf);     // attacker touched last
  assert(r2.type === 'goalkick' && r2.team === 1);
  const r3 = restartFor({ type: 'side', x: 30, y: 0 }, 0, defOf);
  assert(r3.type === 'throw' && r3.team === 1);
});

console.log('Tackles & fouls');
test('front-on tackle reaching the ball first is clean', () => {
  const victim = { x: 10, y: 10, facing: 0 };            // facing +x
  const tackler = { x: 11.5, y: 10 };                     // in front of him
  assert(!isFromBehind(tackler, victim));
  const r = judgeTackle({ type: 'slide', firstContact: 'ball', bodyContact: true, fromBehind: false });
  assert(!r.foul, 'must be clean');
  const r2 = judgeTackle({ type: 'stand', firstContact: 'ball', bodyContact: false, fromBehind: false });
  assert(!r2.foul);
});
test('tackle from behind that misses the ball is a foul (+yellow for slide)', () => {
  const victim = { x: 10, y: 10, facing: 0 };
  const tackler = { x: 8.8, y: 10.2 };
  assert(isFromBehind(tackler, victim));
  const r = judgeTackle({ type: 'slide', firstContact: 'body', bodyContact: true, fromBehind: true });
  assert(r.foul && r.reason === 'From behind' && r.card === 'yellow');
});
test('body before ball from the front is a late challenge; clean miss is no foul', () => {
  const r = judgeTackle({ type: 'stand', firstContact: 'body', bodyContact: true, fromBehind: false });
  assert(r.foul && r.reason === 'Late challenge' && !r.card);
  const m = judgeTackle({ type: 'stand', firstContact: null, bodyContact: false, nearVictim: false, fromBehind: false });
  assert(!m.foul);
});
test('second yellow becomes red', () => {
  const p = { yellows: 0 };
  assert(applyCard(p, 'yellow') === 'yellow');
  assert(applyCard(p, 'yellow') === 'red' && p.sentOff);
});

console.log('Passing');
test('pass target selection picks the teammate in the aim direction', () => {
  const passer = { x: 30, y: 27, vx: 0, vy: 0 };
  const a = { x: 45, y: 27, vx: 0, vy: 0, id: 'a' };      // straight ahead
  const b = { x: 30, y: 45, vx: 0, vy: 0, id: 'b' };      // to the side
  const res = choosePassTarget(passer, [passer, a, b], [], { x: 1, y: 0 });
  assert(res && res.mate === a, 'should pick a');
  const res2 = choosePassTarget(passer, [passer, a, b], [], { x: 0, y: 1 });
  assert(res2 && res2.mate === b, 'should pick b');
});
test('pass avoids a blocked lane when an alternative exists', () => {
  const passer = { x: 30, y: 27 };
  const a = { x: 45, y: 27, vx: 0, vy: 0 };
  const b = { x: 43, y: 37, vx: 0, vy: 0 };
  const opp = { x: 38, y: 27 };
  const res = choosePassTarget(passer, [a, b], [opp], { x: 1, y: 0.2 });
  assert(res && res.mate === b, 'should avoid interception');
});
test('pass leads a moving receiver', () => {
  const passer = { x: 30, y: 27 };
  const m = { x: 45, y: 20, vx: 0, vy: 4 };
  const res = choosePassTarget(passer, [m], [], { x: 1, y: -0.3 });
  assert(res && res.target.y > m.y + 1, 'target should be ahead of the runner: ' + res.target.y);
});
test('pass speed arrives near target at the predicted time', () => {
  for (const d of [8, 15, 25, 35]) {
    const from = { x: 20, y: 27 }, target = { x: 20 + d * 0.8, y: 27 + d * 0.6 };
    const v = passVelocity(from, target, 'ground');
    const b = makeBall(from.x, from.y); b.vx = v.vx; b.vy = v.vy;
    let t = 0; while (t < v.t - 1e-9) { integrate(b, PHYS.DT); t += PHYS.DT; }
    const err = Math.hypot(b.x - target.x, b.y - target.y);
    assert(err < 0.5, `d=${d} err=${err.toFixed(2)}`);
    assert(Math.hypot(b.vx, b.vy) > 2, 'ball still rolling at arrival');
  }
});
test('lob lands near target', () => {
  const from = { x: 20, y: 27 }, target = { x: 50, y: 20 };
  const v = passVelocity(from, target, 'lob');
  const b = makeBall(from.x, from.y); b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.z = 0.01;
  let t = 0; while (t < 5) { integrate(b, PHYS.DT); t += PHYS.DT; if (b.z <= 0 && t > 0.1) break; }
  const err = Math.hypot(b.x - target.x, b.y - target.y);
  assert(err < 1.0, 'lob error ' + err.toFixed(2));
});

console.log('Shooting');
test('assisted shot snaps on target even when aimed wide', () => {
  const rng = makeRng(7);
  for (let i = 0; i < 200; i++) {
    const from = { x: PITCH.L - 18, y: CY + 6 };
    const aimDir = { x: 1, y: -0.55 };                     // points past the far post
    const p = planShot({ from, aimDir, goalSide: 1, mode: 'Assisted', power: Math.random(), type: 'driven', shooting: 0.5 }, rng);
    assert(p.onTarget && p.snapped, 'should be on target');
    assert(isOnTarget(p.target.y, p.target.z));
  }
});
test('assisted shot is really on target after physics', () => {
  const from = { x: PITCH.L - 20, y: CY - 5 };
  const p = planShot({ from, aimDir: { x: 1, y: 0.4 }, goalSide: 1, mode: 'Assisted', power: 0.6, type: 'finesse', shooting: 0.8 }, makeRng(3));
  const v = shotVelocity(from, p);
  const b = makeBall(from.x, from.y); b.z = 0.11; Object.assign(b, { vx: v.vx, vy: v.vy, vz: v.vz, spin: v.spin });
  let crossed = null;
  for (let i = 0; i < 400; i++) { integrate(b, PHYS.DT); if (b.x >= PITCH.L) { crossed = { y: b.y, z: b.z }; break; } }
  assert(crossed && isOnTarget(crossed.y, crossed.z), 'crossing ' + JSON.stringify(crossed));
});
test('precision bonus: on-target aim gets +10% speed and half the error', () => {
  const from = { x: PITCH.L - 20, y: CY };
  const aim = { x: 1, y: 0.1 };
  const pr = planShot({ from, aimDir: aim, goalSide: 1, mode: 'Precision', power: 0.7, type: 'driven', shooting: 0.7 }, makeRng(1));
  const mn = planShot({ from, aimDir: aim, goalSide: 1, mode: 'Manual', power: 0.7, type: 'driven', shooting: 0.7 }, makeRng(1));
  assert(pr.bonus && !mn.bonus);
  assert(near(pr.speed / mn.speed, 1.1, 1e-9), 'speed ratio ' + pr.speed / mn.speed);
  assert(near(pr.sd / mn.sd, 0.5, 1e-9));
  const off = planShot({ from, aimDir: { x: 1, y: 0.6 }, goalSide: 1, mode: 'Precision', power: 0.7, type: 'driven', shooting: 0.7 }, makeRng(1));
  assert(!off.bonus && near(off.speed, mn.speed, 1e-9), 'off-target aim gets no bonus');
});
test('manual mode does not snap', () => {
  const from = { x: PITCH.L - 20, y: CY };
  const p = planShot({ from, aimDir: { x: 1, y: 0.6 }, goalSide: 1, mode: 'Manual', power: 0.5, type: 'driven', shooting: 1 }, makeRng(2));
  assert(!p.snapped && !p.onTarget);
});
test('overpowered shots are wilder', () => {
  const base = { from: { x: 60, y: CY }, aimDir: { x: 1, y: 0 }, goalSide: 1, mode: 'Manual', type: 'driven', shooting: 0.7 };
  assert(planShot({ ...base, power: 1 }).sd > planShot({ ...base, power: 0.6 }).sd * 1.5);
});
test('curved kick solver hits its target', () => {
  const from = { x: 60, y: 20, z: 0.11 }, target = { x: PITCH.L, y: CY + 2, z: 1.8 };
  const v = solveKick(from, target, 24, { spin: 1 });
  const b = makeBall(from.x, from.y); b.z = 0.11; Object.assign(b, { vx: v.vx, vy: v.vy, vz: v.vz, spin: 1 });
  for (let i = 0; i < 400; i++) { integrate(b, PHYS.DT); if (b.x >= PITCH.L) break; }
  assert(Math.abs(b.y - target.y) < 0.15 && Math.abs(b.z - target.z) < 0.2, `y=${b.y.toFixed(2)} z=${b.z.toFixed(2)}`);
});

console.log('Keybinds');
test('keybind save / load round trip', () => {
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  let b = defaultBinds();
  b = setBind(b, 'p1', 'pass', 'KeyK').binds;
  assert(saveBinds(storage, b));
  assert(mem[STORAGE_KEY]);
  const l = loadBinds(storage);
  assert(l.p1.pass === 'KeyK' && l.p1.shoot === 'Space');
});
test('keybind conflict swaps the keys', () => {
  const b = defaultBinds();
  const r = setBind(b, 'p1', 'pass', 'Space');                // Space is shoot
  assert(r.swapped && r.conflict.action === 'shoot');
  assert(r.binds.p1.pass === 'Space' && r.binds.p1.shoot === 'KeyJ');
  assert(b.p1.pass === 'KeyJ', 'original untouched');
  const r2 = setBind(b, 'p2', 'shoot', 'KeyW');                // cross-player conflict
  assert(r2.swapped && r2.conflict.player === 'p1' && r2.binds.p1.up === 'Numpad0');
});
test('load survives broken storage', () => {
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const l = loadBinds(bad);
  assert(l.p1.up === 'KeyW');
  assert(saveBinds(bad, l) === false);
  const junk = { getItem: () => '{not json', setItem() {} };
  assert(loadBinds(junk).p1.shoot === 'Space');
  assert(keyLabel('KeyW') === 'W' && keyLabel('ArrowUp') === '↑');
});

console.log('Data / kits / tournament / penalties');
test('>= 24 teams with kits and 7 named players', () => {
  assert(TEAMS.length >= 24);
  for (const t of TEAMS) assert(t.squad.length === 7 && t.home.shirt && t.away.shirt && t.squad.every((p) => p.name && p.num));
});
test('kit clash switches away side to away kit', () => {
  const k = chooseKits(teamByCode('ENG'), teamByCode('GER'));     // both white
  assert(k.awayUsesAway && !kitsClash(k.kits[0], k.kits[1]));
  const k2 = chooseKits(teamByCode('BRA'), teamByCode('FRA'));
  assert(!k2.awayUsesAway);
});
test('tournament progresses to a champion', () => {
  const rng = makeRng(11);
  const t = newTournament('BRA', rng);
  let guard = 0;
  while (t.stage !== 'done' && guard++ < 20) {
    const f = nextUserFixture(t);
    if (!f) { recordUserResult(t, null, rng); continue; }
    recordUserResult(t, { gf: 2, ga: 1 }, rng);
  }
  assert(t.stage === 'done' && t.champion, 'champion decided');
  assert(standings(t, 0).length === 4);
});
test('AI penalty takers convert roughly 65-88%', () => {
  const rng = makeRng(5);
  let goals = 0; const N = 3000;
  for (let i = 0; i < N; i++) if (penaltyOutcomeSim(rng, 0.75, 0.7) === 'goal') goals++;
  const r = goals / N;
  assert(r > 0.65 && r < 0.88, 'conversion ' + r.toFixed(3));
});

console.log('Regression tests (browser QA fixes)');
test('front-on standing tackle meets the ball before the man (clean)', () => {
  // attacker at x=40 facing -x with the ball 0.55 m in front; defender 0.72 m away facing him
  const victim = { x: 40, y: 27, facing: Math.PI };
  const ball = { x: 39.45, y: 27, z: 0 };
  for (const dy of [0, 0.15, -0.2]) {
    const tackler = { x: 39.28, y: 27 + dy };
    const dir = Math.atan2(ball.y - tackler.y, ball.x - tackler.x);   // lunge at the ball
    const sw = tackleSweep(tackler, dir, 0.9, ball, [victim]);
    assert(sw.first === 'ball', 'front-on tackle should be clean, got ' + sw.first);
    assert(!judgeTackle({ type: 'stand', firstContact: 'ball', bodyContact: true, fromBehind: false }).foul);
  }
});
test('tackle through the man from behind hits the body first (foul)', () => {
  const victim = { x: 40, y: 27, facing: 0 };             // running +x, ball ahead of him
  const ball = { x: 40.6, y: 27, z: 0 };
  const tackler = { x: 39.3, y: 27 };
  const sw = tackleSweep(tackler, 0, 0.9, ball, [victim]);
  assert(sw.first === 'body', 'expected body first, got ' + sw.first);
  assert(isFromBehind(tackler, victim));
  assert(judgeTackle({ type: 'stand', firstContact: 'body', bodyContact: true, fromBehind: true }).foul);
});
test('shoulder-to-shoulder challenge for the ball is not a body foul', () => {
  const victim = { x: 40, y: 27, facing: 0 };
  const ball = { x: 40.6, y: 27.1, z: 0 };
  const tackler = { x: 40.0, y: 27.72 };                  // alongside
  const sw = tackleSweep(tackler, Math.atan2(ball.y - tackler.y, ball.x - tackler.x), 0.9, ball, [victim]);
  assert(sw.first !== 'body', 'side-on challenge reached the ball, got ' + sw.first);
});
test('through ball is played into reachable space, not 40 m ahead', () => {
  const from = { x: 30, y: 27 };
  const runner = { x: 45, y: 20, vx: 6, vy: 0 };
  const lt = leadTarget(from, runner, 'through', 1);
  const lead = Math.hypot(lt.target.x - runner.x, lt.target.y - runner.y);
  assert(lead >= 3 && lead <= 14.5, 'lead ' + lead.toFixed(1));
  assert(lt.target.x > runner.x, 'ahead of the runner');
});
test('lane risk: blocked lane is risky, open lane is safe', () => {
  const a = { x: 30, y: 27 }, b = { x: 45, y: 27 };
  assert(laneRisk(a, b, [{ x: 38, y: 27.3 }]) > 0.8, 'blocked');
  assert(laneRisk(a, b, [{ x: 36, y: 45 }]) < 0.2, 'open');
});
test('pass with nobody in the 45° cone still finds a teammate slightly wider', () => {
  const passer = { x: 30, y: 27 };
  const m = { x: 40, y: 37, vx: 0, vy: 0 };               // 45°+ off a straight-ahead aim
  const r = choosePassTarget(passer, [m], [], { x: 1, y: -0.12 });
  assert(r && r.mate === m, 'wide-cone fallback');
});
test('long lofted kicks reach their target (drag-corrected solver)', () => {
  for (const [d, hs] of [[35, 23], [45, 23], [45, 30], [30, 15]]) {
    const from = { x: 5, y: 27, z: 0.11 }, target = { x: 5 + d, y: 30, z: 0.4 };
    const v = solveKick(from, target, hs, { loft: true });
    const b = makeBall(from.x, from.y); Object.assign(b, { z: from.z, vx: v.vx, vy: v.vy, vz: v.vz });
    let best = 1e9, t = 0;
    while (t < 6) { integrate(b, PHYS.DT); t += PHYS.DT; best = Math.min(best, Math.hypot(b.x - target.x, b.y - target.y, b.z - target.z)); if (b.z <= 0 && t > 0.3) break; }
    assert(best < 0.3, `d=${d} hs=${hs} miss ${best.toFixed(2)}`);
  }
});
test('free kicks: a well-struck kick into the corner beats a Normal keeper sometimes (20-70%)', () => {
  const rng = makeRng(21);
  let goals = 0, saves = 0; const N = 400;
  for (let i = 0; i < N; i++) {
    const pos = { x: PITCH.L - (18 + rng() * 10), y: CY + (rng() - 0.5) * 20 };
    const keeper = new KeeperModel(CY + (pos.y < CY ? 1 : -1) * 0.8, 0.65, PITCH.L - 0.6);
    const wall = buildWall(pos, 4, rng);
    const s = makeKickState(pos, keeper, wall);
    const far = pos.y < CY ? 1 : -1;
    const tgt = kickError({ y: CY + far * (GOAL.W / 2 - 0.6), z: 1.6 }, 0.7, 0.75, rng, 1.2);
    launch(s, tgt, freeKickSpeed(0.7), { spin: far * 0.7 });
    const dv = aiFreeKickDive(s.ball, keeper, true, rng);
    let dived = false;
    for (let k = 0; k < 800 && !s.done; k++) { if (!dived && s.t >= dv.at) { keeper.dive(dv.y, dv.z, dv.dur); dived = true; } stepKick(s, PHYS.DT); }
    if (s.result === 'goal') goals++; if (s.result === 'save') saves++;
    // a kick recorded as saved must never have ended inside the goal
    if (s.result === 'save') assert(goalScored(s.ball) === -1, 'saved ball is in the goal');
  }
  const r = goals / N;
  assert(r > 0.2 && r < 0.7, 'FK goal rate ' + r.toFixed(2));
  assert(saves > 0, 'keeper still makes saves');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
