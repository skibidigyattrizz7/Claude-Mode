// Admin cards (owner request): the top 100 real players get an OP, admin-only version — OVR up to 999
// (face stats are maxed; the engine clamps every attribute to 1-99 anyway, see teams.js toMatchPlayer/
// effectiveOvr, so the huge number is a display flex, never a gameplay exploit), extra PlayStyle+.
// Never generated into packs/market/rewards: they live outside `getDB().all` entirely and are resolved
// lazily through `addResolver`, so `getPlayer('ad_<id>')` works but no pool that iterates `db.all`/
// `db.players` ever sees one. Obtaining one is gated by admin level ('super' only) or an admin grant —
// enforced by the caller (see grantAdminCard) with the level string it already resolved, not by importing
// an admin module here (keeps this file decoupled from wherever admin levels end up living). DOM-free.
import { hashStr, Rng } from './rng.js';
import { getPlayer, addResolver, realPlayers, realRegulars, personOf } from './players.js';
import { PLAYSTYLES } from './physique.js';

export const ADMIN_TOP_N = 100;
export const MAX_ADMIN_OVR = 999;
export const MIN_ADMIN_OVR = 150;
export const ADMIN_ID_PREFIX = 'ad_';
export const isAdminCardId = (id) => typeof id === 'string' && id.startsWith(ADMIN_ID_PREFIX);

let _cards = null;
let _byBase = null;

function buildAdminCards() {
  if (_cards) return _cards;
  const pool = realPlayers().concat(realRegulars())
    .slice()
    .sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1))
    .filter((p, i, arr) => arr.findIndex((x) => personOf(x) === personOf(p)) === i) // one card per person (their best)
    .slice(0, ADMIN_TOP_N);
  const step = ADMIN_TOP_N > 1 ? (MAX_ADMIN_OVR - MIN_ADMIN_OVR) / (ADMIN_TOP_N - 1) : 0;
  _cards = pool.map((base, i) => {
    const p = structuredClone(base);
    p.id = `${ADMIN_ID_PREFIX}${base.id}`;
    p.baseId = base.id;
    delete p.intended; delete p.promo; delete p.upg; delete p.moment;
    const src = p.pos === 'GK' ? p.gk : p.stats;
    for (const k of Object.keys(src)) src[k] = 99;
    p.ovr = Math.round(MAX_ADMIN_OVR - i * step);
    p.pot = p.ovr;
    p.wf = 5; p.sm = p.pos === 'GK' ? 1 : 5;
    p.rare = true; p.tier = 'gold'; p.real = true;
    p.special = 'admin'; p.adminOnly = true; p.linkAll = true;
    p.secret = false;
    const gk = p.pos === 'GK';
    const rng = new Rng(`admincard-${base.id}`);
    const extra = rng.shuffle(Object.keys(PLAYSTYLES).filter((id) => (PLAYSTYLES[id][1] === 'gk') === gk));
    p.playstyles = extra.slice(0, 4).map((id) => ({ id, plus: true }));
    p.value = 0; p.wage = 0; // never priced — never tradeable, never on any market
    p.look = hashStr(p.id) % 997;
    return p;
  });
  _byBase = new Map(_cards.map((c) => [c.baseId, c]));
  return _cards;
}

/** All 100 admin cards, ranked #1 (999 OVR) to #100. */
export function adminCards() { return buildAdminCards(); }
/** The admin card for a given base real-player id, or null if they didn't make the top 100. */
export function adminCardFor(baseId) { buildAdminCards(); return _byBase.get(baseId) || null; }

addResolver((id) => (isAdminCardId(id) ? buildAdminCards().find((c) => c.id === id) || null : null));

/**
 * Grant an admin card to a UT club. `level` is the caller's already-resolved admin level string
 * ('super' | 'full' | 'mod' | 'temp' | null | 'owner' — whatever the admin module in use reports);
 * only 'super' may pull from the admin-card pool, matching the owner's rule that these are strictly
 * super-admin-only (never grantable by a lesser code, and never obtainable any other way).
 */
export function grantAdminCard(state, pid, level) {
  if (!isAdminCardId(pid)) return { ok: false, error: 'Not an admin card' };
  if (level !== 'super') return { ok: false, error: 'Admin cards require the super admin level' };
  const p = getPlayer(pid);
  if (!p) return { ok: false, error: 'Unknown admin card' };
  if (state.club.includes(pid)) return { ok: false, error: 'Already in your club' };
  state.club.push(pid);
  state.untradeable = state.untradeable || [];
  if (!state.untradeable.includes(pid)) state.untradeable.push(pid);
  return { ok: true, player: p };
}
