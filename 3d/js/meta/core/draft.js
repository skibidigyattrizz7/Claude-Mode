// Draft mode: pick a formation, a captain (1 of 5), then 1 of 5 for each XI slot and each of the 7 subs, in any
// order (real + generated players),
// then a 4-round knockout vs AI. Rewards scale with wins. Draft squads are temporary. DOM-free.
import { Rng } from './rng.js';
import { getDB, getPlayer } from './players.js';
import { FORMATIONS, FORMATION_NAMES, positionFit } from './formations.js';
import { calcChemistry, teamRating } from './chemistry.js';
import { buildTeam, gkKitFor, bestLineup } from './teams.js';
import { aiOpponent } from './rivals.js';
import { isCardReleased } from './promos.js';

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

/**
 * Draft odds (FC FUT Draft-like). Every 5-card choice is built from 5 "draws"; each draw is a weighted table of
 * [minOvr, maxOvr, weight]. If a band has nobody left for that position the band widens downwards.
 * `chemBias` = chance that a non-headline draw is limited to players sharing a nation or league with the XI so far,
 * so a high-chemistry draft is actually reachable. Shown cards are shuffled (the best one is not always first).
 */
export const DRAFT_ODDS = {
  captain: [
    [[90, 99, 0.8], [88, 89, 0.2]],
    [[86, 89, 0.6], [84, 85, 0.4]],
    [[86, 89, 0.4], [84, 85, 0.6]],
    [[84, 87, 1]],
    [[84, 87, 1]],
  ],
  slot: [
    [[90, 99, 0.3], [88, 89, 0.3], [85, 87, 0.4]], // headline card: always 85+, real chance at 88-91+
    [[86, 89, 0.35], [83, 85, 0.65]],
    [[82, 85, 1]],
    [[79, 83, 1]],
    [[76, 81, 1]],
  ],
  bench: [
    [[86, 91, 0.35], [84, 85, 0.65]],
    [[82, 85, 1]],
    [[80, 84, 1]],
    [[78, 82, 1]],
    [[75, 80, 1]],
  ],
  chemBias: 0.45,
};
export const BENCH_SIZE = 7;

function pickBand(rng, table) {
  const tot = table.reduce((a, b) => a + b[2], 0);
  let r = rng.next() * tot;
  for (const b of table) { r -= b[2]; if (r <= 0) return b; }
  return table[table.length - 1];
}
/** Draw `table.length` distinct persons from `pool`, skipping `used` persons. Deterministic for a given rng. */
function drawOptions(rng, pool, table, used, chemPool = null) {
  const out = [];
  const persons = new Set();
  const ok = (p) => p && !used.has(personOf(p)) && !persons.has(personOf(p));
  const take = (p) => { persons.add(personOf(p)); out.push(p.id); };
  table.forEach((draw, k) => {
    let [lo, hi] = pickBand(rng, draw);
    const useChem = k > 0 && chemPool && rng.next() < DRAFT_ODDS.chemBias;
    for (let widen = 0; widen < 12; widen++, lo -= 3) {
      const src = (useChem && widen < 3 ? chemPool : pool).filter((p) => p.ovr >= lo && p.ovr <= hi && ok(p));
      if (src.length) { take(rng.pick(src)); return; }
    }
  });
  const rest = pool.filter(ok);
  while (out.length < table.length && rest.length) { const p = rest.splice(Math.floor(rng.next() * rest.length), 1)[0]; if (ok(p)) take(p); }
  return rng.shuffle(out);
}
const draftPool = () => getDB().all.filter((p) => p.special !== 'objective' && isCardReleased(p));

/** 5 captain candidates (84+, usually one 90+, positions that exist in the formation). */
export function chooseFormation(d, formation) {
  if (!FORMATIONS[formation]) throw new Error('Bad formation');
  d.formation = formation;
  const rng = new Rng(`draft-${d.seed}-cap`);
  const slotPos = new Set(FORMATIONS[formation].slots.map((s) => s.pos));
  const pool = draftPool().filter((p) => p.ovr >= 84 && [p.pos, ...(p.alt || [])].some((x) => slotPos.has(x)) && p.pos !== 'GK');
  d.captainOptions = drawOptions(rng, pool, DRAFT_ODDS.captain, new Set());
  d.stage = 'captain';
  return d.captainOptions;
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
  ensureBench(d);
  return idx;
}

