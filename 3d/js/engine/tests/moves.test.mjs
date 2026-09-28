// Tests for: 500+ shooting (guaranteed top-corner curlers), power shot / finesse curve, goalkeeper dives (facing, get-up,
// dive shapes), and the extra skill moves. Runs standalone: node 3d/js/engine/tests/moves.test.mjs
import assert from 'node:assert/strict';
import * as THREE from '../../../vendor/three.module.min.js';
import { MatchSim, SKILL_KINDS, SKILL_INFO, SURE_MIN } from '../core/sim.js';
import { PHASE, GOAL, BALL_R, ANIM } from '../core/constants.js';
import { createBall, stepBall, predictBall, behindLine } from '../core/physics.js';
import { encodeSnapshot } from '../core/snapshot.js';
import { PlayerRig, decodeDive } from '../render/player.js';
import { EXTRA_BINDS, emptyInput } from '../ui/input.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

const DT = 1 / 120;

function mkSim({ attrs = {}, pd: extra = {}, seed = 1, keeper = null } = {}) {
  const home = structuredClone(BRAZIL);
  const pd = home.players[9];
  pd.attrs = { ...(pd.attrs || {}), ...attrs };
  Object.assign(pd, extra);
  const sim = new MatchSim({ home, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed });
  sim.step(DT, [null, null]);
  sim.phase = PHASE.PLAY; sim.sp.done = true; sim.dir = [1, -1];
  const p = sim.players[9];
  sim.players.forEach((q) => { if (q !== p && !q.isGK) sim._teleport(q, -50, -30); });
  const gk = sim.gk(1);
  Object.assign(gk.a, { div: 99, han: 99, ref: 99, spd: 99, pos: 99, ...(keeper || {}) });
  return { sim, p, gk };
}
function place(sim, p, x, z) {
  sim._teleport(sim.gk(1), 51.5, 0);
  sim._teleport(p, x, z); p.face = Math.atan2(-z, 52.5 - x);
  const b = sim.ball;
  b.owner = p.idx; b.inHands = false; b.p.x = x + Math.cos(p.face) * 0.45; b.p.z = z + Math.sin(p.face) * 0.45; b.p.y = BALL_R;
  b.v.x = b.v.y = b.v.z = 0; b.lastTeam = 0;
}
const runUntilDead = (sim, secs = 6) => { for (let t = 0; t < secs && sim.phase === PHASE.PLAY; t += DT) sim.step(DT, [null, null]); };
// the point where a struck ball crosses the goal line (centre) with the real physics
function crossing(sim, p, kind, o) {
  const plan = sim._plan(p, kind, o);
  const pr = predictBall({ p: { ...sim.ball.p }, v: plan.vel, w: plan.spin }, 6, 0.01);
  for (let i = 1; i < pr.length; i++) if (behindLine(pr[i], 1) > 0) return { z: pr[i].z, y: pr[i].y, plan };
  return { plan };
}

