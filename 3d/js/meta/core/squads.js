// Multiple saved squads (owner request, Sep 29): a club keeps up to MAX_SQUADS named squads and switches between
// them. `state.squad` is always the ACTIVE squad (everything else in the game keeps reading it); the others live
// in `state.squads[i].squad`. On a switch the active squad is copied back into its slot and the target is loaded
// into `state.squad`, cleaned of cards the club no longer owns (sold, quick-sold, sent away). The active slot's
// stored copy is stale by design and is ignored; `state.squad` is the truth for it. DOM-free.
import { getPlayer, personOf } from './players.js';
import { teamRating } from './chemistry.js';
import { enforceLock } from './vinson.js';

export const MAX_SQUADS = 5;
const NAME_MAX = 20;
const clone = (x) => JSON.parse(JSON.stringify(x));
const cleanName = (n, fallback) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || fallback;

/** Make sure `state.squads` / `state.activeSquad` exist and are valid (older saves: one squad). Mutates. */
export function ensureSquads(state) {
  if (!Array.isArray(state.squads) || !state.squads.length) state.squads = [{ name: 'Squad 1', squad: null }];
  state.squads = state.squads.slice(0, MAX_SQUADS).map((e, i) => ({
    name: cleanName(e && e.name, `Squad ${i + 1}`),
    squad: e && e.squad && Array.isArray(e.squad.slots) ? e.squad : null,
  }));
  const a = Number.isInteger(state.activeSquad) ? state.activeSquad : 0;
  state.activeSquad = Math.max(0, Math.min(state.squads.length - 1, a));
  return state.squads;
}

/** Drop cards the club no longer owns and second cards of one player; keeps the 11 + bench shape. */
function cleanSquad(state, sq) {
  const owned = new Set(state.club || []);
  const seen = new Set();
  const keep = (id) => {
    if (!id || !owned.has(id)) return null;
    const p = getPlayer(id);
    if (!p || seen.has(personOf(p))) return null;
    seen.add(personOf(p));
    return id;
  };
  const slots = Array.from({ length: 11 }, (_, i) => keep(sq.slots[i]));
  const bench = Array.from({ length: 7 }, (_, i) => keep(Array.isArray(sq.bench) ? sq.bench[i] : null));
  return { ...sq, slots, bench };
}

/** [{ name, active, formation, rating, filled }] for the squad picker. */
export function listSquads(state) {
  ensureSquads(state);
  return state.squads.map((e, i) => {
    const sq = i === state.activeSquad ? state.squad : e.squad || state.squad;
    const players = (sq && sq.slots ? sq.slots : []).map((id) => (id ? getPlayer(id) : null));
    return { name: e.name, active: i === state.activeSquad, formation: sq ? sq.formation : '4-3-3', rating: teamRating(players), filled: players.filter(Boolean).length };
  });
}

/** Load squad `i` as the active squad (the current one is saved first). -> true when it switched. */
export function switchSquad(state, i) {
  ensureSquads(state);
  if (!Number.isInteger(i) || i < 0 || i >= state.squads.length || i === state.activeSquad) return false;
  state.squads[state.activeSquad].squad = clone(state.squad);
  const target = state.squads[i].squad;
  state.squad = cleanSquad(state, target ? clone(target) : clone(state.squad));
  state.activeSquad = i;
  enforceLock(state);
  return true;
}

/** Add a new squad (a copy of the current one, so it's always playable) and switch to it. -> index | -1 when full. */
export function addSquad(state, name) {
  ensureSquads(state);
  if (state.squads.length >= MAX_SQUADS) return -1;
  state.squads.push({ name: cleanName(name, `Squad ${state.squads.length + 1}`), squad: clone(state.squad) });
  const i = state.squads.length - 1;
  switchSquad(state, i);
  return i;
}

export function renameSquad(state, i, name) {
  ensureSquads(state);
  if (!state.squads[i]) return false;
  state.squads[i].name = cleanName(name, state.squads[i].name);
  return true;
}

/** Delete squad `i` (never the last one). Deleting the active squad switches to a neighbour first. */
export function deleteSquad(state, i) {
  ensureSquads(state);
  if (state.squads.length <= 1 || !state.squads[i]) return false;
  if (i === state.activeSquad) switchSquad(state, i === 0 ? 1 : i - 1);
  state.squads.splice(i, 1);
  if (state.activeSquad > i) state.activeSquad--;
  return true;
}
