// Objectives hub: Daily, Weekly, Season, Milestones, Foundations and Player Objectives (incl. Legend of the
// Game chains). Progress comes from UT matches (per-player `result.playerStats`, falling back to `scorers`),
// lifetime stats and feature flags. DOM-free.
import { Rng } from './rng.js';
import { getPlayer } from './players.js';
import { weekNumber } from './calendar.js';
import { seasonNumber } from './seasons.js';
import { grantReward, OBJECTIVES } from './ut.js';

export const SECTIONS = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['player', 'Player'], ['season', 'Season'], ['milestone', 'Milestones'], ['foundation', 'Foundations'],
];
export const dayNumber = (t = Date.now()) => Math.floor(t / 86400000);

// ---------- per-match stats ----------
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** Normalise a match result for the user's side. */
export function userMatchStats(team, result, side = 'home') {
  const ids = team.players.concat(team.bench || []).map((p) => p.id);
  const starters = team.players.map((p) => p.id);
  const ps = result.playerStats && typeof result.playerStats === 'object' ? result.playerStats : null;
  const stats = {};
  for (const id of ids) {
    const s = (ps && ps[id]) || {};
    stats[id] = { goals: n(s.goals), assists: n(s.assists), headerGoals: n(s.headerGoals), finesseGoals: n(s.finesseGoals), shots: n(s.shots), saves: n(s.saves), tackles: n(s.tackles), passes: n(s.passes), played: !!ps ? !!ps[id] || starters.includes(id) : starters.includes(id) };
  }
  const hasGoals = ps && ids.some((id) => ps[id] && ps[id].goals !== undefined);
  if (!hasGoals) {
    for (const sc of result.scorers || []) {
      if (sc.team !== side || sc.own) continue;
      if (stats[sc.playerId]) stats[sc.playerId].goals++;
      if (sc.assistId && stats[sc.assistId]) stats[sc.assistId].assists++;
      if (sc.header && stats[sc.playerId]) stats[sc.playerId].headerGoals++;
      if (sc.finesse && stats[sc.playerId]) stats[sc.playerId].finesseGoals++;
    }
  }
  const gf = n(side === 'home' ? result.homeGoals : result.awayGoals);
  const ga = n(side === 'home' ? result.awayGoals : result.homeGoals);
  let outcome = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
  if (outcome === 'D' && result.pens) {
    const pens = Array.isArray(result.pens) ? result.pens : [result.pens.home, result.pens.away];
    const mine = side === 'home' ? pens[0] : pens[1], theirs = side === 'home' ? pens[1] : pens[0];
    if (mine !== theirs) outcome = mine > theirs ? 'W' : 'L';
  }
  return { outcome, gf, ga, cleanSheet: ga === 0, starters, stats };
}

// ---------- filters ----------
/** Does DB player `p` match filter F? */
export function matchFilter(p, F = {}) {
  if (!p) return false;
  if (F.pid && p.id !== F.pid && p.baseId !== F.pid) return false;
  if (F.person && p.person !== F.person) return false;
  if (F.special && p.special !== F.special) return false;
  if (F.nat && p.nat !== F.nat) return false;
  if (F.minHeight && !(p.height >= F.minHeight)) return false;
  if (F.pos && !F.pos.includes(p.pos)) return false;
  if (F.playstyle && !(p.playstyles || []).some((x) => x.id === F.playstyle)) return false;
  return true;
}
const pl = (id) => getPlayer(id);

/** Progress increment a match gives to one objective metric. */
export function metricGain(metric, m) {
  const F = metric.f || {};
  const sum = (key) => Object.entries(m.stats).reduce((a, [id, s]) => a + (matchFilter(pl(id), F) ? s[key] : 0), 0);
  const startersMatching = () => m.starters.filter((id) => matchFilter(pl(id), F)).length;
  switch (metric.type) {
    case 'play': return 1;
    case 'win': return m.outcome === 'W' ? 1 : 0;
    case 'teamGoals': return m.gf;
    case 'cleanSheet': return m.cleanSheet ? 1 : 0;
    case 'goals': return sum('goals');
    case 'assists': return sum('assists');
    case 'headerGoals': return sum('headerGoals');
    case 'finesseGoals': return sum('finesseGoals');
    case 'playWith': return startersMatching() >= (metric.count || 1) ? 1 : 0;
    case 'winWith': return m.outcome === 'W' && startersMatching() >= (metric.count || 1) ? 1 : 0;
    case 'cleanSheetWith': return m.cleanSheet && startersMatching() >= (metric.count || 1) ? 1 : 0;
    default: return 0;
  }
}

