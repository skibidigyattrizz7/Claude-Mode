// Admin panel + "Admin Given Codes" entry. Levels come from the shared verifier `3d/js/shared/adminauth.js`
// (server-verified code, else local PBKDF2 — the code itself is never stored — or an owner/mod account role):
// 'super' (everything + admin cards to 999 OVR) > 'full' (owner tools) > 'mod' (moderation) > 'temp' (60 min, limited).
import { h, clear, add, fmtNum, modal, confirmBox, select } from './dom.js';
import { playerCard } from './card.js';
import * as UT from '../core/ut.js';
import * as C from '../core/career.js';
import * as A from '../core/admin.js';
import * as AA from '../shared/adminauth.js';
import { getDB } from '../core/players.js';
import { remove as removeKey } from '../core/storage.js';
import { safeCall } from './app.js';
import { openPackFlow } from './utview.js';
import { icon } from './icons.js';
import * as X from './adminextra.js';

const LEVEL_NAME = { super: 'Super Admin', full: 'Admin', mod: 'Moderator', temp: 'Temporary admin' };
const RANK = AA.ADMIN_RANK;
/** What a level may use in this panel (finer-grained than adminauth's own caps, but consistent with them). */
function can(x, level) {
  const r = RANK[level] || 0;
  if (x === 'moderation') return r >= 2;
  if (x === 'owner') return r >= 3; // full / super: sbc, career cheats, reset, infinite coins, broadcast, giveaways, config
  if (x === 'super') return level === 'super'; // card creator / admin cards / OVR > 99
  return r >= 1; // coins, packs, grant — every level, capped for mod/temp
}
const mmss = (ms) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
/** Local-only coin add, capped per grant (owner levels: unlimited; mod/temp: 1,000,000). */
function addLocalCoinsClamped(state, amount, level) {
  const cap = (RANK[level] || 0) >= 3 ? Infinity : 1000000;
  const v = Math.max(0, Math.min(Math.round(Number(amount) || 0), cap));
  state.coins = Math.max(0, (state.coins || 0) + v);
  return v;
}

/** Meta hub entry (replaces the old tiny footer link): opens the Admin Given Codes screen or the panel. */
export function adminButton(app) {
  AA.bindOnline(app.online);
  const lv = AA.getAdminLevel();
  return h('button', { class: 'pm-btn pm-btn--ghost pm-codesbtn', onclick: () => app.push(lv ? adminView() : adminCodesView()) },
    icon('key'), lv ? ' Admin panel' : ' Admin Given Codes');
}

/**
 * "Admin Given Codes" panel: text field + Submit. Wrong code -> "Invalid code"; 5 wrong attempts lock the field for 60 s.
 * onUnlock(level) defaults to opening the Admin panel.
 */
export function adminCodesPanel(app, { onUnlock = null, compact = false } = {}) {
  const input = h('input', { class: 'pm-input pm-codes-input', type: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: '128', 'aria-label': 'Admin given code', placeholder: 'Enter an admin given code', 'data-codes': 'input' });
  const btn = h('button', { class: 'pm-btn pm-btn--primary', type: 'submit', 'data-codes': 'submit' }, 'Submit');
  const msg = h('p', { class: 'pm-dim pm-codes-msg', 'aria-live': 'polite', 'data-codes': 'msg' }, compact ? '' : 'Have a code from the owner? Enter it here.');
  let busy = false, timer = 0;
  const lockTick = () => {
    const ms = AA.lockRemainingMs();
    const locked = ms > 0;
    input.disabled = locked || busy; btn.disabled = locked || busy;
    if (locked) { msg.textContent = `Too many attempts. Try again in ${Math.ceil(ms / 1000)} s.`; msg.className = 'pm-warnline pm-codes-msg'; }
    else if (timer) { clearInterval(timer); timer = 0; msg.textContent = 'You can try again.'; msg.className = 'pm-dim pm-codes-msg'; }
    return locked;
  };
  const startLockTimer = () => { if (!timer && lockTick()) { timer = setInterval(lockTick, 500); app.onCleanup(() => clearInterval(timer)); } };
  const submit = async (e) => {
    e.preventDefault();
    if (busy || lockTick()) return;
    busy = true; input.disabled = true; btn.disabled = true;
    msg.textContent = 'Checking…'; msg.className = 'pm-dim pm-codes-msg';
    AA.bindOnline(app.online);
    const r = await AA.verifyAdminCode(input.value, app.online);
    busy = false; input.value = ''; input.disabled = false; btn.disabled = false;
    if (!r.ok) {
      msg.textContent = r.error; msg.className = 'pm-warnline pm-codes-msg';
      if (r.locked) { setTimeout(startLockTimer, 1200); } else input.focus();
      return;
    }
    msg.textContent = `${LEVEL_NAME[r.level]} unlocked.`; msg.className = 'pm-goodline pm-codes-msg';
    app.toast(r.level === 'temp' ? 'Temporary admin unlocked for 60 minutes.' : 'Admin unlocked for this session.', 'good');
    if (onUnlock) onUnlock(r.level); else app.push(adminView());
  };
  const form = h('form', { class: 'pm-codes-form', onsubmit: submit }, input, btn);
  startLockTimer();
  return h('section', { class: `pm-panel pm-codes ${compact ? 'is-compact' : ''}`, 'data-codes': 'panel' },
    h('div', { class: 'pm-codes-head' }, icon('key', 'pm-codes-ico'), h('h3', null, 'Admin Given Codes')),
    form, msg);
}

