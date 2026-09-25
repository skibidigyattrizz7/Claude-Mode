// Tiny DOM helpers used by the meta UI (only imported by UI modules).

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** h('div', { class: 'x', onclick: fn, style: {...} }, ...children) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendAll(el, children);
  return el;
}
function appendAll(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Build a node from a trusted (internally generated) HTML/SVG string. */
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

let toastTimer = null;
export function toast(root, msg, kind = 'info') {
  let box = root.querySelector('.pm-toasts');
  if (!box) { box = h('div', { class: 'pm-toasts', role: 'status', 'aria-live': 'polite' }); root.appendChild(box); }
  const t = h('div', { class: `pm-toast pm-toast--${kind}` }, msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
  clearTimeout(toastTimer);
}

/**
 * Modal dialog appended to root. actions: [{label, primary, danger, onClick(close) -> bool|void}]
 * Returns close().
 */
export function modal(root, { title, body, actions = [], wide = false, onClose = null, className = '' }) {
  const prevFocus = document.activeElement;
  const back = h('div', { class: 'pm-modal-back' });
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const box = h('div', { class: `pm-modal ${wide ? 'pm-modal--wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    title ? h('div', { class: 'pm-modal-head' }, h('h3', null, title), h('button', { class: 'pm-x', 'aria-label': 'Close', onclick: close }, '×')) : null,
    h('div', { class: 'pm-modal-body' }, body),
    actions.length ? h('div', { class: 'pm-modal-actions' }, actions.map((a) => h('button', {
      class: `pm-btn ${a.primary ? 'pm-btn--primary' : ''} ${a.danger ? 'pm-btn--danger' : ''}`,
      disabled: a.disabled,
      onclick: () => { const r = a.onClick ? a.onClick(close) : undefined; if (r !== false) close(); },
    }, a.label))) : null);
  back.appendChild(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  root.appendChild(back);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { const f = box.querySelector('.pm-modal-actions .pm-btn--primary') || box.querySelector('button,input,select'); if (f) f.focus(); }, 0);
  return close;
}

export function confirmBox(root, title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    modal(root, {
      title, body: h('p', null, text),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, primary: !danger, danger, onClick: () => { done = true; resolve(true); } },
      ],
    });
  });
}

export function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }

export function select(options, value, onchange, attrs = {}) {
  return h('select', { class: 'pm-select', ...attrs, onchange: (e) => onchange(e.target.value) },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: String(v) === String(value) }, l);
    }));
}
