// Squad builder component: formation pitch with drag-and-drop / tap-to-place, bench, chemistry lines, picker.
import { h, clear, select, add } from './dom.js';
import { playerCard, emptyCard } from './card.js';
import { FORMATIONS, FORMATION_NAMES, positionFit, effectiveOvr } from '../core/formations.js';
import { calcChemistry, teamRating } from '../core/chemistry.js';
import { POS_GROUP, NATION_BY_CODE, leagueName } from '../core/data.js';

const POS_FILTERS = ['ALL', 'GK', 'DEF', 'MID', 'ATT'];
const CHEM_CLASS = ['c0', 'c1', 'c2', 'c3'];

/**
 * opts: {
 *   formation, slots: id[11], bench: id[7] | null,
 *   getPlayer(id), pool(): player[],
 *   onChange({formation, slots, bench}),
 *   chemistry: bool, allowFormation: bool,
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
    sel: null, // {area:'slot'|'bench', idx}
    q: '', group: 'AUTO', sort: 'ovr',
  };
  const root = h('div', { class: 'pm-sq' });
  const info = h('div', { class: 'pm-sq-info' });
  const pitchWrap = h('div', { class: 'pm-sq-pitchwrap' });
  const benchEl = h('div', { class: 'pm-sq-bench' });
  const picker = h('div', { class: 'pm-sq-picker', hidden: true });
  const toolbar = h('div', { class: 'pm-sq-toolbar' });
  const mainCol = h('div', { class: 'pm-sq-main' }, info, pitchWrap, st.bench ? h('div', { class: 'pm-sq-benchwrap' }, h('div', { class: 'pm-sq-label' }, 'Substitutes'), benchEl) : null);
  add(root, toolbar, h('div', { class: 'pm-sq-grid' }, mainCol, picker));

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
  }
  function swap(a, b) {
    const x = arr(a.area)[a.idx], y = arr(b.area)[b.idx];
    arr(a.area)[a.idx] = y || null; arr(b.area)[b.idx] = x || null;
  }

  function slotButton(area, idx) {
    const f = FORMATIONS[st.formation];
    const pos = area === 'slot' ? f.slots[idx].pos : 'SUB';
    const p = player(arr(area)[idx]);
    const selected = st.sel && st.sel.area === area && st.sel.idx === idx;
    const btn = h('button', {
      class: `pm-slot ${selected ? 'is-sel' : ''} ${p ? '' : 'is-empty'}`,
      'aria-label': p ? `${pos}: ${p.name} ${p.ovr}` : `Empty ${pos} slot`,
      'aria-pressed': selected ? 'true' : 'false',
      draggable: p ? 'true' : null,
      onclick: () => onSlotClick(area, idx),
    });
    btn.dataset.area = area; btn.dataset.idx = idx;
    if (p) {
      const card = playerCard(p, { size: 'xs', pos: area === 'slot' ? pos : p.pos, extra: opts.decorate ? opts.decorate(p) : null });
      if (area === 'slot' && positionFit(p, pos) === 0) card.classList.add('is-oop');
      btn.appendChild(card);
    } else btn.appendChild(emptyCard(pos));
    btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ area, idx })); e.dataTransfer.effectAllowed = 'move'; });
    btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.classList.add('is-drop'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('is-drop'));
    btn.addEventListener('drop', (e) => {
      e.preventDefault(); btn.classList.remove('is-drop');
      let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (d.pid) place({ area, idx }, d.pid); else if (d.area) swap(d, { area, idx });
      st.sel = null; render(); emit();
    });
    return btn;
  }

  function onSlotClick(area, idx) {
    if (!st.sel) { st.sel = { area, idx }; st.group = 'AUTO'; render(); focusPicker(); return; }
    if (st.sel.area === area && st.sel.idx === idx) { st.sel = null; render(); return; }
    swap(st.sel, { area, idx });
    st.sel = null; render(); emit();
  }
  function focusPicker() {
    setTimeout(() => {
      const s = picker.querySelector('.pm-sq-search');
      if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      else if (s) s.focus({ preventScroll: true });
    }, 30);
  }

  function renderInfo() {
    const slotsP = st.slots.map(player);
    const rating = teamRating(slotsP);
    const chem = calcChemistry(st.formation, slotsP);
    clear(info);
    add(info, 
      h('div', { class: 'pm-stat-chip' }, h('span', null, 'Rating'), h('b', null, rating || '–')),
      opts.chemistry !== false ? h('div', { class: 'pm-stat-chip' }, h('span', null, 'Chemistry'), h('b', null, `${chem.scaled}`), h('small', null, ` ${chem.total}/33`)) : null,
      h('div', { class: 'pm-stat-chip' }, h('span', null, 'Players'), h('b', null, `${slotsP.filter(Boolean).length}/11`)),
    );
    if (opts.onInfo) opts.onInfo({ rating, chem, slots: slotsP });
    return chem;
  }

  function renderPitch(chem) {
    const f = FORMATIONS[st.formation];
    clear(pitchWrap);
    const pitch = h('div', { class: 'pm-pitch' }, h('div', { class: 'pm-pitch-lines' }));
    if (opts.chemistry !== false) {
      const lines = chem.links.map((l) => {
        const a = f.slots[l.a], b = f.slots[l.b];
        return `<line x1="${a.x}" y1="${100 - a.y}" x2="${b.x}" y2="${100 - b.y}" class="ln-${l.color}"/>`;
      }).join('');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'pm-chemlines');
      svg.innerHTML = lines;
      pitch.appendChild(svg);
    }
    f.slots.forEach((s, i) => {
      const wrap = h('div', { class: 'pm-slotpos', style: { left: `${5 + s.x * 0.9}%`, top: `${6 + (100 - s.y) * 0.88}%` } }, slotButton('slot', i));
      const p = player(st.slots[i]);
      if (p && opts.chemistry !== false) {
        const c = chem.players[i];
        wrap.appendChild(h('div', { class: `pm-chempip ${CHEM_CLASS[c]}`, title: `Chemistry ${c}/3` }, String(c)));
      }
      pitch.appendChild(wrap);
    });
    pitchWrap.appendChild(pitch);
  }

  function renderBench() {
    if (!st.bench) return;
    clear(benchEl);
    st.bench.forEach((_, i) => benchEl.appendChild(slotButton('bench', i)));
  }

  function renderPicker() {
    if (!st.sel) { picker.hidden = true; clear(picker); return; }
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
        h('button', { class: 'pm-x', 'aria-label': 'Close picker', onclick: () => { st.sel = null; render(); } }, '×')),
      h('div', { class: 'pm-sq-filters' },
        search,
        h('div', { class: 'pm-chips' }, POS_FILTERS.map((g) => h('button', { class: `pm-chip ${group === g ? 'on' : ''}`, onclick: () => { st.group = g; renderPicker(); } }, g))),
        select([['ovr', 'Sort: Rating'], ['fit', 'Sort: Best fit'], ['name', 'Sort: Name']], st.sort, (v) => { st.sort = v; renderList(); }, { 'aria-label': 'Sort' })),
      current ? h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => { arr(st.sel.area)[st.sel.idx] = null; st.sel = null; render(); emit(); } }, 'Remove from slot') : null,
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
          onclick: () => { place(st.sel, p.id); st.sel = null; render(); emit(); },
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

  function renderToolbar() {
    clear(toolbar);
    if (opts.allowFormation !== false) {
      toolbar.appendChild(h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'Formation'),
        select(FORMATION_NAMES, st.formation, (v) => {
          st.formation = v; st.sel = null;
          render(); emit();
        }, { 'aria-label': 'Formation' })));
    }
    for (const b of opts.toolbar || []) toolbar.appendChild(b);
  }

  function render() {
    renderToolbar();
    const chem = renderInfo();
    renderPitch(chem);
    renderBench();
    renderPicker();
  }

  const onKey = (e) => { if (e.key === 'Escape' && st.sel) { st.sel = null; render(); } };
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
