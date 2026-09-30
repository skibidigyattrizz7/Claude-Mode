// Regression coverage for the FIFA 23 promo calendar, artwork and Ultimate Team integration.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getDB, _resetDB } from '../core/players.js';
import { PROMOS, PROMO_BY_ID, isPromoReleased, isPromoLive } from '../core/promos.js';
import { PACKS, SBCS } from '../core/ut.js';

const required = {
  totw: 'Team of the Week',
  oty: 'Ones to Watch',
  rttk: 'Road to the Knockouts',
  rulebenders: 'Rulebreakers',
  roleswap: 'Out of Position',
  gloryroad: 'World Cup Path to Glory',
  roadtocup: 'Road to the World Cup',
  cupstories: 'World Cup Stories',
  phenoms: 'World Cup Phenoms',
  cuptot: 'World Cup Team of the Tournament',
  frost: 'Winter Wildcards',
  centurions: 'FUT Centurions',
  toty: 'Team of the Year',
  futurestars: 'Future Stars',
  rttf: 'Road to the Final',
  showdown: 'Showdown Series',
  fantasy: 'Fantasy FUT',
  ballers: 'FUT Ballers',
  birthday: 'FUT Birthday',
  titans: 'Trophy Titans',
  totswarmup: 'TOTS Warm-Up Series',
  tots: 'Team of the Season',
  shapeshifters: 'Shapeshifters',
  levelup: 'Level Up',
  fiesta: 'FUTTIES',
  preseason: 'Pre-Season',
};

// These campaign ids already occur in saved cards, schedules, and reward references. Keep them stable.
const savedCampaignIds = [
  'toty', 'tots', 'futurestars', 'flashback', 'birthday', 'rttk', 'moments',
  'showdown', 'oty', 'centurions', 'storm', 'rulebenders', 'potm', 'fright',
  'roleswap', 'halo', 'blackout', 'champions', 'frost', 'yuletide', 'fantasy',
  'wildfire', 'finalchapter', 'fiesta', 'cupplayer', 'roadtocup', 'cupstories',
  'cupstar', 'gloryroad', 'cupicon', 'cuphero', 'phenoms',
];

