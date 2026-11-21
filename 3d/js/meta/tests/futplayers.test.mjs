// Real EA FC card data (fut.gg import, core/futplayers.js + futdata.js): data validity, id / person stability, integration rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDB, getPlayer, computeOvr, tierOf } from '../core/players.js';
import { FUT_CARDS, FUT_BY_PERSON, FUT_NEW_BASE, FUT_NEW_ICONS, futFor, FUT_ASOF } from '../core/futdata.js';
import { NATION_BY_CODE, NATIONS, ALL_NATIONS, CARD_NATIONS } from '../core/data.js';
import { PLAYSTYLES, styleCountRange, maxPlus } from '../core/physique.js';
import { PROMOS } from '../core/promos.js';
import { bioFor } from '../core/bios.js';

let n = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); n++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
};
const db = getDB();
const before = JSON.parse(readFileSync(new URL('./fixtures/ids_before_futgg.json', import.meta.url), 'utf8'));

test('fut.gg rows: valid cards (rating, six stats, positions, nation, foot, weak foot, skill moves, height)', () => {
  assert.ok(FUT_CARDS.length >= 1500, `${FUT_CARDS.length} cards`);
  assert.ok(FUT_NEW_BASE.length >= 1000 && FUT_NEW_ICONS.length >= 50);
  assert.ok(FUT_ASOF);
  const POS = new Set(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF']);
  const seen = new Set();
  for (const c of FUT_CARDS) {
    const key = `${c.slug}|${c.kind}`;
    assert.ok(!seen.has(key), `duplicate ${key}`); seen.add(key);
    assert.ok(/^[a-z0-9]+$/.test(c.slug), `slug ${c.slug}`);
    assert.ok(c.ovr >= 40 && c.ovr <= 99 && POS.has(c.pos) && c.alt.every((a) => POS.has(a) && a !== c.pos), c.name);
    assert.equal(c.face.length, 6); assert.ok(c.face.every((v) => v >= 1 && v <= 99), `${c.name} face`);
    assert.ok(NATION_BY_CODE[c.nat], `${c.name}: nation ${c.nat} unknown`);
    assert.ok(['L', 'R'].includes(c.foot) && c.wf >= 1 && c.wf <= 5 && c.sm >= 1 && c.sm <= 5, c.name);
    assert.ok(c.height >= 150 && c.height <= 215 && (c.weight === 0 || (c.weight >= 45 && c.weight <= 120)), `${c.name} ${c.height}/${c.weight}`);
    assert.ok(['ISL', 'SOL', 'MEI', 'AUR', 'ETO', 'CON', 'ICN'].includes(c.lg), c.lg);
    assert.equal(c.lg === 'ICN', c.kind === 'i');
    for (const s of c.styles.split(' ').filter(Boolean)) assert.ok(PLAYSTYLES[s.replace(/\+$/, '')], `${c.name}: style ${s}`);
  }
});

test('card-only nations exist for cards but do not change the generated world', () => {
  assert.equal(NATIONS.length, 42); // the generated nations are untouched
  assert.ok(CARD_NATIONS.length >= 40);
  for (const c of CARD_NATIONS) {
    assert.equal(NATION_BY_CODE[c.code].name, c.name);
    assert.ok(!Object.keys(NATION_BY_CODE).includes(c.code), `${c.code} must not be enumerable`);
    assert.ok(!ALL_NATIONS.some((x) => x.code === c.code), `${c.code} is not a national team`);
  }
});

test('id stability: every card id of the database before the import still resolves (old saves)', () => {
  for (const id of before.real) assert.ok(getPlayer(id), `${id} lost`);
  for (const id of before.promos) { const p = getPlayer(id); assert.ok(p && p.id === id, `promo ${id} lost`); }
  for (const id of before.real.filter((x) => x.startsWith('rs_'))) assert.ok(getPlayer(id).real);
  const persons = new Map();
  for (const id of before.real) { const p = getPlayer(id); persons.set(id, p.person); }
  assert.equal(getPlayer('rs_messi').person, 'messi'); assert.equal(getPlayer('ic_messi').person, 'messi');
});

test('existing real players take the real FC card: rating, six stats, foot, height, PlayStyle rules; ids and persons stay', () => {
  const messi = getPlayer('rs_messi');
  const card = futFor('messi', 'star');
  assert.equal(card.kind, 'b');
  assert.equal(messi.ovr, card.ovr);
  assert.deepEqual(messi.stats, Object.fromEntries(['pac', 'sho', 'pas', 'dri', 'def', 'phy'].map((k, i) => [k, card.face[i]])), 'real face stats, not nudged');
  assert.equal(messi.height, card.height); assert.equal(messi.wf, card.wf); assert.equal(messi.sm, card.sm);
  assert.equal(messi.realClub, card.club); assert.ok(messi.futId);
  // a prime Icon never takes a current base card
  assert.equal(futFor('messi', 'icon'), null);
  assert.equal(getPlayer('ic_messi').futId, undefined);
  // a retired regular with a fut.gg Icon card is refreshed from it
  assert.ok(getPlayer('rp_pirlo').futId);
});

test('every fut-backed card: ovr == computeOvr (real stats + `ob`), tiers, PlayStyle rules, real height/foot', () => {
  let backed = 0;
  for (const p of db.all) {
    if (!p.futId || p.promo) continue;
    backed++;
    assert.equal(p.ovr, computeOvr(p.pos, p), `${p.id}`);
    assert.ok(p.ob === undefined || (Number.isInteger(p.ob) && Math.abs(p.ob) <= 12), `${p.id} ob ${p.ob}`);
    const [lo, hi] = styleCountRange(p.ovr);
    assert.ok(p.playstyles.length >= Math.min(lo, 4) && p.playstyles.length <= Math.min(hi, 4), `${p.id} ${p.ovr} has ${p.playstyles.length} styles`);
    assert.ok(p.playstyles.filter((x) => x.plus).length <= maxPlus(p.ovr));
    assert.ok(p.real && p.rare && p.physReal);
  }
  assert.ok(backed >= 1600, `${backed} fut-backed cards`);
});

test('new players: rs_<slug> base cards (not in Career `players`), ic_<slug> Icons in the Icons club; ids unique and stable', () => {
  assert.equal(db.futExtra.length, FUT_NEW_BASE.length);
  assert.equal(db.futIcons.length, FUT_NEW_ICONS.length);
  const ids = new Set(db.all.map((p) => p.id));
  assert.equal(ids.size, db.all.length, 'duplicate ids');
  for (const p of db.futExtra) {
    assert.ok(p.id.startsWith('rs_') && p.special === null && p.tier === tierOf(p.ovr) && !db.players.includes(p));
    assert.ok(db.byId.get(p.id) === p);
  }
  for (const p of db.futIcons) assert.ok(p.id.startsWith('ic_') && p.club === 'ICN' && p.special === 'lotg' && p.era === 'prime');
  // a new person never shares a slug with a different existing person: slugs of new cards are not any hand-written id
  for (const c of FUT_NEW_BASE) assert.ok(!before.real.includes(`rs_${c.slug}`) && !before.real.includes(`rp_${c.slug}`), c.slug);
  // Career squads are unchanged in size (no new real player in `players`)
  assert.equal(db.players.length, 3528);
});

test('clubs: fictional stand-ins by league; the real club and league are kept as facts', () => {
  const haaland = db.futExtra.concat(db.regulars).find((p) => p.person === 'haaland');
  assert.ok(haaland && haaland.realClub);
  for (const p of db.futExtra) {
    const c = db.byId.get(p.id);
    assert.ok(c.club && NATION_BY_CODE[c.nat] && c.league && c.realClub !== undefined);
  }
  // Real Madrid and Barcelona players land on the two strongest LaLiga clubs
  const rm = db.futExtra.filter((p) => p.realClub === 'Real Madrid');
  assert.ok(rm.length && new Set(rm.map((p) => p.club)).size === 1);
});

test('real data in packs: rating-weighted odds keep top cards rare, promos and pack opening stay fast with 5000+ cards', () => {
  assert.ok(db.all.length >= 5000);
  const t = Date.now();
  getPlayer('pr_toty_rp_kahn');
  assert.ok(Date.now() - t < 2000);
  for (const pr of PROMOS.filter((x) => x.id === 'toty')) assert.ok(db.all.some((p) => p.special === pr.id));
  const top = db.futExtra.filter((p) => p.ovr >= 86).length, all = db.futExtra.length;
  assert.ok(top / all < 0.05, 'only a few new cards are 86+');
});

test('real bios: EA card height / weight / foot, dob from the card when the hand-written list has none', () => {
  const b = bioFor('haaland');
  assert.ok(b && b.dob && b.height && b.weight && (b.foot === 'L' || b.foot === 'R'));
  assert.ok(FUT_BY_PERSON.get('messi').b.dob);
});

console.log(`${n} passed, ${failed} failed`);
if (failed) process.exit(1);
