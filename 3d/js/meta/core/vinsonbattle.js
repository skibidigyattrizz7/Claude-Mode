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

function freshCombat(stage, seed, attempt, totalTime = 0) {
  const isFinal = stage === 1;
  return {
    phase: 'intro', time: totalTime, phaseTime: 0, stage, attempt,
    hero: { x: 250, y: 425, hp: 100, maxHp: 100, invulnerable: 0, dodgeCooldown: 0, attackCooldown: 0 },
    // A held attack takes roughly 19 seconds for the first encounter and 25 seconds for the finale,
    // including a little travel time for shots crossing the arena.
    boss: { x: 990, y: 425, hp: isFinal ? 810 : 630, maxHp: isFinal ? 810 : 630 },
    hazards: [], projectiles: [], events: [],
    attackTimer: 0.85, nextHazardId: 1,
    _rngState: attemptSeed(seed, stage, attempt), _dodgeWasDown: false, _lastAttack: ''
  };
}

function event(state, type, extra = {}) { state.events.push({ type, time: state.time, ...extra }); }

function normVector(x, y) {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

function spawnHazard(state, rng) {
  if (state.hazards.length >= MAX_HAZARDS) return;
  const types = ['laserline', 'bombcircle', 'painring'];
  let choices = types.filter(type => type !== state._lastAttack);
  if (state.stage === 1 && rng() > 0.55) choices = choices.filter(type => type !== 'bombcircle');
  const type = choices[Math.floor(rng() * choices.length)];
  const h = state.hero, b = state.boss;
  const hazard = {
    id: state.nextHazardId++, type, elapsed: 0, telegraph: 0.48 + rng() * 0.22,
    duration: type === 'painring' ? 1.0 : 0.46, hit: false,
    x: type === 'bombcircle' ? clamp(h.x + (rng() - 0.5) * 90, ARENA.minX + 65, ARENA.maxX - 65) : b.x,
    y: type === 'bombcircle' ? clamp(h.y + (rng() - 0.5) * 90, ARENA.minY + 65, ARENA.maxY - 65) : b.y,
    radius: type === 'bombcircle' ? 74 : 0,
    x1: ARENA.minX, y1: clamp(h.y, ARENA.minY, ARENA.maxY), x2: ARENA.maxX, y2: clamp(h.y, ARENA.minY, ARENA.maxY),
    ringMax: 215
  };
  if (type === 'laserline') {
    // A horizontal eye-beam sweeps through the hero's current lane, with a clearly visible warning first.
    hazard.y1 = hazard.y2 = clamp(h.y, ARENA.minY + 14, ARENA.maxY - 14);
  }
  if (type === 'painring') { hazard.x = b.x; hazard.y = b.y; }
  state.hazards.push(hazard); state._lastAttack = type;
  event(state, 'telegraph', { attack: type, hazardId: hazard.id, duration: hazard.telegraph });
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const d2 = dx * dx + dy * dy;
  const t = d2 ? clamp(((px - x1) * dx + (py - y1) * dy) / d2, 0, 1) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hazardHitsHero(hazard, hero) {
  if (hazard.type === 'laserline') return pointSegmentDistance(hero.x, hero.y, hazard.x1, hazard.y1, hazard.x2, hazard.y2) <= 20;
  if (hazard.type === 'bombcircle') return Math.hypot(hero.x - hazard.x, hero.y - hazard.y) <= hazard.radius;
  const distance = Math.hypot(hero.x - hazard.x, hero.y - hazard.y);
  // The pain ring expands outward from the boss; its danger band is narrow and its sweep is slow enough to dodge.
  const radius = 30 + (hazard.elapsed - hazard.telegraph) * hazard.ringMax / hazard.duration;
  return Math.abs(distance - radius) <= 23;
}

function damagePlayer(state, amount, source) {
  const hero = state.hero;
  if (hero.invulnerable > 0) return;
  hero.hp = Math.max(0, hero.hp - amount);
  hero.invulnerable = 0.62;
  event(state, 'hit', { target: 'hero', source, amount, hp: hero.hp });
  if (hero.hp <= 0) {
    state.phase = 'defeat'; state.phaseTime = 0;
    event(state, 'playerDefeat');
  }
}

function updateFight(state, dt, input) {
  const hero = state.hero, boss = state.boss;
  const ix = clamp(finite(input.x), -1, 1), iy = clamp(finite(input.y), -1, 1);
  const move = normVector(ix, iy);
  hero.invulnerable = Math.max(0, hero.invulnerable - dt);
  hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
  hero.attackCooldown = Math.max(0, hero.attackCooldown - dt);

  const dodgeDown = bool(input.dodge), dodgePressed = dodgeDown && !state._dodgeWasDown;
  state._dodgeWasDown = dodgeDown;
  let speed = 300;
  if (dodgePressed && hero.dodgeCooldown <= 0) {
    const direction = Math.hypot(move.x, move.y) ? move : { x: -1, y: 0 };
    hero.x = clamp(hero.x + direction.x * 620 * 0.19, ARENA.minX, ARENA.maxX);
    hero.y = clamp(hero.y + direction.y * 620 * 0.19, ARENA.minY, ARENA.maxY);
    hero.invulnerable = 0.38; hero.dodgeCooldown = 0.86; speed = 0;
    event(state, 'dodge', { x: hero.x, y: hero.y });
  }
  hero.x = clamp(hero.x + move.x * speed * dt, ARENA.minX, ARENA.maxX);
  hero.y = clamp(hero.y + move.y * speed * dt, ARENA.minY, ARENA.maxY);

  if (bool(input.attack) && hero.attackCooldown <= 0 && state.projectiles.length < MAX_PROJECTILES) {
    const dx = boss.x - hero.x, dy = boss.y - hero.y, length = Math.hypot(dx, dy) || 1;
    state.projectiles.push({ x: hero.x + dx / length * 22, y: hero.y + dy / length * 22,
      vx: dx / length * 650, vy: dy / length * 650, radius: 10, damage: 12, life: 2.0 });
    hero.attackCooldown = 0.35;
    event(state, 'fire', { x: hero.x, y: hero.y });
  }

  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (Math.hypot(p.x - boss.x, p.y - boss.y) <= p.radius + 36) {
      boss.hp = Math.max(0, boss.hp - p.damage);
      event(state, 'hit', { target: 'boss', amount: p.damage, hp: boss.hp });
      state.projectiles.splice(i, 1);
      if (boss.hp <= 0) {
        state.phase = state.stage === 0 ? 'transition' : 'clash'; state.phaseTime = 0;
        event(state, 'bossDefeat', { stage: state.stage });
        if (state.phase === 'clash') event(state, 'clashStart');
        return;
      }
    } else if (p.life <= 0 || p.x < ARENA.minX - 50 || p.x > ARENA.maxX + 50 || p.y < ARENA.minY - 50 || p.y > ARENA.maxY + 50) {
      state.projectiles.splice(i, 1);
    }
  }

  state.attackTimer -= dt;
  if (state.attackTimer <= 0) {
    const rng = () => nextRandom(state);
    spawnHazard(state, rng);
    state.attackTimer = 1.1 + rng() * 0.42;
  }

  for (let i = state.hazards.length - 1; i >= 0; i--) {
    const hazard = state.hazards[i]; hazard.elapsed += dt;
    if (hazard.elapsed >= hazard.telegraph && !hazard.hit && hazardHitsHero(hazard, hero)) {
      damagePlayer(state, hazard.type === 'bombcircle' ? 24 : 18, hazard.type);
      hazard.hit = true;
    }
    if (state.phase === 'defeat') return;
    if (hazard.elapsed >= hazard.telegraph + hazard.duration) state.hazards.splice(i, 1);
  }
}

function setPhase(state, phase) { state.phase = phase; state.phaseTime = 0; }

/** Create a deterministic, renderer-independent playable boss encounter. */
export function createVinsonBattle({ seed = 1, stage = 0 } = {}) {
  const initialSeed = seedNumber(seed);
  let state = freshCombat(stage === 1 ? 1 : 0, initialSeed, 0);

  function step(dt, input = {}) {
    const delta = Math.min(0.05, Math.max(0, finite(dt)));
    state.events = [];
    state.time += delta;
    state.phaseTime += delta;
    if (state.phase === 'intro') {
      if (bool(input.advance)) setPhase(state, 'fight');
    } else if (state.phase === 'fight') {
      updateFight(state, delta, input || {});
    } else if (state.phase === 'clash' && state.phaseTime >= 3.2) {
      setPhase(state, 'victory'); event(state, 'victory');
    }
    return state;
  }

  function retry() {
    const stageNow = state.stage, attempt = state.attempt + 1, totalTime = state.time;
    state = freshCombat(stageNow, initialSeed, attempt, totalTime);
    return state;
  }

  function next() {
    if (state.phase !== 'transition' || state.stage !== 0) return state;
    state = freshCombat(1, initialSeed, 0, state.time);
    return state;
  }

  return { get state() { return state; }, step, retry, next };
}

export const VINSON_BATTLE_ARENA = Object.freeze({ width: WIDTH, height: HEIGHT, ...ARENA });
