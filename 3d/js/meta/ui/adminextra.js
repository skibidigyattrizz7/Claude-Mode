// Admin panel extensions: card creator + Admin Cards gallery (super/owner only), moderation, global
// broadcast, giveaways and global config toggles. Every call into `app.online.*` is feature-detected —
// docs/ONLINE_API.md may not exist yet, so nothing here assumes a shape that isn't checked first.
import { h, clear, add, fmtNum, confirmBox, select, modal, frag } from './dom.js';
import { icon } from './icons.js';
import { playerCard } from './card.js';
import { safeCall } from './app.js';
import { createCustomCard, updateCustomCard, duplicateCustomCard, listCustomCards, deleteCustomCard, grantCustomCard, POSITIONS_ALL, ALT_MAX } from './customcards.js';
import { giftPayloadCard } from '../core/customreg.js';
import { getDB } from '../core/players.js';
import { NATIONS } from '../core/data.js';
import { sendLocalGift } from './giftsview.js';
import { getConfig, syncConfig } from './config.js';
import { PROMOS } from '../core/promos.js';
import { PACKS, storePacks } from '../core/ut.js';
import { PLAYSTYLES, bestPlaystylesFor } from '../core/physique.js';
import { psBadge, ensurePsiStyles } from './playstyleicons.js';

const TIERS = ['bronze', 'silver', 'gold', 'icon'];
// Every card "design": base specials + every live/upcoming promo campaign (not capped to a handful).
const DESIGN_OPTIONS = [['', 'None (plain tier look)'], ['inform', 'In-Form'], ['hero', 'Hero'], ['legend', 'Icon (Classic)'], ['lotg', 'Legend of the Game'], ['objective', 'Pathfinder'], ...PROMOS.map((pr) => [pr.id, pr.name])];

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
      // Small enough to travel inside a gift (server bound 200 000 chars): WebP keeps transparency; JPEG fallback.
      let out = c.toDataURL('image/webp', 0.86);
      if (!/^data:image\/webp/.test(out) || out.length > 150000) out = c.toDataURL('image/jpeg', 0.86);
      if (out.length > 150000) out = c.toDataURL('image/jpeg', 0.6);
      resolve(out);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// The creator's draft lives outside the panel: the admin view re-renders on account / config / presence
// events (and a touch release can land right after one), which used to rebuild the panel from defaults and
// snap every slider back. Now a re-render shows exactly what was being edited.
const newDraft = () => ({ editId: null, name: '', pos: 'ST', alt: [], nat: 'ENG', club: 'FUT', tier: 'gold', special: '', photo: null, playstyles: [], stats: { pac: 75, sho: 75, pas: 75, dri: 75, def: 45, phy: 70 } });
/** Load a saved card back into the creator form (edit mode). GK stats map onto the same six sliders. */
function draftFromCard(c) {
  const d = newDraft();
  const isGk = c.pos === 'GK';
  const src = isGk ? c.gk || {} : c.stats || {};
  const keys = isGk ? ['div', 'han', 'kic', 'ref', 'spd', 'pos'] : ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
  ['pac', 'sho', 'pas', 'dri', 'def', 'phy'].forEach((k, i) => { d.stats[k] = Math.max(1, Math.round(Number(src[keys[i]]) || d.stats[k])); });
  return { ...d, editId: c.id, name: c.name || '', pos: c.pos || 'ST', alt: Array.isArray(c.alt) ? c.alt.slice(0, ALT_MAX) : [], nat: c.nat || 'ENG', club: c.club || 'FUT', tier: c.tier || 'gold', special: c.special || '', photo: c.photo || null,
    playstyles: Array.isArray(c.playstyles) ? c.playstyles.map((x) => ({ id: x.id, plus: !!x.plus })) : [] };
}
let ccDraft = newDraft();
/** Test hook: the Card Creator draft (values survive re-renders). */
export function cardCreatorDraft() { return ccDraft; }

