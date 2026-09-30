// Server-driven changes to THIS device's local save, DOM-free (tests: net/tests/net.test.mjs):
//   * per-profile reset epochs (owner "Reset coins / progress / club / account", migration 003): the server bumps
//     reset_{coins,progress,club}_epoch and presence reports them as `resets`. This device remembers the last epochs it
//     applied (per profile id, storage key `resetSeen.<id>`) and applies anything higher exactly once. The first time a
//     profile is seen on a device the epochs are only recorded (never reset newcomers / new devices / new logins).
//   * owner patches (migration 007): applied to the save BEFORE anything is uploaded, acknowledged only after the save
//     was written, idempotent (ownerpatch.js remembers applied patch ids).
//   * the account was deleted by the owner: wipeLocalProfile() forgets the local club/progress of that profile.
// The callers own the state object (MetaApp's live `this.ut`, or a headless load from storage) and all mutations are
// in place, so views holding the object stay valid.
import { load, save, remove } from './storage.js';
import { applyOwnerOp, applyOwnerPatches } from './ownerpatch.js';
import { setInfinite } from './wallet.js';
import { SEASON_KEY } from './seasons.js';
import { wipeLocalProfile, DELETED_MESSAGE, WIPE_KEYS } from './wipe.js';

export const RESET_KINDS = ['coins', 'progress', 'club'];
export const RESET_COINS = 5000; // what the server sets the wallet to (pitchside_admin_reset)

const epochNum = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
export const normEpochs = (r) => ({ coins: epochNum(r && r.coins), progress: epochNum(r && r.progress), club: epochNum(r && r.club) });
const seenKey = (id) => `resetSeen.${id}`;

export function readSeenEpochs(id) {
  if (typeof id !== 'string' || !id) return null;
  const v = load(seenKey(id), null);
  return v && typeof v === 'object' ? normEpochs(v) : null;
}
export function writeSeenEpochs(id, epochs) { return typeof id === 'string' && id ? save(seenKey(id), normEpochs(epochs)) : false; }

/** What the presence epochs mean for this device: { first, due:[kinds], cur }. `first` = never seen for this profile. */
export function planResets(id, resets) {
  const cur = normEpochs(resets);
  const seen = readSeenEpochs(id);
  if (!seen) return { first: true, due: [], cur };
  return { first: false, due: RESET_KINDS.filter((k) => cur[k] > seen[k]), cur };
}

/** Is there anything for this device to do for this presence update? (cheap; storage read only) */
export function remoteDue(online, presence) {
  try {
    const u = presence || (online && online.presence && online.presence.last);
    if (!u) return false;
    if (u.patches > 0) return true;
    if (!u.hasResets) return false;
    const id = online.identityId && online.identityId();
    if (!id) return false;
    const p = planResets(id, u.resets);
    return p.first || p.due.length > 0;
  } catch { return false; }
}

// ---------------------------------------------------------------- applying a reset to a UT save (in place)
/** Server "progress": rating / divisions / record / Rivals. Locally: match stats, Rivals + weekly battles, objectives,
 * SBCs and the season track. */
export function resetProgress(state) {
  if (!state || typeof state !== 'object') return false;
  state.stats = { matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, packsOpened: 0, sbcDone: 0 };
  state.battles = { week: 1, points: 0, played: 0, wins: 0, history: [] };
  delete state.rivals;
  state.obj = {};
  state.sbc = {};
  remove(SEASON_KEY);
  return true;
}
/** Server "coins": wallet back to 5 000, infinite off. */
export function resetCoins(state) {
  if (!state || typeof state !== 'object') return false;
  setInfinite(state, false, { realBalance: RESET_COINS });
  state.coins = RESET_COINS;
  return true;
}
/** Server "club": a fresh starter club (name, kit and coins kept, the Vinson curse untouched); saved cards, vault,
 * saved squads, pending packs, forced pulls and market records go with it (the server cancelled the listings). */
export function resetClub(state) {
  if (!state || !Array.isArray(state.club)) return false;
  // "club" and "progress" are separate resets on the server: the club op must not wipe match stats, Rivals, objectives, SBCs
  const keep = {};
  for (const k of ['stats', 'battles', 'rivals', 'obj', 'sbc']) if (state[k] !== undefined) keep[k] = state[k];
  const ok = applyOwnerOp(state, { op: 'resetClub' });
  Object.assign(state, keep);
  return ok;
}
/** Apply the due kinds ('coins' | 'progress' | 'club') to the state. -> kinds applied */
export function applyResetKinds(state, kinds) {
  const set = new Set(kinds);
  const done = [];
  if (!state) return done;
  if (set.has('club') && resetClub(state)) done.push('club');
  if (set.has('progress') && resetProgress(state)) done.push('progress');
  if (set.has('coins') && resetCoins(state)) done.push('coins');
  return done;
}
/** The line shown to the player. */
export function resetMessage(kinds) {
  const s = new Set(kinds);
  if (RESET_KINDS.every((k) => s.has(k))) return 'An admin reset your account.';
  const parts = [];
  if (s.has('club')) parts.push('club');
  if (s.has('progress')) parts.push('progress');
  if (s.has('coins')) parts.push('coins');
  if (!parts.length) return '';
  return `An admin reset your ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.`;
}

