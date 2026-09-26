// Pitchside 3D — account UI: first-visit gate (Create account / Log in / Continue as guest), Settings → Account
// (sign out, change username / password), the global broadcast banner and the "N online" counter.
// Pure DOM on top of `online.account.*` / `online.presence.*` (services.js); styles in 3d/css/account.css.

let cssDone = false;
export function ensureAccountCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  if (document.querySelector('link[data-account-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/account.css', import.meta.url).href;
  l.dataset.accountCss = '1';
  document.head.appendChild(l);
}

/** Tiny hyperscript helper (attributes: on* = listeners, class, text via children). */
export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

const field = (label, input, hint) => el('label', { class: 'acc-field' }, el('span', { class: 'acc-label' }, label), input, hint ? el('small', { class: 'acc-hint' }, hint) : null);
const input = (o) => el('input', { class: 'acc-input', spellcheck: 'false', autocapitalize: 'off', ...o });
const busy = (form, on) => { for (const x of form.querySelectorAll('input, button')) x.disabled = on; form.classList.toggle('is-busy', on); };
function say(msgEl, text, kind = '') { msgEl.textContent = text || ''; msgEl.dataset.kind = kind; }

// ------------------------------------------------------------------ gate
/**
 * Full-screen account chooser. view: 'choose' | 'signup' | 'login'. Resolves when closed with
 * 'account' | 'guest' | 'dismissed'. Uses .modal-back so main.js' Escape handler leaves it alone.
 */
export function openAccountGate(online, { view = 'choose', toast = null, canDismiss = false } = {}) {
  ensureAccountCss();
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const back = el('div', { class: 'modal-back acc-gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acc-gate-title' });
    const card = el('div', { class: 'acc-card' });
    back.append(card);
    const close = (how) => { back.classList.add('is-out'); setTimeout(() => back.remove(), 180); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) prevFocus.focus(); resolve(how); };
    const onKey = (e) => { if (e.key === 'Escape' && canDismiss) { e.preventDefault(); e.stopPropagation(); close('dismissed'); } };
    document.addEventListener('keydown', onKey, true);
    const msg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });

    const head = (title, sub) => [
      el('div', { class: 'acc-brand', 'aria-hidden': 'true' }, el('span', { class: 'acc-logo' }, 'P3D'), 'Pitchside'),
      el('h2', { id: 'acc-gate-title' }, title), sub ? el('p', { class: 'acc-sub' }, sub) : null,
    ];
    const done = (r, text) => { if (toast) toast(text); close('account'); return r; };

    function choose() {
      card.replaceChildren(...head('Your club, everywhere', 'Create a free account to keep your Ultimate Team, coins and friends on any device. You can also play as a guest.'),
        el('div', { class: 'acc-choices' },
          el('button', { class: 'acc-btn acc-btn--primary', type: 'button', id: 'acc-go-signup', onclick: signup }, 'Create account'),
          el('button', { class: 'acc-btn', type: 'button', id: 'acc-go-login', onclick: login }, 'Log in'),
          el('button', { class: 'acc-btn acc-btn--ghost', type: 'button', id: 'acc-go-guest', onclick: () => { online.account.guest(); close('guest'); } }, 'Continue as guest')),
        el('p', { class: 'acc-fine' }, 'Guests keep a profile on this device only. You can create an account later in Settings → Account.'),
        canDismiss ? el('button', { class: 'acc-x', type: 'button', 'aria-label': 'Close', onclick: () => close('dismissed') }, '×') : null);
      card.querySelector('#acc-go-signup').focus();
    }

    function signup() {
      const u = input({ id: 'acc-su-user', name: 'username', autocomplete: 'username', maxlength: '16', required: true, placeholder: 'e.g. Phonk Mode Fc' });
      const p1 = input({ id: 'acc-su-pass', name: 'password', type: 'password', autocomplete: 'new-password', maxlength: '72', required: true });
      const p2 = input({ id: 'acc-su-pass2', name: 'confirm', type: 'password', autocomplete: 'new-password', maxlength: '72', required: true });
      const code = input({ id: 'acc-su-code', type: 'password', autocomplete: 'off', maxlength: '128' });
      const codeRow = field('Owner code', code, 'This name is reserved for the owner.');
      codeRow.hidden = true;
      const rem = el('input', { type: 'checkbox', id: 'acc-su-remember', checked: true });
      u.addEventListener('input', () => { codeRow.hidden = !online.account.isReservedName(u.value); });
      const form = el('form', { class: 'acc-form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        const err = online.account.validateUsername(u.value) || online.account.validatePassword(p1.value, u.value, p2.value);
        if (err) { say(msg, online.errorText(err), 'bad'); return; }
        busy(form, true); say(msg, 'Creating your account…');
        const r = await online.account.signup({ username: u.value, password: p1.value, confirm: p2.value, remember: rem.checked, adminCode: code.value });
        busy(form, false);
        if (r.ok) return done(r, r.claimed ? `Welcome, ${r.username}! Your guest progress is now on your account.` : `Welcome, ${r.username}!`);
        say(msg, r.message || online.errorText(r.error), r.queued ? 'warn' : 'bad');
        if (r.queued) setTimeout(() => close('dismissed'), 1600);
      } },
      field('Username', u, '3–16 letters, numbers, _ or single spaces'),
      field('Password', p1, 'At least 8 characters'),
      field('Confirm password', p2), codeRow,
      el('label', { class: 'acc-check' }, rem, 'Keep me signed in on this device'),
      el('div', { class: 'acc-row' },
        el('button', { class: 'acc-btn acc-btn--ghost', type: 'button', onclick: choose }, 'Back'),
        el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'acc-su-submit' }, 'Create account')),
      msg);
      card.replaceChildren(...head('Create account', online.account.current().hasDevice ? 'Your guest coins, rating and friends move to the new account.' : null), form);
      say(msg, '');
      u.focus();
    }

    function login() {
      const u = input({ id: 'acc-li-user', name: 'username', autocomplete: 'username', maxlength: '16', required: true });
      const p = input({ id: 'acc-li-pass', name: 'password', type: 'password', autocomplete: 'current-password', maxlength: '72', required: true });
      const rem = el('input', { type: 'checkbox', id: 'acc-li-remember', checked: true });
      const form = el('form', { class: 'acc-form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        busy(form, true); say(msg, 'Logging in…');
        const r = await online.account.login({ username: u.value, password: p.value, remember: rem.checked });
        busy(form, false);
        if (r.ok) return done(r, `Welcome back, ${r.username}!`);
        say(msg, r.message || online.errorText(r.error), 'bad');
        p.select();
      } },
      field('Username', u), field('Password', p),
      el('label', { class: 'acc-check' }, rem, 'Keep me signed in on this device'),
      el('div', { class: 'acc-row' },
        el('button', { class: 'acc-btn acc-btn--ghost', type: 'button', onclick: choose }, 'Back'),
        el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'acc-li-submit' }, 'Log in')),
      msg);
      card.replaceChildren(...head('Log in', null), form);
      say(msg, '');
      u.focus();
    }

    ({ signup, login }[view] || choose)();
    document.body.append(back);
  });
}

