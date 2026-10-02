import assert from 'node:assert/strict';
import {createVinsonClash,stepVinsonClash,vinsonClashX} from '../core/vinsonclash.js';
import {sampleVinsonCinematic} from '../ui/vinsoncinematic.js';

const run=(solve)=>{
  const s=createVinsonClash({seed:42});
  for(let frame=0;frame<60*46&&!s.won&&!s.lost;frame++){
    const key=solve&&s.stun<=0&&s.recovery<=0&&frame%18===0?s.keys[s.index]:null;
    stepVinsonClash(s,1/60,{key});assert.ok(s.progress>=0&&s.progress<=1);
  }return s;
};
const solved=run(true),idle=run(false);
assert.equal(solved.won,true,'timely complete sequences win');assert.equal(solved.lost,false);
assert.ok(solved.accepted>=16,'four ordered keys per push, no single-key mash');
assert.equal(idle.lost,true,'timeouts cause actual defeat');assert.equal(idle.won,false);
const wrong=createVinsonClash();const start=wrong.progress;
stepVinsonClash(wrong,.016,{key:'j'});assert.ok(wrong.stun>1);assert.ok(wrong.progress<start);assert.equal(wrong.mistakes,1);
const count=wrong.accepted;stepVinsonClash(wrong,.05,{key:wrong.keys[0]});assert.equal(wrong.accepted,count,'stun cannot be bypassed');
const a=createVinsonClash({seed:3}),b=createVinsonClash({seed:3});
for(let i=0;i<600;i++){const input={key:i%18===0?a.keys[a.index]:null};stepVinsonClash(a,1/60,input);stepVinsonClash(b,1/60,input);}assert.deepEqual(a,b);
const mash=createVinsonClash();for(let i=0;i<100;i++)stepVinsonClash(mash,.05,{presses:10,held:true});assert.equal(mash.accepted,0,'holding or auto-clicking cannot solve ordered prompts');

const live=createVinsonClash();live.progress=.63;live.pulse=.8;live.threshold=1;live.thresholdAge=.4;live.elapsed=5;
const shot=sampleVinsonCinematic('finale',1.65,{clash:live});
assert.equal(shot.interactiveClash,true);assert.equal(shot.mashProgress,.63);
assert.equal(shot.clashX,vinsonClashX(.63));assert.equal(shot.mashThreshold,1);
const reduced=sampleVinsonCinematic('finale',1.65,{clash:live,reducedMotion:true});
assert.equal(reduced.zoom,1);assert.equal(reduced.white,0);assert.equal(reduced.mashProgress,shot.mashProgress);
console.log('Vinson interactive domain clash regressions passed');
