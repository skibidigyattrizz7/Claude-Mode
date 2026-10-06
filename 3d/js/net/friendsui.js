// Pitchside 3D — Friends panel shared by Settings → Account and Ultimate Team (no need to leave UT):
// your friend code (copy), add a friend by username OR friend code, requests (accept / decline), friends list
// with online status, view their squad, challenge (invite) and remove. Pure DOM on top of online.friends /
// online.players / online.squads (services.js). Styles: 3d/css/account.css (.fr-*). Never throws.
import { el, ensureAccountCss, svgIcon } from './accountui.js';

const CODE_RE = /^[A-Z0-9]{8}$/;
const safe = async (fn, fb = { ok: false, error: 'offline' }) => { try { const r = await fn(); return r && typeof r === 'object' ? r : fb; } catch { return fb; } };
const initial = (s) => (String(s || '?').trim().slice(0, 1) || '?').toUpperCase();
const fmtCode = (c) => (c && c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c || '');

/**
 * mountFriends(online, { toast, onInvite(friend, mode), inviteModes }) -> HTMLElement.
 * onInvite (optional): start a friend challenge from the host screen (e.g. UT). Without it, no invite buttons.
 */
export function mountFriends(online, { toast = null, onInvite = null, inviteModes = [['friendly', 'Friendly'], ['ut', 'Ultimate Team']] } = {}) {
  ensureAccountCss();
  const note = (t) => { if (toast) try { toast(t); } catch { /* ignore */ } };
  const errText = (r) => (r && (r.message || (online.errorText ? online.errorText(r.error) : r.error))) || 'Something went wrong.';
  const root = el('div', { class: 'fr', 'data-friends': '1' });
  const msg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });
  const say = (t, kind = '') => { msg.textContent = t || ''; msg.dataset.kind = kind; };

  // ---- friend code chip + copy
  const codeVal = el('b', { class: 'fr-code-val', id: 'my-friend-code' }, '········');
  const copyBtn = el('button', { class: 'acc-btn acc-btn--sm fr-copy', type: 'button', id: 'copy-friend-code', disabled: true, 'aria-label': 'Copy your friend code' }, svgIcon('copy'), el('span', null, 'Copy'));
  let myCode = '';
  copyBtn.addEventListener('click', async () => {
    if (!myCode) return;
    let ok = false;
    try { await navigator.clipboard.writeText(myCode); ok = true; } catch { /* clipboard blocked */ }
    copyBtn.lastChild.textContent = ok ? 'Copied' : myCode;
    copyBtn.classList.toggle('is-done', ok);
    note(ok ? 'Friend code copied' : `Your friend code: ${myCode}`);
    setTimeout(() => { copyBtn.lastChild.textContent = 'Copy'; copyBtn.classList.remove('is-done'); }, 1600);
  });
  const codeCard = el('div', { class: 'fr-code' },
    el('div', { class: 'fr-code-txt' }, el('span', { class: 'acc-label' }, 'Your friend code'), codeVal),
    copyBtn);

  // ---- add form
  const q = el('input', { class: 'acc-input', id: 'friend-add-input', maxlength: '40', placeholder: 'Username or friend code', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'send' });
  const addBtn = el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'friend-add-btn' }, svgIcon('plus'), el('span', null, 'Add'));
  const addForm = el('form', { class: 'fr-add', onsubmit: add },
    el('label', { class: 'acc-label', for: 'friend-add-input' }, 'Add a friend'),
    el('div', { class: 'fr-add-row' }, q, addBtn), msg);

  // ---- invite mode (segmented)
  let mode = inviteModes[0] ? inviteModes[0][0] : 'friendly';
  let modeSeg = null;
  if (onInvite && inviteModes.length > 1) {
    const btns = inviteModes.map(([v, l]) => el('button', { class: 'acc-seg-b', type: 'button', role: 'radio', 'aria-checked': String(v === mode), 'data-mode': v,
      onclick: () => { mode = v; for (const b of btns) b.setAttribute('aria-checked', String(b.dataset.mode === v)); } }, l));
    modeSeg = el('div', { class: 'fr-mode' }, el('span', { class: 'acc-label', id: 'fr-mode-l' }, 'Invite friends to'),
      el('div', { class: 'acc-seg', role: 'radiogroup', 'aria-labelledby': 'fr-mode-l' }, btns));
  }

  const listBox = el('div', { class: 'fr-lists', 'aria-live': 'polite' }, skeleton());

  async function add(e) {
    if (e) e.preventDefault();
    const raw = q.value.trim();
    if (raw.length < 2) { say('Type a username or a friend code.', 'bad'); q.focus(); return; }
    addBtn.disabled = true;
    say('Looking up…');
    try {
      let code = raw.toUpperCase().replace(/[-\s]/g, '');
      if (!CODE_RE.test(code) || raw.includes(' ')) {
        const f = await safe(() => online.players.find(raw));
        if (!f.ok) { say(errText(f), 'bad'); return; }
        const items = Array.isArray(f.items) ? f.items : [];
        const k = (s) => String(s || '').toLowerCase().replace(/[ _]/g, '');
        const hit = items.find((x) => x.username && k(x.username) === k(raw)) || (items.length === 1 ? items[0] : null);
        if (!hit || !hit.friendCode) { say(items.length > 1 ? 'Several players match. Type the full username.' : 'No player with that username or friend code.', 'bad'); return; }
        code = hit.friendCode;
      }
      if (code === myCode) { say('That is your own friend code.', 'bad'); return; }
      const r = await safe(() => online.friends.add(code));
      if (!r.ok) { say(errText(r), 'bad'); return; }
      q.value = '';
      const who = r.name || 'that player';
      say(r.status === 'friend' ? `You and ${who} are now friends.` : `Friend request sent to ${who}.`, 'good');
      note(r.status === 'friend' ? `You and ${who} are now friends` : `Friend request sent to ${who}`);
      load();
    } finally { addBtn.disabled = false; }
  }

  async function act(f, action, label, btnEl) {
    if (btnEl) btnEl.disabled = true;
    const r = await safe(() => online.friends.respond(f.id, action));
    if (!r.ok) { if (btnEl) btnEl.disabled = false; say(errText(r), 'bad'); return; }
    say(`${label}: ${f.name}.`, 'good');
    load();
  }

  async function viewSquad(f, box, btnEl) {
    if (box.childElementCount) { box.replaceChildren(); box.hidden = true; btnEl.setAttribute('aria-expanded', 'false'); return; }
    box.hidden = false;
    btnEl.setAttribute('aria-expanded', 'true');
    box.replaceChildren(el('p', { class: 'acc-fine' }, 'Loading squad…'));
    const r = await safe(() => online.squads.view(f.username || f.friendCode || f.name));
    if (!r.ok) { box.replaceChildren(el('p', { class: 'acc-fine' }, r.error === 'no_squad' ? `${f.name} has not shared a squad yet.` : errText(r))); return; }
    const s = r.squad || {};
    const players = (Array.isArray(s.players) ? s.players : []).filter((p) => p && typeof p === 'object');
    const meta = [typeof s.formation === 'string' ? s.formation : null, Number.isFinite(s.rating) ? `${s.rating} OVR` : null].filter(Boolean).join(' · ');
    box.replaceChildren(
      el('div', { class: 'fr-squad-h' }, el('b', null, typeof s.name === 'string' && s.name ? s.name : 'Ultimate Team'), meta ? el('small', null, meta) : null),
      players.length ? el('ol', { class: 'fr-squad' }, players.slice(0, 18).map((p, i) => el('li', { class: i >= 11 ? 'sub' : '' },
        el('span', { class: 'fr-sq-ovr' }, Number.isFinite(Number(p.ovr)) ? String(p.ovr) : '–'),
        el('span', { class: 'fr-sq-pos' }, typeof p.pos === 'string' ? p.pos : ''),
        el('span', { class: 'fr-sq-name' }, typeof p.name === 'string' ? p.name : 'Player'))))
        : el('p', { class: 'acc-fine' }, 'No players in this snapshot.'));
  }

  const btn = (label, onclick, cls = '', attrs = {}) => {
    const b = el('button', { class: `acc-btn acc-btn--sm ${cls}`, type: 'button', ...attrs }, label);
    b.addEventListener('click', () => onclick(b));
    return b;
  };
  const STATUS = { friend: null, incoming: 'Wants to be friends', outgoing: 'Request sent', blocked: 'Blocked' };
  function row(f, actions, extra = null) {
    const sub = f.status === 'friend'
      ? [f.online ? 'Online' : 'Offline', f.rating != null ? `Rating ${f.rating}` : null].filter(Boolean).join(' · ')
      : STATUS[f.status] || '';
    return el('li', { class: `fr-row ${f.online ? 'is-online' : ''} fr-row--${f.status}`, 'data-friend-id': f.id },
      el('div', { class: 'fr-row-main' },
        el('span', { class: 'fr-av', 'aria-hidden': 'true' }, initial(f.name), el('i', { class: 'fr-dot' })),
        el('div', { class: 'fr-who' },
          el('b', { class: 'fr-name' }, f.name || 'Player'),
          el('small', { class: 'fr-sub' }, f.status === 'outgoing' ? el('span', { class: 'fr-pill' }, 'Pending') : null, sub)),
        el('div', { class: 'fr-acts' }, actions)),
      extra);
  }

  function section(title, count, list) {
    return el('section', { class: 'fr-sec' }, el('h4', { class: 'fr-h' }, title, count != null ? el('span', { class: 'fr-n' }, String(count)) : null), list);
  }

  function emptyState() {
    return el('div', { class: 'fr-empty' }, el('span', { class: 'fr-empty-ico', 'aria-hidden': 'true' }, svgIcon('friends')),
      el('b', null, 'No friends yet'),
      el('p', null, myCode ? 'Share your friend code, or add a friend by their username above.' : 'Add a friend by their username or friend code above.'));
  }
  function skeleton() {
    return el('div', { class: 'fr-skel', 'aria-hidden': 'true' }, el('i'), el('i'));
  }

  async function load() {
    const r = await safe(() => online.friends.list());
    if (r.ok && r.code) { myCode = r.code; codeVal.textContent = fmtCode(r.code); copyBtn.disabled = false; codeCard.hidden = false; }
    if (!r.ok) {
      codeCard.hidden = !myCode;
      listBox.replaceChildren(el('div', { class: 'fr-empty' }, el('span', { class: 'fr-empty-ico', 'aria-hidden': 'true' }, svgIcon('offline')),
        el('b', null, r.error === 'offline' ? 'Friends are offline' : 'Friends could not be loaded'),
        el('p', null, r.error === 'offline' ? 'The online service is unreachable right now. Try again in a moment.' : errText(r))));
      return;
    }
    const g = { friend: [], incoming: [], outgoing: [], blocked: [] };
    for (const f of Array.isArray(r.items) ? r.items : []) (g[f.status] || []).push(f);
    g.friend.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    const out = [];
    if (g.incoming.length) {
      out.push(section('Friend requests', g.incoming.length, el('ul', { class: 'fr-ul' }, g.incoming.map((f) => row(f, [
        btn('Accept', (b) => act(f, 'accept', 'Accepted', b), 'acc-btn--primary'),
        btn('Decline', (b) => act(f, 'decline', 'Declined', b)),
      ])))));
    }
    out.push(section('Friends', g.friend.length, g.friend.length ? el('ul', { class: 'fr-ul' }, g.friend.map((f) => {
      const extra = el('div', { class: 'fr-extra', hidden: true });
      return row(f, [
        onInvite ? btn('Invite', () => {
          if (!f.online) { say(`${f.name} is offline. Invites reach players who have the game open.`, 'bad'); return; }
          onInvite(f, mode);
        }, 'acc-btn--primary', { disabled: !f.online, title: f.online ? `Invite ${f.name}` : `${f.name} is offline` }) : null,
        btn('View squad', (b) => viewSquad(f, extra, b), '', { 'aria-expanded': 'false' }),
        btn('Remove', (b) => { try { if (!window.confirm(`Remove ${f.name} from your friends?`)) return; } catch { /* ignore */ } act(f, 'remove', 'Removed', b); }, 'acc-btn--ghost'),
      ], extra);
    })) : emptyState()));
    if (g.outgoing.length) {
      out.push(section('Sent requests', g.outgoing.length, el('ul', { class: 'fr-ul' }, g.outgoing.map((f) => row(f, [btn('Cancel', (b) => act(f, 'remove', 'Cancelled', b), 'acc-btn--ghost')])))));
    }
    if (g.blocked.length) {
      out.push(el('details', { class: 'fr-blocked' }, el('summary', null, `Blocked players (${g.blocked.length})`),
        el('ul', { class: 'fr-ul' }, g.blocked.map((f) => row(f, [btn('Unblock', (b) => act(f, 'unblock', 'Unblocked', b))])))));
    }
    listBox.replaceChildren(...out);
  }

  const top = el('div', { class: 'fr-top' }, codeCard, addForm);
  root.append(top);
  if (modeSeg) root.append(modeSeg);
  root.append(listBox);
  load();
  const off = online.presence && typeof online.presence.onUpdate === 'function'
    ? online.presence.onUpdate((u) => { if (!root.isConnected) { if (off) off(); return; } const n = (u && u.requests) || 0; if (n !== (root._req || 0)) { root._req = n; load(); } }) : null;
  root.refresh = load;
  return root;
}