export function cardCreatorPanel(app, { level }) {
  const isSuper = level === 'super';
  const cap = isSuper ? 999 : 99;
  const st = ccDraft;
  for (const k of Object.keys(st.stats)) st.stats[k] = Math.max(1, Math.min(cap, Math.round(Number(st.stats[k]) || 1)));
  if (!isSuper) return h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('cardcreator'), ' Card Creator'), h('p', { class: 'pm-dim' }, 'Card creation is restricted to Owner Access.'));
  const preview = h('div', { class: 'pm-cc-preview' });
  const drawPreview = () => {
    clear(preview);
    const isGk = st.pos === 'GK';
    const p = { id: 'preview', name: st.name || 'New Player', last: (st.name || 'New Player').split(' ').slice(-1)[0], pos: st.pos, alt: st.alt.slice(), nat: st.nat, club: 'FUT', tier: st.tier, special: st.special || null, customAdmin: true, photo: st.photo, playstyles: st.playstyles };
    if (isGk) p.gk = { div: st.stats.pac, han: st.stats.sho, kic: st.stats.pas, ref: st.stats.dri, spd: st.stats.def, pos: st.stats.phy };
    else p.stats = st.stats;
    p.ovr = Math.max(1, Math.min(999, Math.round(Object.values(st.stats).reduce((a, b) => a + b, 0) / 6)));
    preview.appendChild(playerCard(p, { size: 'md' }));
  };
  const altRow = h('div', { class: 'pm-cc-alt' });
  const drawAlt = () => {
    clear(altRow);
    add(altRow, h('span', { class: 'pm-dim' }, `Alt positions (up to ${ALT_MAX})`), h('div', { class: 'pm-chips' }, POSITIONS_ALL.filter((p) => p !== st.pos).map((p) => h('button', {
      class: `pm-chip ${st.alt.includes(p) ? 'on' : ''}`,
      disabled: !st.alt.includes(p) && st.alt.length >= ALT_MAX,
      onclick: () => { st.alt = st.alt.includes(p) ? st.alt.filter((x) => x !== p) : [...st.alt, p].slice(0, ALT_MAX); drawAlt(); drawPreview(); },
    }, p))));
  };
  const psRow = h('div', { class: 'pm-cc-ps' });
  const PS_GROUPS = [['attack', 'Shooting'], ['passing', 'Passing'], ['control', 'Ball control'], ['defending', 'Defending'], ['physical', 'Physical'], ['gk', 'Goalkeeping']];
  const drawPs = () => {
    clear(psRow);
    ensurePsiStyles();
    const best = bestPlaystylesFor(st.pos);
    const chip = (id, d) => {
      const cur = st.playstyles.find((x) => x.id === id);
      const b = h('button', {
        class: `pm-chip psi-chip ${cur ? 'on' : ''} ${cur && cur.plus ? 'is-plus' : ''}`, title: `${d[0]}: ${d[3]}`, 'aria-pressed': cur ? 'true' : 'false',
        onclick: () => {
          if (!cur) st.playstyles = [...st.playstyles, { id, plus: false }];
          else if (!cur.plus) st.playstyles = st.playstyles.map((x) => (x.id === id ? { ...x, plus: true } : x));
          else st.playstyles = st.playstyles.filter((x) => x.id !== id);
          drawPs(); drawPreview();
        },
      });
      b.appendChild(frag(psBadge({ id, plus: !!(cur && cur.plus) })));
      b.appendChild(document.createTextNode(`${d[0]}${cur && cur.plus ? '+' : ''}${best.includes(id) ? ' ★' : ''}`));
      return b;
    };
    add(psRow, h('span', { class: 'pm-dim' }, `PlayStyles (tap to add, tap again for PlayStyle+, again to remove). ★ = best for ${st.pos}.`),
      h('div', { class: 'psi-legend' }, frag(psBadge({ id: 'finesse', plus: false })), 'PlayStyle', frag(psBadge({ id: 'finesse', plus: true })), 'PlayStyle+'),
      PS_GROUPS.map(([cat, label]) => h('div', { class: 'pm-cc-psgroup' }, h('small', { class: 'pm-dim' }, label),
        h('div', { class: 'pm-chips pm-wrap' }, Object.entries(PLAYSTYLES).filter(([, d]) => d[1] === cat).map(([id, d]) => chip(id, d))))));
  };
  const statRow = (key, label) => {
    const row = h('div', { class: 'pm-cc-stat' }, h('span', null, label), h('input', { type: 'range', min: '1', max: String(cap), step: '1', 'aria-label': label }), h('b', null, String(st.stats[key])));
    const range = row.querySelector('input'), out = row.querySelector('b');
    range.value = String(st.stats[key]); // property (not only the attribute) so the thumb starts where the draft is
    const commit = () => { const v = Math.max(1, Math.min(cap, Math.round(Number(range.value) || 1))); st.stats[key] = v; out.textContent = String(v); };
    range.addEventListener('input', () => { commit(); drawPreview(); });
    range.addEventListener('change', commit);
    return row;
  };
  const nameInp = h('input', { class: 'pm-input', placeholder: 'Player name', maxlength: '26', value: st.name });
  const saveBtn = h('button', { class: 'pm-btn pm-btn--primary', disabled: !st.name.trim() }, st.editId ? 'Save changes' : 'Save to gallery');
  const editing = st.editId ? listCustomCards().find((c) => c.id === st.editId) : null;
  if (st.editId && !editing) st.editId = null;
  const cancelEdit = st.editId ? h('button', { class: 'pm-btn pm-btn--ghost', onclick: () => { ccDraft = newDraft(); app.refresh(); } }, 'Cancel editing') : null;
  const editNote = editing ? h('p', { class: 'pm-cc-editing' }, `Editing ${editing.name}. Saving updates this card (same card id) everywhere it is used on this device.`) : null;
  nameInp.addEventListener('input', () => { st.name = nameInp.value; saveBtn.disabled = !nameInp.value.trim(); drawPreview(); });
  const upload = h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'pm-cc-upload' });
  const uploadMsg = h('small', { class: 'pm-dim' }, 'PNG/JPG: auto-cropped to the card portrait.');
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
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => {
            if (!app.ut) { app.toast('Create an Ultimate Team club first.', 'warn'); return; }
            const r = grantCustomCard(app.ut, c);
            if (!r.ok) { app.toast(`Could not grant ${c.name} (${r.error || 'invalid card'}).`, 'bad'); return; }
            app.saveUT();
            app.toast(r.duplicate ? `${c.name} is already in your club.` : `${c.name} added to your club (tradable).`, 'good');
          } }, 'Grant to my club'),
          h('button', { class: 'pm-btn pm-btn--sm pm-btn--accent', onclick: () => openSendCardModal(app, { card: c }) }, icon('gifts'), ' Send'),
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => { ccDraft = draftFromCard(c); app.refresh(); try { app.root.querySelector('.pm-cardcreator').scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch { /* ignore */ } } }, 'Edit'),
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => { const d = duplicateCustomCard(c.id); if (d) { app.toast(`${c.name} duplicated.`, 'good'); drawGallery(); } } }, 'Duplicate'),
          h('button', { class: 'pm-btn pm-btn--danger pm-btn--sm', onclick: async () => {
            if (!(await confirmBox(app.root, 'Delete card', `Delete ${c.name} from the Admin Cards gallery? Copies already in clubs stay there.`, 'Delete', true))) return;
            deleteCustomCard(c.id); if (ccDraft.editId === c.id) { ccDraft = newDraft(); app.refresh(); } else drawGallery();
          } }, 'Delete'))));
    }
  };
  saveBtn.addEventListener('click', () => {
    const input = { name: st.name, pos: st.pos, alt: st.alt, nat: st.nat, club: st.club, tier: st.tier, special: st.special || null, stats: st.stats, photo: st.photo, superLevel: isSuper, playstyles: st.playstyles };
    if (st.editId) {
      const card = updateCustomCard(st.editId, input, { state: app.ut });
      if (!card) { app.toast('That card is no longer in the gallery.', 'bad'); ccDraft = newDraft(); app.refresh(); return; }
      if (app.ut) app.saveUT();
      app.toast(`${card.name} updated (${card.ovr} OVR). Other players' copies update when you send it to them again.`, 'good');
      ccDraft = newDraft(); app.refresh();
      return;
    }
    const card = createCustomCard(input);
    app.toast(`${card.name} (${card.ovr} OVR) saved to the Admin Cards gallery.`, 'good');
    nameInp.value = ''; st.name = ''; st.photo = null; st.playstyles = []; st.alt = []; saveBtn.disabled = true; uploadMsg.textContent = 'PNG/JPG: auto-cropped to the card portrait.'; drawPs(); drawAlt(); drawPreview(); drawGallery();
  });
  drawPreview(); drawGallery(); drawAlt(); drawPs();
  return h('section', { class: 'pm-panel pm-admin-sec pm-cardcreator' },
    h('h3', null, icon('cardcreator'), ' Card Creator', h('span', { class: 'pm-chip on' }, 'Owner Access')),
    h('p', { class: 'pm-dim' }, `Design a fully custom card, up to ${fmtNum(cap)} in any stat, any promo design, unlimited PlayStyles and alt positions. Saved cards can be granted to your own club or sent to any player (they arrive in the Gifts inbox and land in the club, tradable).`),
    h('div', { class: 'pm-cc-grid' },
      h('div', { class: 'pm-cc-form' },
        editNote,
        nameInp,
        h('div', { class: 'pm-btnrow' },
          select(POSITIONS_ALL, st.pos, (v) => { st.pos = v; st.alt = st.alt.filter((x) => x !== v); drawAlt(); drawPs(); drawPreview(); }, { 'aria-label': 'Position' }),
          select(NATIONS.slice(0, 60).map((n) => [n.code, n.name]), st.nat, (v) => { st.nat = v; drawPreview(); }, { 'aria-label': 'Nation' }),
          select(TIERS, st.tier, (v) => { st.tier = v; drawPreview(); }, { 'aria-label': 'Tier' })),
        altRow,
        h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'Design'), select(DESIGN_OPTIONS, st.special, (v) => { st.special = v; drawPreview(); }, { 'aria-label': 'Card design / promo' })),
        h('div', { class: 'pm-cc-stats' }, (st.pos === 'GK' ? [['pac', 'DIV'], ['sho', 'HAN'], ['pas', 'KIC'], ['dri', 'REF'], ['def', 'SPD'], ['phy', 'POS']] : [['pac', 'PAC'], ['sho', 'SHO'], ['pas', 'PAS'], ['dri', 'DRI'], ['def', 'DEF'], ['phy', 'PHY']]).map(([k, l]) => statRow(k, l))),
        psRow,
        h('label', { class: 'pm-cc-uploadrow' }, icon('upload'), ' Upload photo', upload), uploadMsg,
        h('div', { class: 'pm-btnrow' }, saveBtn, cancelEdit)),
      h('div', { class: 'pm-cc-previewwrap' }, h('div', { class: 'pm-sq-label' }, 'Preview'), preview)),
    h('div', { class: 'pm-cc-galwrap' }, h('div', { class: 'pm-sq-label' }, icon('crop'), ' Admin Cards'), gallery));
}

