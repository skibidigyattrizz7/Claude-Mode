// Meta UI shell: view stack, top bar, hub, shared match + result screens.
import { h, clear, toast, fmtNum, add } from './dom.js';
import { load, save } from '../core/storage.js';
import { validateTeam } from '../core/teams.js';
import { utHomeView, ensureUTView } from './utview.js';
import { careerHomeView } from './careerview.js';
import { loadUT, saveUT } from '../core/ut.js';
import { INFINITE_COINS } from '../core/admin.js';
import { getAdminLevel, bindOnline as bindAdminOnline } from '../shared/adminauth.js';
import { adminButton, adminView } from './adminview.js';
import { tileIcon } from './icons.js';
import { userMatchStats, recordObjectiveMatch } from '../core/objectives.js';
import { recordEvoMatch } from '../core/evolutions.js';
import { recordSeasonMatch } from '../core/seasons.js';

/** Normalise a coin response ({coins}|{balance}|number) to a number (NaN when unknown). */
export function coinNum(r) {
  if (typeof r === 'number') return r;
  if (r && typeof r === 'object') { const v = r.coins ?? r.balance; return typeof v === 'number' ? v : NaN; }
  return NaN;
}
/** Await a promise-returning online call; never throws. */
export async function safeCall(fn, fallback = null) {
  try { const r = await fn(); return r === undefined ? fallback : r; } catch { return fallback; }
}

const SETTINGS_KEY = 'meta.settings';

