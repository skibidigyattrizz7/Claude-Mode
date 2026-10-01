import assert from 'node:assert/strict';
import {createVinsonBattle} from '../core/vinsonbattle.js';
import {drawVinsonBattle} from '../ui/vinsonbattle.js';
import {sampleVinsonCinematic} from '../ui/vinsoncinematic.js';
const images=Object.fromEntries(['patel','captain','world','phonk'].map(key=>[key,{complete:true,naturalWidth:1200,naturalHeight:1000,key}]));
const calls=[];
const ctx=new Proxy({}, {get(target,key){
  if(key==='createLinearGradient')return (...args)=>{assert.ok(args.every(Number.isFinite));return {addColorStop(){}};};
  if(key in target)return target[key];
  return (...args)=>{for(const arg of args)if(typeof arg==='number')assert.ok(Number.isFinite(arg),`${String(key)} received non-finite coordinates`);calls.push({key,args});};
}});
for(const stage of [0,1])for(const weapon of ['star','spinner','explosive','eyes']) {
  const battle=createVinsonBattle({seed:19,stage});battle.step(0,{advance:true});
  battle.state.hero.invulnerable=99;
  for(let i=0;i<240;i++){
    battle.step(1/60,{attack:true,weapon,y:Math.sin(i*.02)});
    if(i%15)continue;
    calls.length=0;drawVinsonBattle(ctx,battle.state,images,i/60);
    const actors=calls.filter(c=>c.key==='drawImage');
    assert.ok(actors.length>=2,'both actual character pictures render in combat alongside source hand/planet pieces');
    assert.deepEqual(actors.slice(0,2).map(c=>c.args[0].key),stage?['captain','phonk']:['patel','world']);
    assert.equal(calls.some(c=>c.key==='bezierCurveTo'),false,'heart marker is replaced by the hero picture');
  }
}
for(const kind of ['transition','finale'])for(let t=0;t<=28;t+=.5)drawVinsonBattle(ctx,createVinsonBattle().state,images,t,{shot:sampleVinsonCinematic(kind,t)});
console.log('Vinson actor, weapon and cinematic render regressions passed');
calls.length=0;
drawVinsonBattle(ctx,createVinsonBattle().state,images,0,{camera:{zoom:1,x:640,y:360}});
const transforms=calls.filter(c=>c.key==='translate');
assert.deepEqual(transforms[0].args,[0,0],'wide camera leaves the arena at its original screen position');
assert.equal(transforms.some(c=>c.args[0]===-640&&c.args[1]===-360),false,'true camera transform must not apply the old second canvas-center offset');
