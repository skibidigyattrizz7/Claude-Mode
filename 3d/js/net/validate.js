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
export const MODES = ['friendly', 'ut', 'rivals'];      // matchmaking queues
export const INVITE_MODES = ['friendly', 'ut'];          // friend challenges
export const PACK_IDS = ['bronze', 'silver', 'gold', 'premium', 'rare', 'stars', 'legend', 'icon'];
export const FRIEND_CODE_RE = /^[A-Z0-9]{8}$/;
export const ROLES = ['player', 'mod', 'owner'];
/** Staff role from server data: 'owner' | 'mod' | null (players and anything unexpected -> null). */
export const roleOf = (v) => (v === 'owner' || v === 'mod' ? v : null);

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
  let raw;
  try { raw = JSON.stringify(card); } catch { return { ok: false, error: 'bad_card' }; }
  if (typeof raw !== 'string') return { ok: false, error: 'bad_card' };
  if (byteLength(raw) > MARKET.maxCardBytes) return { ok: false, error: 'card_too_large' };
  const c = sanitizeCard(card);
  if (!c) return { ok: false, error: 'bad_card' };
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
    friendCode: typeof p.friendCode === 'string' && FRIEND_CODE_RE.test(p.friendCode) ? p.friendCode : null,
    rivalsDivision: int(p.rivalsDivision, 0, 10, 10),
    username: typeof p.username === 'string' ? cleanStr(p.username, 16, '') || null : null,
    role: roleOf(p.role),
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
    opponent: { name: cleanStr(o.name, 16, 'Opponent'), rating: int(o.rating, 0, 5000, 1000), role: roleOf(o.role) },
  };
}

export function sanitizeReport(r) {
  if (!isObj(r) || r.ok !== true) return { ok: false, error: isObj(r) && typeof r.error === 'string' ? cleanStr(r.error, 40, 'error') : 'bad_response' };
  const rv = isObj(r.rivals) ? r.rivals : null;
  return {
    ok: true, capped: r.capped === true,
    coinsAwarded: int(r.coinsAwarded, 0, 100000, 0), coins: int(r.coins, 0, 1e15, 0),
    rating: int(r.rating, 0, 5000, 1000), ratingDelta: int(r.ratingDelta, -1000, 1000, 0), division: int(r.division, 1, 10, 10),
    rivals: rv ? {
      division: int(rv.division, 0, 10, 10), points: int(rv.points, 0, 10000, 0),
      threshold: rv.threshold == null ? null : int(rv.threshold, 1, 1000, 10), promoted: rv.promoted === true, weekWins: int(rv.weekWins, 0, 10000, 0),
    } : null,
  };
}

/** Rivals division label: 0 = Elite. */
export const rivalsDivisionName = (d) => (d === 0 ? 'Elite' : `Division ${d}`);

function sanitizeReward(x) {
  if (!isObj(x)) return null;
  return { coins: int(x.coins, 0, 1e7, 0), packs: Array.isArray(x.packs) ? x.packs.filter((p) => PACK_IDS.includes(p)).slice(0, 8) : [] };
}
export function sanitizeRivalsStatus(r) {
  if (!isObj(r) || r.ok !== true) return null;
  const week = (v) => (typeof v === 'string' && /^\d{4}-W\d{2}$/.test(v) ? v : null);
  return {
    ok: true, division: int(r.division, 0, 10, 10), divisionName: rivalsDivisionName(int(r.division, 0, 10, 10)),
    points: int(r.points, 0, 10000, 0), threshold: r.threshold == null ? null : int(r.threshold, 1, 1000, 10),
    week: week(r.week), weekWins: int(r.weekWins, 0, 10000, 0), weekMatches: int(r.weekMatches, 0, 10000, 0), peak: int(r.peak, 0, 10, 10),
    claimable: r.claimable === true, claimWeek: week(r.claimWeek), reward: r.claimable === true ? sanitizeReward(r.reward) : null,
    nextResetAt: isoOrNull(r.nextResetAt),
  };
}
export function sanitizeRivalsClaim(r) {
  if (!isObj(r) || r.ok !== true) return null;
  const rw = sanitizeReward(r);
  return { ok: true, week: typeof r.week === 'string' ? cleanStr(r.week, 10, '') : '', coins: rw.coins, packs: rw.packs, balance: int(r.balance, 0, 1e15, 0) };
}

// ------------------------------------------------------------------ friends
export function normalizeFriendCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