/** 7 sub positions for a formation: GK, CB, a full-back, two central mids, a wide/attacking mid and a striker. */
export function benchPositions(formation) {
  const pos = FORMATIONS[formation].slots.map((s) => s.pos);
  const first = (list, dflt) => list.find((x) => pos.includes(x)) || dflt;
  return ['GK', 'CB', first(['LB', 'RB', 'LWB', 'RWB'], 'CB'), first(['CDM', 'CM'], 'CM'), first(['CM', 'CAM', 'CDM'], 'CM'), first(['LW', 'RW', 'LM', 'RM', 'CAM'], 'CAM'), first(['ST', 'CF'], 'ST')];
}
/** Old saves: a draft still in its picking stage gets 7 empty sub slots (finished ones keep their bench). */
export function ensureBench(d) {
  if (d.stage === 'slots' && d.bench.length !== BENCH_SIZE) d.bench = new Array(BENCH_SIZE).fill(null);
  if (!d.opts) d.opts = {};
  return d;
}

function optionPool(pos) {
  return draftPool().filter((p) => positionFit(p, pos) >= 1 && (pos === 'GK') === (p.pos === 'GK'));
}
/** Persons unavailable for a new option set: drafted players + persons still on offer in other open slots. */
function blockedPersons(d, key) {
  const used = usedPersons(d);
  for (const [k, ids] of Object.entries(d.opts || {})) {
    if (k === key) continue;
    const filled = k[0] === 's' ? d.slots[+k.slice(1)] : d.bench[+k.slice(1)];
    if (!filled) for (const id of ids) { const p = getPlayer(id); if (p) used.add(personOf(p)); }
  }
  return used;
}
function chemPoolFor(d, pool) {
  const xi = d.slots.filter(Boolean).map(getPlayer).filter(Boolean);
  if (!xi.length) return null;
  const nats = new Set(xi.map((p) => p.nat));
  const leagues = new Set(xi.map((p) => p.league));
  return pool.filter((p) => nats.has(p.nat) || leagues.has(p.league));
}
function cachedOptions(d, key, seedKey, pos, table) {
  ensureBench(d);
  if (d.opts[key] && d.opts[key].length) return d.opts[key];
  const rng = new Rng(`draft-${d.seed}-${seedKey}`);
  const pool = optionPool(pos);
  const out = drawOptions(rng, pool, table, blockedPersons(d, key), chemPoolFor(d, pool));
  d.opts[key] = out;
  return out;
}

/** 5 options for XI slot i. Generated the first time the slot is opened, then stable (any picking order). */
export function slotOptions(d, i) {
  return cachedOptions(d, `s${i}`, `slot-${i}`, FORMATIONS[d.formation].slots[i].pos, DRAFT_ODDS.slot);
}
/** 5 options for sub slot j (same rules as the XI). */
export function benchOptions(d, j) {
  return cachedOptions(d, `b${j}`, `bench-${j}`, benchPositions(d.formation)[j], DRAFT_ODDS.bench);
}

export function nextOpenSlot(d) { return d.slots.findIndex((x) => !x); }
export function nextOpenBench(d) { return d.bench.findIndex((x) => !x); }
/** Picks still to make: XI slots + subs. The draft can only kick off at 0. */
export function picksLeft(d) {
  return d.slots.filter((x) => !x).length + (d.stage === 'slots' ? d.bench.filter((x) => !x).length : 0);
}
function finishIfFilled(d) {
  if (d.stage === 'slots' && nextOpenSlot(d) < 0 && nextOpenBench(d) < 0) d.stage = 'play';
}

export function pickSlot(d, i, pid) {
  if (d.stage !== 'slots') throw new Error('Not picking');
  if (d.slots[i]) throw new Error('Slot filled');
  if (!slotOptions(d, i).includes(pid)) throw new Error('Not an option');
  if (usedPersons(d).has(personOf(getPlayer(pid)))) throw new Error('Already drafted');
  d.slots[i] = pid;
  finishIfFilled(d);
}
export function pickBench(d, j, pid) {
  ensureBench(d);
  if (d.stage !== 'slots') throw new Error('Not picking');
  if (j < 0 || j >= BENCH_SIZE || d.bench[j]) throw new Error('Sub slot filled');
  if (!benchOptions(d, j).includes(pid)) throw new Error('Not an option');
  if (usedPersons(d).has(personOf(getPlayer(pid)))) throw new Error('Already drafted');
  d.bench[j] = pid;
  finishIfFilled(d);
}

export function draftInfo(d) {
  const slots = d.slots.map((id) => (id ? getPlayer(id) : null));
  const chem = d.formation ? calcChemistry(d.formation, slots) : { scaled: 0, players: [] };
  return { slots, rating: teamRating(slots), chem };
}

export function draftTeam(d, kit) {
  const { slots, chem } = draftInfo(d);
  const k = kit || { primary: '#111827', secondary: '#F5C542', number: '#F5C542', shorts: '#111827', socks: '#111827' };
  return buildTeam({ id: `DRAFT-${d.seed}`.slice(0, 30), name: 'Draft XI', short: 'DFT', kit: k, gkKit: gkKitFor(k), formation: d.formation, starters: slots, bench: d.bench.filter(Boolean).map(getPlayer).filter(Boolean), chemistry: chem.scaled });
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
