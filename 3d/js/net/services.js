// Pitchside 3D — online services (Supabase backend): profile, coins, transfer market,
// matchmaking (quick search + code rooms), result rewards, admin check.
//
// Contract (docs/3D_CONTRACT.md "Online services"): every function returns a Promise and never
// throws to the caller — offline / unconfigured / unexpected data resolve { ok:false, error }.
//
// Identity: an account session (username + password -> random 32-byte session token, migration 002)
// or, for older installs, an anonymous device secret. Either is sent as p_secret; the server stores
// only sha256 and checks (id, secret) on every call. No Supabase Auth.
//
// ?mockOnline=1 swaps the backend for an in-browser mock (mockbackend.js) and the transport for
// BroadcastChannel so two tabs can matchmake without network. ?mockOnline=1&mockDown=1 = offline.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { createTransport } from './transport.js';
import { createMatchmaker, randomPeerId } from './matchmaker.js';
import { createMockBackend, webStore } from './mockbackend.js';
import { cleanStr } from './protocol.js';
import {
  SECRET_RE, UUID_RE, validateListingInput, normalizeSearch, sanitizeListingItem, sanitizeMyListing, sanitizeList,
  sanitizeProfile, sanitizeReport, normalizeReport, sanitizeCard, errorText,
  sanitizeRivalsStatus, sanitizeRivalsClaim, sanitizeFriend, sanitizeIncomingInvite, sanitizeOutgoingInvite, parseInviteAccept,
  normalizeFriendCode, FRIEND_CODE_RE, INVITE_MODES, TOKEN_RE, cleanJson, roleOf,
} from './validate.js';
import { usernameError, passwordError, parseBan, banActive, banText, isReservedName, trimUsername } from './accountcore.js';
import {
  nonNeg, PACK_RE, JPEG_RE, MAX_IMAGE_CHARS, CONFIG_KEYS, CONFIG_TTL_MS, sanitizeConfigValue, sanitizeConfig, sanitizeEpochs, sanitizeBroadcast,
  sanitizePresence, sanitizeGift, sanitizePublicPlayer, sanitizeConversation, sanitizeMessage, cleanSquad, compressImage,
} from './onlinevalidate.js';

export const OFFLINE_SIGNUP_MSG = 'Online services are offline — you can play offline now and your account will be created when online is back.';
const MATCH_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(owner|mod)\.[0-9]{9,11}\.[0-9a-f]{64}$/;
const BIND_RE = /^[A-Za-z0-9_-]{1,64}$/;
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

const RPC_TIMEOUT_MS = 8000;
const INVITE_TTL_MS = 60000;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}
const AVAILABLE_TTL_MS = 20000;

function randomSecret() {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ Supabase RPC layer
let sbLoad = null;
function loadSupabaseClient() {
  if (sbLoad) return sbLoad;
  sbLoad = new Promise((resolve, reject) => {
    const make = () => {
      try {
        resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }));
      } catch (e) { reject(e); }
    };
    if (window.supabase && window.supabase.createClient) { make(); return; }
    const s = document.createElement('script');
    s.src = new URL('../../vendor/supabase.js', import.meta.url).href;
    s.async = true;
    s.onload = () => (window.supabase && window.supabase.createClient ? make() : reject(new Error('supabase-js did not initialise')));
    s.onerror = () => reject(new Error('Could not load supabase-js'));
    document.head.appendChild(s);
  }).catch((e) => { sbLoad = null; throw e; });
  return sbLoad;
}

