// UT feature screens: reward claim flow, Player Picks, Objectives hub, Evolutions, Draft, Tournaments,
// Team of the Week, Season track, club customisation and Tactics.
import { h, clear, frag, modal, confirmBox, fmtNum, add, select } from './dom.js';
import { playerCard } from './card.js';
import { crestSVG, badgeSVG } from './art.js';
import { squadEditor } from './squad.js';
import { resultView } from './app.js';
import { openPackFlow, playerModal } from './utview.js';
import { icon } from './icons.js';
import { tacticsEditor } from './tacticsview.js';
import * as UT from '../core/ut.js';
import * as OBJ from '../core/objectives.js';
import * as EVO from '../core/evolutions.js';
import * as DR from '../core/draft.js';
import * as EV from '../core/events.js';
import * as SS from '../core/seasons.js';
import { totwCards } from '../core/totw.js';
import { weekNumber, msToWeekReset, fmtCountdown } from '../core/calendar.js';
import { getPlayer } from '../core/players.js';
import { FORMATIONS, FORMATION_NAMES } from '../core/formations.js';
import { calcChemistry, teamRating } from '../core/chemistry.js';
import { resolveKitClash, gkKitFor, reseat } from '../core/teams.js';
import { PLAYSTYLES } from '../core/physique.js';

const persist = (app) => app.saveUT();
const DIFF_LABEL = { amateur: 'Amateur', pro: 'Professional', world: 'World Class', legendary: 'Legendary' };
const isTop = (app, view) => app.stack[app.stack.length - 1] === view;

export function rewardText(r) {
  if (!r) return '—';
  const parts = [];
  if (r.coins) parts.push(`${fmtNum(r.coins)} coins`);
  if (r.pack) parts.push(UT.PACK_BY_ID[r.pack] ? UT.PACK_BY_ID[r.pack].name : r.pack);
  for (const pk of r.packs || []) parts.push(UT.PACK_BY_ID[pk] ? UT.PACK_BY_ID[pk].name : pk);
  const pid = r.player || (r.promoPlayer ? UT.promoRewardPid(r.promoPlayer) : null);
  if (pid) { const p = getPlayer(pid); if (p) parts.push(`${p.name} (${p.ovr}${p.special ? ` ${UT.SPECIAL_NAME[p.special]}` : ''})`); }
  if (r.pick) parts.push(r.pick.label || 'Player Pick');
  if (r.item) parts.push(`${r.n || 1}× ${UT.ITEM_NAMES[r.item] || r.item}`);
  return parts.join(' + ') || '—';
}

// ---------- reward claim flow: celebration -> straight into packs / picks ----------
/**
 * grant(): performs the grant on app.ut and returns reward labels (array) or null.
 * Newly added packs/picks are offered immediately.
 */
export function rewardFlow(app, grant, title = 'Rewards claimed!') {
  const s = app.ut;
  const packsBefore = s.packs.length, picksBefore = (s.picks || []).length;
  const labels = grant();
  if (!labels) { app.toast('Nothing to claim.', 'warn'); return false; }
  persist(app);
  app.topRefresh();
  const newPacks = s.packs.slice(packsBefore);
  const newPicks = (s.picks || []).slice(picksBefore);
  const chips = h('div', { class: 'pm-claim-chips' }, labels.map((l, i) => h('div', { class: 'pm-claim-chip', style: { animationDelay: `${i * 120}ms` } }, l)));
  const openPacks = () => {
    const queue = newPacks.slice();
    const next = () => {
      const pk = queue.shift();
      if (!pk) { if (newPicks.length) openPick(app, newPicks[0].id); else app.refresh(); return; }
      const idx = s.packs.indexOf(pk);
      if (idx >= 0) s.packs.splice(idx, 1);
      openPackFlow(app, pk.type, next);
    };
    next();
  };
  modal(app.root, {
    title, className: 'pm-claim',
    body: h('div', { class: 'pm-claim-body' }, h('div', { class: 'pm-claim-burst', 'aria-hidden': 'true' }), chips,
      newPacks.length || newPicks.length ? h('p', { class: 'pm-dim' }, 'Packs and picks are also kept in the Store if you open them later.') : null),
    actions: [
      { label: 'Later', onClick: () => app.refresh() },
      newPacks.length ? { label: `Open ${newPacks.length > 1 ? `${newPacks.length} packs` : 'pack'} now`, primary: true, onClick: () => { setTimeout(openPacks, 0); } }
        : newPicks.length ? { label: 'Choose your pick', primary: true, onClick: () => { setTimeout(() => openPick(app, newPicks[0].id), 0); } }
          : { label: 'Great!', primary: true, onClick: () => app.refresh() },
    ],
  });
  return true;
}

