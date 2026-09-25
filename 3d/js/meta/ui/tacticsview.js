// Custom Tactics editor (V2.2) for the UT squad and Career teams. Tactics are saved per squad as named sets;
// the active set is included in every Team object passed to startMatch.
import { h, clear, add, select, modal } from './dom.js';
import * as T from '../core/tactics.js';
import { FORMATION_NAMES } from '../core/formations.js';

/**
 * opts: {
 *   holder: object with tacticSets / activeTactic (UT state or career state),
 *   xi(): [{ id, name, pos, ovr }] current starters in slot order,
 *   formation(): string, setFormation?(f),
 *   onSave(): persist
 * }
 */
export function tacticsEditor(opts) {
  const root = h('div', { class: 'pm-tac' });
  const H = opts.holder;
  T.ensureTacticSets(H);
  let editId = H.activeTactic;
  const cur = () => H.tacticSets.find((x) => x.id === editId) || H.tacticSets[0];
  // sanitise in place so open handlers keep editing the same object (extra UI keys like quickSrc survive)
  const save = () => { const c = cur(); const clean = T.sanitizeTactics(c.t); for (const k of Object.keys(clean)) c.t[k] = clean[k]; opts.onSave && opts.onSave(); };

  function slider(label, key, lo, hi, hint) {
    const t = cur().t;
    const out = h('b', null, String(t[key]));
    const inp = h('input', { type: 'range', min: String(lo), max: String(hi), step: '1', value: String(t[key]), 'aria-label': label });
    inp.addEventListener('input', () => { t[key] = Number(inp.value); out.textContent = inp.value; });
    inp.addEventListener('change', save);
    return h('label', { class: 'pm-tac-slider' }, h('span', null, label, hint ? h('small', { class: 'pm-dim' }, ` ${hint}`) : null), h('div', null, inp, out));
  }
  function choice(label, key, list) {
    const t = cur().t;
    return h('label', { class: 'pm-tac-field' }, h('span', null, label), select(list, t[key], (v) => { t[key] = v; save(); render(); }, { 'aria-label': label }));
  }

  function render() {
    clear(root);
    const set = cur();
    const t = set.t;
    t.instructions = t.instructions || {}; t.setPieceTakers = t.setPieceTakers || {}; t.quick = t.quick || [];
    const xi = opts.xi().filter(Boolean);
    const active = H.activeTactic === set.id;
    // --- saved sets ---
    const bar = h('section', { class: 'pm-panel pm-tac-sets' },
      h('div', { class: 'pm-tac-row' },
        h('label', { class: 'pm-tac-field' }, h('span', null, 'Saved tactics'), select(H.tacticSets.map((x) => [x.id, `${x.name}${x.id === H.activeTactic ? ' (active)' : ''}`]), set.id, (v) => { editId = v; render(); }, { 'aria-label': 'Saved tactics' })),
        h('div', { class: 'pm-btnrow pm-wrap' },
          active ? h('span', { class: 'pm-chip on' }, '✓ Used in matches') : h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', onclick: () => { H.activeTactic = set.id; save(); render(); } }, 'Use in matches'),
          h('button', { class: 'pm-btn pm-btn--sm', disabled: H.tacticSets.length >= T.MAX_TACTIC_SETS, onclick: () => { const id = T.addTacticSet(H, `${set.name} copy`, structuredClone(t)); if (id) { editId = id; save(); render(); } } }, 'Duplicate'),
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => renameModal() }, 'Rename'),
          h('button', { class: 'pm-btn pm-btn--sm pm-btn--danger', disabled: H.tacticSets.length <= 1, onclick: () => { T.removeTacticSet(H, set.id); editId = H.activeTactic; save(); render(); } }, 'Delete'))),
      h('div', { class: 'pm-chips pm-tac-presets' }, h('span', { class: 'pm-lbl' }, 'Presets'), T.PRESET_IDS.map((pid) => h('button', {
        class: 'pm-chip', title: T.PRESETS[pid].desc,
        onclick: () => { Object.assign(t, T.PRESETS[pid].t); save(); render(); },
      }, T.PRESETS[pid].name))));

    // --- team shape ---
    const shape = h('section', { class: 'pm-panel' }, h('h3', null, 'Defence'),
      opts.setFormation ? h('label', { class: 'pm-tac-field' }, h('span', null, 'Formation'), select(FORMATION_NAMES, opts.formation(), (v) => { opts.setFormation(v); render(); }, { 'aria-label': 'Formation' })) : null,
      choice('Defensive style', 'defensiveStyle', T.DEFENSIVE_STYLES),
      slider('Width', 'width', 1, 10, '(narrow → wide)'),
      slider('Depth', 'depth', 1, 10, '(deep → high line)'));
    const attack = h('section', { class: 'pm-panel' }, h('h3', null, 'Attack'),
      choice('Build-up play', 'buildUp', T.BUILD_UPS),
      choice('Chance creation', 'chanceCreation', T.CHANCE_CREATION),
      slider('Players in box', 'playersInBox', 1, 10),
      slider('Corners (players forward)', 'corners', 1, 5),
      slider('Free kicks (players forward)', 'freeKicks', 1, 5));

    // --- set pieces ---
    const takerSel = (key, label) => h('label', { class: 'pm-tac-field' }, h('span', null, label),
      select([['', 'Auto'], ...xi.filter((p) => key === 'captain' || p.pos !== 'GK').map((p) => [p.id, `${p.name} (${p.pos} ${p.ovr})`])], t.setPieceTakers[key] || '', (v) => { if (v) t.setPieceTakers[key] = v; else delete t.setPieceTakers[key]; save(); }, { 'aria-label': label }));
    const takers = h('section', { class: 'pm-panel' }, h('h3', null, 'Set pieces & captain'),
      takerSel('captain', 'Captain'), takerSel('fk', 'Free kicks'), takerSel('pen', 'Penalties'), takerSel('cornerL', 'Left corners'), takerSel('cornerR', 'Right corners'));

    // --- player instructions ---
    const rows = xi.filter((p) => T.instructionGroups(p.pos).length).map((p) => {
      const ins = t.instructions[p.id] || {};
      return h('div', { class: 'pm-tac-ins' },
        h('div', { class: 'pm-tac-insname' }, h('b', null, p.pos), h('span', null, p.name)),
        h('div', { class: 'pm-tac-inssel' }, T.instructionGroups(p.pos).map((g) => select(T.INSTRUCTIONS[g], ins[g] || 'balanced', (v) => {
          const o = { ...(t.instructions[p.id] || {}) };
          if (v === 'balanced') delete o[g]; else o[g] = v;
          if (Object.keys(o).length) t.instructions[p.id] = o; else delete t.instructions[p.id];
          save();
        }, { 'aria-label': `${p.name} ${g}` }))));
    });
    const instr = h('section', { class: 'pm-panel pm-tac-instr' }, h('h3', null, 'Player instructions'),
      rows.length ? rows : h('p', { class: 'pm-dim' }, 'Complete your XI to set player instructions.'));

    // --- quick tactics ---
    const qOpts = [['', '— none —'], ...T.PRESET_IDS.map((id) => [`p:${id}`, `Preset: ${T.PRESETS[id].name}`]), ...H.tacticSets.filter((x) => x.id !== set.id).map((x) => [`s:${x.id}`, `Saved: ${x.name}`])];
    const quick = h('section', { class: 'pm-panel' }, h('h3', null, 'Quick tactics'), h('p', { class: 'pm-dim' }, 'Up to 4 in-match presets bound to the quick-tactic keys.'),
      [0, 1, 2, 3].map((i) => h('label', { class: 'pm-tac-field' }, h('span', null, `Quick ${i + 1}`), select(qOpts, (t.quickSrc || [])[i] || '', (v) => {
        t.quickSrc = (t.quickSrc || []).slice(); t.quickSrc[i] = v;
        t.quick = t.quickSrc.filter(Boolean).map((src) => (src.startsWith('p:') ? { ...T.PRESETS[src.slice(2)].t } : { ...(H.tacticSets.find((x) => x.id === src.slice(2)) || { t: {} }).t, instructions: undefined, quick: undefined }));
        save();
      }, { 'aria-label': `Quick tactic ${i + 1}` }))));
    add(root, bar, h('div', { class: 'pm-tac-grid' }, shape, attack, takers, quick), instr);
  }
  function renameModal() {
    const inp = h('input', { class: 'pm-input', value: cur().name, maxlength: '24', 'aria-label': 'Tactic name' });
    modal(opts.root || document.body, { title: 'Rename tactic', body: h('div', { class: 'pm-form' }, inp), actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => { cur().name = (inp.value.trim() || cur().name).slice(0, 24); save(); render(); } }] });
  }
  render();
  return { el: root, render };
}
