// Pitchside 3D — in-browser mock of the Supabase RPCs (supabase/migrations/001_pitchside.sql).
// Used with ?mockOnline=1 (state in localStorage, so two tabs of the same browser share one
// "server") and by the node unit tests (in-memory store). Mirrors the SQL rules closely enough
// for UI and state-machine testing; it is NOT a security boundary.

const DAY = 86400000;
const hex = (n, rand) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
const uuid = (rand) => {
  const h = hex(32, rand);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// tiny non-cryptographic hash (mock only)
function fnv(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519); }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, '0');
}
const err = (e) => ({ ok: false, error: e });
const cleanName = (n) => (String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim() || 'Player');
const division = (r) => Math.max(1, Math.min(10, 10 - Math.trunc((r - 800) / 100)));
const RIV_THR = { 10: 10, 9: 10, 8: 11, 7: 12, 6: 12, 5: 13, 4: 13, 3: 14, 2: 15, 1: 15 };
function isoWeek(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
function rivalsReward(peak, wins) {
  const base = { 0: 25000, 1: 15000, 2: 12000, 3: 10000, 4: 8000, 5: 6500, 6: 5000, 7: 4000, 8: 3000, 9: 2000 }[peak] || 1500;
  const packs = peak === 0 ? ['stars', 'rare', 'premium'] : peak <= 2 ? ['rare', 'premium'] : peak <= 5 ? ['premium', 'gold'] : peak <= 8 ? ['gold'] : ['silver'];
  if (wins >= 10) packs.push('rare');
  if (wins >= 20) packs.push('stars');
  return { coins: base + 300 * Math.min(Math.max(wins || 0, 0), 20), packs };
}
const POS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];

/** Storage adapter backed by a Web Storage object (localStorage). */
export function webStore(storage, key = 'pitchside.mock.db') {
  return {
    load() { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } },
    save(db) { try { storage.setItem(key, JSON.stringify(db)); } catch { /* ignore */ } },
  };
}
export function memoryStore() {
  let db = null;
  return { load: () => (db ? JSON.parse(JSON.stringify(db)) : null), save: (d) => { db = JSON.parse(JSON.stringify(d)); } };
}

/**
 * @param {{load():object|null, save(db):void}} store
 * @param {{ now?:()=>number, rand?:()=>number, latencyMs?:number, down?:boolean }} opts
 */
