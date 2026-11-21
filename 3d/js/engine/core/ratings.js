// Player match ratings: 6.0 baseline +/- contributions, soft-capped so that only an outstanding
// game (e.g. a hat-trick) approaches 10. DOM-free, pure (unit tested).
import { clamp } from './mathx.js';

/**
 * s: per-player stats {goals, assists, kp (key passes), shots, sot, passes, passAtt, tackles, int,
 *    saves, conceded, fouls, yellow, red, og, err, mins, touches, gk, def}
 * teamGoals / oppGoals: final score from this player's side.
 */
export function rateStats(s, teamGoals, oppGoals) {
  const n = (k) => +s[k] || 0;
  let r = 6.0;
  const g = n('goals');
  r += g * 1.1 + (g >= 3 ? 0.6 : 0);
  r += n('assists') * 0.75;
  r += Math.min(n('kp'), 6) * 0.2;
  r += Math.min(Math.max(0, n('sot') - g), 5) * 0.08;
  r -= Math.min(Math.max(0, n('shots') - n('sot')), 6) * 0.05;
  const pa = n('passAtt'), pc = n('passes');
  if (pa >= 4) r += clamp((pc / pa - 0.78) * 1.6, -0.6, 0.4);
  r += Math.min(pc, 60) * 0.005;
  r += Math.min(n('tackles'), 8) * 0.14 + Math.min(n('int'), 8) * 0.1;
  r -= n('fouls') * 0.08 + n('yellow') * 0.35 + n('red') * 1.6 + n('og') * 1.0 + n('err') * 0.6;
  const full = n('mins') >= 30;
  if (s.gk) r += Math.min(n('saves'), 9) * 0.3 - n('conceded') * 0.35 + (oppGoals === 0 && full ? 0.6 : 0);
  else if (s.def) r += oppGoals === 0 && full ? 0.3 : -Math.min(oppGoals, 4) * 0.08;
  r += teamGoals > oppGoals ? 0.25 : teamGoals < oppGoals ? -0.2 : 0;
  // short cameos stay close to the baseline
  if (n('mins') < 20) r = 6 + (r - 6) * Math.max(0.35, n('mins') / 20);
  // soft cap: 8.3 and above compresses toward 10
  if (r > 8.3) r = 8.3 + 1.7 * (1 - Math.exp(-(r - 8.3) / 1.5));
  return Math.round(clamp(r, 4, 10) * 10) / 10;
}

// pstats: {[playerId]: stats (with .team 0|1)}; score: [home, away]
export function computeRatings(pstats, score) {
  const out = {};
  for (const id in pstats) {
    const s = pstats[id];
    if ((s.mins || 0) < 0.5 && !s.touches) continue;
    out[id] = rateStats(s, score[s.team], score[1 - s.team]);
  }
  return out;
}

// player of the match: best rating; ties broken by goals, then assists
export function playerOfMatch(ratings, pstats) {
  let best = null, key = -1e9;
  for (const id in ratings) {
    const s = pstats[id] || {};
    const k = ratings[id] * 1000 + (s.goals || 0) * 10 + (s.assists || 0);
    if (k > key) { key = k; best = id; }
  }
  return best;
}
