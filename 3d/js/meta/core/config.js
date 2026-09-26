// Injectable global game config (owner-controlled). The real values live server-side and are read through
// `online.config` (net agent) — see docs/ONLINE_API.md. This module never talks to the network itself: call
// `setConfigProvider(fn)` once, wherever `online` is wired up, with a function that returns the latest known
// config object (sync — e.g. a cached value refreshed on an interval). Every other module in `core/` reads
// config through `getConfig()`, which always returns a complete, safe object (local defaults when no
// provider is set, or when the provider throws/returns something unusable) so the game works fully offline.
// DOM-free.

/** Local defaults used offline or before the net agent's config has loaded. */
export const CONFIG_DEFAULTS = Object.freeze({
  promosEnabled: true,
  packsEnabled: true,
  disabledPacks: [], // pack ids hidden from the store regardless of promosEnabled/packsEnabled
  packPriceMult: 1, // multiplies every pack's listed price
  rewardMult: 1, // multiplies coin rewards (post-match, objectives, SBCs, rivals, squad battles)
  marketTaxPct: 5, // % kept back on a Player Market sale (see pmarket.js afterTax)
});

let _provider = null;
/** Register the function the net agent calls to hand over the live config. Pass null to go back to local
 * defaults (e.g. on sign-out / offline). `fn()` must be synchronous and return a plain object or null. */
export function setConfigProvider(fn) { _provider = typeof fn === 'function' ? fn : null; }

/** The current effective config: local defaults merged with whatever the provider currently reports.
 * Never throws and never returns a partial object — every key in CONFIG_DEFAULTS is always present. */
export function getConfig() {
  let live = null;
  try { live = _provider ? _provider() : null; } catch { live = null; }
  if (!live || typeof live !== 'object') return { ...CONFIG_DEFAULTS };
  const out = { ...CONFIG_DEFAULTS, ...live };
  out.disabledPacks = Array.isArray(live.disabledPacks) ? live.disabledPacks.slice() : CONFIG_DEFAULTS.disabledPacks;
  out.packPriceMult = Number.isFinite(live.packPriceMult) && live.packPriceMult > 0 ? live.packPriceMult : CONFIG_DEFAULTS.packPriceMult;
  out.rewardMult = Number.isFinite(live.rewardMult) && live.rewardMult > 0 ? live.rewardMult : CONFIG_DEFAULTS.rewardMult;
  out.marketTaxPct = Number.isFinite(live.marketTaxPct) && live.marketTaxPct >= 0 && live.marketTaxPct <= 50 ? live.marketTaxPct : CONFIG_DEFAULTS.marketTaxPct;
  out.promosEnabled = !!out.promosEnabled;
  out.packsEnabled = !!out.packsEnabled;
  return out;
}

/** Apply packPriceMult to a pack's listed price (owner-configurable, rounded to a clean number). */
export function configuredPackPrice(price, cfg = getConfig()) {
  const v = Math.max(0, Math.round((price * (cfg.packPriceMult || 1)) / 10) * 10);
  return v;
}
/** Apply rewardMult to a coin amount. */
export function configuredCoins(coins, cfg = getConfig()) { return Math.max(0, Math.round((coins * (cfg.rewardMult || 1)) / 10) * 10); }