// ---------------------------------------------------------------- Moderation
export function moderationPanel(app, { level }) {
  const svc = app.online && app.online.moderation;
  const has = (fn) => svc && typeof svc[fn] === 'function';
  if (!svc) return h('section', { class: 'pm-panel' }, h('h3', null, icon('squad'), ' Players'), h('p', { class: 'pm-dim' }, 'The player list needs the online service. Nothing to do here offline.'));
  if (typeof svc.mount === 'function') { const el = h('div'); try { const un = svc.mount(el, { level, app }); if (typeof un === 'function') app.onCleanup(un); } catch (e) { console.warn('[meta] moderation mount failed', e); } return el; }
  const st = { q: '', page: 0, more: false };
  const results = h('div', { class: 'pm-admin-results' });
  const moreWrap = h('div', { class: 'pm-btnrow' });
  const row = (label, ico, danger, onClick) => h('button', { class: `pm-btn pm-btn--sm ${danger ? 'pm-btn--danger' : ''}`, onclick: onClick }, icon(ico), ` ${label}`);
  async function runAction(fn, label, id, ...args) {
    if (!has(fn)) return;
    if (!(await confirmBox(app.root, label, `${label}?`, label, /ban|reset/i.test(label)))) return;
    const r = await safeCall(() => svc[fn](id, ...args), { ok: false });
    app.toast(r && r.ok !== false ? `${label} done.` : `${label} failed${r && r.error ? `: ${r.error}` : ''}`, r && r.ok !== false ? 'good' : 'bad');
    draw();
  }
  async function draw() {
    clear(results); clear(moreWrap);
    if (!has('search')) { results.appendChild(h('p', { class: 'pm-dim' }, 'User search is not available from the online service yet.')); return; }
    results.appendChild(h('p', { class: 'pm-dim pm-skel' }, 'Loading…'));
    const r = await safeCall(() => svc.search(st.q.trim(), undefined, st.page), { ok: false });
    clear(results);
    if (!r || r.ok === false) { results.appendChild(h('p', { class: 'pm-warnline' }, `Could not load players${r && r.error ? `: ${r.error}` : ''}.`)); return; }
    const users = r.items || [];
    st.more = !!r.more;
    if (!users.length) { results.appendChild(h('p', { class: 'pm-dim' }, st.q.trim() ? 'No matches.' : 'No players yet.')); return; }
    if (!st.q.trim() && st.page === 0) results.appendChild(h('p', { class: 'pm-dim' }, `All players, newest first: ${users.length}${st.more ? '+' : ''} shown.`));
    for (const u of users) {
      const ownerLevel = can('owner', level);
      const banned = u.ban || u.banned;
      const onlineNow = u.lastSeenAt && (Date.now() - new Date(u.lastSeenAt).getTime()) < 60000;
      results.appendChild(h('div', { class: 'pm-mktrow' },
        h('span', { class: `pm-onlinedot ${onlineNow ? 'is-on' : ''}`, title: onlineNow ? 'Online now' : 'Offline' }),
        h('div', { class: 'pm-mkt-info' }, h('b', null, u.username || (u.name && !/^player$/i.test(u.name) ? u.name : '') || u.clubName || 'Guest'),
          h('span', { class: 'pm-dim' }, `${u.role || 'player'}${banned ? ' · BANNED' : ''} · ${fmtNum(u.coins || 0)} coins`),
          h('span', { class: 'pm-dim' }, `Joined ${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'} · Last seen ${u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '-'}`)),
        h('div', { class: 'pm-btnrow pm-wrap' },
          row(banned ? 'Unban' : 'Ban', 'ban', !banned, () => runAction(banned ? 'unban' : 'ban', banned ? 'Unban' : 'Ban', u.id, 'Admin action')),
          row('Adjust coins', 'coins', false, async () => { const v = Number(prompt(`Coin delta for ${u.username || u.name} (e.g. -500 or 500):`, '0')); if (!v) return; runAction('adjustCoins', 'Adjust coins', u.id, v, 'admin'); }),
          row('Make mod', 'admin', false, () => runAction('setRole', 'Make mod', u.id, 'mod')),
          h('button', { class: 'pm-btn pm-btn--sm pm-btn--accent', onclick: () => openSendCardModal(app, { toUsername: u.username || u.id || '' }) }, icon('gifts'), ' Send card'),
          ownerLevel ? row('Reset coins', 'coins', true, () => runOwnerReset(u.id, 'coins')) : null,
          ownerLevel ? row('Reset progress', 'reset', true, () => runOwnerReset(u.id, 'progress')) : null,
          ownerLevel ? row('Reset club', 'squad', true, () => runOwnerReset(u.id, 'club')) : null)));
    }
    if (st.more) moreWrap.appendChild(h('button', { class: 'pm-btn', onclick: () => { st.page++; draw(); } }, 'Load more'));
  }
  async function runOwnerReset(id, what) {
    if (!(await confirmBox(app.root, `Reset ${what}`, `Reset this player's ${what}?`, 'Reset', true))) return;
    const r = await safeCall(() => app.online.owner.reset(id, what), { ok: false });
    app.toast(r && r.ok !== false ? `Reset ${what} done.` : `Reset failed${r && r.error ? `: ${r.error}` : ''}`, r && r.ok !== false ? 'good' : 'bad');
  }
  const search = h('input', { class: 'pm-input', type: 'search', placeholder: 'Filter by username or friend code (optional)', 'aria-label': 'Filter players' });
  search.addEventListener('input', () => { st.q = search.value; draw(); });
  draw();
  return h('section', { class: 'pm-panel' }, h('h3', null, icon('squad'), ' Every player'), h('p', { class: 'pm-dim' }, 'All players, newest first. Ban, adjust coins or send a card from each row. Type to filter (optional).'), search, results, moreWrap);
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
    !svc || typeof svc.broadcast !== 'function' ? h('p', { class: 'pm-dim' }, 'Broadcasting needs the online service, not connected in this session.') : null);
}

