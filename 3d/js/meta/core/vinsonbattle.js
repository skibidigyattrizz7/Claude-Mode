// DOM-free deterministic rules for the Vinson encounter. Times and positions are seconds and canvas units.
const WIDTH = 1280, HEIGHT = 720;
const ARENA = { minX: 45, maxX: 1235, minY: 280, maxY: 672 };
const COMPACT_MAX_Y = 600;
const MAX_HAZARDS = 8, MAX_PROJECTILES = 32;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bool = value => value === true;

function seedNumber(seed) {
  if (Number.isFinite(seed)) return seed >>> 0 || 0x6d2b79f5;
  let h = 2166136261;
  for (const char of String(seed)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0 || 0x6d2b79f5;
}
function nextRandom(state) {
  let value = state._rngState >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state._rngState = value >>> 0;
  return state._rngState / 4294967296;
}
function attemptSeed(seed, stage, attempt) {
  return (seedNumber(seed) ^ Math.imul(stage + 1, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;
}

/** Sprite-aligned eye anchors, shared by combat math and the renderer. Actor position is sprite-foot center. */
export function battleEyePositions(key, x, y) {
  if(key==='world')return [{x:x-32,y:y-178},{x:x-7,y:y-178}];
  if(key==='captain')return [{x:x+44,y:y-124},{x:x+68,y:y-124}];
  const spread = key === 'world' ? 11 : key === 'phonk' ? 8 : key === 'patel' ? 7*120/175 : 10;
  const rise = key === 'world' ? 145 : key === 'phonk' ? 201 : key === 'patel' ? 117*120/175 : 124;
  return [{ x: x - spread, y: y - rise }, { x: x + spread, y: y - rise }];
}

const bossKey = stage => stage ? 'phonk' : 'world';
const heroKey = stage => stage ? 'captain' : 'patel';
const arenaMaxY = state => state.compact ? COMPACT_MAX_Y : ARENA.maxY;
export function vinsonBossYBounds(compact = false) {
  // The source portrait is 240 canvas units tall. These bounds keep its hair
  // beneath the dedicated bark row at both desktop and short-landscape scales.
  return compact ? { min: 490, max: 520 } : { min: 470, max: 575 };
}
function freshCombat(stage, seed, attempt, totalTime = 0, compact = false) {
  const isFinal = stage === 1;
  return {
    phase: 'intro', time: totalTime, phaseTime: 0, stage, attempt, compact: !!compact,
    hero: { x: 250, y: 425, bodyRise: isFinal ? 55 : 40, hp: 100, maxHp: 100, invulnerable: 0, dodgeCooldown: 0, attackCooldown: 0, cooldowns: {}, heals: 1, healCooldown: 0, invertedTime:0 },
    boss: { x: 990, y: compact ? 490 : 470, hp: isFinal ? 7200 : 4800, maxHp: isFinal ? 7200 : 4800, vx: 0, vy: 0, dodgeCooldown: 0, dodgeTime: 0 },
    hazards: [], projectiles: [], events: [], box: null, timing: null, thresholdIndex: 0,
    sequence:null,sequenceCooldown:0,comboOffer:0,comboTimer:12,combo:null,
    attackTimer: 0.8, nextHazardId: 1, handQueue: [], _lastHand: 'right',
    _rngState: attemptSeed(seed, stage, attempt), _dodgeWasDown: false, _healWasDown: false,
    _timingWasDown: false, _lastAttack: '', _moveSign: 1
  };
}
function event(state, type, extra = {}) { state.events.push({ type, time: state.time, ...extra }); }
function normVector(x, y) {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}
function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, d2 = dx * dx + dy * dy;
  const t = d2 ? clamp(((px - x1) * dx + (py - y1) * dy) / d2, 0, 1) : 0;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
function spawnHazard(state, rng, forcedType = null, forcedHand = null) {
  if (state.hazards.length >= MAX_HAZARDS) return;
  const maxY = arenaMaxY(state);
  const types = ['laserline', 'bombcircle', 'painring', 'handslam', 'handcatch', 'earththrow', 'inversion', 'chains', ...(state.stage?['eclipsecross','doomfall','gravitywell']:[])];
  let choices = types.filter(type => type !== state._lastAttack);
  if (state.stage === 1 && rng() > 0.4) choices = choices.filter(type => type !== 'painring');
  let type = forcedType || choices[Math.floor(rng() * choices.length)];
  if(type==='inversion'||type==='chains'){
    if(!state.sequence&&state.sequenceCooldown<=0){startVinsonSequence(state,type);state._lastAttack=type;}
    return;
  }
  const h = state.hero, b = state.boss;
  const handKey = forcedHand || (state._lastHand === 'left' ? 'right' : 'left');
  const handBusy = key => state.hazards.some(a => a.type === 'handcatch' || (a.type === 'handslam' && (a.handKey || 'left') === key));
  if ((type === 'handslam' && handBusy(handKey)) || (type === 'handcatch' && (handBusy('left') || handBusy('right')))) {
    if (forcedType) return;
    type = 'bombcircle';
  }
  const telegraph = (type === 'handslam' || type === 'handcatch' ? 1.2 : (state.stage ? 0.82 : 0.92)) + rng() * 0.24;
  const origins = battleEyePositions(bossKey(state.stage), b.x, b.y);
  const handSources = [{ x: b.x - 65, y: b.y - 100 }, { x: b.x + 65, y: b.y - 100 }];
  const segments = type === 'eclipsecross' ? [-1,1].map(sign=>({x1:clamp(h.x-sign*420,ARENA.minX,ARENA.maxX),y1:ARENA.minY-25,x2:clamp(h.x+sign*420,ARENA.minX,ARENA.maxX),y2:maxY})) : type === 'laserline' ? origins.map(origin => ({
    x1: origin.x, y1: origin.y,
    x2: clamp(h.x + (rng() - 0.5) * 75, ARENA.minX, ARENA.maxX),
    y2: clamp(h.y - h.bodyRise + (rng() - 0.5) * 65, ARENA.minY - 40, maxY - h.bodyRise)
  })) : [];
  const slamX = clamp(h.x + (rng() - 0.5) * 105, ARENA.minX + 72, ARENA.maxX - 72);
  const slamY = clamp(h.y - h.bodyRise + (rng() - 0.5) * 65, ARENA.minY + 82, maxY - 82);
  // The horizontal danger lane is fixed for the warning and impact window. Players
  // can leave it vertically; its ends remain inside the arena so it is escapable.
  const laneY = clamp(h.y - h.bodyRise + (rng() - 0.5) * 42, ARENA.minY + 45, maxY - 45);
  const corridor = { x1: ARENA.minX - 60, y1: laneY, x2: ARENA.maxX + 60, y2: laneY, width: 54 };
  // The throw starts at the source globe, not at a detached finger.
  const earthSource = {x:b.x-9,y:b.y-94};
  const earthTarget = { x: clamp(h.x + (rng() - 0.5) * 115, ARENA.minX + 55, ARENA.maxX - 55),
    y: clamp(h.y - h.bodyRise + (rng() - 0.5) * 85, ARENA.minY + 35, maxY - 35) };
  const hazard = {
    id: state.nextHazardId++, type, handKey, elapsed: 0, telegraph,
    duration: type==='doomfall'?1.8:type==='gravitywell'?2.1:type==='eclipsecross'?1.1:type === 'painring' ? (state.stage ? 0.95 : 1.15) : type === 'handslam' || type === 'handcatch' ? 1.1 : type === 'earththrow' ? 0.7 : 0.48, hit: false,
    origins, eyeOrigins: origins, handSources, source: earthSource, target: earthTarget, segments,
    x: type==='gravitywell'?clamp(h.x,ARENA.minX+120,ARENA.maxX-120):type === 'bombcircle' ? clamp(h.x + (rng() - 0.5) * 170, ARENA.minX + 65, ARENA.maxX - 65) : type === 'handslam' ? slamX : b.x,
    y: type==='gravitywell'?clamp(h.y-h.bodyRise,ARENA.minY+65,maxY-65):type === 'bombcircle' ? clamp(h.y + (rng() - 0.5) * 155, ARENA.minY + 65, maxY - 65) : type === 'handslam' ? slamY : b.y,
    radius: type === 'bombcircle' ? 68 : type === 'handslam' ? 82 : type === 'earththrow' ? 49 : 0, ringMax: 235,
    ...(type === 'handcatch' ? { corridor } : {})
  };
  if(type==='doomfall')hazard.spots=Array.from({length:5},(_,i)=>({x:clamp(h.x+(i-2)*125+(rng()-.5)*45,ARENA.minX+55,ARENA.maxX-55),y:clamp(h.y+(rng()-.5)*150,ARENA.minY+55,maxY-55),delay:i*.25,radius:52}));
  state.hazards.push(hazard); state._lastAttack = type;
  if (type === 'handslam') state._lastHand = handKey;
  // Alternate the actual two source hands; never clone a hand still on screen.
  if (!forcedType && type === 'handslam' && !state.handQueue.length) {
    const other = handKey === 'left' ? 'right' : 'left';
    state.handQueue.push({delay:.65,handKey:other},{delay:2.7,handKey},{delay:3.35,handKey:other});
  }
  event(state, 'telegraph', { attack: type, hazardId: hazard.id, duration: hazard.telegraph, origins, segments, handSources,
    ...(type === 'earththrow' ? { source: earthSource, target: earthTarget, radius: hazard.radius } : {}),
    ...(type === 'handslam' ? { x: hazard.x, y: hazard.y, radius: hazard.radius } : {}),
    ...(type === 'handcatch' ? { corridor } : {}) });
}
/** Same lifted arc for visual motion and the throw's collision center. */
export function vinsonEarthPosition(hazard) {
  const source=hazard.source,target=hazard.target;
  const tele=clamp(hazard.elapsed/hazard.telegraph,0,1);
  if(hazard.elapsed<hazard.telegraph)return {x:source.x,y:source.y-35*tele};
  const p=clamp((hazard.elapsed-hazard.telegraph)/hazard.duration,0,1);
  return {x:source.x+(target.x-source.x)*p,y:source.y-35+(target.y-source.y+35)*p-75*Math.sin(p*Math.PI)};
}
function hazardHitsHero(hazard, hero) {
  if (hazard.type === 'handslam' &&
      (hazard.elapsed - hazard.telegraph < 0.3 || hazard.elapsed - hazard.telegraph > 0.6)) return false;
  if (hazard.type === 'handcatch' &&
      (hazard.elapsed - hazard.telegraph < 0.5 || hazard.elapsed - hazard.telegraph > 0.8)) return false;
  const bodyY = hero.y - (hero.bodyRise || 40);
  if(hazard.type==='eclipsecross')return hazard.segments.some(s=>pointSegmentDistance(hero.x,bodyY,s.x1,s.y1,s.x2,s.y2)<=19);
  if(hazard.type==='doomfall'){const p=hazard.elapsed-hazard.telegraph;return hazard.spots.some(s=>p>=s.delay&&p<s.delay+.35&&Math.hypot(hero.x-s.x,hero.y-s.y)<=s.radius);}
  if(hazard.type==='gravitywell')return Math.abs(Math.hypot(hero.x-hazard.x,bodyY-hazard.y)-vinsonGravityRadius(hazard))<=14;
  if (hazard.type === 'laserline') return hazard.segments.some(s => pointSegmentDistance(hero.x, bodyY, s.x1, s.y1, s.x2, s.y2) <= 15);
  if (hazard.type === 'bombcircle') return Math.hypot(hero.x - hazard.x, hero.y - hazard.y) <= hazard.radius;
  if (hazard.type === 'handslam') return Math.hypot(hero.x - hazard.x, bodyY - hazard.y) <= hazard.radius;
  if (hazard.type === 'earththrow') {
    const {x,y}=vinsonEarthPosition(hazard);
    return Math.hypot(hero.x - x, bodyY - y) <= hazard.radius;
  }
  if (hazard.type === 'handcatch') {
    const lane = hazard.corridor;
    return pointSegmentDistance(hero.x, bodyY, lane.x1, lane.y1, lane.x2, lane.y2) <= lane.width / 2 + 14;
  }
  const distance = Math.hypot(hero.x - hazard.x, hero.y - hazard.y);
  const radius = 32 + (hazard.elapsed - hazard.telegraph) * hazard.ringMax / hazard.duration;
  return distance<=22 || Math.abs(distance - radius) <= 22;
}
export function vinsonGravityRadius(hazard){return 150-115*clamp((hazard.elapsed-hazard.telegraph)/hazard.duration,0,1);}
function damagePlayer(state, amount, source, position=null) {
  const hero = state.hero;
  if (hero.invulnerable > 0) return;
  hero.hp = Math.max(0, hero.hp - amount); hero.invulnerable = 0.62;
  event(state, 'hit', { target: 'hero', source, amount, hp: hero.hp,
    x:position?.x??hero.x,y:position?.y??hero.y-(hero.bodyRise||40) });
  if (hero.hp <= 0) { state.phase = 'defeat'; state.phaseTime = 0; event(state, 'playerDefeat'); }
}
const WEAPONS = {
  star: { cooldown: .4, damage: 22, speed: 690, radius: 11, life: 2, color: '#67b9ff' },
  spinner: { cooldown: .8, damage: 8, speed: 760, radius: 8, life: 1.7, color: '#8fffe2' },
  explosive: { cooldown: 1.8, damage: 60, speed: 470, radius: 16, life: 2.4, splash: 78, color: '#ffb45f' },
  eyes: { cooldown: 1.2, damage: 40, speed: 620, radius: 10, life: 2, color: '#ff6280' },
  constellation: { cooldown: 2.4, damage: 12, speed: 560, radius: 9, life: 2.4, color: '#9bd6ff', effect: 'constellation' },
  nova: { cooldown: 4.5, damage: 140, speed: 420, radius: 26, life: 3, splash: 125, color: '#ffe4a2', effect: 'starNova' }
};
const CAPTAIN_WEAPONS = {
  star: { cooldown: .65, damage: 42, speed: 620, radius: 14, life: 2.4, color: '#8bcaff', effect: 'returningShield' },
  spinner: { cooldown: 1.2, damage: 14, speed: 650, radius: 9, life: 2, color: '#8fffe2', effect: 'orbitVolley' },
  explosive: { cooldown: 2.2, damage: 90, speed: 455, radius: 18, life: 2.5, splash: 100, color: '#ffb45f', effect: 'groundShockwave' },
  eyes: { cooldown: 1.65, damage: 75, speed: 810, radius: 9, life: 2.1, color: '#ff6280', effect: 'chargedEyeLance' },
  constellation: { cooldown: 3, damage: 28, speed: 570, radius: 12, life: 2.5, color: '#a9f5ff', effect: 'starLattice' },
  nova: { cooldown: 5.4, damage: 220, speed: 480, radius: 30, life: 3, splash: 145, color: '#ffefb5', effect: 'domainStar' }
};
export function vinsonAbilityStats(stage=0){return Object.fromEntries(Object.entries(stage?CAPTAIN_WEAPONS:WEAPONS).map(([key,spec])=>[key,{damage:spec.damage,cooldown:spec.cooldown}]));}
function moveBoss(state, dt) {
  const b = state.boss, stage = state.stage;
  b.dodgeCooldown=Math.max(0,b.dodgeCooldown-dt);
  if(b.dodgeTime>0){
    b.dodgeTime=Math.max(0,b.dodgeTime-dt);b.x+=(b.dodgeX-b.x)*Math.min(1,dt*14);
    b.vx=0;b.vy=0;return;
  }
  const maxY = arenaMaxY(state), bossY = vinsonBossYBounds(state.compact);
  if (state.hazards.some(h => (h.type === 'laserline' || h.type === 'handslam' || h.type === 'handcatch' || h.type === 'earththrow') && h.elapsed < h.telegraph + h.duration)) {
    b.vx = 0; b.vy = 0;
    return; // Lock aim and eye origins to the visible boss while the beam charges and fires.
  }
  const rate = stage ? 1.75 : 1.3, amplitude = stage ? 115 : 88;
  const targetX = 920 + Math.sin(state.time * rate + state.attempt * 0.7) * amplitude;
  const targetY = (state.compact ? 385 : 410) + Math.sin(state.time * rate * 0.73 + 1.1) * (state.compact ? (stage ? 72 : 58) : (stage ? 135 : 95));
  // Smooth, bounded movement. Stage two actively sidesteps repeated incoming shots.
  const dodge = stage ? Math.sin(state.time * 4.2) * 42 : 0;
  const tx = clamp(targetX + dodge, 790, ARENA.maxX - 55), ty = clamp(targetY, bossY.min, bossY.max);
  const blend = Math.min(1, dt * (stage ? 3.4 : 2.6));
  const oldX = b.x, oldY = b.y;
  b.x += (tx - b.x) * blend; b.y += (ty - b.y) * blend;
  b.vx = dt ? (b.x - oldX) / dt : 0; b.vy = dt ? (b.y - oldY) / dt : 0;
}
function fireWeapon(state, weaponName) {
  const hero = state.hero, boss = state.boss, type = WEAPONS[weaponName] ? weaponName : 'star';
  const spec = state.stage ? CAPTAIN_WEAPONS[type] : WEAPONS[type];
  const origins = type === 'eyes' ? battleEyePositions(heroKey(state.stage), hero.x, hero.y) : undefined;
  const start = origins ? { x: (origins[0].x + origins[1].x) / 2, y: (origins[0].y + origins[1].y) / 2 } : { x: hero.x, y: hero.y - (state.stage ? 75 : 50) };
  const target = type === 'eyes' ? battleEyePositions(bossKey(state.stage), boss.x, boss.y)[0] : { x: boss.x, y: boss.y - 100 };
  const dx = target.x - start.x, dy = target.y - start.y, length = Math.hypot(dx, dy) || 1;
  const spread = type === 'spinner' ? (state.stage ? [-0.12, -0.04, 0.04, 0.12] : [-0.055, 0, 0.055]) : type==='constellation' ? [-.18,-.11,-.035,.035,.11,.18] : [0];
  const misfire=nextRandom(state)<(type==='nova'?.12:type==='eyes'?.07:.04);
  const error=misfire?(nextRandom(state)<.5?-1:1)*(.14+nextRandom(state)*.07):0;
  const power=.85+nextRandom(state)*.3;
  for (const offset of spread) {
    const angle = Math.atan2(dy, dx) + offset + error;
    state.projectiles.push({ type, x: start.x + Math.cos(angle) * 22, y: start.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * spec.speed, vy: Math.sin(angle) * spec.speed, radius: spec.radius,
      damage: Math.round(spec.damage*power), life: spec.life, splash: spec.splash || 0, color: spec.color, origins, misfire, dodgeChecked:false,
      effect: spec.effect || type, orbit: state.stage && type === 'spinner' ? offset : 0,
      target: type === 'eyes' ? { ...target } : undefined,
      charge: type==='nova'?.5:state.stage && type==='constellation'?.45:state.stage && type === 'eyes' ? 0.18 : 0,
      latticeIndex:spread.indexOf(offset),
      returning: false, age: 0 });
  }
  hero.cooldowns[type]=spec.cooldown;
  hero.attackCooldown = .18;
  event(state, 'fire', { weapon: type, effect: spec.effect || type, x: hero.x, y: hero.y, origins });
  if(misfire)event(state,'aimError',{weapon:type});
}
function moveHero(state, dt, input, bounds = ARENA) {
  const hero = state.hero;
  const maxY = bounds === ARENA ? arenaMaxY(state) : bounds.maxY;
  const minY = bounds===ARENA?(state.stage?350:bounds.minY):bounds.minY+44;
  const direction=hero.invertedTime>0?-1:1;
  const move = normVector(clamp(finite(input.x)*direction, -1, 1), clamp(finite(input.y)*direction, -1, 1));
  hero.invertedTime=Math.max(0,hero.invertedTime-dt);
  hero.invulnerable = Math.max(0, hero.invulnerable - dt);
  hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
  hero.attackCooldown = Math.max(0, hero.attackCooldown - dt);
  for(const type of Object.keys(hero.cooldowns))hero.cooldowns[type]=Math.max(0,hero.cooldowns[type]-dt);
  hero.healCooldown = Math.max(0, hero.healCooldown - dt);
  const healDown = bool(input.heal), healPressed = healDown && !state._healWasDown; state._healWasDown = healDown;
  if (healPressed && hero.heals > 0 && hero.healCooldown <= 0 && hero.hp < hero.maxHp) {
    hero.heals--; hero.hp = Math.min(hero.maxHp, hero.hp + 32); hero.healCooldown = 1.1;
    event(state, 'heal', { hp: hero.hp, charges: hero.heals });
  }
  const dodgeDown = bool(input.dodge), dodgePressed = dodgeDown && !state._dodgeWasDown; state._dodgeWasDown = dodgeDown;
  let speed = state.sequence?.kind==='chains' ? 85 : 300;
  if (dodgePressed && hero.dodgeCooldown <= 0 && state.sequence?.kind!=='chains') {
    const perfect=bounds===ARENA&&state.hazards.some(h=>h.telegraph-h.elapsed>0&&h.telegraph-h.elapsed<=.15&&hazardHitsHero({...h,elapsed:h.telegraph+(h.type==='handslam'?.35:h.type==='handcatch'?.6:.05)},hero));
    const direction = Math.hypot(move.x, move.y) ? move : { x: -1, y: 0 };
    hero.x = clamp(hero.x + direction.x * 620 * 0.19, bounds.minX, bounds.maxX);
    hero.y = clamp(hero.y + direction.y * 620 * 0.19, minY, maxY);
    hero.invulnerable = 0.38; hero.dodgeCooldown = state.stage ? 0.9 : 0.86; speed = 0;
    event(state, 'dodge', { x: hero.x, y: hero.y });
    if(perfect){hero.hp=Math.min(hero.maxHp,hero.hp+2);event(state,'perfectDodge',{x:hero.x,y:hero.y});}
  }
  hero.x = clamp(hero.x + move.x * speed * dt, bounds.minX, bounds.maxX);
  hero.y = clamp(hero.y + move.y * speed * dt, minY, maxY);
}
function beginBox(state) {
  state.sequence=null;state.comboOffer=0;
  const maxY = state.compact ? 470 : 580;
  state.box = { minX: 320, maxX: 960, minY: state.compact ? 300 : 320,
    maxY, heroRadius: 7, pattern: ['lanes', 'vertical', 'radial', 'beams'][state.thresholdIndex],
    elapsed: 0, duration: 9 + nextRandom(state) * 2, wave: 0, bullets: [], spawnTimer: 0.65,
    pressureTimer: 1.25, pressureWave: 0, preview: null };
  state.projectiles = []; state.hazards = []; state.handQueue = []; state.hero.x = clamp(state.hero.x, 350, 930);
  state.hero.y = clamp(state.hero.y, state.box.minY + 44, maxY - 18);
  setPhase(state, 'dodgebox');
  event(state, 'boxStart', { threshold: state.thresholdIndex + 1, duration: state.box.duration });
}
function beginTiming(state, input) {
  state.box = null;
  state.timing = { elapsed: 0, duration: 3, marker: 0, score: null, result: null, resolved: false, resolvedAt: null };
  state._timingWasDown = bool(input.attack) || bool(input.advance); setPhase(state, 'timing');
  event(state, 'timingStart', { threshold: state.thresholdIndex + 1, duration: state.timing.duration });
}
function updateBox(state, dt, input) {
  const box = state.box;
  moveHero(state, dt, input, box);
  box.elapsed += dt; box.spawnTimer -= dt;
  if (box.spawnTimer < 0.35 && !box.preview) {
    const safe = Math.floor(nextRandom(state) * 5);
    box.preview = { wave: box.wave, safe, remaining: Math.max(0, box.spawnTimer), pattern: box.pattern };
  }
  if (box.preview) box.preview.remaining = Math.max(0, box.spawnTimer);
  if (box.spawnTimer <= 0 && box.elapsed < box.duration - 0.8) {
    const lanes = 5, laneHeight = (box.maxY - box.minY) / lanes;
    const safe = box.preview?.safe ?? Math.floor(nextRandom(state) * lanes);
    const fromRight = box.wave % 2 === 0;
    if (box.pattern === 'radial') {
      const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
      for (let lane = 0; lane < 16 && box.bullets.length < 64; lane++) {
        const gap=Math.round(safe*16/5);
        if ((lane-gap+16)%16<=2) continue;
        const angle = lane * Math.PI / 8 + box.wave*.19, speed = 170 + state.thresholdIndex*18;
        box.bullets.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          radius: 8, wave: box.wave, kind: 'radial', age:0, telegraph:.65 });
      }
    } else {
      for (let lane = 0; lane < lanes && box.bullets.length < 64; lane++) {
        if (lane === safe) continue;
        const vertical = box.pattern === 'vertical';
        const beam = box.pattern === 'beams';
        box.bullets.push({ x: vertical ? box.minX + (box.maxX - box.minX) * (lane + .5) / lanes :
            fromRight ? box.maxX + 18 : box.minX - 18,
          y: vertical ? (fromRight ? box.minY - 18 : box.maxY + 18) : box.minY + laneHeight * (lane + .5),
          vx: vertical ? 0 : fromRight ? -(beam ? 440 : 400) : beam ? 440 : 400,
          vy: vertical ? (fromRight ? 250 : -250) : 0,
          radius: beam ? 13 : vertical ? 10 : 11, wave: box.wave, age:0, telegraph:.55,
          kind: beam ? 'beam' : vertical ? 'vertical' : 'lane' });
      }
    }
    box.wave++; box.preview = null; box.spawnTimer += box.pattern === 'radial' ? .95 : .85;
  }
  // A second, independent layer targets a snapshot of the player's position.
  // Its warning is visible before motion; the fan never homes after launch.
  box.pressureTimer -= dt;
  if (box.pressureTimer <= 0 && box.elapsed < box.duration - 1.2) {
    const fromTop = box.pressureWave % 2 === 0;
    const x = clamp(state.hero.x + (nextRandom(state)-.5)*240, box.minX+28,box.maxX-28);
    const y = fromTop ? box.minY+12 : box.maxY-12;
    const target = {x:state.hero.x,y:state.hero.y};
    const angle = Math.atan2(target.y-y,target.x-x);
    const count = 3 + (state.thresholdIndex >= 2 ? 2 : 0);
    for (let i=0; i<count && box.bullets.length<64; i++) {
      const a=angle+(i-(count-1)/2)*.22, speed=210+state.thresholdIndex*25;
      box.bullets.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,radius:7,kind:'aimed',wave:box.pressureWave,age:0,telegraph:.7,target});
    }
    box.pressureWave++;box.pressureTimer+=1.15-state.thresholdIndex*.09;
  }
  for (let i = box.bullets.length - 1; i >= 0; i--) {
    const bullet = box.bullets[i], previous=bullet.age||0;
    bullet.age=previous+dt;
    const travel=Math.max(0,bullet.age-(bullet.telegraph||0))-Math.max(0,previous-(bullet.telegraph||0));
    bullet.x += bullet.vx * travel; bullet.y += (bullet.vy || 0) * travel;
    if (bullet.age < (bullet.telegraph||0)) continue;
    if (Math.hypot(bullet.x - state.hero.x, bullet.y - state.hero.y) < bullet.radius + box.heroRadius) {
      damagePlayer(state, state.stage ? 12 : 10, 'box',{x:state.hero.x,y:state.hero.y}); box.bullets.splice(i, 1);
    } else if (bullet.x < box.minX - 25 || bullet.x > box.maxX + 25 ||
      bullet.y < box.minY - 25 || bullet.y > box.maxY + 25) box.bullets.splice(i, 1);
  }
  if (state.phase === 'defeat') return;
  if (box.elapsed >= box.duration) {state.hero.heals++;event(state,'healCharge',{charges:state.hero.heals});beginTiming(state, input);}
}
export function startVinsonSequence(state,kind){
  if(state.sequence||state.phase!=='fight')return false;
  const pool=['q','e','r','f'];
  state.sequence={kind,keys:Array.from({length:3},()=>pool.splice(Math.floor(nextRandom(state)*pool.length),1)[0]),
    index:0,remaining:kind==='chains'?4.5:3.5,origin:{x:state.boss.x,y:state.boss.y-80}};
  state.sequenceCooldown=10;
  event(state,'sequenceStart',{kind,keys:state.sequence.keys.slice()});return true;
}
function updateSequence(state,dt,input){
  state.sequenceCooldown=Math.max(0,state.sequenceCooldown-dt);
  const s=state.sequence;if(!s)return;
  s.remaining-=dt;
  const key=typeof input.sequenceKey==='string'?input.sequenceKey.toLowerCase():null;
  if(key){
    if(key===s.keys[s.index]){s.index++;event(state,'sequenceKey',{kind:s.kind,index:s.index});}
    else if(s.kind==='inversion'){state.hero.invertedTime=6;state.sequence=null;event(state,'inverted',{duration:6});return;}
    else{s.index=0;damagePlayer(state,8,'chains');event(state,'sequenceWrong',{kind:s.kind});}
  }
  if(s.index===s.keys.length){state.sequence=null;event(state,'sequenceEscape',{kind:s.kind});return;}
  if(s.remaining<=0){
    if(s.kind==='inversion'){state.hero.invertedTime=6;event(state,'inverted',{duration:6});}
    else damagePlayer(state,22,'chains');
    state.sequence=null;return;
  }
  if(s.kind==='chains'){
    const d=normVector(s.origin.x-state.hero.x,s.origin.y+state.hero.bodyRise-state.hero.y);
    state.hero.x=clamp(state.hero.x+d.x*145*dt,ARENA.minX,ARENA.maxX);
    state.hero.y=clamp(state.hero.y+d.y*145*dt,state.stage?350:ARENA.minY,arenaMaxY(state));
  }
}
export function triggerVinsonCombo(state){
  if(state.phase!=='fight'||state.comboOffer<=0||state.combo)return false;
  state.comboOffer=0;state.combo={elapsed:0,duration:1.15,damage:state.stage?330:210,
    from:{x:state.hero.x,y:state.hero.y},target:{x:state.boss.x,y:state.boss.y-100}};
  state.hero.invulnerable=1.4;event(state,'comboStart',{});return true;
}
function updateCombo(state,dt){
  const c=state.combo;c.elapsed+=dt;
  if(c.elapsed<c.duration)return;
  const gate=state.thresholdIndex<4?state.boss.maxHp*(1-(state.thresholdIndex+1)*.2):0;
  const amount=Math.min(c.damage,Math.max(0,state.boss.hp-gate));state.boss.hp=Math.max(gate,state.boss.hp-c.damage);
  event(state,'hit',{target:'boss',weapon:'combo',amount,hp:state.boss.hp,x:c.target.x,y:c.target.y});state.combo=null;
  if(state.thresholdIndex<4&&state.boss.hp<=gate+1e-8){beginBox(state);return;}
  if(state.boss.hp<=0){setPhase(state,state.stage?'clash':'transition');event(state,'bossDefeat',{stage:state.stage});}
}
function updateTiming(state, dt, input) {
  const timing = state.timing;
  timing.elapsed += dt;
  if (timing.resolved) {
    if (timing.elapsed - timing.resolvedAt >= 0.85) {
      state.hero.y = clamp(state.hero.y, state.stage ? 350 : 330, arenaMaxY(state));
      state.attackTimer = 0.9; setPhase(state, 'fight');
    }
    return;
  }
  // Triangular sweep crosses center at 0.375 seconds, then every 0.75 seconds.
  timing.marker = 1 - Math.abs((timing.elapsed % 1.5) / 0.75 - 1);
  const down = bool(input.attack) || bool(input.advance);
  const pressed = down && !state._timingWasDown; state._timingWasDown = down;
  if (!pressed && timing.elapsed < timing.duration) return;
  timing.score = pressed ? (Math.abs(timing.marker - 0.5) <= 0.07 ? 'perfect' :
    Math.abs(timing.marker - 0.5) <= 0.18 ? 'good' : 'miss') : 'timeout';
  const chance = { perfect: 0.04, good: 0.13, miss: 0.43, timeout: 1 }[timing.score];
  timing.result = nextRandom(state) < chance ? 'dodged' : 'hit'; timing.resolved = true;
  timing.resolvedAt = timing.elapsed;
  if (timing.result === 'hit') {
    const amount = timing.score === 'perfect' ? 90 : timing.score === 'good' ? 65 : 38;
    state.boss.hp = Math.max(0, state.boss.hp - amount);
    event(state, 'hit', { target: 'boss', weapon: 'timing', amount, hp: state.boss.hp });
  }
  event(state, 'timingResult', { score: timing.score, result: timing.result, threshold: state.thresholdIndex + 1 });
  state.thresholdIndex++;
}
function updateFight(state, dt, input) {
  const hero = state.hero, boss = state.boss;
  const maxY = arenaMaxY(state);
  if(state.combo){updateCombo(state,dt);return;}
  state.comboOffer=Math.max(0,state.comboOffer-dt);state.comboTimer-=dt;
  if(state.comboTimer<=0){state.comboTimer=12+nextRandom(state)*6;if(nextRandom(state)<.35){state.comboOffer=5;event(state,'comboOffer',{duration:5});}}
  if(bool(input.combo)&&triggerVinsonCombo(state)){updateCombo(state,dt);return;}
  updateSequence(state,dt,input);if(state.phase==='defeat')return;
  moveHero(state, dt, input);
  for(const h of state.hazards)if(['gravitywell','painring'].includes(h.type)&&h.elapsed>=h.telegraph){const direction=normVector(h.x-hero.x,h.y+(h.type==='painring'?0:hero.bodyRise)-hero.y);const force=h.type==='painring'?110:72;hero.x=clamp(hero.x+direction.x*force*dt,ARENA.minX,ARENA.maxX);hero.y=clamp(hero.y+direction.y*force*dt,state.stage?350:ARENA.minY,maxY);}
  moveBoss(state, dt);
  if (bool(input.attack) && hero.attackCooldown <= 0 && (hero.cooldowns[input.weapon||'star']||0)<=0 && state.projectiles.length < MAX_PROJECTILES - 6) fireWeapon(state, input.weapon);

  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i], oldX = p.x, oldY = p.y;
    p.age += dt;
    if (p.effect === 'groundShockwave' && p.waveRadius !== undefined) {
      p.waveRadius += 300 * dt; p.life -= dt;
      if (p.life <= 0 || p.waveRadius >= p.splash) state.projectiles.splice(i, 1);
      continue;
    }
    if (p.charge > 0) {
      p.charge = Math.max(0, p.charge - dt);
      if(p.effect==='starLattice'){
        const a=p.latticeIndex*Math.PI/3+p.age*2;p.x=hero.x+Math.cos(a)*48;p.y=hero.y-75+Math.sin(a)*36;
        if(p.charge<=0){const d=normVector(boss.x-p.x,boss.y-100-p.y),speed=Math.hypot(p.vx,p.vy);p.vx=d.x*speed;p.vy=d.y*speed;}
      }else{
        const eyes = battleEyePositions(heroKey(state.stage), hero.x, hero.y);
        p.x = (eyes[0].x + eyes[1].x) / 2; p.y = (eyes[0].y + eyes[1].y) / 2;
      }
      continue;
    }
    if (p.effect === 'returningShield' && !p.returning && p.age >= 1.6) p.returning = true;
    if (p.returning) {
      const dir = normVector(hero.x - p.x, hero.y - 75 - p.y);
      p.vx = dir.x * 760; p.vy = dir.y * 760;
    }
    if (p.effect === 'orbitVolley') {
      const turn = p.orbit * 4 * dt;
      const vx = p.vx, vy = p.vy;
      p.vx = vx * Math.cos(turn) - vy * Math.sin(turn);
      p.vy = vx * Math.sin(turn) + vy * Math.cos(turn);
    }
    if (p.type === 'eyes' && !p.misfire) {
      // The lance follows the current eye, including a boss sidestep after launch.
      p.target = battleEyePositions(bossKey(state.stage), boss.x, boss.y)[0];
      const direction = normVector(p.target.x - p.x, p.target.y - p.y);
      const speed = Math.hypot(p.vx, p.vy); p.vx = direction.x * speed; p.vy = direction.y * speed;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.returning && Math.hypot(p.x - hero.x, p.y - (hero.y - 75)) <= p.radius + 18) {
      state.projectiles.splice(i, 1); continue;
    }
    const targetY = p.type === 'eyes' ? battleEyePositions(bossKey(state.stage), boss.x, boss.y)[0].y : boss.y - 100;
    const distanceToBoss = pointSegmentDistance(boss.x, targetY, oldX, oldY, p.x, p.y);
    if(!p.dodgeChecked&&distanceToBoss<p.radius+105){
      p.dodgeChecked=true;
      const aimLocked=state.hazards.some(h=>['laserline','handslam','handcatch','earththrow'].includes(h.type));
      if(!aimLocked&&boss.dodgeCooldown<=0&&nextRandom(state)<(state.stage?.2:.1)){
        boss.dodgeTime=.28;boss.dodgeCooldown=3.2;
        boss.dodgeX=clamp(boss.x+(nextRandom(state)<.5?-90:90),790,ARENA.maxX-55);
        event(state,'bossDodge',{x:boss.x,y:boss.y,targetX:boss.dodgeX});
      }
    }
    if(boss.dodgeTime>0)continue;
    if (!p.returning && (distanceToBoss <= p.radius + 39 || (p.splash && distanceToBoss <= p.splash))) {
      const damage = p.damage * (distanceToBoss <= p.radius + 39 ? 1 : 0.68);
      const gate = state.thresholdIndex < 4 ? boss.maxHp * (1 - (state.thresholdIndex + 1) * 0.2) : 0;
      const applied = Math.min(damage, Math.max(0, boss.hp - gate));
      boss.hp = Math.max(gate, boss.hp - damage);
      event(state, 'hit', { target: 'boss', weapon: p.type, amount: applied, hp: boss.hp });
      if (p.effect === 'returningShield') p.returning = true;
      else if (p.effect === 'groundShockwave') {
        p.x = boss.x; p.y = boss.y - 100; p.vx = 0; p.vy = 0;
        p.waveRadius = 10; p.life = 0.3; p.hitOnce = true;
        event(state, 'shockwave', { x: p.x, y: p.y, radius: p.splash, damage });
      } else state.projectiles.splice(i, 1);
      if (state.thresholdIndex < 4 && boss.hp <= gate + 1e-8) { beginBox(state); return; }
      if (boss.hp <= 0) {
        state.phase = state.stage === 0 ? 'transition' : 'clash'; state.phaseTime = 0;
        event(state, 'bossDefeat', { stage: state.stage }); if (state.phase === 'clash') event(state, 'clashStart'); return;
      }
    } else if (p.life <= 0 || p.x < ARENA.minX - 50 || p.x > ARENA.maxX + 50 || p.y < 0 || p.y > maxY + 50) state.projectiles.splice(i, 1);
  }
  state.attackTimer -= dt;
  if (state.attackTimer <= 0 && boss.dodgeTime<=0) {
    spawnHazard(state, () => nextRandom(state), state._openingAttack||null);state._openingAttack=null;
    state.attackTimer = (state.stage ? .95 : 1.1) + nextRandom(state) * .22;
  }
  for (let i=state.handQueue.length-1;i>=0;i--) {
    const next=state.handQueue[i];next.delay-=dt;
    if(next.delay<=0){spawnHazard(state,()=>nextRandom(state),'handslam',next.handKey);state.handQueue.splice(i,1);}
  }
  for (let i = state.hazards.length - 1; i >= 0; i--) {
    const hazard = state.hazards[i]; hazard.elapsed += dt;
    if (hazard.elapsed >= hazard.telegraph && !hazard.hit && hazardHitsHero(hazard, hero)) {
      damagePlayer(state, hazard.type === 'bombcircle' || hazard.type === 'handslam' || hazard.type === 'handcatch' ? 22 : state.stage ? 20 : 17, hazard.type); hazard.hit = true;
    }
    if (state.phase === 'defeat') return;
    if (hazard.elapsed >= hazard.telegraph + hazard.duration) state.hazards.splice(i, 1);
  }
}
function setPhase(state, phase) { state.phase = phase; state.phaseTime = 0; }

