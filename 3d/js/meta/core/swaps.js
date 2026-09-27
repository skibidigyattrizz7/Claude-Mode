// Swaps: exchange owned player cards for coins or tokens; tokens buy packs in the Token Store.
// Owner request (Sep 27). DOM-free, mirrors the style of pmarket.js (every function resolves
// { ok, ... } | { ok:false, error }, never throws).
//
// TOKENS is a second UT currency, alongside coins (see ut.js `addCoins`). It lives on `state.tokens`,
// initialised in `createUTState` and sanitised in `migrateUT` (both in ut.js — see the two-line hook
// there); every mutation in this file goes through `addTokens` below, exactly like `addCoins` for coins,
// so it is always a non-negative integer and never NaN.
import { getPlayer, quickSellValue } from './players.js';
import { isPromoSpecial } from './promos.js';
import { getConfig } from './config.js';
import * as UT from './ut.js';
import { isAdminChem } from './chemistry.js';

/** Owner request (Sep 27): admin cards (ids 'ad_…' / rated above 99) are hidden from Swaps and can't be swapped. */
export const isSwapHidden = (p) => isAdminChem(p);

const fail = (error) => ({ ok: false, error });

/** The only way anything should mutate `state.tokens` — never negative, never NaN, always an integer. */
export function addTokens(state, delta) {
  const d = Number.isFinite(delta) ? Math.round(delta) : 0;
  state.tokens = Math.max(0, Math.round(Number(state.tokens) || 0) + d);
  return state.tokens;
}

// ---------- eligibility ----------
/**
 * Can `pid` be swapped right now?
 * - not owned in the club -> hard no.
 * - in the starting XI -> hard no (owner request: never swap a starter).
 * - on the bench -> allowed, but flagged `needsConfirm` ("last copy needed for squad validity" — removing
 *   it leaves that bench slot empty until refilled) so the UI can ask first.
 * - untradeable cards ARE swappable (unlike the Player Market, which forbids them).
 */
export function checkSwappable(state, pid) {
  if (!state || !state.club.includes(pid) || !getPlayer(pid)) return { ok: false, reason: 'not-owned' };
  if (isSwapHidden(getPlayer(pid))) return { ok: false, reason: 'admin-card' };
  if (state.squad.slots.includes(pid)) return { ok: false, reason: 'starting-xi' };
  return { ok: true, needsConfirm: (state.squad.bench || []).includes(pid) };
}
const swapBlocked = (chk) => fail(chk.reason === 'starting-xi' ? 'This card is in your starting XI'
  : chk.reason === 'admin-card' ? 'Admin cards can’t be swapped' : 'Card is not in your club');

// ---------- valuation ----------
const SWAP_COIN_MULT = 1.5; // owner request: swapping for coins beats quick-sell (currently 1.5x)
/** Coin value of a swap — quick-sell already scales with rating/rarity/promo, so this stays in step with it. */
export function swapCoinValue(p) { return Math.round((quickSellValue(p) * SWAP_COIN_MULT) / 10) * 10; }

/** Token value of a swap: 0 below 84, 1 for gold 84+, 2 for 87+, 3 for a promo/Icon/Legend/Hero/LOTG card. */
export function swapTokenValue(p) {
  if (!p) return 0;
  if (isPromoSpecial(p.special) || p.special === 'legend' || p.special === 'lotg' || p.special === 'hero') return 3;
  if (p.ovr >= 87) return 2;
  if (p.ovr >= 84) return 1;
  return 0;
}

// ---------- single-card swaps ----------
/** Swap one card for coins. -> { ok:true, coins } | { ok:false, error } */
export function swapForCoins(state, pid, { confirm = false } = {}) {
  const chk = checkSwappable(state, pid);
  if (!chk.ok) return swapBlocked(chk);
  if (chk.needsConfirm && !confirm) return fail('This card is in your squad — confirm to swap anyway');
  const coins = swapCoinValue(getPlayer(pid));
  UT.removeFromClub(state, pid);
  UT.addCoins(state, coins);
  return { ok: true, coins };
}
/** Swap one card for tokens. -> { ok:true, tokens } | { ok:false, error } */
export function swapForTokens(state, pid, { confirm = false } = {}) {
  const chk = checkSwappable(state, pid);
  if (!chk.ok) return swapBlocked(chk);
  const p = getPlayer(pid);
  const tokens = swapTokenValue(p);
  if (tokens <= 0) return fail('This card is not worth any tokens — try Swap for Coins instead');
  if (chk.needsConfirm && !confirm) return fail('This card is in your squad — confirm to swap anyway');
  UT.removeFromClub(state, pid);
  addTokens(state, tokens);
  return { ok: true, tokens };
}

