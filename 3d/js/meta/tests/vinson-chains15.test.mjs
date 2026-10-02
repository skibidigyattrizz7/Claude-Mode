import assert from 'node:assert/strict';
import {createVinsonBattle,startVinsonSequence} from '../core/vinsonbattle.js';
const b=createVinsonBattle();b.step(0,{advance:true});b.state.attackTimer=99;startVinsonSequence(b.state,'chains');
const s=b.state.sequence;b.state.hero.x=s.origin.x-130;b.state.hero.y=s.origin.y+b.state.hero.bodyRise;
for(let i=0;i<50;i++){b.step(.05,{x:1});assert.ok(Math.hypot(b.state.hero.x-s.origin.x,b.state.hero.y-b.state.hero.bodyRise-s.origin.y)>=124.9,'chain pull and walking cannot hide the actor inside Vinson');}
console.log('Vinson15 chain separation remains readable while held movement tries to approach');
