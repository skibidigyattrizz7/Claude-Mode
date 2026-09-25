// Meta UI shell: view stack, top bar, hub, shared match + result screens.
import { h, clear, toast, fmtNum, add } from './dom.js';
import { load, save } from '../core/storage.js';
import { validateTeam } from '../core/teams.js';
import { utHomeView, ensureUTView } from './utview.js';
import { careerHomeView } from './careerview.js';
import { loadUT } from '../core/ut.js';

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
  constructor(container, { startMatch, onExit = null } = {}) {
    this.container = container;
    this.startMatchFn = startMatch;
    this.onExit = onExit;
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
      h('div', { class: 'pm-top-right' }, v.coins && this.ut ? h('div', { class: 'pm-coins', title: 'Coins' }, h('i', { 'aria-hidden': 'true' }), fmtNum(this.ut.coins)) : null, v.topRight ? v.topRight(this) : null),
    );
  }

  toast(msg, kind) { toast(this.root, msg, kind); }

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
      const res = await this.startMatchFn(home, away, opts);
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
    document.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  showUltimateTeam() { this.reset(hubView()); this.push(ensureUTView(this)); }
  showCareer() { this.reset(hubView()); this.push(careerHomeView()); }
}

export function hubView() {
  return {
    title: 'Game Modes', kicker: 'Pitchside 3D',
    render(main, app) {
      add(main, h('div', { class: 'pm-hub' },
        h('button', { class: 'pm-tile pm-tile--hero pm-tile--ut', 'data-autofocus': '1', onclick: () => app.push(app.ut ? utHomeView() : ensureUTView(app)) },
          h('div', { class: 'pm-tile-art pm-art-ut', 'aria-hidden': 'true' }, h('span', null, 'PUT')),
          h('div', { class: 'pm-tile-body' }, h('div', { class: 'pm-kicker' }, 'Build your dream squad'), h('h2', null, 'Pitchside Ultimate Team'), h('p', null, 'Open packs, complete SBCs, climb Squad Battles.'))),
        h('button', { class: 'pm-tile pm-tile--hero pm-tile--career', onclick: () => app.push(careerHomeView()) },
          h('div', { class: 'pm-tile-art pm-art-career', 'aria-hidden': 'true' }, h('span', null, 'CM')),
          h('div', { class: 'pm-tile-body' }, h('div', { class: 'pm-kicker' }, 'Manage a club'), h('h2', null, 'Career Mode'), h('p', null, 'Seasons, transfers, youth, promotion and glory.'))),
      ));
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
          h('div', { class: 'pm-score-num' }, h('span', null, result.homeGoals), h('i', null, '–'), h('span', null, result.awayGoals),
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