// ---------- player picks ----------
export function openPick(app, pickId) {
  const s = app.ut;
  const pk = (s.picks || []).find((x) => x.id === pickId);
  if (!pk) return;
  let chosen = false;
  const grid = h('div', { class: 'pm-pickrow' });
  let close = null;
  pk.options.forEach((pid, i) => {
    const p = getPlayer(pid);
    if (!p) return;
    const owned = s.club.includes(pid);
    const flip = h('button', { class: 'pm-pickcard', style: { animationDelay: `${i * 220}ms` }, 'aria-label': `Pick ${p.name}` },
      h('div', { class: 'pm-pickcard-in' }, h('div', { class: 'pm-pickback' }, h('span', null, 'P')), h('div', { class: 'pm-pickfront' }, playerCard(p, { size: 'sm' }), owned ? h('small', { class: 'pm-warnline' }, 'Owned → coins') : null)));
    flip.addEventListener('click', () => {
      if (chosen) return;
      chosen = true;
      const r = UT.choosePick(s, pk.id, pid);
      persist(app); app.topRefresh();
      close();
      app.toast(r.dup ? `Duplicate — converted to ${fmtNum(r.coins)} coins.` : `${p.name} joined your club!`, 'good');
      app.refresh();
    });
    grid.appendChild(flip);
  });
  close = modal(app.root, { title: pk.label, wide: true, className: 'pm-pickmodal', body: h('div', null, h('p', { class: 'pm-dim' }, `Choose 1 of ${pk.options.length}. From: ${pk.from || 'reward'}`), grid), actions: [{ label: 'Decide later' }] });
}

export function picksRow(app) {
  const s = app.ut;
  if (!(s.picks || []).length) return null;
  return h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, `Player Picks (${s.picks.length})`),
    h('div', { class: 'pm-packrow' }, s.picks.map((pk) => h('div', { class: 'pm-packitem pm-pickitem' },
      h('div', { class: 'pm-pickicon', 'aria-hidden': 'true' }, '1/3'),
      h('div', null, h('b', null, pk.label), h('small', { class: 'pm-dim' }, pk.from || '')),
      h('button', { class: 'pm-btn pm-btn--primary', onclick: () => openPick(app, pk.id) }, 'Choose')))));
}

// ---------- post-match rewards screen (FIFA-style coin count-up, occasional bonus pack) ----------
function animateCount(el, to, ms = 950) {
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtNum(to * eased);
    el.parentNode && el.parentNode.classList.toggle('is-counting', p < 1);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** Small celebratory modal shown after a UT match vs AI: animated coin count-up, occasional bonus pack. */
export function showMatchRewards(app, { coins = 0, packChance = 0.16 } = {}) {
  if (!coins && Math.random() >= packChance) return;
  const gotPack = Math.random() < packChance;
  const pk = gotPack ? UT.PACKS[Math.floor(Math.random() * UT.PACKS.length)] : null;
  const countEl = h('b', { class: 'pm-rewardcount' }, '0');
  const body = h('div', { class: 'pm-rewardbody' },
    h('div', { class: 'pm-rewardburst', 'aria-hidden': 'true' }),
    h('div', { class: 'pm-rewardcoin' }, icon('coins'), countEl),
    h('p', { class: 'pm-dim' }, 'Coins earned'),
    gotPack ? h('div', { class: 'pm-rewardpack' }, icon('chest'), h('span', null, `Bonus: ${pk.name}!`)) : null);
  const close = modal(app.root, {
    title: 'Match Rewards', className: 'pm-rewardmodal', body,
    actions: [{ label: gotPack ? 'Open bonus pack' : 'Nice!', primary: true, onClick: () => { if (gotPack) setTimeout(() => openPackFlow(app, pk.id), 0); } }],
  });
  setTimeout(() => animateCount(countEl, coins), 160);
  return close;
}

// ---------- shared UT match runner ----------
async function runUtMatch(app, team, opp, { difficulty = 'pro', knockout = false, mode = 'ut' } = {}) {
  const away = structuredClone(opp.team);
  away.kit = resolveKitClash(team.kit, away.kit, opp.awayKit);
  away.gkKit = gkKitFor(team.kit, away.kit, team.gkKit);
  const result = await app.playMatch(team, away, { halfMinutes: app.settings.halfMinutes, difficulty, userSide: 'home', mode, knockout });
  if (!result) return null;
  const after = app.afterMatch({ team, result, side: 'home', mode });
  return { result, away, m: after ? after.m : null };
}

// ---------- objectives hub ----------
export function objectivesHubView(sec = 'daily') {
  const ui = { sec };
  return {
    title: 'Objectives', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const list = OBJ.objectiveList(s);
      const count = (sec) => list.filter((o) => o.section === sec && o.ready).length;
      const tabs = h('div', { class: 'pm-tabs', role: 'tablist' }, OBJ.SECTIONS.map(([id, label]) => h('button', {
        class: `pm-tab ${ui.sec === id ? 'on' : ''}`, role: 'tab', 'aria-selected': ui.sec === id ? 'true' : 'false', onclick: () => { ui.sec = id; app.refresh(); },
      }, label, count(id) ? h('span', { class: 'pm-dotbadge' }, count(id)) : null)));
      const sub = { daily: `Resets in ${fmtCountdown(86400000 - (Date.now() % 86400000))}`, weekly: `Resets in ${fmtCountdown(msToWeekReset())}`, player: 'Challenges with specific players — plus Legend of the Game chains', season: `Season ${SS.seasonNumber()}`, promo: 'Live promo campaigns — rewards include promo players and packs', milestone: 'Lifetime achievements', foundation: 'Learn every part of Ultimate Team' }[ui.sec];
      const items = list.filter((o) => o.section === ui.sec);
      const readyAll = items.filter((o) => o.ready);
      const body = h('div', { class: 'pm-objlist' });
      let lastChain = null;
      for (const o of items) {
        if (o.chain && o.chain !== lastChain) { lastChain = o.chain; body.appendChild(h('h4', { class: 'pm-chainhead' }, `⛓ ${o.chainTitle}`)); }
        body.appendChild(h('div', { class: `pm-obj ${o.claimed ? 'is-claimed' : o.ready ? 'is-ready' : ''} ${o.locked ? 'is-locked' : ''}` },
          o.reward.player ? playerCard(getPlayer(o.reward.player), { size: 'xs', className: 'pm-obj-card' }) : null,
          h('div', { class: 'pm-obj-main' }, h('b', null, o.locked ? `🔒 ${o.label}` : o.label),
            h('div', { class: 'pm-progress' }, h('i', { style: { width: `${(o.prog / o.target) * 100}%` } })),
            h('small', { class: 'pm-dim' }, `${o.prog}/${o.target} · Reward: ${rewardText(o.reward)}`)),
          o.claimed ? h('span', { class: 'pm-chip' }, 'Claimed') : h('button', {
            class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: !o.ready,
            onclick: () => rewardFlow(app, () => OBJ.claimObjectiveById(s, o.id), 'Objective complete!'),
          }, 'Claim')));
      }
      if (!items.length) body.appendChild(h('p', { class: 'pm-empty' }, 'Nothing here right now.'));
      add(main, tabs, h('div', { class: 'pm-objhead' }, h('span', { class: 'pm-dim' }, sub),
        readyAll.length > 1 ? h('button', { class: 'pm-btn pm-btn--accent pm-btn--sm', onclick: () => rewardFlow(app, () => { const out = []; for (const o of readyAll) out.push(...(OBJ.claimObjectiveById(s, o.id) || [])); return out.length ? out : null; }, 'Objectives claimed!') }, `Claim all (${readyAll.length})`) : null), body);
    },
  };
}

