// secretDesignFor: which EA card design each secret / admin card wears. Run: node 3d/js/meta/tests/secretdesign.test.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { secretDesignFor, secretFamily, SECRET_DESIGNS } from '../ui/carddesign-secret.js';
import { secretCards, SECRET_VERSIONS } from '../core/secretcard.js';
import { CARD_DESIGNS } from '../core/carddesigns.js';
import { PROMOS } from '../core/promos.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
}
console.log('secretDesignFor tests');
const byId = Object.fromEntries(secretCards().map((p) => [p.id, p]));

test('the admin design exists (entry in CARD_DESIGNS and the image file)', () => {
  const key = SECRET_DESIGNS.admin;
  assert.ok(CARD_DESIGNS[key], `${key} missing from CARD_DESIGNS`);
  assert.ok(existsSync(new URL(`../../../${CARD_DESIGNS[key].file}`, import.meta.url)), `${CARD_DESIGNS[key].file} not on disk`);
});

test('secret cards keep their OWN designs: no EA design is applied to any of them (owner, Sep 30)', () => {
  assert.equal(secretCards().length, SECRET_VERSIONS.length);
  for (const p of secretCards()) assert.equal(secretDesignFor(p), null, `${p.id} must not get an EA design`);
});

test('families: glitch, cursed, evil, hell, angel, full-art', () => {
  assert.equal(secretFamily(byId.secret_ghost), 'shawky');
  assert.equal(secretFamily(byId.secret_perlita), 'shawky');
  assert.equal(secretFamily(byId.secret_nii), 'cursed');
  assert.equal(secretFamily(byId.secret_evilperlita), 'evil');
  assert.equal(secretFamily(byId.secret_vinson), 'hell');
  assert.equal(secretFamily(byId.secret_painman), 'angel');
  assert.equal(secretFamily(byId.secret_knight), 'rabbi');
  assert.equal(secretFamily(byId.secret_eman), 'eman');
  assert.equal(secretFamily(byId.secret_elijah), 'elijah');
});

test('admin cards: premium design unless the admin picked a promo or base design', () => {
  const plain = { id: 'admin_1', customAdmin: true, special: null };
  assert.equal(secretDesignFor(plain), SECRET_DESIGNS.admin);
  assert.equal(secretDesignFor({ id: 'ad_x', special: 'admin' }), SECRET_DESIGNS.admin);
  for (const pr of PROMOS) assert.equal(secretDesignFor({ id: 'admin_2', customAdmin: true, special: pr.id }), null, pr.id);
  for (const sp of ['inform', 'hero', 'legend', 'lotg', 'objective']) assert.equal(secretDesignFor({ id: 'admin_3', customAdmin: true, special: sp }), null, sp);
});

test('everything else returns null', () => {
  assert.equal(secretDesignFor(null), null);
  assert.equal(secretDesignFor(undefined), null);
  assert.equal(secretDesignFor({}), null);
  assert.equal(secretDesignFor({ id: 'p1', tier: 'gold', rare: true, special: 'inform' }), null);
  assert.equal(secretDesignFor({ id: 'p2', special: 'toty', promo: 'toty' }), null);
});

test('custom art switch: custom-<family> in CARD_DESIGNS wins with no code change', () => {
  const k = 'custom-shawky';
  assert.equal(secretDesignFor(byId.secret_ghost), null);
  CARD_DESIGNS[k] = { file: 'assets/cards/custom-shawky.webp', ink: '#fff', dark: true };
  try {
    assert.equal(secretDesignFor(byId.secret_ghost), k);
    assert.equal(secretDesignFor(byId.secret_nii), null); // other families unaffected
  } finally { delete CARD_DESIGNS[k]; }
  assert.equal(secretDesignFor(byId.secret_ghost), null);
});

import { tiltFor, MAX_TILT } from '../ui/secretfx.js';
test('secretfx tiltFor: centre is flat, edges lean, input is clamped', () => {
  assert.deepEqual(tiltFor(0.5, 0.5), { rx: 0, ry: 0, px: 0.5, py: 0.5 });
  const tr = tiltFor(1, 0);
  assert.equal(tr.ry, MAX_TILT); assert.equal(tr.rx, MAX_TILT);
  const bl = tiltFor(0, 1);
  assert.equal(bl.ry, -MAX_TILT); assert.equal(bl.rx, -MAX_TILT);
  const wild = tiltFor(9, -4);
  assert.equal(wild.ry, MAX_TILT); assert.equal(wild.px, 1); assert.equal(wild.py, 0);
  assert.equal(tiltFor(NaN, undefined).px, 0.5);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
