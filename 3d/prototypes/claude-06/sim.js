import { SCRIPT } from './script.js?v=6';
// Prototype 6-Claude: simulation (no DOM). Fixed 1/120 s steps; hit-stop/slow-mo scale only this clock.
// Stand-in cast drawn by render.js ("Warden" vs "The Eclipse") so ChatGPT can swap in the real characters.
//
// Structure (owner, Oct 1): two phases where BOTH fighters change form, joined by an interactive laser clash;
// a final domain clash ends phase 2; a SECRET phase 3 ("TOTALITY") opens if phase 2 ends on the ECLIPSE BREAKER
// finisher: extremely hard, its own look, its own clash and the better rewards.
// Every 20% of boss HP: SURVIVE box -> TIME YOUR COUNTER. Heals: 1 at each phase start, +1 per SURVIVE, no carry.
// v3 (owner's full ChatGPT list): finisher = 7 keys in order; attacks can MISS; each form's six specials behave
// differently; harder boxes (sweep, crusher, rain, bouncers); both-hands barrage; combos from phase 2; bigger arena;
// clash ends with a sword throw; clickable cinematic dialogue (script.js, placeholder lines for the stand-ins).

export const W = 1280, H = 720;
export const FLOOR = { minX: 46, maxX: 1234, minY: 345, maxY: 692 };
export const BOX = { minX: 420, maxX: 860, minY: 330, maxY: 610 };
const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const STAGES = {
  1: { bossHp: 1500, gates: [0.8, 0.6, 0.4, 0.2], gap: 1.9, speed: 1, dmg: 1, dodge: 0.1, boss: 'THE ECLIPSE', hero: 'WARDEN' },
  2: { bossHp: 2000, gates: [0.8, 0.6, 0.4, 0.2], gap: 1.45, speed: 1.18, dmg: 1.15, dodge: 0.2, boss: 'THE ECLIPSE · UNBOUND', hero: 'WARDEN · REBORN' },
  3: { bossHp: 2600, gates: [0.75, 0.5, 0.25], gap: 1.0, speed: 1.42, dmg: 1.4, dodge: 0.28, boss: 'TOTALITY', hero: 'WARDEN · ASCENDED' },
};
export const HERO_MAX = 100, HEAL = 32;
const SLASH = { cd: 0.24, dmg: [0, 4, 6, 8], speed: 1000, r: 24 };
// six specials per form (index = stage); "strongest normal attack" = nova of the current form
export const ABIL = {
  star:    { key: '1', names: ['', 'STAR', 'SHIELD', 'SUNSHARD'],      cd: [0, .45, .7, .6],  dmg: [0, 9, 12, 10] },
  spinner: { key: '2', names: ['', 'SPIN', 'ORBIT', 'HALO'],           cd: [0, .9, 6, 5],     dmg: [0, 4, 7, 12] },
  burst:   { key: '3', names: ['', 'BURST', 'SHOCKWAVE', 'SUPERNOVA'], cd: [0, 1.9, 2.4, 3.2], dmg: [0, 18, 24, 60] },
  eyes:    { key: '4', names: ['', 'EYES', 'LANCE', 'JUDGEMENT'],      cd: [0, 1.3, 2.2, 2],  dmg: [0, 14, 30, 36] },
  lattice: { key: '5', names: ['', 'SIXFOLD', 'SEAL', 'STARFALL'],     cd: [0, 2.6, 4, 4.5],  dmg: [0, 5, 46, 9] },
  nova:    { key: '6', names: ['', 'NOVA', 'DOMAIN', 'TOTALITY'],      cd: [0, 4.8, 7, 8],    dmg: [0, 34, 40, 120] },
};
// chance an attack simply misses (owner: "add an error chance of missing")
const MISS = { slash: .07, star: .08, shield: .05, spin: .1, burst: .05, fall: .1, nova: .04, shard: .06, wave: .06, eyes: .05 };
export const ABIL_ORDER = ['star', 'spinner', 'burst', 'eyes', 'lattice', 'nova'];
export const FIN = { mult: 2, chance: [0, .08, .08, .06], cooldown: 16, window: 2.6, len: 2.8, keys: 7, qte: [0, 4.2, 3.8, 3.3] };
export const FIN_KEYS = ['W', 'A', 'S', 'D', 'J', 'K', 'L', 'I'];
export const RUNE_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'];
export const CHAIN_KEYS = ['J', 'K', 'L', 'U', 'I', 'O'];
export const TALK_CPS = 42;
export const REWARDS = {
  normal: ['ECLIPSE CARD', 'WARDEN REBORN CARD', '1,000 COINS'],
  secret: ['TOTALITY CARD · SECRET', 'ASCENDED WARDEN CARD', 'TITLE: ECLIPSE BREAKER', '5,000 COINS'],
};

export function createFight({ seed = 7, force = null } = {}) {
  const s = {
    t: 0, phase: 'intro', phaseT: 0, stage: 1, R: rng(seed), events: [], force, forceUsed: false,
    hero: { x: 300, y: 560, vx: 0, vy: 0, hp: HERO_MAX, chip: HERO_MAX, face: 1, inv: 0, dodgeT: 0, dodgeCd: 0, dodgeDir: [1, 0],
      slashCd: 0, cds: {}, sel: 'star', heals: 1, invert: 0, squash: 0, hurt: 0, trail: [], cast: null, orbit: null, lance: null, field: null, charge: null, starfall: null },
    boss: null, shots: [], heroShots: [], hazards: [], box: null, timing: null, rune: null, chain: null, clash: null, cine: null,
    finisher: { prompt: 0, cd: 6, cine: null }, fq: null, talk: null, noTalk: !!force, banner: null, hitstop: 0, slowmo: 0, secret: false, result: null, stats: { perfects: 0, finishers: 0, heals: 0 },
  };
  setupStage(s, 1, true);
  if (force === 'stage2') { setupStage(s, 2, true); }
  if (force === 'stage3') { setupStage(s, 3, true); }
  if (force === 'clash1' || force === 'clash2' || force === 'clash3') { const k = Number(force.slice(-1)); if (k > 1) setupStage(s, k, true); s.boss.hp = 0; s.pendingClash = k; s.secret = k === 2 && false; }
  if (force === 'secret') { setupStage(s, 2, true); s.boss.gateIndex = s.boss.gates.length; s.boss.hp = 40; s.boss.chip = 40; s.finisher.cd = 0; s.forceFinisherPrompt = true; }
  if (force === 'box') { s.pendingGate = true; s.boss.hp = s.boss.gates[0]; s.boss.chip = s.boss.hp; }
  if (force === 'finisher') { s.finisher.cd = 0; s.forceFinisherPrompt = true; }
  return s;
}
function setupStage(s, stage, silent = false) {
  const cfg = STAGES[stage];
  s.stage = stage;
  s.boss = { x: 980, y: 455, hp: cfg.bossHp, max: cfg.bossHp, chip: cfg.bossHp, gates: cfg.gates.map((g) => Math.round(cfg.bossHp * g)), gateIndex: 0,
    attackCd: 2.2, last: null, tell: 0, tellKind: null, flash: 0, stagger: 0, sway: 0, dodgeCd: 2, dodgeT: 0, dodgeDir: 1,
    cds: { barrage: 7, slam: 4, chains: 6, rune: 10, catch: 7, earth: 5, laser: 3, cross: 6, doom: 8, gravity: 9, spiral: 5, corona: 7, twin: 12 },
    hands: [{ x: 860, y: 450, busy: false }, { x: 1100, y: 450, busy: false }] };
  s.hero.heals = 1; // heals never carry into the next phase
  Object.assign(s.hero, { cds: {}, invert: 0, orbit: null, lance: null, field: null, charge: null, starfall: null }); s.shots = []; s.heroShots = []; s.hazards = [];
  if (!silent) { ev(s, 'stage', { stage }); }
}

function ev(s, type, extra = {}) { s.events.push({ type, ...extra }); }
function setPhase(s, p) { s.phase = p; s.phaseT = 0; }
function banner(s, text, sub = '', color = '#ffd7a1') { s.banner = { text, sub, color, t: 0 }; }
const cfg = (s) => STAGES[s.stage];

// ---------------------------------------------------------------------------------------------- damage
function hurtHero(s, dmg, source, x = s.hero.x, y = s.hero.y - 46) {
  const h = s.hero;
  if (h.inv > 0 || h.dodgeT > 0 || !['fight', 'box', 'chained', 'rune'].includes(s.phase)) return false;
  const d = Math.round(dmg * cfg(s).dmg);
  h.hp = Math.max(0, h.hp - d); h.inv = 0.7; h.hurt = 0.3;
  ev(s, 'heroHit', { dmg: d, source, x, y });
  if (h.hp <= 0) { setPhase(s, 'defeat'); s.result = { tier: 'defeat' }; ev(s, 'defeat'); }
  return true;
}
const bossFloor = (s) => s.boss.gateIndex < s.boss.gates.length ? s.boss.gates[s.boss.gateIndex] : 0;
function hurtBoss(s, dmg, kind, x = s.boss.x, y = s.boss.y - 80) {
  const b = s.boss;
  if (b.hp <= 0 || !['fight', 'finisher', 'timing', 'rune', 'chained'].includes(s.phase)) return 0;
  const floor = bossFloor(s), before = b.hp;
  b.hp = Math.max(floor, b.hp - dmg); b.flash = 0.09;
  const dealt = Math.round(before - b.hp);
  ev(s, 'bossHit', { dmg: dealt, kind, x, y });
  if (b.hp <= 0) {
    if (s.stage === 2 && kind === 'finisher') s.secret = true; // the secret path to TOTALITY
    s.pendingClash = s.stage; ev(s, 'bossDown', { stage: s.stage });
  } else if (b.hp <= floor && floor > 0) s.pendingGate = true;
  return dealt;
}

