// Pitchside 3D — validation of everything that comes back from the online backend (and of
// market inputs before they are sent). Pure functions, no DOM: unit-tested with node.
import { cleanStr } from './protocol.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PEER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const SECRET_RE = /^[0-9a-f]{64}$/;
export const TOKEN_RE = /^[0-9a-f]{16,64}$/;
export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];
export const RARITIES = ['bronze', 'bronze_rare', 'silver', 'silver_rare', 'gold', 'gold_rare', 'inform', 'hero', 'legend', 'icon', 'common'];
export const SORTS = ['newest', 'price_asc', 'price_desc', 'ovr_desc'];
export const MARKET = { minPrice: 150, maxPrice: 15000000, maxCardBytes: 4096, maxPage: 49, taxPct: 5 };
export const MODES = ['friendly', 'ut'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
const intStrict = (v, lo, hi) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi);

export function byteLength(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length; // eslint-disable-line no-restricted-globals
}

/**
 * Deep-copy untrusted JSON into a bounded plain structure: strings capped and stripped of control
 * characters, finite numbers only, arrays <= 16 items, objects <= 48 simple keys, depth <= 4.
 * Prototype keys (__proto__, constructor, prototype) are dropped.
 */
export function cleanJson(v, depth = 0) {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return cleanStr(v, 64, '');
  if (depth >= 4) return null;
  if (Array.isArray(v)) return v.slice(0, 16).map((x) => cleanJson(x, depth + 1));
  if (isObj(v)) {
    const out = {};
    let n = 0;
    for (const k of Object.keys(v)) {
      if (n >= 48) break;
      if (!/^[A-Za-z0-9_]{1,24}$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = cleanJson(v[k], depth + 1);
      n++;
    }
    return out;
  }
  return null;
}

/** A UT card object from the market/peer: must have id, name, pos, ovr. Returns a clean copy or null. */
export function sanitizeCard(c) {
  if (!isObj(c)) return null;
  if (typeof c.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,40}$/.test(c.id)) return null;
  if (typeof c.name !== 'string' || !cleanStr(c.name, 32, '')) return null;
  if (!POSITIONS.includes(c.pos)) return null;
  if (!intStrict(c.ovr, 1, 99)) return null;
  const out = cleanJson(c);
  out.id = c.id;
  out.name = cleanStr(c.name, 32, 'Player');
  if (isObj(out.stats)) for (const k of Object.keys(out.stats)) out.stats[k] = int(out.stats[k], 1, 99, 50);
  if (isObj(out.gk)) for (const k of Object.keys(out.gk)) out.gk[k] = int(out.gk[k], 1, 99, 50);
  return out;
}

/** Validate a market listing before it is sent. -> { ok, card, price } | { ok:false, error } */
export function validateListingInput(card, price) {
  const p = typeof price === 'string' && /^\d+$/.test(price.trim()) ? Number(price.trim()) : price;
  if (!intStrict(p, MARKET.minPrice, MARKET.maxPrice)) return { ok: false, error: 'bad_price' };
  const c = sanitizeCard(card);
  if (!c) return { ok: false, error: 'bad_card' };
  if (byteLength(JSON.stringify(c)) > MARKET.maxCardBytes) return { ok: false, error: 'card_too_large' };
  return { ok: true, card: c, price: p };
}

/** Normalise market search filters into RPC arguments. */
export function normalizeSearch(f = {}) {
  const src = isObj(f) ? f : {};
  const q = cleanStr(src.q, 24, '');
  return {
    p_q: q || null,
    p_pos: POSITIONS.includes(src.pos) ? src.pos : null,
    p_min_ovr: typeof src.minOvr === 'number' && Number.isFinite(src.minOvr) && src.minOvr > 0 ? int(src.minOvr, 1, 99, null) : null,
    p_max_price: typeof src.maxPrice === 'number' && Number.isFinite(src.maxPrice) && src.maxPrice > 0 ? int(src.maxPrice, 1, MARKET.maxPrice, null) : null,
    p_rarity: RARITIES.includes(src.rarity) ? src.rarity : null,
    p_sort: SORTS.includes(src.sort) ? src.sort : 'newest',
    p_page: int(src.page, 0, MARKET.maxPage, 0),
  };
}