/** Real backend: rpc('get_profile', {...}) -> { ok:true, data } | { ok:false, error } */
export async function supabaseRpc(fn, args) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, error: 'not_configured' };
  let client;
  try { client = await loadSupabaseClient(); } catch { return { ok: false, error: 'offline' }; }
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer;
  try {
    let q = client.rpc(`pitchside_${fn}`, args || {});
    if (ac && q.abortSignal) q = q.abortSignal(ac.signal);
    const res = await Promise.race([
      q,
      new Promise((resolve) => { timer = setTimeout(() => { if (ac) ac.abort(); resolve({ data: null, error: { message: 'timeout', code: 'timeout' } }); }, RPC_TIMEOUT_MS); }),
    ]);
    if (res.error) {
      const m = String(res.error.message || '');
      if (m === 'banned' || res.error.hint === 'pitchside_banned') return { ok: false, error: 'banned', ban: parseBan(res.error.details) };
      const code = res.error.code === 'timeout' ? 'timeout' : /rate limited/i.test(m) ? 'rate_limited' : /fetch|network|Failed/i.test(m) ? 'offline' : 'server_error';
      return { ok: false, error: code };
    }
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, error: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ service factory
/**
 * @param {object} deps
 *   rpc(fn, args)          -> Promise<{ok, data}|{ok:false, error}>
 *   storage                -> Web Storage-like object for the device identity
 *   identityKey            -> storage key
 *   transportKind          -> 'peer' | 'bc' | 'loopback'
 *   peerCfg()              -> PeerJS server options
 *   getName()              -> default display name
 *   matchmakerConfig       -> overrides for MM_DEFAULTS (tests)
 */
export function createOnline(deps) {
  const volatileFallback = memStore();
  const rpc = async (fn, args) => {
    try { return await deps.rpc(fn, args); } catch { return { ok: false, error: 'offline' }; }
  };
  const storage = deps.storage;
  const KEY = deps.identityKey || 'pitchside.online.identity';
  let avail = { at: -Infinity, value: false, pending: null };
  let identP = null;
  // Admin: a server-signed 12 h token ("adm.<level>.<exp>.<sig>", migration 003) kept in session storage —
  // never the code. Legacy servers (no admin_login) keep the verified code in memory only.
  const ADM_KEY = `${deps.accountKey || 'pitchside.account'}.admin`;
  const ADM_RE = /^adm\.(full|super)\.[0-9]{9,11}\.[0-9a-f]{64}$/;
  let adminCode = null;
  const readAdm = () => {
    try {
      const v = JSON.parse(sget(deps.volatileStorage || volatileFallback, ADM_KEY) || 'null');
      if (v && typeof v.token === 'string' && ADM_RE.test(v.token) && Number(v.exp) * 1000 > Date.now()) return { token: v.token, level: v.level === 'super' ? 'super' : 'full', exp: Number(v.exp) };
    } catch { /* ignore */ }
    return null;
  };
  const adminSecret = () => { const a = readAdm(); return a ? a.token : adminCode; };
  const adminLevelNow = () => { const a = readAdm(); return a ? a.level : adminCode ? 'full' : null; };

  const readIdent = () => {
    try {
      const v = JSON.parse(storage.getItem(KEY) || 'null');
      if (v && typeof v === 'object' && typeof v.secret === 'string' && SECRET_RE.test(v.secret)) {
        return { secret: v.secret, id: typeof v.id === 'string' && UUID_RE.test(v.id) ? v.id : null };
      }
    } catch { /* ignore */ }
    return null;
  };
  const writeIdent = (v) => { try { storage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } };

  // ---------------------------------------------------------------- account session (migration 002)
  // Remembered sessions live in `storage` (localStorage); others in `volatileStorage` (sessionStorage).
  const ACC_KEY = deps.accountKey || 'pitchside.account';
  const PENDING_KEY = `${ACC_KEY}.pending`;
  const GUEST_KEY = `${ACC_KEY}.guest`;
  const volatile = deps.volatileStorage || volatileFallback;
  const requireAccount = deps.requireAccount === true;
  let nameSyncTried = false;
  const accListeners = new Set();
  let pendingCreds = null; // offline sign-up kept in memory only (never persisted with the password)
  const sget = (st, k) => { try { return st.getItem(k); } catch { return null; } };
  const sset = (st, k, v) => { try { st.setItem(k, v); } catch { /* ignore */ } };
  const sdel = (st, k) => { try { st.removeItem(k); } catch { /* ignore */ } };
  function readAcc() {
    for (const st of [volatile, storage]) {
      try {
        const v = JSON.parse(sget(st, ACC_KEY) || 'null');
        if (v && typeof v === 'object' && typeof v.id === 'string' && UUID_RE.test(v.id) && typeof v.token === 'string' && SECRET_RE.test(v.token)) {
          return {
            id: v.id, token: v.token, username: cleanStr(v.username, 16, 'Player'), role: roleOf(v.role), remember: v.remember !== false,
            ban: v.ban && typeof v.ban === 'object' ? parseBan(v.ban) : null,
          };
        }
      } catch { /* ignore */ }
    }
    return null;
  }
  function writeAcc(a) {
    const rec = JSON.stringify({ id: a.id, token: a.token, username: a.username, role: a.role || null, remember: a.remember !== false, ban: a.ban || null });
    if (a.remember !== false) { sset(storage, ACC_KEY, rec); sdel(volatile, ACC_KEY); } else { sset(volatile, ACC_KEY, rec); sdel(storage, ACC_KEY); }
  }
  function clearAcc() { sdel(storage, ACC_KEY); sdel(volatile, ACC_KEY); identP = null; }
  const readPending = () => { try { const v = JSON.parse(sget(storage, PENDING_KEY) || 'null'); return v && typeof v.username === 'string' ? { username: cleanStr(v.username, 16, ''), at: Number(v.at) || 0 } : null; } catch { return null; } };
  const emitAcc = () => { const c = online.account.current(); for (const f of [...accListeners]) { try { f(c); } catch (e) { console.error('[online] account listener failed', e); } } };
  function setBan(ban) {
    const a = readAcc();
    if (a) { a.ban = ban ? parseBan(ban) : null; writeAcc(a); emitAcc(); }
  }
  function acceptSession(d, remember, fallbackName) {
    if (!d || d.ok !== true || typeof d.id !== 'string' || !UUID_RE.test(d.id) || typeof d.session_token !== 'string' || !SECRET_RE.test(d.session_token)) return null;
    const a = { id: d.id, token: d.session_token, username: cleanStr(d.username, 16, fallbackName || 'Player'), role: roleOf(d.role), remember: remember !== false, ban: null };
    writeAcc(a);
    identP = null;
    pendingCreds = null;
    sdel(storage, PENDING_KEY);
    return a;
  }

  /** -> {id, secret, account?} | null. Account session first; else the device identity (registered on first use unless requireAccount). */
  function identity({ reset = false } = {}) {
    const acc = readAcc();
    if (acc) return Promise.resolve({ id: acc.id, secret: acc.token, account: true });
    if (requireAccount) { const d = readIdent(); return Promise.resolve(d && d.id ? d : null); }
    if (identP && !reset) return identP;
    identP = (async () => {
      let v = reset ? null : readIdent();
      if (v && v.id) return v;
      if (!v) { v = { secret: randomSecret(), id: null }; writeIdent(v); }
      const r = await rpc('register', { p_secret: v.secret, p_name: cleanStr(deps.getName ? deps.getName() : '', 16, 'Player') });
      if (!r.ok || typeof r.data !== 'string' || !UUID_RE.test(r.data)) return null;
      v = { secret: v.secret, id: r.data };
      writeIdent(v);
      return v;
    })().then((v) => { if (!v) identP = null; return v; }, () => { identP = null; return null; });
    return identP;
  }

  /**
   * Authenticated call. Banned accounts are refused locally (cached ban) and by the server ('banned').
   * An expired / revoked session logs the account out; a legacy device identity re-registers once.
   */
  async function authed(fn, args = {}) {
    const acc = readAcc();
    if (acc && banActive(acc.ban)) return { ok: false, error: 'banned', ban: acc.ban };
    let ident = await identity();
    if (!ident) return { ok: false, error: requireAccount ? 'no_account' : (await isAvailable()) ? 'auth' : 'offline' };
    let r = await rpc(fn, { p_id: ident.id, p_secret: ident.secret, ...args });
    if (!r.ok && r.error === 'banned') { setBan(r.ban); return { ok: false, error: 'banned', ban: r.ban ? parseBan(r.ban) : null }; }
    if (r.ok && r.data && r.data.ok === false && r.data.error === 'auth') {
      if (ident.account) { clearAcc(); emitAcc(); return { ok: false, error: 'auth' }; }
      if (requireAccount) return { ok: false, error: 'auth' };
      ident = await identity({ reset: true });
      if (!ident) return { ok: false, error: 'auth' };
      r = await rpc(fn, { p_id: ident.id, p_secret: ident.secret, ...args });
    }
    if (!r.ok) { avail = { at: -Infinity, value: false, pending: null }; return { ok: false, error: r.error }; }
    return { ok: true, data: r.data };
  }
  const fail = (error, extra) => ({ ok: false, error, message: error === 'banned' && extra && extra.ban ? banText(extra.ban) : errorText(error), ...(extra || {}) });
  const dataOr = (r) => (r.ok ? (r.data && typeof r.data === 'object' ? r.data : { ok: false, error: 'bad_response' }) : { ok: false, error: r.error, ...(r.ban ? { ban: r.ban } : {}) });

  async function isAvailable() {
    const t = Date.now();
    if (t - avail.at < AVAILABLE_TTL_MS) return avail.value;
    if (avail.pending) return avail.pending;
    avail.pending = rpc('ping', {}).then((r) => {
      avail = { at: Date.now(), value: !!(r.ok && r.data === true), pending: null };
      return avail.value;
    });
    return avail.pending;
  }

  /** Like isAvailable(), but re-pings when the cached answer is "down" (user actions / retries). */
  const freshAvailable = () => { if (!avail.value && !avail.pending) avail.at = -Infinity; return isAvailable().catch(() => false); };

  const makeTransport = () => createTransport(deps.transportKind || 'peer', (deps.transportKind || 'peer') === 'peer' && deps.peerCfg ? deps.peerCfg() : undefined);
  const matchmaker = createMatchmaker({
    rpc, identity: () => identity(), createTransport: makeTransport, config: deps.matchmakerConfig,
  });
  const invitePollMs = deps.invitePollMs || 2000;
  let challengeJob = null;

  const configured = deps.configured !== false;
  const online = {
    available: () => isAvailable().catch(() => false),
    /** -> { online, reason: null | 'not_configured' | 'unreachable', message } (for the UI) */
    async status() {
      if (!configured) return { online: false, reason: 'not_configured', message: 'Online services are not set up yet (no server key configured).' };
      const up = await isAvailable().catch(() => false);
      return up ? { online: true, reason: null, message: '' }
        : { online: false, reason: 'unreachable', message: 'The online server is unreachable right now (it may be paused for maintenance, or your connection is down).' };
    },

    /** true once this device has an online profile (no network; used to avoid creating profiles just by browsing). */
    hasIdentity() { if (readAcc()) return true; const v = readIdent(); return !!(v && v.id); },

    async profile() {
      const r = dataOr(await authed('get_profile'));
      const p = sanitizeProfile(r);
      // Until accounts are used, name the profile after the local UT club so the owner can tell players apart.
      if (p && p.name === 'Player' && deps.getName) {
        const want = cleanStr(deps.getName(), 16, '');
        if (want && want !== 'Player' && !nameSyncTried) {
          nameSyncTried = true;
          const s = dataOr(await authed('set_name', { p_name: want }));
          if (s.ok === true) p.name = cleanStr(s.name, 16, want);
        }
      }
      return p || fail(r.error || 'bad_response', r.ban ? { ban: r.ban } : undefined);
    },

    async setName(name) {
      const n = cleanStr(name, 16, '');
      if (!n) return fail('bad_name');
      const r = dataOr(await authed('set_name', { p_name: n }));
      return r.ok === true ? { ok: true, name: cleanStr(r.name, 16, n) } : fail(r.error);
    },

    market: {
      async list(card, price) {
        const v = validateListingInput(card, price);
        if (!v.ok) return fail(v.error);
        const r = dataOr(await authed('list_card', { p_card: v.card, p_price: v.price }));
        if (r.ok !== true || typeof r.listingId !== 'string' || !UUID_RE.test(r.listingId)) return fail(r.error || 'bad_response');
        return { ok: true, listingId: r.listingId };
      },
      async search(filters = {}) {
        const r = dataOr(await rpc('search_listings', normalizeSearch(filters)));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        return { ok: true, items: sanitizeList(r.items, sanitizeListingItem, 20), page: Number.isInteger(r.page) ? r.page : 0 };
      },
      async buy(listingId) {
        if (typeof listingId !== 'string' || !UUID_RE.test(listingId)) return fail('not_found');
        const r = dataOr(await authed('buy', { p_listing: listingId }));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        const card = sanitizeCard(r.card);
        if (!card) return fail('bad_response');
        emitCoins(nonNeg(r.coins));
        return { ok: true, card, price: Number(r.price) || 0, coins: Number(r.coins) || 0 };
      },
      async mine() {
        const r = dataOr(await authed('my_listings'));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        return { ok: true, items: sanitizeList(r.items, sanitizeMyListing, 100) };
      },
      async cancel(listingId) {
        if (typeof listingId !== 'string' || !UUID_RE.test(listingId)) return fail('not_cancellable');
        const r = dataOr(await authed('cancel_listing', { p_listing: listingId }));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        const card = sanitizeCard(r.card);
        return card ? { ok: true, card } : fail('bad_response');
      },
      async claimSales() {
        const r = dataOr(await authed('claim_sales'));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
        return { ok: true, coins: n(r.coins), count: n(r.count), balance: n(r.balance) };
      },
    },

    // One model: when online, the server balance IS the UT balance. Every change is one atomic RPC with an
    // idempotency key (network retries never double-apply). Offline callers use their local balance.
    coins: {
      async get() {
        const r = dataOr(await authed('coins_get'));
        if (r.ok === true) { emitCoins(nonNeg(r.coins)); return { ok: true, coins: nonNeg(r.coins), infinite: r.infinite === true }; }
        if (r.error === 'server_error') { const p = await online.profile(); return p.ok ? { ok: true, coins: p.coins, infinite: false } : p; } // pre-003 server
        return fail(r.error || 'bad_response', r.ban ? { ban: r.ban } : undefined);
      },
      /** -> { ok, coins, applied } | insufficient_coins. Infinite wallets never fail (applied = 0). */
      async spend(amount, reason = 'ut-spend') {
        if (!Number.isInteger(amount) || amount <= 0 || amount > 1e8) return fail('bad_amount');
        return coinOp(-amount, reason);
      },
      /** -> { ok, coins, applied } — server caps earnings (applied may be lower than requested). */
      async earn(amount, reason = 'ut-earn') {
        if (!Number.isInteger(amount) || amount <= 0 || amount > 1e8) return fail('bad_amount');
        return coinOp(amount, reason);
      },
      /** fn(balance) whenever a server balance is seen (buy, coin ops, gifts, rewards, presence). -> unsubscribe */
      onChange(fn) { coinListeners.add(fn); return () => coinListeners.delete(fn); },
      /** Compat: negative = spend, positive = earn (capped). Admin top-ups: online.owner.giveCoins. */
      async add(delta, reason = '') {
        if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) return fail('bad_amount');
        const why = /^[a-z-]{1,24}$/.test(reason) ? reason : delta < 0 ? 'ut-spend' : 'ut-earn';
        if (delta > 0 && why === 'admin') return online.owner.giveCoins(null, delta);
        return delta < 0 ? online.coins.spend(-delta, why) : online.coins.earn(delta, why === 'ut-spend' ? 'ut-earn' : why);
      },
    },

    matchmaking: {
      /**
       * Find a random opponent. Resolves { ok, transport, role:'host'|'guest', opponent:{name, rating}, token }.
       * `onProgress({ state, elapsedMs, opponent? })` drives the searching UI.
       */
      async quickSearch({ mode, team, onProgress } = {}) {
        const acc = readAcc();
        if (acc && banActive(acc.ban)) return { ...fail('banned', { ban: acc.ban }), reason: 'banned' };
        if (requireAccount && !acc && !online.hasIdentity()) return { ...fail('no_account'), reason: 'no_account' };
        if (!(await isAvailable())) return fail(SUPABASE_KEY || deps.mock ? 'offline' : 'not_configured');
        const r = await matchmaker.search({ mode, onProgress });
        if (!r.ok) {
          const reason = r.cancelled ? 'cancelled' : r.error === 'timeout' ? 'no_opponent' : r.error;
          return { ...r, reason, message: r.cancelled ? 'Search cancelled.' : r.error === 'timeout' ? 'No opponent found. Try again in a moment.' : r.message || errorText(r.error) };
        }
        return { ...r, mode, team };
      },
      cancelSearch() { matchmaker.cancel(); return Promise.resolve({ ok: true }); },
      get state() { return matchmaker.state; },
    },

    /** PeerJS 5-letter code rooms (no backend needed). */
    async hostWithCode() {
      const t = makeTransport();
      try { const code = await t.host(); return { ok: true, transport: t, code, role: 'host' }; } catch (e) { try { t.close(); } catch { /* ignore */ } return { ok: false, error: 'connect_failed', message: e.message }; }
    },
    async joinWithCode(code) {
      const t = makeTransport();
      try { await t.join(code); return { ok: true, transport: t, role: 'guest' }; } catch (e) { try { t.close(); } catch { /* ignore */ } return { ok: false, error: 'connect_failed', message: e.message }; }
    },

    async reportResult(x) {
      const v = normalizeReport(x);
      if (!v.ok) return fail(v.error);
      return sanitizeReport(dataOr(await authed('report_result', v.args)));
    },

    // ---------------------------------------------------------------- Rivals (ranked UT)
    rivals: {
      async status() {
        const r = dataOr(await authed('rivals_status'));
        return sanitizeRivalsStatus(r) || fail(r.error || 'bad_response');
      },
      /** Once per finished week. -> { ok, coins (already added server-side), packs:[packId], balance } */
      async claimWeekly() {
        const r = dataOr(await authed('rivals_claim_weekly'));
        return sanitizeRivalsClaim(r) || fail(r.error || 'bad_response');
      },
    },

    // ---------------------------------------------------------------- friends + challenges
    friends: {
      /** -> { ok, code, items:[{ id, name, status:'friend'|'incoming'|'outgoing'|'blocked', online, rating, division, rivalsDivision }] } */
      async list() {
        const r = dataOr(await authed('list_friends'));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        return { ok: true, code: typeof r.code === 'string' && FRIEND_CODE_RE.test(r.code) ? r.code : null, items: sanitizeList(r.items, sanitizeFriend, 250) };
      },
      async code() {
        const p = await online.profile();
        return p.ok ? { ok: true, code: p.friendCode } : p;
      },
      /** Send a request by friend code (or accept theirs if they already asked). */
      async add(code) {
        const c = normalizeFriendCode(code);
        if (!FRIEND_CODE_RE.test(c)) return fail('bad_code');
        const r = dataOr(await authed('add_friend', { p_code: c }));
        if (r.ok !== true) return { ...fail(r.error || 'bad_response'), ...(r.error === 'not_found' ? { message: 'No player has that friend code.' } : {}) };
        return { ok: true, status: r.status === 'friend' ? 'friend' : 'outgoing', name: cleanStr(r.friend && r.friend.name, 16, 'Player') };
      },
      async respond(friendId, action) {
        if (typeof friendId !== 'string' || !UUID_RE.test(friendId)) return fail('not_found');
        if (!['accept', 'decline', 'remove', 'block', 'unblock'].includes(action)) return fail('bad_action');
        const r = dataOr(await authed('respond_friend', { p_friend: friendId, p_action: action }));
        return r.ok === true ? { ok: true } : fail(r.error || 'bad_response');
      },
      accept(id) { return online.friends.respond(id, 'accept'); },
      decline(id) { return online.friends.respond(id, 'decline'); },
      remove(id) { return online.friends.respond(id, 'remove'); },
      block(id) { return online.friends.respond(id, 'block'); },
      unblock(id) { return online.friends.respond(id, 'unblock'); },
      async heartbeat() {
        const r = dataOr(await authed('heartbeat'));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        const n = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 999) : 0);
        return { ok: true, invites: n(r.invites), requests: n(r.requests) };
      },
      /** Heartbeat + incoming invites + my outgoing invite statuses. */
      async pollInvites() {
        const r = dataOr(await authed('poll_invites'));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        return {
          ok: true, incoming: sanitizeList(r.incoming, sanitizeIncomingInvite, 10), outgoing: sanitizeList(r.outgoing, sanitizeOutgoingInvite, 20),
          requests: Number.isInteger(r.requests) && r.requests >= 0 ? Math.min(r.requests, 999) : 0,
        };
      },
      /**
       * Challenge a friend (inviter = host). Opens a listening peer, sends the invite and waits up to 60 s.
       * -> { ok, transport, role:'host', token, opponent:{name, rating}, mode } | { ok:false, error:'declined'|'expired'|'cancelled'|... }
       */
      async challenge(friendId, mode = 'friendly', { onProgress } = {}) {
        if (typeof friendId !== 'string' || !UUID_RE.test(friendId)) return fail('not_found');
        if (!INVITE_MODES.includes(mode)) return fail('bad_mode');
        if (challengeJob) challengeJob.cancelled = true;
        const job = { cancelled: false };
        challengeJob = job;
        const emit = (state, extra) => { if (onProgress) try { onProgress({ state, ...extra }); } catch { /* ignore */ } };
        let t = makeTransport();
        const done = (res) => { if (!res.ok && t) { try { t.close(); } catch { /* ignore */ } } if (challengeJob === job) challengeJob = null; return res; };
        try {
          emit('opening');
          await withTimeout(t.listen(randomPeerId()), 15000, 'Could not reach the connection server.');
          if (job.cancelled) return done(fail('cancelled'));
          const r = dataOr(await authed('send_invite', { p_friend: friendId, p_mode: mode, p_peer_id: t.code }));
          if (r.ok !== true || typeof r.inviteId !== 'string' || !UUID_RE.test(r.inviteId) || typeof r.token !== 'string' || !TOKEN_RE.test(r.token)) return done(fail(r.error || 'bad_response'));
          const t0 = Date.now();
          let errors = 0;
          while (Date.now() - t0 < INVITE_TTL_MS + 3000) {
            emit('waiting', { elapsedMs: Date.now() - t0, ttlMs: INVITE_TTL_MS });
            await sleepMs(invitePollMs);
            if (job.cancelled) { await authed('cancel_invite', { p_invite: r.inviteId }); return done(fail('cancelled')); }
            const pr = await online.friends.pollInvites();
            if (!pr.ok) { if (++errors >= 5) return done(fail(pr.error)); continue; }
            errors = 0;
            const mine = pr.outgoing.find((i) => i.inviteId === r.inviteId);
            if (!mine) continue;
            if (mine.status === 'accepted') {
              const f = await online.friends.list();
              const fr = f.ok ? f.items.find((x) => x.id === friendId) : null;
              const out = { ok: true, transport: t, role: 'host', token: r.token, mode, opponent: { name: fr ? fr.name : 'Friend', rating: fr ? fr.rating : null } };
              t = null;
              return done(out);
            }
            if (mine.status === 'declined') return done(fail('declined'));
            if (mine.status !== 'pending') return done(fail('expired'));
          }
          await authed('cancel_invite', { p_invite: r.inviteId });
          return done({ ...fail('expired'), message: 'Your friend did not answer in time.' });
        } catch (e) {
          return done({ ok: false, error: 'connect_failed', message: String((e && e.message) || e) });
        }
      },
      cancelChallenge() { if (challengeJob) challengeJob.cancelled = true; return Promise.resolve({ ok: true }); },
      /** Accept an incoming invite and connect to the inviter. -> { ok, transport, role:'guest', token, mode, opponent } */
      async acceptInvite(inviteId) {
        if (typeof inviteId !== 'string' || !UUID_RE.test(inviteId)) return fail('not_found');
        const r = parseInviteAccept(dataOr(await authed('respond_invite', { p_invite: inviteId, p_accept: true })));
        if (!r.ok) return fail(r.error);
        if (!r.accepted) return fail('unavailable');
        const t = makeTransport();
        try {
          await withTimeout(t.connectTo(r.peerId), 20000, 'Could not connect to your friend.');
        } catch (e) {
          try { t.close(); } catch { /* ignore */ }
          return { ok: false, error: 'connect_failed', message: e.message };
        }
        return { ok: true, transport: t, role: 'guest', token: r.token, mode: r.mode, opponent: r.from };
      },
      async declineInvite(inviteId) {
        if (typeof inviteId !== 'string' || !UUID_RE.test(inviteId)) return fail('not_found');
        const r = dataOr(await authed('respond_invite', { p_invite: inviteId, p_accept: false }));
        return r.ok === true ? { ok: true } : fail(r.error || 'bad_response');
      },
    },

    admin: {
      /** -> { ok, level:'super'|'full' } (server only; stores a 12 h admin token for owner RPCs). */
      async verifyLevel(code) {
        if (typeof code !== 'string' || !code || code.length > 128) return fail('invalid');
        const r = await rpc('admin_login', { p_code: code });
        if (r.ok && r.data && r.data.ok === true && typeof r.data.token === 'string' && ADM_RE.test(r.data.token)) {
          const level = r.data.level === 'super' ? 'super' : 'full';
          sset(volatile, ADM_KEY, JSON.stringify({ token: r.data.token, level, exp: Number(r.data.exp) || 0 }));
          adminCode = null;
          emitAcc();
          return { ok: true, level };
        }
        if (r.ok && r.data && r.data.ok === false) return fail(r.data.error || 'invalid');
        if (!r.ok && r.error === 'server_error') { // pre-003 server: boolean check, code kept in memory
          const v = await rpc('admin_verify', { p_code: code });
          if (v.ok && v.data === true) { adminCode = code; emitAcc(); return { ok: true, level: 'full' }; }
          return fail('invalid');
        }
        return fail(r.ok ? 'bad_response' : r.error);
      },
      /** Compat boolean check (same as verifyLevel().ok). */
      async verify(code) { return (await online.admin.verifyLevel(code)).ok === true; },
      /** Admin coins for yourself (compat). */
      addCoins(delta) { return online.owner.giveCoins(null, delta); },
      get verified() { return !!adminSecret(); },
      /** Server-verified code level this session: 'super' | 'full' | null */
      get codeLevel() { return adminLevelNow(); },
      forget() { adminCode = null; sdel(volatile, ADM_KEY); emitAcc(); },
      /** 'super' | 'full' (server-verified code) | 'owner' | 'mod' (account role) | null */
      get level() { return adminLevelNow() || staffRole(); },
      /** true when owner powers will be accepted (code token or owner account). */
      canOwner() { return !!adminSecret() || staffRole() === 'owner'; },
      /**
       * Short-lived (15 min) signed token proving this account is owner/mod, bound to the host's room
       * code / peer id (`bind`) so it cannot be replayed in another match. -> { ok, token, role, exp }
       */
      async matchToken(bind = null) {
        if (!staffRole()) return fail('not_allowed');
        if (bind != null && (typeof bind !== 'string' || !BIND_RE.test(bind))) return fail('bad_bind');
        const r = dataOr(await authed('admin_match_token', { p_bind: bind }));
        if (r.ok !== true || typeof r.token !== 'string' || !MATCH_TOKEN_RE.test(r.token)) return fail(r.error || 'bad_response');
        return { ok: true, token: r.token, role: roleOf(r.role), exp: Number(r.exp) || 0 };
      },
      /** Server check of a peer's token. -> { ok, profileId, role, exp } | { ok:false } */
      async verifyMatchToken(token, bind = null) {
        if (typeof token !== 'string' || !MATCH_TOKEN_RE.test(token)) return fail('invalid');
        if (bind != null && (typeof bind !== 'string' || !BIND_RE.test(bind))) return fail('invalid');
        const r = dataOr(await rpc('verify_admin_token', { p_token: token, p_bind: bind }));
        if (r.ok !== true || typeof r.profile_id !== 'string' || !UUID_RE.test(r.profile_id) || !roleOf(r.role)) return fail(r.error || 'invalid');
        return { ok: true, profileId: r.profile_id, role: roleOf(r.role), exp: Number(r.exp) || 0 };
      },
    },

    // ---------------------------------------------------------------- accounts (migration 002)
    account: {
      /**
       * Local view, no network: { state:'none'|'account'|'banned'|'offline', id, username, role, remember, ban, pending, hasDevice }
       * 'offline' = the player chose "play offline" and an account creation is queued.
       */
      current() {
        const a = readAcc();
        const pending = readPending();
        const d = readIdent();
        const hasDevice = !!(d && d.id);
        if (a) return { state: banActive(a.ban) ? 'banned' : 'account', id: a.id, username: a.username, role: a.role, remember: a.remember, ban: banActive(a.ban) ? a.ban : null, pending: null, hasDevice };
        return { state: pending ? 'offline' : 'none', id: null, username: null, role: null, remember: true, ban: null, pending, hasDevice };
      },
      /** Server check of the saved session (touches it; refreshes ban + role). -> { ok, online, ...current(), expired? } */
      async status() {
        const a = readAcc();
        if (!a) return { ok: true, online: await isAvailable().catch(() => false), ...online.account.current() };
        const r = await rpc('account_status', { p_id: a.id, p_secret: a.token });
        if (!r.ok) { if (r.error !== 'banned') avail = { at: -Infinity, value: false, pending: null }; return { ok: false, online: false, error: r.error, ...online.account.current() }; }
        const d = r.data && typeof r.data === 'object' ? r.data : {};
        if (d.ok === false && d.error === 'auth') { clearAcc(); emitAcc(); return { ok: true, online: true, expired: true, ...online.account.current() }; }
        if (d.ok !== true) return { ok: false, online: true, error: 'bad_response', ...online.account.current() };
        writeAcc({ ...a, username: cleanStr(d.username, 16, a.username), role: roleOf(d.role), ban: d.banned === true ? parseBan(d.ban) : null });
        avail = { at: Date.now(), value: true, pending: null };
        emitAcc();
        return { ok: true, online: true, ...online.account.current() };
      },
      /**
       * Create an account. With an unclaimed device profile on this device it is claimed instead (keeps
       * coins, rating, friends, listings). Offline -> queued: { ok:false, error:'offline', queued:true }.
       */
      async signup({ username, password, confirm, remember = true, adminCode = '', claim = null } = {}) {
        const u = trimUsername(username);
        const e = usernameError(u) || passwordError(password, u, confirm);
        if (e) return fail(e);
        const code = typeof adminCode === 'string' ? adminCode.slice(0, 128) : '';
        if (isReservedName(u) && !code) return fail('reserved_username');
        if (!(await freshAvailable())) {
          pendingCreds = { username: u, password, remember, adminCode: code };
          sset(storage, PENDING_KEY, JSON.stringify({ username: u, at: Date.now() }));
          emitAcc();
          return { ...fail('offline'), queued: true, message: OFFLINE_SIGNUP_MSG };
        }
        const d = readIdent();
        const useClaim = claim === null ? !!(d && d.id) : claim;
        let r;
        if (useClaim && d && d.id) {
          r = dataOr(await rpc('claim_profile', { p_id: d.id, p_secret: d.secret, p_username: u, p_password: password, p_admin_code: code || null }));
          if (r.ok === false && (r.error === 'auth' || r.error === 'already_has_account') && claim !== true) r = null; // device unknown / already claimed -> new account
          else if (r.ok === false && r.error === 'banned') return fail('banned', { ban: r.ban ? parseBan(r.ban) : null });
        } else if (claim === true) return fail('auth');
        if (!r) r = dataOr(await rpc('signup', { p_username: u, p_password: password, p_admin_code: code || null }));
        if (r.ok !== true) { if (r.error === 'offline' || r.error === 'timeout') avail = { at: -Infinity, value: false, pending: null }; return fail(r.error || 'bad_response'); }
        const a = acceptSession(r, remember, u);
        if (!a) return fail('bad_response');
        emitAcc();
        return { ok: true, id: a.id, username: a.username, role: a.role, claimed: !!(useClaim && d && d.id && r.id === d.id) };
      },
      /** Attach a username/password to this device's anonymous profile. */
      claim(opts = {}) { return online.account.signup({ ...opts, claim: true }); },
      async login({ username, password, remember = true } = {}) {
        const u = trimUsername(username);
        if (!u || typeof password !== 'string' || !password) return fail('bad_credentials');
        const r = dataOr(await rpc('login', { p_username: u, p_password: password }));
        if (r.ok !== true) {
          if (r.error === 'banned') return fail('banned', { ban: parseBan(r.ban) });
          if (r.error === 'offline' || r.error === 'timeout') avail = { at: -Infinity, value: false, pending: null };
          return fail(r.error || 'bad_response');
        }
        const a = acceptSession(r, remember, u);
        if (!a) return fail('bad_response');
        emitAcc();
        return { ok: true, id: a.id, username: a.username, role: a.role };
      },
      /** Ends the session on the server when reachable; always forgets it locally. */
      async logout({ all = false } = {}) {
        const a = readAcc();
        clearAcc();
        adminCode = null;
        sdel(volatile, ADM_KEY);
        emitAcc();
        if (a) await rpc('logout', { p_id: a.id, p_token: a.token, p_all: !!all });
        return { ok: true };
      },
      /** "Play offline" on the account screen: remembers the choice (and a queued username, if any). */
      continueOffline(username = '') {
        const u = trimUsername(username);
        sset(storage, PENDING_KEY, JSON.stringify({ username: usernameError(u) ? '' : u, at: Date.now() }));
        emitAcc();
      },
      pending: () => readPending(),
      /** Retry a queued offline sign-up (password kept in memory for this visit only). */
      async retryPending() {
        if (!pendingCreds || readAcc()) return { ok: false, error: 'nothing_pending' };
        if (!(await freshAvailable())) return fail('offline');
        const c = pendingCreds;
        return online.account.signup({ username: c.username, password: c.password, confirm: c.password, remember: c.remember, adminCode: c.adminCode });
      },
      get hasPendingCreds() { return !!pendingCreds; },
      /** Change the login name (display name follows). Needs the current password. */
      async changeUsername({ username, password, adminCode: code = '' } = {}) {
        const a = readAcc();
        if (!a) return fail('no_account');
        const u = trimUsername(username);
        const e = usernameError(u);
        if (e) return fail(e);
        if (typeof password !== 'string' || !password) return fail('bad_credentials');
        if (isReservedName(u) && a.role !== 'owner' && !code && !adminSecret()) return fail('reserved_username');
        const r = dataOr(await authed('change_username', { p_username: u, p_password: password, p_admin_code: (code && String(code).slice(0, 128)) || adminSecret() || null }));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        const cur = readAcc();
        if (cur) writeAcc({ ...cur, username: cleanStr(r.username, 16, u), role: roleOf(r.role) || cur.role });
        emitAcc();
        return { ok: true, username: cleanStr(r.username, 16, u), role: roleOf(r.role) };
      },
      /** Change the password (other devices are logged out). */
      async changePassword({ password, newPassword, confirm } = {}) {
        const a = readAcc();
        if (!a) return fail('no_account');
        if (typeof password !== 'string' || !password) return fail('bad_credentials');
        const e = passwordError(newPassword, a.username, confirm);
        if (e) return fail(e);
        const r = dataOr(await authed('change_password', { p_password: password, p_new: newPassword }));
        return r.ok === true ? { ok: true } : fail(r.error || 'bad_response');
      },
      /** "Continue as guest": the device profile keeps working; the account gate is not shown again. */
      guest() { sset(storage, GUEST_KEY, '1'); emitAcc(); },
      isGuest() { return !readAcc() && sget(storage, GUEST_KEY) === '1'; },
      onChange(fn) { accListeners.add(fn); return () => accListeners.delete(fn); },
      isReservedName,
      validateUsername: (u) => usernameError(u),
      validatePassword: (p, u, c) => passwordError(p, u, c),
    },

    // ---------------------------------------------------------------- moderation (owner/mod session or admin code)
    moderation: {
      /** 'admin' | 'owner' | 'mod' | null */
      get role() { return adminSecret() ? 'admin' : staffRole(); },
      canModerate() { return !!(adminSecret() || staffRole()); },
      async search(query, code) {
        const q = cleanStr(query, 40, '');
        if (!q) return fail('bad_query');
        const r = await modCall('mod_search', { p_query: q }, code);
        return r.ok ? { ok: true, items: sanitizeList(r.items, sanitizeModPlayer, 25) } : r;
      },
      async player(id, code) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return fail('not_found');
        const r = await modCall('mod_player', { p_player: id }, code);
        if (!r.ok) return r;
        const player = sanitizeModPlayer(r.player);
        if (!player) return fail('bad_response');
        return {
          ok: true, player, sessions: Number.isInteger(r.sessions) ? r.sessions : 0,
          audit: sanitizeList(r.audit, (x) => (x && typeof x.action === 'string' ? { action: cleanStr(x.action, 32, '?'), detail: cleanJson(x.detail) || {}, at: isoOr(x.at) } : null), 60),
          listings: sanitizeList(r.listings, (x) => (x && typeof x.listingId === 'string' && UUID_RE.test(x.listingId) ? {
            listingId: x.listingId, name: cleanStr(x.name, 32, '?'), ovr: Number(x.ovr) || 0, price: Number(x.price) || 0, status: cleanStr(x.status, 12, '?'), listedAt: isoOr(x.listedAt), soldAt: isoOr(x.soldAt),
          } : null), 40),
        };
      },
      /** until: null = permanent, else Date | ISO string | epoch ms. Cancels their listings and queue entries. */
      async ban(id, reason, until = null, code) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return fail('not_found');
        const why = cleanStr(reason, 200, '');
        if (!why) return fail('bad_reason');
        let iso = null;
        if (until != null && until !== '') {
          const t = until instanceof Date ? until.getTime() : typeof until === 'number' ? until : Date.parse(until);
          if (!Number.isFinite(t) || t <= Date.now()) return fail('bad_until');
          iso = new Date(t).toISOString();
        }
        const r = await modCall('mod_ban', { p_player: id, p_reason: why, p_until: iso }, code);
        return r.ok ? { ok: true, player: sanitizeModPlayer(r.player), listingsCancelled: Number(r.listingsCancelled) || 0 } : r;
      },
      async unban(id, code) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return fail('not_found');
        const r = await modCall('mod_unban', { p_player: id }, code);
        return r.ok ? { ok: true, player: sanitizeModPlayer(r.player) } : r;
      },
      async adjustCoins(id, delta, reason = '', code) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return fail('not_found');
        if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1e8) return fail('bad_amount');
        const r = await modCall('mod_adjust_coins', { p_player: id, p_delta: delta, p_reason: cleanStr(reason, 120, '') }, code);
        return r.ok ? { ok: true, coins: Number(r.coins) || 0 } : r;
      },
      async setRole(id, role, code) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return fail('not_found');
        if (!['player', 'mod', 'owner'].includes(role)) return fail('bad_role');
        const r = await modCall('mod_set_role', { p_player: id, p_role: role }, code);
        return r.ok ? { ok: true, player: sanitizeModPlayer(r.player) } : r;
      },
    },


    // ---------------------------------------------------------------- owner powers (migration 003)
    owner: {
      /** Coins for one player (null = yourself). Idempotent + retried on network errors. -> { ok, coins, player } */
      async giveCoins(playerId, amount, { reason = '', key = opKey() } = {}) {
        if (playerId != null && (typeof playerId !== 'string' || !UUID_RE.test(playerId))) return fail('not_found');
        if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1e9) return fail('bad_amount');
        const r = await ownerCall('admin_coins', { p_player: playerId || null, p_delta: amount, p_reason: cleanStr(reason, 120, '') || null, p_key: key }, true);
        return r.ok ? { ok: true, coins: nonNeg(r.coins), player: typeof r.player === 'string' ? r.player : null } : r;
      },
      /** { to: playerId | 'all', kind: 'coins'|'pack'|'card', coins, packId, count, card, message } -> { ok, giftId } */
      async gift({ to, kind, coins = null, packId = null, count = 1, card = null, message = '' } = {}, { key = opKey() } = {}) {
        const all = to === 'all';
        if (!all && (typeof to !== 'string' || !UUID_RE.test(to))) return fail('bad_target');
        let payload = null;
        if (kind === 'coins') { if (!Number.isInteger(coins) || coins < 1 || coins > 1e9) return fail('bad_amount'); }
        else if (kind === 'pack') { if (typeof packId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(packId) || !Number.isInteger(count) || count < 1 || count > 50) return fail('bad_pack'); payload = { packId, count }; }
        else if (kind === 'card') { const c = cleanJson(card); if (!c || typeof c !== 'object' || Array.isArray(c) || JSON.stringify(c).length > 4000) return fail('bad_card'); payload = { card: c }; }
        else return fail('bad_kind');
        const r = await ownerCall('admin_gift', {
          p_to: all ? null : to, p_all: all, p_kind: kind, p_coins: kind === 'coins' ? coins : null, p_payload: payload, p_message: cleanStr(message, 200, '') || null, p_key: key,
        }, true);
        return r.ok ? { ok: true, giftId: typeof r.giftId === 'string' ? r.giftId : null } : r;
      },
      /** what: 'coins' | 'progress' | 'club' | 'all' -> { ok, player, resets } */
      async reset(playerId, what) {
        if (typeof playerId !== 'string' || !UUID_RE.test(playerId)) return fail('not_found');
        if (!['coins', 'progress', 'club', 'all'].includes(what)) return fail('bad_value');
        const r = await ownerCall('admin_reset', { p_player: playerId, p_what: what });
        return r.ok ? { ok: true, player: sanitizeModPlayer(r.player), resets: sanitizeEpochs(r.resets) } : r;
      },
      async broadcast(text, minutes = 30) {
        const t = cleanStr(text, 200, '');
        if (!t) return fail('bad_text');
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return fail('bad_value');
        const r = await ownerCall('admin_broadcast', { p_text: t, p_minutes: minutes });
        if (r.ok) presenceTick(true);
        return r.ok ? { ok: true, id: Number(r.id) || 0 } : r;
      },
      async clearBroadcast(id) {
        if (!Number.isInteger(id) || id <= 0) return fail('not_found');
        const r = await ownerCall('admin_clear_broadcast', { p_bid: id });
        return r.ok ? { ok: true } : r;
      },
      /** key: 'promos' | 'packs' | 'rewards' | 'market' | 'features' (see docs/ONLINE_API.md) */
      async setConfig(key, value) {
        if (!CONFIG_KEYS.includes(key)) return fail('bad_key');
        const v = sanitizeConfigValue(key, value);
        if (!v) return fail('bad_value');
        const r = await ownerCall('admin_set_config', { p_key: key, p_value: v });
        if (r.ok) await online.config.get(true);
        return r.ok ? { ok: true, version: Number(r.version) || 0 } : r;
      },
      /** Infinite online wallet for your own profile (spends / market buys succeed without deducting). */
      async setInfinite(on, playerId = null) {
        if (playerId != null && (typeof playerId !== 'string' || !UUID_RE.test(playerId))) return fail('not_found');
        const r = await ownerCall('admin_set_infinite', { p_on: !!on, p_player: playerId });
        return r.ok ? { ok: true, infinite: r.infinite === true, coins: nonNeg(r.coins) } : r;
      },
      players(query) { return online.moderation.search(query); },
    },

    // ---------------------------------------------------------------- global config (public read)
    config: {
      /** -> { ok, version, config } (cached 3 min; offline -> last cached copy, ok:false) */
      async get(force = false) {
        if (!force && cfg.at && Date.now() - cfg.at < CONFIG_TTL_MS) return { ok: true, version: cfg.version, config: cfg.config };
        if (cfg.pending) return cfg.pending;
        cfg.pending = (async () => {
          const r = await rpc('get_config', {});
          cfg.pending = null;
          if (!r.ok || !r.data || r.data.ok !== true) return { ...fail(r.ok ? 'bad_response' : r.error), version: cfg.version, config: cfg.config };
          const next = sanitizeConfig(r.data.config);
          const changed = JSON.stringify(next) !== JSON.stringify(cfg.config);
          cfg = { ...cfg, version: Number(r.data.version) || 0, config: next, at: Date.now() };
          sset(storage, CFG_KEY, JSON.stringify({ version: cfg.version, config: next }));
          if (changed) for (const f of [...cfgListeners]) { try { f(next); } catch (e) { console.error('[online] config listener failed', e); } }
          return { ok: true, version: cfg.version, config: next };
        })();
        return cfg.pending;
      },
      /** Sync read, e.g. value('packs.gold.price', 7500). */
      value(path, fallback = undefined) {
        let v = cfg.config;
        for (const k of String(path).split('.')) { if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, k)) return fallback; v = v[k]; }
        return v === undefined ? fallback : v;
      },
      get current() { return cfg.config; },
      onChange(fn) { cfgListeners.add(fn); return () => cfgListeners.delete(fn); },
    },

    // ---------------------------------------------------------------- presence, counter, broadcasts
    presence: {
      /** Heartbeat every 25 s while the tab is visible (+ config refresh every 3 min). Idempotent. */
      start() {
        if (pres.running) return;
        pres.running = true;
        presenceTick(true);
        pres.timer = setInterval(() => presenceTick(false), deps.presenceMs || 25000);
        pres.cfgTimer = setInterval(() => { online.config.get(true); }, CONFIG_TTL_MS);
        online.config.get();
        if (typeof document !== 'undefined' && document.addEventListener) {
          pres.onVis = () => { if (!document.hidden) presenceTick(false); };
          document.addEventListener('visibilitychange', pres.onVis);
        }
      },
      stop() {
        pres.running = false;
        clearInterval(pres.timer); clearInterval(pres.cfgTimer);
        if (pres.onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', pres.onVis);
      },
      /** One tick now (tests / after actions). */
      tick: () => presenceTick(true),
      get last() { return pres.last; },
      async count() {
        const r = await rpc('online_count', {});
        return r.ok && Number.isInteger(r.data) ? { ok: true, online: Math.max(0, r.data) } : fail(r.ok ? 'bad_response' : r.error);
      },
      onUpdate(fn) { pres.listeners.add(fn); if (pres.last) { try { fn(pres.last); } catch { /* ignore */ } } return () => pres.listeners.delete(fn); },
      /** fn({ id, text, until }) once per new broadcast. */
      onBroadcast(fn) { pres.bcast.add(fn); return () => pres.bcast.delete(fn); },
      async broadcasts() {
        const r = dataOr(await rpc('get_broadcasts', {}));
        return r.ok === true ? { ok: true, items: sanitizeList(r.items, sanitizeBroadcast, 5) } : fail(r.error || 'bad_response');
      },
    },

    // ---------------------------------------------------------------- gifts inbox
    gifts: {
      async inbox() {
        const r = dataOr(await authed('gifts_inbox'));
        return r.ok === true ? { ok: true, items: sanitizeList(r.items, sanitizeGift, 50) } : fail(r.error || 'bad_response', r.ban ? { ban: r.ban } : undefined);
      },
      /** -> { ok, kind, coins, balance, packId, count, card } — coins already added server-side. */
      async claim(id) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return fail('not_found');
        const r = dataOr(await authed('claim_gift', { p_gift: id }));
        if (r.ok !== true) return fail(r.error === 'already_claimed' ? 'already_claimed_gift' : r.error || 'bad_response');
        const g = sanitizeGift(r);
        if (!g) return fail('bad_response');
        if (pres.last) { pres.last = { ...pres.last, gifts: Math.max(0, pres.last.gifts - 1) }; emitPresence(); }
        emitCoins(nonNeg(r.balance));
        return { ok: true, ...g, balance: nonNeg(r.balance) };
      },
    },

    // ---------------------------------------------------------------- post-match rewards
    rewards: {
      /** { mode:'ut'|'friendly'|'rivals'|'offline', won, drawn, gf|goalsFor, ga|goalsAgainst } -> { ok, coinsAwarded, coins, pack, capped, multiplier } */
      async match(x = {}) {
        const v = normalizeReport({ ...x, goalsFor: x.goalsFor ?? x.gf, goalsAgainst: x.goalsAgainst ?? x.ga });
        if (!v.ok) return fail(v.error);
        const r = dataOr(await authed('match_reward', v.args));
        const s = sanitizeReport(r);
        if (!s.ok) return fail(s.error, r.ban ? { ban: r.ban } : undefined);
        return { ...s, pack: typeof r.pack === 'string' && PACK_RE.test(r.pack) ? r.pack : null, multiplier: typeof r.multiplier === 'number' && Number.isFinite(r.multiplier) ? r.multiplier : 1 };
      },
    },

    // ---------------------------------------------------------------- social
    players: {
      async find(query) {
        const q = cleanStr(query, 40, '');
        if (q.length < 2) return fail('bad_query');
        const r = dataOr(await rpc('find_player', { p_query: q }));
        return r.ok === true ? { ok: true, items: sanitizeList(r.items, sanitizePublicPlayer, 10) } : fail(r.error || 'bad_response');
      },
    },
    messages: {
      /** text <= 300 chars, image = JPEG data URL <= 150 KB (see compressImage). */
      async send(toId, text = '', image = null) {
        if (typeof toId !== 'string' || !UUID_RE.test(toId)) return fail('not_found');
        const t = typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300).trim() : ''; // eslint-disable-line no-control-regex
        if (image != null && (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS || !JPEG_RE.test(image))) return fail('bad_image');
        if (!t && !image) return fail('empty');
        const r = dataOr(await authed('send_message', { p_to: toId, p_body: t, p_image: image || null }));
        return r.ok === true ? { ok: true, id: Number(r.id) || 0 } : fail(r.error || 'bad_response');
      },
      async conversations() {
        const r = dataOr(await authed('list_conversations'));
        return r.ok === true ? { ok: true, items: sanitizeList(r.items, sanitizeConversation, 30) } : fail(r.error || 'bad_response');
      },
      async thread(withId, before = null) {
        if (typeof withId !== 'string' || !UUID_RE.test(withId)) return fail('not_found');
        const r = dataOr(await authed('get_messages', { p_with: withId, p_before: Number.isInteger(before) ? before : null }));
        if (r.ok !== true) return fail(r.error || 'bad_response');
        if (pres.last && pres.last.unread) { pres.last = { ...pres.last, unread: 0 }; emitPresence(); presenceTick(true); }
        return { ok: true, with: sanitizePublicPlayer(r.with), items: sanitizeList(r.items, sanitizeMessage, 30) };
      },
      unread() { return pres.last ? pres.last.unread : 0; },
      compressImage,
      MAX_TEXT: 300,
      MAX_IMAGE_BYTES: 150 * 1024,
    },
    squads: {
      /** Public squad snapshot (JSON object <= 20 KB), visible to anyone by username / friend code. */
      async publish(snapshot) {
        const c = cleanSquad(snapshot);
        if (!c) return fail('bad_squad');
        if (JSON.stringify(c).length > 20480) return fail('too_large');
        const r = dataOr(await authed('set_squad', { p_squad: c }));
        return r.ok === true ? { ok: true } : fail(r.error || 'bad_response');
      },
      async view(query) {
        const q = cleanStr(query, 40, '');
        if (q.length < 3) return fail('bad_query');
        const r = dataOr(await rpc('view_squad', { p_query: q }));
        if (r.ok !== true) return { ...fail(r.error || 'bad_response'), owner: sanitizePublicPlayer(r.owner) };
        return { ok: true, owner: sanitizePublicPlayer(r.owner), squad: cleanSquad(r.squad), updatedAt: isoOr(r.updatedAt) };
      },
    },

    errorText,
  };

  // ---------------------------------------------------------------- helpers (003)
  const coinListeners = new Set();
  let lastCoins = null;
  function emitCoins(v) {
    if (!Number.isFinite(v) || v === lastCoins) return;
    lastCoins = v;
    for (const f of [...coinListeners]) { try { f(v); } catch (e) { console.error('[online] coins listener failed', e); } }
  }
  function opKey() { return randomSecret().slice(0, 24); }
  const RETRY_ERRORS = ['offline', 'timeout'];
  async function coinOp(delta, reason) {
    const key = opKey();
    let r;
    for (let i = 0; i < 3; i++) {
      r = dataOr(await authed('coins_op', { p_delta: delta, p_reason: reason, p_key: key }));
      if (r.ok === true || !RETRY_ERRORS.includes(r.error)) break;
      await sleepMs(300 * (i + 1));
    }
    if (r.ok !== true) return fail(r.error || 'bad_response', r.ban ? { ban: r.ban } : undefined);
    const out = { ok: true, coins: nonNeg(r.coins), applied: Number.isFinite(r.applied) ? r.applied : 0, infinite: r.infinite === true };
    if (pres.last) { pres.last = { ...pres.last, coins: out.coins }; }
    emitCoins(out.coins);
    return out;
  }
  /** Owner RPC: admin token (or legacy code) + the caller's identity. `retry` = idempotent call, retried on network errors. */
  async function ownerCall(fn, args, retry = false) {
    const a = readAcc();
    const d = a ? null : readIdent();
    const ident = a ? { id: a.id, secret: a.token } : d && d.id ? d : null;
    const c = adminSecret();
    if (!c && staffRole() !== 'owner') return fail(staffRole() === 'mod' ? 'not_allowed' : 'not_admin');
    const payload = { p_code: c || null, ...args, p_id: ident ? ident.id : null, p_secret: ident ? ident.secret : null };
    let r;
    for (let i = 0; i < (retry ? 3 : 1); i++) {
      r = await rpc(fn, payload);
      if (r.ok || !RETRY_ERRORS.includes(r.error)) break;
      await sleepMs(400 * (i + 1));
    }
    if (!r.ok) { if (r.error === 'banned') setBan(r.ban); return fail(r.error, r.ban ? { ban: parseBan(r.ban) } : undefined); }
    const out = r.data && typeof r.data === 'object' ? r.data : { ok: false, error: 'bad_response' };
    if (out.ok !== true && out.error === 'not_admin' && readAdm()) sdel(volatile, ADM_KEY); // expired / revoked token
    return out.ok === true ? out : fail(out.error || 'bad_response');
  }
  // config cache
  const CFG_KEY = `${deps.accountKey || 'pitchside.account'}.config`;
  let cfg = { version: -1, config: {}, at: 0, pending: null };
  try { const c = JSON.parse(sget(storage, CFG_KEY) || 'null'); if (c && typeof c === 'object') cfg = { ...cfg, version: Number(c.version) || 0, config: sanitizeConfig(c.config) }; } catch { /* ignore */ }
  const cfgListeners = new Set();
  // presence
  const pres = { running: false, timer: null, cfgTimer: null, last: null, listeners: new Set(), bcast: new Set(), seen: new Set(), busy: false, onVis: null };
  const emitPresence = () => { for (const f of [...pres.listeners]) { try { f(pres.last); } catch (e) { console.error('[online] presence listener failed', e); } } };
  async function presenceTick(force) {
    if (pres.busy) return pres.last;
    if (!force && typeof document !== 'undefined' && document.hidden) return pres.last;
    pres.busy = true;
    try {
      let d = null;
      const acc = readAcc();
      if (online.hasIdentity() && !(acc && banActive(acc.ban))) {
        const r = dataOr(await authed('presence'));
        if (r.ok === true) d = r;
      }
      if (!d) {
        const [c, b] = await Promise.all([rpc('online_count', {}), rpc('get_broadcasts', {})]);
        if (!c.ok && !b.ok) return pres.last;
        d = { online: c.ok ? c.data : null, broadcasts: b.ok && b.data ? b.data.items : [] };
      }
      const u = sanitizePresence(d);
      if (u.coins != null) emitCoins(u.coins);
      const prev = pres.last;
      pres.last = u;
      if (acc && u.role && u.role !== acc.role) { const cur = readAcc(); if (cur) { writeAcc({ ...cur, role: u.role }); emitAcc(); } }
      if (u.configVersion != null && u.configVersion !== cfg.version) online.config.get(true);
      emitPresence();
      for (const b of u.broadcasts) {
        if (pres.seen.has(b.id)) continue;
        pres.seen.add(b.id);
        for (const f of [...pres.bcast]) { try { f(b); } catch (e) { console.error('[online] broadcast listener failed', e); } }
      }
      void prev;
      return u;
    } finally { pres.busy = false; }
  }
  function staffRole() { const a = readAcc(); return a && !banActive(a.ban) && (a.role === 'owner' || a.role === 'mod') ? a.role : null; }
  async function modCall(fn, args, code) {
    const c = typeof code === 'string' && code ? code.slice(0, 160) : adminSecret();
    const a = staffRole() ? readAcc() : null;
    if (!c && !a) return fail('not_admin');
    const r = await rpc(fn, { p_code: c || null, ...args, p_id: a ? a.id : null, p_secret: a ? a.token : null });
    if (!r.ok) { if (r.error === 'banned') setBan(r.ban); return fail(r.error, r.ban ? { ban: parseBan(r.ban) } : undefined); }
    const d = r.data && typeof r.data === 'object' ? r.data : { ok: false, error: 'bad_response' };
    return d.ok === true ? d : fail(d.error || 'bad_response');
  }
  return online;
}

