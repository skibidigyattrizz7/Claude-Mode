// Admin "Card Creator": build a fully custom card (photo, name, position, stats, club colours) for the
// Admin Cards gallery. Granting / receiving one goes through core/customreg.js (full card data kept in the
// UT save and registered into getPlayer), so it works everywhere a normal club card does.
import { computeOvr, POS_WEIGHTS, getPlayer } from '../core/players.js';
import { load, save } from '../core/storage.js';
import { receiveCard, registerCustomCard, ALT_MAX } from '../core/customreg.js';

export { ALT_MAX };

const KEY = 'meta.admin.customcards';
let uid = 0;

export function listCustomCards() { const l = load(KEY, []); return Array.isArray(l) ? l : []; }
function writeAll(list) { save(KEY, list); }

export function deleteCustomCard(id) { writeAll(listCustomCards().filter((c) => c.id !== id)); }

/** Build a full player-shaped card from Card Creator form input (no saving). */
function buildCard({ name, pos = 'ST', alt = [], nat = 'ENG', club = 'FUT', tier = 'gold', stats = {}, photo = null, special = null, superLevel = false, playstyles = [] }, id, createdAt) {
  const isGk = pos === 'GK';
  // The form's six sliders are always keyed pac/sho/pas/dri/def/phy (only their on-screen labels change to
  // DIV/HAN/KIC/REF/SPD/POS for a keeper — see adminextra.js statRow); read them by those keys regardless of
  // position, then place the values under the GK field names when saving a keeper. Reading GK cards by the
  // GK key names here (the previous bug) meant `stats[k]` was always undefined for a keeper, so every stat
  // silently fell back to the 65 default.
  const srcKeys = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
  const outKeys = isGk ? ['div', 'han', 'kic', 'ref', 'spd', 'pos'] : srcKeys;
  const cap = superLevel ? 999 : 99;
  const vals = srcKeys.map((k) => Math.max(1, Math.min(cap, Math.round(Number(stats[k]) || 65))));
  const statObj = Object.fromEntries(outKeys.map((k, i) => [k, vals[i]]));
  const p = {
    id,
    name: String(name || 'Custom Player').slice(0, 26),
    last: String(name || 'Custom Player').split(' ').slice(-1)[0].slice(0, 20),
    pos, alt: [...new Set(Array.isArray(alt) ? alt : [])].filter((x) => x && x !== pos).slice(0, ALT_MAX), nat, club: club || 'FUT', tier, rare: tier !== 'bronze' && tier !== 'silver' && tier !== 'gold',
    special: special || null, customAdmin: true, photo, tradable: true, superLevel: !!superLevel,
    playstyles: Array.isArray(playstyles) ? playstyles.slice(0, 40) : [],
    createdAt,
  };
  if (isGk) p.gk = statObj; else p.stats = statObj;
  // Core computeOvr clamps to 1..99; super cards can go further, using the same weighted formula uncapped.
  // (Sub-stats are derived from these six face stats, so they follow any edit automatically.)
  p.ovr = superLevel ? Math.max(1, Math.min(999, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))) : computeOvr(pos, p);
  return p;
}

/** Build+save a full card object from Card Creator form input. Returns the saved player-shaped card.
 * `superLevel`: true unlocks stats/OVR above 99 (up to 999), matching adminCaps().maxOvr for the super level. */
export function createCustomCard(input) {
  const p = buildCard(input, `admin_${Date.now()}_${uid++}`, Date.now());
  const list = listCustomCards();
  list.unshift(p);
  writeAll(list.slice(0, 40));
  return p;
}

/**
 * Edit a saved card in place: same id (and creation time), rebuilt from the form input like createCustomCard.
 * Re-registers it so every copy that resolves through the registry (getPlayer) shows the new stats/design, and
 * refreshes the snapshot kept in `state` (this device's UT save) when that club owns it. Other players' saves
 * keep their own snapshot until the card is sent/granted to them again. -> the updated card or null.
 */
export function updateCustomCard(id, input, { state = null } = {}) {
  const list = listCustomCards();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const old = list[i];
  const p = { ...buildCard({ club: old.club, ...input }, id, Number.isFinite(old.createdAt) ? old.createdAt : Date.now()), updatedAt: Date.now() };
  list[i] = p;
  writeAll(list);
  const owned = state && state.customCards && typeof state.customCards === 'object' && state.customCards[id];
  if (owned) registerCustomCard(state, p);
  else if (getPlayer(id)) registerCustomCard(null, p);
  return p;
}

/** Copy a saved card as a new gallery card (new id). -> the copy or null. */
export function duplicateCustomCard(id) {
  const c = getCustomCard(id);
  if (!c) return null;
  const copy = { ...JSON.parse(JSON.stringify(c)), id: `admin_${Date.now()}_${uid++}`, createdAt: Date.now() };
  delete copy.updatedAt;
  const list = listCustomCards();
  const i = list.findIndex((x) => x.id === id);
  list.splice(i + 1, 0, copy);
  writeAll(list.slice(0, 40));
  return copy;
}

/** Import a ready-made card object (e.g. received via a gift) into the local gallery as-is. */
export function importCustomCard(card) {
  if (!card || typeof card !== 'object' || !card.id) return null;
  const list = listCustomCards();
  if (list.some((c) => c.id === card.id)) return card;
  list.unshift({ ...card, customAdmin: true });
  writeAll(list.slice(0, 40));
  return card;
}

export function getCustomCard(id) { return listCustomCards().find((c) => c.id === id) || null; }

/** Grant a custom card to the club: stored in the UT save (state.customCards) and registered into the player
 * lookup, so club / squad / market / SBC screens resolve it. Tradable. -> { ok, integrated, duplicate, error } */
export function grantCustomCard(state, card) {
  if (!state) return { ok: false, integrated: false, error: 'no_club' };
  const r = receiveCard(state, { ...card, customAdmin: true });
  return r.ok ? { ok: true, integrated: true, duplicate: r.duplicate, pid: r.pid } : { ok: false, integrated: false, error: r.error };
}

export const POSITIONS_ALL = Object.keys(POS_WEIGHTS);
