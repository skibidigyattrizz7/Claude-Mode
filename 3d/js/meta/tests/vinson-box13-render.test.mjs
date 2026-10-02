import assert from 'node:assert/strict';
import {createVinsonBattle,vinsonBoxGap,vinsonBoxMarkerWave} from '../core/vinsonbattle.js';
import {drawDodgeBox} from '../ui/vinsonfightfx.js';
for(const pattern of ['lanes','vertical','radial','beams']){
 const battle=createVinsonBattle({seed:113,openingAttack:'box',boxPattern:pattern});battle.step(0,{advance:true});battle.state.hero.invulnerable=100;
 for(let i=0;i<30;i++)battle.step(.025,{});
 const box=battle.state.box,marker=vinsonBoxMarkerWave(box);
 assert.equal(box.preview,null,'wave has emitted, so the old preview-only renderer would show nothing');assert.ok(marker);
 const records=[],stack=[];const ctx=new Proxy({setLineDash(v){this.dash=v},save(){stack.push({strokeStyle:this.strokeStyle,globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,dash:this.dash})},restore(){Object.assign(this,stack.pop())},strokeRect(...v){records.push({type:'rect',v,color:this.strokeStyle,alpha:this.globalAlpha,dash:this.dash})},arc(...v){records.push({type:'arc',v,color:this.strokeStyle})}}, {get(o,k){return k in o?o[k]:(()=>{})}});
 drawDodgeBox(ctx,battle.state,{},0,()=>{},()=>{});
 if(pattern==='radial'){
  const circle=records.find(r=>r.type==='arc'&&r.color==='#f07d70'&&r.v[2]===24);assert.ok(circle,'original13 radial indicator style');const gap=vinsonBoxGap(box,marker);assert.equal(circle.v[0],gap.x);assert.equal(circle.v[1],gap.y);
 }else{
  const rect=records.find(r=>r.type==='rect'&&r.color==='#98bbcf');assert.ok(rect,'original13 blue outlined lane stays visible after emission');assert.equal(rect.alpha,.75);assert.deepEqual(rect.dash,[7,7]);
  if(pattern==='vertical'){assert.equal(rect.v[2],112);assert.equal(rect.v[3],252);}else{assert.equal(rect.v[2],632);assert.equal(rect.v[3],44);}
 }
}
console.log('Prototype13 indicator style and post-emission visibility regressions passed');
