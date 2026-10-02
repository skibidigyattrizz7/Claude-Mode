// designFor(p): which real EA card background a player card uses. Run: node 3d/js/meta/tests/carddesign.test.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { designFor } from '../ui/carddesign.js';
import { CARD_DESIGNS } from '../core/carddesigns.js';
import { PROMOS } from '../core/promos.js';
import { getDB } from '../core/players.js';

const asset = (key) => existsSync(new URL(`../../../${CARD_DESIGNS[key].file}`, import.meta.url));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('Card design tests');

ok('base cards: tier x rare picks a design per level, common and rare differ', () => {
  for (const tier of ['bronze', 'silver', 'gold']) {
    const common = designFor({ tier, rare: false });
    const rare = designFor({ tier, rare: true });
    assert.ok(CARD_DESIGNS[common] && CARD_DESIGNS[rare], tier);
    assert.notEqual(common, rare, `${tier} common and rare share a design`);
  }
  assert.notEqual(designFor({ tier: 'bronze' }), designFor({ tier: 'gold' }));
});

ok('TOTW / in-form cards use the TOTW design', () => {
  const a = designFor({ tier: 'gold', rare: true, totw: 4, special: 'inform' });
  assert.ok(CARD_DESIGNS[a]);
  assert.equal(designFor({ tier: 'silver', special: 'inform' }), a);
  assert.equal(designFor({ tier: 'gold', totw: 1 }), a);
});

ok('Icons and CLASSIC legends use the Icon design', () => {
  const icon = designFor({ tier: 'gold', club: 'ICN', rare: true });
  assert.ok(CARD_DESIGNS[icon]);
  assert.equal(designFor({ tier: 'gold', special: 'legend', club: 'X' }), icon);
  assert.notEqual(icon, designFor({ tier: 'gold', rare: true }));
});

ok('every promo card gets its own promo design (promo field or admin-card special)', () => {
  for (const pr of PROMOS) {
    assert.equal(designFor({ tier: 'gold', rare: true, special: pr.id, promo: pr.id }), pr.design, pr.id);
    assert.equal(designFor({ tier: 'gold', rare: true, special: pr.id, customAdmin: true }), pr.design, pr.id);
  }
});

ok('other specials (hero, lotg, objective, prime, evolution) never fall back to null', () => {
  for (const extra of [{ special: 'hero' }, { special: 'lotg' }, { special: 'objective' }, { era: 'prime' }, { evo: 2 }, { headliner: true, totw: 3, special: 'inform' }]) {
    const key = designFor({ tier: 'gold', rare: true, ...extra });
    assert.ok(CARD_DESIGNS[key], JSON.stringify(extra));
  }
  assert.notEqual(designFor({ tier: 'gold', special: 'hero' }), designFor({ tier: 'gold', special: 'lotg' }));
});

ok('secret cards keep their own unique look (no reused EA design) until custom art exists; unknown tiers still get a design', () => {
  for (const flag of ['cursed', 'evil', 'hell', 'angel', 'glitch']) assert.equal(designFor({ tier: 'gold', [flag]: true }), null, flag);
  assert.ok(CARD_DESIGNS[designFor({ tier: 'weird' })]);
  assert.equal(designFor(null), null);
});

ok('the whole player database maps to designs whose image files exist', () => {
  const seen = new Set();
  for (const p of getDB().all) {
    const key = designFor(p);
    if (key === null) { assert.ok(p.cursed || p.evil || p.hell || p.angel || p.glitch || p.fullArt || p.special === 'secret', `${p.id} has no design`); continue; }
    seen.add(key);
  }
  for (const key of seen) assert.ok(asset(key), `${key} image missing`);
  assert.ok(seen.size >= 8, `only ${seen.size} distinct designs used`);
});

console.log(`\n${n} passed`);
