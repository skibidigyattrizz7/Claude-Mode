import assert from 'node:assert/strict';
import {vinsonPentagramPoints,drawDomainClash} from '../ui/vinsonfinalefx.js';
import {sampleVinsonCinematic} from '../ui/vinsoncinematic.js';
const points=vinsonPentagramPoints();assert.equal(points.length,5);
assert.ok(points[0].y>0,'inverted star has its single vertex downward');
assert.equal(new Set(points.map(p=>p.x.toFixed(3)+','+p.y.toFixed(3))).size,5);
const calls=[];
const ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(k==='createRadialGradient')return ()=>({addColorStop(){}});return (...args)=>calls.push([k,...args]);}});
drawDomainClash(ctx,{domainPower:1,mashProgress:.95,clashX:915},1,false,()=>{});
assert.ok(calls.some(c=>c[0]==='closePath'),'pentagram closes fully');
assert.ok(calls.some(c=>c[0]==='setLineDash'&&c[1].length===0),'complete star has no permanent stroke gap');
for(const time of [2,4,6]){
 const prior=sampleVinsonCinematic('finale',time),after=sampleVinsonCinematic('finale',time,{clash:{won:true}});
 assert.equal(after.clashX,prior.clashX);assert.equal(after.beams,prior.beams);assert.equal(after.text,prior.text);
 assert.equal(after.postMashStruggle,true,'only the restored struggle uses the old look');
}
assert.equal(sampleVinsonCinematic('finale',3.9,{clash:{won:true}}).dialogueId,'final-domain-threat');
assert.equal(sampleVinsonCinematic('finale',6,{clash:{won:true}}).dialogueId,'final-captain-resolve');
assert.ok(sampleVinsonCinematic('finale',18,{clash:{won:true}}).revealFace>0,'unmasked reveal is visible');
console.log('Vinson14 closed sigil, original struggle/dialogue and unmasked reveal regressions passed');