/** First visit: show the gate unless the player has an account or chose guest before. */
export function maybeShowAccountGate(online, opts = {}) {
  try {
    const c = online.account.current();
    if (c.state !== 'none' || online.account.isGuest() || c.pending) return Promise.resolve('skip');
  } catch { return Promise.resolve('skip'); }
  return openAccountGate(online, opts);
}

// ------------------------------------------------------------------ Settings → Account
export function accountSettingsPane(online, { toast = null } = {}) {
  ensureAccountCss();
  const pane = el('div', { class: 'panel settings acc-pane', id: 'settings-account' });
  const note = (t) => (toast ? toast(t) : null);
  let off = null;
  function render() {
    if (!pane.isConnected && off && pane.dataset.mounted) { off(); off = null; return; }
    const c = online.account.current();
    const msg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });
    if (c.state === 'account' || c.state === 'banned') {
      const roleBadge = c.role && c.role !== 'player' ? el('span', { class: `acc-role acc-role--${c.role}` }, c.role === 'owner' ? 'Owner' : 'Admin') : null;
      const nu = input({ id: 'acc-cu-user', maxlength: '16', placeholder: 'New username', autocomplete: 'username' });
      const np = input({ id: 'acc-cu-pass', type: 'password', maxlength: '72', placeholder: 'Current password', autocomplete: 'current-password' });
      const nc = input({ id: 'acc-cu-code', type: 'password', maxlength: '128', placeholder: 'Owner code', autocomplete: 'off' });
      const ncRow = field('Owner code', nc); ncRow.hidden = true;
      nu.addEventListener('input', () => { ncRow.hidden = !(online.account.isReservedName(nu.value) && c.role !== 'owner'); });
      const renameForm = el('form', { class: 'acc-form', id: 'acc-rename', onsubmit: async (e) => {
        e.preventDefault();
        busy(renameForm, true); say(msg, 'Saving…');
        const r = await online.account.changeUsername({ username: nu.value, password: np.value, adminCode: nc.value });
        busy(renameForm, false);
        if (!r.ok) { say(msg, r.message || online.errorText(r.error), 'bad'); return; }
        note(`Username changed to ${r.username}`);
      } }, field('New username', nu), field('Current password', np), ncRow,
      el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'acc-cu-submit' }, 'Change username'));
      const op = input({ type: 'password', maxlength: '72', placeholder: 'Current password', autocomplete: 'current-password', id: 'acc-cp-old' });
      const p1 = input({ type: 'password', maxlength: '72', placeholder: 'New password', autocomplete: 'new-password', id: 'acc-cp-new' });
      const p2 = input({ type: 'password', maxlength: '72', placeholder: 'Repeat new password', autocomplete: 'new-password', id: 'acc-cp-new2' });
      const pwForm = el('form', { class: 'acc-form', onsubmit: async (e) => {
        e.preventDefault();
        busy(pwForm, true); say(msg, 'Saving…');
        const r = await online.account.changePassword({ password: op.value, newPassword: p1.value, confirm: p2.value });
        busy(pwForm, false);
        if (!r.ok) { say(msg, r.message || online.errorText(r.error), 'bad'); return; }
        op.value = p1.value = p2.value = '';
        say(msg, 'Password changed. Other devices were signed out.', 'good');
      } }, field('Current password', op), field('New password', p1), field('Repeat new password', p2),
      el('button', { class: 'acc-btn', type: 'submit' }, 'Change password'));
      pane.replaceChildren(
        el('div', { class: 'acc-who' },
          el('div', { class: 'acc-avatar', 'aria-hidden': 'true' }, (c.username || '?').slice(0, 1).toUpperCase()),
          el('div', null, el('div', { class: 'acc-kicker' }, 'Signed in as'), el('div', { class: 'acc-name', id: 'acc-current-name' }, c.username || 'Player', roleBadge))),
        c.state === 'banned' && c.ban ? el('p', { class: 'acc-msg', 'data-kind': 'bad' }, `Banned: ${c.ban.reason}`) : null,
        el('details', { class: 'acc-details' }, el('summary', null, 'Change username'), renameForm),
        el('details', { class: 'acc-details' }, el('summary', null, 'Change password'), pwForm),
        el('div', { class: 'acc-row acc-row--end' },
          el('button', { class: 'acc-btn acc-btn--ghost', type: 'button', id: 'acc-signout-all', onclick: async () => { await online.account.logout({ all: true }); note('Signed out on every device'); } }, 'Sign out everywhere'),
          el('button', { class: 'acc-btn acc-btn--danger', type: 'button', id: 'acc-signout', onclick: async () => { await online.account.logout(); note('Signed out'); } }, 'Sign out')),
        msg);
    } else {
      pane.replaceChildren(
        el('div', { class: 'acc-who' },
          el('div', { class: 'acc-avatar acc-avatar--guest', 'aria-hidden': 'true' }, 'G'),
          el('div', null, el('div', { class: 'acc-kicker' }, c.state === 'offline' ? 'Waiting for the server' : 'Playing as'), el('div', { class: 'acc-name', id: 'acc-current-name' }, 'Guest'))),
        el('p', { class: 'acc-sub' }, 'Create an account to keep your club, coins and friends on every device. Your guest progress moves over automatically.'),
        el('div', { class: 'acc-row' },
          el('button', { class: 'acc-btn acc-btn--primary', type: 'button', id: 'acc-set-signup', onclick: () => openAccountGate(online, { view: 'signup', toast, canDismiss: true }) }, 'Create account'),
          el('button', { class: 'acc-btn', type: 'button', id: 'acc-set-login', onclick: () => openAccountGate(online, { view: 'login', toast, canDismiss: true }) }, 'Log in')),
        msg);
    }
    pane.dataset.mounted = '1';
  }
  render();
  off = online.account.onChange(() => render());
  return pane;
}

