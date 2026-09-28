// Secret card (owner request): a single, wholly fictional ultra-rare card — "The Shawky" — that exists in
// the Secret Vault pack (`SECRET_PACK_ID`) at `SECRET_ODDS` (0.0005) and the admin-only Admin Vault pack
// (`ADMIN_VAULT_PACK_ID`, see ut.js) at `ADMIN_VAULT_SECRET_ODDS` (0.005), and cannot be granted directly by
// any admin level — pulling him from one of those two packs is the only way in or out of a club. He is not
// tied to any real player (no name/nation to collide with realplayers.js/realregulars.js, no `person`), and
// — like admin cards (admincards.js) — he is kept entirely out of `getDB().all`/`db.players`/`db.specials`,
// resolved lazily through `addResolver`, so no pool that iterates those (packs' normal categories, the AI
// market, AI-opponent squads, admin's player search) can ever surface him except through those two
// guaranteed-odds slots. DOM-free.
//
// "Infinite" stats (owner request, Sep 28): every face stat is maxed at 99 (the same ceiling every other
// card's math already clamps to — computeOvr, chemistry, the match engine's 1-99 attribute clamp in
// core/teams.js toMatchPlayer all stay exactly as safe as they are for a normal 99 card) and the overall
// itself is pushed to INFINITE_OVR, the same "over 99" signal admin cards use (admincards.js MAX_ADMIN_OVR)
// that chemistry.js `isAdminChem` and swaps.js `isSwapHidden` already treat as: always max chemistry, green
// links, hidden from Swaps. The UI (card.js / modesview.js) renders every stat and the OVR/rating as "∞"
// for this one card instead of the raw number — the number itself stays finite and 1-99-safe everywhere
// else (market value, SBC rating math, sorting) because those paths use `p.ovr`/`p.stats` as plain numbers,
// never divide by "how far from a cap", so a big-but-finite number never produces NaN/Infinity. He is never
// priced (`value`/`wage` 0, like admin cards) — never on any market, never SBC fodder.
import { hashStr } from './rng.js';
import { addResolver, computeOvr } from './players.js';
import { genPhysique, PLAYSTYLE_IDS } from './physique.js';
import { POSITIONS } from './data.js';

export const SECRET_CARD_ID = 'secret_ghost';
export const SECRET_PACK_ID = 'secret';
export const SECRET_ODDS = 0.0005;
export const isSecretCardId = (id) => id === SECRET_CARD_ID;

/** Overall shown to every "over 99" system (chemistry/swaps/engine boost) — matches admin cards' ceiling. */
export const INFINITE_OVR = 999;

let _card = null;
function buildSecretCard() {
  if (_card) return _card;
  const pos = 'ST';
  const alt = POSITIONS.filter((x) => x !== pos); // every other outfield position + GK — he plays anywhere
  const p = {
    // `last: 'Shawky'` (not the full "The Shawky") so the card face's compact nameplate (core/players.js
    // `cardName`) doesn't overflow/truncate like every other single-surname card; `name` stays the full
    // "The Shawky" everywhere else (details view title, aria-labels, market/admin listings, ...).
    id: SECRET_CARD_ID, first: '', last: 'Shawky', name: 'The Shawky', age: 24, nat: 'EGY', club: 'SEC', league: 'SEC',
    pos, alt,
    stats: { pac: 99, sho: 99, pas: 99, dri: 99, def: 99, phy: 99 },
    gk: { div: 99, han: 99, kic: 99, ref: 99, spd: 99, pos: 99 },
  };
  computeOvr(pos, p); // sanity: every face stat maxed computes to a clean 99 before the "infinite" override below
  p.ovr = INFINITE_OVR;
  p.pot = p.ovr;
  p.wf = 5; p.sm = 5; p.foot = 'R'; p.wr = ['High', 'High'];
  p.rare = true; p.tier = 'gold'; p.special = 'secret'; p.secret = true; p.real = false;
  // `glitch`: the in-match "OP tier" flag (core/teams.js carries it into the contract match-player shape,
  // same way `rawOvr` carries admin cards' over-99 — see engine/core/sim.js `_applyData` / ai.js / render).
  p.glitch = true;
  p.skin = 3;
  Object.assign(p, genPhysique(p)); // deterministic height/weight, same rules as every other card
  // Every PlayStyle AND PlayStyle+ that exists (owner request) — overrides genPhysique's normal draw/limits,
  // exactly like admincards.js hand-picks its own extra PlayStyle+ list instead of using pickStyles' bands.
  p.playstyles = PLAYSTYLE_IDS.map((id) => ({ id, plus: true }));
  p.value = 0; p.wage = 0; // never priced — never tradeable, never on any market (like admin cards)
  p.look = hashStr(p.id) % 997;
  _card = p;
  return _card;
}

/** The one Secret card (always the same object/reference). */
export function secretCard() { return buildSecretCard(); }

addResolver((id) => (isSecretCardId(id) ? buildSecretCard() : null));
