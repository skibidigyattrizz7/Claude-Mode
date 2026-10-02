import { SCRIPT } from './script.js?v=13e';
// Prototype 7-Claude: simulation (no DOM). Fixed 1/120 s steps; hit-stop/slow-mo scale only this clock.
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
export const FLOOR = { minX: 46, maxX: 1234, minY: 228, maxY: 700 }; // P10 owner: "the playing field is still small, I can't go to the top" (the horizon dropped from 330 to 212)
export const HZ = 212;
export const BOX = { minX: 290, maxX: 990, minY: 236, maxY: 586 }; // the LIVE box rect (P9: it changes shape per act)
// P9 (owner's Undertale references: Toriel, Napstablook, Papyrus, Mad Dummy, Muffet): a box is a run of ACTS, each with
// its own box shape and soul mode, like Undertale's attacks. mix = my star patterns (red soul, free); bones = Papyrus
// (BLUE soul: gravity, W / up / space to jump; blue bones only hurt if you move, orange only if you stand still);
// strings = Muffet (PURPLE soul: stuck to three strings, W / S to change string, spiders crawl along them);
// turrets = Mad Dummy (a ring of turrets fires in turn, plus homing missiles).
export const BOX_SHAPES = {
  mix: { minX: 290, maxX: 990, minY: 236, maxY: 586 },
  bones: { minX: 220, maxX: 1060, minY: 380, maxY: 586 },
  strings: { minX: 270, maxX: 1010, minY: 286, maxY: 586 },
  turrets: { minX: 455, maxX: 825, minY: 216, maxY: 586 },
  spears: { minX: 545, maxX: 735, minY: 316, maxY: 506 },   // Undyne: GREEN soul, you can't move; turn the shield to block
  swipes: { minX: 290, maxX: 990, minY: 236, maxY: 586 },   // Asgore: blue / orange sweeps across the whole box + falling fire
  cgpt: { minX: 320, maxX: 960, minY: 320, maxY: 580 },     // P13: ChatGPT's prototype-13 box (owner: "read ChatGPT's code and add its mechanics")
}; // P8: owner "the playing field is way too small" (was 440x280, now 700x350); the strip under it is for her lines
const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const STAGES = {
  1: { bossHp: 4500, gates: [0.8, 0.6, 0.4, 0.2], gap: 1.9, speed: 1, dmg: 1, dodge: 0.1, boss: 'THE ECLIPSE', hero: 'WARDEN' },
  2: { bossHp: 6000, gates: [0.8, 0.6, 0.4, 0.2], gap: 1.45, speed: 1.18, dmg: 1.15, dodge: 0.2, boss: 'THE ECLIPSE · UNBOUND', hero: 'WARDEN · REBORN' },
  3: { bossHp: 7800, gates: [0.75, 0.5, 0.25], gap: 1.0, speed: 1.42, dmg: 1.4, dodge: 0.28, boss: 'TOTALITY', hero: 'WARDEN · ASCENDED' },
};
export const HERO_MAX = 100, HEAL = 32;
// owner: Normal (what we've been tuning) and Hard ("extremely hard but still beatable"), picked on the title screen
export const MODES = {
  normal: { key: 'normal', name: 'NORMAL', hp: 1, speed: 1, dmg: 1, dodge: 1, gates6: false, combo: [0, .45, .6, .8], triple: [0, .1, .2, .3], gapMul: .62, pressure: [0, 2.1, 1.7, 1.4], pressN: 3, qte: 1, boxEvery: 24, need: [4.6, 0, 1], keyMoments: 3, keyCount: 4, keyTime: 1, stun: 1.1, hardBox: false },
  hard: { key: 'hard', name: 'HARD', hp: 1.3, speed: 1.15, dmg: 1.3, dodge: 1.7, gates6: true, combo: [0, .75, .85, .95], triple: [0, .35, .5, .6], gapMul: .45, pressure: [0, 1.05, .85, .7], pressN: 5, qte: .8, boxEvery: 15, need: [6.2, 0, 1.1], keyMoments: 4, keyCount: 5, keyTime: .8, stun: 1.3, hardBox: true },
};
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
export const FIN = { mult: 6, // P12: x3 with the boss HP so a finisher still lands like one
  chance: [0, .08, .08, .06], cooldown: 16, window: 2.6, len: 4.2, keys: 7, qte: [0, 4.2, 3.8, 3.3] };
// P13 owner: "finishers always pop up as Star of David something, the names don't change": each has its own name,
// shown on the prompt, the key screen and the cinematic. finNext() is the one the next finisher will be.
// P13 owner: "if any look way too similar make them unique": SIX POINTS became MAGEN DAVID, RISING STAR became STAR CAGE
export const FIN_NAMES = ['STAR PATH', 'MAGEN DAVID', 'STAR CAGE', 'SUKKAH', 'DAVID LASER', 'SPINNING STAR'];
export const finNext = (s) => (s.fin0 + s.stats.finishers) % FIN_NAMES.length;
export const FIN_KEYS = ['W', 'A', 'S', 'D', 'J', 'K', 'L', 'I'];
export const RUNE_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'];
export const CHAIN_KEYS = ['J', 'K', 'L', 'U', 'I', 'O'];
export const TALK_CPS = 42;
export const REWARDS = {
  normal: ['ECLIPSE CARD', 'WARDEN REBORN CARD', '1,000 COINS'],
  secret: ['TOTALITY CARD · SECRET', 'ASCENDED WARDEN CARD', 'TITLE: ECLIPSE BREAKER', '5,000 COINS'],
};

export function createFight({ seed = 7, force = null, mode = 'normal', start = 1, fin = 0 } = {}) {
  const s = {
    M: MODES[mode] || MODES.normal,
    t: 0, phase: 'intro', phaseT: 0, stage: 1, R: rng(seed), events: [], force, forceUsed: false,
    hero: { x: 300, y: 560, vx: 0, vy: 0, hp: HERO_MAX, chip: HERO_MAX, face: 1, inv: 0, dodgeT: 0, dodgeCd: 0, dodgeDir: [1, 0],
      slashCd: 0, cds: {}, sel: 'star', heals: 1, invert: 0, squash: 0, hurt: 0, trail: [], cast: null, orbit: null, lance: null, field: null, charge: null, starfall: null },
    boss: null, shots: [], heroShots: [], hazards: [], box: null, timing: null, rune: null, chain: null, clash: null, cine: null,
    finisher: { prompt: 0, cd: 6, cine: null }, fq: null, talk: null, noTalk: !!force, banner: null, hitstop: 0, slowmo: 0, secret: false, result: null, stats: { perfects: 0, finishers: 0, heals: 0 }, fin0: fin | 0,
  };
  setupStage(s, 1, true);
  if (start >= 2 && !force) { // P11 owner: "make it save phases": begin at a saved phase checkpoint
    setupStage(s, start, true); s.hero.heals = 2; s.checkpoint = start; if (start === 3) s.secret = true;
    s.phase = 'fight'; banner(s, start === 3 ? 'TOTALITY' : 'PHASE 2', 'CHECKPOINT', start === 3 ? '#ffffff' : '#ff8a6b'); s.boss.attackCd = 2.5;
  }
  if (force === 'stage2') { setupStage(s, 2, true); }
  if (force === 'stage3') { setupStage(s, 3, true); }
  if (force === 'clash1' || force === 'clash2' || force === 'clash3') { const k = Number(force.slice(-1)); if (k > 1) setupStage(s, k, true); s.boss.hp = 0; s.pendingClash = k; s.secret = k === 2 && false; }
  if (force === 'secret') { setupStage(s, 2, true); s.boss.gateIndex = s.boss.gates.length; s.boss.hp = 40; s.boss.chip = 40; s.finisher.cd = 0; s.forceFinisherPrompt = true; }
  if (force === 'box') { s.pendingGate = true; s.boss.hp = s.boss.gates[0]; s.boss.chip = s.boss.hp; }
  if (force === 'finisher') { s.finisher.cd = 0; s.forceFinisherPrompt = true; }
  return s;
}
function setupStage(s, stage, silent = false) {
  const cfg = STAGES[stage], M = s.M, hp = Math.round(cfg.bossHp * M.hp);
  // hard: a box every ~14% of her HP (six per phase, four in TOTALITY) instead of every 20%
  const gates = M.gates6 ? (stage === 3 ? [.8, .6, .4, .2] : [6, 5, 4, 3, 2, 1].map((i) => i / 7)) : cfg.gates;
  s.stage = stage;
  s.boss = { x: 980, y: 455, hp, max: hp, chip: hp, gates: gates.map((g) => Math.round(hp * g)), gateIndex: 0, queue: [],
    attackCd: 2.2, last: null, tell: 0, tellKind: null, flash: 0, stagger: 0, sway: 0, dodgeCd: 2, dodgeT: 0, dodgeDir: 1,
    cds: { box: M.boxEvery * .6, barrage: 7, slam: 4, chains: 6, rune: 10, catch: 7, earth: 5, laser: 3, cross: 6, doom: 8, gravity: 9, spiral: 5, corona: 7, twin: 12 },
    hands: [{ x: 860, y: 450, busy: false }, { x: 1100, y: 450, busy: false }] };
  s.hero.heals = 2; // heals never carry into the next phase (P13 owner: was 1, he ran dry; now 2, +1 when a box starts)
  Object.assign(s.hero, { cds: {}, invert: 0, orbit: null, lance: null, field: null, charge: null, starfall: null }); s.shots = []; s.heroShots = []; s.hazards = [];
  if (!silent) { ev(s, 'stage', { stage }); }
}

