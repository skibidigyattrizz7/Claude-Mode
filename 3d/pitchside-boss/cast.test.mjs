import assert from 'node:assert/strict';
import {drawEnemyProjectile,drawCastBoss,clipPatel,installCast,CAST,removeVinsonMatte} from './cast.js';
for(const reduced of [false,true]){
 let stack=0,segments=0;const ctx=new Proxy({},{get(o,k){if(k==='save')return()=>stack++;if(k==='restore')return()=>stack--;if(k==='lineTo')return()=>segments++;return(...args)=>{for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n));};}});
 const p={x:70,y:80,r:9,age:2,tele:.2,vx:-40,vy:50},before=JSON.stringify(p);drawEnemyProjectile(ctx,p,2,reduced);assert.equal(JSON.stringify(p),before);assert.equal(stack,0);assert.equal(segments,16);
 for(const phase of [1,2,3]){drawCastBoss(ctx,{naturalWidth:266,naturalHeight:225},phase);assert.equal(stack,0);}clipPatel(ctx,150,130);
}
// Edge-connected whites become transparent; enclosed white facial detail stays intact.
const pixels=new Uint8ClampedArray(5*5*4);for(let y=0;y<5;y++)for(let x=0;x<5;x++){const i=(y*5+x)*4,v=x===0||y===0||x===4||y===4||x===2&&y===2?255:0;pixels.set([v,v,v,255],i);}removeVinsonMatte(pixels,5,5);assert.equal(pixels[3],0);assert.equal(pixels[(2*5+2)*4+3],255);
class MissingImage{naturalWidth=0;set src(value){queueMicrotask(()=>this.onerror());}}const custom={boss:{},hero:{}};await installCast(custom,MissingImage);assert.equal(CAST.world,null);assert.equal(custom.boss[1],null);
console.log('Cast visuals preserve projectile data, balance Canvas state, preserve face details, and tolerate missing assets');
