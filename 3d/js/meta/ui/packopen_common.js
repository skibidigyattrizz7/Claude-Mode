// Shared pieces of both pack-opening animations (packopen_fut.js = FUT-style "new", packopen_classic.js =
// the previous tunnel cinematic): pack art, labels, the kit for the 3D walkout, the item grid shown after
// every opening, and the `packAnim` setting (stored in the meta settings object, pitchside.meta.settings).
import { h, clear, frag, fmtNum } from './dom.js';
import { playerCard } from './card.js';
import { clubById } from '../core/data.js';
import { PROMOS } from '../core/promos.js';
import { load, save } from '../core/storage.js';
import { normalizePackAnim } from './packopen_seq.js';

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

export function ensureCss(root) {
  try {
    const has = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /(^|\/)css\/packs\.css(\?|#|$)/.test(l.getAttribute('href') || '') || l.dataset.pmPacksCss);
    if (has) return;
    const href = new URL('../../../css/packs.css', import.meta.url).href;
    root.appendChild(h('link', { rel: 'stylesheet', href, 'data-pm-packs-css': '1' }));
  } catch { /* ignore */ }
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
  function renderGrid() {
    clear(stage);
    const newCount = players.filter((x) => !x.dup).length;
    const dupCount = players.length - newCount;
    const dupValue = players.filter((x) => x.dup && x.state === 'new').reduce((a, x) => a + opts.sellValue(x.p), 0);
    const allValue = players.filter((x) => x.state === 'new').reduce((a, x) => a + opts.sellValue(x.p), 0);
    const grid = h('div', { class: 'pm-po-grid' });
    for (const x of players) {
      const tile = h('div', { class: `pm-po-item ${x.dup ? 'is-dup' : ''} is-${x.state}` },
        x.dup ? h('div', { class: 'pm-po-badge dup' }, 'Duplicate') : h('div', { class: 'pm-po-badge new' }, 'New'),
        playerCard(x.p, { size: 'sm' }),
        x.state === 'new' ? h('div', { class: 'pm-po-actions' },
          !x.dup ? h('button', { class: 'pm-btn pm-btn--sm pm-btn--primary', onclick: () => send(x) }, 'Send to club') : null,
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => sell(x) }, `Quick sell +${fmtNum(opts.sellValue(x.p))}`))
          : h('div', { class: 'pm-po-done' }, x.state === 'sent' ? '✓ Sent to club' : `Sold +${fmtNum(x.sold)}`));
      grid.appendChild(tile);
    }
    const pending = players.some((x) => x.state === 'new');
    stage.appendChild(h('div', { class: 'pm-po-gridwrap' },
      h('div', { class: 'pm-po-gridhead' },
        h('div', null, h('div', { class: 'pm-kicker' }, pack.name), h('h2', null, `${players.length} items`), h('p', { class: 'pm-dim' }, `${newCount} new · ${dupCount} duplicate${dupCount === 1 ? '' : 's'}${coinsGained ? ` · +${fmtNum(coinsGained)} coins` : ''}`)),
        h('div', { class: 'pm-po-bulk' },
          pending && players.some((x) => !x.dup && x.state === 'new') ? h('button', { class: 'pm-btn pm-btn--primary', onclick: () => { players.filter((x) => !x.dup && x.state === 'new').forEach((x) => send(x, true)); renderGrid(); } }, 'Send all to club') : null,
          dupValue ? h('button', { class: 'pm-btn', onclick: () => { players.filter((x) => x.dup && x.state === 'new').forEach((x) => sell(x, true)); renderGrid(); } }, `Quick sell duplicates +${fmtNum(dupValue)}`) : null,
          pending ? h('button', { class: 'pm-btn', onclick: () => { players.filter((x) => x.state === 'new').forEach((x) => sell(x, true)); renderGrid(); } }, `Quick sell all +${fmtNum(allValue)}`) : null,
          h('button', { class: 'pm-btn pm-btn--accent pm-po-finish', onclick: finish }, pending ? 'Done' : 'Close'))),
      pending ? h('p', { class: 'pm-hint' }, 'Unassigned items are sent to your club on Done; duplicates are quick sold.') : null,
      grid));
  }
  function send(x, silent) { if (x.state !== 'new' || x.dup) return; opts.onSend(x.pid); x.state = 'sent'; if (!silent) renderGrid(); }
  function sell(x, silent) { if (x.state !== 'new') return; const v = opts.onSell(x.pid, x.dup); x.sold = v; coinsGained += v; x.state = 'sold'; if (!silent) renderGrid(); }
  function finish() {
    for (const x of players) { if (x.state === 'new') { if (x.dup) sell(x, true); else send(x, true); } }
    destroy();
    opts.onDone && opts.onDone({ coins: coinsGained, sent: players.filter((x) => x.state === 'sent').length });
  }
  return { render: renderGrid };
}