// ---------- evolutions ----------
export function evolutionsView() {
  return {
    title: 'Evolutions', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const ev = EVO.ensureEvo(s);
      const active = h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, `Active (${ev.active.length}/${EVO.MAX_ACTIVE})`));
      if (!ev.active.length) active.appendChild(h('p', { class: 'pm-empty' }, 'No active evolutions. Pick one below and choose an eligible player.'));
      ev.active.forEach((a, idx) => {
        const evo = EVO.EVO_BY_ID[a.evoId];
        const p = getPlayer(a.pid);
        if (!p) return;
        const done = EVO.evoComplete(a);
        active.appendChild(h('div', { class: `pm-evo ${done ? 'is-ready' : ''}` }, playerCard(p, { size: 'sm' }),
          h('div', { class: 'pm-evo-main' }, h('div', { class: 'pm-kicker' }, evo.name), h('b', null, p.name),
            evo.objectives.map((o) => h('div', { class: 'pm-evo-obj' }, h('span', null, o.label), h('div', { class: 'pm-progress' }, h('i', { style: { width: `${(EVO.evoProgress(a, o) / o.v) * 100}%` } })), h('small', { class: 'pm-dim' }, `${EVO.evoProgress(a, o)}/${o.v}`))),
            h('small', { class: 'pm-dim' }, `Upgrade: ${evo.upgrade.label}`),
            h('div', { class: 'pm-btnrow' },
              h('button', { class: 'pm-btn pm-btn--primary', disabled: !done, onclick: () => {
                const card = EVO.claimEvolution(s, idx);
                if (!card) return;
                persist(app);
                evoReveal(app, p, card);
              } }, done ? 'Claim upgrade' : 'In progress — play matches with him in your XI'),
              h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: async () => { if (await confirmBox(app.root, 'Cancel evolution', `Stop ${evo.name} for ${p.name}? Progress is lost.`, 'Cancel evolution', true)) { EVO.cancelEvolution(s, idx); persist(app); app.refresh(); } } }, 'Cancel')))));
      });
      const avail = h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, 'Available evolutions'),
        h('div', { class: 'pm-sbcgrid' }, EVO.EVOLUTIONS.map((evo) => {
          const used = !!ev.used[evo.id];
          const elig = UT.clubPlayers(s).filter((p) => EVO.eligibility(p, evo)[0] && !ev.active.some((a) => a.pid === p.id));
          return h('div', { class: `pm-sbc ${used ? 'is-done' : ''}` },
            h('div', { class: 'pm-sbc-top' }, h('h4', null, evo.name), h('span', { class: 'pm-chip on' }, 'Free')),
            h('p', null, evo.desc),
            h('ul', { class: 'pm-reqmini' }, reqLines(evo).map((l) => h('li', null, l))),
            h('div', { class: 'pm-sbc-reward' }, h('span', { class: 'pm-dim' }, 'Upgrade'), h('b', null, evo.upgrade.label)),
            used ? h('div', { class: 'pm-sbc-done' }, '✓ Used') : h('button', {
              class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: !elig.length || ev.active.length >= EVO.MAX_ACTIVE,
              onclick: () => chooseEvoPlayer(app, evo, elig),
            }, elig.length ? `Choose player (${elig.length} eligible)` : 'No eligible players'));
        })));
      const items = s.items || {};
      const posmod = h('section', { class: 'pm-panel pm-posmod' }, h('h3', null, `Position Modifiers: ${items.posmod || 0}`),
        h('p', { class: 'pm-dim' }, 'Add a new alternate position to a player (creates an untradeable upgraded card). Earn them from SBCs and objectives.'),
        h('button', { class: 'pm-btn', disabled: !(items.posmod > 0), onclick: () => posModFlow(app) }, 'Use a Position Modifier'));
      add(main, active, avail, posmod);
    },
  };
}
function reqLines(evo) {
  const r = evo.req, out = [];
  if (r.maxOvr) out.push(`OVR max ${r.maxOvr}`);
  for (const [k, v] of Object.entries(r.max || {})) out.push(`${k.toUpperCase()} max ${v}`);
  if (r.pos) out.push(`Position: ${r.pos.join(', ')}`);
  if (r.notPos) out.push(`Not ${r.notPos.join(', ')}`);
  if (r.noLotg) out.push('No Legends of the Game');
  if (r.noSpecial) out.push('No special cards');
  out.push(...evo.objectives.map((o) => o.label));
  return out;
}
function chooseEvoPlayer(app, evo, elig) {
  let close = null;
  const grid = h('div', { class: 'pm-cardgrid pm-pickgrid' }, elig.sort((a, b) => b.ovr - a.ovr).map((p) => playerCard(p, {
    size: 'sm', onClick: () => {
      const r = EVO.startEvolution(app.ut, evo.id, p.id);
      close();
      if (!r.ok) { app.toast(r.error, 'bad'); return; }
      OBJ.setFlag(app.ut, 'evoStarted');
      persist(app); app.toast(`${p.name} started ${evo.name}. Play matches with him in your XI!`, 'good'); app.refresh();
    },
  })));
  close = modal(app.root, { title: `${evo.name}: choose a player`, wide: true, body: grid, actions: [{ label: 'Cancel' }] });
}
function evoReveal(app, before, after) {
  const diff = (a, b) => (b > a ? h('b', { class: 'pm-up' }, `+${b - a}`) : null);
  const keys = after.pos === 'GK' ? ['div', 'han', 'kic', 'ref', 'spd', 'pos'] : ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
  const src = after.pos === 'GK' ? 'gk' : 'stats';
  modal(app.root, {
    title: 'Evolution complete!', wide: true, className: 'pm-claim',
    body: h('div', { class: 'pm-evoreveal' }, playerCard(before, { size: 'sm', className: 'pm-evo-before' }), h('div', { class: 'pm-evo-arrow', 'aria-hidden': 'true' }, '➜'), playerCard(after, { size: 'md', className: 'pm-reveal' }),
      h('div', { class: 'pm-evo-diff' }, h('div', null, 'OVR ', h('b', null, `${before.ovr} → ${after.ovr}`)), keys.map((k) => h('div', null, `${k.toUpperCase()} ${after[src][k]} `, diff(before[src][k], after[src][k]))),
        after.alt.length > before.alt.length ? h('div', null, `New position: ${after.alt[after.alt.length - 1]}`) : null,
        after.playstyles.filter((x) => !before.playstyles.some((y) => y.id === x.id && y.plus === x.plus)).map((x) => h('div', null, `PlayStyle: ${PLAYSTYLES[x.id][0]}${x.plus ? '+' : ''}`)))),
    actions: [{ label: 'Great!', primary: true, onClick: () => app.refresh() }],
  });
}
function posModFlow(app) {
  const s = app.ut;
  let close = null;
  const body = h('div', null);
  const pickPos = (p) => {
    clear(body);
    const opts = ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'].filter((x) => x !== p.pos && !(p.alt || []).includes(x));
    add(body, h('p', null, `Add a position for ${p.name} (${[p.pos, ...(p.alt || [])].join(', ')}):`), h('div', { class: 'pm-chips' }, opts.map((pos) => h('button', {
      class: 'pm-chip', onclick: () => {
        const r = EVO.applyPositionModifier(s, p.id, pos);
        close();
        if (!r.ok) { app.toast(r.error, 'bad'); return; }
        persist(app); app.toast(`${p.name} can now play ${pos}.`, 'good'); app.refresh();
      },
    }, pos))));
  };
  const cands = UT.clubPlayers(s).filter((p) => p.pos !== 'GK' && (p.alt || []).length < 3).sort((a, b) => b.ovr - a.ovr);
  add(body, h('div', { class: 'pm-cardgrid pm-pickgrid' }, cands.map((p) => playerCard(p, { size: 'sm', onClick: () => pickPos(p) }))));
  close = modal(app.root, { title: 'Position Modifier', wide: true, body, actions: [{ label: 'Cancel' }] });
}