/** Send a coins/pack/card gift via `online.owner.gift` (real API) with a local Gifts-inbox fallback.
 * `to`: 'all', a player id, a username or a friend code (resolved to the player id first). */
export async function sendGift(app, { to, kind, coins, packId, card, count = 1, minutes = null }, label) {
  const owner = app.online && app.online.owner;
  const payloadCard = kind === 'card' ? giftPayloadCard(card) : null;
  if (kind === 'card' && !payloadCard) { app.toast(`${label} failed: that card cannot be sent.`, 'bad'); return { ok: false, error: 'bad_card' }; }
  if (owner && typeof owner.gift === 'function' && (await app.onlineAvailable())) {
    let target = to, shown = to;
    if (to !== 'all') {
      const players = app.online.players;
      const r0 = players && typeof players.resolve === 'function' ? await safeCall(() => players.resolve(to), { ok: false, error: 'offline' }) : { ok: true, id: to };
      if (!r0 || r0.ok === false) { const e = (r0 && r0.error) || 'player_not_found'; app.toast(`${label} failed: ${e === 'player_not_found' ? `no player "${to}"` : e}.`, 'bad'); return { ok: false, error: e }; }
      target = r0.id; shown = r0.username || to;
    }
    const r = await safeCall(() => owner.gift({ to: target, kind, coins, packId, card: payloadCard, count, ...(minutes ? { minutes } : {}) }), { ok: false });
    if (r && r.ok !== false) app.toast(`${label} sent${to === 'all' ? ' to everyone' : ` to ${shown}`}. It waits in their Gifts inbox.`, 'good');
    else app.toast(`${label} failed${r && r.error ? `: ${r.error}` : ''}.`, 'bad');
    return r;
  }
  sendLocalGift({ kind: kind === 'card' ? 'player' : kind, amount: coins, packId, count, pid: payloadCard && payloadCard.id, card: payloadCard, note: to === 'all' ? `${label} (local device only, no online service connected)` : `${label} for ${to || 'you'} (local device only)` });
  app.toast('Online gifting is not connected. Queued to this device’s Gifts inbox instead.', 'good');
  return { ok: true, local: true };
}

