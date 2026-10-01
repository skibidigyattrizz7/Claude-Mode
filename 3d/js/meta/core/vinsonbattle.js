// DOM-free deterministic rules for the Vinson encounter. Times and positions are seconds and canvas units.
const WIDTH = 1280, HEIGHT = 720;
const ARENA = { minX: 100, maxX: 1180, minY: 210, maxY: 640 };
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
  const spread = key === 'world' ? 11 : key === 'phonk' ? 8 : 10;
  const rise = key === 'world' ? 145 : key === 'phonk' ? 201 : key === 'patel' ? 167 : 124;
  return [{ x: x - spread, y: y - rise }, { x: x + spread, y: y - rise }];
}

const bossKey = stage => stage ? 'phonk' : 'world';
const heroKey = stage => stage ? 'captain' : 'patel';
function freshCombat(stage, seed, attempt, totalTime = 0) {
  const isFinal = stage === 1;
  return {
    phase: 'intro', time: totalTime, phaseTime: 0, stage, attempt,
    hero: { x: 250, y: 425, hp: 100, maxHp: 100, invulnerable: 0, dodgeCooldown: 0, attackCooldown: 0 },
    boss: { x: 990, y: 425, hp: isFinal ? 1680 : 1050, maxHp: isFinal ? 1680 : 1050, vx: 0, vy: 0 },
    hazards: [], projectiles: [], events: [],
    attackTimer: 0.8, nextHazardId: 1,
    _rngState: attemptSeed(seed, stage, attempt), _dodgeWasDown: false, _lastAttack: '', _moveSign: 1
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
  const types = ['laserline', 'bombcircle', 'painring'];
  let choices = types.filter(type => type !== state._lastAttack);
  if (state.stage === 1 && rng() > 0.4) choices = choices.filter(type => type !== 'painring');
  const type = choices[Math.floor(rng() * choices.length)], h = state.hero, b = state.boss;
  const telegraph = (state.stage ? 0.72 : 0.88) + rng() * 0.25;
  const origins = battleEyePositions(bossKey(state.stage), b.x, b.y);
  const segments = type === 'laserline' ? origins.map(origin => ({
    x1: origin.x, y1: origin.y,
    x2: clamp(h.x + (rng() - 0.5) * 75, ARENA.minX, ARENA.maxX),
    y2: clamp(h.y - 85 + (rng() - 0.5) * 65, ARENA.minY - 90, ARENA.maxY - 85)
  })) : [];
  const hazard = {
    id: state.nextHazardId++, type, elapsed: 0, telegraph,
    duration: type === 'painring' ? (state.stage ? 0.95 : 1.15) : 0.48, hit: false,
    origins, eyeOrigins: origins, segments,
    x: type === 'bombcircle' ? clamp(h.x + (rng() - 0.5) * 170, ARENA.minX + 65, ARENA.maxX - 65) : b.x,
    y: type === 'bombcircle' ? clamp(h.y + (rng() - 0.5) * 155, ARENA.minY + 65, ARENA.maxY - 65) : b.y,
    radius: type === 'bombcircle' ? 68 : 0, ringMax: 235
  };
  state.hazards.push(hazard); state._lastAttack = type;
  event(state, 'telegraph', { attack: type, hazardId: hazard.id, duration: hazard.telegraph, origins, segments });
}
function hazardHitsHero(hazard, hero) {
  if (hazard.type === 'laserline') return hazard.segments.some(s => pointSegmentDistance(hero.x, hero.y - 85, s.x1, s.y1, s.x2, s.y2) <= 19);
  if (hazard.type === 'bombcircle') return Math.hypot(hero.x - hazard.x, hero.y - hazard.y) <= hazard.radius;
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
  spinner: { cooldown: 0.18, damage: 7, speed: 760, radius: 8, life: 1.7, color: '#8fffe2' },
  explosive: { cooldown: 0.82, damage: 34, speed: 470, radius: 16, life: 2.4, splash: 78, color: '#ffb45f' },
  eyes: { cooldown: 0.62, damage: 25, speed: 620, radius: 10, life: 2, color: '#ff6280' }
};
function moveBoss(state, dt) {
  const b = state.boss, stage = state.stage;
  if (state.hazards.some(h => h.type === 'laserline' && h.elapsed < h.telegraph + h.duration)) {
    b.vx = 0; b.vy = 0;
    return; // Lock aim and eye origins to the visible boss while the beam charges and fires.
  }
  const rate = stage ? 1.75 : 1.3, amplitude = stage ? 115 : 88;
  const targetX = 920 + Math.sin(state.time * rate + state.attempt * 0.7) * amplitude;
  const targetY = 410 + Math.sin(state.time * rate * 0.73 + 1.1) * (stage ? 135 : 95);
  // Smooth, bounded movement. Stage two actively sidesteps repeated incoming shots.
  const dodge = stage ? Math.sin(state.time * 4.2) * 42 : 0;
  const tx = clamp(targetX + dodge, 790, ARENA.maxX - 55), ty = clamp(targetY, ARENA.minY + 55, ARENA.maxY - 65);
  const blend = Math.min(1, dt * (stage ? 3.4 : 2.6));
  const oldX = b.x, oldY = b.y;
  b.x += (tx - b.x) * blend; b.y += (ty - b.y) * blend;
  b.vx = dt ? (b.x - oldX) / dt : 0; b.vy = dt ? (b.y - oldY) / dt : 0;
}
function fireWeapon(state, weaponName) {
  const hero = state.hero, boss = state.boss, type = WEAPONS[weaponName] ? weaponName : 'star', spec = WEAPONS[type];
  const origins = type === 'eyes' ? battleEyePositions(heroKey(state.stage), hero.x, hero.y) : undefined;
  const start = origins ? { x: (origins[0].x + origins[1].x) / 2, y: (origins[0].y + origins[1].y) / 2 } : { x: hero.x, y: hero.y - 75 };
  const target = { x: boss.x, y: boss.y - 100 };
  const dx = target.x - start.x, dy = target.y - start.y, length = Math.hypot(dx, dy) || 1;
  const spread = type === 'spinner' ? [-0.055, 0, 0.055] : [0];
  for (const offset of spread) {
    const angle = Math.atan2(dy, dx) + offset;
    state.projectiles.push({ type, x: start.x + Math.cos(angle) * 22, y: start.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * spec.speed, vy: Math.sin(angle) * spec.speed, radius: spec.radius,
      damage: spec.damage, life: spec.life, splash: spec.splash || 0, color: spec.color, origins });
  }
  hero.attackCooldown = spec.cooldown;
  event(state, 'fire', { weapon: type, x: hero.x, y: hero.y, origins });
}
function updateFight(state, dt, input) {
  const hero = state.hero, boss = state.boss;
  const move = normVector(clamp(finite(input.x), -1, 1), clamp(finite(input.y), -1, 1));
  hero.invulnerable = Math.max(0, hero.invulnerable - dt);
  hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
  hero.attackCooldown = Math.max(0, hero.attackCooldown - dt);
  const dodgeDown = bool(input.dodge), dodgePressed = dodgeDown && !state._dodgeWasDown; state._dodgeWasDown = dodgeDown;
  let speed = 300;
  if (dodgePressed && hero.dodgeCooldown <= 0) {
    const direction = Math.hypot(move.x, move.y) ? move : { x: -1, y: 0 };
    hero.x = clamp(hero.x + direction.x * 620 * 0.19, ARENA.minX, ARENA.maxX);
    hero.y = clamp(hero.y + direction.y * 620 * 0.19, ARENA.minY, ARENA.maxY);
    hero.invulnerable = 0.38; hero.dodgeCooldown = state.stage ? 0.9 : 0.86; speed = 0;
    event(state, 'dodge', { x: hero.x, y: hero.y });
  }
  hero.x = clamp(hero.x + move.x * speed * dt, ARENA.minX, ARENA.maxX);
  hero.y = clamp(hero.y + move.y * speed * dt, ARENA.minY, ARENA.maxY);
  moveBoss(state, dt);
  if (bool(input.attack) && hero.attackCooldown <= 0 && state.projectiles.length < MAX_PROJECTILES - 2) fireWeapon(state, input.weapon);

  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    const distanceToBoss = Math.hypot(p.x - boss.x, p.y - (boss.y - 100));
    if (distanceToBoss <= p.radius + 39 || (p.splash && distanceToBoss <= p.splash)) {
      const damage = p.damage * (distanceToBoss <= p.radius + 39 ? 1 : 0.68);
      boss.hp = Math.max(0, boss.hp - damage);
      event(state, 'hit', { target: 'boss', weapon: p.type, amount: damage, hp: boss.hp });
      state.projectiles.splice(i, 1);
      if (boss.hp <= 0) {
        state.phase = state.stage === 0 ? 'transition' : 'clash'; state.phaseTime = 0;
        event(state, 'bossDefeat', { stage: state.stage }); if (state.phase === 'clash') event(state, 'clashStart'); return;
      }
    } else if (p.life <= 0 || p.x < ARENA.minX - 50 || p.x > ARENA.maxX + 50 || p.y < 0 || p.y > ARENA.maxY + 50) state.projectiles.splice(i, 1);
  }
  state.attackTimer -= dt;
  if (state.attackTimer <= 0) {
    spawnHazard(state, () => nextRandom(state));
    state.attackTimer = (state.stage ? 0.92 : 1.23) + nextRandom(state) * (state.stage ? 0.3 : 0.38);
  }
  for (let i = state.hazards.length - 1; i >= 0; i--) {
    const hazard = state.hazards[i]; hazard.elapsed += dt;
    if (hazard.elapsed >= hazard.telegraph && !hazard.hit && hazardHitsHero(hazard, hero)) {
      damagePlayer(state, hazard.type === 'bombcircle' ? 22 : state.stage ? 20 : 17, hazard.type); hazard.hit = true;
    }
    if (state.phase === 'defeat') return;
    if (hazard.elapsed >= hazard.telegraph + hazard.duration) state.hazards.splice(i, 1);
  }
}
function setPhase(state, phase) { state.phase = phase; state.phaseTime = 0; }