// ---------- draft ----------
export function draftView() {
  return {
    title: 'Draft', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const d = s.draft;
      if (!d) {
        add(main, h('section', { class: 'pm-panel pm-draftintro' },
          h('h2', null, 'Pitchside Draft'),
          h('p', null, 'Pick a formation, choose a captain from 5, then 1 of 5 players for every position — real Legends of the Game included. Win a 4-round knockout for big rewards.'),
          h('div', { class: 'pm-draftrewards' }, DR.DRAFT_REWARDS.map((r, i) => h('div', null, h('b', null, `${i} win${i === 1 ? '' : 's'}`), h('small', null, rewardText(r))))),
          h('div', { class: 'pm-btnrow' },
            h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', disabled: s.coins < DR.DRAFT_ENTRY, onclick: async () => {
              if (!(await confirmBox(app.root, 'Enter Draft', `Entry costs ${fmtNum(DR.DRAFT_ENTRY)} coins (${app.coinSourceLabel()}).`, 'Enter'))) return;
              if (s.coins < DR.DRAFT_ENTRY) return;
              s.coins -= DR.DRAFT_ENTRY;
              s.draft = DR.newDraft(`${Date.now()}`);
              persist(app); app.refresh();
            } }, `Enter · ${fmtNum(DR.DRAFT_ENTRY)} coins`))));
        return;
      }
      if (d.stage === 'formation') {
        add(main, h('h3', { class: 'pm-h' }, '1 · Choose a formation'), h('div', { class: 'pm-formgrid' }, DR.FORMATION_NAMES.map((f) => h('button', { class: 'pm-formpick', onclick: () => { DR.chooseFormation(d, f); persist(app); app.refresh(); } }, miniFormation(f), h('b', null, f)))));
        return;
      }
      if (d.stage === 'captain') {
        add(main, h('h3', { class: 'pm-h' }, '2 · Choose your captain'), h('div', { class: 'pm-draftopts' }, d.captainOptions.map((pid) => playerCard(getPlayer(pid), { size: 'md', onClick: () => { DR.chooseCaptain(d, pid); persist(app); app.refresh(); } }))));
        return;
      }
      const info = DR.draftInfo(d);
      const f = FORMATIONS[d.formation];
      const pitch = h('div', { class: 'pm-pitch pm-draftpitch' }, h('div', { class: 'pm-pitch-lines' }));
      const open = DR.nextOpenSlot(d);
      f.slots.forEach((sl, i) => {
        const p = info.slots[i];
        pitch.appendChild(h('div', { class: 'pm-slotpos', style: { left: `${5 + sl.x * 0.9}%`, top: `${2 + (96 - sl.y) * 1.03}%` } },
          h('div', { class: `pm-slot ${i === open ? 'is-sel' : ''}` }, p ? playerCard(p, { size: 'xs', pos: sl.pos }) : h('div', { class: 'pm-card pm-card--xs pm-card--empty' }, h('div', { class: 'pc-in' }, h('div', { class: 'pc-emptypos' }, sl.pos)))),
          p ? h('div', { class: `pm-chempip c${info.chem.players[i] || 0}` }, String(info.chem.players[i] || 0)) : null));
      });
      const head = h('div', { class: 'pm-sq-info' }, h('div', { class: 'pm-stat-chip' }, h('span', null, 'Rating'), h('b', null, info.rating || '–')), h('div', { class: 'pm-stat-chip' }, h('span', null, 'Chemistry'), h('b', null, info.chem.scaled)), h('div', { class: 'pm-stat-chip' }, h('span', null, d.formation)));
      const side = h('div', { class: 'pm-draftside' });
      if (d.stage === 'slots' && open >= 0) {
        const pos = f.slots[open].pos;
        side.appendChild(h('h3', { class: 'pm-h' }, `3 · Pick your ${pos}`));
        const opts = DR.slotOptions(d, open);
        side.appendChild(h('div', { class: 'pm-draftopts' }, opts.map((pid) => {
          const p = getPlayer(pid);
          const trial = d.slots.slice(); trial[open] = pid;
          const ch = calcChemistry(d.formation, trial.map((id) => (id ? getPlayer(id) : null)));
          return h('div', { class: 'pm-draftopt' }, playerCard(p, { size: 'sm', pos, onClick: () => { DR.pickSlot(d, open, pid); persist(app); app.refresh(); } }),
            h('small', { class: 'pm-dim' }, `Chem → ${ch.scaled} (${ch.players[open]}/3)`));
        })));
      } else if (!d.done) {
        const opp = DR.draftOpponent(d);
        side.appendChild(h('section', { class: 'pm-panel' }, h('div', { class: 'pm-kicker' }, `${DR.DRAFT_ROUNDS[d.round]} · ${DIFF_LABEL[DR.roundDifficulty(d)]}`),
          h('h3', null, `vs ${opp.name}`), h('p', { class: 'pm-dim' }, `Rating ${opp.rating} · ${opp.team.formation}`),
          h('div', { class: 'pm-draftpath' }, DR.DRAFT_ROUNDS.map((r, i) => h('span', { class: `pm-chip ${i < d.round ? 'on' : ''}` }, i < d.round ? `✓ ${r}` : r))),
          h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', onclick: async () => {
            const team = DR.draftTeam(d, UT.utKit(s));
            const out = await runUtMatch(app, team, opp, { difficulty: DR.roundDifficulty(d), knockout: true, mode: 'draft' });
            if (!out) return;
            OBJ.setFlag(s, 'draftPlayed');
            DR.applyDraftResult(d, out.m.outcome, { gf: out.m.gf, ga: out.m.ga, opp: opp.name });
            persist(app);
            app.push(resultView({ title: 'Draft', kicker: DR.DRAFT_ROUNDS[d.results[d.results.length - 1].round], home: team, away: out.away, result: out.result, userSide: 'home', onContinue: (a) => a.pop() }));
          } }, 'Kick off')));
      }
      if (d.done) {
        const r = DR.draftReward(d);
        side.appendChild(h('section', { class: 'pm-panel pm-draftdone' }, h('h2', null, d.wins >= 4 ? '🏆 Draft Champions!' : `Draft over — ${d.wins} win${d.wins === 1 ? '' : 's'}`),
          h('p', null, `Rewards: ${rewardText(r)}`),
          h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', onclick: () => {
            rewardFlow(app, () => { const out = UT.grantReward(s, r, 'Draft'); s.draft = null; return out; }, 'Draft rewards');
          } }, 'Claim rewards')));
      }
      add(main, h('div', { class: 'pm-draftgrid' }, h('div', null, head, pitch), side),
        !d.done ? h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: async () => { if (await confirmBox(app.root, 'Forfeit draft', 'Forfeit now and claim the rewards for your current wins?', 'Forfeit', true)) { d.done = true; d.stage = 'done'; persist(app); app.refresh(); } } }, 'Forfeit') : null);
    },
  };
}
function miniFormation(f) {
  const svg = FORMATIONS[f].slots.map((s) => `<circle cx="${s.x}" cy="${100 - s.y}" r="5" fill="currentColor"/>`).join('');
  return frag(`<svg class="pm-miniform" viewBox="0 0 100 100" aria-hidden="true"><rect x="1" y="1" width="98" height="98" rx="6" fill="none" stroke="currentColor" stroke-opacity=".3"/>${svg}</svg>`);
}

