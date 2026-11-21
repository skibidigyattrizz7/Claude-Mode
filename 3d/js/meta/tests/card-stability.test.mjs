// Save stability: the card database built BEFORE the late fut.gg cards / real promo cards (fixtures/card_baseline.json, made by
// tools/make_card_baseline.mjs from the previous commit) must still be inside the current database with IDENTICAL data, in the same order,
// so a saved club (which stores card ids) keeps exactly the same cards. New cards may only be appended after them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getDB, getPlayer } from '../core/players.js';
import { PROMO_BY_ID, isCardReleased } from '../core/promos.js';

const base = JSON.parse(readFileSync(new URL('./fixtures/card_baseline.json', import.meta.url), 'utf8'));
let n = 0, failed = 0;
const test = (name, fn) => { try { fn(); n++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); } };
const db = getDB();
const hash = (p) => (p.upg ? 'dyn' : createHash('sha1').update(JSON.stringify(p)).digest('hex').slice(0, 12));
const ids = Object.keys(base.ids);

test(`all ${base.n} earlier cards keep identical data (ratings, stats, club, photo, ...)`, () => {
  assert.equal(ids.length, base.n);
  const bad = [];
  for (const id of ids) { const p = db.byId.get(id); if (!p || hash(p) !== base.ids[id]) bad.push(id); }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} cards changed or vanished`);
});

test('earlier cards keep their order; new cards are only appended at the end', () => {
  const cur = db.all.map((p) => p.id);
  assert.deepEqual(cur.slice(0, ids.length), ids);
  assert.ok(cur.length > ids.length, 'new cards were added');
  assert.equal(new Set(cur).size, cur.length, 'duplicate card ids');
});

test('every earlier id still resolves through getPlayer', () => {
  for (const id of ids) assert.equal(getPlayer(id).id, id);
});

test('late fut.gg base cards: real data, ids rs_<slug>, appended after every earlier card', () => {
  assert.ok(db.futLate.length >= 2500, `${db.futLate.length} late cards`);
  for (const p of db.futLate) {
    assert.ok(p.id === `rs_${p.person}` && p.real && !p.promo && p.futId, p.id);
    assert.ok(p.ovr >= 50 && p.ovr <= 99 && p.height >= 162 && p.height <= 210, `${p.id} ${p.ovr} ${p.height}`);
    assert.ok(!base.ids[p.id], `${p.id} collides with an earlier card`);
  }
});

test('real promo cards: base exists, real rating, campaign release rules apply, no hotlinked image', () => {
  assert.ok(db.realPromos.length >= 1500, `${db.realPromos.length} real promo cards`);
  const seen = new Set();
  for (const p of db.realPromos) {
    assert.ok(/^rc2[67]_\d+$/.test(p.id) && !seen.has(p.id), p.id); seen.add(p.id);
    const b = db.byId.get(p.baseId);
    assert.ok(b && b.person === p.person, `${p.id} base`);
    assert.ok(PROMO_BY_ID[p.special] && p.promo === p.special && p.realPromo && p.realPromo.name, p.id);
    assert.ok(p.ovr >= 75 && p.ovr <= 99, `${p.id} ${p.ovr}`);
    assert.equal(db.byId.get(p.id), p);
    assert.equal(isCardReleased(p, 1), PROMO_BY_ID[p.special].releaseWeek ? false : true, `${p.id} release gating`);
    assert.ok(!/^https?:|fut\.gg/i.test(JSON.stringify([p.photo, p.image, p.img, p.photoUrl]) ), `${p.id} hotlinked image`);
    assert.ok(!JSON.stringify(p).includes('game-assets.fut.gg'), `${p.id} fut.gg url`);
    assert.ok(!base.ids[p.id], p.id);
    assert.ok(!db.promos.includes(p), 'real promo cards stay out of db.promos (SBC / promo-reward logic unchanged)');
  }
  const gk = db.realPromos.find((p) => p.pos === 'GK');
  assert.ok(gk && gk.sm === 1);
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
