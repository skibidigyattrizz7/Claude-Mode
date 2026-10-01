import assert from 'node:assert/strict';
import {createVinsonClash,stepVinsonClash,vinsonClashX} from '../core/vinsonclash.js';
import {sampleVinsonCinematic} from '../ui/vinsoncinematic.js';

const run=(mode)=>{
  const s=createVinsonClash();
  for(let frame=0;frame<60*20&&!s.won;frame++){
    const active=frame>30;
    stepVinsonClash(s,1/60,mode==='mash'?{presses:active&&frame%8===0?1:0}:{held:active});
    assert.ok(s.progress>=.12&&s.progress<=1);
    assert.ok(Number.isFinite(vinsonClashX(s.progress)));
  }
  return s;
};
const mash=run('mash'),held=run('hold');
assert.equal(mash.won,true,'about 7.5 presses per second can win');
assert.equal(held.won,true,'hold-to-push accessibility route can win');
assert.ok(mash.elapsed>=6&&mash.elapsed<=12);
assert.ok(held.elapsed>=10&&held.elapsed<=20);

const idle=createVinsonClash();
for(let i=0;i<60*30;i++)stepVinsonClash(idle,1/60);
assert.equal(idle.progress,.12,'Vinson cannot push past the recoverable floor');
assert.equal(idle.won,false);

const a=createVinsonClash(),b=createVinsonClash();
for(let i=0;i<600;i++){const input={presses:i%9===0?1:0,held:i%41<8};stepVinsonClash(a,1/60,input);stepVinsonClash(b,1/60,input);}
assert.deepEqual(a,b,'same fixed-step input stream is deterministic');

const live=createVinsonClash();live.progress=.63;live.pulse=.8;live.threshold=1;live.thresholdAge=.4;live.elapsed=5;
const shot=sampleVinsonCinematic('finale',1.65,{clash:live});
assert.equal(shot.interactiveClash,true);assert.equal(shot.mashProgress,.63);
assert.equal(shot.clashX,vinsonClashX(.63));assert.equal(shot.mashThreshold,1);
const reduced=sampleVinsonCinematic('finale',1.65,{clash:live,reducedMotion:true});
assert.equal(reduced.zoom,1);assert.equal(reduced.white,0);assert.equal(reduced.mashProgress,shot.mashProgress);
console.log('Vinson interactive domain clash regressions passed');