const isoOr = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
/** Moderation player row from the server -> bounded plain object. */
export function sanitizeModPlayer(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !UUID_RE.test(p.id)) return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);
  return {
    id: p.id, username: typeof p.username === 'string' ? cleanStr(p.username, 16, '') || null : null, name: cleanStr(p.name, 16, 'Player'),
    role: roleOf(p.role) || 'player', friendCode: typeof p.friendCode === 'string' && FRIEND_CODE_RE.test(p.friendCode) ? p.friendCode : null,
    coins: n(p.coins), rating: n(p.rating), rivalsDivision: n(p.rivalsDivision), wins: n(p.wins), draws: n(p.draws), losses: n(p.losses),
    banned: p.banned === true, banReason: typeof p.banReason === 'string' ? cleanStr(p.banReason, 200, '') : null,
    bannedUntil: isoOr(p.bannedUntil), bannedAt: isoOr(p.bannedAt), createdAt: isoOr(p.createdAt), lastLoginAt: isoOr(p.lastLoginAt), lastSeenAt: isoOr(p.lastSeenAt),
  };
}

// ------------------------------------------------------------------ default instance (browser)
function browserOnline() {
  const Q = new URLSearchParams(location.search);
  const mock = Q.get('mockOnline') === '1';
  let rpcImpl = supabaseRpc;
  let storage = localStorage;
  if (mock) {
    const backend = createMockBackend(webStore(localStorage), { latencyMs: 60, down: Q.get('mockDown') === '1' });
    window.__mockOnline = backend;
    rpcImpl = (fn, args) => backend.call(fn, args);
    storage = sessionStorage; // one identity per tab so two tabs can play each other
  }
  let volatileStorage;
  try { volatileStorage = mock ? undefined : sessionStorage; } catch { volatileStorage = undefined; }
  const net = Q.get('net');
  const netPrefs = () => { try { return JSON.parse(localStorage.getItem('pitchside.net') || '{}') || {}; } catch { return {}; } };
  return createOnline({
    rpc: rpcImpl,
    storage,
    mock,
    configured: mock || !!(SUPABASE_URL && SUPABASE_KEY),
    identityKey: mock ? 'pitchside.mock.identity' : 'pitchside.online.identity',
    accountKey: mock ? 'pitchside.mock.account' : 'pitchside.account',
    volatileStorage,
    requireAccount: Q.get('requireAccount') === '1', // TEMP: accounts migration (002) not live yet — device profiles until then // mock keeps anonymous device profiles for dev tests
    transportKind: ['bc', 'loopback', 'peer'].includes(net) ? net : mock ? 'bc' : 'peer',
    peerCfg: () => {
      const p = netPrefs();
      return p.host ? { host: p.host, port: p.port || undefined, path: p.path || '/', secure: p.secure !== false } : {};
    },
    getName: () => {
      if (netPrefs().name) return netPrefs().name;
      try { const ut = JSON.parse(localStorage.getItem('pitchside.ut') || 'null'); if (ut && ut.clubName) return String(ut.clubName); } catch { /* ignore */ }
      return 'Player';
    },
    matchmakerConfig: mock && Q.get('mmTimeout') ? { timeoutMs: Number(Q.get('mmTimeout')) * 1000 } : undefined,
    invitePollMs: mock ? 700 : 2000,
  });
}

