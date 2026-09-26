// Pure-logic tests. Run with: node 2d/tests/logic.test.mjs
import { PITCH, CY, GOAL, BALL_R, PHYS, POST_R } from '../js/constants.js';
import { DEG } from '../js/util.js';
import { makeBall, stepBallWorld, integrate, solveKick } from '../js/physics.js';
import { goalScored, keeperMaySave, resolveKeeperContact, outOfPlay, restartFor, judgeTackle, isFromBehind, applyCard, tackleSweep } from '../js/rules.js';
import { choosePassTarget, passVelocity, groundPassSpeed, leadTarget, laneRisk, planPass, manualPassSpeed, PASS_CONES, HUMAN_PASS_BOOST } from '../js/passing.js';
import { touchHeaviness, savedKickRestart, timedFinishGrade, shoulderWinChance } from '../js/feel.js';
import { defensiveRoles, markTargets } from '../js/ai.js';
import { sanitizeGameplay, GAMEPLAY_DEFAULTS } from '../js/settings.js';
import { sanitizeBinds } from '../js/keybinds.js';
import { makePlayer, stepPlayer } from '../js/player.js';
import { planShot, shotVelocity, isOnTarget } from '../js/shooting.js';
import { defaultBinds, setBind, saveBinds, loadBinds, STORAGE_KEY, keyLabel } from '../js/keybinds.js';
import { makeRng, norm } from '../js/util.js';
import { chooseKits, TEAMS, teamByCode, kitsClash, kitTone } from '../js/data.js';
import { Match } from '../js/match.js';
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
test('every nation has a distinct home/away/third kit, with patterns beyond plain', () => {
  const patterns = new Set();
  for (const t of TEAMS) {
    assert(t.third && t.third.shirt && t.third.pattern, `${t.code} missing a third kit`);
    patterns.add(t.home.pattern); patterns.add(t.away.pattern); patterns.add(t.third.pattern);
    // the third kit must read as a different colour from both home and away
    assert(kitTone(t.third) !== kitTone(t.home) && kitTone(t.third) !== kitTone(t.away), `${t.code} third kit is not distinct`);
  }
  for (const p of ['stripes', 'hoops', 'sashes']) assert(patterns.has(p), `no team uses the ${p} pattern`);
});
test('kit clash detection always finds enough colour contrast across every fixture', () => {
  for (let i = 0; i < TEAMS.length; i++) {
    for (const j of [(i + 5) % TEAMS.length, (i + 11) % TEAMS.length, (i + 17) % TEAMS.length]) {
      if (i === j) continue;
      const home = TEAMS[i], away = TEAMS[j];
      const k = chooseKits(home, away);
      // when a non-clashing option exists among the away side's kits, one is picked
      const anyClear = [away.home, away.away, away.third].some((kit) => !kitsClash(home.home, kit));
      if (anyClear) assert(!kitsClash(k.kits[0], k.kits[1]), `${home.code} vs ${away.code} (${k.kitTag}) still clashes`);
      assert(!kitsClash(k.gk[0], k.kits[0]) && !kitsClash(k.gk[0], k.kits[1]), `${home.code} home keeper kit blends in`);
    }
  }
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
test('through ball goes well into space: lead = runner speed x arrival time, 20-35 m pass', () => {
  const from = { x: 30, y: 27 };
  const runner = { x: 45, y: 20, vx: 6, vy: 0 };
  const lt = leadTarget(from, runner, 'through', 1);
  const lead = Math.hypot(lt.target.x - runner.x, lt.target.y - runner.y);
  const len = Math.hypot(lt.target.x - from.x, lt.target.y - from.y);
  assert(lt.target.x > runner.x + 8, 'well ahead of the runner');
  assert(len >= 20 && len <= 35, 'pass length ' + len.toFixed(1));
  assert(lead <= 28, 'not absurdly far ahead: ' + lead.toFixed(1));
  // the runner (sprinting ~7 m/s after a short reaction) gets there just as the ball does
  const runT = lead / 7.2 + 0.25;
  assert(Math.abs(runT - lt.t) < 0.35, `runner ${runT.toFixed(2)}s vs ball ${lt.t.toFixed(2)}s`);
  // the ball is still rolling when it gets there (it does not die in front of him)
  const v = passVelocity(from, lt.target, 'through');
  const b = makeBall(from.x, from.y); b.vx = v.vx; b.vy = v.vy;
  let t = 0; while (t < v.t) { integrate(b, PHYS.DT); t += PHYS.DT; }
  assert(Math.hypot(b.vx, b.vy) > 5, 'arrives with pace ' + Math.hypot(b.vx, b.vy).toFixed(1));
});
test('ground passes are firm: quick arrival, speed grows with distance, never a weak roll', () => {
  let prev = 0;
  for (const d of [6, 12, 20, 30, 40]) {
    const v = passVelocity({ x: 10, y: 27 }, { x: 10 + d, y: 27 }, 'ground');
    const v0 = Math.hypot(v.vx, v.vy);
    assert(v0 > prev, 'speed grows with distance');
    assert(v0 >= 9.5, `d=${d} launch speed ${v0.toFixed(1)} too weak`);
    assert(v.t < 0.25 + d / 11, `d=${d} takes ${v.t.toFixed(2)}s`);
    const b = makeBall(10, 27); b.vx = v.vx;
    let t = 0; while (t < v.t) { integrate(b, PHYS.DT); t += PHYS.DT; }
    assert(Math.hypot(b.vx, b.vy) >= 7.5, `d=${d} arrives at ${Math.hypot(b.vx, b.vy).toFixed(1)} m/s`);
    prev = v0;
  }
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

console.log('Gameplay settings: pass assistance');
test('assisted pass always reaches the target team-mate when unobstructed', () => {
  const rng = makeRng(31);
  for (let i = 0; i < 60; i++) {
    const passer = { x: 20 + rng() * 30, y: 10 + rng() * 34 };
    const ang = (rng() - 0.5) * 2 * Math.PI;
    const d = 8 + rng() * 22;
    const mate = { x: passer.x + Math.cos(ang) * d, y: passer.y + Math.sin(ang) * d, vx: (rng() - 0.5) * 8, vy: (rng() - 0.5) * 8 };
    if (mate.x < 6 || mate.x > PITCH.L - 6 || mate.y < 6 || mate.y > PITCH.W - 6) continue;
    const off = (rng() - 0.5) * 1.0;                                   // aim up to ~30 degrees off
    const aimDir = { x: Math.cos(ang + off), y: Math.sin(ang + off) };
    for (const kind of ['ground', 'lob']) {
      const plan = planPass({ passer, from: passer, mates: [passer, mate], opps: [], aimDir, kind, attackDir: 1, mode: 'Assisted', power: rng() });
      assert(plan.mate === mate, 'assisted pass picked the team-mate');
      assert(plan.err === 0, 'no error in assisted passing');
      const b = makeBall(passer.x, passer.y); Object.assign(b, { vx: plan.v.vx, vy: plan.v.vy, vz: plan.v.vz, z: plan.v.vz ? 0.01 : 0 });
      let t = 0, best = 1e9;
      while (t < plan.v.t + 0.6) {
        integrate(b, PHYS.DT); t += PHYS.DT;
        const mx = mate.x + mate.vx * t, my = mate.y + mate.vy * t;   // he keeps his run
        if (b.z < 1.2) best = Math.min(best, Math.hypot(b.x - mx, b.y - my));
      }
      assert(best < 1.0, `${kind} pass misses the runner by ${best.toFixed(2)} m`);
    }
  }
});
test('semi-assisted pass uses a narrower cone than assisted', () => {
  const passer = { x: 30, y: 27 };
  const mate = { x: 30 + 15 * Math.cos(50 * Math.PI / 180), y: 27 + 15 * Math.sin(50 * Math.PI / 180), vx: 0, vy: 0 };   // 50 deg off the aim
  const o = { passer, from: passer, mates: [passer, mate], opps: [], aimDir: { x: 1, y: 0 }, kind: 'ground', attackDir: 1, power: 0.5, passing: 0.8 };
  assert(planPass({ ...o, mode: 'Assisted' }, makeRng(1)).mate === mate, 'assisted finds him');
  assert(planPass({ ...o, mode: 'Semi' }, makeRng(1)).mate === null, 'semi relies on the aim: nobody in its cone');
  const near = { x: 45, y: 29, vx: 0, vy: 0 };                          // ~8 deg off: both find him
  assert(planPass({ ...o, mates: [passer, near], mode: 'Semi' }, makeRng(1)).mate === near);
  // semi: hold time changes the weight of the pass
  const soft = planPass({ ...o, mates: [passer, near], mode: 'Semi', power: 0.05 }, makeRng(2));
  const hard = planPass({ ...o, mates: [passer, near], mode: 'Semi', power: 1 }, makeRng(2));
  assert(Math.hypot(hard.v.vx, hard.v.vy) > Math.hypot(soft.v.vx, soft.v.vy) * 1.2, 'power from hold time');
});
test('manual pass goes exactly where aimed with the power held (no targeting)', () => {
  const passer = { x: 30, y: 27 };
  const mate = { x: 44, y: 31, vx: 0, vy: 0 };
  for (const aimDir of [{ x: 1, y: 0 }, { x: 0.6, y: 0.8 }, { x: -0.8, y: 0.6 }]) {
    let prev = 0;
    for (const power of [0.1, 0.5, 1]) {
      const pl = planPass({ passer, from: passer, mates: [passer, mate], opps: [], aimDir, kind: 'ground', mode: 'Manual', power });
      assert(pl.mate === null, 'no receiver chosen');
      const sp = Math.hypot(pl.v.vx, pl.v.vy);
      assert(Math.abs(pl.v.vx / sp - aimDir.x) < 1e-9 && Math.abs(pl.v.vy / sp - aimDir.y) < 1e-9, 'exact direction');
      assert(near(sp, manualPassSpeed('ground', power) * HUMAN_PASS_BOOST, 1e-9) && sp > prev, 'speed from power, boosted a touch over the raw manual-pass formula');
      prev = sp;
    }
    const lob = planPass({ passer, from: passer, mates: [passer, mate], opps: [], aimDir, kind: 'lob', mode: 'Manual', power: 0.5 });
    const d = Math.hypot(lob.target.x - passer.x, lob.target.y - passer.y);
    assert(near(d, manualPassSpeed('lob', 0.5), 1e-6), 'lob distance from power');
    assert(Math.abs((lob.target.x - passer.x) / d - aimDir.x) < 1e-9, 'lob lands along the aim');
  }
});

console.log('Gameplay settings: defending / marking');
const P = (x, y, human = -1, extra = {}) => ({ x, y, human, role: 'DF', vx: 0, vy: 0, ...extra });
test('AI defending: Assisted helps (press or contain), Tactical leaves it to you', () => {
  const carrier = { x: 40, y: 27 };
  const me = P(41.5, 27, 0), a1 = P(44, 27), a2 = P(50, 30), a3 = P(55, 20);
  const field = [me, a1, a2, a3];
  let r = defensiveRoles(field, carrier, { mode: 'Assisted' });
  assert(r.container === a1 && !r.presser && r.cover === a2, 'you engage, nearest mate contains, next covers');
  const far = P(60, 40, 0);
  r = defensiveRoles([far, a1, a2, a3], carrier, { mode: 'Assisted' });
  assert(r.presser === a1, 'nearest AI presses when he is closer than you');
  r = defensiveRoles(field, carrier, { mode: 'Tactical' });
  assert(!r.presser && !r.container, 'tactical: nobody presses for you');
  r = defensiveRoles([far, a1, a2, a3], carrier, { mode: 'Tactical' });
  assert(!r.presser && r.container === a1, 'tactical: someone contains only when you are far away');
  r = defensiveRoles([a1, a2, a3], carrier, {});
  assert(r.presser === a1 && r.cover === a2, 'CPU team presses and covers');
});
test('auto marking: runners are tracked when on, zones held when off', () => {
  const goal = { x: 0, y: CY };
  const d1 = P(15, 20), d2 = P(15, 34), me = P(25, 27, 0);
  const runner = { x: 18, y: 22 }, other = { x: 20, y: 36 }, far = { x: 60, y: 27 };
  const homes = new Map([[d1, { x: 15, y: 20 }], [d2, { x: 15, y: 34 }], [me, { x: 25, y: 27 }]]);
  const on = markTargets([d1, d2, me], [runner, other, far], (p) => homes.get(p), goal, { autoMarking: true });
  assert(on.get(d1) === runner && on.get(d2) === other, 'each runner picked up by the defender of that zone');
  assert(!on.has(me), 'the human-controlled player is never assigned');
  assert(![...on.values()].includes(far), 'far attacker (out of every zone) is left');
  const off = markTargets([d1, d2, me], [runner, other, far], (p) => homes.get(p), goal, { autoMarking: false });
  assert(off.size === 0, 'no man-marking with auto marking off');
});

console.log('2D gameplay sims: user-team parity, receiving, interceptions (AI vs AI)');
test('assisted human passing uses the exact same target-selection as an AI pass, with a bit more pace', () => {
  const passer = { x: 28, y: 24 }, mate = { x: 46, y: 33, vx: 1.5, vy: -0.5 };
  const opps = [{ x: 34, y: 27 }];
  for (const kind of ['ground', 'through', 'lob']) {
    const aim = norm(mate.x - passer.x, mate.y - passer.y);
    const C = PASS_CONES.Assisted;
    // choosePassTarget / leadTarget are the exact functions planPass('Assisted') calls;
    // reproducing its own cone (and full lead) here proves the human pass IS that AI solver, not a copy.
    const ai = choosePassTarget(passer, [passer, mate], opps, aim, kind, 1, { cone: C[kind] * DEG, wide: C.wide * DEG, alignW: C.alignW, fullLead: true });
    const humanPlan = planPass({ passer, from: passer, mates: [passer, mate], opps, aimDir: aim, kind, attackDir: 1, mode: 'Assisted', power: 0.5, passing: 0.7 });
    assert(ai.mate === humanPlan.mate, `${kind}: assisted pass should pick the same team-mate as the AI`);
    const aiV = passVelocity(passer, ai.target, kind);
    const aiSpeed = Math.hypot(aiV.vx, aiV.vy), humanSpeed = Math.hypot(humanPlan.v.vx, humanPlan.v.vy);
    if (kind === 'lob') {
      // the owner asked for ground/through passes to feel firmer; lobs (landing-spot driven) are untouched
      assert(near(aiV.vx, humanPlan.v.vx, 1e-9) && near(aiV.vy, humanPlan.v.vy, 1e-9), 'lob velocity must match the AI\'s');
    } else {
      // same direction, but a human ground/through pass carries a bit more pace than the AI's (never weaker)
      assert(Math.abs(aiV.vx / aiSpeed - humanPlan.v.vx / humanSpeed) < 1e-6, `${kind}: same direction as the AI`);
      assert(humanSpeed > aiSpeed * 1.03 && humanSpeed < aiSpeed * (HUMAN_PASS_BOOST + 0.1),
        `${kind}: human pass should be a bit firmer than the AI's (got ${(humanSpeed / aiSpeed).toFixed(3)}x)`);
    }
  }
});
test('AI vs AI: user-side (team 0) pass completion is on par with the AI opponent\'s, and both sides record interceptions', () => {
  const totals = { cmp: [0, 0], att: [0, 0], int: [0, 0] };
  for (let seed = 0; seed < 4; seed++) {
    const m = new Match({ home: TEAMS[seed], away: TEAMS[(seed + 9) % TEAMS.length], humans: [], minutes: 4, noClock: true });
    for (let i = 0; i < 4800; i++) m.update(1 / 60);
    for (const t of [0, 1]) { totals.cmp[t] += m.stats[t].passCmp; totals.att[t] += m.stats[t].passAtt; totals.int[t] += m.stats[t].interceptions; }
  }
  const rate = (t) => totals.cmp[t] / Math.max(1, totals.att[t]);
  assert(totals.att[0] > 20 && totals.att[1] > 20, 'both sides actually played passes: ' + JSON.stringify(totals.att));
  assert(Math.abs(rate(0) - rate(1)) < 0.2, `pass completion should be close: user ${rate(0).toFixed(2)} vs AI ${rate(1).toFixed(2)}`);
  assert(totals.int[0] > 0, 'team 0 (the user\'s team) must record interceptions, not just AI opponents');
  assert(totals.int[1] > 0, 'AI opponents still intercept too');
});
test('receivers move onto the ball\'s path and close the distance, they do not free-roam', () => {
  const m = new Match({ home: TEAMS[2], away: TEAMS[13], humans: [], minutes: 4, noClock: true });
  let watch = null; const done = [];
  for (let i = 0; i < 9000 && done.length < 10; i++) {
    m.update(1 / 60);
    for (const e of m.events) {
      if (e.type === 'pass' && e.receiver && !watch) {
        watch = { receiver: e.receiver, passRef: m.pass, start: Math.hypot(e.receiver.x - m.ball.x, e.receiver.y - m.ball.y) };
      }
    }
    m.events.length = 0;
    if (watch && m.pass !== watch.passRef) {
      if (m.owner === watch.receiver) done.push({ start: watch.start, end: Math.hypot(watch.receiver.x - m.ball.x, watch.receiver.y - m.ball.y) });
      watch = null;
    }
  }
  assert(done.length >= 5, 'need enough completed passes to a receiver to check: got ' + done.length);
  for (const d of done) assert(d.end < d.start, `receiver ended farther from the ball than he started: ${d.start.toFixed(2)} -> ${d.end.toFixed(2)}`);
  assert(done.every((d) => d.end < 1.2), 'receiver actually meets the ball, not just gets close');
});

console.log('Feel');
test('first touch gets heavier with ball speed, sprinting and pressure, cleaner with dribbling', () => {
  const base = { relSpeed: 14, dribbling: 0.6, sprinting: false, pressure: 0, height: 0 };
  assert(touchHeaviness({ ...base, relSpeed: 6 }) === 0, 'a soft pass is cushioned dead');
  assert(touchHeaviness({ ...base, relSpeed: 22 }) > touchHeaviness(base), 'faster ball = heavier');
  assert(touchHeaviness({ ...base, sprinting: true }) > touchHeaviness(base), 'sprinting = heavier');
  assert(touchHeaviness({ ...base, pressure: 1 }) > touchHeaviness(base), 'pressure = heavier');
  const hard = { ...base, relSpeed: 20, sprinting: true, pressure: 0.8 };
  assert(touchHeaviness({ ...hard, dribbling: 0.95 }) < touchHeaviness({ ...hard, dribbling: 0.3 }) * 0.6, 'good dribblers are much cleaner');
  assert(touchHeaviness({ ...hard, relSpeed: 40, dribbling: 0 }) <= 0.9, 'bounded');
});
test('momentum: no instant 180 at full sprint (braking arc), easy turn when slow', () => {
  const info = { role: 'MF', num: 8, name: 'T', attrs: { pace: 0.7, dribbling: 0.7, stamina: 0.7, shooting: 0.5, passing: 0.5, tackling: 0.5, keeping: 0.3 } };
  const p = makePlayer(0, 3, info);
  p.x = 40; p.y = 27; p.vx = 9; p.vy = 0; p.facing = 0; p.sprint = true;
  p.want.x = -9; p.want.y = 0;
  let t = 0, maxLat = 0;
  while (p.vx > -6 && t < 3) { stepPlayer(p, PHYS.DT); t += PHYS.DT; maxLat = Math.max(maxLat, Math.abs(p.y - 27)); }
  assert(t > 0.5, 'reversing from a sprint takes time: ' + t.toFixed(2));
  assert(maxLat > 0.3, 'the turn is an arc, not a stop on a sixpence');
  const q = makePlayer(0, 3, info);
  q.x = 40; q.y = 27; q.vx = 2; q.vy = 0; q.want.x = -2; q.want.y = 0;
  let t2 = 0; while (q.vx > -2 && t2 < 3) { stepPlayer(q, PHYS.DT); t2 += PHYS.DT; }
  assert(t2 < 0.25, 'jogging turn is quick: ' + t2.toFixed(2));
});
test('shoulder duel: strength decides, shielding helps the carrier', () => {
  const strong = { attrs: { strength: 0.9 } }, weak = { attrs: { strength: 0.4 } };
  assert(shoulderWinChance(strong, weak) > 0.7 && shoulderWinChance(weak, strong) < 0.2);
  assert(shoulderWinChance(strong, weak, { shielding: true }) < shoulderWinChance(strong, weak));
});
test('timed finishing: tap at contact = green, early / late = red, none = normal', () => {
  assert(timedFinishGrade(0.02).grade === 'perfect' && timedFinishGrade(0.02).errMul < 1);
  assert(timedFinishGrade(-0.15).grade === 'early' && timedFinishGrade(-0.15).errMul > 1);
  assert(timedFinishGrade(0.2).grade === 'late');
  assert(timedFinishGrade(null).grade === 'none' && timedFinishGrade(null).errMul === 1);
});
test('saved penalty / free kick restarts vary: catch, corner, parry into play', () => {
  const rng = makeRng(9);
  const seen = { catch: 0, corner: 0, parry: 0 };
  for (let i = 0; i < 400; i++) seen[savedKickRestart(rng() < 0.45, CY + (rng() - 0.5) * 6, rng, CY).type]++;
  assert(seen.catch > 60 && seen.corner > 60 && seen.parry > 60, JSON.stringify(seen));
  for (let i = 0; i < 20; i++) assert(savedKickRestart(true, CY, rng, CY).type === 'catch', 'a held ball is always a catch');
  const c = savedKickRestart(false, CY - 2, () => 0.1, CY);
  assert(c.type === 'corner' && c.upper, 'corner on the side the ball was saved');
  const pr = savedKickRestart(false, CY + 2, () => 0.9, CY);
  assert(pr.type === 'parry' && pr.dy > 0 && pr.dist > 0 && pr.speed > 0, 'parry has a rebound');
});
test('gameplay settings: per-player defaults, legacy shot assist migrates, junk dropped', () => {
  const g = sanitizeGameplay({ p1: { passGround: 'Manual', autoTackle: 'yes', defending: 'Bogus' }, p2: { receiverLock: true } }, 'Precision');
  assert(g.p1.passGround === 'Manual' && g.p1.autoTackle === GAMEPLAY_DEFAULTS.autoTackle && g.p1.defending === GAMEPLAY_DEFAULTS.defending);
  assert(g.p1.shot === 'Precision' && g.p2.shot === 'Precision', 'old single assist setting kept');
  assert(g.p2.receiverLock === true && g.p2.passGround === GAMEPLAY_DEFAULTS.passGround);
  assert(sanitizeGameplay(null).p1.autoSwitch === 'Auto');
});
test('jockey action: default V, rebindable, old saves get it unless V is taken', () => {
  const b = defaultBinds();
  assert(b.p1.jockey === 'KeyV' && b.p2.jockey);
  const r = setBind(b, 'p1', 'jockey', 'KeyG');
  assert(r.binds.p1.jockey === 'KeyG' && !r.swapped);
  const old = defaultBinds(); delete old.p1.jockey; delete old.p2.jockey;
  assert(sanitizeBinds(old).p1.jockey === 'KeyV', 'added to an old save');
  old.p1.skill = 'KeyV';
  assert(sanitizeBinds(old).p1.jockey === '', 'left unbound instead of clashing');
});

console.log('FIFA-style pass reception assist (human receiver)');
/** A fake controller: never presses anything, always holds the same stick direction. */
function stickCtrl(x, y) {
  return { isHeld: () => false, wasPressed: () => false, move: () => ({ x, y }) };
}
/** A human-controlled passer plays a ground pass to a human-controlled receiver, with every
 *  other player parked far off the pitch so nobody can interfere or intercept. */
function setupAssistScenario(ctrl) {
  const m = new Match({ home: TEAMS[0], away: TEAMS[1], humans: [{ ctrl: 0, team: 0 }], ctrls: [ctrl], minutes: 4, noClock: true });
  for (let i = 0; i < 300 && m.state !== 'play'; i++) m.update(1 / 60);
  assert(m.state === 'play', 'kickoff must resolve to play');
  const passer = m.mates(0).find((p) => p.role !== 'GK');
  const receiver = m.mates(0).find((p) => p !== passer && p.role !== 'GK');
  for (const q of m.players) {
    if (q === passer || q === receiver) continue;
    q.x = -60; q.y = -60; q.vx = 0; q.vy = 0;
  }
  passer.x = 20; passer.y = 27; passer.vx = 0; passer.vy = 0;
  receiver.x = 40; receiver.y = 27; receiver.vx = 0; receiver.vy = 0;
  m.ball.x = passer.x; m.ball.y = passer.y; m.ball.z = 0; m.ball.vx = 0; m.ball.vy = 0; m.ball.vz = 0;
  m.setOwner(passer, true);
  m.setHumanPlayer(m.humans[0], passer);
  m.doPass(passer, 'ground', receiver, null);
  assert(m.pass && m.pass.receiver === receiver, 'pass targets the intended receiver');
  assert(m.humans[0].player === receiver, 'control switches to the intended receiver the moment the pass is played');
  return { m, passer, receiver };
}
test('receiver reaches a ground pass despite continuous sideways user input', () => {
  // stick held hard "sideways" (across the pass lane), never towards the ball
  const { m, receiver } = setupAssistScenario(stickCtrl(0, 1));
  let reached = false;
  for (let i = 0; i < 240 && !reached; i++) {
    m.update(1 / 60);
    if (m.owner === receiver) reached = true;
  }
  assert(reached, 'the AI-driven receiver must still get to the ball despite the sideways nudge');
});
test('a hard steer straight away from the ball only nudges the receiver, it does not send him free-roaming', () => {
  const { m, passer, receiver } = setupAssistScenario(stickCtrl(-1, 0));   // stick held back towards the passer
  let reached = false;
  for (let i = 0; i < 240 && !reached; i++) {
    m.update(1 / 60);
    if (m.owner === receiver) reached = true;
  }
  assert(reached, 'even steering back towards the passer must not stop him receiving it (~20-25% nudge, not full control)');
});
test('the assist ends the instant he receives the ball: pass state clears and full manual control resumes', () => {
  const { m, receiver } = setupAssistScenario(stickCtrl(0, 1));
  let reached = false;
  for (let i = 0; i < 240 && !reached; i++) { m.update(1 / 60); if (m.owner === receiver) reached = true; }
  assert(reached, 'setup must actually complete the pass');
  assert(m.pass === null, 'this.pass clears once the receiver has the ball');
  // with no more assist, a hard stick input now drives him fully (no AI blend towards an old intercept point)
  const ctrl = m.ctrls[0];
  ctrl.move = () => ({ x: -1, y: 0 });
  m.update(1 / 60);
  const sp = Math.hypot(receiver.want.x, receiver.want.y);
  assert(sp > 0.1, 'the receiver still moves under plain user control');
  assert(near(receiver.want.x / sp, -1, 1e-6) && near(receiver.want.y / sp, 0, 1e-6),
    'once he has the ball, his heading is exactly the stick direction, not blended with any leftover AI target');
});
test('switching player cancels the assist outright', () => {
  const { m, passer, receiver } = setupAssistScenario(stickCtrl(0, 0));
  m.update(1 / 60);
  const before = { x: receiver.x, y: receiver.y };
  // hand control to the passer instead (as pressing "switch" would)
  m.setHumanPlayer(m.humans[0], passer);
  assert(m.humans[0].player === passer, 'control moved off the receiver');
  // the receiver is no longer the controlled player, so the assist branch in updateHumans can
  // no longer drive him; only the (unrelated) team AI can move him now
  for (let i = 0; i < 30; i++) m.update(1 / 60);
  assert(m.humans[0].player === passer, 'switch is not reverted by the (former) assist');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
