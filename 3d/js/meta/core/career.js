// Career Mode — pure logic (season, fixtures, table, cup, squad, transfers, youth, season end). DOM-free.
import { Rng, clamp, hashStr } from './rng.js';
import { CLUBS, CLUB_BY_ID, LEAGUE_BY_ID, NATION_BY_CODE } from './data.js';
import { getDB, adjustOvr, marketValue, weeklyWage, genProspect, niceRound } from './players.js';
import { FORMATIONS, FORMATION_NAMES, effectiveOvr } from './formations.js';
import { calcChemistry, teamRating } from './chemistry.js';
import { buildTeam, bestLineup, clubKits, gkKitFor, resolveKitClash } from './teams.js';
import { simulateMatch, penaltyShootout } from './sim.js';
import { load, save, remove } from './storage.js';

export const SLOTS = [1, 2, 3];
export const CUP_ROUNDS = ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];
export const CUP_AFTER_MD = [3, 7, 11, 15];
export const WINTER_AFTER_MD = 9;
export const START_YEAR = 2026;

// ---------- save slots ----------
export function slotKey(slot) { return `career.slot${slot}`; }
export function listSlots() {
  return SLOTS.map((s) => {
    const st = load(slotKey(s), null);
    if (!st) return { slot: s, empty: true };
    const c = st.clubs[st.userClub];
    return { slot: s, empty: false, club: c.name, clubId: st.userClub, season: st.season, year: st.year, manager: st.manager, saved: st.savedAt, phase: st.phase };
  });
}
export function saveCareer(state) {
  state.savedAt = Date.now();
  return save(slotKey(state.slot), state);
}
export function loadCareer(slot) { return load(slotKey(slot), null); }
export function deleteCareer(slot) { remove(slotKey(slot)); }

// ---------- helpers ----------
const rngFor = (state, tag) => new Rng(`${state.seed}|${state.season}|${state.calIdx}|${tag}|${state.rngTick = (state.rngTick || 0) + 1}`);
export const seasonLabel = (state) => `${state.year}/${String((state.year + 1) % 100).padStart(2, '0')}`;

function freshPlayer(p, rng) {
  const q = structuredClone(p);
  Object.assign(q, {
    fitness: 100, morale: clamp(Math.round(rng.normal(72, 8)), 45, 95), form: [], injury: 0,
    goals: 0, apps: 0, rSum: 0, rN: 0, xp: 0, contract: rng.int(1, 5), listed: false,
    careerGoals: 0, careerApps: 0,
  });
  return q;
}

export function clubPlayers(state, clubId) {
  return Object.values(state.players).filter((p) => p.club === clubId);
}
export function userPlayers(state) { return clubPlayers(state, state.userClub); }

function roundRobin(ids, rng) {
  const t = ids.slice();
  rng.shuffle(t);
  if (t.length % 2) t.push(null);
  const n = t.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const md = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i], b = t[n - 1 - i];
      if (a && b) md.push((r + i) % 2 === 0 ? { h: a, a: b } : { h: b, a: a });
    }
    rounds.push(md);
    t.splice(1, 0, t.pop());
  }
  const second = rounds.map((md) => md.map((m) => ({ h: m.a, a: m.h })));
  return rounds.concat(second);
}

function makeFixtures(state, rng) {
  state.fixtures = {};
  for (const tier of [1, 2]) {
    const rr = roundRobin(state.tiers[tier], rng);
    state.fixtures[tier] = rr.map((md, i) => md.map((m, k) => ({ id: `L${tier}-${i + 1}-${k}`, md: i + 1, h: m.h, a: m.a, hg: null, ag: null, played: false, scorers: [] })));
  }
}

function makeCup(state, rng) {
  const t2 = state.tiers[2].slice().sort((a, b) => state.clubs[b].rep - state.clubs[a].rep).slice(0, 6);
  const entrants = rng.shuffle(state.tiers[1].concat(t2));
  const r0 = [];
  for (let i = 0; i < entrants.length; i += 2) r0.push({ id: `C0-${i / 2}`, h: entrants[i], a: entrants[i + 1], hg: null, ag: null, pens: null, winner: null, played: false, scorers: [] });
  state.cup = { rounds: [r0], winner: null };
}

function makeCalendar(state) {
  const cal = [];
  const mds = state.fixtures[1].length;
  for (let md = 1; md <= mds; md++) {
    cal.push({ type: 'league', md });
    const ci = CUP_AFTER_MD.indexOf(md);
    if (ci >= 0) cal.push({ type: 'cup', round: ci });
  }
  state.calendar = cal;
  state.calIdx = 0;
}

export function clubStrength(state, clubId) {
  const ps = clubPlayers(state, clubId).filter((p) => !p.injury);
  const { slots } = bestLineup(ps, state.clubs[clubId].formation, { benchSize: 0 });
  return teamRating(slots);
}