/** Create a deterministic, renderer-independent playable boss encounter. */
export function createVinsonBattle({ seed = 1, stage = 0, compact = false, openingAttack = null } = {}) {
  const initialSeed = seedNumber(seed); let state = freshCombat(stage === 1 ? 1 : 0, initialSeed, 0, 0, compact);
  state._openingAttack=['laserline','painring','chains','inversion'].includes(openingAttack)?openingAttack:null;
  function step(dt, input = {}) {
    const delta = Math.min(0.05, Math.max(0, finite(dt)));
    if (state.phase === 'defeat' || state.phase === 'victory' || state.phase === 'transition') return state;
    state.events = []; state.time += delta; state.phaseTime += delta;
    if (state.phase === 'intro') { if (bool(input.advance)) setPhase(state, 'fight'); }
    else if (state.phase === 'fight') updateFight(state, delta, input || {});
    else if (state.phase === 'dodgebox') updateBox(state, delta, input || {});
    else if (state.phase === 'timing') updateTiming(state, delta, input || {});
    else if (state.phase === 'clash' && state.phaseTime >= 3.2) { setPhase(state, 'victory'); event(state, 'victory'); }
    return state;
  }
  function retry() { const stageNow = state.stage, attempt = state.attempt + 1, totalTime = state.time, compactNow = state.compact; state = freshCombat(stageNow, initialSeed, attempt, totalTime, compactNow); return state; }
  function next() { if (state.phase !== 'transition' || state.stage !== 0) return state; state = freshCombat(1, initialSeed, 0, state.time, state.compact); return state; }
  return { get state() { return state; }, step, retry, next };
}
export const VINSON_BATTLE_ARENA = Object.freeze({ width: WIDTH, height: HEIGHT, compactMaxY: COMPACT_MAX_Y, ...ARENA });
