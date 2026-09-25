// Admin panel + "Admin Given Codes" entry. Access comes from a code (checked by online.admin.verify when the
// backend is reachable, otherwise locally with PBKDF2 — the code itself is never stored) or from an owner/mod
// account role. Levels: full (everything), mod (moderation + limited tools), temp (60 minutes, limited tools).
import { h, clear, add, fmtNum, modal, confirmBox, select } from './dom.js';
import { playerCard } from './card.js';
import * as UT from '../core/ut.js';
import * as C from '../core/career.js';
import * as A from '../core/admin.js';
import { getDB } from '../core/players.js';
import { remove as removeKey } from '../core/storage.js';
import { safeCall } from './app.js';
import { openPackFlow } from './utview.js';

const LEVEL_NAME = { full: 'Admin', mod: 'Moderator', temp: 'Temporary admin' };
const mmss = (ms) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/** Meta hub entry (replaces the old tiny footer link): opens the Admin Given Codes screen or the panel. */
export function adminButton(app) {
  const lv = A.getAdminLevel();
  return h('button', { class: 'pm-btn pm-btn--ghost pm-codesbtn', onclick: () => app.push(lv ? adminView() : adminCodesView()) },
    h('span', { 'aria-hidden': 'true' }, '\u{1F511}\uFE0E'), lv ? ' Admin panel' : ' Admin Given Codes');
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
    const ms = A.lockRemainingMs();
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
    const r = await A.redeemAdminCode(input.value, app.online);
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
    h('div', { class: 'pm-codes-head' }, h('span', { class: 'pm-codes-ico', 'aria-hidden': 'true' }, '\u{1F511}\uFE0E'), h('h3', null, 'Admin Given Codes')),
    form, msg);
}

