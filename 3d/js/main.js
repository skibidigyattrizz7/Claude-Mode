// Pitchside 3D — app shell: main menu, team select, settings, controls rebinding, result screen,
// and the startMatch() wrapper around the engine's createMatch(). Engine + meta are loaded with
// dynamic import() so a broken module shows a friendly error instead of a blank page.
import { DEFAULT_KEYBINDS, loadKeybinds, saveKeybinds, resetKeybinds } from './shared/keybinds.js';
import { dedupeTeams } from './net/protocol.js';

const Q = new URLSearchParams(location.search);
const STUB_ENGINE = Q.get('stubEngine') === '1';

// ------------------------------------------------------------------ tiny DOM helper
export function h(tag, attrs, ...kids) {
  const el = tag === 'svg' || tag === 'path' || tag === 'text' || tag === 'g' || tag === 'rect' || tag === 'circle'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

// ------------------------------------------------------------------ storage
function lsGet(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch { return fallback; }
}
function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

const SETTINGS_KEY = 'pitchside.settings';
const DEFAULT_SETTINGS = { difficulty: 'pro', halfMinutes: 3, camera: 'broadcast', volume: 70, quality: 'med', stadium: 'day' };
const DIFFICULTIES = [['amateur', 'Amateur'], ['pro', 'Pro'], ['world', 'World Class'], ['legendary', 'Legendary']];
const HALF_LENGTHS = [2, 3, 4, 6, 8];
const CAMERAS = [['broadcast', 'Broadcast'], ['pro', 'Pro (player lock)']];
const QUALITIES = [['low', 'Low'], ['med', 'Medium'], ['high', 'High']];
const STADIUMS = [['day', 'Day'], ['night', 'Night']];

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...lsGet(SETTINGS_KEY, {}) };
  if (!DIFFICULTIES.some(([k]) => k === s.difficulty)) s.difficulty = DEFAULT_SETTINGS.difficulty;
  if (!Number.isFinite(s.halfMinutes) || s.halfMinutes < 1 || s.halfMinutes > 10) s.halfMinutes = 3;
  if (!CAMERAS.some(([k]) => k === s.camera)) s.camera = DEFAULT_SETTINGS.camera;
  if (!QUALITIES.some(([k]) => k === s.quality)) s.quality = DEFAULT_SETTINGS.quality;
  if (!Number.isFinite(s.volume)) s.volume = 70;
  s.volume = Math.max(0, Math.min(100, Math.round(s.volume)));
  if (s.stadium !== 'night') s.stadium = 'day';
  return s;
}
function saveSettings(s) { lsSet(SETTINGS_KEY, s); }

// ------------------------------------------------------------------ module loading
let enginePromise = null;
let metaPromise = null;
let engineTries = 0;
let metaTries = 0;
// A failed dynamic import is cached by the browser, so retries use a fresh URL.
const retryUrl = (path, n) => (n > 1 ? `${path}?retry=${n}` : path);

function loadEngine() {
  if (!enginePromise) {
    enginePromise = (STUB_ENGINE ? Promise.resolve({ createMatch: stubCreateMatch }) : import(retryUrl('./engine/index.js', ++engineTries)))
      .then((m) => {
        if (typeof m.createMatch !== 'function') throw new Error('engine/index.js does not export createMatch()');
        return m;
      })
      .catch((e) => { enginePromise = null; throw e; });
  }
  return enginePromise;
}
function loadMeta() {
  if (!metaPromise) {
    metaPromise = import(retryUrl('./meta/index.js', ++metaTries))
      .then((m) => {
        for (const fn of ['mountMeta', 'getNationalTeams', 'getSavedUltimateTeam']) {
          if (typeof m[fn] !== 'function') throw new Error(`meta/index.js does not export ${fn}()`);
        }
        return m;
      })
      .catch((e) => { metaPromise = null; throw e; });
  }
  return metaPromise;
}
let teamCache = null;
async function getTeams() {
  if (teamCache) return teamCache;
  const meta = await loadMeta();
  const teams = meta.getNationalTeams();
  if (!Array.isArray(teams) || !teams.length) throw new Error('getNationalTeams() returned no teams');
  teamCache = teams;
  return teams;
}
async function getSavedUT() {
  try { const meta = await loadMeta(); return meta.getSavedUltimateTeam() || null; } catch { return null; }
}

// ------------------------------------------------------------------ team helpers
export function teamOvr(t) {
  const ps = (t && t.players) || [];
  if (!ps.length) return 0;
  return Math.round(ps.reduce((s, p) => s + (Number(p.ovr) || 0), 0) / ps.length);
}
function lineRatings(t) {
  const groups = { ATT: ['ST', 'CF', 'LW', 'RW'], MID: ['CM', 'CDM', 'CAM', 'LM', 'RM'], DEF: ['CB', 'LB', 'RB', 'LWB', 'RWB', 'GK'] };
  const out = {};
  for (const [g, pos] of Object.entries(groups)) {
    const ps = t.players.filter((p) => pos.includes(p.pos));
    out[g] = ps.length ? Math.round(ps.reduce((s, p) => s + p.ovr, 0) / ps.length) : teamOvr(t);
  }
  return out;
}
function starsFor(ovr) {
  const s = ovr >= 86 ? 5 : ovr >= 83 ? 4.5 : ovr >= 80 ? 4 : ovr >= 77 ? 3.5 : ovr >= 74 ? 3 : ovr >= 70 ? 2.5 : ovr >= 65 ? 2 : 1.5;
  const el = h('span', { class: 'stars', 'aria-label': `${s} stars` });
  for (let i = 1; i <= 5; i++) el.append(h('i', { class: i <= s ? 'on' : i - 0.5 === s ? 'half' : '' }));
  return el;
}