// ---------- tournaments ----------
export function eventsView() {
  return {
    title: 'Tournaments', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      EV.ensureEvents(s);
      const info = UT.squadInfo(s);
      add(main, h('p', { class: 'pm-lead' }, `This week's knockout events. 4 rounds vs AI with squad rules. New events in ${fmtCountdown(msToWeekReset())}.`),
        h('div', { class: 'pm-eventgrid' }, EV.activeEvents().map((tpl) => {
          const run = EV.eventRun(s, tpl.id);
          const checks = EV.checkRules(tpl.rules, info.slots, info.rating);
          const ok = checks.every((c) => c.ok);
          const r = EV.eventReward(run);
          return h('section', { class: `pm-panel pm-event ${run.done ? 'is-done' : ''}` },
            h('div', { class: 'pm-kicker' }, run.done ? (run.wins >= 4 ? 'Champions' : 'Eliminated') : EV.EVENT_ROUNDS[run.round]),
            h('h3', null, tpl.name), h('p', { class: 'pm-dim' }, tpl.desc),
            h('ul', { class: 'pm-checklist' }, checks.map((c) => h('li', { class: c.ok ? 'ok' : 'no' }, h('i', null, c.ok ? '✓' : '✕'), h('span', null, c.label), h('b', null, String(c.cur))))),
            h('div', { class: 'pm-draftpath' }, EV.EVENT_ROUNDS.map((rn, i) => h('span', { class: `pm-chip ${i < run.wins ? 'on' : ''}` }, rn))),
            h('small', { class: 'pm-dim' }, `Champion reward: ${rewardText(EV.EVENT_REWARDS[4])}`),
            run.done ? h('div', { class: 'pm-btnrow' },
              r && !run.claimed ? h('button', { class: 'pm-btn pm-btn--accent', onclick: () => rewardFlow(app, () => { run.claimed = true; return UT.grantReward(s, r, tpl.name); }, `${tpl.name} rewards`) }, `Claim: ${rewardText(r)}`) : null,
              h('button', { class: 'pm-btn', disabled: !!(r && !run.claimed), onclick: () => { EV.resetRun(run); persist(app); app.refresh(); } }, 'Play again'))
              : h('button', { class: 'pm-btn pm-btn--primary', disabled: !ok || !info.complete, title: ok ? '' : 'Your XI does not meet the rules — edit your Squad', onclick: () => playEvent(app, tpl, run) }, ok ? `Play ${EV.EVENT_ROUNDS[run.round]}` : 'Squad does not meet rules'));
        })));
    },
  };
}
async function playEvent(app, tpl, run) {
  const s = app.ut;
  const team = UT.utTeam(s);
  if (!team) return;
  const opp = EV.eventOpponent(s, tpl, run);
  if (!(await confirmBox(app.root, `${tpl.name} · ${EV.EVENT_ROUNDS[run.round]}`, `vs ${opp.name} (rating ${opp.rating}). Knockout: extra time and penalties if level.`, 'Kick off'))) return;
  const out = await runUtMatch(app, team, opp, { difficulty: tpl.opp.diffs[run.round], knockout: true, mode: 'tournament' });
  if (!out) return;
  EV.applyEventResult(run, out.m.outcome, { gf: out.m.gf, ga: out.m.ga, opp: opp.name });
  s.stats.matches++; s.stats.goals += out.m.gf;
  if (out.m.outcome === 'W') s.stats.wins++; else if (out.m.outcome === 'D') s.stats.draws++; else s.stats.losses++;
  persist(app);
  app.push(resultView({ title: tpl.name, kicker: EV.EVENT_ROUNDS[run.results[run.results.length - 1].round], home: team, away: out.away, result: out.result, userSide: 'home', onContinue: (a) => a.pop() }));
}