function ensureCss(root) {
  try {
    const has = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /(^|\/)css\/meta\.css(\?|#|$)/.test(l.getAttribute('href') || '') || l.dataset.pmCss);
    if (has) return;
    const href = new URL('../../../css/meta.css', import.meta.url).href;
    root.appendChild(h('link', { rel: 'stylesheet', href, 'data-pm-css': '1' }));
  } catch { /* ignore */ }
}

export class MetaApp {
  constructor(container, { startMatch, startOnlineMatch = null, online = null, onExit = null } = {}) {
    this.container = container;
    this.startMatchFn = startMatch;
    this.startOnlineMatchFn = typeof startOnlineMatch === 'function' ? startOnlineMatch : null;
    this.online = online && typeof online === 'object' ? online : null;
    this.onExit = onExit;
    /** UT coin wallet: 'local' (saved with the club) or 'online' (server balance via online.coins). */
    this.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0 };
    this.root = h('div', { class: 'pm-root' });
    ensureCss(this.root);
    this.top = h('header', { class: 'pm-top' });
    this.main = h('main', { class: 'pm-main', tabindex: '-1' });
    add(this.root, h('div', { class: 'pm-bgfx', 'aria-hidden': 'true' }), this.top, this.main);
    container.appendChild(this.root);
    this.stack = [];
    this.ut = loadUT();
    this.career = null;
    this.settings = { halfMinutes: 3, difficulty: 'pro', ...load(SETTINGS_KEY, {}) };
    this.destroyed = false;
    this.cleanups = [];
    this.onKey = (e) => {
      if (e.key === 'Escape' && !this.root.querySelector('.pm-modal-back, .pm-po, .pm-busy') && this.stack.length > 1 && !e.defaultPrevented) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
        if (this.root.contains(document.activeElement) || document.activeElement === document.body) { e.preventDefault(); this.pop(); }
      }
    };
    document.addEventListener('keydown', this.onKey);
    this.reset(hubView());
    // owner / mod accounts get admin automatically (role read from the online account; never throws)
    bindAdminOnline(this.online);
    this.accountUnsub = null;
    if (this.online && this.online.account && typeof this.online.account.onChange === 'function') {
      try { const un = this.online.account.onChange(() => { if (!this.destroyed) this.refresh(); }); if (typeof un === 'function') this.accountUnsub = un; } catch { /* ignore */ }
    }
  }

  saveSettings() { save(SETTINGS_KEY, this.settings); }

  // ---- navigation ----
  push(view) { this.runCleanup(); this.stack.push(view); this.render(true); }
  replace(view) { this.runCleanup(); this.stack[this.stack.length - 1] = view; this.render(true); }
  reset(view) { this.runCleanup(); this.stack = [view]; this.render(true); }
  pop() {
    if (this.stack.length > 1) { this.runCleanup(); this.stack.pop(); this.render(true); }
    else if (this.onExit) this.onExit();
  }
  popTo(pred) {
    this.runCleanup();
    while (this.stack.length > 1 && !pred(this.stack[this.stack.length - 1])) this.stack.pop();
    this.render(true);
  }
  runCleanup() { for (const f of this.cleanups.splice(0)) { try { f(); } catch { /* ignore */ } } }
  onCleanup(f) { this.cleanups.push(f); }
  refresh() { const y = this.main.scrollTop, wy = window.scrollY; this.runCleanup(); this.render(false); this.main.scrollTop = y; window.scrollTo(0, wy); }

  render(nav) {
    if (this.destroyed) return;
    const v = this.stack[this.stack.length - 1];
    this.renderTop(v);
    clear(this.main);
    this.main.className = `pm-main ${v.cls || ''}`;
    v.render(this.main, this);
    if (nav) {
      this.main.scrollTop = 0;
      try { if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView({ block: 'start' }); } catch { /* ignore */ }
      const f = this.main.querySelector('[data-autofocus]') || this.main.querySelector('.pm-tile, button, [tabindex="0"]');
      if (f && f.focus) f.focus({ preventScroll: true });
    }
  }

  renderTop(v) {
    clear(this.top);
    const canBack = this.stack.length > 1 || this.onExit;
    add(this.top, 
      canBack ? h('button', { class: 'pm-back', 'aria-label': 'Back', onclick: () => this.pop() }, h('span', { 'aria-hidden': 'true' }, '‹'), h('span', { class: 'pm-back-t' }, 'Back')) : h('div', { class: 'pm-logo-sm' }, 'P'),
      h('div', { class: 'pm-top-title' }, v.kicker ? h('div', { class: 'pm-kicker' }, v.kicker) : null, h('h1', null, v.title || 'Pitchside')),
      h('div', { class: 'pm-top-right' }, v.coins && this.ut ? this.coinChip() : null, v.topRight ? v.topRight(this) : null),
    );
  }

  toast(msg, kind) { toast(this.root, msg, kind); }

  // ---- UT coins (local vs online wallet) ----
  coinChip() {
    const inf = this.ut.admin && this.ut.admin.infinite;
    const online = this.wallet.mode === 'online';
    return h('div', { class: `pm-coins ${online ? 'is-online' : ''}`, title: online ? 'Online coin balance (server)' : 'Local coin balance (this device)' },
      h('i', { 'aria-hidden': 'true' }), inf ? '∞' : fmtNum(this.ut.coins), h('small', { class: 'pm-coins-src' }, online ? 'Online' : 'Local'));
  }
  topRefresh() {
    const v = this.stack[this.stack.length - 1];
    if (v) this.renderTop(v);
    const note = this.main.querySelector('.pm-walletnote');
    if (note) note.textContent = this.wallet.mode === 'online' ? 'Coins shown: your online balance (server).' : 'Coins shown: local balance on this device.';
  }
  coinSourceLabel() { return this.wallet.mode === 'online' ? 'online balance' : 'local balance'; }

  async onlineAvailable() {
    if (!this.online || typeof this.online.available !== 'function') return false;
    return !!(await safeCall(() => this.online.available(), false));
  }

  /** Switch the UT coin display to the online balance when the backend is reachable. */
  async initWallet(force = false) {
    const s = this.ut;
    if (!s || (this.wallet.checked && !force)) return this.wallet.mode;
    this.wallet.checked = true;
    if (!this.online || !this.online.coins || !(await this.onlineAvailable())) return this.wallet.mode;
    const bal = coinNum(await safeCall(() => this.online.coins.get()));
    if (!Number.isFinite(bal) || this.destroyed || this.ut !== s) return this.wallet.mode;
    if (this.wallet.mode !== 'online') this.wallet.local = s.coins;
    this.wallet.mode = 'online';
    this.wallet.synced = bal;
    if (!(s.admin && s.admin.infinite)) s.coins = bal;
    // balance changes seen anywhere (seller credited, gifts, rewards, presence) update the top bar at once
    if (!this.wallet.unsub && typeof this.online.coins.onChange === 'function') {
      this.wallet.unsub = this.online.coins.onChange((b) => { if (!this.destroyed) this.setOnlineBalance(b); });
      this.onCleanup(() => { if (this.wallet.unsub) { this.wallet.unsub(); this.wallet.unsub = null; } });
    }
    this.topRefresh();
    return 'online';
  }

  /** A fresh server balance (from a buy / gift / reward / presence tick): show it at once when nothing is syncing. */
  setOnlineBalance(bal) {
    const w = this.wallet;
    if (w.mode !== 'online' || !this.ut || !Number.isFinite(bal) || w.inflight > 0) return;
    w.synced = bal;
    if (!(this.ut.admin && this.ut.admin.infinite)) this.ut.coins = bal;
    this.topRefresh();
  }

  /** Re-read the server balance (after market buys / claims / online matches). */
  async refreshOnlineCoins() {
    if (this.wallet.mode !== 'online' || !this.ut) return;
    await this.wallet.pending;
    const bal = coinNum(await safeCall(() => this.online.coins.get()));
    if (!Number.isFinite(bal) || !this.ut) return;
    this.wallet.synced = bal;
    if (!(this.ut.admin && this.ut.admin.infinite)) this.ut.coins = bal;
    this.topRefresh();
  }

  /** Persist UT; in online mode coin changes since the last sync are sent to the server. */
  saveUT() {
    const s = this.ut;
    if (!s) return false;
    const w = this.wallet;
    if (s.admin && s.admin.infinite) {
      s.coins = INFINITE_COINS;
      // online: make the server wallet infinite too, so real-market buys / spends succeed (owner powers needed)
      if (w.mode === 'online' && !w.infiniteServer && this.online.owner && this.online.admin && typeof this.online.admin.canOwner === 'function' && this.online.admin.canOwner()) {
        w.infiniteServer = true;
        safeCall(() => this.online.owner.setInfinite(true), { ok: false }).then((r) => { if (!r || !r.ok) w.infiniteServer = false; });
      }
    } else if (w.mode === 'online') {
      const delta = Math.round(s.coins - w.synced);
      if (delta) {
        w.synced = s.coins;
        w.inflight++;
        w.pending = w.pending.then(async () => {
          const r = await safeCall(() => this.online.coins.add(delta, delta > 0 ? 'ut-earn' : 'ut-spend'), { ok: false });
          w.inflight--;
          if (!r || r.ok === false) { this.toast('Online coin sync failed — balance refreshed from server.', 'warn'); const b = coinNum(await safeCall(() => this.online.coins.get())); if (Number.isFinite(b) && this.ut) { w.synced = b; this.ut.coins = b; } }
          else { const b = coinNum(r); if (Number.isFinite(b) && w.inflight === 0 && this.ut) { w.synced = b; this.ut.coins = b; } }
          this.topRefresh();
        });
      }
    }
    return saveUT(w.mode === 'online' ? { ...s, coins: w.local ?? 0 } : s);
  }

  // ---- matches ----
  /** Calls the host startMatch. Returns result, or null when abandoned/failed. */
  async playMatch(home, away, opts) {
    for (const [side, t] of [['home', home], ['away', away]]) {
      const errs = validateTeam(t);
      if (errs.length) { this.toast(`Invalid ${side} team: ${errs[0]}`, 'bad'); console.warn('[meta] invalid team', side, errs); return null; }
    }
    if (typeof this.startMatchFn !== 'function') { this.toast('Match engine not available', 'bad'); return null; }
    const busy = h('div', { class: 'pm-busy', role: 'status' }, h('div', { class: 'pm-spinner' }), h('div', null, `${home.name} vs ${away.name}`), h('small', null, 'Match in progress…'));
    this.root.appendChild(busy);
    try {
      const lvl = getAdminLevel(); const matchLevel = lvl === 'super' || lvl === 'full' ? 'owner' : lvl === 'mod' ? 'mod' : null;
      const res = await this.startMatchFn(home, away, { ...opts, adminLevel: matchLevel });
      if (this.destroyed) return null;
      if (!res || res.abandoned) { this.toast('Match abandoned — no result recorded.', 'warn'); return null; }
      return res;
    } catch (err) {
      console.error('[meta] startMatch failed', err);
      this.toast('The match could not be started.', 'bad');
      return null;
    } finally { busy.remove(); }
  }

  destroy() {
    this.destroyed = true;
    this.runCleanup();
    if (this.accountUnsub) { try { this.accountUnsub(); } catch { /* ignore */ } }
    document.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  showUltimateTeam() { this.reset(hubView()); this.push(ensureUTView(this)); }
  /**
   * Shared post-match bookkeeping for every mode: objectives + evolutions (UT only) and the season XP track.
   * Returns { m (normalised stats), season, done (objectives completed) }.
   */
  afterMatch({ team, result, side = 'home', mode = 'match', ut = true }) {
    let m;
    try { m = userMatchStats(team, result, side); } catch (e) { console.warn('[meta] afterMatch', e); return null; }
    let done = [];
    if (ut && this.ut) {
      done = recordObjectiveMatch(this.ut, m);
      recordEvoMatch(this.ut, m);
      this.saveUT();
    }
    const season = recordSeasonMatch({ outcome: m.outcome, goals: m.gf, mode });
    const msgs = [];
    if (season.levelsGained.length) msgs.push(`Season level ${season.levelsGained[season.levelsGained.length - 1]} reached!`);
    if (done.length) msgs.push(`${done.length} objective${done.length > 1 ? 's' : ''} complete — claim in Objectives`);
    if (msgs.length) setTimeout(() => this.toast(msgs.join(' · '), 'good'), 400);
    return { m, season, done };
  }

  isAdmin() { return !!getAdminLevel(); }
  adminLevel() { return getAdminLevel(); }
  /** Open the Admin panel (used after a code is accepted from the main-menu Settings page). */
  showAdmin() { this.reset(hubView()); if (this.ut) { this.push(ensureUTView(this)); } this.push(adminView()); }
  showCareer() { this.reset(hubView()); this.push(careerHomeView()); }
}

