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
import { createMatchmaker } from './matchmaker.js';
import { createMockBackend, webStore } from './mockbackend.js';
import { cleanStr } from './protocol.js';
import {
  SECRET_RE, UUID_RE, validateListingInput, normalizeSearch, sanitizeListingItem, sanitizeMyListing, sanitizeList,
  sanitizeProfile, sanitizeReport, normalizeReport, sanitizeCard, errorText,
} from './validate.js';

const RPC_TIMEOUT_MS = 8000;
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

  const online = {
    available: () => isAvailable().catch(() => false),

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
        if (!r.ok) return { ...r, message: r.cancelled ? 'Search cancelled.' : r.error === 'timeout' ? 'No opponent found. Try again in a moment.' : r.message || errorText(r.error) };
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
    identityKey: mock ? 'pitchside.mock.identity' : 'pitchside.online.identity',
    transportKind: ['bc', 'loopback'].includes(net) ? net : mock ? 'bc' : 'peer',
    peerCfg: () => {
      const p = netPrefs();
      return p.host ? { host: p.host, port: p.port || undefined, path: p.path || '/', secure: p.secure !== false } : {};
    },
    getName: () => netPrefs().name || 'Player',
    matchmakerConfig: mock && Q.get('mmTimeout') ? { timeoutMs: Number(Q.get('mmTimeout')) * 1000 } : undefined,
  });
}

const unavailable = () => {
  const f = async () => ({ ok: false, error: 'offline' });
  return {
    available: async () => false, profile: f, setName: f,
    market: { list: f, search: f, buy: f, mine: f, cancel: f, claimSales: f },
    coins: { get: f, add: f }, matchmaking: { quickSearch: f, cancelSearch: f, state: 'idle' },
    hostWithCode: f, joinWithCode: f, reportResult: f, admin: { verify: async () => false, addCoins: f, verified: false, forget() {} }, errorText,
  };
};

export const online = (() => {
  if (typeof window === 'undefined' || typeof location === 'undefined') return unavailable();
  try { return browserOnline(); } catch (e) { console.warn('[online] services unavailable', e); return unavailable(); }
})();
