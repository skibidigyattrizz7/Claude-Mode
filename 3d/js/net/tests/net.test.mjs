// Pure-logic tests for the online layer. Run: node 3d/js/net/tests/net.test.mjs
import assert from 'node:assert/strict';
import {
  sanitizeCard, cleanJson, validateListingInput, normalizeSearch, parseMmResponse, sanitizeReport, normalizeReport,
  sanitizeListingItem, sanitizeMyListing, sanitizeProfile, MARKET,
} from '../validate.js';
import { decode, sanitizeTeam } from '../protocol.js';
import { sanitizeGameplay, gameplayGroups, GAMEPLAY_FIELDS, gameplayField } from '../gameplaymeta.js';
import { GAMEPLAY_DEFAULTS } from '../../shared/gameplay.js';
import { createMockBackend, memoryStore } from '../mockbackend.js';
import { createMatchmaker, randomPeerId } from '../matchmaker.js';
import { createOnline, online as defaultOnline } from '../services.js';
import { LoopbackTransport } from '../transport.js';
import { NetSession } from '../session.js';

let passed = 0, failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID = '0b8f6a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const card = (o = {}) => ({ id: 'p6', name: 'T. Morby', pos: 'CB', ovr: 80, stats: { pac: 78, sho: 39 }, tier: 'gold', rare: false, ...o });
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// ------------------------------------------------------------------ validation
test('sanitizeCard accepts a real card and clamps stats', () => {
  const c = sanitizeCard(card({ stats: { pac: 400, sho: -3 } }));
  assert.equal(c.id, 'p6');
  assert.equal(c.stats.pac, 99);
  assert.equal(c.stats.sho, 1);
});
test('sanitizeCard rejects missing/invalid required fields', () => {
  assert.equal(sanitizeCard(null), null);
  assert.equal(sanitizeCard([]), null);
  assert.equal(sanitizeCard(card({ id: 'a b' })), null);
  assert.equal(sanitizeCard(card({ pos: 'XX' })), null);
  assert.equal(sanitizeCard(card({ ovr: 80.5 })), null);
  assert.equal(sanitizeCard(card({ ovr: 100 })), null);
  assert.equal(sanitizeCard(card({ name: '' })), null);
});
test('cleanJson drops prototype keys, caps depth/length, strips control chars', () => {
  const evil = JSON.parse('{"__proto__": {"polluted": 1}, "a": {"b": {"c": {"d": {"e": 1}}}}, "s": "x\\u0000y", "n": 1e999}');
  const out = cleanJson(evil);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(out, '__proto__'), false);
  assert.equal(out.a.b.c.d, null);
  assert.equal(out.s, 'xy');
  assert.equal(cleanJson(Array.from({ length: 40 }, (_, i) => i)).length, 16);
});
test('validateListingInput: price bounds, integer only, size cap', () => {
  assert.equal(validateListingInput(card(), 149).error, 'bad_price');
  assert.equal(validateListingInput(card(), 15000001).error, 'bad_price');
  assert.equal(validateListingInput(card(), 1000.5).error, 'bad_price');
  assert.equal(validateListingInput(card(), NaN).error, 'bad_price');
  assert.equal(validateListingInput(card(), '2000').price, 2000);
  assert.equal(validateListingInput({ id: 'x' }, 2000).error, 'bad_card');
  const big = card();
  for (let i = 0; i < 48; i++) big[`k${i}`] = 'z'.repeat(64);
  assert.equal(validateListingInput(big, 2000).error, 'card_too_large');
  assert.equal(validateListingInput(card(), MARKET.minPrice).ok, true);
});
test('normalizeSearch whitelists filters', () => {
  const a = normalizeSearch({ q: "  Mor%by'; drop table x  ", pos: 'ZZ', minOvr: 300, maxPrice: -5, rarity: 'x', sort: 'evil', page: 999 });
  assert.equal(a.p_q.length <= 24, true);
  assert.equal(a.p_pos, null);
  assert.equal(a.p_min_ovr, 99);
  assert.equal(a.p_max_price, null);
  assert.equal(a.p_rarity, null);
  assert.equal(a.p_sort, 'newest');
  assert.equal(a.p_page, 49);
  assert.deepEqual(normalizeSearch({ pos: 'ST', sort: 'price_asc' }).p_pos, 'ST');
});
test('parseMmResponse validates matched responses strictly', () => {
  const ok = { ok: true, matched: true, queueId: UUID, role: 'guest', opponentPeerId: 'psq-abcdefgh12', token: 'ab'.repeat(16), opponent: { name: 'Bob<script>', rating: 1e9 } };
  const m = parseMmResponse(ok);
  assert.equal(m.ok, true);
  assert.equal(m.opponent.rating, 5000);
  assert.equal(parseMmResponse({ ...ok, role: 'admin' }).ok, false);
  assert.equal(parseMmResponse({ ...ok, opponentPeerId: '../../x' }).ok, false);
  assert.equal(parseMmResponse({ ...ok, token: 'zz' }).ok, false);
  assert.equal(parseMmResponse({ ...ok, queueId: 'nope' }).ok, false);
  assert.equal(parseMmResponse('garbage').ok, false);
  assert.deepEqual(parseMmResponse({ ok: false, error: 'auth' }), { ok: false, error: 'auth' });
  assert.equal(parseMmResponse({ ok: true, matched: false, queueId: UUID }).matched, false);
});
test('result / profile / listing sanitisers clamp server data', () => {
  assert.equal(sanitizeReport({ ok: true, coinsAwarded: 1e12, rating: -4 }).coinsAwarded, 100000);
  assert.equal(sanitizeReport({ ok: false, error: 'auth' }).ok, false);
  assert.equal(normalizeReport({ mode: 'hack' }).ok, false);
  assert.deepEqual(normalizeReport({ mode: 'ut', won: true, drawn: true, goalsFor: 99, goalsAgainst: -1 }).args, { p_mode: 'ut', p_won: true, p_drawn: false, p_gf: 50, p_ga: 0 });
  assert.equal(sanitizeProfile({ ok: true, id: 'x' }), null);
  assert.equal(sanitizeProfile({ ok: true, id: UUID, coins: -5 }).coins, 0);
  assert.equal(sanitizeListingItem({ listingId: UUID, card: card(), price: 10 }), null);
  assert.equal(sanitizeListingItem({ listingId: UUID, card: card(), price: 500 }).price, 500);
  assert.equal(sanitizeMyListing({ listingId: UUID, card: card(), price: 500, status: 'hacked' }), null);
});
test('peer messages: decode caps and gameplay sanitising', () => {
  assert.equal(decode('x'.repeat(300000)), null);
  assert.equal(decode('[1]'), null);
  assert.equal(decode('{"t":"gp"}').t, 'gp');
  const g = sanitizeGameplay({ passAssist: 'manual', shotAssist: 'aimbot', autoTackle: 'yes', extra: 1, __proto__: { x: 1 } });
  assert.equal(g.passAssist, 'manual');
  assert.equal(g.shotAssist, GAMEPLAY_DEFAULTS.shotAssist);
  assert.equal(g.autoTackle, GAMEPLAY_DEFAULTS.autoTackle);
  assert.equal('extra' in g, false);
  assert.deepEqual(Object.keys(g).sort(), Object.keys(GAMEPLAY_DEFAULTS).sort());
  assert.throws(() => sanitizeTeam({ players: [] }));
});
test('gameplay settings: every field is labelled and grouped; unknown keys still render', () => {
  const groups = gameplayGroups();
  const keys = groups.flatMap((gr) => gr.fields.map((f) => f.key));
  assert.deepEqual(keys.sort(), Object.keys(GAMEPLAY_DEFAULTS).sort());
  for (const k of Object.keys(GAMEPLAY_DEFAULTS)) assert.ok(GAMEPLAY_FIELDS[k], `no label for ${k}`);
  for (const [k, f] of Object.entries(GAMEPLAY_FIELDS)) {
    if (k in GAMEPLAY_DEFAULTS) assert.ok(f.options.some(([v]) => v === GAMEPLAY_DEFAULTS[k]), `default of ${k} not an option`);
  }
  const f = gameplayField('brandNewToggle', { brandNewToggle: true });
  assert.equal(f.label, 'Brand New Toggle');
  assert.equal(f.group, 'other');
  assert.equal(f.options.length, 2);
  assert.equal(sanitizeGameplay({ newMode: 'fancy' }, { newMode: 'plain' }).newMode, 'fancy');
  assert.equal(sanitizeGameplay({ newMode: '<b>' }, { newMode: 'plain' }).newMode, 'plain');
});

