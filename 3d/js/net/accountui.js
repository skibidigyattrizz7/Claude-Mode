// Pitchside 3D — account UI: first-visit gate (Create account / Log in / Continue as guest), Settings → Account
// (sign out, change username / password), the global broadcast banner and the "N online" counter.
// Pure DOM on top of `online.account.*` / `online.presence.*` (services.js); styles in 3d/css/account.css.
import { mountFriends } from './friendsui.js';
import { passwordHint } from './accountcore.js';

let cssDone = false;
export function ensureAccountCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  if (document.querySelector('link[data-account-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/account.css?v=20260929m', import.meta.url).href;
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
/**
 * Live strength hint under a new-password field (plain text; red while the server would refuse it).
 * getUser() -> current username (the password must not equal it).
 */
function pwHint(pw, getUser) {
  const hint = el('small', { class: 'acc-hint acc-pwhint', 'aria-live': 'polite' });
  const upd = () => {
    const r = passwordHint(pw.value, getUser());
    hint.textContent = r.text;
    hint.dataset.level = String(r.level);
    hint.style.color = !pw.value ? '' : r.level === 0 ? 'var(--bad, #ef4444)' : r.level >= 2 ? 'var(--ok, #22c55e)' : '';
  };
  pw.addEventListener('input', upd);
  upd();
  return hint;
}
const pwField = (label, pw, getUser) => el('label', { class: 'acc-field' }, el('span', { class: 'acc-label' }, label), pw, pwHint(pw, getUser));

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
      put(card, ...head('Your club, everywhere', 'Create a free account to keep your Ultimate Team, coins and friends on any device. You can also play as a guest.'),
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
      u.addEventListener('input', () => { codeRow.hidden = !online.account.isReservedName(u.value); if (p1.value) p1.dispatchEvent(new Event('input')); });
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
      pwField('Password', p1, () => u.value),
      field('Confirm password', p2), codeRow,
      el('label', { class: 'acc-check' }, rem, 'Keep me signed in on this device'),
      el('div', { class: 'acc-row' },
        el('button', { class: 'acc-btn acc-btn--ghost', type: 'button', onclick: choose }, 'Back'),
        el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'acc-su-submit' }, 'Create account')),
      msg);
      put(card, ...head('Create account', online.account.current().hasDevice ? 'Your guest coins, rating and friends move to the new account.' : null), form);
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
      put(card, ...head('Log in', null), form);
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

// ------------------------------------------------------------------ icons (inline SVG, currentColor)
const ICONS = {
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.9.1 4.9 1.9 5.5 5.3"/>',
  offline: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/><path d="M3 3l18 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.5 3.8-7 8-7s7.2 2.5 8 7"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
};
/** Small stroked icon (24×24 viewBox) sized by CSS (.acc-ico, 1em default). */
export function svgIcon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '18'); s.setAttribute('height', '18');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  s.setAttribute('class', `acc-ico acc-ico--${name}`);
  s.innerHTML = ICONS[name] || '';
  return s;
}
/** Parent.replaceChildren without the DOM's habit of printing "null" for skipped (null/false) parts. */
const put = (parent, ...kids) => parent.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

// ------------------------------------------------------------------ Settings → Account
function sectionCard(id, title, sub, ...body) {
  return el('section', { class: 'acc-sec', id },
    el('header', { class: 'acc-sec-h' }, el('h3', null, title), sub ? el('p', null, sub) : null), ...body);
}
/** A collapsible settings row (styled <details>): title + one-line description + chevron; opens a form. */
function disclosure(id, iconName, title, sub, body) {
  return el('details', { class: 'acc-disc', id },
    el('summary', null, el('span', { class: 'acc-disc-ico', 'aria-hidden': 'true' }, svgIcon(iconName)),
      el('span', { class: 'acc-disc-t' }, el('b', null, title), el('small', null, sub)), el('span', { class: 'acc-disc-chev' }, svgIcon('chevron'))),
    el('div', { class: 'acc-disc-body' }, body));
}

