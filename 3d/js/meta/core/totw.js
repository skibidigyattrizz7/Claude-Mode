// Team of the Week: 15 boosted In-Form cards per real calendar week, deterministic from the week number.
// Card ids look like `tw<week>_<baseId>` and resolve on demand (so saved cards survive later weeks).
import { Rng } from './rng.js';
import { getDB, adjustOvr, tierOf, addResolver, marketValue } from './players.js';
import { genPhysique } from './physique.js';
import { weekNumber } from './calendar.js';

const _cache = new Map();

function boost(base, week, rng) {
  const p = structuredClone(base);
  p.id = `tw${week}_${base.id}`;
  p.baseId = base.id;
  adjustOvr(p, rng.int(2, 5));
  p.special = 'inform'; p.totw = week; p.rare = true; p.tier = tierOf(p.ovr);
  p.pot = Math.max(p.pot, p.ovr);
  // one extra PlayStyle for strong weeks (kept within the 0..4 rule)
  const extra = genPhysique({ ...p, id: `${p.id}-x` }).playstyles.find((x) => !p.playstyles.some((y) => y.id === x.id));
  if (extra && p.playstyles.length < 4 && p.ovr >= 80) p.playstyles = p.playstyles.concat({ id: extra.id, plus: false });
  p.value = marketValue(p);
  return p;
}

/** The TOTW squad for a week: 1 GK, 4 DEF, 4 MID, 3 ATT (+3 extra). */
export function totwCards(week = weekNumber()) {
  if (_cache.has(week)) return _cache.get(week);
  const rng = new Rng(`totw-${week}`);
  const db = getDB();
  const grp = (p) => (p.pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p.pos) ? 'DEF' : ['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(p.pos) ? 'MID' : 'ATT');
  const pool = db.players.filter((p) => p.ovr >= 72 && !p.special);
  const want = { GK: 1, DEF: 4, MID: 4, ATT: 3 };
  const out = [];
  const used = new Set();
  const take = (list) => { for (let t = 0; t < 30; t++) { const p = rng.pick(list); if (!used.has(p.id)) { used.add(p.id); return p; } } return null; };
  for (const g of Object.keys(want)) {
    const list = pool.filter((p) => grp(p) === g);
    for (let i = 0; i < want[g]; i++) { const b = take(list); if (b) out.push(boost(b, week, rng)); }
  }
  for (let i = 0; i < 3; i++) { const b = take(pool.filter((p) => p.pos !== 'GK')); if (b) out.push(boost(b, week, rng)); }
  for (const p of out) db.byId.set(p.id, p);
  _cache.set(week, out);
  return out;
}

addResolver((id) => {
  const m = /^tw(\d+)_(.+)$/.exec(id);
  if (!m) return null;
  const list = totwCards(Number(m[1]));
  return list.find((p) => p.id === id) || null;
});
