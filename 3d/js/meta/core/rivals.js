// Rivals (UT ranked mode). Divisions 10 -> 1 then Elite (0). Win +3, draw +1, loss 0 points.
// Online: the server owns the ladder (online.rivals.status/claimWeekly). Offline / "AI Rival" matches
// use this local ladder, clearly labelled as local progress only. DOM-free.
import { Rng, clamp } from './rng.js';
import { weekNumber } from './calendar.js';
import { getDB } from './players.js';
import { bestLineup, buildTeam, gkKitFor, contrastColor } from './teams.js';
import { FORMATIONS } from './formations.js';
import { teamRating } from './chemistry.js';

export const ELITE = 0;
export const DIVISIONS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, ELITE];
export function divisionLabel(d) { return d === ELITE ? 'Elite' : `Division ${d}`; }

/** Points needed to rank up from division d (Elite has no rank-up). */
export function rankUpTarget(d) { return d === ELITE ? null : 8 + Math.ceil((10 - d) * 0.9); }
/** Checkpoints on the division bar: [stay, stay, rank-up] (Elite: weekly win markers). */
export function stageTargets(d) {
  const t = rankUpTarget(d);
  if (t === null) return [9, 15, 21];
  return [Math.round(t / 3), Math.round((2 * t) / 3), t];
}
/** Opponent difficulty for AI Rivals by division. */
export function aiDifficulty(d) {
  if (d === ELITE || d === 1) return 'legendary';
  if (d <= 4) return 'world';
  if (d <= 7) return 'pro';
  return 'amateur';
}
const TARGET = { amateur: 66, pro: 74, world: 80, legendary: 86 };

export function newRivals(week = weekNumber()) {
  return { division: 10, points: 0, week, weeklyWins: 0, weeklyPlayed: 0, history: [], milestones: [], pending: null, claimedWeek: null, best: 10 };
}
export function ensureRivals(state, week = weekNumber()) {
  if (!state.rivals || typeof state.rivals !== 'object') state.rivals = newRivals(week);
  rollWeek(state.rivals, week);
  return state.rivals;
}

/** Weekly reward tier from weekly wins: -1 none, 0 (1+ win), 1 (3+), 2 (5+), 3 (7+). */
export function weeklyTier(wins) { return wins >= 7 ? 3 : wins >= 5 ? 2 : wins >= 3 ? 1 : wins >= 1 ? 0 : -1; }
export const TIER_WINS = [1, 3, 5, 7];

/** Weekly reward by division and weekly wins. { coins, packs:[packId...], pick? } */
export function weeklyReward(division, wins) {
  const tier = weeklyTier(wins);
  if (tier < 0) return null;
  const rank = 10 - (division === ELITE ? -1 : division); // 0 (div 10) .. 11 (Elite)
  const coins = Math.round((1000 + rank * 650) * [0.5, 1, 1.5, 2.2][tier] / 50) * 50;
  const packs = [];
  const packTier = rank >= 11 ? ['premium', 'rare', 'rare', 'icon'] : rank >= 9 ? ['gold', 'premium', 'rare', 'stars'] : rank >= 6 ? ['gold', 'gold', 'premium', 'rare'] : rank >= 3 ? ['silver', 'gold', 'gold', 'premium'] : ['bronze', 'silver', 'gold', 'gold'];
  packs.push(packTier[tier]);
  if (tier >= 2) packs.push(rank >= 6 ? 'premium' : 'gold');
  const out = { coins, packs };
  if (tier >= 3) out.pick = { pool: rank >= 9 ? 'star' : 'gold83', n: 3, label: rank >= 9 ? 'Star Player Pick' : '83+ Player Pick' };
  return out;
}

/** Milestone reward for reaching a new best division. */
export function milestoneReward(newDiv) {
  const rank = 10 - (newDiv === ELITE ? -1 : newDiv);
  return { coins: 1000 + rank * 600, pack: rank >= 11 ? 'rare' : rank >= 8 ? 'premium' : rank >= 4 ? 'gold' : 'silver' };
}

/** New week: previous week's unclaimed reward becomes pending; weekly counters reset. */
export function rollWeek(r, week = weekNumber()) {
  if (r.week === week) return false;
  if (r.claimedWeek !== r.week && weeklyTier(r.weeklyWins) >= 0) r.pending = { week: r.week, division: r.division, wins: r.weeklyWins };
  r.week = week; r.weeklyWins = 0; r.weeklyPlayed = 0;
  return true;
}

