// Admin panel extensions: card creator + Admin Cards gallery (super/owner only), moderation, global
// broadcast, giveaways and global config toggles. Every call into `app.online.*` is feature-detected —
// docs/ONLINE_API.md may not exist yet, so nothing here assumes a shape that isn't checked first.
import { h, clear, add, fmtNum, confirmBox, select } from './dom.js';
import { icon } from './icons.js';
import { playerCard } from './card.js';
import { safeCall } from './app.js';
import { createCustomCard, listCustomCards, deleteCustomCard, grantCustomCard, POSITIONS_ALL } from './customcards.js';
import { getDB } from '../core/players.js';
import { NATIONS } from '../core/data.js';
import { sendLocalGift } from './giftsview.js';
import { getConfig, syncConfig } from './config.js';

const TIERS = ['bronze', 'silver', 'gold', 'icon'];

// ---------------------------------------------------------------- Card Creator + gallery
function cropToCard(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const targetW = 240, targetH = 260; // card avatar aspect
      const c = document.createElement('canvas'); c.width = targetW; c.height = targetH;
      const ctx = c.getContext('2d');
      const s = Math.max(targetW / img.width, targetH / img.height);
      const w = img.width * s, hh = img.height * s;
      ctx.drawImage(img, (targetW - w) / 2, (targetH - hh) / 2, w, hh);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function cardCreatorPanel(app, { level }) {
  const st = { name: '', pos: 'ST', nat: 'ENG', tier: 'gold', photo: null, stats: { pac: 75, sho: 75, pas: 75, dri: 75, def: 45, phy: 70 } };
  const isSuper = level === 'super';
  if (!isSuper) return h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('cardcreator'), ' Card Creator'), h('p', { class: 'pm-dim' }, 'Card creation is restricted to the owner (super) level.'));
  const preview = h('div', { class: 'pm-cc-preview' });
  const drawPreview = () => {
    clear(preview);
    const isGk = st.pos === 'GK';
    const p = { id: 'preview', name: st.name || 'New Player', last: (st.name || 'New Player').split(' ').slice(-1)[0], pos: st.pos, nat: st.nat, club: 'FUT', tier: st.tier, customAdmin: true, photo: st.photo };
    if (isGk) p.gk = { div: st.stats.pac, han: st.stats.sho, kic: st.stats.pas, ref: st.stats.dri, spd: st.stats.def, pos: st.stats.phy };
    else p.stats = st.stats;
    p.ovr = Object.values(st.stats).reduce((a, b) => a + b, 0) / 6 | 0;
    preview.appendChild(playerCard(p, { size: 'md' }));
  };
  const statRow = (key, label) => {
    const row = h('label', { class: 'pm-cc-stat' }, h('span', null, label), h('input', { type: 'range', min: '1', max: '99', value: st.stats[key] }), h('b', null, String(st.stats[key])));
    const range = row.querySelector('input'), out = row.querySelector('b');
    range.addEventListener('input', () => { st.stats[key] = Number(range.value); out.textContent = range.value; drawPreview(); });
    return row;
  };
  const nameInp = h('input', { class: 'pm-input', placeholder: 'Player name', maxlength: '26' });
  nameInp.addEventListener('input', () => { st.name = nameInp.value; drawPreview(); });
  const upload = h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'pm-cc-upload' });
  const uploadMsg = h('small', { class: 'pm-dim' }, 'PNG/JPG — auto-cropped to the card portrait.');
  upload.addEventListener('change', async () => {
    const f = upload.files && upload.files[0];
    if (!f) return;
    uploadMsg.textContent = 'Processing…';
    try { st.photo = await cropToCard(f); uploadMsg.textContent = 'Photo set.'; drawPreview(); }
    catch { uploadMsg.textContent = 'Could not read that image.'; }
  });
  const gallery = h('div', { class: 'pm-cc-gallery' });
  const drawGallery = () => {
    clear(gallery);
    const cards = listCustomCards();
    if (!cards.length) { gallery.appendChild(h('p', { class: 'pm-dim' }, 'No admin cards created yet.')); return; }
    for (const c of cards) {
      gallery.appendChild(h('div', { class: 'pm-cc-item' }, playerCard(c, { size: 'sm' }),
        h('div', { class: 'pm-btnrow' },
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => { const r = grantCustomCard(app.ut, c); app.saveUT(); app.toast(r.integrated ? `${c.name} granted to your club.` : `${c.name} saved (gallery-only — full club integration awaits a core update).`, 'good'); } }, 'Grant to my club'),
          h('button', { class: 'pm-btn pm-btn--danger pm-btn--sm', onclick: () => { deleteCustomCard(c.id); drawGallery(); } }, 'Delete'))));
    }
  };
  drawPreview(); drawGallery();
  return h('section', { class: 'pm-panel pm-admin-sec pm-cardcreator' },
    h('h3', null, icon('cardcreator'), ' Card Creator', h('span', { class: 'pm-chip on' }, 'Super only')),
    h('p', { class: 'pm-dim' }, 'Design a fully custom card. Grants are untradeable; without a core registry hook, a granted card stays visible in this gallery and on your club summary but core screens that read the generated player database (e.g. Squad) will show it as unavailable until that hook lands.'),
    h('div', { class: 'pm-cc-grid' },
      h('div', { class: 'pm-cc-form' },
        nameInp,
        h('div', { class: 'pm-btnrow' },
          select(POSITIONS_ALL, st.pos, (v) => { st.pos = v; drawPreview(); }, { 'aria-label': 'Position' }),
          select(NATIONS.slice(0, 40).map((n) => [n.code, n.name]), st.nat, (v) => { st.nat = v; drawPreview(); }, { 'aria-label': 'Nation' }),
          select(TIERS, st.tier, (v) => { st.tier = v; drawPreview(); }, { 'aria-label': 'Tier' })),
        h('div', { class: 'pm-cc-stats' }, (st.pos === 'GK' ? [['pac', 'DIV'], ['sho', 'HAN'], ['pas', 'KIC'], ['dri', 'REF'], ['def', 'SPD'], ['phy', 'POS']] : [['pac', 'PAC'], ['sho', 'SHO'], ['pas', 'PAS'], ['dri', 'DRI'], ['def', 'DEF'], ['phy', 'PHY']]).map(([k, l]) => statRow(k, l))),
        h('label', { class: 'pm-cc-uploadrow' }, icon('upload'), ' Upload photo', upload), uploadMsg,
        h('button', {
          class: 'pm-btn pm-btn--primary', disabled: !nameInp.value.trim(),
          onclick: () => { createCustomCard({ name: st.name, pos: st.pos, nat: st.nat, tier: st.tier, stats: st.stats, photo: st.photo }); app.toast('Card saved to the Admin Cards gallery.', 'good'); nameInp.value = ''; st.name = ''; st.photo = null; drawPreview(); drawGallery(); },
        }, 'Save to gallery')),
      h('div', { class: 'pm-cc-previewwrap' }, h('div', { class: 'pm-sq-label' }, 'Preview'), preview)),
    h('div', { class: 'pm-cc-galwrap' }, h('div', { class: 'pm-sq-label' }, icon('crop'), ' Admin Cards'), gallery));
}

