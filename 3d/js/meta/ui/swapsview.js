// Swaps screen: exchange spare cards for coins or tokens, complete swap sets, spend tokens in the Token
// Store. Pure UI glue over core/swaps.js — reuses the existing card renderer (card.js) and modal/button
// classes, same as every other UT screen.
import { h, clear, add, fmtNum, confirmBox, select } from './dom.js';
import { playerCard } from './card.js';
import { icon } from './icons.js';
import * as UT from '../core/ut.js';
import * as SW from '../core/swaps.js';
import { POS_GROUP } from '../core/data.js';
import { PROMO_BY_ID } from '../core/promos.js';
import { playerModal, openPackFlow, utTabs } from './utview.js';
import { packArt } from './packopen.js';

const persist = (app) => app.saveUT();
const tokenLabel = (n) => `${n} token${n === 1 ? '' : 's'}`;

/** Token balance chip for the top bar (shown next to the coin chip via the view's `topRight` hook). */
function tokenChip(app) {
  const s = app.ut;
  return h('div', { class: 'pm-coins is-tokens', title: 'Swap tokens — spend them in the Token Store' },
    icon('swap'), h('span', { class: 'pm-coins-n' }, fmtNum(s.tokens || 0)), h('small', { class: 'pm-coins-src' }, 'Tokens'));
}

