// Online Player Market (real users' listings) — DOM-free glue between the UT state and `online.market.*`
// (see docs/3D_CONTRACT.md "Online services"). Completely separate from the simulated AI market in ut.js.
// Every function resolves { ok, ... } and never throws.
import { getPlayer, registerCard, utPrice, niceRound } from './players.js';
import { removeFromClub, addToClub } from './ut.js';

export const MARKET_TAX = 0.05;

// FUT-style price bands by overall (special cards get a higher floor/ceiling).
const BANDS = [[0, 150, 10000], [65, 200, 15000], [75, 350, 50000], [80, 700, 100000], [83, 2000, 250000], [86, 8000, 1000000], [89, 25000, 5000000]];

/** { min, max } allowed listing price for a card. */
export function priceRange(p) {
  let band = BANDS[0];
  for (const b of BANDS) if (p.ovr >= b[0]) band = b;
  let [, min, max] = band;
  if (p.special === 'lotg') { min *= p.era === 'prime' ? 4 : 2; max = p.era === 'prime' ? 15000000 : Math.max(max * 3, 1000000); }
  else if (p.special) { min = Math.round(min * 1.5); }
  return { min: snapPrice(min), max: snapPrice(max) };
}
/** FUT-like bid increments. */
export function priceStep(v) { return v < 1000 ? 50 : v < 10000 ? 100 : v < 50000 ? 250 : v < 100000 ? 500 : 1000; }
export function snapPrice(v) { const st = priceStep(v); return Math.max(st, Math.round(v / st) * st); }
export function clampPrice(p, v) { const r = priceRange(p); return Math.min(r.max, Math.max(r.min, snapPrice(Number(v) || 0))); }
export function suggestedPrice(p) { return clampPrice(p, niceRound(utPrice(p))); }
export function afterTax(price) { return Math.floor(price * (1 - MARKET_TAX)); }

export function isTradeable(state, pid) {
  return state.club.includes(pid) && !(state.untradeable || []).includes(pid) && !!getPlayer(pid);
}

/** Plain JSON copy of a card (what we send to the server). */
export function cardPayload(pid) {
  const p = getPlayer(pid);
  return p ? JSON.parse(JSON.stringify(p)) : null;
}

/** Put a received card into the club (registers cards our local DB does not know). Returns pid or null. */
export function acceptCard(state, card) {
  if (!card) return null;
  const known = getPlayer(card.id);
  const p = known || registerCard(card);
  if (!p) return null;
  if (!known) { state.foreign = state.foreign || {}; state.foreign[p.id] = p; }
  addToClub(state, p.id);
  return p.id;
}

const avail = (online) => !!(online && online.market);
const fail = (error) => ({ ok: false, error });
async function call(fn) {
  try { const r = await fn(); return r && typeof r === 'object' ? r : fail('Bad response'); } catch (e) { return fail(e && e.message ? e.message : 'Network error'); }
}

/** List a club card. The card leaves the club (and squad) until the listing is cancelled. */
export async function listCard(state, online, pid, price) {
  if (!avail(online)) return fail('Online market unavailable');
  const p = getPlayer(pid);
  if (!p || !state.club.includes(pid)) return fail('Card is not in your club');
  if (!isTradeable(state, pid)) return fail('This card is untradeable');
  const r = priceRange(p);
  const v = snapPrice(Number(price) || 0);
  if (!(v >= r.min && v <= r.max)) return fail(`Price must be between ${r.min} and ${r.max}`);
  const res = await call(() => online.market.list(cardPayload(pid), v));
  if (!res.ok) return fail(res.error || 'Listing failed');
  removeFromClub(state, pid);
  state.listed = state.listed || [];
  state.listed.push({ listingId: String(res.listingId), pid, price: v, listedAt: Date.now(), status: 'active' });
  return { ok: true, listingId: res.listingId };
}

/** Cancel an active (or expired) listing; the card returns to the club. */
export async function cancelListing(state, online, listingId) {
  if (!avail(online)) return fail('Online market unavailable');
  const res = await call(() => online.market.cancel(listingId));
  if (!res.ok) return fail(res.error || 'Could not cancel');
  const local = (state.listed || []).find((l) => l.listingId === String(listingId));
  const pid = acceptCard(state, res.card || (local && cardPayload(local.pid)));
  state.listed = (state.listed || []).filter((l) => l.listingId !== String(listingId));
  return { ok: true, pid };
}

/** Buy another user's listing (server moves coins). */
export async function buyListing(state, online, item) {
  if (!avail(online)) return fail('Online market unavailable');
  if (!item || !item.card) return fail('Bad listing');
  if (state.club.includes(item.card.id)) return fail('You already own this player');
  if ((state.listed || []).some((l) => l.listingId === String(item.listingId))) return fail('This is your own listing');
  const res = await call(() => online.market.buy(item.listingId));
  if (!res.ok) return fail(res.error || 'Purchase failed');
  const pid = acceptCard(state, res.card || item.card);
  return pid ? { ok: true, pid } : fail('Received an invalid card');
}

export async function searchMarket(online, filters = {}) {
  if (!avail(online)) return fail('Online market unavailable');
  const res = await call(() => online.market.search(filters));
  if (!res.ok) return fail(res.error || 'Search failed');
  const items = (Array.isArray(res.items) ? res.items : []).filter((it) => it && it.card && it.listingId != null && Number.isFinite(Number(it.price)));
  return { ok: true, items: items.map((it) => ({ ...it, listingId: String(it.listingId), price: Number(it.price) })) };
}

function statusOf(it) {
  if (it.status) return String(it.status);
  if (it.sold || it.soldAt) return 'sold';
  if (it.expired) return 'expired';
  return 'active';
}

/** My listings from the server, reconciled with local records. */
export async function fetchMine(state, online) {
  if (!avail(online)) return fail('Online market unavailable');
  const res = await call(() => online.market.mine());
  if (!res.ok) return fail(res.error || 'Could not load listings');
  const items = (Array.isArray(res.items) ? res.items : []).map((it) => ({ ...it, listingId: String(it.listingId), price: Number(it.price) || 0, status: statusOf(it) }));
  for (const l of state.listed || []) {
    const it = items.find((x) => x.listingId === l.listingId);
    if (it) l.status = it.status;
  }
  return { ok: true, items };
}

/** Claim coins for sold listings. Sold records are dropped locally. */
export async function claimSales(state, online) {
  if (!avail(online)) return fail('Online market unavailable');
  const res = await call(() => online.market.claimSales());
  if (!res.ok) return fail(res.error || 'Nothing to claim');
  state.listed = (state.listed || []).filter((l) => l.status !== 'sold');
  return { ok: true, coins: Number(res.coins) || 0 };
}