export function accountSettingsPane(online, { toast = null } = {}) {
  ensureAccountCss();
  const pane = el('div', { class: 'panel settings acc-pane', id: 'settings-account' });
  const note = (t) => (toast ? toast(t) : null);
  let off = null;
  function render() {
    if (!pane.isConnected && off && pane.dataset.mounted) { off(); off = null; return; }
    const c = online.account.current();
    if (c.state === 'account' || c.state === 'banned') {
      const roleBadge = c.role && c.role !== 'player' ? el('span', { class: `acc-role acc-role--${c.role}` }, c.role === 'owner' ? 'Owner' : 'Admin') : null;
      // change username
      const nu = input({ id: 'acc-cu-user', maxlength: '16', autocomplete: 'username' });
      const np = input({ id: 'acc-cu-pass', type: 'password', maxlength: '72', autocomplete: 'current-password' });
      const nc = input({ id: 'acc-cu-code', type: 'password', maxlength: '128', autocomplete: 'off' });
      const ncRow = field('Owner code', nc); ncRow.hidden = true;
      nu.addEventListener('input', () => { ncRow.hidden = !(online.account.isReservedName(nu.value) && c.role !== 'owner'); });
      const renameMsg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });
      const renameForm = el('form', { class: 'acc-form', id: 'acc-rename', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        if (!nu.value.trim()) { say(renameMsg, 'Type the new username.', 'bad'); nu.focus(); return; }
        busy(renameForm, true); say(renameMsg, 'Saving…');
        const r = await online.account.changeUsername({ username: nu.value, password: np.value, adminCode: nc.value });
        busy(renameForm, false);
        if (!r.ok) { say(renameMsg, r.message || online.errorText(r.error), 'bad'); return; }
        note(`Username changed to ${r.username}`);
      } }, field('New username', nu, '3–16 letters, numbers, _ or single spaces'), field('Current password', np), ncRow,
      el('div', { class: 'acc-form-foot' }, el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'acc-cu-submit' }, 'Change username')), renameMsg);
      // change password
      const op = input({ type: 'password', maxlength: '72', autocomplete: 'current-password', id: 'acc-cp-old' });
      const p1 = input({ type: 'password', maxlength: '72', autocomplete: 'new-password', id: 'acc-cp-new' });
      const p2 = input({ type: 'password', maxlength: '72', autocomplete: 'new-password', id: 'acc-cp-new2' });
      const pwMsg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });
      const pwForm = el('form', { class: 'acc-form', id: 'acc-password', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        busy(pwForm, true); say(pwMsg, 'Saving…');
        const r = await online.account.changePassword({ password: op.value, newPassword: p1.value, confirm: p2.value });
        busy(pwForm, false);
        if (!r.ok) { say(pwMsg, r.message || online.errorText(r.error), 'bad'); return; }
        op.value = p1.value = p2.value = '';
        say(pwMsg, 'Password changed. Other devices were signed out.', 'good');
      } }, field('Current password', op), pwField('New password', p1, () => c.username || ''), field('Repeat new password', p2),
      el('div', { class: 'acc-form-foot' }, el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'acc-cp-submit' }, 'Change password')), pwMsg);
      const outMsg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });
      const signOut = async (all) => { say(outMsg, 'Signing out…'); await online.account.logout(all ? { all: true } : undefined); note(all ? 'Signed out on every device' : 'Signed out'); };
      put(pane,
        el('section', { class: 'acc-sec acc-profile' },
          el('div', { class: 'acc-who' },
            el('div', { class: 'acc-avatar', 'aria-hidden': 'true' }, (c.username || '?').slice(0, 1).toUpperCase()),
            el('div', { class: 'acc-who-t' }, el('div', { class: 'acc-kicker' }, 'Signed in as'), el('div', { class: 'acc-name', id: 'acc-current-name' }, el('span', { class: 'acc-name-t' }, c.username || 'Player'), roleBadge))),
          c.state === 'banned' ? el('div', { class: 'acc-alert', role: 'alert' }, svgIcon('alert'),
            el('div', null, el('b', null, 'This account is banned'), el('p', null, c.ban && c.ban.reason ? `Reason: ${c.ban.reason}` : 'Online play, trading and messages are disabled.'))) : null,
          el('div', { class: 'acc-profile-acts' },
            el('button', { class: 'acc-btn', type: 'button', id: 'acc-signout', onclick: () => signOut(false) }, svgIcon('logout'), el('span', null, 'Sign out')),
            el('button', { class: 'acc-btn acc-btn--ghost acc-btn--dangertext', type: 'button', id: 'acc-signout-all', onclick: () => signOut(true) }, 'Sign out everywhere')),
          outMsg),
        sectionCard('acc-friends', 'Friends', 'See who is online, view squads and send invites.', mountFriends(online, { toast })),
        sectionCard('acc-security', 'Login & security', null,
          el('div', { class: 'acc-discs' },
            disclosure('acc-disc-user', 'user', 'Change username', 'Your name in matches, friends and the market', renameForm),
            disclosure('acc-disc-pass', 'lock', 'Change password', 'Signs you out on your other devices', pwForm))));
    } else {
      put(pane,
        el('section', { class: 'acc-sec acc-profile' },
          el('div', { class: 'acc-who' },
            el('div', { class: 'acc-avatar acc-avatar--guest', 'aria-hidden': 'true' }, svgIcon('user')),
            el('div', { class: 'acc-who-t' }, el('div', { class: 'acc-kicker' }, c.state === 'offline' ? 'Waiting for the server' : 'Playing as'), el('div', { class: 'acc-name', id: 'acc-current-name' }, el('span', { class: 'acc-name-t' }, 'Guest')))),
          el('p', { class: 'acc-sub' }, 'Create an account to keep your club, coins and friends on every device. Your guest progress moves over automatically.'),
          el('div', { class: 'acc-profile-acts' },
            el('button', { class: 'acc-btn acc-btn--primary', type: 'button', id: 'acc-set-signup', onclick: () => openAccountGate(online, { view: 'signup', toast, canDismiss: true }) }, 'Create account'),
            el('button', { class: 'acc-btn', type: 'button', id: 'acc-set-login', onclick: () => openAccountGate(online, { view: 'login', toast, canDismiss: true }) }, 'Log in'))),
        c.state === 'offline' ? null : sectionCard('acc-friends', 'Friends', 'Guests can add friends too. They stay on this device until you create an account.', mountFriends(online, { toast })));
    }
    pane.dataset.mounted = '1';
  }
  render();
  off = online.account.onChange(() => render());
  return pane;
}

