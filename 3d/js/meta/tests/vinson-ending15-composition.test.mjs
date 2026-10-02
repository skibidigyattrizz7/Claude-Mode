import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sampleVinsonCinematic, VINSON_CINEMATIC_DURATION } from '../ui/vinsoncinematic.js';

const spans = { white: 0, black: 0 };
for (let frame = 0; frame <= 25 * 60; frame++) {
  const shot = sampleVinsonCinematic('finale', frame / 60);
  for (const key of Object.keys(spans)) if (shot[key] > .95) spans[key]++;
}
assert.ok(spans.white / 60 < .55, `full-white flash should be brief (${spans.white / 60}s)`);
assert.ok(spans.black / 60 < .55, `full-black pause should be brief (${spans.black / 60}s)`);
assert.equal(VINSON_CINEMATIC_DURATION.finale, 25, 'the revised flashes preserve the full 25-second story timeline');
assert.equal(sampleVinsonCinematic('finale', 17).dialogueId, 'captain-sacrifice');
assert.equal(sampleVinsonCinematic('finale', 24.99).done, false);
assert.equal(sampleVinsonCinematic('finale', 25).done, true);
const liveClash = sampleVinsonCinematic('finale', 2, { clash: {
  won: false, keys: ['ArrowLeft', 'ArrowRight'], index: 1, remaining: .28,
  stun: .3, recovery: .12, mistakes: 2, progress: .38, pulse: .5, elapsed: 1.2, threshold: .38,
} });
assert.deepEqual(liveClash.clashKeys, ['ArrowLeft', 'ArrowRight']);
assert.equal(liveClash.clashKeyIndex, 1);
assert.equal(liveClash.clashTimeLeft, .28);
assert.equal(liveClash.clashStun, .3);
assert.equal(liveClash.clashRecovery, .12);
assert.equal(liveClash.clashMistakes, 2);

const fx = readFileSync(new URL('../ui/vinsonendingfx.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../css/vinsonbattle.css', import.meta.url), 'utf8');
assert.doesNotMatch(fx, /shadowBlur\s*=/, 'the quiet memorial drawing avoids expensive canvas blur');
assert.doesNotMatch(fx, /rgba\(255,245,214/, 'the shield has no bright metallic glint');
assert.match(fx, /low mound carries across both keepsakes and covers the shield's lower third/);
assert.match(css, /\.vb-sequence-keys button[^\n]*min-height:52px;min-width:52px/);
assert.match(css, /\.vb-panel\.vb-memorial-panel h2\{white-space:nowrap/);
assert.match(css, /\.vb-reward img[^\n]*background:transparent/);
console.log('Vinson 15 brief flashes and memorial composition passed');
