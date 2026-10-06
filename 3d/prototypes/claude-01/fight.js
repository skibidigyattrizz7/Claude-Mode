// Prototype 1-Claude (owner, Oct 1): a self-contained boss fight that shows every requested mechanic and the
// feel/VFX direction from docs/AI_DIRECT.md. Neutral stand-in characters drawn in code (a cloaked knight and
// "The Eclipse"), no dialogue, so ChatGPT can port mechanics/effects into the real fight and keep its own cast/story.
//
// Mechanics: free combat; HP gates at 75/50/25% open a SURVIVE box (accurate soul hurtbox, accurate safe-gap hints);
// heals: 1 at the start of each phase, +1 after each box, never carried into the next phase; RUNE LOCK key-order
// attack (wrong/late = inverted controls); ground slam -> spinning ring -> black hole pull; chain grab with a
// 3-key escape; perfect dodge slow-mo; random FINISHER (zoom, speed blitz, three slashes, 2x the heavy attack).
// Sim runs on a fixed 1/120 s step; hit-stop/slow-mo scale the sim, effects run on their own clock.

const W = 1280, H = 720;
const FLOOR = { minX: 70, maxX: 1210, minY: 360, maxY: 670 };
const STEP = 1 / 120;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeOutBack = (t) => { const c = 1.7, x = clamp(t, 0, 1) - 1; return 1 + (c + 1) * x * x * x + c * x * x; };

function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------------------------------------- tuning
const HERO = { hp: 100, speed: 330, dodgeTime: 0.24, dodgeCd: 0.55, dodgeSpeed: 980 };
const SLASH = { dmg: 5, cd: 0.26, speed: 980, r: 26 };
const HEAVY = { dmg: 14, cd: 3.6, speed: 760, r: 54, charge: 0.32 };
const FINISHER = { mult: 2.0, chance: 0.08, cooldown: 16, window: 2.6, length: 2.6 };
const HEAL_AMOUNT = 32;
const BOSS_HP = 420;
const GATES = [0.75, 0.5, 0.25].map((f) => Math.round(BOSS_HP * f)); // 315, 210, 105
const PHASE2_GATE = 1; // after the 2nd box the boss enrages (phase 2)
const RUNE_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'];
const CHAIN_KEYS = ['J', 'K', 'L', 'U', 'I', 'O'];

export function createFight({ seed = 7, reducedMotion = false, force = null } = {}) {
  const R = rng(seed);
  const s = {
    t: 0, phase: 'intro', phaseT: 0, stage: 1, reducedMotion,
    hero: { x: 300, y: 560, vx: 0, vy: 0, hp: HERO.hp, chip: HERO.hp, face: 1, inv: 0, dodgeT: 0, dodgeCd: 0, dodgeDir: [1, 0],
      slashCd: 0, heavyCd: 0, charge: -1, heals: 1, invert: 0, squash: 0, hurt: 0, trail: [] },
    boss: { x: 980, y: 470, hp: BOSS_HP, chip: BOSS_HP, gateIndex: 0, attackCd: 2.4, last: null, tell: 0, flash: 0,
      stagger: 0, runeCd: 9, chainCd: 6, holeCd: 4, enraged: false, sway: 0, hands: [{ x: 880, y: 470 }, { x: 1080, y: 470 }] },
    shots: [], heroShots: [], hazards: [], box: null, rune: null, chain: null, finisher: { prompt: 0, cd: 6, cine: null },
    banner: null, events: [], force, R, hitstop: 0, slowmo: 0, slowmoT: 0, result: null,
  };
  if (force === 'phase2') { s.boss.hp = GATES[1]; s.boss.chip = s.boss.hp; s.boss.gateIndex = 2; enrage(s, true); }
  return s;
}

function ev(s, type, extra = {}) { s.events.push({ type, ...extra }); }
function setPhase(s, p) { s.phase = p; s.phaseT = 0; }
function banner(s, text, sub = '', color = '#ffd7a1') { s.banner = { text, sub, color, t: 0 }; }

function enrage(s, silent = false) {
  s.stage = 2; s.boss.enraged = true; s.hero.heals = 1; // heals never carry into the next phase
  if (!silent) { banner(s, 'PHASE 2', 'THE ECLIPSE AWAKENS', '#ff6a4d'); ev(s, 'phase', { stage: 2 }); }
}

// ---------------------------------------------------------------------------------------------- damage
function hurtHero(s, dmg, source, x = s.hero.x, y = s.hero.y - 46) {
  const h = s.hero;
  if (h.inv > 0 || h.dodgeT > 0 || s.phase === 'victory' || s.phase === 'defeat') return false;
  h.hp = Math.max(0, h.hp - dmg); h.inv = 0.7; h.hurt = 0.3;
  ev(s, 'heroHit', { dmg, source, x, y });
  if (h.hp <= 0) { setPhase(s, 'defeat'); s.result = 'defeat'; ev(s, 'defeat'); }
  return true;
}
function bossFloor(s) { return s.boss.gateIndex < GATES.length ? GATES[s.boss.gateIndex] : 0; }
function hurtBoss(s, dmg, kind, x = s.boss.x, y = s.boss.y - 70) {
  const b = s.boss;
  if (s.phase === 'victory' || s.phase === 'defeat') return;
  const floor = bossFloor(s);
  const before = b.hp;
  b.hp = Math.max(floor, b.hp - dmg); b.flash = 0.09;
  ev(s, 'bossHit', { dmg: Math.round(before - b.hp) || 0, raw: dmg, kind, x, y });
  if (b.hp <= 0) { setPhase(s, 'victory'); s.result = 'victory'; s.slowmo = 1.2; ev(s, 'victory'); return; }
  if (b.hp <= floor && floor > 0 && ['fight', 'finisher'].includes(s.phase)) s.pendingGate = true;
}

// ---------------------------------------------------------------------------------------------- boss attacks
function bossEye(s) { return { x: s.boss.x, y: s.boss.y - 120 }; }
function chooseAttack(s) {
  const b = s.boss, R = s.R;
  if (s.force && s.force !== 'phase2' && !s.forceUsed) { s.forceUsed = true; return s.force; }
  const opts = [['orbs', 3]];
  if (b.holeCd <= 0) opts.push(['slam', 2.2]);
  if (b.chainCd <= 0) opts.push(['chains', 1.8]);
  if (b.runeCd <= 0) opts.push(['rune', 1.4 + (s.stage - 1)]);
  if (s.stage === 2) opts.push(['spiral', 1.6]);
  const pool = opts.filter(([k]) => k !== b.last || opts.length === 1);
  let total = pool.reduce((a, [, w]) => a + w, 0), pick = R() * total;
  for (const [k, w] of pool) { pick -= w; if (pick <= 0) return k; }
  return pool[0][0];
}
function startAttack(s, kind) {
  const b = s.boss, h = s.hero, R = s.R;
  b.last = kind; b.tell = 0.45; ev(s, 'tell', { kind });
  const fast = s.stage === 2 ? 0.8 : 1;
  if (kind === 'orbs') {
    const eye = bossEye(s), n = s.stage === 2 ? 9 : 7, base = Math.atan2(h.y - 40 - eye.y, h.x - eye.x);
    for (let i = 0; i < n; i++) s.shots.push({ kind: 'orb', x: eye.x, y: eye.y, a: base + (i - (n - 1) / 2) * 0.17, speed: 330 + (s.stage - 1) * 70,
      r: 13, dmg: 9, tele: 0.55 * fast, age: 0, life: 4 });
    b.attackCd = 1.7 * fast;
  } else if (kind === 'spiral') {
    const eye = bossEye(s);
    for (let i = 0; i < 18; i++) s.shots.push({ kind: 'orb', x: eye.x, y: eye.y, a: i / 18 * TAU + R() * 0.2, speed: 250, spin: 0.9, r: 11, dmg: 8,
      tele: 0.5 + i * 0.045, age: 0, life: 4.5 });
    b.attackCd = 2.2;
  } else if (kind === 'slam') {
    const hand = b.hands[h.x < b.x ? 0 : 1];
    s.hazards.push({ kind: 'slam', x: clamp(h.x, FLOOR.minX + 80, FLOOR.maxX - 80), y: clamp(h.y, FLOOR.minY + 40, FLOOR.maxY - 20), hand, t: 0, tele: 0.85 * fast, r: 92, hit: false });
    b.holeCd = 9 * fast; b.attackCd = 3.4 * fast;
  } else if (kind === 'chains') {
    s.hazards.push({ kind: 'chain', t: 0, tele: 0.75 * fast, tx: h.x, ty: h.y - 40, hx: b.x - 60, hy: b.y - 70, head: 0, done: false });
    b.chainCd = 11 * fast; b.attackCd = 2.6;
  } else if (kind === 'rune') {
    const n = s.stage === 2 ? 6 : 5, keys = [];
    while (keys.length < n) { const k = RUNE_KEYS[Math.floor(R() * RUNE_KEYS.length)]; if (k !== keys[keys.length - 1]) keys.push(k); }
    s.rune = { keys, i: 0, t: 0, limit: s.stage === 2 ? 4.2 : 5, rise: 0, wrong: -1, done: null };
    b.runeCd = 18; b.attackCd = 2.5; setPhase(s, 'rune'); ev(s, 'runeStart');
  }
}

