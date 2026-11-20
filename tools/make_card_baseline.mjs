// Writes { id: sha1-prefix of the card's JSON } for EVERY card of a database build (db.all + resolver-only promo ids are not included).
// Used by the save-stability test (3d/js/meta/tests/card-stability.test.mjs): build it from the code BEFORE a card-data change
//   mkdir /tmp/base && git archive <old-commit> 3d/js/meta/core | tar -x -C /tmp/base
//   node tools/make_card_baseline.mjs /tmp/base/3d/js/meta/core/players.js 3d/js/meta/tests/fixtures/card_baseline.json
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [src, out] = process.argv.slice(2);
const { getDB } = await import(pathToFileURL(resolve(src)).href);
const db = getDB();
const res = {};
for (const p of db.all) res[p.id] = p.upg ? 'dyn' : createHash('sha1').update(JSON.stringify(p)).digest('hex').slice(0, 12); // upgradable promo cards (RTTK, Path to Glory) change every week by design
writeFileSync(out, JSON.stringify({ n: db.all.length, ids: res }));
console.log(`${db.all.length} cards -> ${out}`);
