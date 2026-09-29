import assert from 'node:assert/strict';
import { defaultSquad } from '../core/ut.js';
import { HELL_CARD_ID } from '../core/secretcard.js';
import { DOOM_MS, FIRST_WARNING_MS, FINAL_WARNING_MS, BAN_MESSAGE, MATCH_MESSAGE,
  beginDoom, advance, release, lift, squadChanged, enforceLock, inSquad, cursedPack, reconcileServer } from '../core/vinson.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const s = () => ({ club: [HELL_CARD_ID], squad: defaultSquad() });

test('one-minute deadline survives repeated checks and expires at the exact boundary', () => {
  const state = s(); beginDoom(state, 1000);
  assert.equal(state.vinson.doomUntil, 1000 + DOOM_MS);
  assert.equal(advance(state, 1000 + DOOM_MS - 1).phase, 'doom');
  assert.equal(advance(state, 1000 + DOOM_MS).phase, 'banned');
  assert.match(BAN_MESSAGE, /WRATH OF VINSON/);
});

test('owner release then 5+10 seconds warns and locks, removal during either warning is safe', () => {
  const state = s(); release(state); state.squad.slots[9] = HELL_CARD_ID;
  squadChanged(state, 1000);
  assert.equal(state.vinson.phase, 'warn'); assert.equal(state.vinson.phaseUntil, 1000 + FIRST_WARNING_MS);
  state.squad.slots[9] = null; squadChanged(state, 5000); assert.equal(state.vinson.phase, 'freed');
  state.squad.bench[1] = HELL_CARD_ID; squadChanged(state, 10000);
  assert.equal(advance(state, 10000 + FIRST_WARNING_MS).phase, 'consequence');
  assert.equal(advance(state, 10000 + FIRST_WARNING_MS + FINAL_WARNING_MS - 1).phase, 'consequence');
  assert.equal(advance(state, 10000 + FIRST_WARNING_MS + FINAL_WARNING_MS).phase, 'locked');
  assert.deepEqual(state.vinson.pin, { area: 'bench', idx: 1 });
  assert.equal(cursedPack(state), true);
  assert.match(MATCH_MESSAGE, /ELIGIBLE TO PLAY/);
});

test('locked card is restored after attempted removal, squad switch or club edit', () => {
  const state = s(); state.vinson = { phase: 'locked', pin: { area: 'slot', idx: 9 } };
  state.squad.slots[9] = null; state.club = [];
  assert.equal(enforceLock(state), true); assert.equal(state.squad.slots[9], HELL_CARD_ID);
  assert.ok(state.club.includes(HELL_CARD_ID));
  assert.equal(enforceLock(state), false);
  state.squad.bench[0] = HELL_CARD_ID;
  assert.equal(enforceLock(state), true, 'duplicate is removed while pinned card stays');
  assert.equal(state.squad.bench[0], null);
  state.squad = defaultSquad(); enforceLock(state); assert.equal(inSquad(state.squad), true);
});

test('server release changes ban to freed, lock persists across devices', () => {
  const state = s(); beginDoom(state, 0); advance(state, DOOM_MS);
  reconcileServer(state, { ok: true, phase: 'released' }); assert.equal(state.vinson.phase, 'freed');
  reconcileServer(state, { ok: true, phase: 'locked' }); assert.equal(state.vinson.phase, 'locked');
  assert.equal(inSquad(state.squad), true);
  reconcileServer(state, { ok: true, phase: 'lifted' });
  assert.equal(state.vinson.phase, 'lifted');
  assert.equal(cursedPack(state), false);
  state.squad.slots[9] = null; assert.equal(enforceLock(state), false);
  lift(state); assert.equal(squadChanged(state)?.phase, 'lifted');
});

test('server time keeps the countdown accurate when the device clock differs', () => {
  const state = s();
  reconcileServer(state, { ok: true, phase: 'doom', serverNow: '2026-09-29T00:00:00Z', deadline: '2026-09-29T00:01:00Z' }, 1000);
  assert.equal(state.vinson.doomUntil, 1000 + DOOM_MS);
});

console.log(`${n} Vinson state tests passed`);