// ---------------------------------------------------------------------------------------------- SURVIVE box
const BOX = { minX: 420, maxX: 860, minY: 330, maxY: 610 };
function beginBox(s) {
  const gate = s.boss.gateIndex;
  s.box = { t: 0, len: 8.5, gate, pattern: ['lanes', 'radial', 'storm'][gate] || 'storm', soul: { x: 640, y: 470 }, bullets: [], wave: 0, next: 0.9,
    preview: null, aimT: 2.2, shake: 0 };
  s.shots = []; s.hazards = []; s.heroShots = []; s.chain = null;
  setPhase(s, 'box'); banner(s, 'SURVIVE', 'DODGE · NO ATTACKS', '#e8f1ff'); ev(s, 'boxStart');
}
function spawnBoxWave(s, safe) {
  const b = s.box, R = s.R, lanes = 5, lh = (BOX.maxY - BOX.minY) / lanes, lw = (BOX.maxX - BOX.minX) / lanes;
  const p = b.pattern === 'storm' ? (b.wave % 2 ? 'radial' : 'lanes') : b.pattern;
  if (p === 'lanes') {
    const vertical = b.wave % 2 === 1, fromStart = b.wave % 4 < 2;
    for (let i = 0; i < lanes; i++) {
      if (i === safe) continue;
      const x = vertical ? BOX.minX + lw * (i + 0.5) : fromStart ? BOX.minX - 14 : BOX.maxX + 14;
      const y = vertical ? (fromStart ? BOX.minY - 14 : BOX.maxY + 14) : BOX.minY + lh * (i + 0.5);
      const v = 300 + b.gate * 40;
      b.bullets.push({ x, y, vx: vertical ? 0 : fromStart ? v : -v, vy: vertical ? (fromStart ? v : -v) : 0, r: vertical ? lw * 0.42 : lh * 0.42, wall: true,
        vertical, age: 0, tele: 0.5 });
    }
  } else {
    const cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, spokes = 20, gap = safe; // gap spoke index 0..19, 3 spokes skipped
    const off = b.wave * 0.23;
    for (let i = 0; i < spokes; i++) {
      if (((i - gap + spokes) % spokes) <= 2) continue;
      const a = i / spokes * TAU + off;
      b.bullets.push({ x: cx, y: cy, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, r: 8, age: 0, tele: 0.6 });
    }
  }
  b.wave++;
}
function previewFor(s) {
  const b = s.box, p = b.pattern === 'storm' ? (b.wave % 2 ? 'radial' : 'lanes') : b.pattern;
  if (p === 'lanes') return { pattern: 'lanes', safe: Math.floor(s.R() * 5), vertical: b.wave % 2 === 1 };
  return { pattern: 'radial', safe: Math.floor(s.R() * 20), off: b.wave * 0.23 };
}
function updateBox(s, dt, inp) {
  const b = s.box, soul = b.soul, h = s.hero;
  b.t += dt; b.next -= dt; b.aimT -= dt;
  let mx = inp.mx, my = inp.my; if (h.invert > 0) { mx = -mx; my = -my; }
  const sp = 250, len = Math.hypot(mx, my) || 1;
  soul.x = clamp(soul.x + mx / Math.max(1, len) * sp * dt, BOX.minX + 9, BOX.maxX - 9);
  soul.y = clamp(soul.y + my / Math.max(1, len) * sp * dt, BOX.minY + 9, BOX.maxY - 9);
  if (!b.preview && b.next < 0.5 && b.t < b.len - 1) b.preview = previewFor(s);
  if (b.next <= 0 && b.t < b.len - 1) { spawnBoxWave(s, b.preview ? b.preview.safe : 2); b.preview = null; b.next = b.pattern === 'storm' ? 0.95 : 1.15; }
  // aimed fan (gate 2+): telegraphed at a SNAPSHOT of the soul, never homes
  if (b.gate >= 1 && b.aimT <= 0 && b.t < b.len - 1.3) {
    const side = Math.floor(s.R() * 4), ex = [BOX.minX + 10, BOX.maxX - 10][side % 2], ey = side < 2 ? BOX.minY + 10 : BOX.maxY - 10;
    const a = Math.atan2(soul.y - ey, soul.x - ex);
    for (let i = -1; i <= 1; i++) b.bullets.push({ x: ex, y: ey, vx: Math.cos(a + i * 0.2) * 240, vy: Math.sin(a + i * 0.2) * 240, r: 7, age: 0, tele: 0.7, aimed: true });
    b.aimT = 1.6 - b.gate * 0.2;
  }
  for (let i = b.bullets.length - 1; i >= 0; i--) {
    const p = b.bullets[i]; p.age += dt;
    if (p.age < p.tele) continue; // telegraph: sits still at its spawn point with an aim guide
    p.x += p.vx * dt; p.y += p.vy * dt;
    let hit;
    if (p.wall) hit = p.vertical ? Math.abs(soul.x - p.x) < p.r && Math.abs(soul.y - p.y) < 16 : Math.abs(soul.y - p.y) < p.r && Math.abs(soul.x - p.x) < 16;
    else hit = Math.hypot(soul.x - p.x, soul.y - p.y) < p.r + 5;
    if (hit && h.inv <= 0) { if (hurtHero(s, 8, 'box', soul.x, soul.y)) b.shake = 0.25; b.bullets.splice(i, 1); continue; }
    if (p.x < BOX.minX - 60 || p.x > BOX.maxX + 60 || p.y < BOX.minY - 60 || p.y > BOX.maxY + 60) b.bullets.splice(i, 1);
  }
  if (s.phase !== 'box') return;
  if (b.t >= b.len) {
    // passed this gate: +1 heal for this phase
    s.boss.gateIndex++; s.box = null; h.heals++; ev(s, 'healGain', { heals: h.heals });
    if (s.boss.gateIndex === PHASE2_GATE + 1 && s.stage === 1) enrage(s);
    else banner(s, 'SURVIVED', '+1 HEAL', '#9ff0c4');
    setPhase(s, 'fight'); s.boss.attackCd = 1.6;
  }
}

