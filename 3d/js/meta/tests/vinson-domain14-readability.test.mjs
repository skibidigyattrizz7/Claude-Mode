import assert from 'node:assert/strict';
import {drawDomainClash} from '../ui/vinsonfinalefx.js';
import {vinsonClashStarRadius} from '../ui/vinsonbattle.js';
const calls=[],ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(k==='createRadialGradient')return ()=>({addColorStop(){}});return (...args)=>calls.push([k,...args]);},set(o,k,v){calls.push(['set',k,v]);o[k]=v;return true;}});
assert.equal(vinsonClashStarRadius(1),58,'original52px star is only six pixels bigger');assert.equal(vinsonClashStarRadius(99),58);
calls.length=0;drawDomainClash(ctx,{domainPower:1,mashThreshold:2,mashProgress:.9,clashX:880},4,false,()=>{});
assert.equal(calls.filter(c=>c[0]==='quadraticCurveTo').length,9,'Captain vault pillars oppose the angular red domain');
assert.ok(calls.filter(c=>c[0]==='ellipse').length>=6,'two three-layer dome walls');
console.log('Vinson small original clash star and opposing walls regressions passed');