function ev(s, type, extra = {}) { s.events.push({ type, ...extra }); }
function setPhase(s, p) { s.phase = p; s.phaseT = 0; }
function banner(s, text, sub = '', color = '#ffd7a1') { s.banner = { text, sub, color, t: 0 }; }
const cfg = (s) => { const b = STAGES[s.stage], M = s.M; return { ...b, speed: b.speed * M.speed, dmg: b.dmg * M.dmg, dodge: Math.min(.6, b.dodge * M.dodge), gap: b.gap / M.speed * (M.gapMul || 1) }; };

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
  1: [['box', 1.4], ['orbs', 3], ['slam', 2], ['barrage', 1.3], ['chains', 1.5], ['rune', 1.1], ['catch', 1.6], ['earth', 1.6], ['laser', 2]],
  2: [['box', 1.4], ['orbs', 2], ['slam', 1.6], ['barrage', 1.6], ['chains', 1.4], ['rune', 1.2], ['catch', 1.4], ['earth', 1.3], ['laser', 1.8], ['cross', 1.8], ['doom', 1.6], ['gravity', 1.4], ['spiral', 1.6]],
  3: [['box', 1.4], ['orbs', 1.5], ['slam', 1.4], ['barrage', 1.5], ['chains', 1.3], ['rune', 1.2], ['catch', 1.3], ['earth', 1.2], ['laser', 1.6], ['cross', 1.7], ['doom', 1.6], ['gravity', 1.3], ['spiral', 1.6], ['corona', 1.8], ['twin', 1.2]],
};
const SOLO = new Set(['rune', 'chains', 'box']); // never part of a combo
function chooseAttack(s) {
  const b = s.boss;
  if (s.force && s.force !== 'box' && !s.forceUsed && (POOLS[3].some(([k]) => k === s.force) || s.force === 'minibox')) { if (s.force === 'minibox') { s.forceUsed = true; return ['box']; } s.forceUsed = true; return [s.force]; }
  const ready = POOLS[s.stage].filter(([k]) => (b.cds[k] ?? 0) <= 0 && k !== b.last);
  if (!ready.length) return ['orbs'];
  const pick = () => { const tot = ready.reduce((a, [, w]) => a + w, 0); let p = s.R() * tot; for (const [k, w] of ready) { p -= w; if (p <= 0) return k; } return ready[0][0]; };
  const first = pick();
  // phase 2-3: sometimes two attacks at once (never two hand attacks or pulls, never with a QTE)
  const BIG = ['slam', 'gravity', 'twin', 'barrage', 'catch'];
  if (!SOLO.has(first) && s.R() < s.M.combo[s.stage]) { // owner: multiple attacks at once
    const second = ready.map(([k]) => k).filter((k) => k !== first && !SOLO.has(k) && !(BIG.includes(k) && BIG.includes(first)));
    if (second.length) { const two = second[Math.floor(s.R() * second.length)];
      const third = second.filter((k) => k !== two && !(BIG.includes(k) && (BIG.includes(first) || BIG.includes(two))));
      if (third.length && s.R() < (s.M.triple?.[s.stage] || 0)) return [first, two, third[Math.floor(s.R() * third.length)]]; // Hard: three at once
      return [first, two]; }
  }
  return [first];
}
function startAttacks(s, kinds) {
  const b = s.boss;
  b.tell = 0.45; b.tellKind = kinds[0]; ev(s, 'tell', { kind: kinds[0] });
  let wait = cfg(s).gap;
  kinds.forEach((kind, i) => { if (i === 0) wait += spawnAttack(s, kind); else { b.queue.push({ kind, t: .55 * i }); wait += s.M.key === 'hard' ? .5 : .9; } });
  b.attackCd = wait;
}
// one attack; returns the extra time before her next move
function spawnAttack(s, kind) {
  const b = s.boss, h = s.hero, R = s.R, sp = cfg(s).speed, fast = 1 / sp;
  let wait = 0;
  b.last = kind; b.cds[kind] = { box: s.M.boxEvery, orbs: 0, barrage: 10, slam: 9, chains: 11, rune: 18, catch: 8, earth: 6, laser: 3.5, cross: 7, doom: 9, gravity: 10, spiral: 6, corona: 8, twin: 14 }[kind] * (s.stage === 3 ? 0.75 : 1);
  if (kind === 'box') { beginBox(s, true); return 0; }
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
    s.rune = { keys, i: 0, t: 0, warn: 1, limit: [0, 5, 4.4, 4.2][s.stage] * s.M.qte, rise: 0, wrong: -1, done: null }; // P11: 1 s GET READY first, presses ignored
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
    s.hazards.push({ kind: 'corona', t: 0, tele: 1 * fast, len: 1.6 * fast, gap: FLOOR.minY + 30 + R() * (FLOOR.maxY - FLOOR.minY - 120), hit: false });
    wait += 1.2;
  }
  return wait;
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
    case 'spinner1': for (let i = -1; i <= 1; i++) { const r = ang + i * .34; shot({ kind: 'spin', vx: Math.cos(r) * 700, vy: Math.sin(r) * 700, r: 12, life: 1.7, homing: .035 }); } break; // owner: three stars, slight homing
    case 'burst1': shot({ kind: 'burst', vx: ax * 520, vy: ay * 520, r: 24, splash: 120, popEnd: true }); break; // big spinning star, explodes on impact
    case 'eyes1': s.hazards.push({ kind: 'heroBeam', x: ox, y: oy - 30, a: ang, t: 0, tele: .14, len: .22, dmg, hit: false }); break;
    case 'lattice1': for (let i = 0; i < 6; i++) s.heroShots.push({ kind: 'fall', x: b.x + (i - 2.5) * 44 + (s.R() - .5) * 20, y: -60 - i * 70, vx: 0, vy: 950, r: 14, dmg, life: 2.5, age: 0, gy: b.y + 10 + (s.R() - .5) * 50 }); break; // stars fall from the sky and explode
    case 'nova1': shot({ kind: 'nova', vx: ax * 380, vy: ay * 380, r: 58, life: 3, pierce: true, splash: 180 }); break; // the biggest star
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
  if (h.starfall) { const f = h.starfall; f.t -= dt; if (f.t <= 0 && f.n < f.total) { f.t = .11; f.n++; s.heroShots.push({ kind: 'fall', x: b.x + (s.R() - .5) * 200, y: -60, vx: (s.R() - .5) * 80, vy: 1100, r: 13, dmg: f.dmg, life: 2.5, age: 0, gy: b.y + 10 + (s.R() - .5) * 60 }); } if (f.n >= f.total) h.starfall = null; }
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
  // P11 owner: the finisher traces the Star of David with a trail, then a beam of light falls from the sky onto a
  // huge spinning star on the ground. Three versions, taken in turn so it is never the same one twice in a row.
  const v = (s.fin0 + s.stats.finishers - 1) % FIN_NAMES.length; // P13: the rotation carries over between fights (index.html saves it), so all four get seen. P12: a fourth version, the SUKKAH (the hut he builds, then stars rain from it)
  s.finisher.cine = { t: 0, len: v === 1 ? 4.8 : v === 2 ? 4.6 : v === 3 ? SUKKAH.len : v === 4 ? 4.8 : v === 5 ? 5.6 : FIN.len, rot: 0, w: 0, dmg: Math.round(ABIL.nova.dmg[s.stage] * FIN.mult * (1 + (s.R() - .5) * .1)), v, trace: 0, cx: s.boss.x, cy: s.boss.y - 105, R: 235, orbs: [], absorbed: 0, squeeze: 0,
    name: FIN_NAMES[v], sub: '', hits: 0, pole: [0, 0, 0, 0], branches: 0,
    hx: clamp(s.boss.x - 430, FLOOR.minX + 120, FLOOR.maxX - 500), hy: clamp(s.boss.y + 40, FLOOR.minY + 160, FLOOR.maxY - 10), bombs: [] };
  if (v >= 4) { const c = s.finisher.cine; c.cy = clamp(s.boss.y - 105, 310, 460); c.R = c.R0 = 235; }
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
    // P13 owner: "the star bugs out sometimes": lerping the velocity vector could shrink it to nothing, so a star that
    // missed (she sidestepped) hung shaking on her. Now it turns at a capped rate, keeps its speed, and stops homing
    // once it has flown past her.
    if (p.homing && p.age > .12 && !p.passed) {
      const dx = s.boss.x - p.x, dy = (s.boss.y - 105) - p.y, sp = Math.hypot(p.vx, p.vy) || 1;
      if (dx * p.vx + dy * p.vy < 0) p.passed = true;
      else { const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(dy, dx), turn = (p.homing === true ? 6 : 2.6) * dt;
        let da = want - cur; da = Math.atan2(Math.sin(da), Math.cos(da)); const a = cur + clamp(da, -turn, turn); p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; }
    }
    if (p.kind === 'fall' && p.gy != null && p.y + p.vy * dt >= p.gy) { // a falling star bursts on the ground near her
      const near = Math.abs(p.x - b.x) < 130 && b.dodgeT <= 0; if (near) landHit(s, p, p.dmg, p.x, p.gy - 60); ev(s, 'splash', { x: p.x, y: p.gy, r: 90, kind: 'fall' }); s.heroShots.splice(i, 1); continue; }
    if (p.ret && p.age > .55 && !p.turned) { p.turned = true; p.hitBoss = false; } // the shield hits again on the way back
    if (p.ret && p.age > .55) { const dx = h.x - p.x, dy = (h.y - 50) - p.y, d = Math.hypot(dx, dy) || 1; p.vx = lerp(p.vx, dx / d * 900, .08); p.vy = lerp(p.vy, dy / d * 900, .08); if (d < 30 && p.age > .8) { s.heroShots.splice(i, 1); continue; } }
    p.x += p.vx * dt; p.y += p.vy * dt;
    // boss sidestep: the boss reads incoming shots (chance per stage)
    if (b.dodgeCd <= 0 && b.dodgeT <= 0 && s.phase === 'fight' && b.stagger <= 0 && Math.hypot(p.x - b.x, p.y - b.y) < 200 && !['fall', 'wave'].includes(p.kind)) {
      b.dodgeCd = 1.4; if (s.R() < cfg(s).dodge) { b.dodgeT = .28; b.dodgeDir = s.R() < .5 ? -1 : 1; ev(s, 'bossDodge', { x: b.x, y: b.y }); }
    }
    if (!p.hitBoss && !(p.kind === 'fall' && p.gy != null) && heroShotHits(s, p)) {
      if (b.dodgeT > 0) { /* passes through the afterimage */ }
      else {
        if (p.splash) { landHit(s, p, p.dmg, p.x, p.y); ev(s, 'splash', { x: p.x, y: p.y, r: p.splash, kind: p.kind, big: !!p.supernova }); }
        else landHit(s, p, p.dmg, p.x, p.y);
        if (p.pierce || p.ret) p.hitBoss = true; else { s.heroShots.splice(i, 1); continue; }
      }
    }
    if (p.popEnd && p.age > p.life) ev(s, 'splash', { x: p.x, y: p.y, r: p.splash * .6, kind: p.kind, fizzle: true });
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
          s.chain = { keys, i: 0, t: 0, limit: [0, 2.9, 2.5, 2.3][s.stage] * s.M.qte, wrong: 0 }; setPhase(s, 'chained'); ev(s, 'chained'); break;
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
        if (!z.hit && z.t >= z.tele) { z.hit = true; const b2 = s.boss; if (segDist(b2.x, b2.y - 105, z.x, z.y, z.x + Math.cos(z.a) * 1600, z.y + Math.sin(z.a) * 1600) < 100) { z.ix = b2.x - 40; z.iy = b2.y - 105; landHit(s, { kind: 'eyes' }, z.dmg, z.ix, z.iy); ev(s, 'eyesHit', { x: z.ix, y: z.iy }); } ev(s, 'heroBeam', { x: z.x, y: z.y, a: z.a }); }
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
// P8 owner notes: the box was still "extremely easy" (his recording of the live box was the bar to beat, and he
// wants it harder than that), with FEWER indicators. So: a bigger box, Undertale-style patterns whose shape already
// shows the way out (gap walls, a closing ring with a gap, a spinning spiral), and the only marker left is the blue
// safe area for the patterns that have one (lanes, spokes, sweep, crusher). No dashed aim lines, no text labels.
const BOX_MIX = { // normal; hard plays the same tables faster, denser, with an overlay running underneath
  1: [['lanes', 'gapwall', 'radial'], ['ring', 'lanes', 'spiral'], ['gapwall', 'radial', 'ring', 'lanes'], ['spiral', 'crush', 'ring', 'gapwall']],
  2: [['gapwall', 'ring', 'radial', 'spiral'], ['sweep', 'spiral', 'ring', 'lanes'], ['crush', 'gapwall', 'spiral', 'ring'], ['ring', 'sweep', 'spiral', 'gapwall', 'crush']],
  3: [['spiral', 'ring', 'gapwall', 'crush'], ['ring', 'spiral', 'sweep', 'gapwall'], ['gapwall', 'ring', 'spiral', 'crush', 'radial']],
};
const BOUNCERS = { normal: { 1: [0, 1, 1, 1], 2: [1, 1, 2, 2], 3: [1, 2, 2] }, hard: { 1: [1, 1, 2, 2, 2, 2], 2: [2, 2, 2, 3, 3, 3], 3: [2, 3, 3] } };
const pickGate = (arr, g) => arr[Math.min(g, arr.length - 1)];
const ACTS = { // per stage, per gate; Hard adds one more act to every box
  1: [['mix', 'cgpt', 'bones', 'spears'], ['bones', 'strings', 'cgpt', 'swipes'], ['turrets', 'spears', 'cgpt', 'strings'], ['swipes', 'cgpt', 'bones', 'turrets']],
  2: [['bones', 'cgpt', 'spears', 'swipes'], ['strings', 'turrets', 'cgpt', 'bones'], ['spears', 'cgpt', 'swipes', 'strings'], ['mix', 'strings', 'spears', 'cgpt', 'bones']],
  3: [['turrets', 'cgpt', 'spears', 'strings'], ['swipes', 'turrets', 'cgpt', 'spears', 'bones'], ['bones', 'strings', 'cgpt', 'swipes', 'spears']],
};
const ACT_LEN = { normal: 3.6, hard: 3.4 }, TRANS = .5;
function beginBox(s, short = false) {
  const g = s.boss.gateIndex, st = s.stage, hard = s.M.hardBox;
  let acts = pickGate(ACTS[st], g).slice();
  if (hard) acts.push(['turrets', 'spears', 'bones', 'swipes', 'strings', 'mix'][(g + st) % 6]);
  if (short) acts = [acts[(g + (s.boxCount || 0)) % acts.length]];
  if (s.forceAct && BOX_SHAPES[s.forceAct]) acts = [s.forceAct, s.forceAct]; // test flag ?act=bones|strings|turrets|mix
  const al = ACT_LEN[hard ? 'hard' : 'normal'] + (short ? 1.4 : 0), len = acts.length * al + (acts.length - 1) * TRANS;
  const mix = pickGate(BOX_MIX[st], g);
  s.box = { t: 0, len, short, hard, gate: g, mix, acts, ai: 0, actT: 0, actLen: al, act: null, trans: null, mode: 'red', moving: false, prevMy: 0,
    soul: { x: 640, y: 411, vx: 0, vy: 0, si: 1, ground: false }, bullets: [], beams: [], emitters: [], turrets: [], wave: 0, next: 1, preview: null, shown: null, aimT: 9, shake: 0, line: null, hint: null };
  s.hero.heals = Math.min(4, s.hero.heals + 1); ev(s, 'healGain', { heals: s.hero.heals }); // P13: the bonus heal comes AT the start of the box so it can be used inside
  Object.assign(BOX, BOX_SHAPES[acts[0]]);
  startAct(s, acts[0]);
  const lines = SCRIPT.boxLines || []; if (lines.length && !short) s.box.line = { text: lines[(s.boxCount = (s.boxCount || 0) + 1) % lines.length], t: 0 };
  s.shots = []; s.hazards = []; s.heroShots = []; s.boss.hands.forEach((hd) => { hd.busy = false; });
  setPhase(s, 'box'); banner(s, short ? 'TRAPPED' : 'SURVIVE', short ? 'SHE PULLS YOU INTO THE BOX' : 'DODGE · NO ATTACKS', '#e8f1ff'); ev(s, 'boxStart');
}
const MODE_OF = { mix: 'red', bones: 'blue', strings: 'purple', turrets: 'red', spears: 'green', swipes: 'red', cgpt: 'red' };
const HINTS = { blue: 'BLUE SOUL: W or SPACE jumps. Blue bones: freeze. Orange: keep moving.', purple: 'PURPLE SOUL: you ride the strings. W and S switch string.', green: 'GREEN SOUL: you can\'t move. Point the shield (WASD) at each spear.' };
function startAct(s, kind) {
  const b = s.box, st = s.stage, hard = b.hard, sp = cfg(s).speed, so = b.soul;
  b.act = kind; b.actT = 0; b.mode = MODE_OF[kind]; b.bullets = []; b.beams = []; b.emitters = []; b.turrets = []; b.preview = null; b.shown = null;
  b.st = { fire: .8, spawn: .5, missile: 1.2, ti: 0 };
  so.x = (BOX.minX + BOX.maxX) / 2; so.vx = so.vy = 0;
  so.shield = 'up'; if (b.mode === 'green') { so.x = 640; so.y = 411; } if (b.mode === 'blue') so.y = BOX.maxY - 9; else if (b.mode === 'purple') { so.si = 1; so.y = stringY(1); } else so.y = (BOX.minY + BOX.maxY) / 2;
  if (HINTS[b.mode] && !(s.seenModes ||= {})[b.mode]) { s.seenModes[b.mode] = true; b.hint = { text: HINTS[b.mode], t: 0 }; }
  if (kind === 'mix') { b.next = .7; b.aimT = hard ? 1.2 : 1.8; const nb = pickGate(BOUNCERS[hard ? 'hard' : 'normal'][st], b.gate); for (let i = 0; i < nb; i++) { const a = s.R() * TAU; b.bullets.push({ x: BOX.minX + 60 + i * 200, y: BOX.minY + 30, vx: Math.cos(a) * 190 * sp, vy: Math.abs(Math.sin(a)) * 190 * sp + 60, r: 12, age: 0, tele: .9, bounce: true }); } }
  if (kind === 'strings') { const nd = hard ? 2 : 1; for (let i = 0; i < nd; i++) { const a = .6 + s.R() * .5; b.bullets.push({ x: BOX.minX + 80 + i * 300, y: BOX.minY + 20, vx: Math.cos(a) * 170 * sp * (i % 2 ? -1 : 1), vy: Math.sin(a) * 170 * sp, r: 13, age: 0, tele: 1, bounce: true, donut: true }); } }
  if (kind === 'cgpt') { b.cg = { pattern: ['lanes', 'vertical', 'radial', 'beams'][(b.gate + st + (s.boxCount || 0)) % 4], wave: 0, spawn: .65, pressure: 1.25, pw: 0, preview: null, waves: [] }; }
  if (kind === 'turrets') { const cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, rx = (BOX.maxX - BOX.minX) / 2 + 34, ry = (BOX.maxY - BOX.minY) / 2 + 34;
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; b.turrets.push({ x: cx + Math.sign(Math.round(Math.cos(a) * 10)) * rx, y: cy + Math.sign(Math.round(Math.sin(a) * 10)) * ry, flash: 0 }); } }
  ev(s, 'boxAct', { kind, mode: b.mode });
}
const stringY = (i) => BOX.minY + (BOX.maxY - BOX.minY) * (i + 1) / 4;
const BW = () => BOX.maxX - BOX.minX, BH = () => BOX.maxY - BOX.minY;
function previewFor(s) {
  const b = s.box, p = b.mix[b.wave % b.mix.length], R = s.R;
  if (p === 'lanes') return { pattern: p, safe: Math.floor(R() * (b.wave % 2 ? 7 : 5)), vertical: b.wave % 2 === 1, n: b.wave % 2 ? 7 : 5 };
  if (p === 'radial') return { pattern: p, safe: Math.floor(R() * 24), off: b.wave * .23 };
  if (p === 'sweep') return { pattern: p, gapY: BOX.minY + 50 + R() * (BH() - 100), fromLeft: R() < .5, half: s.stage === 3 ? 32 : 38 };
  if (p === 'crush') return { pattern: p, cy: BOX.minY + 50 + R() * (BH() - 100), half: s.stage === 3 ? 28 : 34 };
  if (p === 'gapwall') return { pattern: p, fromLeft: R() < .5, gaps: Array.from({ length: b.hard ? 6 : 5 }, () => BOX.minY + 50 + R() * (BH() - 100)) };
  if (p === 'ring') return { pattern: p, gap: R() * TAU };
  return { pattern: 'spiral', dir: R() < .5 ? -1 : 1, a0: R() * TAU };
}
function spawnBoxWave(s, pv) {
  const b = s.box, sp = cfg(s).speed * (b.hard ? 1.12 : 1), cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2;
  if (pv.pattern === 'lanes') {
    const vertical = pv.vertical, n = pv.n, lw = BW() / n, lh = BH() / n, fromStart = b.wave % 4 < 2;
    for (let i = 0; i < n; i++) {
      if (i === pv.safe) continue;
      const v = (400 + b.gate * 40) * sp;
      b.bullets.push({ x: vertical ? BOX.minX + lw * (i + .5) : fromStart ? BOX.minX - 14 : BOX.maxX + 14, y: vertical ? (fromStart ? BOX.minY - 14 : BOX.maxY + 14) : BOX.minY + lh * (i + .5),
        vx: vertical ? 0 : fromStart ? v : -v, vy: vertical ? (fromStart ? v : -v) : 0, r: vertical ? lw * .44 : lh * .44, wall: true, vertical, age: 0, tele: .3 });
    }
  } else if (pv.pattern === 'radial') {
    const spokes = 24;
    for (let i = 0; i < spokes; i++) { if (((i - pv.safe + spokes) % spokes) <= 2) continue; const a = i / spokes * TAU + pv.off; b.bullets.push({ x: cx, y: cy, vx: Math.cos(a) * (240 + b.gate * 20) * sp, vy: Math.sin(a) * (240 + b.gate * 20) * sp, r: 9, age: 0, tele: .35 }); }
  } else if (pv.pattern === 'sweep') b.beams.push({ kind: 'sweep', t: 0, len: 1.3 / sp, gapY: pv.gapY, half: pv.half, fromLeft: pv.fromLeft, x: pv.fromLeft ? BOX.minX : BOX.maxX });
  else if (pv.pattern === 'crush') b.beams.push({ kind: 'crush', t: 0, cy: pv.cy, half: pv.half, close: .4 / sp, hold: .7, open: .3, k: 0 });
  else if (pv.pattern === 'gapwall') { // a run of walls, each with one gap, the gap moving from wall to wall
    // P13 owner: "the first one is literally impossible to reach; make it longer but make the gates make sense".
    // The first gap is always within reach of where the soul is when its wall gets there; each next gap is within
    // reach of the one before (soul speed x the time between walls, with a margin). 8 walls (9 on Hard).
    const so = b.soul, n = b.hard ? 9 : 8, gapT = b.hard ? .42 : .5, len = 1.9 / sp, wv = BW() / len, lo = BOX.minY + 52, hi = BOX.maxY - 52, lead = .45, R = () => s.R();
    const x0 = pv.fromLeft ? BOX.minX : BOX.maxX, tFirst = lead + Math.abs(so.x - x0) / wv;
    let gy = clamp(so.y + (R() - .5) * 2 * Math.min(150, 300 * tFirst * .55), lo, hi), dir = R() < .5 ? -1 : 1;
    pv.gaps = [];
    for (let i = 0; i < n; i++) {
      if (i) { if (R() < .35) dir = -dir; let step = (.4 + R() * .6) * 300 * gapT * .6; if (gy + dir * step < lo || gy + dir * step > hi) dir = -dir; gy = clamp(gy + dir * step, lo, hi); }
      pv.gaps.push(gy); b.beams.push({ kind: 'sweep', t: -(lead + i * gapT), len, gapY: gy, half: b.hard ? 42 : 48, fromLeft: pv.fromLeft, x: x0, wall: true });
    }
    pv.runT = lead + (n - 1) * gapT + len; b.actLen = Math.max(b.actLen, b.actT + pv.runT + .4); // the act waits for the whole run
  } else if (pv.pattern === 'ring') { // a ring closes in on the soul; one gap is the way out
    const n = b.hard ? 34 : 28, R0 = 250, gapN = b.hard ? 3 : 4;
    for (let i = 0; i < n; i++) { const a = pv.gap + i / n * TAU; if (i < gapN) continue; b.bullets.push({ x: b.soul.x + Math.cos(a) * R0, y: b.soul.y + Math.sin(a) * R0, vx: -Math.cos(a) * 165 * sp, vy: -Math.sin(a) * 165 * sp, r: 9, age: 0, tele: .45, ring: true }); }
  } else if (pv.pattern === 'spiral') b.emitters.push({ kind: 'spiral', t: 0, len: b.hard ? 2.4 : 2, fire: 0, a: pv.a0, dir: pv.dir, arms: b.hard ? 4 : 3, rate: b.hard ? .075 : .09, x: cx, y: cy });
  b.wave++;
}
function updateBox(s, dt, inp) {
  const b = s.box, so = b.soul, h = s.hero, st = s.stage, hard = b.hard, sp = cfg(s).speed * (hard ? 1.12 : 1);
  b.t += dt;
  if (b.line) { b.line.t += dt; if ((inp.confirm || inp.attack0 || inp.taps > 0) && b.line.t > .3) b.line.t = Math.max(b.line.t, 3.2); } // click / Enter clears her line
  if (b.hint) b.hint.t += dt;
  // ---- acts: run one, then the box reshapes (no damage, bullets cleared) and the next starts
  if (b.trans) {
    const T = b.trans; T.t += dt; const k = easeOut(clamp(T.t / TRANS, 0, 1));
    for (const key of ['minX', 'maxX', 'minY', 'maxY']) BOX[key] = lerp(T.from[key], T.to[key], k);
    so.x = clamp(so.x, BOX.minX + 9, BOX.maxX - 9); so.y = clamp(so.y, BOX.minY + 9, BOX.maxY - 9);
    if (T.t >= TRANS) { b.trans = null; startAct(s, b.acts[b.ai]); }
    return finishBox(s);
  }
  b.actT += dt;
  if (b.actT >= b.actLen && b.ai < b.acts.length - 1) { b.ai++; b.bullets = []; b.beams = []; b.emitters = []; b.turrets = []; b.trans = { t: 0, from: { ...BOX }, to: BOX_SHAPES[b.acts[b.ai]] }; ev(s, 'boxShift'); return; }
  // ---- the soul
  let mx = inp.mx, my = inp.my; if (h.invert > 0) { mx = -mx; my = -my; }
  const up = my < -.5 || inp.jump || inp.dodge, len = Math.max(1, Math.hypot(mx, my));
  if (b.mode === 'blue') { // gravity; hold to jump higher
    so.vx = mx * 270; so.x += so.vx * dt;
    if (so.ground && up) { so.vy = -610; so.ground = false; ev(s, 'soulJump'); }
    if (!up && so.vy < -230) so.vy = -230;
    so.vy += 1550 * dt; so.y += so.vy * dt;
    if (so.y >= BOX.maxY - 9) { so.y = BOX.maxY - 9; so.vy = 0; so.ground = true; } else so.ground = false;
    if (so.y < BOX.minY + 9) { so.y = BOX.minY + 9; so.vy = Math.max(0, so.vy); }
    b.moving = Math.abs(mx) > .15 || !so.ground;
  } else if (b.mode === 'green') { // rooted; the shield turns to the last direction pressed
    if (Math.abs(mx) > .5 || Math.abs(my) > .5) so.shield = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
    so.x = 640; so.y = 411; b.moving = false;
  } else if (b.mode === 'purple') { // three strings; W / S hop between them
    if (my < -.5 && b.prevMy >= -.5) so.si = Math.max(0, so.si - 1);
    if (my > .5 && b.prevMy <= .5) so.si = Math.min(2, so.si + 1);
    so.x += mx * 290 * dt; so.y = lerp(so.y, stringY(so.si), 1 - Math.exp(-dt * 30));
    b.moving = Math.abs(mx) > .15 || Math.abs(so.y - stringY(so.si)) > 3;
  } else {
    so.x += mx / len * 300 * dt; so.y += my / len * 300 * dt;
    b.moving = Math.abs(mx) + Math.abs(my) > .15;
  }
  b.prevMy = my;
  if (inp.heal && h.heals > 0 && h.hp < HERO_MAX) { h.heals--; s.stats.heals++; h.hp = Math.min(HERO_MAX, h.hp + HEAL); ev(s, 'heal', { x: so.x, y: so.y + 40, box: true }); } // P13 owner: heal inside the mini games too
  so.x = clamp(so.x, BOX.minX + 9, BOX.maxX - 9); so.y = clamp(so.y, BOX.minY + 9, BOX.maxY - 9);
  const live = b.actT < b.actLen - .7; // stop spawning a little before the act ends
  const B = b.st;
  // ---- act spawners
  if (b.act === 'mix') {
    b.next -= dt; b.aimT -= dt;
    const lead = { lanes: .5, radial: .45, sweep: .55, crush: .55 }, nextP = b.mix[b.wave % b.mix.length];
    if (!b.preview && lead[nextP] && b.next < lead[nextP] * (hard ? .7 : 1) && live) b.preview = previewFor(s);
    if (b.next <= 0 && live) {
      const pv = b.preview || previewFor(s); spawnBoxWave(s, pv); b.preview = null;
      b.shown = lead[pv.pattern] ? { ...pv, until: b.t + ({ lanes: 1, radial: .9, sweep: 1.3 / sp, crush: 1.3 }[pv.pattern]) } : null;
      b.next = ({ gapwall: 1.9, spiral: 1.7, ring: 1.35, sweep: 1.05, crush: 1.2 }[pv.pattern] || .95) * (hard ? .68 : .78) * [0, 1, .95, .9][st];
      if (pv.pattern === 'gapwall') b.next = Math.max(b.next, pv.runT - (hard ? 1.2 : .8)); // nothing new piles onto the gate run until its end
    }
    if (b.aimT <= 0 && live) {
      const side = Math.floor(s.R() * 4), ex = [BOX.minX + 10, BOX.maxX - 10][side % 2], ey = side < 2 ? BOX.minY + 10 : BOX.maxY - 10, a = Math.atan2(so.y - ey, so.x - ex), n = hard ? 2 : 1;
      for (let i = -n; i <= n; i++) b.bullets.push({ x: ex, y: ey, vx: Math.cos(a + i * .24) * (250 + b.gate * 25) * sp, vy: Math.sin(a + i * .24) * (250 + b.gate * 25) * sp, r: 7, age: 0, tele: .45, aimed: true });
      b.aimT = (hard ? Math.max(.9, 1.35 - b.gate * .07) : Math.max(1.3, 1.9 - b.gate * .1)) / sp;
    }
  } else if (b.act === 'bones') { // Papyrus: bones slide in along the floor and from the ceiling
    // P13 owner: "bones are extremely easy now, make it like before but slightly easier". Back to the P12 mix (both
    // directions, doubles, slower blue/orange bones), spawning ~9% slower. One guard stays: two bones never reach
    // the soul so close together that they ask for things it can't do at once (e.g. a ceiling bone mid-jump).
    B.spawn -= dt;
    if (B.spawn <= 0 && live) {
      const R = s.R(), dir = (hard || st >= 2) && s.R() < .3 ? 1 : -1, v = (hard ? 450 : 390) * sp * dir, x = dir < 0 ? BOX.maxX + 10 : BOX.minX - 10;
      const lateTall = st >= 2 || hard || b.gate >= 1;
      const need = R < .42 ? 'jump' : R < .62 ? 'down' : R < .84 || !lateTall ? 'still' : 'move', vv = need === 'jump' || need === 'down' ? v : v * .85;
      const tA = b.actT + Math.max(0, (so.x - x) * Math.sign(vv)) / Math.abs(vv);
      B.arr = (B.arr || []).filter((q) => q.t > b.actT - .2);
      const clash = B.arr.some((q) => { const d = Math.abs(q.t - tA); if (q.need === need) return need === 'jump' && d > .12 && d < .7; return d < (q.need === 'jump' || need === 'jump' ? .62 : .3); });
      if (clash) B.spawn = .07;
      else {
        if (need === 'jump') b.beams.push({ kind: 'bone', x, vx: vv, y1: BOX.maxY - (34 + s.R() * 40), y2: BOX.maxY, col: 'white' });
        if (need === 'down') b.beams.push({ kind: 'bone', x, vx: vv, y1: BOX.minY, y2: BOX.maxY - 46, col: 'white' });
        if (need === 'still') b.beams.push({ kind: 'bone', x, vx: vv, y1: BOX.minY + 8, y2: BOX.maxY, col: 'blue' });
        if (need === 'move') b.beams.push({ kind: 'bone', x, vx: vv, y1: BOX.minY + 8, y2: BOX.maxY, col: 'orange' });
        if (need === 'jump' && s.R() < (hard ? .5 : .3)) b.beams.push({ kind: 'bone', x: x - dir * 46, vx: vv, y1: BOX.maxY - (30 + s.R() * 30), y2: BOX.maxY, col: 'white' }); // a double: one jump clears both
        B.arr.push({ t: tA, need });
        B.spawn = (hard ? .37 : .46) * [0, 1, .94, .88][st] / sp;
      }
    }
  } else if (b.act === 'strings') { // Muffet: spiders run along the strings
    B.spawn -= dt;
    if (B.spawn <= 0 && live) {
      // P13 fairness: a spider's "busy window" is when it crosses the soul; at least one string is always free then
      const arrive = (p) => { const dx = (so.x - p.x) * Math.sign(p.vx); return dx < -30 ? null : dx / Math.abs(p.vx); };
      const busy = (si, t0) => b.bullets.some((p) => p.spider && p.si === si && (() => { const t = arrive(p); return t != null && Math.abs(t - t0) < .42; })());
      const lanes = [0, 1, 2].sort(() => s.R() - .5), n = s.R() < (hard ? .75 : .55) ? 2 : 1, made = [];
      for (let i = 0; i < n; i++) {
        const dir = s.R() < .5 ? 1 : -1, v = ((hard ? 400 : 350) + s.R() * 150) * sp * dir * (s.R() < .18 ? 1.5 : 1), x0 = dir > 0 ? BOX.minX - 12 : BOX.maxX + 12, t0 = Math.abs((so.x - x0) / v);
        const free = [0, 1, 2].filter((k) => k !== lanes[i] && !made.includes(k) && !busy(k, t0));
        if (busy(lanes[i], t0) || !free.length) continue; // would close the last free string: skip this one
        b.bullets.push({ x: x0, y: stringY(lanes[i]), vx: v, vy: 0, r: 11, age: 0, tele: .05, spider: true, si: lanes[i] }); made.push(lanes[i]);
      }
      B.spawn = (hard ? .15 : .21) * [0, 1, .94, .88][st] / sp;
    }
  } else if (b.act === 'turrets') { // Mad Dummy: the ring fires in turn, missiles hunt you
    B.fire -= dt; B.missile -= dt;
    if (B.fire <= 0 && live && b.turrets.length) {
      const tu = b.turrets[B.ti++ % b.turrets.length], a = Math.atan2(so.y - tu.y, so.x - tu.x); tu.flash = .15;
      b.bullets.push({ x: tu.x, y: tu.y, vx: Math.cos(a) * (hard ? 340 : 290) * sp, vy: Math.sin(a) * (hard ? 340 : 290) * sp, r: 7, age: 0, tele: .12, outside: true });
      B.fire = (hard ? .075 : .11) / sp;
    }
    if (B.missile <= 0 && live) {
      const tu = b.turrets[Math.floor(s.R() * b.turrets.length)], a = Math.atan2(so.y - tu.y, so.x - tu.x); tu.flash = .3;
      b.bullets.push({ x: tu.x, y: tu.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, r: 9, age: 0, tele: .3, missile: true, speed: (hard ? 215 : 175) * sp, turn: hard ? 2.4 : 2, life: 3.6, outside: true });
      B.missile = (hard ? .55 : .85) / sp;
    }
    for (const tu of b.turrets) tu.flash = Math.max(0, tu.flash - dt);
  }
  else if (b.act === 'cgpt') { // ChatGPT's box, ported from live core/vinsonbattle.js (beginBox / updateBox):
    // one pattern per box (lanes / vertical / radial / beams), a 0.35 s preview, waves every .85 s (.95 radial),
    // bullets that sit still through a .55/.65 s telegraph, and an aimed fan from the top or bottom at a snapshot of you.
    const G = b.cg, gi = Math.min(5, b.gate), cad = hard ? .82 : 1;
    G.spawn -= dt; G.pressure -= dt;
    if (G.spawn < .35 && !G.preview && live) G.preview = { safe: Math.floor(s.R() * 5), wave: G.wave, pattern: G.pattern };
    if (G.spawn <= 0 && live) {
      const lanes = 5, lh = (BOX.maxY - BOX.minY) / lanes, safe = G.preview ? G.preview.safe : Math.floor(s.R() * 5), fromRight = G.wave % 2 === 0;
      G.waves.push({ safe, wave: G.wave, pattern: G.pattern });
      if (G.pattern === 'radial') {
        const cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, gap = Math.round(safe * 16 / 5);
        for (let lane = 0; lane < 16; lane++) { if ((lane - gap + 16) % 16 <= 2) continue; const a = lane * Math.PI / 8 + G.wave * .19, spd = (170 + gi * 18) * sp; b.bullets.push({ x: cx, y: cy, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 8, age: 0, tele: .65, cw: G.wave }); }
      } else for (let lane = 0; lane < lanes; lane++) {
        if (lane === safe) continue; const vertical = G.pattern === 'vertical', beam = G.pattern === 'beams';
        b.bullets.push({ x: vertical ? BOX.minX + (BOX.maxX - BOX.minX) * (lane + .5) / lanes : fromRight ? BOX.maxX + 18 : BOX.minX - 18,
          y: vertical ? (fromRight ? BOX.minY - 18 : BOX.maxY + 18) : BOX.minY + lh * (lane + .5),
          vx: (vertical ? 0 : fromRight ? -(beam ? 440 : 400) : beam ? 440 : 400) * sp, vy: (vertical ? (fromRight ? 250 : -250) : 0) * sp, r: beam ? 13 : vertical ? 10 : 11, age: 0, tele: .55, cw: G.wave, outside: true });
      }
      G.wave++; G.preview = null; G.spawn += (G.pattern === 'radial' ? .95 : .85) * cad;
    }
    if (G.pressure <= 0 && live) { // the aimed fan; its bullets show where they start before they move
      const fromTop = G.pw % 2 === 0, x = clamp(so.x + (s.R() - .5) * 240, BOX.minX + 28, BOX.maxX - 28), y = fromTop ? BOX.minY + 12 : BOX.maxY - 12, ang = Math.atan2(so.y - y, so.x - x), count = 3 + (gi >= 2 ? 2 : 0);
      for (let i = 0; i < count; i++) { const a = ang + (i - (count - 1) / 2) * .22, spd = (210 + gi * 25) * sp; b.bullets.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 7, age: 0, tele: .7, aimed: true }); }
      G.pw++; G.pressure += Math.max(.6, 1.15 - gi * .09) * cad;
    }
    G.waves = G.waves.filter((w) => b.bullets.some((p) => p.cw === w.wave)).slice(-6);
  }
  else if (b.act === 'spears') { // Undyne: spears from four sides; in Hard and later phases some flip sides at the last moment
    B.spawn -= dt;
    if (B.spawn <= 0 && live) { // P12 owner: spears come from several sides at the same time (staggered so each can be blocked)
      const dirs = ['up', 'down', 'left', 'right'].sort(() => s.R() - .5), r = s.R(), n = hard ? (r < .35 ? 3 : r < .85 ? 2 : 1) : (r < .55 ? 2 : 1);
      const V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }, spd = (hard ? 500 : 430) * sp, gapT = hard ? .34 : .42; // P13 owner: "arrows come at the same time": arrivals are now spaced for a human turn of the shield
      const now0 = b.actT + 330 / spd, start = Math.max(now0, (B.lastArrive ?? -9) + gapT) - now0; // P13 fairness: never two spears at the same moment
      for (let k = 0; k < n; k++) {
        const d = dirs[k], dist = 330 + (start + k * gapT) * spd, rev = (n === 1 || hard) && k === n - 1 && s.R() < (hard ? .38 : st >= 2 ? .22 : .12); // a flipping spear only ever comes last
        B.lastArrive = b.actT + dist / spd;
        b.bullets.push({ x: 640 + V[d][0] * dist, y: 411 + V[d][1] * dist, vx: -V[d][0] * spd, vy: -V[d][1] * spd, r: 8, age: 0, tele: 0, spear: true, from: d, rev, outside: true });
      }
      B.spawn = (hard ? .3 : .4) * (1 + (n - 1) * .8) * [0, 1, .94, .88][st] / sp;
    }
  } else if (b.act === 'swipes') { // Asgore: full-height sweeps (blue: stand still, orange: keep moving) and falling fire
    B.spawn -= dt; B.fire -= dt;
    if (B.spawn <= 0 && live) { const fromLeft = s.R() < .5; b.beams.push({ kind: 'swipe', x: fromLeft ? BOX.minX - 30 : BOX.maxX + 30, vx: (fromLeft ? 1 : -1) * (hard ? 720 : 620) * sp, col: s.R() < .5 ? 'blue' : 'orange' }); if (s.R() < (hard ? .55 : .3)) { const L = b.beams[b.beams.length - 1]; b.beams.push({ ...L, x: L.x - Math.sign(L.vx) * 130, col: L.col === 'blue' ? 'orange' : 'blue' }); } B.spawn = (hard ? .38 : .52) / sp; }
    if (B.fire <= 0 && live) { let x = BOX.minX + 20 + s.R() * (BOX.maxX - BOX.minX - 40);
      // P13 fairness: no fire right over you while a blue sweep (stand still) is about to pass you
      if (Math.abs(x - so.x) < 80 && b.beams.some((z) => z.kind === 'swipe' && z.col === 'blue' && (so.x - z.x) * Math.sign(z.vx) > -30 && (so.x - z.x) * Math.sign(z.vx) < Math.abs(z.vx) * .9)) x = so.x + (x < so.x ? -1 : 1) * (90 + s.R() * 120); x = clamp(x, BOX.minX + 20, BOX.maxX - 20); b.bullets.push({ x, y: BOX.minY - 10, vx: (s.R() - .5) * 120, vy: (hard ? 300 : 250) * sp, r: 8, age: 0, tele: .1, fire: true, outside: true }); B.fire = (hard ? .045 : .065) / sp; }
  }
  for (let i = b.emitters.length - 1; i >= 0; i--) { // the spiral: arms of bullets turning out of the middle
    const m = b.emitters[i]; m.t += dt; m.fire -= dt; m.a += m.dir * (hard ? 2.4 : 2) * dt;
    while (m.fire <= 0 && m.t < m.len) { m.fire += m.rate; for (let k = 0; k < m.arms; k++) { const a = m.a + k / m.arms * TAU; b.bullets.push({ x: m.x, y: m.y, vx: Math.cos(a) * 210 * sp, vy: Math.sin(a) * 210 * sp, r: 8, age: 0, tele: .12 }); } }
    if (m.t >= m.len) b.emitters.splice(i, 1);
  }
  // ---- damage. Blue things only hurt a moving soul, orange only a still one.
  const hurts = (col) => col === 'blue' ? b.moving : col === 'orange' ? !b.moving : true;
  const hit = () => { if (h.inv <= 0 && hurtHero(s, (hard ? 4.6 : 7) * [0, 1, .85, .55][st], 'box', so.x, so.y)) { b.shake = .25; h.inv = .45; } };
  for (let i = b.beams.length - 1; i >= 0; i--) {
    const z = b.beams[i]; z.t = (z.t || 0) + dt;
    if (z.kind === 'swipe') {
      z.x += z.vx * dt;
      if (Math.abs(so.x - z.x) < 24 && hurts(z.col)) hit();
      if (z.x < BOX.minX - 60 || z.x > BOX.maxX + 60) b.beams.splice(i, 1);
      continue;
    }
    if (z.kind === 'bone') {
      z.x += z.vx * dt;
      if (Math.abs(so.x - z.x) < 13 && so.y + 6 > z.y1 && so.y - 6 < z.y2 && hurts(z.col)) hit();
      if (z.x < BOX.minX - 40 || z.x > BOX.maxX + 40) b.beams.splice(i, 1);
    } else if (z.kind === 'sweep') { // a wall of light crosses the box; only its gap is safe
      if (z.t < 0) continue;
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
    if (p.missile) { // turns toward the soul at a limited rate, so a late sidestep beats it
      const want = Math.atan2(so.y - p.y, so.x - p.x), cur = Math.atan2(p.vy, p.vx); let d = want - cur; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      const na = cur + clamp(d, -p.turn * dt, p.turn * dt); p.vx = Math.cos(na) * p.speed; p.vy = Math.sin(na) * p.speed;
      if (p.age > p.life) { b.bullets.splice(i, 1); continue; }
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.spear) {
      const dist = Math.hypot(p.x - 640, p.y - 411);
      if (p.rev && !p.flipped && dist < 120) { p.flipped = true; p.x = 640 - (p.x - 640); p.y = 411 - (p.y - 411); p.vx = -p.vx; p.vy = -p.vy; p.from = { up: 'down', down: 'up', left: 'right', right: 'left' }[p.from]; } // it jumps to the far side
      if (dist < 34) { if (so.shield === p.from) ev(s, 'block', { x: p.x, y: p.y }); else hit(); b.bullets.splice(i, 1); }
      continue;
    }
    if (p.bounce) { if (p.x < BOX.minX + p.r || p.x > BOX.maxX - p.r) { p.vx *= -1; p.x = clamp(p.x, BOX.minX + p.r, BOX.maxX - p.r); } if (p.y < BOX.minY + p.r || p.y > BOX.maxY - p.r) { p.vy *= -1; p.y = clamp(p.y, BOX.minY + p.r, BOX.maxY - p.r); } }
    const touch = p.wall ? (p.vertical ? Math.abs(so.x - p.x) < p.r && Math.abs(so.y - p.y) < 16 : Math.abs(so.y - p.y) < p.r && Math.abs(so.x - p.x) < 16) : Math.hypot(so.x - p.x, so.y - p.y) < p.r + 5;
    if (touch && h.inv <= 0 && hurts(p.col)) { hit(); if (!p.bounce) { b.bullets.splice(i, 1); continue; } }
    const pad = p.outside ? 140 : 60;
    if (!p.bounce && (p.x < BOX.minX - pad || p.x > BOX.maxX + pad || p.y < BOX.minY - pad || p.y > BOX.maxY + pad)) b.bullets.splice(i, 1);
  }
  b.shake = Math.max(0, (b.shake || 0) - dt);
  finishBox(s);
}
function finishBox(s) {
  const b = s.box, h = s.hero;
  if (s.phase !== 'box' || b.trans || b.ai < b.acts.length - 1 || b.actT < b.actLen) return;
  Object.assign(BOX, BOX_SHAPES.mix);
  if (b.short) { s.box = null; setPhase(s, 'fight'); s.boss.attackCd = 1.4; ev(s, 'boxEnd'); return; } // a mid-fight trap: straight back to fighting
  s.box = null;
  s.boss.gateIndex++; // floor moves to the next gate before the counter lands
  s.timing = { t: 0, len: 3 * 1.15 / cfg(s).speed, pass: 1.15 / cfg(s).speed, marker: 0, result: null, resT: 0 };
  setPhase(s, 'timing'); ev(s, 'timingStart');
}
function updateTiming(s, dt, inp) {
  const tm = s.timing;
  if (tm.result) { tm.resT += dt; if (tm.resT > .9) { s.timing = null; setPhase(s, 'fight'); s.boss.attackCd = 1.4; } return; }
  // P11 owner: "really hard to catch, make it go back and forth": the marker sweeps across and back three times
  tm.t += dt; const pass = tm.pass || (tm.len / 3), ph = (tm.t / pass) % 2; tm.marker = ph < 1 ? ph : 2 - ph;
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
  r.rise = Math.min(1, r.rise + dt * 2);
  if (r.warn > 0) { r.warn -= dt; return; } // owner: it caught him off guard and he misclicked
  r.t += dt;
  if (r.done) { r.doneT = (r.doneT || 0) + dt; if (r.doneT > .9) { s.rune = null; setPhase(s, 'fight'); } return; }
  for (const k of inp.keysPressed) {
    if (!RUNE_KEYS.includes(k)) continue;
    if (k === r.keys[r.i]) { r.i++; ev(s, 'qteGood'); if (r.i >= r.keys.length) break; } else { r.wrong = r.i; r.done = 'fail'; break; }
  }
  if (!r.done && r.i >= r.keys.length) { r.done = 'win'; b.stagger = 1.2; hurtBoss(s, 14 + s.stage * 6, 'reflect'); ev(s, 'runeWin'); }
  else if (!r.done && r.t >= r.limit) r.done = 'fail';
  if (r.done === 'fail' && !r.failed) { r.failed = true; h.invertIn = 1.6; h.invertLen = 5 + s.stage; h.inv = 0; hurtHero(s, 10, 'rune'); ev(s, 'runeFail'); } // inversion starts after a clear countdown
}
export const STAR_PATH = [0, 2, 4, 0, 1, 3, 5, 1]; // up-triangle, then a dash to the down-triangle
export const MAGEN = { shots: [.14, .5], n: 8, fly: .32, charge: .56, dash: [.66, .74] }; // MAGEN DAVID timeline
export const CAGE = { fly: [.08, .4], lock: .4, squeeze: [.47, .54, .61], shatter: .7 };         // STAR CAGE timeline
// SUKKAH timeline (fractions of the cine) and the hut's shape, built round the boss: back poles higher up the floor
export const SUKKAH = { len: 6.6, poles: [.06, .36], beams: [.36, .41], walls: [.41, .54], roof: [.54, .68], deco: [.68, .72], leap: .72, branches: 9, bombs: [.75, .88], n: 5, fall: .38, big: .93 };
export const sukkahGeom = (b) => { const x = b.x, gy = b.y + 44, top = b.y - 372, fw = 300, bw = 252, back = -40;
  return { x, gy, top, fw, bw, back, poles: [[x - bw, gy + back], [x - fw, gy], [x + fw, gy], [x + bw, gy + back]], poleH: (i) => (i === 0 || i === 3) ? gy + back - (top - 22) : gy - top }; };
