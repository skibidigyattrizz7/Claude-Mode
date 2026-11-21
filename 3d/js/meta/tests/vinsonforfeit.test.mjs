import assert from 'node:assert/strict';
import { forfeitVinsonSquad } from '../core/vinsonforfeit.js';
const fresh = () => ({coins:500, club:['hell','a','b','reserve'], untradeable:['a'],
  transferList:['a','reserve'], squad:{slots:['hell','a',null],bench:['b']},
  squads:[{squad:{slots:['a','reserve'],bench:['hell','b']}}], vinson:{phase:'locked'}});
let s=fresh();
assert.deepEqual(forfeitVinsonSquad(s,'hell'),['a','b']);
assert.equal(s.coins,500);
assert.deepEqual(s.club,['hell','reserve']);
assert.deepEqual(s.squad.slots,['hell',null,null]);
assert.deepEqual(s.squad.bench,[null]);
assert.deepEqual(s.squads[0].squad.slots,[null,'reserve']);
assert.deepEqual(s.squads[0].squad.bench,['hell',null]);
assert.deepEqual(s.transferList,['reserve']);
assert.deepEqual(s.untradeable,[]);
assert.deepEqual(forfeitVinsonSquad(s,'hell'),[]);
s=fresh(); assert.deepEqual(forfeitVinsonSquad(s,'hell',{owner:true}),[]);
assert.deepEqual(s.club,fresh().club);
s=fresh();s.vinson.immune=true;assert.deepEqual(forfeitVinsonSquad(s,'hell'),[]);
s=fresh();s.vinson.phase='lifted';assert.deepEqual(forfeitVinsonSquad(s,'hell'),[]);
s=fresh();s.squad.slots[0]=null;assert.deepEqual(forfeitVinsonSquad(s,'hell'),[]);
console.log('Vinson zero-coin active squad consequence regressions passed');
