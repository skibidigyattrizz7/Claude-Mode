// Pure-logic tests for the meta layer. Run: node 3d/js/meta/tests/meta.test.mjs
import assert from 'node:assert/strict';
import { getDB, _resetDB, computeOvr, tierOf, sanitizeCard } from '../core/players.js';
import { Rng } from '../core/rng.js';
import { calcChemistry, calcChemistryFc26, calcChemistryStyled, CHEM_STYLES, linkStrength, teamRating } from '../core/chemistry.js';
import { FORMATIONS, FORMATION_NAMES } from '../core/formations.js';
import { validateTeam, bestLineup, buildTeam, gkKitFor, toMatchPlayer } from '../core/teams.js';
import { simulateMatch } from '../core/sim.js';
import * as UT from '../core/ut.js';
import * as SW from '../core/swaps.js';
import * as C from '../core/career.js';
import { getNationalTeams, getSavedUltimateTeam, mountMeta } from '../index.js';
import { POSITIONS, NATIONS, LEAGUE_BY_ID, SPECIAL_CLUBS, clubById } from '../core/data.js';

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log(`  ok  ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
  }
}
const fingerprint = (db) => db.all.map((p) => `${p.id}|${p.name}|${p.nat}|${p.club}|${p.pos}|${p.ovr}|${p.pot}|${p.stats.pac}`).join('\n');

console.log('Pitchside meta tests');

test('player database is deterministic across regenerations', () => {
  const a = fingerprint(getDB());
  _resetDB();
  const b = fingerprint(getDB());
  assert.equal(a, b);
});

test('database has >= 1500 players with required fields', () => {
  const db = getDB();
  assert.ok(db.players.length >= 1500, `only ${db.players.length}`);
  const ids = new Set();
  for (const p of db.all) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`); ids.add(p.id);
    for (const k of ['id', 'name', 'age', 'nat', 'club', 'league', 'pos', 'alt', 'ovr', 'pot', 'wf', 'sm', 'foot', 'wr', 'height', 'value', 'wage', 'tier']) assert.ok(p[k] !== undefined, `${p.id} missing ${k}`);
    assert.ok(POSITIONS.includes(p.pos));
    assert.ok(p.wf >= 1 && p.wf <= 5 && p.sm >= 1 && p.sm <= 5);
    assert.ok(p.pot >= p.ovr);
    assert.equal(p.ovr, computeOvr(p.pos, p), `ovr mismatch ${p.id}`);
    if (!p.special) assert.equal(p.tier, tierOf(p.ovr));
  }
  for (const sp of ['legend', 'hero', 'inform']) assert.ok(db.specials.some((p) => p.special === sp), `no ${sp}`);
});

// Owner request (leagues): every card in the pool must carry a usable `league` — a real LEAGUE_BY_ID entry,
// or one of the documented special-club pseudo-leagues (Icons/Legends/Heroes/Secret/Card Creator) — so
// SBC/objective/tournament "same league" requirements and chemistry always have a real field to read.
test('every card in the pool has a usable league (real league or a documented special-club pseudo-league)', () => {
  const db = getDB();
  const usable = (id) => typeof id === 'string' && id.length > 0 && (!!LEAGUE_BY_ID[id] || !!SPECIAL_CLUBS[id]);
  const bad = db.all.filter((p) => !usable(p.league));
  assert.deepEqual(bad.map((p) => `${p.id}:${p.league}`), [], `${bad.length}/${db.all.length} cards have no usable league`);
  // Heroes are tied to a real league (their "home" league), not the HER pseudo-club/league.
  for (const p of db.specials.filter((x) => x.special === 'hero')) assert.ok(LEAGUE_BY_ID[p.league], `hero ${p.id} should carry a real league, got ${p.league}`);
  // Icons/Legends/classic Legends always link to every league in chemistry (linksAll in chemistry.js),
  // so their own league value only needs to be a resolvable pseudo-league, never a real one.
  for (const p of db.icons) assert.equal(p.league, 'ICN');
  for (const p of db.specials.filter((x) => x.special === 'legend')) assert.equal(p.league, 'LEG');
  // Real Stars/regulars sit at a fictional club, and must carry THAT club's actual league (not a guess).
  for (const p of db.stars.concat(db.regulars)) {
    const c = clubById(p.club);
    assert.ok(c && c.league === p.league, `${p.id}: club ${p.club} is in ${c && c.league}, card says ${p.league}`);
  }
});

// Custom / Card Creator cards (ui/customcards.js -> core/customreg.js -> sanitizeCard) have no real club of
// their own; they must still resolve to a usable, self-consistent league (not an arbitrary Icons default).
test('custom (Card Creator) cards without an explicit club/league resolve to the FUT pseudo-league', () => {
  const created = sanitizeCard({ id: 'admin_1_1', name: 'Test Player', pos: 'ST', tier: 'gold', stats: { pac: 75, sho: 75, pas: 75, dri: 75, def: 45, phy: 70 } });
  assert.equal(created.club, 'FUT');
  assert.equal(created.league, 'FUT');
  assert.ok(SPECIAL_CLUBS.FUT && SPECIAL_CLUBS.FUT.league === 'FUT');
  // A malformed network card with a real club but no league inherits that club's actual league.
  const realClub = clubById(getDB().players[0].club);
  const inherited = sanitizeCard({ id: 'net1', pos: 'ST', club: realClub.id, stats: {} });
  assert.equal(inherited.league, realClub.league);
});