// ---------------------------------------------------------------- account deleted by the owner (see wipe.js)
export { wipeLocalProfile, DELETED_MESSAGE, WIPE_KEYS };

// ---------------------------------------------------------------- the sync pass
let running = null;
/** Owner patches applied to the local save but not yet acknowledged: acknowledged once the patched club is on the server
 * (cloud sync 'uploaded' / 'unchanged'), so a download of an older server copy can never swallow an owner edit. */
const awaitingAck = new Set();
/** cloudsave `afterSync(result)`: acknowledge (or, after a download replaced the local club, forget) the waiting patches. */
export async function flushAcks(online, result) {
  if (!awaitingAck.size) return 0;
  const action = result && result.ok ? result.action : null;
  if (action === 'downloaded') { awaitingAck.clear(); return 0; } // local club replaced: the patches stay pending and re-apply
  if (!(action === 'uploaded' || action === 'unchanged')) return 0;
  const ids = [...awaitingAck];
  const r = await online.patches.ack(ids);
  if (r && r.ok !== false) for (const id of ids) awaitingAck.delete(id);
  return ids.length;
}
export const pendingAcks = () => awaitingAck.size;
export function forgetPendingAcks() { awaitingAck.clear(); }
/**
 * One pass: presence epochs, then owner patches. Applies to `state` in place, then `persist()` writes it
 * (return false when the write failed: nothing is recorded / acknowledged then, so the pass simply repeats).
 * @param {object} o
 *   online   the net/services.js object      state    live UT save or null (no club yet)
 *   persist  () => boolean|void              onApply  (kinds) => void, called after a reset was applied, before persist()
 *   usePresence  true: trust online.presence.last (a check-in just delivered); false (default): ask the server now
 *   cloud    true when a cloud sync follows (patches are then acknowledged by flushAcks after the upload); false = ack now
 * @returns {Promise<{ ok, resets:string[], first:boolean, patches:{applied:number[], changed:number}|null, notices:string[], changed:boolean }>}
 */
export function syncRemote(o) {
  if (running) return running;
  running = run(o).finally(() => { running = null; });
  return running;
}
async function run({ online, state = null, persist = () => true, onApply = null, cloud = false, usePresence = false } = {}) {
  const out = { ok: false, resets: [], first: false, patches: null, notices: [], changed: false };
  try {
    if (!online || typeof online.identityId !== 'function' || !online.hasIdentity()) return out;
    const id = online.identityId();
    if (!id) return out;
    // Presence-driven passes use the check-in that was just delivered; every other pass (start-up, before a cloud
    // upload) asks the server NOW, so a reset issued seconds ago is never missed by a stale check-in.
    let last = usePresence && online.presence ? online.presence.last : null;
    if (!last || !last.hasResets) last = await online.presence.tick();
    if (!last || !last.hasResets) return out; // offline / not authenticated: never guess
    out.ok = true;
    // 1) per-profile reset epochs
    const plan = planResets(id, last.resets);
    if (plan.first) { writeSeenEpochs(id, plan.cur); out.first = true; }
    else if (plan.due.length) {
      let applied = [];
      if (state) {
        applied = applyResetKinds(state, plan.due);
        try { if (onApply) onApply(applied); } catch (e) { console.warn('[remote] onApply failed', e); }
        if (persist() === false) return { ...out, ok: false }; // not written: try again next pass (reset is idempotent)
        out.changed = applied.length > 0;
      }
      writeSeenEpochs(id, plan.cur);
      out.resets = plan.due;
      const msg = resetMessage(plan.due);
      if (msg) out.notices.push(msg);
    }
    // 2) owner patches (after resets, so a patch queued after a reset lands on the reset save)
    if (state && last.patches > awaitingAck.size && online.patches && typeof online.patches.pending === 'function') {
      const r = await online.patches.pending();
      if (r && r.ok !== false && Array.isArray(r.items) && r.items.length) {
        const res = applyOwnerPatches(state, r.items);
        if (persist() !== false) {
          if (cloud) for (const pid of res.applied) awaitingAck.add(pid);
          else if (res.applied.length) await online.patches.ack(res.applied);
          out.patches = res;
          if (res.changed) { out.changed = true; out.notices.push('The owner updated your club.'); }
        }
      }
    }
  } catch (e) { console.warn('[remote] sync failed', e); }
  return out;
}