// ---------- team of the week ----------
export function totwView() {
  return {
    title: 'Team of the Week', kicker: `Week ${weekNumber()}`, coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const cards = totwCards(weekNumber());
      const heads = cards.filter((p) => p.headliner);
      const rest = cards.filter((p) => !p.headliner);
      const pack = UT.PACK_BY_ID.totw;
      add(main, h('p', { class: 'pm-lead' }, `This week's standout performers — In-Form cards boosted +3 to +8, led by ${heads.length} headliners rated 88+. A new Team of the Week arrives in ${fmtCountdown(msToWeekReset())}.`),
        h('div', { class: 'pm-btnrow' }, h('button', { class: 'pm-btn pm-btn--primary', disabled: app.ut.coins < pack.price, onclick: async () => {
          if (!(await confirmBox(app.root, 'TOTW Pack', `Buy ${pack.name} for ${fmtNum(pack.price)} coins? Guaranteed Team of the Week card.`, 'Buy & open'))) return;
          if (app.ut.coins < pack.price) return;
          app.ut.coins -= pack.price; persist(app); openPackFlow(app, 'totw');
        } }, `Buy TOTW Pack · ${fmtNum(pack.price)}`)),
        h('h3', { class: 'pm-h' }, 'Headliners'),
        h('div', { class: 'pm-cardgrid pm-totw-heads' }, heads.map((p) => playerCard(p, { size: 'md', onClick: () => playerModal(app, p) }))),
        h('h3', { class: 'pm-h' }, 'Team of the Week'),
        h('div', { class: 'pm-cardgrid' }, rest.map((p) => playerCard(p, { size: 'sm', onClick: () => playerModal(app, p) }))));
    },
  };
}

