// EVIL VINSON curse rules. Pure, deterministic state transitions; timestamps are absolute milliseconds so a
// reload, background tab or second device cannot restart a countdown. The server owns ban/release/lock for
// accounts; this saved state also gives offline guests the same presentation and squad rules.
import { HELL_CARD_ID } from './secretcard.js';

export const DOOM_MS = 60 * 1000;
export const FIRST_WARNING_MS = 5 * 1000;
export const FINAL_WARNING_MS = 10 * 1000;
export const BAN_MESSAGE = "YOU'VE BEEN STRUCK BY THE WRATH OF VINSON";
export const MATCH_MESSAGE = "VINSON HAS KILLED YOUR ENTIRE TEAM. YOUR SQUAD ISN'T ELIGIBLE TO PLAY.";

export const isVinson = (id) => id === HELL_CARD_ID;
export const isOwner = (online) => online?.account?.current?.().role === 'owner';
export const inSquad = (sq) => !!sq && [ ...(sq.slots || []), ...(sq.bench || []) ].includes(HELL_CARD_ID);
export const cursedPack = (state) => state?.vinson?.phase === 'locked' && inSquad(state.squad);
// Destructive UI effects belong to the initial pull, not the surviving squad curse after unban.
export const hasDoomEffects = (phase) => phase === 'doom';

export function beginDoom(state, now = Date.now(), deadline = now + DOOM_MS) {
  state.vinson = { phase: 'doom', doomUntil: deadline, phaseUntil: 0, pin: null };
  return state.vinson;
}

export function advance(state, now = Date.now()) {
  const v = state?.vinson;
  if (!v) return null;
  if (v.phase === 'doom' && now >= v.doomUntil) v.phase = 'banned';
  if (v.phase === 'warn' && now >= v.phaseUntil) {
    v.phase = 'consequence'; v.phaseUntil += FINAL_WARNING_MS;
  }
  if (v.phase === 'consequence' && now >= v.phaseUntil) {
    v.phase = 'locked'; v.phaseUntil = 0;
  }
  return v;
}

export function release(state) {
  state.vinson = { phase: 'freed', doomUntil: 0, phaseUntil: 0, pin: null };
  return state.vinson;
}

export function lift(state) {
  state.vinson = { phase: 'lifted', doomUntil: 0, phaseUntil: 0, pin: null };
  return state.vinson;
}

export function squadChanged(state, now = Date.now()) {
  const v = advance(state, now);
  if (!v || !['freed', 'warn', 'consequence', 'locked'].includes(v.phase)) return v;
  const sq = state.squad;
  if (v.phase === 'locked') { enforceLock(state); return v; }
  if (!inSquad(sq)) {
    if (v.phase === 'warn' || v.phase === 'consequence') release(state);
    return state.vinson;
  }
  if (v.phase === 'freed') {
    v.phase = 'warn'; v.phaseUntil = now + FIRST_WARNING_MS;
    v.pin = locate(sq);
  } else v.pin = locate(sq);
  return v;
}

function locate(sq) {
  let idx = (sq.slots || []).indexOf(HELL_CARD_ID);
  if (idx >= 0) return { area: 'slot', idx };
  idx = (sq.bench || []).indexOf(HELL_CARD_ID);
  return idx >= 0 ? { area: 'bench', idx } : null;
}

/** Once locked, restore the pinned card after any squad edit or switch. Returns true if it repaired a save. */
export function enforceLock(state) {
  const v = state?.vinson, sq = state?.squad;
  if (v?.phase !== 'locked' || !sq) return false;
  const area = v.pin?.area === 'bench' ? 'bench' : 'slots';
  const arr = Array.isArray(sq[area]) ? sq[area] : null;
  const idx = Number.isInteger(v.pin?.idx) && v.pin.idx >= 0 && v.pin.idx < (arr?.length || 0) ? v.pin.idx : area === 'bench' ? 0 : 9;
  if (!arr) return false;
  let changed = arr[idx] !== HELL_CARD_ID;
  if (Array.isArray(state.club) && !state.club.includes(HELL_CARD_ID)) { state.club.push(HELL_CARD_ID); changed = true; }
  for (const a of [sq.slots, sq.bench]) if (Array.isArray(a)) for (let i = 0; i < a.length; i++) {
    if (a[i] === HELL_CARD_ID && (a !== arr || i !== idx)) { a[i] = null; changed = true; }
  }
  if (!changed) return false;
  arr[idx] = HELL_CARD_ID;
  return true;
}

/** Server status is authoritative for ban/owner release, but never rewinds a locally locked squad. */
export function reconcileServer(state, remote, now = Date.now()) {
  if (!state || !remote || !remote.ok || remote.exempt) return null;
  const v = state.vinson;
  if (remote.phase === 'doom' && remote.deadline) {
    const serverDeadline = Date.parse(remote.deadline);
    const serverNow = Date.parse(remote.serverNow);
    const deadline = Number.isFinite(serverNow) ? now + serverDeadline - serverNow : serverDeadline;
    if (Number.isFinite(deadline) && (!v || v.phase === 'doom' || v.phase === 'banned')) beginDoom(state, now, deadline);
  } else if (remote.phase === 'banned' && (!v || v.phase !== 'banned')) {
    state.vinson = { phase: 'banned', doomUntil: v?.doomUntil || now, phaseUntil: 0, pin: null };
  } else if (remote.phase === 'lifted') lift(state);
  else if (remote.phase === 'released' && (!v || v.phase === 'doom' || v.phase === 'banned')) {
    // An owner release can arrive while Vinson is already in the active squad. Start the
    // squad warning as part of reconciliation so every caller (including reload/cloud
    // reconciliation) observes the same countdown without relying on a UI callback.
    release(state);
    if (inSquad(state.squad)) squadChanged(state, now);
  }
  else if (remote.phase === 'locked' && (!v || v.phase !== 'locked')) {
    state.vinson = { phase: 'locked', doomUntil: 0, phaseUntil: 0, pin: v?.pin || { area: 'slot', idx: 9 } };
    enforceLock(state);
  }
  return advance(state, now);
}
