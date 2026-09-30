// Contracts for the FIFA 22 and FC 24-27 historical promo catalog.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CARD_DESIGNS } from '../core/carddesigns.js';
import { getDB, getPlayer, _resetDB, adjustOvr, computeOvr, marketValue, tierOf } from '../core/players.js';
import { PROMOS, PROMO_BY_ID, buildPromoCards, isPromoLive, isPromoPackOnSale } from '../core/promos.js';
import { PACKS, SBCS } from '../core/ut.js';

const YEARS = new Map([[22, 'f22-'], [24, 'fc24-'], [25, 'fc25-'], [26, 'fc26-'], [27, 'fc27-']]);
const historical = PROMOS.filter((p) => YEARS.has(p.year));
// A sampled set of documented headline events per year prevents a thin catalog from passing on metadata alone.
// FC 27 intentionally covers only campaigns already published for that edition.
const REQUIRED_CAMPAIGNS = new Map([
  [22, ['Team of the Year', 'Team of the Season', 'Ones to Watch', 'Headliners', 'FUT Captains', 'Signature Signings', 'Versus', 'Numbers Up', 'Winter Wildcards', 'Rulebreakers']],
  [24, ['Team of the Year', 'Team of the Season', 'Ultimate Birthday', 'Trailblazers', 'Thunderstruck', 'Radioactive', 'Ultimate Dynasties', 'GOLAZO', 'Fantasy FC', 'Festival of Football']],
  [25, ['Team of the Year', 'Team of the Season', 'FUT Birthday', 'Trailblazers', 'Thunderstruck', 'Dreamchasers', 'Ultimate Succession', 'NumeroFUT', 'Total Rush', 'Globetrotters']],
  [26, ['Team of the Year', 'Team of the Season', 'FUT Birthday', 'Thunderstruck', 'Ultimate Scream', 'Unbreakables', 'Knockout Royalty', 'Festival of Football', 'Joga Bonito', 'Trophy Titans']],
  [27, ['Team of the Week', 'Destined for Glory', 'Debut International Icon', 'Base Hall of FUT', 'Ones to Watch', 'Squad Foundations']],
]);
const ORIGINAL_DESIGNS = {
  toty: 'f23-5', tots: 'f23-11', futurestars: 'f23-71', flashback: 'f23-51', birthday: 'f23-30', rttk: 'f23-47',
  moments: 'f23-91', showdown: 'f23-58', oty: 'f23-21', centurions: 'f23-151', storm: 'f23-49', rulebenders: 'f23-149',
  potm: 'f23-93', fright: 'f23-92', roleswap: 'f23-150', halo: 'f23-156', blackout: 'f23-120', champions: 'f23-124',
  frost: 'f23-118', yuletide: 'f23-122', fantasy: 'f23-134', wildfire: 'f23-50', finalchapter: 'f23-91', fiesta: 'f23-16',
  cupplayer: 'f23-129', roadtocup: 'f23-139', cupstories: 'f23-145', cupstar: 'f23-130', gloryroad: 'f23-131',
  cupicon: 'f23-129', cuphero: 'f23-133', phenoms: 'f23-146', totw: 'f23-3', cuptot: 'f23-138', rttf: 'f23-124',
  ballers: 'f23-163', titans: 'f23-156', totswarmup: 'f23-11', shapeshifters: 'f23-161', levelup: 'f23-167', preseason: 'f23-16',
};
const ORIGINAL_NAMES = {
  toty: 'Team of the Year', tots: 'Team of the Season', futurestars: 'Future Stars', flashback: 'Heroes Flashback',
  birthday: 'FUT Birthday', rttk: 'Road to the Knockouts', moments: 'Moments', showdown: 'Showdown Series',
  oty: 'Ones to Watch', centurions: 'FUT Centurions', storm: 'Storm Surge', rulebenders: 'Rulebreakers',
  potm: 'Player of the Month', fright: 'Fright Night', roleswap: 'Out of Position', halo: 'Hall of Heroes',
  blackout: 'Blackout', champions: 'Champions Night', frost: 'Winter Wildcards', yuletide: 'Yuletide Stars',
  fantasy: 'Fantasy FUT', wildfire: 'Wildfire', finalchapter: 'Final Chapter', fiesta: 'FUTTIES',
  cupplayer: 'Global Cup', roadtocup: 'Road to the World Cup', cupstories: 'World Cup Stories', cupstar: 'Cup Stars',
  gloryroad: 'World Cup Path to Glory', cupicon: 'Global Cup Icons', cuphero: 'Global Cup Heroes',
  phenoms: 'World Cup Phenoms', totw: 'Team of the Week', cuptot: 'World Cup Team of the Tournament',
  rttf: 'Road to the Final', ballers: 'FUT Ballers', titans: 'Trophy Titans', totswarmup: 'TOTS Warm-Up Series',
  shapeshifters: 'Shapeshifters', levelup: 'Level Up', preseason: 'Pre-Season',
};
const test = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.stack.split('\n').slice(0, 3).join('\n       ')}`); process.exitCode = 1; }
};

console.log('Historical promo tests');

test('historical campaigns have distinct stable ids, real names, and game-year design keys', () => {
  assert.ok(historical.length > 0, 'no historical campaigns carry a year');
  assert.equal(new Set(PROMOS.map((p) => p.id)).size, PROMOS.length, 'duplicate campaign id');
  for (const [year, prefix] of YEARS) {
    const campaigns = historical.filter((p) => p.year === year);
    assert.ok(campaigns.length > 0, `no FIFA/FC ${year} campaigns`);
    for (const required of REQUIRED_CAMPAIGNS.get(year)) {
      assert.ok(campaigns.some((p) => p.name.toLowerCase().includes(required.toLowerCase())), `${year}: missing ${required}`);
    }
    for (const p of campaigns) {
      assert.ok(typeof p.name === 'string' && p.name.trim().length > 2, `${p.id}: missing display name`);
      assert.match(p.id, new RegExp(`${year}$`), `${p.id}: id does not identify year ${year}`);
      assert.ok(typeof p.design === 'string' && p.design.startsWith(prefix), `${p.id}: design ${p.design} does not match ${year}`);
      assert.ok(CARD_DESIGNS[p.design], `${p.id}: ${p.design} is not a registered card design`);
      assert.ok(existsSync(new URL(`../../../assets/cards/${p.design}.webp`, import.meta.url)), `${p.id}: missing card image ${p.design}.webp`);
    }
  }
  for (const p of historical) assert.equal(PROMO_BY_ID[p.id], p, `${p.id}: lookup map does not resolve the definition`);
});

test('historical campaign ranges, prices, colors, and release weeks are usable', () => {
  for (const p of historical) {
    assert.ok(Array.isArray(p.range) && p.range.length === 2, `${p.id}: missing OVR range`);
    assert.ok(Number.isInteger(p.range[0]) && Number.isInteger(p.range[1]) && p.range[0] >= 1 && p.range[0] <= p.range[1] && p.range[1] <= 99, `${p.id}: invalid OVR range`);
    assert.ok(Number.isFinite(p.price) && p.price > 0, `${p.id}: invalid pack price`);
    assert.ok(Array.isArray(p.colors) && p.colors.length >= 2 && p.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `${p.id}: invalid campaign colors`);
    assert.ok(Number.isInteger(p.releaseWeek || 1) && (p.releaseWeek || 1) >= 1, `${p.id}: invalid release week`);
    assert.equal(typeof isPromoLive(p.id, p.releaseWeek || 1), 'boolean');
  }
  const late = historical.filter((p) => p.releaseWeek > 76);
  assert.ok(late.length > 0, 'no late-season historical campaigns beyond week 76');
  assert.equal(new Set(late.map((p) => p.releaseWeek)).size, late.length, 'late-season campaigns are not spread over distinct weeks');
});

test('historical campaign packs and SBC rewards resolve for every campaign', () => {
  const db = getDB();
  for (const p of historical) {
    assert.ok(db.promos.some((card) => card.special === p.id), `${p.id}: no promo cards generated`);
    const pack = PACKS.find((x) => x.id === `promo_${p.id}`);
    assert.ok(pack, `${p.id}: pack missing`);
    assert.equal(pack.promo, p.id);
    assert.ok(pack.slots.length > 0 && pack.slots.every((slot) => slot.n > 0 && Object.keys(slot.odds).length > 0), `${p.id}: empty pack rewards`);
    const sbcs = SBCS.filter((x) => x.promo === p.id);
    assert.ok(sbcs.length > 0, `${p.id}: no SBCs`);
    for (const sbc of sbcs) {
      assert.ok(sbc.reward && (sbc.reward.promoPlayer || sbc.reward.pack || sbc.reward.coins), `${sbc.id}: empty reward`);
      if (sbc.reward.promoPlayer) assert.equal(sbc.reward.promoPlayer.promo, p.id, `${sbc.id}: wrong promo player reward`);
      if (sbc.reward.pack) assert.ok(PACKS.some((x) => x.id === sbc.reward.pack), `${sbc.id}: unresolved pack reward`);
    }
  }
});

test('pre-existing promo ids and saved card ids still resolve', () => {
  const legacyIds = [
    'toty', 'tots', 'futurestars', 'flashback', 'birthday', 'rttk', 'moments', 'showdown', 'oty', 'centurions',
    'storm', 'rulebenders', 'potm', 'fright', 'roleswap', 'halo', 'blackout', 'champions', 'frost', 'yuletide',
    'fantasy', 'wildfire', 'finalchapter', 'fiesta', 'cupplayer', 'roadtocup', 'cupstories', 'cupstar', 'gloryroad',
    'cupicon', 'cuphero', 'phenoms', 'totw', 'cuptot', 'rttf', 'ballers', 'titans', 'totswarmup', 'shapeshifters',
    'levelup', 'preseason',
  ];
  const db = getDB();
  for (const [id, design] of Object.entries(ORIGINAL_DESIGNS)) {
    assert.ok(PROMO_BY_ID[id], `original campaign id ${id} was removed`);
    assert.equal(PROMO_BY_ID[id].design, design, `${id}: original card design changed`);
    assert.equal(PROMO_BY_ID[id].name, ORIGINAL_NAMES[id], `${id}: original campaign name changed`);
  }
  for (const id of legacyIds) {
    assert.ok(PROMO_BY_ID[id], `legacy campaign id ${id} was removed`);
    const oldCard = db.promos.find((p) => p.special === id);
    assert.ok(oldCard, `${id}: existing generated promo card missing`);
    assert.equal(oldCard.id, `pr_${id}_${oldCard.baseId}`, `${id}: saved card id format changed`);
    assert.ok(getPlayer(oldCard.id), `${oldCard.id}: saved promo card no longer resolves`);
  }
});

test('future historical packs respect their release week even during the global promo-sale period', () => {
  for (const p of historical.filter((x) => x.releaseWeek > 39)) {
    assert.equal(isPromoPackOnSale(p.id, p.releaseWeek - 1), false, `${p.id}: available before release`);
    assert.equal(isPromoPackOnSale(p.id, p.releaseWeek), true, `${p.id}: unavailable on release week`);
  }
});

test('diversified card building improves player spread over the legacy seeded selection', () => {
  const db = getDB();
  const source = { stars: db.stars, icons: db.icons, regulars: db.regulars, generated: db.players.filter((p) => !p.real), lateIcons: db.specials.filter((p) => p.special === 'icon') };
  const helpers = { adjustOvr, computeOvr, tierOf, marketValue };
  const legacy = buildPromoCards(source, helpers, undefined, { diverse: false });
  const current = db.promos;
  function distribution(cards) {
    const counts = new Map();
    for (const p of cards) {
      const person = p.person || p.baseId || p.id;
      counts.set(person, (counts.get(person) || 0) + 1);
    }
    return { unique: counts.size, max: Math.max(...counts.values()) };
  }
  const oldSpread = distribution(legacy), newSpread = distribution(current);
  assert.ok(newSpread.unique >= oldSpread.unique, `diversified unique count ${newSpread.unique} fell below legacy ${oldSpread.unique}`);
  assert.ok(newSpread.max <= oldSpread.max, `diversified max versions ${newSpread.max} exceeded legacy ${oldSpread.max}`);
  for (const p of PROMOS) {
    const people = current.filter((card) => card.special === p.id).map((card) => card.person || card.baseId);
    assert.equal(new Set(people).size, people.length, `${p.id}: duplicate person within campaign`);
  }
  _resetDB();
  assert.deepEqual(getDB().promos.map((p) => p.id), current.map((p) => p.id), 'promo database rebuild is not deterministic');
});
