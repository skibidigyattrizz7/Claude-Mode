// Gifts inbox: coins / packs / players sent to the player (admin giveaways, promos, welcome gifts).
// Backed by `online.gifts` when the net agent's service exists (see docs/ONLINE_API.md — feature-detected,
// since that doc/service may not exist yet); always falls back to a local per-device inbox so the UI works
// standalone and is testable offline. Local gifts are also how the Admin panel's "giveaway to me" works.
import { h, clear, add, fmtNum, modal } from './dom.js';
import { icon } from './icons.js';
import { load, save } from '../core/storage.js';
import { safeCall } from './app.js';
import * as UT from '../core/ut.js';
import { getPlayer } from '../core/players.js';
import { openPackFlow } from './utview.js';
import { importCustomCard } from './customcards.js';

const LOCAL_KEY = 'meta.gifts.local';
let uid = 0;
const nid = () => `g${Date.now()}_${uid++}`;

function readLocal() { const l = load(LOCAL_KEY, []); return Array.isArray(l) ? l : []; }
function writeLocal(list) { save(LOCAL_KEY, list); }

/** Queue a gift into the local inbox (used by the Admin panel giveaway tool and welcome-back drops). */
export function sendLocalGift(gift) {
  const list = readLocal();
  list.unshift({ id: nid(), at: Date.now(), from: 'Owner', ...gift });
  writeLocal(list.slice(0, 60));
  return list[0];
}

/** Normalised gift list: `online.gifts.inbox()` first (when available), local device queue always appended. */
async function listGifts(app) {
  let remote = [];
  if (app.online && app.online.gifts && typeof app.online.gifts.inbox === 'function' && (await app.onlineAvailable())) {
    const r = await safeCall(() => app.online.gifts.inbox());
    if (r && r.ok !== false && Array.isArray(r.items)) remote = r.items.map((g) => ({ ...g, kind: g.kind || (g.coins ? 'coins' : g.packId ? 'pack' : g.card ? 'player' : 'coins'), amount: g.coins, pid: g.card && g.card.id, remote: true }));
  }
  return [...remote, ...readLocal()];
}

function rewardLabel(g) {
  if (g.kind === 'coins') return `${fmtNum(g.amount || 0)} coins`;
  if (g.kind === 'pack') return `${UT.PACK_BY_ID[g.packId] ? UT.PACK_BY_ID[g.packId].name : g.packId} pack`;
  if (g.kind === 'player' || g.kind === 'card') { const p = getPlayer(g.pid) || g.card; return p ? `${p.name} (${p.ovr} OVR)` : 'Player card'; }
  return 'Gift';
}

/** Apply a gift's reward to the local UT save and remove it from whichever inbox held it. */
async function claimGift(app, g) {
  const s = app.ut;
  if (!s) { app.toast('Create a Ultimate Team club first.', 'warn'); return; }
  let kind = g.kind, amount = g.amount, packId = g.packId, pid = g.pid, count = g.count || 1, card = g.card || null;
  if (g.remote && app.online && app.online.gifts && typeof app.online.gifts.claim === 'function') {
    const r = await safeCall(() => app.online.gifts.claim(g.id), { ok: false });
    if (!r || r.ok === false) { app.toast(r && r.error ? r.error : 'Claim failed', 'bad'); return; }
    kind = r.kind || kind; amount = r.coins ?? amount; packId = r.packId || packId; card = r.card || card; pid = (r.card && r.card.id) || pid; count = r.count || count;
    if (kind === 'coins') { s.coins = Math.max(0, s.coins + (amount || 0)); app.saveUT(); app.toast(`+${fmtNum(amount || 0)} coins claimed.`, 'good'); app.refresh(); return; }
  } else {
    const list = readLocal();
    const i = list.findIndex((x) => x.id === g.id);
    if (i >= 0) list.splice(i, 1);
    writeLocal(list);
  }
  if (kind === 'coins') { s.coins = Math.max(0, s.coins + (amount || 0)); app.saveUT(); app.toast(`+${fmtNum(amount || 0)} coins claimed.`, 'good'); }
  else if (kind === 'pack') { app.saveUT(); for (let i = 1; i < count; i++) s.packs.push({ type: packId, from: 'Gift' }); openPackFlow(app, packId); }
  else if (kind === 'player' || kind === 'card') {
    const p = getPlayer(pid) || card;
    if (!p) { app.toast('Card data missing from this gift.', 'bad'); }
    else if (s.club.includes(p.id)) { s.coins += 500; app.saveUT(); app.toast('Already owned — converted to 500 coins.', 'good'); }
    else if (getPlayer(p.id)) { UT.addToClub(s, p.id); app.saveUT(); app.toast(`${p.name} added to your club!`, 'good'); }
    else { importCustomCard(p); app.saveUT(); app.toast(`${p.name} saved to your Admin Cards gallery (custom card).`, 'good'); }
  }
  app.refresh();
}

/** Small bell button for the top of the UT hub, with an unread-count badge. */
export function giftsButton(app) {
  const btn = h('button', { class: 'pm-giftsbtn', 'aria-label': 'Gifts inbox', title: 'Gifts inbox', onclick: () => app.push(giftsView()) }, icon('gifts'));
  const n = readLocal().length;
  if (n) btn.appendChild(h('span', { class: 'pm-badge pm-badge--dot' }, String(n)));
  if (app.online && app.online.gifts && typeof app.online.gifts.inbox === 'function') {
    listGifts(app).then((all) => { if (!app.destroyed && all.length !== n) app.refresh(); }).catch(() => {});
  }
  return btn;
}

export function giftsView() {
  return {
    title: 'Gifts', kicker: 'Inbox', coins: true,
    render(main, app) {
      const list = h('div', { class: 'pm-gifts-list' }, h('p', { class: 'pm-dim' }, 'Loading…'));
      add(main, h('p', { class: 'pm-lead' }, 'Coins, packs and players sent to you by the owner or through promos land here.'), list);
      listGifts(app).then((items) => {
        clear(list);
        if (!items.length) { list.appendChild(h('div', { class: 'pm-empty-state' }, icon('gifts'), h('p', null, 'No gifts right now.'))); return; }
        for (const g of items) {
          list.appendChild(h('div', { class: 'pm-giftrow' },
            h('div', { class: 'pm-gifticon' }, icon(g.kind === 'coins' ? 'coins' : g.kind === 'pack' ? 'chest' : 'grant')),
            h('div', { class: 'pm-gift-info' }, h('b', null, rewardLabel(g)), h('small', { class: 'pm-dim' }, `${g.from || 'Owner'}${g.note ? ` · ${g.note}` : ''} · ${new Date(g.at).toLocaleString()}`)),
            h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', onclick: () => claimGift(app, g) }, 'Claim')));
        }
      }).catch(() => { clear(list); list.appendChild(h('p', { class: 'pm-dim' }, 'Could not load gifts.')); });
    },
  };
}
