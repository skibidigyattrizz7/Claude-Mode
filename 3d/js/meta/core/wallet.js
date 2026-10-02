// One UT balance model for local coins and admin "infinite coins" (DOM-free, testable).
//   state.coins          the working balance every screen reads/spends (INFINITE_COINS while infinite is on)
//   state.admin.infinite infinite coins on/off
//   state.admin.stash    the REAL local balance while infinite is on (restored when it goes off)
// While infinite is on, spends are free and earnings still count: settleInfinite() moves any gain above
// INFINITE_COINS into the stash. Toggling never loses, corrupts or NaNs the real balance.
import { INFINITE_COINS } from './admin.js';

export { INFINITE_COINS };
const MAX_REAL = 9e15; // safe-integer range (owner grants go this high)
/** A finite, non-negative whole number of coins (NaN / strings / negatives -> fallback). */
export function cleanCoins(v, fallback = 0) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(MAX_REAL, Math.round(n))) : fallback;
}
export const isInfinite = (s) => !!(s && s.admin && s.admin.infinite);

/** The player's real balance (the stash while infinite is on). */
export function realCoins(s) {
  if (!s) return 0;
  return isInfinite(s) ? cleanCoins(s.admin.stash, 0) : cleanCoins(s.coins, 0);
}

/** Repair a loaded / edited save in place: no NaN, no leftover INFINITE_COINS as a real balance. */
export function normalizeWallet(s) {
  if (!s || typeof s !== 'object') return s;
  s.admin = s.admin && typeof s.admin === 'object' ? s.admin : {};
  if (s.admin.infinite) {
    s.admin.infinite = true;
    if (!Number.isFinite(Number(s.admin.stash)) || s.admin.stash === null) {
      const c = cleanCoins(s.coins, 0);
      s.admin.stash = c >= INFINITE_COINS ? 0 : c;
    } else s.admin.stash = cleanCoins(s.admin.stash, 0);
    s.coins = INFINITE_COINS;
  } else {
    s.admin.infinite = false;
    let c = cleanCoins(s.coins, NaN);
    if (!Number.isFinite(c) || c >= INFINITE_COINS) c = Number.isFinite(Number(s.admin.stash)) && s.admin.stash !== null ? cleanCoins(s.admin.stash, 0) : (Number.isFinite(c) ? c : 0);
    s.coins = c;
    delete s.admin.stash;
  }
  return s;
}

/** While infinite: keep earnings (gain above INFINITE_COINS) in the stash, then reset the working balance.
 * -> coins earned since the last settle (0 when nothing was earned or infinite is off). */
export function settleInfinite(s, { stash = true } = {}) {
  if (!isInfinite(s)) return 0;
  const c = Number(s.coins);
  const gained = Number.isFinite(c) && c > INFINITE_COINS ? Math.round(c - INFINITE_COINS) : 0;
  if (gained > 0 && stash) s.admin.stash = cleanCoins(cleanCoins(s.admin.stash, 0) + gained, 0);
  s.coins = INFINITE_COINS;
  return gained;
}

/** Turn infinite coins on/off. `realBalance` (optional) = the balance to restore when turning off
 * (e.g. the online server balance); defaults to the stash. -> the state. */
export function setInfinite(s, on, { realBalance = null } = {}) {
  if (!s) return s;
  normalizeWallet(s);
  if (on) {
    if (!s.admin.infinite) { s.admin.stash = cleanCoins(s.coins, 0); s.admin.infinite = true; }
    s.coins = INFINITE_COINS;
  } else if (s.admin.infinite) {
    settleInfinite(s);
    const back = realBalance != null && Number.isFinite(Number(realBalance)) ? cleanCoins(realBalance, 0) : cleanCoins(s.admin.stash, 0);
    s.admin.infinite = false;
    delete s.admin.stash;
    s.coins = back;
  }
  return s;
}
