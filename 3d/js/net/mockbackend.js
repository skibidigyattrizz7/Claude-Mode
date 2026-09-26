// Pitchside 3D — in-browser mock of the Supabase RPCs (supabase/migrations/001_pitchside.sql + 002_accounts_moderation.sql).
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
import { usernameError, passwordError, isReservedName, usernameKey, isBlockedName } from './accountcore.js';

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
  // Dev-only default codes so ?mockOnline=1 has a working admin without any setup (docs/ONLINE_API.md: "mock
  // admin codes are mock-full / mock-super"). Real deployments set their own via setAdminCode(s) (server-side).
  const extraDefaults = () => ({ saves: {}, adminHashSuper: fnv('admin:mock-super'), config: {}, configAt: 0, coinOps: {}, adminOps: {}, broadcasts: [], bcastSeq: 0, gifts: [], giftClaims: [], messages: [], msgSeq: 0, squads: {}, throttle: {} });
  const fresh = () => ({ profiles: {}, listings: [], queue: [], friends: [], invites: [], adminHash: fnv('admin:mock-full'), adminFails: {}, sessions: [], audit: [], loginFails: {}, serverKey: hex(32, rand), ...extraDefaults() });
  const load = () => {
    const d = store.load();
    if (!d || !d.profiles) return fresh();
    d.friends = d.friends || []; d.invites = d.invites || [];
    d.sessions = d.sessions || []; d.audit = d.audit || []; d.loginFails = d.loginFails || {}; d.serverKey = d.serverKey || hex(32, rand);
    for (const [k, v] of Object.entries(extraDefaults())) if (d[k] == null) d[k] = v;
    return d;
  };
  const SESSION_TTL = 60 * DAY;
  const isBanned = (p) => !!p.banned && (!p.bannedUntil || p.bannedUntil > now());
  const banJson = (p) => ({ reason: p.banReason || '', until: p.bannedUntil ? new Date(p.bannedUntil).toISOString() : null });
  const bannedError = (p) => Object.assign(new Error('banned'), { ban: banJson(p) });
  const audit = (db, id, action, detail = {}) => { db.audit.push({ profileId: id, action, detail, at: now() }); if (db.audit.length > 2000) db.audit.splice(0, db.audit.length - 2000); };
  const newSession = (db, id) => {
    const token = hex(64, rand);
    db.sessions.push({ profileId: id, tokenHash: fnv(`s:${token}`), createdAt: now(), lastSeen: now() });
    const mine = db.sessions.filter((x) => x.profileId === id).sort((a, b) => b.lastSeen - a.lastSeen);
    if (mine.length > 10) { const drop = new Set(mine.slice(10)); db.sessions = db.sessions.filter((x) => !drop.has(x)); }
    return token;
  };
  const accountJson = (p, token) => ({ ok: true, id: p.id, session_token: token, username: p.username, name: p.name, friendCode: p.friendCode, role: p.role || 'player' });
  // Admin code levels (003): 'super' | 'full' | null. Accepts the code or a signed admin token "adm.<level>.<exp>.<sig>".
  const admSig = (db, level, exp) => (fnv(`adm|${db.serverKey}|${level}|${exp}`) + fnv(`${exp}|${level}|${db.serverKey}`) + fnv(`z${level}${db.serverKey}${exp}`) + fnv(`q${db.serverKey}${exp}`)).slice(0, 64).padEnd(64, '0');
  const adminLevel = (db, code) => {
    const minute = Math.floor(now() / 60000);
    if ((db.adminFails[minute] || 0) >= 20 || typeof code !== 'string' || !code || code.length > 160) return null;
    const m = /^adm\.(full|super)\.(\d{9,11})\.([0-9a-f]{64})$/.exec(code);
    let lv = null;
    if (m) { if (Number(m[2]) > now() / 1000 && admSig(db, m[1], m[2]) === m[3]) lv = m[1]; }
    else if (code.length <= 128) {
      const h = fnv(`admin:${code}`);
      lv = db.adminHashSuper && h === db.adminHashSuper ? 'super' : db.adminHash && h === db.adminHash ? 'full' : null;
    }
    if (!lv) db.adminFails = { [minute]: (db.adminFails[minute] || 0) + 1 };
    return lv;
  };
  const adminOk = (db, code) => !!adminLevel(db, code);
  const RANK = { admin: 3, owner: 2, mod: 1 };
  const rank = (r) => RANK[r] || 0;
  function modActor(db, p_code, p_id, p_secret) {
    if (p_id && p_secret) {
      const a = auth(db, p_id, p_secret);
      if (a && (a.role === 'owner' || a.role === 'mod')) return a.role;
    }
    if (p_code && adminOk(db, p_code)) return 'admin';
    return null;
  }
  const modRow = (p) => ({
    id: p.id, username: p.username || null, name: p.name, role: p.role || 'player', friendCode: p.friendCode, coins: p.coins, rating: p.rating,
    rivalsDivision: p.rivalsDivision ?? 10, wins: p.wins, draws: p.draws, losses: p.losses, banned: isBanned(p), banReason: p.banReason || null,
    bannedUntil: p.bannedUntil ? new Date(p.bannedUntil).toISOString() : null, bannedAt: p.bannedAt ? new Date(p.bannedAt).toISOString() : null,
    createdAt: new Date(p.createdAt || 0).toISOString(), lastLoginAt: p.lastLoginAt ? new Date(p.lastLoginAt).toISOString() : null, lastSeenAt: p.lastSeen ? new Date(p.lastSeen).toISOString() : null,
  });
  const newProfile = (db, secretHash, name) => {
    const id = uuid(rand);
    db.profiles[id] = { id, secretHash, name, coins: 5000, rating: 1000, division: 8, wins: 0, draws: 0, losses: 0, lastReward: 0, windowStart: 0, windowCount: 0, friendCode: newCode(db), lastSeen: 0, createdAt: now(), role: 'player', ...rivalsDefaults };
    return db.profiles[id];
  };
  const keyTaken = (db, u) => Object.values(db.profiles).some((p) => p.username && usernameKey(p.username) === usernameKey(u));
  const safeName = (n, role) => { const v = cleanName(n); return (role !== 'owner' && isReservedName(v)) || isBlockedName(v) ? null : v; };
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

  /** Device secret or live session; banned profiles throw like the SQL helper (unless raw). */
  function authRaw(db, id, secret) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return null;
    const p = db.profiles[id];
    if (!p) return null;
    if (p.secretHash === fnv(secret)) return p;
    const h = fnv(`s:${secret}`);
    return db.sessions.some((x) => x.profileId === id && x.tokenHash === h && x.lastSeen > now() - SESSION_TTL) ? p : null;
  }
  function auth(db, id, secret) {
    const p = authRaw(db, id, secret);
    if (p && isBanned(p)) throw bannedError(p);
    return p;
  }
  const mmResult = (r) => (r.matchedWith == null
    ? { ok: true, matched: false, queueId: r.id, waitedMs: Math.max(0, now() - r.createdAt) }
    : { ok: true, matched: true, queueId: r.id, role: r.host ? 'host' : 'guest', opponentPeerId: r.oppPeerId, token: r.token, opponent: { name: r.oppName, rating: r.oppRating, role: r.oppRole || 'player' } });

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
    const roleOfId = (id) => (db.profiles[id] || {}).role || 'player';
    Object.assign(c, { matchedWith: me.id, matchedAt: t, host: true, token, oppPlayerId: me.playerId, oppPeerId: me.peerId, oppRating: me.rating, oppName: me.name, oppRole: roleOfId(me.playerId) });
    Object.assign(me, { matchedWith: c.id, matchedAt: t, host: false, token, oppPlayerId: c.playerId, oppPeerId: c.peerId, oppRating: c.rating, oppName: c.name, oppRole: roleOfId(c.playerId), lastPoll: t });
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


  // ---------------------------------------------------------------- 003 helpers
  const hit = (db, bucket, windowMs, max) => {
    const w = Math.floor(now() / windowMs);
    const k = `${bucket}@${windowMs}`;
    const cur = db.throttle[k] && db.throttle[k].w === w ? db.throttle[k].n : 0;
    db.throttle[k] = { w, n: cur + 1 };
    return cur + 1 <= max;
  };
  const cfgNum = (db, key, field, dflt) => { const v = db.config && db.config[key] && db.config[key].value; return v && typeof v[field] === 'number' ? v[field] : dflt; };
  const cfgVersion = (db) => db.configAt || 0;
  function actor(db, p_code, p_id, p_secret) {
    let role = null;
    if (p_id && p_secret) { const a = auth(db, p_id, p_secret); if (a && (a.role === 'owner' || a.role === 'mod')) role = a.role; }
    const lv = p_code ? adminLevel(db, p_code) : null;
    return lv || role;
  }
  const ownerPower = (a) => a === 'super' || a === 'full' || a === 'owner';
  const powerErr = (a) => err(a === 'mod' ? 'not_allowed' : 'not_admin');
  const mayActOn = (a, p_id, v) => a === 'super' || a === 'full' || (a === 'owner' && ((v.role || 'player') !== 'owner' || v.id === p_id));
  const keyOk = (k) => k == null || (typeof k === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(k));
  const cleanText = (t, max) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').slice(0, max).trim();
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const KEY_RE = /^[A-Za-z0-9_.-]{1,40}$/;
  function configError(key, v) {
    if (!isObj(v)) return 'bad_value';
    if (JSON.stringify(v).length > 8192) return 'too_large';
    const ent = Object.entries(v);
    if (ent.length > 200) return 'too_large';
    if (key === 'promos') return ent.every(([k, x]) => KEY_RE.test(k) && typeof x === 'boolean') ? null : 'bad_value';
    if (key === 'features') return ent.every(([k, x]) => KEY_RE.test(k) && (typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e12))) ? null : 'bad_value';
    if (key === 'packs') {
      return ent.every(([k, x]) => KEY_RE.test(k) && isObj(x) && Object.entries(x).every(([f, y]) => (f === 'enabled' && typeof y === 'boolean')
        || (f === 'price' && Number.isInteger(y) && y >= 0 && y <= 10000000))) ? null : 'bad_value';
    }
    if (key === 'rewards') return ent.every(([f, y]) => typeof y === 'number' && ((f === 'multiplier' && y >= 0 && y <= 10) || (f === 'packChance' && y >= 0 && y <= 1))) ? null : 'bad_value';
    if (key === 'market') return ent.every(([f, y]) => f === 'tax' && typeof y === 'number' && y >= 0 && y <= 0.5) ? null : 'bad_value';
    return 'bad_key';
  }
  const activeBroadcasts = (db) => db.broadcasts.filter((b) => !b.cancelled && b.until > now()).sort((a, b) => b.id - a.id).slice(0, 5)
    .map((b) => ({ id: b.id, text: b.text, at: new Date(b.at).toISOString(), until: new Date(b.until).toISOString() }));
  const onlineCount = (db) => Object.values(db.profiles).filter((p) => p.lastSeen > now() - 60000).length;
  const claimed = (db, gid, pid) => db.giftClaims.some((c) => c.giftId === gid && c.profileId === pid);
  const myGifts = (db, p) => db.gifts.filter((g) => (g.toId === p.id || g.toId == null) && g.until > now() && !claimed(db, g.id, p.id));
  const giftJson = (g) => ({ id: g.id, kind: g.kind, coins: g.coins, packId: g.payload.packId ?? null, count: g.payload.count ?? null, card: g.payload.card ?? null, message: g.message, all: g.toId == null, at: new Date(g.at).toISOString(), until: new Date(g.until).toISOString() });
  const publicRow = (q) => ({ id: q.id, username: q.username || null, name: q.name, friendCode: q.friendCode, online: (q.lastSeen || 0) > now() - 60000 });
  function findProfile(db, query) {
    const q = String(query ?? '').trim();
    if (q.length < 3 || q.length > 40) return null;
    if (db.profiles[q.toLowerCase()]) return db.profiles[q.toLowerCase()];
    const k = usernameKey(q);
    return Object.values(db.profiles).find((p) => p.username && usernameKey(p.username) === k)
      || Object.values(db.profiles).find((p) => p.friendCode === q.toUpperCase().replace(/-/g, '')) || null;
  }
  const blocked = (db, x, y) => { const f = findF(db, x, y); return !!f && f.status === 'blocked'; };
  const epochs = (p) => ({ coins: p.resetCoins || 0, progress: p.resetProgress || 0, club: p.resetClub || 0 });
  function giftCard(c, sup) {
    if (!isObj(c) || JSON.stringify(c).length > 4000) return null;
    if (typeof c.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,40}$/.test(c.id) || typeof c.name !== 'string' || c.name.length < 1 || c.name.length > 32) return null;
    if (!Number.isInteger(c.ovr) || c.ovr < 1 || c.ovr > (sup ? 999 : 99)) return null;
    if ('pos' in c && (typeof c.pos !== 'string' || !/^[A-Z]{2,4}$/.test(c.pos))) return null;
    const { untradable, ...rest } = c; // eslint-disable-line no-unused-vars
    return { ...rest, tradable: true };
  }
  const features = (db) => (db.config.features && db.config.features.value) || {};
  const resetEpoch = (db) => (Number.isFinite(features(db).resetEpoch) ? Math.trunc(features(db).resetEpoch) : 0);
  const resetAt = (db) => (Number.isFinite(features(db).resetAtMs) ? features(db).resetAtMs : resetEpoch(db) * 1000);
  const passOk = (p, pw) => typeof pw === 'string' && pw.length <= 72 && p.pwHash === fnv(`pw:${pw}`);

  const fns = {
    ping: () => true,
    register({ p_secret, p_name }) {
      if (typeof p_secret !== 'string' || !/^[0-9a-f]{64}$/.test(p_secret)) throw new Error('invalid secret');
      const db = load();
      const h = fnv(p_secret);
      const ex = Object.values(db.profiles).find((p) => p.secretHash === h);
      if (ex) return ex.id;
      const { id } = newProfile(db, h, safeName(p_name) || 'Player');
      store.save(db);
      return id;
    },
    get_profile({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const unclaimed = db.listings.filter((l) => l.sellerId === p.id && l.status === 'sold' && !l.claimed).reduce((s, l) => s + l.credit, 0);
      return { ok: true, id: p.id, name: p.name, coins: p.coins, rating: p.rating, division: p.division, wins: p.wins, draws: p.draws, losses: p.losses, unclaimed, friendCode: p.friendCode, rivalsDivision: p.rivalsDivision ?? 10, username: p.username || null, role: p.role || 'player' };
    },
    set_name({ p_id, p_secret, p_name }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const nm = safeName(p_name, p.role);
      if (!nm) return err('name_not_allowed');
      p.name = nm;
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
      const ok = adminOk(db, p_code);
      store.save(db);
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
      if (!p.infinite && p.coins < l.price) return err('insufficient_coins');
      if (!p.infinite) p.coins -= l.price;
      const tax = Math.max(0, Math.min(0.5, cfgNum(db, 'market', 'tax', 0.05)));
      const credit = l.price - Math.ceil(l.price * tax);
      Object.assign(l, { status: 'sold', buyerId: p.id, soldAt: now(), credit, claimed: true });
      const seller = db.profiles[l.sellerId];
      if (seller) seller.coins += credit;
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
      const items = db.listings.filter((l) => l.sellerId === p.id && (l.status === 'active' || l.status === 'expired'))
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
          id: o.id, name: o.name, role: o.role || 'player',
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
        .map((i) => ({ inviteId: i.id, mode: i.mode, createdAt: new Date(i.createdAt).toISOString(), from: { id: i.fromId, name: db.profiles[i.fromId].name, rating: db.profiles[i.fromId].rating, role: db.profiles[i.fromId].role || 'player' } }));
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
      return { ok: true, accepted: true, mode: i.mode, peerId: i.peerId, token: i.token, from: { id: o.id, name: o.name, rating: o.rating, role: o.role || 'player' } };
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
    // ---------------------------------------------------------------- accounts (002)
    signup({ p_username, p_password, p_admin_code = null }) {
      const u = String(p_username ?? '').trim();
      const e = usernameError(u) || passwordError(p_password, u);
      if (e) return err(e);
      const db = load();
      let role = 'player';
      if (isReservedName(u)) { if (!adminOk(db, p_admin_code)) { store.save(db); return err('reserved_username'); } role = 'owner'; }
      if (keyTaken(db, u)) return err('username_taken');
      const p = newProfile(db, fnv(hex(64, rand)), u);
      Object.assign(p, { username: u, pwHash: fnv(`pw:${p_password}`), role, lastLoginAt: now() });
      const token = newSession(db, p.id);
      audit(db, p.id, 'signup', { username: u, role });
      store.save(db);
      return accountJson(p, token);
    },
    login({ p_username, p_password }) {
      const u = String(p_username ?? '').trim();
      if (u.length < 3 || u.length > 16 || typeof p_password !== 'string' || !p_password) return err('bad_credentials');
      const db = load();
      const k = usernameKey(u);
      const win = Math.floor(now() / 900000);
      const fk = `${win}:${k}`;
      if ((db.loginFails[fk] || 0) >= 10) return err('too_many_attempts');
      const p = Object.values(db.profiles).find((x) => x.username && usernameKey(x.username) === k);
      if (!p || p.pwHash !== fnv(`pw:${p_password}`)) {
        db.loginFails = { ...Object.fromEntries(Object.entries(db.loginFails).filter(([key]) => key.startsWith(`${win}:`))), [fk]: (db.loginFails[fk] || 0) + 1 };
        if (p) audit(db, p.id, 'login_failed');
        store.save(db);
        return err('bad_credentials');
      }
      if (isBanned(p)) { audit(db, p.id, 'login_banned'); store.save(db); return { ok: false, error: 'banned', ban: banJson(p) }; }
      p.lastLoginAt = now(); seen(p);
      const token = newSession(db, p.id);
      audit(db, p.id, 'login');
      store.save(db);
      return accountJson(p, token);
    },
    logout({ p_id, p_token, p_all = false }) {
      if (typeof p_token !== 'string' || !/^[0-9a-f]{64}$/.test(p_token)) return err('auth');
      const db = load();
      const h = fnv(`s:${p_token}`);
      if (!db.sessions.some((x) => x.profileId === p_id && x.tokenHash === h)) return { ok: true, ended: 0 };
      const before = db.sessions.length;
      db.sessions = db.sessions.filter((x) => !(x.profileId === p_id && (p_all || x.tokenHash === h)));
      audit(db, p_id, 'logout', { all: !!p_all });
      store.save(db);
      return { ok: true, ended: before - db.sessions.length };
    },
    claim_profile({ p_id, p_secret, p_username, p_password, p_admin_code = null }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (p.username) return err('already_has_account');
      const u = String(p_username ?? '').trim();
      const e = usernameError(u) || passwordError(p_password, u);
      if (e) return err(e);
      let role = p.role || 'player';
      if (isReservedName(u)) { if (!adminOk(db, p_admin_code)) { store.save(db); return err('reserved_username'); } role = 'owner'; }
      if (keyTaken(db, u)) return err('username_taken');
      Object.assign(p, { username: u, name: u, role, pwHash: fnv(`pw:${p_password}`), secretHash: fnv(hex(64, rand)), lastLoginAt: now() });
      const token = newSession(db, p.id);
      audit(db, p.id, 'claim', { username: u });
      store.save(db);
      return accountJson(p, token);
    },
    account_status({ p_id, p_secret }) {
      const db = load();
      const p = authRaw(db, p_id, p_secret);
      if (!p) return err('auth');
      const h = fnv(`s:${p_secret}`);
      for (const x of db.sessions) if (x.profileId === p.id && x.tokenHash === h) x.lastSeen = now();
      seen(p);
      store.save(db);
      const b = isBanned(p);
      return { ok: true, id: p.id, username: p.username || null, name: p.name, role: p.role || 'player', claimed: !!p.username, banned: b, ban: b ? banJson(p) : null, friendCode: p.friendCode };
    },
    // ---------------------------------------------------------------- moderation (002)
    // p_query='' -> "all players" (paginated, newest first). A real pitchside_mod_list RPC should replace this
    // path server-side; the mock covers it here so the Admin panel's "All players" list works end-to-end.
    mod_search({ p_code, p_query, p_page = 0, p_id = null, p_secret = null }) {
      const db = load();
      const actor = modActor(db, p_code, p_id, p_secret);
      store.save(db);
      if (!actor) return err('not_admin');
      const q = String(p_query ?? '').trim();
      if (q.length > 40) return err('bad_query');
      const page = Math.max(0, Math.trunc(Number(p_page) || 0));
      let list;
      if (!q) {
        list = Object.values(db.profiles).filter((p) => p.username).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      } else {
        const k = usernameKey(q);
        list = Object.values(db.profiles).filter((p) => (k && p.username && usernameKey(p.username).startsWith(k)) || p.friendCode === q.toUpperCase().replace(/-/g, '')
          || p.id === q.toLowerCase() || p.name.toLowerCase().includes(q.toLowerCase()))
          .sort((a, b) => ((b.username && usernameKey(b.username) === k) - (a.username && usernameKey(a.username) === k)) || (b.lastSeen || 0) - (a.lastSeen || 0));
      }
      const page_size = 25;
      const items = list.slice(page * page_size, page * page_size + page_size).map(modRow);
      return { ok: true, items, more: list.length > (page + 1) * page_size };
    },
    mod_player({ p_code, p_player, p_id = null, p_secret = null }) {
      const db = load();
      const actor = modActor(db, p_code, p_id, p_secret);
      store.save(db);
      if (!actor) return err('not_admin');
      const p = db.profiles[p_player];
      if (!p) return err('not_found');
      const auditRows = db.audit.filter((a) => a.profileId === p.id).slice(-60).reverse().map((a) => ({ action: a.action, detail: a.detail, at: new Date(a.at).toISOString() }));
      const listings = db.listings.filter((l) => l.sellerId === p.id).slice(-40).reverse().map((l) => ({ listingId: l.id, name: l.card.name, ovr: l.card.ovr, price: l.price, status: l.status, listedAt: new Date(l.createdAt).toISOString(), soldAt: null }));
      return { ok: true, player: modRow(p), audit: auditRows, listings, sessions: db.sessions.filter((x) => x.profileId === p.id).length };
    },
    mod_ban({ p_code, p_player, p_reason, p_until = null, p_id = null, p_secret = null }) {
      const db = load();
      const actor = modActor(db, p_code, p_id, p_secret);
      if (!actor) { store.save(db); return err('not_admin'); }
      const reason = String(p_reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); // eslint-disable-line no-control-regex
      if (!reason || reason.length > 200) return err('bad_reason');
      const until = p_until == null ? null : Date.parse(p_until);
      if (until !== null && (!Number.isFinite(until) || until <= now() || until > now() + 3650 * DAY)) return err('bad_until');
      const p = db.profiles[p_player];
      if (!p) return err('not_found');
      if (actor !== 'admin' && p.id === p_id) return err('not_allowed');
      if (rank(p.role) >= rank(actor)) return err('not_allowed');
      Object.assign(p, { banned: true, banReason: reason, bannedUntil: until, bannedAt: now(), bannedBy: actor });
      let n = 0;
      for (const l of db.listings) if (l.sellerId === p.id && l.status === 'active') { l.status = 'cancelled'; n++; }
      db.queue = db.queue.filter((q) => !(q.playerId === p.id && q.matchedWith == null));
      for (const i of db.invites) if ((i.fromId === p.id || i.toId === p.id) && i.status === 'pending') i.status = 'cancelled';
      audit(db, p.id, 'admin_ban', { reason, until: p_until, by: actor, listingsCancelled: n });
      store.save(db);
      return { ok: true, player: modRow(p), listingsCancelled: n };
    },
    mod_unban({ p_code, p_player, p_id = null, p_secret = null }) {
      const db = load();
      const actor = modActor(db, p_code, p_id, p_secret);
      if (!actor) { store.save(db); return err('not_admin'); }
      const p = db.profiles[p_player];
      if (!p) return err('not_found');
      if (rank(p.role) >= rank(actor)) return err('not_allowed');
      Object.assign(p, { banned: false, banReason: null, bannedUntil: null, bannedAt: null, bannedBy: null });
      audit(db, p.id, 'admin_unban', { by: actor });
      store.save(db);
      return { ok: true, player: modRow(p) };
    },
    mod_adjust_coins({ p_code, p_player, p_delta, p_reason = null, p_id = null, p_secret = null }) {
      const db = load();
      const actor = modActor(db, p_code, p_id, p_secret);
      if (!actor) { store.save(db); return err('not_admin'); }
      if (actor === 'mod') return err('not_allowed');
      if (!Number.isInteger(p_delta) || p_delta === 0 || Math.abs(p_delta) > 1e8) return err('bad_amount');
      const p = db.profiles[p_player];
      if (!p) return err('not_found');
      const before = p.coins;
      p.coins = Math.max(0, p.coins + p_delta);
      audit(db, p.id, 'admin_coins', { delta: p_delta, before, balance: p.coins, reason: p_reason || '', by: actor });
      store.save(db);
      return { ok: true, coins: p.coins };
    },
    mod_set_role({ p_code, p_player, p_role, p_id = null, p_secret = null }) {
      const db = load();
      const actor = modActor(db, p_code, p_id, p_secret);
      if (!actor) { store.save(db); return err('not_admin'); }
      if (actor === 'mod') return err('not_allowed');
      if (!['player', 'mod', 'owner'].includes(p_role)) return err('bad_role');
      const p = db.profiles[p_player];
      if (!p) return err('not_found');
      if (!p.username) return err('no_account');
      if (actor !== 'admin' && (p.id === p_id || p.role === 'owner' || p_role === 'owner')) return err('not_allowed');
      const from = p.role || 'player';
      p.role = p_role;
      audit(db, p.id, 'admin_role', { from, to: p_role, by: actor });
      store.save(db);
      return { ok: true, player: modRow(p) };
    },
    admin_match_token({ p_id, p_secret, p_bind = null }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (p.role !== 'owner' && p.role !== 'mod') return err('not_allowed');
      if (p_bind != null && !/^[A-Za-z0-9_-]{1,64}$/.test(p_bind)) return err('bad_bind');
      const exp = Math.floor(now() / 1000) + 900;
      const payload = `${p.id}.${p.role}.${exp}`;
      const sig = (fnv(`${db.serverKey}|${payload}|${p_bind || ''}`) + fnv(`${payload}|${p_bind || ''}|${db.serverKey}`) + fnv(`x${db.serverKey}${payload}${p_bind || ''}`) + fnv(`y${payload}${db.serverKey}`)).slice(0, 64).padEnd(64, '0');
      return { ok: true, role: p.role, exp, token: `${payload}.${sig}` };
    },
    verify_admin_token({ p_token, p_bind = null }) {
      const m = typeof p_token === 'string' && /^([0-9a-f-]{36})\.(owner|mod)\.(\d{9,11})\.([0-9a-f]{64})$/.exec(p_token);
      if (!m) return err('invalid');
      const db = load();
      const payload = `${m[1]}.${m[2]}.${m[3]}`;
      const sig = (fnv(`${db.serverKey}|${payload}|${p_bind || ''}`) + fnv(`${payload}|${p_bind || ''}|${db.serverKey}`) + fnv(`x${db.serverKey}${payload}${p_bind || ''}`) + fnv(`y${payload}${db.serverKey}`)).slice(0, 64).padEnd(64, '0');
      if (sig !== m[4] || Number(m[3]) < now() / 1000) return err('invalid');
      const p = db.profiles[m[1]];
      if (!p || p.role !== m[2] || isBanned(p)) return err('invalid');
      return { ok: true, profile_id: p.id, role: p.role, exp: Number(m[3]) };
    },

    // ---------------------------------------------------------------- 003: admin levels, config, coins, owner powers
    admin_login({ p_code }) {
      const db = load();
      const lv = adminLevel(db, p_code);
      store.save(db);
      if (!lv) return err('invalid');
      const exp = Math.floor(now() / 1000) + 12 * 3600;
      return { ok: true, level: lv, exp, token: `adm.${lv}.${exp}.${admSig(db, lv, String(exp))}` };
    },
    get_config() {
      const db = load();
      return { ok: true, version: cfgVersion(db), config: Object.fromEntries(Object.entries(db.config).map(([k, v]) => [k, v.value])) };
    },
    admin_set_config({ p_code, p_key, p_value, p_id = null, p_secret = null }) {
      const db = load();
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      if (!['promos', 'packs', 'rewards', 'market', 'features'].includes(p_key)) return err('bad_key');
      const e = configError(p_key, p_value);
      if (e) return err(e);
      db.configAt = Math.max(now(), (db.configAt || 0) + 1);
      db.config[p_key] = { value: JSON.parse(JSON.stringify(p_value)), at: db.configAt, by: a };
      audit(db, p_id, 'admin_config', { key: p_key, by: a });
      store.save(db);
      return { ok: true, version: db.configAt };
    },
    coins_get({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      return { ok: true, coins: p.coins, infinite: !!p.infinite };
    },
    coins_op({ p_id, p_secret, p_delta, p_reason = null, p_key = null }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!Number.isInteger(p_delta) || p_delta === 0 || Math.abs(p_delta) > 1e8) return err('bad_amount');
      if (!keyOk(p_key)) return err('bad_key');
      const ok = p_key ? db.coinOps[`${p.id}:${p_key}`] : null;
      if (ok) return { ...ok, replay: true };
      if (!hit(db, `coinop:${p.id}`, 3600000, 900)) { store.save(db); return err('rate_limited'); }
      let applied;
      if (p_delta < 0) {
        if (p.infinite) applied = 0;
        else { if (p.coins < -p_delta) return err('insufficient_coins'); p.coins += p_delta; applied = p_delta; }
      } else {
        if (!['quicksell', 'objective', 'sbc', 'season', 'ut-earn', 'event', 'draft', 'reward'].includes(p_reason)) return err('bad_reason');
        const hs = Math.floor(now() / 3600000), ds = Math.floor(now() / DAY);
        const hour = p.earnHour === hs ? p.earnHourCoins : 0, day = p.earnDay === ds ? p.earnDayCoins : 0;
        applied = Math.max(0, Math.min(p_delta, 250000 - hour, 1000000 - day));
        Object.assign(p, { coins: p.coins + applied, earnHour: hs, earnHourCoins: hour + applied, earnDay: ds, earnDayCoins: day + applied });
      }
      const res = { ok: true, coins: p.coins, applied, requested: p_delta, infinite: !!p.infinite };
      if (p_key) db.coinOps[`${p.id}:${p_key}`] = res;
      store.save(db);
      return res;
    },
    admin_coins({ p_code, p_player = null, p_delta, p_reason = null, p_key = null, p_id = null, p_secret = null }) {
      const db = load();
      if (!keyOk(p_key)) return err('bad_key');
      if (p_key && db.adminOps[`coins:${p_key}`]) return { ...db.adminOps[`coins:${p_key}`], replay: true };
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      if (!Number.isInteger(p_delta) || p_delta === 0 || Math.abs(p_delta) > 1e9) return err('bad_amount');
      const v = db.profiles[p_player || p_id];
      if (!v) return err('not_found');
      if (!mayActOn(a, p_id, v)) return err('not_allowed');
      const before = v.coins;
      v.coins = Math.max(0, Math.min(v.coins + p_delta, 1e12));
      const res = { ok: true, coins: v.coins, player: v.id };
      if (p_key) db.adminOps[`coins:${p_key}`] = res;
      audit(db, v.id, 'admin_coins', { delta: p_delta, before, balance: v.coins, reason: p_reason || '', by: a });
      store.save(db);
      return res;
    },
    admin_set_infinite({ p_code, p_on, p_player = null, p_id = null, p_secret = null }) {
      const db = load();
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      if (typeof p_on !== 'boolean') return err('bad_value');
      if (p_player && p_player !== p_id && a !== 'super' && a !== 'full') return err('not_allowed');
      if (!p_player && !authRaw(db, p_id, p_secret)) return err('auth');
      const v = db.profiles[p_player || p_id];
      if (!v) return err('not_found');
      v.infinite = p_on;
      audit(db, v.id, 'admin_infinite', { on: p_on, by: a });
      store.save(db);
      return { ok: true, infinite: v.infinite, coins: v.coins };
    },
    admin_reset({ p_code, p_player, p_what, p_id = null, p_secret = null }) {
      const db = load();
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      if (!['coins', 'progress', 'club', 'all'].includes(p_what)) return err('bad_value');
      const v = db.profiles[p_player];
      if (!v) return err('not_found');
      if (!mayActOn(a, p_id, v)) return err('not_allowed');
      const all = p_what === 'all';
      if (all || p_what === 'coins') Object.assign(v, { coins: 5000, infinite: false, resetCoins: (v.resetCoins || 0) + 1, earnHourCoins: 0, earnDayCoins: 0 });
      if (all || p_what === 'progress') Object.assign(v, { rating: 1000, division: 8, wins: 0, draws: 0, losses: 0, ...rivalsDefaults, resetProgress: (v.resetProgress || 0) + 1 });
      if (all || p_what === 'club') {
        v.resetClub = (v.resetClub || 0) + 1;
        delete db.squads[v.id];
        for (const l of db.listings) if (l.sellerId === v.id && (l.status === 'active' || l.status === 'expired')) l.status = 'cancelled';
      }
      audit(db, v.id, 'admin_reset', { what: p_what, by: a });
      store.save(db);
      return { ok: true, player: modRow(v), resets: epochs(v) };
    },
    // ---------------------------------------------------------------- 003: broadcasts + presence
    get_broadcasts() { return { ok: true, items: activeBroadcasts(load()) }; },
    admin_broadcast({ p_code, p_text, p_minutes = 30, p_id = null, p_secret = null }) {
      const db = load();
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      const text = cleanText(p_text, 200);
      if (!text) return err('bad_text');
      if (!Number.isInteger(p_minutes) || p_minutes < 1 || p_minutes > 1440) return err('bad_value');
      if (!hit(db, 'bcast', 3600000, 60)) { store.save(db); return err('rate_limited'); }
      const id = ++db.bcastSeq;
      db.broadcasts.push({ id, text, at: now(), until: now() + p_minutes * 60000, by: a, cancelled: false });
      db.broadcasts = db.broadcasts.filter((b) => b.until > now() - 30 * DAY);
      store.save(db);
      return { ok: true, id };
    },
    admin_clear_broadcast({ p_code, p_bid, p_id = null, p_secret = null }) {
      const db = load();
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      const b = db.broadcasts.find((x) => x.id === p_bid && !x.cancelled);
      if (!b) return err('not_found');
      b.cancelled = true;
      store.save(db);
      return { ok: true };
    },
    online_count() { return onlineCount(load()); },
    presence({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!hit(db, `pres:${p.id}`, 3600000, 600)) { store.save(db); return err('rate_limited'); }
      seen(p);
      store.save(db);
      return {
        ok: true, online: onlineCount(db), coins: p.coins, infinite: !!p.infinite, broadcasts: activeBroadcasts(db), gifts: myGifts(db, p).length,
        unread: db.messages.filter((m) => m.toId === p.id && !m.readAt).length,
        invites: db.invites.filter((i) => i.toId === p.id && i.status === 'pending' && i.createdAt > now() - 60000).length,
        requests: db.friends.filter((f) => (f.a === p.id || f.b === p.id) && f.status === 'pending' && f.requestedBy !== p.id).length,
        resets: epochs(p), configVersion: cfgVersion(db), role: p.role || 'player',
        resetEpoch: resetEpoch(db), resetDue: resetEpoch(db) > (p.resetAck || 0) && (p.createdAt || 0) < resetAt(db) ? resetEpoch(db) : null,
        createdAt: new Date(p.createdAt || 0).toISOString(),
      };
    },
    // ---------------------------------------------------------------- 003: gifts
    admin_gift({ p_code, p_to = null, p_all = false, p_kind, p_coins = null, p_payload = null, p_message = null, p_key = null, p_id = null, p_secret = null }) {
      const db = load();
      if (!keyOk(p_key)) return err('bad_key');
      if (p_key && db.adminOps[`gift:${p_key}`]) return { ...db.adminOps[`gift:${p_key}`], replay: true };
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      if (!!p_all === (p_to != null)) return err('bad_target');
      if (p_to != null && !db.profiles[p_to]) return err('not_found');
      let payload = {};
      if (p_kind === 'coins') { if (!Number.isInteger(p_coins) || p_coins < 1 || p_coins > 1e9) return err('bad_amount'); }
      else if (p_kind === 'pack') {
        const count = p_payload && p_payload.count != null ? p_payload.count : 1;
        if (!p_payload || typeof p_payload.packId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(p_payload.packId) || !Number.isInteger(count) || count < 1 || count > 50) return err('bad_pack');
        payload = { packId: p_payload.packId, count };
      } else if (p_kind === 'card') {
        const c = giftCard(p_payload && p_payload.card, a === 'super');
        if (!c) return err(a !== 'super' && p_payload && p_payload.card && Number(p_payload.card.ovr) > 99 ? 'needs_super' : 'bad_card');
        payload = { card: c };
      } else return err('bad_kind');
      if (!hit(db, `gift:${a}:${p_id || 'ip'}`, 3600000, 300)) { store.save(db); return err('rate_limited'); }
      const g = { id: uuid(rand), toId: p_to, kind: p_kind, coins: p_kind === 'coins' ? p_coins : 0, payload, message: cleanText(p_message, 200) || null, by: a, at: now(), until: now() + 14 * DAY };
      db.gifts.push(g);
      const res = { ok: true, giftId: g.id };
      if (p_key) db.adminOps[`gift:${p_key}`] = res;
      audit(db, p_to, 'admin_gift', { gift: g.id, kind: p_kind, all: p_to == null, by: a });
      store.save(db);
      return res;
    },
    gifts_inbox({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      return { ok: true, items: myGifts(db, p).sort((x, y) => y.at - x.at).slice(0, 50).map(giftJson) };
    },
    claim_gift({ p_id, p_secret, p_gift }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const g = db.gifts.find((x) => x.id === p_gift);
      if (!g || !(g.toId === p.id || g.toId == null)) return err('not_found');
      if (g.until <= now()) return err('expired');
      if (claimed(db, g.id, p.id)) return err('already_claimed');
      db.giftClaims.push({ giftId: g.id, profileId: p.id, at: now() });
      if (g.kind === 'coins') p.coins = Math.min(p.coins + g.coins, 1e12);
      audit(db, p.id, 'gift_claim', { gift: g.id, kind: g.kind });
      store.save(db);
      return { ...giftJson(g), ok: true, balance: p.coins };
    },
    // ---------------------------------------------------------------- 003: players, messages, squads
    find_player({ p_query }) {
      const db = load();
      const q = String(p_query ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (q.length < 2 || q.length > 40) return err('bad_query');
      const k = usernameKey(q), code = q.toUpperCase().replace(/-/g, '');
      const items = Object.values(db.profiles).filter((p) => !isBanned(p) && ((p.username && k && usernameKey(p.username).startsWith(k)) || p.friendCode === code))
        .sort((a, b) => ((b.username && usernameKey(b.username) === k) - (a.username && usernameKey(a.username) === k)) || (b.lastSeen || 0) - (a.lastSeen || 0))
        .slice(0, 10).map(publicRow);
      return { ok: true, items };
    },
    send_message({ p_id, p_secret, p_to, p_body = '', p_image = null }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!p.username) return err('no_account');
      const o = db.profiles[p_to];
      if (!o || o.id === p.id || blocked(db, p.id, o.id)) return err('not_found');
      const body = cleanText(p_body, 300);
      if (!body && p_image == null) return err('empty');
      if (p_image != null && (typeof p_image !== 'string' || p_image.length > 204860 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(p_image))) return err('bad_image');
      if (!hit(db, `msg:${p.id}`, 600000, 20) || !hit(db, `msgday:${p.id}`, DAY, 300) || (p_image != null && !hit(db, `msgimg:${p.id}`, DAY, 20))) { store.save(db); return err('rate_limited'); }
      const id = ++db.msgSeq;
      db.messages.push({ id, fromId: p.id, toId: o.id, body, image: p_image, at: now(), readAt: null });
      if (db.messages.length > 3000) db.messages.splice(0, db.messages.length - 3000);
      store.save(db);
      return { ok: true, id };
    },
    list_conversations({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const last = new Map();
      for (const m of db.messages) {
        if (m.fromId !== p.id && m.toId !== p.id) continue;
        const other = m.fromId === p.id ? m.toId : m.fromId;
        if (!last.has(other) || last.get(other).id < m.id) last.set(other, m);
      }
      const items = [...last.entries()].sort((a, b) => b[1].id - a[1].id).slice(0, 30).filter(([o]) => db.profiles[o]).map(([o, m]) => ({
        with: publicRow(db.profiles[o]), lastText: m.body, lastImage: m.image != null, lastMine: m.fromId === p.id, at: new Date(m.at).toISOString(),
        unread: db.messages.filter((x) => x.toId === p.id && x.fromId === o && !x.readAt).length,
      }));
      return { ok: true, items };
    },
    get_messages({ p_id, p_secret, p_with, p_before = null }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const o = db.profiles[p_with];
      if (!o) return err('not_found');
      for (const m of db.messages) if (m.toId === p.id && m.fromId === o.id && !m.readAt) m.readAt = now();
      store.save(db);
      const items = db.messages.filter((m) => ((m.fromId === p.id && m.toId === o.id) || (m.fromId === o.id && m.toId === p.id)) && (p_before == null || m.id < p_before))
        .sort((a, b) => b.id - a.id).slice(0, 30).reverse()
        .map((m) => ({ id: m.id, mine: m.fromId === p.id, text: m.body, image: m.image, at: new Date(m.at).toISOString(), read: !!m.readAt }));
      return { ok: true, with: publicRow(o), items };
    },
    set_squad({ p_id, p_secret, p_squad }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!isObj(p_squad)) return err('bad_squad');
      if (JSON.stringify(p_squad).length > 20480) return err('too_large');
      if (!hit(db, `squad:${p.id}`, 3600000, 60)) { store.save(db); return err('rate_limited'); }
      db.squads[p.id] = { squad: JSON.parse(JSON.stringify(p_squad)), at: now() };
      store.save(db);
      return { ok: true };
    },
    view_squad({ p_query }) {
      const db = load();
      const o = findProfile(db, p_query);
      if (!o || isBanned(o)) return err('not_found');
      const s = db.squads[o.id];
      if (!s) return { ok: false, error: 'no_squad', owner: publicRow(o) };
      return { ok: true, owner: publicRow(o), squad: s.squad, updatedAt: new Date(s.at).toISOString() };
    },
    // ---------------------------------------------------------------- 003: account changes
    change_username({ p_id, p_secret, p_username, p_password, p_admin_code = null }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!p.username || !p.pwHash) return err('no_account');
      if (!passOk(p, p_password)) return err('bad_credentials');
      const u = String(p_username ?? '').trim();
      const e = usernameError(u);
      if (e) return err(e);
      let role = p.role || 'player';
      if (isReservedName(u) && role !== 'owner') { if (!adminOk(db, p_admin_code)) { store.save(db); return err('reserved_username'); } role = 'owner'; }
      if (Object.values(db.profiles).some((x) => x.id !== p.id && x.username && usernameKey(x.username) === usernameKey(u))) return err('username_taken');
      if (!hit(db, `rename:${p.id}`, DAY, 5)) { store.save(db); return err('rate_limited'); }
      const from = p.username;
      Object.assign(p, { username: u, name: u, role });
      audit(db, p.id, 'rename', { from, to: u });
      store.save(db);
      return { ok: true, username: p.username, name: p.name, role: p.role };
    },
    change_password({ p_id, p_secret, p_password, p_new }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!p.username || !p.pwHash) return err('no_account');
      if (!passOk(p, p_password)) return err('bad_credentials');
      const e = passwordError(p_new, p.username);
      if (e) return err(e);
      p.pwHash = fnv(`pw:${p_new}`);
      const h = fnv(`s:${p_secret}`);
      db.sessions = db.sessions.filter((x) => x.profileId !== p.id || x.tokenHash === h);
      store.save(db);
      return { ok: true };
    },
    // ---------------------------------------------------------------- 003: post-match rewards
    match_reward(args) {
      const r = fns.report_result(args);
      const db = load();
      const mult = Math.max(0, Math.min(10, cfgNum(db, 'rewards', 'multiplier', 1)));
      if (!r || r.ok !== true || r.capped) return { ...r, pack: null, multiplier: mult };
      const p = db.profiles[args.p_id];
      const base = r.coinsAwarded;
      const extra = Math.floor(base * mult) - base;
      if (extra) { p.coins = Math.max(0, p.coins + extra); store.save(db); }
      const chance = Math.max(0, Math.min(1, cfgNum(db, 'rewards', 'packChance', 0.06))) * (args.p_won ? 1 : args.p_drawn ? 0.6 : 0.35);
      let pack = null;
      if (rand() < chance) { const x = rand(); pack = x < 0.55 ? 'gold' : x < 0.85 ? 'premium' : x < 0.97 ? 'rare' : 'stars'; }
      return { ...r, coinsAwarded: base + extra, coins: p.coins, pack, multiplier: mult };
    },

    // ---------------------------------------------------------------- 004: reset everyone, admin players, cloud save
    admin_reset_everyone({ p_code, p_id = null, p_secret = null }) {
      const db = load();
      const a = actor(db, p_code, p_id, p_secret);
      if (!ownerPower(a)) { store.save(db); return powerErr(a); }
      if (!hit(db, 'reset_all', 3600000, 10)) { store.save(db); return err('rate_limited'); }
      const t = now();
      const epoch = Math.max(Math.ceil(t / 1000), resetEpoch(db) + 1);
      db.configAt = Math.max(t, (db.configAt || 0) + 1);
      db.config.features = { value: { ...features(db), resetEpoch: epoch, resetAtMs: t }, at: db.configAt, by: a };
      let n = 0;
      for (const p of Object.values(db.profiles)) if ((p.createdAt || 0) <= t) { Object.assign(p, { coins: 5000, infinite: false, earnHourCoins: 0, earnDayCoins: 0 }); n++; }
      store.save(db);
      return { ok: true, epoch, affected: n };
    },
    ack_reset({ p_id, p_secret, p_epoch }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!Number.isInteger(p_epoch) || p_epoch < 0 || p_epoch > resetEpoch(db)) return err('bad_value');
      p.resetAck = Math.max(p.resetAck || 0, p_epoch);
      store.save(db);
      return { ok: true, ack: p.resetAck };
    },
    admin_players({ p_code, p_query = null, p_limit = 50, p_offset = 0, p_id = null, p_secret = null }) {
      const db = load();
      const a = actor(db, p_code, p_id, p_secret);
      if (!a) { store.save(db); return err('not_admin'); }
      const q = String(p_query ?? '').trim().toLowerCase();
      if (q.length > 40) return err('bad_query');
      const k = usernameKey(q);
      const club = (p) => (db.squads[p.id] && typeof db.squads[p.id].squad.name === 'string' ? db.squads[p.id].squad.name.slice(0, 32) : null);
      const rows = Object.values(db.profiles).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.username && k && usernameKey(p.username).includes(k))
        || p.friendCode === q.toUpperCase().replace(/-/g, '') || p.id === q || (club(p) || '').toLowerCase().includes(q))
        .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
      const lim = Math.min(Math.max(p_limit | 0, 1), 200), off = Math.max(p_offset | 0, 0);
      return {
        ok: true, total: rows.length,
        items: rows.slice(off, off + lim).map((p) => ({ id: p.id, username: p.username || null, name: p.name, clubName: club(p), coins: p.coins, role: p.role || 'player', banned: isBanned(p),
          friendCode: p.friendCode, createdAt: new Date(p.createdAt || 0).toISOString(), lastSeenAt: p.lastSeen ? new Date(p.lastSeen).toISOString() : null, online: (p.lastSeen || 0) > now() - 60000 })),
      };
    },
    save_get({ p_id, p_secret }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      const sv = db.saves[p.id];
      return sv ? { ok: true, exists: true, rev: sv.rev, updatedAt: new Date(sv.at).toISOString(), data: JSON.parse(JSON.stringify(sv.data)) } : { ok: true, exists: false, rev: 0 };
    },
    save_put({ p_id, p_secret, p_data, p_rev }) {
      const db = load();
      const p = auth(db, p_id, p_secret);
      if (!p) return err('auth');
      if (!p.username) return err('no_account');
      if (!isObj(p_data)) return err('bad_value');
      if (JSON.stringify(p_data).length > 1572864) return err('too_large');
      if (!hit(db, `save:${p.id}`, 3600000, 240)) { store.save(db); return err('rate_limited'); }
      const cur = db.saves[p.id];
      if ((cur ? cur.rev : 0) !== p_rev) return { ok: false, error: 'conflict', rev: cur ? cur.rev : 0 };
      db.saves[p.id] = { data: JSON.parse(JSON.stringify(p_data)), rev: (cur ? cur.rev : 0) + 1, at: now() };
      store.save(db);
      return { ok: true, rev: db.saves[p.id].rev };
    },
  };

  return {
    /** Same shape as the real RPC layer: -> { ok:true, data } | { ok:false, error } */
    async call(fn, args = {}) {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      if (down || this.down) return { ok: false, error: 'offline' };
      const f = fns[fn];
      if (!f) return { ok: false, error: 'unknown_function' };
      try { return { ok: true, data: f(args || {}) }; } catch (e) {
        if (e && e.ban) return { ok: false, error: 'banned', ban: e.ban };
        return { ok: false, error: String(e.message || e) };
      }
    },
    /** Test helper: set the mock admin code (hash kept only in the mock store). */
    setAdminCode(code) { const db = load(); db.adminHash = fnv(`admin:${code}`); store.save(db); },
    /** Test helper: set the mock 'full' / 'super' codes. */
    setAdminCodes({ full, super: sup } = {}) { const db = load(); if (full) db.adminHash = fnv(`admin:${full}`); if (sup) db.adminHashSuper = fnv(`admin:${sup}`); store.save(db); },
    hasAdminCodes() { const db = load(); return !!db.adminHash; },
    /** Test helper: set a profile's role directly (like the owner running SQL). */
    setRole(id, role) { const db = load(); if (db.profiles[id]) { db.profiles[id].role = role; store.save(db); } },
    reset() { store.save(fresh()); },
    down,
  };
}
