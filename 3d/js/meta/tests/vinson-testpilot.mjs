import assert from 'node:assert/strict';
import { createVinsonBattle, vinsonAbilityStats, vinsonEarthPosition, vinsonGravityRadius } from '../core/vinsonbattle.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function segmentDistance(p, s) {
  const dx = s.x2-s.x1, dy = s.y2-s.y1, d = dx*dx+dy*dy;
  const u = d ? clamp(((p.x-s.x1)*dx+(p.y-s.y1)*dy)/d,0,1) : 0;
  return Math.hypot(p.x-(s.x1+u*dx),p.y-(s.y1+u*dy));
}
function hazardClearance(h, x, y, elapsed) {
  const active = elapsed >= h.telegraph;
  const past = elapsed - h.telegraph;
  const body = { x, y: y - 55 };
  if (h.type === 'laserline' || h.type === 'eclipsecross') {
    if (!active || past > h.duration) return 150;
    return Math.min(...h.segments.map(s => segmentDistance(body,s))) - 21;
  }
  if (h.type === 'bombcircle') return active && past <= h.duration ? distance({x,y},h)-h.radius-8 : 150;
  if (h.type === 'handslam') {
    if (past < .3 || past > .6) return 150;
    return distance(body,{x:h.x,y:h.y})-h.radius-10;
  }
  if (h.type === 'handcatch') {
    if (past < .5 || past > .8) return 150;
    return segmentDistance(body,h.corridor)-h.corridor.width/2-19;
  }
  if (h.type === 'earththrow') {
    if (!active || past > h.duration) return 150;
    const at = vinsonEarthPosition({...h,elapsed});
    return distance(body,at)-h.radius-10;
  }
  if (h.type === 'painring') {
    if (!active || past > h.duration) return 150;
    const r = 32 + past * h.ringMax / h.duration;
    return Math.abs(distance({x,y},h)-r)-27;
  }
  if (h.type === 'doomfall') {
    const risk = h.spots.filter(s => past >= s.delay && past <= s.delay+.35)
      .map(s => distance({x,y},s)-s.radius-10);
    return risk.length ? Math.min(...risk) : 150;
  }
  if (h.type === 'gravitywell') {
    if (!active || past > h.duration) return 150;
    return Math.abs(distance(body,h)-vinsonGravityRadius({...h,elapsed}))-23;
  }
  return 150;
}
function bulletClearance(p, x, y, elapsed) {
  const travel = Math.max(0,(p.age||0)+elapsed-(p.telegraph||0))-Math.max(0,(p.age||0)-(p.telegraph||0));
  const at = {x:p.x+p.vx*travel,y:p.y+(p.vy||0)*travel};
  return distance({x,y},at)-(p.radius||8)-9;
}
function riskAt(state, x, y, elapsed) {
  let risk = 0;
  for (const h of state.hazards) {
    const c = hazardClearance(h,x,y,h.elapsed+elapsed);
    if (c < 42) risk += (42-c)*(42-c) * (c < 0 ? 7 : 1);
  }
  if (state.phase === 'dodgebox' && state.box) {
    for (const p of state.box.bullets) {
      if ((p.age||0)+elapsed < (p.telegraph||0)) continue;
      const c = bulletClearance(p,x,y,elapsed);
      if (c < 38) risk += (38-c)*(38-c) * (c < 0 ? 7 : 1);
    }
    const b = state.box;
    if (x < b.minX+18 || x > b.maxX-18 || y < b.minY+18 || y > b.maxY-18) risk += 12000;
  }
  return risk;
}