// ------------------------------------------------------------------ mock backend mirrors the SQL rules
test('mock backend: market rules (self-buy, double-buy, claim once, 5% tax)', async () => {
  const be = createMockBackend(memoryStore());
  const s = (c) => c.repeat(64);
  const a = (await be.call('register', { p_secret: s('a'), p_name: 'A' })).data;
  const b = (await be.call('register', { p_secret: s('b'), p_name: 'B' })).data;
  const c = (await be.call('register', { p_secret: s('c'), p_name: 'C' })).data;
  const l = (await be.call('list_card', { p_id: a, p_secret: s('a'), p_card: card(), p_price: 1000 })).data;
  assert.equal(l.ok, true);
  assert.equal((await be.call('list_card', { p_id: a, p_secret: s('a'), p_card: card(), p_price: 1000 })).data.error, 'already_listed');
  assert.equal((await be.call('buy', { p_id: a, p_secret: s('a'), p_listing: l.listingId })).data.error, 'own_listing');
  assert.equal((await be.call('buy', { p_id: b, p_secret: s('a'), p_listing: l.listingId })).data.error, 'auth');
  assert.equal((await be.call('buy', { p_id: b, p_secret: s('b'), p_listing: l.listingId })).data.ok, true);
  assert.equal((await be.call('buy', { p_id: c, p_secret: s('c'), p_listing: l.listingId })).data.error, 'unavailable');
  assert.equal((await be.call('claim_sales', { p_id: a, p_secret: s('a') })).data.coins, 950);
  assert.equal((await be.call('claim_sales', { p_id: a, p_secret: s('a') })).data.coins, 0);
  assert.equal((await be.call('get_profile', { p_id: b, p_secret: s('b') })).data.coins, 4000);
});