/** Create a deterministic, renderer-independent playable boss encounter. */
export function createVinsonBattle({ seed = 1, stage = 0 } = {}) {
  const initialSeed = seedNumber(seed); let state = freshCombat(stage === 1 ? 1 : 0, initialSeed, 0);
  function step(dt, input = {}) {
    const delta = Math.min(0.05, Math.max(0, finite(dt)));
    state.events = []; state.time += delta; state.phaseTime += delta;
    if (state.phase === 'intro') { if (bool(input.advance)) setPhase(state, 'fight'); }
    else if (state.phase === 'fight') updateFight(state, delta, input || {});
    else if (state.phase === 'clash' && state.phaseTime >= 3.2) { setPhase(state, 'victory'); event(state, 'victory'); }
    return state;
  }
  function retry() { const stageNow = state.stage, attempt = state.attempt + 1, totalTime = state.time; state = freshCombat(stageNow, initialSeed, attempt, totalTime); return state; }
  function next() { if (state.phase !== 'transition' || state.stage !== 0) return state; state = freshCombat(1, initialSeed, 0, state.time); return state; }
  return { get state() { return state; }, step, retry, next };
}
export const VINSON_BATTLE_ARENA = Object.freeze({ width: WIDTH, height: HEIGHT, ...ARENA });