export function swapsView() {
  const ui = { tab: 'cards' };
  return {
    title: 'Swaps', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    topRight(app) { return tokenChip(app); },
    render(main, app) {
      main.appendChild(utTabs(app, 'swaps'));
      const tabs = h('div', { class: 'pm-tabs', role: 'tablist' },
        [['cards', 'Swap cards'], ['sets', 'Swap sets'], ['store', 'Token Store']].map(([id, label]) => h('button', {
          class: `pm-tab ${ui.tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(ui.tab === id),
          onclick: () => { ui.tab = id; app.refresh(); },
        }, label)));
      const body = h('div', { class: 'pm-tabbody', role: 'tabpanel' });
      add(main,
        h('p', { class: 'pm-lead' }, 'Swap spare cards for coins, or for tokens to spend in the Token Store below. Starting XI cards can’t be swapped; bench cards ask you to confirm first.'),
        tabs, body);
      if (ui.tab === 'sets') renderSwapSets(body, app);
      else if (ui.tab === 'store') renderTokenStore(body, app);
      else renderSwapCards(body, app);
    },
  };
}

// ---------------- Swap cards (one at a time) ----------------
function renderSwapCards(body, app) {
  const s = app.ut;
  const f = { q: '', group: 'ALL', sort: 'ovr' };
  const grid = h('div', { class: 'pm-cardgrid' });
  const count = h('span', { class: 'pm-dim' });
  const draw = () => {
    clear(grid);
    const starters = new Set(s.squad.slots.filter(Boolean));
    const bench = new Set(s.squad.bench.filter(Boolean));
    const q = f.q.trim().toLowerCase();
    let list = UT.clubPlayers(s).filter((p) => !starters.has(p.id) && !SW.isSwapHidden(p) && (!q || p.name.toLowerCase().includes(q)) && (f.group === 'ALL' || POS_GROUP[p.pos] === f.group));
    const sorters = { ovr: (a, b) => b.ovr - a.ovr, coins: (a, b) => SW.swapCoinValue(b) - SW.swapCoinValue(a), tokens: (a, b) => SW.swapTokenValue(b) - SW.swapTokenValue(a) };
    list.sort(sorters[f.sort]);
    count.textContent = `${list.length} eligible (starting XI and admin cards hidden)`;
    for (const p of list) {
      const tag = bench.has(p.id) ? h('div', { class: 'pm-cardtag' }, 'SUB') : null;
      grid.appendChild(playerCard(p, { size: 'sm', extra: tag, onClick: () => swapCardModal(app, p, draw) }));
    }
    if (!list.length) grid.appendChild(h('p', { class: 'pm-empty' }, 'No eligible cards (only your starting XI is off-limits).'));
  };
  const search = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search name…', 'aria-label': 'Search club' });
  search.addEventListener('input', () => { f.q = search.value; draw(); });
  add(body,
    h('div', { class: 'pm-filterbar' }, search,
      select([['ALL', 'All positions'], ['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['ATT', 'Attackers']], f.group, (v) => { f.group = v; draw(); }, { 'aria-label': 'Position' }),
      select([['ovr', 'Sort: Rating'], ['coins', 'Sort: Coin value'], ['tokens', 'Sort: Token value']], f.sort, (v) => { f.sort = v; draw(); }, { 'aria-label': 'Sort' }),
      count),
    grid);
  draw();
}

function swapCardModal(app, p, redraw) {
  const coins = SW.swapCoinValue(p);
  const tokens = SW.swapTokenValue(p);
  playerModal(app, p, {
    extra: [['Swap for coins', `${fmtNum(coins)} coins`], ['Swap for tokens', tokens ? tokenLabel(tokens) : 'Not eligible']],
    actions: [
      { label: `Swap for ${fmtNum(coins)} coins`, onClick: () => setTimeout(() => confirmSwap(app, p, redraw, 'coins'), 0) },
      { label: tokens ? `Swap for ${tokenLabel(tokens)}` : 'Not eligible for tokens', disabled: !tokens, onClick: () => setTimeout(() => confirmSwap(app, p, redraw, 'tokens'), 0) },
    ],
  });
}

async function confirmSwap(app, p, redraw, kind) {
  const s = app.ut;
  const chk = SW.checkSwappable(s, p.id);
  if (chk.needsConfirm) {
    const ok = await confirmBox(app.root, 'Swap card', `${p.name} is on your bench — swapping it will leave that slot empty until refilled. Continue?`, 'Swap anyway', true);
    if (!ok) return;
  }
  const r = kind === 'coins' ? SW.swapForCoins(s, p.id, { confirm: true }) : SW.swapForTokens(s, p.id, { confirm: true });
  if (!r.ok) { app.toast(r.error, 'bad'); return; }
  persist(app);
  app.toast(kind === 'coins' ? `+${fmtNum(r.coins)} coins` : `+${tokenLabel(r.tokens)}`, 'good');
  app.renderTop(app.stack[app.stack.length - 1]);
  app.refresh();
  redraw();
}

// ---------------- Swap sets (hand in N cards -> tokens) ----------------
function renderSwapSets(body, app) {
  add(body, h('div', { class: 'pm-sbcgrid' }, SW.SWAP_SETS.map((set) => h('button', {
    class: 'pm-sbc', onclick: () => app.push(swapSetDetailView(set.id)),
  }, h('div', { class: 'pm-sbc-top' }, h('h4', null, set.name)),
    h('p', null, set.desc),
    h('div', { class: 'pm-sbc-reward' }, h('span', { class: 'pm-dim' }, 'Reward'), h('b', null, tokenLabel(set.tokens)))))));
}

export function swapSetDetailView(setId) {
  const set = SW.SWAP_SET_BY_ID[setId];
  const chosen = [];
  return {
    title: set.name, kicker: 'Swap Set', coins: true, cls: 'pm-main--wide',
    topRight(app) { return tokenChip(app); },
    render(main, app) {
      const s = app.ut;
      const checklist = h('ul', { class: 'pm-checklist', 'aria-live': 'polite' });
      const submit = h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', disabled: true, onclick: doSubmit }, 'Submit');
      const grid = h('div', { class: 'pm-cardgrid' });
      const update = () => {
        const ev = SW.evaluateSwapSet(setId, chosen);
        clear(checklist);
        for (const c of ev.checks) checklist.appendChild(h('li', { class: c.ok ? 'ok' : 'no' }, h('i', { 'aria-hidden': 'true' }, c.ok ? '✓' : '✕'), h('span', null, c.label), c.cur ? h('b', null, String(c.cur)) : null));
        submit.disabled = !ev.ok;
      };
      const drawGrid = () => {
        clear(grid);
        const starters = new Set(s.squad.slots.filter(Boolean));
        const pool = UT.clubPlayers(s).filter((p) => !starters.has(p.id));
        for (const p of pool) {
          const on = chosen.includes(p.id);
          const tag = on ? h('div', { class: 'pm-cardtag pm-cardtag--ut' }, '✓') : null;
          grid.appendChild(playerCard(p, {
            size: 'xs', extra: tag, onClick: () => {
              if (on) chosen.splice(chosen.indexOf(p.id), 1);
              else if (chosen.length < set.count) chosen.push(p.id);
              else { app.toast(`Only ${set.count} players needed`, 'warn'); return; }
              drawGrid(); update();
            },
          }));
        }
      };
      async function doSubmit() {
        const bench = new Set(s.squad.bench.filter(Boolean));
        const inBench = chosen.filter((id) => bench.has(id)).length;
        const ok = await confirmBox(app.root, 'Submit swap set', `${chosen.length} players will be exchanged${inBench ? ` (${inBench} from your bench)` : ''} for ${tokenLabel(set.tokens)}.`, 'Submit');
        if (!ok) return;
        const r = SW.submitSwapSet(s, setId, chosen.slice(), { confirm: true });
        if (!r.ok) { app.toast(r.error, 'bad'); return; }
        persist(app);
        app.toast(`+${tokenLabel(r.tokens)}`, 'good');
        app.pop();
      }
      add(main, h('div', { class: 'pm-sbcdetail' },
        h('section', { class: 'pm-panel pm-sbcreq' },
          h('p', null, set.desc), h('h3', null, 'Requirements'), checklist,
          h('div', { class: 'pm-sbc-reward' }, h('span', { class: 'pm-dim' }, 'Reward'), h('b', null, tokenLabel(set.tokens))),
          submit, h('p', { class: 'pm-hint' }, 'Tap cards below to select or deselect them.')),
        grid));
      update(); drawGrid();
    },
  };
}

// ---------------- Token Store ----------------
function renderTokenStore(body, app) {
  const s = app.ut;
  const listing = SW.tokenStoreListing();
  if (!listing.length) { add(body, h('div', { class: 'pm-empty-state' }, h('p', null, 'No packs are available in the Token Store right now.'))); return; }
  add(body, h('div', { class: 'pm-storegrid' }, listing.map(({ pack, tokens }) => {
    const canBuy = (s.tokens || 0) >= tokens;
    return h('div', { class: `pm-storeitem ${pack.promo ? `is-promo pm-promo--${pack.promo}` : ''}`, style: pack.promo ? { '--pa': PROMO_BY_ID[pack.promo].colors[0], '--pb': PROMO_BY_ID[pack.promo].colors[1], '--pc': PROMO_BY_ID[pack.promo].colors[2] } : null },
      packArt(pack, 'md'),
      h('div', { class: 'pm-storeinfo' }, h('h4', null, pack.name), h('p', { class: 'pm-dim' }, pack.desc),
        h('div', { class: 'pm-price' }, icon('swap'), ` ${tokenLabel(tokens)}`),
        h('button', {
          class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: !canBuy,
          onclick: async () => {
            if (!(await confirmBox(app.root, 'Buy pack', `Buy ${pack.name} for ${tokenLabel(tokens)}?`, 'Buy & open'))) return;
            const r = SW.buyPackWithTokens(s, pack.id);
            if (!r.ok) { app.toast(r.error, 'bad'); return; }
            persist(app);
            app.renderTop(app.stack[app.stack.length - 1]);
            openPackFlow(app, pack.id);
          },
        }, 'Buy & open')));
  })));
}
