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

// More versions of the same ∞ glitch card (owner request, Sep 28): each has its own name + nation and
// otherwise identical powers. They share the Secret slot's odds (the slot picks one version at random), and
// none of them can be admin-granted either.
export const SECRET_VERSIONS = [
  { id: SECRET_CARD_ID, last: 'Shawky', name: 'The Shawky', nat: 'EGY', skin: 3 },
  { id: 'secret_kilner', last: 'Kilner', name: 'Kilner', nat: 'SCO', skin: 0 },
  { id: 'secret_collins', last: 'Collins', name: 'Collins', nat: 'KOR', skin: 1 },
  { id: 'secret_patel', last: 'Patel', name: 'Patel', nat: 'IND', skin: 3 },
  { id: 'secret_oelke', last: 'Oelke', name: 'Oelke', nat: 'GER', skin: 0 },
  { id: 'secret_masilang', last: 'Masilang', name: 'BraydenMasilang', nat: 'PHI', skin: 2 },
  { id: 'secret_nickerson', last: 'Nickerson', name: 'Nickerson', nat: 'KEN', skin: 5 },
  { id: 'secret_dammad', last: 'Dammad', name: 'Dammad', nat: 'PLE', skin: 3 },
  // hand-drawn face (meta/ui/art.js CUSTOM_AVATARS.grumpy), owner request Sep 29
  { id: 'secret_grumpypatel', last: 'Grumpy Patel', name: 'Grumpy Patel', nat: 'IND', skin: 1, avatar: 'grumpy' },
];
const VERSION_BY_ID = new Map(SECRET_VERSIONS.map((v) => [v.id, v]));
export const SECRET_CARD_IDS = SECRET_VERSIONS.map((v) => v.id);
export const isSecretCardId = (id) => VERSION_BY_ID.has(id);

/** Overall shown to every "over 99" system (chemistry/swaps/engine boost) — matches admin cards' ceiling. */
export const INFINITE_OVR = 999;

const _cards = new Map();
function buildSecretCard(id = SECRET_CARD_ID) {
  const ver = VERSION_BY_ID.get(id);
  if (!ver) return null;
  if (_cards.has(id)) return _cards.get(id);
  const pos = 'ST';
  const alt = POSITIONS.filter((x) => x !== pos); // every other outfield position + GK — he plays anywhere
  const p = {
    // `last: 'Shawky'` (not the full "The Shawky") so the card face's compact nameplate (core/players.js
    // `cardName`) doesn't overflow/truncate like every other single-surname card; `name` stays the full
    // "The Shawky" everywhere else (details view title, aria-labels, market/admin listings, ...).
    id: ver.id, first: '', last: ver.last, name: ver.name, age: 24, nat: ver.nat, club: 'SEC', league: 'SEC',
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
  p.skin = ver.skin;
  if (ver.avatar) p.avatar = ver.avatar;
  Object.assign(p, genPhysique(p)); // deterministic height/weight, same rules as every other card
  // Every PlayStyle AND PlayStyle+ that exists (owner request) — overrides genPhysique's normal draw/limits,
  // exactly like admincards.js hand-picks its own extra PlayStyle+ list instead of using pickStyles' bands.
  p.playstyles = PLAYSTYLE_IDS.map((id) => ({ id, plus: true }));
  p.value = 0; p.wage = 0; // never priced — never tradeable, never on any market (like admin cards)
  p.look = hashStr(p.id) % 997;
  _cards.set(id, p);
  return p;
}

/** A Secret card version (default: The Shawky); always the same object/reference per id. */
export function secretCard(id = SECRET_CARD_ID) { return buildSecretCard(id); }
/** Every version of the Secret card (the Secret slot's pool). */
export function secretCards() { return SECRET_CARD_IDS.map((id) => buildSecretCard(id)); }

addResolver((id) => (isSecretCardId(id) ? buildSecretCard(id) : null));
