// Owner control panel (Admin → Players): EVERY player (accounts + device guests) with all in-game info, and a
// player screen to see and control their club, coins, account, bans / restrictions, and to message them.
// Club edits are queued as owner patches (online.owner.patchPlayer, migration 007) that the player's client
// applies on its next check-in; coins, bans, restrictions, roles and usernames apply on the server at once.
import { h, clear, add, fmtNum, confirmBox, select, modal } from './dom.js';
import { icon } from './icons.js';
import { playerCard } from './card.js';
import { safeCall } from './app.js';
import { getDB, getPlayer } from '../core/players.js';
import { secretCards } from '../core/secretcard.js';
import { PROMOS } from '../core/promos.js';
import { giftPayloadCard } from '../core/customreg.js';
import { listCustomCards } from './customcards.js';
import { save as saveLocal } from '../core/storage.js';
import { openSendCardModal } from './adminextra.js';

const RESTRICTIONS = [['market', 'Transfer market'], ['packs', 'Packs'], ['messages', 'Messages'], ['codes', 'Using admin codes'], ['admin', 'Activating admin (all staff powers)']];
const DURATION_UNITS = [['s', 'sec'], ['m', 'min'], ['h', 'hr'], ['d', 'day']];
const DURATION_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];
const DESIGNS = [['', 'None'], ['inform', 'In-Form'], ['hero', 'Hero'], ['legend', 'Icon'], ['lotg', 'Legend of the Game'], ['objective', 'Pathfinder'], ...PROMOS.map((p) => [p.id, p.name])];
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '-');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : '-');
const errText = (r) => (r && (r.message || r.error)) || 'failed';
const owner = (app) => app.online && app.online.owner;

/** Parse a length like "30s", "10m", "2h", "1d" (a bare number = minutes) into whole milliseconds, at least
 * one second. -> ms | null (blank = no length given, i.e. permanent) | NaN (typed but not a valid length). */
export function parseDuration(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  const ms = Math.round(n * DURATION_MS[(m[2] || 'm')[0]]);
  return ms >= 1000 ? ms : NaN;
}

/** A number + unit (s/m/h/d) control for ban/timeout/restriction lengths, down to 1 second (blank number =
 * permanent). -> { el, ms(): number | null } */
function durationInput(label, unit = 'm') {
  const n = h('input', { class: 'pm-input pm-input--num', type: 'number', min: '1', step: 'any', placeholder: 'Permanent', style: { maxWidth: '92px' }, 'aria-label': `${label} length` });
  const u = select(DURATION_UNITS, unit, () => {}, { 'aria-label': `${label} unit`, style: { maxWidth: '84px' } });
  return {
    el: h('span', { class: 'pm-btnrow', style: { display: 'inline-flex', gap: '4px', flexWrap: 'nowrap' } }, n, u),
    ms() { const v = Number(n.value); return n.value.trim() && Number.isFinite(v) && v > 0 ? Math.round(v * DURATION_MS[u.value]) : null; },
  };
}