/** Simple shirt icon in the team's kit colours. */
export function shirtSVG(kit, number = '', size = 64) {
  const k = kit || {};
  const svg = h('svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'shirt', 'aria-hidden': 'true' });
  svg.append(
    h('path', { d: 'M8 28 L30 10 L40 10 L60 10 L70 10 L92 28 L82 44 L72 38 L72 92 L28 92 L28 38 L18 44 Z', fill: k.primary || '#ccc', stroke: 'rgba(0,0,0,.35)', 'stroke-width': '2', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M8 28 L30 10 L28 38 L18 44 Z M92 28 L70 10 L72 38 L82 44 Z', fill: k.secondary || '#555' }),
    h('path', { d: 'M40 10 Q50 22 60 10', fill: 'none', stroke: k.secondary || '#555', 'stroke-width': '5' }),
    h('rect', { x: '28', y: '84', width: '44', height: '8', fill: k.shorts || k.secondary || '#333', opacity: '.9' }),
  );
  if (number !== '') {
    const t = h('text', { x: '50', y: '66', 'text-anchor': 'middle', 'font-size': '30', 'font-weight': '900', fill: k.number || '#111', 'font-family': 'system-ui, sans-serif' });
    t.textContent = String(number);
    svg.append(t);
  }
  return svg;
}

function kitDot(kit) {
  return h('span', { class: 'kitdot', style: { background: `linear-gradient(135deg, ${kit.primary} 0 55%, ${kit.secondary} 55% 100%)` } });
}

// ------------------------------------------------------------------ navigation
const app = document.getElementById('app');
const stack = []; // { el, name, destroy? }

function show(screen) {
  for (const s of stack) s.el.hidden = s !== screen;
  app.dataset.screen = screen.name;
  window.scrollTo(0, 0);
  const f = screen.el.querySelector('[data-autofocus]');
  if (f) f.focus({ preventScroll: true });
}
export const nav = {
  push(screen) {
    stack.push(screen);
    app.append(screen.el);
    show(screen);
  },
  replace(screen) {
    const old = stack.pop();
    if (old) { old.el.remove(); if (old.destroy) old.destroy(); }
    nav.push(screen);
  },
  back() {
    if (stack.length <= 1) return;
    const old = stack.pop();
    old.el.remove();
    if (old.destroy) old.destroy();
    show(stack[stack.length - 1]);
    if (stack[stack.length - 1].onReturn) stack[stack.length - 1].onReturn();
  },
  home() {
    while (stack.length > 1) {
      const old = stack.pop();
      old.el.remove();
      if (old.destroy) old.destroy();
    }
    show(stack[0]);
  },
  get top() { return stack[stack.length - 1]; },
};

function screenShell(name, title, kicker, ...body) {
  const el = h('section', { class: `screen screen--${name}`, 'aria-label': title },
    h('header', { class: 'topbar' },
      h('button', { class: 'back', type: 'button', 'aria-label': 'Back', onclick: (e) => (e.currentTarget.closest('.screen')._back || (() => nav.back()))() }, h('span', { 'aria-hidden': 'true' }, '‹'), h('span', { class: 'back-t' }, 'Back')),
      h('div', { class: 'topbar-title' }, kicker ? h('div', { class: 'kicker' }, kicker) : null, h('h1', null, title)),
      h('div', { class: 'topbar-logo', 'aria-hidden': 'true' }, 'P3D')),
    h('div', { class: 'screen-body' }, ...body));
  return el;
}

export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2200);
}

function errorTile(title, err, retry) {
  console.error(`[pitchside] ${title}`, err);
  return h('div', { class: 'error-tile', role: 'alert' },
    h('div', { class: 'error-ico', 'aria-hidden': 'true' }, '!'),
    h('h2', null, title),
    h('p', null, 'This part of the game could not be loaded. The rest of Pitchside still works.'),
    h('code', null, String((err && err.message) || err).slice(0, 300)),
    h('div', { class: 'row' },
      retry ? h('button', { class: 'btn btn--primary', type: 'button', onclick: retry }, 'Try again') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => nav.home() }, 'Main menu')));
}

// ------------------------------------------------------------------ segmented control
function segmented(label, options, value, onChange, name) {
  const wrap = h('div', { class: 'field' }, h('div', { class: 'field-label', id: `lbl-${name}` }, label));
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': `lbl-${name}`, 'data-name': name });
  const btns = options.map(([v, text]) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', 'data-value': String(v) }, text);
    b.addEventListener('click', () => {
      for (const o of btns) { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', String(o === b)); }
      onChange(v);
    });
    return b;
  });
  seg.append(...btns);
  wrap.append(seg);
  return wrap;
}

// ------------------------------------------------------------------ team picker
/**
 * options: [{ team, label?, tag?, disabled?, note? }]
 * Returns { el, get value(), set(i) }.
 */
export function teamPicker({ title, options, index = 0, onChange, sideClass = '' }) {
  let i = Math.max(0, Math.min(options.length - 1, index));
  if (options[i] && options[i].disabled) i = options.findIndex((o) => !o.disabled);
  const el = h('div', { class: `picker ${sideClass}` });
  const render = () => {
    const o = options[i];
    const t = o.team;
    el.replaceChildren(
      h('div', { class: 'picker-head' }, h('span', { class: 'picker-side' }, title), o.tag ? h('span', { class: 'tag' }, o.tag) : null),
      h('div', { class: 'picker-main' },
        h('button', { class: 'arrow', type: 'button', 'aria-label': `Previous team for ${title}`, onclick: () => step(-1) }, '‹'),
        h('button', { class: 'picker-card', type: 'button', 'aria-label': `${title}: ${t.name}. Browse teams`, onclick: openGrid, style: { '--kit1': t.kit.primary, '--kit2': t.kit.secondary } },
          h('div', { class: 'picker-shirt' }, shirtSVG(t.kit, 10, 96)),
          h('div', { class: 'picker-name' }, o.label || t.name),
          h('div', { class: 'picker-meta' }, h('b', { class: 'ovr' }, teamOvr(t)), h('span', null, 'OVR'), starsFor(teamOvr(t))),
          (() => { const r = lineRatings(t); return h('div', { class: 'picker-lines' }, ['ATT', 'MID', 'DEF'].map((k) => h('span', null, h('small', null, k), h('b', null, r[k])))); })(),
          h('div', { class: 'picker-form' }, t.formation)),
        h('button', { class: 'arrow', type: 'button', 'aria-label': `Next team for ${title}`, onclick: () => step(1) }, '›')),
    );
  };
  const step = (d) => {
    let j = i;
    for (let n = 0; n < options.length; n++) {
      j = (j + d + options.length) % options.length;
      if (!options[j].disabled) break;
    }
    i = j;
    render();
    if (onChange) onChange(options[i].team, i);
  };
  function openGrid() {
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); el.querySelector('.picker-card')?.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const grid = h('div', { class: 'grid-teams' }, options.map((o, j) => h('button', {
      type: 'button', class: `gt ${j === i ? 'on' : ''}`, disabled: o.disabled || null, title: o.note || null,
      onclick: () => { i = j; render(); close(); if (onChange) onChange(options[i].team, i); },
    }, kitDot(o.team.kit), h('span', { class: 'gt-name' }, o.label || o.team.name), o.disabled ? h('small', null, o.note || 'Unavailable') : h('b', null, teamOvr(o.team)))));
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-label': `Choose team for ${title}` },
        h('div', { class: 'modal-head' }, h('h2', null, `Choose ${title}`), h('button', { class: 'btn btn--ghost', type: 'button', onclick: close, 'aria-label': 'Close' }, '✕')),
        grid));
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    (grid.querySelector('.gt.on') || grid.querySelector('.gt'))?.focus();
  }
  render();
  return {
    el,
    get value() { return options[i].team; },
    get index() { return i; },
    set(j) { if (options[j] && !options[j].disabled) { i = j; render(); } },
  };
}

