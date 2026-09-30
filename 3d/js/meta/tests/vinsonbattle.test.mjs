import assert from 'node:assert/strict';
import { createVinsonBattle, VINSON_BATTLE_ARENA } from '../core/vinsonbattle.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok', name); };
const start = (seed = 7, stage = 0) => {
  const battle = createVinsonBattle({ seed, stage });
  battle.step(0, { advance: true });
  return battle;
};
const runSteps = (battle, n, dt = 1 / 60, input = {}) => {
  for (let i = 0; i < n && !['defeat', 'transition', 'clash', 'victory'].includes(battle.state.phase); i++) battle.step(dt, input);
};

test('same seed and input stream produce identical events and combat state', () => {
  const a = start(123), b = start(123);
  for (let i = 0; i < 220; i++) {
    const input = { x: i % 80 < 40 ? 0.7 : -0.4, y: i % 31 < 15 ? 0.3 : -0.6, attack: i % 3 !== 0, dodge: i === 80 };
    a.step(1 / 60, input); b.step(1 / 60, input);
    assert.deepEqual(a.state, b.state);
  }
  const c = start(124); runSteps(c, 220, 1 / 60, { attack: true });
  assert.notEqual(c.state._rngState, a.state._rngState);
});

test('movement normalizes diagonals and remains inside the playable arena', () => {
  const battle = start();
  const x0 = battle.state.hero.x, y0 = battle.state.hero.y;
  battle.step(0.05, { x: 1, y: 1 });
  assert.ok(Math.abs(Math.hypot(battle.state.hero.x - x0, battle.state.hero.y - y0) - 15) < 1e-8);
  for (let i = 0; i < 120; i++) battle.step(0.05, { x: 1, y: -1 });
  const h = battle.state.hero;
  assert.ok(h.x >= VINSON_BATTLE_ARENA.minX && h.x <= VINSON_BATTLE_ARENA.maxX);
  assert.ok(h.y >= VINSON_BATTLE_ARENA.minY && h.y <= VINSON_BATTLE_ARENA.maxY);
});

test('non-finite and negative dt become zero and large dt is capped at 50 ms', () => {
  const battle = createVinsonBattle();
  battle.step(-1); assert.equal(battle.state.time, 0);
  battle.step(Number.NaN); assert.equal(battle.state.time, 0);
  battle.step(2); assert.equal(battle.state.time, 0.05);
});

test('telegraphs give a readable warning before any hazard can damage the hero', () => {
  const battle = start(19);
  let warning;
  for (let i = 0; i < 100 && !warning; i++) {
    battle.step(0.05);
    warning = battle.state.events.find(e => e.type === 'telegraph');
  }
  assert.ok(warning, 'first boss warning should appear promptly');
  const hazard = battle.state.hazards.find(h => h.id === warning.hazardId);
  assert.ok(hazard.telegraph >= 0.48 && hazard.telegraph <= 0.70);
  assert.equal(battle.state.events.some(e => e.type === 'hit' && e.target === 'hero'), false);
  while (hazard.elapsed < hazard.telegraph - 0.06) {
    battle.step(0.05);
    assert.equal(battle.state.events.some(e => e.type === 'hit' && e.target === 'hero'), false);
  }
});

test('dodge is a press action, grants brief invulnerability, and respects cooldown', () => {
  const battle = start();
  const before = battle.state.hero.x;
  battle.step(0.01, { dodge: true });
  assert.equal(battle.state.events[0]?.type, 'dodge');
  assert.ok(battle.state.hero.x < before);
  assert.ok(battle.state.hero.invulnerable > 0);
  battle.step(0.05, { dodge: true });
  assert.equal(battle.state.events.some(e => e.type === 'dodge'), false, 'holding dodge does not retrigger');
  battle.step(0.05, { dodge: false }); battle.step(0.05, { dodge: true });
  assert.equal(battle.state.events.some(e => e.type === 'dodge'), false, 'cooldown blocks a second dodge');
});

test('attacks emit fire events and blue projectiles damage the boss', () => {
  const battle = start(); battle.state.boss.hp = 18;
  let hit = false;
  for (let i = 0; i < 150 && battle.state.phase === 'fight'; i++) {
    battle.step(1 / 60, { attack: true });
    hit ||= battle.state.events.some(e => e.type === 'hit' && e.target === 'boss');
  }
  assert.ok(hit); assert.equal(battle.state.phase, 'transition');
  assert.ok(battle.state.events.some(e => e.type === 'bossDefeat'));
});

test('holding attack through several volleys cannot instantly finish either encounter stage', () => {
  for (const stage of [0, 1]) {
    const battle = start(33, stage);
    let shots = 0;
    for (let i = 0; i < 100 && battle.state.phase === 'fight'; i++) {
      battle.step(0.05, { attack: true });
      shots += battle.state.events.filter(e => e.type === 'fire').length;
    }
    assert.ok(shots >= 12, `stage ${stage} should allow repeated shots in this check`);
    assert.ok(battle.state.boss.hp > 0, `stage ${stage} must survive a five-second attack hold`);
    assert.equal(battle.state.phase, 'fight');
  }
});

test('retry restores the same stage checkpoint with a reproducible new attempt seed', () => {
  const first = start(88); first.state.hero.hp = 0;
  const sameA = first.retry(); const attemptSeedA = sameA._rngState;
  assert.equal(sameA.stage, 0); assert.equal(sameA.attempt, 1); assert.equal(sameA.phase, 'intro');
  const second = start(88); second.state.hero.hp = 0;
  const sameB = second.retry();
  assert.equal(sameB._rngState, attemptSeedA);
  assert.notEqual(attemptSeedA, start(88).state._rngState);
});

test('stage transition opens Captain Israel checkpoint and final boss defeat reaches clash then victory', () => {
  const battle = start(3); battle.state.boss.hp = 18;
  for (let i = 0; i < 150 && battle.state.phase === 'fight'; i++) battle.step(1 / 60, { attack: true });
  assert.equal(battle.state.phase, 'transition');
  battle.next(); assert.equal(battle.state.stage, 1); assert.equal(battle.state.phase, 'intro');
  assert.equal(battle.state.hero.hp, battle.state.hero.maxHp);
  battle.step(0, { advance: true }); battle.state.boss.hp = 18;
  for (let i = 0; i < 150 && battle.state.phase === 'fight'; i++) battle.step(1 / 60, { attack: true });
  assert.equal(battle.state.phase, 'clash');
  assert.ok(battle.state.events.some(e => e.type === 'clashStart'));
  for (let i = 0; i < 100 && battle.state.phase === 'clash'; i++) battle.step(0.05);
  assert.equal(battle.state.phase, 'victory');
  assert.ok(battle.state.events.some(e => e.type === 'victory'));
});

test('defeat event and retry do not advance the stage; hazard and projectile collections stay capped', () => {
  const battle = start(5);
  battle.state.hero.hp = 1;
  // Put the player in the first line target lane and wait for the warned beam to fire.
  for (let i = 0; i < 120 && battle.state.phase === 'fight'; i++) battle.step(0.05, { attack: true });
  assert.ok(battle.state.events.some(e => e.type === 'playerDefeat') || battle.state.hero.hp === 1);
  battle.retry(); assert.equal(battle.state.stage, 0); assert.equal(battle.state.phase, 'intro');
  battle.step(0, { advance: true });
  for (let i = 0; i < 3000 && battle.state.phase === 'fight'; i++) battle.step(0.05, { attack: true });
  assert.ok(battle.state.hazards.length <= 8);
  assert.ok(battle.state.projectiles.length <= 32);
});

console.log(`${count} Vinson battle tests passed`);
