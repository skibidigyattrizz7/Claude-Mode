// Shared pieces of both pack-opening animations (packopen_fut.js = FUT-style "new", packopen_classic.js =
// the previous tunnel cinematic): pack art, labels, the kit for the 3D walkout, the item grid shown after
// every opening, and the `packAnim` setting (stored in the meta settings object, pitchside.meta.settings).
import { h, clear, frag, fmtNum } from './dom.js';
import { playerCard } from './card.js';
import { clubById } from '../core/data.js';
import { PROMOS } from '../core/promos.js';
import { load, save } from '../core/storage.js';
import { normalizePackAnim, bulkTargets } from './packopen_seq.js';
import { fractureElement } from './vinsonfracture.js';

export const FLARE = { bronze: '#a9b1bf', silver: '#e4ecf6', gold: '#ffc933', walkout: '#b44dff' };
export const SPECIAL_FLARE = { legend: '#fff2c4', hero: '#27e1c1', inform: '#ffb300', lotg: '#ffd35a', objective: '#6ee7ff' };
export const SPECIAL_BADGE = { inform: 'In-Form', hero: 'Hero', legend: 'Classic', lotg: 'Legend of the Game', objective: 'Pathfinder' };
for (const pr of PROMOS) { SPECIAL_FLARE[pr.id] = pr.colors[1]; SPECIAL_BADGE[pr.id] = pr.name; }

// ---------------------------------------------------------------- setting: packAnim 'new' | 'classic'
const SETTINGS_KEY = 'meta.settings';
const MIRROR_KEY = 'meta.packAnim'; // survives the app re-saving an in-memory settings object without the key
/** opts.settings / opts.saveSettings (the app's live settings object) are used when supplied. */
export function readPackAnim(opts = {}) {
  const live = opts.settings && opts.settings.packAnim;
  if (live) return normalizePackAnim(live);
  const stored = (load(SETTINGS_KEY, {}) || {}).packAnim;
  return normalizePackAnim(stored || load(MIRROR_KEY, 'new'));
}
export function writePackAnim(opts = {}, mode) {
  const v = normalizePackAnim(mode);
  if (opts.settings) opts.settings.packAnim = v;
  if (opts.settings && typeof opts.saveSettings === 'function') opts.saveSettings();
  else save(SETTINGS_KEY, { ...(load(SETTINGS_KEY, {}) || {}), packAnim: v });
  save(MIRROR_KEY, v);
  return v;
}
/** Small "Animation: New / Classic" switch shown before the pack is opened. */
export function animToggle(current, onSwitch) {
  const btn = (mode, label) => h('button', {
    type: 'button', class: `pk-animbtn ${current === mode ? 'on' : ''}`, 'aria-pressed': String(current === mode),
    onclick: (e) => { e.stopPropagation(); if (current !== mode) onSwitch(mode); },
  }, label);
  return h('div', { class: 'pk-animtoggle', role: 'group', 'aria-label': 'Pack animation style' },
    h('span', null, 'Animation'), btn('new', 'New'), btn('classic', 'Classic'));
}

// ---------------------------------------------------------------- helpers
export function pseudoNumber(p) {
  // Players carry no squad number in the data model; derive a stable one so the walkout shirt reads "his number".
  let hh = 2166136261; const s = String(p.id || p.name || '');
  for (let i = 0; i < s.length; i++) { hh ^= s.charCodeAt(i); hh = Math.imul(hh, 16777619); }
  return 1 + ((hh >>> 0) % 29);
}
/** Kit for the 3D walkout: the player's own club colours, or the user's club when `userKit` is supplied. */
export function walkoutKit(best, userKit) {
  const club = clubById(best.club);
  const base = userKit || (club && club.colors) || { primary: '#2a3a55', secondary: '#e8edf7' };
  return {
    primary: base.primary, secondary: base.secondary || '#ffffff',
    shorts: base.shorts || base.secondary || base.primary,
    socks: base.socks || base.primary,
    number: pseudoNumber(best), pattern: 0,
  };
}

