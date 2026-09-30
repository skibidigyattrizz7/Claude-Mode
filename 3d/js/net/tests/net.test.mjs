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
import { LoopbackTransport, backlogged, RT_BACKLOG_BYTES } from '../transport.js';
import { NetSession } from '../session.js';
import { usernameError, passwordError, passwordHint, COMMON_PASSWORDS, nameNorm, isReservedName, usernameKey, parseBan, banActive, banText, BLOCKED_WORDS } from '../accountcore.js';
import { errorText } from '../validate.js';
import { readFileSync } from 'node:fs';
import { receiveCard, giftPayloadCard, registerCustomCard } from '../../meta/core/customreg.js';
import * as UT from '../../meta/core/ut.js';
import { getPlayer, getDB } from '../../meta/core/players.js';
import { isTradeable } from '../../meta/core/pmarket.js';
import { applyOwnerPatches } from '../../meta/core/ownerpatch.js';

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
  assert.equal(sanitizeListingItem({ listingId: UUID, card: card(), price: 0 }), null);
  assert.equal(sanitizeListingItem({ listingId: UUID, card: card(), price: 10 }).price, 10); // staff may list at any price (007)
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
  // owner, Sep 30: no username restrictions beyond 1-16 characters and no invisible characters
  assert.equal(usernameError(''), 'bad_username');
  assert.equal(usernameError('a'.repeat(17)), 'bad_username');
  assert.equal(usernameError('a\u200bb'), 'bad_username');
  assert.equal(usernameError('x'), null);
  assert.equal(usernameError('bad-name!'), null);
  assert.equal(usernameError('two  spaces'), null);
  assert.equal(usernameError('  Alice Smith  '), null); // trimmed
  assert.equal(usernameError('Cool_Kid 9'), null);
  assert.equal(usernameError('The Admin'), null);
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

test('password strength rules (same as SQL pitchside__password_error, migration 008)', () => {
  for (const pw of ['aaaaaaaa', 'ZZZZZZZZZZ', '12345678', '0000000000', '98765432109', 'password', 'PASSWORD1', 'Qwerty123', 'iloveyou', 'Liverpool', 'short1!', ''])
    assert.equal(passwordError(pw), 'weak_password', pw);
  assert.equal(passwordError('Cool Kid 9', 'cool kid 9'), 'weak_password'); // equals the username
  assert.equal(passwordError(null), 'weak_password');
  assert.equal(passwordError('x'.repeat(73)), 'bad_password');
  assert.equal(passwordError('abc\u0001defgh'), 'bad_password');
  for (const pw of ['Blue-Kite-42', 'correct horse', 'aaaaaaab', '1234567a', 'password!2x', 'Pitch-pass1'])
    assert.equal(passwordError(pw, 'someone'), null, pw);
  assert.equal(passwordError('Blue-Kite-42', 'x', 'Blue-Kite-43'), 'password_mismatch');
  // every common entry is refused, and the SQL list is the same list in the same order
  for (const pw of COMMON_PASSWORDS) assert.equal(passwordError(pw), 'weak_password', pw);
  assert.ok(COMMON_PASSWORDS.length >= 45 && COMMON_PASSWORDS.every((x) => x.length >= 8 && !/^[0-9]+$/.test(x) && x === x.toLowerCase()));
  const sql = readFileSync(new URL('../../../../supabase/drafts/pitchside_008_security.sql', import.meta.url), 'utf8');
  const m = /COMMON-PASSWORDS-BEGIN([\s\S]*?)-- COMMON-PASSWORDS-END/.exec(sql);
  assert.ok(m, 'common list found in SQL');
  assert.deepEqual([...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]), COMMON_PASSWORDS);
  assert.ok(sql.includes("p_password ~ '^(.)\\1*$'") && sql.includes("p_password ~ '^[0-9]+$'"), 'repeat / digits rules in SQL');
});

test('password hint text follows the rules', () => {
  assert.equal(passwordHint('').level, 0);
  assert.match(passwordHint('abc').text, /5 more characters/);
  assert.match(passwordHint('abcdefg').text, /1 more character needed/);
  assert.match(passwordHint('12345678').text, /not only numbers/);
  assert.match(passwordHint('football').text, /common/);
  assert.match(passwordHint('Cool Kid 9', 'cool kid 9').text, /username/);
  assert.match(passwordHint('bbbbbbbbbb').text, /Too weak/);
  assert.equal(passwordHint('greenkite').level, 1);
  assert.equal(passwordHint('Blue-Kite').level, 2);
  assert.equal(passwordHint('Blue-Kite-42').level, 3);
  assert.equal(passwordHint('x'.repeat(80)).level, 0);
});

test('friendly error text for security codes (new and existing)', () => {
  const fallback = errorText('definitely_not_a_code');
  for (const code of ['weak_password', 'bad_password', 'too_many_attempts', 'rate_limited', 'bad_credentials', 'invalid', 'reserved_username', 'password_mismatch']) {
    const t = errorText(code);
    assert.ok(typeof t === 'string' && t.length > 5 && t !== fallback, code);
  }
  assert.match(errorText('weak_password'), /common password/);
  assert.match(errorText('too_many_attempts'), /15 minutes/);
});