export function hubView() {
  return {
    title: 'Game Modes', kicker: 'Pitchside 3D',
    render(main, app) {
      add(main, h('div', { class: 'pm-hub' },
        h('button', { class: 'pm-tile pm-tile--hero pm-tile--ut', 'data-autofocus': '1', onclick: () => app.push(app.ut ? utHomeView() : ensureUTView(app)) },
          tileIcon('squad'),
          h('div', { class: 'pm-tile-body' }, h('div', { class: 'pm-kicker' }, 'Build your dream squad'), h('h2', null, 'Pitchside Ultimate Team'), h('p', null, 'Open packs, complete SBCs, climb Squad Battles.'))),
        h('button', { class: 'pm-tile pm-tile--hero pm-tile--career', onclick: () => app.push(careerHomeView()) },
          tileIcon('club'),
          h('div', { class: 'pm-tile-body' }, h('div', { class: 'pm-kicker' }, 'Manage a club'), h('h2', null, 'Career Mode'), h('p', null, 'Seasons, transfers, youth, promotion and glory.'))),
      ), h('div', { class: 'pm-hubfoot' }, adminButton(app)));
    },
  };
}

/** Shared post-match screen. */
export function resultView({ title = 'Full Time', home, away, result, userSide = 'home', extra = null, onContinue, continueLabel = 'Continue', kicker = '' }) {
  return {
    title, kicker, cls: 'pm-main--result',
    render(main, app) {
      const scorersFor = (side, team) => (result.scorers || []).filter((s) => s.team === side).map((s) => {
        const p = team.players.concat(team.bench).find((x) => x.id === s.playerId);
        return h('li', null, `${p ? p.name : '—'} ${s.minute}'`);
      });
      const st = result.stats || {};
      const row = (label, arr, pct = false) => (arr ? h('div', { class: 'pm-srow' },
        h('b', null, `${arr[0]}${pct ? '%' : ''}`),
        h('div', { class: 'pm-sbar' }, h('i', { style: { width: `${(arr[0] / Math.max(1, arr[0] + arr[1])) * 100}%` } })),
        h('span', null, label), h('b', null, `${arr[1]}${pct ? '%' : ''}`)) : null);
      const mine = userSide === 'home' ? home : away;
      const ratings = mine.players.concat(mine.bench).filter((p) => result.playerRatings && result.playerRatings[p.id] !== undefined)
        .map((p) => ({ p, r: result.playerRatings[p.id] })).sort((a, b) => b.r - a.r);
      const gf = userSide === 'home' ? result.homeGoals : result.awayGoals;
      const ga = userSide === 'home' ? result.awayGoals : result.homeGoals;
      const outcome = gf > ga ? 'win' : gf < ga ? 'loss' : 'draw';
      add(main, 
        h('section', { class: `pm-score pm-score--${outcome}` },
          h('div', { class: 'pm-score-team' }, h('span', { class: 'pm-kitdot', style: { background: home.kit.primary, borderColor: home.kit.secondary } }), h('b', null, home.name), h('ul', null, scorersFor('home', home))),
          h('div', { class: 'pm-score-num' }, h('div', { class: 'pm-score-digits' }, h('span', null, result.homeGoals), h('i', null, '–'), h('span', null, result.awayGoals)),
            result.pens ? h('small', null, `Pens ${result.pens.home}–${result.pens.away}`) : null,
            h('div', { class: `pm-outcome ${outcome}` }, outcome === 'win' ? 'Victory' : outcome === 'loss' ? 'Defeat' : 'Draw'),
            result.simulated ? h('small', { class: 'pm-dim' }, 'Simulated') : null),
          h('div', { class: 'pm-score-team right' }, h('span', { class: 'pm-kitdot', style: { background: away.kit.primary, borderColor: away.kit.secondary } }), h('b', null, away.name), h('ul', null, scorersFor('away', away)))),
        extra,
        h('div', { class: 'pm-two' },
          h('section', { class: 'pm-panel' }, h('h3', null, 'Match stats'),
            row('Possession', st.possession, true), row('Shots', st.shots), row('On target', st.shotsOnTarget), row('Passes', st.passes)),
          h('section', { class: 'pm-panel' }, h('h3', null, 'Player ratings'),
            h('div', { class: 'pm-ratings' }, ratings.map(({ p, r }) => h('div', { class: 'pm-rating-row' }, h('span', { class: 'pm-dim' }, p.pos), h('span', null, p.name), h('b', { class: r >= 8 ? 'hi' : r >= 7 ? 'good' : r < 6 ? 'low' : '' }, r.toFixed(1))))))),
        h('div', { class: 'pm-actions-row' }, h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', 'data-autofocus': '1', onclick: () => onContinue(app) }, continueLabel)),
      );
    },
  };
}
