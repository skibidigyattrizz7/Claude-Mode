// Deterministic fictional player database. DOM-free.
import { Rng, clamp, hashStr } from './rng.js';
import { NATIONS, NATION_BY_CODE, NAME_REGIONS, LEAGUES, CLUBS, LEAGUE_BY_ID, POS_GROUP } from './data.js';
import { buildRealPlayers } from './realplayers.js';

export const DB_SEED = 'pitchside-db-v1';
export const FACE = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
export const GKFACE = ['div', 'han', 'kic', 'ref', 'spd', 'pos'];

// Position weights over [pac, sho, pas, dri, def, phy] (GK uses GK face stats).
export const POS_WEIGHTS = {
  ST: [0.18, 0.42, 0.06, 0.18, 0, 0.16],
  CF: [0.14, 0.34, 0.16, 0.28, 0, 0.08],
  LW: [0.25, 0.2, 0.15, 0.35, 0, 0.05],
  RW: [0.25, 0.2, 0.15, 0.35, 0, 0.05],
  LM: [0.22, 0.12, 0.28, 0.3, 0.03, 0.05],
  RM: [0.22, 0.12, 0.28, 0.3, 0.03, 0.05],
  CAM: [0.1, 0.2, 0.33, 0.33, 0, 0.04],
  CM: [0.06, 0.1, 0.4, 0.24, 0.12, 0.08],
  CDM: [0.05, 0.02, 0.25, 0.1, 0.4, 0.18],
  LB: [0.25, 0, 0.15, 0.12, 0.35, 0.13],
  RB: [0.25, 0, 0.15, 0.12, 0.35, 0.13],
  LWB: [0.27, 0, 0.18, 0.15, 0.28, 0.12],
  RWB: [0.27, 0, 0.18, 0.15, 0.28, 0.12],
  CB: [0.08, 0, 0.07, 0.02, 0.6, 0.23],
  GK: [0.21, 0.21, 0.06, 0.24, 0.06, 0.22],
};
const PROFILE = {
  ST: [2, 5, -10, 0, -45, 0], CF: [0, 2, -2, 4, -45, -8],
  LW: [8, -3, -5, 5, -45, -12], RW: [8, -3, -5, 5, -45, -12],
  LM: [5, -8, 0, 3, -30, -10], RM: [5, -8, 0, 3, -30, -10],
  CAM: [-2, 0, 4, 4, -40, -12], CM: [-8, -6, 4, 1, -8, -3], CDM: [-12, -18, -1, -6, 3, 3],
  LB: [5, -30, -6, -6, 0, -4], RB: [5, -30, -6, -6, 0, -4], LWB: [6, -28, -4, -3, -3, -6], RWB: [6, -28, -4, -3, -3, -6],
  CB: [-12, -40, -18, -22, 2, 3],
};
const ALT = {
  GK: [], CB: ['CDM'], LB: ['LWB', 'LM'], RB: ['RWB', 'RM'], LWB: ['LB', 'LM'], RWB: ['RB', 'RM'],
  CDM: ['CM', 'CB'], CM: ['CDM', 'CAM'], CAM: ['CM', 'CF'], LM: ['LW', 'LB'], RM: ['RW', 'RB'],
  LW: ['LM', 'ST'], RW: ['RM', 'ST'], ST: ['CF'], CF: ['ST', 'CAM'],
};

export function computeOvr(pos, p) {
  const w = POS_WEIGHTS[pos] || POS_WEIGHTS.CM;
  const keys = pos === 'GK' ? GKFACE : FACE;
  const src = pos === 'GK' ? p.gk : p.stats;
  let s = 0;
  for (let i = 0; i < 6; i++) s += w[i] * src[keys[i]];
  return clamp(Math.round(s), 1, 99);
}

