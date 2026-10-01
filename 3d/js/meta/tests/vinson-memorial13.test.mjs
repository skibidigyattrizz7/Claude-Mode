import assert from 'node:assert/strict';
import { sampleVinsonCinematic, VINSON_CINEMATIC_DURATION } from '../ui/vinsoncinematic.js';

const finiteTree = value => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `non-finite number: ${value}`);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
};

assert.equal(VINSON_CINEMATIC_DURATION.finale, 25, 'finale has a 25 second timeline');
let previousClashX = null, movedLeft = false, movedRight = false;
for (let frame = 0; frame <= 25 * 60; frame++) {
  const t = frame / 60;
  const shot = sampleVinsonCinematic('finale', t);
  finiteTree(shot);
  assert.equal(shot.time, t);
  for (const key of ['white','black','beams','domainPower','clashProgress','clashPower','throwSword','peace','shield','sword','explosion']) {
    assert.ok(shot[key] >= 0 && shot[key] <= 1, `${key} outside [0,1] at ${t}s`);
  }
  if (t >= 1.8 && t <= 7.7 && previousClashX != null) {
    movedLeft ||= shot.clashX < previousClashX - .1;
    movedRight ||= shot.clashX > previousClashX + .1;
  }
  previousClashX = shot.clashX;
  assert.equal(shot.done, t >= 25, `done boundary at ${t}s`);
  assert.deepEqual(sampleVinsonCinematic('finale', t), shot, 'same time always returns the same shot');
}
assert.ok(movedLeft && movedRight, 'beam clash shifts toward both sides during the struggle');

const swordBeforeBlast = sampleVinsonCinematic('finale', 8.0);
const blast = sampleVinsonCinematic('finale', 8.9);
assert.ok(swordBeforeBlast.throwSword > .9, 'Captain releases his sword before the blast');
assert.equal(swordBeforeBlast.white, 0);
assert.ok(blast.white > .5 && blast.explosion > .5, 'the white explosion follows the sword throw');

const memorial = sampleVinsonCinematic('finale', 20);
assert.ok(memorial.peace > .99, 'the ending settles into a peaceful tableau');
assert.ok(memorial.shield > .99 && memorial.sword > .99, 'shield and planted sword remain in the memorial');
assert.ok(memorial.landingAge > 0, 'the landed sword has settled before the reveal');
const reveal = sampleVinsonCinematic('finale', 17);
assert.equal(reveal.dialogueId, 'captain-sacrifice');
assert.match(reveal.text, /Grumpy Patel.*sacrifice saved humanity/);

for (let frame = 0; frame <= 25 * 30; frame++) {
  const t = frame / 30;
  const motionOff = sampleVinsonCinematic('finale', t, { reducedMotion: true });
  finiteTree(motionOff);
  assert.equal(motionOff.zoom, 1);
  assert.equal(motionOff.white, 0);
  assert.equal(motionOff.explosion, 0);
  assert.equal(motionOff.throwSword, sampleVinsonCinematic('finale', t).throwSword,
    'reduced motion preserves the sword and sacrifice story beats');
  assert.equal(motionOff.dialogueId, sampleVinsonCinematic('finale', t).dialogueId);
}

console.log('Vinson memorial 13 finale tests passed');