export function createMockBackend(store, { now = () => Date.now(), rand = Math.random, latencyMs = 0, down = false } = {}) {
  const fresh = () => ({ profiles: {}, listings: [], queue: [], friends: [], invites: [], adminHash: null, adminFails: {} });
  const load = () => {
    const d = store.load();
    if (!d || !d.profiles) return fresh();
    d.friends = d.friends || []; d.invites = d.invites || [];
    return d;
  };
  const CODE_A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = (db) => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 8; i++) c += CODE_A[Math.floor(rand() * 32)];
      if (!Object.values(db.profiles).some((p) => p.friendCode === c)) return c;
    }
  };
  const pairKey = (x, y) => (x < y ? [x, y] : [y, x]);
  const findF = (db, x, y) => { const [a, b] = pairKey(x, y); return db.friends.find((f) => f.a === a && f.b === b) || null; };
  const seen = (p) => { p.lastSeen = now(); };
  function rollover(p) {
    const w = isoWeek(now());
    if (p.rivalsWeek === w) return;
    if (p.rivalsWeek && p.rivalsWeekMatches > 0) { p.rivalsPrevWeek = p.rivalsWeek; p.rivalsPrevPeak = p.rivalsPeak; p.rivalsPrevWins = p.rivalsWeekWins; }
    Object.assign(p, { rivalsWeek: w, rivalsWeekWins: 0, rivalsWeekMatches: 0, rivalsPeak: p.rivalsDivision });
  }
  const rivalsDefaults = { rivalsDivision: 10, rivalsPoints: 0, rivalsWeek: null, rivalsWeekWins: 0, rivalsWeekMatches: 0, rivalsPeak: 10, rivalsPrevWeek: null, rivalsPrevPeak: null, rivalsPrevWins: null, rivalsClaimedWeek: null };

  function auth(db, id, secret) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return null;
    const p = db.profiles[id];
    return p && p.secretHash === fnv(secret) ? p : null;
  }
  const mmResult = (r) => (r.matchedWith == null
    ? { ok: true, matched: false, queueId: r.id, waitedMs: Math.max(0, now() - r.createdAt) }
    : { ok: true, matched: true, queueId: r.id, role: r.host ? 'host' : 'guest', opponentPeerId: r.oppPeerId, token: r.token, opponent: { name: r.oppName, rating: r.oppRating } });

  function pair(db, me) {
    const t = now();
    const cands = db.queue.filter((q) => q.mode === me.mode && q.matchedWith == null && q.id !== me.id && q.playerId !== me.playerId
      && q.lastPoll > t - 20000 && (q.createdAt < me.createdAt || (q.createdAt === me.createdAt && q.id < me.id))
      && Math.abs(q.rating - me.rating) <= Math.min(1000, 100 + Math.floor(10 * (t - q.createdAt) / 1000))
      && (me.mode !== 'rivals' || Math.abs((q.division ?? 10) - (me.division ?? 10)) <= 1 + Math.floor((t - q.createdAt) / 20000)))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const c = cands[0];
    if (!c) return me;
    const token = hex(32, rand);
    Object.assign(c, { matchedWith: me.id, matchedAt: t, host: true, token, oppPlayerId: me.playerId, oppPeerId: me.peerId, oppRating: me.rating, oppName: me.name });
    Object.assign(me, { matchedWith: c.id, matchedAt: t, host: false, token, oppPlayerId: c.playerId, oppPeerId: c.peerId, oppRating: c.rating, oppName: c.name, lastPoll: t });
    return me;
  }
  function purge(db) {
    const t = now();
    db.queue = db.queue.filter((q) => !((q.matchedWith == null && q.lastPoll < t - 60000) || q.createdAt < t - 3 * 3600000));
  }
  function expireMine(db, sellerId) {
    for (const l of db.listings) if (l.sellerId === sellerId && l.status === 'active' && l.createdAt <= now() - 3 * DAY) l.status = 'expired';
  }
  const pub = (l, db) => ({ listingId: l.id, card: l.card, price: l.price, seller: (db.profiles[l.sellerId] || {}).name || 'Player', listedAt: new Date(l.createdAt).toISOString() });

  const fns = {
    ping: () => true,
    register({ p_secret, p_name }) {
      if (typeof p_secret !== 'string' || !/^[0-9a-f]{64}$/.test(p_secret)) throw new Error('invalid secret');
      const db = load();
      const h = fnv(p_secret);
      const ex = Object.values(db.profiles).find((p) => p.secretHash === h);
      if (ex) return ex.id;
      const id = uuid(rand);
      db.profiles[id] = { id, secretHash: h, name: cleanName(p_name), coins: 5000, rating: 1000, division: 8, wins: 0, draws: 0, losses: 0, lastReward: 0, windowStart: 0, windowCount: 0, friendCode: newCode(db), lastSeen: 0, ...rivalsDefaults };
      store.save(db);
      return id;
    },
    get_profile({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const unclaimed = db.listings.filter((l) => l.sellerId === p.id && l.status === 'sold' && !l.claimed).reduce((s, l) => s + l.credit, 0);
      return { ok: true, id: p.id, name: p.name, coins: p.coins, rating: p.rating, division: p.division, wins: p.wins, draws: p.draws, losses: p.losses, unclaimed, friendCode: p.friendCode, rivalsDivision: p.rivalsDivision ?? 10 };
    },
    set_name({ p_id, p_secret, p_name }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      p.name = cleanName(p_name);
      store.save(db);
      return { ok: true, name: p.name };
    },
    report_result({ p_id, p_secret, p_mode, p_won, p_drawn, p_gf, p_ga }) {
      if (!['friendly', 'ut', 'rivals', 'offline'].includes(p_mode)) return err('bad_mode');
      if (p_won && p_drawn) return err('bad_result');
      if (!Number.isInteger(p_gf) || !Number.isInteger(p_ga) || p_gf < 0 || p_ga < 0 || p_gf > 50 || p_ga > 50) return err('bad_score');
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const t = now();
      const ws = Math.floor(t / 3600000) * 3600000;
      const count = p.windowStart === ws ? p.windowCount : 0;
      if (count >= 12 || (p.lastReward && p.lastReward > t - 60000)) {
        return { ok: true, capped: true, coinsAwarded: 0, coins: p.coins, rating: p.rating, ratingDelta: 0, division: p.division };
      }
      const coins = p_won ? 800 : p_drawn ? 400 : 200;
      const score = p_won ? 1 : p_drawn ? 0.5 : 0;
      let opp = p.rating, k = 16, matched = false;
      if (p_mode !== 'offline') {
        const q = db.queue.filter((x) => x.playerId === p.id && x.matchedWith != null && !x.reported && x.mode === p_mode && x.matchedAt > t - 3 * 3600000)
          .sort((a, b) => b.matchedAt - a.matchedAt)[0];
        if (q) { q.reported = true; opp = q.oppRating; k = 32; matched = true; }
      } else k = 0;
      const exp = 1 / (1 + 10 ** ((opp - p.rating) / 400));
      const old = p.rating;
      p.rating = Math.max(100, Math.min(3000, p.rating + Math.round(k * (score - exp))));
      p.division = division(p.rating);
      p.coins += coins;
      if (p_won) p.wins++; else if (p_drawn) p.draws++; else p.losses++;
      p.lastReward = t; p.windowStart = ws; p.windowCount = count + 1;
      let rivals = null;
      if (p_mode === 'rivals' && matched) {
        Object.assign(p, { ...rivalsDefaults, ...p });
        rollover(p);
        let div = p.rivalsDivision, pts = p.rivalsPoints + (p_won ? 3 : p_drawn ? 1 : 0), promoted = false;
        while (RIV_THR[div] && pts >= RIV_THR[div]) { pts -= RIV_THR[div]; div--; promoted = true; }
        Object.assign(p, { rivalsDivision: div, rivalsPoints: pts, rivalsPeak: Math.min(p.rivalsPeak, div), rivalsWeekWins: p.rivalsWeekWins + (p_won ? 1 : 0), rivalsWeekMatches: p.rivalsWeekMatches + 1 });
        rivals = { division: div, points: pts, threshold: RIV_THR[div] ?? null, promoted, weekWins: p.rivalsWeekWins };
      }
      store.save(db);
      return { ok: true, capped: false, coinsAwarded: coins, coins: p.coins, rating: p.rating, ratingDelta: p.rating - old, division: p.division, rivals };
    },
    spend_coins({ p_id, p_secret, p_amount }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!Number.isInteger(p_amount) || p_amount <= 0 || p_amount > 1e8) return err('bad_amount');
      if (p.coins < p_amount) return err('insufficient_coins');
      p.coins -= p_amount;
      store.save(db);
      return { ok: true, coins: p.coins };
    },
    admin_verify({ p_code }) {
      const db = load();
      const minute = Math.floor(now() / 60000);
      if ((db.adminFails[minute] || 0) >= 20) return false;
      const ok = !!db.adminHash && typeof p_code === 'string' && p_code.length <= 128 && fnv(`admin:${p_code}`) === db.adminHash;
      if (!ok) { db.adminFails = { [minute]: (db.adminFails[minute] || 0) + 1 }; store.save(db); }
      return ok;
    },
    admin_add_coins({ p_id, p_secret, p_code, p_delta }) {
      const db0 = load();
      const p0 = auth(db0, p_id, p_secret);
      if (!p0) return err('auth');
      if (!Number.isInteger(p_delta) || p_delta === 0 || Math.abs(p_delta) > 1e8) return err('bad_amount');
      if (!fns.admin_verify({ p_code })) return err('not_admin');
      const db = load();
      const p = db.profiles[p_id];
      p.coins = Math.max(0, p.coins + p_delta);
      store.save(db);
      return { ok: true, coins: p.coins };
    },
    list_card({ p_id, p_secret, p_card, p_price }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!Number.isInteger(p_price) || p_price < 150 || p_price > 15000000) return err('bad_price');
      const c = p_card;
      if (!c || typeof c !== 'object' || Array.isArray(c)) return err('bad_card');
      if (JSON.stringify(c).length > 4096) return err('card_too_large');
      if (typeof c.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,40}$/.test(c.id) || typeof c.name !== 'string' || !POS.includes(c.pos) || !Number.isInteger(c.ovr) || c.ovr < 1 || c.ovr > 99) return err('bad_card');
      if (db.listings.filter((l) => l.sellerId === p.id && l.status === 'active').length >= 30) return err('too_many_listings');
      if (db.listings.some((l) => l.sellerId === p.id && l.status === 'active' && l.card.id === c.id)) return err('already_listed');
      const rarity = ['legend', 'hero', 'inform', 'icon'].includes(c.special) ? c.special
        : ['gold', 'silver', 'bronze'].includes(c.tier) ? c.tier + (c.rare === true ? '_rare' : '') : 'common';
      const l = { id: uuid(rand), sellerId: p.id, card: c, ovr: c.ovr, pos: c.pos, rarity, name: c.name.slice(0, 32), price: p_price, credit: Math.floor((p_price * 95) / 100), status: 'active', buyerId: null, createdAt: now(), soldAt: null, claimed: false };
      db.listings.push(l);
      store.save(db);
      return { ok: true, listingId: l.id };
    },
    search_listings({ p_q = null, p_pos = null, p_min_ovr = null, p_max_price = null, p_rarity = null, p_sort = 'newest', p_page = 0 }) {
      const db = load();
      const t = now();
      const q = p_q ? String(p_q).slice(0, 24).toLowerCase() : null;
      const page = Math.max(0, Math.min(49, p_page | 0));
      const rows = db.listings.filter((l) => l.status === 'active' && l.createdAt > t - 3 * DAY
        && (!q || l.name.toLowerCase().includes(q)) && (!p_pos || l.pos === p_pos) && (p_min_ovr == null || l.ovr >= p_min_ovr)
        && (!p_max_price || l.price <= p_max_price) && (!p_rarity || l.rarity === p_rarity));
      const cmp = { price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price, ovr_desc: (a, b) => b.ovr - a.ovr }[p_sort];
      rows.sort((a, b) => (cmp ? cmp(a, b) : 0) || b.createdAt - a.createdAt);
      return { ok: true, items: rows.slice(page * 20, page * 20 + 20).map((l) => pub(l, db)), page };
    },
    buy({ p_id, p_secret, p_listing }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const l = db.listings.find((x) => x.id === p_listing);
      if (!l) return err('not_found');
      if (l.status !== 'active') return err('unavailable');
      if (l.createdAt <= now() - 3 * DAY) { l.status = 'expired'; store.save(db); return err('expired'); }
      if (l.sellerId === p.id) return err('own_listing');
      if (p.coins < l.price) return err('insufficient_coins');
      p.coins -= l.price;
      Object.assign(l, { status: 'sold', buyerId: p.id, soldAt: now() });
      store.save(db);
      return { ok: true, card: l.card, price: l.price, coins: p.coins };
    },
    cancel_listing({ p_id, p_secret, p_listing }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const l = db.listings.find((x) => x.id === p_listing && x.sellerId === p.id && (x.status === 'active' || x.status === 'expired'));
      if (!l) return err('not_cancellable');
      l.status = 'cancelled';
      store.save(db);
      return { ok: true, card: l.card };
    },
    my_listings({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      expireMine(db, p.id);
      store.save(db);
      const items = db.listings.filter((l) => l.sellerId === p.id && (l.status === 'active' || l.status === 'expired' || (l.status === 'sold' && (!l.claimed || l.soldAt > now() - 7 * DAY))))
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
        .map((l) => ({ ...pub(l, db), status: l.status, soldAt: l.soldAt ? new Date(l.soldAt).toISOString() : null, claimed: l.claimed, credit: l.credit }));
      return { ok: true, items };
    },
    claim_sales({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      expireMine(db, p.id);
      let total = 0, n = 0;
      for (const l of db.listings) if (l.sellerId === p.id && l.status === 'sold' && !l.claimed) { l.claimed = true; total += l.credit; n++; }
      p.coins += total;
      store.save(db);
      return { ok: true, coins: total, count: n, balance: p.coins };
    },
    mm_enqueue({ p_id, p_secret, p_mode, p_peer_id }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!['friendly', 'ut', 'rivals'].includes(p_mode)) return err('bad_mode');
      if (typeof p_peer_id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(p_peer_id)) return err('bad_peer');
      purge(db);
      Object.assign(p, { ...rivalsDefaults, ...p });
      rollover(p);
      db.queue = db.queue.filter((q) => !(q.playerId === p.id && q.matchedWith == null));
      const t = now();
      const r = { id: uuid(rand), playerId: p.id, mode: p_mode, peerId: p_peer_id, rating: p.rating, name: p.name, division: p.rivalsDivision, createdAt: t, lastPoll: t, matchedWith: null, matchedAt: null, host: false, token: null, reported: false };
      db.queue.push(r);
      pair(db, r);
      store.save(db);
      return mmResult(r);
    },
    mm_poll({ p_id, p_secret, p_queue_id }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const r = db.queue.find((q) => q.id === p_queue_id && q.playerId === p.id);
      if (!r) return err('not_queued');
      if (r.matchedWith != null) return mmResult(r);
      r.lastPoll = now();
      pair(db, r);
      store.save(db);
      return mmResult(r);
    },
    mm_cancel({ p_id, p_secret, p_queue_id }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const r = db.queue.find((q) => q.id === p_queue_id && q.playerId === p.id);
      if (!r) return { ok: true, matched: false };
      if (r.matchedWith != null) return mmResult(r);
      db.queue = db.queue.filter((q) => q !== r);
      store.save(db);
      return { ok: true, matched: false };
    },

    // ---------------------------------------------------------------- rivals
    rivals_status({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      Object.assign(p, { ...rivalsDefaults, ...p });
      rollover(p);
      store.save(db);
      const claimable = !!p.rivalsPrevWeek && p.rivalsPrevWeek !== p.rivalsClaimedWeek;
      const d = new Date(now()); const day = (d.getUTCDay() + 6) % 7;
      const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 7);
      return {
        ok: true, division: p.rivalsDivision, points: p.rivalsPoints, threshold: RIV_THR[p.rivalsDivision] ?? null, week: p.rivalsWeek,
        weekWins: p.rivalsWeekWins, weekMatches: p.rivalsWeekMatches, peak: p.rivalsPeak, claimable,
        claimWeek: claimable ? p.rivalsPrevWeek : null, reward: claimable ? rivalsReward(p.rivalsPrevPeak, p.rivalsPrevWins) : null,
        nextResetAt: new Date(next).toISOString(),
      };
    },
    rivals_claim_weekly({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      Object.assign(p, { ...rivalsDefaults, ...p });
      rollover(p);
      if (!p.rivalsPrevWeek) { store.save(db); return err('nothing_to_claim'); }
      if (p.rivalsPrevWeek === p.rivalsClaimedWeek) { store.save(db); return err('already_claimed'); }
      const rw = rivalsReward(p.rivalsPrevPeak, p.rivalsPrevWins);
      p.coins += rw.coins;
      p.rivalsClaimedWeek = p.rivalsPrevWeek;
      store.save(db);
      return { ok: true, week: p.rivalsClaimedWeek, coins: rw.coins, packs: rw.packs, balance: p.coins };
    },
    /** test hook: pretend the current rivals week is over */
    _rivals_end_week({ p_id }) {
      const db = load();
      const p = db.profiles[p_id];
      if (p) { p.rivalsWeek = '2000-W01'; store.save(db); }
      return true;
    },

    // ---------------------------------------------------------------- friends + invites
    heartbeat({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      seen(p);
      store.save(db);
      return {
        ok: true, invites: db.invites.filter((i) => i.toId === p.id && i.status === 'pending' && i.createdAt > now() - 60000).length,
        requests: db.friends.filter((f) => (f.a === p.id || f.b === p.id) && f.status === 'pending' && f.requestedBy !== p.id).length,
      };
    },
    add_friend({ p_id, p_secret, p_code }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const code = String(p_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^[A-Z0-9]{8}$/.test(code)) return err('bad_code');
      const o = Object.values(db.profiles).find((x) => x.friendCode === code);
      if (!o) return err('not_found');
      if (o.id === p.id) return err('self');
      const f = findF(db, p.id, o.id);
      if (f) {
        if (f.status === 'blocked') return err(f.blockedBy === p.id ? 'blocked' : 'not_found');
        if (f.status === 'accepted') return err('already_friends');
        if (f.requestedBy === p.id) return err('already_requested');
        f.status = 'accepted';
        store.save(db);
        return { ok: true, status: 'friend', friend: { id: o.id, name: o.name } };
      }
      const [a, b] = pairKey(p.id, o.id);
      db.friends.push({ a, b, status: 'pending', requestedBy: p.id, blockedBy: null });
      store.save(db);
      return { ok: true, status: 'outgoing', friend: { id: o.id, name: o.name } };
    },
    respond_friend({ p_id, p_secret, p_friend, p_action }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!['accept', 'decline', 'remove', 'block', 'unblock'].includes(p_action)) return err('bad_action');
      if (!p_friend || p_friend === p.id || !db.profiles[p_friend]) return err('not_found');
      const f = findF(db, p.id, p_friend);
      const cancelInv = () => { for (const i of db.invites) if (i.status === 'pending' && ((i.fromId === p.id && i.toId === p_friend) || (i.fromId === p_friend && i.toId === p.id))) i.status = 'cancelled'; };
      if (p_action === 'block') {
        if (f && f.status === 'blocked') return { ok: true };
        if (f) Object.assign(f, { status: 'blocked', blockedBy: p.id, requestedBy: p.id });
        else { const [a, b] = pairKey(p.id, p_friend); db.friends.push({ a, b, status: 'blocked', requestedBy: p.id, blockedBy: p.id }); }
        cancelInv();
        store.save(db);
        return { ok: true };
      }
      if (!f || (f.status === 'blocked' && f.blockedBy !== p.id)) return err('not_found');
      if (p_action === 'unblock') {
        if (f.status !== 'blocked') return err('not_found');
        db.friends = db.friends.filter((x) => x !== f);
      } else if (p_action === 'accept') {
        if (f.status !== 'pending' || f.requestedBy === p.id) return err('not_found');
        f.status = 'accepted';
      } else {
        if (f.status === 'blocked') return err('blocked');
        db.friends = db.friends.filter((x) => x !== f);
        cancelInv();
      }
      store.save(db);
      return { ok: true };
    },
    list_friends({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      seen(p);
      store.save(db);
      const items = db.friends.filter((f) => (f.a === p.id || f.b === p.id) && !(f.status === 'blocked' && f.blockedBy !== p.id)).map((f) => {
        const o = db.profiles[f.a === p.id ? f.b : f.a];
        const acc = f.status === 'accepted';
        return {
          id: o.id, name: o.name,
          status: acc ? 'friend' : f.status === 'blocked' ? 'blocked' : f.requestedBy === p.id ? 'outgoing' : 'incoming',
          online: acc && o.lastSeen > now() - 60000, rating: acc ? o.rating : null, division: acc ? o.division : null, rivalsDivision: acc ? (o.rivalsDivision ?? 10) : null,
        };
      }).sort((x, y) => (y.online - x.online) || x.name.localeCompare(y.name));
      return { ok: true, code: p.friendCode, items };
    },
    send_invite({ p_id, p_secret, p_friend, p_mode, p_peer_id }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!['friendly', 'ut'].includes(p_mode)) return err('bad_mode');
      if (typeof p_peer_id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(p_peer_id)) return err('bad_peer');
      const f = findF(db, p.id, p_friend);
      if (!f || f.status !== 'accepted') return err('not_friends');
      const recent = db.invites.filter((i) => i.fromId === p.id && i.createdAt > now() - 600000).length;
      if (recent >= 20) return err('rate_limited');
      for (const i of db.invites) if (i.fromId === p.id && i.status === 'pending') i.status = 'cancelled';
      const inv = { id: uuid(rand), fromId: p.id, toId: p_friend, mode: p_mode, peerId: p_peer_id, token: hex(32, rand), status: 'pending', createdAt: now() };
      db.invites.push(inv);
      db.invites = db.invites.filter((i) => i.createdAt > now() - 3600000);
      seen(p);
      store.save(db);
      return { ok: true, inviteId: inv.id, token: inv.token, expiresInMs: 60000 };
    },
    poll_invites({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      seen(p);
      store.save(db);
      const t = now();
      const incoming = db.invites.filter((i) => i.toId === p.id && i.status === 'pending' && i.createdAt > t - 60000 && (findF(db, i.fromId, i.toId) || {}).status === 'accepted')
        .map((i) => ({ inviteId: i.id, mode: i.mode, createdAt: new Date(i.createdAt).toISOString(), from: { id: i.fromId, name: db.profiles[i.fromId].name, rating: db.profiles[i.fromId].rating } }));
      const outgoing = db.invites.filter((i) => i.fromId === p.id && i.createdAt > t - 120000)
        .map((i) => ({ inviteId: i.id, mode: i.mode, toId: i.toId, status: i.status === 'pending' && i.createdAt <= t - 60000 ? 'expired' : i.status }));
      const requests = db.friends.filter((f) => (f.a === p.id || f.b === p.id) && f.status === 'pending' && f.requestedBy !== p.id).length;
      return { ok: true, incoming, outgoing, requests };
    },
    respond_invite({ p_id, p_secret, p_invite, p_accept }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const i = db.invites.find((x) => x.id === p_invite && x.toId === p.id);
      if (!i) return err('not_found');
      if (i.status !== 'pending') return err('unavailable');
      if (i.createdAt <= now() - 60000) { i.status = 'expired'; store.save(db); return err('expired'); }
      if (!p_accept) { i.status = 'declined'; store.save(db); return { ok: true, accepted: false }; }
      if ((findF(db, i.fromId, i.toId) || {}).status !== 'accepted') { i.status = 'cancelled'; store.save(db); return err('unavailable'); }
      i.status = 'accepted';
      store.save(db);
      const o = db.profiles[i.fromId];
      return { ok: true, accepted: true, mode: i.mode, peerId: i.peerId, token: i.token, from: { id: o.id, name: o.name, rating: o.rating } };
    },
    cancel_invite({ p_id, p_secret, p_invite }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const i = db.invites.find((x) => x.id === p_invite && x.fromId === p.id);
      if (!i) return { ok: true, status: 'not_found' };
      if (i.status !== 'pending') return { ok: true, status: i.status };
      i.status = 'cancelled';
      store.save(db);
      return { ok: true, status: 'cancelled' };
    },
  };

  return {
    /** Same shape as the real RPC layer: -> { ok:true, data } | { ok:false, error } */
    async call(fn, args = {}) {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      if (down || this.down) return { ok: false, error: 'offline' };
      const f = fns[fn];
      if (!f) return { ok: false, error: 'unknown_function' };
      try { return { ok: true, data: f(args || {}) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
    },
    /** Test helper: set the mock admin code (hash kept only in the mock store). */
    setAdminCode(code) { const db = load(); db.adminHash = fnv(`admin:${code}`); store.save(db); },
    reset() { store.save(fresh()); },
    down,
  };
}
