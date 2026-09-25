// Admin "Card Creator": build a fully custom card (photo, name, position, stats, club colours) for the
// Admin Cards gallery. Full club/gameplay integration needs a core hook that does not exist yet (see
// docs/META_API.md) — feature-detected below — so grants fall back to a local, clearly-labelled gallery
// entry that renders with the normal card component and can still be viewed/downloaded.
import { computeOvr, POS_WEIGHTS } from '../core/players.js';
import { load, save } from '../core/storage.js';
import * as UT from '../core/ut.js';

const KEY = 'meta.admin.customcards';
let uid = 0;

export function listCustomCards() { const l = load(KEY, []); return Array.isArray(l) ? l : []; }
function writeAll(list) { save(KEY, list); }

export function deleteCustomCard(id) { writeAll(listCustomCards().filter((c) => c.id !== id)); }

/** Build+save a full card object from Card Creator form input. Returns the saved player-shaped card. */
export function createCustomCard({ name, pos = 'ST', nat = 'ENG', club = 'FUT', tier = 'gold', stats, photo = null, special = null }) {
  const isGk = pos === 'GK';
  const keys = isGk ? ['div', 'han', 'kic', 'ref', 'spd', 'pos'] : ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
  const vals = keys.map((k) => Math.max(1, Math.min(99, Math.round(Number(stats[k]) || 65))));
  const statObj = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  const p = {
    id: `admin_${Date.now()}_${uid++}`,
    name: String(name || 'Custom Player').slice(0, 26),
    last: String(name || 'Custom Player').split(' ').slice(-1)[0].slice(0, 20),
    pos, alt: [], nat, club, tier, rare: tier !== 'bronze' && tier !== 'silver' && tier !== 'gold',
    special: special || null, customAdmin: true, photo,
    createdAt: Date.now(),
  };
  if (isGk) p.gk = statObj; else p.stats = statObj;
  p.ovr = computeOvr(pos, p);
  const list = listCustomCards();
  list.unshift(p);
  writeAll(list.slice(0, 40));
  return p;
}

export function getCustomCard(id) { return listCustomCards().find((c) => c.id === id) || null; }

/** Grant a custom card to the club when the core exposes a registration hook; otherwise gallery-only. */
export function grantCustomCard(state, card) {
  if (typeof UT.registerCustomCard === 'function') {
    UT.registerCustomCard(card);
    UT.addToClub(state, card.id);
    state.untradeable = state.untradeable || [];
    state.untradeable.push(card.id);
    return { ok: true, integrated: true };
  }
  return { ok: true, integrated: false };
}

export const POSITIONS_ALL = Object.keys(POS_WEIGHTS);
