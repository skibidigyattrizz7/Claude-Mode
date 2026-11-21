// Draft pick presentation (FC FUT Draft style): cards dealt face-down from the left one by one, flipped with a
// landing bounce and a light sweep; a picked card flies into its pitch slot. Uses the shared playerCard renderer.
// Honours prefers-reduced-motion (everything instant). Styles: css/draft.css.
import { h } from './dom.js';
import { playerCard } from './card.js';

if (typeof document !== 'undefined' && !document.getElementById('dp-css')) {
  const l = document.createElement('link');
  l.id = 'dp-css';
  l.rel = 'stylesheet';
  l.href = new URL('../../../css/draft.css', import.meta.url).href;
  document.head.appendChild(l);
}

export const DEAL_STAGGER = 140;
const DEAL_MS = 820;
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A row of dealt cards. items: [{ p, pos?, note? }]. onPick(item, cardEl) fires once; the row locks after it.
 * Returns the row element (class dp-row); cards are playable as soon as they land.
 */
export function dealRow(items, onPick, { cls = '' } = {}) {
  const anim = !reducedMotion();
  let locked = false;
  const row = h('div', { class: `dp-row ${cls} ${anim ? 'is-dealing' : ''}`, style: { '--n': items.length } });
  items.forEach((it, i) => {
    const card = playerCard(it.p, { size: 'md', pos: it.pos, onClick: () => {
      if (locked) return;
      locked = true;
      row.classList.add('is-picked');
      opt.classList.add('is-chosen');
      onPick(it, card);
    } });
    const opt = h('div', { class: 'dp-opt', style: { '--i': i } },
      h('div', { class: 'dp-flip' }, anim ? h('div', { class: 'pm-card dp-back', 'aria-hidden': 'true' }, h('div', { class: 'pc-in' })) : null, card),
      it.note ? h('div', { class: 'dp-note' }, it.note) : null);
    row.appendChild(opt);
  });
  if (anim) {
    const done = () => { row.classList.remove('is-dealing'); row.querySelectorAll('.dp-back').forEach((b) => b.remove()); };
    setTimeout(done, DEAL_STAGGER * (items.length - 1) + DEAL_MS + 60);
  }
  return row;
}

/** Centred picker overlay over the pitch. Returns close(). */
export function openPicker(host, { title, sub, items, onPick, returnFocus }) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const row = dealRow(items, (it, card) => onPick(it, card, close));
  const panel = h('div', { class: 'dp-pickpanel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'dp-pickhead' },
      h('div', null, h('h2', null, title), sub ? h('p', null, sub) : null),
      h('button', { class: 'pm-btn pm-btn--ghost dp-close', onclick: close }, 'Back')),
    row);
  const back = h('div', { class: 'dp-overlay', onclick: (e) => { if (e.target === back) close(); } }, panel);
  host.appendChild(back);
  document.addEventListener('keydown', onKey, true);
  const first = row.querySelector('.pm-card[role="button"]');
  if (first) first.focus({ preventScroll: true });
  return close;
}

// ---- pick -> slot flight: the view re-renders between the pick and the landing, so the source is remembered ----
let pending = null;
/** Remember the picked card (position + look) so the next render can fly it into slot `key`. */
export function queueFly(key, cardEl) {
  if (reducedMotion() || !cardEl) { pending = null; return; }
  const r = cardEl.getBoundingClientRect();
  pending = { key, rect: r, node: cardEl.cloneNode(true), at: performance.now() };
}
/** Call after rendering the pitch: animates a queued card into `[data-k=key]`. */
export function landFly(root) {
  const f = pending;
  pending = null;
  if (!f || performance.now() - f.at > 1500) return;
  requestAnimationFrame(() => {
    const slot = root.querySelector(`[data-k="${f.key}"]`);
    const target = slot && slot.querySelector('.pm-card');
    if (!target) return;
    const t = target.getBoundingClientRect();
    const ghost = f.node;
    ghost.classList.add('dp-ghost');
    ghost.removeAttribute('tabindex');
    Object.assign(ghost.style, { left: `${f.rect.left}px`, top: `${f.rect.top}px`, width: `${f.rect.width}px`, height: `${f.rect.height}px`, fontSize: `${f.rect.width / 10}px` });
    (root.closest('.pm-root') || document.body).appendChild(ghost);
    target.style.visibility = 'hidden';
    const dx = t.left + t.width / 2 - (f.rect.left + f.rect.width / 2);
    const dy = t.top + t.height / 2 - (f.rect.top + f.rect.height / 2);
    const s = t.width / f.rect.width;
    const a = ghost.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 30}px) scale(${(1 + s) / 2 + 0.06})`, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
    ], { duration: 520, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
    const finish = () => {
      ghost.remove();
      target.style.visibility = '';
      target.animate([{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
    };
    a.onfinish = finish;
    a.oncancel = finish;
  });
}

/** Keep `--dp-h` = viewport height left below `el` (so stages centre in the visible area). */
export function fitHeight(el, app, pad = 16) {
  const fit = () => {
    if (!el.isConnected) return;
    const top = el.getBoundingClientRect().top + (window.scrollY || 0);
    el.style.setProperty('--dp-h', `${Math.max(260, Math.round(window.innerHeight - top - pad))}px`);
  };
  fit();
  window.addEventListener('resize', fit);
  if (app && app.onCleanup) app.onCleanup(() => window.removeEventListener('resize', fit));
  return fit;
}
