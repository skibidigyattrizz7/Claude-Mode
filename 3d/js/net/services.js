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
  const rpc = async (fn, args) => {
    try { return await deps.rpc(fn, args); } catch { return { ok: false, error: 'offline' }; }
  };
  const storage = deps.storage;
  const KEY = deps.identityKey || 'pitchside.online.identity';
  let avail = { at: -Infinity, value: false, pending: null };
  let identP = null;
  let adminCode = null; // held in memory only after a successful server-side verify; never persisted

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
  const volatile = deps.volatileStorage || memStore();
  const requireAccount = deps.requireAccount === true;
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

    coins: {
      async get() {
        const p = await online.profile();
        return p.ok ? { ok: true, coins: p.coins } : p;
      },
      /** Negative delta = spend (server checks the balance). Positive delta needs a verified admin code. */
      async add(delta, reason = '') {
        if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) return fail('bad_amount');
        if (delta < 0) {
          const r = dataOr(await authed('spend_coins', { p_amount: -delta, p_reason: cleanStr(reason, 40, '') }));
          return r.ok === true ? { ok: true, coins: Number(r.coins) || 0 } : fail(r.error);
        }
        if (!adminCode) return fail('not_allowed');
        return online.admin.addCoins(delta);
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
      async verify(code) {
        if (typeof code !== 'string' || !code || code.length > 128) return false;
        const r = await rpc('admin_verify', { p_code: code });
        const ok = !!(r.ok && r.data === true);
        if (ok) adminCode = code;
        return ok;
      },
      async addCoins(delta, code = adminCode) {
        if (!code) return fail('not_admin');
        if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) return fail('bad_amount');
        const r = dataOr(await authed('admin_add_coins', { p_code: code, p_delta: delta }));
        return r.ok === true ? { ok: true, coins: Number(r.coins) || 0 } : fail(r.error);
      },
      get verified() { return !!adminCode; },
      forget() { adminCode = null; },
      /** 'admin' (code verified this session) | 'owner' | 'mod' (account role) | null */
      get level() { return adminCode ? 'admin' : staffRole(); },
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
      onChange(fn) { accListeners.add(fn); return () => accListeners.delete(fn); },
      isReservedName,
      validateUsername: (u) => usernameError(u),
      validatePassword: (p, u, c) => passwordError(p, u, c),
    },

    // ---------------------------------------------------------------- moderation (owner/mod session or admin code)
    moderation: {
      /** 'admin' | 'owner' | 'mod' | null */
      get role() { return adminCode ? 'admin' : staffRole(); },
      canModerate() { return !!(adminCode || staffRole()); },
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

    errorText,
  };
  function staffRole() { const a = readAcc(); return a && !banActive(a.ban) && (a.role === 'owner' || a.role === 'mod') ? a.role : null; }
  async function modCall(fn, args, code) {
    const c = typeof code === 'string' && code ? code.slice(0, 128) : adminCode;
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
    getName: () => netPrefs().name || 'Player',
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
    coins: { get: f, add: f }, matchmaking: { quickSearch: f, cancelSearch: f, state: 'idle' },
    hostWithCode: f, joinWithCode: f, reportResult: f, admin: { verify: async () => false, addCoins: f, verified: false, forget() {}, level: null, matchToken: f, verifyMatchToken: f }, errorText,
    hasIdentity: () => false,
    account: {
      current: () => ({ state: 'none', id: null, username: null, role: null, remember: true, ban: null, pending: null, hasDevice: false }),
      status: async () => ({ ok: false, online: false, error: 'offline', state: 'none' }), signup: f, claim: f, login: f,
      logout: async () => ({ ok: true }), continueOffline() {}, pending: () => null, retryPending: f, hasPendingCreds: false,
      onChange: () => () => {}, isReservedName: () => false, validateUsername: () => null, validatePassword: () => null,
    },
    moderation: { role: null, canModerate: () => false, search: f, player: f, ban: f, unban: f, adjustCoins: f, setRole: f },
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
