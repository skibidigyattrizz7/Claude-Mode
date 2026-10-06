import assert from 'node:assert/strict';
import { createVinsonBattle, vinsonBoxThreatPath } from '../core/vinsonbattle.js';

const tick = (battle, dt = .05, input = {}) => battle.step(dt, input);
const start = (seed = 1, stage = 0, options = {}) => {
  const battle = createVinsonBattle({ seed, stage, ...options });
  tick(battle, 0, { advance: true });
  return battle;
};

// The warning path is the real vx/vy trajectory clipped to the arena, including
// waves emitted just outside the box and aimed pressure bullets.
{
  const box = { minX: 320, maxX: 960, minY: 300, maxY: 580 };
  for (const p of [
    { x: 978, y: 400, vx: -400, vy: 0, radius: 11 }, // off-box lane origin
    { x: 640, y: 292, vx: 0, vy: 250, radius: 10 }, // off-box vertical origin
    { x: 400, y: 350, vx: 170, vy: 170, radius: 8 },
    { x: 500, y: 310, vx: 30, vy: 220, radius: 7 }, // aimed pressure
    { x: 100, y: 100, vx: 0, vy: -10, radius: 7 }
  ]) {
    const path = vinsonBoxThreatPath(box, p);
    if (p.x === 100) { assert.equal(path, null); continue; }
    assert.ok(path, 'trajectory intersecting the box has a warning path');
    for (const [x, y] of [[path.x1, path.y1], [path.x2, path.y2]]) {
      assert.ok(x >= box.minX - 1e-8 && x <= box.maxX + 1e-8);
      assert.ok(y >= box.minY - 1e-8 && y <= box.maxY + 1e-8);
    }
    const vx = p.vx || 0, vy = p.vy || 0;
    assert.ok(Math.abs((path.x2 - path.x1) * vy - (path.y2 - path.y1) * vx) < 1e-5,
      'clipped warning remains collinear with the actual projectile trajectory');
    assert.equal(path.radius, p.radius);
  }
}

// Each seeded rotation gets through its attack deck in a bounded encounter;
// stage two's deck includes the cross sweep and hand catch.
for (const [stage, required] of [[0, ['handcatch']], [1, ['handcatch', 'eclipsecross']]]) {
  const battle = start(1515, stage);
  battle.state.hero.hp = 1e9;
  battle.state.attackTimer = .01;
  const picks = [];
  for (let i = 0; i < 500 && battle.state.time < 25; i++) {
    tick(battle);
    picks.push(...battle.state.events.filter(e => e.type === 'rotationPick').map(e => e.attack));
  }
  for (const type of required) assert.ok(picks.includes(type), `stage ${stage} rotation includes ${type}`);
  assert.ok(picks.length >= 10, `stage ${stage} produces a useful sample of seeded picks (${picks.length})`);
}

// Painring is centered on the hero's body when it spawns and pulls locally.
function painringAt(x, y) {
  const battle = start(2025, 0, { openingAttack: 'painring' });
  battle.state.attackTimer = .01;
  battle.state.hero.x = x; battle.state.hero.y = y;
  tick(battle);
  const hazard = battle.state.hazards.find(h => h.type === 'painring');
  assert.ok(hazard);
  assert.equal(hazard.x, x);
  assert.equal(hazard.y, y - battle.state.hero.bodyRise);
  return { battle, hazard };
}
{
  const { battle, hazard } = painringAt(400, 450);
  battle.state.hero.x += 45;
  hazard.elapsed = hazard.telegraph;
  const before = Math.hypot(battle.state.hero.x - hazard.x,
    battle.state.hero.y - battle.state.hero.bodyRise - hazard.y);
  tick(battle);
  const after = Math.hypot(battle.state.hero.x - hazard.x,
    battle.state.hero.y - battle.state.hero.bodyRise - hazard.y);
  assert.ok(after < before, `nearby player is pulled toward its local ring center (${before} -> ${after})`);
  hazard.elapsed = hazard.telegraph + hazard.duration - .01;
  tick(battle);
  assert.equal(battle.state.hazards.includes(hazard), false, 'painring expires after its finite lifetime');

  const far = painringAt(400, 450);
  far.battle.state.hero.x = 800;
  far.hazard.elapsed = far.hazard.telegraph;
  const x = far.battle.state.hero.x, y = far.battle.state.hero.y;
  tick(far.battle);
  assert.equal(far.battle.state.hero.x, x, 'players beyond local pull radius are unaffected');
  assert.equal(far.battle.state.hero.y, y);

  const other = painringAt(650, 500);
  assert.notEqual(other.hazard.x, hazard.x, 'independent spawns follow the current hero position');
  assert.notEqual(other.hazard.y, hazard.y);
}

// Combo uses three timed confirmations (start/C, slash, finish). One press
// after starting resolves a deliberately weaker partial hit and never hangs.
function resolveCombo(stage, presses) {
  const battle = start(3030 + stage, stage, { openingAttack: 'combo' });
  assert.ok(battle.state.comboOffer > 0);
  tick(battle, .01, { combo: true });
  assert.ok(battle.state.combo);
  assert.equal(battle.state.combo.presses, 1);
  for (let i = 0; i < 12 && battle.state.combo?.beat === 'windup'; i++) tick(battle);
  assert.equal(battle.state.combo.beat, 'slash');
  if (presses >= 2) tick(battle, .01, { combo: true });
  if (presses >= 3) {
    for (let i = 0; i < 10 && battle.state.combo?.beat === 'crosswind'; i++) tick(battle);
    assert.equal(battle.state.combo.beat, 'finish');
    tick(battle, .01, { combo: true });
  }
  for (let i = 0; i < 100 && battle.state.combo; i++) tick(battle);
  assert.equal(battle.state.combo, null, 'combo resolves or times out cleanly');
  return battle.state.events.find(e => e.type === 'hit' && e.weapon === 'combo')?.amount;
}
for (const [stage, full] of [[0, 210], [1, 330]]) {
  const partial = resolveCombo(stage, 2);
  const complete = resolveCombo(stage, 3);
  assert.ok(partial > 0 && partial < full, `one follow-up press resolves a partial combo (${partial}/${full})`);
  assert.equal(complete, full, `three total confirmations deliver full stage ${stage} damage`);
}

const held=createVinsonBattle({openingAttack:'combo'});held.step(0,{advance:true});held.state.thresholdIndex=4;held.state.attackTimer=99;held.state.hero.hp=1e6;const hp=held.state.boss.hp;for(let i=0;i<110;i++)held.step(.05,{combo:true});assert.ok(hp-held.state.boss.hp<210,'holding C cannot complete follow-up strikes');
console.log('Vinson threat15 path, deck, local pull and combo checks passed');
