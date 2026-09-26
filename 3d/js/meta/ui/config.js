// Owner-controlled global config toggles (promos on/off, packs in shop, price multiplier). Local-only
// (per device) unless a future `online.config` service exists — feature-detected, never assumed.
import { load, save } from '../core/storage.js';

const KEY = 'meta.admin.config';
const DEFAULTS = { promosOn: true, packsInShop: true, priceMult: 1 };

let cache = null;
export function getConfig() {
  if (!cache) cache = { ...DEFAULTS, ...load(KEY, {}) };
  return cache;
}
export function setConfig(patch) {
  cache = { ...getConfig(), ...patch };
  save(KEY, cache);
  return cache;
}
/** Effective coin price after the owner's global multiplier. */
export function effPrice(base) { return Math.max(0, Math.round(base * (getConfig().priceMult || 1))); }

/** Push the local config to the online service too, when it exists (never throws). */
export async function syncConfig(online, patch) {
  const cfg = setConfig(patch);
  try { if (online && online.config && typeof online.config.set === 'function') await online.config.set(cfg); } catch { /* ignore */ }
  return cfg;
}
