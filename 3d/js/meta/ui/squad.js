// Squad builder component: formation pitch with drag-and-drop / tap-to-place, bench, chemistry lines,
// manager slot, chem-mode toggle and player picker.
//
// Perf note: a swap/place only patches the DOM nodes it actually changes (the moved slot's card content,
// every slot's chemistry pip/line since chemistry is a team-wide calculation, and the small info chips) —
// it never tears down and rebuilds the whole pitch/bench on every move, so drag/tap swapping stays smooth
// even on low-end phones.
import { h, clear, select, add, modal } from './dom.js';
import { playerCard, emptyCard } from './card.js';
import { flagSVG } from './art.js';
import { FORMATIONS, FORMATION_NAMES, positionFit, effectiveOvr, playerPositions } from '../core/formations.js';
import { calcChemistryStyled, CHEM_STYLES } from '../core/chemistry.js';
import { teamRating } from '../core/chemistry.js';
import { POS_GROUP, NATION_BY_CODE, NATIONS, LEAGUES, leagueName } from '../core/data.js';
import { icon } from './icons.js';

const px = (x) => 5 + x * 0.9;
const py = (y) => 2 + (96 - y) * 1.03;
const POS_FILTERS = ['ALL', 'GK', 'DEF', 'MID', 'ATT'];
const CHEM_CLASS = ['c0', 'c1', 'c2', 'c3'];

/**
 * opts: {
 *   formation, slots: id[11], bench: id[7] | null,
 *   getPlayer(id), pool(): player[],
 *   onChange({formation, slots, bench}),
 *   chemistry: bool, chemToggle: bool, allowFormation: bool,
 *   manager: { value, onChange(manager) } | null,
 *   decorate(p): Node | null   // extra overlay per card (fitness etc.)
 *   rowInfo(p): string          // extra info in picker rows
 *   toolbar: Node[]             // extra toolbar buttons
 *   onInfo(): void              // called after each render with {rating, chem}
 * }
 */