function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.stack.split('\n').slice(0, 3).join('\n       ')}`); process.exitCode = 1; }
}

const fifa23 = PROMOS.filter((p) => p.year === undefined || p.year === 23);
console.log('FIFA 23 promo tests');

test('all requested campaigns use their real FIFA 23 names and unique stable ids', () => {
  assert.equal(new Set(PROMOS.map((p) => p.id)).size, PROMOS.length, 'duplicate campaign id');
  assert.equal(new Set(PROMOS.map((p) => p.name)).size, PROMOS.length, 'duplicate campaign name');
  for (const [id, name] of Object.entries(required)) {
    assert.ok(PROMO_BY_ID[id], `missing campaign ${id}`);
    assert.equal(PROMO_BY_ID[id].name, name, `${id} name`);
  }
});

test('previous campaign ids remain available for saved cards and schedules', () => {
  for (const id of savedCampaignIds) assert.ok(PROMO_BY_ID[id], `removed/renamed saved campaign id ${id}`);
  const db = getDB();
  for (const id of savedCampaignIds) {
    const oldCards = db.promos.filter((p) => p.id.startsWith(`pr_${id}_`));
    assert.ok(oldCards.length > 0, `no resolvable cards remain for ${id}`);
    assert.ok(oldCards.every((p) => p.id === `pr_${id}_${p.baseId}`), `${id} card ids changed format`);
  }
});

test('campaign artwork matches the requested and visually verified rarity backgrounds', () => {
  const designs = {
    totw: 3, toty: 5, tots: 11, fiesta: 16, oty: 21, birthday: 30, flashback: 51,
    rttk: 47, frost: 118, cupicon: 129, centurions: 151, titans: 156, rulebenders: 149,
    futurestars: 71, roleswap: 150, gloryroad: 131, roadtocup: 139, cupstories: 145,
    phenoms: 146, cuptot: 138, rttf: 124, showdown: 58, fantasy: 134, ballers: 163,
    shapeshifters: 161, levelup: 167, totswarmup: 11, preseason: 16,
  };
  for (const [id, rarity] of Object.entries(designs)) assert.equal(PROMO_BY_ID[id].design, `f23-${rarity}`, `${id} artwork`);
});

test('every FIFA 23 campaign has a local FIFA 23 card design, valid range and usable release week', () => {
  for (const p of fifa23) {
    assert.match(p.design, /^f23-[\w-]+$/, `${p.id}: invalid design key`);
    assert.ok(existsSync(new URL(`../../../assets/cards/${p.design}.webp`, import.meta.url)), `${p.id}: missing ${p.design}.webp`);
    assert.ok(Array.isArray(p.range) && p.range.length === 2, `${p.id}: missing range`);
    assert.ok(Number.isInteger(p.range[0]) && Number.isInteger(p.range[1]) && p.range[0] >= 1 && p.range[0] <= p.range[1] && p.range[1] <= 99, `${p.id}: invalid range`);
    assert.ok(Number.isInteger(p.releaseWeek || 1) && (p.releaseWeek || 1) >= 1, `${p.id}: invalid release week`);
    assert.ok(typeof p.theme === 'string' && p.theme.length > 0, `${p.id}: missing pack-opening theme`);
  }
});

test('promo packs and SBCs remain integrated with the current promo definitions', () => {
  const cards = getDB().promos;
  for (const p of PROMOS) {
    assert.ok(cards.some((card) => card.special === p.id), `${p.id}: no cards for pack/SBC rewards`);
    const pack = PACKS.find((x) => x.id === `promo_${p.id}`);
    assert.ok(pack, `${p.id}: missing pack`);
    assert.equal(pack.promo, p.id);
    assert.equal(pack.slots[0].odds[`promo_${p.id}`], 1, `${p.id}: first slot must guarantee its promo`);
    const sbcs = SBCS.filter((x) => x.promo === p.id);
    assert.equal(sbcs.length, 2, `${p.id}: expected player and upgrade SBCs`);
    assert.ok(sbcs.some((x) => x.reward.promoPlayer?.promo === p.id), `${p.id}: no featured player reward`);
    assert.ok(sbcs.some((x) => x.reward.pack === `promo_${p.id}`), `${p.id}: no pack upgrade reward`);
  }
});

test('campaign availability obeys release week and remains deterministic', () => {
  for (const p of PROMOS) {
    if (p.releaseWeek) assert.equal(isPromoReleased(p.id, p.releaseWeek - 1), false, `${p.id}: pre-release`);
    assert.equal(isPromoReleased(p.id, p.releaseWeek || 1), true, `${p.id}: release week`);
    assert.equal(typeof isPromoLive(p.id, p.releaseWeek || 1), 'boolean');
  }
  const fingerprint = () => getDB().promos.map((p) => `${p.id}|${p.name}|${p.ovr}|${p.design}`).join('\n');
  const first = fingerprint();
  _resetDB();
  assert.equal(fingerprint(), first, 'promo card builder changed output across database regenerations');
});

test('FIFA 23 promo pool spreads cards across players when campaign alternatives are available', () => {
  const ids = new Set(fifa23.map((p) => p.id));
  const cards = getDB().promos.filter((p) => ids.has(p.special));
  const usage = new Map();
  for (const p of cards) usage.set(p.person || p.baseId, (usage.get(p.person || p.baseId) || 0) + 1);
  const counts = [...usage.values()];
  assert.ok(usage.size >= 80, `only ${usage.size} distinct players across ${cards.length} promo cards`);
  assert.ok(counts.filter((n) => n >= 4).length <= 12, 'too many players have four or more promo versions');
  for (const campaign of fifa23) {
    const people = cards.filter((p) => p.special === campaign.id).map((p) => p.person || p.baseId);
    assert.equal(new Set(people).size, people.length, `${campaign.id}: duplicate player within campaign`);
  }
});
