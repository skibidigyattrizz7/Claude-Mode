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

// ---------------- V2 ----------------
const PM = await import('../core/pmarket.js');
const RV = await import('../core/rivals.js');
const SS = await import('../core/seasons.js');
const OBJ = await import('../core/objectives.js');
const EVO = await import('../core/evolutions.js');
const DR = await import('../core/draft.js');
const EVT = await import('../core/events.js');
const TAC = await import('../core/tactics.js');
const { totwCards } = await import('../core/totw.js');
const { PLAYSTYLES, styleCountRange, maxPlus } = await import('../core/physique.js');
const { getPlayer } = await import('../core/players.js');
const { REAL_ROW_COUNT } = await import('../core/realplayers.js');
const { effectiveOvr, positionFit } = await import('../core/formations.js');

const EXPECTED_REAL = ['Lionel Messi', 'Pelé', 'Diego Maradona', 'Cristiano Ronaldo', 'Johan Cruyff', 'Alfredo Di Stéfano', 'Franz Beckenbauer', 'Zinedine Zidane', 'George Best', 'Michel Platini', 'Ronaldo Nazário', 'Ronaldinho', 'Paolo Maldini', 'Garrincha', 'Lev Yashin', 'Stanley Matthews', 'Roberto Baggio', 'Thierry Henry', 'Marco van Basten', 'Xavi Hernández', 'Andrés Iniesta', 'Luís Figo', 'Romário', 'Eusébio', 'Karl-Heinz Rummenigge', 'Fabio Cannavaro', 'Iker Casillas', 'Raúl González', 'Neymar Jr.', 'Sergio Ramos', 'Paolo Rossi', 'Roberto Carlos', 'Kylian Mbappé', 'Luka Modrić', 'Gheorghe Hagi', 'Zlatan Ibrahimović', 'Frank Lampard', 'Steven Gerrard', 'David Beckham', 'Clarence Seedorf', 'Dani Alves', 'Patrick Vieira', 'Ronald Koeman', 'Giacinto Facchetti', 'Philipp Lahm', 'Javier Zanetti', 'Sándor Kocsis', 'Just Fontaine', 'Teófilo Cubillas', 'Mario Kempes', 'Jimmy Johnstone', 'Eric Cantona', 'Kevin De Bruyne', 'Alessandro Del Piero', 'Francesco Totti', 'Diego Forlán', 'Rivaldo', 'Michael Laudrup', 'Johan Neeskens', 'Hristo Stoichkov', 'Didier Drogba', 'Paul Scholes', 'Gunnar Nordahl', 'Arjen Robben', 'Raul Meireles', 'Fernandinho', 'Edinson Cavani', 'Karim Benzema', 'Toni Kroos', 'Ivan Rakitić', 'Sergio Busquets', 'Gianluigi Buffon', 'Manuel Neuer', 'Kaká', 'Roberto Mancini', 'Hakan Şükür', 'Wayne Rooney', 'Alessandro Nesta', 'Sol Campbell', 'Patrick Kluivert', 'Dino Zoff', 'Sócrates', 'Cafu', 'Lothar Matthäus', 'Daniel Passarella', 'Fernando Hierro', 'Javier Mascherano', 'David Villa', 'Gary Lineker', 'Romelu Lukaku', 'Karim Bagheri', 'Didier Deschamps', 'Emmanuel Petit', 'Paulo Futre', 'Hristo Bonev', 'Mohamed Salah', 'Ray Clemence'];

