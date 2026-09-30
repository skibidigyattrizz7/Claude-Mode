import assert from 'node:assert/strict';
import { createVinsonPackClaim } from '../core/vinsonpackclaim.js';
let calls = 0;
const pull = createVinsonPackClaim([{pid:'hell'}], 'hell', () => calls++);
assert.equal(calls, 0, 'rolling cannot start Doom');
pull.observe('hell'); // Send, save or quick sell.
assert.equal(calls, 0, 'item disposition cannot infect an open rewards grid');
pull.close();
assert.equal(calls, 1, 'closing registers a sold or collected Vinson');
pull.close();
assert.equal(calls, 1, 'cleanup cannot restart the timer');
createVinsonPackClaim([{pid:'normal'}], 'hell', () => calls++).close();
assert.equal(calls, 1, 'ordinary packs do not trigger Doom');
console.log('Vinson pack dismissal regressions passed');
