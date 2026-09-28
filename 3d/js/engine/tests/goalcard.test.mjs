// Goal scorer card: the pure scorer-info extraction used by ui/goalcard.js.
import assert from 'node:assert/strict';
import { goalCardInfo, cardSurname } from '../ui/goalcard.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('ok', name); }
const teams = [BRAZIL, FRANCE];

check('home scorer: name, ovr, pos, number, side and team colour', () => {
  const pd = BRAZIL.players[10];
  const i = goalCardInfo({ team: 0, pi: 10, og: 0 }, pd, teams, 23);
  assert.equal(i.id, String(pd.id));
  assert.equal(i.name, pd.name);
  assert.equal(i.ovr, pd.ovr);
  assert.equal(i.pos, pd.pos);
  assert.equal(i.number, String(pd.number));
  assert.equal(i.side, 0); assert.equal(i.sideName, 'home'); assert.equal(i.scoringSide, 0);
  assert.equal(i.og, false); assert.equal(i.label, 'GOAL');
  assert.equal(i.minute, 23);
  assert.equal(i.teamShort, BRAZIL.short);
  assert.equal(i.kit.primary, BRAZIL.kit.primary);
});

check('away scorer uses indices 11..21 and the away kit', () => {
  const pd = FRANCE.players[9];
  const i = goalCardInfo({ team: 1, pi: 20, og: 0 }, pd, teams, 88);
  assert.equal(i.side, 1); assert.equal(i.sideName, 'away'); assert.equal(i.og, false);
  assert.equal(i.teamShort, FRANCE.short);
  assert.equal(i.kit.primary, FRANCE.kit.primary);
});

check('own goal: flagged, labelled, shown in the scorer\'s own team colours', () => {
  const pd = FRANCE.players[3];
  const i = goalCardInfo({ team: 0, pi: 14, og: 1 }, pd, teams, 61);
  assert.equal(i.og, true); assert.equal(i.label, 'OWN GOAL');
  assert.equal(i.side, 1); assert.equal(i.scoringSide, 0);
  assert.equal(i.kit.primary, FRANCE.kit.primary);
  // a player on the other side than the scoring team is an OG even without the flag
  assert.equal(goalCardInfo({ team: 1, pi: 3 }, BRAZIL.players[3], teams, 5).og, true);
});

check('dark kits get a visible accent bar; bad data never throws', () => {
  const dark = { short: 'BLK', kit: { primary: '#111111', secondary: '#f2c200' } };
  const i = goalCardInfo({ team: 0, pi: 2 }, { name: 'A. Test', ovr: 140 }, [dark, FRANCE], 12.4);
  assert.equal(i.accent, '#f2c200');
  assert.equal(i.ovr, 99);
  assert.equal(i.minute, 12);
  const e = goalCardInfo(null, null, null, NaN);
  assert.equal(e.name, 'Unknown'); assert.equal(e.id, null); assert.equal(e.minute, null); assert.equal(e.ovr, null);
  assert.match(e.kit.primary, /^#[0-9a-f]{6}$/i);
  assert.ok(['#ffffff', '#0b0d10'].includes(e.kit.ink));
});

check('card surname', () => {
  assert.equal(cardSurname('R. Alves'), 'Alves');
  assert.equal(cardSurname('J. da Silva'), 'da Silva');
  assert.equal(cardSurname('Vinicius'), 'Vinicius');
  assert.equal(cardSurname('Kylian Mbappe'), 'Mbappe');
  assert.equal(cardSurname(''), '');
});

console.log(`${passed} goal card tests passed`);
