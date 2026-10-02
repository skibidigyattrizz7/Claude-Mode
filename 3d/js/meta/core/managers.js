// Manager cards (owner request): assigning one to a squad contributes chemistry, in both chemistry styles
// (see core/chemistry.js — this module only supplies the manager data + the match test; the actual points
// are added inside calcChemistry/calcChemistryFc26 so both styles stay in one place). Fictional identities
// (no real people), DOM-free.
//
// A manager matches a player when any of nation / league / club line up:
//  - FC26-style chemistry: a match gives that one player +1 chemistry (capped at 3), same as any other
//    per-player nation/league/club count in that style.
//  - Classic (link) chemistry: a small flat team boost — +1 total chemistry per 4 matching starters
//    (capped at +3) — since classic chemistry has no per-player "manager" slot the way FC26 does.
//
// Row: [id, name, nation, league (or null = any), club (or null = any club in that league/nation)]
const MANAGER_ROWS = [
  ['mgr_ashcombe', 'Terry Ashcombe', 'ENG', 'ISL', 'ISL01'],
  ['mgr_harker', 'Colin Harker', 'ENG', 'ISL', null],
  ['mgr_montoya', 'Javier Montoya', 'ESP', 'SOL', 'SOL01'],
  ['mgr_fuentes', 'Diego Fuentes', 'ESP', 'SOL', null],
  ['mgr_reiter', 'Klaus Reiter', 'GER', 'MEI', 'MEI01'],
  ['mgr_voss', 'Werner Voss', 'GER', 'MEI', null],
  ['mgr_ferretti', 'Marco Ferretti', 'ITA', 'AUR', 'AUR01'],
  ['mgr_bianchi', 'Luca Bianchi', 'ITA', 'AUR', null],
  ['mgr_rocher', 'Étienne Rocher', 'FRA', 'ETO', 'ETO01'],
  ['mgr_bastide', 'Julien Bastide', 'FRA', 'ETO', null],
  ['mgr_mendes', 'Ricardo Mendes', 'BRA', 'CON', 'CON01'],
  ['mgr_duarte', 'Hernán Duarte', 'ARG', 'CON', null],
  ['mgr_cardoso', 'Nuno Cardoso', 'POR', null, null],
  ['mgr_degroot', 'Willem de Groot', 'NED', null, null],
  ['mgr_verlinden', 'Kevin Verlinden', 'BEL', null, null],
  ['mgr_andrade', 'Paulo Andrade', 'BRA', null, null],
];

// Real managers (owner, Sep 30): collectible, packed from the Store's Manager Pack (ut.js openManagerPack) and only
// assignable once owned (state.managers). Nation + the in-game league of their best-known club drive chemistry.
// Photos: assets/managers/<slug>.webp (freely licensed, see assets/managers/credits.json); the UI falls back to
// initials when a photo is missing. Row: [slug, name, nation, league | null]
const REAL_MANAGER_ROWS = [
  ['guardiola', 'Pep Guardiola', 'ESP', 'ISL'], ['ancelotti', 'Carlo Ancelotti', 'ITA', 'SOL'], ['klopp', 'Jürgen Klopp', 'GER', 'ISL'],
  ['mourinho', 'José Mourinho', 'POR', 'ISL'], ['zidane', 'Zinedine Zidane', 'FRA', 'SOL'], ['simeone', 'Diego Simeone', 'ARG', 'SOL'],
  ['arteta', 'Mikel Arteta', 'ESP', 'ISL'], ['xabi_alonso', 'Xabi Alonso', 'ESP', 'SOL'], ['flick', 'Hansi Flick', 'GER', 'SOL'],
  ['luis_enrique', 'Luis Enrique', 'ESP', 'ETO'], ['slot', 'Arne Slot', 'NED', 'ISL'], ['scaloni', 'Lionel Scaloni', 'ARG', null],
  ['deschamps', 'Didier Deschamps', 'FRA', null], ['southgate', 'Gareth Southgate', 'ENG', null], ['ferguson', 'Alex Ferguson', 'SCO', 'ISL'],
  ['wenger', 'Arsène Wenger', 'FRA', 'ISL'], ['low', 'Joachim Löw', 'GER', null], ['tuchel', 'Thomas Tuchel', 'GER', null],
  ['conte', 'Antonio Conte', 'ITA', 'AUR'], ['nagelsmann', 'Julian Nagelsmann', 'GER', null], ['pochettino', 'Mauricio Pochettino', 'ARG', null],
  ['amorim', 'Rúben Amorim', 'POR', 'ISL'], ['inzaghi', 'Simone Inzaghi', 'ITA', 'AUR'], ['kompany', 'Vincent Kompany', 'BEL', 'MEI'],
];
export const REAL_MANAGERS = REAL_MANAGER_ROWS.map(([slug, name, nat, league]) => ({
  id: `mgr_real_${slug}`, slug, name, nat, league, club: null, real: true, photo: `assets/managers/${slug}.webp`,
}));

export const MANAGERS = MANAGER_ROWS.map(([id, name, nat, league, club]) => ({ id, name, nat, league, club })).concat(REAL_MANAGERS);
export const MANAGER_BY_ID = Object.fromEntries(MANAGERS.map((m) => [m.id, m]));

/** A manager by id, or null (also null for a falsy/unknown id — always safe to pass straight through). */
export function getManager(id) { return (typeof id === 'string' && MANAGER_BY_ID[id]) || null; }
export const isRealManager = (id) => !!(getManager(id) && getManager(id).real);

/** True when this manager's nation/league/club lines up with the player's — the one thing both chemistry
 * styles check before adding their manager bonus. */
export function managerMatches(manager, p) {
  if (!manager || !p) return false;
  if (manager.nat && p.nat === manager.nat) return true;
  if (manager.league && p.league === manager.league) return true;
  if (manager.club && p.club === manager.club) return true;
  return false;
}