const unavailable = () => {
  const f = async () => ({ ok: false, error: 'offline' });
  return {
    available: async () => false, profile: f, setName: f,
    status: async () => ({ online: false, reason: 'unreachable', message: 'Online services are unavailable.' }),
    market: { list: f, search: f, buy: f, mine: f, cancel: f, claimSales: f },
    coins: { get: f, add: f, spend: f, earn: f, onChange: () => () => {} }, matchmaking: { quickSearch: f, cancelSearch: f, state: 'idle' },
    hostWithCode: f, joinWithCode: f, reportResult: f, admin: { verify: async () => false, verifyLevel: f, addCoins: f, verified: false, codeLevel: null, canOwner: () => false, forget() {}, level: null, matchToken: f, verifyMatchToken: f }, errorText,
    hasIdentity: () => false,
    account: {
      current: () => ({ state: 'none', id: null, username: null, role: null, remember: true, ban: null, pending: null, hasDevice: false }),
      status: async () => ({ ok: false, online: false, error: 'offline', state: 'none' }), signup: f, claim: f, login: f,
      logout: async () => ({ ok: true }), continueOffline() {}, changeUsername: f, changePassword: f, guest() {}, isGuest: () => false, pending: () => null, retryPending: f, hasPendingCreds: false,
      onChange: () => () => {}, isReservedName: () => false, validateUsername: () => null, validatePassword: () => null,
    },
    moderation: { role: null, canModerate: () => false, search: f, player: f, ban: f, unban: f, adjustCoins: f, setRole: f },
    owner: { giveCoins: f, gift: f, reset: f, broadcast: f, clearBroadcast: f, setConfig: f, setInfinite: f, players: f },
    config: { get: async () => ({ ok: false, error: 'offline', version: 0, config: {} }), value: (p, d) => d, current: {}, onChange: () => () => {} },
    presence: { start() {}, stop() {}, tick: async () => null, last: null, count: f, onUpdate: () => () => {}, onBroadcast: () => () => {}, broadcasts: f },
    gifts: { inbox: f, claim: f },
    rewards: { match: f },
    players: { find: f },
    messages: { send: f, conversations: f, thread: f, unread: () => 0, compressImage: async () => ({ ok: false, error: 'bad_image' }), MAX_TEXT: 300, MAX_IMAGE_BYTES: 150 * 1024 },
    squads: { publish: f, view: f },
    rivals: { status: f, claimWeekly: f },
    friends: {
      list: f, code: f, add: f, respond: f, accept: f, decline: f, remove: f, block: f, unblock: f, heartbeat: f, pollInvites: f,
      challenge: f, cancelChallenge: f, acceptInvite: f, declineInvite: f,
    },
  };
};

export const online = (() => {
  if (typeof window === 'undefined' || typeof location === 'undefined') return unavailable();
  try { return browserOnline(); } catch (e) { console.warn('[online] services unavailable', e); return unavailable(); }
})();
