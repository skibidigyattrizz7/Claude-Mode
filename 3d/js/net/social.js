// Pitchside 3D — small social UI: direct messages (text + small pictures) and "View squad".
// Opened from the Online screen. Everything goes through online.players / online.messages / online.squads.
import { el, ensureAccountCss } from './accountui.js';

const fmtTime = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : ''; };
const who = (p) => (p ? p.username || p.name || 'Player' : 'Player');

/** Modal wrapper. -> close() */
export function openSocial(online, opts = {}) {
  ensureAccountCss();
  const back = el('div', { class: 'modal-back acc-social-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Messages and squads' });
  const box = el('div', { class: 'acc-social-box' });
  back.append(box);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  let inner = null;
  function close() { document.removeEventListener('keydown', onKey, true); if (inner) inner.destroy(); back.remove(); }
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  inner = mountSocial(box, { ...opts, online, onClose: close });
  return close;
}

/**
 * mountSocial(root, { online, tab:'messages'|'squad', withId, squadQuery, onClose }) -> { destroy }
 */
export function mountSocial(root, { online, tab = 'messages', withId = null, squadQuery = '', onClose = null } = {}) {
  let alive = true;
  let poll = 0;
  const tabs = el('div', { class: 'acc-tabs', role: 'tablist' });
  const body = el('div', { class: 'acc-social-body' });
  const header = el('div', { class: 'acc-social-head' },
    el('h2', null, 'Social'), tabs,
    onClose ? el('button', { class: 'acc-x', type: 'button', 'aria-label': 'Close', id: 'social-close', onclick: onClose }, '×') : null);
  root.replaceChildren(header, body);
  const select = (t) => {
    clearInterval(poll);
    for (const b of tabs.children) { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    if (t === 'squad') squadTab(squadQuery); else messagesTab();
  };
  tabs.append(...[['messages', 'Messages'], ['squad', 'View squad']].map(([t, label]) => el('button', { class: 'acc-tab', type: 'button', role: 'tab', 'data-tab': t, id: `social-tab-${t}`, onclick: () => select(t) }, label)));

  // ---------------------------------------------------------------- messages
  function messagesTab() {
    const acc = online.account.current();
    if (acc.state !== 'account') {
      body.replaceChildren(el('div', { class: 'acc-empty' }, el('p', null, 'Messages need an account (so people know who they are talking to).'),
        el('p', { class: 'acc-fine' }, 'Create one or log in from Settings → Account.')));
      return;
    }
    const list = el('div', { class: 'acc-convs', id: 'social-convs' }, el('p', { class: 'acc-fine' }, 'Loading…'));
    const q = el('input', { class: 'acc-input', id: 'social-find', placeholder: 'Find a player (username or friend code)', maxlength: '40', autocomplete: 'off' });
    const results = el('div', { class: 'acc-results', id: 'social-results' });
    const find = el('form', { class: 'acc-find', onsubmit: async (e) => {
      e.preventDefault();
      results.replaceChildren(el('p', { class: 'acc-fine' }, 'Searching…'));
      const r = await online.players.find(q.value);
      if (!alive) return;
      if (!r.ok) { results.replaceChildren(el('p', { class: 'acc-msg', 'data-kind': 'bad' }, r.message || online.errorText(r.error))); return; }
      const me = online.account.current().id;
      const items = r.items.filter((p) => p.id !== me);
      results.replaceChildren(...(items.length ? items.map((p) => el('button', { class: 'acc-conv', type: 'button', 'data-player': p.id, onclick: () => openThread(p) },
        el('span', { class: `acc-dot ${p.online ? 'on' : ''}`, 'aria-hidden': 'true' }), el('b', null, who(p)), p.friendCode ? el('small', null, p.friendCode) : null))
        : [el('p', { class: 'acc-fine' }, 'Nobody found.')]));
    } }, q, el('button', { class: 'acc-btn', type: 'submit' }, 'Find'));
    const side = el('div', { class: 'acc-side' }, find, results, el('h3', null, 'Conversations'), list);
    const main = el('div', { class: 'acc-thread', id: 'social-thread' }, el('div', { class: 'acc-empty' }, 'Pick a conversation or find a player.'));
    body.replaceChildren(el('div', { class: 'acc-msgs' }, side, main));
    async function loadConvs() {
      const r = await online.messages.conversations();
      if (!alive) return;
      if (!r.ok) { list.replaceChildren(el('p', { class: 'acc-msg', 'data-kind': 'bad' }, r.message || online.errorText(r.error))); return; }
      list.replaceChildren(...(r.items.length ? r.items.map((c) => el('button', { class: 'acc-conv', type: 'button', 'data-player': c.with.id, onclick: () => openThread(c.with) },
        el('span', { class: `acc-dot ${c.with.online ? 'on' : ''}`, 'aria-hidden': 'true' }), el('b', null, who(c.with)),
        el('small', null, `${c.lastMine ? 'You: ' : ''}${c.lastImage && !c.lastText ? '[picture]' : c.lastText}`.slice(0, 40)),
        c.unread ? el('span', { class: 'acc-unread' }, String(c.unread)) : null))
        : [el('p', { class: 'acc-fine' }, 'No messages yet.')]));
    }
    let current = null;
    async function openThread(p) {
      current = p;
      body.querySelector('.acc-msgs').classList.add('has-thread');
      const log = el('div', { class: 'acc-log', id: 'social-log' }, el('p', { class: 'acc-fine' }, 'Loading…'));
      const text = el('input', { class: 'acc-input', id: 'social-text', maxlength: String(online.messages.MAX_TEXT || 300), placeholder: `Message ${who(p)}`, autocomplete: 'off' });
      const file = el('input', { type: 'file', accept: 'image/*', hidden: true, id: 'social-file' });
      const preview = el('div', { class: 'acc-preview' });
      const msg = el('p', { class: 'acc-msg', role: 'status', 'aria-live': 'polite' });
      let image = null;
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        msg.textContent = 'Compressing picture…';
        const r = await online.messages.compressImage(f);
        if (!r.ok) { msg.textContent = online.errorText('bad_image'); msg.dataset.kind = 'bad'; return; }
        image = r.dataUrl;
        msg.textContent = `Picture ready (${Math.round(r.bytes / 1024)} KB)`; msg.dataset.kind = '';
        preview.replaceChildren(el('img', { src: image, alt: 'Picture to send' }), el('button', { class: 'acc-x', type: 'button', 'aria-label': 'Remove picture', onclick: () => { image = null; preview.replaceChildren(); msg.textContent = ''; } }, '×'));
      });
      const form = el('form', { class: 'acc-compose', onsubmit: async (e) => {
        e.preventDefault();
        if (!text.value.trim() && !image) return;
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        const r = await online.messages.send(p.id, text.value, image);
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.message || online.errorText(r.error); msg.dataset.kind = 'bad'; return; }
        text.value = ''; image = null; preview.replaceChildren(); msg.textContent = '';
        await loadThread(); loadConvs();
      } },
      el('button', { class: 'acc-btn acc-btn--ghost', type: 'button', title: 'Attach a picture', 'aria-label': 'Attach a picture', onclick: () => file.click() }, '📷'),
      text, file, el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'social-send' }, 'Send'));
      main.replaceChildren(
        el('div', { class: 'acc-thread-head' },
          el('button', { class: 'acc-btn acc-btn--ghost acc-only-narrow', type: 'button', onclick: () => { body.querySelector('.acc-msgs').classList.remove('has-thread'); current = null; } }, '‹'),
          el('b', null, who(p)), p.friendCode ? el('small', null, p.friendCode) : null,
          el('button', { class: 'acc-btn acc-btn--ghost', type: 'button', onclick: () => select('squad') || squadTab(p.username || p.friendCode || '') }, 'View squad')),
        log, preview, form, msg);
      text.focus();
      async function loadThread() {
        const r = await online.messages.thread(p.id);
        if (!alive || current !== p) return;
        if (!r.ok) { log.replaceChildren(el('p', { class: 'acc-msg', 'data-kind': 'bad' }, r.message || online.errorText(r.error))); return; }
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        log.replaceChildren(...(r.items.length ? r.items.map((m) => el('div', { class: `acc-bubble ${m.mine ? 'mine' : ''}`, 'data-mid': String(m.id) },
          m.image ? el('img', { src: m.image, alt: 'Picture', loading: 'lazy' }) : null, m.text ? el('span', null, m.text) : null,
          el('time', null, fmtTime(m.at))))
          : [el('p', { class: 'acc-fine' }, 'Say hi!')]));
        if (atBottom || log.dataset.first !== '1') { log.scrollTop = log.scrollHeight; log.dataset.first = '1'; }
      }
      await loadThread();
      clearInterval(poll);
      poll = setInterval(() => { if (!document.hidden) loadThread(); }, 5000);
    }
    loadConvs();
    if (withId) { const id = withId; withId = null; openThread({ id, name: 'Player' }); }
  }

  // ---------------------------------------------------------------- view squad
  function squadTab(initial = '') {
    const q = el('input', { class: 'acc-input', id: 'social-squad-q', placeholder: 'Username or friend code', maxlength: '40', value: initial, autocomplete: 'off' });
    const out = el('div', { class: 'acc-squad', id: 'social-squad' });
    const form = el('form', { class: 'acc-find', onsubmit: async (e) => {
      e.preventDefault();
      out.replaceChildren(el('p', { class: 'acc-fine' }, 'Loading…'));
      const r = await online.squads.view(q.value);
      if (!alive) return;
      if (!r.ok) { out.replaceChildren(el('p', { class: 'acc-msg', 'data-kind': r.error === 'no_squad' ? '' : 'bad' }, r.error === 'no_squad' && r.owner ? `${who(r.owner)} has not shared a squad yet.` : r.message || online.errorText(r.error))); return; }
      out.replaceChildren(renderSquad(r));
    } }, q, el('button', { class: 'acc-btn acc-btn--primary', type: 'submit', id: 'social-squad-go' }, 'View'));
    body.replaceChildren(el('div', { class: 'acc-squad-wrap' }, form,
      el('p', { class: 'acc-fine' }, 'Squads are shared from Ultimate Team. Anyone can look up a squad by username or friend code.'), out));
    if (initial) form.requestSubmit();
  }
  function renderSquad(r) {
    const s = r.squad || {};
    const players = Array.isArray(s.players) ? s.players.filter((p) => p && typeof p === 'object') : [];
    const ovrs = players.map((p) => Number(p.ovr)).filter(Number.isFinite);
    const avg = ovrs.length ? Math.round(ovrs.slice(0, 11).reduce((a, b) => a + b, 0) / Math.min(11, ovrs.length)) : null;
    return el('div', null,
      el('div', { class: 'acc-squad-head' },
        el('div', null, el('div', { class: 'acc-kicker' }, who(r.owner)), el('h3', null, typeof s.name === 'string' && s.name ? s.name : 'Ultimate Team')),
        el('div', { class: 'acc-squad-meta' }, typeof s.formation === 'string' ? el('span', null, s.formation) : null, avg ? el('span', null, `${avg} OVR`) : null,
          r.updatedAt ? el('small', null, `Updated ${fmtTime(r.updatedAt)}`) : null)),
      players.length ? el('ol', { class: 'acc-squad-list' }, ...players.map((p, i) => el('li', { class: i >= 11 ? 'sub' : '' },
        el('span', { class: 'acc-ovr' }, Number.isFinite(Number(p.ovr)) ? String(p.ovr) : '–'), el('span', { class: 'acc-pos' }, typeof p.pos === 'string' ? p.pos : ''),
        el('span', { class: 'acc-pname' }, typeof p.name === 'string' ? p.name : 'Player'))))
        : el('p', { class: 'acc-fine' }, 'No players in this snapshot.'));
  }

  select(tab === 'squad' ? 'squad' : 'messages');
  return { destroy() { alive = false; clearInterval(poll); } };
}