/** Claimable now? (last week's pending reward, or 3+ wins this week and not yet claimed). */
export function claimableWeekly(r) {
  if (r.pending) return { ...r.pending, reward: weeklyReward(r.pending.division, r.pending.wins) };
  if (weeklyTier(r.weeklyWins) >= 1 && r.claimedWeek !== r.week) return { week: r.week, division: r.division, wins: r.weeklyWins, reward: weeklyReward(r.division, r.weeklyWins) };
  return null;
}
/** Mark the weekly reward claimed; returns the reward (caller grants it). */
export function takeWeekly(r) {
  const c = claimableWeekly(r);
  if (!c) return null;
  if (r.pending) r.pending = null; else r.claimedWeek = r.week;
  return c.reward;
}

/** Apply a local result. outcome 'W'|'D'|'L'. Returns { points, rankedUp, milestone }. */
export function applyRivalsResult(r, outcome, meta = {}) {
  const pts = outcome === 'W' ? 3 : outcome === 'D' ? 1 : 0;
  r.points += pts;
  r.weeklyPlayed++;
  if (outcome === 'W') r.weeklyWins++;
  let rankedUp = false, milestone = null;
  const t = rankUpTarget(r.division);
  if (t !== null && r.points >= t) {
    r.division = r.division === 1 ? ELITE : r.division - 1;
    r.points = 0;
    rankedUp = true;
    const better = r.best === undefined || (r.division === ELITE ? r.best !== ELITE : (r.best !== ELITE && r.division < r.best));
    if (better && !r.milestones.includes(r.division)) { r.milestones.push(r.division); milestone = milestoneReward(r.division); }
    r.best = r.division === ELITE || r.best === ELITE ? ELITE : Math.min(r.best ?? 10, r.division);
  }
  r.history.unshift({ outcome, pts, gf: meta.gf ?? null, ga: meta.ga ?? null, opp: meta.opp || '', ai: !!meta.ai, div: r.division });
  r.history = r.history.slice(0, 20);
  return { points: pts, rankedUp, milestone };
}

const ADJ = ['Rival', 'Northern', 'Southern', 'Royal', 'Atomic', 'Crimson', 'Shadow', 'Harbour', 'Summit', 'Storm'];
const NOUN = ['United', 'Athletic', 'Rangers', 'Dynamos', 'Wanderers', 'Comets', 'Titans', 'Falcons', 'Sporting', 'Albion'];
const COLS = ['#E63946', '#1D3557', '#2A9D8F', '#F4A261', '#8338EC', '#FFBE0B', '#3A86FF', '#FB5607', '#06D6A0', '#EF476F', '#FFFFFF', '#111111'];

/** Deterministic AI opponent (squad-battles style). */
export function aiOpponent(seed, difficulty, { maxTier = null, noSpecial = false, label = 'AI' } = {}) {
  const rng = new Rng(`aiopp-${seed}`);
  const db = getDB();
  const target = (TARGET[difficulty] || 74) + rng.int(-2, 2);
  const pool = db.all.filter((p) => Math.abs(p.ovr - target) <= 4 && (!noSpecial || !p.special) && (!p.special || difficulty === 'legendary')
    && (!maxTier || (maxTier === 'silver' ? p.ovr < 75 && !p.special : true)));
  const grp = (p) => (p.pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p.pos) ? 'DEF' : ['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(p.pos) ? 'MID' : 'ATT');
  const picked = [];
  const want = { GK: 2, DEF: 7, MID: 7, ATT: 5 };
  for (const g of Object.keys(want)) {
    const gp = pool.filter((p) => grp(p) === g);
    const src = gp.length ? gp : db.players.filter((p) => grp(p) === g && Math.abs(p.ovr - target) <= 8);
    for (let i = 0; i < want[g]; i++) picked.push(rng.pick(src));
  }
  const uniq = [...new Map(picked.map((p) => [p.id, p])).values()];
  const formation = rng.pick(Object.keys(FORMATIONS));
  const { slots, bench } = bestLineup(uniq, formation);
  const c1 = rng.pick(COLS); let c2 = rng.pick(COLS); while (c2 === c1) c2 = rng.pick(COLS);
  const name = `${rng.pick(ADJ)} ${rng.pick(NOUN)}`;
  const kit = { primary: c1, secondary: c2, number: contrastColor(c1), shorts: c2, socks: c1 };
  const away = { primary: c2, secondary: c1, number: contrastColor(c2), shorts: c1, socks: c2 };
  const id = `${label}-${seed}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const team = buildTeam({ id, name, short: name.split(' ').map((w) => w[0]).join('') + 'C', kit, gkKit: gkKitFor(kit, away), formation, starters: slots, bench, chemistry: clamp(rng.int(60, 100), 0, 100) });
  return { id, name, difficulty, rating: teamRating(slots), team, awayKit: away, colors: { primary: c1, secondary: c2 } };
}
