import assert from 'node:assert/strict';
import { defaultSquad, quickSell, resolvePending, autoSquad, setSquad } from '../core/ut.js';
import { switchSquad, addSquad } from '../core/squads.js';
import { HELL_CARD_ID } from '../core/secretcard.js';
import { dispatchOnlineEntry } from '../ui/app.js';
import { DOOM_MS, FIRST_WARNING_MS, FINAL_WARNING_MS, BAN_MESSAGE, MATCH_MESSAGE,
  beginDoom, advance, release, lift, squadChanged, enforceLock, inSquad, cursedPack, reconcileServer } from '../core/vinson.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const s = () => ({ club: [HELL_CARD_ID], squad: defaultSquad() });

test('legacy bench lock is promoted to the XI and every core squad edit preserves it', () => {
  const state = s(); state.vinson = { phase: 'locked', pin: { area: 'bench', idx: 1 } };
  state.squad.bench[1] = HELL_CARD_ID;
  assert.equal(enforceLock(state), true);
  assert.deepEqual(state.vinson.pin, { area: 'slot', idx: 9 });
  assert.equal(state.squad.slots[9], HELL_CARD_ID);
  assert.equal(state.squad.bench.includes(HELL_CARD_ID), false);
  setSquad(state, { formation: '4-4-2', slots: [], bench: [HELL_CARD_ID] });
  assert.equal(state.squad.slots[9], HELL_CARD_ID);
  autoSquad(state);
  assert.equal(state.squad.slots[9], HELL_CARD_ID);
  addSquad(state, 'Other squad');
  state.squads[0].squad = defaultSquad();
  switchSquad(state, 0);
  assert.equal(state.squad.slots[9], HELL_CARD_ID);
  assert.equal(state.squad.bench.includes(HELL_CARD_ID), false);
});

test('quick-selling or resolving the item cannot clear any account curse phase', () => {
  for (const phase of ['doom', 'banned', 'freed', 'warn', 'consequence', 'locked']) {
    const state = s(); state.coins = 0; state.vault = []; state.untradeable = [];
    beginDoom(state, 1000); state.vinson.phase = phase;
    state.pendingPack = [HELL_CARD_ID];
    const curse = structuredClone(state.vinson);
    resolvePending(state, HELL_CARD_ID);
    quickSell(state, HELL_CARD_ID);
    assert.deepEqual(state.vinson, curse, `selling cannot remove or restart ${phase}`);
    assert.equal(state.club.includes(HELL_CARD_ID), false);
    if (phase === 'doom') assert.equal(advance(state, curse.doomUntil).phase, 'banned');
  }
});

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

test('match curse follows the locked saved squad even if a mode-built team omits Vinson', () => {
  const state = s();
  state.vinson = { phase: 'locked', pin: { area: 'slot', idx: 9 } };
  state.squad.slots[9] = HELL_CARD_ID;
  const modeBuiltHome = { players: [], bench: [] };
  assert.equal(modeBuiltHome.players.some((p) => p.id === HELL_CARD_ID), false);
  assert.equal(cursedPack(state), true);
  lift(state);
  assert.equal(cursedPack(state), false);
});

test('cursed online UT entry opens local pitch sabotage without matchmaking', async () => {
  const state = s();
  state.vinson = { phase: 'locked', pin: { area: 'slot', idx: 9 } };
  state.squad.slots[9] = HELL_CARD_ID;
  const requestedTeam = { name: 'My UT squad', kit: { primary: '#111111', secondary: '#eeeeee' }, gkKit: { primary: '#00ff00' } };
  let localArgs = null, onlineCalled = false;
  const result = await dispatchOnlineEntry({
    state,
    args: { mode: 'ut', team: requestedTeam },
    halfMinutes: 4,
    startMatch: async (...args) => { localArgs = args; return { abandoned: true, reason: 'vinson_curse' }; },
    startOnlineMatch: async () => { onlineCalled = true; },
  });
  assert.equal(onlineCalled, false);
  assert.equal(localArgs[0], requestedTeam);
  assert.equal(localArgs[2].vinsonCurse, true);
  assert.equal(localArgs[2].mode, 'ut');
  assert.equal(localArgs[2].halfMinutes, 4);
  assert.equal(localArgs[1].players.length, 11);
  assert.deepEqual(result, { abandoned: true, reason: 'vinson_curse' });
  localArgs = null;
  await dispatchOnlineEntry({ state, exempt: true, args: { mode: 'ut', team: requestedTeam },
    startMatch: async (...args) => { localArgs = args; },
    startOnlineMatch: async () => { onlineCalled = true; } });
  assert.equal(onlineCalled, true, 'owner exemption keeps normal online entry');
  assert.equal(localArgs, null);
});

