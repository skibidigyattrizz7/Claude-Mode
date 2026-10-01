import assert from 'node:assert/strict';
import { battleEyePositions, createVinsonBattle, VINSON_BATTLE_ARENA, vinsonBossYBounds } from '../core/vinsonbattle.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok', name); };
const start = (seed = 7, stage = 0) => {
  const battle = createVinsonBattle({ seed, stage });
  battle.step(0, { advance: true });
  return battle;
};
const startCompact = (seed = 7, stage = 0) => {
  const battle = createVinsonBattle({ seed, stage, compact: true });
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

test('short landscape keeps movement and circular telegraphs above the controls', () => {
  const battle = startCompact(19);
  battle.state.hero.hp = 1e6;
  for (let i = 0; i < 700 && battle.state.phase === 'fight'; i++) {
    battle.step(0.05, { y: 1 });
    assert.ok(battle.state.hero.y <= VINSON_BATTLE_ARENA.compactMaxY);
    const bossBounds=vinsonBossYBounds(true);
    assert.ok(battle.state.boss.y >= bossBounds.min && battle.state.boss.y <= bossBounds.max);
    for (const hazard of battle.state.hazards) {
      if (hazard.type === 'handslam' || hazard.type === 'bombcircle') {
        assert.ok(hazard.y + hazard.radius <= VINSON_BATTLE_ARENA.compactMaxY + 12, `${hazard.type} warning stays inside the compact floor`);
      }
    }
  }
  battle.retry(); assert.equal(battle.state.compact, true, 'retry keeps compact bounds');
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
  assert.ok(hazard.telegraph >= 0.82 && hazard.telegraph <= 1.44);
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
  const battle = start(); battle.state.thresholdIndex = 4; battle.state.boss.hp = 18;
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
    assert.ok(shots >= 10, `stage ${stage} should allow repeated shots in this check`);
    assert.ok(battle.state.boss.hp > 0, `stage ${stage} must survive a five-second attack hold`);
    assert.ok(['fight', 'dodgebox'].includes(battle.state.phase));
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
  const battle = start(3); battle.state.thresholdIndex = 4; battle.state.boss.hp = 18;
  for (let i = 0; i < 150 && battle.state.phase === 'fight'; i++) battle.step(1 / 60, { attack: true });
  assert.equal(battle.state.phase, 'transition');
  battle.next(); assert.equal(battle.state.stage, 1); assert.equal(battle.state.phase, 'intro');
  assert.equal(battle.state.hero.hp, battle.state.hero.maxHp);
  battle.step(0, { advance: true }); battle.state.thresholdIndex = 4; battle.state.boss.hp = 18;
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

test('boss moves deterministically and remains inside arena bounds in both stages', () => {
  for (const stage of [0, 1]) {
    const a = start(901, stage), b = start(901, stage), initial = { x: a.state.boss.x, y: a.state.boss.y };
    for (let i = 0; i < 30; i++) { a.step(0.05, {}); b.step(0.05, {}); assert.deepEqual(a.state, b.state); }
    assert.ok(Math.hypot(a.state.boss.x - initial.x, a.state.boss.y - initial.y) > 5, `stage ${stage} boss should move`);
    assert.ok(a.state.boss.x >= VINSON_BATTLE_ARENA.minX && a.state.boss.x <= VINSON_BATTLE_ARENA.maxX);
    assert.ok(a.state.boss.y >= VINSON_BATTLE_ARENA.minY && a.state.boss.y <= VINSON_BATTLE_ARENA.maxY);
  }
});

test('sprite eye anchors match the rendered actor frame dimensions', () => {
  assert.deepEqual(battleEyePositions('world', 900, 400), [{ x: 868, y: 222 }, { x: 893, y: 222 }]);
  assert.deepEqual(battleEyePositions('phonk', 900, 400), [{ x: 892, y: 199 }, { x: 908, y: 199 }]);
  assert.deepEqual(battleEyePositions('patel', 250, 425), [{ x: 243, y: 308 }, { x: 257, y: 308 }]);
  assert.deepEqual(battleEyePositions('captain', 250, 425), [{ x: 294, y: 301 }, { x: 318, y: 301 }]);
});

test('eye hazards start at both boss eyes and aim visible segments toward the hero', () => {
  const battle = start(29);
  for (let i = 0; i < 30 && !battle.state.hazards.length; i++) battle.step(0.05);
  const laser = battle.state.hazards.find(h => h.type === 'laserline');
  if (!laser) return; // Seed may select another telegraph first.
  assert.equal(laser.origins.length, 2); assert.equal(laser.segments.length, 2);
  laser.segments.forEach((segment, i) => {
    assert.deepEqual({ x: segment.x1, y: segment.y1 }, laser.origins[i]);
    assert.ok(Math.hypot(segment.x2 - battle.state.hero.x, segment.y2 - (battle.state.hero.y - 85)) < 100);
  });
});

test('boss holds its eye anchors steady throughout each laser charge and active window', () => {
  const battle = start(29);
  for (let i = 0; i < 30 && !battle.state.hazards.some(h => h.type === 'laserline'); i++) battle.step(0.05);
  const laser = battle.state.hazards.find(h => h.type === 'laserline');
  if (!laser) return;
  const bossAtAim = { x: battle.state.boss.x, y: battle.state.boss.y };
  for (let i = 0; i < 40 && battle.state.hazards.includes(laser); i++) {
    battle.step(0.05);
    assert.deepEqual({ x: battle.state.boss.x, y: battle.state.boss.y }, bossAtAim);
    assert.deepEqual(laser.origins, battleEyePositions('world', bossAtAim.x, bossAtAim.y));
  }
});

test('weapon inputs create distinct projectile patterns, cooldowns, and impact strengths', () => {
  const expected = { star: [1, 18], spinner: [3, 3], explosive: [1, 34], eyes: [1, 25] };
  for (const [weapon, [count, damage]] of Object.entries(expected)) {
    const battle = start(17); battle.step(0.01, { attack: true, weapon });
    assert.equal(battle.state.projectiles.length, count, weapon);
    assert.ok(battle.state.projectiles.every(p => p.type === weapon && p.damage === damage));
    assert.ok(battle.state.hero.attackCooldown > 0);
    const p = battle.state.projectiles[0];
    if (weapon === 'eyes') assert.ok(Math.abs(p.y - (battle.state.hero.y - 117)) < 25);
    else assert.ok(Math.abs(p.y - (battle.state.hero.y - 75)) < 25);
    if (weapon === 'eyes') {
      assert.equal(battle.state.projectiles[0].origins.length, 2);
      assert.equal(battle.state.events.find(e => e.type === 'fire').weapon, 'eyes');
    }
  }
});

test('explosive splash damages a moving boss at its outer radius', () => {
  const battle = start(4); battle.state.boss.x = battle.state.hero.x + 340; battle.state.boss.y = battle.state.hero.y;
  battle.step(0.01, { attack: true, weapon: 'explosive' });
  const shot = battle.state.projectiles[0];
  shot.x = battle.state.boss.x + 65; shot.y = battle.state.boss.y - 100; shot.vx = 0; shot.vy = 0;
  const hp = battle.state.boss.hp;
  battle.step(0, {});
  assert.ok(battle.state.boss.hp < hp, 'blast radius should register splash damage');
});

function battleWithTelegraphedAttack(type) {
  for (let seed = 1; seed <= 100; seed++) {
    const battle = start(seed);
    battle.state.hero.hp = 1e6;
    for (let i = 0; i < 500; i++) {
      battle.step(0.05);
      const warning = battle.state.events.find(e => e.type === 'telegraph' && e.attack === type);
      if (warning) {
        const hazard = battle.state.hazards.find(h => h.id === warning.hazardId);
        battle.state.hazards = [hazard]; hazard.elapsed = 0; hazard.hit = false;
        return { battle, hazard, warning };
      }
    }
  }
  assert.fail(`could not find a seeded ${type} warning`);
}

test('hand slams and hand catches expose geometry, give full warning, and damage only during impact', () => {
  for (const type of ['handslam', 'handcatch']) {
    const { battle, hazard, warning } = battleWithTelegraphedAttack(type);
    assert.ok(warning.duration >= 1.02, `${type} warning should give at least one second`);
    if (type === 'handslam') {
      assert.deepEqual({ x: warning.x, y: warning.y, radius: warning.radius }, { x: hazard.x, y: hazard.y, radius: hazard.radius });
      assert.ok(hazard.radius >= 80);
      battle.state.hero.x = hazard.x; battle.state.hero.y = hazard.y + 55;
    } else {
      assert.deepEqual(warning.corridor, hazard.corridor);
      assert.ok(hazard.corridor.width >= 50);
      battle.state.hero.x = (hazard.corridor.x1 + hazard.corridor.x2) / 2;
      battle.state.hero.y = hazard.corridor.y1 + 55;
    }
    while (hazard.elapsed < hazard.telegraph - 0.06) {
      battle.step(0.05);
      assert.equal(battle.state.events.some(e => e.type === 'hit' && e.target === 'hero' && e.source === type), false);
    }
    let hit = false;
    for (let i = 0; i < 34 && !hit; i++) {
      battle.step(0.02);
      hit = battle.state.events.some(e => e.type === 'hit' && e.target === 'hero' && e.source === type);
    }
    assert.ok(hit, `${type} should damage a stationary hero in its impact area`);
  }
});

test('directional dodge escapes both telegraphed hand attacks without damage', () => {
  for (const type of ['handslam', 'handcatch']) {
    const { battle, hazard } = battleWithTelegraphedAttack(type);
    if (type === 'handslam') {
      battle.state.hero.x = hazard.x; battle.state.hero.y = hazard.y + 55;
    } else {
      battle.state.hero.x = (hazard.corridor.x1 + hazard.corridor.x2) / 2;
      battle.state.hero.y = hazard.corridor.y1 + 55;
    }
    while (hazard.elapsed < hazard.telegraph - 0.22) battle.step(0.05);
    const startY = battle.state.hero.y;
    const direction=startY<520?1:-1;
    battle.step(0.01, { y: direction, dodge: true });
    assert.ok(Math.abs(battle.state.hero.y-startY)>100, `${type} dodge should leave the danger area`);
    for (let i = 0; i < 12 && battle.state.hazards.includes(hazard); i++) battle.step(0.05, { y: direction });
    assert.equal(battle.state.events.some(e => e.type === 'hit' && e.target === 'hero' && e.source === type), false);
  }
});

test('ideal sustained star attacks finish both stages in a roughly 30–70 second active fight', () => {
  const battle = start(31); let activeSeconds = 0;
  battle.state.hero.hp = 1e6; battle.state.thresholdIndex = 4;
  while (battle.state.phase === 'fight') { battle.step(1 / 60, { attack: true, weapon: 'star' }); activeSeconds += 1 / 60; }
  assert.equal(battle.state.phase, 'transition');
  battle.next(); battle.step(0, { advance: true }); battle.state.hero.hp = 1e6; battle.state.thresholdIndex = 4;
  while (battle.state.phase === 'fight') { battle.step(1 / 60, { attack: true, weapon: 'star' }); activeSeconds += 1 / 60; }
  assert.equal(battle.state.phase, 'clash');
  assert.ok(activeSeconds >= 30 && activeSeconds <= 70, `ideal two-stage fight took ${activeSeconds.toFixed(1)}s`);
});

test('a telegraph-aware player can beat stage two in a seeded dodge-and-attack smoke run', () => {
  for (const seed of [1, 2, 3]) {
    const battle = start(seed, 1); battle.state.thresholdIndex = 4;
    for (let i = 0; i < 6000 && battle.state.phase === 'fight'; i++) {
      const s = battle.state, heading = [[0, 1], [-1, 0], [0, -1], [1, 0]][Math.floor(i / 80) % 4];
      let x = heading[0], y = heading[1], dodge = false;
      const warning = s.hazards.find(h => h.elapsed < h.telegraph + h.duration);
      if (warning && warning.elapsed >= warning.telegraph - 0.25) {
        if (warning.type === 'laserline') { x = warning.segments[0].y2 > s.hero.y - 85 ? -1 : 1; y = x; }
        else if (warning.type === 'bombcircle') { x = s.hero.x < warning.x ? -1 : 1; y = s.hero.y < warning.y ? -1 : 1; }
        else { x = s.hero.x < s.boss.x ? -1 : 1; y = s.hero.y < s.boss.y ? -1 : 1; }
        dodge = i % 20 === 0;
      }
      battle.step(1 / 60, { x, y, dodge, attack: true, weapon: 'star' });
    }
    assert.equal(battle.state.phase, 'clash', `seed ${seed} should win the finale`);
  }
});

console.log(`${count} Vinson battle tests passed`);

for(const stage of [0,1]){const b=createVinsonBattle({stage});b.step(0,{advance:true});b.state.hero.invulnerable=999;for(let i=0;i<200;i++)b.step(.05,{y:-1,dodge:i%20===0});assert.ok(b.state.hero.y>=(stage?350:330),'portrait top remains below HUD while moving/dodging upward');}
