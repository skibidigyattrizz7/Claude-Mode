// Builds contract-shaped Team objects, lineups, kits and national teams. DOM-free.
import { FORMATIONS, effectiveOvr, positionFit } from './formations.js';
import { calcChemistry, teamRating } from './chemistry.js';
import { ALL_NATIONS, CLUBS } from './data.js';
import { getDB, genPlayer, personOf } from './players.js';
import { hashStr, Rng, clamp } from './rng.js';
import { matchPhysique, genPhysique, ensureAlts } from './physique.js';
import { sanitizeTactics, aiTactics, autoSetPieceTakers, defaultQuick } from './tactics.js';

// ---------- colour helpers ----------
export function hexToRgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function colorDist(a, b) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}
export function luminance(h) {
  const [r, g, b] = hexToRgb(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
export function contrastColor(bg, a = '#FFFFFF', b = '#111111') {
  return luminance(bg) > 0.58 ? b : a;
}

// ---------- kits ----------
export function clubKits(club) {
  const { primary, secondary } = club.colors;
  const whiteShorts = hashStr(club.id) % 3 === 0;
  const home = {
    primary, secondary,
    number: colorDist(primary, secondary) > 140 ? secondary : contrastColor(primary),
    shorts: whiteShorts && luminance(primary) < 0.8 ? '#FFFFFF' : (luminance(primary) > 0.85 ? secondary : primary),
    socks: primary,
  };
  const light = luminance(primary) > 0.6;
  const awayPrimary = light ? (luminance(secondary) < 0.5 ? secondary : '#1B1F2A') : (luminance(secondary) > 0.75 ? secondary : '#F4F4F4');
  const away = {
    primary: awayPrimary,
    secondary: primary,
    number: contrastColor(awayPrimary),
    shorts: awayPrimary,
    socks: awayPrimary,
  };
  return { home, away };
}

const GK_PALETTE = ['#1A1A1A', '#39D353', '#FF7A00', '#7B2FBE', '#00B8D4', '#F5E216', '#E91E63', '#9E9E9E'];
export function gkKitFor(...kits) {
  let best = GK_PALETTE[0], bestD = -1;
  for (const c of GK_PALETTE) {
    const d = Math.min(...kits.filter(Boolean).flatMap((k) => [colorDist(c, k.primary), colorDist(c, k.shorts)]));
    if (d > bestD) { bestD = d; best = c; }
  }
  const alt = contrastColor(best, '#FFFFFF', '#111111');
  return { primary: best, secondary: alt, number: alt, shorts: best, socks: best };
}

/** If kits clash, switch away team to its alternate kit. Returns new away kit. */
export function resolveKitClash(homeKit, awayKit, awayAlt) {
  if (!awayAlt) return awayKit;
  if (colorDist(homeKit.primary, awayKit.primary) < 160) return awayAlt;
  return awayKit;
}

// ---------- players -> contract shape ----------
const NUM_PREF = { GK: [1], RB: [2], RWB: [2], LB: [3], LWB: [3], CB: [4, 5, 6, 15], CDM: [6, 16, 8], CM: [8, 14, 16, 18], CAM: [10, 20], LM: [11, 17], RM: [7, 17], LW: [11, 17], RW: [7, 19], ST: [9, 10, 19], CF: [9, 10] };

export function assignNumbers(starterPositions, benchCount, preset = []) {
  const used = new Set(preset.filter(Boolean));
  const out = [];
  starterPositions.forEach((pos, i) => {
    if (preset[i]) { out.push(preset[i]); return; }
    let n = (NUM_PREF[pos] || []).find((x) => !used.has(x));
    if (!n) { n = 12; while (used.has(n)) n++; }
    used.add(n); out.push(n);
  });
  for (let i = 0; i < benchCount; i++) {
    const pi = starterPositions.length + i;
    if (preset[pi]) { out.push(preset[pi]); continue; }
    let n = 12; while (used.has(n)) n++;
    used.add(n); out.push(n);
  }
  return out;
}

/** Converts a DB/career player into the contract match-player shape. scale: attribute multiplier (fitness/morale). */
export function toMatchPlayer(p, pos, number, scale = 1) {
  const sc = (v) => Math.max(1, Math.min(99, Math.round(v * scale)));
  const fit = positionFit(p, pos);
  const ovr = Math.round(effectiveOvr(p, pos) * scale);
  return {
    id: p.id, name: p.name, number, pos, ovr: Math.max(1, Math.min(99, fit === 2 ? Math.round(p.ovr * scale) : ovr)),
    ...matchPhysique(p),
    attrs: {
      pac: sc(p.stats.pac), sho: sc(p.stats.sho), pas: sc(p.stats.pas), dri: sc(p.stats.dri), def: sc(p.stats.def), phy: sc(p.stats.phy),
      div: sc(p.gk.div), han: sc(p.gk.han), kic: sc(p.gk.kic), ref: sc(p.gk.ref), spd: sc(p.gk.spd), pos: sc(p.gk.pos),
    },
  };
}

/**
 * Build a contract Team.
 * starters: array[11] of player objects aligned with FORMATIONS[formation].slots
 * bench: array of player objects (0..7)
 * opts.numbers: optional preset numbers (by player id)
 * opts.scale(p): optional per-player attribute scale
 */
export function buildTeam({ id, name, short, kit, gkKit, formation, starters, bench = [], chemistry, numbers = null, scale = null, tactics = null }) {
  const f = FORMATIONS[formation];
  const positions = f.slots.map((s) => s.pos);
  const preset = numbers ? starters.concat(bench).map((p) => (p && numbers[p.id]) || 0) : [];
  // ensure uniqueness of preset numbers
  const seen = new Set();
  for (let i = 0; i < preset.length; i++) { if (preset[i] && seen.has(preset[i])) preset[i] = 0; else if (preset[i]) seen.add(preset[i]); }
  const nums = assignNumbers(positions, bench.length, preset);
  const players = starters.map((p, i) => toMatchPlayer(p, positions[i], nums[i], scale ? scale(p) : 1));
  const benchOut = bench.slice(0, 7).map((p, i) => toMatchPlayer(p, p.pos, nums[11 + i], scale ? scale(p) : 1));
  const chem = chemistry !== undefined ? chemistry : calcChemistry(formation, starters).scaled;
  // V2.2 tactics: user tactics when given, otherwise a deterministic AI style; always sanitised
  const ids = players.concat(benchOut).map((p) => p.id);
  const tac = sanitizeTactics(tactics || aiTactics(id, formation, teamRating(starters)), ids);
  const auto = autoSetPieceTakers(players);
  for (const k of Object.keys(auto)) if (!tac.setPieceTakers[k]) tac.setPieceTakers[k] = auto[k];
  if (!tac.quick.length) tac.quick = defaultQuick();
  return {
    id: String(id), name, short: String(short).slice(0, 3).toUpperCase(),
    kit: { ...kit }, gkKit: { ...gkKit },
    formation, players, bench: benchOut,
    chemistry: Math.max(0, Math.min(100, Math.round(chem))),
    tactics: tac,
  };
}

/** Validate a Team against the contract. Returns [] when valid. */
export function validateTeam(t) {
  const errs = [];
  const colorKeys = ['primary', 'secondary', 'number', 'shorts', 'socks'];
  const attrKeys = ['pac', 'sho', 'pas', 'dri', 'def', 'phy', 'div', 'han', 'kic', 'ref', 'spd', 'pos'];
  if (!t || typeof t !== 'object') return ['not an object'];
  for (const k of ['id', 'name', 'short']) if (typeof t[k] !== 'string' || !t[k]) errs.push(`bad ${k}`);
  for (const k of ['kit', 'gkKit']) {
    if (!t[k]) { errs.push(`missing ${k}`); continue; }
    for (const c of colorKeys) if (!/^#[0-9A-Fa-f]{6}$/.test(t[k][c] || '')) errs.push(`${k}.${c} invalid`);
  }
  if (!FORMATIONS[t.formation]) errs.push('bad formation');
  if (!Array.isArray(t.players) || t.players.length !== 11) errs.push('need exactly 11 players');
  else {
    if (t.players[0].pos !== 'GK') errs.push('index 0 must be GK');
    if (t.players.slice(1).some((p) => p.pos === 'GK')) errs.push('outfield GK');
    const f = FORMATIONS[t.formation];
    if (f) t.players.forEach((p, i) => { if (p.pos !== f.slots[i].pos) errs.push(`slot ${i} pos ${p.pos} != ${f.slots[i].pos}`); });
  }
  if (!Array.isArray(t.bench) || t.bench.length > 7) errs.push('bench must be 0..7');
  const ids = new Set();
  const nums = new Set();
  for (const p of (t.players || []).concat(t.bench || [])) {
    if (!p || typeof p.id !== 'string') { errs.push('player id'); continue; }
    if (ids.has(p.id)) errs.push(`duplicate player ${p.id}`);
    ids.add(p.id);
    if (nums.has(p.number)) errs.push(`duplicate number ${p.number}`);
    nums.add(p.number);
    if (typeof p.name !== 'string' || !p.name) errs.push('player name');
    if (!Number.isInteger(p.number) || p.number < 1 || p.number > 99) errs.push('player number');
    if (!Number.isFinite(p.ovr) || p.ovr < 1 || p.ovr > 99) errs.push('player ovr');
    if (!p.attrs) { errs.push('attrs missing'); continue; }
    for (const a of attrKeys) if (!Number.isFinite(p.attrs[a])) errs.push(`attr ${a} missing on ${p.id}`);
  }
  if (t.chemistry !== undefined && (t.chemistry < 0 || t.chemistry > 100)) errs.push('chemistry range');
  for (const p of (t.players || []).concat(t.bench || [])) {
    if (!p) continue;
    if (p.height !== undefined && !(p.height >= 1.62 && p.height <= 2.02)) errs.push(`height ${p.id}`);
    if (p.weight !== undefined && !(p.weight >= 58 && p.weight <= 100)) errs.push(`weight ${p.id}`);
    if (p.playstyles !== undefined && (!Array.isArray(p.playstyles) || p.playstyles.length > 4)) errs.push(`playstyles ${p.id}`);
  }
  if (t.tactics !== undefined) {
    const tc = t.tactics;
    if (!tc || typeof tc !== 'object') errs.push('tactics');
    else {
      for (const k of ['width', 'depth', 'playersInBox']) if (!(tc[k] >= 1 && tc[k] <= 10)) errs.push(`tactics.${k}`);
      for (const k of ['corners', 'freeKicks']) if (!(tc[k] >= 1 && tc[k] <= 5)) errs.push(`tactics.${k}`);
      if (tc.quick && tc.quick.length > 4) errs.push('tactics.quick');
    }
  }
  return errs;
}

// ---------- lineups ----------
/** Greedy best XI for a formation from a pool of players. Returns { slots, bench } of player objects. */
export function bestLineup(pool, formation, { benchSize = 7, score = null } = {}) {
  const f = FORMATIONS[formation];
  const val = score || ((p, pos) => effectiveOvr(p, pos));
  const avail = pool.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 60);
  const slots = new Array(11).fill(null);
  const used = new Set(); // player ids used
  const usedPersons = new Set(); // base identities used (no two cards of the same player)
  const take = (p) => { used.add(p.id); usedPersons.add(personOf(p)); };
  // GK first
  const gks = avail.filter((p) => p.pos === 'GK');
  const gk = gks[0] || avail.slice().sort((a, b) => val(b, 'GK') - val(a, 'GK'))[0];
  if (gk) { slots[0] = gk; take(gk); }
  for (let n = 1; n < 11; n++) {
    let best = null, bs = -Infinity, bi = -1;
    for (let i = 1; i < 11; i++) {
      if (slots[i]) continue;
      const pos = f.slots[i].pos;
      for (const p of avail) {
        if (used.has(p.id) || usedPersons.has(personOf(p)) || p.pos === 'GK') continue;
        const s = val(p, pos);
        if (s > bs) { bs = s; best = p; bi = i; }
      }
    }
    if (!best) break;
    slots[bi] = best; take(best);
  }
  // bench: 1 GK + best others (never a duplicate of a starter's underlying player)
  const rest = avail.filter((p) => !used.has(p.id) && !usedPersons.has(personOf(p)));
  const bench = [];
  const bgk = rest.find((p) => p.pos === 'GK');
  if (bgk && benchSize > 0) { bench.push(bgk); usedPersons.add(personOf(bgk)); }
  for (const p of rest) {
    if (bench.length >= benchSize) break;
    if (p === bgk || p.pos === 'GK' || usedPersons.has(personOf(p))) continue;
    bench.push(p); usedPersons.add(personOf(p));
  }
  return { slots, bench };
}

/**
 * Chemistry-aware auto builder (Ultimate Team). Tries several "core" preferences and keeps the best
 * score = team rating + chemistry weight.
 */
export function autoBuildSquad(pool, formation, { chemWeight = 0.15 } = {}) {
  const candidates = [];
  const tryBuild = (bonusFn) => {
    const { slots, bench } = bestLineup(pool, formation, { score: (p, pos) => effectiveOvr(p, pos) + bonusFn(p) });
    if (slots.some((s) => !s)) return;
    const chem = calcChemistry(formation, slots);
    const rating = teamRating(slots);
    candidates.push({ slots, bench, rating, chem: chem.scaled, score: rating + chem.scaled * chemWeight });
  };
  tryBuild(() => 0);
  const count = (key) => {
    const m = new Map();
    for (const p of pool) m.set(p[key], (m.get(p[key]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]);
  };
  for (const lg of count('league')) for (const b of [4, 8]) tryBuild((p) => (p.league === lg || p.special === 'legend' || p.special === 'lotg' ? b : 0));
  for (const nat of count('nat')) for (const b of [4, 8]) tryBuild((p) => (p.nat === nat ? b : 0));
  for (const lg of count('league').slice(0, 2)) for (const nat of count('nat').slice(0, 2)) tryBuild((p) => (p.league === lg ? 5 : 0) + (p.nat === nat ? 4 : 0));
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return bestLineup(pool, formation);
  // local search on the best few candidates: single replacements and pairwise swaps
  const f = FORMATIONS[formation];
  const W = chemWeight;
  const scoreOf = (sl) => teamRating(sl) + calcChemistry(formation, sl).scaled * W;
  const shortlist = pool.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 70);
  let best = null;
  for (const cand of candidates.slice(0, 3)) {
    let cur = cand.slots.slice(), cs = scoreOf(cur);
    for (let it = 0; it < 4; it++) {
      let improved = false;
      for (let i = 0; i < 11; i++) {
        const pos = f.slots[i].pos;
        for (const p of shortlist) {
          if (cur.includes(p) || (i === 0) !== (p.pos === 'GK')) continue;
          if (positionFit(p, pos) === 0) continue;
          if (cur.some((q, k) => k !== i && q && personOf(q) === personOf(p))) continue;
          const next = cur.slice(); next[i] = p;
          const s = scoreOf(next);
          if (s > cs + 1e-9) { cur = next; cs = s; improved = true; }
        }
      }
      for (let i = 1; i < 11; i++) for (let j = i + 1; j < 11; j++) {
        const next = cur.slice(); [next[i], next[j]] = [next[j], next[i]];
        const s = scoreOf(next);
        if (s > cs + 1e-9) { cur = next; cs = s; improved = true; }
      }
      if (!improved) break;
    }
    if (!best || cs > best.score) best = { slots: cur, score: cs };
  }
  const used = new Set(best.slots.map((p) => p.id));
  const usedPersons = new Set(best.slots.map((p) => personOf(p)));
  const rest = pool.filter((p) => !used.has(p.id) && !usedPersons.has(personOf(p))).sort((a, b) => b.ovr - a.ovr);
  const bench = [];
  const bgk = rest.find((p) => p.pos === 'GK');
  if (bgk) { bench.push(bgk); usedPersons.add(personOf(bgk)); }
  for (const p of rest) {
    if (bench.length >= 7) break;
    if (p === bgk || p.pos === 'GK' || usedPersons.has(personOf(p))) continue;
    bench.push(p); usedPersons.add(personOf(p));
  }
  return { slots: best.slots, bench, rating: teamRating(best.slots), chem: calcChemistry(formation, best.slots).scaled, score: best.score };
}

// ---------- national teams ----------
// Each nation's XI is an all-time squad: its real players (Icons + Stars, one version per person — the
// higher rated) where they fit, then filled with generated players. Extra V2 nations (not in the generated
// DB) get deterministic generated fillers of their own.
let _nt = null;
let _extraPools = null;

function extraNationPools() {
  if (_extraPools) return _extraPools;
  _extraPools = new Map();
  const tmpl = ['GK', 'GK', 'CB', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST', 'CB'];
  const clubs = CLUBS.filter((c) => c.tier === 2);
  for (const n of ALL_NATIONS.filter((x) => x.extra)) {
    const rng = new Rng(`xnat-${n.code}`);
    const pool = tmpl.map((pos, i) => {
      const club = clubs[(hashStr(n.code) + i * 7) % clubs.length];
      const target = clamp(Math.round(64 + n.str * 2.6 + rng.normal(0, 3) - (i === 1 ? 5 : 0)), 58, 82);
      const p = genPlayer(rng, { id: `xn_${n.code}_${i + 1}`, nat: n.code, pos, target, club: club.id, league: club.league });
      return ensureAlts(Object.assign(p, genPhysique(p)));
    });
    _extraPools.set(n.code, pool);
  }
  return _extraPools;
}

/** Real players of a nation, one version per person (highest overall). */
export function nationRealPlayers(code) {
  const best = new Map();
  const db = getDB();
  for (const p of db.real.concat(db.regulars || [])) {
    if (p.nat !== code) continue;
    const cur = best.get(p.person);
    if (!cur || p.ovr > cur.ovr) best.set(p.person, p);
  }
  return [...best.values()];
}

/** Real players are preferred wherever they fit (natural/alternative position) and never forced out of position. */
function nationScore(p, pos) {
  const base = effectiveOvr(p, pos);
  if (!p.real) return base;
  const fit = positionFit(p, pos);
  return base + (fit === 2 ? 10 : fit === 1 ? 8 : base >= p.ovr - 6 ? -8 : -25);
}
function lineupScore(slots, formation) {
  const f = FORMATIONS[formation];
  return slots.reduce((a, p, i) => a + (p ? nationScore(p, f.slots[i].pos) : -50), 0);
}

export function getNationalTeams() {
  if (_nt) return _nt.map((t) => structuredClone(t));
  const db = getDB();
  const byNat = new Map();
  for (const p of db.players) {
    if (p.real) continue;
    if (!byNat.has(p.nat)) byNat.set(p.nat, []);
    byNat.get(p.nat).push(p);
  }
  const extra = extraNationPools();
  _nt = ALL_NATIONS.map((n) => {
    const generated = byNat.get(n.code) || extra.get(n.code) || [];
    const real = nationRealPlayers(n.code);
    const pool = real.concat(generated);
    let formation = n.formation;
    let lineup = bestLineup(pool, formation, { score: nationScore });
    if (real.length >= 2) {
      // all-time squads pick the shape that fits their real players best (ties keep the nation's usual shape)
      let bestScore = lineupScore(lineup.slots, formation);
      for (const f of Object.keys(FORMATIONS)) {
        if (f === formation) continue;
        const lu = bestLineup(pool, f, { score: nationScore });
        const sc = lineupScore(lu.slots, f);
        if (sc > bestScore + 0.5) { bestScore = sc; lineup = lu; formation = f; }
      }
    }
    const kit = { ...n.kit };
    return buildTeam({
      id: n.code, name: n.name, short: n.code, kit, gkKit: gkKitFor(n.kit, n.away),
      formation, starters: lineup.slots, bench: lineup.bench,
    });
  });
  return _nt.map((t) => structuredClone(t));
}

/** Alternate (away) kit lookup for national teams. */
export function nationalAwayKit(code) {
  const n = ALL_NATIONS.find((x) => x.code === code);
  return n ? { ...n.away } : null;
}

/** Re-seat an XI into another formation by best positional fit (keeps the same 11 players). */
export function reseat(slotPlayers, formation) {
  const xi = slotPlayers.filter(Boolean).slice();
  const nf = FORMATIONS[formation];
  const seats = new Array(11).fill(null);
  // GK slot first, then others by scarcity
  const order = [0, ...nf.slots.map((_, i) => i).slice(1)];
  for (const i of order) {
    let bi = -1, bs = -Infinity;
    xi.forEach((p, k) => {
      if (!p) return;
      if ((i === 0) !== (p.pos === 'GK') && xi.some((q) => q && ((i === 0) === (q.pos === 'GK')))) return;
      const sc = effectiveOvr(p, nf.slots[i].pos) + positionFit(p, nf.slots[i].pos) * 3;
      if (sc > bs) { bs = sc; bi = k; }
    });
    if (bi >= 0) { seats[i] = xi[bi]; xi[bi] = null; }
  }
  return seats;
}