/** Every sendable card: the full player DB (searchable) plus every Admin Card. */
function findCard(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const db = getDB();
  return db.all.find((p) => p.name.toLowerCase() === q) || listCustomCards().find((c) => c.name.toLowerCase() === q)
    || db.all.find((p) => p.name.toLowerCase().includes(q)) || listCustomCards().find((c) => c.name.toLowerCase().includes(q)) || null;
}

const EXPIRY = [['', 'Expires in 14 days'], ['60', '1 hour'], ['360', '6 hours'], ['1440', '1 day'], ['4320', '3 days'], ['10080', '7 days'], ['43200', '30 days'], ['129600', '90 days']];

/** Pending (unclaimed, unexpired) gifts with Cancel per gift + "Clear all pending gifts". */
export function pendingGiftsPanel(app) {
  const svc = app.online && app.online.owner;
  const list = h('div', { class: 'pm-admin-results' });
  const wrap = h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('gifts'), ' Pending gifts'));
  if (!svc || typeof svc.gifts !== 'function') { wrap.appendChild(h('p', { class: 'pm-dim' }, 'Needs the online service.')); return wrap; }
  const label = (g) => (g.kind === 'coins' ? `${fmtNum(g.coins)} coins` : g.kind === 'pack' ? `${g.count}× ${g.packId} pack` : g.card ? `${g.card.name} (${g.card.ovr})` : 'Card');
  async function draw() {
    clear(list); list.appendChild(h('p', { class: 'pm-dim pm-skel' }, 'Loading…'));
    const r = await safeCall(() => svc.gifts(), { ok: false, error: 'offline' });
    clear(list);
    if (!r || r.ok === false) { list.appendChild(h('p', { class: 'pm-warnline' }, `Could not load gifts: ${(r && (r.message || r.error)) || 'offline'}.`)); return; }
    if (!r.items.length) { list.appendChild(h('p', { class: 'pm-dim' }, 'No pending gifts.')); return; }
    for (const g of r.items) {
      list.appendChild(h('div', { class: 'pm-mktrow', 'data-gift': g.id },
        h('div', { class: 'pm-mkt-info' }, h('b', null, label(g)),
          h('span', { class: 'pm-dim' }, `${g.all ? `Everyone (${g.claims} claimed)` : `To ${g.to ? g.to.username || g.to.name : '?'}`} · sent ${g.at ? new Date(g.at).toLocaleString() : '-'} · expires ${g.until ? new Date(g.until).toLocaleString() : '-'}`)),
        h('button', {
          class: 'pm-btn pm-btn--danger pm-btn--sm',
          onclick: async () => { const x = await safeCall(() => svc.cancelGift(g.id), { ok: false }); app.toast(x && x.ok ? 'Gift cancelled.' : `Cancel failed: ${(x && x.error) || 'offline'}.`, x && x.ok ? 'good' : 'bad'); draw(); },
        }, 'Cancel gift')));
    }
  }
  draw();
  add(wrap, h('div', { class: 'pm-btnrow' },
    h('button', { class: 'pm-btn', onclick: draw }, 'Refresh'),
    h('button', {
      class: 'pm-btn pm-btn--danger',
      onclick: async () => {
        if (!(await confirmBox(app.root, 'Clear all pending gifts', 'Cancel every gift that has not been claimed yet?', 'Clear all', true))) return;
        const x = await safeCall(() => svc.clearGifts(), { ok: false });
        app.toast(x && x.ok ? `${x.cancelled} pending gift${x.cancelled === 1 ? '' : 's'} cancelled.` : `Failed: ${(x && x.error) || 'offline'}.`, x && x.ok ? 'good' : 'bad');
        draw();
      },
    }, 'Clear all pending gifts')), list);
  return wrap;
}