// the two laser finishers' timelines (fractions of the cine; 2 = that step is not in this one)
export const DLASER = { 4: { tp: .3, fire: .34, link: 2, spin: 2, boom: .8 }, 5: { tp: .3, fire: 2, link: .36, spin: .46, boom: .82 } };
export const dlPoint = (c, i) => { const a = -Math.PI / 2 + i * Math.PI / 3 + c.rot; return [c.cx + Math.cos(a) * c.R, c.cy + Math.sin(a) * c.R * .82]; };
export const starPoint = (c, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [c.cx + Math.cos(a) * c.R, c.cy + Math.sin(a) * c.R * .82]; };
function updateFinisher(s, dt) {
  const c = s.finisher.cine, h = s.hero, b = s.boss; c.t += dt;
  const k = c.t / c.len, TR = .52; // the trace takes the first 52%
  if (c.v >= 4) { // owner, Oct 2: he blinks to each of the six points, then ("make them two different finishers")
    // 4 DAVID LASER: all six of him fire into her at once, the beams make the sign, then it blows.
    // 5 SPINNING STAR: each point fires at the points across to draw the star, it spins up very fast, then blows.
    const L = DLASER[c.v], u = (a, b) => clamp((k - a) / (b - a), 0, 1);
    if (k < L.tp) { const i = Math.min(5, Math.floor(k / L.tp * 6)); if (i >= c.hits) { c.hits = i + 1; const [x, y] = dlPoint(c, i); ev(s, 'dlBlink', { x, y, i }); } }
    if (k >= L.fire && !c.fired) { c.fired = true; ev(s, 'dlFire', { x: c.cx, y: c.cy }); s.hitstop = .06; }
    if (k >= L.link && !c.linked) { c.linked = true; ev(s, 'dlLink', { x: c.cx, y: c.cy }); s.hitstop = .08; }
    if (k >= L.spin && !c.spun) { c.spun = true; ev(s, 'dlSpin', { x: c.cx, y: c.cy }); }
    if (k >= L.spin && k < L.boom) { const sp = u(L.spin, L.boom); c.w = lerp(.8, 38, sp * sp); c.rot += c.w * dt; c.R = c.R0 * (1 - .22 * sp); }
    if (k >= L.boom && !c.boomed) { c.boomed = true; c.w = 0; ev(s, 'dlBoom', { x: c.cx, y: c.cy }); s.hitstop = .18; }
    if (k < L.boom) { const [x, y] = dlPoint(c, Math.min(5, Math.max(0, c.hits - 1))); h.x = x; h.y = y + 60; } // he is the sixth point
    else { h.x = lerp(h.x, b.x - 300, .1); h.y = lerp(h.y, b.y + 40, .1); }
    if (c.t >= c.len) { s.finisher.cine = null; setPhase(s, 'fight'); h.inv = .6; hurtBoss(s, c.dmg, 'finisher', b.x, b.y - 90); ev(s, 'finisherHit', { dmg: c.dmg }); s.hitstop = .2; b.stagger = 1.6; }
    return;
  }
  if (c.v === 1) { // MAGEN DAVID (the Shield of David): he raises a giant star shield, she fires into it, it soaks up every
    // shot and charges, then he rams it into her.
    const M = MAGEN, sx = h.x + 115, sy = h.y - 105;
    if (k < M.dash[0]) { h.x = lerp(h.x, b.x - (k > M.charge ? 430 : 400), .12); h.y = lerp(h.y, b.y + 40, .12); } // braces back as it charges
    else if (k < M.dash[1]) { const f = (k - M.dash[0]) / (M.dash[1] - M.dash[0]); h.x = lerp(b.x - 420, b.x - 190, f * f); }
    else { h.x = lerp(h.x, b.x - 330, .06); }
    if (k >= .03 && !c.raised) { c.raised = true; ev(s, 'mdRaise', { x: sx, y: sy }); }
    for (let i = 0; i < M.n; i++) { const at = M.shots[0] + i * (M.shots[1] - M.shots[0]) / M.n; if (k >= at && !c.orbs[i]) { c.orbs[i] = { t: 0, y0: b.y - 150 + ((i * 47) % 90 - 45) }; ev(s, 'mdShot', { x: b.x - 60, y: b.y - 150 }); } }
    for (const o of c.orbs) if (o) { o.t += dt; if (!o.hit && o.t >= M.fly) { o.hit = true; c.absorbed++; ev(s, 'mdAbsorb', { x: sx, y: sy, n: c.absorbed }); } }
    if (k >= M.charge && !c.charged) { c.charged = true; ev(s, 'mdCharge', { x: sx, y: sy }); }
    if (k >= M.dash[1] && !c.slammed) { c.slammed = true; ev(s, 'mdSlam', { x: b.x - 80, y: b.y - 120 }); s.hitstop = .16; }
    if (c.t >= c.len) { s.finisher.cine = null; setPhase(s, 'fight'); h.inv = .6; hurtBoss(s, c.dmg, 'finisher', b.x, b.y - 90); ev(s, 'finisherHit', { dmg: c.dmg }); s.hitstop = .2; b.stagger = 1.6; }
    return;
  }
  if (c.v === 2) { // STAR CAGE: the two triangles of the star fly in from both sides, lock round her as a cage, crush in three
    // squeezes, then the whole star shatters.
    const C = CAGE; h.x = lerp(h.x, b.x - 430, .1); h.y = lerp(h.y, b.y + 40, .1);
    if (k >= C.lock && !c.locked) { c.locked = true; ev(s, 'scLock', { x: b.x, y: b.y - 120 }); s.hitstop = .1; }
    for (let i = 0; i < 3; i++) if (k >= C.squeeze[i] && c.squeeze <= i) { c.squeeze = i + 1; ev(s, 'scSqueeze', { x: b.x, y: b.y - 120, n: i + 1 }); s.hitstop = .05; }
    if (k >= C.shatter && !c.shattered) { c.shattered = true; ev(s, 'scShatter', { x: b.x, y: b.y - 120 }); s.hitstop = .16; }
    if (c.t >= c.len) { s.finisher.cine = null; setPhase(s, 'fight'); h.inv = .6; hurtBoss(s, c.dmg, 'finisher', b.x, b.y - 90); ev(s, 'finisherHit', { dmg: c.dmg }); s.hitstop = .2; b.stagger = 1.6; }
    return;
  }
  if (c.v === 3) { // SUKKAH (P13 owner: "build the hut AROUND the boss, with a building animation, then the bombing"):
    // he hammers in four poles round her, the beams go on, the walls unroll, he throws branches up for the roof and
    // hangs the fruit; then he leaps clear, Star of David bombs fall out of the sky onto the hut, then one giant one.
    const S = SUKKAH, G = sukkahGeom(b), u = (a2, b2) => clamp((k - a2) / (b2 - a2), 0, 1);
    const pw = (S.poles[1] - S.poles[0]) / 4, pi = Math.min(3, Math.floor((k - S.poles[0]) / pw));
    if (k < S.poles[0]) { h.x = lerp(h.x, G.poles[0][0] - 46, .15); h.y = lerp(h.y, G.poles[0][1], .15); }
    else if (k < S.poles[1]) {
      const [px, py] = G.poles[pi], f = (k - S.poles[0]) / pw - pi;
      const sx = px + (pi >= 2 ? 46 : -46); // he stands on the outside of each pole
      if (c.slot !== pi) { c.slot = pi; c.from = [h.x, h.y]; }
      if (f < .2) { const e2 = easeOut(f / .2); h.x = lerp(c.from[0], sx, e2); h.y = lerp(c.from[1], py, e2) - Math.sin(e2 * Math.PI) * 70; } // a leap to the next pole
      else { h.x = sx; h.y = py; }
      const hits = f < .35 ? 0 : f < .6 ? 1 : f < .85 ? 2 : 3;
      for (let j = 0; j < pi; j++) c.pole[j] = 1;
      if (hits / 3 > c.pole[pi]) { c.pole[pi] = hits / 3; ev(s, 'sukkahHammer', { x: px, y: py - G.poleH(pi) * c.pole[pi], n: hits }); }
    } else {
      c.pole = [1, 1, 1, 1];
      if (k < S.leap) { h.x = lerp(h.x, G.x - G.fw - 110, .12); h.y = lerp(h.y, G.gy + 10, .12); }
      else { h.x = lerp(h.x, clamp(G.x - G.fw - 260, FLOOR.minX + 40, FLOOR.maxX), .1); h.y = lerp(h.y, G.gy + 30, .1); }
    }
    if (k >= S.walls[0] && !c.walled) { c.walled = true; ev(s, 'sukkahWalls', { x: G.x, y: G.gy }); }
    const nb = Math.floor(u(S.roof[0], S.roof[1]) * S.branches); if (nb > c.branches) { c.branches = nb; ev(s, 'sukkahBranch', { x: h.x, y: h.y - 80 }); }
    if (k >= S.deco[1] && !c.built) { c.built = true; ev(s, 'sukkahBuilt', { x: G.x, y: G.gy }); }
    for (let i = 0; i < S.n; i++) {
      const at = S.bombs[0] + i * (S.bombs[1] - S.bombs[0]) / S.n;
      if (k >= at && !c.bombs[i]) { const x = G.x + ((i * 37) % 5 - 2) * G.fw * .32; c.bombs[i] = { t: 0, x, ty: b.y - 90 - (i * 29 % 50) }; ev(s, 'starLaunch', { x, y: -200 }); }
    }
    for (const bm of c.bombs) if (bm) { bm.t += dt; if (!bm.hit && bm.t >= S.fall) { bm.hit = true; ev(s, 'starBomb', { x: bm.x, y: bm.ty }); s.hitstop = Math.max(s.hitstop, .06); } }
    if (k >= S.big && !c.done2) { c.done2 = true; ev(s, 'starBombBig', { x: b.x, y: b.y - 40 }); ev(s, 'sukkahBlown', { x: G.x, y: G.gy }); s.hitstop = .16; }
    if (c.t >= c.len) { s.finisher.cine = null; setPhase(s, 'fight'); h.inv = .6; hurtBoss(s, c.dmg, 'finisher', b.x, b.y - 90); ev(s, 'finisherHit', { dmg: c.dmg }); s.hitstop = .2; b.stagger = 1.6; }
    return;
  }
  if (k < TR) {
    const u = k / TR, segs = STAR_PATH.length - 1, f = u * segs, si = Math.min(segs - 1, Math.floor(f)), sf = f - si;
    const [x0, y0] = starPoint(c, STAR_PATH[si]), [x1, y1] = starPoint(c, STAR_PATH[si + 1]);
    if (c.v === 1) { const vi = Math.min(segs, Math.round(f)); [h.x, h.y] = starPoint(c, STAR_PATH[vi]); h.y += 60; } // SIX POINTS: blinks point to point
    else { h.x = lerp(x0, x1, easeOut(sf)); h.y = lerp(y0, y1, easeOut(sf)) + 60; }
    c.trace = u;
    const lt = h.trail[h.trail.length - 1]; if (!lt || Math.hypot(lt.x - h.x, lt.y - h.y) > 40) h.trail.push({ x: h.x, y: h.y, life: .35, face: x1 >= x0 ? 1 : -1 });
    const vertex = Math.floor(f); if (vertex > c.hits) { c.hits = vertex; ev(s, 'finisherSlash', { n: vertex / segs, x: x0, y: y0, star: true }); }
  } else {
    c.trace = 1; h.x = lerp(h.x, b.x - 260, .12); h.y = lerp(h.y, b.y + 40, .12);
    if (!c.done1) { c.done1 = true; ev(s, 'finisherStar', { x: b.x, y: b.y, v: c.v }); s.hitstop = .1; }
    if (k >= .7 && !c.done2) { c.done2 = true; ev(s, 'finisherBeam', { x: b.x, y: b.y }); }
  }
  if (c.t >= c.len) { s.finisher.cine = null; setPhase(s, 'fight'); h.inv = .6; hurtBoss(s, c.dmg, 'finisher', b.x, b.y - 90); ev(s, 'finisherHit', { dmg: c.dmg }); s.hitstop = .2; b.stagger = 1.6; }
}