/** Deterministic 8-way pilot. It reads state only and never edits battle state. */
export function pilotInput(state, tick = 0) {
  const hero = state.hero, active = state.phase === 'fight' || state.phase === 'dodgebox';
  const bounds = state.phase === 'dodgebox' && state.box
    ? {minX:state.box.minX,maxX:state.box.maxX,minY:state.box.minY,maxY:state.box.maxY}
    : {minX:70,maxX:1210,minY:state.stage?350:280,maxY:state.compact?540:640};
  const directions = [
    [0,0], [1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]
  ].map(([x,y]) => {const n=Math.hypot(x,y)||1;return {x:x/n,y:y/n};});
  let chosen = directions[0], best = Infinity;
  const goalX = state.phase === 'dodgebox' ? (bounds.minX+bounds.maxX)/2 : clamp(state.boss.x-300,bounds.minX+80,bounds.maxX-80);
  const goalY = state.phase === 'dodgebox' ? (bounds.minY+bounds.maxY)/2 : clamp(state.boss.y+(hero.bodyRise||40),bounds.minY+35,bounds.maxY-30);
  for (const dir of directions) {
    let score = 0;
    for (const t of [.2,.4,.65,.9,1.2,1.5]) {
      let x=clamp(hero.x+dir.x*300*t,bounds.minX,bounds.maxX);
      let y=clamp(hero.y+dir.y*300*t,bounds.minY,bounds.maxY);
      if (state.phase === 'fight') {
        for (const h of state.hazards) if (h.type==='gravitywell' && h.elapsed+t>=h.telegraph) {
          const dx=h.x-x,dy=h.y+55-y,n=Math.hypot(dx,dy)||1;
          const pull=Math.min(48*Math.max(0,t-Math.max(0,h.telegraph-h.elapsed)),70);
          x=clamp(x+dx/n*pull,bounds.minX,bounds.maxX);y=clamp(y+dy/n*pull,bounds.minY,bounds.maxY);
        }
      }
      score += riskAt(state,x,y,t) / (1+t*.55);
    }
    const goalDistance=Math.hypot(goalX-(hero.x+dir.x*170),goalY-(hero.y+dir.y*170));
    score += goalDistance*.16;
    // Stable tie-break makes identical snapshots choose the same route.
    score += ((tick%9)*.0001) * (Math.abs(dir.x)+Math.abs(dir.y));
    if (score < best) {best=score;chosen=dir;}
  }
  const urgent = active && state.hero.dodgeCooldown <= .05 && !state._dodgeWasDown &&
    riskAt(state,hero.x+chosen.x*75,hero.y+chosen.y*75,.25)>1100;
  const heal = hero.hp < 65 && hero.heals > 0 && hero.healCooldown <= .05 && !state._healWasDown;
  let weapon='star', attack=false;
  if (state.phase === 'fight') {
    const stats=vinsonAbilityStats(state.stage), priority={star:1,spinner:4,explosive:2,eyes:3,constellation:5,nova:0};
    const ready=Object.entries(stats).filter(([key]) => (hero.cooldowns[key]||0)<=.05)
      .sort(([a,sa],[b,sb]) => (sb.damage*priority[b]/sb.cooldown)-(sa.damage*priority[a]/sa.cooldown)||a.localeCompare(b));
    if (ready.length) {weapon=ready[0][0];attack=true;}
  }
  return {x:chosen.x*(hero.invertedTime>0?-1:1),y:chosen.y*(hero.invertedTime>0?-1:1),dodge:urgent,heal,attack,weapon,sequenceKey:state.sequence?.keys[state.sequence.index],combo:state.comboOffer>0};
}

// Standalone integration check; the main test may also import pilotInput directly.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  {
    const battle=createVinsonBattle({seed:909,stage:1});
    battle.step(0,{advance:true});battle.state.hero.hp=60;
    const before=structuredClone(battle.state),input=pilotInput(battle.state,0);
    assert.equal(input.heal,true,'pilot spends a heal below 65 HP when available');
    assert.deepEqual(battle.state,before,'pilot reads state without mutating it');
    battle.step(.05,input);
    assert.equal(battle.state.hero.hp,92);
    assert.equal(battle.state.hero.heals,0);
  }
  for (const seed of [1,2,3]) {
    const battle=createVinsonBattle({seed,stage:1});
    battle.state.thresholdIndex=4;
    battle.step(0,{advance:true});
    for (let tick=0;tick<4800 && battle.state.phase!=='victory' && battle.state.phase!=='defeat';tick++) {
      battle.step(.05,pilotInput(battle.state,tick));
    }
    assert.equal(battle.state.phase,'victory',`seed ${seed} should win with the competent pilot within 240 seconds`);
    assert.ok(battle.state.hero.hp>0 && battle.state.hero.hp<=100,'pilot wins using real bounded health');
    console.log(`pilot seed ${seed}: victory at ${battle.state.time.toFixed(1)}s, HP ${battle.state.hero.hp}`);
  }
}