export function squadEditor(opts) {
  const st = {
    formation: opts.formation,
    slots: opts.slots.slice(),
    bench: opts.bench ? opts.bench.slice() : null,
    manager: opts.manager ? opts.manager.value || null : null,
    sel: null, // {area:'slot'|'bench', idx}
    q: '', group: 'AUTO', sort: 'ovr',
    chemOn: true,
    chemStyle: opts.chemStyle ? (opts.chemStyle.value || 'classic') : 'classic',
  };
  const root = h('div', { class: 'pm-sq' });
  const info = h('div', { class: 'pm-sq-info' });
  const pitchWrap = h('div', { class: 'pm-sq-pitchwrap' });
  const benchEl = h('div', { class: 'pm-sq-bench' });
  const picker = h('div', { class: 'pm-sq-picker', hidden: true });
  const toolbar = h('div', { class: 'pm-sq-toolbar' });
  const managerEl = opts.manager ? h('div', { class: 'pm-sq-manager' }) : null;
  const mainCol = h('div', { class: 'pm-sq-main' }, info, pitchWrap,
    st.bench ? h('div', { class: 'pm-sq-benchwrap' }, h('div', { class: 'pm-sq-label' }, 'Substitutes'), benchEl) : null,
    managerEl);
  add(root, toolbar, h('div', { class: 'pm-sq-grid' }, mainCol, picker));

  // area:idx -> { wrap, btn } live DOM refs, so a move only patches the nodes it touches.
  const nodes = new Map();
  const key = (area, idx) => `${area}:${idx}`;

  const player = (id) => (id ? opts.getPlayer(id) : null);
  const emit = () => opts.onChange && opts.onChange({ formation: st.formation, slots: st.slots.slice(), bench: st.bench ? st.bench.slice() : null });

  function locate(pid) {
    let i = st.slots.indexOf(pid);
    if (i >= 0) return { area: 'slot', idx: i };
    if (st.bench) { i = st.bench.indexOf(pid); if (i >= 0) return { area: 'bench', idx: i }; }
    return null;
  }
  const arr = (area) => (area === 'slot' ? st.slots : st.bench);
  function place(target, pid) {
    const from = locate(pid);
    const cur = arr(target.area)[target.idx];
    if (from) arr(from.area)[from.idx] = cur || null;
    arr(target.area)[target.idx] = pid;
    return [target, from].filter(Boolean);
  }
  function swap(a, b) {
    const x = arr(a.area)[a.idx], y = arr(b.area)[b.idx];
    arr(a.area)[a.idx] = y || null; arr(b.area)[b.idx] = x || null;
    return [a, b];
  }

  /** Rebuild only slot (area,idx)'s card content in its existing button (no siblings touched). */
  function patchSlotCard(area, idx) {
    const ref = nodes.get(key(area, idx));
    if (!ref) return;
    const { btn } = ref;
    const f = FORMATIONS[st.formation];
    const pos = area === 'slot' ? f.slots[idx].pos : 'SUB';
    const p = player(arr(area)[idx]);
    clear(btn);
    btn.className = `pm-slot ${st.sel && st.sel.area === area && st.sel.idx === idx ? 'is-sel' : ''} ${p ? '' : 'is-empty'}`;
    btn.setAttribute('aria-label', p ? `${pos}: ${p.name} ${p.ovr}` : `Empty ${pos} slot`);
    btn.draggable = !!p;
    if (p) {
      const card = playerCard(p, { size: 'xs', pos: area === 'slot' ? pos : p.pos, extra: opts.decorate ? opts.decorate(p) : null });
      if (area === 'slot' && positionFit(p, pos) === 0) card.classList.add('is-oop');
      btn.appendChild(card);
    } else btn.appendChild(emptyCard(pos));
  }

  /** Chemistry is team-wide: patch every slot's pip + the link-line colours without rebuilding cards. */
  function patchChemistry(chem) {
    if (opts.chemistry === false || !st.chemOn) { pitchWrap.querySelectorAll('.pm-chempip').forEach((n) => n.remove()); return; }
    st.slots.forEach((pid, i) => {
      const ref = nodes.get(key('slot', i));
      if (!ref) return;
      let pip = ref.wrap.querySelector('.pm-chempip');
      if (!pid) { if (pip) pip.remove(); return; }
      const c = chem.players[i];
      if (!pip) { pip = h('div', { class: 'pm-chempip' }); ref.wrap.appendChild(pip); }
      pip.className = `pm-chempip ${CHEM_CLASS[c]}`;
      pip.title = `Chemistry ${c}/3`;
      pip.textContent = String(c);
    });
    const svg = pitchWrap.querySelector('.pm-chemlines');
    if (svg) {
      const f = FORMATIONS[st.formation];
      svg.innerHTML = chem.links.map((l) => {
        const a = f.slots[l.a], b = f.slots[l.b];
        return `<line x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}" class="ln-${l.color}"/>`;
      }).join('');
    }
  }

  function patchInfo(chem) {
    const slotsP = st.slots.map(player);
    const rating = teamRating(slotsP);
    clear(info);
    add(info,
      h('div', { class: 'pm-stat-chip' }, h('span', null, 'Rating'), h('b', null, rating || '–')),
      opts.chemistry !== false ? h('div', { class: `pm-stat-chip ${st.chemOn ? '' : 'is-off'}` }, h('span', null, 'Chemistry'), h('b', null, st.chemOn ? `${chem.scaled}` : 'Off'), st.chemOn ? h('small', null, ` ${chem.total}/33`) : null) : null,
      h('div', { class: 'pm-stat-chip' }, h('span', null, 'Players'), h('b', null, `${slotsP.filter(Boolean).length}/11`)),
    );
    if (opts.onInfo) opts.onInfo({ rating, chem, slots: slotsP });
    return { rating, chem };
  }

  /** Recompute chemistry + patch the affected/whole-team visuals; far cheaper than a full render(). */
  function afterMove(touched) {
    const chem = calcChemistryStyled(st.formation, st.slots.map(player), st.chemStyle);
    for (const t of touched) patchSlotCard(t.area, t.idx);
    patchChemistry(chem);
    patchInfo(chem);
  }

  function bindSlotDnD(btn, area, idx) {
    btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ area, idx })); e.dataTransfer.effectAllowed = 'move'; });
    btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.classList.add('is-drop'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('is-drop'));
    btn.addEventListener('drop', (e) => {
      e.preventDefault(); btn.classList.remove('is-drop');
      let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      const wasSel = st.sel; st.sel = null;
      const touched = d.pid ? place({ area, idx }, d.pid) : d.area ? swap(d, { area, idx }) : [];
      if (wasSel) patchSlotCard(wasSel.area, wasSel.idx);
      closePicker();
      afterMove(touched);
      emit();
    });
  }

  function makeSlotButton(area, idx) {
    const btn = h('button', { class: 'pm-slot', onclick: () => onSlotClick(area, idx) });
    btn.dataset.area = area; btn.dataset.idx = idx;
    bindSlotDnD(btn, area, idx);
    return btn;
  }

  function onSlotClick(area, idx) {
    const prevSel = st.sel;
    if (!st.sel) { st.sel = { area, idx }; st.group = 'AUTO'; patchSlotCard(area, idx); renderPicker(); focusPicker(); return; }
    if (st.sel.area === area && st.sel.idx === idx) { st.sel = null; patchSlotCard(area, idx); closePicker(); return; }
    const touched = swap(st.sel, { area, idx });
    st.sel = null;
    patchSlotCard(prevSel.area, prevSel.idx);
    closePicker();
    afterMove(touched);
    emit();
  }
  function focusPicker() {
    setTimeout(() => {
      const s = picker.querySelector('.pm-sq-search');
      if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      else if (s) s.focus({ preventScroll: true });
    }, 30);
  }
  function closePicker() { picker.hidden = true; clear(picker); }

  function renderPitch() {
    clear(pitchWrap);
    nodes.clear();
    const f = FORMATIONS[st.formation];
    const pitch = h('div', { class: 'pm-pitch' }, h('div', { class: 'pm-pitch-grass', 'aria-hidden': 'true' }), h('div', { class: 'pm-pitch-lines' }));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'pm-chemlines');
    pitch.appendChild(svg);
    f.slots.forEach((s, i) => {
      const btn = makeSlotButton('slot', i);
      const wrap = h('div', { class: 'pm-slotpos', style: { left: `${px(s.x)}%`, top: `${py(s.y)}%` } }, btn);
      nodes.set(key('slot', i), { wrap, btn });
      patchSlotCard('slot', i);
      pitch.appendChild(wrap);
    });
    pitchWrap.appendChild(pitch);
  }

  function renderBench() {
    if (!st.bench) return;
    clear(benchEl);
    st.bench.forEach((_, i) => {
      const btn = makeSlotButton('bench', i);
      nodes.set(key('bench', i), { wrap: btn, btn });
      patchSlotCard('bench', i);
      benchEl.appendChild(btn);
    });
  }

  function renderManager() {
    if (!managerEl) return;
    clear(managerEl);
    const m = st.manager;
    add(managerEl, h('div', { class: 'pm-sq-label' }, 'Manager'),
      h('button', { class: `pm-mgrslot ${m ? '' : 'is-empty'}`, onclick: () => openManagerPicker() },
        m ? [h('div', { class: 'pm-mgr-flag', html: flagSVG(m.nat, 'pc-flag') }), h('div', { class: 'pm-mgr-info' }, h('b', null, m.name), h('small', { class: 'pm-dim' }, `${NATION_BY_CODE[m.nat] ? NATION_BY_CODE[m.nat].name : m.nat} · ${leagueName(m.league)}`))]
          : [icon('admin'), h('span', null, 'Assign a manager')]));
  }
  function openManagerPicker() {
    const modalRoot = root.closest('.pm-root') || document.body;
    const nameInp = h('input', { class: 'pm-input', placeholder: 'Manager name', value: st.manager ? st.manager.name : '', maxlength: '22' });
    const natSel = select(NATIONS.slice(0, 60).map((n) => [n.code, n.name]), st.manager ? st.manager.nat : 'ENG', () => {}, { 'aria-label': 'Manager nation' });
    const leagueSel = select(LEAGUES.map((l) => [l.id, l.name]), st.manager ? st.manager.league : LEAGUES[0].id, () => {}, { 'aria-label': 'Preferred league' });
    modal(modalRoot, {
      title: 'Club manager', body: h('div', { class: 'pm-mgr-form' },
        h('p', { class: 'pm-dim' }, 'Cosmetic club identity — shown on your Squad and Club screens.'),
        nameInp, natSel, leagueSel),
      actions: [
        st.manager ? { label: 'Remove', danger: true, onClick: () => { st.manager = null; renderManager(); if (opts.manager) opts.manager.onChange(null); } } : null,
        { label: 'Save', primary: true, onClick: () => {
          const name = nameInp.value.trim(); if (!name) return false;
          st.manager = { name, nat: natSel.value, league: leagueSel.value };
          renderManager();
          if (opts.manager) opts.manager.onChange(st.manager);
        } },
      ].filter(Boolean),
    });
  }

  function renderPicker() {
    if (!st.sel) { closePicker(); return; }
    picker.hidden = false;
    clear(picker);
    const f = FORMATIONS[st.formation];
    const slotPos = st.sel.area === 'slot' ? f.slots[st.sel.idx].pos : null;
    const current = player(arr(st.sel.area)[st.sel.idx]);
    const group = st.group === 'AUTO' ? (slotPos ? POS_GROUP[slotPos] : 'ALL') : st.group;
    const search = h('input', { class: 'pm-input pm-sq-search', type: 'search', placeholder: 'Search players…', value: st.q, 'aria-label': 'Search players' });
    search.addEventListener('input', () => { st.q = search.value; renderList(); });
    const list = h('div', { class: 'pm-sq-list', role: 'list' });
    add(picker,
      h('div', { class: 'pm-sq-pickhead' },
        h('div', null, h('div', { class: 'pm-kicker' }, st.sel.area === 'slot' ? `Slot ${slotPos}` : 'Substitute'), h('b', null, current ? `Replace ${current.name}` : 'Choose a player')),
        h('button', { class: 'pm-x', 'aria-label': 'Close picker', onclick: () => { const s0 = st.sel; st.sel = null; patchSlotCard(s0.area, s0.idx); closePicker(); } }, '×')),
      h('div', { class: 'pm-sq-filters' },
        search,
        h('div', { class: 'pm-chips' }, POS_FILTERS.map((g) => h('button', { class: `pm-chip ${group === g ? 'on' : ''}`, onclick: () => { st.group = g; renderPicker(); } }, g))),
        select([['ovr', 'Sort: Rating'], ['fit', 'Sort: Best fit'], ['name', 'Sort: Name']], st.sort, (v) => { st.sort = v; renderList(); }, { 'aria-label': 'Sort' })),
      current ? h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => { const s0 = st.sel; arr(s0.area)[s0.idx] = null; st.sel = null; closePicker(); afterMove([s0]); emit(); } }, 'Remove from slot') : null,
      current && st.sel.area === 'slot' ? playAs(current) : null,
      list,
      h('p', { class: 'pm-hint' }, 'Tip: tap a slot, then another slot to swap. Drag cards on desktop.'),
    );
    function renderList() {
      clear(list);
      const q = st.q.trim().toLowerCase();
      let pool = opts.pool().filter((p) => (group === 'ALL' || POS_GROUP[p.pos] === group) && (!q || p.name.toLowerCase().includes(q)));
      const sp = slotPos || null;
      if (st.sort === 'ovr') pool.sort((a, b) => b.ovr - a.ovr);
      else if (st.sort === 'fit' && sp) pool.sort((a, b) => effectiveOvr(b, sp) - effectiveOvr(a, sp));
      else pool.sort((a, b) => a.name.localeCompare(b.name));
      pool = pool.slice(0, 80);
      if (!pool.length) list.appendChild(h('p', { class: 'pm-empty' }, 'No players match.'));
      for (const p of pool) {
        const loc = locate(p.id);
        const fit = sp ? positionFit(p, sp) : 2;
        const row = h('button', {
          class: `pm-prow ${loc ? 'in-use' : ''}`, role: 'listitem', draggable: 'true',
          onclick: () => { const s0 = st.sel; const touched = place(s0, p.id); st.sel = null; closePicker(); afterMove(touched); emit(); },
        },
        playerCard(p, { size: 'xs' }),
        h('div', { class: 'pm-prow-info' },
          h('b', null, p.name),
          h('span', null, `${p.pos}${p.alt && p.alt.length ? ' · ' + p.alt.join('/') : ''} · ${NATION_BY_CODE[p.nat]?.name || p.nat}`),
          h('span', { class: 'pm-dim' }, leagueName(p.league) + (opts.rowInfo ? ' · ' + opts.rowInfo(p) : '')),
          loc ? h('span', { class: 'pm-tagmini' }, loc.area === 'slot' ? 'In XI' : 'On bench') : null),
        sp ? h('span', { class: `pm-fit fit${fit}`, title: fit === 2 ? 'Natural position' : fit === 1 ? 'Alternate position' : 'Out of position' }, fit === 2 ? '●' : fit === 1 ? '◐' : '○') : null);
        row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ pid: p.id })); });
        list.appendChild(row);
      }
    }
    renderList();
  }

  /** "Play as": move the selected player to a slot matching one of his positions (swapping the occupant). */
  function playAs(p) {
    const f = FORMATIONS[st.formation];
    const from = st.sel.idx;
    const chips = playerPositions(p).map((pos) => {
      const target = f.slots.findIndex((sl, i) => sl.pos === pos && i === from) >= 0 ? from : f.slots.findIndex((sl) => sl.pos === pos);
      const here = f.slots[from].pos === pos;
      return h('button', {
        class: `pm-chip ${here ? 'on' : ''}`, disabled: target < 0,
        title: target < 0 ? `No ${pos} slot in ${st.formation}` : here ? 'Current position' : `Move to the ${pos} slot`,
        onclick: () => { if (target < 0 || here) return; const touched = swap({ area: 'slot', idx: from }, { area: 'slot', idx: target }); st.sel = null; closePicker(); afterMove(touched); emit(); },
      }, `${pos} ${effectiveOvr(p, pos)}`);
    });
    const cur = f.slots[from].pos;
    const oop = positionFit(p, cur) === 0;
    return h('div', { class: 'pm-playas' }, h('span', { class: 'pm-lbl' }, 'Play as'), h('div', { class: 'pm-chips' }, chips),
      oop ? h('small', { class: 'pm-warnline' }, `Out of position at ${cur}: ${effectiveOvr(p, cur)} OVR, 0 chemistry.`) : null);
  }

  function renderToolbar() {
    clear(toolbar);
    if (opts.allowFormation !== false) {
      toolbar.appendChild(h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'Formation'),
        select(FORMATION_NAMES, st.formation, (v) => {
          // keep the same XI, re-seat players into the new shape by best positional fit
          const xi = st.slots.map(player).filter(Boolean);
          const nf = FORMATIONS[v];
          const seats = new Array(11).fill(null);
          const order = nf.slots.map((sl, i) => i);
          for (const i of order) {
            let bi = -1, bs = -Infinity;
            xi.forEach((p, k) => { if (!p) return; const s = effectiveOvr(p, nf.slots[i].pos); if (s > bs) { bs = s; bi = k; } });
            if (bi >= 0) { seats[i] = xi[bi].id; xi[bi] = null; }
          }
          st.slots = seats;
          st.formation = v; st.sel = null;
          render(); emit();
        }, { 'aria-label': 'Formation' })));
    }
    if (opts.chemToggle && opts.chemistry !== false) {
      toolbar.appendChild(h('button', { class: `pm-btn pm-btn--ghost pm-btn--sm pm-chemtoggle ${st.chemOn ? 'is-on' : ''}`, onclick: () => { st.chemOn = !st.chemOn; renderToolbar(); afterMove([]); } },
        icon('swap'), st.chemOn ? ' Chemistry: On' : ' Chemistry: Off'));
    }
    if (opts.chemStyle && opts.chemistry !== false) {
      toolbar.appendChild(h('label', { class: 'pm-inline', title: 'Classic: formation-link chemistry. FC26: club/league/nation counts across the whole XI, no adjacency.' },
        h('span', { class: 'pm-dim' }, 'Chemistry style'),
        select([['classic', 'Classic (links)'], ['fc26', 'FC26 (whole XI)']], st.chemStyle, (v) => {
          st.chemStyle = v;
          if (opts.chemStyle.onChange) opts.chemStyle.onChange(v);
          afterMove([]);
        }, { 'aria-label': 'Chemistry style' })));
    }
    for (const b of opts.toolbar || []) toolbar.appendChild(b);
  }

  function render() {
    renderToolbar();
    renderPitch();
    renderBench();
    renderManager();
    const chem = calcChemistryStyled(st.formation, st.slots.map(player), st.chemStyle);
    patchChemistry(chem);
    patchInfo(chem);
    renderPicker();
  }

  const onKey = (e) => { if (e.key === 'Escape' && st.sel) { const s0 = st.sel; st.sel = null; patchSlotCard(s0.area, s0.idx); closePicker(); } };
  root.addEventListener('keydown', onKey);
  render();
  return {
    el: root,
    set(state) {
      if (state.formation) st.formation = state.formation;
      if (state.slots) st.slots = state.slots.slice();
      if (state.bench && st.bench) st.bench = state.bench.slice();
      st.sel = null;
      render();
    },
    get() { return { formation: st.formation, slots: st.slots.slice(), bench: st.bench ? st.bench.slice() : null }; },
    render,
  };
}
