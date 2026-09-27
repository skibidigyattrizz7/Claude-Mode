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

export const MANAGERS = MANAGER_ROWS.map(([id, name, nat, league, club]) => ({ id, name, nat, league, club }));
export const MANAGER_BY_ID = Object.fromEntries(MANAGERS.map((m) => [m.id, m]));

/** A manager by id, or null (also null for a falsy/unknown id — always safe to pass straight through). */
export function getManager(id) { return (id && MANAGER_BY_ID[id]) || null; }

/** True when this manager's nation/league/club lines up with the player's — the one thing both chemistry
 * styles check before adding their manager bonus. */
export function managerMatches(manager, p) {
  if (!manager || !p) return false;
  if (manager.nat && p.nat === manager.nat) return true;
  if (manager.league && p.league === manager.league) return true;
  if (manager.club && p.club === manager.club) return true;
  return false;
}
