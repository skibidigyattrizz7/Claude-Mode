import assert from 'node:assert/strict';
import {createVinsonBattle,startVinsonSequence,triggerVinsonCombo} from '../core/vinsonbattle.js';
import {drawVinsonBattle} from '../ui/vinsonbattle.js';
import {sampleVinsonCinematic} from '../ui/vinsoncinematic.js';
const ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(/create.*Gradient/.test(k))return ()=>({addColorStop(){}});return (...args)=>{for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n),`${k} invalid coordinate`);};}});
const b=createVinsonBattle();b.step(0,{advance:true});b.state.hero.hp=80;
b.state.hazards=[{type:'bombcircle',x:b.state.hero.x,y:b.state.hero.y,radius:90,elapsed:.9,telegraph:1,duration:.5,hit:false}];
b.step(.01,{dodge:true,x:-1});assert.ok(b.state.events.some(e=>e.type==='perfectDodge'));assert.equal(b.state.hero.hp,82);
for(const reducedMotion of [false,true]){
 for(const kind of ['inversion','chains']){b.state.sequence=null;startVinsonSequence(b.state,kind);drawVinsonBattle(ctx,b.state,{},1,{reducedMotion});assert.equal(new Set(b.state.sequence.keys).size,3);}
 b.state.sequence=null;b.state.comboOffer=5;triggerVinsonCombo(b.state);
 for(const age of [0,.3,.6,1.1]){b.state.combo.elapsed=age;drawVinsonBattle(ctx,b.state,{},1,{reducedMotion});}
 b.state.combo=null;
 for(const time of [1,3,7,8,9,14,16,21,25])drawVinsonBattle(ctx,b.state,{},time,{shot:sampleVinsonCinematic('finale',time,{reducedMotion}),reducedMotion});
}
console.log('Vinson perfect-dodge, unique keys and finite combat/finale render regressions passed');
