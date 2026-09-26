// UT Transfer Market: two completely separate markets.
//  - Player Market: real users' listings via online.market.* (core/pmarket.js).
//  - AI Market: the simulated market (core/ut.js marketSearch/buyListing) — offline friendly.
import { h, clear, modal, confirmBox, fmtNum, select, add } from './dom.js';
import { playerCard } from './card.js';
import * as UT from '../core/ut.js';
import * as PM from '../core/pmarket.js';
import { getPlayer } from '../core/players.js';
import { NATIONS, NATION_BY_CODE, LEAGUES, leagueName, POSITIONS } from '../core/data.js';
import { playerModal } from './utview.js';
import { setFlag } from '../core/objectives.js';

const persist = (app) => app.saveUT();
const isTop = (app, view) => app.stack[app.stack.length - 1] === view;
const RARITIES = [['', 'Any rarity'], ['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze'], ['rare', 'Rare'], ['lotg', 'Legends of the Game'], ['special', 'Any special']];
const STATUS_LABEL = { active: 'Active', sold: 'Sold', expired: 'Expired', pending: 'Pending' };

function metaLine(p) {
  const n = NATION_BY_CODE[p.nat];
  return `${p.pos} · ${n ? n.name : p.nat} · ${leagueName(p.league)}`;
}
function priceTag(v) { return h('div', { class: 'pm-price' }, h('i', { class: 'pm-coin', 'aria-hidden': 'true' }), fmtNum(v)); }
function ago(ts) {
  const t = Number(ts) || (ts ? Date.parse(ts) : 0);
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function marketView() {
  const ui = {
    tab: 'player',
    pm: { status: null, sub: 'search', f: { q: '', pos: '', rarity: '', minOvr: 0, maxPrice: 0, sort: 'price_asc', page: 0 }, results: null, loading: false, mine: null, mineLoading: false },
    ai: { f: { name: '', pos: '', tier: '', nat: '', league: '', minOvr: 0, maxOvr: 99, maxPrice: 0, seed: 0 }, results: null },
  };
  const view = {
    title: 'Transfer Market', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const tabs = h('div', { class: 'pm-tabs pm-mkttabs', role: 'tablist' },
        [['player', 'Player Market', 'Online · real users'], ['ai', 'AI Market', 'Simulated traders']].map(([id, label, sub]) => h('button', {
          class: `pm-tab ${ui.tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': ui.tab === id ? 'true' : 'false',
          onclick: () => { ui.tab = id; app.refresh(); },
        }, h('b', null, label), h('small', null, sub))));
      const body = h('div', { class: 'pm-tabbody', role: 'tabpanel' });
      add(main, tabs, body);
      if (ui.tab === 'player') renderPlayerMarket(body, app, ui.pm, view);
      else renderAiMarket(body, app, ui.ai);
    },
  };
  return view;
}

// ---------------- Player Market (online) ----------------
function renderPlayerMarket(body, app, st, view) {
  const s = app.ut;
  if (st.status === null) {
    st.status = 'checking';
    app.onlineAvailable().then((ok) => { st.status = ok && app.online && app.online.market ? 'online' : 'offline'; if (isTop(app, view)) app.refresh(); });
  }
  if (st.status === 'checking') { add(body, h('div', { class: 'pm-empty pm-loading' }, h('div', { class: 'pm-spinner' }), 'Connecting to the Player Market…')); return; }
  if (st.status === 'offline') {
    add(body, h('section', { class: 'pm-panel pm-offline' },
      h('div', { class: 'pm-offline-ico', 'aria-hidden': 'true' }, '⇄'),
      h('h3', null, 'Online market unavailable'),
      h('p', { class: 'pm-dim' }, 'The Player Market trades cards with real users and needs an online connection. The AI Market still works offline.'),
      h('div', { class: 'pm-btnrow' },
        h('button', { class: 'pm-btn pm-btn--primary', onclick: () => { st.status = null; app.refresh(); } }, 'Try again'),
        h('button', { class: 'pm-btn', onclick: () => { const t = view; app.stack[app.stack.length - 1] = t; app.main.querySelectorAll('.pm-mkttabs .pm-tab')[1].click(); } }, 'Open AI Market'))));
    return;
  }
  const listedN = (s.listed || []).length;
  const sub = h('div', { class: 'pm-subtabs' },
    [['search', 'Search'], ['mine', `My listings${listedN ? ` (${listedN})` : ''}`]].map(([id, label]) => h('button', {
      class: `pm-chip ${st.sub === id ? 'on' : ''}`, 'aria-pressed': st.sub === id ? 'true' : 'false', onclick: () => { st.sub = id; if (id === 'mine') st.mine = null; app.refresh(); },
    }, label)),
    h('button', { class: 'pm-btn pm-btn--accent pm-btn--sm', onclick: () => listPickerModal(app, () => { st.mine = null; if (isTop(app, view)) app.refresh(); }) }, '+ List a card'),
    h('span', { class: 'pm-dim pm-subnote' }, `Buying uses your ${app.coinSourceLabel()} · 5% tax on sales`));
  add(body, sub);
  if (st.sub === 'mine') renderMine(body, app, st, view);
  else renderSearch(body, app, st, view);
}

function renderSearch(body, app, st, view) {
  const s = app.ut;
  const f = st.f;
  const list = h('div', { class: 'pm-mktlist', 'aria-live': 'polite' });
  const run = async () => {
    const seq = (st.seq = (st.seq || 0) + 1); // only the latest search may draw (no stale / doubled results)
    st.loading = true; drawList();
    const q = { q: f.q.trim(), pos: f.pos, minOvr: f.minOvr || 0, maxPrice: f.maxPrice || 0, rarity: f.rarity, sort: f.sort, page: f.page };
    const r = await PM.searchMarket(app.online, q);
    if (seq !== st.seq) return;
    st.loading = false;
    if (!isTop(app, view)) return;
    if (!r.ok) { st.results = []; app.toast(r.error || 'Search failed', 'bad'); } else st.results = r.items;
    drawList();
  };
  const mineIds = new Set((s.listed || []).map((l) => l.listingId));
  function drawList() {
    clear(list);
    if (st.loading) { list.appendChild(h('div', { class: 'pm-empty pm-loading' }, h('div', { class: 'pm-spinner' }), 'Searching…')); return; }
    if (!st.results) { list.appendChild(h('p', { class: 'pm-empty' }, 'Search real users’ listings. Set filters and press Search.')); return; }
    if (!st.results.length) list.appendChild(h('p', { class: 'pm-empty' }, 'No listings found. Try broader filters.'));
    for (const it of st.results) {
      const p = getPlayer(it.card.id) || it.card;
      const owned = s.club.includes(it.card.id);
      const own = mineIds.has(it.listingId);
      const noCoins = s.coins < it.price;
      list.appendChild(h('div', { class: 'pm-mktrow' },
        safeCard(p, () => playerModal(app, p)),
        h('div', { class: 'pm-mkt-info' }, h('b', null, p.name), h('span', { class: 'pm-dim' }, metaLine(p)),
          h('small', { class: 'pm-dim' }, `Seller: ${String(it.seller || 'Unknown').slice(0, 24)}${it.listedAt ? ` · listed ${ago(it.listedAt)}` : ''}`)),
        priceTag(it.price),
        h('button', {
          class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: owned || own || noCoins,
          title: own ? 'Your own listing' : owned ? 'Already in your club' : noCoins ? 'Not enough coins' : '',
          onclick: async (e) => {
            if (!(await confirmBox(app.root, 'Buy Now', `Buy ${p.name} for ${fmtNum(it.price)} coins from ${String(it.seller || 'another manager').slice(0, 24)}?`, 'Buy'))) return;
            e.target.disabled = true;
            const r = await PM.buyListing(s, app.online, it);
            if (!r.ok) { app.toast(r.error, 'bad'); e.target.disabled = false; return; }
            if (Number.isFinite(r.coins) && typeof app.setOnlineBalance === 'function') app.setOnlineBalance(r.coins);
            persist(app);
            await app.refreshOnlineCoins();
            st.results = st.results.filter((x) => x.listingId !== it.listingId);
            app.toast(`${p.name} joined your club!`, 'good');
            if (isTop(app, view)) drawList();
          },
        }, own ? 'Yours' : owned ? 'Owned' : 'Buy Now')));
    }
    if (st.results.length || f.page > 0) {
      list.appendChild(h('div', { class: 'pm-pager' },
        h('button', { class: 'pm-btn pm-btn--sm', disabled: f.page <= 0, onclick: () => { f.page--; run(); } }, '‹ Prev'),
        h('span', { class: 'pm-dim' }, `Page ${f.page + 1}`),
        h('button', { class: 'pm-btn pm-btn--sm', disabled: st.results.length < 20, onclick: () => { f.page++; run(); } }, 'Next ›')));
    }
  }
  const q = h('input', { class: 'pm-input', type: 'search', placeholder: 'Player name', value: f.q, 'aria-label': 'Player name' });
  q.addEventListener('input', () => { f.q = q.value; });
  const num = (key, label) => { const i = h('input', { class: 'pm-input pm-input--num', type: 'number', min: '0', value: String(f[key] || ''), placeholder: label, 'aria-label': label }); i.addEventListener('input', () => { f[key] = Number(i.value) || 0; }); return i; };
  add(body,
    h('form', { class: 'pm-filterbar pm-mktform', onsubmit: (e) => { e.preventDefault(); setFlag(s, 'marketSearch'); f.page = 0; run(); } },
      q,
      select([['', 'Any position'], ...POSITIONS.map((p) => [p, p])], f.pos, (v) => { f.pos = v; }, { 'aria-label': 'Position' }),
      select(RARITIES, f.rarity, (v) => { f.rarity = v; }, { 'aria-label': 'Rarity' }),
      num('minOvr', 'Min OVR'), num('maxPrice', 'Max price'),
      select([['price_asc', 'Price: low → high'], ['price_desc', 'Price: high → low'], ['ovr_desc', 'Rating: high → low'], ['newest', 'Newest']], f.sort, (v) => { f.sort = v; }, { 'aria-label': 'Sort' }),
      h('button', { class: 'pm-btn pm-btn--primary', type: 'submit' }, 'Search')),
    list);
  drawList();
}

function renderMine(body, app, st, view) {
  const s = app.ut;
  const box = h('div', { class: 'pm-mktlist' });
  add(body, box);
  const load = async () => {
    st.mineLoading = true; draw();
    const seq = (st.mineSeq = (st.mineSeq || 0) + 1);
    const r = await PM.fetchMine(s, app.online);
    if (seq !== st.mineSeq) return;
    st.mineLoading = false;
    if (!isTop(app, view)) return;
    if (!r.ok) { app.toast(r.error, 'bad'); st.mine = []; } else {
      st.mine = r.items; persist(app);
      if (r.sold && r.sold.length) { app.toast(`${r.sold.length} of your listing${r.sold.length > 1 ? 's' : ''} sold — coins already added.`, 'good'); app.refreshOnlineCoins(); }
    }
    draw();
  };
  function draw() {
    clear(box);
    if (st.mineLoading || !st.mine) { box.appendChild(h('div', { class: 'pm-empty pm-loading' }, h('div', { class: 'pm-spinner' }), 'Loading your listings…')); return; }
    const serverIds = new Set(st.mine.map((x) => x.listingId));
    const rows = st.mine.slice();
    for (const l of s.listed || []) if (!serverIds.has(l.listingId)) rows.push({ listingId: l.listingId, card: getPlayer(l.pid), price: l.price, status: 'pending', listedAt: l.listedAt });
    const sold = rows.filter((r) => r.status === 'sold');
    const claimable = sold.reduce((a, r) => a + PM.afterTax(r.price), 0);
    box.appendChild(h('section', { class: 'pm-panel pm-claimbar' },
      h('div', null, h('b', null, `${rows.filter((r) => r.status === 'active').length} active · ${sold.length} sold · ${rows.filter((r) => r.status === 'expired').length} expired`),
        h('small', { class: 'pm-dim' }, 'Listed cards leave your club until sold or cancelled. Sale proceeds (minus 5% tax) are claimed to your online balance.')),
      h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => { st.mine = null; load(); } }, '↻ Refresh'),
      h('button', {
        class: 'pm-btn pm-btn--accent', disabled: !sold.length,
        onclick: async () => {
          const r = await PM.claimSales(s, app.online);
          if (!r.ok) { app.toast(r.error, 'warn'); return; }
          persist(app);
          await app.refreshOnlineCoins();
          app.toast(`Claimed ${fmtNum(r.coins || claimable)} coins from sales.`, 'good');
          st.mine = null; load();
        },
      }, sold.length ? `Claim ${fmtNum(claimable)} coins` : 'Nothing to claim')));
    if (!rows.length) { box.appendChild(h('p', { class: 'pm-empty' }, 'You have no listings. Use “+ List a card” or open a player in your Club.')); return; }
    for (const it of rows) {
      const p = it.card ? (getPlayer(it.card.id) || it.card) : null;
      if (!p) continue;
      const status = it.status || 'active';
      box.appendChild(h('div', { class: `pm-mktrow is-${status}` },
        safeCard(p, () => playerModal(app, p)),
        h('div', { class: 'pm-mkt-info' }, h('b', null, p.name), h('span', { class: 'pm-dim' }, metaLine(p)),
          h('small', { class: 'pm-dim' }, status === 'sold' ? `Sold${it.buyer ? ` to ${String(it.buyer).slice(0, 24)}` : ''} · you receive ${fmtNum(PM.afterTax(it.price))}` : `Listed ${ago(it.listedAt)}`)),
        h('div', { class: 'pm-mkt-side' }, h('span', { class: `pm-status s-${status}` }, STATUS_LABEL[status] || status), priceTag(it.price)),
        status === 'sold' ? h('span', { class: 'pm-dim pm-mkt-gap' }, '') : h('button', {
          class: 'pm-btn pm-btn--sm',
          onclick: async (e) => {
            e.target.disabled = true;
            const r = await PM.cancelListing(s, app.online, it.listingId);
            if (!r.ok) { app.toast(r.error, 'bad'); e.target.disabled = false; return; }
            persist(app);
            app.toast(`${p.name} returned to your club.`, 'good');
            st.mine = null; if (isTop(app, view)) { app.refresh(); }
          },
        }, status === 'expired' ? 'Return to club' : 'Cancel')));
    }
  }
  if (!st.mine && !st.mineLoading) load(); else draw();
}

function safeCard(p, onClick) {
  try { return playerCard(p, { size: 'xs', onClick }); } catch { return h('div', { class: 'pm-card pm-card--xs pm-card--empty' }); }
}

/** Pick a tradeable club card to list. */
function listPickerModal(app, done) {
  const s = app.ut;
  const cards = UT.clubPlayers(s).filter((p) => PM.isTradeable(s, p.id)).sort((a, b) => b.ovr - a.ovr);
  let close = null;
  const grid = h('div', { class: 'pm-cardgrid pm-pickgrid' }, cards.length ? cards.slice(0, 80).map((p) => playerCard(p, { size: 'sm', onClick: () => { close(); setTimeout(() => playerMarketListModal(app, p, done), 0); } }))
    : h('p', { class: 'pm-empty' }, 'No tradeable cards in your club.'));
  close = modal(app.root, { title: 'List a card on the Player Market', wide: true, body: h('div', null, h('p', { class: 'pm-dim' }, 'Untradeable cards (SBC / admin rewards) are hidden.'), grid), actions: [{ label: 'Close' }] });
}

/** Price a card and list it for real users. */
export function playerMarketListModal(app, p, done) {
  const s = app.ut;
  if (!PM.isTradeable(s, p.id)) { app.toast('This card is untradeable.', 'warn'); return; }
  const range = PM.priceRange(p);
  let price = PM.suggestedPrice(p);
  const input = h('input', { class: 'pm-input', type: 'number', min: String(range.min), max: String(range.max), step: String(PM.priceStep(price)), value: String(price), 'aria-label': 'Buy Now price' });
  const recv = h('b', null);
  const upd = () => { price = PM.clampPrice(p, input.value); recv.textContent = `${fmtNum(PM.afterTax(price))} coins`; };
  input.addEventListener('input', () => { const v = Number(input.value) || 0; recv.textContent = `${fmtNum(PM.afterTax(Math.min(range.max, Math.max(range.min, v))))} coins`; });
  input.addEventListener('change', () => { upd(); input.value = String(price); });
  upd();
  const inSquad = s.squad.slots.concat(s.squad.bench).includes(p.id);
  modal(app.root, {
    title: `Player Market — list ${p.name}`,
    body: h('div', { class: 'pm-form pm-listform' },
      h('div', { class: 'pm-listcard' }, playerCard(p, { size: 'sm' }),
        h('div', null,
          h('p', null, 'Real managers can buy this card. It leaves your club until it sells or you cancel the listing.'),
          h('p', { class: 'pm-dim' }, `Allowed price for a ${p.ovr}${p.special ? ` ${UT.SPECIAL_NAME[p.special]}` : ''}: ${fmtNum(range.min)} – ${fmtNum(range.max)} coins.`),
          inSquad ? h('p', { class: 'pm-warnline' }, 'This player is in your squad and will be removed from it.') : null)),
      h('label', null, h('span', null, 'Buy Now price'), input),
      h('div', { class: 'pm-taxline' }, h('span', { class: 'pm-dim' }, 'After 5% market tax you receive'), recv)),
    actions: [{ label: 'Cancel' }, { label: 'List card', primary: true, onClick: () => {
      upd();
      (async () => {
        if (!app.online) { app.toast('Online market unavailable', 'bad'); return; }
        const r = await PM.listCard(s, app.online, p.id, price);
        if (!r.ok) { app.toast(r.error, 'bad'); return; }
        persist(app);
        app.toast(`${p.name} listed for ${fmtNum(price)} coins.`, 'good');
        if (done) done();
      })();
    } }],
  });
}

// ---------------- AI Market (simulated) ----------------
function renderAiMarket(body, app, st) {
  const s = app.ut;
  const f = st.f;
  const list = h('div', { class: 'pm-mktlist' });
  const drawList = () => {
    clear(list);
    if (!st.results) { list.appendChild(h('p', { class: 'pm-empty' }, 'Set your filters and search the AI market.')); return; }
    if (!st.results.length) { list.appendChild(h('p', { class: 'pm-empty' }, 'No listings found. Try broader filters.')); return; }
    for (const l of st.results) {
      const p = getPlayer(l.pid);
      const owned = s.club.includes(l.pid);
      list.appendChild(h('div', { class: 'pm-mktrow' },
        playerCard(p, { size: 'xs', onClick: () => playerModal(app, p) }),
        h('div', { class: 'pm-mkt-info' }, h('b', null, p.name), h('span', { class: 'pm-dim' }, metaLine(p)), h('small', { class: 'pm-dim' }, `AI trader · ends in ${l.mins} min`)),
        priceTag(l.price),
        h('button', {
          class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: owned || s.coins < l.price,
          onclick: async () => {
            if (!(await confirmBox(app.root, 'Buy Now (AI Market)', `Buy ${p.name} for ${fmtNum(l.price)} coins from an AI trader?`, 'Buy'))) return;
            try { UT.buyListing(s, l); persist(app); app.toast(`${p.name} joined your club!`, 'good'); st.results = st.results.filter((x) => x !== l); app.topRefresh(); drawList(); } catch (e) { app.toast(e.message, 'bad'); }
          },
        }, owned ? 'Owned' : 'Buy Now')));
    }
  };
  const name = h('input', { class: 'pm-input', type: 'search', placeholder: 'Player name', value: f.name, 'aria-label': 'Player name' });
  name.addEventListener('input', () => { f.name = name.value; });
  const num = (key, label, min, max) => { const i = h('input', { class: 'pm-input pm-input--num', type: 'number', min: String(min), max: String(max), value: String(f[key] || ''), placeholder: label, 'aria-label': label }); i.addEventListener('input', () => { f[key] = Number(i.value) || 0; }); return i; };
  add(body,
    h('div', { class: 'pm-ainote' }, h('span', { class: 'pm-chip on' }, 'AI'), h('span', { class: 'pm-dim' }, `Simulated market with computer traders — separate from the Player Market. Uses your ${app.coinSourceLabel()}.`)),
    h('form', { class: 'pm-filterbar pm-mktform', onsubmit: (e) => { e.preventDefault(); setFlag(s, 'marketSearch'); f.seed++; st.results = UT.marketSearch({ ...f, maxOvr: f.maxOvr || 99 }, `${Date.now() >> 16}-${f.seed}`); drawList(); } },
      name,
      select([['', 'Any position'], ...POSITIONS.map((p) => [p, p])], f.pos, (v) => { f.pos = v; }, { 'aria-label': 'Position' }),
      select([['', 'Any quality'], ['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze'], ['rare', 'Rare'], ['lotg', 'Legends of the Game'], ['special', 'Special']], f.tier, (v) => { f.tier = v; }, { 'aria-label': 'Quality' }),
      select([['', 'Any nation'], ...NATIONS.map((n) => [n.code, n.name])], f.nat, (v) => { f.nat = v; }, { 'aria-label': 'Nation' }),
      select([['', 'Any league'], ...LEAGUES.map((l) => [l.id, l.name]), ['ICN', 'Legends of the Game']], f.league, (v) => { f.league = v; }, { 'aria-label': 'League' }),
      num('minOvr', 'Min OVR', 40, 99), num('maxOvr', 'Max OVR', 40, 99), num('maxPrice', 'Max price', 0, 100000000),
      h('button', { class: 'pm-btn pm-btn--primary', type: 'submit' }, 'Search')),
    list);
  drawList();
}
