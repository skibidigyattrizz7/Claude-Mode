// Tournaments / Gauntlets: weekly 4-round knockout events vs AI with squad rules. DOM-free.
import { Rng } from './rng.js';
import { weekNumber } from './calendar.js';
import { aiOpponent } from './rivals.js';

export const EVENT_TEMPLATES = [
  { id: 'bronze-silver', name: 'Bronze & Silver Cup', desc: 'Only bronze and silver cards in your XI.', rules: [{ t: 'maxTier', v: 'silver' }], opp: { maxTier: 'silver', diffs: ['amateur', 'amateur', 'pro', 'pro'] } },
  { id: 'one-legend', name: 'Legends Showdown', desc: 'Max 1 Legend of the Game in your XI.', rules: [{ t: 'maxSpecial', special: 'lotg', v: 1 }], opp: { diffs: ['pro', 'world', 'world', 'legendary'] } },
  { id: 'nations', name: 'Nations Gauntlet', desc: 'At least 5 players from the same nation.', rules: [{ t: 'sameNation', v: 5 }], opp: { diffs: ['pro', 'world', 'world', 'legendary'] } },
  { id: 'youth', name: 'Rising Stars Cup', desc: 'Every starter aged 25 or under.', rules: [{ t: 'maxAge', v: 25 }], opp: { noSpecial: true, diffs: ['pro', 'pro', 'world', 'world'] } },
  { id: 'grassroots', name: 'Grassroots Gauntlet', desc: 'No special cards and team rating 80 or lower.', rules: [{ t: 'noSpecial' }, { t: 'maxRating', v: 80 }], opp: { noSpecial: true, diffs: ['pro', 'pro', 'world', 'world'] } },
  { id: 'league-pride', name: 'League Pride', desc: 'At least 7 players from one league.', rules: [{ t: 'sameLeague', v: 7 }], opp: { diffs: ['pro', 'world', 'world', 'legendary'] } },
];
export const EVENT_ROUNDS = ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
export const EVENT_REWARDS = [
  null,
  { coins: 2000 },
  { coins: 4000, pack: 'gold' },
  { coins: 7000, pack: 'premium' },
  { coins: 12000, pack: 'rare', pick: { pool: 'gold83', n: 3, label: '83+ Player Pick' } },
];

/** Three events live this week. */
export function activeEvents(week = weekNumber()) {
  const rng = new Rng(`events-${week}`);
  return rng.shuffle(EVENT_TEMPLATES.slice()).slice(0, 3);
}

function maxShared(players, key) { const m = new Map(); for (const p of players) m.set(p[key], (m.get(p[key]) || 0) + 1); return Math.max(0, ...m.values()); }
export function ruleLabel(r) {
  switch (r.t) {
    case 'maxTier': return 'Only bronze/silver players';
    case 'maxSpecial': return `Max ${r.v} Legend of the Game`;
    case 'sameNation': return `Min. ${r.v} from one nation`;
    case 'sameLeague': return `Min. ${r.v} from one league`;
    case 'maxAge': return `All starters aged ≤ ${r.v}`;
    case 'noSpecial': return 'No special cards';
    case 'maxRating': return `Team rating ≤ ${r.v}`;
    default: return r.t;
  }
}
/** Check rules against the XI (player objects). rating = team rating. */
export function checkRules(rules, slots, rating) {
  const ps = slots.filter(Boolean);
  return rules.map((r) => {
    let ok, cur;
    switch (r.t) {
      case 'maxTier': cur = ps.filter((p) => p.ovr >= 75 || p.special).length; ok = cur === 0; cur = `${ps.length - cur}/${ps.length}`; break;
      case 'maxSpecial': cur = ps.filter((p) => p.special === r.special).length; ok = cur <= r.v; break;
      case 'sameNation': cur = maxShared(ps, 'nat'); ok = cur >= r.v; break;
      case 'sameLeague': cur = maxShared(ps, 'league'); ok = cur >= r.v; break;
      case 'maxAge': cur = ps.filter((p) => p.age > r.v).length; ok = cur === 0; cur = `${ps.length - cur}/${ps.length}`; break;
      case 'noSpecial': cur = ps.filter((p) => p.special).length; ok = cur === 0; break;
      case 'maxRating': cur = rating; ok = rating <= r.v; break;
      default: ok = false; cur = '?';
    }
    return { label: ruleLabel(r), ok: ok && ps.length === 11, cur };
  });
}

export function ensureEvents(state, week = weekNumber()) {
  if (!state.events || state.events.week !== week) state.events = { week, runs: {} };
  return state.events;
}
export function eventRun(state, id) {
  const ev = ensureEvents(state);
  if (!ev.runs[id]) ev.runs[id] = { round: 0, wins: 0, done: false, claimed: false, results: [], attempts: 0 };
  return ev.runs[id];
}
export function eventOpponent(state, tpl, run) {
  const d = tpl.opp.diffs[run.round] || 'world';
  return aiOpponent(`ev-${state.events.week}-${tpl.id}-${run.attempts}-${run.round}`, d, { maxTier: tpl.opp.maxTier || null, noSpecial: !!tpl.opp.noSpecial, label: 'EVT' });
}
export function applyEventResult(run, outcome, meta = {}) {
  run.results.push({ round: run.round, outcome, ...meta });
  if (outcome === 'W') { run.wins++; run.round++; if (run.wins >= 4) run.done = true; }
  else run.done = true;
  return run;
}
export function eventReward(run) { return EVENT_REWARDS[Math.min(4, run.wins)]; }
/** Start again after finishing (rewards must be claimed first). */
export function resetRun(run) { Object.assign(run, { round: 0, wins: 0, done: false, claimed: false, results: [], attempts: (run.attempts || 0) + 1 }); }
