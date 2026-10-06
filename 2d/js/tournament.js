// World Cup: 16 nations, 4 groups of 4, then quarter-finals, semi-finals and final.
// Pure logic (no DOM); persisted by the UI via storage.js.
import { TEAMS, teamByCode } from './data.js';

export const WC_KEY = 'touchline.worldcup.v1';
const GROUP_NAMES = ['A', 'B', 'C', 'D'];
const MD_PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
export const STAGE_LABEL = { group: 'Group stage', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final', done: 'Finished' };

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function newTournament(userCode, rng = Math.random) {
  const others = TEAMS.filter((t) => t.code !== userCode)
    .map((t) => ({ t, k: t.rating + rng() * 10 }))
    .sort((a, b) => b.k - a.k).slice(0, 15).map((x) => x.t);
  const field = [teamByCode(userCode), ...others].sort((a, b) => b.rating - a.rating);
  const pots = [0, 1, 2, 3].map((i) => shuffle(field.slice(i * 4, i * 4 + 4), rng));
  const groups = GROUP_NAMES.map((name, g) => ({ name, teams: pots.map((p) => p[g].code) }));
  return { v: 1, user: userCode, groups, results: [], stage: 'group', md: 0, ko: { qf: [], sf: [], final: [] }, champion: null, out: false };
}

/** Poisson-ish score simulation weighted by rating. */
export function simMatch(ra, rb, rng = Math.random, knockout = false) {
  const pois = (l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; };
  const la = 1.3 * Math.exp((ra - rb) / 22), lb = 1.3 * Math.exp((rb - ra) / 22);
  const a = pois(la), b = pois(lb);
  let pensA = null;
  if (knockout && a === b) pensA = rng() < 0.5 + (ra - rb) / 100;
  return { a, b, pensA };
}

export function groupOf(t, code) { return t.groups.findIndex((g) => g.teams.includes(code)); }

function fixturesForRound(t) {
  if (t.stage === 'group') {
    const out = [];
    t.groups.forEach((g) => MD_PAIRS[t.md].forEach(([i, j]) => out.push([g.teams[i], g.teams[j]])));
    return out;
  }
  return t.ko[t.stage] || [];
}

/** The user's next fixture, or null if eliminated / finished. */
export function nextUserFixture(t) {
  if (t.stage === 'done') return null;
  const f = fixturesForRound(t).find(([a, b]) => a === t.user || b === t.user);
  if (!f) return null;
  return { home: f[0], away: f[1], stage: t.stage, knockout: t.stage !== 'group', label: t.stage === 'group' ? `Group ${t.groups[groupOf(t, t.user)].name} · Matchday ${t.md + 1}` : STAGE_LABEL[t.stage] };
}

export function standings(t, gi) {
  const g = t.groups[gi];
  const rows = Object.fromEntries(g.teams.map((c) => [c, { code: c, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 }]));
  for (const r of t.results) {
    if (r.stage !== 'group' || !rows[r.home] || !rows[r.away]) continue;
    const h = rows[r.home], a = rows[r.away];
    h.P++; a.P++; h.GF += r.hg; h.GA += r.ag; a.GF += r.ag; a.GA += r.hg;
    if (r.hg > r.ag) { h.W++; a.L++; h.Pts += 3; } else if (r.hg < r.ag) { a.W++; h.L++; a.Pts += 3; } else { h.D++; a.D++; h.Pts++; a.Pts++; }
  }
  return Object.values(rows).map((r) => ({ ...r, GD: r.GF - r.GA }))
    .sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || teamByCode(y.code).rating - teamByCode(x.code).rating);
}

const winnerOf = (r) => (r.hg > r.ag ? r.home : r.hg < r.ag ? r.away : r.pens);

/**
 * Record the user's result for the current round (res = {gf, ga, pensWin} from the user's
 * perspective, or null when the user is not playing) and simulate all other fixtures.
 */
export function recordUserResult(t, res, rng = Math.random) {
  if (t.stage === 'done') return t;
  const ko = t.stage !== 'group';
  for (const [home, away] of fixturesForRound(t)) {
    let hg, ag, pens = null;
    if (res && (home === t.user || away === t.user)) {
      const userHome = home === t.user;
      hg = userHome ? res.gf : res.ga; ag = userHome ? res.ga : res.gf;
      if (ko && hg === ag) pens = res.pensWin ? t.user : (userHome ? away : home);
    } else {
      const s = simMatch(teamByCode(home).rating, teamByCode(away).rating, rng, ko);
      hg = s.a; ag = s.b;
      if (ko && hg === ag) pens = s.pensA ? home : away;
    }
    t.results.push({ stage: t.stage, md: t.md, home, away, hg, ag, pens });
  }
  advance(t);
  return t;
}

function advance(t) {
  const round = t.results.filter((r) => r.stage === t.stage);
  if (t.stage === 'group') {
    t.md++;
    if (t.md < 3) return;
    const pos = t.groups.map((_, gi) => standings(t, gi).map((r) => r.code));
    t.ko.qf = [[pos[0][0], pos[1][1]], [pos[1][0], pos[0][1]], [pos[2][0], pos[3][1]], [pos[3][0], pos[2][1]]];
    t.stage = 'qf';
    if (!t.ko.qf.flat().includes(t.user)) t.out = true;
    return;
  }
  const winners = round.map(winnerOf);
  if (t.stage === 'qf') { t.ko.sf = [[winners[0], winners[1]], [winners[2], winners[3]]]; t.stage = 'sf'; }
  else if (t.stage === 'sf') { t.ko.final = [[winners[0], winners[1]]]; t.stage = 'final'; }
  else if (t.stage === 'final') { t.champion = winners[0]; t.stage = 'done'; }
  if (t.stage !== 'done' && !t.ko[t.stage].flat().includes(t.user)) t.out = true;
  if (t.stage === 'done' && t.champion !== t.user) t.out = true;
}

export function resultFor(t, stage, a, b) {
  return t.results.find((r) => r.stage === stage && ((r.home === a && r.away === b) || (r.home === b && r.away === a)));
}