// ------------------------------------------------------------------ match launching
const matchState = { active: null };

/**
 * Open a full-screen match. Returns { handle, done: Promise<result>, overlay, close() }.
 * `opts` go to createMatch (defaults from settings; `userSide` -> controllers when none given).
 */
export async function openMatch(opts) {
  const eng = await loadEngine();
  const s = loadSettings();
  const layer = h('div', { class: 'match-layer', tabindex: '-1' });
  const stage = h('div', { class: 'match-stage' });
  const overlay = h('div', { class: 'match-overlay' });
  layer.append(stage, overlay);
  document.body.append(layer);
  document.body.classList.add('in-match');
  const prevFocus = document.activeElement;
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const controllers = opts.controllers || (opts.userSide === 'away' ? { home: 'ai', away: 'p1' } : { home: 'p1', away: 'ai' });
  const userOnEnd = opts.onEnd;
  const userOnEvent = opts.onEvent;
  const full = {
    halfMinutes: s.halfMinutes, difficulty: s.difficulty, stadium: s.stadium, netRole: 'local',
    camera: s.camera, quality: s.quality, volume: s.volume / 100,
    ...opts,
    controllers,
    keybinds: loadKeybinds(),
    onEvent: (e) => { if (userOnEvent) try { userOnEvent(e); } catch (err) { console.error(err); } },
    onEnd: (r) => { if (userOnEnd) try { userOnEnd(r); } catch (err) { console.error(err); } resolve(r); },
  };
  delete full.userSide;
  if (Q.get('timeScale')) full.timeScale = Number(Q.get('timeScale')); // dev/testing: fast-forward the sim
  let handle = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { if (handle) handle.destroy(); } catch (e) { console.warn('[pitchside] destroy failed', e); }
    layer.remove();
    document.body.classList.remove('in-match');
    if (matchState.active === ctl) matchState.active = null;
    try { if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  const ctl = { get handle() { return handle; }, done, overlay, layer, close };
  try {
    handle = eng.createMatch(stage, full);
    if (!handle || typeof handle.destroy !== 'function') throw new Error('createMatch() did not return a MatchHandle');
  } catch (e) {
    close();
    throw e;
  }
  matchState.active = ctl;
  // keep focus inside the match so menu/meta Escape handlers don't fire on <body>
  try { if (!layer.contains(document.activeElement)) layer.focus({ preventScroll: true }); } catch { /* ignore */ }
  return ctl;
}

/** startMatch(home, away, opts) -> Promise<result>. Handed to mountMeta and used by Kick-Off. */
export async function startMatch(home, away, opts = {}) {
  const m = await openMatch({ ...opts, home, away });
  try { return await m.done; } finally { m.close(); }
}

// ------------------------------------------------------------------ stub engine (?stubEngine=1)
function stubCreateMatch(container, opts) {
  const ms = Math.max(200, Number(Q.get('stubMs')) || 1000);
  const log = (window.__stub = window.__stub || { created: 0, remoteInputs: 0, snapshotsApplied: 0, snapshotsTaken: 0, lastInput: null, lastOpts: null, destroyed: 0 });
  log.created++;
  log.lastOpts = { ...opts, home: opts.home && opts.home.name, away: opts.away && opts.away.name, keybinds: opts.keybinds };
  let t0 = performance.now();
  let paused = false;
  let pausedAt = 0;
  let score = [0, 0];
  const el = h('div', { class: 'stub-match' },
    h('div', { class: 'stub-badge' }, 'STUB ENGINE'),
    h('h2', null, `${opts.home.name} vs ${opts.away.name}`),
    h('p', null, `${opts.netRole} · ${opts.controllers.home} vs ${opts.controllers.away} · ${opts.difficulty} · ${opts.halfMinutes} min halves · ${opts.stadium}`),
    h('div', { class: 'stub-clock' }, '0\''));
  container.append(el);
  const clock = el.querySelector('.stub-clock');
  const tick = setInterval(() => {
    if (paused) return;
    const f = Math.min(1, (performance.now() - t0) / ms);
    clock.textContent = `${Math.round(f * 90)}'  ${score[0]} - ${score[1]}`;
    if (opts.netRole === 'guest') return;
    if (f >= 0.5 && score[0] + score[1] === 0) { score = [1, 0]; opts.onEvent?.({ type: 'goal', team: 'home', minute: 45 }); }
    if (f >= 1) {
      clearInterval(tick);
      const hp = opts.home.players, ap = opts.away.players;
      const ratings = {};
      hp.concat(ap).forEach((p, i) => { ratings[p.id] = 6 + ((i * 37) % 30) / 10; });
      ratings[hp[9].id] = 9.1;
      opts.onEnd({
        homeGoals: 2, awayGoals: 1,
        scorers: [{ playerId: hp[9].id, team: 'home', minute: 23 }, { playerId: ap[10].id, team: 'away', minute: 51 }, { playerId: hp[9].id, team: 'home', minute: 88 }],
        stats: { possession: [54, 46], shots: [11, 7], shotsOnTarget: [5, 3], passes: [412, 356] },
        playerRatings: ratings,
      });
    }
  }, 50);
  let n = 0;
  return {
    pause() { if (!paused) { paused = true; pausedAt = performance.now(); } },
    resume() { if (paused) { paused = false; t0 += performance.now() - pausedAt; } },
    destroy() { clearInterval(tick); el.remove(); log.destroyed++; },
    setRemoteInput(side, input) { log.remoteInputs++; log.lastInput = { side, input }; },
    getSnapshot() { log.snapshotsTaken++; return { t: performance.now() - t0, sc: score }; },
    applySnapshot(snap) { log.snapshotsApplied++; log.lastSnap = snap; if (snap && Array.isArray(snap.sc)) score = snap.sc; },
    getLocalInput() {
      n++;
      return { mx: Math.sin(n / 5), my: 0, aimX: 0, aimY: 0, sprint: n % 20 < 10, pass: false, through: false, lob: false, shoot: false, shootPower: 0, switchP: false, tackle: false, skill: false, finesse: false };
    },
  };
}

// ------------------------------------------------------------------ result screen
/**
 * Render a result into a fresh element.
 * actions: [{ label, primary?, onClick(btn) }]
 */
export function renderResult({ home, away, result, title = 'Full Time', kicker = '', actions = [], note = '' }) {
  const all = home.players.concat(home.bench || []).map((p) => ({ p, side: 'home', team: home }))
    .concat(away.players.concat(away.bench || []).map((p) => ({ p, side: 'away', team: away })));
  const byId = new Map(all.map((x) => [x.p.id, x]));
  const scorerList = (side) => h('ul', { class: 'scorers' }, (result.scorers || []).filter((s) => s.team === side).map((s) => {
    const x = byId.get(s.playerId);
    return h('li', null, h('span', { class: 'ball', 'aria-hidden': 'true' }), `${x ? x.p.name : 'Unknown'} ${s.minute}'${s.ownGoal ? ' (OG)' : ''}`);
  }));
  const st = result.stats || {};
  const statRow = (label, arr, pct) => {
    if (!Array.isArray(arr)) return null;
    const a = Number(arr[0]) || 0, b = Number(arr[1]) || 0;
    const tot = a + b;
    const fa = tot ? (a / tot) * 100 : 50;
    return h('div', { class: 'srow' },
      h('b', null, `${a}${pct ? '%' : ''}`),
      h('div', { class: 'sbar-wrap' }, h('div', { class: 'slabel' }, label),
        h('div', { class: 'sbar', style: { '--c1': home.kit.primary, '--c2': away.kit.primary } },
          h('i', { class: 'l', style: { width: `${fa}%` } }), h('i', { class: 'r', style: { width: `${100 - fa}%` } }))),
      h('b', null, `${b}${pct ? '%' : ''}`));
  };
  let potm = null;
  for (const [id, r] of Object.entries(result.playerRatings || {})) {
    const x = byId.get(id);
    if (x && typeof r === 'number' && (!potm || r > potm.r)) potm = { ...x, r };
  }
  const hg = result.homeGoals | 0, ag = result.awayGoals | 0;
  const el = h('div', { class: 'result' },
    h('div', { class: 'result-kicker' }, kicker),
    h('h2', { class: 'result-title' }, title),
    note ? h('p', { class: 'result-note' }, note) : null,
    h('div', { class: 'scoreboard' },
      h('div', { class: `sb-team ${hg > ag ? 'win' : ''}` }, shirtSVG(home.kit, '', 56), h('b', null, home.name), scorerList('home')),
      h('div', { class: 'sb-score', 'aria-label': `${home.name} ${hg}, ${away.name} ${ag}` }, h('span', null, hg), h('i', null, '–'), h('span', null, ag)),
      h('div', { class: `sb-team ${ag > hg ? 'win' : ''}` }, shirtSVG(away.kit, '', 56), h('b', null, away.name), scorerList('away'))),
    h('div', { class: 'result-grid' },
      h('section', { class: 'panel stats' }, h('h3', null, 'Match stats'),
        statRow('Possession', st.possession, true), statRow('Shots', st.shots), statRow('On target', st.shotsOnTarget), statRow('Passes', st.passes)),
      potm ? h('section', { class: 'panel potm', style: { '--kit1': potm.team.kit.primary, '--kit2': potm.team.kit.secondary } },
        h('h3', null, 'Player of the match'),
        h('div', { class: 'potm-card' },
          h('div', { class: 'potm-rating' }, potm.r.toFixed(1)),
          shirtSVG(potm.team.kit, potm.p.number, 72),
          h('div', { class: 'potm-name' }, potm.p.name),
          h('div', { class: 'potm-sub' }, `${potm.p.pos} · ${potm.team.name}`),
          h('div', { class: 'potm-goals' }, (() => { const g = (result.scorers || []).filter((s) => s.playerId === potm.p.id && !s.ownGoal).length; return g ? `${g} goal${g > 1 ? 's' : ''}` : ''; })()))) : null),
    h('div', { class: 'row actions' }, actions.map((a, i) => {
      const b = h('button', { class: `btn ${a.primary ? 'btn--primary' : ''} btn--lg`, type: 'button', 'data-autofocus': i === 0 ? '1' : null, 'data-action': a.id || null });
      b.textContent = a.label;
      b.addEventListener('click', () => a.onClick(b));
      return b;
    })));
  return el;
}

function showResultScreen({ home, away, result, title, kicker, onRematch }) {
  const el = h('section', { class: 'screen screen--result', 'aria-label': 'Result' });
  el.append(renderResult({
    home, away, result, title, kicker,
    actions: [
      onRematch ? { id: 'rematch', label: 'Rematch', primary: true, onClick: () => { nav.back(); onRematch(); } } : null,
      { id: 'menu', label: 'Main menu', primary: !onRematch, onClick: () => nav.home() },
    ].filter(Boolean),
  }));
  nav.push({ el, name: 'result' });
}

/** Play a match from a menu screen, then show the result screen. */
async function playFromMenu({ home, away, opts, kicker }) {
  const replay = () => playFromMenu({ home, away, opts, kicker });
  let result;
  try {
    result = await startMatch(home, away, opts);
  } catch (e) {
    const el = h('section', { class: 'screen screen--error' });
    el.append(errorTile('The match engine failed to start', e, () => { nav.back(); replay(); }));
    nav.push({ el, name: 'error' });
    return;
  }
  if (!result || result.abandoned) { toast('Match abandoned'); return; }
  showResultScreen({ home, away, result, title: 'Full Time', kicker, onRematch: replay });
}

// ------------------------------------------------------------------ Kick-Off / Local 2P / Practice
const LAST_KEY = 'pitchside.lastKickoff';

async function teamSelectScreen(mode) {
  const local2p = mode === 'local2p';
  const title = local2p ? 'Local 2-Player' : 'Kick-Off';
  const body = h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading teams…');
  const el = screenShell(mode, title, local2p ? 'Couch co-op · same keyboard or gamepads' : 'Quick match', body);
  nav.push({ el, name: mode });
  let teams;
  try { teams = await getTeams(); } catch (e) {
    body.replaceWith(errorTile('Teams could not be loaded', e, () => { nav.back(); teamSelectScreen(mode); }));
    return;
  }
  const s = loadSettings();
  const last = lsGet(LAST_KEY, {});
  const idx = (id, dflt) => { const i = teams.findIndex((t) => t.id === id); return i >= 0 ? i : dflt; };
  const opts = teams.map((t) => ({ team: t }));
  const cfg = { difficulty: s.difficulty, halfMinutes: s.halfMinutes, stadium: last.stadium || s.stadium, userSide: 'home' };
  const homeP = teamPicker({ title: 'Home', options: opts, index: idx(last.home, 0), sideClass: 'home' });
  const awayP = teamPicker({ title: 'Away', options: opts, index: idx(last.away, Math.min(1, teams.length - 1)), sideClass: 'away' });
  const ctrlLine = h('div', { class: 'ctrl-line' });
  const renderCtrl = () => {
    const hc = local2p ? 'P1' : cfg.userSide === 'home' ? 'YOU' : 'CPU';
    const ac = local2p ? 'P2' : cfg.userSide === 'away' ? 'YOU' : 'CPU';
    ctrlLine.replaceChildren(
      h('span', { class: `ctrl-chip ${hc === 'CPU' ? 'cpu' : 'hum'}` }, hc),
      local2p ? h('span', { class: 'vs' }, 'VS') : h('button', { class: 'btn btn--ghost swap', type: 'button', onclick: () => { cfg.userSide = cfg.userSide === 'home' ? 'away' : 'home'; renderCtrl(); }, 'aria-label': 'Swap the side you control' }, '⇄ Swap sides'),
      h('span', { class: `ctrl-chip ${ac === 'CPU' ? 'cpu' : 'hum'}` }, ac));
  };
  renderCtrl();
  const kb = loadKeybinds();
  const kickBtn = h('button', { class: 'btn btn--primary btn--xl kick', type: 'button', 'data-autofocus': '1' }, 'Kick Off');
  const content = h('div', { class: 'select' },
    h('div', { class: 'pickers' }, homeP.el, h('div', { class: 'pickers-vs', 'aria-hidden': 'true' }, 'VS'), awayP.el),
    ctrlLine,
    local2p ? h('div', { class: 'hint-box' },
      h('b', null, 'Two players, one device. '),
      `P1 uses ${keyLabel(kb.p1.up)}${keyLabel(kb.p1.left)}${keyLabel(kb.p1.down)}${keyLabel(kb.p1.right)} + ${keyLabel(kb.p1.shoot)} to shoot; P2 uses the arrow keys + ${keyLabel(kb.p2.shoot)}. `,
      'Plug in a gamepad for either player — press any button on it and the match picks it up. ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); controlsScreen(); } }, 'Edit controls')) : null,
    h('div', { class: 'opts' },
      local2p ? null : segmented('Difficulty', DIFFICULTIES, cfg.difficulty, (v) => { cfg.difficulty = v; }, `${mode}-diff`),
      segmented('Half length', HALF_LENGTHS.map((m) => [m, `${m} min`]), cfg.halfMinutes, (v) => { cfg.halfMinutes = v; }, `${mode}-half`),
      segmented('Stadium', STADIUMS, cfg.stadium, (v) => { cfg.stadium = v; }, `${mode}-stadium`)),
    h('div', { class: 'row center' }, kickBtn));
  body.replaceWith(content);
  kickBtn.focus({ preventScroll: true });
  kickBtn.addEventListener('click', () => {
    const home = homeP.value;
    const away = dedupeTeams(home, awayP.value);
    lsSet(LAST_KEY, { home: homeP.value.id, away: awayP.value.id, stadium: cfg.stadium });
    const controllers = local2p ? { home: 'p1', away: 'p2' } : cfg.userSide === 'home' ? { home: 'p1', away: 'ai' } : { home: 'ai', away: 'p1' };
    playFromMenu({
      home, away, kicker: title,
      opts: { controllers, difficulty: local2p ? s.difficulty : cfg.difficulty, halfMinutes: cfg.halfMinutes, stadium: cfg.stadium, netRole: 'local' },
    });
  });
}

async function practice() {
  let teams;
  try { teams = await getTeams(); } catch (e) {
    const el = h('section', { class: 'screen screen--error' });
    el.append(errorTile('Teams could not be loaded', e, () => { nav.back(); practice(); }));
    nav.push({ el, name: 'error' });
    return;
  }
  const last = lsGet(LAST_KEY, {});
  const sorted = [...teams].sort((a, b) => teamOvr(b) - teamOvr(a));
  const home = teams.find((t) => t.id === last.home) || sorted[0];
  const base = sorted[sorted.length - 1];
  const weak = (p) => ({ ...p, id: `trn-${p.id}`, ovr: Math.max(20, Math.round(p.ovr * 0.6)), attrs: Object.fromEntries(Object.entries(p.attrs).map(([k, v]) => [k, Math.max(15, Math.round(v * 0.6))])) });
  const away = {
    ...base, id: 'TRAINING', name: 'Training XI', short: 'TRN',
    kit: { primary: '#ff7a1a', secondary: '#1b1b1b', number: '#1b1b1b', shorts: '#1b1b1b', socks: '#ff7a1a' },
    players: base.players.map(weak), bench: [], chemistry: 0,
  };
  playFromMenu({ home, away, kicker: 'Practice', opts: { controllers: { home: 'p1', away: 'ai' }, difficulty: 'amateur', halfMinutes: 2, netRole: 'local' } });
}

// ------------------------------------------------------------------ Career / Ultimate Team (meta)
let metaMount = null;
async function metaScreen(which) {
  const holder = h('div', { class: 'meta-holder' });
  const el = h('section', { class: 'screen screen--meta' }, holder);
  const screen = {
    el, name: 'meta',
    destroy() { if (metaMount) { try { metaMount.destroy(); } catch { /* ignore */ } metaMount = null; } },
  };
  nav.push(screen);
  holder.append(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading…'));
  let meta;
  try { meta = await loadMeta(); } catch (e) {
    holder.replaceChildren(screenShell('meta-err', which === 'ut' ? 'Ultimate Team' : 'Career Mode', 'Pitchside 3D',
      errorTile('Career & Ultimate Team could not be loaded', e, () => { nav.back(); metaScreen(which); })));
    return;
  }
  if (nav.top !== screen) return;
  holder.replaceChildren();
  try {
    metaMount = meta.mountMeta(holder, { startMatch, onExit: () => nav.back() });
    if (which === 'ut') metaMount.showUltimateTeam(); else metaMount.showCareer();
  } catch (e) {
    holder.replaceChildren(screenShell('meta-err', 'Game modes', 'Pitchside 3D', errorTile('Career & Ultimate Team failed to start', e, () => { nav.back(); metaScreen(which); })));
  }
}

// ------------------------------------------------------------------ Online
async function onlineScreen() {
  const body = h('div', { class: 'online-root' }, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading online play…'));
  const el = screenShell('online', 'Online Match', 'Head to head · peer-to-peer', body);
  let mounted = null;
  nav.push({ el, name: 'online', destroy() { if (mounted) mounted.destroy(); } });
  try {
    const mod = await import('./net/online.js');
    mounted = mod.mountOnline(body, {
      h, nav, toast, getTeams, getSavedUT, openMatch, renderResult, teamPicker, teamOvr, shirtSVG, loadSettings,
      transportKind: ['bc', 'loopback'].includes(Q.get('net')) ? Q.get('net') : 'peer',
      dcTimeoutMs: Math.max(2000, Number(Q.get('dcTimeout')) * 1000 || 15000),
      autoAction: Q.get('online'), // 'host' | 'join:CODE' (tests / share links)
      setBack: (fn) => { el._back = fn; },
    });
  } catch (e) {
    body.replaceChildren(errorTile('Online play could not be loaded', e, () => { nav.back(); onlineScreen(); }));
  }
}

// ------------------------------------------------------------------ Settings
function settingsScreen() {
  const s = loadSettings();
  const upd = (k) => (v) => { s[k] = v; saveSettings(s); toast('Saved'); };
  const vol = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(s.volume), id: 'set-volume', 'aria-label': 'Sound volume' });
  const volOut = h('output', { for: 'set-volume' }, `${s.volume}%`);
  vol.addEventListener('input', () => { volOut.textContent = `${vol.value}%`; });
  vol.addEventListener('change', () => upd('volume')(Number(vol.value)));
  const el = screenShell('settings', 'Settings', 'Match defaults',
    h('div', { class: 'panel settings' },
      segmented('Default difficulty', DIFFICULTIES, s.difficulty, upd('difficulty'), 'set-diff'),
      segmented('Default half length', HALF_LENGTHS.map((m) => [m, `${m} min`]), s.halfMinutes, upd('halfMinutes'), 'set-half'),
      segmented('Default stadium', STADIUMS, s.stadium, upd('stadium'), 'set-stadium'),
      segmented('Camera', CAMERAS, s.camera, upd('camera'), 'set-cam'),
      segmented('Graphics quality', QUALITIES, s.quality, upd('quality'), 'set-quality'),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-volume' }, 'Sound volume'), h('div', { class: 'range-row' }, vol, volOut)),
      h('p', { class: 'hint' }, 'Settings apply to the next match. Career and Ultimate Team keep their own difficulty settings.')));
  nav.push({ el, name: 'settings' });
}

// ------------------------------------------------------------------ Controls (rebinding)
const ACTIONS = [
  ['up', 'Move up'], ['down', 'Move down'], ['left', 'Move left'], ['right', 'Move right'],
  ['sprint', 'Sprint'], ['pass', 'Pass'], ['through', 'Through ball'], ['lob', 'Lob / Cross'],
  ['shoot', 'Shoot'], ['finesse', 'Finesse shot'], ['switchP', 'Switch player'], ['tackle', 'Tackle / Slide'],
  ['skill', 'Skill move'], ['pause', 'Pause'],
];
const ACTION_LABEL = Object.fromEntries(ACTIONS);
const KEY_NAMES = {
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
  MetaLeft: 'L Meta', MetaRight: 'R Meta', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space',
  Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Num Enter', Backspace: 'Bksp', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  NumpadDecimal: 'Num .', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins', Delete: 'Del',
};
export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `Num ${m[1]}`;
  return code;
}

function controlsScreen() {
  let binds = loadKeybinds();
  let listening = null; // { player, action, btn }
  const status = h('div', { class: 'bind-status', role: 'status', 'aria-live': 'polite' });
  const table = h('div', { class: 'bind-table', role: 'table', 'aria-label': 'Key bindings' });

  const findConflicts = (player, action, code) => {
    const out = [];
    for (const p of ['p1', 'p2']) for (const [a] of ACTIONS) if (!(p === player && a === action) && binds[p][a] === code) out.push({ player: p, action: a });
    return out;
  };
  const who = (p, a) => `${p.toUpperCase()} · ${ACTION_LABEL[a]}`;

  const commit = () => { saveKeybinds(binds); binds = loadKeybinds(); render(); };

  const stopListening = () => {
    if (!listening) return;
    listening = null;
    window.removeEventListener('keydown', onCaptureKey, true);
    window.removeEventListener('keyup', swallow, true);
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('blur', cancel);
    render();
  };
  const cancel = () => { if (listening) { stopListening(); status.textContent = 'Cancelled.'; } };
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const onOutside = (e) => { if (!e.target.closest || !e.target.closest('.keybtn')) cancel(); };

  function onCaptureKey(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!listening || e.repeat) return;
    const code = e.code;
    if (!code || code === 'Unidentified') return;
    if (code === 'Escape') { cancel(); return; }
    const { player, action } = listening;
    stopListening();
    if (binds[player][action] === code) { status.textContent = `${who(player, action)} unchanged (${keyLabel(code)}).`; return; }
    const conflicts = findConflicts(player, action, code);
    if (!conflicts.length) {
      binds[player][action] = code;
      commit();
      status.textContent = `${who(player, action)} → ${keyLabel(code)}. Saved.`;
      return;
    }
    showConflict(player, action, code, conflicts);
  }

  function showConflict(player, action, code, conflicts) {
    const old = binds[player][action];
    const other = conflicts[0];
    status.textContent = `${keyLabel(code)} is already used by ${who(other.player, other.action)}.`;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); table.querySelector(`[data-player="${player}"][data-action="${action}"]`)?.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); status.textContent = 'Cancelled.'; close(); } };
    const swapBtn = h('button', { class: 'btn btn--primary', type: 'button', 'data-conflict': 'swap', onclick: () => {
      for (const c of conflicts) binds[c.player][c.action] = old;
      binds[player][action] = code;
      commit();
      status.textContent = `Swapped: ${who(player, action)} → ${keyLabel(code)}, ${who(other.player, other.action)} → ${keyLabel(old)}. Saved.`;
      close();
    } }, `Swap keys`);
    const back = h('div', { class: 'modal-back' },
      h('div', { class: 'modal modal--sm', role: 'alertdialog', 'aria-label': 'Key already in use' },
        h('h2', null, 'Key already in use'),
        h('p', null, h('kbd', null, keyLabel(code)), ' is bound to ', h('b', null, conflicts.map((c) => who(c.player, c.action)).join(', ')), '.'),
        h('p', { class: 'hint' }, `Swap gives ${who(other.player, other.action)} your old key `, h('kbd', null, keyLabel(old)), '.'),
        h('div', { class: 'row' }, swapBtn,
          h('button', { class: 'btn', type: 'button', 'data-conflict': 'cancel', onclick: () => { status.textContent = 'Cancelled.'; close(); } }, 'Cancel'))));
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    swapBtn.focus();
  }

  function startListening(player, action) {
    if (listening) stopListening();
    listening = { player, action };
    render();
    status.textContent = `Press a key for ${who(player, action)} — Esc to cancel.`;
    window.addEventListener('keydown', onCaptureKey, true);
    window.addEventListener('keyup', swallow, true);
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('blur', cancel);
  }

  function render() {
    const dup = new Map();
    for (const p of ['p1', 'p2']) for (const [a] of ACTIONS) { const c = binds[p][a]; dup.set(c, (dup.get(c) || 0) + 1); }
    table.replaceChildren(
      h('div', { class: 'bind-row bind-head', role: 'row' }, h('span', { role: 'columnheader' }, 'Action'), h('span', { role: 'columnheader' }, 'Player 1'), h('span', { role: 'columnheader' }, 'Player 2')),
      ...ACTIONS.map(([a, label]) => h('div', { class: 'bind-row', role: 'row' },
        h('span', { class: 'bind-label', role: 'rowheader' }, label),
        ...['p1', 'p2'].map((p) => {
          const isL = listening && listening.player === p && listening.action === a;
          const b = h('button', {
            type: 'button', role: 'cell', class: `keybtn ${isL ? 'listening' : ''} ${dup.get(binds[p][a]) > 1 ? 'dup' : ''}`,
            'data-player': p, 'data-action': a, 'aria-label': `${p.toUpperCase()} ${label}: ${keyLabel(binds[p][a])}. Click to rebind`,
          }, isL ? 'Press a key…' : keyLabel(binds[p][a]));
          b.addEventListener('click', (e) => { e.preventDefault(); if (isL) cancel(); else startListening(p, a); });
          return b;
        }))));
    if (listening) table.querySelector('.keybtn.listening')?.focus({ preventScroll: true });
  }
  render();

  const resetOne = (p) => { binds[p] = structuredClone(DEFAULT_KEYBINDS[p]); commit(); status.textContent = `${p.toUpperCase()} controls reset to defaults.`; };
  const el = screenShell('controls', 'Controls', 'Keyboard · gamepad · touch',
    h('div', { class: 'panel controls' },
      h('p', { class: 'hint' }, 'Click a key, then press the new key. Esc cancels. If the key is already used you can swap the two bindings. Changes save instantly.'),
      status,
      table,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', 'data-reset': 'p1', onclick: () => resetOne('p1') }, 'Reset P1'),
        h('button', { class: 'btn', type: 'button', 'data-reset': 'p2', onclick: () => resetOne('p2') }, 'Reset P2'),
        h('button', { class: 'btn btn--danger', type: 'button', 'data-reset': 'all', onclick: () => { binds = resetKeybinds(); render(); status.textContent = 'All controls reset to defaults.'; } }, 'Reset all'))),
    h('div', { class: 'panel info-grid' },
      h('div', null, h('h3', null, 'Gamepad'), h('p', null, 'Any standard controller works — press a button on it to wake it up. Left stick moves, face buttons pass and shoot, triggers sprint. In Local 2-Player each pad can take a side.')),
      h('div', null, h('h3', null, 'Touch'), h('p', null, 'On phones and tablets an on-screen stick and action buttons appear during the match.')),
      h('div', null, h('h3', null, 'Shooting'), h('p', null, 'Hold shoot to build power, release to strike. Finesse curls it; lob chips the keeper.'))));
  nav.push({ el, name: 'controls', destroy: () => stopListening() });
}

