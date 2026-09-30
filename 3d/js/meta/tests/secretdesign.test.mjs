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

test('every family maps to a design that exists (entry in CARD_DESIGNS and the image file)', () => {
  for (const [fam, key] of Object.entries(SECRET_DESIGNS)) {
    assert.ok(CARD_DESIGNS[key], `${fam}: ${key} missing from CARD_DESIGNS`);
    assert.ok(existsSync(new URL(`../../../${CARD_DESIGNS[key].file}`, import.meta.url)), `${fam}: ${CARD_DESIGNS[key].file} not on disk`);
  }
});

test('every secret card gets an EA design', () => {
  assert.equal(secretCards().length, SECRET_VERSIONS.length);
  for (const p of secretCards()) assert.ok(secretDesignFor(p), `${p.id} has no design`);
});

test('families: glitch, cursed, evil, hell, angel, full-art', () => {
  assert.equal(secretDesignFor(byId.secret_ghost), SECRET_DESIGNS.shawky);
  assert.equal(secretDesignFor(byId.secret_nii), SECRET_DESIGNS.cursed);
  assert.equal(secretDesignFor(byId.secret_evilperlita), SECRET_DESIGNS.evil);
  assert.equal(secretDesignFor(byId.secret_vinson), SECRET_DESIGNS.hell);
  assert.equal(secretDesignFor(byId.secret_painman), SECRET_DESIGNS.angel);
  assert.equal(secretDesignFor(byId.secret_knight), SECRET_DESIGNS.rabbi);
  assert.equal(secretDesignFor(byId.secret_eman), SECRET_DESIGNS.eman);
  assert.equal(secretDesignFor(byId.secret_elijah), SECRET_DESIGNS.elijah);
  assert.equal(secretFamily(byId.secret_perlita), 'shawky');
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
  assert.notEqual(secretDesignFor(byId.secret_ghost), k);
  CARD_DESIGNS[k] = { file: 'assets/cards/custom-shawky.webp', ink: '#fff', dark: true };
  try {
    assert.equal(secretDesignFor(byId.secret_ghost), k);
    assert.equal(secretDesignFor(byId.secret_nii), SECRET_DESIGNS.cursed); // other families unaffected
  } finally { delete CARD_DESIGNS[k]; }
  assert.equal(secretDesignFor(byId.secret_ghost), SECRET_DESIGNS.shawky);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