// ---------- catalogue ----------
const R = (coins, extra = {}) => ({ coins, ...extra });
const DAILY_POOL = [
  { label: 'Play 2 matches', metric: { type: 'play' }, target: 2, reward: R(1200) },
  { label: 'Win a match', metric: { type: 'win' }, target: 1, reward: R(1500) },
  { label: 'Score 3 goals', metric: { type: 'teamGoals' }, target: 3, reward: R(1000, { pack: 'silver' }) },
  { label: 'Keep a clean sheet', metric: { type: 'cleanSheet' }, target: 1, reward: R(1500) },
  { label: 'Assist 2 goals', metric: { type: 'assists' }, target: 2, reward: R(1200) },
  { label: 'Score with a Legend of the Game', metric: { type: 'goals', f: { special: 'lotg' } }, target: 1, reward: R(2000) },
  { label: 'Score 2 goals with your strikers', metric: { type: 'goals', f: { pos: ['ST', 'CF'] } }, target: 2, reward: R(1200) },
];
const WEEKLY_POOL = [
  { label: 'Win 5 matches', metric: { type: 'win' }, target: 5, reward: { pack: 'premium' } },
  { label: 'Score 12 goals', metric: { type: 'teamGoals' }, target: 12, reward: R(6000) },
  { label: 'Keep 3 clean sheets', metric: { type: 'cleanSheet' }, target: 3, reward: { pack: 'gold', coins: 2500 } },
  { label: 'Score 2 headers', metric: { type: 'headerGoals' }, target: 2, reward: R(5000) },
  { label: 'Score 3 finesse goals', metric: { type: 'finesseGoals' }, target: 3, reward: R(5000) },
  { label: 'Play 8 matches', metric: { type: 'play' }, target: 8, reward: { pack: 'rare' } },
  { label: 'Assist 6 goals', metric: { type: 'assists' }, target: 6, reward: { pick: { pool: 'gold80', n: 3, label: '80+ Player Pick' } } },
];
const PLAYER_POOL = [
  { label: 'Score 3 goals with Messi', metric: { type: 'goals', f: { person: 'messi' } }, target: 3, reward: R(8000) },
  { label: 'Assist 2 goals with any Legend of the Game', metric: { type: 'assists', f: { special: 'lotg' } }, target: 2, reward: { pack: 'premium' } },
  { label: 'Score a header with a player 1.90 m+', metric: { type: 'headerGoals', f: { minHeight: 190 } }, target: 1, reward: R(4000) },
  { label: 'Win with 3+ Brazilians in your XI', metric: { type: 'winWith', count: 3, f: { nat: 'BRA' } }, target: 1, reward: R(4000) },
  { label: 'Keep a clean sheet with Buffon in goal', metric: { type: 'cleanSheetWith', f: { person: 'buffon' } }, target: 1, reward: { pack: 'rare' } },
  { label: 'Score a finesse goal', metric: { type: 'finesseGoals' }, target: 1, reward: R(2500) },
  { label: 'Score 2 goals with a Finesse Shot player', metric: { type: 'goals', f: { playstyle: 'finesse' } }, target: 2, reward: R(3000) },
  { label: 'Score 3 goals with Cristiano Ronaldo', metric: { type: 'goals', f: { person: 'ronaldo' } }, target: 3, reward: R(8000) },
  { label: 'Win 2 with 3+ Frenchmen', metric: { type: 'winWith', count: 3, f: { nat: 'FRA' } }, target: 2, reward: R(5000) },
  { label: 'Score 2 goals with a centre-back', metric: { type: 'goals', f: { pos: ['CB'] } }, target: 2, reward: { pack: 'premium' } },
];
// Legend of the Game chains: each step unlocks after the previous is claimed.
const CHAINS = [
  { chain: 'samba', title: 'Samba Legends', steps: [
    { label: 'Win with 3+ Brazilians', metric: { type: 'winWith', count: 3, f: { nat: 'BRA' } }, target: 2, reward: R(5000) },
    { label: 'Score 4 goals with Brazilians', metric: { type: 'goals', f: { nat: 'BRA' } }, target: 4, reward: { pack: 'rare' } },
    { label: 'Score 2 goals with a Brazilian Legend of the Game', metric: { type: 'goals', f: { nat: 'BRA', special: 'lotg' } }, target: 2, reward: { player: 'ic_garrincha' } },
  ] },
  { chain: 'catenaccio', title: 'Catenaccio', steps: [
    { label: 'Keep 2 clean sheets with 3+ Italians', metric: { type: 'cleanSheetWith', count: 3, f: { nat: 'ITA' } }, target: 2, reward: R(6000) },
    { label: 'Win 3 with an Italian Legend of the Game', metric: { type: 'winWith', f: { nat: 'ITA', special: 'lotg' } }, target: 3, reward: { pack: 'lotg' } },
    { label: 'Keep 3 clean sheets with an Italian LOTG defender', metric: { type: 'cleanSheetWith', f: { nat: 'ITA', special: 'lotg', pos: ['CB', 'LB', 'RB', 'GK'] } }, target: 3, reward: { player: 'ic_nesta' } },
  ] },
  { chain: 'total', title: 'Total Football', steps: [
    { label: 'Win with 3+ Dutch players', metric: { type: 'winWith', count: 3, f: { nat: 'NED' } }, target: 2, reward: R(5000) },
    { label: 'Assist 4 goals with Dutch players', metric: { type: 'assists', f: { nat: 'NED' } }, target: 4, reward: { pick: { pool: 'gold83', n: 3, label: '83+ Player Pick' } } },
    { label: 'Score 3 goals with a Dutch Legend of the Game', metric: { type: 'goals', f: { nat: 'NED', special: 'lotg' } }, target: 3, reward: { player: 'ic_neeskens' } },
  ] },
  { chain: 'pathfinder', title: 'Pathfinder Trail', steps: [
    { label: 'Play 5 matches', metric: { type: 'play' }, target: 5, reward: { player: 'ob1' } },
    { label: 'Win 6 matches', metric: { type: 'win' }, target: 6, reward: { player: 'ob5' } },
    { label: 'Keep 4 clean sheets', metric: { type: 'cleanSheet' }, target: 4, reward: { player: 'ob3' } },
  ] },
];
const SEASON_LIST = [
  { id: 's-wins', label: 'Win 25 matches this season', metric: { type: 'win' }, target: 25, reward: { pack: 'lotg' } },
  { id: 's-goals', label: 'Score 60 goals this season', metric: { type: 'teamGoals' }, target: 60, reward: { pick: { pool: 'lotg', n: 3, label: 'LOTG Player Pick' } } },
  { id: 's-cs', label: 'Keep 12 clean sheets this season', metric: { type: 'cleanSheet' }, target: 12, reward: { player: 'ob7' } },
  { id: 's-lotg', label: 'Score 15 goals with Legends of the Game', metric: { type: 'goals', f: { special: 'lotg' } }, target: 15, reward: { player: 'ob2' } },
];
const FOUNDATIONS = [
  { id: 'f-pack', label: 'Open your first pack', metric: { type: 'stat', key: 'packsOpened' }, target: 1, reward: R(1500) },
  { id: 'f-squad', label: 'Edit your squad', metric: { type: 'flag', key: 'squadEdited' }, target: 1, reward: R(1000) },
  { id: 'f-tactics', label: 'Save a custom tactic', metric: { type: 'flag', key: 'tactics' }, target: 1, reward: R(1500) },
  { id: 'f-battle', label: 'Play a Squad Battles match', metric: { type: 'stat', key: 'matches' }, target: 1, reward: R(1500) },
  { id: 'f-sbc', label: 'Complete an SBC', metric: { type: 'stat', key: 'sbcDone' }, target: 1, reward: { pack: 'gold' } },
  { id: 'f-market', label: 'Search the transfer market', metric: { type: 'flag', key: 'marketSearch' }, target: 1, reward: R(1000) },
  { id: 'f-club', label: 'Customise your badge or kits', metric: { type: 'flag', key: 'clubEdited' }, target: 1, reward: { pack: 'silver' } },
  { id: 'f-evo', label: 'Start an Evolution', metric: { type: 'flag', key: 'evoStarted' }, target: 1, reward: { pack: 'premium' } },
  { id: 'f-rivals', label: 'Play a Rivals match', metric: { type: 'flag', key: 'rivalsPlayed' }, target: 1, reward: { pack: 'gold' } },
  { id: 'f-draft', label: 'Play a Draft', metric: { type: 'flag', key: 'draftPlayed' }, target: 1, reward: { pack: 'premium' } },
];

