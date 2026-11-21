// Reactive layer for the secret cards' own designs (css/cards-secret.css). No card.js hook needed: one delegated
// pointer listener on the document tilts the hovered secret card and moves its light, and an IntersectionObserver
// pauses the cards that are off-screen (`sx-off` stops their CSS animations).
//   * mouse and pen only (touch just gets the ambient motion); nothing at all under prefers-reduced-motion
//   * xs cards and the full-art cards (Rabbi Patel, E-Man, E.L.I.J.A.H.) are left alone
//   * per pointer move: one rAF, four custom properties on one element
// DOM-free at import time (node tests import `tiltFor`); call `initSecretFx()` in the browser (done below).

export const SECRET_FX_SELECTOR = '.pm-card.sp-secret:not(.is-fullart):not(.pm-card--xs)';
export const MAX_TILT = 9; // degrees

/** Pointer position (0..1 in the card) -> tilt in degrees and light position. The card leans away from the pointer side. */
export function tiltFor(px, py, max = MAX_TILT) {
  const c = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
  const x = c(px), y = c(py);
  return { rx: +((0.5 - y) * 2 * max).toFixed(2), ry: +((x - 0.5) * 2 * max).toFixed(2), px: +x.toFixed(3), py: +y.toFixed(3) };
}

let started = false;

export function initSecretFx(doc = typeof document !== 'undefined' ? document : null) {
  if (started || !doc || !doc.defaultView) return;
  started = true;
  const win = doc.defaultView;
  const reduced = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ---- pointer tilt + light ----
  let cur = null, rect = null, raf = 0, last = null, clearTimer = 0;
  function apply() {
    raf = 0;
    if (!cur || !last) return;
    const t = tiltFor((last.x - rect.left) / rect.width, (last.y - rect.top) / rect.height);
    const s = cur.style;
    s.setProperty('--sx-rx', `${t.rx}deg`); s.setProperty('--sx-ry', `${t.ry}deg`);
    s.setProperty('--sx-px', String(t.px)); s.setProperty('--sx-py', String(t.py));
  }
  function release(el) {
    if (!el) return;
    el.style.setProperty('--sx-hov', '0');
    el.style.setProperty('--sx-rx', '0deg'); el.style.setProperty('--sx-ry', '0deg');
    // drop the tilt class once the card has eased back, so an idle card carries no transform
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { if (cur !== el) el.classList.remove('sx-tilt'); }, 260);
  }
  doc.addEventListener('pointermove', (e) => {
    if (reduced.matches || (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    const el = e.target && e.target.closest ? e.target.closest(SECRET_FX_SELECTOR) : null;
    if (el !== cur) {
      const prev = cur; cur = el;
      if (prev) release(prev);
      if (el) { rect = el.getBoundingClientRect(); el.classList.add('sx-tilt'); el.style.setProperty('--sx-hov', '1'); }
    }
    if (!el) return;
    last = { x: e.clientX, y: e.clientY };
    if (!raf) raf = win.requestAnimationFrame(apply);
  }, { passive: true });
  doc.documentElement.addEventListener('pointerleave', () => { const p = cur; cur = null; release(p); }, { passive: true });
  win.addEventListener('blur', () => { const p = cur; cur = null; release(p); });

  // ---- pause off-screen cards ----
  if (!win.IntersectionObserver) return;
  const io = new win.IntersectionObserver((entries) => {
    for (const en of entries) en.target.classList.toggle('sx-off', !en.isIntersecting);
  }, { rootMargin: '80px' });
  const watch = (el) => { if (!el.__sx) { el.__sx = 1; io.observe(el); } };
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('.pm-card.sp-secret')) watch(root);
    if (root.querySelectorAll) root.querySelectorAll('.pm-card.sp-secret').forEach(watch);
  };
  scan(doc.documentElement);
  new win.MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(scan); }).observe(doc.documentElement, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') initSecretFx();