export function runMoveTests(test) {
  console.log('500+ shooting');
  test('500+ shooting tier: rawOvr / SHO of 500 or more, not 499; the Shawky is always in it', () => {
    assert.equal(mkSim({ pd: { rawOvr: SURE_MIN } }).p.sure, true);
    assert.equal(mkSim({ pd: { rawOvr: SURE_MIN - 1 } }).p.sure, false);
    assert.equal(mkSim({ attrs: { sho: 999 } }).p.sure, true);
    assert.equal(mkSim({}).p.sure, false);
    assert.equal(mkSim({ pd: { glitch: true } }).p.sure, true);
  });
  test('500+ shot: from his own half, a wide angle and a weak tap all score in a top corner against a 99 keeper', () => {
    const spots = [[-45, 0], [-30, 22], [-10, -25], [0, 0], [35, 28], [35, -28], [45, 22], [20, 5], [50, -15]];
    const kinds = ['shot', 'finesse', 'lowdriven', 'powershot', 'chip', 'trivela'];
    let n = 0, goals = 0, corners = 0;
    for (const [x, z] of spots) {
      for (const kind of kinds) {
        const { sim, p } = mkSim({ pd: { rawOvr: 999 }, seed: n + 1 });
        place(sim, p, x, z);
        sim.aiKick(p, kind, { tz: 0, ty: 0.2, power: 0.05 }); // a weak, badly aimed tap
        let cross = null;
        for (let t = 0; t < 6 && sim.phase === PHASE.PLAY; t += DT) {
          sim.step(DT, [null, null]);
          if (!cross && sim.ball.p.x > 52.5) cross = { z: sim.ball.p.z, y: sim.ball.p.y };
        }
        n++;
        if (sim.phase === PHASE.GOAL) goals++;
        // "top bin": high and wide inside the frame (the sharpest angles get the next-best corner)
        if (cross && cross.y > 1.5 && Math.abs(cross.z) > 1.5) corners++;
      }
    }
    assert.equal(goals, n, `scored ${goals}/${n}`);
    assert.ok(corners >= n * 0.9, `top corners ${corners}/${n}`);
  });
  test('500+ shot: the flight is a hard curler from the first frame, not a slow ball that speeds up', () => {
    const { sim, p } = mkSim({ pd: { rawOvr: 999 } });
    place(sim, p, -8, 14);
    sim.aiKick(p, 'shot', { tz: 0, ty: 0.3, power: 0.05 });
    const b = sim.ball, v0 = Math.hypot(b.v.x, b.v.y, b.v.z);
    assert.ok(v0 > 33, 'launch speed ' + v0);
    let prev = v0, z0 = b.p.z, sideMax = 0;
    for (let t = 0; t < 1.2; t += DT) {
      sim.step(DT, [null, null]);
      const s = Math.hypot(b.v.x, b.v.y, b.v.z);
      assert.ok(s <= prev + 0.05, 'ball must never speed up in flight');
      prev = s;
      sideMax = Math.max(sideMax, Math.abs(b.p.z - z0));
    }
    assert.ok(Math.abs(b.w.y) > 5, 'sidespin to curl the ball, w.y=' + b.w.y);
    assert.ok(b.p.x > -8 + 20, 'travelled hard');
  });
  test('500+ shot: nobody can block, head or intercept it in flight', () => {
    let goals = 0;
    for (let s = 0; s < 6; s++) {
      const { sim, p } = mkSim({ pd: { rawOvr: 999 }, seed: s + 3 });
      place(sim, p, 22, (s - 3) * 4);
      // defenders stood right on the line of the shot
      for (let k = 12; k < 21; k++) sim._teleport(sim.players[k], 30 + (k % 4), (s - 3) * 2 + (k % 3 - 1) * 1.5);
      sim.aiKick(p, 'shot', { tz: 0, ty: 0.3, power: 0.5 });
      runUntilDead(sim, 4);
      if (sim.phase === PHASE.GOAL) goals++;
    }
    assert.equal(goals, 6);
  });
  test('a 499 card (and a normal 99) still gets saved sometimes and misses from his own half', () => {
    let goals = 0;
    for (let s = 0; s < 8; s++) {
      const { sim, p } = mkSim({ pd: { rawOvr: 499 }, attrs: { sho: 99 }, seed: s + 1 });
      place(sim, p, -40, (s % 3 - 1) * 5);
      sim.aiKick(p, 'shot', { tz: 1, ty: 1, power: 0.5 });
      runUntilDead(sim, 5);
      if (sim.phase === PHASE.GOAL) goals++;
    }
    assert.ok(goals < 8, 'sub-500 card must not be guaranteed, scored ' + goals);
  });

  console.log('power shot / finesse');
  test('power shot is much faster and lower than a normal shot, and strays more for a low shooter', () => {
    const speed = (kind, sho) => { const { sim, p } = mkSim({ attrs: { sho } }); place(sim, p, 28, 4); const pl = sim._plan(p, kind, { tz: -2, ty: 1, power: 1 }); return Math.hypot(pl.vel.x, pl.vel.y, pl.vel.z); };
    assert.ok(speed('powershot', 80) > speed('shot', 80) * 1.2, `${speed('powershot', 80)} vs ${speed('shot', 80)}`);
    const peak = (kind) => { const { sim, p } = mkSim({ attrs: { sho: 80 } }); place(sim, p, 28, 4); const pl = sim._plan(p, kind, { tz: -2, ty: 3, power: 1 }); const pr = predictBall({ p: { ...sim.ball.p }, v: pl.vel, w: pl.spin }, 2, 0.02); return Math.max(...pr.map((q) => q.y)); };
    assert.ok(peak('powershot') < peak('shot'), 'power shot is driven low');
    const spread = (sho) => {
      let e = 0;
      for (let s = 0; s < 40; s++) {
        const { sim, p } = mkSim({ attrs: { sho }, seed: 100 + s });
        place(sim, p, 28, 0);
        const pl = sim._plan(p, 'powershot', { tz: 0, ty: 1, power: 1 });
        sim._execute(p, pl);
        e += Math.abs(Math.atan2(sim.ball.v.z, sim.ball.v.x));
      }
      return e / 40;
    };
    assert.ok(spread(55) > spread(92) * 1.3, `low SHO ${spread(55)} vs high ${spread(92)}`);
  });
  test('power shot: a longer back-swing than a normal timed shot, animated as WINDUP 2.x then KICK 2.5', () => {
    const { sim, p } = mkSim();
    place(sim, p, 28, 0);
    sim.gp[0].timedFinishing = true;
    sim._shootRelease(p, 'shot', { x: 1, z: 0 }, 0.8);
    const normal = sim.pendingShot[0].tc - sim.t; sim.pendingShot[0] = null;
    sim._shootRelease(p, 'powershot', { x: 1, z: 0 }, 0.8);
    const power = sim.pendingShot[0].tc - sim.t;
    assert.ok(power > normal * 1.8, `${power} vs ${normal}`);
    assert.ok(p.windup >= 2 && p.windup < 3);
    sim._updateAnims(); assert.equal(p.anim, ANIM.WINDUP);
    sim.pendingShot[0] = null; p.windup = 0;
    sim.aiKick(p, 'powershot', { tz: 0, ty: 1, power: 1 });
    assert.equal(p.act.pw, 2.5);
  });
  test('power modifier: the shoot + power input gives a power shot at any charge; finesse alone keeps its own animation code', () => {
    const NONE = { mx: 0, my: 0, aimX: 0, aimY: 0, sprint: false, pass: false, through: false, lob: false, shoot: false, finesse: false, switchP: false, tackle: false, skill: false, jockey: false, power: false };
    const { sim, p } = mkSim();
    sim.controllers = ['p1', 'ai']; sim.human = [true, false]; sim.ctrl[0] = p.idx;
    place(sim, p, 28, 0);
    sim.ctrl[0] = p.idx;
    const inp = (o) => ({ ...NONE, ...o });
    let last = null;
    const orig = sim._shootRelease.bind(sim);
    sim._shootRelease = (pp, kind, aim, power) => { last = { kind, power }; return orig(pp, kind, aim, power); };
    for (let i = 0; i < 6; i++) sim.step(DT, [inp({ shoot: true, power: true }), null]);
    sim.step(DT, [inp({}), null]);
    assert.ok(last && last.kind === 'powershot', JSON.stringify(last));
    assert.ok(p.windup === 0 || p.windup >= 1);
    assert.equal(EXTRA_BINDS.p1.power, 'KeyO'); assert.equal(EXTRA_BINDS.p2.power, 'Numpad9');
    assert.equal(emptyInput().power, false);
  });
  test('finesse: sidespin bends the ball progressively and it still ends on the far-post target', () => {
    for (const [x, z] of [[30, 12], [26, -16], [34, 6], [24, 0]]) {
      const { sim, p } = mkSim({ attrs: { sho: 82 } });
      place(sim, p, x, z);
      const tz = -(Math.sign(z) || 1) * 3.0;
      const plan = sim._plan(p, 'finesse', { tz, ty: 1.6, power: 0.85 });
      const b = createBall(); b.p = { ...sim.ball.p }; b.v = { ...plan.vel }; b.w = { ...plan.spin };
      const sx = b.p.x, sz = b.p.z, cx = 52.5 - sx, cz = tz - sz, cl = Math.hypot(cx, cz);
      const dev = [];
      let t = 0, hit = null;
      while (b.p.x < 52.5 && t < 4) { stepBall(b, DT); t += DT; if (Math.round(t / DT) % 12 === 0) dev.push(((b.p.x - sx) * cz - (b.p.z - sz) * cx) / cl); }
      hit = { z: b.p.z, y: b.p.y };
      const maxDev = Math.max(...dev.map(Math.abs));
      assert.ok(maxDev > 1.0, `visible bend ${maxDev.toFixed(2)} from (${x},${z})`);
      // smooth arc: the lateral offset changes monotonically up to its peak (no kinks)
      const pk = dev.map(Math.abs).indexOf(maxDev);
      for (let i = 1; i <= pk; i++) assert.ok(Math.abs(dev[i]) >= Math.abs(dev[i - 1]) - 0.02, 'monotone bend');
      assert.ok(Math.abs(hit.z - tz) < 0.6 && Math.abs(hit.y - 1.6) < 0.6, `ends at target ${JSON.stringify(hit)}`);
      // kick animation code = finesse (inside-foot curl)
      sim._execute(p, plan);
      assert.equal(p.act.pw, 1.5);
    }
  });

  console.log('goalkeeper dives');
  const diveScene = (shotFn) => {
    const { sim, p, gk } = mkSim({ seed: 7 });
    place(sim, p, 27, 5);
    shotFn(sim, p);
    return { sim, gk };
  };
  test('keeper turns to face the shooter and dives side-on; then lies, and gets up (getup act) instead of snapping up', () => {
    const { sim, gk } = diveScene((s, p) => { const pl = s._plan(p, 'finesse', { tz: -3, ty: 1.2, power: 0.75 }); s._release(p, pl.vel, pl.spin, pl.info); });
    let dive = null, sawGetUp = false, faceErr = null, animP = 0;
    for (let t = 0; t < 4; t += DT) {
      sim.step(DT, [null, null]);
      if (gk.act && gk.act.type === 'dive' && !dive) {
        dive = { ...gk.act };
        const toBall = Math.atan2(sim.ball.p.z - gk.z, sim.ball.p.x - gk.x);
        faceErr = Math.abs(Math.atan2(Math.sin(gk.face - toBall), Math.cos(gk.face - toBall)));
      }
      if (gk.act && gk.act.type === 'dive') animP = gk.animP;
      if (gk.act && gk.act.type === 'getup') sawGetUp = true;
      if (sawGetUp && !gk.act) break;
    }
    assert.ok(dive, 'keeper dived');
    assert.ok(faceErr < 0.05, 'faces the ball at take-off, err ' + faceErr);
    assert.ok(sawGetUp, 'get-up phase');
    assert.ok(dive.next && dive.next.type === 'getup');
    // dive flies along the goal line (lateral), not toward / away from the shooter
    assert.ok(Math.abs(dive.vz * dive.flight) > 0.1 && Math.abs(dive.vx) < Math.abs(dive.vz) * 2 + 3);
    // snapshot: the encoded dive parameters round-trip
    const d = decodeDive(animP);
    assert.ok(!d.legacy && d.side === dive.side && Math.abs(d.h - dive.h) < 0.02 && d.flight >= 0.24 && d.flight <= 0.52);
    const snap = encodeSnapshot(sim);
    const o = 11 * 7 - 0; assert.ok(Number.isFinite(snap.p[o + 5]));
  });
  test('low / mid / high saves come out as different dives (hand height + travel are carried in animP)', () => {
    const hs = [];
    for (const ty of [0.3, 1.1, 2.15]) {
      const { sim, gk } = diveScene((s, p) => { const pl = s._plan(p, 'finesse', { tz: -3, ty, power: 0.6 }); s._release(p, pl.vel, pl.spin, pl.info); });
      let d = null;
      for (let t = 0; t < 3 && !d; t += DT) { sim.step(DT, [null, null]); if (gk.act && gk.act.type === 'dive') d = decodeDive(gk.animP); }
      assert.ok(d, 'dived for ty ' + ty);
      hs.push(d.h);
    }
    assert.ok(hs[0] < hs[1] && hs[1] < hs[2], 'hand heights ' + hs.join(', '));
    assert.ok(hs[0] < 0.7 && hs[2] > 1.6, 'low is near the grass, high stretches: ' + hs.join(', '));
  });
  test('rig: every dive shape (low / mid / high / diagonal, legacy) and get-up stays finite; getting up ends upright', () => {
    const rig = Object.create(PlayerRig.prototype);
    Object.assign(rig, { leftFoot: false, seed: 0, face: 0, px: 0, pz: 0, turn: 0, headYaw: 0, cyc: 0, diveSide: 1 });
    const pose = new Float32Array(29);
    const ctx = { t: 1, ballX: 0, ballZ: 4, ballY: 1, scorer: 0, idx: 0 };
    for (const h of [0.2, 0.5, 1.0, 1.6, 2.2, 2.6]) for (const tb of [0, 1, 2, 3]) for (const fb of [0, 3]) {
      const pp = -(1 + h + 4 * (1 + tb + 4 * fb));
      for (let u = 0; u <= 1.9; u += 0.05) {
        rig._locomotion(pose, 0, 1, 0, 1); rig._oneShot(pose, ANIM.DIVE, u, pp, 0, ctx);
        assert.ok([...pose].every(Number.isFinite), `h${h} tb${tb} fb${fb} u${u}`);
      }
      // end of the get-up: standing height, no roll left
      const end = 0.24 + 0.09 * fb + 0.38 + 0.5;
      rig._locomotion(pose, 0, 1, 0, 1); rig._oneShot(pose, ANIM.DIVE, end + 0.02, pp, 0, ctx);
      assert.ok(Math.abs(pose[2]) < 0.05 && pose[0] > 0.85, `upright at the end: roll ${pose[2]} y ${pose[0]}`);
    }
  });
  test('keeper ready / set stance: set (shot on its way) is deeper than ready, and both face the ball', () => {
    const rig = Object.create(PlayerRig.prototype);
    Object.assign(rig, { leftFoot: false, seed: 0, face: 0, px: 0, pz: 0, turn: 0, headYaw: 0, cyc: 0 });
    const a = new Float32Array(29), b = new Float32Array(29);
    rig._oneShot(a, ANIM.GKREADY, 0, 0, 0, { t: 0 }); rig._oneShot(b, ANIM.GKREADY, 0, 1, 0, { t: 0 });
    assert.ok(b[22] > a[22] && b[6] > a[6], 'deeper knees and forward lean when set');
    const { sim, gk } = mkSim();
    place(sim, sim.players[9], 30, 10);
    for (let t = 0; t < 1.5; t += DT) sim.step(DT, [null, null]);
    const toBall = Math.atan2(sim.ball.p.z - gk.z, sim.ball.p.x - gk.x);
    assert.ok(Math.abs(Math.atan2(Math.sin(gk.face - toBall), Math.cos(gk.face - toBall))) < 0.6, 'faces the ball while shuffling');
  });

  console.log('skill moves');
  test('at least 4 new skill moves exist with stars, layers and animation indices below 10', () => {
    const fresh = ['dragback', 'croqueta', 'elastico', 'rainbow', 'fakeshot'];
    for (const k of fresh) { assert.ok(SKILL_KINDS.includes(k) && SKILL_INFO[k].stars >= 1 && SKILL_INFO[k].adv); }
    assert.equal(SKILL_KINDS.slice(0, 4).join(), 'stepover,roulette,ballroll,heel', 'old indices unchanged');
    assert.ok(SKILL_KINDS.length < 10);
  });
  const skillScene = (sm, pdExtra = {}) => {
    const { sim, p } = mkSim({ pd: { sm, ...pdExtra }, attrs: { dri: 90 } });
    sim._teleport(p, 20, 0); p.face = 0; p.vx = 3; p.vz = 0;
    const b = sim.ball; b.owner = p.idx; b.inHands = false; b.p.x = 20.45; b.p.z = 0; b.p.y = BALL_R; b.lastTeam = 0;
    return { sim, p };
  };
  const dirs = { fwd: { x: 1, z: 0 }, diag: { x: 0.707, z: 0.707 }, side: { x: 0, z: 1 }, back: { x: -1, z: 0 } };
  test('advanced layer: direction picks the move, star-gated (5 star gets all; a 2 star falls back to the basic move)', () => {
    const want = { none: 'fakeshot', fwd: 'rainbow', diag: 'elastico', side: 'croqueta', back: 'dragback' };
    for (const [name, kind] of Object.entries(want)) {
      const { sim, p } = skillScene(5);
      sim.doSkill(p, name === 'none' ? null : dirs[name], true);
      assert.equal(p.act && p.act.kind, kind, name);
      assert.equal(p.skillIdx, SKILL_KINDS.indexOf(kind));
    }
    const { sim, p } = skillScene(2);
    sim.doSkill(p, dirs.fwd, true);
    assert.equal(p.act.kind, 'heel', 'rainbow needs 5 stars');
    assert.ok(sim.fx.some((f) => f.k === 'skill' && !f.ok && f.need === 5));
    // basic layer keeps the old mapping
    const s3 = skillScene(5); s3.sim.doSkill(s3.p, dirs.back, false); assert.equal(s3.p.act.kind, 'roulette');
    const s4 = skillScene(5); s4.sim.doSkill(s4.p, null, false); assert.equal(s4.p.act.kind, 'stepover');
  });
  test('chaining: a second skill press right after the first switches to the advanced layer (touch double-tap)', () => {
    const { sim, p } = skillScene(5);
    sim.doSkill(p, dirs.back, false);
    assert.equal(p.act.kind, 'roulette');
    for (let i = 0; i < 40; i++) sim.step(DT, [null, null]); // ~0.33 s later
    const b = sim.ball; b.owner = p.idx; b.inHands = false;
    sim.doSkill(p, dirs.back, false);
    assert.equal(p.act.kind, 'dragback');
  });
  test('each new move has a real effect: drag back turns him round, elastico / croqueta / fake shot displace him and the ball, rainbow lifts the ball over', () => {
    const run = (kind, dir) => {
      const { sim, p } = skillScene(5);
      const opp = sim.players[17]; sim._teleport(opp, 23, 0.3); opp.face = Math.PI;
      sim.doSkill(p, dir, true);
      assert.equal(p.act.kind, kind);
      let maxY = 0, released = false, maxTurn = 0;
      const start = { x: p.x, z: p.z, face: p.face };
      for (let t = 0; t < 0.9; t += DT) {
        sim.step(DT, [null, null]); maxY = Math.max(maxY, sim.ball.p.y); if (sim.ball.owner < 0) released = true;
        maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(p.face - start.face), Math.cos(p.face - start.face))));
      }
      return { sim, p, opp, start, maxY, released, maxTurn };
    };
    let r = run('dragback', dirs.back);
    assert.ok(r.maxTurn > 2.5, 'turned ~180 degrees');
    r = run('croqueta', dirs.side);
    assert.ok(Math.abs(r.p.z - r.start.z) > 0.5, 'moved across');
    r = run('elastico', dirs.diag);
    assert.ok(Math.abs(r.p.z - r.start.z) > 0.3 && r.p.x > r.start.x + 0.8, 'jinked and went past');
    r = run('fakeshot', null);
    assert.ok(r.p.x > r.start.x + 0.3, 'steps past after the feint');
    r = run('rainbow', dirs.fwd);
    assert.ok(r.released && r.maxY > 2.2, 'ball flicked up and over, apex ' + r.maxY);
  });
  test('moves fool nearby defenders (they bite more with more stars) and stay deterministic', () => {
    const bites = (sm) => {
      let n = 0;
      for (let s = 0; s < 40; s++) {
        const { sim, p } = skillScene(sm);
        sim.rng = ((seed) => { let a = seed >>> 0; const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; f.gauss = () => 0; return f; })(s + 1);
        const o = sim.players[17]; sim._teleport(o, 22, 0.5);
        sim.doSkill(p, dirs.diag, true);
        if (o.fooledUntil > sim.t) n++;
      }
      return n;
    };
    assert.ok(bites(5) > 8, 'defenders bite ' + bites(5));
    assert.equal(bites(5), bites(5));
  });
  test('rig: all 9 skill animations and the finesse / power kick + windup poses are finite and distinct', () => {
    const rig = Object.create(PlayerRig.prototype);
    Object.assign(rig, { leftFoot: false, seed: 0, face: 0, px: 0, pz: 0, turn: 0, headYaw: 0, cyc: 0 });
    const ctx = { t: 1, ballX: 0, ballZ: 3, ballY: 0.1, scorer: 0, idx: 0 };
    const poses = new Set();
    for (let idx = 0; idx < SKILL_KINDS.length; idx++) for (const left of [0, 10]) {
      const a = new Float32Array(29);
      for (const u of [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.9]) { rig._locomotion(a, 0, 1, 0, 1); rig._oneShot(a, ANIM.SKILL, u, idx + left, 0, ctx); assert.ok([...a].every(Number.isFinite), `skill ${idx} ${u}`); }
      rig._locomotion(a, 0, 1, 0, 1); rig._oneShot(a, ANIM.SKILL, 0.3, idx, 0, ctx);
      poses.add([...a].map((v) => v.toFixed(2)).join());
    }
    assert.equal(poses.size, SKILL_KINDS.length, 'each move has its own pose');
    const kicks = [0.4, 1, 1.5, 2.5].map((pp) => { const a = new Float32Array(29); rig._locomotion(a, 0, 1, 0, 1); rig._oneShot(a, ANIM.KICK, 0.05, pp, 0, ctx); assert.ok([...a].every(Number.isFinite)); return [...a].map((v) => v.toFixed(2)).join(); });
    assert.equal(new Set(kicks).size, 4, 'pass / shot / finesse / power kicks differ');
    const wind = [0.6, 1.6, 2.6].map((pp) => { const a = new Float32Array(29); rig._locomotion(a, 0, 1, 0, 1); rig._oneShot(a, ANIM.WINDUP, 0.2, pp, 0, ctx); assert.ok([...a].every(Number.isFinite)); return [...a].map((v) => v.toFixed(2)).join(); });
    assert.equal(new Set(wind).size, 3, 'normal / finesse / power windups differ');
    void THREE;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let passed = 0, failed = 0;
  runMoveTests((name, fn) => {
    try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack)); }
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