test('admin code lock (rate_limited) reaches the UI as a friendly message', async () => {
  const rpc = async (fn) => (fn === 'admin_login' ? { ok: true, data: { ok: false, error: 'rate_limited' } } : { ok: false, error: 'offline' });
  const O = createOnline({ rpc, storage: memStorage(), volatileStorage: memStorage(), transportKind: 'loopback' });
  const r = await O.admin.verifyLevel('Some-Code-1');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'rate_limited');
  assert.equal(r.message, errorText('rate_limited'));
  assert.equal(O.admin.verified, false);
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
  assert.equal((await A.account.signup({ username: 'A'.repeat(17), password: 'Pitch-pass1', confirm: 'Pitch-pass1' })).error, 'bad_username');
  assert.equal((await A.account.signup({ username: 'Alice Smith', password: 'Pitch-pass1', confirm: 'nope' })).error, 'password_mismatch');
  const r = await A.account.signup({ username: ' Alice Smith ', password: 'Pitch-pass1', confirm: 'Pitch-pass1', remember: true });
  assert.equal(r.ok, true);
  assert.equal(r.username, 'Alice Smith');
  assert.ok(disk.getItem('pitchside.account') && !tab.getItem('pitchside.account'));
  const p = await A.profile();
  assert.equal(p.ok, true);
  assert.equal(p.username, 'Alice Smith');
  assert.equal(p.coins, 5000);
  // case / space / underscore variants are the same name
  const B = mkAcc(be);
  assert.equal((await B.account.signup({ username: 'ALICE_SMITH', password: 'Pitch-pass2', confirm: 'Pitch-pass2' })).error, 'username_taken');
  assert.equal((await B.account.signup({ username: 'alicesmith', password: 'Pitch-pass2', confirm: 'Pitch-pass2' })).error, 'username_taken');
  // log in on another device, not remembered -> session only in the volatile store
  const disk2 = memStorage(), tab2 = memStorage();
  const A2 = mkAcc(be, { storage: disk2, volatile: tab2 });
  assert.equal((await A2.account.login({ username: 'alice smith', password: 'wrong-one' })).error, 'bad_credentials');
  const l = await A2.account.login({ username: 'alice smith', password: 'Pitch-pass1', remember: false });
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
  await A.account.signup({ username: 'Target', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
  const X = mkAcc(be);
  // 4 failures, then the right password clears the counter
  for (let i = 0; i < 4; i++) assert.equal((await X.account.login({ username: 'target', password: `bad${i}xxxx` })).error, 'bad_credentials');
  assert.equal((await X.account.login({ username: 'target', password: 'Pitch-pass1' })).ok, true);
  await X.account.logout();
  // 5 failures in 15 minutes lock the username (migration 008)
  for (let i = 0; i < 5; i++) assert.equal((await X.account.login({ username: 'target', password: `bad${i}xxxx` })).error, 'bad_credentials');
  assert.equal((await X.account.login({ username: 'target', password: 'Pitch-pass1' })).error, 'too_many_attempts');
  const O = mkAcc(be);
  assert.equal((await O.account.signup({ username: 'Shawky Fc', password: 'Pitch-pass9', confirm: 'Pitch-pass9' })).error, 'reserved_username');
  assert.equal((await O.account.signup({ username: 'Shawky_FC', password: 'Pitch-pass9', confirm: 'Pitch-pass9', adminCode: 'wrong' })).error, 'reserved_username');
  const ok = await O.account.signup({ username: 'Shawky Fc', password: 'Pitch-pass9', confirm: 'Pitch-pass9', adminCode: 'Owner-Code-1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.role, 'owner');
  assert.equal(O.account.current().role, 'owner');
  assert.equal((await O.profile()).role, 'owner');
  assert.deepEqual(await A.setName('ShawkyFC'), { ok: true, name: 'Target' }); // accounts: the display name is always the username
});

test('accounts: claim an existing anonymous device profile keeps its coins and id', async () => {
  const be = createMockBackend(memoryStore());
  const disk = memStorage();
  const legacy = createOnline({ rpc: (f, a) => be.call(f, a), storage: disk, transportKind: 'loopback' });
  const p0 = await legacy.profile(); // anonymous device profile (old install)
  await be.call('admin_add_coins', {}); // no-op
  const A = mkAcc(be, { storage: disk });
  assert.equal(A.account.current().hasDevice, true);
  const r = await A.account.signup({ username: 'Old Timer', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
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
  const pr = await P.account.signup({ username: 'Cheater', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
  await P.market.list(card(), 1000);
  const M = mkAcc(be);
  const mr = await M.account.signup({ username: 'Helper', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
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
  const lg = await again.account.login({ username: 'cheater', password: 'Pitch-pass1' });
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
  const or = await O.account.signup({ username: 'Shawky Fc', password: 'Pitch-pass9', confirm: 'Pitch-pass9', adminCode: 'Owner-Code-1' });
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
  const r = await A.account.signup({ username: 'Late Joiner', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
  assert.equal(r.ok, false);
  assert.equal(r.queued, true);
  assert.match(r.message, /play offline now and your account will be created/);
  assert.equal(A.account.current().state, 'offline');
  assert.equal(A.account.pending().username, 'Late Joiner');
  assert.ok(!disk.getItem('pitchside.account.pending').includes('Pitch-pass1'));
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
  await A.account.signup({ username: 'Sleepy', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
  let events = 0;
  A.account.onChange(() => { events++; });
  // the session ends on the server (expired / revoked elsewhere) while the profile still exists. (A server that lost the
  // whole profile is the "deleted" case, see the 019 tests: that one wipes the device instead.)
  const B = mkAcc(be);
  await B.account.login({ username: 'Sleepy', password: 'Pitch-pass1' });
  await B.account.logout({ all: true });
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
  const or = await O.account.signup({ username: 'Shawky Fc', password: 'Pitch-pass9', confirm: 'Pitch-pass9', adminCode: 'Owner-Code-1' });
  const P = mkAcc(be);
  await P.account.signup({ username: 'Plain', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
  assert.equal((await P.admin.matchToken('ROOM1')).ok, false);
  assert.equal(O.admin.level, 'super'); // 009: the owner account is Owner Access
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
  const a = await A.account.signup({ username: 'Alice Smith', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
  const b = await B.account.signup({ username: 'Bob Jones', password: 'Pitch-pass2', confirm: 'Pitch-pass2' });
  const o = await O.account.signup({ username: 'Shawky Fc', password: 'Pitch-pass9', confirm: 'Pitch-pass9', adminCode: 'super-code-1' });
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

test('009: the owner ACCOUNT is Owner Access: gifts a 500 OVR card with no code this session (laptop needs_super bug)', async () => {
  const { O, B, b } = await world3();
  O.admin.forget(); // no code token in this browser session, like a fresh laptop session
  assert.equal(O.admin.codeLevel, null);
  assert.equal(O.admin.level, 'super');
  const r = await O.owner.gift({ to: b.id, kind: 'card', card: { id: 'adm9', name: 'Admin Nine', pos: 'ST', ovr: 500 } });
  assert.equal(r.ok, true, r.error);
  assert.ok((await B.gifts.inbox()).items.some((g) => g.kind === 'card' && g.card.ovr === 500));
});

test('gifts: giveaway to everyone + direct card (tradable, >99 needs super), claim once, presence counts', async () => {
  const { be, A, B, O, b } = await world3();
  assert.equal((await O.owner.gift({ to: 'all', kind: 'coins', coins: 1000, message: 'Enjoy!' })).ok, true);
  // A FULL code (not Owner Access) still can't gift cards above 99; the owner ACCOUNT can (009), without any code.
  const F = mk3(be);
  await F.admin.verifyLevel('full-code-1');
  assert.equal((await F.owner.gift({ to: b.id, kind: 'card', card: { id: 'adm1', name: 'Admin Guy', ovr: 500, untradable: true } })).error, 'needs_super');
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

test('card creator gift: a created card (photo, OVR 500) sent by username lands in the receiver club, tradable, after reload too', async () => {
  const { be, B, O, b } = await world3();
  const X = mk3(be);
  await X.admin.verifyLevel('super-code-1');
  const photo = `data:image/webp;base64,${'QUJD'.repeat(15000)}`;
  const created = {
    id: 'admin_1700000000000_0', name: 'Zed Custom', last: 'Custom', pos: 'ST', alt: ['CF'], nat: 'ENG', club: 'FUT', tier: 'icon', special: 'hero',
    customAdmin: true, photo, tradable: true, playstyles: Array.from({ length: 20 }, (_, i) => ({ id: `ps${i}`, plus: i % 2 === 0 })),
    stats: { pac: 500, sho: 500, pas: 400, dri: 450, def: 100, phy: 300 }, ovr: 500, createdAt: 1,
  };
  assert.equal((await X.players.resolve('nobody here')).error, 'player_not_found');
  const who = await X.players.resolve('bob jones');
  assert.equal(who.id, b.id);
  assert.equal((await X.players.resolve(b.id)).id, b.id);
  const payload = giftPayloadCard(created);
  assert.equal(payload.photo, photo);
  const F = mk3(be);
  await F.admin.verifyLevel('full-code-1');
  assert.equal((await F.owner.gift({ to: who.id, kind: 'card', card: payload })).error, 'needs_super'); // FULL code: OVR > 99 needs Owner Access
  const sent = await X.owner.gift({ to: who.id, kind: 'card', card: payload, minutes: 60 });
  assert.equal(sent.ok, true);
  const g = (await B.gifts.inbox()).items.find((x) => x.kind === 'card');
  assert.equal(g.card.photo, photo);
  const c = await B.gifts.claim(g.id);
  assert.equal(c.ok, true);
  const state = UT.createUTState();
  state.untradeable.push(created.id);
  const r = receiveCard(state, c.card);
  assert.deepEqual([r.ok, r.duplicate], [true, false]);
  assert.ok(state.club.includes(created.id));
  assert.equal(isTradeable(state, created.id), true);
  const p = getPlayer(created.id);
  assert.deepEqual([p.ovr, p.stats.pac, p.photo === photo, p.tier, p.special, p.playstyles.length, p.customAdmin], [500, 500, true, 'icon', 'hero', 20, true]);
  // the UT save keeps the full card: a fresh load (migrateUT) resolves it again
  const saved = JSON.parse(JSON.stringify(state));
  getDB().byId.delete(created.id);
  assert.equal(getPlayer(created.id), null);
  const again = UT.migrateUT(saved);
  assert.ok(again.club.includes(created.id));
  assert.equal(getPlayer(created.id).ovr, 500);
  assert.equal(receiveCard(again, c.card).duplicate, true);
  // a database card gift arrives by id (compact payload) and lands in the club too
  const dbCard = getDB().all.find((x) => x.ovr < 90 && !state.club.includes(x.id));
  const g2 = await X.owner.gift({ to: b.id, kind: 'card', card: giftPayloadCard(dbCard) });
  assert.equal(g2.ok, true);
  const c2 = await B.gifts.claim((await B.gifts.inbox()).items.find((x) => x.kind === 'card').id);
  assert.equal(receiveCard(again, c2.card).pid, dbCard.id);
  assert.ok(again.club.includes(dbCard.id));
  // a bad photo is rejected by the server
  assert.equal((await X.owner.gift({ to: b.id, kind: 'card', card: { ...payload, id: 'admin_2', photo: 'data:text/html;base64,AAAA' } })).ok, true); // client drops a bad photo
  assert.equal((await be.call('admin_gift', { p_code: 'super-code-1', p_to: b.id, p_all: false, p_kind: 'card', p_payload: { card: { id: 'x1', name: 'X', ovr: 50, photo: 'javascript:1' } } })).data.error, 'bad_card');
  assert.equal(registerCustomCard(null, { id: 'bad id', name: 'X', pos: 'ST', ovr: 50 }), null);
});

test('owner/mod actions take a username or friend code (resolved to the id), never bad_target', async () => {
  const { A, B, O, a, b } = await world3();
  const bFc = (await A.players.find('bob jones')).items[0].friendCode;
  assert.equal((await O.owner.giveCoins('bob jones', 500)).ok, true);
  assert.equal((await B.coins.get()).coins, 5500);
  assert.equal((await O.owner.gift({ to: 'Bob_Jones', kind: 'coins', coins: 5 })).ok, true);
  assert.equal((await O.owner.gift({ to: bFc, kind: 'coins', coins: 5 })).ok, true);
  assert.equal((await O.owner.gift({ to: '', kind: 'coins', coins: 5 })).error, 'bad_target');
  assert.equal((await O.owner.gift({ to: 'ghost player', kind: 'coins', coins: 5 })).error, 'player_not_found');
  assert.equal((await O.moderation.setRole('alice smith', 'mod')).player.role, 'mod');
  assert.equal((await O.moderation.adjustCoins(bFc, -100, 'test')).coins, 5400);
  assert.equal((await O.moderation.ban('Bob Jones', 'spam')).ok, true);
  assert.equal((await O.moderation.unban('bob jones')).ok, true); // banned players still resolve (staff search)
  assert.equal((await O.owner.reset('bob jones', 'coins')).ok, true);
  assert.equal((await O.moderation.player('alice smith')).player.id, a.id);
  assert.equal((await O.moderation.ban('nobody at all', 'x')).error, 'player_not_found');
  assert.equal((await O.owner.giveCoins(b.id, 1)).ok, true); // ids still work
});

test('names: accounts are shown by username everywhere (friends, market seller, queue, players), set_name cannot hide it', async () => {
  const { be, A, B, a, b } = await world3();
  assert.equal((await A.setName('Totally Else')).name, 'Alice Smith');
  const fc = (await A.players.find('bob jones')).items[0].friendCode;
  const add = await A.friends.add(fc);
  assert.equal(add.ok, true);
  await B.friends.respond(a.id, 'accept');
  const fl = await A.friends.list();
  const bob = fl.items.find((f) => f.id === b.id);
  assert.deepEqual([bob.name, bob.username], ['Bob Jones', 'Bob Jones']);
  const l = await B.market.list(card({ id: 'nm1' }), 1000);
  assert.equal(l.ok, true);
  const s = await A.market.search({});
  assert.equal(s.items.find((x) => x.listingId === l.listingId).seller, 'Bob Jones');
  assert.equal((await B.profile()).name, 'Bob Jones');
});

test('gifts: owner lists pending gifts, cancels one, clears all; expiry picker bounds', async () => {
  const { A, B, O, b } = await world3();
  assert.equal((await O.owner.gift({ to: b.id, kind: 'coins', coins: 10, minutes: 0 })).error, 'bad_value');
  const g1 = await O.owner.gift({ to: b.id, kind: 'coins', coins: 10, minutes: 30 });
  assert.ok(Date.parse(g1.until) - Date.now() <= 30 * 60000 + 5000);
  await O.owner.gift({ to: 'all', kind: 'pack', packId: 'gold' });
  assert.equal((await A.owner.gifts()).error, 'not_admin');
  const list = await O.owner.gifts();
  assert.equal(list.items.length, 2);
  assert.equal(list.items.find((x) => x.kind === 'coins').to.username, 'Bob Jones');
  assert.equal((await O.owner.cancelGift(g1.giftId)).ok, true);
  assert.equal((await B.gifts.claim(g1.giftId)).error, 'expired');
  assert.equal((await B.gifts.inbox()).items.length, 1);
  assert.equal((await O.owner.clearGifts()).cancelled, 1);
  assert.equal((await B.gifts.inbox()).items.length, 0);
  assert.equal((await O.owner.gifts()).items.length, 0);
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
  assert.equal((await A.account.changeUsername({ username: 'Bob_Jones', password: 'Pitch-pass1' })).error, 'username_taken');
  assert.equal((await A.account.changeUsername({ username: 'Shawky FC 2', password: 'Pitch-pass1' })).error, 'reserved_username');
  const r = await A.account.changeUsername({ username: 'Alicia', password: 'Pitch-pass1' });
  assert.equal(r.ok, true);
  assert.equal(A.account.current().username, 'Alicia');
  const A2 = mk3(be);
  assert.equal((await A2.account.login({ username: 'alicia', password: 'Pitch-pass1' })).id, a.id);
  assert.equal((await A.account.changePassword({ password: 'Pitch-pass1', newPassword: 'Pitch-pass7', confirm: 'nope' })).error, 'password_mismatch');
  assert.equal((await A.account.changePassword({ password: 'Pitch-pass1', newPassword: 'Pitch-pass7', confirm: 'Pitch-pass7' })).ok, true);
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
  assert.equal(AA.getAdminLevel(), 'super'); // 009: owner account = Owner Access, no code needed
  AA.setAdminSessionLevel('temp');
  assert.equal(AA.getAdminLevel(), 'super');
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
  await A.account.signup({ username: 'Old Timer', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
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
  await N.account.signup({ username: 'New Comer', password: 'Pitch-pass2', confirm: 'Pitch-pass2' });
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
  await A1.account.signup({ username: 'Cloud Guy', password: 'Pitch-pass1', confirm: 'Pitch-pass1' });
  assert.equal((await c1.syncNow()).action, 'uploaded');
  d2.setItem('pitchside.ut', JSON.stringify({ club: ['other'] }));
  await A2.account.login({ username: 'cloud guy', password: 'Pitch-pass1' });
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

// ------------------------------------------------------------------ 007: owner control panel
test('owner panel: every player (guests too) with full info; coins beyond 1e9; username; admin give/revoke/revoke-all', async () => {
  const { be, A, B, O, a, b, o } = await world3();
  const G = mk3(be);
  assert.equal((await G.profile()).ok, true); // a device guest
  const all = await O.owner.allPlayers();
  assert.equal(all.total, 4);
  const guest = all.items.find((x) => !x.account);
  assert.ok(guest && guest.username === null && guest.coins === 5000 && guest.rating === 1000);
  assert.equal(all.items.find((x) => x.id === b.id).username, 'Bob Jones');
  assert.equal((await A.owner.allPlayers()).error, 'not_admin');
  // coins: huge grants land exactly (safe integers), over the bound is refused, never NaN
  assert.equal((await O.owner.giveCoins(b.id, 5e15)).coins, 5e15 + 5000);
  assert.equal((await O.owner.giveCoins(b.id, 9e15 + 2)).error, 'bad_amount');
  assert.equal((await O.owner.giveCoins(b.id, 5e15)).coins, 9e15); // clamped at the safe max
  assert.equal((await O.owner.giveCoins(b.id, -9e15)).coins, 0);
  // username + roles
  assert.equal((await O.owner.setUsername('bob jones', 'Robert J')).player.username, 'Robert J');
  assert.equal((await O.owner.setUsername(b.id, 'Alice Smith')).error, 'username_taken');
  assert.equal((await O.owner.setUsername(guest.id, 'Guesty')).error, 'no_account');
  assert.equal((await O.owner.giveAdmin(a.id)).player.role, 'mod');
  assert.equal((await O.owner.revokeAdmin(a.id)).player.role, 'player');
  await O.owner.giveAdmin(a.id);
  const X = mk3(be);
  await X.admin.verifyLevel('full-code-1'); // an admin code session (token)
  assert.equal((await X.owner.listPlayers()).ok, true);
  const rv = await O.owner.revokeAllAdmin();
  assert.deepEqual([rv.ok, rv.revoked], [true, 1]); // Alice's mod role (the owner account keeps its role)
  be.call('noop');
  assert.equal((await X.owner.listPlayers()).error, 'not_admin'); // old token revoked...
  const Y = mk3(be);
  assert.equal((await Y.admin.verifyLevel('full-code-1')).ok, true); // ...the code still works for a new session
  const rv2 = await Y.owner.revokeAllAdmin();
  assert.equal((await Y.owner.listPlayers()).ok, true); // the caller got a fresh token back
  assert.equal(rv2.ok, true);
  void o;
});

test('owner panel: restrictions (market, messages, codes, admin) are enforced server- and client-side; timeouts; DMs; admins list at any price', async () => {
  const { be, A, B, O, a, b } = await world3();
  assert.equal((await O.owner.restrict(b.id, 'market', { minutes: 60 })).restrictions.market.length > 10, true);
  assert.equal((await B.market.list(card({ id: 'r1' }), 1000)).error, 'restricted'); // server (client did not know yet)
  await B.presence.tick();
  assert.equal(B.admin.restricted('market'), true);
  assert.equal((await B.market.buy(UUID)).error, 'restricted'); // client-side now
  assert.equal((await O.owner.restrict(b.id, 'market', { on: false })).restrictions.market, undefined);
  await B.presence.tick();
  assert.equal((await B.market.list(card({ id: 'r1' }), 1000)).ok, true);
  await O.owner.restrict(b.id, 'messages');
  assert.equal((await B.messages.send(a.id, 'hi')).error, 'restricted');
  assert.equal((await O.owner.message(b.id, 'Please behave')).ok, true); // owner DM still reaches them
  const conv = await B.messages.conversations();
  assert.equal(conv.items[0].with.id, (await O.profile()).id);
  // codes / admin
  be.setRole(a.id, 'mod');
  await O.owner.restrict(a.id, 'admin');
  assert.equal((await A.moderation.search('bob')).error, 'not_admin'); // staff powers gone server-side
  await A.presence.tick();
  assert.equal(A.admin.canOwner(), false);
  assert.equal((await A.admin.verifyLevel('full-code-1')).error, 'restricted');
  assert.equal((await O.owner.restrict(o_id(await O.profile()), 'market')).error, 'not_allowed'); // never yourself
  // timeout = timed ban
  const t = await O.moderation.ban(b.id, 'cool down', new Date(Date.now() + 3600000));
  assert.equal(t.ok, true);
  assert.equal((await B.coins.get()).error, 'banned');
  await O.moderation.unban(b.id);
  // admins may list at ANY price (and players may not)
  const ownerList = await O.market.list(card({ id: 'cheap1' }), 1);
  assert.equal(ownerList.ok, true);
  assert.equal((await B.market.list(card({ id: 'cheap2' }), 1)).error, 'bad_price');
  const big = await O.market.list(card({ id: 'dear1' }), 5e12);
  assert.equal(big.ok, true);
  const found = (await B.market.search({})).items.map((x) => x.price);
  assert.ok(found.includes(1) && found.includes(5e12));
});
const o_id = (p) => p.id;

test('online team: card view + admin / secret tiers survive sanitizeTeam; data-URL photos and junk are dropped', () => {
  const mkP = (i, extra = {}) => ({ id: `x${i}`, name: `P${i}`, number: i + 1, pos: i ? 'CM' : 'GK', ovr: 99, attrs: {}, ...extra });
  const players = Array.from({ length: 11 }, (_, i) => mkP(i));
  players[1] = mkP(1, { rawOvr: 999, card: { name: 'Pain Man', ovr: 999, customAdmin: true, special: 'hero', photo: 'data:image/png;base64,AAAA', stats: { pac: 999 }, evil: 'yes', onclick: 'x' } });
  players[2] = mkP(2, { glitch: true, card: { name: 'The Shawky', last: 'Shawky', ovr: 999, glitch: true, photo: 'assets/cards/oelke.webp', photoCut: true } });
  players[3] = mkP(3, { cursed: true, rawOvr: 5000, card: { name: '' } });
  const t = sanitizeTeam({ name: 'T', players }, 'g');
  assert.equal(t.players[1].rawOvr, 999);
  assert.equal(t.players[1].card.ovr, 999);
  assert.equal(t.players[1].card.customAdmin, true);
  assert.equal(t.players[1].card.photo, undefined, 'no data URLs over the wire');
  assert.equal(t.players[1].card.evil, undefined);
  assert.equal(t.players[1].card.onclick, undefined);
  assert.equal(t.players[1].card.stats.pac, 999);
  assert.equal(t.players[2].glitch, true);
  assert.equal(t.players[2].card.photo, 'assets/cards/oelke.webp');
  assert.equal(t.players[3].cursed, true);
  assert.equal(t.players[3].rawOvr, 999, 'clamped');
  assert.equal(t.players[3].card, undefined, 'a nameless card view is dropped');
  assert.equal(t.players[0].card, undefined);
});

test('owner pokes: an owner write wakes that player at once (no waiting for the next check-in); reads do not poke', async () => {
  const be = createMockBackend(memoryStore());
  be.setAdminCodes({ full: 'full-code-1', super: 'super-code-1' });
  const bus = new Set(); const sent = [];
  const pokes = (onPoke) => { bus.add(onPoke); return Promise.resolve({ send(to) { sent.push(to); for (const f of bus) if (f !== onPoke) f({ to }); }, close() { bus.delete(onPoke); } }); };
  const extra = { pokes, presenceMs: 600000 };
  const B = mk3(be, { extra }), O = mk3(be, { extra });
  const b = await B.account.signup({ username: 'Bob Jones', password: 'Pitch-pass2', confirm: 'Pitch-pass2' });
  await O.account.signup({ username: 'Shawky Fc', password: 'Pitch-pass9', confirm: 'Pitch-pass9', adminCode: 'super-code-1' });
  B.presence.start(); O.presence.start();
  await new Promise((r) => setTimeout(r, 1700)); // poke channel joins 1.5 s after start
  assert.equal(bus.size, 2);
  await B.presence.tick();
  assert.equal(B.presence.last.unread, 0);
  await O.owner.players();
  assert.deepEqual(sent, [], 'reads never poke');
  assert.equal((await O.owner.message(b.id, 'Hello from the owner')).ok, true);
  assert.deepEqual(sent, [b.id]);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(B.presence.last.unread, 1, 'B checked in right after the poke');
  B.presence.stop(); O.presence.stop();
  assert.equal(bus.size, 0);
});

test('realtime backlog: snapshots / inputs are dropped while a data channel still has unsent data', () => {
  assert.equal(backlogged({ dataChannel: { bufferedAmount: 0 }, bufferSize: 0 }), false);
  assert.equal(backlogged({ dataChannel: { bufferedAmount: RT_BACKLOG_BYTES + 1 }, bufferSize: 0 }), true);
  assert.equal(backlogged({ dataChannel: { bufferedAmount: 10 }, bufferSize: 3 }), true, "PeerJS's own queue counts too");
  assert.equal(backlogged({}), false);
});

test('owner panel: club edits go through owner patches the player applies + acks (add, edit any field, tradable, remove, reset objectives); guests have cloud saves', async () => {
  const { be, B, O, b } = await world3();
  const { createCloudSync } = await import('../cloudsave.js');
  // a guest's club is uploaded too (owner can see it)
  const gDisk = memStorage();
  const G = mk3(be, { storage: gDisk });
  await G.profile();
  gDisk.setItem('pitchside.ut', JSON.stringify({ club: ['p1', 'p2'], coins: 700 }));
  const gs = createCloudSync(G, { storage: gDisk });
  assert.equal((await gs.syncNow()).action, 'uploaded');
  gDisk.setItem('pitchside.ut', JSON.stringify({ club: ['p1', 'p2', 'p3'], coins: 700 }));
  assert.equal((await gs.syncNow()).action, 'uploaded');
  const gd = await O.owner.playerDetail((await G.profile()).id);
  assert.deepEqual(gd.save.data.club, ['p1', 'p2', 'p3']);
  // B's club: owner queues edits
  const state = UT.createUTState();
  const dbCard = getDB().all.find((x) => x.ovr < 80 && !state.club.includes(x.id));
  const victim = state.club.find((id) => !state.squad.slots.includes(id));
  const keep = state.club.find((id) => id !== victim);
  const custom = { id: 'admin_77_1', name: 'Gift Guy', pos: 'CM', ovr: 88, customAdmin: true, stats: { pac: 88, sho: 88, pas: 88, dri: 88, def: 88, phy: 88 } };
  const ops = [
    { op: 'addCard', card: giftPayloadCard(dbCard) },
    { op: 'addCard', card: giftPayloadCard(custom), untradeable: true },
    { op: 'editCard', id: keep, fields: { name: 'Edited Name', ovr: 99, stats: { pac: 99 }, special: 'hero', tradable: false } },
    { op: 'removeCard', id: victim },
    { op: 'resetObjectives' },
    { op: 'setClubName', name: 'Owner FC' },
  ];
  assert.equal((await O.owner.patchPlayer(b.id, [{ op: 'hack' }])).error, 'bad_value');
  assert.equal((await O.owner.patchPlayer('bob jones', ops)).ok, true);
  assert.equal((await B.presence.tick()).patches, 1);
  state.obj = { x: 1 };
  const pend = await B.patches.pending();
  const res = applyOwnerPatches(state, pend.items);
  assert.equal(res.applied.length, 1);
  assert.ok(state.club.includes(dbCard.id) && state.club.includes(custom.id) && !state.club.includes(victim));
  assert.equal(isTradeable(state, custom.id), false);
  assert.equal(isTradeable(state, dbCard.id), true);
  assert.deepEqual([getPlayer(keep).name, getPlayer(keep).ovr, getPlayer(keep).stats.pac, getPlayer(keep).special, isTradeable(state, keep)], ['Edited Name', 99, 99, 'hero', false]);
  assert.deepEqual([state.obj, state.clubName], [{}, 'Owner FC']);
  assert.equal((await B.patches.ack(res.applied)).acked, 1);
  assert.equal((await B.patches.pending()).items.length, 0);
  assert.equal((await O.owner.playerDetail(b.id)).patches.length, 0);
  // the edit survives a reload (state.cardEdits re-applied on load)
  const again = UT.migrateUT(JSON.parse(JSON.stringify(state)));
  assert.equal(getPlayer(keep).name, 'Edited Name');
  assert.ok(again.club.includes(custom.id));
});

// ------------------------------------------------------------------ 019: owner resets / deletes / removals reach the device and stick
// Each "device" = its own storage (identity + local club, the way the game uses localStorage). remote.js and the UT
// save read the global localStorage, so `dev.as(fn)` swaps it while that device acts.
const lsShim = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
async function withRemote(fn) {
  const R = await import('../../meta/core/remote.js');
  const W = await import('../../meta/core/wipe.js');
  const { createCloudSync } = await import('../cloudsave.js');
  const prev = globalThis.localStorage;
  try { return await fn({ R, W, createCloudSync }); } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
}
/** A device of `be`: online client + its own disk + cloud sync wired like main.js (beforeSync applies remote commands, afterSync acks). */
function mkDevice(be, { R, W, createCloudSync }, { rpc = null } = {}) {
  const disk = lsShim();
  const on = createOnline({ rpc: rpc || ((f, a) => be.call(f, a)), storage: disk, volatileStorage: lsShim(), transportKind: 'loopback' });
  const dev = { disk, on, deleted: [] };
  dev.as = async (fn) => { const p = globalThis.localStorage; globalThis.localStorage = disk; try { return await fn(); } finally { globalThis.localStorage = p; } };
  dev.ut = () => dev.as(() => UT.loadUT());
  dev.putUT = (st) => dev.as(() => UT.saveUT(st));
  dev.remote = (o = {}) => dev.as(async () => {
    const st = UT.loadUT();
    return R.syncRemote({ online: on, state: st, cloud: true, persist: () => (st ? UT.saveUT(st) : true), ...o });
  });
  dev.cloud = createCloudSync(on, { storage: disk, beforeSync: () => dev.remote(), afterSync: (r) => dev.as(() => R.flushAcks(on, r)) });
  dev.sync = () => dev.as(() => dev.cloud.syncNow());
  // main.js: the moment the profile is reported deleted, the local club is wiped synchronously
  on.account.onDeleted(() => { dev.deleted.push(1); const p = globalThis.localStorage; globalThis.localStorage = disk; try { W.wipeLocalProfile(); R.forgetPendingAcks(); } finally { globalThis.localStorage = p; } });
  return dev;
}

test('019 owner reset club/progress/coins/all reaches the player, once, and is not undone by the next sync', async () => {
  await withRemote(async (ctx) => {
    const { R } = ctx;
    const { be, O, b } = await world3();
    const D = mkDevice(be, ctx);
    await D.on.account.login({ username: 'Bob Jones', password: 'Pitch-pass2' });
    const st = UT.createUTState();
    st.coins = 777; st.stats.matches = 9; st.stats.wins = 4; st.obj = { x: 1 }; st.sbc = { s: 1 }; st.rivals = { division: 3 };
    await D.putUT(st);
    // first sight of the profile: epochs are only recorded, nothing is reset
    const first = await D.remote();
    assert.equal(first.first, true);
    assert.deepEqual(first.resets, []);
    assert.equal((await D.ut()).coins, 777);
    assert.equal((await D.sync()).action, 'uploaded');
    assert.deepEqual((await O.owner.playerDetail(b.id)).save.data.club, st.club);
    assert.deepEqual((await D.remote()).resets, []); // nothing new: nothing happens
    // --- club reset
    assert.equal((await O.owner.reset(b.id, 'club')).ok, true);
    assert.equal((await O.owner.playerDetail(b.id)).save.exists, false, 'the server copy of the club is gone');
    const r1 = await D.remote();
    assert.deepEqual(r1.resets, ['club']);
    assert.deepEqual(r1.notices, ['An admin reset your club.']);
    const fresh = await D.ut();
    assert.notDeepEqual(fresh.club, st.club);
    assert.equal(fresh.coins, 777, 'club reset keeps coins');
    assert.equal(fresh.stats.matches, 9, 'club reset keeps progress');
    // the next sync uploads the FRESH club (never the old one); later syncs / check-ins neither undo nor repeat it
    assert.equal((await D.sync()).action, 'uploaded');
    assert.deepEqual((await O.owner.playerDetail(b.id)).save.data.club, fresh.club);
    assert.deepEqual((await D.remote()).resets, []);
    assert.deepEqual((await D.ut()).club, fresh.club);
    // --- progress reset
    assert.equal((await O.owner.reset(b.id, 'progress')).ok, true);
    assert.deepEqual((await D.remote()).resets, ['progress']);
    const p = await D.ut();
    assert.deepEqual([p.stats.matches, p.stats.wins, p.obj, p.sbc, p.rivals, p.coins, p.club], [0, 0, {}, {}, undefined, 777, fresh.club]);
    // --- coins reset (server wallet 5000; the local balance follows)
    assert.equal((await O.owner.reset(b.id, 'coins')).ok, true);
    assert.deepEqual((await D.remote()).resets, ['coins']);
    assert.equal((await D.ut()).coins, 5000);
    // --- everything
    const s2 = await D.ut(); s2.stats.matches = 5; s2.obj = { y: 2 }; s2.coins = 123; await D.putUT(s2);
    assert.equal((await D.sync()).ok, true);
    assert.equal((await O.owner.reset(b.id, 'all')).ok, true);
    const r4 = await D.remote();
    assert.deepEqual(r4.resets, ['coins', 'progress', 'club']);
    assert.deepEqual(r4.notices, ['An admin reset your account.']);
    const s3 = await D.ut();
    assert.deepEqual([s3.stats.matches, s3.obj, s3.coins], [0, {}, 5000]);
    assert.notDeepEqual(s3.club, fresh.club);
    assert.equal((await D.sync()).action, 'uploaded');
    assert.deepEqual((await O.owner.playerDetail(b.id)).save.data.club, s3.club);
    assert.equal(R.resetMessage(['progress', 'coins']), 'An admin reset your progress and coins.');
  });
});

test('019 a stale device that plays on after an owner club reset applies it before uploading (the old club never comes back)', async () => {
  await withRemote(async (ctx) => {
    const { be, O, b } = await world3();
    const D = mkDevice(be, ctx);
    await D.on.account.login({ username: 'Bob Jones', password: 'Pitch-pass2' });
    const st = UT.createUTState(); await D.putUT(st);
    await D.remote(); await D.sync();
    const oldClub = [...st.club];
    assert.equal((await O.owner.reset(b.id, 'club')).ok, true);
    // the player plays a match before the next check-in (the local save changes) and the cloud sync fires
    const s = await D.ut(); s.coins += 100; s.stats.matches++; await D.putUT(s);
    assert.equal((await D.sync()).ok, true);
    const server = (await O.owner.playerDetail(b.id)).save;
    assert.equal(server.exists, true);
    assert.notDeepEqual(server.data.club, oldClub, 'the old club did not come back');
    assert.deepEqual(server.data.club, (await D.ut()).club);
  });
});

test('019 first sight of a profile only records the epochs: new devices and new logins are never reset by old epochs', async () => {
  await withRemote(async (ctx) => {
    const { R } = ctx;
    const { be, O, b } = await world3();
    assert.equal((await O.owner.reset(b.id, 'all')).ok, true); // long before this device ever saw the account
    assert.equal((await O.owner.reset(b.id, 'club')).ok, true);
    const D = mkDevice(be, ctx);
    const st = UT.createUTState(); st.coins = 4242; await D.putUT(st);
    await D.on.account.login({ username: 'Bob Jones', password: 'Pitch-pass2' });
    const r = await D.remote();
    assert.deepEqual([r.first, r.resets, r.notices], [true, [], []]);
    assert.equal((await D.ut()).coins, 4242);
    assert.deepEqual((await D.ut()).club, st.club);
    assert.deepEqual(await D.as(() => R.readSeenEpochs(b.id)), { coins: 1, progress: 1, club: 2 });
    // ...but a reset issued afterwards does apply
    assert.equal((await O.owner.reset(b.id, 'coins')).ok, true);
    assert.deepEqual((await D.remote()).resets, ['coins']);
    assert.equal((await D.ut()).coins, 5000);
    // a brand new account starts at epoch 0 and is unaffected
    const N = mkDevice(be, ctx);
    await N.on.account.signup({ username: 'Newbie One', password: 'Pitch-pass3', confirm: 'Pitch-pass3' });
    const n = UT.createUTState(); n.coins = 10000; await N.putUT(n);
    assert.deepEqual([(await N.remote()).first, (await N.ut()).coins], [true, 10000]);
    // the anonymous fallback check-in (no identity) carries no epochs and is never read as "0, 0, 0"
    const anon = createOnline({ rpc: (f, a) => be.call(f, a), storage: lsShim(), volatileStorage: lsShim(), transportKind: 'loopback' });
    assert.equal((await anon.presence.tick()).hasResets, false);
  });
});

test('019 owner deletes a player: the device forgets its identity and wipes its club instead of re-registering with it', async () => {
  await withRemote(async (ctx) => {
    const { R } = ctx;
    const { be, O } = await world3();
    // a guest device with a club
    const G = mkDevice(be, ctx);
    const gp = await G.on.profile();
    assert.equal(gp.ok, true);
    await G.putUT(UT.createUTState());
    await G.remote(); assert.equal((await G.sync()).action, 'uploaded');
    const before = (await O.owner.allPlayers()).total;
    assert.equal((await O.owner.deletePlayer(gp.id)).ok, true);
    assert.equal((await O.owner.allPlayers()).total, before - 1);
    assert.equal((await O.owner.playerDetail(gp.id)).ok, false, 'no profile, no save');
    assert.equal((await be.call('identity_state', { p_id: gp.id })).data.exists, false);
    // the next check-in: the server answers "auth", identity_state says "deleted"
    await G.as(() => G.on.presence.tick());
    assert.equal(G.deleted.length, 1);
    assert.equal(G.on.hasIdentity(), false);
    assert.equal(await G.ut(), null, 'local club wiped');
    assert.equal(G.disk.getItem('pitchside.ut.cloud'), null);
    // nothing re-registers or re-uploads: the profile count does not grow, further calls are quiet
    const after = (await O.owner.allPlayers()).total;
    assert.equal((await G.sync()).ok, false);
    await G.as(() => G.on.presence.tick());
    assert.equal((await O.owner.allPlayers()).total, after);
    assert.equal(G.deleted.length, 1, 'fires once');
    // an ACCOUNT device: logged out and wiped too, with the message
    const A = mkDevice(be, ctx);
    const login = await A.on.account.login({ username: 'Alice Smith', password: 'Pitch-pass1' });
    await A.putUT(UT.createUTState()); await A.remote(); await A.sync();
    assert.equal((await O.owner.deletePlayer(login.id)).ok, true);
    const pr = await A.as(() => A.on.profile());
    assert.equal(pr.error, 'deleted');
    assert.equal(pr.message, 'Your account was deleted by an admin.');
    assert.equal(A.on.account.current().state, 'none');
    assert.equal(await A.ut(), null);
    assert.equal(A.deleted.length, 1);
    assert.equal(await A.as(() => R.readSeenEpochs(login.id)), null);
  });
});

test('019 a network error or an expired session does NOT wipe anything', async () => {
  await withRemote(async (ctx) => {
    const { be, O } = await world3();
    // (1) profile deleted, but the identity_state check cannot be answered (network): nothing changes
    let blockCheck = true;
    const flaky = (f, args) => (f === 'identity_state' && blockCheck ? { ok: false, error: 'offline' } : be.call(f, args));
    const D = mkDevice(be, ctx, { rpc: flaky });
    const login = await D.on.account.login({ username: 'Bob Jones', password: 'Pitch-pass2' });
    await D.putUT(UT.createUTState());
    assert.equal((await O.owner.deletePlayer(login.id)).ok, true);
    const r = await D.as(() => D.on.profile());
    assert.equal(r.error, 'offline');
    assert.equal(D.on.account.current().state, 'account', 'still logged in: we could not tell');
    assert.notEqual(await D.ut(), null);
    assert.equal(D.deleted.length, 0);
    blockCheck = false; // the network is back: now it is known
    assert.equal((await D.as(() => D.on.profile())).error, 'deleted');
    assert.equal(D.deleted.length, 1);
    // (2) the whole server is unreachable
    const E = mkDevice(be, ctx);
    await E.on.account.login({ username: 'Alice Smith', password: 'Pitch-pass1' });
    await E.putUT(UT.createUTState());
    be.down = true;
    await E.as(() => E.on.presence.tick());
    be.down = false;
    assert.equal(E.on.account.current().state, 'account');
    assert.notEqual(await E.ut(), null);
    // (3) expired / revoked session (the profile still exists): the old behaviour, the club stays on the device
    const other = mkDevice(be, ctx);
    await other.on.account.login({ username: 'Alice Smith', password: 'Pitch-pass1' });
    await other.on.account.logout({ all: true }); // ends every session of Alice on the server
    const pr = await E.as(() => E.on.profile());
    assert.equal(pr.error, 'auth');
    assert.equal(E.on.account.current().state, 'none', 'logged out as before');
    assert.notEqual(await E.ut(), null, 'but the local club is kept');
    assert.equal(E.deleted.length, 0);
  });
});

test('019 removeCard removes the card everywhere (club, squad, saved squads, saved list, vault, pending pack, transfer list, market records) and is idempotent', () => {
  const state = UT.createUTState();
  const victim = state.club.find((id) => state.squad.slots.includes(id));
  const other = state.club.find((id) => id !== victim && !state.squad.slots.includes(id));
  state.saved = [victim, other, victim];
  state.vault = [victim, other];
  state.pendingPack = [victim];
  state.transferList = [victim];
  state.untradeable = [victim];
  state.forcedPulls = [victim];
  state.listed = [{ listingId: 'l1', pid: victim, price: 500, status: 'active' }, { listingId: 'l2', pid: other, price: 500, status: 'active' }];
  state.squads = [{ name: 'Squad 1', squad: null }, { name: 'B', squad: { formation: '4-3-3', slots: [...state.squad.slots], bench: [victim, null, null, null, null, null, null] } }];
  const patch = { id: 7, ops: [{ op: 'removeCard', id: victim }, { op: 'removeCard', id: 'not_a_card' }, { op: 'removeCard', id: 'bad id!' }] };
  const r1 = applyOwnerPatches(state, [patch]);
  assert.deepEqual(r1.applied, [7]);
  assert.equal(JSON.stringify(state).split(`"${victim}"`).length - 1, 0, 'no trace of the card is left in the save');
  assert.ok(state.club.length > 5 && state.vault.includes(other) && state.saved.includes(other) && state.listed.length === 1);
  // loading the save again keeps it removed; "claim all saved" cannot bring it back
  const again = UT.migrateUT(JSON.parse(JSON.stringify(state)));
  UT.claimAllSaved(again);
  assert.equal(again.club.includes(victim), false);
  // the same patch delivered again (its ack was lost) changes nothing
  const snap = JSON.stringify(state);
  const r2 = applyOwnerPatches(state, [patch]);
  assert.deepEqual([r2.applied, r2.changed, JSON.stringify(state)], [[7], 0, snap]);
  // ...and a resetClub patch is never replayed over what the player did since
  applyOwnerPatches(state, [{ id: 8, ops: [{ op: 'resetClub' }] }]);
  state.coins = 4321; state.club.push('___bought');
  applyOwnerPatches(state, [{ id: 8, ops: [{ op: 'resetClub' }] }]);
  assert.ok(state.club.includes('___bought'), 'the second delivery of patch 8 did not wipe the club again');
  assert.equal(state.coins, 4321);
});

test('019 owner removeCard end to end: applied before the upload, acknowledged only once the patched club is on the server, survives a download of an older server copy', async () => {
  await withRemote(async (ctx) => {
    const { R } = ctx;
    const { be, O, b } = await world3();
    const D1 = mkDevice(be, ctx);
    await D1.on.account.login({ username: 'Bob Jones', password: 'Pitch-pass2' });
    const st = UT.createUTState();
    const victim = st.club.find((id) => st.squad.slots.includes(id));
    st.saved = [victim]; st.vault = [victim];
    await D1.putUT(st);
    await D1.remote(); await D1.sync();
    assert.ok((await O.owner.playerDetail(b.id)).save.data.club.includes(victim));
    // a second device of the same account, in sync with the server
    const D2 = mkDevice(be, ctx);
    await D2.on.account.login({ username: 'Bob Jones', password: 'Pitch-pass2' });
    await D2.remote(); assert.equal((await D2.sync()).action, 'downloaded');
    assert.deepEqual((await D2.ut()).club, st.club);
    // the owner removes the card; D2 plays and syncs first: the patch is applied BEFORE its upload and acknowledged after it
    assert.equal((await O.owner.patchPlayer(b.id, [{ op: 'removeCard', id: victim }])).ok, true);
    const s2 = await D2.ut(); s2.coins += 5; await D2.putUT(s2);
    assert.equal((await D2.sync()).action, 'uploaded');
    const det = await O.owner.playerDetail(b.id);
    assert.equal(det.patches.length, 0);
    assert.equal(JSON.stringify(det.save.data).includes(`"${victim}"`), false, 'gone from club, squad, saved cards and vault on the server');
    // D1 (stale) plays on: its upload conflicts and the server copy (already patched) replaces it
    const s1 = await D1.ut(); s1.coins += 1; await D1.putUT(s1);
    assert.equal((await D1.sync()).action, 'downloaded');
    const c1 = await D1.ut();
    assert.equal(JSON.stringify(c1).includes(`"${victim}"`), false);
    // --- the risky order: an OLD client (no remote step) uploads a copy that still has the next card, D1 applies the
    // patch locally, but its upload loses to that newer server copy: the patch must not be acknowledged, then re-applies
    const victim2 = c1.club.find((id) => id !== victim && !c1.squad.slots.includes(id));
    assert.equal((await O.owner.patchPlayer(b.id, [{ op: 'removeCard', id: victim2 }])).ok, true);
    const s3 = await D2.ut(); s3.stats.matches += 1; await D2.putUT(s3);
    const oldClient = createCloudSyncFor(D2);
    assert.equal((await D2.as(() => oldClient.syncNow())).action, 'uploaded');
    assert.equal((await O.owner.playerDetail(b.id)).save.data.club.includes(victim2), true);
    assert.equal((await O.owner.playerDetail(b.id)).patches.length, 1, 'still pending on the server');
    await D1.remote(); // applied to D1's local club; acknowledgement waits for the upload
    assert.equal(R.pendingAcks(), 1);
    assert.equal((await D1.ut()).club.includes(victim2), false);
    const lost = await D1.sync(); // conflict with the newer server copy: it replaces the local club
    assert.equal(lost.action, 'downloaded');
    assert.equal(R.pendingAcks(), 0);
    assert.equal((await O.owner.playerDetail(b.id)).patches.length, 1, 'never acknowledged while the patched club was not on the server');
    const again = await D1.remote(); // the patch re-applies to the downloaded copy
    assert.ok(again.patches && again.patches.changed >= 1);
    assert.equal((await D1.sync()).action, 'uploaded');
    const done = await O.owner.playerDetail(b.id);
    assert.equal(done.patches.length, 0, 'acknowledged after the upload');
    assert.equal(done.save.data.club.includes(victim2), false);
    function createCloudSyncFor(dev) { return ctx.createCloudSync(dev.on, { storage: dev.disk }); }
  });
});

test('019 wipe.js forgets exactly the keys the game uses for the club (UT save, backup, cloud link, season, reset records)', async () => {
  await withRemote(async ({ R, W }) => {
    const { SEASON_KEY } = await import('../../meta/core/seasons.js');
    assert.deepEqual(W.WIPE_KEYS, [UT.UT_KEY, `${UT.UT_KEY}.backup`, `${UT.UT_KEY}.cloud`, SEASON_KEY]);
    const ls = lsShim(); globalThis.localStorage = ls;
    for (const k of ['pitchside.ut', 'pitchside.ut.backup', 'pitchside.ut.cloud', 'pitchside.season', 'pitchside.resetSeen.abc', 'pitchside.resetApplied.abc', 'pitchside.settings', 'pitchside.gameplay']) ls.setItem(k, '1');
    W.wipeLocalProfile();
    assert.deepEqual([...Array(ls.length)].map((_, i) => ls.key(i)).sort(), ['pitchside.gameplay', 'pitchside.settings']);
    assert.equal(R.RESET_COINS, 5000);
  });
});

// ------------------------------------------------------------------ Vinson battle (migration 020)
async function vinsonWorld() {
  let t = 1_800_000_000_000;
  const be = createMockBackend(memoryStore(), { now: () => t });
  const pw = 'Pitch-pass1';
  const mkAcc = async (username, extra = {}) => { const c = mk3(be); const r = await c.account.signup({ username, password: pw, confirm: pw, ...extra }); assert.equal(r.ok, true, username); return { c, id: r.id }; };
  const O = await mkAcc('Shawky Fc', { adminCode: 'mock-super' });
  const A = await mkAcc('Cursed One'), B = await mkAcc('Cursed Two');
  return { be, O, A, B, tick: (ms) => { t += ms; } };
}
const vCurse = async (who) => { assert.equal((await who.c.vinson.pull()).phase, 'doom'); };
/** curse -> doom expires -> owner unban -> player locks the card */
const vCursedAndLocked = async (w, who) => {
  await vCurse(who); w.tick(61000);
  assert.equal((await who.c.vinson.status()).phase, 'banned');
  assert.equal((await w.O.c.moderation.unban(who.id)).ok, true);
  assert.equal((await who.c.vinson.status()).phase, 'released'); // the client polls status, which clears its cached ban
  assert.equal((await who.c.vinson.lock()).phase, 'locked');
};

test('vinson battle: happy path start -> win -> claim, status reconciles, never re-cursed', async () => {
  const w = await vinsonWorld();
  await vCursedAndLocked(w, w.A);
  const st0 = await w.A.c.vinson.status();
  assert.deepEqual([st0.phase, st0.immune, st0.battleWon, st0.rewardsClaimed], ['locked', false, false, false]);
  const s = await w.A.c.vinson.battleStart();
  assert.equal(s.ok, true); assert.match(s.nonce, /^[0-9a-f]{32}$/);
  w.tick(61000);
  const win = await w.A.c.vinson.battleWin({ nonce: s.nonce });
  assert.deepEqual([win.ok, win.immune, win.phase], [true, true, 'lifted']);
  const st = await w.A.c.vinson.status();
  assert.deepEqual([st.phase, st.immune, st.battleWon, st.rewardsClaimed], ['lifted', true, true, false]);
  assert.equal(st.restrictions?.market, undefined); // restrictions added by the lock are gone, like an owner lift
  const c1 = await w.A.c.vinson.claimBattleRewards();
  assert.deepEqual([c1.ok, c1.claimed, c1.cards], [true, true, ['vinson_reward_world', 'vinson_reward_phonk', 'vinson_reward_captain']]);
  assert.equal((await w.A.c.vinson.status()).rewardsClaimed, true);
  // an immune profile is never re-cursed and cannot start another fight
  const pull = await w.A.c.vinson.pull();
  assert.deepEqual([pull.ok, pull.phase, pull.immune], [true, 'lifted', true]);
  w.tick(3600000);
  assert.equal((await w.A.c.vinson.status()).phase, 'lifted');
  assert.equal((await w.A.c.vinson.battleStart()).error, 'already_immune');
});

test('vinson battle: win without start, bad nonce, never cursed, claim before win', async () => {
  const w = await vinsonWorld();
  await vCursedAndLocked(w, w.A);
  assert.equal((await w.A.c.vinson.battleWin({ nonce: 'a'.repeat(32) })).error, 'no_battle');
  assert.equal((await w.A.c.vinson.battleWin({ nonce: 'nope' })).error, 'bad_nonce');
  assert.equal((await w.A.c.vinson.battleWin()).error, 'bad_nonce');
  const s = await w.A.c.vinson.battleStart(); w.tick(61000);
  assert.equal((await w.A.c.vinson.battleWin({ nonce: 'f'.repeat(32) })).error, 'bad_nonce');
  assert.equal((await w.B.c.vinson.battleStart()).error, 'not_cursed'); // never cursed
  assert.equal((await w.B.c.vinson.battleWin({ nonce: s.nonce })).error, 'no_battle');
  assert.equal((await w.O.c.vinson.battleStart()).error, 'not_cursed'); // owner is exempt
  assert.equal((await w.A.c.vinson.claimBattleRewards()).error, 'not_won');
  assert.equal((await w.B.c.vinson.claimBattleRewards()).error, 'not_won');
});

test('vinson battle: too-fast win refused but nonce kept; restart replaces nonce; stale nonce expires', async () => {
  const w = await vinsonWorld();
  await vCursedAndLocked(w, w.A); await vCursedAndLocked(w, w.B);
  const s = await w.A.c.vinson.battleStart();
  w.tick(5000);
  const fast = await w.A.c.vinson.battleWin({ nonce: s.nonce });
  assert.deepEqual([fast.ok, fast.error], [false, 'too_soon']);
  assert.ok(fast.retryAfter > 0 && fast.retryAfter <= 55);
  assert.equal((await w.A.c.vinson.status()).immune, false);
  w.tick(60000);
  assert.equal((await w.A.c.vinson.battleWin({ nonce: s.nonce })).ok, true); // the honest, slower win still lands
  const s1 = await w.B.c.vinson.battleStart();
  const s2 = await w.B.c.vinson.battleStart();
  assert.notEqual(s1.nonce, s2.nonce);
  w.tick(61000);
  assert.equal((await w.B.c.vinson.battleWin({ nonce: s1.nonce })).error, 'bad_nonce'); // replaced
  w.tick(2 * 3600000);
  assert.equal((await w.B.c.vinson.battleWin({ nonce: s2.nonce })).error, 'expired');
  const s3 = await w.B.c.vinson.battleStart(); w.tick(61000);
  assert.equal((await w.B.c.vinson.battleWin({ nonce: s3.nonce })).immune, true);
});

test('vinson battle: nonce is bound to its profile; a reused nonce is idempotent', async () => {
  const w = await vinsonWorld();
  await vCursedAndLocked(w, w.A); await vCursedAndLocked(w, w.B);
  const sa = await w.A.c.vinson.battleStart(), sb = await w.B.c.vinson.battleStart();
  w.tick(61000);
  assert.equal((await w.B.c.vinson.battleWin({ nonce: sa.nonce })).error, 'bad_nonce'); // A's nonce, B's identity
  assert.equal((await w.B.c.vinson.status()).immune, false);
  assert.equal((await w.A.c.vinson.battleWin({ nonce: sa.nonce })).ok, true);
  const again = await w.A.c.vinson.battleWin({ nonce: sa.nonce }); // replay: same success, no second grant
  assert.deepEqual([again.ok, again.immune, again.phase, again.rewardsClaimed], [true, true, 'lifted', false]);
  assert.equal((await w.A.c.vinson.claimBattleRewards()).claimed, true);
  assert.equal((await w.A.c.vinson.battleWin({ nonce: sa.nonce })).rewardsClaimed, true);
  assert.equal((await w.B.c.vinson.battleWin({ nonce: sb.nonce })).ok, true);
});

test('vinson battle: double claim returns claimed:false with the same ids', async () => {
  const w = await vinsonWorld();
  await vCursedAndLocked(w, w.A);
  const s = await w.A.c.vinson.battleStart(); w.tick(61000);
  await w.A.c.vinson.battleWin({ nonce: s.nonce });
  const c1 = await w.A.c.vinson.claimBattleRewards(), c2 = await w.A.c.vinson.claimBattleRewards(), c3 = await w.A.c.vinson.claimBattleRewards();
  assert.deepEqual([c1.claimed, c2.claimed, c3.claimed], [true, false, false]);
  assert.deepEqual(c2.cards, c1.cards); assert.deepEqual(c3.cards, c1.cards);
  assert.equal(c1.cards.length, 3);
});

test('vinson battle: a released player can still fight; start is rate limited', async () => {
  const w = await vinsonWorld();
  await vCurse(w.A); w.tick(61000);
  assert.equal((await w.A.c.vinson.status()).phase, 'banned'); // 021: a Vinson ban may fight (see the ban-screen test)
  assert.equal((await w.O.c.moderation.unban(w.A.id)).ok, true);
  assert.equal((await w.A.c.vinson.status()).phase, 'released');
  let last;
  for (let i = 0; i < 31; i++) last = await w.A.c.vinson.battleStart();
  assert.equal(last.error, 'rate_limited');
});

test('vinson battle: unban, owner lift and earned immunity stay distinct', async () => {
  const w = await vinsonWorld();
  await vCurse(w.A); w.tick(61000); // unban only releases: not immune, not lifted
  assert.equal((await w.O.c.moderation.unban(w.A.id)).ok, true);
  let st = await w.A.c.vinson.status();
  assert.deepEqual([st.phase, st.immune, st.battleWon], ['released', false, false]);
  assert.equal((await w.B.c.vinson.lift(w.A.id)).error, 'not_allowed'); // only the owner lifts
  assert.equal((await w.O.c.vinson.lift(w.A.id)).ok, true); // owner lift: lifted, NOT immune, no rewards
  st = await w.A.c.vinson.status();
  assert.deepEqual([st.phase, st.immune, st.battleWon], ['lifted', false, false]);
  assert.equal((await w.A.c.vinson.claimBattleRewards()).error, 'not_won');
  assert.equal((await w.A.c.vinson.battleStart()).error, 'not_cursed'); // nothing left to fight
  assert.equal((await w.A.c.vinson.pull()).phase, 'lifted');
  await vCursedAndLocked(w, w.B); // earned immunity is its own thing
  const s = await w.B.c.vinson.battleStart(); w.tick(61000);
  await w.B.c.vinson.battleWin({ nonce: s.nonce });
  assert.equal((await w.O.c.vinson.lift(w.B.id)).error, 'not_vinson');
  assert.equal((await w.O.c.vinson.unban(w.B.id)).error, 'not_vinson');
  assert.equal((await w.B.c.vinson.status()).immune, true);
  assert.equal((await w.B.c.vinson.pull()).immune, true);
});

test('vinson battle: an owner lift during the fight keeps the nonce; the win still immunises', async () => {
  const w = await vinsonWorld();
  await vCursedAndLocked(w, w.A);
  const s = await w.A.c.vinson.battleStart();
  assert.equal((await w.O.c.vinson.lift(w.A.id)).ok, true);
  w.tick(61000);
  const win = await w.A.c.vinson.battleWin({ nonce: s.nonce });
  assert.deepEqual([win.ok, win.immune], [true, true]);
});

test('vinson battle: win marks the cloud save lifted so the locked card may leave the XI', async () => {
  const w = await vinsonWorld();
  await vCursedAndLocked(w, w.A);
  const club = { club: ['secret_vinson'], squad: { slots: ['secret_vinson'], bench: [] }, vinson: { phase: 'locked' } };
  assert.equal((await w.A.c.cloud.put(club, 0)).ok, true);
  const s = await w.A.c.vinson.battleStart(); w.tick(61000);
  await w.A.c.vinson.battleWin({ nonce: s.nonce });
  const got = await w.A.c.cloud.get();
  assert.equal(got.data.vinson.phase, 'lifted');
  assert.equal((await w.A.c.cloud.put({ club: [], squad: { slots: [], bench: [] } }, got.rev)).ok, true);
});

// ------------------------------------------------------------------ run
for (const [name, fn] of queue) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e && e.stack || String(e)).split("\n").slice(0, 8).join('\n       ')}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

test('vinson battle (021): a Vinson-banned player fights from the ban screen; moderation bans stay blocked', async () => {
  const w = await vinsonWorld();
  await vCurse(w.A); await vCurse(w.B); w.tick(61000);
  assert.equal((await w.A.c.vinson.status()).phase, 'banned'); // caches the Vinson ban locally
  assert.equal(w.A.c.account.current().state, 'banned');
  const s = await w.A.c.vinson.battleStart();
  assert.equal(s.ok, true, 'start from the ban screen');
  w.tick(61000);
  const win = await w.A.c.vinson.battleWin({ nonce: s.nonce });
  assert.deepEqual([win.ok, win.immune, win.phase], [true, true, 'lifted']);
  assert.equal(w.A.c.account.current().state, 'account'); // local ban cleared
  assert.equal((await w.A.c.vinson.claimBattleRewards()).claimed, true);
  assert.equal((await w.A.c.vinson.status()).phase, 'lifted');
  // B: Vinson-banned, then the owner puts a real moderation ban on top -> the fight is refused
  assert.equal((await w.B.c.vinson.status()).phase, 'banned');
  assert.equal((await w.O.c.moderation.ban(w.B.id, 'spam')).ok, true);
  assert.equal((await w.B.c.vinson.battleStart()).error, 'banned');
  assert.equal((await w.B.c.vinson.claimBattleRewards()).error, 'banned');
});
