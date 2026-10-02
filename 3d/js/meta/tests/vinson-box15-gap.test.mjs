import assert from 'node:assert/strict';
import {createVinsonBattle,vinsonBoxGap,startVinsonSequence} from '../core/vinsonbattle.js';
for(const compact of [false,true])for(const pattern of ['lanes','vertical','radial','beams'])for(let safe=0;safe<5;safe++)for(let wave=0;wave<8;wave++){
 const b=createVinsonBattle({compact});b.step(0,{advance:true});b.state.hero.hp=1e6;
 const box={minX:320,maxX:960,minY:compact?300:320,maxY:compact?470:580,heroRadius:7,pattern,elapsed:0,duration:10,wave,bullets:[],spawnTimer:.01,pressureTimer:99,pressureWave:0,preview:{safe,wave,pattern}};
 b.state.phase='dodgebox';b.state.box=box;const hint=vinsonBoxGap(box,box.preview);b.step(.02,{});
 assert.ok(hint.x>=box.minX+7&&hint.x<=box.maxX-7&&hint.y>=box.minY+7&&hint.y<=box.maxY-7,'all marked gap points reachable');
 for(const p of box.bullets){if(pattern==='vertical')assert.ok(Math.abs(hint.x-p.x)>p.radius+box.heroRadius);else if(pattern==='radial'){let d=Math.atan2(p.vy,p.vx)-hint.angle;d=Math.atan2(Math.sin(d),Math.cos(d));assert.ok(Math.abs(d)>hint.half,'shared wedge points between actual emitted spokes');}else assert.ok(Math.abs(hint.y-p.y)>p.radius+box.heroRadius);}
 if(safe===0&&pattern==='lanes'){b.state.hero.y=box.minY+80;b.state.box.spawnTimer=99;for(let i=0;i<8;i++)b.step(.05,{y:-1});assert.ok(b.state.hero.y<box.minY+26,'top main-wave gap is no longer behind44px movement clamp');}
}
for(const kind of ['inversion','chains']){const b=createVinsonBattle();b.step(0,{advance:true});startVinsonSequence(b.state,kind);assert.equal(b.state.sequence.remaining,kind==='chains'?6:5.5);assert.equal(b.state.sequenceCooldown,35);}
for(const kind of ['chains','inversion']){const w=createVinsonBattle();w.step(0,{advance:true});w.state.attackTimer=99;startVinsonSequence(w.state,kind,{warning:1.5});const remaining=w.state.sequence.remaining;for(let i=0;i<20;i++)w.step(.05,{sequenceKey:'wrong'});assert.equal(w.state.sequence.index,0);assert.equal(w.state.sequence.remaining,remaining);assert.equal(w.state.hero.invertedTime,0);assert.ok(w.state.sequence.warning>0);}
const b=createVinsonBattle({seed:15});b.step(0,{advance:true});b.state.hero.hp=1e6;const starts=[];
for(let i=0;i<2400;i++){b.step(.05,{sequenceKey:b.state.sequence?.keys[b.state.sequence.index]});for(const e of b.state.events)if(e.type==='sequenceStart')starts.push(b.state.time);}
assert.ok(starts.length>=2);assert.ok(starts[0]>=20);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=34.9,'long breathing room between combat sequences');
console.log('Vinson15 all gap/spawn geometries align, top gap reachable and combat QTE pacing eased');
