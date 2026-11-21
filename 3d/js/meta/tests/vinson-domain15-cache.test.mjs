import assert from 'node:assert/strict';
import {drawDomainClash,warmVinsonDomains,vinsonDomainWallX} from '../ui/vinsonfinalefx.js';
assert.equal(vinsonDomainWallX(337,{clashX:800,mashProgress:.9},0,true),800,'beam centre remains on the curved pressure wall');
assert.ok(vinsonDomainWallX(0,{clashX:800,mashProgress:.9},0,true)<800,'stronger Captain domain bulges forward at contact');
assert.ok(vinsonDomainWallX(0,{clashX:800,mashProgress:.1},0,true)>800,'pressure reverses wall bend');
let surfaces=0,gradients=0,draws=0;
const context=()=>new Proxy({}, {get(o,k){if(k in o)return o[k];if(k==='createRadialGradient')return ()=>{gradients++;return {addColorStop(){}};};if(k==='drawImage')return ()=>draws++;return ()=>{};},set(o,k,v){if(k==='shadowBlur')assert.equal(v,0,'no software blur pass');o[k]=v;return true;}});
const saved=globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas=class{constructor(w,h){surfaces++;this.width=w;this.height=h;this.ctx=context();}getContext(){return this.ctx;}};
try{
 warmVinsonDomains();const builds=surfaces,paints=gradients;
 const ctx=context();for(let i=0;i<60;i++)drawDomainClash(ctx,{domainPower:1,clashX:640,mashThreshold:2,mashPulse:.8},i/60,false,()=>{});
 assert.equal(surfaces,builds,'warmup pre-renders all floor and glow tiles');assert.equal(gradients,paints,'gradients are not rebuilt on animation frames');assert.ok(draws>60,'cached bitmaps are reused');assert.ok(builds<=10,'tile count bounded');
 console.log('Vinson15 warmed domain tiles reused without per-frame gradient allocation or blur');
}finally{if(saved===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=saved;}
