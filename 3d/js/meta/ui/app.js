// Meta UI shell: view stack, top bar, hub, shared match + result screens.
import { h, clear, toast, fmtNum, add, infNodes } from './dom.js';
import { load, save } from '../core/storage.js';
import { validateTeam, resolveKitClash, gkKitFor } from '../core/teams.js';
import { aiOpponent } from '../core/rivals.js';
import { utHomeView, ensureUTView } from './utview.js';
import { careerHomeView } from './careerview.js';
import { loadUT, saveUT, rescuePendingPack, utTeam } from '../core/ut.js';
import { normalizeWallet, settleInfinite, setInfinite as walletSetInfinite, realCoins, isInfinite, cleanCoins } from '../core/wallet.js';
import { getAdminLevel, bindOnline as bindAdminOnline, clearAdminSession } from '../../shared/adminauth.js';
import { adminButton, adminView } from './adminview.js';
import { tileIcon } from './icons.js';
import { userMatchStats, recordObjectiveMatch } from '../core/objectives.js';
import { recordEvoMatch } from '../core/evolutions.js';
import { recordSeasonMatch } from '../core/seasons.js';
import { syncRemote, remoteDue, wipeLocalProfile, DELETED_MESSAGE } from '../core/remote.js';
import { startVinsonExperience } from './vinson.js?v=vinson15';
import { cursedPack, enforceLock, isOwner, hasDoomEffects } from '../core/vinson.js';

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

/** A cursed UT online entry uses the local pitch/reveal sabotage path without matchmaking a real opponent. */
export function shouldSabotageOnlineUT(state, args) {
  return args?.mode === 'ut' && cursedPack(state);
}

