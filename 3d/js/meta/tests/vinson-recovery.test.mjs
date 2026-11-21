import assert from 'node:assert/strict';
import { createOnline } from '../../net/services.js';
import { createMockBackend, memoryStore } from '../../net/mockbackend.js';

const mem = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

let clock = Date.UTC(2026, 8, 29);
const store = memoryStore();
const backend = createMockBackend(store, { now: () => clock });

const rpc = (fn, args) => backend.call(fn, args);
const client = () => createOnline({ rpc, storage: mem(), volatileStorage: mem(), transportKind: 'loopback', requireAccount: true });
const owner = client();
const player = client();
const password = 'Blue-Kite-42';

const ownerSignup = await owner.account.signup({ username: 'Shawky Fc', password, confirm: password, adminCode: 'mock-super' });
const playerSignup = await player.account.signup({ username: 'Vinson Tester', password, confirm: password });
assert.equal(ownerSignup.ok, true);
assert.equal(playerSignup.ok, true);
assert.equal((await player.vinson.pull()).phase, 'doom');

clock += 60_001;
assert.equal((await player.vinson.status()).phase, 'banned');

const release = await owner.vinson.unban(playerSignup.id);
assert.equal(release.ok, true);
assert.equal(release.player.vinsonPhase, 'released', 'unban response preserves server released phase');

const listed = await owner.owner.listPlayers();
assert.equal(listed.ok, true);
assert.equal(listed.items.find((row) => row.id === playerSignup.id)?.vinsonPhase, 'released', 'owner list preserves released phase');

const detailed = await owner.moderation.player(playerSignup.id);
assert.equal(detailed.ok, true);
assert.equal(detailed.player.vinsonPhase, 'released', 'moderation detail preserves released phase');

assert.equal((await player.vinson.status()).phase, 'released');
const lifted = await owner.vinson.lift(playerSignup.id);
assert.equal(lifted.ok, true, 'released players remain eligible for the owner lift action');
assert.equal(lifted.player.vinsonPhase, null, 'only lifting removes the owner action');
assert.equal((await owner.owner.listPlayers()).items.find((row) => row.id === playerSignup.id)?.vinsonPhase, null);
assert.equal((await player.vinson.status()).phase, 'lifted');

console.log('Vinson release recovery regression passed');
