// Admin (owner-only) actions — DOM-free. Verification happens server-side via online.admin.verify(code);
// the UI only unlocks these after that check. No admin code is ever stored in the client.
import { getPlayer, computeOvr, POS_WEIGHTS, FACE, GKFACE, marketValue, weeklyWage } from './players.js';
import { SBCS, OBJECTIVES, grantReward, addToClub } from './ut.js';
import { userPlayers } from './career.js';

export const INFINITE_COINS = 999999999;

/** Grant any DB card (incl. Icons) to the UT club. Admin grants are untradeable (keeps the real market fair). */
export function grantPlayer(state, pid) {
  const p = getPlayer(pid);
  if (!p) return { ok: false, error: 'Unknown player' };
  if (state.club.includes(pid)) return { ok: false, error: 'Already in your club' };
  addToClub(state, pid);
  state.untradeable = state.untradeable || [];
  if (!state.untradeable.includes(pid)) state.untradeable.push(pid);
  return { ok: true, player: p };
}

/** Mark every non-repeatable SBC complete and grant its reward. */
export function completeAllSbcs(state) {
  const got = [];
  for (const sbc of SBCS) {
    if (sbc.repeatable || state.sbc[sbc.id] > 0) continue;
    state.sbc[sbc.id] = 1;
    state.stats.sbcDone++;
    got.push(...grantReward(state, sbc.reward, `Admin: ${sbc.name}`));
  }
  return got;
}

/** Push objective stats to their targets so every objective can be claimed. */
export function unlockAllObjectives(state) {
  let n = 0;
  for (const o of OBJECTIVES) {
    if ((state.stats[o.stat] || 0) < o.target) state.stats[o.stat] = o.target;
    if (!state.obj[o.id]) n++;
  }
  return n;
}

/** Max every relevant attribute of the user's career squad (99 overall). */
export function maxCareerRatings(career) {
  let n = 0;
  for (const p of userPlayers(career)) {
    if (p.pos === 'GK') for (const k of GKFACE) p.gk[k] = 99;
    else FACE.forEach((k, i) => { if (POS_WEIGHTS[p.pos][i] > 0) p.stats[k] = 99; });
    p.ovr = computeOvr(p.pos, p);
    p.pot = Math.max(p.pot, p.ovr);
    p.tier = 'gold';
    p.value = marketValue(p);
    p.wage = Math.max(p.wage || 0, weeklyWage(p));
    n++;
  }
  return n;
}

export function setCareerBudget(career, amount) {
  const v = Math.max(0, Math.round(Number(amount) || 0));
  career.budget = v;
  return v;
}