export function adminCodesView() {
  return {
    title: 'Admin Given Codes', kicker: 'Pitchside', coins: true,
    render(main, app) {
      AA.bindOnline(app.online);
      const lv = AA.getAdminLevel();
      add(main, h('p', { class: 'pm-lead' }, 'Codes are handed out by the owner. A valid code unlocks the Admin panel for this browser session.'),
        lv ? h('p', { class: 'pm-goodline' }, `${LEVEL_NAME[lv]} is active.`, ' ', h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', onclick: () => app.replace(adminView()) }, 'Open Admin panel')) : null,
        adminCodesPanel(app, { onUnlock: () => app.replace(adminView()) }));
    },
  };
}

/** Visible badge in the UT hub while admin is active (countdown for temporary admin, crown for the owner account). */
export function adminBadge(app) {
  AA.bindOnline(app.online);
  const level = AA.getAdminLevel();
  if (!level) return null;
  let role = null;
  try { const c = app.online && app.online.account && typeof app.online.account.current === 'function' ? app.online.account.current() : null; role = c && c.state === 'account' ? c.role : null; } catch { /* ignore */ }
  const owner = role === 'owner' && (level === 'full' || level === 'super');
  const label = h('span', { class: 'pm-adminbadge-t' });
  const draw = () => {
    const lv = AA.getAdminLevel();
    if (!lv) { app.toast('Temporary admin expired.', 'warn'); app.refresh(); return false; }
    label.textContent = owner ? 'OWNER' : lv === 'super' ? 'SUPER' : lv === 'mod' ? 'MOD' : lv === 'temp' ? `Temp admin · ${mmss(AA.tempRemainingMs())}` : 'Admin';
    return true;
  };
  draw();
  if (level === 'temp') { const t = setInterval(() => { if (!draw()) clearInterval(t); }, 1000); app.onCleanup(() => clearInterval(t)); }
  return h('button', { class: `pm-adminbadge lv-${level} ${owner ? 'is-owner' : ''}`, 'data-admin-badge': level, title: 'Open the Admin panel', onclick: () => app.push(adminView()) },
    owner ? icon('crown', 'pm-crown') : icon('admin'),
    label);
}

export function adminView() {
  const st = { q: '', q2: '', slot: null, amount: 100000, budget: 250000000, tab: 'tools' };
  const view = {
    title: 'Admin', kicker: 'Owner tools', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      AA.bindOnline(app.online);
      const level = AA.getAdminLevel();
      if (!level) { app.replace(adminCodesView()); return; }
      const s = app.ut;
      const needUT = s ? null : h('p', { class: 'pm-warnline' }, 'Create an Ultimate Team club first to use the UT tools.');
      const done = (msg) => { if (s) app.saveUT(); app.toast(msg, 'good'); app.refresh(); };

      // ---- coins ----
      const amt = h('input', { class: 'pm-input pm-input--num', type: 'number', value: String(st.amount), 'aria-label': 'Coin amount' });
      amt.addEventListener('input', () => { st.amount = Math.round(Number(amt.value) || 0); });
      const inf = !!(s && s.admin && s.admin.infinite);
      const limited = !can('owner', level);
      const coinsLimited = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('coins'), ' Coins'),
        h('p', { class: 'pm-dim' }, s ? `Local balance: ${fmtNum(app.wallet.mode === 'online' ? (app.wallet.local || 0) : s.coins)}. Up to ${(RANK[level] || 0) >= 3 ? 'unlimited' : fmtNum(1000000)} coins per grant.` : ''),
        h('div', { class: 'pm-btnrow' }, amt,
          h('button', { class: 'pm-btn pm-btn--primary', disabled: !s || inf, onclick: () => {
            if (app.wallet.mode === 'online') { const tmp = { coins: app.wallet.local || 0 }; const v = addLocalCoinsClamped(tmp, st.amount, level); app.wallet.local = tmp.coins; done(`Added ${fmtNum(v)} local coins.`); }
            else { const v = addLocalCoinsClamped(s, st.amount, level); done(`Added ${fmtNum(v)} coins.`); }
          } }, 'Add coins')));
      const coins = limited ? coinsLimited : h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('coins'), ' Coins'),
        h('p', { class: 'pm-dim' }, s ? `Shown balance: ${inf ? '∞' : fmtNum(s.coins)} (${app.coinSourceLabel()}).${app.wallet.mode === 'online' ? ` Local balance: ${fmtNum(app.wallet.local || 0)}.` : ''}` : ''),
        h('div', { class: 'pm-btnrow' }, amt,
          h('button', { class: 'pm-btn', disabled: !s || inf, onclick: () => { if (app.wallet.mode === 'online') app.wallet.local = Math.max(0, st.amount); else s.coins = Math.max(0, st.amount); done('Local coins set.'); } }, 'Set local'),
          h('button', { class: 'pm-btn', disabled: !s || inf, onclick: () => { if (app.wallet.mode === 'online') app.wallet.local = Math.max(0, (app.wallet.local || 0) + st.amount); else s.coins = Math.max(0, s.coins + st.amount); done('Local coins added.'); } }, 'Add local'),
          h('button', {
            class: 'pm-btn pm-btn--primary', disabled: !app.online || !app.online.coins || app.wallet.mode !== 'online', title: app.wallet.mode === 'online' ? '' : 'Online services are offline',
            onclick: async () => {
              const r = await safeCall(() => app.online.coins.add(st.amount, 'admin'), { ok: false });
              if (!r || r.ok === false) { app.toast(`Online add failed${r && r.error ? `: ${r.error}` : ''}`, 'bad'); return; }
              await app.initWallet(true); await app.refreshOnlineCoins();
              app.toast(`Added ${fmtNum(st.amount)} to the online balance.`, 'good'); app.refresh();
            },
          }, 'Add to online balance')),
        h('label', { class: 'pm-toggle' }, h('input', {
          type: 'checkbox', checked: inf, disabled: !s,
          onchange: (e) => {
            s.admin = s.admin || {};
            if (e.target.checked) { s.admin.stash = app.wallet.mode === 'online' ? null : s.coins; s.admin.infinite = true; }
            else { s.admin.infinite = false; s.coins = app.wallet.mode === 'online' ? app.wallet.synced : (s.admin.stash ?? 10000); delete s.admin.stash; }
            done(e.target.checked ? 'Infinite coins on (nothing is charged or synced).' : 'Infinite coins off.');
          },
        }), h('span', null, 'Infinite coins (UT)')));

      // ---- packs ----
      const packs = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('chest'), ' Open any pack for free'),
        h('div', { class: 'pm-btnrow pm-wrap' }, UT.PACKS.map((pk) => h('button', { class: 'pm-btn pm-btn--sm', disabled: !s, onclick: () => openPackFlow(app, pk.id) }, pk.name))));

      // ---- grant player ----
      const results = h('div', { class: 'pm-admin-results' });
      const drawResults = () => {
        clear(results);
        const q = st.q.trim().toLowerCase();
        if (q.length < 2) { results.appendChild(h('p', { class: 'pm-dim' }, 'Type at least 2 letters (searches every card, including Legends of the Game).')); return; }
        const db = getDB();
        const hits = db.all.filter((p) => p.name.toLowerCase().includes(q) || p.last.toLowerCase().includes(q)).sort((a, b) => b.ovr - a.ovr).slice(0, 24);
        if (!hits.length) results.appendChild(h('p', { class: 'pm-dim' }, 'No players found.'));
        for (const p of hits) {
          const owned = s && s.club.includes(p.id);
          results.appendChild(h('div', { class: 'pm-mktrow' }, playerCard(p, { size: 'xs' }),
            h('div', { class: 'pm-mkt-info' }, h('b', null, p.name), h('span', { class: 'pm-dim' }, `${p.ovr} ${p.pos}${p.special ? ` · ${UT.SPECIAL_NAME[p.special]}` : ''}`)),
            h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: !s || owned, onclick: () => { const r = A.grantPlayer(s, p.id); if (!r.ok) { app.toast(r.error, 'bad'); return; } app.saveUT(); app.toast(`${p.name} granted (untradeable).`, 'good'); drawResults(); } }, owned ? 'Owned' : 'Grant')));
        }
      };
      const q = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search any player…', value: st.q, 'aria-label': 'Search players' });
      q.addEventListener('input', () => { st.q = q.value; drawResults(); });
      const grant = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('grant'), ' Grant any player'), q, results);
      drawResults();

      // ---- toggle tradable on owned cards ----
      const tradeResults = h('div', { class: 'pm-admin-results' });
      const drawTrade = () => {
        clear(tradeResults);
        if (!s) return;
        const q2 = st.q2.trim().toLowerCase();
        const owned = UT.clubPlayers(s).filter((p) => !q2 || p.name.toLowerCase().includes(q2)).sort((a, b) => b.ovr - a.ovr).slice(0, 24);
        if (!owned.length) { tradeResults.appendChild(h('p', { class: 'pm-dim' }, 'No club players match.')); return; }
        for (const p of owned) {
          const untrad = (s.untradeable || []).includes(p.id);
          tradeResults.appendChild(h('div', { class: 'pm-mktrow' }, playerCard(p, { size: 'xs' }),
            h('div', { class: 'pm-mkt-info' }, h('b', null, p.name), h('span', { class: `pm-dim ${untrad ? '' : 'pm-goodline'}` }, untrad ? 'Untradeable' : 'Tradable')),
            h('button', { class: 'pm-btn pm-btn--sm', onclick: () => {
              s.untradeable = s.untradeable || [];
              const i = s.untradeable.indexOf(p.id);
              if (i >= 0) s.untradeable.splice(i, 1); else s.untradeable.push(p.id);
              app.saveUT(); app.toast(`${p.name} is now ${i >= 0 ? 'tradable' : 'untradeable'}.`, 'good'); drawTrade();
            } }, untrad ? 'Make tradable' : 'Make untradeable')));
        }
      };
      const q2 = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search your club…', value: st.q2, 'aria-label': 'Search club players' });
      q2.addEventListener('input', () => { st.q2 = q2.value; drawTrade(); });
      const tradable = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('tag'), ' Toggle tradable'), q2, tradeResults);
      drawTrade();

      // ---- UT progress ----
      const progress = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('sbc'), ' SBCs & objectives'),
        h('div', { class: 'pm-btnrow pm-wrap' },
          h('button', { class: 'pm-btn', disabled: !s, onclick: () => { const got = A.completeAllSbcs(s); done(got.length ? `Completed SBCs: ${got.length} rewards granted.` : 'All SBCs already complete.'); } }, 'Complete all SBCs'),
          h('button', { class: 'pm-btn', disabled: !s, onclick: () => { const n = A.unlockAllObjectives(s); done(`${n} objectives ready to claim.`); } }, 'Unlock all objectives')));

      // ---- career ----
      const slots = C.listSlots().filter((x) => !x.empty);
      if (st.slot === null || !slots.some((x) => x.slot === st.slot)) st.slot = app.career ? app.career.slot : (slots[0] ? slots[0].slot : null);
      const withCareer = (fn) => {
        let c = app.career && app.career.slot === st.slot ? app.career : C.loadCareer(st.slot);
        if (!c) { app.toast('No career in that slot.', 'bad'); return; }
        const msg = fn(c);
        C.saveCareer(c);
        if (app.career && app.career.slot === c.slot) app.career = c;
        app.toast(msg, 'good'); app.refresh();
      };
      const budget = h('input', { class: 'pm-input pm-input--num', type: 'number', value: String(st.budget), 'aria-label': 'Career budget' });
      budget.addEventListener('input', () => { st.budget = Number(budget.value) || 0; });
      const career = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('club'), ' Career Mode'),
        slots.length ? h('div', { class: 'pm-btnrow pm-wrap' },
          select(slots.map((x) => [x.slot, `Slot ${x.slot}: ${x.club} (S${x.season})`]), st.slot, (v) => { st.slot = Number(v); }, { 'aria-label': 'Career slot' }),
          h('button', { class: 'pm-btn', onclick: () => withCareer((c) => `${A.maxCareerRatings(c)} players maxed to 99.`) }, 'Max all player ratings'),
          budget,
          h('button', { class: 'pm-btn', onclick: () => withCareer((c) => `Budget set to ${C.money(A.setCareerBudget(c, st.budget))}.`) }, 'Set budget'))
          : h('p', { class: 'pm-dim' }, 'No career saves yet.'));

      // ---- reset ----
      const reset = h('section', { class: 'pm-panel pm-admin-sec pm-admin-danger' }, h('h3', null, icon('reset'), ' Reset'),
        h('div', { class: 'pm-btnrow pm-wrap' },
          h('button', { class: 'pm-btn pm-btn--danger', disabled: !s, onclick: async () => { if (!(await confirmBox(app.root, 'Reset UT', 'Delete the Ultimate Team save on this device?', 'Reset', true))) return; removeKey(UT.UT_KEY); app.ut = null; app.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0 }; app.toast('UT save reset.', 'good'); app.refresh(); } }, 'Reset UT save'),
          h('button', { class: 'pm-btn pm-btn--danger', disabled: !slots.length, onclick: async () => { if (!(await confirmBox(app.root, 'Reset careers', 'Delete every Career Mode save slot?', 'Delete', true))) return; for (const x of C.SLOTS) C.deleteCareer(x); app.career = null; app.toast('Career saves deleted.', 'good'); app.refresh(); } }, 'Delete all careers'),
          h('button', { class: 'pm-btn', onclick: () => { AA.clearAdminSession(); app.toast('Admin locked.'); app.pop(); } }, 'Lock admin')));

      const lock = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('lock'), ' Session'),
        h('p', { class: 'pm-dim' }, `${LEVEL_NAME[level]}${(RANK[AA.adminSessionLevel()] || 0) < (RANK[level] || 0) ? ' (from your account role)' : ''}.`),
        h('button', { class: 'pm-btn', onclick: () => { AA.clearAdminSession(); app.toast('Admin locked.'); app.pop(); } }, 'Lock admin'));
      const tools = h('div', { class: 'pm-admin-grid', 'data-admin-tab': 'tools' },
        can('coins', level) ? coins : null, can('packs', level) ? packs : null,
        can('owner', level) ? progress : null, can('owner', level) ? career : null, can('grant', level) ? grant : null, can('grant', level) ? tradable : null, can('owner', level) ? reset : lock);

      // ---- extra tabs: moderation (mod/full), and owner-only Cards / Broadcast / Config ----
      const extraTabs = [];
      if (can('moderation', level)) extraTabs.push(['moderation', 'Moderation', () => X.moderationPanel(app, { level })]);
      if (can('owner', level)) {
        extraTabs.push(['cards', 'Card Creator', () => X.cardCreatorPanel(app, { level })]);
        extraTabs.push(['broadcast', 'Broadcast & Giveaways', () => h('div', null, X.broadcastPanel(app), X.giveawayPanel(app))]);
        extraTabs.push(['config', 'Global Config', () => X.configPanel(app)]);
      }
      if (!extraTabs.some(([k]) => k === st.tab)) st.tab = 'tools';
      const panes = { tools };
      for (const [k, , build] of extraTabs) { const p = h('div', { 'data-admin-tab': k, hidden: k !== st.tab }); if (k === st.tab) p.appendChild(build()); panes[k] = p; }
      tools.hidden = st.tab !== 'tools';
      const tabDefs = [['tools', 'Tools'], ...extraTabs.map(([k, label]) => [k, label])];
      const tabs = extraTabs.length ? h('div', { class: 'pm-tabs', role: 'tablist' }, tabDefs.map(([k, label]) => h('button', {
        class: `pm-tab ${k === st.tab ? 'on' : ''}`, role: 'tab', 'aria-selected': String(k === st.tab), 'data-tab': k,
        onclick: () => { st.tab = k; app.refresh(); },
      }, label))) : null;
      add(main, h('p', { class: 'pm-lead' }, can('owner', level) ? 'Owner tools. Changes apply to this device (and the online balance where stated).' : `${LEVEL_NAME[level]}: limited tools. Changes apply to this device only.`), needUT,
        tabs, tools, ...extraTabs.map(([k]) => panes[k]));
    },
  };
  return view;
}