// ------------------------------------------------------------------ main menu
const ICONS = {
  kickoff: 'M50 8a42 42 0 1 0 .01 0Zm0 14 12 9-4 14H42l-4-14Zm-26 20 9 3 4 13-8 10-9-4a30 30 0 0 1 4-22Zm52 0a30 30 0 0 1 4 22l-9 4-8-10 4-13Zm-34 28h16l6 9-7 8a30 30 0 0 1-14 0l-7-8Z',
  career: 'M20 80V40l30-20 30 20v40H60V58H40v22Zm10-44h40',
  ut: 'M30 12h40l8 16-6 60H28l-6-60Zm20 20a8 8 0 1 0 .01 0ZM36 62h28',
  online: 'M50 12a38 38 0 1 0 .01 0ZM12 50h76M50 12c14 12 14 64 0 76M50 12c-14 12-14 64 0 76',
  local: 'M18 40h28a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10H18A10 10 0 0 1 8 58v-8a10 10 0 0 1 10-10Zm36 0h28a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10H54M22 49v10M17 54h10',
  practice: 'M20 20v60M20 20h50l-10 12 10 12H20M60 70a8 8 0 1 0 .01 0Z',
  settings: 'M50 34a16 16 0 1 0 .01 0ZM46 8h8l2 10 8 4 9-6 6 6-6 9 4 8 10 2v8l-10 2-4 8 6 9-6 6-9-6-8 4-2 10h-8l-2-10-8-4-9 6-6-6 6-9-4-8-10-2v-8l10-2 4-8-6-9 6-6 9 6 8-4Z',
  controls: 'M10 30h80v44H10ZM20 42h8M34 42h8M48 42h8M62 42h8M76 42h4M24 54h52M30 64h40',
};
function icon(name) {
  return h('svg', { viewBox: '0 0 100 100', class: 'ico', 'aria-hidden': 'true' },
    h('path', { d: ICONS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': '6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
}

function mainMenu() {
  const tiles = [
    { id: 'kickoff', cls: 'hero', title: 'Kick-Off', sub: 'Quick match against the CPU', go: () => teamSelectScreen('kickoff') },
    { id: 'career', cls: 'big career', title: 'Career Mode', sub: 'Manage a club through the seasons', go: () => metaScreen('career') },
    { id: 'ut', cls: 'big ut', title: 'Ultimate Team', sub: 'Packs, squads & Squad Battles', go: () => metaScreen('ut') },
    { id: 'online', cls: 'online', title: 'Online Match', sub: 'Play a friend peer-to-peer', go: onlineScreen },
    { id: 'local', cls: 'local', title: 'Local 2-Player', sub: 'Same keyboard or gamepads', go: () => teamSelectScreen('local2p') },
    { id: 'practice', cls: 'practice', title: 'Practice', sub: 'Warm up vs a training XI', go: practice },
    { id: 'settings', cls: 'small', title: 'Settings', sub: 'Difficulty, camera, graphics', go: settingsScreen },
    { id: 'controls', cls: 'small', title: 'Controls', sub: 'Rebind every key', go: controlsScreen },
  ];
  const el = h('section', { class: 'screen screen--menu', 'aria-label': 'Main menu' },
    h('header', { class: 'menu-head' },
      h('a', { class: 'menu-home', href: '../index.html', 'aria-label': 'All games' }, '‹ Games'),
      h('div', { class: 'brand' },
        h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'P'),
        h('div', null, h('h1', { class: 'brand-name' }, 'PITCHSIDE', h('span', null, '3D')), h('div', { class: 'brand-tag' }, 'The beautiful game, in your browser'))),
      h('div', { class: 'menu-season', 'aria-hidden': 'true' }, 'SEASON 26')),
    h('nav', { class: 'tiles', 'aria-label': 'Game modes' }, tiles.map((t, i) => h('button', {
      type: 'button', class: `tile ${t.cls.split(' ').map((c) => `tile--${c}`).join(' ')}`, 'data-tile': t.id, 'data-autofocus': i === 0 ? '1' : null, style: { '--i': i }, onclick: t.go,
    }, h('span', { class: 'tile-glow', 'aria-hidden': 'true' }), t.cls === 'small' ? null : h('span', { class: 'tile-mark', 'aria-hidden': 'true' }, icon(t.id)), icon(t.id), h('span', { class: 'tile-text' }, h('span', { class: 'tile-title' }, t.title), h('span', { class: 'tile-sub' }, t.sub)), h('span', { class: 'tile-arrow', 'aria-hidden': 'true' }, '›')))),
    h('footer', { class: 'menu-foot' }, h('span', null, 'Arrow keys + Enter to navigate'), h('span', null, 'All players are fictional')));
  // arrow-key navigation between tiles
  el.querySelector('.tiles').addEventListener('keydown', (e) => {
    const list = [...el.querySelectorAll('.tile')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const r0 = list[i].getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    let best = null, bd = Infinity;
    for (const t of list) {
      if (t === list[i]) continue;
      const r = t.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const d = along + Math.abs(dx * dir[1] + dy * dir[0]) * 2;
      if (d < bd) { bd = d; best = t; }
    }
    if (best) best.focus();
  });
  nav.push({ el, name: 'menu' });
}

// Escape = back (not during a match, not inside meta which handles its own Escape, not over a modal)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (document.body.classList.contains('in-match') || document.querySelector('.modal-back')) return;
  const top = nav.top;
  if (!top || top.name === 'menu' || top.name === 'meta') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (top.name === 'online') { top.el.querySelector('.back')?.click(); return; }
  nav.back();
});

// ------------------------------------------------------------------ boot
mainMenu();
document.documentElement.classList.add('ready');
const start = Q.get('screen');
if (start === 'kickoff') teamSelectScreen('kickoff');
else if (start === 'local2p') teamSelectScreen('local2p');
else if (start === 'settings') settingsScreen();
else if (start === 'controls') controlsScreen();
else if (start === 'online') onlineScreen();
else if (start === 'career') metaScreen('career');
else if (start === 'ut') metaScreen('ut');
// warm the engine module in the background so Kick-Off starts fast (errors surface later, on use)
setTimeout(() => { loadEngine().catch(() => {}); }, 400);

// Expose for tests / debugging.
window.pitchside = { startMatch, openMatch, nav, loadSettings };
