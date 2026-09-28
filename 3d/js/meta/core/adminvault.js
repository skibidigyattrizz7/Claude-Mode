// Admin Vault (owner request, Sep 28): a second, admin-only pack — never in the public store (see ut.js
// `storePacks`, which filters out any pack with `adminOnly: true`) or in "My Packs"; admins open it for
// free from the admin panel's "Open any pack for free" list, same as every other pack there. Its pool is
// the 50 highest-rated ordinary cards in the game (icons/Legends of the Game first, then the very best
// regular golds) — nothing invented, all real `getDB().all` cards. Every draw from this pool also has a
// small, separate chance (`ADMIN_VAULT_SECRET_ODDS`, 10x the Secret Vault pack's own odds — still an admin
// tool, not a way to farm him) of landing the Secret card ("The Shawky") instead, exactly like the Secret
// Vault pack's own slot: he still cannot be admin-granted directly (admin.js `grantPlayer` blocks his id
// unconditionally, whichever pack a caller is opening), so pulling him from one of these two packs' odds
// remains the only way into (or out of) a club. DOM-free.
import { getDB } from './players.js';

export const ADMIN_VAULT_PACK_ID = 'adminvault';
export const ADMIN_VAULT_SECRET_ODDS = 0.005;
export const ADMIN_VAULT_SIZE = 50;

let _pool = null;
/** The Admin Vault's fixed 50-card pool — the highest-rated cards in `getDB().all` (never the Secret card,
 * which lives outside `db.all` entirely and is layered on top by the pack's own odds — see ut.js). */
export function adminVaultPool() {
  if (_pool) return _pool;
  const db = getDB();
  _pool = db.all.slice().sort((a, b) => b.ovr - a.ovr).slice(0, ADMIN_VAULT_SIZE);
  return _pool;
}
