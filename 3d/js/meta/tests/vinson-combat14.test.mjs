import assert from 'node:assert/strict';
import { createVinsonBattle, startVinsonSequence, triggerVinsonCombo } from '../core/vinsonbattle.js';

const freshFight = (seed = 1414, stage = 0) => {
  const battle = createVinsonBattle({ seed, stage });
  battle.step(0, { advance: true });
  return battle;
};
const tap = (battle, key) => battle.step(.01, { sequenceKey: key });

// A seeded encounter has exactly one starting heal and repeats the sequence for the same seed.
{
  const a = freshFight(), b = freshFight();
  assert.equal(a.state.hero.heals, 1);
  assert.deepEqual(startVinsonSequence(a.state, 'inversion'), true);
  assert.deepEqual(startVinsonSequence(b.state, 'inversion'), true);
  assert.deepEqual(a.state.sequence, b.state.sequence);
  assert.equal(a.state.sequence.keys.length, 3);
  assert.ok(a.state.sequence.keys.every(key => ['q', 'e', 'r', 'f'].includes(key)));
}

// Correct ordered inputs release both sequence types; chains also pull until the final key.
for (const kind of ['inversion', 'chains']) {
  const battle = freshFight(1415);
  startVinsonSequence(battle.state, kind);
  const keys = [...battle.state.sequence.keys];
  for (const key of keys) tap(battle, key);
  assert.equal(battle.state.sequence, null, `${kind} ends after three ordered keys`);
  assert.ok(battle.state.events.some(event => event.type === 'sequenceEscape'));
}

// A wrong inversion key applies six seconds of reversed movement.
{
  const battle = freshFight(1416);
  startVinsonSequence(battle.state, 'inversion');
  const expected = battle.state.sequence.keys[0];
  tap(battle, expected === 'q' ? 'e' : 'q');
  assert.ok(battle.state.hero.invertedTime > 5.9);
  const x = battle.state.hero.x;
  battle.step(.05, { x: 1 });
  assert.ok(battle.state.hero.x < x, 'right input moves left while inverted');
}

// An unanswered inversion expires into the same movement penalty.
{
  const battle = freshFight(1417);
  startVinsonSequence(battle.state, 'inversion');
  for (let i = 0; i < 120 && battle.state.sequence; i++) battle.step(.05, {});
  assert.equal(battle.state.sequence, null);
  assert.ok(battle.state.hero.invertedTime > 5.9);
}

// Chains pull toward their recorded origin and wrong input deals the specified damage.
{
  const battle = freshFight(1418);
  startVinsonSequence(battle.state, 'chains');
  battle.state.hero.x = 300;
  const originX = battle.state.sequence.origin.x;
  battle.step(.05, {});
  assert.ok(Math.abs(battle.state.hero.x - originX) < Math.abs(300 - originX));
  const hp = battle.state.hero.hp;
  const first = battle.state.sequence.keys[0];
  tap(battle, first === 'q' ? 'e' : 'q');
  assert.equal(battle.state.hero.hp, hp - 8);
  assert.equal(battle.state.sequence.index, 0);
}

// Completing a dodge box adds a heal charge; box-hit markers use the hero's feet.
{
  const battle = freshFight(1419);
  battle.state.hero.heals = 1;
  battle.state.phase = 'dodgebox';
  battle.state.box = { minX: 320, maxX: 960, minY: 320, maxY: 580, heroRadius: 7,
    pattern: 'lanes', elapsed: 0, duration: .01, wave: 0, bullets: [], spawnTimer: 5,
    pressureTimer: 5, pressureWave: 0, preview: null };
  battle.step(.02, {});
  assert.equal(battle.state.hero.heals, 2);

  battle.state.phase = 'dodgebox';
  battle.state.box = { minX: 320, maxX: 960, minY: 320, maxY: 580, heroRadius: 7,
    pattern: 'lanes', elapsed: 0, duration: 9, wave: 0, bullets: [
      { x: battle.state.hero.x, y: battle.state.hero.y, vx: 0, vy: 0, radius: 8, age: .6, telegraph: .5 }
    ], spawnTimer: 5, pressureTimer: 5, pressureWave: 0, preview: null };
  battle.state.hero.invulnerable = 0;
  battle.step(.01, {});
  const hit = battle.state.events.find(event => event.type === 'hit' && event.source === 'box');
  assert.ok(hit);
  assert.equal(hit.x, battle.state.hero.x);
  assert.equal(hit.y, battle.state.hero.y);
}

// Combo offers gate a unique finisher, which consumes the offer and applies its stage damage.
for (const [stage, damage] of [[0, 210], [1, 330]]) {
  const battle = freshFight(1420 + stage, stage);
  assert.equal(triggerVinsonCombo(battle.state), false, 'no combo before an offer');
  battle.state.comboOffer = 5;
  assert.equal(triggerVinsonCombo(battle.state), true);
  assert.equal(battle.state.comboOffer, 0);
  assert.equal(triggerVinsonCombo(battle.state), false, 'offer is consumed and only one finisher can run');
  battle.state.thresholdIndex = 4;
  const hp = battle.state.boss.hp;
  for (let i = 0; i < 23 && battle.state.combo; i++) battle.step(.05, {});
  assert.equal(battle.state.boss.hp, hp - damage);
  assert.ok(battle.state.events.some(event => event.type === 'hit' && event.weapon === 'combo' && event.amount === damage));
}

console.log('Vinson combat14 sequence, healing, marker and combo regressions passed');
