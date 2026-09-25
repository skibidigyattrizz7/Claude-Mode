// Pure-logic tests for the meta layer. Run: node 3d/js/meta/tests/meta.test.mjs
import assert from 'node:assert/strict';
import { getDB, _resetDB, computeOvr, tierOf } from '../core/players.js';
import { Rng } from '../core/rng.js';
import { calcChemistry, linkStrength, teamRating } from '../core/chemistry.js';
import { FORMATIONS, FORMATION_NAMES } from '../core/formations.js';
import { validateTeam, bestLineup, buildTeam, gkKitFor } from '../core/teams.js';
import { simulateMatch } from '../core/sim.js';
import * as UT from '../core/ut.js';
import * as C from '../core/career.js';
import { getNationalTeams, getSavedUltimateTeam, mountMeta } from '../index.js';
import { POSITIONS, NATIONS } from '../core/data.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
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
    for (const k of ['id', 'name', 'age', 'nat', 'club', 'pos', 'alt', 'ovr', 'pot', 'wf', 'sm', 'foot', 'wr', 'height', 'value', 'wage', 'tier']) assert.ok(p[k] !== undefined, `${p.id} missing ${k}`);
    assert.ok(POSITIONS.includes(p.pos));
    assert.ok(p.wf >= 1 && p.wf <= 5 && p.sm >= 1 && p.sm <= 5);
    assert.ok(p.pot >= p.ovr);
    assert.equal(p.ovr, computeOvr(p.pos, p), `ovr mismatch ${p.id}`);
    if (!p.special) assert.equal(p.tier, tierOf(p.ovr));
  }
  for (const sp of ['legend', 'hero', 'inform']) assert.ok(db.specials.some((p) => p.special === sp), `no ${sp}`);
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