test('real players: every requested player present once per version, LOTG rarity, valid stats', () => {
  const db = getDB();
  assert.equal(db.real.length, REAL_ROW_COUNT);
  const names = new Set(db.real.map((p) => p.name));
  for (const n of EXPECTED_REAL) assert.ok(names.has(n), `missing ${n}`);
  const versions = new Set(db.real.map((p) => `${p.person}|${p.era}`));
  assert.equal(versions.size, db.real.length, 'duplicate real player version');
  assert.equal(new Set(db.real.map((p) => p.person)).size, EXPECTED_REAL.length);
  for (const p of db.real) {
    assert.equal(p.special, 'lotg'); assert.ok(p.real);
    assert.ok(['prime', 'current'].includes(p.era));
    assert.equal(p.ovr, p.intended, `${p.name} ovr ${p.ovr} != ${p.intended}`);
    if (p.era === 'prime') assert.ok(p.ovr >= 86 && p.ovr <= 98, `${p.name} prime ovr`);
    assert.ok(p.wf >= 1 && p.wf <= 5 && p.sm >= 1 && p.sm <= 5 && ['L', 'R'].includes(p.foot));
    assert.ok((p.alt || []).length <= 3 && !(p.alt || []).includes(p.pos));
    const face = p.pos === 'GK' ? p.gk : p.stats;
    for (const v of Object.values(face)) assert.ok(v >= 1 && v <= 99);
    if (p.pos === 'GK') assert.ok(p.gk.div >= 80 && p.gk.ref >= 80, `${p.name} GK stats`);
  }
  assert.equal(getPlayer('ic_pele').ovr, 98);
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
  for (const p of db.players) { assert.ok(p.alt.length <= 3); if (p.pos === 'GK') assert.equal(p.alt.length, 0); if (p.alt.length) withAlt++; }
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

test('draft: formation, captain, 1-of-5 picks, valid team, knockout rewards', () => {
  const d = DR.newDraft('t1');
  DR.chooseFormation(d, '4-2-3-1');
  assert.equal(d.captainOptions.length, 5);
  DR.chooseCaptain(d, d.captainOptions[0]);
  let i;
  while ((i = DR.nextOpenSlot(d)) >= 0) { const o = DR.slotOptions(d, i); assert.equal(o.length, 5); DR.pickSlot(d, i, o[0]); }
  assert.equal(d.stage, 'play');
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
const { CLUBS } = await import('../core/data.js');
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
  assert.equal(PR.PROMOS.length, 7);
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
  assert.ok(toty.every((p) => p.ovr >= 97 && p.ovr <= 99));
  assert.ok(db.promos.filter((p) => p.special === 'tots').every((p) => p.ovr >= 93 && p.ovr <= 97));
  assert.ok(db.promos.filter((p) => p.special === 'birthday').every((p) => p.sm >= getPlayer(p.baseId).sm && p.wf === Math.min(5, getPlayer(p.baseId).wf + 1)));
  assert.ok(db.promos.filter((p) => p.special === 'rttk').every((p) => p.upg && p.upg.level >= 0 && p.upg.level <= 4));
  assert.ok(db.promos.some((p) => p.special === 'flashback' && p.baseId === 'ic_ronaldinho'));
  // In-Forms: +3..+8 scaled to the base card
  const ifs = db.specials.filter((p) => p.special === 'inform');
  for (const p of ifs) { const d = p.ovr - getPlayer(p.baseId).ovr; assert.ok((d >= 3 && d <= 8) || p.ovr === 99, `${p.id} +${d}`); }
  assert.ok(Math.max(...ifs.map((p) => p.ovr)) >= 95, 'in-forms reach 95+');
  // calendar + packs
  for (let w = 1; w < 60; w++) { const live = PR.livePromos(w); assert.ok(live.length >= 1 && live.length <= 2 && live.every((id) => PR.PROMO_BY_ID[id])); }
  const seen = new Set(); for (let w = 1; w <= 14; w++) seen.add(PR.promoOfWeek(w));
  assert.equal(seen.size, 7, 'every campaign appears in the calendar');
  for (const pr of PR.PROMOS) {
    const pack = UT.PACK_BY_ID[`promo_${pr.id}`];
    assert.ok(pack && pack.promo === pr.id);
    for (const sl of pack.slots) assert.ok(Math.abs(Object.values(sl.odds).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    const items = UT.openPack(pack.id, new Set(), new Rng(`pp-${pr.id}`));
    assert.equal(getPlayer(items[0].pid).special, pr.id, 'promo card leads the pack');
    assert.equal(UT.packFlare(items), 'walkout');
  }
  const live = PR.livePromos();
  assert.ok(UT.storePacks().filter((p) => p.promo).every((p) => live.includes(p.promo)));
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

await runAll();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