export function dispatchOnlineEntry({ state, args = {}, startMatch, startOnlineMatch, halfMinutes = 3, exempt = false }) {
  if (exempt || !shouldSabotageOnlineUT(state, args)) return startOnlineMatch(args);
  // Give the normal local match opener the requested UT squad, so the players and pitch
  // appear before startMatch performs the curse sabotage. Do not queue a real opponent
  // for a match that will be abandoned moments later.
  const home = args.team || utTeam(state);
  if (!home) return Promise.resolve({ ok: false, abandoned: true, reason: 'no_team' });
  if (typeof startMatch !== 'function') return Promise.resolve({ ok: false, abandoned: true, reason: 'no_match_engine' });
  const opponent = aiOpponent(`vinson-training-${Date.now()}`, 'pro', { label: 'VIN' });
  const away = structuredClone(opponent.team);
  away.kit = resolveKitClash(home.kit, away.kit, opponent.awayKit);
  away.gkKit = gkKitFor(home.kit, away.kit, home.gkKit);
  return startMatch(home, away, {
    halfMinutes,
    difficulty: opponent.difficulty,
    userSide: 'home',
    mode: 'ut',
    vinsonCurse: true,
  });
}

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
    this.startOnlineMatchFn = typeof startOnlineMatch === 'function' ? (args = {}) => dispatchOnlineEntry({
      state: this.ut,
      args,
      startMatch: this.startMatchFn,
      startOnlineMatch,
      halfMinutes: this.settings?.halfMinutes || 3,
      exempt: isOwner(this.online),
    }) : null;
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
    // a pack left mid-opening last time (tab closed / reload): its unresolved cards go to Saved cards
    try { if (this.ut && rescuePendingPack(this.ut)) { saveUT(this.ut); this._rescued = true; } } catch { /* never block loading */ }
    if (this.ut) normalizeWallet(this.ut);
    this.vinson = this.online ? startVinsonExperience(this.online) : null;
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
    this.configUnsub = null;
    if (this.online && this.online.config && typeof this.online.config.onChange === 'function') {
      try { const un = this.online.config.onChange(() => { this.checkResetEpoch(); this.checkAdminRevoke(); this.refreshLiveConfig(); }); if (typeof un === 'function') this.configUnsub = un; } catch { /* ignore */ }
    }
    if (this.online && this.online.presence && typeof this.online.presence.onUpdate === 'function') {
      try {
        const un = this.online.presence.onUpdate((u) => {
          if (u && u.resetDue) this.checkResetEpoch();
          if (u && remoteDue(this.online, u)) this.processRemote({ usePresence: true }); // per-profile resets + owner patches
          if (u) this.applyRestrictions(u.restrictions);
        });
        if (typeof un === 'function') this.presenceUnsub = un;
      } catch { /* ignore */ }
    }
    // the owner deleted this profile on the server: forget the local club (main.js wipes storage too)
    this.deletedUnsub = null;
    if (this.online && this.online.account && typeof this.online.account.onDeleted === 'function') {
      try { const un = this.online.account.onDeleted(() => this.onIdentityDeleted()); if (typeof un === 'function') this.deletedUnsub = un; } catch { /* ignore */ }
    }
    this.checkResetEpoch();
    this.processRemote();
    this.vinson?.attach(this);
  }

  /**
   * Global "owner reset everyone" epoch (server config `features.resetEpoch`, seconds). When it advances past
   * the last one seen on this device: drop the local admin session/server token, turn off infinite coins, set
   * the local UT balance to 5000, and toast once. Owner Access re-entry with the code still works afterwards.
   */
  async checkResetEpoch() {
    if (!this.online || !this.online.config) return;
    try {
      // Profiles with a server identity: the server decides (presence.resetDue — only profiles that existed before
      // the reset, at most once per reset, acknowledged below). Devices without a profile: first sight of an epoch
      // is recorded without resetting (never reset newcomers); only a later, newer epoch applies.
      let due = null;
      const last = this.online.presence && this.online.presence.last;
      const hasProfile = typeof this.online.hasIdentity === 'function' && this.online.hasIdentity();
      if (hasProfile && last && 'resetDue' in last) due = last.resetDue || null;
      else if (!hasProfile) {
        let epoch = 0;
        if (typeof this.online.config.value === 'function') epoch = Number(this.online.config.value('features.resetEpoch', 0)) || 0;
        if (!epoch) return;
        const seen = load('resetEpochSeen', null);
        if (seen === null || !(Number(seen) >= 0)) { save('resetEpochSeen', epoch); return; }
        if (epoch > Number(seen)) due = epoch;
      }
      if (!due) return;
      const ack = () => { if (hasProfile && this.online.account && typeof this.online.account.ackReset === 'function') safeCall(() => this.online.account.ackReset(due)); };
      if (hasProfile) {
        const cur = this.online.account && typeof this.online.account.current === 'function' ? this.online.account.current() : null;
        const k = `resetApplied.${(cur && cur.id) || 'device'}`;
        if (Number(load(k, 0)) >= due) { ack(); return; } // already applied here; just (re)acknowledge
        save(k, due);
      }
      save('resetEpochSeen', Math.max(due, Number(load('resetEpochSeen', 0)) || 0));
      ack();
      clearAdminSession();
      try { this.online.admin && typeof this.online.admin.forget === 'function' && this.online.admin.forget(); } catch { /* ignore */ }
      if (this.ut) {
        walletSetInfinite(this.ut, false, { realBalance: 5000 });
        this.ut.coins = 5000;
        this.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0, unsub: this.wallet.unsub };
        this.saveUT();
      }
      if (this.destroyed) return;
      this.refresh();
      this.toast('Economy reset by the owner', 'warn');
    } catch { /* never throws */ }
  }

  /**
   * Everything the server asks of this device's club, applied to the live UT save (core/remote.js):
   *  - per-profile reset epochs ("Reset coins / progress / club / account"): applied once, first sight only records;
   *  - owner patches (add / remove / edit cards, reset club...): applied before any upload, acknowledged once the
   *    patched club is on the server.
   * Then the cloud copy is synced so the server matches this device. Never throws.
   */
  async processRemote({ usePresence = false } = {}) {
    if (this.remoting || this.destroyed || !this.online) return null;
    this.remoting = true;
    try {
      const cloud = globalThis.__pitchsideCloud;
      const hasCloud = !!(cloud && typeof cloud.syncNow === 'function');
      const res = await syncRemote({
        online: this.online, state: this.ut, cloud: hasCloud, usePresence,
        // coins: the server wallet is 5 000 now; drop the local wallet link BEFORE saving so no delta is sent
        onApply: (kinds) => { if (kinds.includes('coins')) this.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0, unsub: this.wallet.unsub }; },
        persist: () => this.saveUT() !== false,
      });
      if (!res || this.destroyed) return res;
      if (res.resets.includes('coins')) safeCall(() => this.refreshOnlineCoins());
      if ((res.resets.length || res.patches) && hasCloud) safeCall(() => cloud.syncNow());
      if (res.changed || res.notices.length) {
        try { globalThis.__pitchsideVinson?.reload?.(); } catch { /* ignore */ }
        for (const n of res.notices) this.toast(n, 'warn');
        this.refresh();
      }
      return res;
    } finally { this.remoting = false; }
  }
  /** Compat alias (older callers / tests). */
  applyOwnerPatches() { return this.processRemote(); }
  /** The cloud sync replaced the local club (login on a new device, or another device saved newer): pick it up. */
  reloadUT() {
    if (this.destroyed) return;
    this.ut = loadUT();
    if (this.ut) normalizeWallet(this.ut);
    this.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0, unsub: this.wallet.unsub };
    this.refresh();
  }
  /** The owner deleted this profile: nothing of its club may be written back. Storage is wiped, the hub shows a fresh start. */
  onIdentityDeleted() {
    if (this.destroyed) return;
    wipeLocalProfile();
    this.ut = null;
    this.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0, unsub: this.wallet.unsub };
    try { globalThis.__pitchsideVinson?.reload?.(); } catch { /* ignore */ }
    this.reset(hubView());
    this.toast(DELETED_MESSAGE, 'bad');
  }
  /** Owner changed the server config (Store packs on/off, prices...): redraw the Store / UT home right away when
   * one is on screen, so players see it without reloading. Skipped while the player is typing or a dialog is open. */
  refreshLiveConfig() {
    try {
      const v = this.stack[this.stack.length - 1];
      if (this.destroyed || !v || !v.liveConfig) return;
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (document.querySelector('.pm-modal, .pm-po, [role="dialog"][aria-modal="true"]')) return;
      this.refresh();
    } catch { /* never throws */ }
  }
  /** Owner "Revoke ALL admin" (config features.adminRevokeAt, unix s): drop this device's admin session once. */
  checkAdminRevoke() {
    try {
      if (!this.online || !this.online.config || typeof this.online.config.value !== 'function') return;
      const at = Number(this.online.config.value('features.adminRevokeAt', 0)) || 0;
      const seen = Number(load('adminRevokeSeen', 0)) || 0;
      if (!at || at <= seen) return;
      save('adminRevokeSeen', at);
      if (Date.now() / 1000 - at > 12 * 3600) return; // older than any admin session: nothing to revoke here
      if (!getAdminLevel()) return;
      clearAdminSession();
      try { if (this.online.admin && typeof this.online.admin.forget === 'function') this.online.admin.forget(); } catch { /* ignore */ }
      if (!this.destroyed) { this.toast('All admin access was revoked by the owner.', 'warn'); this.refresh(); }
    } catch { /* never throws */ }
  }
  /** Owner restrictions (presence): 'admin' / 'codes' drop any admin session on this device. */
  applyRestrictions(r) {
    if (!r || typeof r !== 'object') return;
    if ((r.admin || r.codes) && getAdminLevel()) {
      clearAdminSession();
      try { if (this.online.admin && typeof this.online.admin.forget === 'function') this.online.admin.forget(); } catch { /* ignore */ }
      this.toast('The owner has restricted admin access on your account.', 'warn');
      if (!this.destroyed) this.refresh();
    }
  }
  /** True when the owner restricted this feature ('packs' | 'market' | 'messages' | 'codes' | 'admin'). */
  restricted(key) {
    try { return !!(this.online && this.online.admin && typeof this.online.admin.restricted === 'function' && this.online.admin.restricted(key)); } catch { return false; }
  }

  saveSettings() { save(SETTINGS_KEY, this.settings); }

  // ---- navigation ----
  push(view) {
    if (hasDoomEffects(this.ut?.vinson?.phase) && !isOwner(this.online) && this.stack.some(v => v.utHome) && !view.utHome) return;
    this.runCleanup(); this.stack.push(view); this.render(true); }
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
    const inf = isInfinite(this.ut);
    const online = this.wallet.mode === 'online';
    const val = cleanCoins(this.ut.coins, 0);
    const num = h('span', { class: 'pm-coins-n', 'data-coins': inf ? 'inf' : String(val) }, inf ? infNodes('∞') : fmtNum(val));
    // FC-style currency readout: coin + number (count-up), with a small status dot on the coin (online = server wallet)
    const chip = h('div', { class: `pm-coins ${online ? 'is-online' : 'is-local'} ${inf ? 'is-inf' : ''}`, title: online ? 'Coins: online balance (server)' : 'Coins: local balance (this device)' },
      h('span', { class: 'pm-coins-ico', 'aria-hidden': 'true' }, h('i', { class: 'pm-coin' }), h('i', { class: 'pm-coins-dot' })),
      num, h('span', { class: 'pm-sr' }, online ? ' coins, online balance' : ' coins, local balance'));
    if (inf) this.coinAnim = null; else this.animateCoins(num, val);
    return chip;
  }
  /**
   * The ONE animated coin display: every coin change (match rewards, market sales, gifts, SBCs, packs, admin)
   * re-renders the top bar, and the chip counts up/down from the value it showed last — continuing smoothly
   * when a new change lands mid-animation.
   */
  animateCoins(el, to, ms = 700) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const a = this.coinAnim;
    let from = to;
    if (a) {
      const p = Math.min(1, (now - a.t0) / a.ms);
      from = p >= 1 ? a.to : Math.round(a.from + (a.to - a.from) * (1 - Math.pow(1 - p, 3)));
    }
    const anim = { from, to, t0: now, ms };
    this.coinAnim = anim;
    if (from === to || typeof requestAnimationFrame !== 'function') return;
    el.textContent = fmtNum(from);
    el.style.color = to > from ? '#7dffc4' : '#ff9a9a';
    const step = (t) => {
      if (this.coinAnim !== anim || !el.isConnected) return;
      const p = Math.min(1, (t - anim.t0) / anim.ms);
      el.textContent = fmtNum(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step); else { el.textContent = fmtNum(to); el.style.color = ''; }
    };
    requestAnimationFrame(step);
  }
  /** Infinite coins on/off without ever losing the real balance (local: stash; online: server balance). */
  setInfiniteCoins(on) {
    const s = this.ut;
    if (!s) return;
    const w = this.wallet;
    if (on) walletSetInfinite(s, true);
    else if (w.mode === 'online') {
      this.saveUT(); // settles + sends any coins earned while infinite
      walletSetInfinite(s, false, { realBalance: cleanCoins(w.synced, 0) });
      w.synced = s.coins;
      if (w.infiniteServer && this.online && this.online.owner && typeof this.online.owner.setInfinite === 'function') {
        w.infiniteServer = false;
        safeCall(() => this.online.owner.setInfinite(false), { ok: false }).then(() => this.refreshOnlineCoins());
      } else this.refreshOnlineCoins();
    } else walletSetInfinite(s, false);
    this.saveUT();
    this.topRefresh();
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
    if (this.wallet.mode !== 'online') this.wallet.local = realCoins(s);
    this.wallet.mode = 'online';
    this.wallet.synced = bal;
    if (!(s.admin && s.admin.infinite)) s.coins = bal;
    // balance changes seen anywhere (seller credited, gifts, rewards, presence) update the top bar at once
    if (!this.wallet.unsub && typeof this.online.coins.onChange === 'function') {
      // lives as long as the app (a per-view cleanup used to drop it on the first navigation, so server
      // balance changes — owner grants, sales, gifts — stopped reaching the top bar)
      this.wallet.unsub = this.online.coins.onChange((b) => { if (!this.destroyed) this.setOnlineBalance(b); });
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
    if (s.vinson?.phase === 'locked') enforceLock(s);
    const w = this.wallet;
    if (isInfinite(s)) {
      // spends are free; earnings are kept (local: in the stash; online: sent to the server wallet)
      const earned = settleInfinite(s, { stash: w.mode !== 'online' });
      if (w.mode === 'online' && earned > 0) {
        w.inflight++;
        w.pending = w.pending.then(async () => {
          const r = await safeCall(() => this.online.coins.add(earned, 'ut-earn'), { ok: false });
          w.inflight--;
          const b = coinNum(r);
          if (r && r.ok !== false && Number.isFinite(b)) w.synced = b;
        });
      }
      // online: make the server wallet infinite too, so real-market buys / spends succeed (owner powers needed)
      if (w.mode === 'online' && !w.infiniteServer && this.online.owner && this.online.admin && typeof this.online.admin.canOwner === 'function' && this.online.admin.canOwner()) {
        w.infiniteServer = true;
        safeCall(() => this.online.owner.setInfinite(true), { ok: false }).then((r) => { if (!r || !r.ok) w.infiniteServer = false; });
      }
    } else if (w.mode === 'online') {
      if (!Number.isFinite(Number(s.coins))) s.coins = cleanCoins(w.synced, 0);
      if (!Number.isFinite(Number(w.synced))) w.synced = cleanCoins(s.coins, 0);
      const delta = Math.round(s.coins - w.synced);
      if (delta) {
        w.synced = s.coins;
        w.inflight++;
        w.pending = w.pending.then(async () => {
          const r = await safeCall(() => this.online.coins.add(delta, delta > 0 ? 'ut-earn' : 'ut-spend'), { ok: false });
          w.inflight--;
          if (!r || r.ok === false) { this.toast('Online coin sync failed. Balance refreshed from server.', 'warn'); const b = coinNum(await safeCall(() => this.online.coins.get())); if (Number.isFinite(b) && this.ut) { w.synced = b; this.ut.coins = b; } }
          else { const b = coinNum(r); if (Number.isFinite(b) && w.inflight === 0 && this.ut) { w.synced = b; this.ut.coins = b; } }
          this.topRefresh();
        });
      }
    } else s.coins = cleanCoins(s.coins, 0);
    if (w.mode !== 'online') return saveUT(s);
    // online: the device file keeps the real LOCAL balance (never the server's, never INFINITE_COINS)
    const local = cleanCoins(w.local, 0);
    return saveUT(isInfinite(s) ? { ...s, coins: local, admin: { ...s.admin, stash: local } } : { ...s, coins: local });
  }

  // ---- matches ----
  /** Calls the host startMatch. Returns result, or null when abandoned/failed. */
  async playMatch(home, away, opts) {
    // Curse state belongs to the saved squad, not a match Team assembled by a mode.
    // Some builders can omit / replace a slot, which must not bypass the locked curse.
    const vinsonCurse = cursedPack(this.ut) && !isOwner(this.online);
    for (const [side, t] of [['home', home], ['away', away]]) {
      const errs = validateTeam(t);
      if (errs.length) { this.toast(`Invalid ${side} team: ${errs[0]}`, 'bad'); console.warn('[meta] invalid team', side, errs); return null; }
    }
    if (typeof this.startMatchFn !== 'function') { this.toast('Match engine not available', 'bad'); return null; }
    const busy = h('div', { class: 'pm-busy', role: 'status' }, h('div', { class: 'pm-spinner' }), h('div', null, `${home.name} vs ${away.name}`), h('small', null, 'Match in progress…'));
    this.root.appendChild(busy);
    try {
      const lvl = getAdminLevel(); const matchLevel = lvl === 'super' || lvl === 'full' ? 'owner' : lvl === 'mod' ? 'mod' : null;
      const res = await this.startMatchFn(home, away, { ...opts, vinsonCurse, adminLevel: matchLevel });
      if (this.destroyed) return null;
      if (res?.reason === 'vinson_curse') return null;
      if (!res || res.abandoned) { this.toast('Match abandoned. No result recorded.', 'warn'); return null; }
      return res;
    } catch (err) {
      console.error('[meta] startMatch failed', err);
      this.toast('The match could not be started.', 'bad');
      return null;
    } finally { busy.remove(); }
  }

  destroy() {
    this.destroyed = true;
    this.vinson?.detach(this);
    this.runCleanup();
    if (this.accountUnsub) { try { this.accountUnsub(); } catch { /* ignore */ } }
    if (this.configUnsub) { try { this.configUnsub(); } catch { /* ignore */ } }
    if (this.presenceUnsub) { try { this.presenceUnsub(); } catch { /* ignore */ } }
    if (this.deletedUnsub) { try { this.deletedUnsub(); } catch { /* ignore */ } }
    if (this.wallet && this.wallet.unsub) { try { this.wallet.unsub(); } catch { /* ignore */ } this.wallet.unsub = null; }
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
    if (done.length) msgs.push(`${done.length} objective${done.length > 1 ? 's' : ''} complete: claim in Objectives`);
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
        return h('li', null, `${p ? p.name : '-'} ${s.minute}'`);
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
