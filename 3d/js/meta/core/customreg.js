// Custom (Card Creator / admin-gifted) card registry. A custom card is not part of the generated player
// database, so its full data lives in the UT save (`state.customCards[id]`) and is registered into the
// player lookup (getPlayer) on every UT load (migrateUT) and whenever one is granted or received — so the
// club, squad, market, SBC and match screens all resolve it like any other card.
// Unlike network cards (players.sanitizeCard), custom cards keep their photo, promo design, tier, PlayStyles
// and super stats (up to 999), but every field is still validated/bounded here.
import { sanitizeCard, registerLocalCard, getPlayer, FACE, GKFACE } from './players.js';

export const PHOTO_MAX = 200000; // chars of the data URL (the server accepts the same bound)
const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
const TIERS = new Set(['bronze', 'silver', 'gold', 'icon']);
const int = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);

/** A valid card photo data URL (png/jpeg/webp, bounded) or null. */
export function cleanPhoto(s) { return typeof s === 'string' && s.length <= PHOTO_MAX && PHOTO_RE.test(s) ? s : null; }

/** True for Card Creator / admin cards (full data travels with the card). */
export function isCustomCard(c) { return !!(c && typeof c === 'object' && (c.customAdmin === true || (typeof c.id === 'string' && c.id.startsWith('admin_')))); }

/** Validate a custom card (from the creator, a gift or a save). Returns a full player object or null. */
export function sanitizeCustomCard(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !ID_RE.test(c.id)) return null;
  const s = c.stats || {}, g = c.gk || {};
  const clamp99 = (o, keys, d) => Object.fromEntries(keys.map((k) => [k, int(o[k], 1, 99, d)]));
  const base = sanitizeCard({ ...c, stats: clamp99(s, FACE, 50), gk: clamp99(g, GKFACE, 10) });
  if (!base) return null;
  delete base.foreign;
  for (const k of FACE) if (s[k] != null) base.stats[k] = int(s[k], 1, 999, base.stats[k]);
  for (const k of GKFACE) if (g[k] != null) base.gk[k] = int(g[k], 1, 999, base.gk[k]);
  base.ovr = int(c.ovr, 1, 999, base.ovr);
  base.pot = Math.max(base.ovr, base.pot || 0);
  base.name = String(c.name || base.name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || 'Custom Player';
  if (typeof c.last === 'string' && c.last.trim()) base.last = c.last.trim().slice(0, 30);
  if (typeof c.special === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(c.special)) base.special = c.special;
  if (TIERS.has(c.tier)) base.tier = c.tier;
  base.rare = c.rare === true || base.tier === 'icon';
  if (Array.isArray(c.playstyles)) base.playstyles = c.playstyles.filter((x) => x && typeof x.id === 'string').slice(0, 40).map((x) => ({ id: String(x.id).slice(0, 20), plus: !!x.plus }));
  const photo = cleanPhoto(c.photo);
  if (photo) base.photo = photo;
  base.customAdmin = true;
  base.tradable = true;
  base.createdAt = Number.isFinite(c.createdAt) ? c.createdAt : Date.now();
  return base;
}

/** Store + register one custom card in a UT save. Returns the registered player or null. */
export function registerCustomCard(state, card) {
  const p = sanitizeCustomCard(card);
  if (!p) return null;
  if (state && typeof state === 'object') {
    if (!state.customCards || typeof state.customCards !== 'object' || Array.isArray(state.customCards)) state.customCards = {};
    state.customCards[p.id] = p;
  }
  return registerLocalCard(p);
}

/** UT load hook (migrateUT): make every saved custom card resolvable before the club is validated. */
export function restoreCustomCards(state) {
  if (!state || typeof state !== 'object') return;
  const map = state.customCards;
  if (!map || typeof map !== 'object' || Array.isArray(map)) { state.customCards = {}; return; }
  for (const [id, card] of Object.entries(map)) {
    const p = sanitizeCustomCard(card);
    if (p && p.id === id) { map[id] = p; registerLocalCard(p); } else delete map[id];
  }
}

/** Remove the untradeable flag (gifted / granted cards are tradable). */
function makeTradable(state, pid) {
  if (Array.isArray(state.untradeable)) state.untradeable = state.untradeable.filter((x) => x !== pid);
}

/**
 * Put a gifted / granted card into the club, tradable. Known database cards are added by id; custom cards
 * are registered with their full data; any other card (e.g. from another player's DB) is registered as a
 * foreign card. -> { ok, pid, card, duplicate } (duplicate: already owned, nothing added).
 */
export function receiveCard(state, card) {
  if (!state || !Array.isArray(state.club) || !card || typeof card !== 'object') return { ok: false, error: 'bad_card' };
  let p = null;
  if (isCustomCard(card)) p = registerCustomCard(state, card) || getPlayer(card.id);
  else {
    p = getPlayer(card.id);
    if (!p) {
      p = sanitizeCard(card);
      if (p) {
        p = registerLocalCard(p);
        state.foreign = state.foreign && typeof state.foreign === 'object' ? state.foreign : {};
        state.foreign[p.id] = p;
      }
    }
  }
  if (!p) return { ok: false, error: 'bad_card' };
  if (state.club.includes(p.id)) return { ok: true, pid: p.id, card: p, duplicate: true };
  state.club.push(p.id);
  makeTradable(state, p.id);
  return { ok: true, pid: p.id, card: p, duplicate: false };
}

/**
 * The card object to send in a gift: custom cards travel in full (with photo); database cards as a compact
 * reference (the receiver's database resolves the id), plus the full data when it is small.
 */
export function giftPayloadCard(card) {
  if (!card || typeof card !== 'object') return null;
  if (isCustomCard(card)) {
    const p = sanitizeCustomCard(card);
    if (!p) return null;
    const { photo, look, value, wage, physique, ...rest } = p; // eslint-disable-line no-unused-vars
    const out = JSON.parse(JSON.stringify(rest));
    if (photo) out.photo = photo;
    return out;
  }
  const ref = { id: card.id, name: String(card.name || 'Player').slice(0, 32), pos: card.pos, ovr: int(card.ovr, 1, 999, 50), tier: card.tier, special: card.special || null, rare: !!card.rare };
  try { const full = JSON.parse(JSON.stringify(card)); if (JSON.stringify(full).length <= 3500) return { ...full, ...ref }; } catch { /* fall through */ }
  return ref;
}