// ------------------------------------------------------------------ matchmaker state machine (fake RPC)
function fakeTransport(log) {
  return {
    listen: async (id) => { log.push(['listen', id]); },
    connectTo: async (id) => { log.push(['connectTo', id]); if (id === 'psq-unreachable1') throw new Error('nope'); },
    close: () => log.push(['close']),
  };
}
function scriptedRpc(script, log) {
  return async (fn, args) => {
    log.push([fn, args]);
    const next = script[fn] && script[fn].shift();
    if (typeof next === 'function') return next(args);
    return next || { ok: false, error: 'offline' };
  };
}
const matched = (role, peer = 'psq-host0000001') => ({ ok: true, data: { ok: true, matched: true, queueId: UUID, role, opponentPeerId: peer, token: 'cd'.repeat(16), opponent: { name: 'Opp', rating: 1100 } } });
const waiting = { ok: true, data: { ok: true, matched: false, queueId: UUID, waitedMs: 10 } };
const ident = async () => ({ id: UUID, secret: 'a'.repeat(64) });

test('matchmaker: queued -> polled -> matched as guest connects to host peer id', async () => {
  const log = [], tlog = [], states = [];
  const mm = createMatchmaker({
    rpc: scriptedRpc({ mm_enqueue: [waiting], mm_poll: [waiting, matched('guest')] }, log),
    identity: ident, createTransport: () => fakeTransport(tlog), config: { pollMs: 5 },
  });
  const r = await mm.search({ mode: 'ut', onProgress: (p) => states.push(p.state) });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'guest');
  assert.deepEqual(tlog.map((x) => x[0]), ['listen', 'connectTo']);
  assert.equal(tlog[1][1], 'psq-host0000001');
  assert.match(tlog[0][1], /^psq-[a-z0-9]{20}$/);
  assert.equal(log.filter((x) => x[0] === 'mm_poll').length, 2);
  assert.deepEqual([...new Set(states)], ['opening', 'queued', 'matched', 'linking', 'done']);
  assert.equal(log[0][1].p_mode, 'ut');
});
test('matchmaker: host role resolves without connecting', async () => {
  const tlog = [];
  const mm = createMatchmaker({ rpc: scriptedRpc({ mm_enqueue: [matched('host')] }, []), identity: ident, createTransport: () => fakeTransport(tlog) });
  const r = await mm.search({ mode: 'friendly' });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'host');
  assert.deepEqual(tlog.map((x) => x[0]), ['listen']);
});
test('matchmaker: cancel during queue leaves the queue and closes the peer', async () => {
  const log = [], tlog = [];
  const mm = createMatchmaker({
    rpc: scriptedRpc({ mm_enqueue: [waiting], mm_poll: Array(50).fill(waiting), mm_cancel: [{ ok: true, data: { ok: true, matched: false } }] }, log),
    identity: ident, createTransport: () => fakeTransport(tlog), config: { pollMs: 20 },
  });
  const p = mm.search({ mode: 'ut' });
  await sleep(50);
  mm.cancel();
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true);
  assert.ok(log.some((x) => x[0] === 'mm_cancel' && x[1].p_queue_id === UUID));
  assert.ok(tlog.some((x) => x[0] === 'close'));
  assert.equal(mm.state, 'idle');
});
test('matchmaker: times out, re-enqueues after purge, fails after repeated errors, rejects bad data', async () => {
  let t = 0;
  const mmT = createMatchmaker({
    rpc: scriptedRpc({ mm_enqueue: [waiting], mm_poll: Array(50).fill(waiting), mm_cancel: [{ ok: true, data: { ok: true, matched: false } }] }, []),
    identity: ident, createTransport: () => fakeTransport([]), config: { pollMs: 1, timeoutMs: 30 }, now: () => (t += 5),
  });
  assert.equal((await mmT.search({ mode: 'ut' })).error, 'timeout');

  const log = [];
  const mmP = createMatchmaker({
    rpc: scriptedRpc({ mm_enqueue: [waiting, waiting], mm_poll: [{ ok: true, data: { ok: false, error: 'not_queued' } }, matched('host')] }, log),
    identity: ident, createTransport: () => fakeTransport([]), config: { pollMs: 1 },
  });
  assert.equal((await mmP.search({ mode: 'ut' })).ok, true);
  assert.equal(log.filter((x) => x[0] === 'mm_enqueue').length, 2);

  const mmE = createMatchmaker({
    rpc: scriptedRpc({ mm_enqueue: [waiting], mm_poll: [] }, []),
    identity: ident, createTransport: () => fakeTransport([]), config: { pollMs: 1, maxErrors: 3 },
  });
  assert.equal((await mmE.search({ mode: 'ut' })).error, 'offline');

  const bad = { ok: true, data: { ...matched('guest').data, opponentPeerId: 'bad id!' } };
  const mmB = createMatchmaker({ rpc: scriptedRpc({ mm_enqueue: [bad] }, []), identity: ident, createTransport: () => fakeTransport([]) });
  assert.equal((await mmB.search({ mode: 'ut' })).error, 'bad_response');

  const mmC = createMatchmaker({ rpc: scriptedRpc({ mm_enqueue: [matched('guest', 'psq-unreachable1')] }, []), identity: ident, createTransport: () => fakeTransport([]) });
  assert.equal((await mmC.search({ mode: 'ut' })).error, 'connect_failed');
  assert.equal((await mmC.search({ mode: 'nope' })).error, 'bad_mode');
  const mmO = createMatchmaker({ rpc: scriptedRpc({}, []), identity: async () => null, createTransport: () => fakeTransport([]) });
  assert.equal((await mmO.search({ mode: 'ut' })).error, 'offline');
});
test('randomPeerId is PeerJS-safe and matches the server regex', () => {
  for (let i = 0; i < 50; i++) assert.match(randomPeerId(), /^[A-Za-z0-9][A-Za-z0-9_-]{6,62}[A-Za-z0-9]$/);
});