// ---------------------------------------------------------------- Moderation
export function moderationPanel(app, { level }) {
  const svc = app.online && app.online.moderation;
  const has = (fn) => svc && typeof svc[fn] === 'function';
  if (!svc) return h('section', { class: 'pm-panel' }, h('h3', null, icon('moderation'), ' Moderation'), h('p', { class: 'pm-dim' }, 'Moderation connects to the online service once it is available — nothing to do here offline.'));
  if (typeof svc.mount === 'function') { const el = h('div'); try { const un = svc.mount(el, { level, app }); if (typeof un === 'function') app.onCleanup(un); } catch (e) { console.warn('[meta] moderation mount failed', e); } return el; }
  const st = { q: '' };
  const results = h('div', { class: 'pm-admin-results' });
  const row = (label, ico, id, action, danger) => h('button', { class: `pm-btn pm-btn--sm ${danger ? 'pm-btn--danger' : ''}`, disabled: !has(action), title: has(action) ? '' : 'Not available yet', onclick: () => runAction(action, label, id) }, icon(ico), ` ${label}`);
  async function runAction(fn, label, id, ...args) {
    if (!has(fn)) return;
    if (!(await confirmBox(app.root, label, `${label}?`, label, /ban|reset/i.test(label)))) return;
    const r = await safeCall(() => svc[fn](id, ...args), { ok: false });
    app.toast(r && r.ok !== false ? `${label} done.` : `${label} failed${r && r.error ? `: ${r.error}` : ''}`, r && r.ok !== false ? 'good' : 'bad');
    draw();
  }
  async function draw() {
    clear(results);
    if (st.q.trim().length < 2) { results.appendChild(h('p', { class: 'pm-dim' }, 'Type at least 2 characters of a username.')); return; }
    if (!has('search')) { results.appendChild(h('p', { class: 'pm-dim' }, 'User search is not available from the online service yet.')); return; }
    const r = await safeCall(() => svc.search(st.q.trim()), { ok: false });
    const users = (r && r.ok !== false && (r.items || (Array.isArray(r) ? r : null))) || [];
    if (!users.length) { results.appendChild(h('p', { class: 'pm-dim' }, 'No matches.')); return; }
    for (const u of users) {
      const ownerLevel = can('owner', level);
      results.appendChild(h('div', { class: 'pm-mktrow' },
        h('div', { class: 'pm-mkt-info' }, h('b', null, u.username || u.name || u.id), h('span', { class: 'pm-dim' }, `${u.role || 'player'}${u.ban || u.banned ? ' · BANNED' : ''} · ${fmtNum(u.coins || 0)} coins`)),
        h('div', { class: 'pm-btnrow pm-wrap' },
          row((u.ban || u.banned) ? 'Unban' : 'Ban', 'ban', u.id, (u.ban || u.banned) ? 'unban' : 'ban', !(u.ban || u.banned)),
          row('Adjust coins', 'coins', u.id, 'adjustCoins'),
          row('Make mod', 'admin', u.id, 'setRole'),
          ownerLevel ? h('button', { class: 'pm-btn pm-btn--sm pm-btn--danger', disabled: !app.online || !app.online.owner, onclick: () => runOwnerReset(u.id, 'coins') }, icon('coins'), ' Reset coins') : null,
          ownerLevel ? h('button', { class: 'pm-btn pm-btn--sm pm-btn--danger', disabled: !app.online || !app.online.owner, onclick: () => runOwnerReset(u.id, 'progress') }, icon('reset'), ' Reset progress') : null,
          ownerLevel ? h('button', { class: 'pm-btn pm-btn--sm pm-btn--danger', disabled: !app.online || !app.online.owner, onclick: () => runOwnerReset(u.id, 'club') }, icon('squad'), ' Reset club') : null)));
    }
  }
  async function runOwnerReset(id, what) {
    if (!(await confirmBox(app.root, `Reset ${what}`, `Reset this player's ${what}?`, 'Reset', true))) return;
    const r = await safeCall(() => app.online.owner.reset(id, what), { ok: false });
    app.toast(r && r.ok !== false ? `Reset ${what} done.` : `Reset failed${r && r.error ? `: ${r.error}` : ''}`, r && r.ok !== false ? 'good' : 'bad');
  }
  const search = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search a username…', 'aria-label': 'Search players' });
  search.addEventListener('input', () => { st.q = search.value; draw(); });
  draw();
  return h('section', { class: 'pm-panel' }, h('h3', null, icon('moderation'), ' Moderation'), icon('search', 'pm-inline-search-ico'), search, results);
}