function pickFrom(pool, n, seed, prefix) {
  const rng = new Rng(seed);
  const idx = rng.shuffle(pool.map((_, i) => i)).slice(0, n);
  return idx.map((i) => ({ ...pool[i], id: `${prefix}${i}` }));
}

/** Every objective active right now, with bucket keys. */
export function catalog(t = Date.now()) {
  const day = dayNumber(t), week = weekNumber(t), season = seasonNumber(t);
  const out = [];
  for (const o of pickFrom(DAILY_POOL, 3, `daily-${day}`, 'd')) out.push({ ...o, section: 'daily', bucket: `d${day}` });
  for (const o of pickFrom(WEEKLY_POOL, 4, `weekly-${week}`, 'w')) out.push({ ...o, section: 'weekly', bucket: `w${week}` });
  for (const o of pickFrom(PLAYER_POOL, 5, `pobj-${week}`, 'p')) out.push({ ...o, section: 'player', bucket: `w${week}` });
  for (const c of CHAINS) c.steps.forEach((st, i) => out.push({ ...st, id: `c-${c.chain}-${i}`, chain: c.chain, chainTitle: c.title, step: i, section: 'player', bucket: 'life', requires: i ? `c-${c.chain}-${i - 1}` : null }));
  for (const o of SEASON_LIST) out.push({ ...o, section: 'season', bucket: `s${season}` });
  for (const o of OBJECTIVES) out.push({ id: o.id, label: o.label, metric: { type: 'stat', key: o.stat }, target: o.target, reward: o.reward, section: 'milestone', bucket: 'legacy' });
  for (const o of FOUNDATIONS) out.push({ ...o, section: 'foundation', bucket: 'life' });
  return out;
}

