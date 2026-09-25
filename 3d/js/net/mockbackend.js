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
  const fresh = () => ({ profiles: {}, listings: [], queue: [], adminHash: null, adminFails: {} });
  const load = () => { const d = store.load(); return d && d.profiles ? d : fresh(); };

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
      && Math.abs(q.rating - me.rating) <= Math.min(1000, 100 + Math.floor(10 * (t - q.createdAt) / 1000)))
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
      db.profiles[id] = { id, secretHash: h, name: cleanName(p_name), coins: 5000, rating: 1000, division: 8, wins: 0, draws: 0, losses: 0, lastReward: 0, windowStart: 0, windowCount: 0 };
      store.save(db);
      return id;
    },
    get_profile({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const unclaimed = db.listings.filter((l) => l.sellerId === p.id && l.status === 'sold' && !l.claimed).reduce((s, l) => s + l.credit, 0);
      return { ok: true, id: p.id, name: p.name, coins: p.coins, rating: p.rating, division: p.division, wins: p.wins, draws: p.draws, losses: p.losses, unclaimed };
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
      if (!['friendly', 'ut', 'offline'].includes(p_mode)) return err('bad_mode');
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
      let opp = p.rating, k = 16;
      if (p_mode !== 'offline') {
        const q = db.queue.filter((x) => x.playerId === p.id && x.matchedWith != null && !x.reported && x.mode === p_mode && x.matchedAt > t - 3 * 3600000)
          .sort((a, b) => b.matchedAt - a.matchedAt)[0];
        if (q) { q.reported = true; opp = q.oppRating; k = 32; }
      } else k = 0;
      const exp = 1 / (1 + 10 ** ((opp - p.rating) / 400));
      const old = p.rating;
      p.rating = Math.max(100, Math.min(3000, p.rating + Math.round(k * (score - exp))));
      p.division = division(p.rating);
      p.coins += coins;
      if (p_won) p.wins++; else if (p_drawn) p.draws++; else p.losses++;
      p.lastReward = t; p.windowStart = ws; p.windowCount = count + 1;
      store.save(db);
      return { ok: true, capped: false, coinsAwarded: coins, coins: p.coins, rating: p.rating, ratingDelta: p.rating - old, division: p.division };
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
      if (!['friendly', 'ut'].includes(p_mode)) return err('bad_mode');
      if (typeof p_peer_id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(p_peer_id)) return err('bad_peer');
      purge(db);
      db.queue = db.queue.filter((q) => !(q.playerId === p.id && q.matchedWith == null));
      const t = now();
      const r = { id: uuid(rand), playerId: p.id, mode: p_mode, peerId: p_peer_id, rating: p.rating, name: p.name, createdAt: t, lastPoll: t, matchedWith: null, matchedAt: null, host: false, token: null, reported: false };
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
