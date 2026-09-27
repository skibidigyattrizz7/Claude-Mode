// Chemistry + team rating. DOM-free.
import { FORMATIONS, positionFit } from './formations.js';
import { SPECIAL_CLUB_IDS } from './data.js';
import { managerMatches } from './managers.js';

/** Owner request: a Manager (core/managers.js) assigned to the squad contributes chemistry too, in both
 * styles. Classic has no per-player "manager" concept, so it gets one small flat team-level boost, scaled
 * to how many starters the manager actually matches; FC26 already scores per player, so the manager just
 * adds its own +1 there, capped by the usual 0-3 per player ceiling — see calcChemistry/calcChemistryFc26. */
function managerTeamBoost(manager, slots) {
  if (!manager) return 0;
  const matches = slots.filter((p) => p && managerMatches(manager, p)).length;
  return matches >= 7 ? 3 : matches >= 4 ? 2 : matches >= 1 ? 1 : 0;
}

/** Legends of the Game (and classic Legends) link to every league; LOTG are always green with their nation. */
const linksAll = (p) => p.special === 'legend' || p.special === 'lotg' || !!p.linkAll;

/** Link strength between two players: 0 (red), 1 (orange), 2 (green). */
export function linkStrength(a, b) {
  if (!a || !b) return null;
  let s = 0;
  if (a.nat === b.nat) s++;
  if (linksAll(a) || linksAll(b) || a.league === b.league) s++;
  if (a.club === b.club && !SPECIAL_CLUB_IDS.has(a.club)) s++;
  return s >= 2 ? 2 : s;
}

export const LINK_COLORS = ['red', 'orange', 'green'];

/**
 * @param formation formation name
 * @param slots array[11] of player objects (or null)
 * @returns {{ players:number[], links:{a,b,strength,color}[], total:number, scaled:number, fits:number[] }}
 */
export function calcChemistry(formation, slots, manager = null) {
  const f = FORMATIONS[formation];
  const links = [];
  const sum = new Array(11).fill(0), cnt = new Array(11).fill(0);
  for (const [a, b] of f.links) {
    const s = linkStrength(slots[a], slots[b]);
    if (s === null) { links.push({ a, b, strength: null, color: 'none' }); continue; }
    links.push({ a, b, strength: s, color: LINK_COLORS[s] });
    sum[a] += s; cnt[a]++; sum[b] += s; cnt[b]++;
  }
  const players = [], fits = [];
  let total = 0;
  for (let i = 0; i < 11; i++) {
    const p = slots[i];
    if (!p) { players.push(0); fits.push(0); continue; }
    const fit = positionFit(p, f.slots[i].pos);
    fits.push(fit);
    let base = 0;
    if (cnt[i] > 0) {
      const avg = sum[i] / cnt[i];
      base = avg >= 1.5 ? 3 : avg >= 0.9 ? 2 : avg >= 0.4 ? 1 : 0;
    }
    if (p.special === 'legend' || p.special === 'hero') base = Math.min(3, base + 1);
    if (p.special === 'lotg' || p.linkAll) base = 3; // LOTG perk (also promo versions of LOTG cards): full chemistry in any of their positions
    const chem = fit >= 1 ? base : 0; // any listed position counts as in-position; out of position = 0
    players.push(chem);
    total += chem;
  }
  total = Math.min(33, total + managerTeamBoost(manager, slots));
  return { players, links, total, scaled: Math.round((total / 33) * 100), fits, manager: manager ? manager.id : null };
}

// ---------------------------------------------------------------------------------------------------
// FC26-style chemistry (owner request, Sep 26): no formation adjacency/links — each player's chemistry
// is the best of three whole-XI counts (how many of his 10 teammates share his club / league / nation),
// tiered the same way the classic link system tiers a link (thresholds below), still 0-3 per player and
// 0-33/scaled-100 total, still zeroed by being out of position, and legends/LOTG still apply.
// ---------------------------------------------------------------------------------------------------
const FC26_CLUB_T = [2, 4, 7];
const FC26_LEAGUE_T = [3, 5, 8];
const FC26_NATION_T = [2, 4, 7];
const tierFor = (count, thresholds) => Math.min(3, thresholds.filter((t) => count >= t).length);

export function calcChemistryFc26(formation, slots, manager = null) {
  const f = FORMATIONS[formation];
  const present = slots.map((p, i) => (p ? { p, i } : null)).filter(Boolean);
  const players = [], fits = [];
  let total = 0;
  for (let i = 0; i < 11; i++) {
    const p = slots[i];
    if (!p) { players.push(0); fits.push(0); continue; }
    const fit = positionFit(p, f.slots[i].pos);
    fits.push(fit);
    let clubC = 0, leagueC = 0, natC = 0;
    for (const { p: o, i: j } of present) {
      if (j === i) continue;
      if (p.nat === o.nat) natC++;
      if (linksAll(p) || linksAll(o) || p.league === o.league) leagueC++;
      if (p.club === o.club && !SPECIAL_CLUB_IDS.has(p.club)) clubC++;
    }
    let base = Math.max(tierFor(clubC, FC26_CLUB_T), tierFor(leagueC, FC26_LEAGUE_T), tierFor(natC, FC26_NATION_T));
    if (p.special === 'legend' || p.special === 'hero') base = Math.min(3, base + 1);
    if (p.special === 'lotg' || p.linkAll) base = 3;
    if (managerMatches(manager, p)) base = Math.min(3, base + 1); // owner request: manager nation/league/club match = +1
    const chem = fit >= 1 ? base : 0;
    players.push(chem);
    total += chem;
  }
  return { players, links: [], total, scaled: Math.round((total / 33) * 100), fits, style: 'fc26', manager: manager ? manager.id : null };
}

export const CHEM_STYLES = ['classic', 'fc26'];
/** Pick the chemistry calculation by style ('classic' link-based, or 'fc26' whole-XI counts). Unknown/missing
 * style falls back to 'classic' so every existing caller keeps its current behaviour. `manager` (a Manager
 * object from core/managers.js, or null) is optional and backward-compatible for every existing caller. */
export function calcChemistryStyled(formation, slots, style = 'classic', manager = null) {
  return style === 'fc26' ? calcChemistryFc26(formation, slots, manager) : calcChemistry(formation, slots, manager);
}

/** FIFA-style team rating: average plus over-average bonus. Missing players count as 0. */
export function teamRating(players) {
  const list = players.filter(Boolean);
  if (!list.length) return 0;
  const vals = [];
  for (let i = 0; i < 11; i++) vals.push(players[i] ? players[i].ovr : 0);
  const sum = vals.reduce((a, b) => a + b, 0);
  const avg = sum / 11;
  let excess = 0;
  for (const v of vals) if (v > avg) excess += v - avg;
  return Math.min(99, Math.floor((sum + excess) / 11));
}