// ---------- season track ----------
export function seasonPassView() {
  return {
    title: 'Season Progress', kicker: `Season ${SS.seasonNumber()}`, coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const ss = SS.loadSeason();
      const lvl = SS.levelOf(ss.xp);
      const inLvl = ss.xp - lvl * SS.XP_PER_LEVEL;
      const claimable = SS.claimableLevels(ss);
      const track = h('div', { class: 'pm-track' });
      for (let l = 1; l <= SS.SEASON_LEVELS; l++) {
        const r = SS.levelReward(l);
        const got = ss.claimed.includes(l), reached = l <= lvl;
        track.appendChild(h('div', { class: `pm-tlevel ${reached ? 'reached' : ''} ${got ? 'claimed' : ''} ${l % 10 === 0 ? 'big' : ''}` },
          h('b', null, l), h('small', null, rewardText(r)),
          reached && !got ? h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: !s, onclick: () => claimLevels(app, [l]) }, 'Claim') : got ? h('span', { class: 'pm-dim' }, '✓') : null));
      }
      add(main, h('section', { class: 'pm-rankcard pm-seasoncard' },
        h('div', { class: 'pm-rankbadge r3' }, String(lvl), h('small', null, 'LVL')),
        h('div', { class: 'pm-rankinfo' }, h('div', { class: 'pm-kicker' }, `Ends in ${fmtCountdown(SS.seasonEnds(SS.seasonNumber()) - Date.now())}`), h('h2', null, `Level ${lvl} / ${SS.SEASON_LEVELS}`),
          h('div', { class: 'pm-progress' }, h('i', { style: { width: `${lvl >= SS.SEASON_LEVELS ? 100 : (inLvl / SS.XP_PER_LEVEL) * 100}%` } })),
          h('small', { class: 'pm-dim' }, lvl >= SS.SEASON_LEVELS ? 'Max level!' : `${inLvl}/${SS.XP_PER_LEVEL} XP · every match in any mode (UT, Rivals, Draft, Tournaments, Career) earns XP`)),
        h('div', { class: 'pm-rankside' }, claimable.length ? h('button', { class: 'pm-btn pm-btn--accent', disabled: !s, onclick: () => claimLevels(app, claimable) }, `Claim ${claimable.length} reward${claimable.length > 1 ? 's' : ''}`) : null)),
      !s ? h('p', { class: 'pm-warnline' }, 'Create an Ultimate Team club to claim season rewards.') : null, track);
    },
  };
}
function claimLevels(app, levels) {
  rewardFlow(app, () => {
    const ss = SS.loadSeason();
    const out = [];
    for (const l of levels) { if (ss.claimed.includes(l) || l > SS.levelOf(ss.xp)) continue; SS.markClaimed(ss, l); out.push(...UT.grantReward(app.ut, SS.levelReward(l), `Season level ${l}`)); }
    SS.saveSeason(ss);
    return out.length ? out : null;
  }, 'Season rewards');
}