function boardObjectives(state) {
  const club = state.clubs[state.userClub];
  const tierClubs = state.tiers[club.tier].slice().sort((a, b) => clubStrength(state, b) - clubStrength(state, a));
  const expected = tierClubs.indexOf(state.userClub) + 1;
  const objs = [];
  if (club.tier === 1) {
    const target = expected <= 1 ? 1 : expected <= 3 ? 3 : expected <= 6 ? Math.min(6, expected + 1) : 8;
    objs.push({ id: 'league', text: target === 1 ? 'Win the league title' : target === 8 ? 'Avoid relegation (finish 8th or higher)' : `Finish in the top ${target}`, target });
  } else {
    const target = expected <= 3 ? 2 : Math.min(6, expected + 1);
    objs.push({ id: 'league', text: target <= 2 ? 'Win promotion (finish top 2)' : `Finish in the top ${target}`, target });
  }
  const cupTarget = club.rep >= 4 ? 2 : club.rep >= 3 ? 1 : 0;
  objs.push({ id: 'cup', text: `Reach the ${CUP_ROUNDS[cupTarget + 1] || 'Quarter-finals'} of the Cup`, target: cupTarget });
  objs.push({ id: 'youth', text: 'Give 5+ appearances to a player aged 21 or under', target: 5 });
  return objs;
}

function baseBudget(club) {
  return niceRound((club.rep * club.rep * 3.2 + (club.tier === 1 ? 4 : 1)) * 1e6);
}

// ---------- creation ----------
export function newCareer({ clubId, manager = 'Manager', slot = 1, seed = null }) {
  const club0 = CLUB_BY_ID[clubId];
  const lg = LEAGUE_BY_ID[club0.league];
  const s = seed ?? `${clubId}-${Date.now()}`;
  const rng = new Rng(`career-${s}`);
  const db = getDB();
  const state = {
    v: 1, slot, seed: String(s), manager, league: lg.id, leagueName: lg.name, tier2Name: lg.tier2Name,
    userClub: clubId, season: 1, year: START_YEAR, phase: 'season', clubs: {}, tiers: { 1: [], 2: [] },
    players: {}, lineup: null, news: [], offers: [], youth: [], history: [], nextId: 1,
    settings: { halfMinutes: 3, difficulty: 'pro' }, boardConfidence: 60,
  };
  const leagueClubs = CLUBS.filter((c) => c.league === lg.id);
  for (const c of leagueClubs) {
    state.clubs[c.id] = {
      id: c.id, name: c.name, short: c.short, colors: c.colors, rep: c.rep, tier: c.tier,
      formation: FORMATION_NAMES[hashStr(c.id) % FORMATION_NAMES.length],
    };
    state.tiers[c.tier].push(c.id);
  }
  for (const p of db.players) if (state.clubs[p.club]) state.players[p.id] = freshPlayer(p, rng);
  // squad numbers
  for (const cid of Object.keys(state.clubs)) assignSquadNumbers(state, cid);
  const uc = state.clubs[clubId];
  state.budget = baseBudget(uc);
  state.wageBudget = niceRound(userPlayers(state).reduce((a, p) => a + p.wage, 0) * 1.15);
  makeFixtures(state, rng);
  makeCup(state, rng);
  makeCalendar(state);
  autoLineup(state);
  state.objectives = boardObjectives(state);
  state.baseBudget = state.budget;
  addNews(state, `Welcome to ${uc.name}, boss! The board have set your objectives for ${seasonLabel(state)}.`);
  addNews(state, `Summer transfer window is open. Budget: ${money(state.budget)}.`);
  generateOffers(state, rng, 2);
  return state;
}

function assignSquadNumbers(state, clubId) {
  const ps = clubPlayers(state, clubId).sort((a, b) => b.ovr - a.ovr);
  const club = state.clubs[clubId];
  const { slots } = bestLineup(ps, club.formation, { benchSize: 0 });
  const used = new Set(ps.filter((p) => p.number).map((p) => p.number));
  const pref = { GK: [1, 13, 25], RB: [2, 22], LB: [3, 23], CB: [4, 5, 6, 15], CDM: [6, 16], CM: [8, 14, 18], CAM: [10, 20], LM: [11, 17], RM: [7, 17], LW: [11, 17], RW: [7, 19], ST: [9, 19, 29], CF: [9, 10] };
  const order = slots.filter(Boolean).concat(ps.filter((p) => !slots.includes(p)));
  for (const p of order) {
    if (p.number) continue;
    let n = (pref[p.pos] || []).find((x) => !used.has(x));
    if (!n) { n = 12; while (used.has(n)) n++; }
    used.add(n); p.number = n;
  }
}