// ---------------------------------------------------------------------------------------------- boss attacks
const eye = (s) => ({ x: s.boss.x, y: s.boss.y - 160 });
const POOLS = {
  1: [['orbs', 3], ['slam', 2], ['barrage', 1.3], ['chains', 1.5], ['rune', 1.1], ['catch', 1.6], ['earth', 1.6], ['laser', 2]],
  2: [['orbs', 2], ['slam', 1.6], ['barrage', 1.6], ['chains', 1.4], ['rune', 1.2], ['catch', 1.4], ['earth', 1.3], ['laser', 1.8], ['cross', 1.8], ['doom', 1.6], ['gravity', 1.4], ['spiral', 1.6]],
  3: [['orbs', 1.5], ['slam', 1.4], ['barrage', 1.5], ['chains', 1.3], ['rune', 1.2], ['catch', 1.3], ['earth', 1.2], ['laser', 1.6], ['cross', 1.7], ['doom', 1.6], ['gravity', 1.3], ['spiral', 1.6], ['corona', 1.8], ['twin', 1.2]],
};
const SOLO = new Set(['rune', 'chains']); // never part of a combo
function chooseAttack(s) {
  const b = s.boss;
  if (s.force && !s.forceUsed && POOLS[3].some(([k]) => k === s.force)) { s.forceUsed = true; return [s.force]; }
  const ready = POOLS[s.stage].filter(([k]) => (b.cds[k] ?? 0) <= 0 && k !== b.last);
  if (!ready.length) return ['orbs'];
  const pick = () => { const tot = ready.reduce((a, [, w]) => a + w, 0); let p = s.R() * tot; for (const [k, w] of ready) { p -= w; if (p <= 0) return k; } return ready[0][0]; };
  const first = pick();
  // phase 2-3: sometimes two attacks at once (never two hand attacks or pulls, never with a QTE)
  const BIG = ['slam', 'gravity', 'twin', 'barrage', 'catch'];
  if (s.stage >= 2 && !SOLO.has(first) && s.R() < (s.stage === 3 ? 0.55 : 0.3)) { // owner: multiple attacks at once
    const second = ready.map(([k]) => k).filter((k) => k !== first && !SOLO.has(k) && !(BIG.includes(k) && BIG.includes(first)));
    if (second.length) return [first, second[Math.floor(s.R() * second.length)]];
  }
  return [first];
}
function startAttacks(s, kinds) {
  const b = s.boss, h = s.hero, R = s.R, sp = cfg(s).speed, fast = 1 / sp;
  b.tell = 0.45; b.tellKind = kinds[0]; ev(s, 'tell', { kind: kinds[0] });
  let wait = cfg(s).gap;
  for (const kind of kinds) {
    b.last = kind; b.cds[kind] = { orbs: 0, barrage: 10, slam: 9, chains: 11, rune: 18, catch: 8, earth: 6, laser: 3.5, cross: 7, doom: 9, gravity: 10, spiral: 6, corona: 8, twin: 14 }[kind] * (s.stage === 3 ? 0.75 : 1);
    if (kind === 'orbs') {
      const e = eye(s), n = 5 + s.stage * 2, base = Math.atan2(h.y - 40 - e.y, h.x - e.x);
      for (let i = 0; i < n; i++) s.shots.push({ kind: 'orb', x: e.x, y: e.y, a: base + (i - (n - 1) / 2) * 0.16, speed: 320 * sp, r: 13, dmg: 9, tele: .55 * fast, age: 0 });
    } else if (kind === 'spiral') {
      const e = eye(s), n = s.stage === 3 ? 28 : 20;
      for (let i = 0; i < n; i++) s.shots.push({ kind: 'orb', x: e.x, y: e.y, a: i / n * TAU * 1.5 + R() * .1, speed: 240 * sp, spin: .7, r: 11, dmg: 8, tele: .45 + i * .04 * fast, age: 0 });
      wait += 0.4;
    } else if (kind === 'slam') {
      const hand = b.hands[h.x < b.x ? 0 : 1]; hand.busy = true;
      s.hazards.push({ kind: 'slam', x: clamp(h.x, FLOOR.minX + 80, FLOOR.maxX - 80), y: clamp(h.y, FLOOR.minY + 40, FLOOR.maxY - 20), hand, t: 0, tele: .85 * fast, r: 92, hit: false });
      wait += 0.8;
    } else if (kind === 'barrage') { // both hands spam slams around you, alternating
      b.hands.forEach((hd) => { hd.busy = true; });
      const n = s.stage === 3 ? 8 : 6; s.hazards.push({ kind: 'barrage', t: 0, n, i: 0, gap: .36 * fast });
      wait += n * .36 * fast + .3;
    } else if (kind === 'twin') {
      for (const x of [280, 1000]) s.hazards.push({ kind: 'spin', x, y: 520, t: 0, len: .9 });
      wait += 1.6;
    } else if (kind === 'chains') {
      s.hazards.push({ kind: 'chain', t: 0, tele: .75 * fast, tx: h.x, ty: h.y - 40, hx: b.x - 60, hy: b.y - 70, head: 0, done: false });
    } else if (kind === 'rune') {
      const n = 4 + s.stage, keys = [];
      while (keys.length < n) { const k = RUNE_KEYS[Math.floor(R() * RUNE_KEYS.length)]; if (k !== keys[keys.length - 1]) keys.push(k); }
      s.rune = { keys, i: 0, t: 0, limit: [0, 5, 4.4, 4.2][s.stage], rise: 0, wrong: -1, done: null };
      setPhase(s, 'rune'); ev(s, 'runeStart');
    } else if (kind === 'catch') {
      const y = clamp(h.y - 20, FLOOR.minY + 30, FLOOR.maxY - 30);
      b.hands.forEach((hd) => { hd.busy = true; });
      s.hazards.push({ kind: 'catch', y, t: 0, tele: 1 * fast, close: .55, band: 46, hit: false });
      wait += 0.9;
    } else if (kind === 'earth') {
      const tx = clamp(h.x + h.vx * .5, FLOOR.minX + 60, FLOOR.maxX - 60), ty = clamp(h.y + h.vy * .5, FLOOR.minY + 30, FLOOR.maxY - 20);
      s.hazards.push({ kind: 'earth', sx: b.x, sy: b.y - 200, tx, ty, t: 0, tele: .85 * fast, fly: .7, r: 110, hit: false });
    } else if (kind === 'laser') {
      const e = eye(s), a = Math.atan2(h.y - 40 - e.y, h.x - e.x);
      s.hazards.push({ kind: 'laser', x: e.x, y: e.y, a, t: 0, tele: .8 * fast, len: .35, w: 26, hit: false, track: true });
    } else if (kind === 'cross') {
      s.hazards.push({ kind: 'cross', x: h.x, y: h.y - 30, a: R() * Math.PI, t: 0, tele: .95 * fast, len: .5, w: 30, hit: false });
    } else if (kind === 'doom') {
      const n = s.stage === 3 ? 7 : 5;
      for (let i = 0; i < n; i++) s.hazards.push({ kind: 'meteor', x: clamp(h.x + (R() - .5) * 520, FLOOR.minX + 40, FLOOR.maxX - 40), y: clamp(h.y + (R() - .5) * 200, FLOOR.minY + 20, FLOOR.maxY - 10), t: -i * .22, tele: .85 * fast, r: 68, hit: false });
      wait += 0.6;
    } else if (kind === 'gravity') {
      s.hazards.push({ kind: 'well', x: h.x, y: h.y, t: 0, len: 2.4 * fast, r0: 230, hit: false });
      wait += 0.8;
    } else if (kind === 'corona') {
      s.hazards.push({ kind: 'corona', t: 0, tele: 1 * fast, len: 1.6 * fast, gap: FLOOR.minY + 10 + R() * 200, hit: false });
      wait += 1.2;
    }
  }
  b.attackCd = wait;
}

