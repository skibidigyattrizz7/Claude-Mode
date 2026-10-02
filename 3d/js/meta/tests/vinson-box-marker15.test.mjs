import assert from 'node:assert/strict';
import {createVinsonBattle,vinsonBoxMarkerWave,vinsonBoxSafeRect} from '../core/vinsonbattle.js';
for(const difficulty of ['normal','hard'])for(const pattern of ['lanes','vertical','radial','beams']){
 const b=createVinsonBattle({seed:113,difficulty,openingAttack:'box',boxPattern:pattern});b.step(0,{advance:true});b.state.hero.invulnerable=100;
 let tracked=null,heldFrames=0,sawOverlap=false,sawFan=false;
 for(let i=0;i<400&&b.state.box;i++){
  const before=tracked;b.step(.025,{});const box=b.state.box;if(!box)break;
  const marker=vinsonBoxMarkerWave(box);
  if(before&&box.bullets.some(p=>p.kind!=='aimed'&&p.wave===before.wave)){
   assert.deepEqual(marker,before,'a newer spawn cannot replace a wave whose bullets are still active');heldFrames++;
  }
  if(marker){assert.ok(vinsonBoxSafeRect(box));tracked={...marker};delete tracked.remaining;}
  if(marker?.remaining!==undefined)tracked=null;
  sawOverlap ||= box.mainWaves.length>1;sawFan ||=box.bullets.some(p=>p.kind==='aimed');
  assert.ok(box.mainWaves.length<=64,'wave metadata is bounded and cleaned up');
 }
 assert.ok(heldFrames>20,pattern+' marker persists beyond the old short pre-spawn flash');
 assert.ok(sawOverlap,pattern+' restores overlapping prototype13 waves');
 assert.ok(sawFan,pattern+' restores side pressure');
}
console.log('Vinson persistent main-wave marker regressions passed');