// ---------------------------------------------------------------- Broadcast + giveaways
export function broadcastPanel(app) {
  const svc = app.online && app.online.owner;
  const msg = h('textarea', { class: 'pm-input', rows: '2', maxlength: '200', placeholder: 'Message shown to every online player…' });
  const mins = h('input', { class: 'pm-input pm-input--num', type: 'number', value: '30', min: '1', max: '1440', 'aria-label': 'Minutes shown' });
  const status = h('small', { class: 'pm-dim' });
  return h('section', { class: 'pm-panel pm-admin-sec' },
    h('h3', null, icon('broadcast'), ' Global message'),
    msg,
    h('div', { class: 'pm-btnrow' }, h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'Minutes shown'), mins),
      h('button', {
        class: 'pm-btn pm-btn--primary', disabled: !svc || typeof svc.broadcast !== 'function',
        onclick: async () => {
          const text = msg.value.trim(); if (!text) return;
          const r = await safeCall(() => svc.broadcast(text, Math.max(1, Math.min(1440, Number(mins.value) || 30))), { ok: false });
          if (r && r.ok !== false) { status.textContent = 'Broadcast sent.'; app.toast('Broadcast sent to everyone online.', 'good'); msg.value = ''; }
          else status.textContent = `Failed${r && r.error ? `: ${r.error}` : ''}.`;
        },
      }, 'Broadcast to everyone')),
    status,
    !svc || typeof svc.broadcast !== 'function' ? h('p', { class: 'pm-dim' }, 'Broadcasting needs the online service — not connected in this session.') : null);
}