// packs.css is the pack stage's own stylesheet. It used to be injected only when the first pack was opened, so on
// a slow / filtered network (school Chromebooks) or a deploy where it 404'd, the overlay mounted UNSTYLED: the
// stage flowed thousands of px below the fold, only the meta.css background glows showed and nothing was
// tappable. Now it is requested as soon as this module loads, readiness is checked before the stage is shown,
// and the overlay falls back to a self-styled 2D reveal when it is missing (see fallbackReveal).
const PACKS_CSS_RE = /(^|\/)css\/packs\.css(\?|#|$)/;
function packsCssLink() {
  try { return [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => PACKS_CSS_RE.test(l.getAttribute('href') || '') || l.dataset.pmPacksCss) || null; } catch { return null; }
}
/** Start loading packs.css (idempotent). `root` is kept for the old signature; the link goes into <head>. */
export function ensureCss(root) {
  try {
    if (typeof document === 'undefined' || packsCssLink()) return;
    const href = new URL('../../../css/packs.css', import.meta.url).href;
    (document.head || root || document.body).appendChild(h('link', { rel: 'stylesheet', href, 'data-pm-packs-css': '1' }));
  } catch { /* ignore */ }
}
/**
 * True once packs.css has actually loaded and applies. Probes a real rule (`.pk2-scene { position: absolute }`)
 * because a pending load has no sheet and a FAILED load still exposes an (inaccessible) sheet object.
 */
export function packCssReady() {
  try {
    if (!document.body) return false;
    const probe = document.createElement('div');
    probe.className = 'pk2-scene';
    probe.style.cssText = 'visibility:hidden;pointer-events:none;width:0;height:0';
    document.body.appendChild(probe);
    const ok = getComputedStyle(probe).position === 'absolute';
    probe.remove();
    return ok;
  } catch { return false; }
}
/** Resolves true when packs.css is usable, false after `ms` (or on a load error). Never rejects. */
export function waitPackCss(ms) {
  ensureCss();
  if (packCssReady()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const l = packsCssLink();
    const end = (v) => { if (done) return; done = true; clearInterval(poll); clearTimeout(to); if (l) { l.removeEventListener('load', onLoad); l.removeEventListener('error', onErr); } resolve(v); };
    const onLoad = () => end(packCssReady());
    const onErr = () => end(false);
    if (l) { l.addEventListener('load', onLoad); l.addEventListener('error', onErr); }
    const poll = setInterval(() => { if (packCssReady()) end(true); }, 100);
    const to = setTimeout(() => end(packCssReady()), Math.max(0, ms));
  });
}

/** Critical overlay layout as inline styles, so it covers the viewport even before (or without) any stylesheet. */
export function pinOverlay(ov) {
  const st = ov.style;
  st.position = 'fixed'; st.top = '0'; st.left = '0'; st.right = '0'; st.bottom = '0';
  st.width = '100%'; st.height = '100vh'; st.height = '100dvh'; // dvh where supported (ignored otherwise)
  st.zIndex = '1000'; st.overflow = 'hidden'; st.margin = '0';
  if (!st.background) st.background = '#03050c';
  st.color = '#fff'; st.boxSizing = 'border-box';
  return ov;
}
/** Skip button pinned inside the safe area (always fully visible), independent of stylesheets. */
export function pinSkip(btn) {
  const st = btn.style;
  st.position = 'absolute'; st.zIndex = '9';
  st.top = 'max(12px, env(safe-area-inset-top, 0px))'; st.right = 'max(12px, env(safe-area-inset-right, 0px))';
  return btn;
}

// Page scroll lock while an overlay is open (nesting-safe). Without it laptops kept a live page scrollbar
// beside the overlay and wheel/keys scrolled the store underneath.
let lockDepth = 0, saved = null;
export function lockScroll() {
  if (typeof document === 'undefined') return () => {};
  if (lockDepth++ === 0) {
    const de = document.documentElement, b = document.body;
    saved = { h: de.style.overflow, b: b ? b.style.overflow : '' };
    de.style.overflow = 'hidden'; if (b) b.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return; released = true;
    if (--lockDepth > 0 || !saved) return;
    const de = document.documentElement, b = document.body;
    de.style.overflow = saved.h; if (b) b.style.overflow = saved.b;
    saved = null;
  };
}