// ------------------------------------------------------------------ broadcast banner + online counter
export function mountBroadcastBanner(online) {
  ensureAccountCss();
  const wrap = el('div', { class: 'acc-bcast-wrap', 'aria-live': 'polite' });
  document.body.append(wrap);
  const dismissed = new Set();
  return online.presence.onBroadcast((b) => {
    if (dismissed.has(b.id)) return;
    const ttl = b.until ? Math.max(4000, Math.min(Date.parse(b.until) - Date.now(), 10 * 60 * 1000)) : 60000;
    const item = el('div', { class: 'acc-bcast', role: 'status', 'data-bid': String(b.id) },
      el('span', { class: 'acc-bcast-tag' }, 'Announcement'), el('span', { class: 'acc-bcast-text' }, b.text),
      el('button', { class: 'acc-bcast-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { dismissed.add(b.id); item.remove(); } }, '×'));
    wrap.append(item);
    setTimeout(() => item.remove(), ttl);
  });
}

/** "● 12 online" pill that follows presence updates. */
export function onlineCountBadge(online) {
  ensureAccountCss();
  const n = el('span', { class: 'acc-count-n' }, '–');
  const badge = el('span', { class: 'acc-count', id: 'online-count', title: 'Players online now' }, el('i', { class: 'acc-count-dot', 'aria-hidden': 'true' }), n, ' online');
  const set = (v) => { if (Number.isInteger(v)) { n.textContent = v.toLocaleString('en-US'); badge.dataset.state = 'on'; } };
  online.presence.count().then((r) => { if (r && r.ok) set(r.online); }).catch(() => {});
  const off = online.presence.onUpdate((u) => { if (!badge.isConnected && badge.dataset.state) { off(); return; } if (u) set(u.online); });
  return badge;
}
