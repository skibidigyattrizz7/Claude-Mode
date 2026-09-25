// Pitchside 3D — online services (Supabase backend): profile, coins, transfer market,
// matchmaking (quick search + code rooms), result rewards, admin check.
//
// Contract (docs/3D_CONTRACT.md "Online services"): every function returns a Promise and never
// throws to the caller — offline / unconfigured / unexpected data resolve { ok:false, error }.
//
// Identity: a random 32-byte secret generated here and kept in localStorage; the server stores
// only its sha256 and checks (id, secret) on every call. No Supabase Auth.
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
  normalizeFriendCode, FRIEND_CODE_RE, INVITE_MODES, TOKEN_RE,
} from './validate.js';

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

  /** -> {id, secret} | null. Registers on first use (idempotent per secret). */
  function identity({ reset = false } = {}) {
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

  /** Authenticated call. Re-registers once if the server no longer knows this device. */
  async function authed(fn, args = {}) {
    let ident = await identity();
    if (!ident) return { ok: false, error: (await isAvailable()) ? 'auth' : 'offline' };
    let r = await rpc(fn, { p_id: ident.id, p_secret: ident.secret, ...args });
    if (r.ok && r.data && r.data.ok === false && r.data.error === 'auth') {
      ident = await identity({ reset: true });
      if (!ident) return { ok: false, error: 'auth' };
      r = await rpc(fn, { p_id: ident.id, p_secret: ident.secret, ...args });
    }
    if (!r.ok) { avail = { at: -Infinity, value: false, pending: null }; return { ok: false, error: r.error }; }
    return { ok: true, data: r.data };
  }
  const fail = (error) => ({ ok: false, error, message: errorText(error) });
  const dataOr = (r) => (r.ok ? (r.data && typeof r.data === 'object' ? r.data : { ok: false, error: 'bad_response' }) : { ok: false, error: r.error });

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
    hasIdentity() { const v = readIdent(); return !!(v && v.id); },

    async profile() {
      const r = dataOr(await authed('get_profile'));
      const p = sanitizeProfile(r);
      return p || fail(r.error || 'bad_response');
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
    },

    errorText,
  };
  return online;
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
  const net = Q.get('net');
  const netPrefs = () => { try { return JSON.parse(localStorage.getItem('pitchside.net') || '{}') || {}; } catch { return {}; } };
  return createOnline({
    rpc: rpcImpl,
    storage,
    mock,
    configured: mock || !!(SUPABASE_URL && SUPABASE_KEY),
    identityKey: mock ? 'pitchside.mock.identity' : 'pitchside.online.identity',
    transportKind: ['bc', 'loopback'].includes(net) ? net : mock ? 'bc' : 'peer',
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
    hostWithCode: f, joinWithCode: f, reportResult: f, admin: { verify: async () => false, addCoins: f, verified: false, forget() {} }, errorText,
    hasIdentity: () => false,
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
