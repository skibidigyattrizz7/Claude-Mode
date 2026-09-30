import assert from 'node:assert/strict';
import { createVinsonBattle } from '../core/vinsonbattle.js';
import { sampleVinsonCinematic, VINSON_CINEMATIC_DURATION } from '../ui/vinsoncinematic.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok', name); };
const finiteTree = value => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `unexpected non-finite value ${value}`);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) finiteTree(item);
};

test('both cinematic timelines stay finite and bounded through their full durations', () => {
  for (const [kind, duration] of Object.entries(VINSON_CINEMATIC_DURATION)) {
    for (let i = -1; i <= duration * 60 + 1; i++) {
      const shot = sampleVinsonCinematic(kind, i / 60);
      finiteTree(shot);
      assert.ok(shot.zoom >= 0.5 && shot.zoom <= 2);
      for (const key of ['black', 'white', 'beams', 'star', 'shield', 'sword', 'heroAlpha', 'villainAlpha']) {
        assert.ok(shot[key] >= 0 && shot[key] <= 1, `${kind}.${key} outside [0,1]`);
      }
    }
    assert.equal(sampleVinsonCinematic(kind, duration).done, true);
    assert.equal(sampleVinsonCinematic(kind, duration - 0.01).done, false);
  }
});

test('transition has a sustained blackout between Vinson forms and continuous camera motion', () => {
  const blackouts = []; let blackoutStart = null, lastZoom = null;
  for (let i = 0; i <= 28 * 60; i++) {
    const shot = sampleVinsonCinematic('transition', i / 60);
    if (shot.black > 0.95) { if (blackoutStart === null) blackoutStart = i / 60; }
    else if (blackoutStart !== null) { blackouts.push(i / 60 - blackoutStart); blackoutStart = null; }
    if (lastZoom !== null) assert.ok(Math.abs(shot.zoom - lastZoom) < 0.025, 'zoom should ease continuously');
    lastZoom = shot.zoom;
  }
  assert.equal(blackouts.length, 2, 'form change and Patel loss each use a separate blackout');
  assert.ok(blackouts.every(duration => duration >= 1.5 && duration <= 3.5));
  assert.equal(sampleVinsonCinematic('transition', 6).villain, 'phonk');
  assert.equal(sampleVinsonCinematic('transition', 20).hero, 'captain');
});

test('finale grows into whiteout, reveals cracked shield and sword, then displays the ending', () => {
  let peakWhite = 0;
  for (let i = 0; i <= 26 * 60; i++) peakWhite = Math.max(peakWhite, sampleVinsonCinematic('finale', i / 60).white);
  assert.ok(peakWhite > 0.99);
  assert.ok(sampleVinsonCinematic('finale', 18).shield > 0.5);
  assert.ok(sampleVinsonCinematic('finale', 22).sword > 0.5);
  assert.match(sampleVinsonCinematic('finale', 21).text, /world has been saved/);
  assert.equal(sampleVinsonCinematic('finale', 26).done, true);
});

test('reduced motion removes camera zoom and white flash while preserving story beats', () => {
  for (const kind of ['transition', 'finale']) {
    const duration = VINSON_CINEMATIC_DURATION[kind];
    for (let i = 0; i <= duration * 10; i++) {
      const shot = sampleVinsonCinematic(kind, i / 10, { reducedMotion: true });
      assert.equal(shot.zoom, 1);
      assert.equal(shot.white, 0);
    }
  }
  assert.match(sampleVinsonCinematic('finale', 21, { reducedMotion: true }).text, /world has been saved/);
});

test('battle stages feed transition and finale cinematics in order', () => {
  const battle = createVinsonBattle({ seed: 71 });
  battle.step(0, { advance: true });
  battle.state.boss.hp = 12;
  for (let i = 0; i < 100 && battle.state.phase === 'fight'; i++) battle.step(0.05, { attack: true });
  assert.equal(battle.state.phase, 'transition');
  assert.equal(sampleVinsonCinematic('transition', 0).hero, 'patel');
  assert.equal(sampleVinsonCinematic('transition', 27.99).done, false);
  assert.equal(sampleVinsonCinematic('transition', 28).done, true);
  battle.next(); assert.equal(battle.state.stage, 1); assert.equal(battle.state.phase, 'intro');
  battle.step(0, { advance: true }); battle.state.boss.hp = 12;
  for (let i = 0; i < 100 && battle.state.phase === 'fight'; i++) battle.step(0.05, { attack: true });
  assert.equal(battle.state.phase, 'clash');
  for (let i = 0; i < 70 && battle.state.phase === 'clash'; i++) battle.step(0.05);
  assert.equal(battle.state.phase, 'victory');
  assert.equal(sampleVinsonCinematic('finale', 26).done, true);
});

console.log(`${count} Vinson cinematic tests passed`);