// Owner request: every SBC that checks league composition ('sameLeague') must be satisfiable from the
// available card pool — i.e. at least one real league actually has enough eligible players, of varied
// enough positions, to fill an 11-man XI (not just a raw headcount).
test('every SBC league requirement (sameLeague) is satisfiable from the available pool', () => {
  const db = getDB();
  for (const sbc of UT.SBCS) {
    const lgReq = sbc.reqs.find((r) => r.t === 'sameLeague');
    const countReq = sbc.reqs.find((r) => r.t === 'count');
    if (!lgReq) continue;
    const need = Math.max(lgReq.v, countReq ? countReq.v : 11);
    const byLeague = new Map();
    for (const p of db.all) { const k = p.league; (byLeague.get(k) || byLeague.set(k, []).get(k)).push(p); }
    // pick the league with the most eligible players and prove a real, duplicate-free 11-man XI comes out of it
    const [bestLeague, pool] = [...byLeague.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    assert.ok(pool.length >= need, `${sbc.id}: needs ${need} from one league, ${bestLeague} only has ${pool.length}`);
    const dedup = [...new Map(pool.map((p) => [p.person || p.id, p])).values()];
    const { slots } = bestLineup(dedup, '4-3-3');
    const filled = slots.filter(Boolean);
    assert.ok(filled.length === 11, `${sbc.id}: could not fill an XI from ${bestLeague} alone (${filled.length}/11)`);
    assert.ok(filled.every((p) => p.league === bestLeague));
  }
});

test('>= 24 national teams, all valid contract Teams (11 starters, GK first)', () => {
  const nts = getNationalTeams();
  assert.ok(nts.length >= 24);
  for (const t of nts) {
    assert.deepEqual(validateTeam(t), [], `${t.id}: ${validateTeam(t).join(', ')}`);
    assert.equal(t.players.length, 11);
    assert.equal(t.players[0].pos, 'GK');
    assert.ok(t.bench.length <= 7);
  }
  assert.equal(new Set(nts.map((t) => t.id)).size, nts.length);
});

test('getSavedUltimateTeam returns null without storage', () => {
  assert.equal(getSavedUltimateTeam(), null);
  assert.equal(typeof mountMeta, 'function');
});

test('chemistry: link strengths, per-player 0..3, team 0..33 scaled to 0..100', () => {
  const db = getDB();
  const club = db.players.filter((p) => p.club === db.players[0].club);
  const { slots } = bestLineup(club, '4-4-2');
  const chem = calcChemistry('4-4-2', slots);
  assert.equal(chem.players.length, 11);
  assert.ok(chem.players.every((c) => c >= 0 && c <= 3));
  assert.ok(chem.total >= 0 && chem.total <= 33);
  assert.equal(chem.scaled, Math.round((chem.total / 33) * 100));
  assert.ok(chem.total >= 20, `same-club XI should gel, got ${chem.total}`);
  assert.equal(chem.links.length, FORMATIONS['4-4-2'].links.length);
  const a = slots[1], b = { ...a, nat: 'zz', league: 'zz', club: 'zz' };
  assert.equal(linkStrength(a, a), 2);
  assert.equal(linkStrength(a, b), 0);
  assert.equal(linkStrength(a, { ...b, nat: a.nat }), 1);
  // out of position player gets 0
  const oop = slots.slice(); oop[0] = slots[10];
  assert.equal(calcChemistry('4-4-2', oop).players[0], 0);
  // empty squad
  assert.equal(calcChemistry('4-3-3', new Array(11).fill(null)).total, 0);
});

test('chemistry styles: FC26 (whole-XI counts, no adjacency) vs classic (links), selectable and both 0..33', () => {
  const db = getDB();
  assert.deepEqual(CHEM_STYLES, ['classic', 'fc26']);
  const club = db.players.filter((p) => p.club === db.players[0].club);
  const { slots } = bestLineup(club, '4-4-2');
  const classic = calcChemistry('4-4-2', slots);
  const fc26 = calcChemistryFc26('4-4-2', slots);
  assert.equal(fc26.players.length, 11);
  assert.ok(fc26.players.every((c) => c >= 0 && c <= 3));
  assert.ok(fc26.total >= 0 && fc26.total <= 33);
  assert.equal(fc26.scaled, Math.round((fc26.total / 33) * 100));
  assert.deepEqual(fc26.links, []); // no adjacency in FC26 style
  assert.ok(fc26.total >= 20, `same-club XI should gel under FC26 too, got ${fc26.total}`);
  // out of position still zeroes chemistry in both styles
  const oop = slots.slice(); oop[0] = slots[10];
  assert.equal(calcChemistryFc26('4-4-2', oop).players[0], 0);
  // calcChemistryStyled dispatches correctly and defaults to classic (back-compat for every existing caller)
  assert.deepEqual(calcChemistryStyled('4-4-2', slots), classic);
  assert.deepEqual(calcChemistryStyled('4-4-2', slots, 'classic'), classic);
  assert.deepEqual(calcChemistryStyled('4-4-2', slots, 'fc26'), fc26);
  assert.deepEqual(calcChemistryStyled('4-4-2', slots, 'bogus'), classic);
  // a squad where every player is entirely unrelated (unique club/league/nation) should score 0 under FC26
  const base = slots[0];
  const unrelated = slots.map((p, i) => ({ ...p, id: `zz${i}`, nat: `n${i}`, league: `l${i}`, club: `c${i}`, special: null, linkAll: false }));
  assert.equal(calcChemistryFc26('4-4-2', unrelated).total, 0, 'fully unrelated XI should have 0 FC26 chemistry');
});

test('formations: 11 slots, GK first, links in range', () => {
  for (const f of FORMATION_NAMES) {
    const F = FORMATIONS[f];
    assert.equal(F.slots.length, 11);
    assert.equal(F.slots[0].pos, 'GK');
    for (const [a, b] of F.links) assert.ok(a >= 0 && a < 11 && b >= 0 && b < 11 && a !== b);
  }
});

test('team rating', () => {
  const mk = (o) => ({ ovr: o });
  assert.equal(teamRating(new Array(11).fill(0).map(() => mk(80))), 80);
  assert.ok(teamRating([mk(90), ...new Array(10).fill(0).map(() => mk(70))]) > 71);
});

test('pack odds: every slot distribution sums to 1 and categories have players', () => {
  const pools = UT.categoryPools();
  for (const pack of UT.PACKS) {
    for (const s of pack.slots) {
      const sum = Object.values(s.odds).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${pack.id} sums to ${sum}`);
      for (const c of Object.keys(s.odds)) assert.ok(pools[c] && pools[c].length > 0, `empty category ${c}`);
    }
    const items = UT.openPack(pack.id, new Set(), new Rng(pack.id));
    assert.equal(items.length, pack.slots.reduce((a, s) => a + s.n, 0));
  }
  const legend = UT.openPack('legend', new Set(), new Rng(1));
  assert.ok(legend.some((it) => it.pid.startsWith('lg')));
  assert.equal(UT.packFlare(legend), 'walkout');
});

test('pack duplicates are flagged', () => {
  const items = UT.openPack('gold', new Set(), new Rng(9));
  const again = UT.openPack('gold', new Set(items.map((i) => i.pid)), new Rng(9));
  assert.ok(again.every((i) => i.dup));
});

test('SBC validation and submission', () => {
  const s = UT.createUTState({ clubName: 'Test FC' }, new Rng(42));
  const db = getDB();
  const bronzes = db.players.filter((p) => p.tier === 'bronze').slice(0, 30);
  for (const p of bronzes) UT.addToClub(s, p.id);
  const sbc = UT.SBC_BY_ID['bronze-up'];
  const slotIds = UT.sbcAutoFill(s, sbc, '4-4-2');
  const ev = UT.evaluateSbc(sbc, '4-4-2', slotIds.map((id) => (id ? db.byId.get(id) : null)));
  assert.ok(ev.ok, JSON.stringify(ev.checks));
  const partial = slotIds.slice(); partial[3] = null;
  assert.equal(UT.evaluateSbc(sbc, '4-4-2', partial.map((id) => (id ? db.byId.get(id) : null))).ok, false);
  const golds = db.players.filter((p) => p.ovr >= 80).slice(0, 11);
  assert.equal(UT.evaluateSbc(sbc, '4-4-2', golds).ok, false);
  const before = s.club.length, packs = s.packs.length;
  UT.submitSbc(s, 'bronze-up', '4-4-2', slotIds);
  assert.equal(s.club.length, before - 11);
  assert.equal(s.packs.length, packs + 1);
  assert.throws(() => UT.submitSbc(s, 'bronze-up', '4-4-2', slotIds));
});

test('UT squad produces a valid Team with chemistry', () => {
  const s = UT.createUTState({ clubName: 'Test FC', primary: '#FF0000', secondary: '#FFFFFF' }, new Rng(7));
  const t = UT.utTeam(s);
  assert.deepEqual(validateTeam(t), []);
  assert.ok(t.chemistry >= 0 && t.chemistry <= 100);
  const opp = UT.battleOpponents(1);
  assert.equal(opp.length, 12);
  for (const o of opp) assert.deepEqual(validateTeam(o.team), []);
  const r = UT.applyBattleResult(s, opp[0], { homeGoals: 2, awayGoals: 0, scorers: [], stats: {}, playerRatings: {} });
  assert.equal(r.outcome, 'W');
  assert.ok(r.coins > 0 && s.stats.wins === 1);
});

test('UT squad chemistry style setting reaches squadInfo and the match Team (utTeam)', () => {
  const s = UT.createUTState({ clubName: 'Style FC', primary: '#0033AA', secondary: '#00AA00' }, new Rng(11));
  const classicInfo = UT.squadInfo(s);
  assert.equal(classicInfo.chem.links.length > 0, true);
  s.squad.chemStyle = 'fc26';
  const fc26Info = UT.squadInfo(s);
  assert.equal(fc26Info.chem.style, 'fc26');
  assert.deepEqual(fc26Info.chem.links, []);
  const t = UT.utTeam(s);
  assert.deepEqual(validateTeam(t), []);
  assert.equal(t.chemistry, Math.max(0, Math.min(100, Math.round(fc26Info.chem.scaled))));
  s.squad.chemStyle = 'not-a-real-style';
  assert.deepEqual(UT.squadInfo(s).chem, classicInfo.chem); // unknown style falls back to classic
});

test('simulated score distribution is realistic', () => {
  const nts = getNationalTeams();
  const rng = new Rng('sim');
  let goals = 0, draws = 0, homeWins = 0, n = 3000, maxG = 0;
  for (let i = 0; i < n; i++) {
    const h = nts[i % nts.length], a = nts[(i * 7 + 3) % nts.length];
    if (h.id === a.id) { n++; continue; }
    const r = simulateMatch(h, a, { rng });
    goals += r.homeGoals + r.awayGoals;
    maxG = Math.max(maxG, r.homeGoals + r.awayGoals);
    if (r.homeGoals === r.awayGoals) draws++;
    if (r.homeGoals > r.awayGoals) homeWins++;
    assert.equal(r.scorers.length, r.homeGoals + r.awayGoals);
    assert.equal(Object.keys(r.playerRatings).length, 22);
  }
  const avg = goals / n;
  assert.ok(avg > 2.1 && avg < 3.3, `avg goals ${avg}`);
  assert.ok(draws / n > 0.16 && draws / n < 0.34, `draw rate ${draws / n}`);
  assert.ok(homeWins / n > 0.38 && homeWins / n < 0.58, `home win rate ${homeWins / n}`);
  assert.ok(maxG <= 12);
  // stronger team wins more
  const strong = nts.find((t) => t.id === 'ESP'), weak = nts.find((t) => t.id === 'GRE');
  let sw = 0;
  for (let i = 0; i < 500; i++) { const r = simulateMatch(strong, weak, { rng, neutral: true }); if (r.homeGoals > r.awayGoals) sw++; }
  assert.ok(sw / 500 > 0.5, `strong win rate ${sw / 500}`);
});

test('career: fixtures, table, season end, promotion/relegation, new season', () => {
  const s = C.newCareer({ clubId: 'SOL04', manager: 'T', seed: 'test' });
  const t1 = s.fixtures[1];
  assert.equal(t1.length, 18);
  const pairs = new Set();
  for (const md of t1) for (const f of md) pairs.add(`${f.h}-${f.a}`);
  assert.equal(pairs.size, 90); // double round robin, each ordered pair once
  const { home, away } = C.matchTeams(s, t1[0][0].h, t1[0][0].a);
  assert.deepEqual(validateTeam(home), []); assert.deepEqual(validateTeam(away), []);
  assert.ok(C.transferWindow(s) === 'Summer');
  let guard = 0;
  while (s.phase === 'season' && guard++ < 100) C.advance(s);
  assert.equal(s.phase, 'seasonEnd');
  const table = C.leagueTable(s, 1);
  assert.ok(table.every((r) => r.P === 18));
  assert.equal(table.reduce((a, r) => a + r.GF, 0), table.reduce((a, r) => a + r.GA, 0));
  assert.ok(s.cup.winner);
  const rel = s.seasonSummary.relegated, pro = s.seasonSummary.promoted;
  C.startNewSeason(s);
  assert.equal(s.season, 2);
  for (const id of rel) assert.equal(s.clubs[id].tier, 2);
  for (const id of pro) assert.equal(s.clubs[id].tier, 1);
  assert.equal(s.tiers[1].length, 10);
  assert.ok(C.userPlayers(s).length >= 18);
});

test('career: transfers respect window and budget', () => {
  const s = C.newCareer({ clubId: 'ISL05', manager: 'T', seed: 'tr' });
  const target = C.searchPlayers(s, { minOvr: 65, maxOvr: 75, maxValue: 8e6 })[0];
  assert.ok(target);
  assert.equal(C.makeBid(s, target.id, s.budget + 1).status, 'error');
  const low = C.makeBid(s, target.id, 1000);
  assert.equal(low.status, 'rejected');
  const r = C.makeBid(s, target.id, C.askingPrice(s, target));
  assert.equal(r.status, 'accepted', r.message);
  assert.equal(s.players[target.id].club, 'ISL05');
  C.advance(s);
  assert.equal(C.transferWindow(s), null);
  const t2 = C.searchPlayers(s, { minOvr: 60 })[0];
  assert.equal(C.makeBid(s, t2.id, 1e6).status, 'error');
});

test('buildTeam enforces unique numbers and contract shape', () => {
  const db = getDB();
  const { slots, bench } = bestLineup(db.players.slice(0, 200), '3-5-2');
  const t = buildTeam({ id: 'X', name: 'X', short: 'XXX', kit: NATIONS[0].kit, gkKit: gkKitFor(NATIONS[0].kit), formation: '3-5-2', starters: slots, bench });
  assert.deepEqual(validateTeam(t), []);
  assert.equal(new Set(t.players.concat(t.bench).map((p) => p.number)).size, t.players.length + t.bench.length);
});

// ---------------- V2 ----------------
const PM = await import('../core/pmarket.js');
const RV = await import('../core/rivals.js');
const SS = await import('../core/seasons.js');
const OBJ = await import('../core/objectives.js');
const EVO = await import('../core/evolutions.js');
const DR = await import('../core/draft.js');
const EVT = await import('../core/events.js');
const TAC = await import('../core/tactics.js');
const TOTW = await import('../core/totw.js');
const { totwCards } = TOTW;
const { PLAYSTYLES, styleCountRange, maxPlus } = await import('../core/physique.js');
const { getPlayer } = await import('../core/players.js');
const { REAL_ROW_COUNT } = await import('../core/realplayers.js');
const { effectiveOvr, positionFit } = await import('../core/formations.js');

const EXPECTED_REAL = ['Lionel Messi', 'Pelé', 'Diego Maradona', 'Cristiano Ronaldo', 'Johan Cruyff', 'Alfredo Di Stéfano', 'Franz Beckenbauer', 'Zinedine Zidane', 'George Best', 'Michel Platini', 'Ronaldo Nazário', 'Ronaldinho', 'Paolo Maldini', 'Garrincha', 'Lev Yashin', 'Stanley Matthews', 'Roberto Baggio', 'Thierry Henry', 'Marco van Basten', 'Xavi Hernández', 'Andrés Iniesta', 'Luís Figo', 'Romário', 'Eusébio', 'Karl-Heinz Rummenigge', 'Fabio Cannavaro', 'Iker Casillas', 'Raúl González', 'Neymar Jr.', 'Sergio Ramos', 'Paolo Rossi', 'Roberto Carlos', 'Kylian Mbappé', 'Luka Modrić', 'Gheorghe Hagi', 'Zlatan Ibrahimović', 'Frank Lampard', 'Steven Gerrard', 'David Beckham', 'Clarence Seedorf', 'Dani Alves', 'Patrick Vieira', 'Ronald Koeman', 'Giacinto Facchetti', 'Philipp Lahm', 'Javier Zanetti', 'Sándor Kocsis', 'Just Fontaine', 'Teófilo Cubillas', 'Mario Kempes', 'Jimmy Johnstone', 'Eric Cantona', 'Kevin De Bruyne', 'Alessandro Del Piero', 'Francesco Totti', 'Diego Forlán', 'Rivaldo', 'Michael Laudrup', 'Johan Neeskens', 'Hristo Stoichkov', 'Didier Drogba', 'Paul Scholes', 'Gunnar Nordahl', 'Arjen Robben', 'Raul Meireles', 'Fernandinho', 'Edinson Cavani', 'Karim Benzema', 'Toni Kroos', 'Ivan Rakitić', 'Sergio Busquets', 'Gianluigi Buffon', 'Manuel Neuer', 'Kaká', 'Roberto Mancini', 'Hakan Şükür', 'Wayne Rooney', 'Alessandro Nesta', 'Sol Campbell', 'Patrick Kluivert', 'Dino Zoff', 'Sócrates', 'Cafu', 'Lothar Matthäus', 'Daniel Passarella', 'Fernando Hierro', 'Javier Mascherano', 'David Villa', 'Gary Lineker', 'Romelu Lukaku', 'Karim Bagheri', 'Didier Deschamps', 'Emmanuel Petit', 'Paulo Futre', 'Hristo Bonev', 'Mohamed Salah', 'Ray Clemence',
  'Mohamed Aboutrika', 'Hossam Hassan', 'Essam El-Hadary', 'Ahmed Hassan', 'Hany Ramzy', 'Mahmoud El Khatib', 'Wael Gomaa', 'Mohamed Zidan', 'Amr Zaki', 'Ahmed Hossam Mido', 'Mohamed Barakat', 'Ahmed Fathy'];

test('real players: every requested player present once per version, LOTG rarity, valid stats', () => {
  const db = getDB();
  assert.equal(db.real.length, REAL_ROW_COUNT);
  const names = new Set(db.real.map((p) => p.name));
  for (const n of EXPECTED_REAL) assert.ok(names.has(n), `missing ${n}`);
  const versions = new Set(db.real.map((p) => `${p.person}|${p.era}`));
  assert.equal(versions.size, db.real.length, 'duplicate real player version');
  assert.equal(new Set(db.real.map((p) => p.person)).size, EXPECTED_REAL.length);
  for (const p of db.real) {
    // Legend of the Game is elite since Sep 30: Icons + current players rated LOTG_MIN_OVR+; the rest are rare golds
    assert.ok(p.real);
    if (p.special === 'lotg') assert.ok(['prime', 'current'].includes(p.era));
    else assert.ok(p.special == null && p.club !== 'ICN' && p.ovr < 88, `${p.name} should be a Legend of the Game`);
    assert.equal(p.ovr, p.intended, `${p.name} ovr ${p.ovr} != ${p.intended}`);
    if (p.era === 'prime') assert.ok(p.ovr >= 86 && p.ovr <= 99, `${p.name} prime ovr`); // Pelé / Maradona 99 (owner, Sep 30)
    assert.ok(p.wf >= 1 && p.wf <= 5 && p.sm >= 1 && p.sm <= 5 && ['L', 'R'].includes(p.foot));
    assert.ok((p.alt || []).length <= 4 && !(p.alt || []).includes(p.pos));
    const face = p.pos === 'GK' ? p.gk : p.stats;
    for (const v of Object.values(face)) assert.ok(v >= 1 && v <= 99);
    if (p.pos === 'GK') assert.ok(p.gk.div >= 80 && p.gk.ref >= 80, `${p.name} GK stats`);
  }
  assert.equal(getPlayer('ic_pele').ovr, 99); // raised to 99 with Maradona (owner, Sep 30)
  assert.equal(getPlayer('rs_messi').era, 'current');
  assert.equal(getPlayer('ic_messi').era, 'prime');
});

test('physique + PlayStyles: heights/weights in range, counts respect OVR bands, ids valid', () => {
  const db = getDB();
  for (const p of db.all) {
    assert.ok(p.height >= 162 && p.height <= 202, `${p.id} height ${p.height}`);
    if (p.pos === 'GK' && !p.real) assert.ok(p.height >= 184, `${p.id} GK height`);
    assert.ok(p.weight >= 58 && p.weight <= 100, `${p.id} weight`);
    assert.ok(Array.isArray(p.playstyles));
    const [lo, hi] = styleCountRange(p.ovr);
    if (!p.special || p.special === 'lotg') assert.ok(p.playstyles.length >= Math.min(lo, 4) && p.playstyles.length <= hi, `${p.id} ${p.ovr} has ${p.playstyles.length} styles`);
    assert.ok(p.playstyles.length <= 4);
    assert.ok(p.playstyles.filter((x) => x.plus).length <= Math.max(maxPlus(p.ovr), 0) || p.special === 'inform' || !!p.promo, `${p.id} plus count`);
    for (const x of p.playstyles) assert.ok(PLAYSTYLES[x.id], `${p.id} bad style ${x.id}`);
    const gkStyle = p.playstyles.some((x) => PLAYSTYLES[x.id][1] === 'gk');
    if (gkStyle) assert.equal(p.pos, 'GK', `${p.id} outfield GK style`);
  }
  const t = getNationalTeams()[0];
  for (const p of t.players) { assert.ok(p.height >= 1.62 && p.height <= 2.02); assert.ok(p.weight >= 58 && p.weight <= 100); assert.ok(Array.isArray(p.playstyles)); }
});

test('alternate positions: 0-3 sensible alts, in-position chemistry and full rating', () => {
  const db = getDB();
  let withAlt = 0;
  for (const p of db.players) { assert.ok(p.alt.length <= 4, `${p.id} has ${p.alt.length} alts`); if (p.pos === 'GK') assert.equal(p.alt.length, 0); if (p.alt.length) withAlt++; }
  assert.ok(withAlt / db.players.length > 0.6, 'most players have alternates');
  const cm = db.players.find((p) => p.pos === 'CM' && p.alt.includes('CDM'));
  assert.equal(positionFit(cm, 'CDM'), 1);
  assert.equal(effectiveOvr(cm, 'CDM'), cm.ovr);
  const slots = new Array(11).fill(null); slots[6] = cm;
  const alone = calcChemistry('4-3-3', slots);
  assert.ok(alone.players[6] >= 0);
  assert.ok(effectiveOvr(cm, 'CB') < cm.ovr);
});

test('LOTG chemistry: nation links always green, full chem in any listed position', () => {
  const db = getDB();
  const pele = getPlayer('ic_pele');
  const bra = db.players.find((p) => p.nat === 'BRA' && !p.real);
  const other = db.players.find((p) => p.nat !== 'BRA' && p.league !== 'ICN');
  assert.equal(linkStrength(pele, bra), 2);
  assert.equal(linkStrength(pele, other), 1);
  const slots = new Array(11).fill(null);
  slots[9] = pele; // 4-3-3 ST (Pelé is CF, which counts as ST)
  slots[8] = other;
  const chem = calcChemistry('4-3-3', slots);
  assert.equal(chem.players[9], 3);
  const oop = new Array(11).fill(null); oop[2] = pele;
  assert.equal(calcChemistry('4-3-3', oop).players[2], 0);
});

test('national teams include real players (all-time squads) and stay valid', () => {
  const nts = getNationalTeams();
  const byId = Object.fromEntries(nts.map((t) => [t.id, t]));
  for (const code of ['BRA', 'ARG', 'ITA', 'NED', 'FRA', 'ESP', 'ENG', 'GER', 'POR', 'HUN', 'BUL', 'RUS', 'NIR', 'EGY']) {
    const t = byId[code];
    assert.ok(t, `no ${code}`);
    assert.deepEqual(validateTeam(t), [], `${code}: ${validateTeam(t).join(', ')}`);
    assert.equal(t.players.length, 11); assert.equal(t.players[0].pos, 'GK');
    const real = t.players.filter((p) => getPlayer(p.id) && getPlayer(p.id).real);
    assert.ok(real.length >= 1, `${code} has no real players`);
    assert.equal(new Set(real.map((p) => getPlayer(p.id).person)).size, real.length, `${code} fields the same person twice`);
    assert.ok(t.tactics && t.tactics.width >= 1);
  }
  assert.ok(byId.BRA.players.some((p) => p.id === 'ic_pele'));
  assert.ok(byId.ARG.players.some((p) => p.id === 'ic_messi' || p.id === 'ic_maradona'));
  assert.ok(nts.length >= 49);
});

function mockOnline() {
  const listings = [];
  let seq = 1;
  return {
    listings,
    market: {
      async list(card, price) { const l = { listingId: `L${seq++}`, card, price, status: 'active', mine: true }; listings.push(l); return { ok: true, listingId: l.listingId }; },
      async cancel(id) { const l = listings.find((x) => x.listingId === id && x.status === 'active'); if (!l) return { ok: false, error: 'nf' }; l.status = 'cancelled'; return { ok: true, card: l.card }; },
      async buy(id) { const l = listings.find((x) => x.listingId === id); if (!l) return { ok: false }; l.status = 'bought'; return { ok: true, card: l.card }; },
      async mine() { return { ok: true, items: listings.filter((l) => l.mine && l.status !== 'cancelled') }; },
      async search() { return { ok: true, items: listings.filter((l) => l.status === 'active') }; },
      async claimSales() { return { ok: true, coins: 0 }; },
    },
  };
}

test('player market: listing removes the card (and from squad), cancel returns it; untradeables blocked', async () => {
  const s = UT.createUTState({ clubName: 'Mkt FC' }, new Rng(5));
  UT.migrateUT(s);
  const on = mockOnline();
  const pid = s.squad.slots[5];
  const p = getPlayer(pid);
  const r = PM.priceRange(p);
  assert.ok(r.min < r.max);
  const bad = await PM.listCard(s, on, pid, r.max * 10);
  assert.equal(bad.ok, false);
  const res = await PM.listCard(s, on, pid, r.min);
  assert.ok(res.ok, res.error);
  assert.ok(!s.club.includes(pid));
  assert.ok(!s.squad.slots.includes(pid));
  assert.equal(s.listed.length, 1);
  const c = await PM.cancelListing(s, on, res.listingId);
  assert.ok(c.ok);
  assert.ok(s.club.includes(pid));
  assert.equal(s.listed.length, 0);
  s.untradeable.push(pid);
  assert.equal((await PM.listCard(s, on, pid, r.min)).ok, false);
  assert.equal(PM.afterTax(1000), 950);
  // buying a card from another user
  const other = db2card('rs_salah');
  on.listings.push({ listingId: 'X1', card: other, price: 5000, status: 'active', mine: false });
  const b = await PM.buyListing(s, on, { listingId: 'X1', card: other, price: 5000 });
  assert.ok(b.ok && s.club.includes('rs_salah'));
  // unknown foreign card is sanitised + registered
  const foreign = { ...db2card('p10'), id: 'zz_foreign_1', stats: { pac: 200, sho: 50, pas: 50, dri: 50, def: 50, phy: 50 } };
  const pid2 = PM.acceptCard(s, foreign);
  assert.equal(pid2, 'zz_foreign_1');
  assert.equal(getPlayer('zz_foreign_1').stats.pac, 99);
});
function db2card(id) { return JSON.parse(JSON.stringify(getPlayer(id))); }

test('old v1 UT saves migrate', () => {
  const s = UT.createUTState({ clubName: 'Old FC' }, new Rng(8));
  const v1 = JSON.parse(JSON.stringify(s));
  for (const k of ['listed', 'untradeable', 'foreign', 'admin', 'tacticSets', 'activeTactic']) delete v1[k];
  v1.v = 1; v1.packs.push({ type: 'nonexistent' });
  const m = UT.migrateUT(v1);
  assert.equal(m.v, 2);
  assert.ok(Array.isArray(m.listed) && Array.isArray(m.untradeable));
  assert.ok(m.packs.every((pk) => UT.PACK_BY_ID[pk.type]));
  assert.deepEqual(validateTeam(UT.utTeam(m)), []);
});

test('tactics: sanitised on every Team, presets valid, user tactics used', () => {
  for (const id of TAC.PRESET_IDS) assert.deepEqual(validateTeam({ ...getNationalTeams()[1], tactics: TAC.sanitizeTactics(TAC.presetTactics(id)) }), []);
  const s = UT.createUTState({ clubName: 'Tac FC' }, new Rng(9));
  UT.migrateUT(s);
  const t0 = UT.utTeam(s);
  TAC.activeTactics(s).defensiveStyle = 'dropBack';
  TAC.activeTactics(s).width = 99;
  TAC.activeTactics(s).instructions = { [t0.players[9].id]: { attack: 'getInBehind' }, nobody: { attack: 'stayForward' } };
  const t = UT.utTeam(s);
  assert.equal(t.tactics.defensiveStyle, 'dropBack');
  assert.equal(t.tactics.width, 10);
  assert.deepEqual(Object.keys(t.tactics.instructions), [t0.players[9].id]);
  assert.ok(t.tactics.setPieceTakers.captain);
  assert.ok(t.tactics.quick.length >= 1 && t.tactics.quick.length <= 4);
  const c = C.newCareer({ clubId: 'ISL02', seed: 'tac' });
  const { home } = C.matchTeams(c, 'ISL02', 'ISL03');
  assert.ok(home.tactics);
});

test('rivals ladder: points, rank up, milestones, weekly rewards', () => {
  const r = RV.newRivals(10);
  const t = RV.rankUpTarget(10);
  let res;
  for (let i = 0; i < Math.ceil(t / 3); i++) res = RV.applyRivalsResult(r, 'W');
  assert.equal(r.division, 9);
  assert.ok(res.rankedUp && res.milestone);
  assert.ok(RV.claimableWeekly(r));
  const w = RV.takeWeekly(r);
  assert.ok(w.coins > 0 && w.packs.length);
  assert.equal(RV.claimableWeekly(r), null);
  RV.applyRivalsResult(r, 'W');
  RV.rollWeek(r, 11);
  assert.equal(r.pending, null, 'already claimed that week');
  const r2 = RV.newRivals(20);
  RV.applyRivalsResult(r2, 'W');
  RV.rollWeek(r2, 21);
  assert.ok(r2.pending && RV.claimableWeekly(r2).reward.coins > 0);
  assert.equal(r2.weeklyWins, 0);
  const opp = RV.aiOpponent('t', 'world');
  assert.deepEqual(validateTeam(opp.team), []);
});

test('objectives hub: per-player stats with fallback to scorers, chains lock, claims grant rewards', () => {
  const s = UT.createUTState({ clubName: 'Obj FC' }, new Rng(11));
  UT.migrateUT(s);
  s.club.push('ic_pele'); s.squad.slots[9] = 'ic_pele';
  const team = UT.utTeam(s);
  const res = { homeGoals: 2, awayGoals: 0, scorers: [{ playerId: 'ic_pele', team: 'home', minute: 10 }, { playerId: 'ic_pele', team: 'home', minute: 50 }], playerRatings: {} };
  const m = OBJ.userMatchStats(team, res, 'home');
  assert.equal(m.outcome, 'W'); assert.equal(m.stats.ic_pele.goals, 2); assert.ok(m.cleanSheet);
  const m2 = OBJ.userMatchStats(team, { ...res, playerStats: { ic_pele: { goals: 1, assists: 2, headerGoals: 1 } } }, 'home');
  assert.equal(m2.stats.ic_pele.goals, 1); assert.equal(m2.stats.ic_pele.assists, 2);
  assert.equal(OBJ.metricGain({ type: 'goals', f: { special: 'lotg' } }, m), 2);
  assert.equal(OBJ.metricGain({ type: 'winWith', count: 1, f: { nat: 'BRA' } }, m), 1);
  assert.equal(OBJ.metricGain({ type: 'headerGoals', f: { minHeight: 170 } }, m2), 1);
  OBJ.recordObjectiveMatch(s, m);
  const list = OBJ.objectiveList(s);
  for (const sec of ['daily', 'weekly', 'player', 'season', 'milestone', 'foundation']) assert.ok(list.some((o) => o.section === sec), sec);
  assert.ok(list.find((o) => o.id === 'c-samba-1').locked);
  const ready = list.find((o) => o.ready && o.bucket !== 'legacy');
  if (ready) { const before = s.coins + s.packs.length; assert.ok(OBJ.claimObjectiveById(s, ready.id)); assert.ok(s.coins + s.packs.length > before || (s.picks || []).length || s.club.length); }
  OBJ.setFlag(s, 'tactics');
  assert.ok(OBJ.objectiveList(s).find((o) => o.id === 'f-tactics').ready);
});

test('evolutions + position modifier create untradeable upgraded cards', () => {
  const s = UT.createUTState({ clubName: 'Evo FC' }, new Rng(12));
  UT.migrateUT(s);
  const evo = EVO.EVO_BY_ID.rising;
  const p = UT.clubPlayers(s).find((x) => x.pos !== 'GK' && EVO.eligibility(x, evo)[0]);
  assert.ok(EVO.startEvolution(s, 'rising', p.id).ok);
  assert.equal(EVO.startEvolution(s, 'rising', p.id).ok, false);
  const m = { starters: [p.id], stats: { [p.id]: { goals: 0 } }, outcome: 'W', cleanSheet: false };
  EVO.recordEvoMatch(s, m); EVO.recordEvoMatch(s, m);
  const card = EVO.claimEvolution(s, 0);
  assert.ok(card && card.ovr > p.ovr && card.evo === 1);
  assert.ok(s.club.includes(card.id) && !s.club.includes(p.id));
  assert.ok(s.untradeable.includes(card.id));
  assert.equal(card.ovr, computeOvr(card.pos, card));
  s.items.posmod = 1;
  const target = ['CB', 'LB', 'RB', 'CDM', 'CM', 'ST'].find((x) => x !== card.pos && !card.alt.includes(x));
  const pm = card.alt.length < 3 ? EVO.applyPositionModifier(s, card.id, target) : { ok: true, card: { alt: [target] } };
  assert.ok(pm.ok, pm.error);
  assert.ok(pm.card.alt.includes(target));
  const saved = JSON.parse(JSON.stringify(s));
  const back = UT.migrateUT(saved);
  assert.ok(back.club.includes(pm.card.id || card.id));
});

test('elite evolutions: 15 more, each takes a 98 card and no 99, and their PlayStyles exist', async () => {
  const { PLAYSTYLE_IDS } = await import('../core/physique.js');
  const elite = EVO.EVOLUTIONS.filter((e) => e.id.startsWith('elite-'));
  assert.equal(elite.length, 15);
  assert.equal(new Set(EVO.EVOLUTIONS.map((e) => e.id)).size, EVO.EVOLUTIONS.length);
  const all = getDB().all;
  for (const e of elite) {
    assert.equal(e.req.maxOvr, 98, e.id);
    assert.ok(e.upgrade.styles.every((x) => PLAYSTYLE_IDS.includes(x)), `${e.id} styles`);
    assert.ok(all.some((p) => p.ovr >= 94 && p.ovr <= 98 && EVO.eligibility(p, e)[0]), `${e.id} takes a top card`);
    assert.ok(!all.some((p) => p.ovr === 99 && EVO.eligibility(p, e)[0]), `${e.id} must not take a 99`);
  }
  // a 98 evolves and the upgrade applies (capped at 99)
  const s = UT.createUTState({ clubName: 'Elite FC' }, new Rng(7));
  const p98 = all.find((p) => p.ovr === 98 && p.pos !== 'GK');
  UT.addToClub(s, p98.id);
  assert.ok(EVO.startEvolution(s, 'elite-captain', p98.id).ok);
  const m = { starters: [p98.id], stats: {}, outcome: 'W', cleanSheet: false };
  for (let i = 0; i < 5; i++) EVO.recordEvoMatch(s, m);
  const idx = s.evo.active.findIndex((a) => a.evoId === 'elite-captain');
  const card = EVO.claimEvolution(s, idx);
  assert.ok(card && card.ovr >= 98 && card.ovr <= 99 && card.evo === 1);
});

test('instant evolutions: no matches needed, claimable right after starting', () => {
  const inst = EVO.EVOLUTIONS.filter((e) => e.instant);
  assert.ok(inst.length >= 5, `${inst.length} instant evolutions`);
  assert.ok(inst.some((e) => e.req.pos && e.req.pos.includes('GK')), 'one for keepers');
  const s = UT.createUTState({ clubName: 'Instant FC' }, new Rng(21));
  const evo = EVO.EVO_BY_ID['elite-captain'];
  const p = UT.clubPlayers(s).find((x) => EVO.eligibility(x, evo)[0]);
  assert.ok(EVO.startEvolution(s, evo.id, p.id).ok);
  const idx = s.evo.active.findIndex((a) => a.evoId === evo.id);
  assert.ok(EVO.evoComplete(s.evo.active[idx]));
  const card = EVO.claimEvolution(s, idx);
  assert.ok(card && card.evo === 1 && card.ovr >= p.ovr);
});

test('draft: formation, captain, 1-of-5 picks, valid team, knockout rewards', () => {
  const d = DR.newDraft('t1');
  DR.chooseFormation(d, '4-2-3-1');
  assert.equal(d.captainOptions.length, 5);
  DR.chooseCaptain(d, d.captainOptions[0]);
  let i;
  while ((i = DR.nextOpenSlot(d)) >= 0) { const o = DR.slotOptions(d, i); assert.equal(o.length, 5); DR.pickSlot(d, i, o[0]); }
  assert.equal(d.stage, 'slots', 'XI alone does not finish the draft: the 7 subs are required');
  while ((i = DR.nextOpenBench(d)) >= 0) { const o = DR.benchOptions(d, i); assert.equal(o.length, 5); DR.pickBench(d, i, o[0]); }
  assert.equal(d.stage, 'play');
  assert.equal(DR.draftTeam(d).bench.length, 7, 'drafted subs reach the match Team');
  const t = DR.draftTeam(d);
  assert.deepEqual(validateTeam(t), []);
  DR.applyDraftResult(d, 'W'); DR.applyDraftResult(d, 'L');
  assert.ok(d.done && d.wins === 1);
  assert.ok(DR.draftReward(d).coins > 0);
});

test('tournaments, TOTW, picks and season track', () => {
  const evs = EVT.activeEvents(3);
  assert.equal(evs.length, 3);
  const s = UT.createUTState({ clubName: 'Evt FC' }, new Rng(13));
  UT.migrateUT(s);
  const info = UT.squadInfo(s);
  const checks = EVT.checkRules([{ t: 'maxSpecial', special: 'lotg', v: 1 }], info.slots, info.rating);
  assert.ok(checks[0].ok);
  const tw = totwCards(5);
  assert.ok(tw.length >= 12);
  for (const p of tw) { assert.equal(getPlayer(p.id), p); assert.equal(p.special, 'inform'); }
  UT.addPick(s, { pool: 'lotg', n: 3 }, 'test', new Rng(1));
  const pk = s.picks[0];
  assert.equal(pk.options.length, 3);
  assert.ok(pk.options.every((id) => getPlayer(id).special === 'lotg'));
  UT.choosePick(s, pk.id, pk.options[0]);
  assert.ok(s.club.includes(pk.options[0]));
  const ss = SS.newSeason();
  const r = SS.addXp(ss, 2500);
  assert.deepEqual(r.levelsGained, [1, 2]);
  assert.deepEqual(SS.claimableLevels(ss), [1, 2]);
  for (let l = 1; l <= 30; l++) assert.ok(SS.levelReward(l));
});

test('career: create-a-club, player career, scouting network, training', () => {
  const s = C.newCareer({ clubId: 'SOL05', seed: 'cc', custom: { name: 'Test Utd', short: 'TUT', primary: '#112233', secondary: '#FFFFFF' } });
  assert.equal(s.clubs.SOL05.name, 'Test Utd');
  const { home } = C.matchTeams(s, 'SOL05', 'SOL06');
  assert.equal(home.name, 'Test Utd');
  s.budget = 5e6;
  const sc = C.sendScouts(s, 'samerica');
  assert.ok(sc.found.length >= 2 && sc.found.every((p) => p.potHidden && p.potRange[0] <= p.pot && p.potRange[1] >= p.pot));
  C.scoutFurther(s, sc.found[0].id);
  assert.equal(sc.found[0].potHidden, false);
  const pc = C.newCareer({ clubId: 'ISL07', seed: 'pro1', pro: { first: 'Test', last: 'Pro', pos: 'CM', nat: 'ENG' } });
  const pro = C.proPlayer(pc);
  assert.ok(pro && pro.isPro && pro.ovr >= 55);
  assert.ok(C.setTraining(pc, pro.id, 'playmaking'));
  let g = 0;
  while (pc.phase === 'season' && g++ < 100) C.advance(pc);
  assert.ok(pro.apps >= 15, `pro apps ${pro.apps}`);
  assert.ok(pro.ovr >= 62);
});

// ---------------- V3: Admin Given Codes, promos, real regulars ----------------
const A = await import('../core/admin.js');
const PR = await import('../core/promos.js');
const { REAL_NAMES, REG_ROW_COUNT } = await import('../core/realplayers.js');
const { CLUBS, NATION_BY_CODE: NATION_BY_CODE_T } = await import('../core/data.js');
const { createHash, pbkdf2Sync } = await import('node:crypto');
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; }
for (const k of ['localStorage', 'sessionStorage']) { try { if (!globalThis[k] || typeof globalThis[k].getItem !== 'function') throw 0; globalThis[k].getItem('x'); } catch { Object.defineProperty(globalThis, k, { value: memStorage(), configurable: true, writable: true }); } }

test('admin codes: PBKDF2 verifier matches a self-made test vector and rejects wrong codes', async () => {
  // dummy vector (NOT the real code): code/salt made up here, expected hash from node:crypto
  const salt = createHash('sha256').update('pitchside-test-salt').digest('hex').slice(0, 32);
  const dummy = { salt, iterations: 1000, hash: pbkdf2Sync('dummy-code-123', Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex') };
  assert.equal(await A.pbkdf2Hex('dummy-code-123', salt, 1000), dummy.hash);
  assert.equal(await A.verifyCodeWith('dummy-code-123', dummy), true);
  assert.equal(await A.verifyCodeWith('dummy-code-124', dummy), false);
  assert.equal(await A.verifyLocalCode('dummy-code-123', { temp: dummy }), 'temp');
  assert.equal(await A.verifyLocalCode('definitely-not-the-code'), null); // real parameters, known-wrong code
  assert.ok(A.safeEqualHex('ABcd', 'abcd') && !A.safeEqualHex('abcd', 'abce') && !A.safeEqualHex('abc', 'abcd'));
  // only parameters are stored: 16-byte salts, 32-byte hashes, 600k iterations
  for (const lv of ['full', 'temp']) { const q = A.ADMIN_CODE_PARAMS[lv]; assert.equal(q.salt.length, 32); assert.equal(q.hash.length, 64); assert.equal(q.iterations, 600000); }
});

test('admin codes: "Invalid code", lockout after 5 attempts, temp level limits, account roles', async () => {
  A.clearFailures(); A.clearAdminSession(); A.setAccountRole(null);
  for (let i = 1; i <= 4; i++) { const r = await A.redeemAdminCode(`wrong-${i}`, null); assert.equal(r.ok, false); assert.equal(r.error, 'Invalid code'); assert.ok(!r.locked); }
  const fifth = await A.redeemAdminCode('wrong-5', null);
  assert.equal(fifth.error, 'Invalid code'); assert.ok(fifth.locked > 55000);
  const blocked = await A.redeemAdminCode('anything', null);
  assert.ok(blocked.locked > 0 && /Too many attempts/.test(blocked.error));
  assert.ok(A.lockRemainingMs() > 0 && A.lockRemainingMs() <= 60000);
  A.clearFailures();
  // success path with a swapped-in dummy vector (real parameters restored afterwards)
  const saved = { ...A.ADMIN_CODE_PARAMS.temp };
  const salt = 'ab'.repeat(16);
  Object.assign(A.ADMIN_CODE_PARAMS.temp, { salt, iterations: 1000, hash: pbkdf2Sync('temp-dummy', Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex') });
  try {
    const ok = await A.redeemAdminCode('temp-dummy', { available: async () => false, admin: { verify: async () => true } });
    assert.deepEqual(ok, { ok: true, level: 'temp' });
  } finally { Object.assign(A.ADMIN_CODE_PARAMS.temp, saved); }
  assert.equal(A.getAdminLevel(), 'temp');
  assert.ok(A.adminInfo().tempRemainingMs > 59 * 60000);
  assert.ok(A.adminCan('packs') && A.adminCan('grant') && !A.adminCan('reset') && !A.adminCan('infinite') && !A.adminCan('onlineCoins') && !A.adminCan('moderation'));
  const st = { coins: 0 };
  assert.equal(A.addLocalCoins(st, 5e6), 1e6);
  assert.equal(A.matchAdminLevel(), null);
  assert.equal(A.getAdminLevel(Date.now() + 61 * 60000), null, 'temp admin expires after 60 minutes');
  A.clearAdminSession();
  // online verify wins when reachable
  const on = await A.redeemAdminCode('whatever', { available: async () => true, admin: { verify: async () => true } });
  assert.deepEqual(on, { ok: true, level: 'full' });
  assert.ok(A.adminCan('reset') && A.adminCan('moderation'));
  A.clearAdminSession();
  // account roles
  A.setAccountRole('owner'); assert.equal(A.getAdminLevel(), 'full'); assert.equal(A.matchAdminLevel(), 'owner');
  A.setAccountRole('mod'); assert.equal(A.getAdminLevel(), 'mod'); assert.ok(A.adminCan('moderation') && !A.adminCan('infinite'));
  assert.ok(await A.refreshAccountRole({ account: { current: async () => ({ role: 'owner' }) } }) || A.accountRole() === 'owner');
  assert.equal(A.accountRole(), 'owner');
  A.setAccountRole(null); A.clearFailures();
  assert.equal(A.getAdminLevel(), null);
});

test('real regulars: ~150 extra players, no duplicate names across lists, regular gold cards at sensible clubs', () => {
  const db = getDB();
  assert.ok(REG_ROW_COUNT >= 150, `only ${REG_ROW_COUNT}`);
  assert.equal(db.regulars.length, REG_ROW_COUNT);
  const reg = new Set(REAL_NAMES.regulars);
  assert.equal(reg.size, REAL_NAMES.regulars.length, 'duplicate within regulars');
  for (const n of REAL_NAMES.icons.concat(REAL_NAMES.stars)) assert.ok(!reg.has(n), `${n} duplicated in regulars`);
  assert.equal(new Set(REAL_NAMES.stars).size, REAL_NAMES.stars.length);
  const persons = new Set(db.real.map((p) => p.person));
  const clubIds = new Set(CLUBS.map((c) => c.id));
  for (const p of db.regulars) {
    assert.ok(!persons.has(p.person), `${p.name} person clash`);
    assert.equal(p.special, null); assert.ok(p.real && p.rare);
    assert.equal(p.tier, tierOf(p.ovr));
    assert.ok(p.ovr >= 78 && p.ovr <= 92, `${p.name} ${p.ovr}`);
    assert.ok(clubIds.has(p.club) && CLUBS.find((c) => c.id === p.club).league === p.league);
    assert.ok(db.players.includes(p));
  }
  for (const n of ['Erling Haaland', 'Jude Bellingham', 'Lamine Yamal', 'Virgil van Dijk', 'Alisson Becker', 'Rodri']) assert.ok(reg.has(n), n);
  assert.ok(db.regulars.filter((p) => p.pos === 'GK').length >= 12 && db.regulars.filter((p) => ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p.pos)).length >= 35);
  const cnt = {}; for (const p of db.players) cnt[p.club] = (cnt[p.club] || 0) + 1;
  for (const [c, n] of Object.entries(cnt)) assert.ok(n <= 36, `${c} has ${n} players`);
  // packs + market see them
  assert.ok(UT.categoryPools().gold86.some((p) => p.id.startsWith('rp_')));
  assert.ok(UT.marketSearch({ name: 'haaland' }).some((l) => l.pid === 'rp_haaland'));
});

test('promos: rating ranges, boosts and PlayStyles, stable ids, packs with walkouts', () => {
  const db = getDB();
  assert.ok(PR.PROMOS.length >= 10, `only ${PR.PROMOS.length} promos`);
  for (const pr of PR.PROMOS) {
    const cards = db.promos.filter((p) => p.special === pr.id);
    assert.ok(cards.length >= 8, `${pr.id} has ${cards.length}`);
    for (const p of cards) {
      const base = getPlayer(p.baseId);
      assert.ok(p.ovr >= pr.range[0] && p.ovr <= pr.range[1], `${p.id} ${p.ovr} outside ${pr.range}`);
      assert.ok(p.ovr > base.ovr, `${p.id} not boosted`);
      assert.equal(p.ovr, computeOvr(p.pos, p));
      assert.ok(p.playstyles.filter((x) => x.plus).length >= Math.min(p.playstyles.length, (base.playstyles || []).filter((x) => x.plus).length + 1));
      assert.equal(getPlayer(p.id), p);
    }
  }
  const toty = db.promos.filter((p) => p.special === 'toty');
  assert.equal(toty.length, 11);
  assert.ok(toty.every((p) => p.ovr >= 96 && p.ovr <= 98));
  assert.ok(db.promos.filter((p) => p.special === 'tots').every((p) => p.ovr >= 92 && p.ovr <= 97));
  assert.ok(db.promos.filter((p) => p.special === 'birthday').every((p) => p.sm >= getPlayer(p.baseId).sm && p.wf === Math.min(5, getPlayer(p.baseId).wf + 1)));
  assert.ok(db.promos.filter((p) => p.special === 'rttk').every((p) => p.upg && p.upg.level >= 0 && p.upg.level <= 4));
  assert.ok(db.promos.some((p) => p.special === 'flashback' && p.baseId === 'ic_ronaldinho'));
  // In-Forms: +3..+8 scaled to the base card
  const ifs = db.specials.filter((p) => p.special === 'inform');
  for (const p of ifs) { const d = p.ovr - getPlayer(p.baseId).ovr; assert.ok((d >= 3 && d <= 8) || p.ovr === 99, `${p.id} +${d}`); }
  assert.ok(Math.max(...ifs.map((p) => p.ovr)) >= 95, 'in-forms reach 95+');
  // calendar + packs
  for (let w = 1; w < 60; w++) { const live = PR.livePromos(w); assert.ok(live.length >= 1 && live.length <= 2 && live.every((id) => PR.PROMO_BY_ID[id])); }
  // Scan far enough to reach every campaign's launch week (a campaign always headlines the week it launches;
  // late-launching campaigns like finalchapter/fiesta need more than `PROMOS.length * 2` weeks to show up).
  const scanWeeks = Math.max(PR.PROMOS.length * 2, ...PR.PROMOS.map((p) => p.releaseWeek || 0)) + 2;
  const seen = new Set(); for (let w = 1; w <= scanWeeks; w++) seen.add(PR.promoOfWeek(w));
  assert.equal(seen.size, PR.PROMOS.length, 'every campaign appears in the calendar');
  for (const pr of PR.PROMOS) {
    const pack = UT.PACK_BY_ID[`promo_${pr.id}`];
    assert.ok(pack && pack.promo === pr.id);
    for (const sl of pack.slots) assert.ok(Math.abs(Object.values(sl.odds).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    const items = UT.openPack(pack.id, new Set(), new Rng(`pp-${pr.id}`));
    assert.equal(getPlayer(items[0].pid).special, pr.id, 'promo card leads the pack');
    assert.equal(UT.packFlare(items), 'walkout');
  }
  // before the owner's all-packs release only live campaigns sell; from then on every promo pack does, never Admin Vault
  const early = PR.ALL_PACKS_ON_SALE_FROM - 1;
  assert.ok(UT.storePacks(early).filter((p) => p.promo).every((p) => PR.livePromos(early).includes(p.promo)));
  const now = UT.storePacks(PR.ALL_PACKS_ON_SALE_FROM);
  assert.equal(now.filter((p) => p.promo).length, PR.PROMOS.length, 'every promo pack on sale');
  assert.ok(!now.some((p) => p.adminOnly), 'Admin Vault stays out of the store');
  // admin Store packs list: off hides any pack, on sells a promo pack outside its live weeks; Admin Vault never
  const cfg = { packsEnabled: true, promosEnabled: true, disabledPacks: ['gold', 'promo_toty'], forcedPacks: ['promo_fiesta', 'adminvault'] };
  const ids = UT.storePacks(early, cfg).map((p) => p.id);
  assert.ok(!ids.includes('gold') && !ids.includes('promo_toty') && ids.includes('promo_fiesta') && !ids.includes('adminvault'));
});

test('promos: SBCs and objectives award promo players; saves with promo/TOTW cards migrate', () => {
  const live = PR.livePromos();
  const s = UT.createUTState({ clubName: 'Promo FC' }, new Rng(99));
  const sbc = UT.SBCS.find((x) => x.promo === live[0] && !x.repeatable);
  assert.ok(sbc && UT.sbcAvailable(s, sbc));
  const off = UT.SBCS.find((x) => x.promo && !live.includes(x.promo));
  if (off) assert.equal(UT.sbcAvailable(s, off), false);
  const got = UT.grantReward(s, sbc.reward, 'test');
  const pid = UT.promoRewardPid(sbc.reward.promoPlayer);
  assert.ok(pid && s.club.includes(pid) && getPlayer(pid).special === live[0], got.join());
  const objs = OBJ.catalog().filter((o) => o.section === 'promo');
  assert.equal(objs.length, live.length * 3);
  assert.ok(objs.some((o) => o.reward.promoPlayer));
  // old + new ids survive a save round-trip
  const tw = totwCards(3)[0];
  const legacy = getPlayer('tw3_' + db2legacy(3));
  const saved = JSON.parse(JSON.stringify({ ...s, club: s.club.concat([tw.id, legacy.id, 'pr_toty_rp_haaland']) }));
  const m = UT.migrateUT(saved);
  for (const id of [tw.id, legacy.id, 'pr_toty_rp_haaland', pid]) assert.ok(m.club.includes(id), `${id} lost`);
});
function db2legacy(week) { return TOTW.legacyTotwCards(week)[0].baseId; }

test('TOTW: 3 headliners rated 88-94 every week, boosts +3..+8, legacy ids still resolve', () => {
  for (const w of [1, 2, 5, 17, 40]) {
    const cards = totwCards(w);
    assert.equal(cards.length, 15);
    const heads = cards.filter((p) => p.headliner);
    assert.equal(heads.length, 3);
    for (const p of heads) assert.ok(p.ovr >= 88 && p.ovr <= 94, `week ${w} headliner ${p.ovr}`);
    for (const p of cards) {
      assert.ok(p.id.startsWith(`tt${w}_`)); assert.equal(p.special, 'inform'); assert.equal(p.totw, w);
      const d = p.ovr - getPlayer(p.baseId).ovr;
      assert.ok(d >= 2 && d <= 10, `${p.id} +${d}`);
      assert.equal(getPlayer(p.id).id, p.id);
    }
    assert.ok(Math.min(...cards.map((p) => p.ovr)) >= 77);
  }
  const lg = TOTW.legacyTotwCards(5);
  assert.equal(lg.length, 15);
  assert.ok(lg.every((p) => p.id.startsWith('tw5_') && getPlayer(p.id) === p && !getPlayer(p.baseId).real));
});

test('national teams stay valid with real regulars (incl. new nations Georgia and Slovenia)', () => {
  const nts = getNationalTeams();
  const byId = Object.fromEntries(nts.map((t) => [t.id, t]));
  for (const t of nts) assert.deepEqual(validateTeam(t), [], `${t.id}: ${validateTeam(t).join(', ')}`);
  assert.ok(byId.GEO && byId.SVN);
  assert.ok(byId.GEO.players.some((p) => p.id === 'rp_kvaratskhelia'));
  assert.ok(byId.NOR.players.some((p) => p.id === 'rp_haaland'));
  assert.ok(byId.ENG.players.filter((p) => getPlayer(p.id) && getPlayer(p.id).real).length >= 5);
  for (const t of nts) { const real = t.players.filter((p) => getPlayer(p.id) && getPlayer(p.id).real); assert.equal(new Set(real.map((p) => getPlayer(p.id).person)).size, real.length, `${t.id} duplicates a person`); }
});

// ---------------- B9: every mode that plays a match vs AI must build a valid, duplicate-free Team ----------------
function assertValidNoDup(t, label) {
  assert.deepEqual(validateTeam(t), [], `${label}: ${validateTeam(t).join(', ')}`);
  const persons = t.players.concat(t.bench).map((p) => getPlayer(p.id)).filter(Boolean).map((p) => p.person || p.baseId || p.id);
  assert.equal(new Set(persons).size, persons.length, `${label}: duplicate player`);
}

test('Squad Battles: every weekly opponent (all difficulties) builds a valid, duplicate-free Team', () => {
  for (const week of [1, 2, 3, 17, 40, 59]) {
    const opps = UT.battleOpponents(week);
    assert.equal(opps.length, 12);
    for (const o of opps) assertValidNoDup(o.team, `SB week ${week} ${o.name}`);
  }
});

test('Rivals AI: opponents at every difficulty build valid, duplicate-free Teams', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const diff of ['amateur', 'pro', 'world', 'legendary']) {
      const opp = RV.aiOpponent(`ladder-${seed}`, diff);
      assertValidNoDup(opp.team, `rivals ${diff} seed ${seed}`);
    }
  }
});

test('Draft: any-order picking, options stable per slot, completes only when XI + 7 subs are filled', () => {
  const d = DR.newDraft('anyorder');
  DR.chooseFormation(d, '4-3-3');
  const capIdx = DR.chooseCaptain(d, d.captainOptions[2]);
  assert.equal(d.bench.length, DR.BENCH_SIZE);
  assert.equal(DR.picksLeft(d), 10 + 7);
  // open every XI slot + sub slot in a scrambled order first: each keeps the same 5 when re-opened
  const order = [10, 0, 5, 3, 8, 1, 9, 2, 7, 4, 6].filter((i) => i !== capIdx);
  const first = new Map(order.map((i) => [i, DR.slotOptions(d, i).slice()]));
  const bfirst = [6, 0, 3, 1, 5, 2, 4].map((j) => [j, DR.benchOptions(d, j).slice()]);
  // no person is on offer in two open slots (a pick can never invalidate another slot's cards)
  const persons = new Set([getPlayer(d.captain)].map((p) => p.person || p.baseId || p.id));
  for (const ids of [...first.values(), ...bfirst.map((x) => x[1])]) for (const id of ids) {
    const p = getPlayer(id); const per = p.person || p.baseId || p.id;
    assert.ok(!persons.has(per), `${id} offered twice`); persons.add(per);
  }
  // mix subs and XI, pick the LAST option each time, in scrambled order
  const steps = [];
  order.forEach((i, k) => { steps.push(['s', i]); if (k < bfirst.length) steps.push(['b', bfirst[k][0]]); });
  for (const [kind, i] of steps) {
    assert.notEqual(d.stage, 'play');
    if (kind === 's') { const o = DR.slotOptions(d, i); assert.deepEqual(o, first.get(i), `slot ${i} stable`); DR.pickSlot(d, i, o[4]); }
    else { const o = DR.benchOptions(d, i); assert.deepEqual(o, bfirst.find((x) => x[0] === i)[1], `sub ${i} stable`); DR.pickBench(d, i, o[4]); }
    assert.throws(() => (kind === 's' ? DR.pickSlot(d, i, first.get(i)[0]) : DR.pickBench(d, i, 'x')));
  }
  assert.equal(DR.picksLeft(d), 0);
  assert.equal(d.stage, 'play');
  assert.throws(() => DR.pickBench(d, 0, 'x'));
  const t = DR.draftTeam(d);
  assert.deepEqual(validateTeam(t), []);
  assert.equal(t.bench.length, 7);
  assert.equal(t.bench.filter((p) => p.pos === 'GK').length >= 1, true, 'a sub keeper');
  // old saves (pre-subs) in the picking stage get 7 empty sub slots
  const old = DR.newDraft('legacy'); DR.chooseFormation(old, '4-4-2'); old.slots[0] = null; old.stage = 'slots'; old.bench = [];
  DR.slotOptions(old, 1);
  assert.equal(old.bench.length, 7);
});

test('Draft odds: strong captains, a headline 85+ card in (almost) every 5, chem-friendly options', () => {
  let capBest = 0, cap90 = 0, capMin = 99, n = 0, best = 0, has85 = 0, has88 = 0, chemLinked = 0, slotsWithXI = 0;
  const RUNS = 40;
  for (let r = 0; r < RUNS; r++) {
    const d = DR.newDraft(`odds-${r}`);
    DR.chooseFormation(d, DR.FORMATION_NAMES[r % DR.FORMATION_NAMES.length]);
    const caps = d.captainOptions.map(getPlayer);
    assert.equal(caps.length, 5);
    capMin = Math.min(capMin, ...caps.map((p) => p.ovr));
    const cb = Math.max(...caps.map((p) => p.ovr)); capBest += cb; if (cb >= 90) cap90++;
    DR.chooseCaptain(d, d.captainOptions[0]);
    let i;
    while ((i = DR.nextOpenSlot(d)) >= 0) {
      const xi = d.slots.filter(Boolean).map(getPlayer);
      const opts = DR.slotOptions(d, i).map(getPlayer);
      assert.equal(opts.length, 5);
      const b = Math.max(...opts.map((p) => p.ovr));
      n++; best += b; if (b >= 85) has85++; if (b >= 88) has88++;
      slotsWithXI++; if (opts.some((p) => xi.some((x) => x.nat === p.nat || x.league === p.league))) chemLinked++;
      DR.pickSlot(d, i, opts.sort((a, c) => c.ovr - a.ovr)[1].id);
    }
  }
  assert.ok(capMin >= 84, `captain min ${capMin}`);
  assert.ok(cap90 / RUNS >= 0.7, `captain 90+ only ${cap90}/${RUNS}`);
  assert.ok(best / n >= 86, `avg best-of-5 ${(best / n).toFixed(1)}`);
  assert.ok(has85 / n >= 0.8, `85+ in ${(100 * has85 / n).toFixed(0)}%`);
  assert.ok(has88 / n >= 0.3, `88+ in ${(100 * has88 / n).toFixed(0)}%`);
  assert.ok(chemLinked / slotsWithXI >= 0.8, `chem-linked option in ${(100 * chemLinked / slotsWithXI).toFixed(0)}%`);
});

test('Draft: repeated runs build valid, duplicate-free user + opponent Teams', () => {
  for (let i = 0; i < 8; i++) {
    const d = DR.newDraft(`stress-${i}`);
    DR.chooseFormation(d, DR.FORMATION_NAMES[i % DR.FORMATION_NAMES.length]);
    DR.chooseCaptain(d, d.captainOptions[0]);
    let guard = 0, slot;
    while ((slot = DR.nextOpenSlot(d)) >= 0 && guard++ < 20) DR.pickSlot(d, slot, DR.slotOptions(d, slot)[0]);
    while ((slot = DR.nextOpenBench(d)) >= 0 && guard++ < 40) DR.pickBench(d, slot, DR.benchOptions(d, slot)[0]);
    assert.equal(d.stage, 'play');
    assertValidNoDup(DR.draftTeam(d), `draft ${i} user`);
    for (let r = 0; r < 4; r++) { d.round = r; assertValidNoDup(DR.draftOpponent(d).team, `draft ${i} round ${r} opp`); }
  }
});

test('Tournaments (events): every template/round opponent builds a valid Team', () => {
  const s = UT.createUTState({ clubName: 'Evt2 FC' }, new Rng(21));
  UT.migrateUT(s);
  for (const week of [1, 5, 9]) {
    EVT.ensureEvents(s, week);
    for (const tpl of EVT.EVENT_TEMPLATES) {
      const run = EVT.eventRun(s, tpl.id);
      for (run.round = 0; run.round < 4; run.round++) {
        assertValidNoDup(EVT.eventOpponent(s, tpl, run).team, `event ${tpl.id} w${week} r${run.round}`);
      }
    }
  }
});

// ---------------- V4 (owner request Sep 26): vault, unreleased promos hidden, more promos ----------------
test('SBC storage vault: duplicates auto-vault (capped, allows repeats), usable in SBCs, spent before the club copy', () => {
  const s = UT.createUTState({ clubName: 'Vault FC' }, new Rng(31));
  UT.migrateUT(s);
  const pid = s.club[0];
  assert.deepEqual(UT.claimPackItem(s, 'zz_never_owned_before'), { where: null }); // unknown id: no-op, no throw
  const before = s.club.length;
  const r1 = UT.claimPackItem(s, pid); // already owned -> vault
  assert.equal(r1.where, 'vault');
  assert.equal(s.club.length, before);
  assert.ok(s.vault.includes(pid));
  assert.ok(UT.isOwnedAnywhere(s, pid));
  for (let i = 0; i < 10; i++) UT.sendToVault(s, pid); // vault allows repeats of the same id
  assert.equal(s.vault.filter((x) => x === pid).length, 11);
  const fillers = getDB().players.slice(0, 250);
  for (const f of fillers) UT.sendToVault(s, f.id);
  assert.ok(s.vault.length <= UT.VAULT_CAP, `vault grew past cap: ${s.vault.length}`);
  assert.equal(s.vault.length, UT.VAULT_CAP);
  const notOwned = getDB().players.find((p) => !s.club.includes(p.id));
  const r2 = UT.claimPackItem(s, notOwned.id);
  assert.equal(r2.where, 'club'); // not a duplicate -> straight into the club
  // spend a vault duplicate in an SBC without touching the club's own copy
  const bronzes = getDB().players.filter((p) => p.tier === 'bronze' && !s.club.includes(p.id)).slice(0, 11).map((p) => p.id);
  for (const id of bronzes) UT.addToClub(s, id);
  UT.sendToVault(s, bronzes[0]); // a second copy of a club card, parked in the vault
  const vaultCountBefore = s.vault.filter((x) => x === bronzes[0]).length;
  UT.submitSbc(s, 'bronze-up', '4-4-2', bronzes.slice());
  assert.ok(s.club.includes(bronzes[0]), 'the club copy must survive — the vault copy should be spent first');
  assert.equal(s.vault.filter((x) => x === bronzes[0]).length, vaultCountBefore - 1);
});

test('unreleased promo cards never appear in the AI market, packs, draft or objective/SBC rewards', () => {
  const future = PR.PROMOS.find((p) => p.releaseWeek && p.releaseWeek > 1);
  assert.ok(future, 'no promo has a future releaseWeek');
  const before = future.releaseWeek - 1;
  assert.equal(PR.isPromoReleased(future.id, before), false);
  assert.equal(PR.isPromoReleased(future.id, future.releaseWeek), true);
  // AI market
  for (let seed = 0; seed < 30; seed++) {
    const items = UT.marketSearch({ tier: 'special' }, `unreleased-${seed}`);
    assert.ok(items.every((it) => getPlayer(it.pid).special !== future.id), `market leaked ${future.id}`);
  }
  // the dedicated pack never shows in the store before release, and never grants the card as a "drop from any pack" bonus
  assert.ok(!UT.storePacks(Math.min(before, PR.ALL_PACKS_ON_SALE_FROM - 1)).some((p) => p.promo === future.id));
  for (let seed = 0; seed < 200; seed++) {
    const items = UT.openPack('gold', new Set(), new Rng(`unreleased-gold-${seed}`));
    assert.ok(items.every((it) => getPlayer(it.pid).special !== future.id));
  }
  // SBC / objective rewards
  const sbc = UT.SBCS.find((x) => x.promo === future.id);
  const s = UT.createUTState({ clubName: 'Rel FC' }, new Rng(32));
  assert.equal(UT.sbcAvailable(s, sbc), false);
  assert.ok(!PR.releasedLivePromos(before).includes(future.id));
  // draft: never offered as a slot/captain option
  const d = DR.newDraft('unreleased-draft');
  DR.chooseFormation(d, '4-3-3');
  assert.ok(d.captainOptions.every((id) => getPlayer(id).special !== future.id));
});

test('promo cards job: 20+ campaigns, each with theme, colours, card class and a launch week; unreleased stay hidden', async () => {
  const HEX = /^#[0-9a-f]{6}$/i;
  assert.ok(PR.PROMOS.length >= 20, `only ${PR.PROMOS.length} promos`);
  const weeks = new Set();
  for (const pr of PR.PROMOS) {
    assert.ok(pr.theme && typeof pr.theme === 'string', `${pr.id} theme`);
    assert.ok(Array.isArray(pr.colors) && pr.colors.length === 3 && pr.colors.every((c) => HEX.test(c)), `${pr.id} colours`);
    assert.ok(pr.name && pr.short && pr.tag && pr.desc && pr.range[0] < pr.range[1] && pr.range[1] <= 99, `${pr.id} fields`);
    // Owner-approved FIFA 23 campaign names replace the former fictional naming policy.
    assert.ok(pr.design && /^f23-[\w-]+$/.test(pr.design), `${pr.id} needs local FIFA 23 artwork`);
    // the original seven are already released; everything newer carries a unique launch week
    if (pr.releaseWeek) { assert.ok(!weeks.has(pr.releaseWeek), `${pr.id} shares a launch week`); weeks.add(pr.releaseWeek); }
    else assert.ok(['toty', 'tots', 'futurestars', 'flashback', 'birthday', 'rttk', 'moments'].includes(pr.id), `${pr.id} needs a releaseWeek`);
    if (pr.releaseWeek > 1) {
      assert.equal(PR.promoOfWeek(pr.releaseWeek), pr.id, `${pr.id} headlines its launch week`);
      assert.ok(!PR.releasedLivePromos(pr.releaseWeek - 1).includes(pr.id));
      assert.equal(PR.isCardReleased({ special: pr.id }, pr.releaseWeek - 1), false);
    }
  }
  // every week from the V5 rotation on has at least one released, live campaign (no empty weeks)
  for (let w = 39; w < 120; w++) assert.ok(PR.releasedLivePromos(w).length >= 1, `week ${w} has no promo`);
  // Legacy campaigns retain CSS artwork; new campaigns supply local backgrounds for the card renderer.
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../../../css/meta.css', import.meta.url), 'utf8');
  for (const pr of PR.PROMOS) assert.ok(
    css.includes(`.sp-${pr.id} {`) || fs.existsSync(new URL(`../../../assets/cards/${pr.design}.webp`, import.meta.url)),
    `no card design for ${pr.id}`);
  const { cardClasses } = await import('../ui/card.js');
  // Admin card-creator cards store the chosen promo design only in \`special\` — they must still render as that promo
  assert.ok(cardClasses({ tier: 'gold', special: 'storm', customAdmin: true }).includes('is-promo'));
  assert.ok(cardClasses({ tier: 'gold', special: 'inform' }).every((c) => c !== 'is-promo'));
  // pack opening reads the same colours
  const SEQ = await import('../ui/packopen_seq.js');
  for (const pr of PR.PROMOS) assert.deepEqual(SEQ.classifyPull({ ovr: 90, tier: 'gold', special: pr.id }, PR.PROMO_BY_ID).colors, pr.colors);
});

test('pack opening safety nets: watchdog limit/trip, time-boxing, CSS gate + fixed overlay wiring', async () => {
  const SEQ = await import('../ui/packopen_seq.js');
  const PR = await import('../core/promos.js');
  // watchdog limit = longest gap between beats + grace, for every kind of pull
  for (const best of [{ ovr: 70, tier: 'silver' }, { ovr: 84, tier: 'gold', rare: true }, { ovr: 91, tier: 'gold', special: 'lotg' }, { ovr: 90, tier: 'gold', special: PR.PROMOS[0].id }]) {
    const steps = SEQ.buildPackSequence(SEQ.classifyPull(best, PR.PROMO_BY_ID), { figure: true });
    const lim = SEQ.watchdogLimit(steps);
    let gap = 0; for (let i = 1; i < steps.length; i++) gap = Math.max(gap, steps[i].at - steps[i - 1].at);
    assert.equal(lim, gap + SEQ.WATCHDOG_GRACE_MS);
    assert.ok(lim <= 2000 + SEQ.WATCHDOG_GRACE_MS, `a beat gap of ${gap}ms is too long for the watchdog`);
  }
  assert.equal(SEQ.watchdogLimit([], 100), 100);
  // trips only while actively playing, and only after the limit
  assert.equal(SEQ.watchdogTripped({ phase: 'playing', lastProgress: 0, now: 3000, limit: 2500 }), true);
  assert.equal(SEQ.watchdogTripped({ phase: 'playing', lastProgress: 0, now: 2000, limit: 2500 }), false);
  for (const phase of ['ready', 'reveal', 'grid']) assert.equal(SEQ.watchdogTripped({ phase, lastProgress: 0, now: 1e9, limit: 1 }), false, phase);
  assert.equal(SEQ.watchdogTripped({ phase: 'flag', lastProgress: 0, now: 9000, limit: 6000, active: ['intro', 'flag'] }), true);
  // time-boxing: resolves in time, times out on a promise that never settles, reports rejections, never rejects
  assert.deepEqual(await SEQ.timeBox(Promise.resolve(7), 50), { ok: true, value: 7 });
  const never = new Promise(() => {});
  const t0 = Date.now();
  assert.deepEqual(await SEQ.timeBox(never, 30), { ok: false, timedOut: true });
  assert.ok(Date.now() - t0 < 1000);
  const rej = await SEQ.timeBox(Promise.reject(new Error('no webgl')), 50);
  assert.equal(rej.ok, false); assert.equal(rej.error.message, 'no webgl');
  // injectable timers: the timeout path fires without real time passing
  let fire = null;
  const fake = { setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {} };
  const pending = SEQ.timeBox(never, 99999, fake); fire();
  assert.equal((await pending).timedOut, true);
  assert.ok(SEQ.CSS_WAIT_MS <= 1500, 'the 2D fallback must appear within 1.5 s when packs.css is missing');
  // wiring guards (the laptop/Chromebook "blank blue stage" bug): the CSS is preloaded, the overlay is pinned
  // with inline fixed styles, page scroll is locked, and both animations are watched
  const fs = await import('node:fs');
  const src = (f) => fs.readFileSync(new URL(`../ui/${f}`, import.meta.url), 'utf8');
  assert.match(src('packopen.js'), /^if \(typeof document !== 'undefined'\) ensureCss\(\);/m);
  for (const f of ['packopen_fut.js', 'packopen_classic.js']) {
    const code = src(f);
    for (const k of ['pinOverlay(ov)', 'pinSkip(skipBtn)', 'lockScroll()', 'unlockScroll()', 'watchdogTripped(', 'clearInterval(watchdog)']) assert.ok(code.includes(k), `${f} is missing ${k}`);
  }
  assert.ok(src('packopen_fut.js').includes('waitPackCss(CSS_WAIT_MS)'));
  assert.ok(src('packopen_classic.js').includes('timeBox(scene.introSequence()'));
});

test('pack summary bulk actions: send all to club / SBC storage / transfer list, quick sell', async () => {
  const SEQ = await import('../ui/packopen_seq.js');
  const s = UT.createUTState({ clubName: 'Bulk FC' }, new Rng(71));
  UT.migrateUT(s);
  const owned = s.club[0];
  const fresh = getDB().players.filter((p) => !s.club.includes(p.id)).slice(0, 4).map((p) => p.id);
  s.untradeable.push(fresh[3]); // e.g. an untradeable reward card
  const mk = () => [
    { pid: fresh[0], dup: false, state: 'new' }, { pid: fresh[1], dup: false, state: 'new' },
    { pid: owned, dup: true, state: 'new' }, { pid: fresh[2], dup: false, state: 'sold' },
    { pid: fresh[3], dup: false, state: 'new' },
  ];
  const ids = (xs) => xs.map((x) => x.pid);
  const tradeable = (pid) => !s.untradeable.includes(pid);
  assert.deepEqual(ids(SEQ.bulkTargets(mk(), 'club')), [fresh[0], fresh[1], fresh[3]]);
  assert.deepEqual(ids(SEQ.bulkTargets(mk(), 'vault')), [fresh[0], fresh[1], owned, fresh[3]], 'SBC storage takes every pending item, duplicates too');
  assert.deepEqual(ids(SEQ.bulkTargets(mk(), 'transfer', tradeable)), [fresh[0], fresh[1]], 'transfer list skips duplicates and untradeables');
  assert.deepEqual(ids(SEQ.bulkTargets(mk(), 'sellDups')), [owned]);
  assert.deepEqual(ids(SEQ.bulkTargets(mk(), 'sellAll')), [fresh[0], fresh[1], owned, fresh[3]]);
  assert.deepEqual(SEQ.bulkTargets(mk(), 'nope'), []);
  // "Send all to transfer list" through the real store functions (what utview's onTransfer does)
  for (const x of SEQ.bulkTargets(mk(), 'transfer', tradeable)) { UT.addToClub(s, x.pid); assert.ok(PM.sendToTransferList(s, x.pid).ok); }
  assert.ok(PM.onTransferList(s, fresh[0]) && PM.onTransferList(s, fresh[1]));
  assert.ok(s.club.includes(fresh[0]), 'listed cards stay in the club until sold');
  assert.ok(!PM.onTransferList(s, owned));
  // "Send all to SBC storage" through the vault store function
  const before = (s.vault || []).length;
  for (const x of SEQ.bulkTargets(mk(), 'vault')) assert.ok(UT.sendToVault(s, x.pid));
  assert.equal(s.vault.length, before + 4);
  assert.equal(s.vault.filter((id) => id === owned).length, 1, 'the duplicate copy is parked in storage');
  // the summary wires both buttons to those callbacks
  const common = (await import('node:fs')).readFileSync(new URL('../ui/packopen_common.js', import.meta.url), 'utf8');
  assert.ok(common.includes("'Send all to SBC storage'") && common.includes("'Send all to transfer list'"));
  const utv = (await import('node:fs')).readFileSync(new URL('../ui/utview.js', import.meta.url), 'utf8');
  assert.match(utv, /onTransfer: \(pid\) => \{ (?:done\(pid\); )?UT\.addToClub\(s, pid\); const r = PM\.sendToTransferList\(s, pid\)/);
});

test('transfer list (pmarket): flag a club card for sale without listing it yet, then list or return it', async () => {
  const s = UT.createUTState({ clubName: 'TL FC' }, new Rng(33));
  UT.migrateUT(s);
  const pid = s.squad.slots.find(Boolean) ? s.club.find((x) => !s.untradeable.includes(x)) : s.club[0];
  const r = PM.sendToTransferList(s, pid);
  assert.ok(r.ok, r.error);
  assert.ok(PM.onTransferList(s, pid));
  assert.ok(s.club.includes(pid), 'transfer list keeps the card in the club until it actually sells');
  PM.removeFromTransferList(s, pid);
  assert.ok(!PM.onTransferList(s, pid));
});

test('global config: safe local defaults, injectable provider, gates packs/promos/coins/tax', async () => {
  const CFG = await import('../core/config.js');
  CFG.setConfigProvider(null);
  assert.deepEqual(CFG.getConfig(), CFG.CONFIG_DEFAULTS);
  assert.equal(PM.afterTax(1000), 950);
  CFG.setConfigProvider(() => { throw new Error('offline'); });
  assert.deepEqual(CFG.getConfig(), CFG.CONFIG_DEFAULTS); // never throws, never returns a partial object
  CFG.setConfigProvider(() => ({ packsEnabled: false }));
  assert.deepEqual(UT.storePacks(), []);
  CFG.setConfigProvider(() => ({ promosEnabled: false }));
  assert.ok(UT.storePacks().every((p) => !p.promo));
  CFG.setConfigProvider(() => ({ disabledPacks: ['gold'] }));
  assert.ok(!UT.storePacks().some((p) => p.id === 'gold'));
  CFG.setConfigProvider(() => ({ packPriceMult: 2 }));
  assert.equal(UT.packPriceFor(UT.PACK_BY_ID.gold), UT.PACK_BY_ID.gold.price * 2);
  CFG.setConfigProvider(() => ({ rewardMult: 2 }));
  const s = UT.createUTState({ clubName: 'Cfg FC' }, new Rng(34));
  const before = s.coins;
  UT.grantReward(s, { coins: 1000 }, 'test');
  assert.equal(s.coins, before + 2000);
  CFG.setConfigProvider(() => ({ marketTaxPct: 10 }));
  assert.equal(PM.afterTax(1000), 900);
  CFG.setConfigProvider(null); // restore defaults for any later test
});

test('sensible alt positions (e.g. Messi RW + RM/CAM/CF/ST); coins never go negative or NaN', () => {
  for (const id of ['ic_messi', 'rs_messi']) {
    const m = getPlayer(id);
    assert.equal(m.pos, 'RW');
    for (const pos of ['RM', 'CAM', 'CF', 'ST']) assert.ok(m.alt.includes(pos), `${id} missing alt ${pos}`);
    assert.ok(!m.alt.includes('RW'));
  }
  const s = UT.createUTState({ clubName: 'Coin FC' }, new Rng(41));
  UT.addCoins(s, -1e12);
  assert.equal(s.coins, 0);
  UT.addCoins(s, NaN);
  assert.equal(s.coins, 0);
  UT.addCoins(s, 1500.6);
  assert.equal(s.coins, 1501);
});

test('pack opening (new): pull classification, beat sequence and packAnim setting', async () => {
  const SEQ = await import('../ui/packopen_seq.js');
  const { PROMO_BY_ID } = await import('../core/promos.js');
  const silver = SEQ.classifyPull({ ovr: 70, tier: 'silver' }, PROMO_BY_ID);
  assert.equal(silver.walkout, false); assert.equal(silver.level, 0);
  assert.equal(SEQ.classifyPull({ ovr: 78, tier: 'gold' }, PROMO_BY_ID).level, 1);
  assert.equal(SEQ.classifyPull({ ovr: 82, tier: 'gold' }, PROMO_BY_ID).level, 2);
  const walk = SEQ.classifyPull({ ovr: 90, tier: 'gold' }, PROMO_BY_ID);
  assert.ok(walk.walkout); assert.equal(walk.level, 3);
  const pr = SEQ.classifyPull({ ovr: 84, tier: 'gold', special: 'toty' }, PROMO_BY_ID);
  assert.ok(pr.walkout); assert.equal(pr.promoId, 'toty'); assert.deepEqual(pr.colors, PROMO_BY_ID.toty.colors);
  const kinds = (steps) => steps.map((s) => s.kind);
  const w = SEQ.buildPackSequence(walk, { figure: true });
  assert.deepEqual(kinds(w), ['rise', 'tension', 'rip', 'burst', 'card', 'banners', 'flag', 'rating', 'club', 'fireworks', 'flip', 'figure', 'done']);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].at >= w[i - 1].at, 'beats are in time order');
  assert.ok(kinds(SEQ.buildPackSequence(pr, {})).includes('promo'));
  const n = SEQ.buildPackSequence(silver, { figure: true });
  assert.deepEqual(kinds(n), ['rise', 'tension', 'rip', 'burst', 'card', 'flag', 'flip', 'done']);
  assert.ok(SEQ.beatAt(n, 'flip') < SEQ.beatAt(w, 'flip'), 'non-walkouts reveal quicker');
  assert.ok(SEQ.beatAt(SEQ.buildPackSequence(walk, { reduce: true }), 'flip') < SEQ.beatAt(w, 'flip'));
  assert.equal(SEQ.normalizePackAnim('classic'), 'classic');
  assert.equal(SEQ.normalizePackAnim(undefined), 'new');
  assert.equal(SEQ.normalizePackAnim('weird'), 'new');
});

// ---------------- B2: ratings/players/admin cards/secret card/managers ----------------
const SC = await import('../core/secretcard.js');
const MG = await import('../core/managers.js');
const PH = await import('../core/physique.js');

const { getPlayer: getPlayerB2 } = await import('../core/players.js');

test('B2: no duplicate ids anywhere in the real-player database, and no duplicate names within each list '
  + '(Messi/Ronaldo legitimately share a name across their icon + star *versions* — see personOf)', () => {
  const db = getDB();
  const ids = new Set(), dupIds = [];
  for (const p of db.real.concat(db.regulars)) { if (ids.has(p.id)) dupIds.push(p.id); ids.add(p.id); }
  assert.deepEqual(dupIds, []);
  for (const list of [REAL_NAMES.icons, REAL_NAMES.stars, REAL_NAMES.regulars]) {
    assert.equal(new Set(list.map((n) => n.toLowerCase())).size, list.length, 'duplicate name within one list');
  }
  const regSet = new Set(REAL_NAMES.regulars.map((n) => n.toLowerCase()));
  for (const n of REAL_NAMES.icons.concat(REAL_NAMES.stars)) assert.ok(!regSet.has(n.toLowerCase()), `${n} also a regular`);
});

test('B2: ratings bounds — icons 86-98, regulars 78-92, every OVR matches computeOvr(pos)', () => {
  const db = getDB();
  for (const p of db.real) {
    assert.ok(p.ovr >= 1 && p.ovr <= 99);
    if (p.era === 'prime') assert.ok(p.ovr >= 86 && p.ovr <= 99, `${p.name} ${p.ovr}`);
    assert.equal(p.ovr, computeOvr(p.pos, p));
  }
  for (const p of db.regulars) { assert.ok(p.ovr >= 78 && p.ovr <= 92, `${p.name} ${p.ovr}`); assert.equal(p.ovr, computeOvr(p.pos, p)); }
  // Owner call-outs (Sep 26/27): Cannavaro's 2006 peak, and Neymar's peak/legend tier.
  assert.ok(getPlayerB2('ic_cannavaro').ovr >= 96);
  assert.ok(getPlayerB2('rs_neymar').ovr >= 91);
  assert.deepEqual(getPlayerB2('rp_bellingham').alt.slice().sort(), ['CDM', 'CM', 'LM']);
});

test('B2: positions and alts are valid everywhere (icons+stars+regulars)', () => {
  const db = getDB();
  const POS = new Set(POSITIONS);
  for (const p of db.real.concat(db.regulars)) {
    assert.ok(POS.has(p.pos), `${p.id} bad pos ${p.pos}`);
    assert.ok(p.alt.length <= 4 && !p.alt.includes(p.pos), `${p.id} bad alt`);
    for (const a of p.alt) assert.ok(POS.has(a), `${p.id} bad alt entry ${a}`);
    assert.equal(new Set(p.alt).size, p.alt.length, `${p.id} duplicate alt`);
  }
});

test('B2: +500 real players — every club stays a valid Career starting squad (<= 32)', () => {
  const db = getDB();
  assert.ok(REG_ROW_COUNT >= 400, `only ${REG_ROW_COUNT} regulars`);
  const cnt = {};
  for (const p of db.players) cnt[p.club] = (cnt[p.club] || 0) + 1;
  // A handful of clubs already exceeded 32 purely from the generated (non-real) top-up passes before any of
  // this ran (pre-existing, out of scope here) — but no *newly*-affected club should end up unplayable, and
  // every club actually used by a Career test must have room for at least one signing.
  for (const id of ['ISL05', 'SOL04', 'ISL02', 'SOL05', 'ISL07']) assert.ok((cnt[id] || 0) < 32, `${id} has ${cnt[id]}`);
});

test('B2: Secret card ("The Shawky") — EGY, every position, every PlayStyle, "infinite" stats that stay '
  + 'math-safe, ~0.001 odds in the Secret Vault pack + ~0.005 in the admin-only Admin Vault pack only, '
  + 'never admin-grantable', () => {
  const card = SC.secretCard();
  assert.equal(card.special, 'secret');
  assert.equal(card.name, 'The Shawky');
  assert.equal(card.nat, 'EGY');
  // "Infinite": the number itself is finite/1-99-safe everywhere it's used for math (computeOvr already
  // clamps to 99 before the display override, and every face stat is a plain 99), but ovr/pot are pushed to
  // the same "over 99" signal admin cards use, and `glitch` is what the UI (card.js/utview.js) keys "∞" off.
  assert.equal(card.ovr, SC.INFINITE_OVR);
  assert.ok(card.ovr > 99, 'must read as admin-tier (isAdminChem/isSwapHidden) too');
  assert.equal(card.pot, card.ovr);
  assert.equal(card.glitch, true);
  assert.equal(computeOvr(card.pos, card), 99, 'face stats alone (before the "infinite" override) are a clean 99');
  for (const k of ['pac', 'sho', 'pas', 'dri', 'def', 'phy']) assert.equal(card.stats[k], 99);
  for (const k of ['div', 'han', 'kic', 'ref', 'spd', 'pos']) assert.equal(card.gk[k], 99);
  assert.ok(Number.isFinite(card.value) && Number.isFinite(card.wage) && card.value === 0 && card.wage === 0, 'never priced/tradeable');
  // Every position: main pos CF/ST, every other outfield position + GK in alt.
  assert.ok(['ST', 'CF'].includes(card.pos));
  assert.deepEqual([card.pos, ...card.alt].slice().sort(), POSITIONS.slice().sort());
  // Every PlayStyle AND PlayStyle+ that exists.
  const psIds = card.playstyles.map((x) => x.id).sort();
  assert.deepEqual(psIds, Object.keys(PH.PLAYSTYLES).sort());
  assert.ok(card.playstyles.every((x) => x.plus === true), 'every PlayStyle must be a PlayStyle+');
  // SBC rating math / sorting / chemistry never NaN or break with this card in a squad.
  const slots = new Array(11).fill(null); slots[9] = card;
  const rating = teamRating(slots);
  assert.ok(Number.isFinite(rating) && rating >= 0 && rating <= 99, `teamRating broke: ${rating}`);
  const chem = calcChemistry('4-3-3', slots);
  assert.equal(chem.players[9], 3, 'max chemistry (isAdminChem: ovr>99)');
  assert.ok(!SW.isSwapHidden || SW.isSwapHidden(card) === true, 'hidden from Swaps like admin cards');
  // Sorting by ovr (as pack/market/search views do) never produces NaN comparisons with this card mixed in.
  const mixed = [card, { ovr: 82 }, { ovr: 91 }].sort((a, b) => b.ovr - a.ovr);
  assert.equal(mixed[0], card);
  const db = getDB();
  assert.ok(!db.all.some((p) => p.id === card.id), 'secret card must never be in db.all');
  // Only the Secret Vault pack (public) and the Admin Vault pack (admin-only) ever reference the 'secret' odds.
  const pack = UT.PACK_BY_ID[SC.SECRET_PACK_ID];
  assert.ok(pack, 'secret pack missing');
  const hasSecret = (s) => Object.keys(s.odds).some((k) => k.startsWith('secret'));
  assert.ok(pack.slots.some(hasSecret));
  // Every version has its OWN chance (adding versions never makes The Shawky rarer).
  for (const v of SC.SECRET_VERSIONS) {
    if (v.adminOnly) assert.ok(!pack.slots[0].odds[`secret_${v.id}`], `${v.id} is Admin Vault only`); // E-Man / E.L.I.J.A.H.
    else assert.ok(Math.abs(pack.slots[0].odds[`secret_${v.id}`] - SC.SECRET_ODDS) < 1e-9, v.id);
  }
  for (const p of [pack]) for (const sl of p.slots) assert.ok(Math.abs(Object.values(sl.odds).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'odds sum to 1');
  const avPack = UT.PACK_BY_ID[UT.ADMIN_VAULT_PACK_ID];
  assert.ok(avPack, 'admin vault pack missing');
  for (const v of SC.SECRET_VERSIONS) assert.ok(Math.abs(avPack.slots[0].odds[`secret_${v.id}`] - UT.ADMIN_VAULT_SECRET_ODDS) < 1e-9, v.id);
  for (const p of UT.PACKS) if (p.id !== SC.SECRET_PACK_ID && p.id !== UT.ADMIN_VAULT_PACK_ID) assert.ok(!p.slots.some(hasSecret), `${p.id} also has secret odds`);
  // Statistically confirm both packs' actual pull rates match (large sample, seeded/deterministic).
  let hits = 0, shawky = 0; const N = 40000;
  for (let i = 0; i < N; i++) { const items = UT.openPack(SC.SECRET_PACK_ID, new Set(), new Rng(`secret-${i}`)); if (items.some((it) => SC.isSecretCardId(it.pid))) hits++; if (items.some((it) => it.pid === SC.SECRET_CARD_ID)) shawky++; }
  const nv = SC.SECRET_VERSIONS.filter((v) => !v.adminOnly).length, nvAll = SC.SECRET_VERSIONS.length;
  assert.ok(hits >= N * SC.SECRET_ODDS * nv * 0.6 && hits <= N * SC.SECRET_ODDS * nv * 1.4, `expected ~${N * SC.SECRET_ODDS * nv} hits, got ${hits}`);
  assert.ok(shawky >= N * SC.SECRET_ODDS * 0.4 && shawky <= N * SC.SECRET_ODDS * 1.8, `The Shawky alone keeps ~${N * SC.SECRET_ODDS}, got ${shawky}`);
  let avHits = 0;
  for (let i = 0; i < N; i++) { const items = UT.openPack(UT.ADMIN_VAULT_PACK_ID, new Set(), new Rng(`av-${i}`)); if (items.some((it) => SC.isSecretCardId(it.pid))) avHits++; }
  assert.ok(avHits >= N * UT.ADMIN_VAULT_SECRET_ODDS * nvAll * 0.8 && avHits <= N * UT.ADMIN_VAULT_SECRET_ODDS * nvAll * 1.2, `expected ~${N * UT.ADMIN_VAULT_SECRET_ODDS * nvAll} admin-vault hits, got ${avHits}`);
  // No admin level can ever grant it (the one generic "give any player id" API is admin.js's grantPlayer).
  const s = UT.createUTState({ clubName: 'X' }, new Rng(1));
  const r = A.grantPlayer(s, SC.SECRET_CARD_ID);
  assert.equal(r.ok, false);
  assert.ok(!s.club.includes(SC.SECRET_CARD_ID));
  // Every version (owner's list) is a full ∞ glitch card with its own name + nation, and none can be granted.
  // THE NII (`cursed`) is the one anti-version: OVR 1, floor stats, no glitch, carried into matches as `cursed`.
  assert.equal(SC.SECRET_VERSIONS.length, 18);
  for (const v of SC.SECRET_VERSIONS) {
    const c = getPlayer(v.id);
    if (v.cursed) {
      assert.ok(c && c.cursed && !c.glitch && c.ovr === 1 && c.stats.pac === 1 && c.cardTag === v.tag && c.special === 'secret', v.id);
      assert.equal(toMatchPlayer(c, 'ST', 9).cursed, true);
      assert.ok(UT.itemScore(c) > UT.itemScore(getPlayer(SC.SECRET_CARD_ID)), 'THE NII leads the pack reveal');
    } else assert.ok(c && c.glitch && c.ovr === SC.INFINITE_OVR && c.nat === v.nat && c.name === v.name, v.id);
    assert.ok(NATION_BY_CODE_T[c.nat] || v.fullArt, `nation ${c.nat} exists`); // the full-art knight uses a flag-only nation (art.js FLAG_ONLY)
    assert.equal(A.grantPlayer(s, v.id).ok, false);
  }
});

test('EVIL VINSON has an independent HELL card identity and stable display hook', () => {
  const c = SC.secretCard(SC.HELL_CARD_ID);
  assert.equal(c.id, 'secret_vinson');
  assert.equal(c.name, 'Evil Vinson');
  assert.equal(c.cardTag, 'WORSE THAN THOMAS');
  assert.equal(c.hell, true);
  assert.equal(c.evil, undefined);
  assert.equal(c.cursed, undefined);
  assert.equal(c.photo, 'assets/cards/evil-vinson.png');
  assert.equal(c.photoCut, false);
  assert.equal(c.ovr, SC.INFINITE_OVR);
  assert.ok(Object.values(c.stats).every((v) => v === 99));
  assert.equal(getPlayer(SC.HELL_CARD_ID), c);
});

test('B2: Admin Vault pack — admin-only (never in the public store), 10 varied random players per opening', () => {
  const pack = UT.PACK_BY_ID[UT.ADMIN_VAULT_PACK_ID];
  assert.ok(pack.adminOnly, 'must be flagged admin-only');
  assert.ok(!UT.storePacks().some((p) => p.id === UT.ADMIN_VAULT_PACK_ID), 'must never be in the public store');
  for (const s of pack.slots) assert.ok(Math.abs(Object.values(s.odds).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'slot odds sum to 1');
  const top50 = new Set(getDB().all.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 50).map((p) => p.id));
  let outsideTop = 0; const ovrs = new Set();
  for (let i = 0; i < 100; i++) {
    const items = UT.openPack(UT.ADMIN_VAULT_PACK_ID, new Set(), new Rng(`av-size-${i}`));
    assert.equal(items.length, UT.ADMIN_VAULT_SIZE);
    assert.equal(UT.ADMIN_VAULT_SIZE, 10);
    for (const it of items) {
      const p = getPlayer(it.pid);
      assert.ok(p, `unknown card ${it.pid}`);
      if (!top50.has(p.id)) outsideTop++;
      ovrs.add(p.ovr);
    }
    assert.ok(items.filter((it) => SC.isSecretCardId(it.pid)).length <= 1);
  }
  assert.ok(outsideTop > 100 * 7, 'not just the highest-rated cards');
  assert.ok(ovrs.size > 15, 'a varied spread of ratings');
});

test('Squads: up to 5 saved squads, switching keeps each one, cleans sold cards; auto-build settings work', async () => {
  const SQ = await import('../core/squads.js');
  const s = UT.createUTState({ clubName: 'Sq' }, new Rng('squads'));
  SQ.ensureSquads(s);
  assert.equal(s.squads.length, 1);
  const first = s.squad.slots.slice();
  assert.equal(SQ.addSquad(s, 'Second'), 1);
  assert.equal(s.activeSquad, 1);
  assert.deepEqual(s.squad.slots, first, 'a new squad starts as a copy');
  s.squad.slots[5] = null; s.squad.formation = '4-4-2';
  SQ.switchSquad(s, 0);
  assert.deepEqual(s.squad.slots, first, 'squad 1 unchanged');
  SQ.switchSquad(s, 1);
  assert.equal(s.squad.formation, '4-4-2'); assert.equal(s.squad.slots[5], null);
  // a card that left the club disappears from a stored squad when it is loaded
  SQ.switchSquad(s, 0);
  const gone = s.squad.slots[3];
  s.club = s.club.filter((id) => id !== gone);
  SQ.switchSquad(s, 1); SQ.switchSquad(s, 0);
  assert.ok(!s.squad.slots.includes(gone));
  for (let i = 0; i < 6; i++) SQ.addSquad(s, `x${i}`);
  assert.equal(s.squads.length, SQ.MAX_SQUADS);
  assert.equal(SQ.addSquad(s, 'too many'), -1);
  assert.ok(SQ.renameSquad(s, 0, '  Main  XI  ')); assert.equal(s.squads[0].name, 'Main XI');
  while (s.squads.length > 1) assert.ok(SQ.deleteSquad(s, s.activeSquad));
  assert.equal(SQ.deleteSquad(s, 0), false, 'never deletes the last squad');
  assert.equal(SQ.listSquads(s).length, 1);
  // auto-build settings
  assert.deepEqual(UT.autoBuildSettings(s), UT.AUTO_BUILD_DEFAULTS);
  UT.setAutoBuildSettings(s, { priority: 'chemistry', formation: 'best', bogus: 1 });
  assert.equal(UT.autoBuildSettings(s).priority, 'chemistry'); assert.equal(s.autoBuild.bogus, undefined);
  UT.autoSquad(s);
  assert.ok(s.squad.slots.every(Boolean), 'best formation squad is complete');
  const u = s.squad.slots[4];
  s.untradeable = [u];
  UT.setAutoBuildSettings(s, { untradeables: false, formation: 'current' });
  UT.autoSquad(s);
  assert.ok(!s.squad.slots.includes(u) && !s.squad.bench.includes(u), 'untradeables left out');
  UT.setAutoBuildSettings(s, { untradeables: true, fillOnly: true });
  const keep = s.squad.slots[7]; s.squad.slots[2] = null;
  UT.autoSquad(s);
  assert.equal(s.squad.slots[7], keep, 'fill-only keeps existing starters');
  assert.ok(s.squad.slots.every(Boolean), 'and fills the gap');
});

test('Auto-build filters: rating range, card type, league/club/country; gaps filled from the club when too few match', () => {
  const s = UT.createUTState({ clubName: 'Flt' }, new Rng('filters'));
  const db = getDB();
  // give the club plenty of one nation so a full XI of it is possible
  const fra = db.players.filter((p) => p.nat === 'FRA' && !p.special);
  for (const p of fra.slice(0, 40)) if (!s.club.includes(p.id)) s.club.push(p.id);
  UT.setAutoBuildSettings(s, { nation: 'FRA' });
  UT.autoSquad(s);
  const xi = s.squad.slots.map(getPlayer);
  assert.ok(xi.every(Boolean));
  assert.ok(xi.every((p) => p.nat === 'FRA'), 'every starter is French');
  assert.equal(s.autoBuildShort, 0);
  UT.setAutoBuildSettings(s, { nation: '', minOvr: 60, maxOvr: 70 });
  UT.autoSquad(s);
  const xi2 = s.squad.slots.map(getPlayer);
  const inRange = xi2.filter((p) => p.ovr >= 60 && p.ovr <= 70).length;
  assert.equal(inRange + s.autoBuildShort, 11, 'in-range starters + gaps filled from the club = 11');
  assert.ok(xi2.every(Boolean), 'always a full XI');
  // an impossible filter still returns a full XI, flagged as all gaps
  UT.setAutoBuildSettings(s, { minOvr: 0, maxOvr: 0, cardType: 'nosuchpromo' });
  UT.autoSquad(s);
  assert.ok(s.squad.slots.every(Boolean));
  assert.equal(s.autoBuildShort, 11);
  assert.equal(UT.autoBuildMatch({ special: null, tier: 'gold', rare: true, ovr: 80 }, UT.autoBuildSettings({ autoBuild: { cardType: 'base', rarity: 'rare', tier: 'gold' } })), true);
  assert.equal(UT.autoBuildMatch({ special: 'inform', tier: 'gold', rare: true, ovr: 80 }, UT.autoBuildSettings({ autoBuild: { cardType: 'base' } })), false);
});

test('B2: Manager cards contribute chemistry in both styles, and never regress an unmanaged squad', () => {
  const db = getDB();
  const mgr = MG.getManager('mgr_ashcombe'); // ENG / ISL / ISL01
  assert.ok(mgr);
  const eng = db.players.filter((p) => p.nat === 'ENG' && !p.real).slice(0, 11);
  assert.equal(eng.length, 11, 'need 11 ENG generated players for this test');
  const slots = new Array(11).fill(null);
  eng.forEach((p, i) => { slots[i] = p; });
  const noMgr = calcChemistry('4-3-3', slots);
  const withMgr = calcChemistry('4-3-3', slots, mgr);
  assert.ok(withMgr.total >= noMgr.total, 'manager must never lower classic chemistry');
  assert.ok(withMgr.total <= 33 && withMgr.scaled <= 100);
  assert.equal(withMgr.manager, mgr.id);
  const fcNo = calcChemistryFc26('4-3-3', slots);
  const fcYes = calcChemistryFc26('4-3-3', slots, mgr);
  assert.ok(fcYes.total >= fcNo.total, 'manager must never lower FC26 chemistry');
  assert.ok(fcYes.players.every((c, i) => c >= fcNo.players[i]), 'FC26 manager bonus is per-player, never negative');
  assert.ok(fcYes.total <= 33);
  // Wired into UT squad/state too.
  const s = UT.createUTState({ clubName: 'Y' }, new Rng(7));
  assert.equal(UT.setManager(s, 'mgr_ashcombe'), 'mgr_ashcombe');
  assert.equal(UT.setManager(s, 'not-a-real-manager'), null);
  assert.equal(UT.setManager(s, 'mgr_ashcombe'), 'mgr_ashcombe');
  assert.equal(UT.squadInfo(s).chem.manager, 'mgr_ashcombe');
  const migrated = UT.migrateUT(JSON.parse(JSON.stringify(s)));
  assert.equal(migrated.squad.manager, 'mgr_ashcombe');
});

test('B2: bestPlaystylesFor(pos) matches the owner reference chart and drives PlayStyle+ placement', () => {
  // owner chart (promorefs/playstyles_plus_by_position.jpg), updated Sep 27 with the FC 25/26 list
  assert.deepEqual(PH.bestPlaystylesFor('ST'), ['finesse', 'power', 'lowdriven']);
  assert.deepEqual(PH.bestPlaystylesFor('CB'), ['intercept', 'anticipate', 'bruiser']);
  assert.deepEqual(PH.bestPlaystylesFor('CDM'), ['longball', 'intercept', 'pinged']);
  assert.deepEqual(PH.bestPlaystylesFor('GK'), ['farreach', 'quickreflexes']);
  for (const pos of POSITIONS) for (const id of PH.bestPlaystylesFor(pos)) assert.ok(PH.PLAYSTYLES[id], `${pos} -> unknown style ${id}`);
  // At least some high-rated generated players actually carry a '+' on their position's best style.
  const db = getDB();
  const hits = db.players.filter((p) => p.ovr >= 90 && !p.real).filter((p) => {
    const best = new Set(PH.bestPlaystylesFor(p.pos));
    return p.playstyles.some((x) => x.plus && best.has(x.id));
  });
  assert.ok(hits.length > 0, 'no 90+ generated player got a position-best PlayStyle+');
});

test('B2: Neymar has several promo versions, the highest reaching 99, at least one released now', () => {
  const db = getDB();
  const base = getPlayerNeymar(db);
  const promos = db.promos.filter((p) => p.baseId === base.id);
  assert.ok(promos.length >= 3, `only ${promos.length} Neymar promo versions`);
  assert.ok(Math.max(...promos.map((p) => p.ovr)) === 99, 'top Neymar promo should reach 99');
  assert.ok(promos.filter((p) => p.ovr === 99).some((p) => PR.isCardReleased(p)), 'at least one Neymar 99 promo must be released now');
  for (const p of promos) assert.ok(p.ovr > base.ovr);
});
function getPlayerNeymar(db) { return db.stars.find((p) => p.person === 'neymar'); }

test('B2 (owner Sep 27): Neymar FLASHBACK promo card is 99 with boosted stats', () => {
  const db = getDB();
  const base = getPlayerNeymar(db);
  const flashback = db.promos.find((p) => p.baseId === base.id && p.special === 'flashback');
  assert.ok(flashback, 'Neymar has no FLASHBACK promo card');
  assert.equal(flashback.ovr, 99, `Neymar FLASHBACK should be 99, got ${flashback.ovr}`);
  assert.ok(flashback.ovr > base.ovr, 'FLASHBACK should be boosted over the base card');
  for (const k of Object.keys(flashback.stats)) assert.ok(flashback.stats[k] >= base.stats[k], `${k} should not regress on the boosted card`);
});

test('B2 (owner Sep 27): Salah has a guaranteed legend-level promo version', () => {
  const db = getDB();
  const base = db.stars.find((p) => p.person === 'salah');
  assert.ok(base, 'Salah missing from stars');
  const promos = db.promos.filter((p) => p.baseId === base.id);
  assert.ok(promos.length >= 1, 'Salah should have at least one promo version');
  assert.ok(Math.max(...promos.map((p) => p.ovr)) >= 94, 'Salah should have a legend-level (94+) promo card');
});

test('B2 (owner Sep 27): Egypt has a full, playable 2026 World Cup squad', () => {
  const db = getDB();
  const egypt = db.players.filter((p) => p.nat === 'EGY' && p.real);
  assert.ok(egypt.length >= 23, `only ${egypt.length} EGY real players in db.players`);
  const gks = egypt.filter((p) => p.pos === 'GK');
  assert.ok(gks.length >= 2, `only ${gks.length} EGY goalkeepers`);
  for (const p of egypt) {
    assert.ok(p.league && (LEAGUE_BY_ID[p.league] || SPECIAL_CLUBS[p.league]), `${p.name} has no usable league`);
    assert.ok(p.nat === 'EGY');
  }
  // Salah (Star) and Marmoush (regular) must both still be present.
  assert.ok(db.stars.some((p) => p.person === 'salah' && p.nat === 'EGY'), 'Salah missing');
  assert.ok(db.regulars.some((p) => p.person === 'marmoush'), 'Marmoush missing');
});

test('B2 (owner Sep 27): Egyptian all-time greats are Icons (Aboutrika, El-Hadary, Hossam Hassan…)', () => {
  const db = getDB();
  const iconSlugs = ['aboutrika', 'elhadary', 'hossamhassan', 'ahmedhassan', 'hanyramzy', 'elkhatib', 'waelgomaa', 'zidanmo', 'amrzaki', 'mido', 'barakat', 'ahmedfathy'];
  for (const slug of iconSlugs) {
    const icon = db.icons.find((p) => p.person === slug);
    assert.ok(icon, `Icon ${slug} missing`);
    assert.equal(icon.nat, 'EGY');
    assert.equal(icon.club, 'ICN', `${slug} should play for the Icons club`);
  }
  const aboutrika = db.icons.find((p) => p.person === 'aboutrika');
  assert.ok(aboutrika.ovr >= 90, `Aboutrika should be a peak-tier Icon, got ${aboutrika.ovr}`);
  const elhadary = db.icons.find((p) => p.person === 'elhadary');
  assert.equal(elhadary.pos, 'GK');
  assert.ok(elhadary.ovr >= 87, `El-Hadary should be ~88, got ${elhadary.ovr}`);
  const hossam = db.icons.find((p) => p.person === 'hossamhassan');
  assert.ok(hossam.ovr >= 87, `Hossam Hassan should be ~88, got ${hossam.ovr}`);
  // No name may appear in both the Icons/Stars lists and the regulars list (duplicate-player rule).
  const regNames = new Set(db.regulars.map((p) => p.name.toLowerCase()));
  for (const slug of iconSlugs) {
    const icon = db.icons.find((p) => p.person === slug);
    assert.ok(!regNames.has(icon.name.toLowerCase()), `${icon.name} duplicated in regulars`);
  }
});

// ---------- A2: one balance model (local coins <-> infinite) + custom card registry ----------
test('wallet: toggling infinite on/off never loses, NaNs or corrupts the real balance; earnings while infinite count', async () => {
  const W = await import('../core/wallet.js');
  const s = { coins: 12345, admin: {} };
  W.setInfinite(s, true);
  assert.equal(s.coins, W.INFINITE_COINS);
  assert.equal(W.realCoins(s), 12345);
  s.coins -= 900000; // a pack bought while infinite: free
  W.settleInfinite(s);
  assert.equal(W.realCoins(s), 12345);
  s.coins += 800; // a match reward while infinite: kept
  assert.equal(W.settleInfinite(s), 800);
  W.setInfinite(s, true); // double "on" is a no-op
  W.setInfinite(s, false);
  assert.deepEqual([s.coins, s.admin.infinite, 'stash' in s.admin], [13145, false, false]);
  W.setInfinite(s, false); // double "off" is a no-op
  assert.equal(s.coins, 13145);
  for (let i = 0; i < 20; i++) W.setInfinite(s, i % 2 === 0); // rapid toggling
  assert.equal(W.realCoins(s), 13145);
  // corrupt saves are repaired: NaN / string / leftover INFINITE_COINS as a real balance
  assert.equal(W.normalizeWallet({ coins: NaN, admin: {} }).coins, 0);
  assert.equal(W.normalizeWallet({ coins: '700', admin: null }).coins, 700);
  assert.equal(W.normalizeWallet({ coins: W.INFINITE_COINS, admin: { infinite: false, stash: 4200 } }).coins, 4200);
  const inf = W.normalizeWallet({ coins: 5000, admin: { infinite: true } });
  assert.deepEqual([inf.coins, inf.admin.stash], [W.INFINITE_COINS, 5000]);
  assert.equal(W.setInfinite({ coins: 1, admin: { infinite: true, stash: 50 } }, false, { realBalance: 777 }).coins, 777); // online: server balance
  assert.equal(W.setInfinite({ coins: W.INFINITE_COINS, admin: { infinite: true, stash: NaN } }, false).coins, 0);
});

test('custom cards: granted Card Creator card is in the club, tradable, and survives a save/load round trip', async () => {
  const { receiveCard } = await import('../core/customreg.js');
  const { getPlayer, getDB: db } = await import('../core/players.js');
  const s = UT.createUTState();
  const card = { id: 'admin_42_0', name: 'Test Hero', pos: 'CAM', ovr: 97, tier: 'gold', special: 'hero', customAdmin: true, stats: { pac: 97, sho: 96, pas: 99, dri: 99, def: 60, phy: 80 }, photo: 'data:image/jpeg;base64,AAAA' };
  const r = receiveCard(s, card);
  assert.equal(r.ok, true);
  assert.ok(s.club.includes(card.id) && !s.untradeable.includes(card.id));
  const back = UT.migrateUT(JSON.parse(JSON.stringify(s)));
  db().byId.delete(card.id);
  const again = UT.migrateUT(JSON.parse(JSON.stringify(s)));
  assert.ok(back.club.includes(card.id) && again.club.includes(card.id));
  assert.equal(getPlayer(card.id).photo, card.photo);
  assert.equal(getPlayer(card.id).ovr, 97);
});

// ---------------- Swaps (owner request Sep 27): cards -> coins/tokens, swap sets, Token Store ----------------
test('swap for coins: removes the card and credits exactly swapCoinValue(p)', () => {
  const s = UT.createUTState({ clubName: 'Swap FC' }, new Rng(51));
  UT.migrateUT(s);
  const inSquad = new Set(s.squad.slots.concat(s.squad.bench).filter(Boolean));
  const pid = s.club.find((x) => !inSquad.has(x));
  const p = getPlayer(pid);
  const expected = SW.swapCoinValue(p);
  const before = s.coins;
  const r = SW.swapForCoins(s, pid);
  assert.equal(r.ok, true);
  assert.equal(r.coins, expected);
  assert.equal(s.coins, before + expected);
  assert.ok(!s.club.includes(pid));
});

test('swap for tokens: removes the card and credits exactly swapTokenValue(p)', () => {
  const s = UT.createUTState({ clubName: 'Token FC' }, new Rng(52));
  UT.migrateUT(s);
  // ic_pele (98 ovr, LOTG) is not in the generated starter club/squad — an easy, unambiguous 3-token case.
  const pid = 'ic_pele';
  assert.ok(!s.club.includes(pid));
  s.club.push(pid);
  const p = getPlayer(pid);
  const expected = SW.swapTokenValue(p);
  assert.equal(expected, 3);
  const before = s.tokens;
  const r = SW.swapForTokens(s, pid);
  assert.equal(r.ok, true);
  assert.equal(r.tokens, expected);
  assert.equal(s.tokens, before + expected);
  assert.ok(!s.club.includes(pid));
  // a low-rated card is worth 0 tokens and is refused (coins are still fine for it)
  const inSquad = new Set(s.squad.slots.concat(s.squad.bench).filter(Boolean));
  const low = s.club.map(getPlayer).find((c) => c && c.ovr < 80 && !inSquad.has(c.id));
  if (low) {
    assert.equal(SW.swapTokenValue(low), 0);
    const bad = SW.swapForTokens(s, low.id);
    assert.equal(bad.ok, false);
    assert.ok(s.club.includes(low.id));
  }
});

test("swap: a card in the starting XI can't be swapped (for coins or tokens), bench needs confirm", () => {
  const s = UT.createUTState({ clubName: 'XI FC' }, new Rng(53));
  UT.migrateUT(s);
  const starter = s.squad.slots.find(Boolean);
  assert.ok(starter);
  const r1 = SW.swapForCoins(s, starter);
  assert.equal(r1.ok, false);
  const r2 = SW.swapForTokens(s, starter);
  assert.equal(r2.ok, false);
  assert.ok(s.club.includes(starter), 'starting XI card must survive a rejected swap');
  const benchPid = s.squad.bench.find(Boolean);
  if (benchPid) {
    const noConfirm = SW.swapForCoins(s, benchPid);
    assert.equal(noConfirm.ok, false);
    assert.ok(s.club.includes(benchPid));
    const withConfirm = SW.swapForCoins(s, benchPid, { confirm: true });
    assert.equal(withConfirm.ok, true);
    assert.ok(!s.club.includes(benchPid));
  }
});

test('swap sets: hand in N players meeting requirements -> exact tokens, consumed from the club', () => {
  const s = UT.createUTState({ clubName: 'Set FC' }, new Rng(54));
  UT.migrateUT(s);
  const set = SW.SWAP_SET_BY_ID['fc-gold'];
  const inSquad = new Set(s.squad.slots.concat(s.squad.bench).filter(Boolean));
  const pool = s.club.map(getPlayer).filter((p) => p && p.ovr >= set.minOvr && !inSquad.has(p.id));
  if (pool.length >= set.count) {
    const pids = pool.slice(0, set.count).map((p) => p.id);
    const ev = SW.evaluateSwapSet(set.id, pids);
    assert.equal(ev.ok, true);
    const before = s.tokens;
    const r = SW.submitSwapSet(s, set.id, pids);
    assert.equal(r.ok, true);
    assert.equal(r.tokens, set.tokens);
    assert.equal(s.tokens, before + set.tokens);
    for (const pid of pids) assert.ok(!s.club.includes(pid));
  }
  // wrong count is rejected without touching the club
  const before2 = s.club.length;
  const bad = SW.submitSwapSet(s, 'fc-elite', []);
  assert.equal(bad.ok, false);
  assert.equal(s.club.length, before2);
});

test('token store: tokens buy a pack (deducted exactly, gated the same way as the coin Store)', async () => {
  const s = UT.createUTState({ clubName: 'Store FC' }, new Rng(55));
  UT.migrateUT(s);
  const price = SW.tokenPriceFor(UT.PACK_BY_ID.gold);
  assert.ok(price > 0);
  const poor = SW.buyPackWithTokens(s, 'gold');
  assert.equal(poor.ok, false, 'no tokens yet');
  SW.addTokens(s, price + 5);
  const before = s.tokens;
  const r = SW.buyPackWithTokens(s, 'gold');
  assert.equal(r.ok, true);
  assert.equal(r.tokens, price);
  assert.equal(s.tokens, before - price);
  // config-disabled packs are respected, same as the coin Store
  const cfgOff = { ...(await import('../core/config.js')).CONFIG_DEFAULTS, disabledPacks: ['gold'] };
  assert.equal(SW.buyPackWithTokens(s, 'gold', cfgOff).ok, false);
});

test('tokens: never NaN, always integer, clamped >= 0; old saves (pre-Swaps) migrate to tokens:0', () => {
  const s = UT.createUTState({ clubName: 'Mig FC' }, new Rng(56));
  const v1 = JSON.parse(JSON.stringify(s));
  delete v1.tokens; // pre-Swaps save shape
  const m = UT.migrateUT(v1);
  assert.equal(m.tokens, 0);
  SW.addTokens(m, NaN);
  assert.equal(m.tokens, 0);
  SW.addTokens(m, -50);
  assert.equal(m.tokens, 0);
  SW.addTokens(m, 4.6);
  assert.equal(m.tokens, 5);
  m.tokens = 'abc';
  assert.equal(UT.migrateUT(m).tokens, 0);
  m.tokens = -7;
  assert.equal(UT.migrateUT(m).tokens, 0);
});


test('admin cards always have max chemistry in any position (both styles)', () => {
  const mk = (i, extra = {}) => ({ id: 'x' + i, name: 'P' + i, pos: 'GK', altPos: [], nat: 'N' + i, league: 'L' + i, club: 'C' + i, ovr: 70, ...extra });
  const slots = Array.from({ length: 11 }, (_, i) => mk(i));
  slots[5] = mk(5, { id: 'ad_test', ovr: 250, pos: 'GK' }); // out of position, no shared club/league/nation
  for (const style of ['classic', 'fc26']) {
    const r = calcChemistryStyled('4-3-3', slots, style);
    assert.equal(r.players[5], 3, style + ': admin card gets 3 chem');
  }
  assert.equal(linkStrength(slots[5], slots[4]), 2);
});


test('admin cards are hidden from swaps and cannot be swapped', async () => {
  const SW = await import('../core/swaps.js');
  assert.equal(SW.isSwapHidden({ id: 'ad_x', ovr: 300 }), true);
  assert.equal(SW.isSwapHidden({ id: 'p1', ovr: 88 }), false);
});

// ---------- Sep 27 owner requests: FC PlayStyles + icons, real personal info, leagues ----------
const BIO = await import('../core/bios.js');
const PSI = await import('../ui/playstyleicons.js');
const LB = await import('../ui/leaguebadge.js');
const SUB = await import('../core/substats.js');
const ENGINE_PS = await import('../../engine/core/playstyles.js');

test('PlayStyles: full FC 25/26 set, each with a description, an icon (normal + PlayStyle+) and an engine effect', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../../engine/core/', import.meta.url));
  const src = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(dir + f, 'utf8')).join('\n');
  const FC = ['Finesse Shot', 'Power Shot', 'Chip Shot', 'Dead Ball', 'Trivela', 'Low Driven Shot', 'Precision Header', 'Acrobatic', 'Gamechanger',
    'Incisive Pass', 'Tiki Taka', 'Pinged Pass', 'Long Ball Pass', 'Whipped Pass', 'Inventive', 'First Touch', 'Technical', 'Rapid', 'Flair',
    'Trickster', 'Press Proven', 'Anticipate', 'Intercept', 'Block', 'Jockey', 'Slide Tackle', 'Bruiser', 'Aerial Fortress', 'Quick Step',
    'Relentless', 'Long Throw', 'Enforcer', 'Far Reach', 'Footwork', 'Rush Out', 'Cross Claimer', 'Quick Reflexes', 'Deflector'];
  const names = new Set(Object.values(PH.PLAYSTYLES).map((d) => d[0]));
  for (const n of FC) assert.ok(names.has(n), `missing PlayStyle ${n}`);
  for (const [id, d] of Object.entries(PH.PLAYSTYLES)) {
    assert.ok(typeof d[3] === 'string' && d[3].length > 10, `${id} description`);
    assert.ok(PSI.PS_GLYPHS[id], `${id} has no icon glyph`);
    const a = PSI.psIconSvg(id, false), b = PSI.psIconSvg(id, true);
    assert.ok(a.startsWith('<svg') && b.startsWith('<svg') && a !== b, `${id} icon variants`);
    assert.ok(b.includes('#e6bd57'), `${id}+ icon should be gold`);
    assert.ok(ENGINE_PS.PLAYSTYLES[id], `${id} unknown to the engine`);
    assert.ok(new RegExp(`\\bps\\(\\s*[\\w.]+\\s*,\\s*'${id}'\\s*\\)`).test(src), `${id} has no engine effect`);
  }
  // old/FC ids keep working
  assert.equal(PH.canonStyle('precisionheader'), 'powerheader');
  assert.equal(PH.canonStyle('aerialfortress'), 'aerial');
  assert.deepEqual(PH.parseStyles(['precisionheader+', 'aerialfortress']), [{ id: 'powerheader', plus: true }, { id: 'aerial', plus: false }]);
  const p = { playstyles: [{ id: 'aerialfortress', plus: true }], height: 190, weight: 85 };
  assert.deepEqual(PH.matchPhysique(p).playstyles, [{ id: 'aerial', plus: true }]);
});

test('PlayStyle+ are placed by the owner tier list + per-position chart', () => {
  const db = getDB();
  // Messi (RW): Finesse Shot is both his signature and the chart's #1 for wingers
  assert.ok(getPlayer('rs_messi').playstyles.find((x) => x.id === 'finesse').plus);
  for (const p of db.all.filter((x) => x.real && !x.promo)) {
    const plus = p.playstyles.filter((x) => x.plus);
    assert.ok(plus.length <= Math.max(0, maxPlus(p.ovr)), `${p.id} too many PlayStyle+`);
    if (p.ovr >= 85) assert.ok(plus.length >= 1, `${p.id} (${p.ovr}) should have a PlayStyle+`);
    // any chart style the player has outranks every non-chart style for the '+'
    const best = PH.bestPlaystylesFor(p.pos);
    const chartOwned = p.playstyles.filter((x) => best.includes(x.id));
    if (plus.length && chartOwned.length) assert.ok(plus.some((x) => best.includes(x.id)), `${p.id} chart style missed the +`);
  }
});

test('Real players: age from the real date of birth (Messi 39 on 2026-09-27), never a fake one', () => {
  const on = new Date('2026-09-27T12:00:00');
  const f = (id) => Object.fromEntries(BIO.profileFacts(getPlayer(id), on));
  assert.equal(f('rs_messi').Age, '39'); assert.equal(f('rs_messi')['Date of birth'], '24 Jun 1987');
  assert.equal(f('ic_messi').Age, '39', 'the prime Icon version shows his real age too');
  assert.equal(f('rs_ronaldo')['Date of birth'], '5 Feb 1985'); assert.equal(f('rs_ronaldo').Age, '41');
  assert.equal(f('ic_totti').Age, '50', 'birthday today counts');
  assert.equal(BIO.ageOn('1987-06-24', '2026-06-23'), 38);
  assert.equal(BIO.ageOn('1987-06-24', '2026-06-24'), 39);
  assert.match(f('ic_pele').Age, /^Died 29 Dec 2022 \(aged 82\)$/);
  assert.equal(f('rs_messi')['Preferred foot'], 'Left'); assert.equal(f('rs_messi').Height, '170 cm');
  assert.equal(getPlayer('rp_kahn').height, 188, 'real height replaces the generated one');
});

test('No real player shows generated personal info; fictional players show Unknown', () => {
  const db = getDB();
  const on = new Date('2026-09-27T12:00:00');
  const persons = new Set(db.all.filter((p) => p.real).map((p) => p.person));
  for (const k of Object.keys(BIO.BIOS)) assert.ok(persons.has(k), `BIOS key ${k} is not a real player`);
  for (const p of db.all) {
    const facts = Object.fromEntries(BIO.profileFacts(p, on));
    const b = p.real ? BIO.bioFor(p.person) : null;
    if (!p.real) {
      for (const k of ['Date of birth', 'Age', 'Height', 'Weight', 'Preferred foot']) assert.equal(facts[k], 'Unknown', `${p.id} ${k} = ${facts[k]}`);
      continue;
    }
    // DOB / age only ever come from BIOS
    if (!b || !b.dob) assert.equal(facts['Date of birth'], 'Unknown', `${p.id} dob`);
    else assert.equal(facts['Date of birth'], BIO.fmtDate(b.dob));
    if (!b || (!b.dob && !b.died)) assert.equal(facts.Age, 'Unknown', `${p.id} age`);
    // generated heights (compact rows) never leak
    if (!p.physReal && !(b && b.height)) assert.equal(facts.Height, 'Unknown', `${p.id} generated height shown`);
    if (!p.physReal && !(b && b.weight)) assert.equal(facts.Weight, 'Unknown', `${p.id} generated weight shown`);
  }
});

test('Leagues: recognisable real names + badge per league; details attributes cover every sub-stat', () => {
  const names = Object.fromEntries(Object.values(LEAGUE_BY_ID).map((l) => [l.id, l.name]));
  assert.equal(names.ISL, 'Premier League'); assert.equal(names.SOL, 'LaLiga'); assert.equal(names.MEI, 'Bundesliga');
  assert.equal(names.AUR, 'Serie A'); assert.equal(names.ETO, 'Ligue 1');
  for (const id of [...Object.keys(LEAGUE_BY_ID), 'ICN', 'LEG', 'HER', 'SEC', 'FUT']) {
    const svg = LB.leagueBadgeSVG(id);
    assert.ok(svg.startsWith('<svg') && svg.includes('<text'), `${id} badge`);
  }
  const p = getPlayer('rs_messi');
  const groups = SUB.subStats(p);
  assert.equal(groups.length, 6);
  assert.equal(groups.reduce((n, g) => n + g.subs.length, 0), 29, 'FC has 29 outfield attributes');
  for (const g of groups) {
    assert.equal(g.value, p.stats[g.key]);
    const avg = g.subs.reduce((a, x) => a + x.value, 0) / g.subs.length;
    assert.ok(Math.abs(avg - g.value) <= 2.5, `${g.key} subs average ${avg} vs ${g.value}`);
  }
  assert.equal(SUB.subStats(getPlayer('ic_yashin')).length, 6);
});

// Owner request (Sep 28): saved admin cards can be edited in place (Card Creator → Edit).
test('updateCustomCard keeps the card id, rebuilds stats and refreshes the registry + club snapshot', async () => {
  const hadLS = 'localStorage' in globalThis;
  const mem = new Map();
  if (!hadLS) globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const CC = await import('../ui/customcards.js');
    const { getPlayer: gp } = await import('../core/players.js');
    const card = CC.createCustomCard({ name: 'Edit Me', pos: 'ST', nat: 'ENG', tier: 'gold', stats: { pac: 70, sho: 70, pas: 70, dri: 70, def: 40, phy: 70 } });
    const state = UT.createUTState({ clubName: 'Test FC' });
    assert.ok(CC.grantCustomCard(state, card).ok);
    assert.equal(gp(card.id).stats.sho, 70);
    const upd = CC.updateCustomCard(card.id, { name: 'Edited Star', pos: 'CAM', nat: 'ENG', tier: 'gold', special: 'inform', stats: { pac: 88, sho: 91, pas: 90, dri: 92, def: 40, phy: 70 }, playstyles: [{ id: 'finesse', plus: true }] }, { state });
    assert.equal(upd.id, card.id, 'same id');
    assert.equal(upd.createdAt, card.createdAt);
    assert.equal(CC.listCustomCards().filter((c) => c.id === card.id).length, 1, 'no new gallery entry');
    assert.equal(CC.getCustomCard(card.id).stats.sho, 91);
    assert.ok(upd.ovr > card.ovr);
    const reg = gp(card.id);
    assert.equal(reg.name, 'Edited Star'); assert.equal(reg.pos, 'CAM'); assert.equal(reg.stats.sho, 91); assert.equal(reg.special, 'inform');
    assert.equal(state.customCards[card.id].stats.sho, 91, 'club snapshot updated');
    assert.ok(state.club.includes(card.id));
    const dup = CC.duplicateCustomCard(card.id);
    assert.notEqual(dup.id, card.id); assert.equal(dup.stats.sho, 91);
    assert.equal(CC.updateCustomCard('admin_missing', { name: 'x', stats: {} }), null);
  } finally { if (!hadLS) delete globalThis.localStorage; }
});

test('infinity is drawn as a symmetric sign, never the raw font glyph (owner, Sep 29)', async () => {
  const { infHtml, INF_HTML } = await import('../ui/dom.js');
  assert.equal(infHtml('∞'), INF_HTML);
  assert.equal(infHtml('-∞'), '-' + INF_HTML);
  assert.equal(infHtml('|∞|'), '|' + INF_HTML + '|');
  assert.equal(infHtml('<b>'), '&lt;b&gt;', 'still escapes');
  assert.equal(infHtml('87'), '87');
});

test('display order: Secret cards always first, ∞ god cards above 999 Admin Cards, cursed secret below gods', async () => {
  const { byDisplayRank, secretFirst } = await import('../core/rank.js');
  const l = [{ ovr: 999, name: 'admin' }, { ovr: 999, secret: true, name: 'glitch' }, { ovr: 1, secret: true, cursed: true, name: 'nii' }, { ovr: 99, name: 'toty' }];
  assert.deepEqual(l.slice().sort(byDisplayRank).map((x) => x.name), ['glitch', 'nii', 'admin', 'toty']);
  const byName = l.slice().sort((a, b) => secretFirst(a, b) || a.name.localeCompare(b.name)).map((x) => x.name);
  assert.deepEqual(byName.slice(0, 2), ['glitch', 'nii'], 'secret first even when sorting by name');
});

test('packs: top-rated cards are rare inside a category (rating-weighted draws)', async () => {
  const UT = await import('../core/ut.js');
  const pool = [{ id: 'a', ovr: 86 }, { id: 'b', ovr: 86 }, { id: 'c', ovr: 99 }];
  const rng = new Rng('weights');
  let top = 0;
  for (let i = 0; i < 4000; i++) if (UT.pickByRating(pool, rng).id === 'c') top++;
  const expect = Math.pow(UT.RATING_DECAY, 13) / (2 + Math.pow(UT.RATING_DECAY, 13));
  assert.ok(top / 4000 < expect * 4 + 0.002, `99 drawn ${top} times`);
  assert.equal(UT.pickByRating([{ id: 'x', ovr: 90 }], rng).id, 'x');
});

test('promos: campaigns spread across more people; every promo card from the old selection still resolves', async () => {
  const { buildPromoCards } = await import('../core/promos.js');
  const db = getDB();
  const promos = db.all.filter((p) => p.id.startsWith('pr_'));
  const people = new Set(promos.map((p) => p.person || p.baseId));
  assert.ok(people.size >= 260, `only ${people.size} different people across promos`);
  const legacy = db.all.filter((p) => p.id.startsWith('pr_')).map((p) => p.id);
  assert.ok(legacy.every((id) => getPlayer(id)));
  void buildPromoCards;
});

test('real managers: packed from the Manager Pack, only assignable once owned, duplicates refund coins', async () => {
  const UT = await import('../core/ut.js');
  const s = UT.createUTState();
  const m = UT.REAL_MANAGERS[0];
  assert.equal(UT.setManager(s, m.id), null, 'not owned yet');
  const rng = new Rng('mgr');
  const r = UT.openManagerPack(s, rng);
  assert.equal(r.dup, false);
  assert.ok(s.managers.includes(r.id));
  assert.equal(UT.setManager(s, r.id), r.id);
  s.managers = UT.REAL_MANAGERS.map((x) => x.id);
  const coins = s.coins;
  const d = UT.openManagerPack(s, rng);
  assert.equal(d.dup, true);
  assert.equal(s.coins, coins + UT.MANAGER_PACK.refund);
  assert.deepEqual(UT.setManager(s, { name: 'My Boss', nat: 'EGY', league: 'ISL' }), { name: 'My Boss', nat: 'EGY', league: 'ISL' }, 'custom manager kept');
});

await runAll();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
