import assert from 'node:assert/strict';
import { createVinsonBattle, VINSON_BATTLE_ARENA, battleEyePositions } from '../core/vinsonbattle.js';
import { vinsonSpriteFrame } from '../ui/vinsonbattle.js';
import { drawDodgeBox } from '../ui/vinsonfightfx.js';

const tick = (battle, input = {}) => battle.step(0.05, input);
const startBox = (seed, compact = false) => {
  const battle = createVinsonBattle({ seed, compact,difficulty:'hard' });
  battle.step(0, { advance: true });
  battle.state.hero.hp = 100000;
  battle.state.boss.hp = battle.state.boss.maxHp * .8 + 1;
  for (let i = 0; i < 300 && battle.state.phase !== 'dodgebox'; i++) tick(battle, { attack: true });
  assert.equal(battle.state.phase, 'dodgebox');
  return battle;
};

// The same seed and input stream must reproduce the mixed pressure field exactly.
{
  const a = startBox(12012), b = startBox(12012);
  for (let i = 0; i < 120 && a.state.phase === 'dodgebox'; i++) {
    const input = { x: i % 60 < 30 ? 1 : -1, y: i % 40 < 20 ? 1 : -1 };
    tick(a, input); tick(b, input);
    assert.deepEqual(a.state, b.state, 'pressure remains deterministic for a fixed seed and input');
    assert.ok(a.state.box.bullets.length <= 64, 'mixed bullets stay within the declared cap');
    for (const bullet of a.state.box.bullets) {
      assert.ok(Number.isFinite(bullet.x) && Number.isFinite(bullet.y));
      assert.ok(bullet.telegraph >= .55, 'all box shots give at least 550 ms warning');
      assert.ok(Number.isFinite(bullet.age) && bullet.age >= 0, 'shot age is tracked through activation');
    }
  }
}

// Aimed pressure should be announced before it becomes collidable and must not home after launch.
{
  const battle = startBox(8321);
  for (let i = 0; i < 100 && battle.state.phase === 'dodgebox'; i++) tick(battle, { x: i % 2 ? 1 : -1 });
  const shots = battle.state.box?.bullets ?? [];
  assert.ok(shots.length > 0, 'box produces a sustained projectile field');
  const aimed = shots.filter(p => p.kind === 'aimed');
  assert.ok(aimed.length > 0, 'independent aimed layer appears during the box');
  for (const shot of aimed) {
    assert.ok(shot.telegraph >= .45);
    assert.ok(Number.isFinite(shot.vx) && Number.isFinite(shot.vy));
    assert.ok(Number.isFinite(shot.target?.x) && Number.isFinite(shot.target?.y), 'shot stores its target snapshot');
    assert.equal(shot.homing, undefined, 'aimed shots do not opt into homing');
  }
  assert.ok(battle.state.box.pressureTimer >= 0, 'pressure scheduler exposes a bounded timer');
}

// Arena floor and Patel's reduced frame / eye anchors stay aligned with the 120 px fighter.
{
  assert.equal(VINSON_BATTLE_ARENA.minY, 230);
  const frame = vinsonSpriteFrame('patel', 1000, 1000);
  assert.equal(frame.height, 120);
  assert.equal(frame.width, 126);
  const eyes = battleEyePositions('patel', 500, 600);
  assert.ok(Math.abs(eyes[0].x - (500 - 7 * 120 / 175)) < .1);
  assert.ok(Math.abs(eyes[1].x - (500 + 7 * 120 / 175)) < .1);
  assert.ok(Math.abs(eyes[0].y - (600 - 117 * 120 / 175)) < .1);
  assert.equal(eyes[0].y, eyes[1].y);

  const arcs = [], translations = [], scales = [], styles = [];
  const ctx = new Proxy({}, { get(_target, key) {
    if (key === 'arc') return (x, y, radius) => arcs.push({ x, y, radius });
    if (key === 'translate') return (x, y) => translations.push({ x, y });
    if (key === 'scale') return (x, y) => scales.push({ x, y });
    return () => {};
  }, set(target, key, value) { target[key] = value; if (key === 'strokeStyle' || key === 'fillStyle') styles.push(value); return true; } });
  drawDodgeBox(ctx, { box: { minX: 320, maxX: 960, minY: 280, maxY: 640,
    duration: 10, elapsed: 1, bullets: [] }, hero: { x: 640, y: 450, invulnerable: 0 }, stage: 0 },
    {}, 0, () => {}, () => {});
  assert.ok(translations.some(p => p.x === 640 && p.y === 450), 'scaled source sprite is anchored at the hero feet');
  assert.ok(scales.some(p => p.x === .32 && p.y === .32), 'Patel is drawn smaller inside the box');
  assert.equal(arcs.some(a => a.x === 640 && a.y === 450), false, 'no circular ring covers the box hero');
  assert.equal(styles.includes('#42e0ff') || styles.includes('#6de8ff'), false, 'old blue hurtbox ring colors are absent');
}

// Hand slam instances identify their source hand so a combo can alternate sides.
{
  const battle = createVinsonBattle({ seed: 9281 });
  battle.step(0, { advance: true }); battle.state.hero.hp = 100000;
  let observed = false;
  for (let i = 0; i < 2400 && !observed; i++) {
    tick(battle);
    const slams = battle.state.hazards.filter(h => h.type === 'handslam');
    assert.ok(battle.state.hazards.length <= 8, 'simultaneous boss hazards respect overlap cap');
    observed ||= slams.some(h => h.handKey === 'left') && slams.some(h => h.handKey === 'right');
  }
  assert.ok(observed, 'boss can layer left- and right-hand slams');
}

console.log('Vinson prototype 12 pressure tests passed');

// Explicit preview opener is isolated to the first hazard; no hidden account state.
{
  const battle=createVinsonBattle({seed:1,openingAttack:'laserline'});
  battle.step(0,{advance:true});
  for(let i=0;i<20&&!battle.state.hazards.length;i++)tick(battle);
  assert.equal(battle.state.hazards[0].type,'laserline');
  assert.equal(battle.state._openingAttack,null);
  for(const ray of battle.state.hazards[0].segments)assert.ok([ray.x1,ray.y1,ray.x2,ray.y2].every(Number.isFinite));
}
