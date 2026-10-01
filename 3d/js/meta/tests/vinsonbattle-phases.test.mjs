import assert from 'node:assert/strict';
import { createVinsonBattle, vinsonEarthPosition, VINSON_BATTLE_ARENA } from '../core/vinsonbattle.js';

const start = (seed = 7, stage = 0, compact = false) => {
  const battle = createVinsonBattle({ seed, stage, compact });
  battle.step(0, { advance: true }); battle.state.hero.hp = 100000;
  return battle;
};
const tick = (battle, input = {}) => battle.step(0.05, input);
const until = (battle, phase, input = {}, limit = 3000) => {
  for (let i = 0; i < limit && battle.state.phase !== phase; i++) tick(battle, input);
  assert.equal(battle.state.phase, phase);
};

for (const stage of [0, 1]) {
  const battle = start(91, stage);
  assert.equal(battle.state.phase, 'fight');
  assert.equal(battle.state.hero.heals, 3);
  for (let threshold = 1; threshold <= 4; threshold++) {
    // A lethal hit cannot skip a threshold.
    battle.state.boss.hp = battle.state.boss.maxHp * (1 - threshold * .2) + 1;
    until(battle, 'dodgebox', { attack: true });
    const box = battle.state.box;
    assert.equal(battle.state.boss.hp, battle.state.boss.maxHp * (1 - threshold * .2));
    assert.ok(box.duration >= 8 && box.duration <= 12);
    assert.equal(box.pattern, ['lanes', 'vertical', 'radial', 'beams'][threshold - 1]);
    assert.equal(box.heroRadius, 7);
    assert.ok(box.minX < box.maxX && box.minY < box.maxY);
    const hp = battle.state.boss.hp;
    let sawBullets = false;
    for (let i = 0; i < 300 && battle.state.phase === 'dodgebox'; i++) {
      tick(battle, { attack: true, x: 1 });
      assert.ok(battle.state.box?.bullets.length <= 64 || battle.state.phase === 'timing');
      assert.equal(battle.state.boss.hp, hp, 'attack is disabled in box');
      sawBullets ||= !!battle.state.box?.bullets.length;
      if (battle.state.box?.preview) assert.ok(battle.state.box.preview.remaining <= .35);
    }
    assert.ok(sawBullets);
    assert.equal(battle.state.phase, 'timing');
    assert.equal(battle.state.box, null);
    // Let every strike time out to test both dodge and recovery without input.
    until(battle, 'fight');
    assert.equal(battle.state.timing.resolved, true);
    assert.equal(battle.state.timing.score, 'timeout');
    assert.equal(battle.state.thresholdIndex, threshold);
  }
  battle.state.boss.hp = 1;
  until(battle, stage ? 'clash' : 'transition', { attack: true });
  assert.ok(battle.state.events.some(e => e.type === 'bossDefeat'));
  if (!stage) {
    const frozen = structuredClone(battle.state);
    tick(battle, { attack: true }); assert.deepEqual(battle.state, frozen);
  } else {
    until(battle, 'victory');
    const frozen = structuredClone(battle.state);
    tick(battle, { attack: true }); assert.deepEqual(battle.state, frozen);
  }
}

{
  const battle = start(31);
  battle.state.hero.hp = 30;
  tick(battle, { heal: true });
  assert.equal(battle.state.hero.hp, 62); assert.equal(battle.state.hero.heals, 2);
  for (let i = 0; i < 40; i++) tick(battle, { heal: true });
  assert.equal(battle.state.hero.heals, 2, 'holding heal never repeats');
  tick(battle, { heal: false }); tick(battle, { heal: true });
  assert.equal(battle.state.hero.heals, 1);
  battle.retry(); assert.equal(battle.state.hero.heals, 3);
}

{
  const a = start(4, 1, true), b = start(4, 1, true);
  let sawLance=false;
  for (let i = 0; i < 25; i++) { tick(a, { attack: true, weapon: 'eyes' }); tick(b, { attack: true, weapon: 'eyes' }); sawLance ||= a.state.events.some(e=>e.type==='fire'&&e.weapon==='eyes');assert.deepEqual(a.state, b.state); }
  assert.equal(VINSON_BATTLE_ARENA.minY, 280);
  assert.ok(a.state.hero.y >= 350);
  const lance = a.state.projectiles.find(p => p.effect === 'chargedEyeLance');
  assert.ok(lance || sawLance);
}

{
  const battle = start(88);
  battle.state.boss.hp = battle.state.boss.maxHp * .8 + 1;
  until(battle, 'dodgebox', { attack: true });
  until(battle, 'timing');
  for (let i = 0; i < 7; i++) tick(battle);
  const marker = battle.state.timing.marker;
  assert.ok(Math.abs(marker - .5) < .07);
  tick(battle, { attack: true });
  assert.equal(battle.state.phase, 'timing');
  assert.equal(battle.state.timing.resolved, true);
  assert.equal(battle.state.timing.score, 'perfect');
  assert.ok(Number.isFinite(battle.state.timing.resolvedAt));
  assert.ok(battle.state.events.some(e => e.type === 'timingResult'));
  for (let i = 0; i < 8; i++) tick(battle);
  assert.equal(battle.state.phase, 'timing', 'result remains visible for a beat');
  assert.ok(['hit', 'dodged'].includes(battle.state.timing.result));
  until(battle, 'fight');
}

{
  let earth;
  for (let seed = 1; seed < 60 && !earth; seed++) {
    const battle = start(seed);
    for (let i = 0; i < 600 && battle.state.phase === 'fight'; i++) {
      tick(battle);
      earth = battle.state.hazards.find(h => h.type === 'earththrow');
      if (earth) {
        assert.ok(earth.telegraph >= .9);
        assert.ok(earth.handSources.length === 2);
        assert.equal(earth.source.x,battle.state.boss.x-9);assert.equal(earth.source.y,battle.state.boss.y-94);
        assert.ok(earth.target.x >= VINSON_BATTLE_ARENA.minX);
        assert.ok(earth.target.y >= VINSON_BATTLE_ARENA.minY);
        assert.equal(battle.state.events.some(e => e.type === 'hit' && e.source === 'earththrow'), false);
        break;
      }
    }
  }
  assert.ok(earth, 'seeded earth throw should spawn');
}

console.log('Vinson phase tests passed');

{
  const h={source:{x:981,y:331},target:{x:300,y:430},telegraph:1.2,duration:.7};
  const before=vinsonEarthPosition({...h,elapsed:1.2-1e-6}),after=vinsonEarthPosition({...h,elapsed:1.2+1e-6});
  assert.ok(Math.hypot(before.x-after.x,before.y-after.y)<.01,'Earth launch is continuous after its lift');
  assert.deepEqual(vinsonEarthPosition({...h,elapsed:0}),h.source,'Earth starts at source globe');
  const landed=vinsonEarthPosition({...h,elapsed:h.telegraph+h.duration});
  assert.ok(Math.hypot(landed.x-h.target.x,landed.y-h.target.y)<1e-9,'draw/collision arc lands at exact target');
}
