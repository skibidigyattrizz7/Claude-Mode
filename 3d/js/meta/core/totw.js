// Team of the Week: 15 boosted In-Form cards per real calendar week, deterministic from the week number.
// V3: boosts scale with the base card (+3..+8), 3 headliners rated 88–94 every week, better PlayStyles, and
// real regular players are eligible. New card ids are `tt<week>_<baseId>`; the pre-V3 generator is kept for
// `tw<week>_<baseId>` ids so cards in existing saves still resolve with their original ratings.
import { Rng, clamp } from './rng.js';
import { getDB, adjustOvr, computeOvr, tierOf, addResolver, marketValue } from './players.js';
import { genPhysique } from './physique.js';
import { weekNumber } from './calendar.js';
import { informBoost, upgradeStyles, setOvr } from './promos.js';

const grp = (p) => (p.pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p.pos) ? 'DEF' : ['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(p.pos) ? 'MID' : 'ATT');

// ---------- pre-V3 generator (legacy ids `tw…`) ----------
const _legacy = new Map();
function legacyBoost(base, week, rng) {
  const p = structuredClone(base);
  p.id = `tw${week}_${base.id}`;
  p.baseId = base.id;
  adjustOvr(p, rng.int(2, 5));
  p.special = 'inform'; p.totw = week; p.rare = true; p.tier = tierOf(p.ovr);
  p.pot = Math.max(p.pot, p.ovr);
  const extra = genPhysique({ ...p, id: `${p.id}-x` }).playstyles.find((x) => !p.playstyles.some((y) => y.id === x.id));
  if (extra && p.playstyles.length < 4 && p.ovr >= 80) p.playstyles = p.playstyles.concat({ id: extra.id, plus: false });
  p.value = marketValue(p);
  return p;
}
export function legacyTotwCards(week) {
  if (_legacy.has(week)) return _legacy.get(week);
  const rng = new Rng(`totw-${week}`);
  const db = getDB();
  const pool = db.players.filter((p) => p.ovr >= 72 && !p.special && !p.real);
  const want = { GK: 1, DEF: 4, MID: 4, ATT: 3 };
  const out = [];
  const used = new Set();
  const take = (list) => { for (let t = 0; t < 30; t++) { const p = rng.pick(list); if (!used.has(p.id)) { used.add(p.id); return p; } } return null; };
  for (const g of Object.keys(want)) {
    const list = pool.filter((p) => grp(p) === g);
    for (let i = 0; i < want[g]; i++) { const b = take(list); if (b) out.push(legacyBoost(b, week, rng)); }
  }
  for (let i = 0; i < 3; i++) { const b = take(pool.filter((p) => p.pos !== 'GK')); if (b) out.push(legacyBoost(b, week, rng)); }
  for (const p of out) db.byId.set(p.id, p);
  _legacy.set(week, out);
  return out;
}

// ---------- V3 generator ----------
const _cache = new Map();
function boost(base, week, target, headliner) {
  const p = structuredClone(base);
  p.id = `tt${week}_${base.id}`;
  p.baseId = base.id;
  delete p.intended;
  setOvr(p, clamp(target, base.ovr, 99), { adjustOvr, computeOvr });
  p.special = 'inform'; p.totw = week; p.rare = true; p.tier = tierOf(p.ovr);
  if (headliner) p.headliner = true;
  p.pot = Math.max(p.pot, p.ovr);
  upgradeStyles(p, headliner ? 2 : 1);
  p.value = marketValue(p);
  return p;
}

/** The TOTW squad for a week: 3 headliners (88–94) + 1 GK, 4 DEF, 4 MID, 3 ATT. Headliners come first. */
export function totwCards(week = weekNumber()) {
  if (_cache.has(week)) return _cache.get(week);
  const rng = new Rng(`totw3-${week}`);
  const db = getDB();
  const pool = db.players.filter((p) => p.ovr >= 74 && !p.special);
  const used = new Set();
  const key = (p) => p.person || p.id;
  const take = (list) => { for (let t = 0; t < 40 && list.length; t++) { const p = rng.pick(list); if (!used.has(key(p))) { used.add(key(p)); return p; } } return null; };
  const out = [];
  const heads = pool.filter((p) => p.ovr >= 84 && p.pos !== 'GK');
  for (let i = 0; i < 3; i++) {
    const b = take(heads);
    if (b) out.push(boost(b, week, clamp(b.ovr + informBoost(b.ovr), 88, 94), true));
  }
  const want = { GK: 1, DEF: 4, MID: 4, ATT: 3 };
  for (const g of Object.keys(want)) {
    const list = pool.filter((p) => grp(p) === g && p.ovr <= 86);
    for (let i = 0; i < want[g]; i++) { const b = take(list); if (b) out.push(boost(b, week, Math.min(93, b.ovr + informBoost(b.ovr)), false)); }
  }
  for (const p of out) db.byId.set(p.id, p);
  _cache.set(week, out);
  return out;
}

addResolver((id) => {
  let m = /^tt(\d+)_(.+)$/.exec(id);
  if (m) return totwCards(Number(m[1])).find((p) => p.id === id) || null;
  m = /^tw(\d+)_(.+)$/.exec(id);
  if (m) return legacyTotwCards(Number(m[1])).find((p) => p.id === id) || null;
  return null;
});