// ---------------------------------------------------------------------------------------------- fight update
function moveHero(s, dt, inp) {
  const h = s.hero;
  let mx = inp.mx, my = inp.my; if (h.invert > 0) { mx = -mx; my = -my; }
  const len = Math.hypot(mx, my);
  if (h.dodgeT > 0) {
    h.dodgeT -= dt; h.x += h.dodgeDir[0] * HERO.dodgeSpeed * dt; h.y += h.dodgeDir[1] * HERO.dodgeSpeed * 0.6 * dt;
    const lt = h.trail[h.trail.length - 1]; if (!lt || Math.hypot(lt.x - h.x, lt.y - h.y) > 26) h.trail.push({ x: h.x, y: h.y, life: 0.32, face: h.face });
  } else {
    const sp = HERO.speed * (h.charge >= 0 ? 0.55 : 1);
    h.vx = lerp(h.vx, len ? mx / len * sp : 0, 1 - Math.exp(-dt * 18));
    h.vy = lerp(h.vy, len ? my / len * sp * 0.75 : 0, 1 - Math.exp(-dt * 18));
    h.x += h.vx * dt; h.y += h.vy * dt;
  }
  if (Math.abs(mx) > 0.2 && h.dodgeT <= 0) h.face = mx > 0 ? 1 : -1;
  h.x = clamp(h.x, FLOOR.minX, FLOOR.maxX); h.y = clamp(h.y, FLOOR.minY, FLOOR.maxY);
  if (inp.dodge && h.dodgeCd <= 0 && h.dodgeT <= 0) {
    const d = len ? [mx / len, my / len] : [h.face, 0];
    h.dodgeDir = d; h.dodgeT = HERO.dodgeTime; h.dodgeCd = HERO.dodgeCd; ev(s, 'dodge', { x: h.x, y: h.y });
    // perfect dodge: something was about to hit within ~0.18 s
    const danger = s.shots.some((p) => p.age >= p.tele && Math.hypot(p.x - h.x, p.y - (h.y - 40)) < p.r + 26 + p.speed * 0.18) ||
      s.hazards.some((z) => z.kind === 'slam' && !z.hit && z.t > z.tele - 0.2 && Math.hypot(z.x - h.x, (z.y - h.y) * 1.6) < z.r + 20) ||
      s.hazards.some((z) => z.kind === 'chain' && z.t >= z.tele && !z.done && Math.hypot(z.cx - h.x, z.cy - (h.y - 40)) < 120);
    if (danger) { s.slowmo = 0.45; h.inv = Math.max(h.inv, 0.5); ev(s, 'perfect', { x: h.x, y: h.y }); if (s.finisher.cd > 4) s.finisher.cd -= 4; }
  }
}
function heroAttacks(s, dt, inp) {
  const h = s.hero, b = s.boss;
  const aim = () => { const dx = b.x - h.x, dy = (b.y - 80) - (h.y - 45), l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  if (inp.attack && h.slashCd <= 0 && h.charge < 0 && h.dodgeT <= 0) {
    const [ax, ay] = aim(); h.slashCd = SLASH.cd; h.squash = 0.12; h.face = ax >= 0 ? 1 : -1;
    s.heroShots.push({ kind: 'slash', x: h.x + ax * 40, y: h.y - 45 + ay * 40, vx: ax * SLASH.speed, vy: ay * SLASH.speed, r: SLASH.r, dmg: SLASH.dmg, life: 1.4, age: 0 });
    ev(s, 'fire', { x: h.x + ax * 40, y: h.y - 45 + ay * 40, kind: 'slash' });
  }
  if (inp.heavy && h.heavyCd <= 0 && h.charge < 0 && h.dodgeT <= 0) { h.charge = 0; ev(s, 'charge'); }
  if (h.charge >= 0) {
    h.charge += dt;
    if (h.charge >= HEAVY.charge) {
      const [ax, ay] = aim(); h.charge = -1; h.heavyCd = HEAVY.cd; h.squash = 0.2;
      s.heroShots.push({ kind: 'heavy', x: h.x + ax * 50, y: h.y - 45 + ay * 50, vx: ax * HEAVY.speed, vy: ay * HEAVY.speed, r: HEAVY.r, dmg: HEAVY.dmg, life: 1.6, age: 0, pierce: true, hitBoss: false });
      ev(s, 'fire', { x: h.x, y: h.y - 45, kind: 'heavy' });
    }
  }
  if (inp.heal && h.heals > 0 && h.hp < HERO.hp) { h.heals--; h.hp = Math.min(HERO.hp, h.hp + HEAL_AMOUNT); ev(s, 'heal', { x: h.x, y: h.y }); }
  if (inp.finisher && s.finisher.prompt > 0) {
    s.finisher.prompt = 0; s.finisher.cd = FINISHER.cooldown;
    s.finisher.cine = { t: 0, len: FINISHER.length, dmg: Math.round(HEAVY.dmg * FINISHER.mult * (1 + (s.R() - 0.5) * 0.12)), startX: h.x, startY: h.y };
    s.shots = []; s.hazards = []; setPhase(s, 'finisher'); ev(s, 'finisherStart');
  }
}
function updateShots(s, dt) {
  const h = s.hero, b = s.boss;
  for (let i = s.heroShots.length - 1; i >= 0; i--) {
    const p = s.heroShots[i]; p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (!p.hitBoss && Math.hypot(p.x - b.x, (p.y - (b.y - 80)) * 1.1) < p.r + 78) {
      const dmg = Math.round(p.dmg * (0.9 + s.R() * 0.2));
      hurtBoss(s, dmg, p.kind, p.x, p.y);
      if (s.phase === 'fight' && s.finisher.cd <= 0 && s.finisher.prompt <= 0 && s.R() < FINISHER.chance) { s.finisher.prompt = FINISHER.window; ev(s, 'finisherReady'); }
      if (p.pierce) p.hitBoss = true; else { s.heroShots.splice(i, 1); continue; }
    }
    if (p.age > p.life || p.x < -100 || p.x > W + 100 || p.y < -100 || p.y > H + 100) s.heroShots.splice(i, 1);
  }
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const p = s.shots[i]; p.age += dt;
    if (p.age < p.tele) continue;
    if (p.spin) p.a += p.spin * dt;
    p.x += Math.cos(p.a) * p.speed * dt; p.y += Math.sin(p.a) * p.speed * dt;
    if (Math.hypot(p.x - h.x, p.y - (h.y - 40)) < p.r + 24) { if (hurtHero(s, p.dmg, 'orb', p.x, p.y)) { s.shots.splice(i, 1); continue; } }
    if (p.age > p.life + p.tele || p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) s.shots.splice(i, 1);
  }
}
function updateHazards(s, dt, inp) {
  const h = s.hero, b = s.boss;
  for (let i = s.hazards.length - 1; i >= 0; i--) {
    const z = s.hazards[i]; z.t += dt;
    if (z.kind === 'slam') {
      z.hand.x = lerp(z.hand.x, z.x, 1 - Math.exp(-dt * 6)); z.hand.y = lerp(z.hand.y, z.t < z.tele ? z.y - 170 : z.y - 40, 1 - Math.exp(-dt * (z.t < z.tele ? 6 : 30)));
      if (!z.hit && z.t >= z.tele) {
        z.hit = true; ev(s, 'slam', { x: z.x, y: z.y });
        if (Math.hypot(z.x - h.x, (z.y - h.y) * 1.6) < z.r) hurtHero(s, 14, 'slam');
        // the impact keeps spinning on the ground, then collapses into a black hole
        s.hazards.push({ kind: 'spin', x: z.x, y: z.y, t: 0, len: 0.75 });
      }
      if (z.t > z.tele + 0.35) s.hazards.splice(i, 1);
    } else if (z.kind === 'spin') {
      if (z.t >= z.len) { s.hazards.splice(i, 1); s.hazards.push({ kind: 'hole', x: z.x, y: z.y, t: 0, len: s.stage === 2 ? 3 : 2.5, tick: 0 }); ev(s, 'hole', { x: z.x, y: z.y }); }
    } else if (z.kind === 'hole') {
      const life = z.t / z.len, strength = Math.sin(clamp(life, 0, 1) * Math.PI); // swell then fade
      const dx = z.x - h.x, dy = (z.y - h.y), d = Math.hypot(dx, dy) || 1;
      if (d < 520 && h.dodgeT <= 0) {
        const pull = (110 + 160 * (1 - d / 520)) * strength * (s.stage === 2 ? 1.12 : 1); // max ~300 < run speed 330: escapable by running
        h.x += dx / d * pull * dt; h.y += dy / d * pull * dt * 0.8;
        h.x = clamp(h.x, FLOOR.minX, FLOOR.maxX); h.y = clamp(h.y, FLOOR.minY, FLOOR.maxY);
      }
      z.tick -= dt;
      if (d < 46 && z.tick <= 0) { if (hurtHero(s, 7, 'hole')) z.tick = 0.45; }
      if (z.t >= z.len) { s.hazards.splice(i, 1); ev(s, 'holeEnd', { x: z.x, y: z.y }); }
    } else if (z.kind === 'chain') {
      if (z.t < z.tele) { z.tx = lerp(z.tx, h.x, 1 - Math.exp(-dt * 2.2)); z.ty = lerp(z.ty, h.y - 40, 1 - Math.exp(-dt * 2.2)); continue; }
      if (z.head === 0) ev(s, 'chainThrow');
      z.head = Math.min(1, z.head + dt * 2.4);
      z.cx = lerp(z.hx, z.tx, easeOut(z.head)); z.cy = lerp(z.hy, z.ty, easeOut(z.head));
      if (!z.done && Math.hypot(z.cx - h.x, z.cy - (h.y - 40)) < 34 && h.dodgeT <= 0 && h.inv <= 0) {
        z.done = true; s.hazards.splice(i, 1);
        const keys = []; while (keys.length < 3) { const k = CHAIN_KEYS[Math.floor(s.R() * CHAIN_KEYS.length)]; if (!keys.includes(k)) keys.push(k); }
        s.chain = { keys, i: 0, t: 0, limit: s.stage === 2 ? 2.4 : 2.9, wrong: -1, ax: z.hx, ay: z.hy };
        setPhase(s, 'chained'); ev(s, 'chained'); continue;
      }
      if (z.head >= 1) { z.t2 = (z.t2 || 0) + dt; if (z.t2 > 0.3) s.hazards.splice(i, 1); }
    }
  }
}
function updateChained(s, dt, inp) {
  const c = s.chain, h = s.hero, b = s.boss;
  c.t += dt;
  const dx = (b.x - 110) - h.x, dy = (b.y - 10) - h.y, d = Math.hypot(dx, dy) || 1;
  h.x += dx / d * 120 * dt; h.y += dy / d * 120 * dt * 0.7;
  for (const k of inp.keysPressed) {
    if (k === c.keys[c.i]) { c.i++; ev(s, 'qteGood', { i: c.i }); if (c.i >= c.keys.length) break; }
    else if (CHAIN_KEYS.includes(k) || RUNE_KEYS.includes(k)) { c.wrong = 0.3; ev(s, 'qteBad'); c.t += 0.35; }
  }
  if (c.wrong > 0) c.wrong -= dt;
  if (c.i >= c.keys.length) {
    s.chain = null; setPhase(s, 'fight'); h.inv = 0.8; h.dodgeT = 0.2; h.dodgeDir = [-1, 0.3]; b.stagger = 1.1; hurtBoss(s, 8, 'break');
    banner(s, 'BROKE FREE', '', '#bfe8ff'); ev(s, 'chainBreak', { x: h.x, y: h.y }); b.attackCd = Math.max(b.attackCd, 1.4);
  } else if (c.t >= c.limit || d < 40) {
    s.chain = null; setPhase(s, 'fight'); hurtHero(s, 15, 'chain'); h.vx = -600; ev(s, 'chainSlam', { x: h.x, y: h.y });
  }
}
function updateRune(s, dt, inp) {
  const r = s.rune, h = s.hero, b = s.boss;
  r.t += dt; r.rise = Math.min(1, r.rise + dt * 2);
  if (r.done) { r.doneT = (r.doneT || 0) + dt; if (r.doneT > 0.9) { s.rune = null; setPhase(s, 'fight'); if (r.failed) banner(s, 'CONTROLS INVERTED', `${Math.ceil(h.invert)} SECONDS`, '#ff8a6b'); } return; }
  for (const k of inp.keysPressed) {
    if (!RUNE_KEYS.includes(k) && !CHAIN_KEYS.includes(k)) continue;
    if (k === r.keys[r.i]) { r.i++; ev(s, 'qteGood', { i: r.i }); if (r.i >= r.keys.length) break; }
    else { r.wrong = r.i; r.done = 'fail'; break; }
  }
  if (!r.done && r.i >= r.keys.length) { r.done = 'win'; b.stagger = 1.2; hurtBoss(s, 12, 'reflect'); ev(s, 'runeWin'); }
  else if (!r.done && r.t >= r.limit) { r.done = 'fail'; }
  if (r.done === 'fail' && !r.failed) {
    r.failed = true; h.invert = s.stage === 2 ? 7 : 6; hurtHero(s, 10, 'rune'); ev(s, 'runeFail');
  }
}
function updateFinisher(s, dt) {
  const c = s.finisher.cine; c.t += dt;
  const h = s.hero, b = s.boss;
  // blitz path around the boss (sim only moves the hero; the drama is in the renderer)
  const k = c.t / c.len;
  if (k < 0.75) { const a = k * 11; h.x = b.x + Math.cos(a) * 170; h.y = b.y - 10 + Math.sin(a) * 60; const lt = h.trail[h.trail.length - 1]; if (!lt || Math.hypot(lt.x - h.x, lt.y - h.y) > 60) h.trail.push({ x: h.x, y: h.y, life: 0.3, face: Math.cos(a) > 0 ? -1 : 1 }); }
  else { h.x = lerp(h.x, b.x - 220, 0.2); h.y = lerp(h.y, b.y + 20, 0.2); }
  for (const at of [0.28, 0.45, 0.62]) if (c.t - dt < at * c.len && c.t >= at * c.len) ev(s, 'finisherSlash', { n: at });
  if (c.t >= c.len) {
    s.finisher.cine = null; setPhase(s, 'fight'); h.inv = 0.6;
    hurtBoss(s, c.dmg, 'finisher', b.x, b.y - 90); ev(s, 'finisherHit', { dmg: c.dmg });
    s.hitstop = 0.16; b.stagger = 1.4;
  }
}

