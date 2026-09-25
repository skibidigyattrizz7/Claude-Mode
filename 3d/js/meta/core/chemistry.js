// Chemistry + team rating. DOM-free.
import { FORMATIONS, positionFit } from './formations.js';
import { SPECIAL_CLUB_IDS } from './data.js';

/** Icons and Legends link to every league (and Icons are always green with their own nation). */
const linksAll = (p) => p.special === 'legend' || p.special === 'icon';

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
export function calcChemistry(formation, slots) {
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
    if (p.special === 'legend' || p.special === 'hero' || p.special === 'icon') base = Math.min(3, base + 1);
    const chem = fit >= 1 ? base : 0; // any listed position counts as in-position; out of position = 0
    players.push(chem);
    total += chem;
  }
  return { players, links, total, scaled: Math.round((total / 33) * 100), fits };
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