// ---------- club customisation ----------
export function clubEditView() {
  return {
    title: 'Customise Club', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const home0 = UT.utKit(s), away0 = UT.utAwayKit(s);
      const st = {
        name: s.clubName, short: s.short,
        badge: { shape: 'shield', c1: s.kit.primary, c2: s.kit.secondary, c3: '#FFFFFF', text: s.short, stripe: false, ...(s.badge || {}) },
        home: { ...home0 }, away: { ...away0 },
      };
      const prev = h('div', { class: 'pm-ce-preview' });
      const draw = () => {
        clear(prev);
        add(prev, frag(badgeSVG(st.badge, 'pm-crest pm-crest--xl', st.name)),
          kitSVG(st.home, 'Home'), kitSVG(st.away, 'Away'));
      };
      const color = (obj, key, label) => { const i = h('input', { type: 'color', value: obj[key], 'aria-label': label }); i.addEventListener('input', () => { obj[key] = i.value.toUpperCase(); draw(); }); return h('label', { class: 'pm-ce-color' }, i, h('span', null, label)); };
      const name = h('input', { class: 'pm-input', value: st.name, maxlength: '24', 'aria-label': 'Club name' });
      name.addEventListener('input', () => { st.name = name.value; draw(); });
      const short = h('input', { class: 'pm-input pm-input--short', value: st.short, maxlength: '3', 'aria-label': 'Short name' });
      short.addEventListener('input', () => { st.short = short.value; });
      const btext = h('input', { class: 'pm-input pm-input--short', value: st.badge.text, maxlength: '3', 'aria-label': 'Badge initials' });
      btext.addEventListener('input', () => { st.badge.text = btext.value.toUpperCase(); draw(); });
      draw();
      add(main, h('div', { class: 'pm-ce' }, prev,
        h('div', { class: 'pm-form' },
          h('label', null, h('span', null, 'Club name'), name), h('label', null, h('span', null, 'Short name'), short),
          h('div', { class: 'pm-lbl' }, 'Badge'),
          h('div', { class: 'pm-chips' }, UT.BADGE_SHAPES.map((sh) => h('button', { class: `pm-chip ${st.badge.shape === sh ? 'on' : ''}`, onclick: (e) => { st.badge.shape = sh; e.currentTarget.parentNode.querySelectorAll('.pm-chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); draw(); } }, sh))),
          h('div', { class: 'pm-ce-row' }, color(st.badge, 'c1', 'Main'), color(st.badge, 'c2', 'Accent'), color(st.badge, 'c3', 'Trim'), h('label', null, h('span', null, 'Initials'), btext),
            h('label', { class: 'pm-toggle' }, h('input', { type: 'checkbox', checked: st.badge.stripe, onchange: (e) => { st.badge.stripe = e.target.checked; draw(); } }), h('span', null, 'Band'))),
          h('div', { class: 'pm-lbl' }, 'Home kit'),
          h('div', { class: 'pm-ce-row' }, color(st.home, 'primary', 'Shirt'), color(st.home, 'secondary', 'Trim'), color(st.home, 'number', 'Numbers'), color(st.home, 'shorts', 'Shorts'), color(st.home, 'socks', 'Socks')),
          h('div', { class: 'pm-lbl' }, 'Away kit'),
          h('div', { class: 'pm-ce-row' }, color(st.away, 'primary', 'Shirt'), color(st.away, 'secondary', 'Trim'), color(st.away, 'number', 'Numbers'), color(st.away, 'shorts', 'Shorts'), color(st.away, 'socks', 'Socks')),
          h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', onclick: () => {
            UT.customiseClub(s, { clubName: st.name, short: st.short, badge: st.badge, kits: { home: st.home, away: st.away } });
            OBJ.setFlag(s, 'clubEdited');
            persist(app); app.toast('Club identity saved. Your kits are used in every match.', 'good'); app.pop();
          } }, 'Save club'))));
    },
  };
}
export function kitSVG(k, label) {
  return frag(`<figure class="pm-kit"><svg viewBox="0 0 60 70" role="img" aria-label="${label} kit">
    <path d="M18 4l-14 8 5 12 7-3v25h28V21l7 3 5-12-14-8c-2 4-6 6-12 6s-10-2-12-6z" fill="${k.primary}" stroke="rgba(0,0,0,.35)"/>
    <path d="M18 4c2 4 6 6 12 6s10-2 12-6" fill="none" stroke="${k.secondary}" stroke-width="3"/>
    <path d="M4 12l5 12M56 12l-5 12" stroke="${k.secondary}" stroke-width="3"/>
    <text x="30" y="36" text-anchor="middle" font-size="13" font-weight="900" fill="${k.number}" font-family="Arial Black,Arial">10</text>
    <path d="M16 47h28l2 12H33l-3-5-3 5H14z" fill="${k.shorts}" stroke="rgba(0,0,0,.35)"/>
    <rect x="17" y="61" width="9" height="8" rx="2" fill="${k.socks}"/><rect x="34" y="61" width="9" height="8" rx="2" fill="${k.socks}"/>
  </svg><figcaption>${label}</figcaption></figure>`);
}

// ---------- tactics (UT) ----------
export function utTacticsView() {
  return {
    title: 'Tactics', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const ed = tacticsEditor({
        holder: s, root: app.root,
        xi: () => { const f = FORMATIONS[s.squad.formation]; return UT.squadSlots(s).map((p, i) => (p ? { id: p.id, name: p.name, pos: f.slots[i].pos, ovr: p.ovr } : null)); },
        formation: () => s.squad.formation,
        setFormation: (fm) => { const seats = reseat(UT.squadSlots(s), fm); s.squad.formation = fm; s.squad.slots = seats.map((p) => (p ? p.id : null)); persist(app); },
        onSave: () => { OBJ.setFlag(s, 'tactics'); persist(app); },
      });
      add(main, h('p', { class: 'pm-dim' }, 'The tactic marked “Used in matches” is sent with your team in every UT mode (Squad Battles, Rivals, Tournaments).'), ed.el);
    },
  };
}

