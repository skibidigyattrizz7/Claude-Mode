import assert from 'node:assert/strict';
import { VINSON_PACK_BEATS, vinsonCrackPaths } from '../ui/vinsonpackcollapse.js';
const punches=VINSON_PACK_BEATS.filter(b=>b.action==='punch');
assert.deepEqual(punches.map(b=>b.hit),[1,2,3,4,5,6]);
assert.equal(VINSON_PACK_BEATS[0].action,'surfaces');
assert.ok(VINSON_PACK_BEATS[0].at>=2000,'buttons settle before the rest falls');
assert.ok(punches[0].at>VINSON_PACK_BEATS[1].at+1000,'pause before first punch');
assert.ok(VINSON_PACK_BEATS.every((b,i)=>!i||b.at>VINSON_PACK_BEATS[i-1].at));
assert.equal(VINSON_PACK_BEATS.at(-3).action,'reach');
assert.equal(VINSON_PACK_BEATS.at(-2).action,'black');
assert.equal(VINSON_PACK_BEATS.at(-1).action,'exit');
assert.ok(VINSON_PACK_BEATS.at(-1).at-VINSON_PACK_BEATS.at(-2).at>=1500,'black hold before home');
let previous=0;
for(let hit=1;hit<=6;hit++){
  const paths=vinsonCrackPaths(hit);
  assert.ok(paths.length>previous,'every impact grows the fracture network');
  assert.ok(paths.every(p=>!(/NaN|Infinity/.test(p))));
  assert.deepEqual(paths,vinsonCrackPaths(hit),'reproducible cracks');
  previous=paths.length;
}
console.log('Vinson staged cursed-pack collapse timeline regressions passed');