/**
 * Self-contained 2D reveal (inline styles + Web Animations only, no packs.css / WebGL / fonts needed):
 * the pack art pops, the best card flips in with its name and a Continue button. Used when packs.css is
 * unavailable, when the cinematic fails to build, and by the watchdog as a last resort.
 * Returns the layer (appended to `ov`); `onContinue` is called from its button.
 */
export function fallbackReveal(ov, pack, best, onContinue) {
  const anim = (el, frames, o) => { try { if (el.animate) el.animate(frames, o); } catch { /* ignore */ } };
  const packEl = packArt(pack, 'lg');
  packEl.style.position = 'absolute';
  const card = playerCard(best, { size: 'lg' });
  const cont = h('button', { type: 'button', class: 'pm-btn pm-btn--primary pm-po-continue', onclick: (e) => { e.stopPropagation(); onContinue(); } }, 'Continue');
  cont.style.minWidth = '180px'; cont.style.minHeight = '44px';
  const name = h('div', { class: 'pm-po-revealname' }, best.name, best.special ? h('span', { class: `pm-sp-badge sp-${best.special}` }, SPECIAL_BADGE[best.special] || best.special) : null);
  name.style.cssText = 'font-weight:700;font-size:clamp(18px,3.2vw,30px);text-transform:uppercase;letter-spacing:.06em;display:flex;gap:10px;align-items:center;text-align:center';
  const cardBox = h('div', null, card);
  cardBox.style.cssText = 'display:grid;place-items:center;perspective:1200px';
  const col = h('div', null, cardBox, name, cont);
  col.style.cssText = 'display:grid;justify-items:center;gap:14px;max-height:100%;opacity:0';
  const layer = h('div', { class: 'pm-po-fallback' }, packEl, col);
  layer.style.cssText = 'position:absolute;inset:0;z-index:7;display:grid;place-items:center;padding:max(56px,env(safe-area-inset-top,0px)) 16px 16px;overflow:auto;background:radial-gradient(60% 50% at 50% 45%,color-mix(in srgb,var(--c2,var(--flare,#ffc933)) 30%,transparent),transparent 70%),#03050c';
  ov.appendChild(layer);
  anim(packEl, [{ transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }, { transform: 'scale(1.08) rotate(-2deg)', opacity: 1, offset: 0.55 }, { transform: 'scale(1.7)', opacity: 0, filter: 'brightness(3)' }], { duration: 650, easing: 'ease-in', fill: 'forwards' });
  setTimeout(() => { packEl.style.visibility = 'hidden'; col.style.opacity = '1'; }, 560);
  anim(card, [{ transform: 'rotateY(-110deg) scale(.8)', filter: 'brightness(2.4)' }, { transform: 'rotateY(10deg) scale(1.02)', filter: 'brightness(1.1)', offset: 0.6 }, { transform: 'none', filter: 'none' }], { duration: 700, delay: 560, easing: 'cubic-bezier(.22,.8,.22,1)', fill: 'backwards' });
  setTimeout(() => { try { cont.focus({ preventScroll: true }); } catch { /* ignore */ } }, 1300);
  return layer;
}

export function packArt(pack, size = 'md') {
  return frag(`<div class="pm-pack pm-pack--${pack.look} pm-pack--${size}" aria-hidden="true">
    <div class="pk-foil"></div><div class="pk-shine"></div>
    <div class="pk-logo"><span>P</span></div>
    <div class="pk-brand">PITCHSIDE<br><small>ULTIMATE TEAM</small></div>
    <div class="pk-name">${pack.name.replace(' Pack', '').toUpperCase()}</div>
  </div>`);
}