export function giveawayPanel(app) {
  const st = { target: '', kind: 'coins', amount: 5000, packId: 'gold', pid: '' };
  const db = getDB();
  const owner = app.online && app.online.owner;
  const targetInp = h('input', { class: 'pm-input', placeholder: 'Username (leave blank + "Everyone" for all)', 'aria-label': 'Giveaway target' });
  targetInp.addEventListener('input', () => { st.target = targetInp.value; });
  const kindSel = select([['coins', 'Coins'], ['pack', 'Pack'], ['player', 'Player']], st.kind, (v) => { st.kind = v; redrawExtra(); }, { 'aria-label': 'Giveaway type' });
  const extra = h('div', { class: 'pm-btnrow' });
  function redrawExtra() {
    clear(extra);
    if (st.kind === 'coins') { const inp = h('input', { class: 'pm-input pm-input--num', type: 'number', value: String(st.amount) }); inp.addEventListener('input', () => { st.amount = Number(inp.value) || 0; }); extra.appendChild(inp); }
    else if (st.kind === 'pack') extra.appendChild(select(['bronze', 'silver', 'gold', 'rare', 'premium'], st.packId, (v) => { st.packId = v; }, { 'aria-label': 'Pack' }));
    else { const inp = h('input', { class: 'pm-input', placeholder: 'Player name…', list: 'admin-gw-players' }); inp.addEventListener('input', () => { st.pid = (db.all.find((p) => p.name.toLowerCase() === inp.value.trim().toLowerCase()) || {}).id || ''; }); extra.appendChild(inp); }
  }
  redrawExtra();
  const status = h('small', { class: 'pm-dim' });
  async function give(everyone) {
    if (st.kind === 'player' && !st.pid) { status.textContent = 'Type an exact player name.'; return; }
    const gift = { to: everyone ? 'all' : st.target.trim(), kind: st.kind, coins: st.kind === 'coins' ? st.amount : undefined, packId: st.kind === 'pack' ? st.packId : undefined, card: st.kind === 'player' ? { id: st.pid } : undefined, count: 1 };
    if (owner && typeof owner.gift === 'function') {
      const r = await safeCall(() => owner.gift(gift), { ok: false });
      status.textContent = r && r.ok !== false ? `Sent${everyone ? ' to everyone' : ` to ${st.target}`}.` : `Failed${r && r.error ? `: ${r.error}` : ''}.`;
      if (r && r.ok !== false) app.toast('Giveaway sent.', 'good');
      return;
    }
    // No online giveaway service yet: queue it locally so it can be tested end-to-end via the Gifts inbox.
    sendLocalGift({ ...gift, note: everyone ? 'Giveaway (local device only — no online service connected)' : `Giveaway for ${st.target || 'you'} (local device only)` });
    status.textContent = 'Online giveaways are not connected — queued to this device’s Gifts inbox instead.';
    app.toast('Queued to your Gifts inbox (local demo).', 'good');
  }
  return h('section', { class: 'pm-panel pm-admin-sec' },
    h('h3', null, icon('giveaway'), ' Giveaways'),
    h('p', { class: 'pm-dim' }, 'Send coins, a pack or a player to one user or to everyone.'),
    targetInp, h('div', { class: 'pm-btnrow' }, kindSel, extra),
    h('div', { class: 'pm-btnrow' },
      h('button', { class: 'pm-btn pm-btn--primary', onclick: () => give(false) }, 'Send to user'),
      h('button', { class: 'pm-btn pm-btn--accent', onclick: () => give(true) }, 'Send to everyone')),
    status);
}

// ---------------------------------------------------------------- Global config toggles
export function configPanel(app) {
  const cfg = getConfig();
  const row = (key, label) => h('label', { class: 'pm-toggle' }, h('input', { type: 'checkbox', checked: cfg[key], onchange: async (e) => { await syncConfig(app.online, { [key]: e.target.checked }); app.toast(`${label} ${e.target.checked ? 'on' : 'off'}.`, 'good'); app.refresh(); } }), h('span', null, label));
  const mult = h('input', { type: 'range', min: '0.25', max: '2', step: '0.05', value: String(cfg.priceMult) });
  const multOut = h('b', null, `${cfg.priceMult.toFixed(2)}x`);
  mult.addEventListener('change', async () => { await syncConfig(app.online, { priceMult: Number(mult.value) }); multOut.textContent = `${Number(mult.value).toFixed(2)}x`; app.toast('Price multiplier updated.', 'good'); app.refresh(); });
  mult.addEventListener('input', () => { multOut.textContent = `${Number(mult.value).toFixed(2)}x`; });
  return h('section', { class: 'pm-panel pm-admin-sec' },
    h('h3', null, icon('gear'), ' Global config'),
    row('promosOn', 'Promo campaigns enabled'),
    row('packsInShop', 'Packs available in the shop'),
    h('label', { class: 'pm-cc-stat' }, h('span', null, 'Shop price multiplier'), mult, multOut),
    h('p', { class: 'pm-dim' }, app.online && app.online.config ? 'Synced to the online service when reachable.' : 'Local to this device — the online config service is not connected yet.'));
}
