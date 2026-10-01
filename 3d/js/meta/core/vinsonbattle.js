// DOM-free deterministic rules for the Vinson encounter. Times and positions are seconds and canvas units.
const WIDTH = 1280, HEIGHT = 720;
const ARENA = { minX: 100, maxX: 1180, minY: 330, maxY: 640 };
const COMPACT_MAX_Y = 480;
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
  if(key==='captain')return [{x:x+44,y:y-124},{x:x+68,y:y-124}];
  const spread = key === 'world' ? 11 : key === 'phonk' ? 8 : key === 'patel' ? 7 : 10;
  const rise = key === 'world' ? 145 : key === 'phonk' ? 201 : key === 'patel' ? 117 : 124;
  return [{ x: x - spread, y: y - rise }, { x: x + spread, y: y - rise }];
}

const bossKey = stage => stage ? 'phonk' : 'world';
const heroKey = stage => stage ? 'captain' : 'patel';
const arenaMaxY = state => state.compact ? COMPACT_MAX_Y : ARENA.maxY;
function freshCombat(stage, seed, attempt, totalTime = 0, compact = false) {
  const isFinal = stage === 1;
  return {
    phase: 'intro', time: totalTime, phaseTime: 0, stage, attempt, compact: !!compact,
    hero: { x: 250, y: 425, hp: 100, maxHp: 100, invulnerable: 0, dodgeCooldown: 0, attackCooldown: 0, heals: 3, healCooldown: 0 },
    // Tuned for roughly 30–55 seconds of accurate sustained damage per stage.
    boss: { x: 990, y: compact ? 415 : 425, hp: isFinal ? 950 : 880, maxHp: isFinal ? 950 : 880, vx: 0, vy: 0 },
    hazards: [], projectiles: [], events: [], box: null, timing: null, thresholdIndex: 0,
    attackTimer: 0.8, nextHazardId: 1,
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
function spawnHazard(state, rng) {
  if (state.hazards.length >= MAX_HAZARDS) return;
  const maxY = arenaMaxY(state);
  const types = ['laserline', 'bombcircle', 'painring', 'handslam', 'handcatch', 'earththrow'];
  let choices = types.filter(type => type !== state._lastAttack);
  if (state.stage === 1 && rng() > 0.4) choices = choices.filter(type => type !== 'painring');
  const type = choices[Math.floor(rng() * choices.length)], h = state.hero, b = state.boss;
  const telegraph = (type === 'handslam' || type === 'handcatch' ? 1.2 : (state.stage ? 0.82 : 0.92)) + rng() * 0.24;
  const origins = battleEyePositions(bossKey(state.stage), b.x, b.y);
  const handSources = [{ x: b.x - 65, y: b.y - 100 }, { x: b.x + 65, y: b.y - 100 }];
  const segments = type === 'laserline' ? origins.map(origin => ({
    x1: origin.x, y1: origin.y,
    x2: clamp(h.x + (rng() - 0.5) * 75, ARENA.minX, ARENA.maxX),
    y2: clamp(h.y - 85 + (rng() - 0.5) * 65, ARENA.minY - 90, maxY - 85)
  })) : [];
  const slamX = clamp(h.x + (rng() - 0.5) * 105, ARENA.minX + 72, ARENA.maxX - 72);
  const slamY = clamp(h.y - 55 + (rng() - 0.5) * 65, ARENA.minY + 72, maxY - 72);
  // The horizontal danger lane is fixed for the warning and impact window. Players
  // can leave it vertically; its ends remain inside the arena so it is escapable.
  const laneY = clamp(h.y - 55 + (rng() - 0.5) * 42, ARENA.minY + 72, maxY - 72);
  const corridor = { x1: ARENA.minX - 60, y1: laneY, x2: ARENA.maxX + 60, y2: laneY, width: 54 };
  const earthSource = handSources[Math.floor(rng() * handSources.length)];
  const earthTarget = { x: clamp(h.x + (rng() - 0.5) * 115, ARENA.minX + 55, ARENA.maxX - 55),
    y: clamp(h.y - 55 + (rng() - 0.5) * 85, ARENA.minY + 45, maxY - 55) };
  const hazard = {
    id: state.nextHazardId++, type, elapsed: 0, telegraph,
    duration: type === 'painring' ? (state.stage ? 0.95 : 1.15) : type === 'handslam' || type === 'handcatch' ? 1.1 : type === 'earththrow' ? 0.7 : 0.48, hit: false,
    origins, eyeOrigins: origins, handSources, source: earthSource, target: earthTarget, segments,
    x: type === 'bombcircle' ? clamp(h.x + (rng() - 0.5) * 170, ARENA.minX + 65, ARENA.maxX - 65) : type === 'handslam' ? slamX : b.x,
    y: type === 'bombcircle' ? clamp(h.y + (rng() - 0.5) * 155, ARENA.minY + 65, maxY - 65) : type === 'handslam' ? slamY : b.y,
    radius: type === 'bombcircle' ? 68 : type === 'handslam' ? 82 : type === 'earththrow' ? 49 : 0, ringMax: 235,
    ...(type === 'handcatch' ? { corridor } : {})
  };
  state.hazards.push(hazard); state._lastAttack = type;
  event(state, 'telegraph', { attack: type, hazardId: hazard.id, duration: hazard.telegraph, origins, segments, handSources,
    ...(type === 'earththrow' ? { source: earthSource, target: earthTarget, radius: hazard.radius } : {}),
    ...(type === 'handslam' ? { x: hazard.x, y: hazard.y, radius: hazard.radius } : {}),
    ...(type === 'handcatch' ? { corridor } : {}) });
}
function hazardHitsHero(hazard, hero) {
  if (hazard.type === 'handslam' &&
      (hazard.elapsed - hazard.telegraph < 0.3 || hazard.elapsed - hazard.telegraph > 0.6)) return false;
  if (hazard.type === 'handcatch' &&
      (hazard.elapsed - hazard.telegraph < 0.5 || hazard.elapsed - hazard.telegraph > 0.8)) return false;
  if (hazard.type === 'laserline') return hazard.segments.some(s => pointSegmentDistance(hero.x, hero.y - 85, s.x1, s.y1, s.x2, s.y2) <= 19);
  if (hazard.type === 'bombcircle') return Math.hypot(hero.x - hazard.x, hero.y - hazard.y) <= hazard.radius;
  if (hazard.type === 'handslam') return Math.hypot(hero.x - hazard.x, hero.y - 55 - hazard.y) <= hazard.radius;
  if (hazard.type === 'earththrow') {
    const progress = clamp((hazard.elapsed - hazard.telegraph) / hazard.duration, 0, 1);
    const x = hazard.source.x + (hazard.target.x - hazard.source.x) * progress;
    const y = hazard.source.y + (hazard.target.y - hazard.source.y) * progress - 75 * Math.sin(progress * Math.PI);
    return Math.hypot(hero.x - x, hero.y - 55 - y) <= hazard.radius;
  }
  if (hazard.type === 'handcatch') {
    const lane = hazard.corridor;
    return pointSegmentDistance(hero.x, hero.y - 55, lane.x1, lane.y1, lane.x2, lane.y2) <= lane.width / 2 + 17;
  }
  const distance = Math.hypot(hero.x - hazard.x, hero.y - hazard.y);
  const radius = 32 + (hazard.elapsed - hazard.telegraph) * hazard.ringMax / hazard.duration;
  return Math.abs(distance - radius) <= 22;
}
function damagePlayer(state, amount, source) {
  const hero = state.hero;
  if (hero.invulnerable > 0) return;
  hero.hp = Math.max(0, hero.hp - amount); hero.invulnerable = 0.62;
  event(state, 'hit', { target: 'hero', source, amount, hp: hero.hp });
  if (hero.hp <= 0) { state.phase = 'defeat'; state.phaseTime = 0; event(state, 'playerDefeat'); }
}
const WEAPONS = {
  star: { cooldown: 0.36, damage: 18, speed: 690, radius: 11, life: 2, color: '#67b9ff' },
  spinner: { cooldown: 0.24, damage: 3, speed: 760, radius: 8, life: 1.7, color: '#8fffe2' },
  explosive: { cooldown: 0.82, damage: 34, speed: 470, radius: 16, life: 2.4, splash: 78, color: '#ffb45f' },
  eyes: { cooldown: 0.62, damage: 25, speed: 620, radius: 10, life: 2, color: '#ff6280' }
};
const CAPTAIN_WEAPONS = {
  star: { cooldown: 0.42, damage: 24, speed: 620, radius: 14, life: 2.4, color: '#8bcaff', effect: 'returningShield' },
  spinner: { cooldown: 0.42, damage: 7, speed: 650, radius: 9, life: 2, color: '#8fffe2', effect: 'orbitVolley' },
  explosive: { cooldown: 0.92, damage: 47, speed: 455, radius: 18, life: 2.5, splash: 100, color: '#ffb45f', effect: 'groundShockwave' },
  eyes: { cooldown: 0.85, damage: 37, speed: 810, radius: 9, life: 2.1, color: '#ff6280', effect: 'chargedEyeLance' }
};
function moveBoss(state, dt) {
  const b = state.boss, stage = state.stage;
  const maxY = arenaMaxY(state);
  if (state.hazards.some(h => (h.type === 'laserline' || h.type === 'handslam' || h.type === 'handcatch' || h.type === 'earththrow') && h.elapsed < h.telegraph + h.duration)) {
    b.vx = 0; b.vy = 0;
    return; // Lock aim and eye origins to the visible boss while the beam charges and fires.
  }
  const rate = stage ? 1.75 : 1.3, amplitude = stage ? 115 : 88;
  const targetX = 920 + Math.sin(state.time * rate + state.attempt * 0.7) * amplitude;
  const targetY = (state.compact ? 385 : 410) + Math.sin(state.time * rate * 0.73 + 1.1) * (state.compact ? (stage ? 72 : 58) : (stage ? 135 : 95));
  // Smooth, bounded movement. Stage two actively sidesteps repeated incoming shots.
  const dodge = stage ? Math.sin(state.time * 4.2) * 42 : 0;
  const tx = clamp(targetX + dodge, 790, ARENA.maxX - 55), ty = clamp(targetY, ARENA.minY + 55, maxY - 65);
  const blend = Math.min(1, dt * (stage ? 3.4 : 2.6));
  const oldX = b.x, oldY = b.y;
  b.x += (tx - b.x) * blend; b.y += (ty - b.y) * blend;
  b.vx = dt ? (b.x - oldX) / dt : 0; b.vy = dt ? (b.y - oldY) / dt : 0;
}
function fireWeapon(state, weaponName) {
  const hero = state.hero, boss = state.boss, type = WEAPONS[weaponName] ? weaponName : 'star';
  const spec = state.stage ? CAPTAIN_WEAPONS[type] : WEAPONS[type];
  const origins = type === 'eyes' ? battleEyePositions(heroKey(state.stage), hero.x, hero.y) : undefined;
  const start = origins ? { x: (origins[0].x + origins[1].x) / 2, y: (origins[0].y + origins[1].y) / 2 } : { x: hero.x, y: hero.y - 75 };
  const target = type === 'eyes' ? battleEyePositions(bossKey(state.stage), boss.x, boss.y)[0] : { x: boss.x, y: boss.y - 100 };
  const dx = target.x - start.x, dy = target.y - start.y, length = Math.hypot(dx, dy) || 1;
  const spread = type === 'spinner' ? (state.stage ? [-0.12, -0.04, 0.04, 0.12] : [-0.055, 0, 0.055]) : [0];
  for (const offset of spread) {
    const angle = Math.atan2(dy, dx) + offset;
    state.projectiles.push({ type, x: start.x + Math.cos(angle) * 22, y: start.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * spec.speed, vy: Math.sin(angle) * spec.speed, radius: spec.radius,
      damage: spec.damage, life: spec.life, splash: spec.splash || 0, color: spec.color, origins,
      effect: spec.effect || type, orbit: state.stage && type === 'spinner' ? offset : 0,
      target: type === 'eyes' ? { ...target } : undefined,
      charge: state.stage && type === 'eyes' ? 0.18 : 0,
      returning: false, age: 0 });
  }
  hero.attackCooldown = spec.cooldown;
  event(state, 'fire', { weapon: type, effect: spec.effect || type, x: hero.x, y: hero.y, origins });
}
function moveHero(state, dt, input, bounds = ARENA) {
  const hero = state.hero;
  const maxY = bounds === ARENA ? arenaMaxY(state) : bounds.maxY;
  const minY = bounds === ARENA ? (state.stage ? 350 : 330) : bounds.minY;
  const move = normVector(clamp(finite(input.x), -1, 1), clamp(finite(input.y), -1, 1));
  hero.invulnerable = Math.max(0, hero.invulnerable - dt);
  hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
  hero.attackCooldown = Math.max(0, hero.attackCooldown - dt);
  hero.healCooldown = Math.max(0, hero.healCooldown - dt);
  const healDown = bool(input.heal), healPressed = healDown && !state._healWasDown; state._healWasDown = healDown;
  if (healPressed && hero.heals > 0 && hero.healCooldown <= 0 && hero.hp < hero.maxHp) {
    hero.heals--; hero.hp = Math.min(hero.maxHp, hero.hp + 32); hero.healCooldown = 1.1;
    event(state, 'heal', { hp: hero.hp, charges: hero.heals });
  }
  const dodgeDown = bool(input.dodge), dodgePressed = dodgeDown && !state._dodgeWasDown; state._dodgeWasDown = dodgeDown;
  let speed = 300;
  if (dodgePressed && hero.dodgeCooldown <= 0) {
    const direction = Math.hypot(move.x, move.y) ? move : { x: -1, y: 0 };
    hero.x = clamp(hero.x + direction.x * 620 * 0.19, bounds.minX, bounds.maxX);
    hero.y = clamp(hero.y + direction.y * 620 * 0.19, minY, maxY);
    hero.invulnerable = 0.38; hero.dodgeCooldown = state.stage ? 0.9 : 0.86; speed = 0;
    event(state, 'dodge', { x: hero.x, y: hero.y });
  }
  hero.x = clamp(hero.x + move.x * speed * dt, bounds.minX, bounds.maxX);
  hero.y = clamp(hero.y + move.y * speed * dt, minY, maxY);
}
function beginBox(state) {
  const maxY = state.compact ? 470 : 580;
  state.box = { minX: 320, maxX: 960, minY: state.compact ? 300 : 320,
    maxY, heroRadius: 7, pattern: ['lanes', 'vertical', 'radial', 'beams'][state.thresholdIndex],
    elapsed: 0, duration: 9 + nextRandom(state) * 2, wave: 0, bullets: [], spawnTimer: 0.65,
    preview: null };
  state.projectiles = []; state.hazards = []; state.hero.x = clamp(state.hero.x, 350, 930);
  state.hero.y = clamp(state.hero.y, state.box.minY + 18, maxY - 18);
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
      for (let lane = 0; lane < 12 && box.bullets.length < 24; lane++) {
        if (lane === safe * 2 || lane === safe * 2 + 1 || lane === (safe * 2 + 2) % 12) continue;
        const angle = lane * Math.PI / 6, speed = 130;
        box.bullets.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          radius: 9, wave: box.wave, kind: 'radial' });
      }
    } else {
      for (let lane = 0; lane < lanes && box.bullets.length < 24; lane++) {
        if (lane === safe) continue;
        const vertical = box.pattern === 'vertical';
        const beam = box.pattern === 'beams';
        box.bullets.push({ x: vertical ? box.minX + (box.maxX - box.minX) * (lane + .5) / lanes :
            fromRight ? box.maxX + 18 : box.minX - 18,
          y: vertical ? (fromRight ? box.minY - 18 : box.maxY + 18) : box.minY + laneHeight * (lane + .5),
          vx: vertical ? 0 : fromRight ? -(beam ? 380 : 330) : beam ? 380 : 330,
          vy: vertical ? (fromRight ? 200 : -200) : 0,
          radius: beam ? 16 : vertical ? 12 : 13, wave: box.wave,
          kind: beam ? 'beam' : vertical ? 'vertical' : 'lane' });
      }
    }
    box.wave++; box.preview = null; box.spawnTimer += box.pattern === 'radial' ? 1.4 : 1.15;
  }
  for (let i = box.bullets.length - 1; i >= 0; i--) {
    const bullet = box.bullets[i]; bullet.x += bullet.vx * dt; bullet.y += (bullet.vy || 0) * dt;
    if (Math.hypot(bullet.x - state.hero.x, bullet.y - state.hero.y) < bullet.radius + box.heroRadius) {
      damagePlayer(state, state.stage ? 12 : 10, 'box'); box.bullets.splice(i, 1);
    } else if (bullet.x < box.minX - 25 || bullet.x > box.maxX + 25 ||
      bullet.y < box.minY - 25 || bullet.y > box.maxY + 25) box.bullets.splice(i, 1);
  }
  if (state.phase === 'defeat') return;
  if (box.elapsed >= box.duration) beginTiming(state, input);
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
  moveHero(state, dt, input);
  moveBoss(state, dt);
  if (bool(input.attack) && hero.attackCooldown <= 0 && state.projectiles.length < MAX_PROJECTILES - 2) fireWeapon(state, input.weapon);

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
      const eyes = battleEyePositions(heroKey(state.stage), hero.x, hero.y);
      p.x = (eyes[0].x + eyes[1].x) / 2; p.y = (eyes[0].y + eyes[1].y) / 2;
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
    if (p.type === 'eyes') {
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
  if (state.attackTimer <= 0) {
    spawnHazard(state, () => nextRandom(state));
    state.attackTimer = (state.stage ? 1.55 : 1.72) + nextRandom(state) * (state.stage ? 0.35 : 0.42);
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
export function createVinsonBattle({ seed = 1, stage = 0, compact = false } = {}) {
  const initialSeed = seedNumber(seed); let state = freshCombat(stage === 1 ? 1 : 0, initialSeed, 0, 0, compact);
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