export function positionName(pos) {
  return ({ GK: 'Goalkeeper', CB: 'Centre-Back', LB: 'Left-Back', RB: 'Right-Back', LWB: 'Left Wing-Back', RWB: 'Right Wing-Back', CDM: 'Defensive Midfield', CM: 'Central Midfield', CAM: 'Attacking Midfield', LM: 'Left Midfield', RM: 'Right Midfield', LW: 'Left Wing', RW: 'Right Wing', ST: 'Striker', CF: 'Centre-Forward' })[pos] || pos;
}

// ---------------------------------------------------------------- item grid (unchanged summary screen)
/**
 * Renders the post-opening item grid into `stage`. `destroy()` tears the overlay down; `opts` are the
 * runPackOpening options (sellValue, onSend, onSell, onDone).
 */
export function makeGrid(stage, pack, players, opts, destroy) {
  let coinsGained = 0;
  let corrupting = false;
  const canTransfer = (pid) => (typeof opts.canTransfer === 'function' ? opts.canTransfer(pid) : true);
  function renderGrid() {
    clear(stage);
    const newCount = players.filter((x) => !x.dup).length;
    const dupCount = players.length - newCount;
    const dupValue = players.filter((x) => x.dup && x.state === 'new').reduce((a, x) => a + opts.sellValue(x.p), 0);
    const allValue = players.filter((x) => x.state === 'new').reduce((a, x) => a + opts.sellValue(x.p), 0);
    const grid = h('div', { class: 'pm-po-grid' });
    // best card first (and larger), like FC's pack summary; the rest keep their pack order
    const bestIdx = players.reduce((bi, x, i) => ((x.p.ovr || 0) > (players[bi].p.ovr || 0) ? i : bi), 0);
    const order = players.length ? [players[bestIdx], ...players.filter((_, i) => i !== bestIdx)] : [];
    const coin = () => h('i', { class: 'pm-coin', 'aria-hidden': 'true' });
    for (const x of order) {
      const best = x === players[bestIdx] && players.length > 2;
      const tile = h('div', { class: `pm-po-item ${x.dup ? 'is-dup' : ''} is-${x.state} ${best ? 'is-best' : ''}` },
        x.dup ? h('div', { class: 'pm-po-badge dup' }, 'Duplicate') : h('div', { class: 'pm-po-badge new' }, 'New'),
        playerCard(x.p, { size: 'sm' }),
        x.state === 'new' ? h('div', { class: 'pm-po-actions' },
          !x.dup ? h('button', { class: 'pm-btn pm-btn--sm pm-btn--primary', onclick: () => send(x) }, 'To club') : null,
          x.dup && opts.onVault ? h('button', { class: 'pm-btn pm-btn--sm pm-btn--primary', title: 'Send to SBC storage', onclick: () => vault(x) }, 'To SBC storage') : null,
          h('button', { class: 'pm-btn pm-btn--sm pm-po-sell', 'aria-label': `Quick sell for ${fmtNum(opts.sellValue(x.p))} coins`, onclick: () => sell(x) },
            h('span', null, 'Quick sell'), h('b', null, coin(), fmtNum(opts.sellValue(x.p)))))
          : h('div', { class: 'pm-po-done' }, x.state === 'sent' ? '✓ In your club' : x.state === 'vault' ? '✓ In SBC storage' : x.state === 'listed' ? '✓ On transfer list' : h('span', null, 'Sold ', coin(), ` ${fmtNum(x.sold)}`)));
      grid.appendChild(tile);
    }
    const pending = players.some((x) => x.state === 'new');
    const chip = (cls, text) => h('span', { class: `pm-po-chip ${cls}` }, text);
    stage.appendChild(h('div', { class: 'pm-po-gridwrap' },
      h('div', { class: 'pm-po-gridhead' },
        h('div', { class: 'pm-po-title' },
          h('div', { class: 'pm-kicker' }, pack.name),
          h('div', { class: 'pm-po-titlerow' }, h('h2', null, `${players.length} item${players.length === 1 ? '' : 's'}`),
            h('div', { class: 'pm-po-chips' },
              newCount ? chip('new', `${newCount} new`) : null,
              dupCount ? chip('dup', `${dupCount} duplicate${dupCount === 1 ? '' : 's'}`) : null,
              coinsGained ? chip('coins', h('span', null, coin(), ` +${fmtNum(coinsGained)}`)) : null))),
        h('div', { class: 'pm-po-bulk' },
          bulkTargets(players, 'club').length ? h('button', { class: 'pm-btn pm-btn--primary', onclick: () => { bulkTargets(players, 'club').forEach((x) => send(x, true)); renderGrid(); } }, 'Send all to club') : null,
          opts.onVault && bulkTargets(players, 'vault').length ? h('button', { class: 'pm-btn pm-po-bulk-vault', onclick: () => { bulkTargets(players, 'vault').forEach((x) => vault(x, true)); renderGrid(); } }, 'Send all to SBC storage') : null,
          opts.onTransfer && bulkTargets(players, 'transfer', canTransfer).length ? h('button', { class: 'pm-btn pm-po-bulk-tl', onclick: () => { bulkTargets(players, 'transfer', canTransfer).forEach((x) => transfer(x, true)); renderGrid(); } }, 'Send all to transfer list') : null,
          dupValue ? h('button', { class: 'pm-btn', onclick: () => { bulkTargets(players, 'sellDups').forEach((x) => sell(x, true)); renderGrid(); } }, `Quick sell duplicates +${fmtNum(dupValue)}`) : null,
          pending ? h('button', { class: 'pm-btn', onclick: () => { bulkTargets(players, 'sellAll').forEach((x) => sell(x, true)); renderGrid(); } }, `Quick sell all +${fmtNum(allValue)}`) : null,
          h('button', { class: 'pm-btn pm-btn--accent pm-po-finish', onclick: finish }, pending ? 'Done' : 'Close'))),
      pending ? h('p', { class: 'pm-hint pm-po-hint' }, opts.onSave ? 'On Done, new players go to your club and duplicates go to Saved cards (Club tab). Nothing is sold unless you choose to.' : 'On Done, unassigned players go to your club and duplicates are quick sold.') : null,
      grid));
    if (opts.curse) stage.querySelector('.pm-po-gridwrap')?.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      if (corrupting) return;
      corrupting = true;
      stage.querySelectorAll('.pm-po-gridwrap button').forEach((b, i) => {
        fractureElement(b, { delay: Math.min(i, 8) * 65 });
        b.classList.add('vinson-po-corrupt');
        b.style.animationDelay = `${Math.min(i, 8) * 65}ms`;
      });
      setTimeout(() => { destroy(); opts.onCurseExit?.(); }, 1700);
    }, true);
  }
  function send(x, silent) { if (x.state !== 'new' || x.dup) return; opts.onSend(x.pid); x.state = 'sent'; if (!silent) renderGrid(); }
  // Single-item SBC storage stays duplicates-only (tile button); the bulk action stores every pending item.
  function vault(x, bulk) { if (x.state !== 'new' || !opts.onVault || (!x.dup && !bulk)) return; opts.onVault(x.pid); x.state = 'vault'; if (!bulk) renderGrid(); }
  function transfer(x, silent) {
    if (x.state !== 'new' || x.dup || !opts.onTransfer) return;
    const r = opts.onTransfer(x.pid) || { ok: true };
    x.state = r.ok ? 'listed' : 'sent'; // a full transfer list still leaves the card safely in the club
    if (!silent) renderGrid();
  }
  function sell(x, silent) { if (x.state !== 'new') return; const v = opts.onSell(x.pid, x.dup); x.sold = v; coinsGained += v; x.state = 'sold'; if (!silent) renderGrid(); }
  function finish() {
    // never auto quick-sell (owner lost a Rabbi Patel): new cards join the club, anything else goes to Saved cards
    for (const x of players) { if (x.state === 'new') { if (!x.dup) send(x, true); else if (opts.onSave) { opts.onSave(x.pid); x.state = 'saved'; } else sell(x, true); } }
    destroy();
    opts.onDone && opts.onDone({ coins: coinsGained, sent: players.filter((x) => x.state === 'sent').length, listed: players.filter((x) => x.state === 'listed').length, vault: players.filter((x) => x.state === 'vault').length });
  }
  return { render: renderGrid };
}