export function giveawayPanel(app) {
  const st = { target: '', kind: 'coins', amount: 5000, packId: 'gold', cardQuery: '', minutes: '' };
  const targetInp = h('input', { class: 'pm-input', placeholder: 'Username (leave blank + "Everyone" for all)', 'aria-label': 'Giveaway target' });
  targetInp.addEventListener('input', () => { st.target = targetInp.value; });
  const kindSel = select([['coins', 'Coins'], ['pack', 'Pack'], ['card', 'Card (any player or Admin Card)']], st.kind, (v) => { st.kind = v; redrawExtra(); }, { 'aria-label': 'Giveaway type' });
  const extra = h('div', { class: 'pm-btnrow' });
  const cardMatch = h('small', { class: 'pm-dim' });
  function redrawExtra() {
    clear(extra); cardMatch.textContent = '';
    if (st.kind === 'coins') { const inp = h('input', { class: 'pm-input pm-input--num', type: 'number', value: String(st.amount) }); inp.addEventListener('input', () => { st.amount = Number(inp.value) || 0; }); extra.appendChild(inp); }
    else if (st.kind === 'pack') extra.appendChild(select(['bronze', 'silver', 'gold', 'rare', 'premium'], st.packId, (v) => { st.packId = v; }, { 'aria-label': 'Pack' }));
    else {
      const inp = h('input', { class: 'pm-input', placeholder: 'Player or Admin Card name…' });
      inp.addEventListener('input', () => { st.cardQuery = inp.value; const c = findCard(st.cardQuery); cardMatch.textContent = c ? `Matched: ${c.name} (${c.ovr} OVR${c.customAdmin ? ' · Admin Card' : ''})` : (st.cardQuery.trim() ? 'No match yet…' : ''); });
      extra.appendChild(inp);
    }
  }
  redrawExtra();
  const status = h('small', { class: 'pm-dim' });
  async function give(everyone) {
    if (!everyone && !st.target.trim()) { status.textContent = 'Enter a username, or use "Send to everyone".'; return; }
    let card = null;
    if (st.kind === 'card') { card = findCard(st.cardQuery); if (!card) { status.textContent = 'No card matches that name.'; return; } }
    const r = await sendGift(app, { to: everyone ? 'all' : st.target.trim(), kind: st.kind, coins: st.kind === 'coins' ? st.amount : undefined, packId: st.kind === 'pack' ? st.packId : undefined, card: card || undefined, minutes: st.minutes ? Number(st.minutes) : null }, 'Giveaway');
    status.textContent = r && r.ok !== false ? 'Sent.' : `Failed${r && r.error ? `: ${r.error}` : ''}.`;
  }
  return h('section', { class: 'pm-panel pm-admin-sec' },
    h('h3', null, icon('giveaway'), ' Giveaways'),
    h('p', { class: 'pm-dim' }, 'Send coins, a pack, or any card (including Admin Cards) to one user or to everyone. Gifted cards are always tradable.'),
    targetInp, h('div', { class: 'pm-btnrow' }, kindSel, extra), cardMatch,
    h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'Expiry'), select(EXPIRY, st.minutes, (v) => { st.minutes = v; }, { 'aria-label': 'Gift expiry' })),
    h('div', { class: 'pm-btnrow' },
      h('button', { class: 'pm-btn pm-btn--primary', onclick: () => give(false) }, 'Send to user'),
      h('button', { class: 'pm-btn pm-btn--accent', onclick: () => give(true) }, 'Send to everyone')),
    status);
}

