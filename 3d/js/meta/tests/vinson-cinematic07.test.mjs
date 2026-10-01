import assert from 'node:assert/strict';
import { sampleVinsonCinematic, VINSON_CINEMATIC_DURATION } from '../ui/vinsoncinematic.js';

const finiteTree = value => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `non-finite number: ${value}`);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
};

for (let i = 0; i <= VINSON_CINEMATIC_DURATION.transition * 60; i++) {
  const shot = sampleVinsonCinematic('transition', i / 60);
  finiteTree(shot);
  for (const key of ['clashProgress','clashPower','explosion','arrival','skyBeam','arrivalStar']) {
    assert.ok(shot[key] >= 0 && shot[key] <= 1, `${key} outside [0,1]`);
  }
}

assert.equal(sampleVinsonCinematic('transition', 0).villain, 'world');
assert.equal(sampleVinsonCinematic('transition', 5).villain, 'phonk');
assert.ok(sampleVinsonCinematic('transition', 12).clashProgress > .4, 'eye struggle is sustained');
assert.ok(sampleVinsonCinematic('transition', 15.5).clashProgress > .9);
assert.ok(sampleVinsonCinematic('transition', 15.5).clashPower > sampleVinsonCinematic('transition', 9).clashPower);
assert.ok(sampleVinsonCinematic('transition', 16.5).white > .9, 'climax is a white explosion');
assert.ok(sampleVinsonCinematic('transition', 19.5).skyBeam > .5);
assert.ok(sampleVinsonCinematic('transition', 19.5).arrivalStar > .5);
assert.equal(sampleVinsonCinematic('transition', 22.5).hero, 'captain');

const center = sampleVinsonCinematic('transition', 8.5).clashX;
const left = sampleVinsonCinematic('transition', 9.2).clashX;
const right = sampleVinsonCinematic('transition', 10.7).clashX;
assert.ok(Math.abs(center - 640) < 1, 'clash starts centered');
assert.ok(left < 640 && right > 640, 'clash oscillates toward both fighters');
assert.ok(sampleVinsonCinematic('transition', 12).clashX >= 300 && sampleVinsonCinematic('transition', 12).clashX <= 980);

const reduced = sampleVinsonCinematic('transition', 16.5, { reducedMotion: true });
assert.ok(reduced.white < sampleVinsonCinematic('transition', 16.5).white);
assert.ok(reduced.zoom <= 1.04);
assert.equal(sampleVinsonCinematic('transition', VINSON_CINEMATIC_DURATION.transition).done, true);
assert.match(sampleVinsonCinematic('finale', 21).text, /world has been saved/);
console.log('Vinson cinematic 07 tests passed');
