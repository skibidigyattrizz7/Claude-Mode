// PlayStyles coverage: every PlayStyle the game knows (engine table + the meta/card list) must have a real
// gameplay effect in the sim, aliases must resolve, and PlayStyle+ must be stronger than the normal version.
// Run: node 3d/js/engine/tests/playstyles.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MatchSim } from '../core/sim.js';
import { PLAYSTYLES, PS_ALIASES, PS_PLUS, parsePlaystyles, ps } from '../core/playstyles.js';
import { PLAYSTYLES as META_PS, PS_ALIASES as META_ALIASES } from '../../meta/core/physique.js';
import { BRAZIL, FRANCE } from './sampleTeams.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = join(here, '..', 'core');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack)); }
}

// every `ps(x, 'id')` read anywhere in the engine core
const src = readdirSync(coreDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(coreDir, f), 'utf8')).join('\n');
const used = new Set([...src.matchAll(/\bps\(\s*[\w.]+\s*,\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1]));

const FC_LIST = ['finesse', 'power', 'chip', 'deadball', 'trivela', 'lowdriven', 'powerheader', 'acrobatic', 'gamechanger',
  'incisive', 'tikitaka', 'pinged', 'longball', 'whipped', 'inventive', 'firsttouch', 'technical', 'rapid', 'flair', 'trickster',
  'pressproven', 'anticipate', 'intercept', 'block', 'jockey', 'slidetackle', 'bruiser', 'aerial', 'quickstep', 'relentless',
  'longthrow', 'enforcer', 'farreach', 'footwork', 'rushout', 'crossclaimer', 'quickreflexes', 'deflector'];

test('the engine knows the full FC 25/26 PlayStyles list', () => {
  for (const id of FC_LIST) assert.ok(PLAYSTYLES[id], `engine missing ${id}`);
});
test('every engine PlayStyle has a gameplay effect in the sim', () => {
  const missing = Object.keys(PLAYSTYLES).filter((id) => !used.has(id));
  assert.deepEqual(missing, [], `no ps(p, id) effect for: ${missing.join(', ')}`);
});
test('every meta (card) PlayStyle maps to an engine PlayStyle with an effect', () => {
  for (const id of Object.keys(META_PS)) {
    assert.ok(PLAYSTYLES[id], `meta style ${id} unknown to the engine`);
    assert.ok(used.has(id), `meta style ${id} has no engine effect`);
  }
  for (const [alias, id] of Object.entries(META_ALIASES)) assert.equal(PS_ALIASES[alias], id, `alias ${alias}`);
});
test('aliases (FC names) resolve; PlayStyle+ is stronger than the normal version', () => {
  const m = parsePlaystyles([{ id: 'precisionheader', plus: true }, 'aerialfortress', { id: 'bogus' }, { id: 'enforcer' }]);
  assert.deepEqual(m, { powerheader: PS_PLUS, aerial: 1, enforcer: 1 });
  assert.ok(PS_PLUS > 1);
});

const withSt = (playstyles) => {
  const t = structuredClone(BRAZIL);
  t.players[9].playstyles = playstyles;
  t.players[3].playstyles = playstyles;
  return new MatchSim({ home: t, away: FRANCE, halfMinutes: 3, controllers: { home: 'ai', away: 'ai' }, seed: 1 });
};
test('Enforcer makes a player stronger (Enforcer+ more so)', () => {
  const base = withSt([]).players[9].str, n = withSt([{ id: 'enforcer' }]).players[9].str, plus = withSt([{ id: 'enforcer', plus: true }]).players[9].str;
  assert.ok(n > base && plus > n, `${base} ${n} ${plus}`);
});
test('Gamechanger / Inventive tighten the error of improvised finishes and passes', () => {
  // capture the aim spread the sim would apply
  const spread = (styles, kind, info = {}) => {
    const sim = withSt(styles);
    const p = sim.players[9];
    let got = null;
    sim._applyErr = (vel, sYaw) => { got = sYaw; return vel; };
    sim._execute(p, { vel: { x: 20, y: 3, z: 0 }, spin: { x: 0, y: 0, z: 0 }, info: { kind, pass: !!info.pass, shot: !info.pass, target: -1, power: 0.6, point: null, ...info } });
    return got;
  };
  const c0 = spread([], 'chip'), c1 = spread([{ id: 'gamechanger' }], 'chip'), c2 = spread([{ id: 'gamechanger', plus: true }], 'chip');
  assert.ok(c1 < c0 && c2 < c1, `chip ${c0} ${c1} ${c2}`);
  const f0 = spread([], 'ground', { pass: true, flair: true }), f1 = spread([{ id: 'inventive' }], 'ground', { pass: true, flair: true });
  assert.ok(f1 < f0, `flair pass ${f0} ${f1}`);
});
test('ps() reads 0 for a player without the style', () => {
  const p = withSt([{ id: 'finesse', plus: true }]).players[9];
  assert.equal(ps(p, 'finesse'), PS_PLUS);
  assert.equal(ps(p, 'gamechanger'), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