/**
 * Prominent "Send card" modal: username/friend code + a searchable card picker (DB players + Admin Cards).
 * Exported so the Admin panel's top-level button and Moderation's per-row "Send card" both reuse it.
 */
export function openSendCardModal(app, { toUsername = '', card = null } = {}) {
  const st = { target: toUsername, q: card ? card.name : '', tradable: true };
  const target = h('input', { class: 'pm-input', value: st.target, placeholder: 'Username or friend code', 'aria-label': 'Recipient' });
  target.addEventListener('input', () => { st.target = target.value; });
  const q = h('input', { class: 'pm-input', type: 'search', value: st.q, placeholder: 'Search any player or Admin Card…', 'aria-label': 'Card search' });
  const results = h('div', { class: 'pm-admin-results pm-cc-sendresults' });
  function draw() {
    clear(results);
    const query = st.q.trim().toLowerCase();
    if (query.length < 2) { results.appendChild(h('p', { class: 'pm-dim' }, 'Type at least 2 letters. Admin Cards appear first.')); return; }
    const custom = listCustomCards().filter((c) => c.name.toLowerCase().includes(query));
    const db = getDB();
    const dbHits = db.all.filter((p) => p.name.toLowerCase().includes(query)).sort((a, b) => b.ovr - a.ovr).slice(0, 20);
    const all = [...custom, ...dbHits];
    if (!all.length) { results.appendChild(h('p', { class: 'pm-dim' }, 'No matches.')); return; }
    for (const c of all) {
      results.appendChild(h('div', { class: 'pm-mktrow' }, playerCard(c, { size: 'xs' }),
        h('div', { class: 'pm-mkt-info' }, h('b', null, c.name), h('span', { class: 'pm-dim' }, `${c.ovr} ${c.pos}${c.customAdmin ? ' · Admin Card' : ''}`)),
        h('button', {
          class: 'pm-btn pm-btn--primary pm-btn--sm',
          onclick: async () => {
            if (!st.target.trim()) { app.toast('Enter a username or friend code first.', 'warn'); return; }
            const r = await sendGift(app, { to: st.target.trim(), kind: 'card', card: c }, 'Card');
            if (r && r.ok !== false) close();
          },
        }, 'Send')));
    }
  }
  q.addEventListener('input', () => { st.q = q.value; draw(); });
  draw();
  const close = modal(app.root, {
    title: 'Send / Gift a card', wide: true,
    body: h('div', { class: 'pm-cc-send' },
      h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'To'), target),
      h('p', { class: 'pm-dim' }, 'The card arrives in their Gifts inbox and lands in their club, tradable.'),
      q, results),
    actions: [{ label: 'Close' }],
  });
  return close;
}

