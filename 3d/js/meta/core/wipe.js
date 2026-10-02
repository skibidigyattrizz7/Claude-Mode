// Forget this device's local club / progress for the current online profile. Tiny and dependency-light on purpose:
// main.js imports it statically so the wipe runs synchronously the moment the server says the profile was deleted
// (before anything can register a new profile or upload the old club to it).
import { remove, PREFIX } from './storage.js';

export const DELETED_MESSAGE = 'Your account was deleted by an admin.';
// keys are ut.js UT_KEY / seasons.js SEASON_KEY (a test checks they match)
export const WIPE_KEYS = ['ut', 'ut.backup', 'ut.cloud', 'season'];

/** Remove the UT save + its backup and cloud link, the season track and the per-profile reset records. */
export function wipeLocalProfile() {
  for (const k of WIPE_KEYS) remove(k);
  try {
    const st = globalThis.localStorage;
    const drop = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (k && (k.startsWith(`${PREFIX}resetSeen.`) || k.startsWith(`${PREFIX}resetApplied.`))) drop.push(k);
    }
    for (const k of drop) st.removeItem(k);
  } catch { /* storage unavailable: nothing to wipe */ }
}
