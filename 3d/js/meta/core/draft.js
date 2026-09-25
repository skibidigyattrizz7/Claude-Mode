// Draft mode: pick a formation, a captain (1 of 5), then 1 of 5 for each slot (real + generated players),
// then a 4-round knockout vs AI. Rewards scale with wins. Draft squads are temporary. DOM-free.
import { Rng } from './rng.js';
import { getDB, getPlayer } from './players.js';
import { FORMATIONS, FORMATION_NAMES, positionFit } from './formations.js';
import { calcChemistry, teamRating } from './chemistry.js';
import { buildTeam, gkKitFor, bestLineup } from './teams.js';
import { aiOpponent } from './rivals.js';

export const DRAFT_ENTRY = 8000;
export const DRAFT_ROUNDS = ['Round 1', 'Quarter-final', 'Semi-final', 'Final'];
const ROUND_DIFF = ['world', 'world', 'legendary', 'legendary'];
export const DRAFT_REWARDS = [
  { coins: 800, pack: 'bronze' },
  { coins: 2500, pack: 'silver' },
  { coins: 5000, pack: 'gold' },
  { coins: 9000, pack: 'premium' },
  { coins: 16000, pack: 'rare', pick: { pool: 'gold83', n: 3, label: '83+ Player Pick' } },
];

export function newDraft(seed = `${Date.now()}`) {
  return { seed: String(seed), stage: 'formation', formation: null, captain: null, captainOptions: [], slots: new Array(11).fill(null), bench: [], round: 0, wins: 0, results: [], done: false, claimed: false };
}

const personOf = (p) => p.person || p.baseId || p.id;
function usedPersons(d) {
  return new Set(d.slots.concat(d.bench).filter(Boolean).map((id) => personOf(getPlayer(id))));
}

/** 5 captain candidates (85+, positions that exist in the formation). */
export function chooseFormation(d, formation) {
  if (!FORMATIONS[formation]) throw new Error('Bad formation');
  d.formation = formation;
  const rng = new Rng(`draft-${d.seed}-cap`);
  const slotPos = new Set(FORMATIONS[formation].slots.map((s) => s.pos));
  const pool = getDB().all.filter((p) => p.ovr >= 85 && p.special !== 'objective' && [p.pos, ...(p.alt || [])].some((x) => slotPos.has(x)) && p.pos !== 'GK');
  const out = [];
  const persons = new Set();
  for (let i = 0; i < 200 && out.length < 5 && pool.length; i++) {
    const p = rng.pick(pool);
    if (p && !persons.has(personOf(p))) { persons.add(personOf(p)); out.push(p.id); }
  }
  d.captainOptions = out;
  d.stage = 'captain';
  return out;
}

export function chooseCaptain(d, pid) {
  if (!d.captainOptions.includes(pid)) throw new Error('Not an option');
  const p = getPlayer(pid);
  const f = FORMATIONS[d.formation];
  let idx = f.slots.findIndex((s) => positionFit(p, s.pos) === 2);
  if (idx < 0) idx = f.slots.findIndex((s) => positionFit(p, s.pos) >= 1);
  if (idx < 0) idx = 1;
  d.slots[idx] = pid;
  d.captain = pid;
  d.stage = 'slots';
  return idx;
}

/** 5 options for slot i (deterministic per draft). */
export function slotOptions(d, i) {
  const pos = FORMATIONS[d.formation].slots[i].pos;
  const rng = new Rng(`draft-${d.seed}-slot-${i}`);
  const used = usedPersons(d);
  const all = getDB().all.filter((p) => p.special !== 'objective' && positionFit(p, pos) >= 1 && (pos === 'GK') === (p.pos === 'GK'));
  const bands = [[86, 99, 1], [82, 85, 2], [76, 81, 2]];
  const out = [];
  const persons = new Set();
  for (const [lo, hi, k] of bands) {
    const pool = all.filter((p) => p.ovr >= lo && p.ovr <= hi);
    for (let t = 0, got = 0; t < 80 && got < k && pool.length; t++) {
      const p = rng.pick(pool);
      const per = personOf(p);
      if (used.has(per) || persons.has(per)) continue;
      persons.add(per); out.push(p.id); got++;
    }
  }
  for (let t = 0; t < 300 && out.length < 5 && all.length; t++) {
    const p = rng.pick(all);
    if (p && !persons.has(personOf(p)) && !used.has(personOf(p))) { persons.add(personOf(p)); out.push(p.id); }
  }
  return out;
}

export function nextOpenSlot(d) { return d.slots.findIndex((x) => !x); }

export function pickSlot(d, i, pid) {
  if (d.slots[i]) throw new Error('Slot filled');
  if (!slotOptions(d, i).includes(pid)) throw new Error('Not an option');
  d.slots[i] = pid;
  if (nextOpenSlot(d) < 0) {
    // auto bench: 5 solid subs (1 GK) not already drafted
    const used = usedPersons(d);
    const rng = new Rng(`draft-${d.seed}-bench`);
    let pool = getDB().players.filter((p) => p.ovr >= 76 && p.ovr <= 83 && !used.has(personOf(p)));
    let gk = pool.filter((p) => p.pos === 'GK');
    if (!gk.length) { pool = getDB().players.filter((p) => p.ovr >= 70 && p.ovr <= 88); gk = pool.filter((p) => p.pos === 'GK'); }
    if (!gk.length) gk = getDB().players.filter((p) => p.pos === 'GK');
    d.bench = [rng.pick(gk).id];
    for (let t = 0; t < 120 && d.bench.length < 5 && pool.length; t++) { const p = rng.pick(pool); if (p.pos !== 'GK' && !d.bench.includes(p.id) && !used.has(personOf(p))) d.bench.push(p.id); }
    d.stage = 'play';
  }
}

export function draftInfo(d) {
  const slots = d.slots.map((id) => (id ? getPlayer(id) : null));
  const chem = d.formation ? calcChemistry(d.formation, slots) : { scaled: 0, players: [] };
  return { slots, rating: teamRating(slots), chem };
}

export function draftTeam(d, kit) {
  const { slots, chem } = draftInfo(d);
  const k = kit || { primary: '#111827', secondary: '#F5C542', number: '#F5C542', shorts: '#111827', socks: '#111827' };
  return buildTeam({ id: `DRAFT-${d.seed}`.slice(0, 30), name: 'Draft XI', short: 'DFT', kit: k, gkKit: gkKitFor(k), formation: d.formation, starters: slots, bench: d.bench.map(getPlayer).filter(Boolean), chemistry: chem.scaled });
}

export function draftOpponent(d) {
  return aiOpponent(`draft-${d.seed}-r${d.round}`, ROUND_DIFF[d.round] || 'legendary', { label: 'DRF' });
}
export function roundDifficulty(d) { return ROUND_DIFF[d.round] || 'legendary'; }

/** Apply a knockout result ('W' advances; anything else ends the run). */
export function applyDraftResult(d, outcome, meta = {}) {
  d.results.push({ round: d.round, outcome, ...meta });
  if (outcome === 'W') { d.wins++; d.round++; if (d.wins >= 4) d.done = true; }
  else d.done = true;
  if (d.done) d.stage = 'done';
  return d;
}
export function draftReward(d) { return DRAFT_REWARDS[Math.min(4, d.wins)]; }
export { FORMATION_NAMES, bestLineup };
