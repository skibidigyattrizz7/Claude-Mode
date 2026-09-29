// Secret card (owner request): a single, wholly fictional ultra-rare card — "The Shawky" — that exists in
// the Secret Vault pack (`SECRET_PACK_ID`) at `SECRET_ODDS` (0.001, 0.1% each, owner Sep 29) and the admin-only Admin Vault pack
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
export const SECRET_ODDS = 0.001;

// More versions of the same ∞ glitch card (owner request, Sep 28): each has its own name + nation and
// otherwise identical powers. They share the Secret slot's odds (the slot picks one version at random), and
// none of them can be admin-granted either.
export const SECRET_VERSIONS = [
  { id: SECRET_CARD_ID, last: 'Shawky', name: 'The Shawky', nat: 'EGY', skin: 3 },
  { id: 'secret_kilner', last: 'Kilner', name: 'Kilner', nat: 'SCO', skin: 0 },
  { id: 'secret_collins', last: 'Collins', name: 'Collins', nat: 'KOR', skin: 1 },
  { id: 'secret_patel', last: 'Patel', name: 'Patel', nat: 'IND', skin: 3 },
  { id: 'secret_oelke', last: 'Oelke', name: 'Oelke', nat: 'GER', skin: 0, photo: 'assets/cards/oelke.webp' }, // owner's photo, cut out (Sep 29)
  { id: 'secret_masilang', last: 'Masilang', name: 'BraydenMasilang', nat: 'PHI', skin: 2 },
  { id: 'secret_nickerson', last: 'Nickerson', name: 'Nickerson', nat: 'KEN', skin: 5, photo: 'assets/cards/nickerson.webp' }, // owner's photo, cut out (Sep 29)
  { id: 'secret_dammad', last: 'Dammad', name: 'Dammad', nat: 'PLE', skin: 3 },
  // owner's own photo, cut out (3d/assets/cards/grumpy-patel.webp), owner request Sep 29
  { id: 'secret_grumpypatel', last: 'Grumpy Patel', name: 'Grumpy Patel', nat: 'IND', skin: 1, photo: 'assets/cards/grumpy-patel.webp' },
  // "THE NII" (owner request, Sep 29): the anti-secret card. Same vault odds, but `cursed` instead of `glitch`:
  // every stat shows "-∞" and in matches he barely moves, gives the ball away, passes to the opponent and every
  // shot flies into his own goal for 10 own goals (engine/core/sim.js `p.cursed`). Owner's photo, faded edges.
  // owner request (Sep 29): Perlita + an "evil" twin. `evil`: red design with "EVIL" across the top, and (owner) -∞ stats: cursed like THE NII
  // (card.js `is-evil`, meta.css). Nation: Kenya (owner).
  { id: 'secret_perlita', last: 'Perlita', name: 'Perlita', nat: 'KEN', skin: 2, photo: 'assets/cards/perlita.webp' },
  { id: 'secret_evilperlita', last: 'Evil Perlita', name: 'Evil Perlita', nat: 'KEN', skin: 2, photo: 'assets/cards/evil-perlita.webp', evil: true, cursed: true, tag: 'EVIL' },
  { id: 'secret_evilnickerson', last: 'Evil Nickerson', name: 'Evil Nickerson', nat: 'KEN', skin: 5, photo: 'assets/cards/evil-nickerson.webp', evil: true, cursed: true, tag: 'EVIL' },
  // owner request (Sep 29): knight card, the owner's whole picture (title + background) is the card art and every
  // stat shows a Star of David. Name is a placeholder until the owner gives one.
  { id: 'secret_knight', last: 'Knight', name: 'Knight', nat: 'ISR', skin: 1, fullArt: 'assets/cards/knight-full.webp', statGlyph: '✡' },
  // owner request (Sep 29): E-Man and his final form. Admin Vault only (`adminOnly`), full fire picture as card art.
  { id: 'secret_eman', last: 'E-Man', name: 'E-Man', nat: 'GHA', skin: 5, fullArt: 'assets/cards/eman-full.webp', artTheme: 'fire', adminOnly: true },
  { id: 'secret_elijah', last: 'E.L.I.J.A.H.', name: 'E.L.I.J.A.H.', nat: 'GHA', skin: 5, fullArt: 'assets/cards/elijah-full.webp', artTheme: 'fire', adminOnly: true,
    statText: '???', statSup: '∞', tag: 'FINAL FORM' }, // every stat reads ???^∞
  { id: 'secret_nii', last: 'AryeetyMensah', name: 'AryeetyMensah', nat: 'GHA', skin: 5, photo: 'assets/cards/aryeety-mensah.webp', cursed: true, tag: 'THE NII' },
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
  if (ver.photo) { p.photo = ver.photo; p.photoCut = true; }
  if (ver.evil) { p.evil = true; p.cardTag = ver.tag || 'EVIL'; }
  if (ver.fullArt) {
    p.fullArt = ver.fullArt; p.statGlyph = ver.statGlyph || null; p.artTheme = ver.artTheme || null;
    if (ver.statText) { p.statText = ver.statText; p.statSup = ver.statSup || ''; }
    if (ver.tag) p.cardTag = ver.tag;
  }
  if (ver.adminOnly) p.adminOnly = true;
  Object.assign(p, genPhysique(p)); // deterministic height/weight, same rules as every other card
  if (ver.cursed) {
    // the exact opposite of the glitch tier: floor stats (shown as "-∞"), OVR 1, no PlayStyles, weak foot and
    // skills at 1, and he only plays up front. `cursed` rides through core/teams.js toMatchPlayer to the engine.
    p.stats = { pac: 1, sho: 1, pas: 1, dri: 1, def: 1, phy: 1 };
    p.gk = { div: 1, han: 1, kic: 1, ref: 1, spd: 1, pos: 1 };
    p.alt = [];
    p.ovr = 1; p.pot = 1; p.wf = 1; p.sm = 1; p.wr = ['Low', 'Low'];
    p.glitch = false; p.cursed = true; p.cardTag = ver.tag;
    p.playstyles = [];
    p.value = 0; p.wage = 0;
    p.look = hashStr(p.id) % 997;
    _cards.set(id, p);
    return p;
  }
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