const isoOrNull = (v) => (typeof v === 'string' && v.length < 40 && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export function sanitizeListingItem(r) {
  if (!isObj(r) || typeof r.listingId !== 'string' || !UUID_RE.test(r.listingId)) return null;
  const card = sanitizeCard(r.card);
  if (!card || !intStrict(r.price, MARKET.minPrice, MARKET.maxPrice)) return null;
  return { listingId: r.listingId, card, price: r.price, seller: cleanStr(r.seller, 16, 'Player'), listedAt: isoOrNull(r.listedAt) };
}

export function sanitizeMyListing(r) {
  const base = sanitizeListingItem(r);
  if (!base) return null;
  const status = ['active', 'sold', 'cancelled', 'expired'].includes(r.status) ? r.status : null;
  if (!status) return null;
  return {
    ...base, status, soldAt: isoOrNull(r.soldAt), claimed: r.claimed === true,
    credit: int(r.credit, 0, MARKET.maxPrice, Math.floor(base.price * 0.95)),
  };
}

export function sanitizeList(arr, fn, max = 100) {
  return Array.isArray(arr) ? arr.slice(0, max).map(fn).filter(Boolean) : [];
}

export function sanitizeProfile(p) {
  if (!isObj(p) || p.ok !== true || typeof p.id !== 'string' || !UUID_RE.test(p.id)) return null;
  return {
    ok: true, id: p.id, name: cleanStr(p.name, 16, 'Player'),
    coins: int(p.coins, 0, 1e15, 0), rating: int(p.rating, 0, 5000, 1000), division: int(p.division, 1, 10, 10),
    wins: int(p.wins, 0, 1e9, 0), draws: int(p.draws, 0, 1e9, 0), losses: int(p.losses, 0, 1e9, 0),
    unclaimed: int(p.unclaimed, 0, 1e15, 0),
  };
}

/** Matchmaking RPC response (enqueue / poll / cancel). */
export function parseMmResponse(r) {
  if (!isObj(r)) return { ok: false, error: 'bad_response' };
  if (r.ok !== true) return { ok: false, error: typeof r.error === 'string' ? cleanStr(r.error, 40, 'error') : 'error' };
  if (r.matched !== true) {
    if (r.queueId !== undefined && (typeof r.queueId !== 'string' || !UUID_RE.test(r.queueId))) return { ok: false, error: 'bad_response' };
    return { ok: true, matched: false, queueId: r.queueId || null, waitedMs: int(r.waitedMs, 0, 3.6e6, 0) };
  }
  if (typeof r.queueId !== 'string' || !UUID_RE.test(r.queueId)) return { ok: false, error: 'bad_response' };
  if (r.role !== 'host' && r.role !== 'guest') return { ok: false, error: 'bad_response' };
  if (typeof r.opponentPeerId !== 'string' || !PEER_ID_RE.test(r.opponentPeerId)) return { ok: false, error: 'bad_response' };
  if (typeof r.token !== 'string' || !TOKEN_RE.test(r.token)) return { ok: false, error: 'bad_response' };
  const o = isObj(r.opponent) ? r.opponent : {};
  return {
    ok: true, matched: true, queueId: r.queueId, role: r.role, opponentPeerId: r.opponentPeerId, token: r.token,
    opponent: { name: cleanStr(o.name, 16, 'Opponent'), rating: int(o.rating, 0, 5000, 1000) },
  };
}

export function sanitizeReport(r) {
  if (!isObj(r) || r.ok !== true) return { ok: false, error: isObj(r) && typeof r.error === 'string' ? cleanStr(r.error, 40, 'error') : 'bad_response' };
  return {
    ok: true, capped: r.capped === true,
    coinsAwarded: int(r.coinsAwarded, 0, 100000, 0), coins: int(r.coins, 0, 1e15, 0),
    rating: int(r.rating, 0, 5000, 1000), ratingDelta: int(r.ratingDelta, -1000, 1000, 0), division: int(r.division, 1, 10, 10),
  };
}

/** Validate a result report before it is sent. */
export function normalizeReport(x = {}) {
  const src = isObj(x) ? x : {};
  const mode = ['friendly', 'ut', 'offline'].includes(src.mode) ? src.mode : null;
  if (!mode) return { ok: false, error: 'bad_mode' };
  const won = src.won === true, drawn = src.drawn === true && !won;
  return {
    ok: true,
    args: { p_mode: mode, p_won: won, p_drawn: drawn, p_gf: int(src.goalsFor, 0, 50, 0), p_ga: int(src.goalsAgainst, 0, 50, 0) },
  };
}

/** Friendly message for a backend error code. */
export function errorText(code) {
  return ({
    not_configured: 'Online services are not set up yet.',
    offline: 'Online services are unreachable right now.',
    timeout: 'The server took too long to answer.',
    auth: 'Your online profile could not be verified.',
    bad_price: `Price must be between ${MARKET.minPrice.toLocaleString('en-US')} and ${MARKET.maxPrice.toLocaleString('en-US')} coins.`,
    bad_card: 'That card cannot be listed.',
    card_too_large: 'That card cannot be listed.',
    already_listed: 'That card is already on the market.',
    too_many_listings: 'You have too many active listings.',
    insufficient_coins: 'Not enough coins.',
    own_listing: 'You cannot buy your own listing.',
    unavailable: 'That player has already been sold or removed.',
    expired: 'That listing has expired.',
    not_found: 'Listing not found.',
    not_cancellable: 'That listing can no longer be removed.',
    rate_limited: 'Too many requests — try again in a little while.',
    not_admin: 'Admin code required.',
    not_allowed: 'Not allowed.',
  })[code] || 'Something went wrong. Please try again.';
}