/** Parse a whole coin amount (commas / spaces allowed); safe integers only (up to 9e15). -> number | null */
export function parseCoins(v) {
  const s = String(v ?? '').replace(/[\s,_]/g, '');
  if (!/^-?\d{1,16}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n !== 0 && Math.abs(n) <= 9e15 ? n : null;
}

async function run(app, label, fn, { confirm = null, danger = false } = {}) {
  if (confirm && !(await confirmBox(app.root, label, confirm, label, danger))) return null;
  const r = await safeCall(fn, { ok: false, error: 'offline' });
  app.toast(r && r.ok !== false ? `${label}: done.` : `${label} failed: ${errText(r)}.`, r && r.ok !== false ? 'good' : 'bad');
  return r;
}

function restrictionChips(r) {
  const keys = Object.keys(r || {});
  return keys.map((k) => h('span', { class: 'pm-chip on', style: { minHeight: '22px', fontSize: '11px', padding: '2px 8px', marginLeft: '4px' }, title: r[k] === true ? 'Permanent' : `Until ${when(r[k])}` }, `no ${k}`));
}

/** Readable name for any player: username, else the guest's display name, else their club, else "Guest". */
export function displayName(u) {
  const nm = u && typeof u.name === 'string' && u.name.trim() && !/^player$/i.test(u.name.trim()) ? u.name.trim() : '';
  return (u && u.username) || nm || (u && u.clubName) || 'Guest';
}

// ---------------------------------------------------------------- all players
export function playersPanel(app) {
  const svc = owner(app);
  const wrap = h('section', { class: 'pm-panel pm-admin-sec' });
  if (!svc || typeof svc.allPlayers !== 'function') {
    add(wrap, h('h3', null, icon('squad'), ' Players'), h('p', { class: 'pm-dim' }, 'The player list needs the online service.'));
    return wrap;
  }
  const st = { items: null, filter: '', error: '' };
  const body = h('div');
  const count = h('small', { class: 'pm-dim' });
  const filterInp = h('input', { class: 'pm-input', type: 'search', placeholder: 'Filter the list (optional)…', 'aria-label': 'Filter players' });
  filterInp.addEventListener('input', () => { st.filter = filterInp.value.trim().toLowerCase(); draw(); });
  async function load() {
    clear(body); body.appendChild(h('p', { class: 'pm-dim pm-skel' }, 'Loading every player…'));
    const r = await safeCall(() => svc.allPlayers(), { ok: false, error: 'offline' });
    if (!r || r.ok === false) { st.items = null; st.error = errText(r); } else { st.items = r.items; st.error = ''; }
    draw();
  }
  const mod = app.online && app.online.moderation;
  const quick = async (label, fn, confirmText, danger = false) => { const r = await run(app, label, fn, confirmText ? { confirm: confirmText, danger } : {}); if (r && r.ok !== false) load(); };
  function draw() {
    clear(body);
    if (st.error) { body.appendChild(h('p', { class: 'pm-warnline' }, `Could not load players: ${st.error}.`)); return; }
    if (!st.items) return;
    const f = st.filter;
    const rows = !f ? st.items : st.items.filter((u) => [u.username, u.name, u.clubName, u.friendCode, u.id].some((x) => x && String(x).toLowerCase().includes(f)));
    count.textContent = `${rows.length} of ${st.items.length} players (accounts and device guests), online first.`;
    const sorted = rows.slice().sort((x, y) => (y.online ? 1 : 0) - (x.online ? 1 : 0) || String(y.lastSeenAt || '').localeCompare(String(x.lastSeenAt || '')));
    const list = h('ul', { class: 'pm-plist' }, sorted.map((u) => {
      const name = displayName(u);
      const open = () => app.push(playerDetailView(u.id, u));
      const meta = [u.account ? 'Account' : 'Guest', u.role !== 'player' ? u.role : null, u.clubName || (u.hasSave ? 'Saved club' : null),
        u.infinite ? '∞ coins' : `${fmtNum(u.coins)} coins`, `Rating ${u.rating}`, `${u.wins}-${u.draws}-${u.losses}`].filter(Boolean).join(' · ');
      const btn = (label, ico, onclick, cls = '') => h('button', { class: `pm-btn pm-btn--sm ${cls}`, type: 'button', onclick: (e) => { e.stopPropagation(); onclick(); } }, ico ? icon(ico) : null, ico ? ` ${label}` : label);
      return h('li', { class: `pm-prow ${u.banned ? 'is-banned' : ''}`, 'data-player': u.id },
        h('button', { class: 'pm-prow-main', type: 'button', title: `Open ${name}`, onclick: open },
          h('span', { class: 'pm-prow-av', 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase(), h('i', { class: `pm-onlinedot ${u.online ? 'is-on' : ''}` })),
          h('span', { class: 'pm-prow-who' },
            h('b', null, name, u.banned ? h('span', { class: 'pm-prow-flag' }, u.bannedUntil ? 'Timeout' : 'Banned') : null, ...restrictionChips(u.restrictions)),
            h('small', null, meta),
            h('small', null, `${u.friendCode ? `Code ${u.friendCode} · ` : ''}Joined ${day(u.createdAt)} · Last seen ${u.online ? 'now' : u.lastSeenAt ? when(u.lastSeenAt) : '-'}`))),
        h('div', { class: 'pm-prow-acts' },
          btn('Message', 'bell', async () => { const t = (prompt(`Message to ${name}:`, '') || '').trim(); if (t) quick('Message', () => svc.message(u.id, t)); }),
          btn('Card', 'grant', () => openSendCardModal(app, { toUsername: name, toId: u.id })),
          btn('Coins', 'coins', async () => { const n = parseCoins(prompt(`Coins for ${name} (e.g. 5000 or -5000):`, '')); if (n) quick(n > 0 ? 'Add coins' : 'Remove coins', () => svc.giveCoins(u.id, n, { reason: 'owner panel' })); }),
          u.banned
            ? btn('Unban', null, () => quick('Unban', () => mod.unban(u.id)))
            : [btn('Timeout', null, () => quick('Timeout (1 day)', () => mod.ban(u.id, 'Timeout', new Date(Date.now() + 1440 * 60000)), `Time out ${name} for 1 day?`, true)),
              btn('Ban', 'ban', () => { const reason = (prompt(`Ban ${name}. Reason (shown to the player):`, 'Owner decision') || '').trim(); if (reason) quick('Ban', () => mod.ban(u.id, reason, null)); }, 'pm-btn--danger')],
          btn('Manage', null, open, 'pm-btn--accent'),
          u.role === 'owner' ? null : btn('Delete', null, () => quick('Delete player', () => svc.deletePlayer(u.id), `Delete ${name} completely? Their club, coins, saves and messages are gone for good.`, true), 'pm-btn--danger')));
    }));
    body.appendChild(list);
  }
  load();
  add(wrap,
    h('h3', null, icon('squad'), ' Every player'),
    h('p', { class: 'pm-dim' }, 'Everyone who ever signed in, played or made a team. Message, coins, timeout and ban right here; Manage opens their club, account, access and history.'),
    h('div', { class: 'pm-btnrow pm-wrap' }, filterInp,
      h('button', { class: 'pm-btn', onclick: load }, 'Refresh'),
      // Bulk clean-up of device guests (no username): pick how many days idle; 0 = every guest.
      h('button', {
        class: 'pm-btn pm-btn--danger',
        onclick: async () => {
          const raw = prompt('Delete every guest (no username) not seen for how many days? 0 = all guests.', '7');
          if (raw == null) return;
          const days = Number(String(raw).trim());
          if (!Number.isInteger(days) || days < 0) { app.toast('Enter a whole number of days (0 or more).', 'warn'); return; }
          const r = await run(app, 'Delete guests', () => svc.deleteGuests(days), { confirm: `Delete every guest not seen for ${days} day${days === 1 ? '' : 's'}? This cannot be undone.`, danger: true });
          if (r && r.ok) { app.toast(`${r.deleted} guest${r.deleted === 1 ? '' : 's'} deleted.`, 'good'); load(); }
        },
      }, 'Delete old guests'),
      h('button', {
        class: 'pm-btn pm-btn--danger',
        onclick: async () => {
          const r = await run(app, 'Revoke ALL admin', () => svc.revokeAllAdmin(), { confirm: 'Every mod / owner role (except the reserved owner account and you) becomes a normal player, and every admin code session ends. Continue?', danger: true });
          if (r && r.ok) { saveLocal('adminRevokeSeen', r.revokeAt); app.toast(`${r.revoked} staff role${r.revoked === 1 ? '' : 's'} revoked; all admin sessions ended.`, 'good'); load(); }
        },
      }, icon('lock'), ' Revoke ALL admin')),
    count, body);
  return wrap;
}

// ---------------------------------------------------------------- one player
/** Plain club view of a cloud save (no registration into this device's player database). */
export function saveCards(data) {
  if (!data || !Array.isArray(data.club)) return [];
  const custom = data.customCards && typeof data.customCards === 'object' ? data.customCards : {};
  const foreign = data.foreign && typeof data.foreign === 'object' ? data.foreign : {};
  const edits = data.cardEdits && typeof data.cardEdits === 'object' ? data.cardEdits : {};
  const untrad = new Set(Array.isArray(data.untradeable) ? data.untradeable : []);
  return data.club.map((id) => {
    const base = custom[id] || foreign[id] || getPlayer(id);
    if (!base) return { id, missing: true, tradable: !untrad.has(id) };
    const e = edits[id] || {};
    return { ...base, ...e, stats: { ...(base.stats || {}), ...(e.stats || {}) }, gk: { ...(base.gk || {}), ...(e.gk || {}) }, id, tradable: !untrad.has(id), edited: !!edits[id] };
  });
}

function editCardModal(app, card, onSave) {
  const isGk = card.pos === 'GK';
  const keys = isGk ? ['div', 'han', 'kic', 'ref', 'spd', 'pos'] : ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
  const src = (isGk ? card.gk : card.stats) || {};
  const f = { name: card.name, ovr: card.ovr, pos: card.pos, special: card.special || '', tier: card.tier || 'gold', tradable: card.tradable !== false, stats: Object.fromEntries(keys.map((k) => [k, Number(src[k]) || 50])) };
  const num = (v, on) => { const i = h('input', { class: 'pm-input pm-input--num', type: 'number', min: '1', max: '999', value: String(v) }); i.addEventListener('input', () => on(Number(i.value))); return i; };
  const name = h('input', { class: 'pm-input', value: f.name, maxlength: '32', 'aria-label': 'Name' });
  name.addEventListener('input', () => { f.name = name.value; });
  const trad = h('input', { type: 'checkbox', checked: f.tradable });
  trad.addEventListener('change', () => { f.tradable = trad.checked; });
  const body = h('div', { class: 'pm-cc-form' },
    h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'Name'), name),
    h('div', { class: 'pm-btnrow pm-wrap' },
      h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'OVR'), num(f.ovr, (v) => { f.ovr = v; })),
      select(POSITIONS, f.pos, (v) => { f.pos = v; }, { 'aria-label': 'Position' }),
      select(['bronze', 'silver', 'gold', 'icon'], f.tier, (v) => { f.tier = v; }, { 'aria-label': 'Tier' }),
      select(DESIGNS, f.special, (v) => { f.special = v; }, { 'aria-label': 'Promo / design' })),
    h('div', { class: 'pm-btnrow pm-wrap' }, keys.map((k) => h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, k.toUpperCase()), num(f.stats[k], (v) => { f.stats[k] = v; })))),
    h('label', { class: 'pm-toggle' }, trad, h('span', null, 'Tradable')));
  modal(app.root, {
    title: `Edit ${card.name}`, wide: true, body,
    actions: [{ label: 'Cancel' }, {
      label: 'Save changes', primary: true,
      onClick: () => {
        const fields = { name: f.name, ovr: Math.round(f.ovr), pos: f.pos, special: f.special || null, tier: f.tier, tradable: f.tradable, [isGk ? 'gk' : 'stats']: f.stats };
        onSave(fields);
      },
    }],
  });
}