export function tierOf(ovr) { return ovr >= 75 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze'; }

// ---------- names ----------
function genName(rng, region) {
  const R = NAME_REGIONS[region] || NAME_REGIONS.en;
  const first = rng.pick(R.first);
  let last;
  if (R.surnames) last = rng.pick(R.surnames);
  else {
    let root = rng.pick(R.roots), suf = rng.pick(R.suf);
    last = root + suf;
    if (rng.chance(0.06)) last = rng.pick(R.roots) + rng.pick(R.roots).toLowerCase() + suf; // occasional longer surname
    if (R.pre) last = rng.pick(R.pre) + last;
  }
  return { first, last };
}

export function displayName(first, last) {
  return `${first[0]}. ${last}`;
}
export function cardName(p) {
  const l = p.last;
  return l.length > 14 ? l.split(' ').pop() : l;
}

// ---------- economics ----------
export function marketValue(p) {
  let v = Math.pow(10, (p.ovr - 45) / 11) * 10000;
  if (p.age <= 21) v *= 1.3 + Math.max(0, (p.pot - p.ovr)) * 0.04;
  else if (p.age <= 25) v *= 1.1 + Math.max(0, (p.pot - p.ovr)) * 0.02;
  else if (p.age >= 33) v *= 0.35;
  else if (p.age >= 30) v *= 0.65;
  return niceRound(v);
}
export function niceRound(v) {
  if (v < 1000) return Math.max(10, Math.round(v / 10) * 10);
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}
export function weeklyWage(p) { return niceRound(Math.max(500, marketValue(p) * 0.0022 + p.ovr * 40)); }

/** Ultimate Team coin price for a card */
export function utPrice(p) {
  let v;
  if (p.ovr < 65) v = 150 + (p.ovr - 45) * 25;
  else if (p.ovr < 75) v = 400 + (p.ovr - 65) * 60;
  else v = 800 * Math.pow(1.33, p.ovr - 75);
  if (p.rare) v *= 1.35;
  if (p.special === 'inform') v *= 1.9;
  if (p.special === 'hero') v *= 2.4;
  if (p.special === 'legend') v *= 3.2;
  if (p.special === 'star') v *= 1.6;
  if (p.special === 'icon') v *= 4.5;
  return niceRound(v);
}
export function quickSellValue(p) {
  const base = p.ovr < 65 ? 40 + (p.ovr - 45) * 3 : p.ovr < 75 ? 150 + (p.ovr - 65) * 15 : 400 + Math.max(0, p.ovr - 75) * 90;
  const spec = p.special ? 2.5 : 1;
  return Math.round((base * (p.rare ? 1.3 : 1) * spec) / 10) * 10;
}

// ---------- generation ----------
function makeStats(rng, pos, target) {
  const p = { stats: {}, gk: {} };
  if (pos === 'GK') {
    const offs = { div: 1, han: -1, kic: -12, ref: 2, spd: -22, pos: 0 };
    for (const k of GKFACE) p.gk[k] = target + offs[k] + rng.normal(0, 3.5);
    for (let iter = 0; iter < 3; iter++) {
      const cur = GKFACE.reduce((s, k, i) => s + POS_WEIGHTS.GK[i] * p.gk[k], 0);
      const d = target - cur;
      for (const k of GKFACE) p.gk[k] = clamp(p.gk[k] + d, 20, 99);
    }
    for (const k of GKFACE) p.gk[k] = Math.round(p.gk[k]);
    p.stats = {
      pac: clamp(Math.round(p.gk.spd + rng.normal(0, 4)), 25, 90),
      sho: clamp(Math.round(22 + rng.normal(0, 5)), 10, 50),
      pas: clamp(Math.round(p.gk.kic - 12 + rng.normal(0, 4)), 20, 80),
      dri: clamp(Math.round(35 + target * 0.15 + rng.normal(0, 5)), 20, 70),
      def: clamp(Math.round(30 + rng.normal(0, 5)), 15, 55),
      phy: clamp(Math.round(55 + target * 0.15 + rng.normal(0, 6)), 40, 90),
    };
    return p;
  }
  const prof = PROFILE[pos];
  // archetype flavour: pacey / technical / physical
  const arche = rng.int(0, 3);
  const flav = [[4, 0, 0, 1, 0, -3], [-3, 0, 2, 3, 0, -2], [-3, 1, -1, -2, 1, 5], [0, 0, 0, 0, 0, 0]][arche];
  FACE.forEach((k, i) => { p.stats[k] = target + prof[i] + flav[i] + rng.normal(0, 3.5); });
  const w = POS_WEIGHTS[pos];
  for (let iter = 0; iter < 4; iter++) {
    const cur = FACE.reduce((s, k, i) => s + w[i] * p.stats[k], 0);
    const d = target - cur;
    for (const k of FACE) p.stats[k] = clamp(p.stats[k] + d, 18, 99);
  }
  for (const k of FACE) p.stats[k] = Math.round(p.stats[k]);
  for (const k of GKFACE) p.gk[k] = clamp(Math.round(10 + rng.normal(0, 3)), 5, 20);
  p.gk.spd = p.stats.pac;
  return p;
}

function heightFor(rng, pos) {
  const base = pos === 'GK' ? 190 : pos === 'CB' ? 188 : pos === 'ST' ? 184 : ['LW', 'RW', 'CAM', 'LM', 'RM'].includes(pos) ? 176 : 180;
  return Math.round(clamp(rng.normal(base, 5), 162, 203));
}

const WR = ['Low', 'Med', 'High'];

export function genPlayer(rng, { id, nat, pos, target, age, club, league }) {
  const nation = NATION_BY_CODE[nat];
  const { first, last } = genName(rng, nation.region);
  if (age === undefined) age = clamp(Math.round(rng.normal(26, 4.2)), 17, 37);
  const st = makeStats(rng, pos, target);
  const p = {
    id, first, last, name: displayName(first, last), age, nat, club, league, pos,
    alt: [], stats: st.stats, gk: st.gk,
  };
  if (pos !== 'GK') {
    const alts = ALT[pos].slice();
    const n = rng.chance(0.45) ? 0 : rng.chance(0.7) ? 1 : 2;
    p.alt = rng.shuffle(alts).slice(0, n);
  }
  p.ovr = computeOvr(pos, p);
  const growth = age <= 20 ? rng.int(6, 20) : age <= 23 ? rng.int(3, 12) : age <= 26 ? rng.int(0, 5) : age <= 29 ? rng.int(0, 2) : 0;
  p.pot = clamp(p.ovr + growth, p.ovr, 95);
  p.wf = rng.weighted([[1, 3], [2, 22], [3, 50], [4, 20], [5, 5]]);
  const attacking = ['LW', 'RW', 'CAM', 'CF', 'ST', 'LM', 'RM'].includes(pos);
  p.sm = pos === 'GK' ? 1 : attacking ? rng.weighted([[2, 20], [3, 45], [4, 28], [5, 7]]) : rng.weighted([[2, 55], [3, 38], [4, 7]]);
  p.foot = ['LB', 'LWB', 'LM', 'LW'].includes(pos) ? (rng.chance(0.6) ? 'L' : 'R') : (rng.chance(0.2) ? 'L' : 'R');
  const atk = attacking ? rng.weighted([[1, 3], [2, 2]]) : pos === 'CB' ? rng.weighted([[0, 3], [1, 5], [2, 1]]) : rng.int(0, 2);
  const def = ['CB', 'CDM', 'LB', 'RB'].includes(pos) ? rng.weighted([[1, 3], [2, 3]]) : rng.int(0, 2);
  p.wr = [WR[atk], WR[def]];
  p.height = heightFor(rng, pos);
  p.rare = p.ovr >= 60 ? rng.chance(clamp(0.25 + (p.ovr - 65) * 0.03, 0.15, 0.9)) : rng.chance(0.2);
  p.tier = tierOf(p.ovr);
  p.special = null;
  p.value = marketValue(p);
  p.wage = weeklyWage(p);
  p.look = hashStr(id) % 997;
  return p;
}

/** Shift a player's relevant face stats by delta and recompute overall (used for growth/decline/in-forms). */
export function adjustOvr(p, delta) {
  if (!delta) return p;
  if (p.pos === 'GK') for (const k of GKFACE) p.gk[k] = clamp(p.gk[k] + delta, 10, 99);
  else {
    const w = POS_WEIGHTS[p.pos];
    FACE.forEach((k, i) => { if (w[i] > 0.04) p.stats[k] = clamp(p.stats[k] + delta, 10, 99); });
  }
  p.ovr = computeOvr(p.pos, p);
  p.tier = tierOf(p.ovr);
  if (p.pot < p.ovr) p.pot = p.ovr;
  p.value = marketValue(p);
  return p;
}

// ---------- database ----------
const SQUAD_TEMPLATE = ['GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'LB', 'RB', 'RB', 'CDM', 'CDM', 'CM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST'];
const FIRST_CHOICE_IDX = new Set([0, 2, 3, 6, 8, 10, 12, 13, 15, 18, 19, 20]); // rough "starter" template slots

let _db = null;

export function getDB() {
  if (_db) return _db;
  const rng = new Rng(DB_SEED);
  const players = [];
  let seq = 1;
  const nid = () => `p${seq++}`;
  const foreignPool = NATIONS.map((n) => [n.code, n.str * n.str]);

  for (const club of CLUBS) {
    const lg = LEAGUE_BY_ID[club.league];
    SQUAD_TEMPLATE.forEach((pos, i) => {
      const starter = FIRST_CHOICE_IDX.has(i);
      const nat = rng.chance(0.58) ? rng.weighted(lg.home) : rng.weighted(foreignPool);
      const age = starter ? clamp(Math.round(rng.normal(26.5, 3.6)), 18, 36) : clamp(Math.round(rng.normal(24, 5)), 17, 36);
      let target = club.target + (starter ? rng.normal(0, 2.6) : rng.normal(-6, 3.5));
      if (age <= 20) target -= rng.int(2, 8);
      target = clamp(Math.round(target), 45, 92);
      players.push(genPlayer(rng, { id: nid(), nat, pos, target, age, club: club.id, league: club.league }));
    });
  }

  // National stars: stronger nations get elite players at top clubs
  const topClubs = CLUBS.filter((c) => c.tier === 1 && c.rep >= 3.5);
  const starPos = ['ST', 'LW', 'RW', 'CAM', 'CM', 'CDM', 'CB', 'CB', 'GK', 'LB', 'RB', 'CM', 'ST'];
  for (const n of NATIONS) {
    const count = [0, 0, 1, 3, 5, 7][n.str];
    for (let i = 0; i < count; i++) {
      const homeTop = topClubs.filter((c) => LEAGUE_BY_ID[c.league].home.some(([code]) => code === n.code));
      const club = homeTop.length && rng.chance(0.55) ? rng.pick(homeTop) : rng.pick(topClubs);
      const target = clamp(Math.round(80 + n.str * 1.4 + rng.normal(0, 2.2) - i * 0.4), 78, 92);
      const pos = starPos[(i + (hashStr(n.code) % 5)) % starPos.length];
      players.push(genPlayer(rng, { id: nid(), nat: n.code, pos, target, age: rng.int(22, 32), club: club.id, league: club.league }));
    }
  }

  // Top-up so every nation can field a sensible XI
  const need = { GK: 3, DEF: 8, MID: 8, ATT: 5 };
  const groupPos = { GK: ['GK'], DEF: ['CB', 'CB', 'LB', 'RB', 'CB'], MID: ['CM', 'CDM', 'CAM', 'LM', 'RM', 'CM'], ATT: ['ST', 'LW', 'RW', 'ST'] };
  for (const n of NATIONS) {
    const mine = players.filter((p) => p.nat === n.code);
    const floor = 62 + n.str * 2;
    for (const g of Object.keys(need)) {
      let have = mine.filter((p) => POS_GROUP[p.pos] === g && p.ovr >= floor).length;
      let k = 0;
      while (have < need[g]) {
        const pos = groupPos[g][k++ % groupPos[g].length];
        const homeClubs = CLUBS.filter((c) => LEAGUE_BY_ID[c.league].home.some(([code]) => code === n.code));
        const club = homeClubs.length && rng.chance(0.5) ? rng.pick(homeClubs) : rng.pick(CLUBS);
        const target = clamp(Math.round(66 + n.str * 2.4 + rng.normal(0, 3)), 60, 86);
        players.push(genPlayer(rng, { id: nid(), nat: n.code, pos, target, club: club.id, league: club.league }));
        have++;
      }
    }
  }

  // Specials -------------------------------------------------------------
  const specials = [];
  // Legends: retired greats (fictional)
  const legendPos = ['ST', 'CAM', 'CM', 'CB', 'GK', 'LW', 'RW', 'CDM', 'CF', 'LB', 'RB', 'ST', 'CAM', 'CB', 'CM'];
  const legendNations = NATIONS.filter((n) => n.str >= 3);
  for (let i = 0; i < 32; i++) {
    const n = legendNations[(i * 7) % legendNations.length];
    const pos = legendPos[i % legendPos.length];
    const p = genPlayer(rng, { id: `lg${i + 1}`, nat: n.code, pos, target: rng.int(86, 94), age: rng.int(36, 48), club: 'LEG', league: 'LEG' });
    p.special = 'legend'; p.rare = true; p.tier = 'gold'; p.pot = p.ovr;
    p.value = marketValue({ ...p, age: 30 }) * 2; p.wage = weeklyWage({ ...p, age: 30 });
    specials.push(p);
  }
  // Heroes: fan-favourite fictional former players tied to a league
  for (let i = 0; i < 24; i++) {
    const lg = LEAGUES[i % LEAGUES.length];
    const nat = rng.weighted(lg.home);
    const pos = legendPos[(i * 3 + 1) % legendPos.length];
    const p = genPlayer(rng, { id: `hr${i + 1}`, nat, pos, target: rng.int(84, 90), age: rng.int(33, 40), club: 'HER', league: lg.id });
    p.special = 'hero'; p.rare = true; p.tier = 'gold'; p.pot = p.ovr;
    specials.push(p);
  }
  // In-Forms: boosted versions of strong existing players
  const informBase = players.filter((p) => p.ovr >= 70).sort((a, b) => hashStr(a.id + 'if') - hashStr(b.id + 'if')).slice(0, 72);
  for (const b of informBase) {
    const p = structuredClone(b);
    p.id = `if_${b.id}`; p.baseId = b.id;
    adjustOvr(p, rng.int(2, 5));
    p.special = 'inform'; p.rare = true; p.tier = tierOf(p.ovr);
    specials.push(p);
  }

  // V2 real players (appended last and generated without the shared RNG, so every id above is unchanged).
  // Stars play for fictional clubs (they are part of `players`, so Career Mode includes them);
  // Icons belong to the special Icons club.
  const real = buildRealPlayers({ POS_WEIGHTS, computeOvr, marketValue, weeklyWage, tierOf });
  for (const p of real.stars) players.push(p);
  for (const p of real.icons) specials.push(p);

  const all = players.concat(specials);
  const byId = new Map(all.map((p) => [p.id, p]));
  _db = { players, specials, all, byId, icons: real.icons, stars: real.stars, real: real.icons.concat(real.stars) };
  for (const c of _foreign.values()) if (!byId.has(c.id)) byId.set(c.id, c);
  return _db;
}

// ---------- foreign cards (bought from other users on the online Player Market) ----------
const _foreign = new Map();
const POS_SET = new Set(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF']);
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : d);
const str = (v, max, d = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);

/** Validate/sanitise a card object received from the network. Returns a safe player object or null. */
export function sanitizeCard(c) {
  if (!c || typeof c !== 'object') return null;
  const id = str(c.id, 64);
  if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id)) return null;
  const pos = POS_SET.has(c.pos) ? c.pos : null;
  if (!pos) return null;
  const s = c.stats || {}, g = c.gk || {};
  const p = {
    id, first: str(c.first, 30), last: str(c.last, 30, str(c.name, 30, 'Player')), name: str(c.name, 40, 'Player'),
    age: num(c.age, 15, 50, 27), nat: str(c.nat, 3, 'ENG').toUpperCase(), club: str(c.club, 12, 'ICN'), league: str(c.league, 12, 'ICN'),
    pos, alt: Array.isArray(c.alt) ? c.alt.filter((x) => POS_SET.has(x)).slice(0, 3) : [],
    stats: {}, gk: {},
  };
  for (const k of FACE) p.stats[k] = num(s[k], 1, 99, 50);
  for (const k of GKFACE) p.gk[k] = num(g[k], 1, 99, 10);
  p.ovr = computeOvr(pos, p);
  p.pot = Math.max(p.ovr, num(c.pot, 1, 99, p.ovr));
  p.wf = num(c.wf, 1, 5, 3); p.sm = num(c.sm, 1, 5, 2); p.foot = c.foot === 'L' ? 'L' : 'R';
  p.wr = Array.isArray(c.wr) && c.wr.length === 2 ? c.wr.map((x) => (['Low', 'Med', 'High'].includes(x) ? x : 'Med')) : ['Med', 'Med'];
  p.height = num(c.height, 150, 210, 180);
  p.rare = !!c.rare;
  p.special = ['inform', 'hero', 'legend', 'icon', 'star'].includes(c.special) ? c.special : null;
  p.tier = p.special ? 'gold' : tierOf(p.ovr);
  if (c.real) p.real = true;
  if (Number.isInteger(c.skin) && c.skin >= 0 && c.skin <= 5) p.skin = c.skin;
  p.value = marketValue(p); p.wage = weeklyWage(p);
  p.look = hashStr(id) % 997;
  p.foreign = true;
  return p;
}