// ---------------------------------------------------------------- Global config toggles
export function configPanel(app, { level } = {}) {
  const cfg = getConfig();
  const row = (key, label) => h('label', { class: 'pm-toggle' }, h('input', { type: 'checkbox', checked: cfg[key], onchange: async (e) => { await syncConfig(app.online, { [key]: e.target.checked }); app.toast(`${label} ${e.target.checked ? 'on' : 'off'}.`, 'good'); app.refresh(); } }), h('span', null, label));
  const mult = h('input', { type: 'range', min: '0.25', max: '2', step: '0.05', value: String(cfg.priceMult) });
  const multOut = h('b', null, `${cfg.priceMult.toFixed(2)}x`);
  mult.addEventListener('change', async () => { await syncConfig(app.online, { priceMult: Number(mult.value) }); multOut.textContent = `${Number(mult.value).toFixed(2)}x`; app.toast('Price multiplier updated.', 'good'); app.refresh(); });
  mult.addEventListener('input', () => { multOut.textContent = `${Number(mult.value).toFixed(2)}x`; });
  return h('div', null, h('section', { class: 'pm-panel pm-admin-sec' },
    h('h3', null, icon('gear'), ' Global config'),
    row('promosOn', 'Promo campaigns enabled'),
    row('packsInShop', 'Packs available in the shop'),
    h('label', { class: 'pm-cc-stat' }, h('span', null, 'Shop price multiplier'), mult, multOut),
    h('p', { class: 'pm-dim' }, app.online && app.online.config ? 'Synced to the online service when reachable.' : 'Local to this device: the online config service is not connected yet.')),
    storePacksPanel(app),
    level === 'super' ? resetEveryonePanel(app) : h('section', { class: 'pm-panel pm-admin-sec' }, h('h3', null, icon('reset'), ' Reset everyone'), h('p', { class: 'pm-dim' }, 'Owner Access only.')));
}

/** Store packs on/off: every pack except Admin Vault. Saved to the server config `packs.<id>.enabled`
 * (false hides it, true puts it on sale even when its promo isn't live), so it applies to every player. */
function storePacksPanel(app) {
  const owner = app.online && app.online.owner;
  const online = !!(owner && typeof owner.setConfig === 'function');
  const status = h('small', { class: 'pm-dim' });
  const list = h('div', { class: 'pm-admin-packs' });
  const draw = () => {
    const onSale = new Set(storePacks().map((p) => p.id));
    clear(list);
    for (const p of PACKS.filter((x) => !x.adminOnly)) {
      list.appendChild(h('label', { class: 'pm-toggle' },
        h('input', { type: 'checkbox', checked: onSale.has(p.id), disabled: !online, onchange: async (e) => {
          const on = e.target.checked;
          const cur = (app.online.config && app.online.config.current && app.online.config.current.packs) || {};
          const packs = {};
          for (const [k, v] of Object.entries(cur)) if (v && typeof v === 'object') packs[k] = { ...v };
          packs[p.id] = { ...(packs[p.id] || {}), enabled: on };
          status.textContent = 'Saving…';
          const r = await safeCall(() => owner.setConfig('packs', packs), { ok: false });
          if (r && r.ok !== false) { status.textContent = ''; app.toast(`${p.name} ${on ? 'added to' : 'removed from'} the Store.`, 'good'); }
          else { status.textContent = `Failed${r && r.error ? `: ${r.error}` : ''}.`; }
          draw(); app.refresh();
        } }),
        h('span', null, p.name)));
    }
  };
  draw();
  return h('section', { class: 'pm-panel pm-admin-sec' },
    h('h3', null, icon('gear'), ' Store packs'),
    h('p', { class: 'pm-dim' }, online ? 'Tick a pack to sell it in the Store, untick to remove it. Applies to every player.' : 'Needs the online service: sign in to change the Store for everyone.'),
    list, status);
}

/** Owner-only "reset everyone": bumps the server `features.resetEpoch` so every device wipes its local
 * admin session + infinite coins + sets its UT balance to 5000 next time it checks in, and calls a
 * server-side economy reset RPC when one exists. */
function resetEveryonePanel(app) {
  const status = h('small', { class: 'pm-dim' });
  return h('section', { class: 'pm-panel pm-admin-sec pm-admin-danger' },
    h('h3', null, icon('reset'), ' Reset everyone'),
    h('p', { class: 'pm-dim' }, 'Every connected player’s admin session drops, infinite coins turn off, and their local UT balance resets to 5,000 the next time their game checks in.'),
    h('button', {
      class: 'pm-btn pm-btn--danger', disabled: !app.online || !app.online.config,
      onclick: async () => {
        if (!(await confirmBox(app.root, 'Reset everyone', 'This resets every connected player’s admin session and coin balance. Continue?', 'Reset everyone', true))) return;
        status.textContent = 'Resetting…';
        const owner = app.online.owner;
        let r;
        if (owner && typeof owner.resetEveryone === 'function') r = await safeCall(() => owner.resetEveryone(), { ok: false });
        else {
          // Older backend without the reset RPC: bump the epoch through config only.
          const cur = await safeCall(() => app.online.config.get(), { ok: false });
          const features = { ...(cur && cur.config && cur.config.features) || {}, resetEpoch: Math.floor(Date.now() / 1000) };
          r = owner && typeof owner.setConfig === 'function' ? await safeCall(() => owner.setConfig('features', features), { ok: false }) : { ok: false, error: 'not_connected' };
        }
        if (r && r.ok !== false) { status.textContent = 'Done: every device resets on its next check-in.'; app.toast('Global reset broadcast.', 'good'); app.checkResetEpoch(); }
        else status.textContent = `Failed${r && r.error ? `: ${r.error}` : ''}.`;
      },
    }, 'Reset everyone now'), status);
}