test('server release ends the ban and starts the squad warning, lock persists across devices', () => {
  const state = s(); beginDoom(state, 0); advance(state, DOOM_MS);
  reconcileServer(state, { ok: true, phase: 'released' }); assert.equal(state.vinson.phase, 'warn'); // owned Vinson joins the XI (Oct 1)
  reconcileServer(state, { ok: true, phase: 'locked' }); assert.equal(state.vinson.phase, 'locked');
  assert.equal(inSquad(state.squad), true);
  reconcileServer(state, { ok: true, phase: 'lifted' });
  assert.equal(state.vinson.phase, 'lifted');
  assert.equal(cursedPack(state), false);
  state.squad.slots[9] = null; assert.equal(enforceLock(state), false);
  lift(state); assert.equal(squadChanged(state)?.phase, 'lifted');
});

test('server release starts the warning immediately when Vinson is already in the squad', () => {
  const state = s();
  state.squad.slots[9] = HELL_CARD_ID;
  beginDoom(state, 0);
  advance(state, DOOM_MS);
  const now = 50_000;
  reconcileServer(state, { ok: true, phase: 'released' }, now);
  assert.equal(state.vinson.phase, 'warn');
  assert.equal(state.vinson.phaseUntil, now + FIRST_WARNING_MS);
  assert.deepEqual(state.vinson.pin, { area: 'slot', idx: 9 });
  assert.equal(advance(state, now + FIRST_WARNING_MS).phase, 'consequence');
  assert.equal(advance(state, now + FIRST_WARNING_MS + FINAL_WARNING_MS).phase, 'locked');
  assert.equal(cursedPack(state), true);
});

test('server time keeps the countdown accurate when the device clock differs', () => {
  const state = s();
  reconcileServer(state, { ok: true, phase: 'doom', serverNow: '2026-09-29T00:00:00Z', deadline: '2026-09-29T00:01:00Z' }, 1000);
  assert.equal(state.vinson.doomUntil, 1000 + DOOM_MS);
});

test('server release repairs stale local lifted state and restores squad aftermath', () => {
  const s = {club:[HELL_CARD_ID], squad:defaultSquad(), vinson:{phase:'lifted',immune:false}};
  s.squad.slots[9] = HELL_CARD_ID;
  reconcileServer(s,{ok:true,phase:'released',immune:false},1000);
  assert.equal(s.vinson.phase,'warn');
  advance(s,1000+5000+10000);
  assert.equal(s.vinson.phase,'locked');
  assert.equal(cursedPack(s),true);
});
test('owner unban puts an owned Vinson into the XI so the aftermath always runs', () => {
  const s = {club:[HELL_CARD_ID,'a','b'], squad:defaultSquad(), vinson:{phase:'banned',doomUntil:1,phaseUntil:0,pin:null}};
  const before = s.squad.slots[9];
  reconcileServer(s,{ok:true,phase:'released',immune:false},1000);
  assert.equal(s.squad.slots[9], HELL_CARD_ID);
  assert.equal(s.vinson.phase,'warn');
  if (before && s.squad.bench.some((id) => !id)) assert.ok(s.squad.bench.includes(before));
  advance(s,1000+5000+10000);
  assert.equal(s.vinson.phase,'locked');
  assert.equal(cursedPack(s),true);
});
console.log(`${n} Vinson state tests passed`);
