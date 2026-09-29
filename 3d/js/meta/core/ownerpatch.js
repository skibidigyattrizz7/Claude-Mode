// Owner patches: edits the owner queues for a player's Ultimate Team club (server table
// pitchside_owner_patches, migration 007). The player's client applies them to its UT save and acknowledges
// them, so a stale client can never overwrite an owner edit (it stays pending until applied). DOM-free.
//   { op:'addCard', card, untradeable? }      card: full card (custom / foreign) or { id } of a database card
//   { op:'removeCard', id }                   removes it from club, squad, vault and transfer list
//   { op:'editCard', id, fields }             any card field (see customreg.cleanEditFields) + fields.tradable
//   { op:'setTradable', id, tradable }
//   { op:'resetClub' }                        fresh starter club (club name, kit and coins kept)
//   { op:'resetObjectives' } / { op:'resetSbcs' }
//   { op:'setClubName', name }
//   { op:'forcePull', id }                    their next pack leads with this card (ut.js queueForcedPull)
import { receiveCard, applyCardEdit } from './customreg.js';
import { removeFromClub, createUTState, queueForcedPull } from './ut.js';

export const OWNER_OPS = ['addCard', 'removeCard', 'editCard', 'setTradable', 'resetClub', 'resetObjectives', 'resetSbcs', 'setClubName', 'forcePull'];
const ID_RE = /^[A-Za-z0-9_.:-]{1,40}$/;

function setTradable(state, id, tradable) {
  if (!state.club.includes(id)) return false;
  state.untradeable = Array.isArray(state.untradeable) ? state.untradeable : [];
  const i = state.untradeable.indexOf(id);
  if (tradable && i >= 0) state.untradeable.splice(i, 1);
  if (!tradable && i < 0) state.untradeable.push(id);
  return true;
}

/** Apply one op to a (migrated) UT state. -> true when it changed something. */
export function applyOwnerOp(state, op) {
  if (!state || !Array.isArray(state.club) || !op || typeof op !== 'object' || !OWNER_OPS.includes(op.op)) return false;
  const id = typeof op.id === 'string' && ID_RE.test(op.id) ? op.id : null;
  switch (op.op) {
    case 'addCard': {
      const r = receiveCard(state, op.card);
      if (r.ok && op.untradeable === true) setTradable(state, r.pid, false);
      return r.ok && !r.duplicate;
    }
    case 'removeCard': {
      if (!id) return false;
      const had = state.club.includes(id);
      removeFromClub(state, id);
      state.vault = (state.vault || []).filter((x) => x !== id);
      state.transferList = (state.transferList || []).filter((x) => x !== id);
      return had;
    }
    case 'editCard': {
      if (!id) return false;
      const f = op.fields && typeof op.fields === 'object' ? op.fields : {};
      const p = applyCardEdit(state, id, f);
      if (typeof f.tradable === 'boolean') setTradable(state, id, f.tradable);
      return !!p;
    }
    case 'setTradable': return id ? setTradable(state, id, op.tradable !== false) : false;
    case 'resetClub': {
      const keep = { clubName: state.clubName, short: state.short, kit: state.kit, coins: state.coins, admin: state.admin };
      const fresh = createUTState({ clubName: state.clubName, short: state.short, primary: state.kit && state.kit.primary, secondary: state.kit && state.kit.secondary });
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, fresh, keep);
      return true;
    }
    case 'resetObjectives': state.obj = {}; return true;
    case 'resetSbcs': state.sbc = {}; return true;
    case 'forcePull': return id ? queueForcedPull(state, id) : false;
    case 'setClubName': {
      const n = typeof op.name === 'string' ? op.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';
      if (!n) return false;
      state.clubName = n;
      return true;
    }
    default: return false;
  }
}

/** Apply a list of patches ({ id, ops }) in order. -> { applied: [patch ids], changed } */
export function applyOwnerPatches(state, patches) {
  const applied = [];
  let changed = 0;
  for (const p of Array.isArray(patches) ? patches : []) {
    if (!p || !Array.isArray(p.ops)) continue;
    for (const op of p.ops.slice(0, 100)) { try { if (applyOwnerOp(state, op)) changed++; } catch (e) { console.warn('[ownerpatch] op failed', op && op.op, e); } }
    if (Number.isSafeInteger(p.id)) applied.push(p.id);
  }
  return { applied, changed };
}