function addCardModal(app, onAdd) {
  const q = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search any player or Admin Card…', 'aria-label': 'Card search' });
  const res = h('div', { class: 'pm-admin-results' });
  const untrad = h('input', { type: 'checkbox' });
  const draw = () => {
    clear(res);
    const s = q.value.trim().toLowerCase();
    if (s.length < 2) { res.appendChild(h('p', { class: 'pm-dim' }, 'Type at least 2 letters.')); return; }
    const hits = [...listCustomCards().filter((c) => c.name.toLowerCase().includes(s)), ...getDB().all.filter((p) => p.name.toLowerCase().includes(s)).sort((a, b) => b.ovr - a.ovr).slice(0, 20)];
    if (!hits.length) res.appendChild(h('p', { class: 'pm-dim' }, 'No matches.'));
    for (const c of hits) {
      res.appendChild(h('div', { class: 'pm-mktrow' }, playerCard(c, { size: 'xs' }),
        h('div', { class: 'pm-mkt-info' }, h('b', null, c.name), h('span', { class: 'pm-dim' }, `${c.ovr} ${c.pos}${c.customAdmin ? ' · Admin Card' : ''}`)),
        h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', onclick: () => onAdd(c, untrad.checked) }, 'Add')));
    }
  };
  q.addEventListener('input', draw);
  draw();
  modal(app.root, { title: 'Add a card to their club', wide: true, body: h('div', null, q, h('label', { class: 'pm-toggle' }, untrad, h('span', null, 'Untradeable')), res), actions: [{ label: 'Close' }] });
}

/** Pick a card to force out of a pack (database + secret cards; owner, Sep 29). onPick(card) -> keep open unless it returns true. */
export function forcePullPicker(app, onPick, title = 'Force a pack pull') {
  const q = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search any card, e.g. Rabbi Patel…', 'aria-label': 'Card search' });
  const res = h('div', { class: 'pm-admin-results' });
  let close = null;
  const draw = () => {
    clear(res);
    const s = q.value.trim().toLowerCase();
    if (s.length < 2) { res.appendChild(h('p', { class: 'pm-dim' }, 'Type at least 2 letters. Secret cards are included.')); return; }
    const pool = [...secretCards(), ...getDB().all];
    const hits = pool.filter((p) => p.name.toLowerCase().includes(s)).sort((a, b) => (b.secret ? 1 : 0) - (a.secret ? 1 : 0) || b.ovr - a.ovr).slice(0, 24);
    if (!hits.length) res.appendChild(h('p', { class: 'pm-dim' }, 'No matches.'));
    for (const c of hits) {
      res.appendChild(h('div', { class: 'pm-mktrow' }, playerCard(c, { size: 'xs' }),
        h('div', { class: 'pm-mkt-info' }, h('b', null, c.name), h('span', { class: 'pm-dim' }, c.secret ? 'Secret card' : `${c.ovr} ${c.pos}`)),
        h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', onclick: async () => { if ((await onPick(c)) === true && close) close(); } }, 'Force')));
    }
  };
  q.addEventListener('input', draw);
  draw();
  close = modal(app.root, { title, wide: true, body: h('div', null, h('p', { class: 'pm-dim' }, 'The next pack leads with this card (it walks out).'), q, res), actions: [{ label: 'Close' }] });
  return close;
}

export function playerDetailView(id, summary = null) {
  return {
    title: summary ? (summary.username || summary.name || 'Player') : 'Player', kicker: 'Owner · player', cls: 'pm-main--wide',
    render(main, app) {
      const svc = owner(app);
      const box = h('div', null, h('p', { class: 'pm-dim pm-skel' }, 'Loading player…'));
      add(main, box);
      if (!svc || typeof svc.playerDetail !== 'function') { clear(box); box.appendChild(h('p', { class: 'pm-warnline' }, 'Needs the online service.')); return; }
      const reload = () => { if (!app.destroyed) app.refresh(); };
      safeCall(() => svc.playerDetail(id), { ok: false, error: 'offline' }).then((d) => {
        clear(box);
        if (!d || d.ok === false) { box.appendChild(h('p', { class: 'pm-warnline' }, `Could not load this player: ${errText(d)}.`)); return; }
        const p = d.player;
        const patch = async (label, ops) => { const r = await run(app, label, () => svc.patchPlayer(id, ops)); if (r && r.ok) reload(); return r; };

        // -- info
        const info = h('section', { class: 'pm-panel pm-admin-sec' },
          h('h3', null, icon('squad'), ` ${displayName(p)}`, h('span', { class: `pm-onlinedot ${p.online ? 'is-on' : ''}`, style: { marginLeft: '8px' } })),
          h('div', { class: 'pm-dim' }, [
            `${p.account ? 'Account' : 'Device guest'} · role ${p.role} · friend code ${p.friendCode || '-'} · id ${p.id}`, h('br'),
            `Coins ${p.infinite ? '∞ (infinite)' : fmtNum(p.coins)} · rating ${p.rating} · Rivals ${p.rivalsDivision === 0 ? 'Elite' : `D${p.rivalsDivision}`} · ${p.wins}W ${p.draws}D ${p.losses}L`, h('br'),
            `Joined ${when(p.createdAt)} · last login ${when(p.lastLoginAt)} · last seen ${when(p.lastSeenAt)}`, h('br'),
            p.banned ? h('b', { class: 'pm-warnline' }, `${p.bannedUntil ? `Timed out until ${when(p.bannedUntil)}` : 'Banned permanently'}: ${p.banReason || ''}`) : 'Not banned',
            ...restrictionChips(p.restrictions)]));

        // -- coins (no upper limit beyond the safe integer range)
        const amt = h('input', { class: 'pm-input', inputmode: 'numeric', placeholder: 'Amount, e.g. 1,000,000,000', 'aria-label': 'Coin amount' });
        const coinBtn = (sign) => h('button', {
          class: `pm-btn ${sign > 0 ? 'pm-btn--primary' : 'pm-btn--danger'}`,
          onclick: async () => {
            const n = parseCoins(amt.value);
            if (!n || n < 0) { app.toast('Enter a whole positive amount (up to 9,000,000,000,000,000).', 'warn'); return; }
            const r = await run(app, sign > 0 ? 'Add coins' : 'Remove coins', () => svc.giveCoins(id, sign * n, { reason: 'owner panel' }));
            if (r && r.ok) reload();
          },
        }, sign > 0 ? 'Add coins' : 'Remove coins');
        const coins = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('coins'), ' Coins'),
          h('div', { class: 'pm-btnrow pm-wrap' }, amt, coinBtn(1), coinBtn(-1),
            h('button', { class: 'pm-btn', onclick: async () => { const r = await run(app, p.infinite ? 'Infinite off' : 'Infinite on', () => svc.setInfinite(!p.infinite, id)); if (r && r.ok) reload(); } }, icon('infinite'), p.infinite ? ' Turn infinite off' : ' Give infinite coins')));

        // -- account
        const uname = h('input', { class: 'pm-input', value: p.username || '', maxlength: '16', placeholder: 'New username', 'aria-label': 'New username', disabled: !p.account });
        const account = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('key'), ' Account'),
          h('div', { class: 'pm-btnrow pm-wrap' }, uname,
            h('button', { class: 'pm-btn', disabled: !p.account, onclick: async () => { const r = await run(app, 'Change username', () => svc.setUsername(id, uname.value)); if (r && r.ok) reload(); } }, 'Change username')),
          p.account ? null : h('p', { class: 'pm-dim' }, 'Device guests have no username yet.'),
          h('div', { class: 'pm-btnrow pm-wrap' },
            p.role === 'player' ? h('button', { class: 'pm-btn', onclick: async () => { const r = await run(app, 'Give admin', () => svc.giveAdmin(id)); if (r && r.ok) reload(); } }, icon('admin'), ' Give admin (mod)') : null,
            p.role !== 'player' ? h('button', { class: 'pm-btn pm-btn--danger', onclick: async () => { const r = await run(app, 'Revoke admin', () => svc.revokeAdmin(id)); if (r && r.ok) reload(); } }, icon('admin'), ' Revoke admin') : null,
            ...[['coins', 'Reset coins'], ['progress', 'Reset progress'], ['club', 'Reset club'], ['all', 'Reset account']].map(([w, l]) => h('button', {
              class: 'pm-btn pm-btn--danger', onclick: async () => { const r = await run(app, l, () => svc.reset(id, w), { confirm: `${l} for ${p.username || p.name}?`, danger: true }); if (r && r.ok) reload(); },
            }, l)),
            h('button', { class: 'pm-btn pm-btn--danger', onclick: () => patch('Reset objectives', [{ op: 'resetObjectives' }]) }, 'Reset objectives'),
            h('button', { class: 'pm-btn pm-btn--danger', onclick: () => patch('Reset SBCs', [{ op: 'resetSbcs' }]) }, 'Reset SBCs')));

        // -- bans, timeouts, restrictions
        const reason = h('input', { class: 'pm-input', placeholder: 'Reason (shown to the player)', maxlength: '200', 'aria-label': 'Ban reason' });
        // Ban length: number + unit, down to 1 second (owner request); blank = permanent ban.
        const banLen = durationInput('Ban', 'm');
        const mod = app.online.moderation;
        const bans = h('section', { class: 'pm-panel pm-admin-sec pm-admin-danger' }, h('h3', null, icon('ban'), ' Ban · timeout · access'),
          h('div', { class: 'pm-btnrow pm-wrap' }, reason, banLen.el,
            h('button', {
              class: 'pm-btn pm-btn--danger',
              onclick: async () => {
                const ms = banLen.ms();
                if (ms != null && ms < 1000) { app.toast('Shortest ban is 1 second.', 'warn'); return; }
                const until = ms != null ? new Date(Date.now() + ms) : null;
                const banFor = ms != null;
                const r = await run(app, banFor ? 'Timeout' : 'Ban', () => mod.ban(id, reason.value.trim() || 'Owner decision', until), { confirm: `${banFor ? 'Time out' : 'Ban'} ${p.username || p.name}?`, danger: true });
                if (r && r.ok) reload();
              },
            }, 'Ban / timeout'),
            p.banned ? h('button', { class: 'pm-btn', onclick: async () => { const r = await run(app, 'Unban', () => mod.unban(id)); if (r && r.ok) reload(); } }, 'Unban') : null),
          h('div', { class: 'pm-admin-results' }, RESTRICTIONS.map(([k, label]) => {
            // length: number + unit like the ban above (blank = permanent); DURATIONS was removed in a refactor
            // but this row still used it, which crashed the whole Manage screen
            const dur = durationInput(label, 'd');
            const on = p.restrictions && p.restrictions[k];
            return h('div', { class: 'pm-mktrow' },
              h('div', { class: 'pm-mkt-info' }, h('b', null, `Ban from: ${label}`), h('span', { class: 'pm-dim' }, on ? (on === true ? 'Restricted (permanent)' : `Restricted until ${when(on)}`) : 'Allowed')),
              on ? null : dur.el,
              h('button', {
                class: `pm-btn pm-btn--sm ${on ? '' : 'pm-btn--danger'}`,
                onclick: async () => { const ms = on ? null : dur.ms(); const r = await run(app, on ? `Allow ${label}` : `Restrict ${label}`, () => svc.restrict(id, k, { on: !on, minutes: ms ? Math.max(1, Math.ceil(ms / 60000)) : null })); if (r && r.ok) reload(); },
              }, on ? 'Lift' : 'Restrict'));
          })));

        // -- direct message
        const dm = h('textarea', { class: 'pm-input', rows: '2', maxlength: '300', placeholder: `Message to ${p.username || p.name}…`, 'aria-label': 'Direct message' });
        const message = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('bell'), ' Message'),
          dm, h('button', { class: 'pm-btn pm-btn--primary', onclick: async () => { const t = dm.value.trim(); if (!t) return; const r = await run(app, 'Message', () => svc.message(id, t)); if (r && r.ok) dm.value = ''; } }, 'Send message'));

        // -- club
        const club = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('club'), ' Club & cards'));
        if (!d.save.exists) {
          club.appendChild(h('p', { class: 'pm-dim' }, 'No club saved on the server yet. It uploads the next time this player opens the game. Cards you add now are queued and land in their club when they next check in.'));
        } else {
          const data = d.save.data;
          const cards = saveCards(data).sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
          club.appendChild(h('p', { class: 'pm-dim' }, `${data.clubName || 'Club'} · ${cards.length} cards · ${fmtNum(Number(data.coins) || 0)} local coins · saved ${when(d.save.updatedAt)}`));
          const list = h('div', { class: 'pm-admin-results' });
          for (const c of cards) {
            if (c.missing) { list.appendChild(h('div', { class: 'pm-mktrow' }, h('div', { class: 'pm-mkt-info' }, h('b', null, c.id), h('span', { class: 'pm-dim' }, 'Unknown card')), h('button', { class: 'pm-btn pm-btn--sm pm-btn--danger', onclick: () => patch('Remove card', [{ op: 'removeCard', id: c.id }]) }, 'Remove'))); continue; }
            list.appendChild(h('div', { class: 'pm-mktrow' }, playerCard(c, { size: 'xs' }),
              h('div', { class: 'pm-mkt-info' }, h('b', null, c.name), h('span', { class: `pm-dim ${c.tradable ? 'pm-goodline' : ''}` }, `${c.ovr} ${c.pos} · ${c.tradable ? 'Tradable' : 'Untradeable'}${c.edited ? ' · edited' : ''}${c.customAdmin ? ' · Admin Card' : ''}`)),
              h('div', { class: 'pm-btnrow' },
                h('button', { class: 'pm-btn pm-btn--sm', onclick: () => editCardModal(app, c, (fields) => patch(`Edit ${c.name}`, [{ op: 'editCard', id: c.id, fields }])) }, 'Edit'),
                h('button', { class: 'pm-btn pm-btn--sm', onclick: () => patch(c.tradable ? 'Make untradeable' : 'Make tradable', [{ op: 'setTradable', id: c.id, tradable: !c.tradable }]) }, c.tradable ? 'Make untradeable' : 'Make tradable'),
                h('button', { class: 'pm-btn pm-btn--sm pm-btn--danger', onclick: async () => { if (await confirmBox(app.root, 'Remove card', `Remove ${c.name} from their club?`, 'Remove', true)) patch('Remove card', [{ op: 'removeCard', id: c.id }]); } }, 'Remove'))));
          }
          club.appendChild(list);
        }
        club.appendChild(h('div', { class: 'pm-btnrow pm-wrap' },
          h('button', { class: 'pm-btn pm-btn--primary', onclick: () => addCardModal(app, (c, untradeable) => patch(`Add ${c.name}`, [{ op: 'addCard', card: giftPayloadCard(c), untradeable }])) }, icon('grant'), ' Add a card'),
          h('button', { class: 'pm-btn', onclick: () => forcePullPicker(app, async (c) => { const r = await patch(`Force ${c.name} from their next pack`, [{ op: 'forcePull', id: c.id }]); return !!(r && r.ok); }, 'Force a pull for this player') }, icon('chest'), ' Force a pack pull'),
          h('button', { class: 'pm-btn pm-btn--danger', onclick: async () => { if (await confirmBox(app.root, 'Reset club', 'Replace their club with a fresh starter club?', 'Reset club', true)) patch('Reset club', [{ op: 'resetClub' }]); } }, 'Fresh starter club')));
        if (d.patches.length) {
          club.appendChild(h('p', { class: 'pm-warnline' }, `${d.patches.length} change${d.patches.length > 1 ? 's' : ''} waiting, applied when the player next opens Ultimate Team:`));
          club.appendChild(h('ul', { class: 'pm-dim' }, d.patches.map((x) => h('li', null, `${when(x.at)}: ${x.ops.map((o) => o.op + (o.card && o.card.name ? ` ${o.card.name}` : o.id ? ` ${o.id}` : '')).join(', ')}`))));
        }
        if (d.squad && Array.isArray(d.squad.players)) {
          club.appendChild(h('p', { class: 'pm-dim' }, `Shared squad: ${d.squad.name || ''} (${d.squad.formation || ''}): ${d.squad.players.map((x) => `${x.name} ${x.ovr || ''}`).join(', ')}`));
        }

        // -- history
        const hist = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('tag'), ' History'),
          h('ul', { class: 'pm-dim' }, d.audit.slice(0, 25).map((a) => h('li', null, `${when(a.at)} · ${a.action}`))),
          d.listings.length ? h('p', { class: 'pm-dim' }, `Listings: ${d.listings.slice(0, 10).map((l) => `${l.name} ${fmtNum(l.price)} (${l.status})`).join(' · ')}`) : null);

        add(box, h('div', { class: 'pm-admin-grid' }, info, coins, account, bans, message, club, hist));
      }).catch((e) => { clear(box); box.appendChild(h('p', { class: 'pm-warnline' }, `This player screen failed to load: ${(e && e.message) || e}.`)); });
    },
  };
}
