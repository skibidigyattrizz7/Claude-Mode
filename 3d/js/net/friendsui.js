// Pitchside 3D — Friends panel shared by Settings → Account and Ultimate Team (no need to leave UT):
// your friend code, add a friend by username OR friend code, requests (accept / decline), friends list
// with online status, view their squad, challenge (invite) and remove. Pure DOM on top of online.friends /
// online.players / online.squads (services.js). Never throws.
import { el, ensureAccountCss } from './accountui.js';

const CODE_RE = /^[A-Z0-9]{8}$/;
const safe = async (fn, fb = { ok: false, error: 'offline' }) => { try { const r = await fn(); return r && typeof r === 'object' ? r : fb; } catch { return fb; } };

/**
 * mountFriends(online, { toast, onInvite(friend, mode), inviteModes }) -> HTMLElement.
 * onInvite (optional): start a friend challenge from the host screen (e.g. UT). Without it, no invite buttons.
 */
export function mountFriends(online, { toast = null, onInvite = null, inviteModes = [['friendly', 'Friendly'], ['ut', 'Ultimate Team']] } = {}) {
  ensureAccountCss();
  const note = (t) => { if (toast) try { toast(t); } catch { /* ignore */ } };
  const errText = (r) => (r && (r.message || (online.errorText ? online.errorText(r.error) : r.error))) || 'Something went wrong.';
  const root = el('div', { class: 'acc-friends', 'data-friends': '1' });
  const msg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });
  const codeLine = el('p', { class: 'acc-sub' }, 'Your friend code: …');
  const listBox = el('div', { class: 'acc-friends-list' }, el('p', { class: 'acc-sub' }, 'Loading friends…'));
  const q = el('input', { class: 'acc-input', id: 'friend-add-input', maxlength: '40', placeholder: 'Username or friend code', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Add a friend by username or friend code' });
  let mode = inviteModes[0] ? inviteModes[0][0] : 'friendly';
  const say = (t, kind = '') => { msg.textContent = t || ''; msg.dataset.kind = kind; };

  async function add(e) {
    if (e) e.preventDefault();
    const raw = q.value.trim();
    if (raw.length < 2) { say('Type a username or a friend code.', 'bad'); return; }
    say('Looking up…');
    let code = raw.toUpperCase().replace(/[-\s]/g, '');
    if (!CODE_RE.test(code) || raw.includes(' ')) {
      const f = await safe(() => online.players.find(raw));
      if (!f.ok) { say(errText(f), 'bad'); return; }
      const k = (s) => String(s || '').toLowerCase().replace(/[ _]/g, '');
      const hit = f.items.find((x) => x.username && k(x.username) === k(raw)) || (f.items.length === 1 ? f.items[0] : null);
      if (!hit || !hit.friendCode) { say(f.items.length > 1 ? 'Several players match — type the full username.' : 'No player with that username or friend code.', 'bad'); return; }
      code = hit.friendCode;
    }
    const r = await safe(() => online.friends.add(code));
    if (!r.ok) { say(errText(r), 'bad'); return; }
    q.value = '';
    say(r.status === 'friend' ? `You and ${r.name} are now friends.` : `Friend request sent to ${r.name}.`, 'good');
    note(r.status === 'friend' ? `You and ${r.name} are now friends` : `Friend request sent to ${r.name}`);
    load();
  }

  async function act(f, action, label) {
    const r = await safe(() => online.friends.respond(f.id, action));
    if (!r.ok) { say(errText(r), 'bad'); return; }
    say(`${label}: ${f.name}.`, 'good');
    load();
  }

  async function viewSquad(f, box) {
    box.replaceChildren(el('p', { class: 'acc-sub' }, 'Loading squad…'));
    const r = await safe(() => online.squads.view(f.username || f.friendCode || f.name));
    if (!r.ok) { box.replaceChildren(el('p', { class: 'acc-sub' }, r.error === 'no_squad' ? `${f.name} has not shared a squad yet.` : errText(r))); return; }
    const s = r.squad || {};
    const players = Array.isArray(s.players) ? s.players : [];
    box.replaceChildren(el('div', { class: 'acc-squad' },
      el('b', null, `${s.name || 'Ultimate Team'}${s.formation ? ` · ${s.formation}` : ''}${Number.isFinite(s.rating) ? ` · ${s.rating} OVR` : ''}`),
      el('ol', { class: 'acc-squad-list' }, players.slice(0, 18).map((p) => el('li', null, `${p.pos || ''} ${p.name || 'Player'} ${p.ovr || ''}`.trim())))));
  }

  const row = (f, ...btns) => {
    const extra = el('div', { class: 'acc-friend-extra' });
    return el('li', { class: `acc-friend ${f.online ? 'is-online' : ''}`, 'data-friend-id': f.id },
      el('div', { class: 'acc-friend-main' },
        el('span', { class: 'acc-count-dot', style: `opacity:${f.online ? 1 : 0.25}`, 'aria-hidden': 'true' }),
        el('b', { class: 'acc-friend-name' }, f.name),
        el('small', { class: 'acc-hint' }, f.status === 'friend' ? ` ${f.online ? 'Online' : 'Offline'}${f.rating != null ? ` · ${f.rating}` : ''}` : ''),
        el('span', { class: 'acc-row', style: 'margin-left:auto;gap:6px;flex-wrap:wrap' }, btns.map((b) => (typeof b === 'function' ? b(extra) : b)))),
      extra);
  };
  const btn = (label, onclick, cls = '') => el('button', { class: `acc-btn acc-btn--sm ${cls}`, type: 'button', onclick }, label);

  async function load() {
    const r = await safe(() => online.friends.list());
    if (r.ok && r.code) codeLine.replaceChildren('Your friend code: ', el('b', { id: 'my-friend-code' }, r.code), ' — share it, or add friends by username.');
    if (!r.ok) { listBox.replaceChildren(el('p', { class: 'acc-sub' }, r.error === 'offline' ? 'Friends need the online service — it is unreachable right now.' : errText(r))); return; }
    const g = { friend: [], incoming: [], outgoing: [], blocked: [] };
    for (const f of r.items) (g[f.status] || []).push(f);
    const sections = [];
    if (g.incoming.length) sections.push(el('h4', null, 'Friend requests'), el('ul', { class: 'acc-friend-ul' }, g.incoming.map((f) => row(f, btn('Accept', () => act(f, 'accept', 'Accepted'), 'acc-btn--primary'), btn('Decline', () => act(f, 'decline', 'Declined'))))));
    sections.push(el('h4', null, `Friends (${g.friend.length})`));
    sections.push(g.friend.length ? el('ul', { class: 'acc-friend-ul' }, g.friend.map((f) => row(f,
      (extra) => btn('View squad', () => viewSquad(f, extra)),
      onInvite ? btn('Invite', () => { if (!f.online) { say(`${f.name} is offline — invites reach players who have the game open.`, 'bad'); return; } onInvite(f, mode); }, 'acc-btn--primary') : null,
      btn('Remove', () => { try { if (!window.confirm(`Remove ${f.name}?`)) return; } catch { /* ignore */ } act(f, 'remove', 'Removed'); }, 'acc-btn--ghost'))))
      : el('p', { class: 'acc-sub' }, 'No friends yet — add one by username or friend code above.'));
    if (g.outgoing.length) sections.push(el('h4', null, 'Sent requests'), el('ul', { class: 'acc-friend-ul' }, g.outgoing.map((f) => row(f, el('small', { class: 'acc-hint' }, 'Pending'), btn('Cancel', () => act(f, 'remove', 'Cancelled'))))));
    if (g.blocked.length) sections.push(el('details', null, el('summary', null, `Blocked (${g.blocked.length})`), el('ul', { class: 'acc-friend-ul' }, g.blocked.map((f) => row(f, btn('Unblock', () => act(f, 'unblock', 'Unblocked')))))));
    listBox.replaceChildren(...sections);
  }

  const modeSel = onInvite && inviteModes.length > 1 ? el('label', { class: 'acc-field' }, el('span', { class: 'acc-label' }, 'Invite mode'),
    el('select', { class: 'acc-input', onchange: (e) => { mode = e.target.value; } }, inviteModes.map(([v, l]) => el('option', { value: v }, l)))) : null;
  root.append(
    codeLine,
    el('form', { class: 'acc-row', onsubmit: add, style: 'gap:8px;flex-wrap:wrap' }, q, el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'friend-add-btn' }, 'Add friend')),
    msg, modeSel, listBox);
  load();
  const off = online.presence && typeof online.presence.onUpdate === 'function'
    ? online.presence.onUpdate((u) => { if (!root.isConnected) { if (off) off(); return; } const n = (u && u.requests) || 0; if (n !== (root._req || 0)) { root._req = n; load(); } }) : null;
  root.refresh = load;
  return root;
}
