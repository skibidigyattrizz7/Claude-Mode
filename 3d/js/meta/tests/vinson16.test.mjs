import assert from 'node:assert/strict';
import {createVinsonBattle,VINSON_BATTLE_ARENA} from '../core/vinsonbattle.js';
import {drawFlagStar,drawStarImpact} from '../ui/vinsonweaponart16.js';
// Both actors retain their source scale but can use the whole enlarged floor in either phase.
for(const stage of [0,1])for(const compact of [false,true]){
 const b=createVinsonBattle({seed:16,stage,compact});b.step(0,{advance:true});b.state.attackTimer=999;b.state.hero.invulnerable=999;
 for(let i=0;i<180;i++)b.step(1/60,{y:-1});assert.equal(b.state.hero.y,stage?320:250);
 for(let i=0;i<240;i++)b.step(1/60,{y:1});assert.equal(b.state.hero.y,compact?600:672);
}
// Sixfold starts with six visible sky projectiles; its actual falling paths can damage the boss.
{
 const a=createVinsonBattle({seed:16}),b=createVinsonBattle({seed:16});for(const fight of [a,b]){fight.step(0,{advance:true});fight.state.attackTimer=999;fight.state.hero.invulnerable=999;fight.state.boss.dodgeCooldown=999;fight.step(.01,{attack:true,weapon:'constellation'});}
 assert.equal(a.state.projectiles.length,6);assert.ok(a.state.projectiles.every(p=>p.falling&&p.y>0&&p.vx===0&&p.vy>0));
 let hits=0;for(let i=0;i<140;i++){a.step(1/60,{});b.step(1/60,{});hits+=a.state.events.filter(e=>e.type==='hit'&&e.target==='boss').length;assert.deepEqual(a.state,b.state);}
 assert.ok(hits>0,'falling art and actual hit path agree');
}
// A flag star has both triangles in each stroke, stays hollow, and restores canvas state.
{
 let points=0,strokes=[],fills=0,saves=0;const ctx={globalAlpha:1,save(){saves++},restore(){saves--},translate(){},beginPath(){points=0},moveTo(){points++},lineTo(){points++},closePath(){},stroke(){strokes.push(points)},fill(){fills++}};
 drawFlagStar(ctx,0,0,30,.3);assert.deepEqual(strokes,[6,6]);assert.equal(fills,0);assert.equal(saves,0);assert.equal(ctx.globalCompositeOperation,'source-over');
}
// Heavy impact work remains finite and bounded, including reduced-motion mode.
for(const reduced of [false,true])for(const weapon of ['star','spinner','explosive','eyes','constellation','nova']){
 let calls=0;const ctx=new Proxy({globalAlpha:1},{get(o,k){if(k in o)return o[k];return (...args)=>{calls++;for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v));};}});
 const result=drawStarImpact(ctx,{x:800,y:350,age:.2,life:.65,tier:3,weapon},4,reduced);assert.equal(result.drawn,true);assert.ok(calls<1500);
}
console.log('Prototype16 expanded floor, deterministic falling Sixfold and hollow bounded weapon art passed');