export function sanitizeFriend(f) {
  if (!isObj(f) || typeof f.id !== 'string' || !UUID_RE.test(f.id)) return null;
  const status = ['friend', 'incoming', 'outgoing', 'blocked'].includes(f.status) ? f.status : null;
  if (!status) return null;
  return {
    id: f.id, name: cleanStr(f.name, 16, 'Player'), status, online: status === 'friend' && f.online === true,
    rating: status === 'friend' ? int(f.rating, 0, 5000, 1000) : null,
    division: status === 'friend' ? int(f.division, 1, 10, 10) : null,
    rivalsDivision: status === 'friend' ? int(f.rivalsDivision, 0, 10, 10) : null,
    role: roleOf(f.role),
  };
}
export function sanitizeIncomingInvite(i) {
  if (!isObj(i) || typeof i.inviteId !== 'string' || !UUID_RE.test(i.inviteId) || !INVITE_MODES.includes(i.mode)) return null;
  const f = isObj(i.from) ? i.from : {};
  if (typeof f.id !== 'string' || !UUID_RE.test(f.id)) return null;
  return { inviteId: i.inviteId, mode: i.mode, createdAt: isoOrNull(i.createdAt), from: { id: f.id, name: cleanStr(f.name, 16, 'Player'), rating: int(f.rating, 0, 5000, 1000), role: roleOf(f.role) } };
}
export function sanitizeOutgoingInvite(i) {
  if (!isObj(i) || typeof i.inviteId !== 'string' || !UUID_RE.test(i.inviteId)) return null;
  const status = ['pending', 'accepted', 'declined', 'cancelled', 'expired'].includes(i.status) ? i.status : null;
  if (!status) return null;
  return { inviteId: i.inviteId, status, mode: INVITE_MODES.includes(i.mode) ? i.mode : 'friendly', toId: typeof i.toId === 'string' && UUID_RE.test(i.toId) ? i.toId : null };
}
/** respond_invite(accept) -> { ok, mode, peerId, token, from } */
export function parseInviteAccept(r) {
  if (!isObj(r) || r.ok !== true) return { ok: false, error: isObj(r) && typeof r.error === 'string' ? cleanStr(r.error, 40, 'error') : 'bad_response' };
  if (r.accepted !== true) return { ok: true, accepted: false };
  if (!INVITE_MODES.includes(r.mode) || typeof r.peerId !== 'string' || !PEER_ID_RE.test(r.peerId) || typeof r.token !== 'string' || !TOKEN_RE.test(r.token)) return { ok: false, error: 'bad_response' };
  const f = isObj(r.from) ? r.from : {};
  return { ok: true, accepted: true, mode: r.mode, peerId: r.peerId, token: r.token, from: { name: cleanStr(f.name, 16, 'Friend'), rating: int(f.rating, 0, 5000, 1000), role: roleOf(f.role) } };
}

/** Validate a result report before it is sent. */
export function normalizeReport(x = {}) {
  const src = isObj(x) ? x : {};
  const mode = ['friendly', 'ut', 'rivals', 'offline'].includes(src.mode) ? src.mode : null;
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
    bad_code: 'Friend codes are 8 letters and numbers.',
    self: 'That is your own friend code.',
    already_friends: 'You are already friends.',
    already_requested: 'Friend request already sent.',
    too_many_friends: 'Your friends list is full.',
    not_friends: 'You can only challenge friends.',
    declined: 'Your friend declined the challenge.',
    blocked: 'You blocked this player.',
    nothing_to_claim: 'No finished Rivals week to claim yet.',
    already_claimed: 'This week’s Rivals rewards were already claimed.',
    no_opponent: 'No opponent found.',
    connect_failed: 'Could not connect to the other player.',
    banned: 'Your account is banned from online play.',
    no_account: 'Create an account or log in to play online.',
    bad_username: 'Usernames are 3–16 letters, numbers, _ or single spaces.',
    username_not_allowed: 'That username is not allowed.',
    username_taken: 'That username is already taken.',
    reserved_username: 'That username is reserved.',
    weak_password: 'Passwords need at least 8 characters (and must not be your username).',
    bad_password: 'Passwords can be at most 72 characters.',
    password_mismatch: 'The passwords do not match.',
    bad_credentials: 'Wrong username or password.',
    too_many_attempts: 'Too many failed attempts — wait 15 minutes and try again.',
    already_has_account: 'This profile already has an account.',
    name_not_allowed: 'That name is not allowed.',
    bad_query: 'Type a username, friend code or player id.',
    bad_reason: 'Give a reason (1–200 characters).',
    bad_until: 'The ban end must be in the future (at most 10 years).',
    bad_role: 'Unknown role.',
    bad_amount: 'Enter a whole number of coins.',
  })[code] || 'Something went wrong. Please try again.';
}
