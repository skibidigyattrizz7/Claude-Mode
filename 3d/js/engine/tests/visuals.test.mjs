import assert from 'node:assert/strict';
import * as THREE from '../../../vendor/three.module.min.js';
import { createWeather } from '../render/weather.js';
import { REPLAY_CAMERAS, sampleReplay } from '../render/replay-cameras.js';
import { createCommentary, surnameOf } from '../audio/commentary.js';
import { PlayerRig, selectAnimationState } from '../render/player.js';
import { ANIM } from '../core/constants.js';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('ok', name); }
check('weather clear is free, precipitation is capped and cleanup idempotent', () => {
  for (const type of ['clear', 'rain', 'snow']) {
    const scene = new THREE.Scene(), existing = new THREE.Group(); scene.add(existing);
    const weather = createWeather(scene, { type, count: 10000 });
    assert.equal(weather.count, type === 'clear' ? 0 : 600);
    for (let i = 0; i < 100; i++) weather.update(i % 2 ? 1 / 60 : NaN);
    scene.traverse(o => { if (o.instanceMatrix) assert.ok([...o.instanceMatrix.array].every(Number.isFinite)); });
    weather.dispose(); weather.dispose(); weather.update(0.1);
    assert.deepEqual(scene.children, [existing]);
  }
});
check('replay paths interpolate, clamp time and do not mutate recordings', () => {
  const frames = [{ time: 0, ball: { x: 0, y: 1, z: 0 }, players: [{ x: -1, y: 0, z: 0 }] }, { time: 1, ball: { x: 12, y: 2, z: 4 }, players: [{ x: 3, y: 0, z: 0 }] }];
  const before = JSON.stringify(frames);
  assert.equal(sampleReplay(frames, 0.5).ball.x, 6);
  assert.equal(sampleReplay(frames, -1).ball.x, 0);
  assert.equal(sampleReplay(frames, 10).ball.x, 12);
  for (const camera of Object.values(REPLAY_CAMERAS)) for (const t of [-1, 0, 0.5, 1, 10]) {
    const result = camera(frames, t, { goalSign: -1 });
    assert.ok(Object.values(result).flatMap(Object.values).every(Number.isFinite));
    assert.ok(result.position.y > 0);
  }
  assert.equal(JSON.stringify(frames), before);
  assert.equal(sampleReplay([{t:0,b:[1,2,3],p:new Float32Array([4,5,0,0,0,0,0])}],0).scorer.z, 5);
});
check('commentary is silent without speech support', () => {
  const c = createCommentary({ volume: 1 });
  assert.equal(c.supported, false); assert.equal(c.onEvent({ type: 'goal' }), false); c.dispose(); c.dispose();
});
check('commentary surnames, mute, throttle and event aliases', () => {
  const lines = []; let cancelled = 0;
  globalThis.speechSynthesis = { speaking: false, speak(u) { lines.push(u); }, cancel() { cancelled++; } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  try {
    const c = createCommentary({ volume: 0.4 });
    assert.equal(surnameOf({ playerName: 'Mohamed Salah' }), 'Salah');
    assert.equal(c.onEvent({ type: 'goal', playerName: 'Mohamed Salah' }), true);
    assert.match(lines[0].text, /^Salah\./); assert.ok(!lines[0].text.includes('Mohamed'));
    assert.equal(lines[0].volume, 0.4);
    assert.equal(c.onEvent({ type: 'save' }), false);
    c.setMuted(true); assert.equal(c.onEvent({type:'goal'}), false); assert.equal(cancelled, 1);
    c.setMuted(false); c.setVolume(0); assert.equal(c.onEvent({type:'attack'}), false); c.dispose();
  } finally { delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; }
});
function rigStub() {
  const rig = Object.create(PlayerRig.prototype);
  Object.assign(rig, { leftFoot: false, seed: 0, face: 0, px: 0, pz: 0, turn: 0, headYaw: 0, cyc: 0 });
  return rig;
}
check('every pose stays finite across powers and timelines', () => {
  const rig = rigStub(), pose = new Float32Array(29);
  for (const anim of Object.values(ANIM)) for (const power of [-2, 0, 0.4, 1, 3]) for (const t of [0, .1, .25, .5, 1, 3]) {
    rig._locomotion(pose, 7, 1, 0, t);
    rig._oneShot(pose, anim, t, power, 7, { t, ballX: 0, ballZ: 3, scorer: 0, idx: 0 });
    assert.ok([...pose].every(Number.isFinite), `anim ${anim}`);
  }
});
check('sprint lean, kick power, header height, dive side and distinct celebrations', () => {
  const rig = rigStub(), a = new Float32Array(29), b = new Float32Array(29);
  const ctx = { t: 1, ballX: 0, ballZ: 4, scorer: 0, idx: 0 };
  rig._locomotion(a, 2, 1, 0, 1); rig._locomotion(b, 8, 1, 0, 1); assert.ok(b[1] > a[1]);
  rig._oneShot(a, ANIM.KICK, .1, 0, 0, ctx); rig._oneShot(b, ANIM.KICK, .1, 1, 0, ctx); assert.notEqual(a[24], b[24]);
  rig._oneShot(a, ANIM.HEAD, .3, .2, 0, ctx); rig._oneShot(b, ANIM.HEAD, .3, .8, 0, ctx); assert.ok(b[5] > a[5]);
  rig._oneShot(a, ANIM.DIVE, .3, 1.5, 0, ctx); rig._oneShot(b, ANIM.DIVE, .3, 1.5, 0, {...ctx,ballZ:-4}); assert.ok(a[2] * b[2] < 0);
  const poses = [0,1,2,3].map(kind => { rig.seed=2; rig._locomotion(a,0,1,0,1);rig._oneShot(a,ANIM.CELEB,1,kind,0,ctx);return [...a].join(','); });
  assert.equal(new Set(poses).size,4);
});
check('state selection prioritizes actions over braking and turns', () => {
  assert.equal(selectAnimationState(ANIM.RUN, 0), 'idle');
  assert.equal(selectAnimationState(ANIM.RUN, 3), 'jog');
  assert.equal(selectAnimationState(ANIM.RUN, 8), 'sprint');
  assert.equal(selectAnimationState(ANIM.RUN, 5, -8), 'brake');
  assert.equal(selectAnimationState(ANIM.RUN, 5, 0, 2), 'plant');
  assert.equal(selectAnimationState(ANIM.KICK, 5, -8, 2, .4), 'pass');
  assert.equal(selectAnimationState(ANIM.KICK, 5, -8, 2, 1), 'strike');
  for (const [code, state] of [[ANIM.WINDUP, 'windup'], [ANIM.HEAD, 'header'], [ANIM.SLIDE, 'slide'], [ANIM.DIVE, 'dive'], [ANIM.CELEB, 'celebrate']]) {
    assert.equal(selectAnimationState(code, 8, -8, 4), state);
  }
});
function updatingRig() {
  const rig = rigStub();
  Object.assign(rig, {pose: new Float32Array(29), target: new Float32Array(29), from: new Float32Array(29),
    root: new THREE.Group(), spd: 0, acceleration: 0, brake: 0, plant: 0, vx: 0, vz: 0,
    curAnim: -1, lastAnimT: 0, faceInit: false, blendT: 1, blendDur: .14, diveSide: 0});
  rig._setStand(); rig._apply = () => {};
  return rig;
}
check('release begins at contact, passing opens the foot, windup precedes release', () => {
  const rig = rigStub(), pose = new Float32Array(29), ctx = {t: 0};
  rig._locomotion(pose, 0, 1, 0, 0);
  rig._oneShot(pose, ANIM.WINDUP, .2, 1, 0, ctx);
  assert.ok(pose[24] > 0, 'leg behind body before release');
  rig._oneShot(pose, ANIM.KICK, 0, 1, 0, ctx);
  assert.ok(pose[24] < 0 && pose[27] < .2, 'extended leg at contact');
  const shotYaw = pose[25];
  rig._oneShot(pose, ANIM.KICK, 0, .4, 0, ctx);
  assert.ok(Math.abs(pose[25]) > Math.abs(shotYaw), 'inside-foot passing pose');
});
check('braking and turning settle continuously; pause does not advance pose', () => {
  const rig = updatingRig(); let x = 0;
  const ctx = {dt: 1/60, t: 0, ballX: 20, ballY: 0, ballZ: 20, idx: 0, scorer: -1};
  let braking = false, planting = false;
  for (let frame = 0; frame < 300; frame++) {
    const speed = frame < 150 ? 8 : 0;
    const face = frame < 100 ? 0 : Math.PI / 2;
    x += speed / 60; ctx.t += ctx.dt;
    const prev = [...rig.pose];
    rig.update(x, 0, face, ANIM.RUN, 0, 0, speed, ctx);
    braking ||= rig.visualState === 'brake'; planting ||= rig.visualState === 'plant';
    assert.ok([...rig.pose].every(Number.isFinite));
    assert.ok(Math.max(...rig.pose.map((v, i) => Math.abs(v - prev[i]))) < .6, 'no gait discontinuity');
  }
  assert.ok(braking && planting); assert.equal(rig.visualState, 'idle');
  const prev = [...rig.pose];
  rig.update(x, 0, Math.PI/2, ANIM.RUN, 0, 0, 0, {...ctx, dt:0});
  assert.deepEqual([...rig.pose], prev);
});
check('keeper commits to dive side through a deflection and varies height', () => {
  const rig = updatingRig(), ctx = {dt:1/60,t:0,ballX:0,ballZ:4,ballY:2};
  rig.update(0, 0, 0, ANIM.DIVE, 0, 3.2, 0, ctx);
  const side = rig.diveSide;
  rig.update(0, 0, 0, ANIM.DIVE, .3, 3.2, 0, {...ctx,ballZ:-4});
  assert.equal(rig.diveSide, side);
  const low = new Float32Array(29), high = new Float32Array(29);
  rig._oneShot(low, ANIM.DIVE, .3, 1.2, 0, ctx);
  rig._oneShot(high, ANIM.DIVE, .3, 3.2, 0, ctx);
  assert.ok(high[0] > low[0]);
});
check('somersault lands upright without an extra spin on state exit', () => {
  const rig = updatingRig(); rig.seed = 3;
  const ctx = {dt:1/60,t:0,ballX:10,ballY:0,ballZ:0,scorer:0,idx:0};
  for (let f = 0; f < 150; f++) {
    rig.update(0,0,0,ANIM.CELEB,f/60,0,0,{...ctx,t:f/60});
    assert.ok([...rig.pose].every(Number.isFinite));
    assert.ok(rig.target[0] >= .7, 'pelvis stays above ground');
  }
  assert.ok(Math.abs(rig.pose[1] + Math.PI * 2) < .001);
  rig.update(0,0,0,ANIM.RUN,0,0,0,{...ctx,t:2.5});
  assert.ok(Math.abs(rig.pose[1]) < .1, 'equivalent upright angle on recovery');
});
console.log(`${passed} visual/audio tests passed`);
