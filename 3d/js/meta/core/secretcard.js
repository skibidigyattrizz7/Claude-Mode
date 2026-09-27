// Secret card (owner request): a single, wholly fictional ultra-rare card that exists in exactly one pack
// (`SECRET_PACK_ID`) at `SECRET_ODDS` (0.0005) and cannot be granted by any admin level — the only way in
// or out of a club is actually pulling it. It is not tied to any real player (no name/nation to collide
// with realplayers.js/realregulars.js, no `person`), and — like admin cards (admincards.js) — it is kept
// entirely out of `getDB().all`/`db.players`/`db.specials`, resolved lazily through `addResolver`, so no
// pool that iterates those (packs' normal categories, the AI market, AI-opponent squads, admin's player
// search) can ever surface it except through the one guaranteed-odds slot below. DOM-free.
import { hashStr } from './rng.js';
import { addResolver, computeOvr, marketValue, weeklyWage } from './players.js';
import { genPhysique } from './physique.js';

export const SECRET_CARD_ID = 'secret_ghost';
export const SECRET_PACK_ID = 'secret';
export const SECRET_ODDS = 0.0005;
export const isSecretCardId = (id) => id === SECRET_CARD_ID;

let _card = null;
function buildSecretCard() {
  if (_card) return _card;
  const pos = 'CF';
  const p = {
    id: SECRET_CARD_ID, first: '', last: '???', name: '??? (Secret)', age: 26, nat: 'BRA', club: 'SEC', league: 'SEC',
    pos, alt: ['ST', 'CAM'],
    // Hand-tuned to land on exactly 97 through CF's position weights (see players.js POS_WEIGHTS.CF).
    stats: { pac: 99, sho: 99, pas: 93, dri: 99, def: 45, phy: 90 },
    gk: { div: 12, han: 12, kic: 20, ref: 12, spd: 99, pos: 12 },
  };
  p.ovr = computeOvr(pos, p);
  p.pot = p.ovr;
  p.wf = 5; p.sm = 5; p.foot = 'R'; p.wr = ['High', 'Low'];
  p.rare = true; p.tier = 'gold'; p.special = 'secret'; p.secret = true; p.real = false;
  p.skin = 3;
  Object.assign(p, genPhysique(p)); // deterministic height/weight/PlayStyles, same rules as every other card
  p.value = marketValue(p);
  p.wage = weeklyWage(p);
  p.look = hashStr(p.id) % 997;
  _card = p;
  return _card;
}

/** The one Secret card (always the same object/reference). */
export function secretCard() { return buildSecretCard(); }

addResolver((id) => (isSecretCardId(id) ? buildSecretCard() : null));