// ---------- swap sets ("hand in N players meeting requirements -> X tokens") ----------
export const SWAP_SETS = [
  { id: 'fc-bronze', name: 'Bronze Foundations', desc: 'Hand in 4 bronze players for 1 token.', count: 4, minOvr: 0, maxOvr: 64, tokens: 1 },
  { id: 'fc-gold', name: 'Gold Foundations', desc: 'Hand in 5 gold players (75+) for 3 tokens.', count: 5, minOvr: 75, tokens: 3 },
  { id: 'fc-rare', name: 'Rare Talent Exchange', desc: 'Hand in 5 rare players (80+) for 5 tokens.', count: 5, minOvr: 80, rareOnly: true, tokens: 5 },
  { id: 'fc-elite', name: 'Elite Exchange', desc: 'Hand in 3 players rated 85+ for 8 tokens.', count: 3, minOvr: 85, tokens: 8 },
];
export const SWAP_SET_BY_ID = Object.fromEntries(SWAP_SETS.map((s) => [s.id, s]));

/** Requirement checklist for a swap set given candidate card ids (unresolved/missing ids -> not ok). */
export function evaluateSwapSet(setId, pids) {
  const set = SWAP_SET_BY_ID[setId];
  if (!set) return { ok: false, checks: [] };
  const cards = (pids || []).map(getPlayer);
  if (cards.some((c) => c && isSwapHidden(c))) return { ok: false, checks: [{ label: 'No admin cards', ok: false }] };
  const checks = [{ label: `Exactly ${set.count} players`, ok: cards.length === set.count && cards.every(Boolean), cur: `${cards.filter(Boolean).length}/${set.count}` }];
  const known = cards.filter(Boolean);
  checks.push({ label: `All players rated ${set.minOvr}+`, ok: known.length > 0 && known.every((p) => p.ovr >= set.minOvr) });
  if (set.maxOvr != null) checks.push({ label: `All players rated ${set.maxOvr} or below`, ok: known.every((p) => p.ovr <= set.maxOvr) });
  if (set.rareOnly) checks.push({ label: 'All players rare', ok: known.length > 0 && known.every((p) => p.rare) });
  return { checks, ok: checks.every((c) => c.ok) };
}

/** Submit a swap set: consumes every listed card, credits `set.tokens`. -> { ok:true, tokens } | { ok:false, error } */
export function submitSwapSet(state, setId, pids, { confirm = false } = {}) {
  const set = SWAP_SET_BY_ID[setId];
  if (!set) return fail('Unknown swap set');
  const list = pids || [];
  if (new Set(list).size !== list.length) return fail('The same card was selected twice');
  for (const pid of list) {
    const chk = checkSwappable(state, pid);
    if (!chk.ok) return swapBlocked(chk);
    if (chk.needsConfirm && !confirm) return fail('One of these cards is in your squad — confirm to swap anyway');
  }
  const ev = evaluateSwapSet(setId, list);
  if (!ev.ok) return fail('Requirements not met');
  for (const pid of list) UT.removeFromClub(state, pid);
  addTokens(state, set.tokens);
  return { ok: true, tokens: set.tokens };
}

// ---------- token store (packs bought with tokens) ----------
// Reuses UT.PACKS/UT.PACK_BY_ID as-is; this just attaches a token price on top of the existing coin price.
// Promo packs are priced as a group (owner request range 5-10) rather than per-campaign since there are 32.
const TOKEN_PRICES = { bronze: 1, silver: 1, gold: 2, premium: 5, rare: 6, totw: 6, legend: 10, lotg: 10 };
const PROMO_TOKEN_PRICE = 8;
/** Token price for a pack, or 0 when it isn't sold in the Token Store (e.g. the Secret Vault pack). */
export function tokenPriceFor(pack) {
  if (!pack) return 0;
  if (pack.promo) return PROMO_TOKEN_PRICE;
  return TOKEN_PRICES[pack.id] || 0;
}
/** Packs on sale for tokens right now: `UT.storePacks()` already applies packsEnabled/disabledPacks/promo gating. */
export function tokenStoreListing(cfg = getConfig()) {
  return UT.storePacks(undefined, cfg).map((pack) => ({ pack, tokens: tokenPriceFor(pack) })).filter((x) => x.tokens > 0);
}
/** Spend tokens on a pack (same availability rules as the coin Store). -> { ok:true, tokens, pack } | { ok:false, error } */
export function buyPackWithTokens(state, packId, cfg = getConfig()) {
  const pack = UT.PACK_BY_ID[packId];
  const price = tokenPriceFor(pack);
  if (!pack || !price) return fail('Not available in the Token Store');
  if (!UT.storePacks(undefined, cfg).some((p) => p.id === packId)) return fail('Pack is not currently available');
  if ((Number(state.tokens) || 0) < price) return fail('Not enough tokens');
  addTokens(state, -price);
  return { ok: true, tokens: price, pack };
}
