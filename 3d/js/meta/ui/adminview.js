// Owner-only admin panel. Access requires a server-side check via online.admin.verify(code); the code is
// never stored or compared in the client. A successful check is remembered for this browser session only.
import { h, clear, add, fmtNum, modal, confirmBox, select } from './dom.js';
import { playerCard } from './card.js';
import * as UT from '../core/ut.js';
import * as C from '../core/career.js';
import * as A from '../core/admin.js';
import { getDB } from '../core/players.js';
import { remove as removeKey } from '../core/storage.js';
import { safeCall } from './app.js';
import { openPackFlow } from './utview.js';

const SESSION_KEY = 'pitchside.admin.session';
const setSession = (on) => { try { if (on) globalThis.sessionStorage.setItem(SESSION_KEY, '1'); else globalThis.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } };

export function adminButton(app) {
  return h('button', { class: 'pm-adminbtn', title: 'Owner admin', onclick: () => (app.isAdmin() ? app.push(adminView()) : codePrompt(app)) }, h('span', { 'aria-hidden': 'true' }, '⚙'), ' Admin');
}

/** Resolve the server verdict. Only an explicit `true` (or {valid:true}/{admin:true}) unlocks. */
export async function verifyAdmin(online, code) {
  const offline = { ok: false, error: 'Admin needs an online connection' };
  if (!online || !online.admin || typeof online.admin.verify !== 'function') return offline;
  if (typeof online.available === 'function' && !(await safeCall(() => online.available(), false))) return offline;
  const r = await safeCall(() => online.admin.verify(String(code || '')), null);
  if (r === null || (r && typeof r === 'object' && r.ok === false && r.error && /offline|network|unreach/i.test(String(r.error)))) return offline;
  const ok = r === true || (r && typeof r === 'object' && (r.valid === true || r.admin === true));
  return ok ? { ok: true } : { ok: false, error: 'Code not accepted' };
}

function codePrompt(app) {
  const input = h('input', { class: 'pm-input', type: 'password', autocomplete: 'off', 'aria-label': 'Admin code', placeholder: 'Admin code' });
  const msg = h('p', { class: 'pm-dim', 'aria-live': 'polite' }, 'Owner only. The code is checked by the server.');
  let busy = false;
  const submit = async (close) => {
    if (busy) return;
    busy = true; msg.textContent = 'Checking…'; msg.className = 'pm-dim';
    const r = await verifyAdmin(app.online, input.value);
    busy = false;
    input.value = '';
    if (!r.ok) { msg.textContent = r.error; msg.className = 'pm-warnline'; return; }
    setSession(true);
    close();
    app.toast('Admin unlocked for this session.', 'good');
    app.push(adminView());
  };
  let closeFn = null;
  const form = h('form', { class: 'pm-form', onsubmit: (e) => { e.preventDefault(); submit(closeFn); } }, h('label', null, h('span', null, 'Code'), input), msg);
  closeFn = modal(app.root, {
    title: 'Admin access', body: form,
    actions: [{ label: 'Cancel' }, { label: 'Unlock', primary: true, onClick: (close) => { submit(close); return false; } }],
  });
  setTimeout(() => input.focus(), 30);
}

export function adminView() {
  const st = { q: '', slot: null, amount: 100000, budget: 250000000 };
  const view = {
    title: 'Admin', kicker: 'Owner tools', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      if (!app.isAdmin()) { app.pop(); return; }
      const s = app.ut;
      const needUT = s ? null : h('p', { class: 'pm-warnline' }, 'Create an Ultimate Team club first to use the UT tools.');
      const done = (msg) => { if (s) app.saveUT(); app.toast(msg, 'good'); app.refresh(); };

      // ---- coins ----
      const amt = h('input', { class: 'pm-input pm-input--num', type: 'number', value: String(st.amount), 'aria-label': 'Coin amount' });
      amt.addEventListener('input', () => { st.amount = Math.round(Number(amt.value) || 0); });
      const inf = !!(s && s.admin && s.admin.infinite);
      const coins = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, 'Coins'),
        h('p', { class: 'pm-dim' }, s ? `Shown balance: ${inf ? '∞' : fmtNum(s.coins)} (${app.coinSourceLabel()}).${app.wallet.mode === 'online' ? ` Local balance: ${fmtNum(app.wallet.local || 0)}.` : ''}` : ''),
        h('div', { class: 'pm-btnrow' }, amt,
          h('button', { class: 'pm-btn', disabled: !s || inf, onclick: () => { if (app.wallet.mode === 'online') app.wallet.local = Math.max(0, st.amount); else s.coins = Math.max(0, st.amount); done('Local coins set.'); } }, 'Set local'),
          h('button', { class: 'pm-btn', disabled: !s || inf, onclick: () => { if (app.wallet.mode === 'online') app.wallet.local = Math.max(0, (app.wallet.local || 0) + st.amount); else s.coins = Math.max(0, s.coins + st.amount); done('Local coins added.'); } }, 'Add local'),
          h('button', {
            class: 'pm-btn pm-btn--primary', disabled: !app.online || !app.online.coins,
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
          h('button', { class: 'pm-btn', onclick: () => { setSession(false); app.toast('Admin locked.'); app.pop(); } }, 'Lock admin')));

      add(main, h('p', { class: 'pm-lead' }, 'Owner tools. Changes apply to this device (and the online balance where stated).'), needUT,
        h('div', { class: 'pm-admin-grid' }, coins, packs, progress, career, grant, reset));
    },
  };
  return view;
}