export function step(s, dt, inp) {
  // hit-stop & slow-mo scale the simulation only
  let scale = 1;
  if (s.hitstop > 0) { s.hitstop -= dt; scale = 0.04; }
  else if (s.slowmo > 0) { s.slowmo -= dt; scale = 0.35; }
  const sdt = dt * scale;
  s.t += sdt; s.phaseT += sdt;
  const h = s.hero, b = s.boss;
  if (s.banner) s.banner.t += dt;
  h.chip = h.chip > h.hp ? Math.max(h.hp, h.chip - dt * 40) : h.hp;
  b.chip = b.chip > b.hp ? Math.max(b.hp, b.chip - dt * 70) : b.hp;
  for (const tr of h.trail) tr.life -= dt; h.trail = h.trail.filter((tr) => tr.life > 0).slice(-7);
  h.inv = Math.max(0, h.inv - sdt); h.hurt = Math.max(0, h.hurt - dt); h.squash = Math.max(0, h.squash - dt);
  b.flash = Math.max(0, b.flash - dt); b.tell = Math.max(0, b.tell - sdt);
  if (s.phase === 'intro') { if (s.phaseT > 1.6) { setPhase(s, 'fight'); } return s; }
  if (s.phase === 'victory' || s.phase === 'defeat') { return s; }
  if (h.invert > 0) h.invert = Math.max(0, h.invert - sdt);
  h.dodgeCd = Math.max(0, h.dodgeCd - sdt); h.slashCd = Math.max(0, h.slashCd - sdt); h.heavyCd = Math.max(0, h.heavyCd - sdt);
  if (s.phase === 'box') { updateBox(s, sdt, inp); return s; }
  if (s.phase === 'chained') { updateChained(s, sdt, inp); updateShots(s, sdt); return s; }
  if (s.phase === 'rune') { updateRune(s, sdt, inp); return s; }
  if (s.phase === 'finisher') { updateFinisher(s, sdt); return s; }
  // fight
  s.finisher.cd = Math.max(0, s.finisher.cd - sdt); s.finisher.prompt = Math.max(0, s.finisher.prompt - dt);
  moveHero(s, sdt, inp); heroAttacks(s, sdt, inp);
  if (s.phase !== 'fight') return s;
  b.sway += sdt; b.stagger = Math.max(0, b.stagger - sdt);
  const homeX = 960 + Math.sin(b.sway * 0.6) * 90, homeY = 470 + Math.sin(b.sway * 1.1) * 18;
  b.x = lerp(b.x, homeX, 1 - Math.exp(-sdt * 2)); b.y = lerp(b.y, homeY, 1 - Math.exp(-sdt * 2));
  for (const [i, hand] of b.hands.entries()) {
    if (s.hazards.some((z) => z.kind === 'slam' && z.hand === hand)) continue;
    const hx = b.x + (i ? 125 : -125), hy = b.y - 30 + Math.sin(b.sway * 2 + i * 2) * 14;
    hand.x = lerp(hand.x, hx, 1 - Math.exp(-sdt * 5)); hand.y = lerp(hand.y, hy, 1 - Math.exp(-sdt * 5));
  }
  b.holeCd -= sdt; b.chainCd -= sdt; b.runeCd -= sdt;
  if (b.stagger <= 0) { b.attackCd -= sdt; if (b.attackCd <= 0) startAttack(s, chooseAttack(s)); }
  updateShots(s, sdt); updateHazards(s, sdt, inp);
  if (s.pendingGate && s.phase === 'fight') { s.pendingGate = false; beginBox(s); }
  return s;
}