export function adminCodesView() {
  return {
    title: 'Admin Given Codes', kicker: 'Pitchside', coins: true,
    render(main, app) {
      const lv = A.getAdminLevel();
      add(main, h('p', { class: 'pm-lead' }, 'Codes are handed out by the owner. A valid code unlocks the Admin panel for this browser session.'),
        lv ? h('p', { class: 'pm-goodline' }, `${LEVEL_NAME[lv]} is active.`, ' ', h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', onclick: () => app.replace(adminView()) }, 'Open Admin panel')) : null,
        adminCodesPanel(app, { onUnlock: () => app.replace(adminView()) }));
    },
  };
}

/** Visible badge in the UT hub while admin is active (countdown for temporary admin, crown for the owner account). */
export function adminBadge(app) {
  const info = A.adminInfo();
  if (!info.level) return null;
  const owner = info.fromAccount && info.role === 'owner';
  const label = h('span', { class: 'pm-adminbadge-t' });
  const draw = () => {
    const i = A.adminInfo();
    if (!i.level) { app.toast('Temporary admin expired.', 'warn'); app.refresh(); return false; }
    label.textContent = owner ? 'OWNER' : i.level === 'mod' ? 'MOD' : i.level === 'temp' ? `Temp admin · ${mmss(i.tempRemainingMs)}` : 'Admin';
    return true;
  };
  draw();
  if (info.level === 'temp') { const t = setInterval(() => { if (!draw()) clearInterval(t); }, 1000); app.onCleanup(() => clearInterval(t)); }
  return h('button', { class: `pm-adminbadge lv-${info.level} ${owner ? 'is-owner' : ''}`, 'data-admin-badge': info.level, title: 'Open the Admin panel', onclick: () => app.push(adminView()) },
    owner ? h('span', { class: 'pm-crown', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 16" width="18" height="12"><path d="M1 14h22L20 3l-5 5-3-7-3 7-5-5z" fill="currentColor"/></svg>' }) : h('span', { 'aria-hidden': 'true' }, '\u2699\uFE0E'),
    label);
}

export function adminView() {
  const st = { q: '', slot: null, amount: 100000, budget: 250000000, tab: 'tools' };
  const view = {
    title: 'Admin', kicker: 'Owner tools', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const level = A.getAdminLevel();
      if (!level) { app.replace(adminCodesView()); return; }
      const can = (x) => A.adminCan(x, level);
      const s = app.ut;
      const needUT = s ? null : h('p', { class: 'pm-warnline' }, 'Create an Ultimate Team club first to use the UT tools.');
      const done = (msg) => { if (s) app.saveUT(); app.toast(msg, 'good'); app.refresh(); };

      // ---- coins ----
      const amt = h('input', { class: 'pm-input pm-input--num', type: 'number', value: String(st.amount), 'aria-label': 'Coin amount' });
      amt.addEventListener('input', () => { st.amount = Math.round(Number(amt.value) || 0); });
      const inf = !!(s && s.admin && s.admin.infinite);
      const limited = !can('infinite');
      const coinsLimited = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'Coins'),
        h('p', { class: 'pm-dim' }, s ? `Local balance: ${fmtNum(app.wallet.mode === 'online' ? (app.wallet.local || 0) : s.coins)}. Up to ${fmtNum(A.COIN_CAP[level])} coins per grant.` : ''),
        h('div', { class: 'pm-btnrow' }, amt,
          h('button', { class: 'pm-btn pm-btn--primary', disabled: !s || inf, onclick: () => {
            if (app.wallet.mode === 'online') { const tmp = { coins: app.wallet.local || 0 }; const v = A.addLocalCoins(tmp, st.amount, level); app.wallet.local = tmp.coins; done(`Added ${fmtNum(v)} local coins.`); }
            else { const v = A.addLocalCoins(s, st.amount, level); done(`Added ${fmtNum(v)} coins.`); }
          } }, 'Add coins')));
      const coins = limited ? coinsLimited : h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'Coins'),
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
      const packs = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'Open any pack for free'),
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
      const grant = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'Grant any player'), q, results);
      drawResults();

      // ---- UT progress ----
      const progress = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'SBCs & objectives'),
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
      const career = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'Career Mode'),
        slots.length ? h('div', { class: 'pm-btnrow pm-wrap' },
          select(slots.map((x) => [x.slot, `Slot ${x.slot}: ${x.club} (S${x.season})`]), st.slot, (v) => { st.slot = Number(v); }, { 'aria-label': 'Career slot' }),
          h('button', { class: 'pm-btn', onclick: () => withCareer((c) => `${A.maxCareerRatings(c)} players maxed to 99.`) }, 'Max all player ratings'),
          budget,
          h('button', { class: 'pm-btn', onclick: () => withCareer((c) => `Budget set to ${C.money(A.setCareerBudget(c, st.budget))}.`) }, 'Set budget'))
          : h('p', { class: 'pm-dim' }, 'No career saves yet.'));

      // ---- reset ----
      const reset = h('section', { class: 'pm-panel pm-admin-sec pm-admin-danger' }, h('h3', null, 'Reset'),
        h('div', { class: 'pm-btnrow pm-wrap' },
          h('button', { class: 'pm-btn pm-btn--danger', disabled: !s, onclick: async () => { if (!(await confirmBox(app.root, 'Reset UT', 'Delete the Ultimate Team save on this device?', 'Reset', true))) return; removeKey(UT.UT_KEY); app.ut = null; app.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0 }; app.toast('UT save reset.', 'good'); app.refresh(); } }, 'Reset UT save'),
          h('button', { class: 'pm-btn pm-btn--danger', disabled: !slots.length, onclick: async () => { if (!(await confirmBox(app.root, 'Reset careers', 'Delete every Career Mode save slot?', 'Delete', true))) return; for (const x of C.SLOTS) C.deleteCareer(x); app.career = null; app.toast('Career saves deleted.', 'good'); app.refresh(); } }, 'Delete all careers'),
          h('button', { class: 'pm-btn', onclick: () => { A.clearAdminSession(); app.toast('Admin locked.'); app.pop(); } }, 'Lock admin')));

      const lock = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'Session'),
        h('p', { class: 'pm-dim' }, `${LEVEL_NAME[level]}${A.adminInfo().fromAccount ? ' (from your account role)' : ''}.`),
        h('button', { class: 'pm-btn', onclick: () => { A.clearAdminSession(); app.toast('Admin locked.'); app.pop(); } }, 'Lock admin'));
      const tools = h('div', { class: 'pm-admin-grid', 'data-admin-tab': 'tools' },
        can('coins') ? coins : null, can('packs') ? packs : null,
        can('sbc') ? progress : null, can('career') ? career : null, can('grant') ? grant : null, can('reset') ? reset : lock);

      // ---- EXTENSION POINT: Moderation tab ----
      // Rendered only for 'full' / 'mod' levels when the online services expose `online.moderation`
      // (added by the net agent). If it provides mount(el, { level, app }), it renders its own UI in `modPane`.
      const modOk = can('moderation') && app.online && app.online.moderation && typeof app.online.moderation === 'object';
      const modPane = h('div', { class: 'pm-admin-mod', 'data-admin-tab': 'moderation', hidden: true });
      if (modOk) {
        if (typeof app.online.moderation.mount === 'function') { try { const un = app.online.moderation.mount(modPane, { level, app }); if (typeof un === 'function') app.onCleanup(un); } catch (e) { console.warn('[meta] moderation mount failed', e); } }
        else modPane.appendChild(h('section', { class: 'pm-panel' }, h('h3', null, 'Moderation'), h('p', { class: 'pm-dim' }, 'Moderation tools will appear here.')));
      }
      const tabs = modOk ? h('div', { class: 'pm-tabs', role: 'tablist' }, [['tools', 'Tools'], ['moderation', 'Moderation']].map(([k, label]) => h('button', {
        class: `pm-tab ${k === st.tab ? 'on' : ''}`, role: 'tab', 'aria-selected': String(k === st.tab), 'data-tab': k,
        onclick: (e) => { st.tab = k; tools.hidden = k !== 'tools'; modPane.hidden = k !== 'moderation'; for (const b of e.currentTarget.parentNode.children) { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); } },
      }, label))) : null;
      if (modOk && st.tab === 'moderation') { tools.hidden = true; modPane.hidden = false; }
      add(main, h('p', { class: 'pm-lead' }, level === 'full' ? 'Owner tools. Changes apply to this device (and the online balance where stated).' : `${LEVEL_NAME[level]}: limited tools. Changes apply to this device only.`), needUT,
        tabs, tools, modOk ? modPane : null);
    },
  };
  return view;
}