export function ensureObj(state) {
  if (!state.ob || typeof state.ob !== 'object') state.ob = { prog: {}, claimed: {} };
  state.flags = state.flags || {};
  return state.ob;
}
const key = (o) => `${o.bucket}:${o.id}`;

export function progressOf(state, o) {
  const ob = ensureObj(state);
  if (o.metric.type === 'stat') return Math.min(o.target, state.stats[o.metric.key] || 0);
  if (o.metric.type === 'flag') return state.flags[o.metric.key] ? o.target : 0;
  return Math.min(o.target, ob.prog[key(o)] || 0);
}
export function isClaimed(state, o) {
  if (o.bucket === 'legacy') return !!state.obj[o.id];
  return !!ensureObj(state).claimed[key(o)];
}
export function isLocked(state, o, list) {
  if (!o.requires) return false;
  const prev = list.find((x) => x.id === o.requires);
  return prev ? !isClaimed(state, prev) : false;
}

/** Objectives with status for the hub UI. */
export function objectiveList(state, t = Date.now()) {
  const list = catalog(t);
  return list.map((o) => {
    const prog = progressOf(state, o);
    const claimed = isClaimed(state, o);
    const locked = isLocked(state, o, list);
    return { ...o, prog, claimed, locked, ready: !claimed && !locked && prog >= o.target };
  });
}
export function claimableCount(state, t = Date.now()) { return objectiveList(state, t).filter((o) => o.ready).length; }

/** Feed one UT match into every active objective. */
export function recordObjectiveMatch(state, m, t = Date.now()) {
  const ob = ensureObj(state);
  const list = catalog(t);
  const changed = [];
  for (const o of list) {
    if (['stat', 'flag'].includes(o.metric.type) || isClaimed(state, o) || isLocked(state, o, list)) continue;
    const g = metricGain(o.metric, m);
    if (!g) continue;
    const k = key(o);
    const before = ob.prog[k] || 0;
    ob.prog[k] = Math.min(o.target, before + g);
    if (before < o.target && ob.prog[k] >= o.target) changed.push(o);
  }
  // drop progress of expired buckets
  const live = new Set(list.map(key));
  for (const k of Object.keys(ob.prog)) if (!live.has(k)) delete ob.prog[k];
  return changed;
}

export function setFlag(state, flag) { ensureObj(state); state.flags[flag] = true; }

/** Claim an objective; returns reward labels (or null). */
export function claimObjectiveById(state, id, t = Date.now()) {
  const list = objectiveList(state, t);
  const o = list.find((x) => x.id === id);
  if (!o || !o.ready) return null;
  if (o.bucket === 'legacy') state.obj[o.id] = true;
  else ensureObj(state).claimed[key(o)] = true;
  return grantReward(state, o.reward, `Objective: ${o.label}`);
}
