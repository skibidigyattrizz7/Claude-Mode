import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createVinsonBattle,VINSON_BATTLE_ARENA} from '../core/vinsonbattle.js';
import {drawVinsonBattle} from '../ui/vinsonbattle.js';
const ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(/create.*Gradient/.test(k))return ()=>({addColorStop(){}});return (...args)=>{for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n),`${k} has invalid coordinates`);if(k==='arc'||k==='ellipse')assert.ok(args[2]>=0);};}});
const images=Object.fromEntries(['patel','captain','world','phonk'].map(k=>[k,{complete:true,naturalWidth:1200,naturalHeight:1000}]));
for(const stage of [0,1])for(const weapon of ['star','spinner','explosive','eyes','constellation','nova']){
 const b=createVinsonBattle({stage,seed:13013});b.step(0,{advance:true});b.state.hero.invulnerable=999;
 for(let i=0;i<600;i++){b.step(1/60,{attack:true,weapon,y:1,sequenceKey:b.state.sequence?.keys[b.state.sequence.index]});if(i%10===0)drawVinsonBattle(ctx,b.state,images,i/60);}
 assert.ok(b.state.hero.y>VINSON_BATTLE_ARENA.maxY-15,'down movement reaches the expanded lower edge during attacks despite gravity pull');
}
// Isolate exact movement bounds from gravity attacks; the repeated-fire cases above retain hazards.
for(const compact of [false,true]){const b=createVinsonBattle({compact});b.step(0,{advance:true});b.state.hero.invulnerable=999;b.state.attackTimer=99;for(let i=0;i<300;i++)b.step(1/60,{y:1,sequenceKey:b.state.sequence?.keys[b.state.sequence.index]});assert.equal(b.state.hero.y,compact?600:672);}
const css=fs.readFileSync(new URL('../../../css/vinsonbattle.css',import.meta.url),'utf8');
assert.match(css,/\.vb-weapons button:not\(\.vb-cycle\)\{width:78px;min-width:78px;white-space:nowrap/,'cooldown labels cannot reflow desktop arena');
console.log('Vinson repeated-fire, lower movement and stable dock regressions passed');