export function money(v) {
  if (Math.abs(v) >= 1e6) return `€${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1e3) return `€${Math.round(v / 1e3)}K`;
  return `€${Math.round(v)}`;
}
export function addNews(state, text, kind = 'info') {
  state.news.unshift({ text, kind, season: state.season, cal: state.calIdx });
  state.news = state.news.slice(0, 60);
}

// ---------- lineup ----------
export function autoLineup(state, formation = null) {
  const ps = userPlayers(state).filter((p) => !p.injury);
  let bestF = formation, best = null;
  const tryF = formation ? [formation] : FORMATION_NAMES;
  for (const f of tryF) {
    const res = bestLineup(ps, f, { score: (p, pos) => effectiveOvr(p, pos) * (0.9 + p.fitness / 1000) });
    const r = res.slots.reduce((a, p, i) => a + (p ? effectiveOvr(p, FORMATIONS[f].slots[i].pos) : 0), 0);
    if (!best || r > best.r) { best = { ...res, r }; bestF = f; }
  }
  state.lineup = {
    formation: bestF,
    slots: best.slots.map((p) => (p ? p.id : null)),
    bench: Array.from({ length: 7 }, (_, i) => (best.bench[i] ? best.bench[i].id : null)),
  };
  return state.lineup;
}

/** Repair the user lineup (missing, injured or sold players). Returns list of changes. */
export function ensureLineup(state) {
  const L = state.lineup;
  const changes = [];
  if (!L) { autoLineup(state); return ['Lineup auto-selected']; }
  const mine = new Map(userPlayers(state).map((p) => [p.id, p]));
  const used = new Set();
  L.slots = L.slots.map((id) => (id && mine.has(id) && !mine.get(id).injury && !used.has(id) ? (used.add(id), id) : null));
  L.bench = L.bench.map((id) => (id && mine.has(id) && !mine.get(id).injury && !used.has(id) ? (used.add(id), id) : null));
  const f = FORMATIONS[L.formation];
  for (let i = 0; i < 11; i++) {
    if (L.slots[i]) continue;
    const pos = f.slots[i].pos;
    const cands = [...mine.values()].filter((p) => !p.injury && !used.has(p.id) && (i === 0 ? p.pos === 'GK' : p.pos !== 'GK'));
    cands.sort((a, b) => effectiveOvr(b, pos) - effectiveOvr(a, pos));
    const pick = cands[0] || [...mine.values()].find((p) => !used.has(p.id));
    if (pick) {
      L.slots[i] = pick.id; used.add(pick.id);
      const bi = L.bench.indexOf(pick.id); if (bi >= 0) L.bench[bi] = null;
      changes.push(`${pick.name} drafted in at ${pos}`);
    }
  }
  // refill bench
  const rest = [...mine.values()].filter((p) => !p.injury && !L.slots.includes(p.id) && !L.bench.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  for (let i = 0; i < 7; i++) if (!L.bench[i] && rest.length) L.bench[i] = rest.shift().id;
  return changes;
}

function scaleFor(p) {
  const fit = p.fitness ?? 100, mor = p.morale ?? 70;
  return clamp(1 - Math.max(0, 75 - fit) / 250 + (mor - 65) / 1500, 0.82, 1.03);
}

/** Contract Team for any club in the career world. */
export function careerTeam(state, clubId) {
  const club = state.clubs[clubId];
  const kits = clubKits({ id: clubId, colors: club.colors });
  let formation, starters, bench;
  if (clubId === state.userClub) {
    ensureLineup(state);
    formation = state.lineup.formation;
    starters = state.lineup.slots.map((id) => state.players[id]);
    bench = state.lineup.bench.filter(Boolean).map((id) => state.players[id]);
  } else {
    formation = club.formation;
    const ps = clubPlayers(state, clubId).filter((p) => !p.injury);
    const res = bestLineup(ps, formation, { score: (p, pos) => effectiveOvr(p, pos) * (0.9 + (p.fitness ?? 100) / 1000) });
    starters = res.slots; bench = res.bench;
  }
  const numbers = {};
  for (const p of starters.concat(bench)) if (p && p.number) numbers[p.id] = p.number;
  const team = buildTeam({
    id: clubId, name: club.name, short: club.short, kit: kits.home, gkKit: gkKitFor(kits.home, kits.away),
    formation, starters, bench, numbers, scale: scaleFor,
    chemistry: 70 + Math.round(clamp(calcChemistry(formation, starters).scaled - 50, -20, 30)),
  });
  return { team, away: kits.away };
}

export function matchTeams(state, h, a) {
  const H = careerTeam(state, h), A = careerTeam(state, a);
  A.team.kit = resolveKitClash(H.team.kit, A.team.kit, A.away);
  A.team.gkKit = gkKitFor(H.team.kit, A.team.kit, H.team.gkKit);
  return { home: H.team, away: A.team };
}

// ---------- calendar queries ----------
export function currentEvent(state) { return state.calendar[state.calIdx] || null; }

export function eventFixtures(state, ev) {
  if (!ev) return [];
  if (ev.type === 'league') {
    const out = [];
    for (const tier of [1, 2]) { const md = state.fixtures[tier][ev.md - 1]; if (md) out.push(...md.map((f) => ({ ...f, tier, ref: f }))); }
    return out;
  }
  const r = state.cup.rounds[ev.round] || [];
  return r.map((f) => ({ ...f, cup: true, ref: f }));
}

/** The user's fixture in the current event, or null. */
export function userFixture(state) {
  const ev = currentEvent(state);
  if (!ev) return null;
  const f = eventFixtures(state, ev).find((x) => x.h === state.userClub || x.a === state.userClub);
  return f ? { fixture: f.ref, ev, cup: !!f.cup, home: f.h === state.userClub } : null;
}

export function transferWindow(state) {
  if (state.phase !== 'season') return null;
  const done = state.calendar.slice(0, state.calIdx).filter((e) => e.type === 'league');
  const last = done.length ? done[done.length - 1].md : 0;
  if (last === 0) return 'Summer';
  if (last === WINTER_AFTER_MD) return 'Winter';
  return null;
}

// ---------- match processing ----------
function recordFixture(state, fx, home, away, result, cup, rng) {
  fx.hg = result.homeGoals; fx.ag = result.awayGoals; fx.played = true;
  const idToClub = {};
  for (const p of home.players.concat(home.bench)) idToClub[p.id] = fx.h;
  for (const p of away.players.concat(away.bench)) idToClub[p.id] = fx.a;
  fx.scorers = (result.scorers || []).map((s) => ({ pid: s.playerId, club: s.team === 'home' ? fx.h : fx.a, minute: s.minute }));
  if (cup) {
    if (fx.hg === fx.ag) {
      fx.pens = result.pens || penaltyShootout(home, away, rng);
      fx.winner = fx.pens.winner === 'home' ? fx.h : fx.a;
    } else fx.winner = fx.hg > fx.ag ? fx.h : fx.a;
  }
  // player stats (all clubs)
  const ratings = result.playerRatings || {};
  const played = new Set(home.players.concat(away.players).map((p) => p.id));
  for (const id of Object.keys(ratings)) played.add(id);
  for (const id of played) {
    const p = state.players[id];
    if (!p) continue;
    const r = ratings[id] ?? 6.0;
    p.apps++; p.careerApps = (p.careerApps || 0) + 1; p.rSum += r; p.rN++;
    p.form = (p.form || []).concat(r).slice(-5);
  }
  for (const s of fx.scorers) {
    const p = state.players[s.pid];
    if (p && !(s.own)) { p.goals++; p.careerGoals = (p.careerGoals || 0) + 1; }
  }
  if (fx.h === state.userClub || fx.a === state.userClub) userPostMatch(state, fx, played, ratings, rng);
}

function userPostMatch(state, fx, played, ratings, rng) {
  const home = fx.h === state.userClub;
  const gf = home ? fx.hg : fx.ag, ga = home ? fx.ag : fx.hg;
  const won = fx.winner ? fx.winner === state.userClub : gf > ga;
  const lost = fx.winner ? fx.winner !== state.userClub : gf < ga;
  for (const p of userPlayers(state)) {
    if (played.has(p.id)) {
      p.fitness = clamp(p.fitness - rng.int(14, 24), 30, 100);
      p.morale = clamp(p.morale + (won ? 4 : lost ? -3 : 1), 15, 100);
      const r = ratings[p.id] ?? 6.0;
      if (r >= 7 && p.ovr < p.pot) {
        const ageF = p.age < 22 ? 1.6 : p.age < 25 ? 1.1 : p.age < 29 ? 0.6 : 0.2;
        p.xp += (r - 6.5) * 0.3 * ageF;
        if (p.xp >= 1) { p.xp -= 1; adjustOvr(p, 1); addNews(state, `${p.name} has improved to ${p.ovr} OVR after strong performances.`, 'good'); }
      }
      if (rng.chance(0.022)) {
        p.injury = rng.int(1, 5);
        addNews(state, `${p.name} picked up an injury and will miss ${p.injury} match${p.injury > 1 ? 'es' : ''}.`, 'bad');
      }
    } else {
      p.morale = clamp(p.morale - (p.ovr >= 75 ? 2 : 1), 15, 100);
    }
  }
}

function recoverAll(state) {
  for (const p of Object.values(state.players)) {
    if (p.club === state.userClub) p.fitness = clamp(p.fitness + 16, 0, 100);
    else p.fitness = 100;
    if (p.injury > 0) { p.injury--; if (p.injury === 0 && p.club === state.userClub) addNews(state, `${p.name} is back in training after injury.`, 'good'); }
  }
}

function nextCupRound(state, rng) {
  const rounds = state.cup.rounds;
  const last = rounds[rounds.length - 1];
  if (!last.every((f) => f.played)) return;
  const winners = last.map((f) => f.winner);
  if (winners.length === 1) { state.cup.winner = winners[0]; return; }
  rng.shuffle(winners);
  const ri = rounds.length;
  const nr = [];
  for (let i = 0; i < winners.length; i += 2) nr.push({ id: `C${ri}-${i / 2}`, h: winners[i], a: winners[i + 1], hg: null, ag: null, pens: null, winner: null, played: false, scorers: [] });
  rounds.push(nr);
}

/**
 * Process the current calendar event. userResult: contract match result for the user's fixture when played
 * in the 3D engine (omit to simulate it). Returns a summary.
 */
export function advance(state, userResult = null) {
  if (state.phase !== 'season') return null;
  const ev = currentEvent(state);
  if (!ev) return null;
  const rng = rngFor(state, 'advance');
  const fixtures = eventFixtures(state, ev);
  let userSummary = null;
  const lineupChanges = ensureLineup(state);
  for (const f of fixtures) {
    const fx = f.ref;
    if (fx.played) continue;
    const { home, away } = matchTeams(state, fx.h, fx.a);
    const isUser = fx.h === state.userClub || fx.a === state.userClub;
    const result = isUser && userResult ? userResult : simulateMatch(home, away, { rng, neutral: ev.type === 'cup' && ev.round === 3 });
    recordFixture(state, fx, home, away, result, ev.type === 'cup', rng);
    if (isUser) userSummary = { fixture: fx, home, away, result, ev };
  }
  if (ev.type === 'cup') nextCupRound(state, rng);
  recoverAll(state);
  state.calIdx++;
  if (userSummary) {
    const f = userSummary.fixture;
    const cn = (id) => state.clubs[id].name;
    addNews(state, `${ev.type === 'cup' ? 'Cup' : 'League'}: ${cn(f.h)} ${f.hg}–${f.ag} ${cn(f.a)}${f.pens ? ` (${f.pens.home}–${f.pens.away} pens)` : ''}`, 'match');
  }
  const win = transferWindow(state);
  if (win === 'Winter' && ev.type === 'league' && ev.md === WINTER_AFTER_MD) {
    addNews(state, 'The winter transfer window is now open until the next league matchday.', 'info');
    generateOffers(state, rng, 2);
  }
  if (state.calIdx >= state.calendar.length) endSeason(state);
  return { ev, user: userSummary, lineupChanges };
}

/** Advance repeatedly until the next event featuring the user (not processed) or season end. */
export function simToNextUserMatch(state) {
  let n = 0;
  while (state.phase === 'season' && currentEvent(state) && !userFixture(state) && n < 60) { advance(state); n++; }
  return n;
}

// ---------- tables & stats ----------
export function leagueTable(state, tier) {
  const rows = new Map(state.tiers[tier].map((id) => [id, { club: id, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0, form: [] }]));
  for (const md of state.fixtures[tier]) for (const f of md) {
    if (!f.played) continue;
    const h = rows.get(f.h), a = rows.get(f.a);
    if (!h || !a) continue;
    h.P++; a.P++; h.GF += f.hg; h.GA += f.ag; a.GF += f.ag; a.GA += f.hg;
    if (f.hg > f.ag) { h.W++; a.L++; h.Pts += 3; h.form.push('W'); a.form.push('L'); }
    else if (f.hg < f.ag) { a.W++; h.L++; a.Pts += 3; h.form.push('L'); a.form.push('W'); }
    else { h.D++; a.D++; h.Pts++; a.Pts++; h.form.push('D'); a.form.push('D'); }
  }
  const list = [...rows.values()];
  for (const r of list) { r.GD = r.GF - r.GA; r.form = r.form.slice(-5); }
  list.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || state.clubs[x.club].name.localeCompare(state.clubs[y.club].name));
  return list;
}

export function topScorers(state, tier = null, n = 10) {
  return Object.values(state.players)
    .filter((p) => p.goals > 0 && state.clubs[p.club] && (tier === null || state.clubs[p.club].tier === tier))
    .sort((a, b) => b.goals - a.goals || a.apps - b.apps).slice(0, n);
}
export function avgRating(p) { return p.rN ? p.rSum / p.rN : 0; }

// ---------- transfers ----------
function ownClubLevel(state) {
  const { slots } = bestLineup(userPlayers(state), state.lineup?.formation || '4-3-3', { benchSize: 0 });
  return teamRating(slots);
}

export function searchPlayers(state, { pos = '', minOvr = 0, maxOvr = 99, maxAge = 99, maxValue = 0, league = '', nat = '', name = '', minPot = 0 } = {}) {
  const db = getDB();
  const q = name.trim().toLowerCase();
  const inWorld = Object.values(state.players).filter((p) => p.club !== state.userClub);
  const outside = db.players.filter((p) => !state.clubs[p.club] && !state.players[p.id]);
  const all = inWorld.concat(outside);
  return all.filter((p) => p.ovr >= minOvr && p.ovr <= maxOvr && p.age <= maxAge && p.pot >= minPot
    && (!pos || p.pos === pos) && (!league || p.league === league) && (!nat || p.nat === nat)
    && (!maxValue || askingPrice(state, p) <= maxValue)
    && (!q || p.name.toLowerCase().includes(q) || p.last.toLowerCase().includes(q)))
    .sort((a, b) => b.ovr - a.ovr || a.age - b.age).slice(0, 60);
}

export function findPlayer(state, pid) {
  return state.players[pid] || getDB().byId.get(pid) || null;
}
export function clubNameOf(state, clubId) {
  return state.clubs[clubId]?.name || CLUB_BY_ID[clubId]?.name || 'Free agent';
}

export function askingPrice(state, p) {
  let ask = marketValue(p);
  if (state.clubs[p.club]) {
    const club = state.clubs[p.club];
    const { slots } = bestLineup(clubPlayers(state, p.club), club.formation, { benchSize: 0 });
    if (slots.some((s) => s && s.id === p.id)) ask *= 1.3;
    if ((p.contract ?? 3) <= 1) ask *= 0.75;
  } else ask *= 1.15;
  return niceRound(ask);
}

export function wageBill(state) { return userPlayers(state).reduce((a, p) => a + p.wage, 0); }

/** Make a bid. Returns { status: 'accepted'|'counter'|'rejected'|'refused'|'error', message, counter? } */
export function makeBid(state, pid, amount) {
  const win = transferWindow(state);
  if (!win) return { status: 'error', message: 'The transfer window is closed.' };
  const p = findPlayer(state, pid);
  if (!p || p.club === state.userClub) return { status: 'error', message: 'Invalid player.' };
  if (amount > state.budget) return { status: 'error', message: 'Bid exceeds your transfer budget.' };
  if (userPlayers(state).length >= 32) return { status: 'error', message: 'Squad is full (32 players). Sell or release someone first.' };
  const ask = askingPrice(state, p);
  const level = ownClubLevel(state);
  const clubRep = state.clubs[state.userClub].rep;
  if (p.ovr > level + 9 && amount < ask * 1.6 && clubRep < 4.5) {
    return { status: 'refused', message: `${p.name} is not interested in joining a club of your stature.` };
  }
  const newWage = Math.round(p.wage * 1.1);
  if (wageBill(state) + newWage > state.wageBudget * 1.02) {
    return { status: 'error', message: `Signing ${p.name} (${money(newWage)}/wk) would exceed your wage budget.` };
  }
  if (amount >= ask) {
    completeTransferIn(state, p, amount, newWage);
    return { status: 'accepted', message: `${clubNameOf(state, p.club)} accepted! ${p.name} joins for ${money(amount)}.` };
  }
  if (amount >= ask * 0.8) return { status: 'counter', counter: ask, message: `${clubNameOf(state, p.club)} want ${money(ask)} for ${p.name}.` };
  return { status: 'rejected', message: `${clubNameOf(state, p.club)} rejected your bid of ${money(amount)}.` };
}

function nextFreeNumber(state) {
  const used = new Set(userPlayers(state).map((p) => p.number));
  let n = 2; while (used.has(n)) n++;
  return n;
}

function completeTransferIn(state, src, fee, wage) {
  const rng = rngFor(state, 'tin');
  const fromClub = src.club;
  const fromName = clubNameOf(state, fromClub);
  let p = state.players[src.id];
  if (!p) { p = freshPlayer(src, rng); state.players[p.id] = p; }
  p.club = state.userClub; p.league = state.league;
  p.number = nextFreeNumber(state);
  p.contract = 4; p.wage = wage; p.morale = 85; p.listed = false; p.fitness = 100;
  state.budget -= fee;
  addNews(state, `Signed ${p.name} (${p.ovr} ${p.pos}) from ${fromName} for ${money(fee)}.`, 'good');
  if (state.clubs[fromClub]) refillClub(state, fromClub, rng);
  const L = state.lineup;
  const bi = L.bench.indexOf(null);
  if (bi >= 0) L.bench[bi] = p.id;
}

function refillClub(state, clubId, rng) {
  while (clubPlayers(state, clubId).length < 20) {
    const club = state.clubs[clubId];
    const lg = LEAGUE_BY_ID[state.league];
    const id = `rg${state.nextId++}_${state.seed.length}`;
    const p = genProspect(rng, { id, nat: rng.weighted(lg.home), club: clubId, league: state.league, age: rng.int(17, 20), quality: club.rep });
    state.players[id] = freshPlayer(p, rng);
    state.players[id].contract = 3;
    assignSquadNumbers(state, clubId);
  }
}

function generateOffers(state, rng, n) {
  const mine = userPlayers(state);
  if (!mine.length) return;
  const others = Object.keys(state.clubs).filter((c) => c !== state.userClub);
  for (let i = 0; i < n; i++) {
    const p = rng.chance(0.5) ? rng.pick(mine.filter((x) => x.listed).concat(mine)) : rng.pick(mine);
    if (!p || state.offers.some((o) => o.pid === p.id)) continue;
    const from = rng.chance(0.2) ? 'ABROAD' : rng.pick(others);
    const amount = niceRound(marketValue(p) * rng.range(0.85, 1.3));
    state.offers.push({ id: `of${state.nextId++}`, pid: p.id, from, amount });
    addNews(state, `${from === 'ABROAD' ? 'A club abroad' : state.clubs[from].name} bid ${money(amount)} for ${p.name}.`, 'offer');
  }
}

export function listPlayer(state, pid) {
  const p = state.players[pid];
  if (!p || p.club !== state.userClub) return null;
  p.listed = true;
  if (!transferWindow(state)) return { message: `${p.name} added to the transfer list. Offers will arrive when the window opens.` };
  const rng = rngFor(state, 'list');
  if (rng.chance(0.75)) {
    const others = Object.keys(state.clubs).filter((c) => c !== state.userClub);
    const from = rng.chance(0.3) ? 'ABROAD' : rng.pick(others);
    const amount = niceRound(marketValue(p) * rng.range(0.75, 1.1));
    state.offers.push({ id: `of${state.nextId++}`, pid, from, amount });
    return { message: `${from === 'ABROAD' ? 'A club abroad' : state.clubs[from].name} offered ${money(amount)} for ${p.name}. Check your offers.` };
  }
  return { message: `No immediate interest in ${p.name}. Offers may arrive in the next window.` };
}

export function respondOffer(state, offerId, accept) {
  const o = state.offers.find((x) => x.id === offerId);
  if (!o) return null;
  state.offers = state.offers.filter((x) => x !== o);
  const p = state.players[o.pid];
  if (!accept || !p || p.club !== state.userClub) {
    if (p) p.morale = clamp(p.morale - (accept ? 0 : 3), 15, 100);
    return { message: 'Offer rejected.' };
  }
  if (!transferWindow(state)) return { message: 'The window is closed; the deal fell through.' };
  if (userPlayers(state).length <= 16) return { message: 'Squad too small to sell (min 16 players).' };
  state.budget += o.amount;
  if (o.from === 'ABROAD') delete state.players[p.id];
  else { p.club = o.from; p.number = null; assignSquadNumbers(state, o.from); p.listed = false; }
  scrubLineup(state, o.pid);
  addNews(state, `Sold ${p.name} to ${o.from === 'ABROAD' ? 'a club abroad' : state.clubs[o.from].name} for ${money(o.amount)}.`, 'good');
  return { message: `Sold ${p.name} for ${money(o.amount)}.` };
}

function scrubLineup(state, pid) {
  if (!state.lineup) return;
  state.lineup.slots = state.lineup.slots.map((x) => (x === pid ? null : x));
  state.lineup.bench = state.lineup.bench.map((x) => (x === pid ? null : x));
}

export function releasePlayer(state, pid) {
  const p = state.players[pid];
  if (!p || p.club !== state.userClub) return null;
  if (userPlayers(state).length <= 16) return { message: 'Squad too small to release players (min 16).' };
  const cost = Math.round(p.wage * 26 * Math.max(1, p.contract) * 0.5);
  state.budget -= cost;
  delete state.players[pid];
  scrubLineup(state, pid);
  addNews(state, `Released ${p.name}. Severance paid: ${money(cost)}.`);
  return { message: `${p.name} released (severance ${money(cost)}).` };
}

export function renewContract(state, pid) {
  const p = state.players[pid];
  if (!p || p.club !== state.userClub) return null;
  if (p.contract >= 5) return { message: `${p.name} already has a long contract.` };
  const newWage = niceRound(p.wage * 1.12);
  if (wageBill(state) - p.wage + newWage > state.wageBudget * 1.05) return { message: 'Not enough wage budget for this renewal.' };
  if (p.morale < 35) return { message: `${p.name} is unhappy and refuses to negotiate.` };
  p.contract = Math.min(5, p.contract + 2); p.wage = newWage; p.morale = clamp(p.morale + 6, 0, 100);
  return { message: `${p.name} signed a new deal until ${state.year + p.contract} (${money(newWage)}/wk).` };
}

// ---------- youth academy ----------
export const YOUTH_SCOUT_COST = 250000;
export function scoutYouth(state) {
  if (state.budget < YOUTH_SCOUT_COST) return { message: 'Not enough budget to send scouts.' };
  state.budget -= YOUTH_SCOUT_COST;
  const rng = rngFor(state, 'youth');
  const lg = LEAGUE_BY_ID[state.league];
  const q = state.clubs[state.userClub].rep;
  const found = [];
  for (let i = 0; i < 3; i++) {
    const id = `yp${state.nextId++}_${hashStr(state.seed) % 1000}`;
    const nat = rng.chance(0.75) ? rng.weighted(lg.home) : rng.pick(Object.keys(NATION_BY_CODE));
    const p = genProspect(rng, { id, nat, club: state.userClub, league: state.league, quality: q });
    found.push(p);
    state.youth.push(p);
  }
  return { message: `Your scouts found ${found.length} prospects.`, found };
}
export function promoteYouth(state, pid) {
  const i = state.youth.findIndex((p) => p.id === pid);
  if (i < 0) return null;
  const rng = rngFor(state, 'promote');
  const p = freshPlayer(state.youth[i], rng);
  p.contract = 3; p.club = state.userClub;
  p.number = nextFreeNumber(state);
  state.players[p.id] = p;
  state.youth.splice(i, 1);
  addNews(state, `${p.name} (${p.age}, ${p.pos}) promoted from the academy.`, 'good');
  return { message: `${p.name} joins the first team.` };
}
export function releaseYouth(state, pid) { state.youth = state.youth.filter((p) => p.id !== pid); }

// ---------- season end ----------
function evaluateObjectives(state) {
  const club = state.clubs[state.userClub];
  const table = leagueTable(state, club.tier);
  const pos = table.findIndex((r) => r.club === state.userClub) + 1;
  let cupReached = -1;
  state.cup.rounds.forEach((r, i) => { if (r.some((f) => f.h === state.userClub || f.a === state.userClub)) cupReached = i; });
  const cupWon = state.cup.winner === state.userClub;
  const youthApps = Math.max(0, ...userPlayers(state).filter((p) => p.age <= 21).map((p) => p.apps));
  return state.objectives.map((o) => {
    let met = false, detail = '';
    if (o.id === 'league') { met = pos <= o.target; detail = `Finished ${ordinal(pos)}`; }
    if (o.id === 'cup') { met = cupWon || cupReached >= o.target + 1; detail = cupWon ? 'Won the Cup' : cupReached >= 0 ? `Reached the ${CUP_ROUNDS[cupReached]}` : 'Did not enter'; }
    if (o.id === 'youth') { met = youthApps >= o.target; detail = `Best: ${youthApps} apps`; }
    return { ...o, met, detail };
  });
}
export function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

export function endSeason(state) {
  const t1 = leagueTable(state, 1), t2 = leagueTable(state, 2);
  const relegated = t1.slice(-2).map((r) => r.club);
  const promoted = t2.slice(0, 2).map((r) => r.club);
  const all = Object.values(state.players).filter((p) => state.clubs[p.club]);
  const tier1 = all.filter((p) => state.clubs[p.club].tier === 1);
  const topScorer = tier1.slice().sort((a, b) => b.goals - a.goals || a.apps - b.apps)[0];
  const potsPool = tier1.filter((p) => p.rN >= 8);
  const pots = potsPool.slice().sort((a, b) => avgRating(b) - avgRating(a))[0];
  const young = tier1.filter((p) => p.age <= 21 && p.rN >= 5).sort((a, b) => avgRating(b) - avgRating(a))[0];
  const userBest = userPlayers(state).filter((p) => p.rN >= 3).sort((a, b) => avgRating(b) - avgRating(a))[0];
  const objectives = evaluateObjectives(state);
  const metCount = objectives.filter((o) => o.met).length;
  state.boardConfidence = clamp(state.boardConfidence + (metCount - 1.5) * 18, 0, 100);
  const club = state.clubs[state.userClub];
  const userPos = leagueTable(state, club.tier).findIndex((r) => r.club === state.userClub) + 1;
  const pl = (p) => (p ? { id: p.id, name: p.name, club: p.club, value: p.goals, rating: Math.round(avgRating(p) * 100) / 100, age: p.age } : null);
  state.seasonSummary = {
    season: state.season, label: seasonLabel(state), champion: t1[0].club, tier2Champion: t2[0].club,
    cupWinner: state.cup.winner, relegated, promoted, userPos, userTier: club.tier,
    awards: { topScorer: pl(topScorer), pots: pl(pots), young: pl(young), userBest: pl(userBest) },
    objectives, boardConfidence: state.boardConfidence,
  };
  state.history.push({ season: state.season, label: seasonLabel(state), tier: club.tier, pos: userPos, cup: state.cup.winner === state.userClub, objectivesMet: metCount });
  state.phase = 'seasonEnd';
  addNews(state, `Season ${seasonLabel(state)} complete. ${state.clubs[t1[0].club].name} are champions!`, 'info');
  return state.seasonSummary;
}

export function startNewSeason(state) {
  if (state.phase !== 'seasonEnd') return null;
  const S = state.seasonSummary;
  const rng = new Rng(`${state.seed}|newseason|${state.season}`);
  const club = state.clubs[state.userClub];
  // promotion / relegation
  for (const id of S.relegated) state.clubs[id].tier = 2;
  for (const id of S.promoted) state.clubs[id].tier = 1;
  state.tiers = { 1: [], 2: [] };
  for (const c of Object.values(state.clubs)) state.tiers[c.tier].push(c.id);
  // reputation
  if (S.promoted.includes(state.userClub) || S.userPos <= 2 || S.cupWinner === state.userClub) club.rep = Math.min(5, club.rep + 0.5);
  if (S.relegated.includes(state.userClub)) club.rep = Math.max(1, club.rep - 0.5);
  const news = [];
  // aging, development, retirements, contracts
  for (const p of Object.values(state.players)) {
    p.age++;
    let d;
    if (p.age <= 21) d = rng.int(1, 5);
    else if (p.age <= 24) d = rng.int(0, 3);
    else if (p.age <= 29) d = rng.int(-1, 1);
    else if (p.age <= 32) d = rng.int(-3, 0);
    else d = rng.int(-5, -1);
    const played = p.rN ? avgRating(p) : 6.2;
    if (played >= 7.2 && d < 3) d++;
    if (d > 0) d = Math.min(d, Math.max(0, p.pot - p.ovr));
    adjustOvr(p, d);
    p.value = marketValue(p);
    const retireChance = p.age >= 38 ? 1 : p.age >= 33 ? (p.age - 32) * 0.17 : 0;
    const isUser = p.club === state.userClub;
    if (rng.chance(retireChance)) {
      if (isUser) news.push(`${p.name} (${p.age}) has retired from professional football.`);
      const clubId = p.club;
      delete state.players[p.id];
      if (!isUser) refillClub(state, clubId, rng);
      continue;
    }
    if (isUser) {
      p.contract--;
      if (p.contract <= 0) {
        news.push(`${p.name}'s contract expired and he left the club.`);
        delete state.players[p.id];
        continue;
      }
    } else if (p.contract <= 1) p.contract = rng.int(2, 4); else p.contract--;
    Object.assign(p, { goals: 0, apps: 0, rSum: 0, rN: 0, form: [], injury: 0, fitness: 100, xp: 0 });
  }
  for (const cid of Object.keys(state.clubs)) if (cid !== state.userClub) refillClub(state, cid, rng);
  // youth regens at user club if too thin
  while (userPlayers(state).length < 18) {
    const id = `rg${state.nextId++}_${state.seed.length}`;
    const lg = LEAGUE_BY_ID[state.league];
    const p = freshPlayer(genProspect(rng, { id, nat: rng.weighted(lg.home), club: state.userClub, league: state.league, age: rng.int(17, 19), quality: club.rep }), rng);
    p.contract = 3;
    state.players[id] = p;
    news.push(`Academy graduate ${p.name} (${p.pos}) joins the first team.`);
  }
  for (const cid of Object.keys(state.clubs)) assignSquadNumbers(state, cid);
  // finances
  const left = Math.max(0, state.budget);
  state.budget = niceRound(baseBudget(club) + left * 0.5 + (S.cupWinner === state.userClub ? 5e6 : 0));
  state.wageBudget = niceRound(Math.max(state.wageBudget, wageBill(state) * 1.15));
  state.season++; state.year++;
  state.phase = 'season';
  state.offers = [];
  const r2 = new Rng(`${state.seed}|fixtures|${state.season}`);
  makeFixtures(state, r2);
  makeCup(state, r2);
  makeCalendar(state);
  autoLineup(state, state.lineup?.formation || null);
  state.objectives = boardObjectives(state);
  for (const n of news) addNews(state, n);
  addNews(state, `Welcome to ${seasonLabel(state)}. The summer window is open. Budget: ${money(state.budget)}.`);
  generateOffers(state, rng, 2);
  return state;
}

/** Quick helper: team rating of user's current lineup. */
export function lineupInfo(state) {
  const slots = state.lineup.slots.map((id) => (id ? state.players[id] : null));
  return { slots, rating: teamRating(slots), chem: calcChemistry(state.lineup.formation, slots) };
}