// ------------------------------------------------------------------ services end-to-end on the mock + loopback
test('services: two players quick-search, pair, link with the match token; intruder rejected', async () => {
  const be = createMockBackend(memoryStore());
  const mk = (name) => createOnline({ rpc: (f, a) => be.call(f, a), storage: memStorage(), transportKind: 'loopback', getName: () => name, matchmakerConfig: { pollMs: 10 } });
  const A = mk('Alice'), B = mk('Bob');
  assert.equal(await A.available(), true);
  const pa = A.matchmaking.quickSearch({ mode: 'ut' });
  await sleep(30);
  const rb = await B.matchmaking.quickSearch({ mode: 'ut' });
  const ra = await pa;
  assert.equal(ra.ok && rb.ok, true);
  assert.equal(ra.role, 'host');
  assert.equal(rb.role, 'guest');
  assert.equal(rb.opponent.name, 'Alice');
  assert.equal(ra.token, rb.token);
  // an intruder with the wrong token is refused, the real guest links
  const host = new NetSession(ra.transport, { name: 'Alice', matchToken: ra.token });
  const hostLinked = host.attach('host', 3000);
  const intruderT = new LoopbackTransport();
  await intruderT.connectTo(ra.transport.code);
  const intruder = new NetSession(intruderT, { name: 'Eve', matchToken: 'ee'.repeat(16) });
  await assert.rejects(intruder.attach('guest', 1500), /reserved/);
  intruder.close();
  const guest = new NetSession(rb.transport, { name: 'Bob', matchToken: rb.token });
  // re-link the real guest's transport (the intruder stole the loopback slot)
  rb.transport.reconnect();
  await guest.attach('guest', 3000);
  await hostLinked;
  assert.equal(host.peerName, 'Bob');
  const got = new Promise((res) => host.on('msg', (m) => { if (m.t === 'gp') res(m); }));
  guest.send('gp', { g: { passAssist: 'manual' } });
  assert.equal(sanitizeGameplay((await got).g).passAssist, 'manual');
  // result reward goes through and is rate-limited
  const rep = await A.reportResult({ mode: 'ut', won: true, drawn: false, goalsFor: 2, goalsAgainst: 1 });
  assert.equal(rep.ok, true);
  assert.equal(rep.coinsAwarded, 800);
  assert.equal(rep.ratingDelta > 0, true);
  assert.equal((await A.reportResult({ mode: 'ut', won: true, goalsFor: 2, goalsAgainst: 1 })).capped, true);
  host.close(); guest.close();
});
test('services: market round trip + coins.add rules + admin verify keeps code in memory only', async () => {
  const be = createMockBackend(memoryStore());
  const storA = memStorage();
  const mk = (storage) => createOnline({ rpc: (f, a) => be.call(f, a), storage, transportKind: 'loopback' });
  const A = mk(storA), B = mk(memStorage());
  const l = await A.market.list(card(), 2000);
  assert.equal(l.ok, true);
  assert.equal((await A.market.list(card(), 20)).error, 'bad_price');
  const s = await B.market.search({ q: 'morby', sort: 'price_asc' });
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].seller, 'Player');
  assert.equal((await A.market.buy(l.listingId)).error, 'own_listing');
  const bought = await B.market.buy(l.listingId);
  assert.equal(bought.card.id, 'p6');
  assert.equal((await A.market.claimSales()).coins, 1900);
  assert.equal((await A.coins.get()).coins, 6900);
  assert.equal((await A.coins.add(500)).error, 'not_allowed');
  assert.equal((await A.coins.add(-400, 'pack')).coins, 6500);
  assert.equal((await A.coins.add(-1e7)).error, 'insufficient_coins');
  be.setAdminCode('test-only-code');
  assert.equal(await A.admin.verify('wrong'), false);
  assert.equal(await A.admin.verify('test-only-code'), true);
  assert.equal((await A.coins.add(1000)).coins, 7500);
  assert.equal([...JSON.stringify(Object.fromEntries([['k', storA.getItem('pitchside.online.identity')]]))].join('').includes('test-only-code'), false);
});
test('services never throw when offline / unconfigured', async () => {
  const off = createOnline({ rpc: async () => ({ ok: false, error: 'offline' }), storage: memStorage(), transportKind: 'loopback' });
  const boom = createOnline({ rpc: async () => { throw new Error('boom'); }, storage: memStorage(), transportKind: 'loopback' });
  for (const o of [off, boom, defaultOnline]) {
    assert.equal(await o.available(), false);
    for (const r of [await o.profile(), await o.market.search({}), await o.market.buy(UUID), await o.market.list(card(), 500),
      await o.market.mine(), await o.market.cancel(UUID), await o.market.claimSales(), await o.coins.get(), await o.coins.add(-5),
      await o.reportResult({ mode: 'ut', won: true }), await o.matchmaking.quickSearch({ mode: 'ut' }), await o.setName('x')]) {
      assert.equal(r.ok, false);
    }
    assert.equal(await o.admin.verify('x'), false);
  }
});

// ------------------------------------------------------------------ run
for (const [name, fn] of queue) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e && e.stack || String(e)).split('\n').slice(0, 4).join('\n       ')}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