// ---------------------------------------------------------------------------------------------- laser clashes (mash to win)
// kind 1: between phases (both transform after it); 2: final domain clash; 3: TOTALITY clash (hardest).
export const CLASH_KEYS = ['Q', 'E', 'R', 'F'];
export const CLASH = { 1: { step: .036, push: .1, ramp: .03, floor: .15 }, 2: { step: .03, push: .12, ramp: .04, floor: .15 }, 3: { step: .024, push: .15, ramp: .05, floor: .1 } };
function beginClash(s, kind) {
  s.shots = []; s.hazards = []; s.heroShots = []; s.finisher.prompt = 0;
  s.clash = { kind, t: 0, p: .5, pressT: [], heldPush: 0, won: false, wonT: 0, seam: 0, power: 0, pl: 0, line: null, struggle: null, km: 0, seq: null, rampT: 0, lost: null, retries: 0 };
  s.hero.x = 330; s.hero.y = 560; s.boss.x = 960; s.boss.y = 455;
  setPhase(s, 'clash'); ev(s, 'clashStart', { kind });
}
function loseClash(s) {
  const c = s.clash, h = s.hero; c.p = 0; c.seq = null; c.lost = { t: 0 };
  const dmg = Math.round(14 * s.M.dmg); h.hp = Math.max(1, h.hp - dmg); // never lethal: the clash is always retryable
  s.hitstop = .2; ev(s, 'clashLost', { dmg });
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
  if (c.lost) { c.lost.t += dt; if (c.lost.t >= 1.8) { c.lost = null; c.p = .5; c.rampT = 0; c.km = 0; c.seq = null; c.retries++; ev(s, 'clashRetry'); } return; }
  if (c.t < 1.3) { c.power = c.t / 1.3; return; } // beams build up first
  // her push, in "taps per second you need to match her": rises as you near her and slowly while you mash (capped)
  const N = s.M.need, push = k.step * (N[0] + N[1] * (c.p - .5) + (c.kind - 1) * .5 + Math.min(c.rampT * .1, N[2]) - Math.max(0, c.rampT - 30) * .05); // after 30 s she tires, so no endless stalemate
  // pushing dialogue: one line at the start, then one at each escalation mark
  const PL = SCRIPT.push?.[c.kind] || [], TH = [0, .62, .76, .9];
  while (c.pl < PL.length && c.pl < TH.length && (c.pl === 0 || c.p >= TH[c.pl])) say(s, PL[c.pl++]);
  // announced key moments (normal 3, hard 4): GET READY, then the keys in order; a wrong key stuns
  const KM = s.M.keyMoments >= 4 ? [.56, .67, .78, .89] : [.58, .72, .86];
  if (!c.seq && c.km < KM.length && c.p >= KM[c.km]) {
    c.km++; const keys = []; while (keys.length < s.M.keyCount) { const kk = CLASH_KEYS[Math.floor(s.R() * 4)]; if (kk !== keys[keys.length - 1]) keys.push(kk); }
    c.seq = { warn: s.M.key === 'hard' ? 1.1 : 1.4, keys, i: 0, t: 0, limit: [0, 3.2, 2.9, 2.6][c.kind] * s.M.keyTime * (keys.length / 4), stun: 0 }; ev(s, 'clashSeq');
  }
  if (c.seq) {
    const q = c.seq; c.p -= push * .45 * dt; // she keeps pushing, a little slower
    if (c.p <= 0) return loseClash(s);
    if (q.warn > 0) { q.warn -= dt; return; } // presses during the warning are simply ignored
    q.t += dt;
    if (q.stun > 0) q.stun -= dt;
    else for (const key of inp.keysPressed) {
      if (!CLASH_KEYS.includes(key)) continue;
      if (key === q.keys[q.i]) { q.i++; ev(s, 'qteGood'); if (q.i >= q.keys.length) { c.p += .1; c.seq = null; s.hitstop = .08; ev(s, 'clashSeqWin'); break; } }
      else { q.stun = s.M.stun; c.p -= .08; ev(s, 'clashSeqFail'); break; }
    }
    if (c.seq && q.t >= q.limit) { c.p -= .1; c.seq = null; ev(s, 'clashSeqFail', { timeout: true }); }
    if (c.p <= 0) return loseClash(s);
    return;
  }
  const now = c.t;
  let presses = (inp.attack0 ? 1 : 0) + (inp.confirm ? 1 : 0) + inp.taps;
  c.pressT = c.pressT.filter((t) => now - t < 1);
  for (let i = 0; i < presses; i++) if (c.pressT.length < 15) { c.pressT.push(now); c.p += k.step; ev(s, 'clashPress', { p: c.p }); } // capped 15/s
  if (inp.attack && presses === 0) { c.heldPush += dt; if (c.heldPush >= .2) { c.heldPush = 0; c.p += k.step; ev(s, 'clashPress', { p: c.p, held: true }); } } // hold-to-push ~5/s
  c.rampT += dt; c.p -= push * dt;
  if (c.p <= 0) return loseClash(s); // overpowered: she wins this push, you take a hit and the clash restarts
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
  // P13 owner: "healing during anything": H works in the clash, the counter bar, the chains, the rune lock and the
  // finisher keys too (the fight and the box have their own heal with its effect at the soul)
  if (inp.heal && h.heals > 0 && h.hp < HERO_MAX && ['clash', 'timing', 'chained', 'rune', 'finisherQte'].includes(s.phase)) { h.heals--; s.stats.heals++; h.hp = Math.min(HERO_MAX, h.hp + HEAL); ev(s, 'heal', { x: h.x, y: h.y }); }
  if (s.phase === 'clash') { updateClash(s, sdt, inp); return s; }
  if (s.phase === 'cine') { updateCine(s, sdt, inp); return s; }
  if (h.invertIn > 0) { h.invertIn -= sdt; if (h.invertIn <= 0) { h.invertIn = 0; h.invert = h.invertLen; banner(s, 'CONTROLS INVERTED', `${Math.ceil(h.invert)} SECONDS`, '#ff8a6b'); ev(s, 'invertOn'); } }
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
  if (b.dodgeT > 0) { b.dodgeT -= sdt; b.y += b.dodgeDir * 330 * sdt; b.y = clamp(b.y, 340, 580); }
  const homeX = 970 + Math.sin(b.sway * .6) * 110, homeY = 445 + Math.sin(b.sway * .7) * 55; // P10: she rides up and down the taller field
  b.x = lerp(b.x, homeX, 1 - Math.exp(-sdt * 2)); if (b.dodgeT <= 0) b.y = lerp(b.y, homeY, 1 - Math.exp(-sdt * 2));
  b.hands.forEach((hand, i) => { if (hand.busy) return; hand.x = lerp(hand.x, b.x + (i ? 160 : -160), 1 - Math.exp(-sdt * 5)); hand.y = lerp(hand.y, b.y - 30 + Math.sin(b.sway * 2 + i * 2) * 14, 1 - Math.exp(-sdt * 5)); });
  for (const k in b.cds) b.cds[k] -= sdt;
  if (b.queue.length) { for (const q of b.queue) { q.t -= sdt; if (q.t <= 0) { spawnAttack(s, q.kind); ev(s, 'tell', { kind: q.kind }); } } b.queue = b.queue.filter((q) => q.t > 0); }
  if (b.stagger <= 0) { b.attackCd -= sdt; if (b.attackCd <= 0) startAttacks(s, chooseAttack(s)); }
  if (s.M.pressure) { // Hard: she never stops: a small aimed spray from a hand on top of everything else
    b.pressT = (b.pressT ?? 1.5) - sdt;
    if (b.pressT <= 0) { b.pressT = s.M.pressure[s.stage] * (.8 + s.R() * .4); const hd = b.hands[Math.floor(s.R() * 2)], base = Math.atan2(h.y - 40 - hd.y, h.x - hd.x);
      const pn = s.M.pressN || 3; for (let i = -(pn - 1) / 2; i <= (pn - 1) / 2; i++) s.shots.push({ kind: 'orb', x: hd.x, y: hd.y, a: base + i * .18, speed: 360 * cfg(s).speed, r: 10, dmg: 6, tele: .4, age: 0 }); ev(s, 'pressure', { x: hd.x, y: hd.y }); }
  }
  updateHeroShots(s, sdt); updateHazards(s, sdt);
  if (s.phase !== 'fight') return s;
  if (s.pendingClash) { const k = s.pendingClash; s.pendingClash = 0; s.pendingGate = false; s.shots = []; s.hazards = []; if (k === 2) startTalk(s, 'domain', (s2) => beginClash(s2, 2)); else beginClash(s, k); } // owner: he DOES want the stop-and-read dialogue
  else if (s.pendingGate) { s.pendingGate = false; beginBox(s); }
  return s;
}