// ---------------------------------------------------------------------------------------------- hero
function aimAt(s, ox, oy) { const b = s.boss, dx = b.x - ox, dy = (b.y - 105) - oy, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
function castAbility(s, name) {
  const h = s.hero, b = s.boss, st = s.stage, a = ABIL[name], ox = h.x + h.face * 30, oy = h.y - 50, [ax, ay] = aimAt(s, ox, oy), ang = Math.atan2(ay, ax);
  h.cds[name] = a.cd[st]; h.squash = .16; h.face = ax >= 0 ? 1 : -1;
  const dmg = a.dmg[st], shot = (o) => s.heroShots.push({ x: ox, y: oy, age: 0, life: 2, r: 12, dmg, ...o });
  switch (name + st) {
    // form 1 · WARDEN
    case 'star1': shot({ kind: 'star', vx: ax * 820, vy: ay * 820, r: 14, life: 1.6 }); break;
    case 'spinner1': for (let i = -1; i <= 1; i++) { const r = ang + i * .18; shot({ kind: 'spin', vx: Math.cos(r) * 760, vy: Math.sin(r) * 760, r: 11, life: 1.5 }); } break;
    case 'burst1': shot({ kind: 'burst', vx: ax * 560, vy: ay * 560, r: 18, splash: 105 }); break;
    case 'eyes1': s.hazards.push({ kind: 'heroBeam', x: ox, y: oy - 30, a: ang, t: 0, tele: .14, len: .22, dmg, hit: false }); break;
    case 'lattice1': for (let i = 0; i < 6; i++) s.heroShots.push({ kind: 'fall', x: b.x + (i - 2.5) * 34, y: -40 - i * 60, vx: 0, vy: 900, r: 12, dmg, life: 2, age: 0 }); break;
    case 'nova1': shot({ kind: 'nova', vx: ax * 430, vy: ay * 430, r: 46, life: 3, pierce: true, splash: 140 }); break;
    // form 2 · REBORN: every special works differently from form 1
    case 'star2': shot({ kind: 'shield', vx: ax * 900, vy: ay * 900, r: 18, life: 2.2, ret: true }); break;
    case 'spinner2': h.orbit = { t: 5, fire: .5, n: 6, dmg }; break;
    case 'burst2': s.heroShots.push({ kind: 'wave', x: h.x, y: h.y, vx: (b.x >= h.x ? 1 : -1) * 640, vy: 0, r: 30, dmg, life: 2.2, age: 0, ground: true, pierce: true }); break;
    case 'eyes2': { const d = Math.sign(b.x - h.x) || 1; h.lance = { t: 0, len: .5, fx: h.x, fy: h.y, tx: clamp(b.x - 120 * d, FLOOR.minX, FLOOR.maxX), ty: clamp(b.y + 30, FLOOR.minY, FLOOR.maxY), hit: false, dmg }; h.inv = Math.max(h.inv, .6); break; }
    case 'lattice2': s.hazards.push({ kind: 'seal', t: 0, tele: 1.1, dmg, hit: false }); break;
    case 'nova2': shot({ kind: 'nova', vx: ax * 460, vy: ay * 460, r: 52, life: 3, pierce: true, splash: 160 }); h.field = { t: 4, r: 210 }; break;
    // form 3 · ASCENDED
    case 'star3': for (let i = -1; i <= 1; i++) { const r = ang + i * .55; shot({ kind: 'shard', vx: Math.cos(r) * 700, vy: Math.sin(r) * 700, r: 12, life: 2.4, homing: true }); } break;
    case 'spinner3': s.hazards.push({ kind: 'halo', x: h.x, y: h.y - 45, t: 0, len: .55, r: 0, dmg, hit: false }); h.inv = Math.max(h.inv, .45); break;
    case 'burst3': h.charge = { t: 0, len: .55, dmg }; break;
    case 'eyes3': s.hazards.push({ kind: 'judgement', t: 0, tele: .4, len: .35, dmg, hit: false }); break;
    case 'lattice3': h.starfall = { t: 0, n: 0, total: 12, dmg }; break;
    case 'nova3': s.hazards.push({ kind: 'totalitySigil', t: 0, tele: .9, dmg, hit: false }); h.inv = Math.max(h.inv, 1); break;
  }
  ev(s, 'cast', { name, x: ox, y: oy, form: st });
}
// erase boss projectiles inside a circle (orbit shards, domain, halo)
function blockShots(s, x, y, r, inner = 0) {
  for (let i = s.shots.length - 1; i >= 0; i--) { const p = s.shots[i], d = Math.hypot(p.x - x, p.y - y); if (p.age >= p.tele && d < r && d >= inner) { s.shots.splice(i, 1); ev(s, 'block', { x: p.x, y: p.y }); } }
}
function updateHeroPowers(s, dt) {
  const h = s.hero, b = s.boss;
  if (h.orbit) { const o = h.orbit; o.t -= dt; o.fire -= dt; blockShots(s, h.x, h.y - 50, 70);
    if (o.fire <= 0 && o.n > 0) { o.fire = .55; o.n--; const a = fxAngle(s, o.n), sx = h.x + Math.cos(a) * 48, sy = h.y - 50 + Math.sin(a) * 18, [ax, ay] = aimAt(s, sx, sy); s.heroShots.push({ kind: 'spin', x: sx, y: sy, vx: ax * 900, vy: ay * 900, r: 10, dmg: o.dmg, life: 1.5, age: 0 }); }
    if (o.t <= 0 || o.n <= 0 && o.fire <= -.3) h.orbit = null; }
  if (h.field) { h.field.t -= dt; blockShots(s, h.x, h.y - 40, h.field.r); if (h.field.t <= 0) h.field = null; }
  if (h.starfall) { const f = h.starfall; f.t -= dt; if (f.t <= 0 && f.n < f.total) { f.t = .11; f.n++; s.heroShots.push({ kind: 'fall', x: b.x + (s.R() - .5) * 200, y: -60, vx: (s.R() - .5) * 80, vy: 1100, r: 13, dmg: f.dmg, life: 2, age: 0 }); } if (f.n >= f.total) h.starfall = null; }
}
const fxAngle = (s, n) => s.t * 2.4 + n / 6 * Math.PI * 2;
function moveHero(s, dt, inp) {
  const h = s.hero;
  if (h.lance) { // LANCE: dash through the boss and back, invincible
    const L = h.lance; L.t += dt; const k = L.t / L.len, go = k < .45 ? easeOut(k / .45) : 1 - easeOut((k - .55) / .45);
    h.x = lerp(L.fx, L.tx, clamp(go, 0, 1)); h.y = lerp(L.fy, L.ty, clamp(go, 0, 1)); h.inv = Math.max(h.inv, .1);
    const lt = h.trail[h.trail.length - 1]; if (!lt || Math.hypot(lt.x - h.x, lt.y - h.y) > 30) h.trail.push({ x: h.x, y: h.y, life: .3, face: h.face });
    if (!L.hit && k >= .45) { L.hit = true; landHit(s, { kind: 'lance' }, L.dmg, s.boss.x, s.boss.y - 100); ev(s, 'lanceHit', { x: s.boss.x, y: s.boss.y - 100 }); s.hitstop = Math.max(s.hitstop, .07); }
    if (k >= 1) h.lance = null; return;
  }
  if (h.charge) { // SUPERNOVA: rooted while it charges
    h.charge.t += dt; h.vx = h.vy = 0;
    if (h.charge.t >= h.charge.len) { const ox = h.x + h.face * 30, oy = h.y - 55, [ax, ay] = aimAt(s, ox, oy); s.heroShots.push({ kind: 'nova', x: ox, y: oy, vx: ax * 560, vy: ay * 560, r: 74, dmg: h.charge.dmg, life: 3, age: 0, pierce: true, splash: 240, supernova: true }); ev(s, 'cast', { name: 'nova', x: ox, y: oy, big: true }); h.charge = null; }
    return;
  }
  let mx = inp.mx, my = inp.my; if (h.invert > 0) { mx = -mx; my = -my; }
  const len = Math.hypot(mx, my), speed = 360 + (s.stage - 1) * 20;
  if (h.dodgeT > 0) {
    h.dodgeT -= dt; h.x += h.dodgeDir[0] * 980 * dt; h.y += h.dodgeDir[1] * 600 * dt;
    const lt = h.trail[h.trail.length - 1]; if (!lt || Math.hypot(lt.x - h.x, lt.y - h.y) > 26) h.trail.push({ x: h.x, y: h.y, life: .32, face: h.face });
  } else {
    h.vx = lerp(h.vx, len ? mx / len * speed : 0, 1 - Math.exp(-dt * 18)); h.vy = lerp(h.vy, len ? my / len * speed * .75 : 0, 1 - Math.exp(-dt * 18));
    h.x += h.vx * dt; h.y += h.vy * dt;
  }
  if (Math.abs(mx) > .2 && h.dodgeT <= 0) h.face = mx > 0 ? 1 : -1;
  h.x = clamp(h.x, FLOOR.minX, FLOOR.maxX); h.y = clamp(h.y, FLOOR.minY, FLOOR.maxY);
  if (inp.dodge && h.dodgeCd <= 0 && h.dodgeT <= 0) {
    h.dodgeDir = len ? [mx / len, my / len] : [h.face, 0]; h.dodgeT = .24; h.dodgeCd = .55; ev(s, 'dodge', { x: h.x, y: h.y });
    if (dangerNear(s)) { s.slowmo = .45; h.inv = Math.max(h.inv, .5); s.stats.perfects++; h.hp = Math.min(HERO_MAX, h.hp + 2); ev(s, 'perfect', { x: h.x, y: h.y }); // from ChatGPT 14: a perfect dodge also mends 2 HP s.finisher.cd = Math.max(0, s.finisher.cd - 4);
      if (aligned(s) && s.finisher.prompt <= 0) { s.finisher.prompt = FIN.window; ev(s, 'finisherReady', { aligned: true }); } }
  }
}
function dangerNear(s) {
  const h = s.hero, hx = h.x, hy = h.y - 40;
  if (s.shots.some((p) => p.age >= p.tele && Math.hypot(p.x - hx, p.y - hy) < p.r + 26 + p.speed * .18)) return true;
  return s.hazards.some((z) => {
    if (z.kind === 'slam') return !z.hit && z.t > z.tele - .22 && Math.hypot(z.x - h.x, (z.y - h.y) * 1.6) < z.r + 20;
    if (z.kind === 'meteor') return !z.hit && z.t > z.tele - .22 && Math.hypot(z.x - h.x, (z.y - h.y) * 1.6) < z.r + 20;
    if (z.kind === 'laser' || z.kind === 'cross') return !z.hit && z.t > z.tele - .22 && z.t < z.tele + z.len;
    if (z.kind === 'catch') return !z.hit && z.t > z.tele + z.close - .25 && Math.abs(h.y - 20 - z.y) < z.band;
    if (z.kind === 'earth') return !z.hit && z.t > z.tele + z.fly - .22 && Math.hypot(z.tx - h.x, (z.ty - h.y) * 1.6) < z.r;
    if (z.kind === 'chain') return z.t >= z.tele && !z.done && z.cx != null && Math.hypot(z.cx - hx, z.cy - hy) < 130;
    return false;
  });
}
function heroActions(s, dt, inp) {
  const h = s.hero;
  for (const k of inp.keysPressed) { const n = ABIL_ORDER.find((a) => ABIL[a].key === k); if (n) { h.sel = n; ev(s, 'select', { name: n }); } }
  if (inp.next || inp.prev) { const i = ABIL_ORDER.indexOf(h.sel), d = inp.next ? 1 : -1; h.sel = ABIL_ORDER[(i + d + 6) % 6]; ev(s, 'select', { name: h.sel }); }
  if (inp.attack && h.slashCd <= 0 && h.dodgeT <= 0) {
    const ox = h.x + h.face * 30, oy = h.y - 50, [ax, ay] = aimAt(s, ox, oy);
    h.slashCd = SLASH.cd; h.squash = .1; h.face = ax >= 0 ? 1 : -1;
    s.heroShots.push({ kind: 'slash', x: ox, y: oy, vx: ax * SLASH.speed, vy: ay * SLASH.speed, r: SLASH.r, dmg: SLASH.dmg[s.stage], life: 1.3, age: 0 });
    ev(s, 'fire', { x: ox, y: oy });
  }
  if (inp.cast && (h.cds[h.sel] || 0) <= 0 && h.dodgeT <= 0 && !h.lance && !h.charge) castAbility(s, h.sel);
  if (inp.heal && h.heals > 0 && h.hp < HERO_MAX) { h.heals--; s.stats.heals++; h.hp = Math.min(HERO_MAX, h.hp + HEAL); ev(s, 'heal', { x: h.x, y: h.y }); }
  if (inp.finisher && s.finisher.prompt > 0) { // owner: the finisher takes 7 keys in order
    s.finisher.prompt = 0; const keys = [];
    while (keys.length < FIN.keys) { const k = FIN_KEYS[Math.floor(s.R() * FIN_KEYS.length)]; if (k !== keys[keys.length - 1]) keys.push(k); }
    s.fq = { keys, i: 0, t: 0, limit: FIN.qte[s.stage], wrong: -1, done: null, doneT: 0 }; setPhase(s, 'finisherQte'); ev(s, 'fqStart');
  }
}
// the secret: in phase 2, once a finisher would be the killing blow the eclipse ALIGNS (sky and name pulse white).
// A perfect dodge then calls the ECLIPSE BREAKER; landing it as the killing blow opens TOTALITY.
export function aligned(s) { const b = s.boss; return s.stage === 2 && b.gateIndex >= b.gates.length && b.hp > 0 && b.hp <= ABIL.nova.dmg[2] * FIN.mult * 0.95; }
function startFinisherCine(s) {
  s.finisher.cd = FIN.cooldown; s.stats.finishers++;
  s.finisher.cine = { t: 0, len: FIN.len, dmg: Math.round(ABIL.nova.dmg[s.stage] * FIN.mult * (1 + (s.R() - .5) * .1)) };
  s.shots = []; s.hazards = s.hazards.filter((z) => z.kind === 'hole'); setPhase(s, 'finisher'); ev(s, 'finisherStart');
}
function updateFinisherQte(s, dt, inp) {
  const q = s.fq; q.t += dt;
  if (q.done) { q.doneT += dt; if (q.doneT > .45) { s.fq = null; if (q.done === 'win') startFinisherCine(s); else { setPhase(s, 'fight'); s.finisher.cd = 8; banner(s, 'BREAKER FAILED', '', '#ff8a6b'); } } return; }
  if (q.t > .25) for (const k of inp.keysPressed) { // a short grace so a J held for slashing can't fail it instantly
    if (!FIN_KEYS.includes(k)) continue;
    if (k === q.keys[q.i]) { q.i++; ev(s, 'qteGood'); if (q.i >= q.keys.length) { q.done = 'win'; ev(s, 'fqWin'); break; } }
    else { q.wrong = q.i; q.done = 'fail'; ev(s, 'fqFail'); break; }
  }
  if (!q.done && q.t >= q.limit) { q.done = 'fail'; q.wrong = q.i; ev(s, 'fqFail'); }
}
function heroShotHits(s, p) { const b = s.boss; if (p.ground) return Math.abs(p.x - b.x) < 70 && Math.abs(p.y - b.y) < 150; return Math.hypot(p.x - b.x, (p.y - (b.y - 105)) * 1.1) < p.r + 95; }
function landHit(s, p, dmg, x, y) {
  const b = s.boss;
  if (b.dodgeT > 0) return;
  if (s.R() < (MISS[p.kind] || 0)) { ev(s, 'miss', { x, y }); return; }
  hurtBoss(s, Math.round(dmg * (.9 + s.R() * .2)), p.kind, x, y);
  // while the eclipse is aligned the random finisher is off: the secret needs a deliberate perfect dodge
  if (!aligned(s) && s.phase === 'fight' && s.finisher.cd <= 0 && s.finisher.prompt <= 0 && b.hp > 0 && s.R() < FIN.chance[s.stage]) { s.finisher.prompt = FIN.window; ev(s, 'finisherReady'); }
}
function updateHeroShots(s, dt) {
  const b = s.boss, h = s.hero;
  for (let i = s.heroShots.length - 1; i >= 0; i--) {
    const p = s.heroShots[i]; p.age += dt;
    if (p.homing && p.age > .12) { const dx = s.boss.x - p.x, dy = (s.boss.y - 105) - p.y, d = Math.hypot(dx, dy) || 1, sp = Math.hypot(p.vx, p.vy); p.vx = lerp(p.vx, dx / d * sp, .09); p.vy = lerp(p.vy, dy / d * sp, .09); }
    if (p.ret && p.age > .55 && !p.turned) { p.turned = true; p.hitBoss = false; } // the shield hits again on the way back
    if (p.ret && p.age > .55) { const dx = h.x - p.x, dy = (h.y - 50) - p.y, d = Math.hypot(dx, dy) || 1; p.vx = lerp(p.vx, dx / d * 900, .08); p.vy = lerp(p.vy, dy / d * 900, .08); if (d < 30 && p.age > .8) { s.heroShots.splice(i, 1); continue; } }
    p.x += p.vx * dt; p.y += p.vy * dt;
    // boss sidestep: the boss reads incoming shots (chance per stage)
    if (b.dodgeCd <= 0 && b.dodgeT <= 0 && s.phase === 'fight' && b.stagger <= 0 && Math.hypot(p.x - b.x, p.y - b.y) < 200 && !['fall', 'wave'].includes(p.kind)) {
      b.dodgeCd = 1.4; if (s.R() < cfg(s).dodge) { b.dodgeT = .28; b.dodgeDir = s.R() < .5 ? -1 : 1; ev(s, 'bossDodge', { x: b.x, y: b.y }); }
    }
    if (!p.hitBoss && heroShotHits(s, p)) {
      if (b.dodgeT > 0) { /* passes through the afterimage */ }
      else {
        if (p.splash) { landHit(s, p, p.dmg, p.x, p.y); ev(s, 'splash', { x: p.x, y: p.y, r: p.splash, kind: p.kind }); }
        else landHit(s, p, p.dmg, p.x, p.y);
        if (p.pierce || p.ret) p.hitBoss = true; else { s.heroShots.splice(i, 1); continue; }
      }
    }
    if (p.age > p.life || p.x < -150 || p.x > W + 150 || p.y < -400 || p.y > H + 150) s.heroShots.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------------------------- hazards
function segDist(px, py, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1, t = clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); }
function updateHazards(s, dt) {
  const h = s.hero, b = s.boss, hx = h.x, hy = h.y - 40;
  for (let i = s.hazards.length - 1; i >= 0; i--) {
    const z = s.hazards[i]; z.t += dt;
    const done = () => s.hazards.splice(i, 1);
    switch (z.kind) {
      case 'slam': {
        z.hand.x = lerp(z.hand.x, z.x, 1 - Math.exp(-dt * 6)); z.hand.y = lerp(z.hand.y, z.t < z.tele ? z.y - 170 : z.y - 40, 1 - Math.exp(-dt * (z.t < z.tele ? 6 : 30)));
        if (!z.hit && z.t >= z.tele) { z.hit = true; ev(s, 'slam', { x: z.x, y: z.y }); if (Math.hypot(z.x - h.x, (z.y - h.y) * 1.6) < z.r) hurtHero(s, z.quick ? 11 : 14, 'slam'); if (!z.quick) s.hazards.push({ kind: 'spin', x: z.x, y: z.y, t: 0, len: .75 }); }
        if (z.t > z.tele + (z.quick ? .14 : .35)) { if (!z.quick) z.hand.busy = false; done(); } break;
      }
      case 'barrage': {
        while (z.i < z.n && z.t >= z.i * z.gap) {
          const hand = b.hands[z.i % 2], j = z.i === 0 ? 0 : 1;
          s.hazards.push({ kind: 'slam', quick: true, x: clamp(h.x + h.vx * .35 + (s.R() - .5) * 160 * j, FLOOR.minX + 60, FLOOR.maxX - 60), y: clamp(h.y + h.vy * .35 + (s.R() - .5) * 90 * j, FLOOR.minY + 30, FLOOR.maxY - 20), hand, t: 0, tele: .55 / cfg(s).speed, r: 72, hit: false });
          z.i++;
        }
        if (z.i >= z.n && z.t > z.n * z.gap + .9) { b.hands.forEach((hd) => { hd.busy = false; }); done(); } break;
      }
      case 'spin': if (z.t >= z.len) { done(); s.hazards.push({ kind: 'hole', x: z.x, y: z.y, t: 0, len: s.stage >= 2 ? 3 : 2.5, tick: 0 }); ev(s, 'hole', { x: z.x, y: z.y }); } break;
      case 'hole': {
        const st = Math.sin(clamp(z.t / z.len, 0, 1) * Math.PI), dx = z.x - h.x, dy = z.y - h.y, d = Math.hypot(dx, dy) || 1;
        if (d < 520 && h.dodgeT <= 0 && s.phase === 'fight') { const pull = (110 + 160 * (1 - d / 520)) * st * (s.stage >= 2 ? 1.1 : 1); h.x = clamp(h.x + dx / d * pull * dt, FLOOR.minX, FLOOR.maxX); h.y = clamp(h.y + dy / d * pull * dt * .8, FLOOR.minY, FLOOR.maxY); }
        z.tick -= dt; if (d < 46 && z.tick <= 0 && hurtHero(s, 7, 'hole')) z.tick = .45;
        if (z.t >= z.len) { done(); ev(s, 'holeEnd', { x: z.x, y: z.y }); } break;
      }
      case 'chain': {
        if (z.t < z.tele) { z.tx = lerp(z.tx, hx, 1 - Math.exp(-dt * 2.2)); z.ty = lerp(z.ty, hy, 1 - Math.exp(-dt * 2.2)); break; }
        if (!z.thrown) { z.thrown = true; ev(s, 'chainThrow'); }
        z.head = Math.min(1, z.head + dt * 2.4); z.cx = lerp(z.hx, z.tx, easeOut(z.head)); z.cy = lerp(z.hy, z.ty, easeOut(z.head));
        if (!z.done && Math.hypot(z.cx - hx, z.cy - hy) < 34 && h.dodgeT <= 0 && h.inv <= 0) {
          done(); const n = s.stage === 3 ? 4 : 3, keys = []; while (keys.length < n) { const k = CHAIN_KEYS[Math.floor(s.R() * CHAIN_KEYS.length)]; if (!keys.includes(k)) keys.push(k); }
          s.chain = { keys, i: 0, t: 0, limit: [0, 2.9, 2.5, 2.3][s.stage], wrong: 0 }; setPhase(s, 'chained'); ev(s, 'chained'); break;
        }
        if (z.head >= 1) { z.t2 = (z.t2 || 0) + dt; if (z.t2 > .3) done(); } break;
      }
      case 'catch': {
        const [L, Rh] = b.hands, k = clamp((z.t - z.tele) / z.close, 0, 1);
        const lx = z.t < z.tele ? lerp(L.x, FLOOR.minX - 20, 1 - Math.exp(-dt * 5)) : lerp(FLOOR.minX - 20, 640 - 30, easeOut(k));
        const rx = z.t < z.tele ? lerp(Rh.x, FLOOR.maxX + 20, 1 - Math.exp(-dt * 5)) : lerp(FLOOR.maxX + 20, 640 + 30, easeOut(k));
        L.x = lx; Rh.x = rx; L.y = Rh.y = lerp(L.y, z.y, 1 - Math.exp(-dt * 8));
        if (!z.hit && k > 0 && Math.abs(h.y - 20 - z.y) < z.band && h.x > lx - 30 && h.x < rx + 30 && (Math.abs(h.x - lx) < 50 || Math.abs(h.x - rx) < 50 || k >= 1)) { z.hit = true; hurtHero(s, 16, 'catch'); }
        if (k >= 1 && !z.clapped) { z.clapped = true; ev(s, 'clap', { x: 640, y: z.y }); }
        if (z.t > z.tele + z.close + .35) { b.hands.forEach((hd) => { hd.busy = false; }); done(); } break;
      }
      case 'earth': {
        if (!z.hit && z.t >= z.tele + z.fly) { z.hit = true; ev(s, 'impact', { x: z.tx, y: z.ty, big: true }); if (Math.hypot(z.tx - h.x, (z.ty - h.y) * 1.6) < z.r) hurtHero(s, 15, 'earth'); }
        if (z.t > z.tele + z.fly + .3) done(); break;
      }
      case 'laser': {
        if (z.track && z.t < z.tele * .7) { const e = eye(s); z.x = e.x; z.y = e.y; z.a = lerp(z.a, Math.atan2(hy - z.y, hx - z.x), 1 - Math.exp(-dt * 3)); }
        if (z.t >= z.tele && !z.fired) { z.fired = true; ev(s, 'laser', { x: z.x, y: z.y }); }
        if (!z.hit && z.t >= z.tele && z.t < z.tele + z.len && segDist(hx, hy, z.x, z.y, z.x + Math.cos(z.a) * 1600, z.y + Math.sin(z.a) * 1600) < z.w) { z.hit = true; hurtHero(s, 15, 'laser'); }
        if (z.t > z.tele + z.len + .2) done(); break;
      }
      case 'cross': {
        if (z.t >= z.tele && !z.fired) { z.fired = true; ev(s, 'laser', { x: z.x, y: z.y }); }
        if (!z.hit && z.t >= z.tele && z.t < z.tele + z.len) for (const a of [z.a, z.a + Math.PI / 2]) if (segDist(hx, hy, z.x - Math.cos(a) * 1500, z.y - Math.sin(a) * 1500, z.x + Math.cos(a) * 1500, z.y + Math.sin(a) * 1500) < z.w) { z.hit = true; hurtHero(s, 14, 'cross'); break; }
        if (z.t > z.tele + z.len + .2) done(); break;
      }
      case 'meteor': {
        if (!z.hit && z.t >= z.tele) { z.hit = true; ev(s, 'impact', { x: z.x, y: z.y }); if (Math.hypot(z.x - h.x, (z.y - h.y) * 1.6) < z.r) hurtHero(s, 12, 'meteor'); }
        if (z.t > z.tele + .3) done(); break;
      }
      case 'well': {
        const k = clamp(z.t / z.len, 0, 1), r = lerp(z.r0, 36, easeOut(k)), d = Math.hypot(h.x - z.x, (h.y - z.y) * 1.6);
        if (d < z.r0 && h.dodgeT <= 0) { const dx = z.x - h.x, dy = z.y - h.y, l = Math.hypot(dx, dy) || 1; h.x += dx / l * 70 * dt; h.y += dy / l * 50 * dt; }
        z.r = r;
        if (!z.hit && k >= 1) { z.hit = true; ev(s, 'impact', { x: z.x, y: z.y, big: true }); if (d < 60) hurtHero(s, 18, 'well'); }
        if (k >= 1 && z.t > z.len + .25) done(); break;
      }
      case 'corona': {
        const k = clamp((z.t - z.tele) / z.len, 0, 1);
        z.y = lerp(FLOOR.minY - 40, FLOOR.maxY + 40, k);
        if (!z.hit && z.t >= z.tele && Math.abs(h.y - 30 - z.y) < 26 && Math.abs(h.y - 30 - z.gap) > 70 && h.dodgeT <= 0) { z.hit = true; hurtHero(s, 16, 'corona'); }
        if (z.t > z.tele + z.len) done(); break;
      }
      case 'seal': { // six-point seal on the boss, then a big blast
        z.x = b.x; z.y = b.y - 105;
        if (!z.hit && z.t >= z.tele) { z.hit = true; landHit(s, { kind: 'seal' }, z.dmg, z.x, z.y); ev(s, 'sealBoom', { x: z.x, y: z.y }); }
        if (z.t > z.tele + .35) done(); break;
      }
      case 'halo': {
        const k = clamp(z.t / z.len, 0, 1); z.r = easeOut(k) * 360; blockShots(s, z.x, z.y, z.r + 10, Math.max(0, z.r - 50));
        if (!z.hit && Math.hypot(b.x - z.x, (b.y - 105) - z.y) < z.r) { z.hit = true; landHit(s, { kind: 'halo' }, z.dmg, b.x, b.y - 105); }
        if (z.t > z.len + .1) done(); break;
      }
      case 'judgement': { // pillar from the sky: cannot be dodged or missed
        z.x = lerp(z.x ?? b.x, b.x, .2);
        if (!z.hit && z.t >= z.tele) { z.hit = true; hurtBoss(s, Math.round(z.dmg * (.9 + s.R() * .2)), 'judgement', b.x, b.y - 120); ev(s, 'judgement', { x: b.x, y: b.y }); }
        if (z.t > z.tele + z.len) done(); break;
      }
      case 'totalitySigil': {
        blockShots(s, 640, 400, 2000);
        if (!z.hit && z.t >= z.tele) { z.hit = true; hurtBoss(s, Math.round(z.dmg * (.95 + s.R() * .1)), 'totality', b.x, b.y - 120); ev(s, 'totalityHit', { x: b.x, y: b.y }); s.hitstop = Math.max(s.hitstop, .12); }
        if (z.t > z.tele + .5) done(); break;
      }
      case 'heroBeam': {
        if (!z.hit) { z.x = h.x + h.face * 30; z.y = h.y - 80; z.a = Math.atan2((b.y - 105) - z.y, b.x - z.x); } // always aimed where the boss is now
        if (!z.hit && z.t >= z.tele) { z.hit = true; const b2 = s.boss; if (segDist(b2.x, b2.y - 105, z.x, z.y, z.x + Math.cos(z.a) * 1600, z.y + Math.sin(z.a) * 1600) < 100) landHit(s, { kind: 'eyes' }, z.dmg, b2.x - 40, b2.y - 105); ev(s, 'heroBeam', { x: z.x, y: z.y, a: z.a }); }
        if (z.t > z.tele + z.len) done(); break;
      }
    }
  }
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const p = s.shots[i]; p.age += dt;
    if (p.age < p.tele) continue;
    if (p.spin) p.a += p.spin * dt;
    p.x += Math.cos(p.a) * p.speed * dt; p.y += Math.sin(p.a) * p.speed * dt;
    if (Math.hypot(p.x - hx, p.y - hy) < p.r + 24 && hurtHero(s, p.dmg, 'orb', p.x, p.y)) { s.shots.splice(i, 1); continue; }
    if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) s.shots.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------------------------- SURVIVE box + timing counter
// owner: "the dodging inside the box isn't hard enough ... multiple things". Each gate mixes patterns, and from
// gate 2 a bouncer or two stays in the box the whole time. Every wave is previewed exactly where it will be safe.
const BOX_MIX = {
  1: [['lanes', 'radial'], ['radial', 'rain', 'lanes'], ['sweep', 'lanes', 'rain'], ['crush', 'radial', 'sweep', 'rain']],
  2: [['lanes', 'rain', 'radial'], ['sweep', 'radial', 'crush'], ['crush', 'sweep', 'rain', 'radial'], ['sweep', 'crush', 'radial', 'lanes']],
  3: [['sweep', 'crush', 'radial', 'rain'], ['crush', 'sweep', 'radial', 'lanes'], ['sweep', 'crush', 'rain', 'radial']],
};
const BOUNCERS = { 1: [1, 1, 2, 2], 2: [1, 2, 2, 3], 3: [2, 3, 3] }; // owner: the box was far too easy
function beginBox(s) {
  const g = s.boss.gateIndex, st = s.stage, sp = cfg(s).speed;
  s.box = { t: 0, len: [0, 9.5, 10, 10.5][st], gate: g, mix: BOX_MIX[st][g] || BOX_MIX[st][BOX_MIX[st].length - 1], soul: { x: 640, y: 470 }, bullets: [], beams: [], wave: 0, next: .9, preview: null, aimT: 1.2, shake: 0 };
  for (let i = 0; i < (BOUNCERS[st][g] || 0); i++) { const a = s.R() * TAU; s.box.bullets.push({ x: BOX.minX + 40 + i * 120, y: BOX.minY + 30, vx: Math.cos(a) * 170 * sp, vy: Math.abs(Math.sin(a)) * 170 * sp + 60, r: 11, age: 0, tele: .9, bounce: true }); }
  s.shots = []; s.hazards = []; s.heroShots = []; s.boss.hands.forEach((hd) => { hd.busy = false; });
  setPhase(s, 'box'); banner(s, 'SURVIVE', 'DODGE · NO ATTACKS', '#e8f1ff'); ev(s, 'boxStart');
}
function previewFor(s) {
  const b = s.box, p = b.mix[b.wave % b.mix.length], R = s.R;
  if (p === 'lanes') return { pattern: p, safe: Math.floor(R() * 5), vertical: b.wave % 2 === 1 };
  if (p === 'radial') return { pattern: p, safe: Math.floor(R() * 20), off: b.wave * .23 };
  if (p === 'sweep') return { pattern: p, gapY: BOX.minY + 50 + R() * (BOX.maxY - BOX.minY - 100), fromLeft: R() < .5, half: s.stage === 3 ? 34 : 40 };
  if (p === 'crush') return { pattern: p, cy: BOX.minY + 50 + R() * (BOX.maxY - BOX.minY - 100), half: s.stage === 3 ? 30 : 36 };
  return { pattern: 'rain', xs: Array.from({ length: 12 + s.stage * 2 }, () => BOX.minX + 12 + R() * (BOX.maxX - BOX.minX - 24)) };
}
function spawnBoxWave(s, pv) {
  const b = s.box, lanes = 5, lh = (BOX.maxY - BOX.minY) / lanes, lw = (BOX.maxX - BOX.minX) / lanes, sp = cfg(s).speed;
  if (pv.pattern === 'lanes') {
    const vertical = pv.vertical, fromStart = b.wave % 4 < 2;
    for (let i = 0; i < lanes; i++) {
      if (i === pv.safe) continue;
      const v = (370 + b.gate * 40) * sp;
      b.bullets.push({ x: vertical ? BOX.minX + lw * (i + .5) : fromStart ? BOX.minX - 14 : BOX.maxX + 14, y: vertical ? (fromStart ? BOX.minY - 14 : BOX.maxY + 14) : BOX.minY + lh * (i + .5),
        vx: vertical ? 0 : fromStart ? v : -v, vy: vertical ? (fromStart ? v : -v) : 0, r: vertical ? lw * .42 : lh * .42, wall: true, vertical, age: 0, tele: .45 });
    }
  } else if (pv.pattern === 'radial') {
    const cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, spokes = 20;
    for (let i = 0; i < spokes; i++) { if (((i - pv.safe + spokes) % spokes) <= 2) continue; const a = i / spokes * TAU + pv.off; b.bullets.push({ x: cx, y: cy, vx: Math.cos(a) * (215 + b.gate * 18) * sp, vy: Math.sin(a) * (215 + b.gate * 18) * sp, r: 9, age: 0, tele: .5 }); }
  } else if (pv.pattern === 'sweep') b.beams.push({ kind: 'sweep', t: 0, len: 1.5 / sp, gapY: pv.gapY, half: pv.half, fromLeft: pv.fromLeft, x: pv.fromLeft ? BOX.minX : BOX.maxX });
  else if (pv.pattern === 'crush') b.beams.push({ kind: 'crush', t: 0, cy: pv.cy, half: pv.half, close: .45 / sp, hold: .75, open: .35, k: 0 });
  else pv.xs.forEach((x, i) => b.bullets.push({ x, y: BOX.minY + 4, vx: (s.R() - .5) * 50, vy: 320 * sp, r: 7, age: 0, tele: .3 + i * .05, rain: true }));
  b.wave++;
}
function updateBox(s, dt, inp) {
  const b = s.box, so = b.soul, h = s.hero, st = s.stage;
  b.t += dt; b.next -= dt; b.aimT -= dt;
  let mx = inp.mx, my = inp.my; if (h.invert > 0) { mx = -mx; my = -my; }
  const len = Math.max(1, Math.hypot(mx, my));
  so.x = clamp(so.x + mx / len * 255 * dt, BOX.minX + 9, BOX.maxX - 9); so.y = clamp(so.y + my / len * 255 * dt, BOX.minY + 9, BOX.maxY - 9);
  if (!b.preview && b.next < .38 && b.t < b.len - 1) b.preview = previewFor(s); // shorter warning, like ChatGPT's box
  if (b.next <= 0 && b.t < b.len - 1) {
    const pv = b.preview || previewFor(s); spawnBoxWave(s, pv); b.preview = null;
    b.next = ({ sweep: 1.2, crush: 1.3 }[pv.pattern] || 1) * [0, .86, .82, .84][st];
  }
  if (b.aimT <= 0 && b.t < b.len - 1.2) { // aimed fans from the very first box
    const side = Math.floor(s.R() * 4), ex = [BOX.minX + 10, BOX.maxX - 10][side % 2], ey = side < 2 ? BOX.minY + 10 : BOX.maxY - 10, a = Math.atan2(so.y - ey, so.x - ex), n = b.gate >= 2 || st === 3 ? 2 : 1;
    for (let i = -n; i <= n; i++) b.bullets.push({ x: ex, y: ey, vx: Math.cos(a + i * .22) * (230 + b.gate * 25), vy: Math.sin(a + i * .22) * (230 + b.gate * 25), r: 7, age: 0, tele: .6, aimed: true });
    b.aimT = Math.max(.7, 1.15 - b.gate * .09) / cfg(s).speed;
  }
  const hit = () => { if (h.inv <= 0 && hurtHero(s, st === 3 ? 8 : 10, 'box', so.x, so.y)) { b.shake = .25; h.inv = .45; } }; // shorter grace after a box hit
  for (let i = b.beams.length - 1; i >= 0; i--) {
    const z = b.beams[i]; z.t += dt;
    if (z.kind === 'sweep') { // a wall of light crosses the box; only its gap is safe
      const k = z.t / z.len; z.x = z.fromLeft ? lerp(BOX.minX, BOX.maxX, k) : lerp(BOX.maxX, BOX.minX, k);
      if (Math.abs(so.x - z.x) < 9 && Math.abs(so.y - z.gapY) > z.half - 4) hit();
      if (k >= 1) b.beams.splice(i, 1);
    } else { // crusher: top and bottom close to a corridor, hold, open
      const tt = z.t; z.k = tt < z.close ? easeOut(tt / z.close) : tt < z.close + z.hold ? 1 : 1 - (tt - z.close - z.hold) / z.open;
      const top = lerp(BOX.minY, z.cy - z.half, z.k), bot = lerp(BOX.maxY, z.cy + z.half, z.k);
      if (z.k > .3 && (so.y - 5 < top || so.y + 5 > bot)) hit();
      if (tt > z.close + z.hold + z.open) b.beams.splice(i, 1);
    }
  }
  for (let i = b.bullets.length - 1; i >= 0; i--) {
    const p = b.bullets[i]; p.age += dt;
    if (p.age < p.tele) continue;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.bounce) { if (p.x < BOX.minX + p.r || p.x > BOX.maxX - p.r) { p.vx *= -1; p.x = clamp(p.x, BOX.minX + p.r, BOX.maxX - p.r); } if (p.y < BOX.minY + p.r || p.y > BOX.maxY - p.r) { p.vy *= -1; p.y = clamp(p.y, BOX.minY + p.r, BOX.maxY - p.r); } }
    const touch = p.wall ? (p.vertical ? Math.abs(so.x - p.x) < p.r && Math.abs(so.y - p.y) < 16 : Math.abs(so.y - p.y) < p.r && Math.abs(so.x - p.x) < 16) : Math.hypot(so.x - p.x, so.y - p.y) < p.r + 5;
    if (touch && h.inv <= 0) { hit(); if (!p.bounce) { b.bullets.splice(i, 1); continue; } }
    if (!p.bounce && (p.x < BOX.minX - 60 || p.x > BOX.maxX + 60 || p.y < BOX.minY - 60 || p.y > BOX.maxY + 60)) b.bullets.splice(i, 1);
  }
  if (s.phase !== 'box') return;
  if (b.t >= b.len) {
    s.box = null; h.heals++; ev(s, 'healGain', { heals: h.heals });
    s.boss.gateIndex++; // floor moves to the next gate before the counter lands
    s.timing = { t: 0, len: 1.7 / cfg(s).speed, marker: 0, result: null, resT: 0 };
    setPhase(s, 'timing'); ev(s, 'timingStart');
  }
}
function updateTiming(s, dt, inp) {
  const tm = s.timing;
  if (tm.result) { tm.resT += dt; if (tm.resT > .9) { s.timing = null; setPhase(s, 'fight'); s.boss.attackCd = 1.4; } return; }
  tm.t += dt; tm.marker = clamp(tm.t / tm.len, 0, 1);
  const press = inp.attack0 || inp.finisher || inp.confirm;
  if (press || tm.t >= tm.len) {
    const off = Math.abs(tm.marker - .5), res = !press ? 'miss' : off < .05 ? 'perfect' : off < .13 ? 'good' : 'miss';
    tm.result = res; const pct = { perfect: .06, good: .03, miss: 0 }[res];
    if (pct) { s.slowmo = res === 'perfect' ? .35 : 0; hurtBoss(s, Math.round(s.boss.max * pct), 'counter', s.boss.x, s.boss.y - 90); }
    ev(s, 'timingResult', { result: res }); banner(s, res === 'perfect' ? 'PERFECT COUNTER' : res === 'good' ? 'COUNTER' : 'MISSED', '', res === 'miss' ? '#ff8a6b' : '#c5e9ff');
  }
}

// ---------------------------------------------------------------------------------------------- QTEs
function updateChained(s, dt, inp) {
  const c = s.chain, h = s.hero, b = s.boss;
  c.t += dt;
  const dx = (b.x - 110) - h.x, dy = (b.y - 10) - h.y, d = Math.hypot(dx, dy) || 1;
  h.x += dx / d * 120 * dt; h.y += dy / d * 84 * dt;
  for (const k of inp.keysPressed) { if (k === c.keys[c.i]) { c.i++; ev(s, 'qteGood'); if (c.i >= c.keys.length) break; } else if (CHAIN_KEYS.includes(k)) { c.wrong = .3; c.t += .35; ev(s, 'qteBad'); } }
  c.wrong = Math.max(0, c.wrong - dt);
  if (c.i >= c.keys.length) { s.chain = null; setPhase(s, 'fight'); h.inv = .8; h.dodgeT = .2; h.dodgeDir = [-1, .3]; b.stagger = 1.1; hurtBoss(s, 10 + s.stage * 4, 'break'); banner(s, 'BROKE FREE', '', '#bfe8ff'); ev(s, 'chainBreak', { x: h.x, y: h.y }); b.attackCd = Math.max(b.attackCd, 1.4); }
  else if (c.t >= c.limit || d < 40) { s.chain = null; setPhase(s, 'fight'); hurtHero(s, 15, 'chain'); ev(s, 'chainSlam', { x: h.x, y: h.y }); }
}
function updateRune(s, dt, inp) {
  const r = s.rune, h = s.hero, b = s.boss;
  r.t += dt; r.rise = Math.min(1, r.rise + dt * 2);
  if (r.done) { r.doneT = (r.doneT || 0) + dt; if (r.doneT > .9) { s.rune = null; setPhase(s, 'fight'); if (r.failed) banner(s, 'CONTROLS INVERTED', `${Math.ceil(h.invert)} SECONDS`, '#ff8a6b'); } return; }
  for (const k of inp.keysPressed) {
    if (!RUNE_KEYS.includes(k)) continue;
    if (k === r.keys[r.i]) { r.i++; ev(s, 'qteGood'); if (r.i >= r.keys.length) break; } else { r.wrong = r.i; r.done = 'fail'; break; }
  }
  if (!r.done && r.i >= r.keys.length) { r.done = 'win'; b.stagger = 1.2; hurtBoss(s, 14 + s.stage * 6, 'reflect'); ev(s, 'runeWin'); }
  else if (!r.done && r.t >= r.limit) r.done = 'fail';
  if (r.done === 'fail' && !r.failed) { r.failed = true; h.invert = 5 + s.stage; h.inv = 0; hurtHero(s, 10, 'rune'); ev(s, 'runeFail'); }
}
function updateFinisher(s, dt) {
  const c = s.finisher.cine, h = s.hero, b = s.boss; c.t += dt;
  const k = c.t / c.len;
  if (k < .75) { const a = k * 11; h.x = b.x + Math.cos(a) * 175; h.y = b.y - 10 + Math.sin(a) * 60; const lt = h.trail[h.trail.length - 1]; if (!lt || Math.hypot(lt.x - h.x, lt.y - h.y) > 60) h.trail.push({ x: h.x, y: h.y, life: .3, face: Math.cos(a) > 0 ? -1 : 1 }); }
  else { h.x = lerp(h.x, b.x - 230, .2); h.y = lerp(h.y, b.y + 20, .2); }
  for (const at of [.26, .42, .58]) if (c.t - dt < at * c.len && c.t >= at * c.len) ev(s, 'finisherSlash', { n: at });
  if (c.t >= c.len) { s.finisher.cine = null; setPhase(s, 'fight'); h.inv = .6; hurtBoss(s, c.dmg, 'finisher', b.x, b.y - 90); ev(s, 'finisherHit', { dmg: c.dmg }); s.hitstop = .16; b.stagger = 1.4; }
}

// ---------------------------------------------------------------------------------------------- laser clashes (mash to win)
// kind 1: between phases (both transform after it); 2: final domain clash; 3: TOTALITY clash (hardest).
export const CLASH_KEYS = ['Q', 'E', 'R', 'F'];
export const CLASH = { 1: { step: .036, push: .1, ramp: .03, floor: .15 }, 2: { step: .03, push: .12, ramp: .04, floor: .15 }, 3: { step: .024, push: .15, ramp: .05, floor: .1 } };
function beginClash(s, kind) {
  s.shots = []; s.hazards = []; s.heroShots = []; s.finisher.prompt = 0;
  s.clash = { kind, t: 0, p: .5, pressT: [], heldPush: 0, won: false, wonT: 0, seam: 0, power: 0, pl: 0, line: null, struggle: null, km: 0, seq: null, rampT: 0 };
  s.hero.x = 330; s.hero.y = 560; s.boss.x = 960; s.boss.y = 455;
  setPhase(s, 'clash'); ev(s, 'clashStart', { kind });
}
function say(s, l) { s.clash.line = { ...l, at: s.clash.t }; ev(s, 'talkLine', { who: l.who }); }
function updateClash(s, dt, inp) {
  const c = s.clash, k = CLASH[c.kind];
  c.t += dt;
  if (c.struggle) { // owner (13): after the push they struggle, the beams swing toward each of them, lines shouted
    const g = c.struggle; g.t += dt;
    (SCRIPT.struggle?.[c.kind] || []).forEach((l, i) => { const at = i ? 2.5 : .2; if (g.t - dt < at && g.t >= at) say(s, l); });
    // two stop-and-read story beats in the middle of the struggle (click to continue), like ChatGPT's 13/14
    const beats = SCRIPT.clashBeats?.[c.kind] || [];
    for (const [i, at] of [[0, 1], [1, 1.8]]) if (beats[i] && !g['b' + i] && g.t >= at) { g['b' + i] = true; startTalkLines(s, [beats[i]], (s2) => setPhase(s2, 'clash')); return; }
    if (g.t >= g.len) { c.struggle = null; c.won = true; c.sword = c.kind >= 2; s.hitstop = c.sword ? 0 : .2; ev(s, c.sword ? 'swordThrow' : 'clashWin', { kind: c.kind }); }
    return;
  }
  if (c.won) { c.wonT += dt; if (c.sword && !c.swordHit && c.wonT >= .55) { c.swordHit = true; ev(s, 'swordHit', { x: s.boss.x, y: s.boss.y - 120 }); s.hitstop = .18; } if (c.wonT > (c.sword ? 2 : 1.2)) afterClash(s); return; }
  if (c.t < 1.3) { c.power = c.t / 1.3; return; } // beams build up first
  // pushing dialogue: one line at the start, then one at each escalation mark
  const PL = SCRIPT.push?.[c.kind] || [], TH = [0, .62, .76, .9];
  while (c.pl < PL.length && c.pl < TH.length && (c.pl === 0 || c.p >= TH[c.pl])) say(s, PL[c.pl++]);
  // two announced key moments (like ChatGPT's approved clash): GET READY, then 4 keys in order; a wrong key stuns
  if (!c.seq && c.km < 2 && c.p >= [.58, .82][c.km]) {
    c.km++; const keys = []; while (keys.length < 4) { const kk = CLASH_KEYS[Math.floor(s.R() * 4)]; if (kk !== keys[keys.length - 1]) keys.push(kk); }
    c.seq = { warn: 1.4, keys, i: 0, t: 0, limit: [0, 3.2, 2.9, 2.6][c.kind], stun: 0 }; ev(s, 'clashSeq');
  }
  if (c.seq) {
    const q = c.seq; c.p = Math.max(k.floor, c.p - k.push * .5 * dt); // she keeps pushing, a little slower
    if (q.warn > 0) { q.warn -= dt; return; } // presses during the warning are simply ignored
    q.t += dt;
    if (q.stun > 0) q.stun -= dt;
    else for (const key of inp.keysPressed) {
      if (!CLASH_KEYS.includes(key)) continue;
      if (key === q.keys[q.i]) { q.i++; ev(s, 'qteGood'); if (q.i >= q.keys.length) { c.p += .12; c.seq = null; s.hitstop = .08; ev(s, 'clashSeqWin'); break; } }
      else { q.stun = 1.1; c.p = Math.max(k.floor, c.p - .08); ev(s, 'clashSeqFail'); break; }
    }
    if (c.seq && q.t >= q.limit) { c.p = Math.max(k.floor, c.p - .08); c.seq = null; ev(s, 'clashSeqFail', { timeout: true }); }
    return;
  }
  const now = c.t;
  let presses = (inp.attack0 ? 1 : 0) + (inp.confirm ? 1 : 0) + inp.taps;
  c.pressT = c.pressT.filter((t) => now - t < 1);
  for (let i = 0; i < presses; i++) if (c.pressT.length < 15) { c.pressT.push(now); c.p += k.step; ev(s, 'clashPress', { p: c.p }); } // capped 15/s
  if (inp.attack && presses === 0) { c.heldPush += dt; if (c.heldPush >= .2) { c.heldPush = 0; c.p += k.step; ev(s, 'clashPress', { p: c.p, held: true }); } } // hold-to-push ~5/s
  c.rampT += dt; c.p -= (k.push + k.ramp * c.rampT) * dt; // her push ramps only while you are mashing, not during key moments
  c.p = Math.max(k.floor, c.p);
  for (const mark of [.65, .8, .9]) if (c.p >= mark && !(c['m' + mark])) { c['m' + mark] = true; ev(s, 'clashEscalate', { mark }); }
  if (c.p >= 1) { c.p = 1; c.struggle = { t: 0, len: 3.1 }; ev(s, 'clashStruggle', { kind: c.kind }); } // then the struggle; the end clashes finish with the sword throw
}
function afterClash(s) {
  const kind = s.clash.kind; s.clash = null;
  if (kind === 1) { s.cine = { kind: 'reborn', t: 0, len: 6.5 }; setPhase(s, 'cine'); ev(s, 'cineStart', { kind: 'reborn' }); }
  else if (kind === 2 && s.secret) { s.cine = { kind: 'totality', t: 0, len: 5.5 }; setPhase(s, 'cine'); ev(s, 'cineStart', { kind: 'totality' }); }
  else if (kind === 2) { s.cine = { kind: 'ending', t: 0, len: 9 }; setPhase(s, 'cine'); ev(s, 'cineStart', { kind: 'ending' }); }
  else { s.cine = { kind: 'trueEnding', t: 0, len: 9.5 }; setPhase(s, 'cine'); ev(s, 'cineStart', { kind: 'trueEnding' }); }
}
function updateCine(s, dt, inp) {
  const c = s.cine; c.t += dt;
  for (const at of [.15, .3, .4, .5, .6, .7, .85]) if (c.t - dt < c.len * at && c.t >= c.len * at) ev(s, 'cineBeat', { kind: c.kind, at });
  const skip = c.t > 2.5 && inp.confirm && (c.kind === 'ending' || c.kind === 'trueEnding');
  if (c.t < c.len && !skip) return;
  s.cine = null;
  if (c.kind === 'reborn') { setupStage(s, 2); s.hero.x = 300; s.hero.y = 560; s.hero.heals = 2; /* clash bonus: +1 heal */ startTalk(s, 'reborn', (s2) => { banner(s2, 'PHASE 2', 'BOTH FIGHTERS TRANSFORMED', '#ff8a6b'); toFight(s2); }); }
  else if (c.kind === 'totality') { setupStage(s, 3); s.hero.x = 300; s.hero.y = 560; s.hero.hp = HERO_MAX; startTalk(s, 'totality', (s2) => { banner(s2, 'TOTALITY', 'SECRET PHASE', '#ffffff'); toFight(s2); }); }
  else { setPhase(s, 'victory'); s.result = { tier: c.kind === 'trueEnding' ? 'secret' : 'normal', rewards: REWARDS[c.kind === 'trueEnding' ? 'secret' : 'normal'] }; ev(s, 'victory', { tier: s.result.tier }); }
}

// ---------------------------------------------------------------------------------------------- dialogue
// First press finishes the line, the next press advances. SKIP (or X) ends the scene. Forced test runs skip talk.
function startTalk(s, key, after) { startTalkLines(s, SCRIPT[key], after, key); }
function startTalkLines(s, lines, after, key = 'beat') {
  if (!lines || !lines.length || s.noTalk) { after(s); return; }
  s.talk = { key, lines, i: 0, t: 0, after }; setPhase(s, 'talk'); ev(s, 'talkLine', { who: lines[0].who });
}
function updateTalk(s, dt, inp) {
  const k = s.talk; k.t += dt;
  const end = () => { const after = k.after; s.talk = null; after(s); };
  if (inp.skip) return end();
  if ((inp.confirm || inp.attack0 || inp.taps > 0) && k.t > .2) {
    const full = k.lines[k.i].text.length / TALK_CPS;
    if (k.t < full) k.t = full;
    else { k.i++; k.t = 0; if (k.i >= k.lines.length) return end(); ev(s, 'talkLine', { who: k.lines[k.i].who }); }
  }
}
const toFight = (s) => setPhase(s, 'fight');

// ---------------------------------------------------------------------------------------------- main step
export function step(s, dt, inp) {
  let scale = 1;
  if (s.hitstop > 0) { s.hitstop -= dt; scale = .04; } else if (s.slowmo > 0) { s.slowmo -= dt; scale = .35; }
  const sdt = dt * scale, h = s.hero, b = s.boss;
  s.t += sdt; s.phaseT += sdt;
  if (s.banner) s.banner.t += dt;
  h.chip = h.chip > h.hp ? Math.max(h.hp, h.chip - dt * 40) : h.hp; b.chip = b.chip > b.hp ? Math.max(b.hp, b.chip - dt * 80) : b.hp;
  for (const tr of h.trail) tr.life -= dt; h.trail = h.trail.filter((tr) => tr.life > 0).slice(-7);
  h.inv = Math.max(0, h.inv - sdt); h.hurt = Math.max(0, h.hurt - dt); h.squash = Math.max(0, h.squash - dt);
  b.flash = Math.max(0, b.flash - dt); b.tell = Math.max(0, b.tell - sdt);
  if (s.phase === 'intro') { if (s.phaseT > 1.8) startTalk(s, 'intro', toFight); return s; }
  if (s.phase === 'talk') { updateTalk(s, dt, inp); return s; }
  if (s.phase === 'victory' || s.phase === 'defeat') return s;
  if (s.phase === 'clash') { updateClash(s, sdt, inp); return s; }
  if (s.phase === 'cine') { updateCine(s, sdt, inp); return s; }
  h.invert = Math.max(0, h.invert - sdt);
  h.dodgeCd = Math.max(0, h.dodgeCd - sdt); h.slashCd = Math.max(0, h.slashCd - sdt);
  for (const k in h.cds) h.cds[k] = Math.max(0, h.cds[k] - sdt);
  if (s.phase === 'box') { updateBox(s, sdt, inp); return s; }
  if (s.phase === 'timing') { updateTiming(s, sdt, inp); return s; }
  if (s.phase === 'chained') { updateChained(s, sdt, inp); return s; }
  if (s.phase === 'rune') { updateRune(s, sdt, inp); return s; }
  if (s.phase === 'finisher') { updateFinisher(s, sdt); return s; }
  if (s.phase === 'finisherQte') { updateFinisherQte(s, sdt, inp); return s; }
  // fight
  if (s.forceFinisherPrompt) { s.forceFinisherPrompt = false; s.finisher.prompt = FIN.window; ev(s, 'finisherReady'); }
  s.finisher.cd = Math.max(0, s.finisher.cd - sdt); s.finisher.prompt = Math.max(0, s.finisher.prompt - dt);
  moveHero(s, sdt, inp); heroActions(s, sdt, inp); updateHeroPowers(s, sdt);
  if (s.phase !== 'fight') return s;
  b.sway += sdt; b.stagger = Math.max(0, b.stagger - sdt); b.dodgeCd = Math.max(0, b.dodgeCd - sdt);
  if (b.dodgeT > 0) { b.dodgeT -= sdt; b.y += b.dodgeDir * 330 * sdt; b.y = clamp(b.y, 400, 560); }
  const homeX = 970 + Math.sin(b.sway * .6) * 110, homeY = 455 + Math.sin(b.sway * 1.1) * 18;
  b.x = lerp(b.x, homeX, 1 - Math.exp(-sdt * 2)); if (b.dodgeT <= 0) b.y = lerp(b.y, homeY, 1 - Math.exp(-sdt * 2));
  b.hands.forEach((hand, i) => { if (hand.busy) return; hand.x = lerp(hand.x, b.x + (i ? 160 : -160), 1 - Math.exp(-sdt * 5)); hand.y = lerp(hand.y, b.y - 30 + Math.sin(b.sway * 2 + i * 2) * 14, 1 - Math.exp(-sdt * 5)); });
  for (const k in b.cds) b.cds[k] -= sdt;
  if (b.stagger <= 0) { b.attackCd -= sdt; if (b.attackCd <= 0) startAttacks(s, chooseAttack(s)); }
  updateHeroShots(s, sdt); updateHazards(s, sdt);
  if (s.phase !== 'fight') return s;
  if (s.pendingClash) { const k = s.pendingClash; s.pendingClash = 0; s.pendingGate = false; s.shots = []; s.hazards = []; if (k === 2) startTalk(s, 'domain', (s2) => beginClash(s2, 2)); else beginClash(s, k); } // owner: he DOES want the stop-and-read dialogue
  else if (s.pendingGate) { s.pendingGate = false; beginBox(s); }
  return s;
}
