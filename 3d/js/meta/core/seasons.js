// Season progression track shared by every mode: XP from each match -> 30 levels with coin/pack/pick
// rewards. Seasons last 6 weeks (real calendar). Stored under `pitchside.season`. DOM-free.
import { load, save } from './storage.js';
import { weekNumber, EPOCH } from './calendar.js';

export const SEASON_KEY = 'season';
export const SEASON_LEVELS = 30;
export const XP_PER_LEVEL = 1000;
export const SEASON_WEEKS = 6;

export function seasonNumber(t = Date.now()) { return Math.floor((weekNumber(t) - 1) / SEASON_WEEKS) + 1; }
export function seasonEnds(season) { return EPOCH + season * SEASON_WEEKS * 7 * 86400000; }

/** Reward for reaching `level` (1..30). Every 10th level is a highlight. */
export function levelReward(level) {
  if (level === 30) return { pick: { pool: 'icon', n: 3, label: 'Icon Player Pick' } };
  if (level === 20) return { pick: { pool: 'star', n: 3, label: 'Star Player Pick' } };
  if (level === 10) return { pack: 'premium', coins: 5000 };
  if (level === 25) return { pack: 'stars' };
  if (level === 15) return { pack: 'rare' };
  if (level % 5 === 0) return { pack: 'premium' };
  if (level % 2 === 0) return { coins: 750 + level * 150 };
  return { pack: level < 9 ? 'silver' : 'gold' };
}

export function newSeason(t = Date.now()) { return { season: seasonNumber(t), xp: 0, claimed: [], matches: 0, log: [] }; }
export function loadSeason(t = Date.now()) {
  let s = load(SEASON_KEY, null);
  if (!s || typeof s !== 'object' || s.season !== seasonNumber(t)) s = newSeason(t);
  s.claimed = Array.isArray(s.claimed) ? s.claimed : [];
  return s;
}
export function saveSeason(s) { return save(SEASON_KEY, s); }

export function levelOf(xp) { return Math.min(SEASON_LEVELS, Math.floor(xp / XP_PER_LEVEL)); }

/** XP for one match in any mode. */
export function matchXp({ outcome = 'L', goals = 0, mode = '' } = {}) {
  const base = 150 + (outcome === 'W' ? 150 : outcome === 'D' ? 60 : 0) + Math.min(5, goals) * 20;
  const bonus = { rivals: 1.3, draft: 1.2, tournament: 1.2, online: 1.3 }[mode] || 1;
  return Math.round(base * bonus);
}

/** Add XP; returns { xp, levelsGained:[levels] }. */
export function addXp(s, xp, why = '') {
  const before = levelOf(s.xp);
  s.xp = Math.min(SEASON_LEVELS * XP_PER_LEVEL, s.xp + Math.max(0, Math.round(xp)));
  s.matches = (s.matches || 0) + 1;
  s.log = [{ xp: Math.round(xp), why }].concat(s.log || []).slice(0, 12);
  const after = levelOf(s.xp);
  const levelsGained = [];
  for (let l = before + 1; l <= after; l++) levelsGained.push(l);
  return { xp, levelsGained };
}
export function claimableLevels(s) {
  const out = [];
  for (let l = 1; l <= levelOf(s.xp); l++) if (!s.claimed.includes(l)) out.push(l);
  return out;
}
export function markClaimed(s, level) { if (!s.claimed.includes(level)) s.claimed.push(level); }

/** Record a match (any mode) and persist. */
export function recordSeasonMatch(info) {
  const s = loadSeason();
  const r = addXp(s, matchXp(info), info.mode || 'match');
  saveSeason(s);
  return { ...r, season: s };
}