/** Make a foreign card resolvable through getPlayer(). Known ids return the local DB copy. */
export function registerCard(card) {
  const db = getDB();
  if (card && db.byId.has(card.id)) return db.byId.get(card.id);
  const p = sanitizeCard(card);
  if (!p) return null;
  _foreign.set(p.id, p);
  db.byId.set(p.id, p);
  return p;
}

/** Test helper: drop the cached database so the next getDB() regenerates it. */
export function _resetDB() { _db = null; }

/** All real players (Icons + Stars). */
export function realPlayers() { return getDB().real; }

export function getPlayer(id) { return getDB().byId.get(id) || null; }

/** Generate a fresh youth prospect (career academy / regens). */
export function genProspect(rng, { id, nat, club, league, age = null, quality = 0 }) {
  const pos = rng.pick(['GK', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST']);
  const a = age ?? rng.int(16, 18);
  const target = clamp(Math.round(rng.normal(52 + quality * 2, 5)), 42, 68);
  const p = genPlayer(rng, { id, nat, pos, target, age: a, club, league });
  p.pot = clamp(Math.round(p.ovr + rng.range(14, 30) + quality * 1.5), p.ovr + 8, 94);
  p.value = marketValue(p);
  p.wage = weeklyWage(p);
  return p;
}
