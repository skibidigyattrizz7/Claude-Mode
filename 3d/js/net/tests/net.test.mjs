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
import { usernameError, passwordError, nameNorm, isReservedName, usernameKey, parseBan, banActive, banText, BLOCKED_WORDS } from '../accountcore.js';
import { readFileSync } from 'node:fs';

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
  for (let i = 0; i < 70; i++) big[`k${i}`] = 'z'.repeat(64);
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
  // new shared fields still render with a generic label; flag them so a proper label gets added
  for (const k of Object.keys(GAMEPLAY_DEFAULTS)) if (!GAMEPLAY_FIELDS[k]) console.log(`  warn: gameplay field "${k}" has no label in net/gameplaymeta.js`);
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
test('mock backend: market rules (self-buy, double-buy, instant seller credit, 5% tax)', async () => {
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
  assert.equal((await be.call('get_profile', { p_id: a, p_secret: s('a') })).data.coins, 5950); // credited inside buy
  assert.equal((await be.call('claim_sales', { p_id: a, p_secret: s('a') })).data.coins, 0);
  assert.equal((await be.call('my_listings', { p_id: a, p_secret: s('a') })).data.items.length, 0); // sold listings disappear
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
  assert.equal((await A.market.claimSales()).coins, 0);
  assert.equal((await A.coins.get()).coins, 6900); // seller paid instantly (2000 - 5 %)
  assert.equal((await A.coins.add(500)).coins, 7400); // earn (capped server-side)
  assert.equal((await A.coins.add(-900, 'pack')).coins, 6500);
  assert.equal((await A.coins.add(-1e7)).error, 'insufficient_coins');
  be.setAdminCode('test-only-code');
  assert.equal(await A.admin.verify('wrong'), false);
  assert.equal(await A.admin.verify('test-only-code'), true);
  assert.equal((await A.admin.addCoins(1000)).coins, 7500);
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
    for (const r of [await o.rivals.status(), await o.rivals.claimWeekly(), await o.friends.list(), await o.friends.add('ABCDEFGH'),
      await o.friends.pollInvites(), await o.friends.challenge(UUID, 'ut'), await o.friends.acceptInvite(UUID), await o.friends.block(UUID)]) {
      assert.equal(r.ok, false);
    }
  }
});

