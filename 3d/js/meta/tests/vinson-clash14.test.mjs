import assert from 'node:assert/strict';
import {createVinsonClash,stepVinsonClash,vinsonClashX} from '../core/vinsonclash.js';
import {sampleVinsonCinematic} from '../ui/vinsoncinematic.js';

const s=createVinsonClash({seed:42});
assert.equal(s.phase,'push');assert.equal(s.keys.length,0,'normal clash starts without a sequence');
let warnings=0;
for(let i=0;i<3600&&!s.won&&!s.lost;i++){
 const key=s.phase==='sequence'&&i%12===0?s.keys[s.index]:i%8===0?'j':null;
 stepVinsonClash(s,1/60,{key});warnings+=s.events.filter(e=>e.type==='warning').length;
}
assert.equal(s.won,true);assert.equal(warnings,3,'three announced progress gates ask for sequences');
const warning=createVinsonClash();warning.progress=.51;stepVinsonClash(warning,.01);
assert.equal(warning.phase,'warning');assert.ok(warning.warning>=2,'clear warning precedes active keys');
for(let i=0;i<40;i++)stepVinsonClash(warning,.05,{key:'j',presses:20,held:true});
assert.equal(warning.mistakes,0,'spam during warning cannot fail');assert.equal(warning.phase,'warning');
for(let i=0;i<6;i++)stepVinsonClash(warning,.05,{key:'j'});
assert.equal(warning.phase,'sequence');const index=warning.index;
stepVinsonClash(warning,.01,{key:'j',presses:100,held:true});assert.equal(warning.index,index);assert.equal(warning.mistakes,0,'attack spam is ignored during sequence');
stepVinsonClash(warning,.01,{key:warning.keys[0]==='q'?'e':'q'});assert.ok(warning.stun>1);assert.equal(warning.lost,false);
for(let i=0;i<24;i++)stepVinsonClash(warning,.05);assert.equal(warning.phase,'push','stun returns to same clash');
for(let i=0;i<5;i++){warning.phase='sequence';warning.progress=.9;warning.remaining=3;warning.keys=['q','e','r','f'];warning.index=0;stepVinsonClash(warning,.01,{key:'e'});assert.equal(warning.lost,false,'no three-strike defeat');}
const idle=createVinsonClash();for(let i=0;i<3000&&!idle.lost;i++)stepVinsonClash(idle,1/60);assert.equal(idle.lost,true,'losing ALL territorial ground still loses');
const a=createVinsonClash({seed:3}),b=createVinsonClash({seed:3});for(let i=0;i<600;i++){const input={key:i%8===0?'j':null};stepVinsonClash(a,1/60,input);stepVinsonClash(b,1/60,input);}assert.deepEqual(a,b);

const live=createVinsonClash();live.progress=.63;live.pulse=.8;live.threshold=1;live.thresholdAge=.4;live.elapsed=5;
const shot=sampleVinsonCinematic('finale',1.65,{clash:live});
assert.equal(shot.interactiveClash,true);assert.equal(shot.mashProgress,.63);
assert.equal(shot.clashX,vinsonClashX(.63));assert.equal(shot.mashThreshold,1);
const reduced=sampleVinsonCinematic('finale',1.65,{clash:live,reducedMotion:true});
assert.equal(reduced.zoom,1);assert.equal(reduced.white,0);assert.equal(reduced.mashProgress,shot.mashProgress);
console.log('Vinson interactive domain clash regressions passed');
