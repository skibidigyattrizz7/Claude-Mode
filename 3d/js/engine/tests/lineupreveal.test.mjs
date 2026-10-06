// Lineup reveal: the pure grouping / pitch-placement helpers (the DOM part is browser-checked).
import assert from 'node:assert/strict';
import { groupLines, pitchSlots } from '../../ui/lineupreveal.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

let passed = 0;
function check(name, fn) { fn(); passed++; }

const mk = (formation, posList) => ({
  name: 'T', formation, kit: {},
  players: posList.map((pos, i) => ({ id: `p${i}`, name: `P${i}`, number: i + 1, pos, ovr: 70 + i })),
});
const T442 = mk('4-4-2', ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST']);
const T352 = mk('3-5-2', ['GK', 'CB', 'CB', 'CB', 'LM', 'CDM', 'CDM', 'RM', 'CAM', 'ST', 'ST']);

check('lines: GK, DEF, MID, ATT in order, sizes add up to 11', () => {
  for (const t of [T442, T352, BRAZIL, FRANCE]) {
    const lines = groupLines(t);
    assert.deepEqual(lines.map((l) => l.key), ['gk', 'def', 'mid', 'att']);
    assert.equal(lines.reduce((s, l) => s + l.players.length, 0), 11);
    assert.equal(lines[0].players.length, 1);
  }
});

check('lines: line rating is the rounded mean, players ordered left to right', () => {
  const lines = groupLines(T442);
  const def = lines.find((l) => l.key === 'def');
  assert.deepEqual(def.players.map((p) => p.pos), ['LB', 'CB', 'CB', 'RB']);
  assert.equal(def.avg, Math.round(def.players.reduce((s, p) => s + p.ovr, 0) / 4));
  const mid = lines.find((l) => l.key === 'mid');
  assert.deepEqual(mid.players.map((p) => p.pos), ['LM', 'CM', 'CM', 'RM']);
});

check('lines: empty / odd input does not throw', () => {
  assert.deepEqual(groupLines(null), []);
  assert.deepEqual(groupLines({ players: [] }), []);
});

check('pitch: rows follow the formation, 11 distinct slots, GK at the back', () => {
  for (const t of [T442, T352, BRAZIL, FRANCE]) {
    const slots = pitchSlots(t, groupLines(t));
    assert.equal(slots.length, 11);
    assert.equal(new Set(slots.map((s) => s.p.id)).size, 11);
    assert.equal(slots[0].p.pos, 'GK');
    assert.equal(Math.min(...slots.slice(1).map((s) => s.d)) > slots[0].d, true);
    for (const s of slots) { assert.ok(s.u >= 0 && s.u <= 100 && s.d >= 0 && s.d <= 100); }
  }
  const s442 = pitchSlots(T442, groupLines(T442));
  assert.equal(new Set(s442.map((s) => s.d)).size, 4); // GK + 3 rows
  const s352 = pitchSlots(T352, groupLines(T352));
  assert.equal(s352.filter((s) => s.d === s352[1].d).length, 3); // back three share a row
});

check('pitch: a row is ordered left to right (wing-mid on the left)', () => {
  const slots = pitchSlots(T352, groupLines(T352));
  const mid = slots.filter((s) => ['LM', 'CDM', 'CAM', 'RM'].includes(s.p.pos));
  const lm = mid.find((s) => s.p.pos === 'LM'), rm = mid.find((s) => s.p.pos === 'RM');
  assert.ok(lm.u < rm.u);
});

check('pitch: a formation that does not match the XI falls back to position groups', () => {
  const odd = { ...T442, formation: '9-9-9' };
  const slots = pitchSlots(odd, groupLines(odd));
  assert.equal(slots.length, 11);
});

console.log(`${passed} lineup reveal tests passed`);
