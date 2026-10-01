import assert from 'node:assert/strict';
import {drawClashEmblem,drawDomainClash} from '../ui/vinsonfinalefx.js';
const calls=[],ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(k==='createRadialGradient')return ()=>({addColorStop(){}});return (...args)=>calls.push([k,...args]);},set(o,k,v){calls.push(['set',k,v]);o[k]=v;return true;}});
for(const reducedMotion of [false,true]){
 calls.length=0;
 drawClashEmblem(ctx,{hero:'captain',domainPower:1,beams:1,clashPower:1,mashPulse:1,clashX:900},8,reducedMotion);
 assert.ok(calls.some(c=>c[0]==='set'&&c[1]==='globalCompositeOperation'&&c[2]==='source-over'));
 assert.equal(calls.filter(c=>c[0]==='closePath').length,2,'both complete triangles remain visible at full pressure');
 assert.ok(calls.some(c=>c[0]==='set'&&c[1]==='lineWidth'&&c[2]===12),'dark outline separates star from bright beams');
 for(const c of calls.filter(c=>c[0]==='lineTo'||c[0]==='moveTo'))assert.ok(Math.hypot(c[1],c[2])<=108,'bounded star cannot swallow the arena');
 if(reducedMotion)assert.equal(calls.find(c=>c[0]==='rotate')[1],0);
}
calls.length=0;drawDomainClash(ctx,{domainPower:1,mashThreshold:2,mashProgress:.9,clashX:880},4,false,()=>{});
assert.equal(calls.filter(c=>c[0]==='quadraticCurveTo').length,9,'Captain vault pillars oppose the angular red domain');
assert.ok(calls.filter(c=>c[0]==='ellipse').length>=6,'two three-layer dome walls');
calls.length=0;drawClashEmblem(ctx,{hero:'patel',domainPower:1,beams:1},4,false);assert.equal(calls.length,0,'earlier Patel clash unchanged');
console.log('Vinson14 opposing domain walls and full-power star readability passed');