// ------------------------------------------------------------------ broadcast banner + online counter
// Owner announcements (everyone) and direct messages to this player pop up at the top of the screen as soon as
// presence reports them (every few seconds). A direct message shows who sent it; both can be dismissed.
export function mountBroadcastBanner(online) {
  ensureAccountCss();
  const wrap = el('div', { class: 'acc-bcast-wrap', 'aria-live': 'polite' });
  document.body.append(wrap);
  const dismissed = new Set();
  const show = (key, kind, from, text, ttl) => {
    if (dismissed.has(key) || wrap.querySelector(`[data-key="${CSS.escape(key)}"]`)) return;
    const item = el('div', { class: `acc-bcast acc-bcast--${kind}`, role: 'status', 'data-key': key },
      el('div', { class: 'acc-bcast-body' },
        el('span', { class: 'acc-bcast-tag' }, kind === 'dm' ? `Message from ${from}` : 'Announcement'),
        el('span', { class: 'acc-bcast-text' }, text)),
      el('button', { class: 'acc-bcast-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { dismissed.add(key); item.remove(); } }, '×'));
    wrap.prepend(item);
    while (wrap.children.length > 3) wrap.lastElementChild.remove();
    setTimeout(() => item.remove(), ttl);
  };
  const offB = online.presence.onBroadcast((b) => {
    const ttl = b.until ? Math.max(4000, Math.min(Date.parse(b.until) - Date.now(), 10 * 60 * 1000)) : 60000;
    show(`b${b.id}`, 'all', '', b.text, ttl);
  });
  // direct messages: when the unread count goes up, show the newest unread message of each conversation
  let lastUnread = 0, busy = false;
  const offU = typeof online.presence.onUpdate === 'function' ? online.presence.onUpdate(async (u) => {
    const n = u && Number.isInteger(u.unread) ? u.unread : 0;
    const grew = n > lastUnread; lastUnread = n;
    if (!grew || busy || !online.messages || typeof online.messages.conversations !== 'function') return;
    busy = true;
    try {
      const r = await online.messages.conversations();
      for (const c of (r && r.ok && r.items) || []) {
        if (!c.unread || c.lastMine) continue;
        const who = c.with.name || c.with.username || 'a player';
        show(`m${c.with.id}|${c.at}`, 'dm', who, c.lastText || (c.lastImage ? 'Sent a photo' : ''), 30000);
      }
    } catch { /* never throws */ } finally { busy = false; }
  }) : null;
  return () => { offB && offB(); offU && offU(); wrap.remove(); };
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
