import assert from 'node:assert/strict';
import { createVinsonBattle, vinsonBoxSafeRect, vinsonBoxMarkerWave } from '../core/vinsonbattle.js';
import { createVinsonClash, stepVinsonClash } from '../core/vinsonclash.js';

const tick = (battle, dt = .05, input = {}) => battle.step(dt, input);
const ready = (opts = {}) => {
  const battle = createVinsonBattle(opts);
  tick(battle, 0, { advance: true });
  battle.state.hero.hp = 1e9;
  return battle;
};

// Difficulty is opt-in, determines gate count and boss health, and survives lifecycle resets.
{
  const omitted = ready(), normal = ready({ difficulty: 'normal' }), hard = ready({ difficulty: 'hard' });
  assert.equal(omitted.state.difficulty, 'normal');
  assert.deepEqual(omitted.state.gates, normal.state.gates);
  assert.equal(normal.state.gates.length, 4);
  assert.equal(hard.state.gates.length, 6);
  assert.equal(hard.state.boss.maxHp, normal.state.boss.maxHp * 1.35);
  hard.retry();
  assert.equal(hard.state.difficulty, 'hard');
  assert.equal(hard.state.gates.length, 6);
  const transition = ready({ difficulty: 'hard' });
  transition.state.phase = 'transition';
  transition.next();
  assert.equal(transition.state.stage, 1);
  assert.equal(transition.state.difficulty, 'hard');
  assert.equal(transition.state.gates.length, 6);
}

// A periodic box is a bonus event; its timing timeout does not advance an HP gate.
for (const [difficulty, seconds] of [['normal', 35], ['hard', 20]]) {
  const battle = ready({ seed: 1515, difficulty });
  battle.state.thresholdIndex = 1;
  battle.state.boxClock = seconds - .01;
  tick(battle);
  assert.equal(battle.state.phase, 'dodgebox', `${difficulty} bonus box starts on schedule`);
  assert.equal(battle.state.box.bonus, true);
  assert.equal(battle.state.thresholdIndex, 1);
  battle.state.box.elapsed = battle.state.box.duration;
  tick(battle);
  assert.equal(battle.state.phase, 'timing');
  assert.equal(battle.state.timing.bonus, true);
  for (let i = 0; i < 90 && battle.state.phase === 'timing'; i++) tick(battle);
  assert.equal(battle.state.phase, 'fight');
  assert.equal(battle.state.thresholdIndex, 1, 'bonus timing timeout leaves the HP gate untouched');
}

// Normal boxes expose a safe rectangle for each actual pattern and retain prototype13 aimed fans.
// Hard preserves fans, shortens main-wave cadence, and remains seeded/deterministic.
for (const pattern of ['lanes', 'vertical', 'radial', 'beams']) {
  const normal = ready({ seed: 715, openingAttack: 'box', boxPattern: pattern });
  const hard = ready({ seed: 715, difficulty: 'hard', openingAttack: 'box', boxPattern: pattern });
  normal.state.hero.invulnerable = 1e6;
  hard.state.hero.invulnerable = 1e6;
  assert.equal(normal.state.phase, 'dodgebox');
  assert.equal(hard.state.phase, 'dodgebox');
  let sawRect = false, sawFan = false, sawNormalFan=false, firstNormalWave = null, firstHardWave = null;
  for (let i = 0; i < 500; i++) {
    tick(normal); tick(hard);
    const nbox = normal.state.box, hbox = hard.state.box;
    if (!nbox || !hbox) break;
    sawNormalFan ||= nbox.bullets.some(p=>p.kind==='aimed');
    sawFan ||= hbox.bullets.some(p => p.kind === 'aimed');
    if (nbox.wave > 0 && firstNormalWave === null) firstNormalWave = nbox.elapsed;
    if (hbox.wave > 0 && firstHardWave === null) firstHardWave = hbox.elapsed;
    const rect = vinsonBoxSafeRect(nbox);
    if (rect) {
      sawRect = true;
      assert.ok(rect.x >= nbox.minX && rect.y >= nbox.minY);
      assert.ok(rect.x + rect.w <= nbox.maxX && rect.y + rect.h <= nbox.maxY);
      // Check the rectangle against each bullet's remaining straight-line path while it is live.
      for (const p of nbox.bullets) {
        if (p.kind === 'aimed' || p.age < p.telegraph || p.wave!==vinsonBoxMarkerWave(nbox)?.wave) continue;
        const points=[];
        for(let ix=0;ix<=4;ix++)for(let iy=0;iy<=4;iy++)points.push([rect.x+rect.w*ix/4,rect.y+rect.h*iy/4]);
        for(const [x,y] of points){
          const vx=p.vx||0,vy=p.vy||0,projection=Math.max(0,((x-p.x)*vx+(y-p.y)*vy)/(vx*vx+vy*vy));
          const distance=Math.hypot(x-p.x-vx*projection,y-p.y-vy*projection);
          assert.ok(distance>p.radius+nbox.heroRadius,`${pattern} safe rectangle stays separated from live bullet paths`);
        }
      }
    }
  }
  assert.ok(sawRect, `${pattern} shows a safe rectangle`);
  assert.ok(firstNormalWave !== null && firstHardWave !== null);
  assert.ok(firstHardWave < firstNormalWave, `${pattern} hard wave arrives sooner`);
  assert.ok(sawNormalFan, `${pattern} normal restores prototype13 side shots`);
  assert.ok(sawFan, `${pattern} hard box retains aimed fans`);
}

function driveClash(difficulty, rate) {
  const state = createVinsonClash({ seed: 1500, difficulty });
  let frame = 0, warnings = 0;
  for (; frame < 90 * 60 && !state.won && !state.lost; frame++) {
    let key = null;
    if (state.phase === 'sequence' && frame % 6 === 0) key = state.keys[state.index];
    else if (state.phase === 'push' && frame % Math.round(60 / rate) === 0) key = 'j';
    stepVinsonClash(state, 1 / 60, { key });
    warnings += state.events.filter(e => e.type === 'warning').length;
  }
  return { state, warnings, seconds: frame / 60 };
}

for (const [difficulty, rate, warningCount] of [['normal', 6.5, 3], ['hard', 8.5, 4]]) {
  const result = driveClash(difficulty, rate);
  assert.equal(result.state.won, true, `${difficulty} fresh-press driver wins`);
  assert.equal(result.warnings, warningCount);
  assert.ok(result.seconds < 90);
}

// Continuous holding cannot replace fresh presses on either difficulty.
for (const difficulty of ['normal', 'hard']) {
  const state = createVinsonClash({ seed: 8, difficulty });
  for (let i = 0; i < 90 * 20 && !state.won && !state.lost; i++) {
    stepVinsonClash(state, .05, { held: true });
  }
  assert.equal(state.won, false, `${difficulty} loses without fresh J presses`);
  assert.equal(state.lost, true);
}

console.log('Vinson difficulty 15 regressions passed');
