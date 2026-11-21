import assert from 'node:assert/strict';
import { createVinsonBattle, vinsonAbilityStats } from '../core/vinsonbattle.js';

const tick = (battle, dt = .05, input = {}) => battle.step(dt, input);
const ready = (seed, stage = 0) => {
  const battle = createVinsonBattle({ seed, stage });
  tick(battle, 0, { advance: true });
  battle.state.hero.hp = 1e9;
  battle.state.boss.hp = battle.state.boss.maxHp = 1e9;
  return battle;
};

const abilityNames = ['star', 'spinner', 'explosive', 'eyes', 'constellation', 'nova'];
for (const stage of [0, 1]) {
  const stats = vinsonAbilityStats(stage);
  assert.deepEqual(Object.keys(stats), abilityNames, 'both fighters expose six shared ability slots');
  for (const [name, spec] of Object.entries(stats)) {
    assert.ok(spec.damage > 0 && spec.cooldown > 0, `${name} has positive base damage and cooldown`);
  }
}

// Weapon selection cannot reset a previous weapon's recharge timer.
{
  const battle = ready(111);
  tick(battle, .05, { attack: true, weapon: 'star' });
  const starCount = () => battle.state.projectiles.filter(p => p.type === 'star').length;
  assert.equal(starCount(), 1);
  battle.state.hero.attackCooldown = 0; // isolate the per-weapon cooldown from the shared input debounce
  tick(battle, .05, { attack: true, weapon: 'constellation' });
  assert.equal(battle.state.projectiles.filter(p => p.type === 'constellation').length, 6);
  battle.state.hero.attackCooldown = 0;
  tick(battle, .05, { attack: true, weapon: 'star' });
  assert.equal(starCount(), 1,
    'switching away and back does not bypass star recharge');
  for (let i = 0; i < 10; i++) tick(battle);
  battle.state.hero.attackCooldown = 0;
  tick(battle, .05, { attack: true, weapon: 'star' });
  assert.equal(starCount(), 2,
    'weapon becomes available after its recharge');
}

// Seeded damage varies per shot but stays inside the announced ±15% range.
for (const stage of [0, 1]) {
  const nominal = vinsonAbilityStats(stage);
  for (const [weapon, spec] of Object.entries(nominal)) {
    const damages = new Set();
    for (let seed = 1; seed <= 36; seed++) {
      const battle = ready(seed, stage);
      tick(battle, .05, { attack: true, weapon });
      const projectile = battle.state.projectiles[0];
      assert.ok(projectile, `${weapon} creates a projectile`);
      assert.ok(projectile.damage >= Math.floor(spec.damage * .85));
      assert.ok(projectile.damage <= Math.ceil(spec.damage * 1.15));
      damages.add(projectile.damage);
    }
    assert.ok(damages.size > 1, `${weapon} damage has seeded variation`);
  }
}

// The special Captain moves stay distinct from Patel's versions.
{
  for (const [weapon, effect] of [['constellation', 'starLattice'], ['nova', 'domainStar']]) {
    const captain = ready(32, 1);
    tick(captain, .05, { attack: true, weapon });
    const projectiles = captain.state.projectiles;
    assert.ok(projectiles.length >= (weapon === 'constellation' ? 6 : 1));
    assert.ok(projectiles.every(p => p.effect === effect));
    assert.ok(projectiles.every(p => p.charge > 0), `${effect} has a readable charge interval`);
  }
  const patel = ready(32, 0);
  tick(patel, .05, { attack: true, weapon: 'constellation' });
  assert.ok(patel.state.projectiles.every(p => p.effect === 'constellation'));
  const oldEffects = new Set(['eclipsecross', 'doomfall', 'gravitywell']);
  for (let seed = 1; seed <= 4; seed++) {
    const battle = ready(seed, 0);
    for (let i = 0; i < 1200; i++) tick(battle);
    assert.equal(battle.state.hazards.some(h => oldEffects.has(h.type)), false, 'Phonk-only hazards never enter Patel stage');
  }
}

// Repeated seeded attacks should exercise both aim error and the Phonk's active dodge.
{
  let sawMisfire = false, sawBossDodge = false;
  for (let seed = 1; seed <= 10 && !(sawMisfire && sawBossDodge); seed++) {
    const battle = ready(seed, 1);
    for (let i = 0; i < 560 && !(sawMisfire && sawBossDodge); i++) {
      tick(battle, .05, { attack: true, weapon: 'star' });
      sawMisfire ||= battle.state.events.some(e => e.type === 'aimError') || battle.state.projectiles.some(p => p.misfire);
      sawBossDodge ||= battle.state.events.some(e => e.type === 'bossDodge');
    }
  }
  assert.ok(sawMisfire, 'seeded attacks can produce a visible aim-error event');
  assert.ok(sawBossDodge, 'Phonk sometimes dodges an incoming shot when aim is not locked');
}

// New stage-two attacks expose enough warning and complete geometry for fair reads.
{
  const phonkOnly = new Set(['eclipsecross', 'doomfall', 'gravitywell']);
  const seen = new Map();
  for (let seed = 1; seed <= 8 && seen.size < phonkOnly.size; seed++) {
    const battle = ready(seed, 1);
    for (let i = 0; i < 1800 && seen.size < phonkOnly.size; i++) {
      tick(battle);
      for (const hazard of battle.state.hazards) {
        if (!phonkOnly.has(hazard.type)) continue;
        seen.set(hazard.type, hazard);
        assert.ok(hazard.telegraph >= .8, `${hazard.type} warning is at least 800 ms`);
        if (hazard.type === 'eclipsecross') {
          assert.equal(hazard.segments.length, 2);
          assert.ok(hazard.segments.every(s => [s.x1,s.y1,s.x2,s.y2].every(Number.isFinite)));
        }
        if (hazard.type === 'doomfall') {
          assert.equal(hazard.spots.length, 5);
          assert.deepEqual(hazard.spots.map(s => s.delay), [0,.25,.5,.75,1]);
        }
        if (hazard.type === 'gravitywell') {
          assert.ok(Number.isFinite(hazard.x) && Number.isFinite(hazard.y));
          assert.ok(hazard.duration >= 2);
        }
      }
    }
  }
  assert.deepEqual([...seen.keys()].sort(), [...phonkOnly].sort(), 'all three stage-two patterns appear from seeded runs');
}

console.log('Vinson prototype 12 balance tests passed');
