// Admin Vault (owner request, Sep 28): a second, admin-only pack — never in the public store (see ut.js
// `storePacks`, which filters out any pack with `adminOnly: true`) or in "My Packs"; admins open it for
// free from the admin panel's "Open any pack for free" list. Each opening is ADMIN_VAULT_SIZE (10) random
// players — a varied mix across the normal pack categories (golds, rares, In-Forms, Heroes, Legends, LOTG),
// NOT just the highest-rated cards (owner: 10 random players, not the top-rated ones). The pack as a whole also has
// ADMIN_VAULT_SECRET_ODDS (0.5%) of containing the Secret card ("The Shawky"), on its first slot only, like
// the Secret Vault pack: he still cannot be admin-granted directly (admin.js `grantPlayer` blocks his id).
// DOM-free.

export const ADMIN_VAULT_PACK_ID = 'adminvault';
export const ADMIN_VAULT_SECRET_ODDS = 0.005;
export const ADMIN_VAULT_SIZE = 10;

/** Odds for the 9 ordinary slots: mostly golds, with a healthy sprinkle of specials so it's never samey. */
export const ADMIN_VAULT_MIX = {
  gold: 0.24, goldRare: 0.26, gold83: 0.16, gold86: 0.1, silverRare: 0.04,
  inform: 0.08, hero: 0.05, legend: 0.04, lotg: 0.03,
};
/** The first slot's non-secret mix (sums to 1). ut.js adds ADMIN_VAULT_SECRET_ODDS per Secret card version on
 * top and scales these down to fit, so every opening still has a real walkout. */
export const ADMIN_VAULT_TOP = { gold86: 0.5, legend: 0.2, lotg: 0.15, hero: 0.15 };