// ------------------------------------------------------------------ friends + invites + rivals
test('friends: code add -> accept -> challenge -> accept invite -> token link; block hides', async () => {
  const be = createMockBackend(memoryStore());
  const mk = (name) => createOnline({ rpc: (f, a) => be.call(f, a), storage: memStorage(), transportKind: 'loopback', getName: () => name, invitePollMs: 10 });
  const A = mk('Ann'), B = mk('Ben'), C = mk('Cy');
  const pa = await A.profile(), pb = await B.profile();
  await C.profile();
  assert.match(pb.friendCode, /^[A-Z2-9]{8}$/);
  assert.equal(A.hasIdentity(), true);
  assert.equal((await A.friends.add('bad')).error, 'bad_code');
  assert.equal((await A.friends.add(pa.friendCode)).error, 'self');
  assert.equal((await A.friends.add(pb.friendCode.toLowerCase())).status, 'outgoing');
  assert.equal((await A.friends.add(pb.friendCode)).error, 'already_requested');
  let lb = await B.friends.list();
  assert.equal(lb.items[0].status, 'incoming');
  assert.equal(lb.items[0].rating, null);
  assert.equal((await A.friends.challenge(pb.id, 'ut')).error, 'not_friends');
  assert.equal((await B.friends.accept(pa.id)).ok, true);
  lb = await B.friends.list();
  assert.equal(lb.items[0].status, 'friend');
  assert.equal(lb.items[0].online, false); // A has not sent a heartbeat yet
  assert.equal((await A.friends.heartbeat()).ok, true);
  assert.equal((await B.friends.list()).items[0].online, true);
  // challenge: A invites, B polls, accepts, both linked with the invite token
  const chal = A.friends.challenge(pb.id, 'ut');
  let inc = null;
  for (let i = 0; i < 50 && !inc; i++) { await sleep(10); const p = await B.friends.pollInvites(); inc = p.ok && p.incoming[0]; }
  assert.ok(inc, 'invite arrived');
  assert.equal(inc.mode, 'ut');
  assert.equal(inc.from.name, 'Ann');
  assert.equal('peerId' in inc, false); // peer id only revealed on accept
  assert.equal((await C.friends.acceptInvite(inc.inviteId)).ok, false);
  const acc = await B.friends.acceptInvite(inc.inviteId);
  assert.equal(acc.ok, true);
  const host = await chal;
  assert.equal(host.ok, true);
  assert.equal(host.role, 'host');
  assert.equal(host.token, acc.token);
  const hs = new NetSession(host.transport, { name: 'Ann', matchToken: host.token });
  const hl = hs.attach('host', 3000);
  const gs = new NetSession(acc.transport, { name: 'Ben', matchToken: acc.token });
  await gs.attach('guest', 3000);
  await hl;
  assert.equal(hs.peerName, 'Ben');
  hs.close(); gs.close();
  // decline path + cancel path
  const chal2 = A.friends.challenge(pb.id, 'friendly');
  let inc2 = null;
  for (let i = 0; i < 50 && !inc2; i++) { await sleep(10); const p = await B.friends.pollInvites(); inc2 = p.ok && p.incoming[0]; }
  assert.equal((await B.friends.declineInvite(inc2.inviteId)).ok, true);
  assert.equal((await chal2).error, 'declined');
  const chal3 = A.friends.challenge(pb.id, 'friendly');
  await sleep(30);
  A.friends.cancelChallenge();
  assert.equal((await chal3).error, 'cancelled');
  // block: hidden from the blocked player, cannot re-add, cannot challenge
  assert.equal((await B.friends.block(pa.id)).ok, true);
  assert.equal((await A.friends.list()).items.length, 0);
  assert.equal((await A.friends.add(pb.friendCode)).error, 'not_found');
  assert.equal((await A.friends.challenge(pb.id, 'ut')).error, 'not_friends');
  assert.equal((await B.friends.list()).items[0].status, 'blocked');
  assert.equal((await B.friends.unblock(pa.id)).ok, true);
  assert.equal((await B.friends.list()).items.length, 0);
});
test('rivals: matchmade wins earn points, promotion, weekly claim once, packs whitelisted', async () => {
  const be = createMockBackend(memoryStore());
  let clock = Date.now();
  const mk = (name) => createOnline({ rpc: (f, a) => be.call(f, a), storage: memStorage(), transportKind: 'loopback', getName: () => name, matchmakerConfig: { pollMs: 10 } });
  const A = mk('Ann'), B = mk('Ben');
  const st0 = await A.rivals.status();
  assert.equal(st0.division, 10);
  assert.equal(st0.divisionName, 'Division 10');
  assert.equal(st0.claimable, false);
  assert.equal((await A.rivals.claimWeekly()).error, 'nothing_to_claim');
  // a rivals result without a matchmade game gives coins but no rivals points
  const solo = await A.reportResult({ mode: 'rivals', won: true, goalsFor: 1, goalsAgainst: 0 });
  assert.equal(solo.rivals, null);
  const pa = A.matchmaking.quickSearch({ mode: 'rivals' });
  await sleep(30);
  const rb = await B.matchmaking.quickSearch({ mode: 'rivals' });
  const ra = await pa;
  assert.equal(ra.ok && rb.ok, true);
  ra.transport.close(); rb.transport.close();
  const rep = await B.reportResult({ mode: 'rivals', won: true, goalsFor: 3, goalsAgainst: 0 });
  assert.deepEqual({ d: rep.rivals.division, p: rep.rivals.points }, { d: 10, p: 3 });
  const pb = await B.profile();
  await be.call('_rivals_end_week', { p_id: pb.id });
  const st = await B.rivals.status();
  assert.equal(st.claimable, true);
  assert.equal(st.reward.coins, 1500 + 300);
  assert.deepEqual(st.reward.packs, ['silver']);
  const cl = await B.rivals.claimWeekly();
  assert.equal(cl.ok, true);
  assert.equal(cl.coins, 1800);
  assert.equal((await B.rivals.claimWeekly()).error, 'already_claimed');
  assert.equal(sanitizeReport({ ok: true, rivals: { division: 0, points: 5, threshold: null, promoted: true } }).rivals.threshold, null);
  void clock;
});
test('startOnlineMatch-style rivals timeout reports reason no_opponent', async () => {
  const be = createMockBackend(memoryStore());
  const A = createOnline({ rpc: (f, a) => be.call(f, a), storage: memStorage(), transportKind: 'loopback', matchmakerConfig: { pollMs: 5, timeoutMs: 60 } });
  const r = await A.matchmaking.quickSearch({ mode: 'rivals' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_opponent');
});

// ------------------------------------------------------------------ accounts + moderation (migration 002)
const mkAcc = (be, o = {}) => createOnline({ rpc: (f, a) => be.call(f, a), storage: o.storage || memStorage(), volatileStorage: o.volatile || memStorage(), transportKind: 'loopback', requireAccount: true, matchmakerConfig: { pollMs: 5, timeoutMs: 80 }, ...o.extra });

test('account rules: usernames, passwords, name filter, SQL parity', () => {
  assert.equal(usernameError('ab'), 'bad_username');
  assert.equal(usernameError('a'.repeat(17)), 'bad_username');
  assert.equal(usernameError('bad-name'), 'bad_username');
  assert.equal(usernameError('two  spaces'), 'bad_username');
  assert.equal(usernameError('  Alice Smith  '), null); // trimmed
  assert.equal(usernameError('Cool_Kid 9'), null);
  assert.equal(usernameError('sh1t_lord'), 'username_not_allowed');
  assert.equal(usernameError('The Admin'), 'username_not_allowed');
  assert.equal(nameNorm('5hawky_F C'), 'shawkyfc');
  assert.ok(isReservedName('Shawky Fc') && isReservedName('ShawkyFc') && isReservedName('shawky_fc') && isReservedName('5HAWKY FC'));
  assert.ok(!isReservedName('Shawky'));
  assert.equal(usernameKey('John Doe'), usernameKey('john_doe'));
  assert.equal(passwordError('short'), 'weak_password');
  assert.equal(passwordError('alice123', 'ALICE123'), 'weak_password');
  assert.equal(passwordError('x'.repeat(73)), 'bad_password');
  assert.equal(passwordError('longenough', 'bob', 'different'), 'password_mismatch');
  assert.equal(passwordError('longenough', 'bob', 'longenough'), null);
  // the SQL word filter uses the same list
  const sql = readFileSync(new URL('../../../../supabase/migrations/20260926000000_pitchside_002_accounts.sql', import.meta.url), 'utf8');
  const m = /BLOCKLIST-BEGIN\s*\n\s*if v ~ '\(([^)]*)\)'/.exec(sql);
  assert.ok(m, 'blocklist regex found in SQL');
  assert.deepEqual(m[1].split('|'), BLOCKED_WORDS);
  assert.ok(sql.includes("position('shawkyfc' in"), 'reserved name in SQL');
});

test('ban parsing and text', () => {
  const b = parseBan('{"reason":"Cheating\\u0000","until":"2099-01-01T00:00:00Z"}');
  assert.equal(b.reason, 'Cheating');
  assert.equal(b.until, '2099-01-01T00:00:00.000Z');
  assert.ok(banActive(b));
  assert.ok(!banActive(parseBan({ reason: 'x', until: '2000-01-01T00:00:00Z' })));
  assert.ok(banActive(parseBan({ reason: 'x', until: null })));
  assert.match(banText(parseBan({ reason: 'Toxic', until: null })), /banned: Toxic \(permanent\)/);
  assert.equal(parseBan(null).reason, 'No reason given');
});

test('accounts: signup, duplicate names, remember-me storage, login elsewhere, logout', async () => {
  const be = createMockBackend(memoryStore());
  const disk = memStorage(), tab = memStorage();
  const A = mkAcc(be, { storage: disk, volatile: tab });
  assert.equal(A.account.current().state, 'none');
  assert.equal((await A.profile()).error, 'no_account'); // online features need an account
  assert.equal((await A.account.signup({ username: 'Al', password: 'password1', confirm: 'password1' })).error, 'bad_username');
  assert.equal((await A.account.signup({ username: 'Alice Smith', password: 'password1', confirm: 'nope' })).error, 'password_mismatch');
  const r = await A.account.signup({ username: ' Alice Smith ', password: 'password1', confirm: 'password1', remember: true });
  assert.equal(r.ok, true);
  assert.equal(r.username, 'Alice Smith');
  assert.ok(disk.getItem('pitchside.account') && !tab.getItem('pitchside.account'));
  const p = await A.profile();
  assert.equal(p.ok, true);
  assert.equal(p.username, 'Alice Smith');
  assert.equal(p.coins, 5000);
  // case / space / underscore variants are the same name
  const B = mkAcc(be);
  assert.equal((await B.account.signup({ username: 'ALICE_SMITH', password: 'password2', confirm: 'password2' })).error, 'username_taken');
  assert.equal((await B.account.signup({ username: 'alicesmith', password: 'password2', confirm: 'password2' })).error, 'username_taken');
  // log in on another device, not remembered -> session only in the volatile store
  const disk2 = memStorage(), tab2 = memStorage();
  const A2 = mkAcc(be, { storage: disk2, volatile: tab2 });
  assert.equal((await A2.account.login({ username: 'alice smith', password: 'wrong-one' })).error, 'bad_credentials');
  const l = await A2.account.login({ username: 'alice smith', password: 'password1', remember: false });
  assert.equal(l.ok, true);
  assert.equal(l.id, r.id);
  assert.ok(!disk2.getItem('pitchside.account') && tab2.getItem('pitchside.account'));
  assert.equal((await A2.profile()).id, r.id);
  // logout ends that session on the server too
  const tok = JSON.parse(tab2.getItem('pitchside.account')).token;
  await A2.account.logout();
  assert.equal(A2.account.current().state, 'none');
  assert.equal((await be.call('get_profile', { p_id: r.id, p_secret: tok })).data.error, 'auth');
  assert.equal((await A.profile()).ok, true); // the other device stays logged in
});

test('accounts: failed-login throttle, reserved owner name needs the admin code', async () => {
  const be = createMockBackend(memoryStore());
  be.setAdminCode('Owner-Code-1');
  const A = mkAcc(be);
  await A.account.signup({ username: 'Target', password: 'password1', confirm: 'password1' });
  const X = mkAcc(be);
  for (let i = 0; i < 10; i++) assert.equal((await X.account.login({ username: 'target', password: `bad${i}xxxx` })).error, 'bad_credentials');
  assert.equal((await X.account.login({ username: 'target', password: 'password1' })).error, 'too_many_attempts');
  const O = mkAcc(be);
  assert.equal((await O.account.signup({ username: 'Shawky Fc', password: 'password9', confirm: 'password9' })).error, 'reserved_username');
  assert.equal((await O.account.signup({ username: 'Shawky_FC', password: 'password9', confirm: 'password9', adminCode: 'wrong' })).error, 'reserved_username');
  const ok = await O.account.signup({ username: 'Shawky Fc', password: 'password9', confirm: 'password9', adminCode: 'Owner-Code-1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.role, 'owner');
  assert.equal(O.account.current().role, 'owner');
  assert.equal((await O.profile()).role, 'owner');
  assert.equal((await A.setName('ShawkyFC')).error, 'name_not_allowed');
});

test('accounts: claim an existing anonymous device profile keeps its coins and id', async () => {
  const be = createMockBackend(memoryStore());
  const disk = memStorage();
  const legacy = createOnline({ rpc: (f, a) => be.call(f, a), storage: disk, transportKind: 'loopback' });
  const p0 = await legacy.profile(); // anonymous device profile (old install)
  await be.call('admin_add_coins', {}); // no-op
  const A = mkAcc(be, { storage: disk });
  assert.equal(A.account.current().hasDevice, true);
  const r = await A.account.signup({ username: 'Old Timer', password: 'password1', confirm: 'password1' });
  assert.equal(r.ok, true);
  assert.equal(r.claimed, true);
  assert.equal(r.id, p0.id);
  assert.equal((await A.profile()).coins, p0.coins);
  const dev = JSON.parse(disk.getItem('pitchside.online.identity'));
  assert.equal((await be.call('get_profile', { p_id: dev.id, p_secret: dev.secret })).data.error, 'auth'); // device secret retired
});

test('bans: moderation ban blocks online RPCs with the reason, login shows it, unban restores', async () => {
  const be = createMockBackend(memoryStore());
  be.setAdminCode('Owner-Code-1');
  const P = mkAcc(be);
  const pr = await P.account.signup({ username: 'Cheater', password: 'password1', confirm: 'password1' });
  await P.market.list(card(), 1000);
  const M = mkAcc(be);
  const mr = await M.account.signup({ username: 'Helper', password: 'password1', confirm: 'password1' });
  assert.equal((await M.moderation.search('cheat')).error, 'not_admin'); // players cannot moderate
  be.setRole(mr.id, 'mod');
  await M.account.status();
  assert.equal(M.moderation.role, 'mod');
  const found = await M.moderation.search('cheat');
  assert.equal(found.items[0].id, pr.id);
  assert.equal((await M.moderation.adjustCoins(pr.id, 500)).error, 'not_allowed'); // mods cannot change balances
  const until = Date.now() + 86400000;
  const b = await M.moderation.ban(pr.id, 'Market abuse', until);
  assert.equal(b.ok, true);
  assert.equal(b.listingsCancelled, 1);
  const res = await P.profile();
  assert.equal(res.error, 'banned');
  assert.equal(res.ban.reason, 'Market abuse');
  assert.match(res.message, /banned: Market abuse \(until/);
  assert.equal(P.account.current().state, 'banned');
  assert.equal((await P.market.buy(UUID)).error, 'banned'); // refused locally from the cached ban
  assert.equal((await P.matchmaking.quickSearch({ mode: 'friendly' })).reason, 'banned');
  const again = mkAcc(be);
  const lg = await again.account.login({ username: 'cheater', password: 'password1' });
  assert.equal(lg.error, 'banned');
  assert.equal(lg.ban.reason, 'Market abuse');
  assert.equal(again.account.current().state, 'none'); // no session for banned players
  const det = await M.moderation.player(pr.id);
  assert.ok(det.audit.some((a) => a.action === 'admin_ban'));
  // admin code path (full admin) + unban
  const Adm = mkAcc(be);
  assert.equal(await Adm.admin.verify('Owner-Code-1'), true);
  assert.equal((await Adm.moderation.unban(pr.id)).ok, true);
  const st = await P.account.status();
  assert.equal(st.state, 'account');
  assert.equal((await P.profile()).ok, true);
  assert.equal((await Adm.moderation.adjustCoins(pr.id, -100, 'refund')).coins, 4900);
  // mods cannot ban owners; owners promote mods, cannot touch owners
  const O = mkAcc(be);
  const or = await O.account.signup({ username: 'Shawky Fc', password: 'password9', confirm: 'password9', adminCode: 'Owner-Code-1' });
  assert.equal((await M.moderation.ban(or.id, 'nope')).error, 'not_allowed');
  assert.equal((await M.moderation.setRole(pr.id, 'mod')).error, 'not_allowed');
  assert.equal((await O.moderation.setRole(pr.id, 'mod')).player.role, 'mod');
  assert.equal((await O.moderation.setRole(or.id, 'player')).error, 'not_allowed');
});

test('offline sign-up is queued (no password stored) and completes when online is back', async () => {
  const be = createMockBackend(memoryStore());
  const disk = memStorage();
  const A = mkAcc(be, { storage: disk });
  be.down = true;
  const r = await A.account.signup({ username: 'Late Joiner', password: 'password1', confirm: 'password1' });
  assert.equal(r.ok, false);
  assert.equal(r.queued, true);
  assert.match(r.message, /play offline now and your account will be created/);
  assert.equal(A.account.current().state, 'offline');
  assert.equal(A.account.pending().username, 'Late Joiner');
  assert.ok(!disk.getItem('pitchside.account.pending').includes('password1'));
  assert.equal((await A.account.retryPending()).error, 'offline');
  be.down = false;
  await sleep(20);
  const B = mkAcc(be, { storage: disk }); // next launch: only the username survived
  assert.equal(B.account.pending().username, 'Late Joiner');
  assert.equal(B.account.hasPendingCreds, false);
  const done = await (async () => { for (let i = 0; i < 30; i++) { const x = await A.account.retryPending(); if (x.error !== 'offline') return x; await sleep(10); } return null; })();
  assert.equal(done.ok, true);
  assert.equal(A.account.current().state, 'account');
  assert.equal(A.account.pending(), null);
});

test('expired session logs the account out instead of creating an anonymous profile', async () => {
  const be = createMockBackend(memoryStore());
  const A = mkAcc(be);
  await A.account.signup({ username: 'Sleepy', password: 'password1', confirm: 'password1' });
  let events = 0;
  A.account.onChange(() => { events++; });
  be.reset(); // server forgot the session (expired / revoked)
  const r = await A.profile();
  assert.equal(r.error, 'auth');
  assert.equal(A.account.current().state, 'none');
  assert.ok(events >= 1);
  assert.equal((await A.profile()).error, 'no_account');
});

test('staff match tokens: owner/mod only, bound to the room, verified server-side', async () => {
  const be = createMockBackend(memoryStore());
  be.setAdminCode('Owner-Code-1');
  const O = mkAcc(be);
  const or = await O.account.signup({ username: 'Shawky Fc', password: 'password9', confirm: 'password9', adminCode: 'Owner-Code-1' });
  const P = mkAcc(be);
  await P.account.signup({ username: 'Plain', password: 'password1', confirm: 'password1' });
  assert.equal((await P.admin.matchToken('ROOM1')).ok, false);
  assert.equal(O.admin.level, 'owner');
  const t = await O.admin.matchToken('ROOM1');
  assert.equal(t.ok, true);
  const v = await P.admin.verifyMatchToken(t.token, 'ROOM1');
  assert.deepEqual([v.ok, v.profileId, v.role], [true, or.id, 'owner']);
  assert.equal((await P.admin.verifyMatchToken(t.token, 'ROOM2')).ok, false);
  assert.equal((await P.admin.verifyMatchToken(t.token.replace('.owner.', '.mod.'), 'ROOM1')).ok, false);
  assert.equal((await P.admin.verifyMatchToken('garbage', 'ROOM1')).ok, false);
});


// ------------------------------------------------------------------ migration 003: owner powers, config, coins, social
const mk3 = (be, o = {}) => createOnline({ rpc: o.rpc || ((f, a) => be.call(f, a)), storage: o.storage || memStorage(), volatileStorage: o.volatile || memStorage(), transportKind: 'loopback', ...o.extra });
async function world3() {
  const be = createMockBackend(memoryStore());
  be.setAdminCodes({ full: 'full-code-1', super: 'super-code-1' });
  const A = mk3(be), B = mk3(be), O = mk3(be);
  const a = await A.account.signup({ username: 'Alice Smith', password: 'password1', confirm: 'password1' });
  const b = await B.account.signup({ username: 'Bob Jones', password: 'password2', confirm: 'password2' });
  const o = await O.account.signup({ username: 'Shawky Fc', password: 'password9', confirm: 'password9', adminCode: 'super-code-1' });
  return { be, A, B, O, a, b, o };
}

test('admin levels: full/super codes -> signed token in session storage (never the code); forged tokens fail', async () => {
  const be = createMockBackend(memoryStore());
  be.setAdminCodes({ full: 'full-code-1', super: 'super-code-1' });
  const vol = memStorage(), disk = memStorage();
  const X = mk3(be, { volatile: vol, storage: disk });
  assert.deepEqual(await X.admin.verifyLevel('nope'), { ok: false, error: 'invalid', message: 'Invalid code.' });
  assert.equal(X.admin.level, null);
  assert.equal((await X.admin.verifyLevel('full-code-1')).level, 'full');
  assert.equal((await X.admin.verifyLevel('super-code-1')).level, 'super');
  assert.equal(X.admin.codeLevel, 'super');
  assert.equal(X.admin.canOwner(), true);
  const stored = vol.getItem('pitchside.account.admin');
  assert.ok(stored && !stored.includes('super-code-1') && !JSON.stringify([...Array(1)].map(() => disk.getItem('pitchside.account.admin'))).includes('code'));
  const tok = JSON.parse(stored).token;
  assert.equal((await be.call('admin_verify', { p_code: tok.replace('adm.super.', 'adm.full.') })).data, false);
  assert.equal(await X.admin.verify('super-code-1'), true); // compat boolean
  X.admin.forget();
  assert.equal(X.admin.codeLevel, null);
  assert.equal((await X.owner.broadcast('hi')).error, 'not_admin');
});

test('owner give-coins: idempotent key survives a lost response (timeout after the server applied it)', async () => {
  const { be, A, a } = await world3();
  const X = mk3(be);
  await X.admin.verifyLevel('full-code-1');
  let first = true, calls = 0;
  const flaky = mk3(be, { rpc: async (f, args) => { const r = await be.call(f, args); if (f === 'admin_coins') { calls++; if (first) { first = false; return { ok: false, error: 'timeout' }; } } return r; } });
  flaky.admin.verifyLevel && await flaky.admin.verifyLevel('full-code-1');
  const r = await flaky.owner.giveCoins(a.id, 2500, { reason: 'test' });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  assert.equal((await A.coins.get()).coins, 7500); // applied once
  const k = { key: 'fixed-key-000001' };
  await X.owner.giveCoins(a.id, 100, k); await X.owner.giveCoins(a.id, 100, k);
  assert.equal((await A.coins.get()).coins, 7600);
  assert.equal((await A.owner.giveCoins(a.id, 5)).error, 'not_admin'); // players cannot
});

test('coins: one server wallet — spend/earn atomic, earn capped, infinite wallet always succeeds (also market buys)', async () => {
  const { A, B, O } = await world3();
  assert.equal((await A.coins.spend(1000)).coins, 4000);
  assert.equal((await A.coins.spend(1e7)).error, 'insufficient_coins');
  const e = await A.coins.earn(300000, 'quicksell');
  assert.equal(e.applied, 250000);
  assert.equal((await A.coins.earn(10, 'quicksell')).applied, 0);
  assert.equal((await O.owner.setInfinite(true)).infinite, true); // owner account, no code needed
  assert.equal((await O.coins.spend(99999999)).ok, true);
  assert.equal((await O.coins.get()).infinite, true);
  const l = await B.market.list(card({ id: 'b1' }), 900000);
  const bought = await O.market.buy(l.listingId);
  assert.equal(bought.ok, true);
  assert.equal((await O.coins.get()).coins, 5000);
  assert.equal((await B.coins.get()).coins, 5000 + 855000); // seller credited instantly, 5 % tax
  assert.equal((await B.market.mine()).items.length, 0);
  assert.equal((await A.owner.setInfinite(true)).error, 'not_admin');
});

test('global config: owner/code writes (validated), everyone reads; tax applies to sales', async () => {
  const { A, B, O } = await world3();
  assert.equal((await A.owner.setConfig('market', { tax: 0.2 })).error, 'not_admin');
  assert.equal((await O.owner.setConfig('market', { tax: 0.9 })).error, 'bad_value');
  assert.equal((await O.owner.setConfig('secret', {})).error, 'bad_key');
  assert.equal((await O.owner.setConfig('market', { tax: 0.2 })).ok, true);
  assert.equal((await O.owner.setConfig('packs', { gold: { enabled: false, price: 9000 } })).ok, true);
  assert.equal((await O.owner.setConfig('promos', { toty: true, fut_birthday: false })).ok, true);
  let seen = null;
  B.config.onChange((c) => { seen = c; });
  const c = await B.config.get(true);
  assert.equal(c.config.market.tax, 0.2);
  assert.equal(B.config.value('packs.gold.price', 7500), 9000);
  assert.equal(B.config.value('packs.silver.price', 1500), 1500);
  assert.equal(seen.promos.toty, true);
  const l = await A.market.list(card({ id: 'x9' }), 1000);
  await B.market.buy(l.listingId);
  assert.equal((await A.coins.get()).coins, 5800);
});

test('gifts: giveaway to everyone + direct card (tradable, >99 needs super), claim once, presence counts', async () => {
  const { be, A, B, O, b } = await world3();
  assert.equal((await O.owner.gift({ to: 'all', kind: 'coins', coins: 1000, message: 'Enjoy!' })).ok, true);
  assert.equal((await O.owner.gift({ to: b.id, kind: 'card', card: { id: 'adm1', name: 'Admin Guy', ovr: 500, untradable: true } })).error, 'needs_super');
  const X = mk3(be);
  await X.admin.verifyLevel('super-code-1');
  assert.equal((await X.owner.gift({ to: b.id, kind: 'card', card: { id: 'adm1', name: 'Admin Guy', pos: 'ST', ovr: 500, untradable: true } })).ok, true);
  assert.equal((await X.owner.gift({ to: b.id, kind: 'pack', packId: 'gold', count: 3 })).ok, true);
  assert.equal((await B.presence.tick()).gifts, 3);
  const inbox = await B.gifts.inbox();
  assert.equal(inbox.items.length, 3);
  const cardGift = inbox.items.find((g) => g.kind === 'card');
  assert.equal(cardGift.card.tradable, true);
  assert.equal('untradable' in cardGift.card, false);
  const coinsGift = inbox.items.find((g) => g.kind === 'coins');
  const c1 = await B.gifts.claim(coinsGift.id);
  assert.deepEqual([c1.ok, c1.coins, c1.balance], [true, 1000, 6000]);
  assert.equal((await B.gifts.claim(coinsGift.id)).error, 'already_claimed_gift');
  const p = await B.gifts.claim(inbox.items.find((g) => g.kind === 'pack').id);
  assert.deepEqual([p.packId, p.count], ['gold', 3]);
  assert.equal((await A.gifts.inbox()).items.length, 1); // A only has the giveaway
  assert.equal((await A.gifts.claim(cardGift.id)).error, 'not_found'); // not A's gift
});

test('broadcasts + presence: banner once per message, counter, club reset epoch; guests poll without a profile', async () => {
  const { be, A, B, O, b } = await world3();
  const seen = [];
  A.presence.onBroadcast((x) => seen.push(x.text));
  assert.equal((await A.owner.broadcast('nope')).error, 'not_admin');
  assert.equal((await O.owner.broadcast('Server   restart in 5 min', 10)).ok, true);
  const u = await A.presence.tick();
  await A.presence.tick();
  assert.deepEqual(seen, ['Server restart in 5 min']);
  assert.ok(u.online >= 2);
  const guest = mk3(be); // never registered: no profile is created just by browsing
  const g = await guest.presence.tick();
  assert.equal(guest.hasIdentity(), false);
  assert.equal(g.broadcasts.length, 1);
  assert.ok((await guest.presence.count()).online >= 2);
  const r = await O.owner.reset(b.id, 'club');
  assert.equal(r.resets.club, 1);
  assert.equal((await B.presence.tick()).resets.club, 1);
  const r2 = await O.owner.reset(b.id, 'coins');
  assert.equal(r2.player.coins, 5000);
  const X = mk3(be); await X.admin.verifyLevel('full-code-1');
  const id = (await X.owner.broadcast('two')).id;
  assert.equal((await X.owner.clearBroadcast(id)).ok, true);
  assert.equal((await guest.presence.broadcasts()).items.length, 1);
});

test('messages + squads + player search; guests cannot DM; images must be small JPEGs', async () => {
  const { be, A, B, a, b } = await world3();
  const found = await A.players.find('bob');
  assert.equal(found.items[0].id, b.id);
  assert.equal((await A.messages.send(b.id, 'hi bob')).ok, true);
  assert.equal((await A.messages.send(b.id, '', 'data:image/png;base64,AAAA')).error, 'bad_image');
  assert.equal((await A.messages.send(b.id, '', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==')).ok, true);
  assert.equal((await A.messages.send(b.id, '   ')).error, 'empty');
  assert.equal((await A.messages.send(b.id, 'x'.repeat(400))).ok, true);
  assert.equal((await B.presence.tick()).unread, 3);
  const conv = await B.messages.conversations();
  assert.deepEqual([conv.items[0].with.id, conv.items[0].unread], [a.id, 3]);
  const th = await B.messages.thread(a.id);
  assert.equal(th.items.length, 3);
  assert.equal(th.items[1].image.startsWith('data:image/jpeg'), true);
  assert.equal(th.items[2].text.length, 300);
  assert.equal((await B.presence.tick()).unread, 0);
  const G = mk3(be); // anonymous device profile
  assert.equal((await G.messages.send(b.id, 'hey')).error, 'no_account');
  const players = Array.from({ length: 18 }, (_, i) => ({ name: `P${i}`, pos: 'CM', ovr: 80 + (i % 10) }));
  assert.equal((await A.squads.publish({ name: 'Alice XI', formation: '4-3-3', players })).ok, true);
  const v = await B.squads.view('alice_smith');
  assert.deepEqual([v.ok, v.owner.username, v.squad.name, v.squad.players.length], [true, 'Alice Smith', 'Alice XI', 18]);
  const code = (await A.profile()).friendCode;
  assert.equal((await B.squads.view(code)).squad.formation, '4-3-3');
  assert.equal((await A.squads.view('bob jones')).error, 'no_squad');
  assert.equal((await A.squads.publish({ blob: 'x'.repeat(64), list: Array.from({ length: 40 }, () => Object.fromEntries('abcdefgh'.split('').map((k) => [k, k.repeat(64)]))) })).error, 'too_large');
});

test('account: change username (password + reserved check) and password (other sessions end)', async () => {
  const { be, A, a } = await world3();
  assert.equal((await A.account.changeUsername({ username: 'Alicia', password: 'wrong-pass' })).error, 'bad_credentials');
  assert.equal((await A.account.changeUsername({ username: 'Bob_Jones', password: 'password1' })).error, 'username_taken');
  assert.equal((await A.account.changeUsername({ username: 'Shawky FC 2', password: 'password1' })).error, 'reserved_username');
  const r = await A.account.changeUsername({ username: 'Alicia', password: 'password1' });
  assert.equal(r.ok, true);
  assert.equal(A.account.current().username, 'Alicia');
  const A2 = mk3(be);
  assert.equal((await A2.account.login({ username: 'alicia', password: 'password1' })).id, a.id);
  assert.equal((await A.account.changePassword({ password: 'password1', newPassword: 'password7', confirm: 'nope' })).error, 'password_mismatch');
  assert.equal((await A.account.changePassword({ password: 'password1', newPassword: 'password7', confirm: 'password7' })).ok, true);
  assert.equal((await A2.profile()).error, 'auth'); // other device logged out
  assert.equal((await A.profile()).ok, true);
  const G = mk3(be);
  assert.equal(G.account.isGuest(), false);
  G.account.guest();
  assert.equal(G.account.isGuest(), true);
});

test('post-match rewards: coins x multiplier, rare server pack, capped per minute', async () => {
  const { A, O } = await world3();
  assert.equal((await O.owner.setConfig('rewards', { multiplier: 1.5, packChance: 1 })).ok, true);
  const r = await A.rewards.match({ mode: 'offline', won: true, gf: 3, ga: 1 });
  assert.deepEqual([r.ok, r.coinsAwarded, r.coins, r.multiplier], [true, 1200, 6200, 1.5]);
  assert.ok(['gold', 'premium', 'rare', 'stars'].includes(r.pack));
  const r2 = await A.rewards.match({ mode: 'offline', won: true, gf: 1, ga: 0 });
  assert.deepEqual([r2.capped, r2.pack, r2.coinsAwarded], [true, null, 0]);
  assert.equal((await A.rewards.match({ mode: 'bogus' })).error, 'bad_mode');
});

test('shared adminauth: local PBKDF2 levels, session level + account role, caps', async () => {
  const AA = await import('../../shared/adminauth.js');
  const mem = memStorage();
  globalThis.sessionStorage = mem; globalThis.localStorage = memStorage();
  const salt = '00112233445566778899aabbccddeeff';
  const table = {
    super: { salt, iterations: 1000, hash: await AA.pbkdf2Hex('s-code', salt, 1000) },
    full: { salt, iterations: 1000, hash: await AA.pbkdf2Hex('f-code', salt, 1000) },
    temp: { salt, iterations: 1000, hash: await AA.pbkdf2Hex('t-code', salt, 1000) },
  };
  assert.equal(await AA.verifyAdminCodeLocal('s-code', table), 'super');
  assert.equal(await AA.verifyAdminCodeLocal(' f-code ', table), 'full');
  assert.equal(await AA.verifyAdminCodeLocal('t-code', table), 'temp');
  assert.equal(await AA.verifyAdminCodeLocal('nope', table), null);
  assert.equal(await AA.verifyAdminCodeLocal('definitely-wrong'), null); // real constants (3 x 600k PBKDF2)
  const fakeOnline = { account: { current: () => ({ state: 'account', role: 'owner' }) }, admin: { codeLevel: null } };
  AA.bindOnline(fakeOnline);
  assert.equal(AA.getAdminLevel(), 'full');
  AA.setAdminSessionLevel('temp');
  assert.equal(AA.getAdminLevel(), 'full');
  fakeOnline.admin.codeLevel = 'super';
  assert.equal(AA.getAdminLevel(), 'super');
  assert.equal(AA.adminCaps('super').maxOvr, 999);
  assert.equal(AA.adminCaps('full').adminCards, false);
  AA.bindOnline(null); AA.clearAdminSession();
  assert.equal(AA.getAdminLevel(), null);
  // server path: verifyAdminCode uses online.admin.verifyLevel first
  const be = createMockBackend(memoryStore());
  be.setAdminCodes({ super: 'srv-super-1' });
  const X = mk3(be);
  const r = await AA.verifyAdminCode('srv-super-1', X);
  assert.deepEqual([r.ok, r.level, r.server], [true, 'super', true]);
  assert.equal(AA.adminSessionLevel(), 'super');
  delete globalThis.sessionStorage; delete globalThis.localStorage;
});

test('unavailable stub exposes every 003 namespace', async () => {
  for (const ns of ['owner', 'config', 'presence', 'gifts', 'rewards', 'messages', 'squads', 'players']) assert.ok(defaultOnline[ns], ns);
  assert.equal((await defaultOnline.gifts.inbox()).ok, false);
  assert.equal(defaultOnline.config.value('x', 3), 3);
});


test('super code 12345678910: local PBKDF2 -> super; meta redeem keeps super (reported as full to the UI) + isSuperAdmin', async () => {
  globalThis.sessionStorage = memStorage(); globalThis.localStorage = memStorage();
  const AA = await import('../../shared/adminauth.js');
  assert.equal(await AA.verifyAdminCodeLocal('12345678910'), 'super');
  const M = await import('../../meta/core/admincode.js');
  const r = await M.redeemAdminCode('12345678910', null);
  assert.deepEqual([r.ok, r.level], [true, 'super']);
  assert.equal(M.getAdminLevel(), 'full');
  assert.equal(M.isSuperAdmin(), true);
  assert.equal(M.adminInfo().super, true);
  assert.equal(AA.getAdminLevel(), 'super');
  // with the server: super level + admin token for owner powers
  const be = createMockBackend(memoryStore());
  be.setAdminCodes({ super: '12345678910' });
  const X = mk3(be);
  const r2 = await M.redeemAdminCode('12345678910', X);
  assert.deepEqual([r2.ok, r2.level, r2.server], [true, 'super', true]);
  assert.equal(X.admin.codeLevel, 'super');
  assert.equal(X.admin.canOwner(), true);
  delete globalThis.sessionStorage; delete globalThis.localStorage;
});

test('market: seller paid instantly, sold listing leaves My listings + local records, balances pushed to listeners, dedupe', async () => {
  const PM = await import('../../meta/core/pmarket.js');
  const { A, B } = await world3();
  const seen = [];
  A.coins.onChange((v) => seen.push(v));
  const l = await A.market.list(card({ id: 'mk1' }), 2000);
  const stA = { club: [], listed: [{ listingId: l.listingId, pid: 'mk1', price: 2000, status: 'active' }] };
  await B.market.buy(l.listingId);
  await A.presence.tick();
  assert.equal(seen.at(-1), 6900);
  const mine = await PM.fetchMine(stA, A);
  assert.deepEqual([mine.items.length, mine.sold.length, stA.listed.length], [0, 1, 0]);
  const dupe = { market: { search: async () => ({ ok: true, items: [{ listingId: 'x', card: card(), price: 5 }, { listingId: 'x', card: card(), price: 5 }] }) } };
  assert.equal((await PM.searchMarket(dupe)).items.length, 1);
});


test('reset everyone (004): only profiles older than the reset, once each; newcomers never reset', async () => {
  let t = 1_800_000_000_000;
  const be = createMockBackend(memoryStore(), { now: () => t });
  be.setAdminCodes({ full: 'full-code-1' });
  const A = mk3(be), O = mk3(be);
  await A.account.signup({ username: 'Old Timer', password: 'password1', confirm: 'password1' });
  await A.coins.earn(50000, 'quicksell');
  await O.admin.verifyLevel('full-code-1');
  assert.equal((await A.presence.tick()).resetDue, null);
  t += 5000;
  const r = await O.owner.resetEveryone();
  assert.equal(r.ok, true);
  assert.equal((await A.coins.get()).coins, 5000);
  const u = await A.presence.tick();
  assert.equal(u.resetDue, r.epoch);
  assert.equal((await A.account.ackReset(r.epoch)).ok, true);
  assert.equal((await A.presence.tick()).resetDue, null); // at most once
  t += 60000;
  const N = mk3(be);
  await N.account.signup({ username: 'New Comer', password: 'password2', confirm: 'password2' });
  const n = await N.presence.tick();
  assert.deepEqual([n.resetDue, n.resetEpoch], [null, r.epoch]); // joining after the reset: never reset
  assert.equal((await N.owner.resetEveryone()).error, 'not_admin');
  assert.equal(O.config.value('features.resetEpoch'), r.epoch); // numeric features survive client sanitising
});

test('admin players list (004) + config.set compat for the owner toggles reach every client', async () => {
  const { be, A, B, O } = await world3();
  await B.squads.publish({ name: 'Bobby FC', players: [] });
  const all = await O.owner.listPlayers();
  assert.equal(all.total, 3);
  const q = await O.owner.listPlayers({ query: 'bobby' });
  assert.deepEqual([q.total, q.items[0].clubName, q.items[0].username], [1, 'Bobby FC', 'Bob Jones']);
  assert.equal((await A.owner.listPlayers()).error, 'not_admin');
  assert.equal((await O.config.set({ promosOn: false, packsInShop: true, priceMult: 1.5 })).ok, true);
  const seen = await B.config.get(true); // another client
  assert.deepEqual([seen.config.features.promosEnabled, seen.config.features.packPriceMult], [false, 1.5]);
  const X = mk3(be); await X.presence.tick(); // guest without profile still gets broadcasts via polling
  assert.equal((await X.config.get(true)).config.features.packsEnabled, true);
});

test('cloud save: sign up uploads the local club, login elsewhere downloads it, later edits sync, conflict -> newest', async () => {
  const { createCloudSync } = await import('../cloudsave.js');
  const be = createMockBackend(memoryStore());
  const d1 = memStorage(), d2 = memStorage();
  d1.setItem('pitchside.ut', JSON.stringify({ club: ['p1', 'p2'], coins: 900 }));
  const A1 = mk3(be, { storage: d1 }), A2 = mk3(be, { storage: d2 });
  let replaced2 = 0;
  const c1 = createCloudSync(A1, { storage: d1 }), c2 = createCloudSync(A2, { storage: d2, onReplaced: () => replaced2++ });
  assert.equal((await c1.syncNow()).error, 'no_account'); // guests: nothing uploaded
  await A1.account.signup({ username: 'Cloud Guy', password: 'password1', confirm: 'password1' });
  assert.equal((await c1.syncNow()).action, 'uploaded');
  d2.setItem('pitchside.ut', JSON.stringify({ club: ['other'] }));
  await A2.account.login({ username: 'cloud guy', password: 'password1' });
  assert.equal((await c2.syncNow()).action, 'downloaded');
  assert.deepEqual(JSON.parse(d2.getItem('pitchside.ut')).club, ['p1', 'p2']);
  assert.deepEqual(JSON.parse(d2.getItem('pitchside.ut.backup')).club, ['other']);
  assert.equal(replaced2, 1);
  assert.equal((await c2.syncNow()).action, 'unchanged');
  d2.setItem('pitchside.ut', JSON.stringify({ club: ['p1', 'p2', 'p3'] }));
  assert.equal((await c2.syncNow()).action, 'uploaded');
  d1.setItem('pitchside.ut', JSON.stringify({ club: ['p1'] })); // device 1 edited an older copy
  const r = await c1.syncNow();
  assert.deepEqual([r.action, r.conflict], ['downloaded', true]);
  assert.deepEqual(JSON.parse(d1.getItem('pitchside.ut')).club, ['p1', 'p2', 'p3']);
});

// ------------------------------------------------------------------ run
for (const [name, fn] of queue) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e && e.stack || String(e)).split("\n").slice(0, 8).join('\n       ')}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