// ============================================================================================== RENDERER
export function createRenderer(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  const fx = { particles: [], numbers: [], rings: [], slashes: [], trauma: 0, flash: 0, flashColor: '#fff', zoom: 1, zoomTarget: 1, camX: 0, camY: 0,
    embers: Array.from({ length: 46 }, (_, i) => ({ x: (i * 211) % W, y: (i * 97) % H, s: 0.4 + (i % 5) * 0.25, ph: i })), clock: 0, scorch: [], cracks: [], vignette: 0 };
  const P_MAX = 170;
  const part = (x, y, n, color, speed = 260, life = 0.6, size = 3, grav = 300) => {
    for (let i = 0; i < n && fx.particles.length < P_MAX; i++) {
      const a = Math.random() * TAU, v = speed * (0.35 + Math.random() * 0.65);
      fx.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.25, life, max: life, size: size * (0.6 + Math.random() * 0.8), color, grav });
    }
  };
  const num = (x, y, text, color, big = false) => { fx.numbers.push({ x, y, text, color, t: 0, big }); if (fx.numbers.length > 18) fx.numbers.shift(); };
  const ring = (x, y, color, r0, r1, life, w = 4, flat = 1) => { fx.rings.push({ x, y, color, r0, r1, t: 0, life, w, flat }); if (fx.rings.length > 24) fx.rings.shift(); };
  const shake = (amt) => { if (!reducedMotion) fx.trauma = Math.min(1, fx.trauma + amt); };
  const flash = (color, amt) => { if (!reducedMotion) { fx.flash = Math.max(fx.flash, amt); fx.flashColor = color; } };

  function consume(s) {
    for (const e of s.events) {
      if (e.type === 'bossHit') {
        const big = e.kind === 'heavy' || e.kind === 'finisher', mid = big || e.kind === 'reflect' || e.kind === 'break';
        part(e.x, e.y, big ? 22 : 6, big ? '#ffd68a' : '#bfe6ff', big ? 420 : 240, big ? 0.7 : 0.4, big ? 4 : 2.5);
        num(e.x + (Math.random() - 0.5) * 30, e.y - 20, String(e.dmg || e.raw), big ? '#ffd27a' : '#eaf6ff', big);
        if (mid) { shake(big ? 0.45 : 0.25); ring(e.x, e.y, '#ffe1a8', 10, big ? 120 : 70, 0.35, big ? 6 : 3); }
        if (e.kind === 'heavy') s.hitstop = Math.max(s.hitstop, 0.06);
      }
      if (e.type === 'heroHit') {
        shake(0.4); part(e.x, e.y, 12, '#ff6d5a', 280, 0.5, 3); num(e.x, e.y - 30, '-' + e.dmg, '#ff7a66'); fx.vignette = 0.5; s.hitstop = Math.max(s.hitstop, 0.05);
      }
      if (e.type === 'fire') part(e.x, e.y, e.kind === 'heavy' ? 14 : 4, e.kind === 'heavy' ? '#ffe0a0' : '#bfefff', e.kind === 'heavy' ? 300 : 160, 0.3, 2.5, 0);
      if (e.type === 'dodge') ring(e.x, e.y - 40, '#d7f3ff', 8, 46, 0.25, 2);
      if (e.type === 'perfect') { num(e.x, e.y - 110, 'PERFECT', '#9ff8ff', true); ring(e.x, e.y - 40, '#9ff8ff', 10, 140, 0.5, 3); flash('#bff4ff', 0.18); }
      if (e.type === 'heal') { part(e.x, e.y - 50, 24, '#9ff0c4', 200, 0.9, 3, -120); ring(e.x, e.y - 40, '#9ff0c4', 20, 90, 0.5, 3); num(e.x, e.y - 120, '+' + HEAL_AMOUNT, '#9ff0c4', true); }
      if (e.type === 'healGain') num(640, 300, '+1 HEAL', '#9ff0c4', true);
      if (e.type === 'slam') { shake(0.55); part(e.x, e.y, 26, '#c9a27a', 380, 0.8, 4); ring(e.x, e.y, '#ff9c6a', 20, 160, 0.45, 6, 0.36); fx.scorch.push({ x: e.x, y: e.y, t: 0 }); if (fx.scorch.length > 8) fx.scorch.shift(); fx.cracks.push(makeCrack(e.x, e.y)); if (fx.cracks.length > 6) fx.cracks.shift(); }
      if (e.type === 'hole') { shake(0.3); ring(e.x, e.y, '#ff5d3a', 140, 10, 0.5, 5, 0.36); }
      if (e.type === 'holeEnd') { ring(e.x, e.y, '#ffb18a', 10, 220, 0.6, 3, 0.36); part(e.x, e.y, 30, '#ff8a5a', 420, 0.7, 3); shake(0.35); }
      if (e.type === 'chainThrow') shake(0.1);
      if (e.type === 'chained') { shake(0.45); flash('#ff4b3a', 0.12); }
      if (e.type === 'chainBreak') { part(e.x, e.y - 40, 34, '#d8dee8', 460, 0.8, 3.5); ring(e.x, e.y - 40, '#e9f6ff', 10, 170, 0.5, 5); shake(0.5); flash('#ffffff', 0.25); }
      if (e.type === 'chainSlam') { shake(0.6); }
      if (e.type === 'qteGood') { shake(0.08); }
      if (e.type === 'qteBad') { shake(0.2); }
      if (e.type === 'runeWin') { flash('#ffe7b0', 0.35); shake(0.5); part(640, 220, 40, '#ffd27a', 520, 0.9, 3.5); }
      if (e.type === 'runeFail') { flash('#ff4b3a', 0.3); shake(0.6); }
      if (e.type === 'finisherReady') num(s.hero.x, s.hero.y - 130, 'FINISHER!', '#ffe08a', true);
      if (e.type === 'finisherSlash') { shake(0.35); flash('#ffffff', 0.22); fx.slashes.push({ t: 0, a: -0.45 + e.n * 1.6, y: 260 + e.n * 160 }); }
      if (e.type === 'finisherHit') { shake(1); flash('#ffffff', 0.6); ring(s.boss.x, s.boss.y - 90, '#ffffff', 20, 420, 0.7, 10); part(s.boss.x, s.boss.y - 90, 60, '#ffe7b8', 700, 1.1, 5); }
      if (e.type === 'phase') { shake(0.8); flash('#ff4b3a', 0.5); }
      if (e.type === 'victory') { flash('#ffffff', 0.8); part(s.boss.x, s.boss.y - 80, 80, '#ffcf8a', 600, 1.6, 5, 60); }
      if (e.type === 'boxStart') ring(640, 470, '#e8f1ff', 300, 40, 0.4, 3);
    }
  }
  function makeCrack(x, y) { const lines = []; for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + Math.random() * 0.4; let px = x, py = y; const seg = []; for (let k = 0; k < 4; k++) { px += Math.cos(a + (Math.random() - 0.5) * 0.6) * 22; py += Math.sin(a + (Math.random() - 0.5) * 0.6) * 11; seg.push([px, py]); } lines.push(seg); } return { x, y, lines, t: 0 }; }

  // ------------------------------------------------------------------ drawing helpers
  function glowCircle(x, y, r, color, alpha = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawArena(s) {
    const enraged = s.stage === 2;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, enraged ? '#1a0606' : '#061316'); sky.addColorStop(0.55, enraged ? '#3a0d0b' : '#0c2427'); sky.addColorStop(1, '#050708');
    ctx.fillStyle = sky; ctx.fillRect(-400, -200, W + 800, H + 400);
    // eclipse in the sky
    const ex = 980 - fx.camX * 0.1, ey = 150;
    glowCircle(ex, ey, 260, enraged ? 'rgba(255,90,50,.35)' : 'rgba(255,190,110,.22)');
    ctx.fillStyle = enraged ? '#ff6a3a' : '#ffd08a'; ctx.beginPath(); ctx.arc(ex, ey, 74, 0, TAU); ctx.fill();
    ctx.fillStyle = '#04090a'; ctx.beginPath(); ctx.arc(ex + 10, ey - 4, 70, 0, TAU); ctx.fill();
    // far skyline (parallax 0.2)
    ctx.fillStyle = enraged ? '#200a09' : '#0a1b1d';
    for (let i = 0; i < 18; i++) { const x = (i * 83 - fx.camX * 0.2) % (W + 200) - 100, h = 80 + (i * 37 % 110); ctx.fillRect(x, 330 - h, 54, h); }
    // mid ruins (parallax 0.5)
    ctx.fillStyle = enraged ? '#2b0e0c' : '#0e2528';
    for (let i = 0; i < 9; i++) { const x = (i * 157 - fx.camX * 0.5) % (W + 260) - 130; ctx.fillRect(x, 230 + (i % 3) * 20, 26, 140); ctx.fillRect(x - 14, 222 + (i % 3) * 20, 54, 14); }
    // floor with perspective grid
    const floor = ctx.createLinearGradient(0, 330, 0, H);
    floor.addColorStop(0, enraged ? '#1f0907' : '#0b1a1c'); floor.addColorStop(1, '#030405');
    ctx.fillStyle = floor; ctx.fillRect(-400, 330, W + 800, H);
    ctx.strokeStyle = enraged ? 'rgba(255,90,60,.16)' : 'rgba(120,230,220,.12)'; ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(640 + i * 40, 330); ctx.lineTo(640 + i * 220, H + 40); ctx.stroke(); }
    for (let i = 0; i < 7; i++) { const y = 330 + Math.pow(i / 6, 1.7) * 400; ctx.beginPath(); ctx.moveTo(-400, y); ctx.lineTo(W + 400, y); ctx.stroke(); }
    ctx.strokeStyle = enraged ? 'rgba(255,120,80,.45)' : 'rgba(140,240,230,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-400, 330); ctx.lineTo(W + 400, 330); ctx.stroke();
    // scorch marks + cracks (fade in 6 s)
    for (const sc of fx.scorch) { sc.t += 1 / 60; const a = clamp(1 - sc.t / 6, 0, 1) * 0.6; ctx.globalAlpha = a; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(sc.x, sc.y, 80, 26, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    for (const c of fx.cracks) { c.t += 1 / 60; const a = clamp(1 - c.t / 6, 0, 1); ctx.strokeStyle = `rgba(255,140,80,${0.7 * a})`; ctx.lineWidth = 2; for (const seg of c.lines) { ctx.beginPath(); ctx.moveTo(c.x, c.y); for (const [x, y] of seg) ctx.lineTo(x, y); ctx.stroke(); } }
    fx.scorch = fx.scorch.filter((x) => x.t < 6); fx.cracks = fx.cracks.filter((x) => x.t < 6);
    // embers
    for (const e of fx.embers) {
      e.y -= e.s * 0.6; e.x += Math.sin(fx.clock * 0.8 + e.ph) * 0.3; if (e.y < -10) { e.y = H + 10; e.x = Math.random() * W; }
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(fx.clock * 3 + e.ph); ctx.fillStyle = enraged ? '#ff7a4a' : '#ffc27a'; ctx.fillRect(e.x, e.y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  function shadow(x, y, w, a = 0.55) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.28, 0, 0, TAU); ctx.fill(); }
  function drawHero(s, x, y, alpha = 1, face = s.hero.face, ghost = false) {
    const h = s.hero, sq = h.squash > 0 ? 1 + h.squash * 0.8 : 1, bob = ghost ? 0 : Math.sin(fx.clock * 6) * 2;
    ctx.save(); ctx.translate(x, y + bob); ctx.scale(face * (1 / sq) * 1.3, sq * 1.3); ctx.globalAlpha = alpha;
    if (!ghost) { ctx.save(); ctx.scale(face, 1); shadow(0, 2, 34); ctx.restore(); }
    // cloak
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.quadraticCurveTo(-30, -50, -12, -78); ctx.lineTo(14, -78); ctx.quadraticCurveTo(30, -46, 24, 0);
    ctx.quadraticCurveTo(0, 8 + Math.sin(fx.clock * 8) * 3, -26, 0);
    if (ghost) { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = 'rgba(120,220,255,.12)'; ctx.fill();
      ctx.beginPath(); ctx.arc(1, -90, 16, 0, TAU); ctx.stroke(); ctx.restore(); return; }
    ctx.fillStyle = h.hurt > 0 ? '#ff8a7a' : '#1d3b4a'; ctx.fill();
    if (!ghost) {
      ctx.fillStyle = '#2d5a6e'; ctx.fillRect(-12, -72, 24, 30);
      // head + visor
      ctx.fillStyle = '#16303c'; ctx.beginPath(); ctx.arc(1, -90, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9ff8ff'; ctx.shadowColor = '#9ff8ff'; ctx.shadowBlur = 12; ctx.fillRect(2, -93, 12, 4); ctx.shadowBlur = 0;
      // blade
      const charge = h.charge >= 0 ? h.charge / HEAVY.charge : 0;
      ctx.save(); ctx.translate(18, -52); ctx.rotate(-0.9 - charge * 0.6 + (h.slashCd > SLASH.cd - 0.08 ? 1.2 : 0));
      ctx.fillStyle = '#d8f6ff'; ctx.shadowColor = charge ? '#ffd27a' : '#7fe9ff'; ctx.shadowBlur = 14 + charge * 20;
      ctx.fillRect(0, -3, 64, 6); ctx.fillStyle = '#5a7a88'; ctx.fillRect(-10, -6, 12, 12); ctx.restore(); ctx.shadowBlur = 0;
      if (charge) glowCircle(40, -60, 40 + charge * 30, 'rgba(255,210,120,.6)', 0.8);
    }
    ctx.restore();
    if (!ghost && (h.inv > 0 || h.dodgeT > 0)) { ctx.save(); ctx.globalAlpha = 0.5 + 0.3 * Math.sin(fx.clock * 30); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y - 45, 36, 56, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
  }
  function drawBoss(s) {
    const b = s.boss, enraged = s.stage === 2, x = b.x, y = b.y;
    const tell = b.tell > 0 ? Math.sin((0.45 - b.tell) / 0.45 * Math.PI) : 0;
    const sx = 1 + tell * 0.06, sy = 1 - tell * 0.05;
    shadow(x, y + 30, 120, 0.6);
    ctx.save(); ctx.translate(x, y); ctx.scale(sx * 1.12, sy * 1.12);
    // aura
    glowCircle(0, -90, 230, enraged ? 'rgba(255,70,40,.32)' : 'rgba(255,170,90,.2)');
    // robe body with flowing tendrils
    ctx.fillStyle = b.flash > 0 ? '#ffffff' : '#07090b';
    ctx.beginPath(); ctx.moveTo(-70, -170);
    ctx.quadraticCurveTo(-120, -60, -95, 20);
    for (let i = 0; i <= 8; i++) { const tx = -95 + i * 23.75, ty = 20 + Math.sin(fx.clock * 4 + i) * 12 + (i % 2) * 18; ctx.lineTo(tx, ty); }
    ctx.quadraticCurveTo(120, -60, 70, -170); ctx.quadraticCurveTo(0, -215, -70, -170); ctx.fill();
    // glowing fissures in the robe (pulse with the core)
    ctx.save(); ctx.clip(); ctx.strokeStyle = enraged ? 'rgba(255,90,50,.75)' : 'rgba(255,180,100,.45)'; ctx.lineWidth = 2; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(fx.clock * 3);
    for (const [x0, y0, x1, y1, x2, y2] of [[-40, -150, -55, -90, -38, -30], [30, -160, 52, -100, 40, -20], [-10, -60, 8, -20, -6, 15], [60, -60, 78, -10, 70, 20]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(-70, -170); ctx.quadraticCurveTo(-120, -60, -95, 20);
    for (let i = 0; i <= 8; i++) { const tx = -95 + i * 23.75, ty = 20 + Math.sin(fx.clock * 4 + i) * 12 + (i % 2) * 18; ctx.lineTo(tx, ty); }
    ctx.quadraticCurveTo(120, -60, 70, -170); ctx.quadraticCurveTo(0, -215, -70, -170);
    // rim light
    ctx.strokeStyle = enraged ? 'rgba(255,90,50,.85)' : 'rgba(255,190,110,.7)'; ctx.lineWidth = 2 + tell * 3; ctx.stroke();
    // crown
    ctx.fillStyle = b.flash > 0 ? '#fff' : (enraged ? '#ff6a3a' : '#e6b56e');
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 22 - 9, -190); ctx.lineTo(i * 22, -228 - (2 - Math.abs(i)) * 12); ctx.lineTo(i * 22 + 9, -190); ctx.fill(); }
    // core
    glowCircle(0, -95, 60 + tell * 25, enraged ? 'rgba(255,80,40,.9)' : 'rgba(255,190,110,.85)');
    ctx.fillStyle = '#04090a'; ctx.beginPath(); ctx.arc(0, -95, 20, 0, TAU); ctx.fill();
    // eyes
    ctx.fillStyle = enraged ? '#ffd0b0' : '#fff2cf'; ctx.shadowColor = enraged ? '#ff5a3a' : '#ffbf6a'; ctx.shadowBlur = 16 + tell * 18;
    ctx.fillRect(-26, -142, 16, 4); ctx.fillRect(10, -142, 16, 4); ctx.shadowBlur = 0;
    ctx.restore();
    // hands
    for (const hand of b.hands) {
      ctx.save(); ctx.translate(hand.x, hand.y);
      glowCircle(0, 0, 70, enraged ? 'rgba(255,80,40,.35)' : 'rgba(255,170,90,.25)');
      ctx.fillStyle = b.flash > 0 ? '#fff' : '#0a0c0f'; ctx.strokeStyle = enraged ? '#ff6a3a' : '#e6b56e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 30, 24, 0, 0, TAU); ctx.fill(); ctx.stroke();
      for (let f = -2; f <= 2; f++) { ctx.beginPath(); ctx.moveTo(f * 11, -14); ctx.quadraticCurveTo(f * 16, -40, f * 14 + Math.sin(fx.clock * 5 + f) * 3, -56); ctx.lineWidth = 7; ctx.strokeStyle = '#0a0c0f'; ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = enraged ? '#ff6a3a' : '#e6b56e'; ctx.stroke(); }
      ctx.restore();
    }
    if (b.stagger > 0) { ctx.fillStyle = '#ffe2a6'; ctx.font = "700 20px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('STAGGERED', x, y - 290); }
  }
  function drawTelegraphs(s) {
    for (const z of s.hazards) {
      if (z.kind === 'slam' && !z.hit) {
        const k = z.t / z.tele, pulse = 0.5 + 0.5 * Math.sin(fx.clock * 14);
        ctx.save(); ctx.strokeStyle = '#ff5a3a'; ctx.lineWidth = 3; ctx.setLineDash([12, 10]); ctx.globalAlpha = 0.5 + pulse * 0.4;
        ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.36, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,70,40,${0.08 + k * 0.22})`; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * k, z.r * 0.36 * k, 0, 0, TAU); ctx.fill(); ctx.restore();
      }
      if (z.kind === 'spin') {
        const k = z.t / z.len;
        ctx.save(); ctx.translate(z.x, z.y); ctx.scale(1, 0.36); ctx.rotate(fx.clock * 14);
        ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 5; ctx.globalAlpha = 0.9;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 90 - k * 50 - i * 14, i * 2, i * 2 + 4); ctx.stroke(); }
        ctx.restore();
      }
      if (z.kind === 'hole') {
        const life = z.t / z.len, st = Math.sin(clamp(life, 0, 1) * Math.PI), r = 26 + st * 30;
        ctx.save();
        // pull field
        ctx.strokeStyle = 'rgba(255,120,80,.35)'; ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) { const rr = ((fx.clock * 120 + i * 90) % 450); ctx.globalAlpha = (1 - rr / 450) * 0.6 * st; ctx.beginPath(); ctx.ellipse(z.x, z.y - 10, 480 - rr, (480 - rr) * 0.36, 0, 0, TAU); ctx.stroke(); }
        ctx.globalAlpha = 1;
        // accretion disk
        ctx.translate(z.x, z.y - 14); ctx.scale(1, 0.5); ctx.rotate(fx.clock * 4);
        for (let i = 0; i < 26; i++) { const a = i / 26 * TAU, d = r + 18 + Math.sin(fx.clock * 6 + i) * 6; ctx.fillStyle = i % 2 ? '#ff6a3a' : '#ffd08a'; ctx.globalAlpha = 0.7 * st; ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 4, 4); }
        ctx.globalAlpha = 1; ctx.rotate(-fx.clock * 4); ctx.scale(1, 2);
        glowCircle(0, 0, r * 2.4, 'rgba(255,90,40,.55)', st);
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#ffcf8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 1, 0, TAU); ctx.stroke();
        ctx.restore();
        // spiral-in debris
        if (Math.random() < 0.6 * st && fx.particles.length < P_MAX) { const a = Math.random() * TAU, d = 220; fx.particles.push({ x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d * 0.4, tx: z.x, ty: z.y - 14, life: 0.8, max: 0.8, size: 2.5, color: '#ffb07a', spiral: true, a, d }); }
      }
      if (z.kind === 'chain') {
        if (z.t < z.tele) {
          ctx.save(); ctx.strokeStyle = '#ff5a3a'; ctx.globalAlpha = 0.45 + 0.35 * Math.sin(fx.clock * 16); ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(z.hx, z.hy); ctx.lineTo(z.tx, z.ty); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(z.tx, z.ty, 22, 0, TAU); ctx.stroke(); ctx.restore();
        } else drawChain(z.hx, z.hy, z.cx, z.cy, 1);
      }
    }
    // boss orbs: telegraph = static core with an aim guide
    for (const p of s.shots) {
      if (p.age < p.tele) {
        ctx.save(); ctx.globalAlpha = 0.35 + 0.3 * (p.age / p.tele); ctx.strokeStyle = '#ffb08a'; ctx.setLineDash([4, 8]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.a) * 120, p.y + Math.sin(p.a) * 120); ctx.stroke(); ctx.restore();
      }
    }
  }
  function drawChain(x1, y1, x2, y2, alpha) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.floor(d / 16)), a = Math.atan2(y2 - y1, x2 - x1);
    ctx.save(); ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const t = i / n, x = lerp(x1, x2, t), y = lerp(y1, y2, t) + Math.sin(t * Math.PI) * 10;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + (i % 2 ? Math.PI / 2 : 0)); ctx.strokeStyle = '#c7ccd4'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 8, 4.5, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    ctx.fillStyle = '#e8ecf2'; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(a - 0.5) * 18, y2 - Math.sin(a - 0.5) * 18); ctx.lineTo(x2 - Math.cos(a + 0.5) * 18, y2 - Math.sin(a + 0.5) * 18); ctx.fill();
    ctx.restore();
  }
  function drawShots(s) {
    for (const p of s.shots) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (p.age < p.tele) { glowCircle(p.x, p.y, p.r * 1.6, 'rgba(255,140,90,.6)', 0.6); ctx.restore(); continue; }
      glowCircle(p.x, p.y, p.r * 2.6, 'rgba(255,100,60,.55)');
      ctx.fillStyle = '#fff1d8'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.55, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const p of s.heroShots) {
      const a = Math.atan2(p.vy, p.vx);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a); ctx.globalCompositeOperation = 'lighter';
      const heavy = p.kind === 'heavy';
      ctx.strokeStyle = heavy ? '#ffd27a' : '#bff4ff'; ctx.lineWidth = heavy ? 10 : 5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = heavy ? 26 : 12;
      ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r, -1.1, 1.1); ctx.stroke();
      ctx.lineWidth = heavy ? 3 : 2; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r - 2, -0.9, 0.9); ctx.stroke();
      ctx.restore();
    }
  }
  function drawBox(s) {
    const b = s.box; if (!b) return;
    ctx.save();
    ctx.fillStyle = 'rgba(2,4,6,.82)'; ctx.fillRect(-400, -200, W + 800, H + 400);
    const sh = b.shake > 0 ? (Math.random() - 0.5) * 6 : 0; b.shake = Math.max(0, b.shake - 1 / 60);
    ctx.translate(sh, sh * 0.6);
    ctx.fillStyle = '#05080b'; ctx.fillRect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY);
    ctx.strokeStyle = '#f2ede2'; ctx.lineWidth = 4; ctx.strokeRect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY);
    // time bar instead of a bare number
    const left = clamp(1 - b.t / b.len, 0, 1);
    ctx.fillStyle = '#23303a'; ctx.fillRect(BOX.minX, BOX.minY - 22, BOX.maxX - BOX.minX, 8);
    ctx.fillStyle = '#e8f1ff'; ctx.fillRect(BOX.minX, BOX.minY - 22, (BOX.maxX - BOX.minX) * left, 8);
    // SAFE hint: drawn exactly where the gap will be
    if (b.preview) {
      const pv = b.preview, lh = (BOX.maxY - BOX.minY) / 5, lw = (BOX.maxX - BOX.minX) / 5;
      ctx.save(); ctx.fillStyle = 'rgba(150,240,200,.16)'; ctx.strokeStyle = 'rgba(150,240,200,.8)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
      if (pv.pattern === 'lanes') {
        if (pv.vertical) { const x = BOX.minX + lw * pv.safe; ctx.fillRect(x, BOX.minY, lw, BOX.maxY - BOX.minY); ctx.strokeRect(x + 2, BOX.minY + 2, lw - 4, BOX.maxY - BOX.minY - 4); }
        else { const y = BOX.minY + lh * pv.safe; ctx.fillRect(BOX.minX, y, BOX.maxX - BOX.minX, lh); ctx.strokeRect(BOX.minX + 2, y + 2, BOX.maxX - BOX.minX - 4, lh - 4); }
      } else {
        const cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, mid = (pv.safe + 1) / 20 * TAU + pv.off, half = TAU / 20 * 1.3;
        ctx.beginPath(); ctx.rect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY); ctx.clip();
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 400, mid - half, mid + half); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(150,240,200,.9)'; ctx.font = "700 14px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = 'center'; ctx.setLineDash([]);
      ctx.fillText('SAFE', 640, BOX.maxY + 20);
      ctx.restore();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY); ctx.clip();
    for (const p of b.bullets) {
      const ready = p.age >= p.tele;
      if (p.wall) {
        ctx.fillStyle = ready ? '#ff5a46' : 'rgba(255,90,70,.25)';
        if (p.vertical) ctx.fillRect(p.x - p.r, p.y - 12, p.r * 2, 24); else ctx.fillRect(p.x - 12, p.y - p.r, 24, p.r * 2);
      } else if (!ready) {
        const sp = Math.hypot(p.vx, p.vy) || 1; ctx.strokeStyle = 'rgba(255,170,140,.55)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx / sp * (p.aimed ? 110 : 50), p.y + p.vy / sp * (p.aimed ? 110 : 50)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,200,170,.6)'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill();
      } else { ctx.fillStyle = '#ffd9c8'; ctx.shadowColor = '#ff5a46'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    }
    ctx.restore();
    // the soul IS the hurtbox: a bright diamond centred exactly on the collision point
    const so = b.soul, inv = s.hero.inv > 0 && Math.floor(fx.clock * 16) % 2;
    ctx.save(); ctx.translate(so.x, so.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = inv ? 'rgba(159,248,255,.35)' : '#9ff8ff'; ctx.shadowColor = '#9ff8ff'; ctx.shadowBlur = 14;
    ctx.fillRect(-6, -6, 12, 12); ctx.restore();
    ctx.restore();
  }
  function keycap(x, y, label, state, size = 54) {
    // state: 'todo' | 'now' | 'done' | 'bad'
    const col = { todo: '#2a333b', now: '#f2ede2', done: '#7fe0b0', bad: '#ff5a46' }[state];
    ctx.save(); ctx.translate(x, y); if (state === 'now') { const p = 1 + Math.sin(fx.clock * 10) * 0.05; ctx.scale(p, p); }
    ctx.fillStyle = '#0b1014'; ctx.fillRect(-size / 2, -size / 2 + 5, size, size);
    ctx.fillStyle = col; ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = state === 'todo' ? '#9aa6b0' : '#0b1014'; ctx.font = `700 ${size * 0.55}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 2); ctx.restore();
  }
  function drawRune(s) {
    const r = s.rune; if (!r) return;
    const cx = 640, cy = 210, k = easeOut(r.rise);
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.5 * k})`; ctx.fillRect(-400, -200, W + 800, H + 400);
    // rune circle behind the boss
    ctx.translate(s.boss.x, s.boss.y - 100); ctx.rotate(fx.clock * 0.8); ctx.strokeStyle = '#ffcf7a'; ctx.globalAlpha = 0.6 * k; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 150 + i * 26, 0, TAU); ctx.stroke(); }
    for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i / 12 * TAU); ctx.fillStyle = '#ffcf7a'; ctx.fillRect(160, -3, 14, 6); ctx.restore(); }
    ctx.restore();
    const n = r.keys.length, gap = 70, x0 = cx - (n - 1) * gap / 2;
    ctx.save(); ctx.globalAlpha = k;
    ctx.fillStyle = '#ffe2a6'; ctx.font = "700 26px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = 'center';
    ctx.fillText(r.done === 'fail' ? 'RUNE BROKEN' : r.done === 'win' ? 'REFLECTED!' : 'TYPE THE RUNES IN ORDER', cx, cy - 64);
    r.keys.forEach((key, i) => keycap(x0 + i * gap, cy, key, r.done === 'fail' && i === Math.max(0, r.wrong) ? 'bad' : i < r.i ? 'done' : i === r.i && !r.done ? 'now' : 'todo'));
    // time bar
    const left = clamp(1 - r.t / r.limit, 0, 1);
    ctx.fillStyle = '#23303a'; ctx.fillRect(cx - 200, cy + 48, 400, 8); ctx.fillStyle = left < 0.3 ? '#ff5a46' : '#ffcf7a'; ctx.fillRect(cx - 200, cy + 48, 400 * left, 8);
    ctx.fillStyle = '#b8c4cc'; ctx.font = "600 16px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.fillText('WRONG KEY OR TOO SLOW = CONTROLS INVERTED', cx, cy + 82);
    ctx.restore();
  }
  function drawChained(s) {
    const c = s.chain; if (!c) return;
    const h = s.hero;
    drawChain(s.boss.x - 70, s.boss.y - 70, h.x, h.y - 45, 1);
    drawChain(s.boss.x + 30, s.boss.y - 40, h.x + 10, h.y - 30, 0.8);
    const n = c.keys.length, gap = 74, cx = h.x, cy = h.y - 170, x0 = cx - (n - 1) * gap / 2;
    ctx.save(); ctx.fillStyle = '#ffffff'; ctx.font = "700 24px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = 'center';
    ctx.fillText('BREAK FREE!', cx, cy - 50);
    c.keys.forEach((key, i) => keycap(x0 + i * gap, cy, key, i < c.i ? 'done' : i === c.i ? (c.wrong > 0 ? 'bad' : 'now') : 'todo', 56));
    const left = clamp(1 - c.t / c.limit, 0, 1); ctx.fillStyle = '#23303a'; ctx.fillRect(cx - 110, cy + 42, 220, 7); ctx.fillStyle = '#ff7a5a'; ctx.fillRect(cx - 110, cy + 42, 220 * left, 7);
    ctx.restore();
  }
  function drawFinisher(s) {
    const c = s.finisher.cine;
    for (const tr of s.hero.trail) drawHero(s, tr.x, tr.y, tr.life * 2.4, tr.face, true);
    if (!c) return;
    const k = c.t / c.len;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(-400, -200, W + 800, H + 400);
    // speed lines toward the boss
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const a = i / 26 * TAU + fx.clock * 0.5, r1 = 160 + ((fx.clock * 900 + i * 53) % 420); ctx.beginPath(); ctx.moveTo(s.boss.x + Math.cos(a) * r1, s.boss.y - 90 + Math.sin(a) * r1); ctx.lineTo(s.boss.x + Math.cos(a) * (r1 + 70), s.boss.y - 90 + Math.sin(a) * (r1 + 70)); ctx.stroke(); }
    ctx.restore();
  }
  function drawFinisherScreen(s) {
    const c = s.finisher.cine; if (!c) return;
    const k = c.t / c.len, bar = easeOut(Math.min(1, k * 5)) * 74;
    ctx.fillStyle = '#000'; ctx.fillRect(-400, -200, W + 800, 200 + bar); ctx.fillRect(-400, H - bar, W + 800, bar + 200);
    drawSlashes();
    if (k < 0.32) { ctx.save(); ctx.globalAlpha = Math.min(1, k * 8) * (1 - Math.max(0, (k - 0.22) * 10)); const sc = reducedMotion ? 1 : lerp(1.25, 1, easeOut(k * 6));
      ctx.translate(640, 150); ctx.scale(sc, sc); ctx.fillStyle = '#ffe08a'; ctx.strokeStyle = '#05070a'; ctx.lineWidth = 6; ctx.font = "700 70px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = 'center';
      ctx.strokeText('ECLIPSE BREAKER', 0, 0); ctx.fillText('ECLIPSE BREAKER', 0, 0); ctx.restore(); }
    if (k > 0.8) { ctx.save(); ctx.globalAlpha = clamp((k - 0.8) * 8, 0, 1); ctx.fillStyle = '#fff'; ctx.font = "700 30px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('FINISH!', 640, H - 30); ctx.restore(); }
  }
  function drawSlashes() {
    for (const sl of fx.slashes) {
      sl.t += 1 / 60; const a = clamp(1 - sl.t / 0.45, 0, 1), grow = easeOut(Math.min(1, sl.t * 9));
      ctx.save(); ctx.translate(640, sl.y); ctx.rotate(sl.a); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(-900 * grow, -4 * a - 1, 1800 * grow, 8 * a + 2);
      ctx.fillStyle = `rgba(255,210,120,${a * 0.6})`; ctx.fillRect(-900 * grow, -14 * a, 1800 * grow, 28 * a);
      ctx.restore();
    }
    fx.slashes = fx.slashes.filter((x) => x.t < 0.45);
  }
  function hpBar(x, y, w, h, hp, chip, max, color, gates = []) {
    ctx.fillStyle = '#0b1014'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#1e262c'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f2ede2'; ctx.fillRect(x, y, w * chip / max, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * hp / max, h);
    ctx.fillStyle = '#0b1014'; for (const g of gates) ctx.fillRect(x + w * g / max - 1.5, y - 3, 3, h + 6);
  }
  function drawHud(s, touch = false) {
    const b = s.boss, h = s.hero, font = (px, wt = 700) => `${wt} ${px}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    // boss bar (top)
    ctx.fillStyle = s.stage === 2 ? '#ff8a6b' : '#ffd7a1'; ctx.font = font(22); ctx.textAlign = 'left'; ctx.fillText('THE ECLIPSE', 290, 42);
    ctx.fillStyle = '#9aa6b0'; ctx.font = font(15, 600); ctx.textAlign = 'right'; ctx.fillText(s.stage === 2 ? 'PHASE 2' : 'PHASE 1', 990, 42);
    hpBar(290, 52, 700, 14, b.hp, b.chip, BOSS_HP, s.stage === 2 ? '#ff5a3a' : '#e6a54a', GATES.slice(b.gateIndex));
    // hero panel (bottom left; top left on touch so the joystick never covers it)
    const hy = touch ? 96 : 650;
    ctx.textAlign = 'left'; ctx.fillStyle = '#d8f6ff'; ctx.font = font(18); ctx.fillText('WARDEN', 40, hy);
    hpBar(40, hy + 10, 300, 12, h.hp, Math.max(h.hp, h.chip), HERO.hp, h.hp < 25 ? '#ff6a5a' : '#7fe0b0');
    // heals as pips
    for (let i = 0; i < Math.max(h.heals, 1); i++) { const on = i < h.heals; ctx.fillStyle = on ? '#9ff0c4' : '#26323a'; ctx.beginPath(); ctx.arc(360 + i * 22, hy + 16, 8, 0, TAU); ctx.fill(); ctx.fillStyle = on ? '#0b1014' : '#4b5a63'; ctx.fillRect(356 + i * 22, hy + 15, 8, 2); ctx.fillRect(359 + i * 22, hy + 12, 2, 8); }
    ctx.fillStyle = '#9aa6b0'; ctx.font = font(13, 600); ctx.fillText(touch ? 'HEALS' : 'H HEAL', 356, hy + 40);
    // ability ring cooldowns (bottom right)
    const abil = touch ? [] : [['J', 'SLASH', h.slashCd / SLASH.cd], ['K', 'HEAVY', h.heavyCd / HEAVY.cd], ['SPACE', 'DODGE', h.dodgeCd / HERO.dodgeCd]];
    abil.forEach(([key, name, cd], i) => {
      const x = 1040 + i * 74, y = 655;
      ctx.fillStyle = '#0b1014'; ctx.beginPath(); ctx.arc(x, y, 26, 0, TAU); ctx.fill();
      ctx.strokeStyle = cd > 0 ? '#3a4650' : '#e8f1ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 26, 0, TAU); ctx.stroke();
      if (cd > 0) { ctx.strokeStyle = '#e8f1ff'; ctx.beginPath(); ctx.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - cd)); ctx.stroke(); }
      ctx.fillStyle = cd > 0 ? '#6c7a84' : '#f2ede2'; ctx.font = font(key.length > 1 ? 13 : 20); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(key, x, y + 1); ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#9aa6b0'; ctx.font = font(12, 600); ctx.fillText(name, x, y + 42);
    });
    // finisher prompt
    if (s.finisher.prompt > 0 && s.phase === 'fight') {
      const p = s.finisher.prompt / FINISHER.window, pulse = 1 + Math.sin(fx.clock * 12) * 0.06;
      ctx.save(); ctx.translate(640, touch ? 470 : 590); ctx.scale(pulse, pulse);
      ctx.fillStyle = '#0b1014'; ctx.fillRect(-150, -30, 300, 60); ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3; ctx.strokeRect(-150, -30, 300, 60);
      ctx.fillStyle = '#ffe08a'; ctx.fillRect(-150, 26, 300 * p, 4);
      ctx.font = font(30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(touch ? 'FINISHER!' : 'FINISHER  [ F ]', 0, 0); ctx.restore(); ctx.textBaseline = 'alphabetic';
    }
    // inverted controls status
    if (h.invert > 0 && s.phase !== 'rune') {
      ctx.save(); ctx.fillStyle = '#ff7a5a'; ctx.font = font(22); ctx.textAlign = 'center';
      const jit = reducedMotion ? 0 : Math.sin(fx.clock * 40) * 2; ctx.fillText(`CONTROLS INVERTED  ${h.invert.toFixed(1)}s`, 640 + jit, 110); ctx.restore();
    }
    // banner
    if (s.banner) {
      const bn = s.banner, inT = easeOutBack(bn.t / 0.3), out = clamp((bn.t - 1.4) / 0.35, 0, 1);
      if (bn.t < 1.75) {
        ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(640, 250); const sc = reducedMotion ? 1 : lerp(1.4, 1, clamp(inT, 0, 1.1)); ctx.scale(sc, sc);
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-W, -46, W * 2, 92);
        ctx.fillStyle = bn.color; ctx.font = font(64); ctx.textAlign = 'center'; ctx.fillText(bn.text, 0, 18);
        if (bn.sub) { ctx.fillStyle = '#d0d8de'; ctx.font = font(18, 600); ctx.fillText(bn.sub, 0, 40); }
        ctx.restore();
      }
    }
  }
  function drawFx(dt) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of fx.particles) {
      p.life -= dt;
      if (p.spiral) { p.a += dt * 5; p.d = Math.max(0, p.d - dt * 260); p.x = p.tx + Math.cos(p.a) * p.d; p.y = p.ty + Math.sin(p.a) * p.d * 0.4; }
      else { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; }
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    fx.particles = fx.particles.filter((p) => p.life > 0);
    for (const r of fx.rings) { r.t += dt; const k = r.t / r.life; ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (1 - k) + 0.5; ctx.beginPath(); ctx.ellipse(r.x, r.y, lerp(r.r0, r.r1, easeOut(k)), lerp(r.r0, r.r1, easeOut(k)) * r.flat, 0, 0, TAU); ctx.stroke(); }
    fx.rings = fx.rings.filter((r) => r.t < r.life);
    ctx.restore();
    for (const n of fx.numbers) {
      n.t += dt; const k = n.t / (n.big ? 1 : 0.7);
      ctx.save(); ctx.globalAlpha = clamp(1 - k, 0, 1); ctx.fillStyle = n.color; ctx.strokeStyle = '#05070a'; ctx.lineWidth = 4;
      ctx.font = `700 ${n.big ? 34 : 22}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; ctx.textAlign = 'center';
      const y = n.y - easeOut(k) * 30, sc = n.big ? lerp(1.5, 1, easeOut(Math.min(1, n.t * 6))) : 1;
      ctx.translate(n.x, y); ctx.scale(sc, sc); ctx.strokeText(n.text, 0, 0); ctx.fillText(n.text, 0, 0); ctx.restore();
    }
    fx.numbers = fx.numbers.filter((n) => n.t < (n.big ? 1 : 0.7));
  }

  function render(s, dt, view) {
    fx.clock += dt;
    consume(s); s.events.length = 0;
    const { width, height, scale, ox, oy } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050708'; ctx.fillRect(0, 0, width, height);
    // camera: midpoint framing + gentle zoom; push-in during finisher, pull back in box
    const h = s.hero, b = s.boss;
    let tz = 1, tx = 0, ty = 0;
    if (s.phase === 'finisher') { tz = reducedMotion ? 1 : 1.35; tx = (b.x - 640) * 0.6; ty = (b.y - 140 - 360) * 0.6; }
    else if (s.phase === 'box') tz = reducedMotion ? 1 : 0.96;
    else if (s.phase === 'chained') { tz = reducedMotion ? 1 : 1.08; tx = ((h.x + b.x) / 2 - 640) * 0.4; }
    else if (['fight', 'intro', 'victory', 'defeat'].includes(s.phase)) { tx = ((h.x + b.x) / 2 - 640) * 0.18; tz = reducedMotion ? 1 : 1 + clamp(1 - Math.abs(b.x - h.x) / 900, 0, 1) * 0.06; }
    fx.zoom = lerp(fx.zoom, tz, 1 - Math.exp(-dt * 5)); fx.camX = lerp(fx.camX, tx, 1 - Math.exp(-dt * 4)); fx.camY = lerp(fx.camY, ty, 1 - Math.exp(-dt * 4));
    fx.trauma = Math.max(0, fx.trauma - dt * 1.5);
    const sh = fx.trauma * fx.trauma, shx = Math.sin(fx.clock * 47) * 14 * sh, shy = Math.sin(fx.clock * 61) * 9 * sh, rot = Math.sin(fx.clock * 31) * 0.02 * sh;
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.translate(640 + shx, 360 + shy); ctx.rotate(rot); ctx.scale(fx.zoom, fx.zoom); ctx.translate(-640 - fx.camX, -360 - fx.camY);
    drawArena(s);
    drawTelegraphs(s);
    // depth sort hero and boss by y
    const heroFirst = h.y < b.y + 30;
    for (const tr of (s.phase === 'finisher' ? [] : h.trail)) drawHero(s, tr.x, tr.y, tr.life * 2, tr.face, true);
    if (heroFirst) { drawHero(s, h.x, h.y); drawBoss(s); } else { drawBoss(s); drawHero(s, h.x, h.y); }
    drawShots(s);
    if (s.phase === 'chained') drawChained(s);
    drawFinisher(s);
    drawFx(dt);
    drawBox(s);
    drawRune(s);
    // screen-space overlays
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    if (h.invert > 0 && !reducedMotion) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.08 + 0.05 * Math.sin(fx.clock * 9); ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-6, 0, W, H); ctx.fillStyle = '#2affd8'; ctx.fillRect(6, 0, W, H); ctx.restore(); }
    fx.vignette = Math.max(h.hp < 25 ? 0.25 + 0.15 * Math.sin(fx.clock * 5) : 0, fx.vignette - dt);
    if (fx.vignette > 0) { const g = ctx.createRadialGradient(640, 360, 250, 640, 360, 760); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(170,20,10,${fx.vignette})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    drawFinisherScreen(s);
    if (s.phase !== 'finisher') drawHud(s, !!view.touch);
    if (fx.flash > 0) { ctx.globalAlpha = fx.flash; ctx.fillStyle = fx.flashColor; ctx.fillRect(-400, -200, W + 800, H + 400); ctx.globalAlpha = 1; fx.flash = Math.max(0, fx.flash - dt * 5); }
    if (s.phase === 'intro') { const k = s.phaseT / 1.6; ctx.fillStyle = `rgba(0,0,0,${1 - easeOut(k)})`; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#ffd7a1'; ctx.globalAlpha = Math.sin(clamp(k, 0, 1) * Math.PI); ctx.font = "700 72px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('THE ECLIPSE', 640, 340); ctx.globalAlpha = 1; }
  }
  return { render, fx };
}
