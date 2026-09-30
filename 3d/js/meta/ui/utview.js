// Pitchside Ultimate Team screens.
import { h, clear, frag, modal, confirmBox, fmtNum, select, add, lazyFill, debounce, infNodes } from './dom.js';
import { playerCard, attributeBlock } from './card.js';
import { leagueBadgeSVG } from './leaguebadge.js';
import { profileFacts } from '../core/bios.js';
import { flagSVG, crestSVG } from './art.js';
import { squadEditor } from './squad.js';
import { runPackOpening, packArt } from './packopen.js';
import { resultView } from './app.js';
import * as UT from '../core/ut.js';
import { getPlayer, quickSellValue, utPrice } from '../core/players.js';
import { NATIONS, NATION_BY_CODE, LEAGUES, leagueName, clubById, POS_GROUP, POSITIONS } from '../core/data.js';
import { resolveKitClash, gkKitFor } from '../core/teams.js';
import { Rng } from '../core/rng.js';
import { marketView, playerMarketListModal } from './marketview.js';
import { rivalsTile } from './rivalsview.js';
import * as M from './modesview.js';
import * as OBJ from '../core/objectives.js';
import * as SS from '../core/seasons.js';
import { ensureEvo } from '../core/evolutions.js';
import { playstyleList } from './card.js';
import { adminCodesPanel, adminBadge } from './adminview.js';
import { tileIcon, icon } from './icons.js';
import { giftsButton } from './giftsview.js';
import { accentPicker, uiStylePicker } from '../../uiprefs.js';
import { friendsButton } from './friendsview.js';
import { swapsView } from './swapsview.js';
import { getConfig, effPrice } from './config.js';
import { promoHubView, promoTileSub } from './promoview.js';
import { PROMO_BY_ID } from '../core/promos.js';
import * as PM from '../core/pmarket.js';
import * as SQ from '../core/squads.js';
import { mountStadium } from '../../ui/stadium.js';
import { cursedPack, isOwner, enforceLock } from '../core/vinson.js';
import { HELL_CARD_ID } from '../core/secretcard.js';
import { byDisplayRank, secretFirst } from '../core/rank.js';
import { managerCard } from './managercard.js';

const persist = (app) => app.saveUT();
const userClubObj = (s) => ({ id: 'UT-' + s.short, name: s.clubName, short: s.short, colors: { primary: s.kit.primary, secondary: s.kit.secondary }, badge: s.badge || null });
const DIFF_LABEL = { amateur: 'Amateur', pro: 'Professional', world: 'World Class', legendary: 'Legendary' };

export function ensureUTView(app) {
  if (!app.ut) app.ut = UT.loadUT();
  if (app.ut) app.initWallet();
  return app.ut ? utHomeView() : onboardView();
}

// ---------- onboarding ----------
const SWATCHES = [['#19F5A4', '#0B0F1A'], ['#E63946', '#FFFFFF'], ['#1D4ED8', '#F5D130'], ['#111111', '#F4B400'], ['#7B2CBF', '#27E1C1'], ['#FFFFFF', '#0A2463'], ['#FF7A00', '#111827'], ['#0F7B3F', '#FFFFFF']];

function onboardView() {
  return {
    title: 'Create your club', kicker: 'Pitchside Ultimate Team',
    render(main, app) {
      const st = { name: 'Pitchside FC', short: 'PFC', c1: SWATCHES[0][0], c2: SWATCHES[0][1] };
      const preview = h('div', { class: 'pm-ob-crest' });
      const drawPreview = () => { clear(preview); preview.appendChild(frag(crestSVG({ id: 'UT-' + st.short, name: st.name, short: st.short, colors: { primary: st.c1, secondary: st.c2 } }, 'pm-crest pm-crest--xl'))); };
      const name = h('input', { class: 'pm-input', value: st.name, maxlength: '24', 'aria-label': 'Club name', 'data-autofocus': '1' });
      const short = h('input', { class: 'pm-input pm-input--short', value: st.short, maxlength: '3', 'aria-label': 'Short name (3 letters)' });
      name.addEventListener('input', () => {
        st.name = name.value.trim() || 'Pitchside FC';
        const ini = st.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '');
        if (!short.dataset.touched) { st.short = (ini + 'FC').slice(0, 3); short.value = st.short; }
        drawPreview();
      });
      short.addEventListener('input', () => { short.dataset.touched = '1'; st.short = (short.value.toUpperCase().replace(/[^A-Z]/g, '') + 'XXX').slice(0, 3); drawPreview(); });
      const c1 = h('input', { type: 'color', value: st.c1, 'aria-label': 'Primary colour' });
      const c2 = h('input', { type: 'color', value: st.c2, 'aria-label': 'Secondary colour' });
      c1.addEventListener('input', () => { st.c1 = c1.value.toUpperCase(); drawPreview(); });
      c2.addEventListener('input', () => { st.c2 = c2.value.toUpperCase(); drawPreview(); });
      drawPreview();
      add(main, h('section', { class: 'pm-panel pm-ob' },
        preview,
        h('div', { class: 'pm-form' },
          h('label', null, h('span', null, 'Club name'), name),
          h('label', null, h('span', null, 'Short name'), short),
          h('div', { class: 'pm-lbl' }, 'Kit colours'),
          h('div', { class: 'pm-swatches' }, SWATCHES.map(([a, b]) => h('button', {
            class: 'pm-swatch', 'aria-label': `Colours ${a} and ${b}`, style: { background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` },
            onclick: () => { st.c1 = a; st.c2 = b; c1.value = a; c2.value = b; drawPreview(); },
          })), h('label', { class: 'pm-colorpick' }, c1, c2)),
          h('p', { class: 'pm-dim' }, 'You start with 10,000 coins, a starter squad and two welcome packs. All coins are earned by playing, no real money, ever.'),
          h('button', {
            class: 'pm-btn pm-btn--primary pm-btn--lg', onclick: () => {
              app.ut = UT.createUTState({ clubName: st.name, short: st.short, primary: st.c1, secondary: st.c2 });
              app.wallet = { mode: 'local', checked: false, pending: Promise.resolve(), inflight: 0 };
              persist(app);
              app.initWallet();
              app.replace(utHomeView());
              app.toast('Club created! Head to the Store to open your welcome packs.', 'good');
            },
          }, 'Create club'))));
    },
  };
}

// ---------- FC-style section tabs (first row of every UT section) ----------
const UT_TABS = [['home', 'Home'], ['squad', 'Squad'], ['sbc', 'SBC'], ['objectives', 'Objectives'], ['transfers', 'Transfers'], ['store', 'Store'], ['swaps', 'Swaps'], ['club', 'Club']];
export function utTabs(app, active) {
  try { mountStadium(app.root.querySelector('.pm-bgfx')); } catch { /* backdrop is decoration only */ }
  const s = app.ut;
  const badge = s ? { objectives: OBJ.claimableCount(s), store: s.packs.length + (s.picks || []).length } : {};
  const open = { squad: squadView, sbc: sbcListView, objectives: () => M.objectivesHubView(), transfers: marketView, store: storeView, swaps: swapsView, club: clubView };
  return h('nav', { class: 'pm-uttabs', 'aria-label': 'Ultimate Team sections' }, UT_TABS.map(([id, label]) => h('button', {
    class: `pm-uttab ${id === active ? 'on' : ''}`, 'aria-current': id === active ? 'page' : null, 'data-uttab': id,
    onclick: () => {
      if (id === active) return;
      if ((id === 'sbc' || id === 'transfers') && s?.vinson?.phase === 'locked' && !isOwner(app.online)) {
        app.toast('The Vinson curse blocks this section.', 'bad'); return;
      }
      app.popTo((v) => v.utHome);
      if (id !== 'home') app.push(open[id]());
    },
  }, label, badge[id] ? h('span', { class: 'pm-dotbadge' }, badge[id]) : null)));
}

/** Swap-token balance chip, shown next to the coin chip on every UT section (view `topRight` hook). */
export function tokenChip(app) {
  const s = app.ut;
  if (!s) return null;
  return h('div', { class: 'pm-coins is-tokens', title: 'Swap tokens: spend them in the Token Store (Swaps)' },
    h('span', { class: 'pm-coins-ico', 'aria-hidden': 'true' }, h('i', { class: 'pm-token' })), h('span', { class: 'pm-coins-n' }, fmtNum(s.tokens || 0)), h('span', { class: 'pm-sr' }, ' swap tokens'));
}

/** Alternate positions line shown under cards in grids (owner: no PlayStyle chips here — every PlayStyle, with
 * its icon and description, lives in the card details view). */
export function cardMeta(p, extra = null) {
  return h('div', { class: 'pm-cardmeta' },
    h('span', { class: 'pm-cardmeta-pos', title: 'Positions' }, h('b', null, p.pos), (p.alt || []).length ? ` ${p.alt.join(' ')}` : ''),
    extra);
}

/** Display settings without leaving Ultimate Team (owner, Sep 29): interface style + UI colour (js/uiprefs.js). */
function displayButton(app) {
  return h('button', { class: 'pm-giftsbtn', 'aria-label': 'Display settings', title: 'Display settings: interface style and colour',
    onclick: () => modal(app.root, { title: 'Display', className: 'pm-displaymodal',
      body: h('div', { class: 'pm-display' }, uiStylePicker(), accentPicker(), h('p', { class: 'pm-dim' }, 'Saved on this device. Match settings are in the main menu Settings.')),
      actions: [{ label: 'Done', primary: true }] }) }, icon('gear'));
}

// ---------- home ----------
export function utHomeView() {
  return {
    title: 'Ultimate Team', kicker: 'Pitchside', coins: true, utHome: true, topRight: tokenChip, cls: 'pm-main--wide', liveConfig: true,
    render(main, app) {
      const s = app.ut;
      if (!s) { app.replace(onboardView()); return; }
      const info = UT.squadInfo(s);
      const rank = UT.rankFor(s.battles.points);
      const claimable = OBJ.claimableCount(s);
      const ss = SS.loadSeason();
      const seasonReady = SS.claimableLevels(ss).length;
      const evo = ensureEvo(s);
      const evoReady = evo.active.length;
      // one tile shape: art (the player's own content) + title + one line
      const hx = (cls, title, sub, onclick, art, badge = null, extra = null) => h('button', { class: `pm-tile pm-hx ${cls}`, onclick },
        art ? h('div', { class: 'pm-hx-art', 'aria-hidden': 'true' }, art) : null,
        badge ? h('span', { class: 'pm-badge' }, badge) : null,
        h('div', { class: 'pm-tile-body' }, h('h2', null, title), sub ? h('p', null, sub) : null, extra));
      const mini = (title, sub, onclick, iconName, badge = null) => h('button', { class: 'pm-tile pm-hx pm-hx--mini', onclick },
        tileIcon(iconName), badge ? h('span', { class: 'pm-badge' }, badge) : null,
        h('div', { class: 'pm-tile-body' }, h('h2', null, title), sub ? h('p', null, sub) : null));

      // squad: the XI's three best cards
      const xi = info.slots.filter(Boolean).sort((a, b) => b.ovr - a.ovr);
      const fan = [xi[1], xi[0], xi[2]].filter(Boolean).map((p) => playerCard(p, { size: 'sm' }));
      const squadTile = hx('pm-hx--squad', 'Squad', `${s.squad.formation} · ${xi.length}/11 in the XI`, () => app.push(squadView()),
        [h('div', { class: 'pm-art-squad', style: { position: 'absolute', inset: '0' } }), h('div', { class: 'pm-fan' }, fan)],
        info.complete ? null : '!',
        h('div', { class: 'pm-hx-meta' }, h('span', null, 'Rating', h('b', null, info.rating || '–')), h('span', null, 'Chemistry', h('b', null, info.chem.scaled)), h('span', null, 'Club', h('b', null, s.club.length))));

      // store: packs waiting to be opened, else the featured pack
      const waiting = s.packs.slice(0, 2).map((pk) => UT.PACK_BY_ID[pk.type]).filter(Boolean);
      const onSale = UT.storePacks();
      const featured = onSale.find((p) => p.promo) || onSale[onSale.length - 1];
      // owner request (Sep 29): a fan of packs like the Squad tile's cards, cycling through everything on sale
      // (your unopened packs when you have some)
      const nPacks = s.packs.length + (s.picks || []).length;
      const fanPacks = waiting.length ? s.packs.map((pk) => UT.PACK_BY_ID[pk.type]).filter(Boolean) : [...onSale.filter((p) => p.promo), ...onSale.filter((p) => !p.promo)];
      let storeTile = null; // assigned below; the fan's first callback runs before the tile exists
      const storeArt = h('div', { class: 'pm-art-store', style: { position: 'absolute', inset: '0' } }, fanPacks.length ? packFan(app, fanPacks, (p) => {
        if (!nPacks && storeTile) { const sub = storeTile.querySelector('.pm-tile-body p'); if (sub) sub.textContent = `${p.name} · ${fmtNum(effPrice(p.price))} coins`; }
      }) : null);
      storeTile = hx('pm-hx--store', 'Store', nPacks ? `${nPacks} pack${nPacks > 1 ? 's' : ''} to open` : featured ? `${featured.name} · ${fmtNum(effPrice(featured.price))} coins` : 'Packs & Player Picks', () => app.push(storeView()), storeArt, nPacks ? String(nPacks) : null);

      // sbc: the next challenge you haven't done, with its reward
      const sbcs = UT.SBCS.filter((x) => UT.sbcAvailable(s, x));
      const nextSbc = sbcs.find((x) => !s.sbc[x.id]) || sbcs[0];
      let sbcArt = null;
      if (nextSbc) {
        const r = nextSbc.reward || {};
        const rp = r.player ? getPlayer(r.player) : r.promoPlayer ? getPlayer(UT.promoRewardPid(r.promoPlayer)) : null;
        const rpack = UT.PACK_BY_ID[r.pack || (r.packs || [])[0]];
        sbcArt = h('div', { class: 'pm-art-sbc', style: { position: 'absolute', inset: '0' } },
          h('div', { class: 'pm-sbc-req' }, h('b', null, nextSbc.name), nextSbc.reqs.filter((q) => q.t !== 'count').slice(0, 3).map((q) => h('span', null, UT.reqLabel(q)))),
          rp ? playerCard(rp, { size: 'sm' }) : rpack ? packArt(rpack, 'md') : null);
      }
      const sbcTile = hx('pm-hx--sbc', 'Squad Building', nextSbc ? `Reward: ${rewardText(nextSbc.reward)}` : 'All challenges complete', () => app.push(sbcListView()), sbcArt, (s.vault || []).length ? `${s.vault.length} in storage` : null);
      if (sbcTile.querySelector('.pm-badge')) sbcTile.querySelector('.pm-badge').classList.add('pm-badge--info');

      // squad battles: rank + progress
      const nextPts = rank.next ? rank.next[1] : s.battles.points;
      const prevPts = UT.RANKS[rank.index][1];
      const pct = rank.next ? ((s.battles.points - prevPts) / Math.max(1, nextPts - prevPts)) * 100 : 100;
      const battlesTile = hx('pm-hx--battles', 'Squad Battles', `${rank.name} · ${s.battles.points} pts · Week ${s.battles.week}`, () => app.push(battlesView()),
        h('div', { class: 'pm-art-battles', style: { position: 'absolute', inset: '0' } }, h('div', { class: `pm-rankbadge r${Math.floor(rank.index / 3)}` }, rank.name.split(' ')[0][0], h('small', null, rank.name.split(' ')[1] || '★'))),
        null, h('div', { class: 'pm-progress' }, h('i', { style: { width: `${Math.min(100, pct)}%` } })));

      // objectives: live progress on the three closest
      const objs = OBJ.objectiveList(s).filter((o) => !o.claimed && !o.locked).sort((a, b) => (b.ready - a.ready) || (b.prog / b.target - a.prog / a.target)).slice(0, 3);
      const objTile = hx('pm-hx--obj', 'Objectives', claimable ? `${claimable} ready to claim` : 'Daily · Weekly · Season', () => app.push(M.objectivesHubView()),
        h('div', { class: 'pm-art-obj', style: { position: 'absolute', inset: '0' } }, h('div', { class: 'pm-objmini' }, objs.map((o) => h('div', { class: o.ready ? 'done' : '' },
          h('span', null, o.label), h('b', null, `${Math.min(o.prog, o.target)}/${o.target}`), h('i', { style: { '--p': `${Math.min(100, (o.prog / o.target) * 100)}%` } }))))),
        claimable ? String(claimable) : null);

      // transfers: your most valuable tradeable card
      const tradeable = UT.clubPlayers(s).filter((p) => PM.isTradeable(s, p.id)).sort((a, b) => utPrice(b) - utPrice(a));
      const tl = PM.transferList(s).length;
      const listed = (s.listed || []).length;
      const mktArt = h('div', { class: 'pm-art-cards', style: { position: 'absolute', inset: '0' } },
        tradeable[0] ? h('div', { class: 'pm-art-price' }, h('small', null, `${tradeable[0].name} · est. value`), h('b', null, h('i', { class: 'pm-coin' }), fmtNum(utPrice(tradeable[0])))) : null,
        tradeable.slice(0, 2).reverse().map((p) => playerCard(p, { size: 'sm' })));
      const marketTile = hx('pm-hx--market', 'Transfers', listed || tl ? `${listed} listed · ${tl} on transfer list` : 'Player Market · AI Market', () => app.push(marketView()), mktArt, listed ? String(listed) : null);

      // promos: the live promo pack in its campaign colours
      const promoPack = onSale.find((p) => p.promo);
      const promo = promoPack ? PROMO_BY_ID[promoPack.promo] : null;
      const promoTile = hx('pm-hx--promo', 'Promos', promoTileSub() || 'Live campaigns', () => app.push(promoHubView(PROMO_DEPS)),
        h('div', { class: 'pm-art-promohx pm-art-sbc', style: { position: 'absolute', inset: '0', ...(promo ? { '--pa': promo.colors[0], '--pb': promo.colors[1] } : {}) } }, promoPack ? packArt(promoPack, 'md') : null), 'LIVE');

      const rivals = rivalsTile(app);
      rivals.classList.remove('pm-tile--wide');
      rivals.classList.add('pm-hx', 'pm-hx--rivals');

      add(main, utTabs(app, 'home'),
        h('section', { class: 'pm-clubhead' },
          frag(crestSVG(userClubObj(s), 'pm-crest pm-crest--lg')),
          h('div', null, h('h2', null, s.clubName),
            h('div', { class: 'pm-chiprow' },
              h('span', { class: 'pm-stat-chip' }, h('span', null, 'Record'), h('b', null, `${s.stats.wins}-${s.stats.draws}-${s.stats.losses}`)),
              h('small', { class: 'pm-dim pm-walletnote' }, app.wallet.mode === 'online' ? 'Coins shown: your online balance (server).' : 'Coins shown: local balance on this device.'))),
          h('div', { class: 'pm-clubhead-btns' }, displayButton(app), friendsButton(app), giftsButton(app), adminBadge(app))),
        h('div', { class: 'pm-uthub' },
          squadTile, storeTile, sbcTile, battlesTile, objTile, rivals, marketTile, promoTile,
          h('div', { class: 'pm-hxminis' }, mini('Club', `${s.club.length} players`, () => app.push(clubView()), 'club'),
          mini('Season', `Level ${SS.levelOf(ss.xp)}/${SS.SEASON_LEVELS}`, () => app.push(M.seasonPassView()), 'season', seasonReady ? `${seasonReady}` : null),
          mini('Evolutions', `${evoReady}/3 active`, () => app.push(M.evolutionsView()), 'evolutions'),
          mini('Draft', s.draft ? 'In progress' : 'Pick 1 of 5', () => app.push(M.draftView()), 'draftpick', s.draft ? '▶' : null),
          mini('Tournaments', 'Weekly knockouts', () => app.push(M.eventsView()), 'event'),
          mini('Team of the Week', '3 headliners 88+', () => app.push(M.totwView()), 'totw'),
          mini('Tactics', 'Custom & presets', () => app.push(M.utTacticsView()), 'tactics'),
          mini('Customise', 'Badge, name & kits', () => app.push(M.clubEditView()), 'custom'),
          mini('Swaps', `${fmtNum(s.tokens || 0)} tokens`, () => app.push(swapsView()), 'swap'))),
        adminCodesPanel(app, { compact: true }));
    },
  };
}

// ---------- player details (card detail view) ----------
const stars = (n) => h('span', { class: 'pm-stars', 'aria-label': `${n} of 5` }, Array.from({ length: 5 }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
export function playerModal(app, p, { actions = [], extra = null } = {}) {
  const n = NATION_BY_CODE[p.nat];
  const c = clubById(p.club);
  // Personal info is REAL (core/bios.js) or 'Unknown' — never generated. Age is computed from the date of birth.
  const bio = [
    ...profileFacts(p),
    ['Nation', h('span', { class: 'pm-factrow' }, frag(flagSVG(p.nat, 'pm-flag pm-flag--xs')), n ? n.name : p.nat)],
    ['Club', h('span', { class: 'pm-factrow' }, frag(crestSVG(c || p.club, 'pm-crest pm-crest--xs')), c ? c.name : p.club)],
    ['League', h('span', { class: 'pm-factrow' }, frag(leagueBadgeSVG(p.league)), leagueName(p.league))],
    ['Weak foot', p.hell === true ? '???' : stars(p.wf)], ['Skill moves', p.hell === true ? '???' : stars(p.sm)],
    ['Work rates', p.hell === true ? '???' : `${p.wr[0]} / ${p.wr[1]}`],
    ['Card', p.hell === true ? 'HELL' : p.special ? `${UT.SPECIAL_NAME[p.special] || p.special}${p.real ? ' · real player' : ''}` : `${p.tier[0].toUpperCase() + p.tier.slice(1)}${p.rare ? ' rare' : ''}`],
    ['Potential', p.hell === true ? '???' : p.glitch === true ? infNodes('∞') : p.cursed === true ? infNodes('-∞') : p.pot],
  ];
  if (p.moment) bio.push(['Moment', p.moment]);
  if (p.upg) bio.push(['Upgrades', `${p.upg.level}/${p.upg.max} knockout rounds reached`]);
  if (extra) bio.push(...extra);
  return modal(app.root, {
    title: p.name, wide: true, className: 'pm-pmodal',
    body: h('div', { class: 'pm-pdetail' },
      h('div', { class: 'pm-pdetail-card' }, playerCard(p, { size: 'md' }),
        h('div', { class: 'pm-posrow', 'aria-label': 'Positions' }, h('span', { class: 'on' }, p.pos), (p.alt || []).map((x) => h('span', null, x)))),
      h('div', { class: 'pm-pdetail-info' },
        h('section', null, h('h4', null, 'Attributes'), attributeBlock(p)),
        h('section', null, h('h4', null, 'Profile'), h('dl', { class: 'pm-facts' }, bio.map(([k, v]) => [h('dt', null, k), h('dd', null, v instanceof Node ? v : String(v))]))),
        h('section', null, playstyleList(p)),
        h('section', { class: 'pm-goalsfor' }, h('h4', null, 'Goals for your club'), h('p', { class: 'pm-dim' }, 'Appearances and goals for your club will show here in a later update.')))),
    actions: actions.concat([{ label: 'Close' }]),
  });
}

// ---------- squad ----------
function squadView() {
  return {
    title: 'Squad', kicker: 'Ultimate Team', coins: true, topRight: tokenChip, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      main.appendChild(utTabs(app, 'squad'));
      SQ.ensureSquads(s);
      // ---- saved squads: switch / new / rename / delete (owner request, Sep 29) ----
      const squads = SQ.listSquads(s);
      const nameInput = (value) => h('input', { class: 'pm-input', maxlength: '20', value, 'aria-label': 'Squad name' });
      const squadBar = h('div', { class: 'pm-squadbar' },
        h('label', { class: 'pm-squadbar-pick' }, h('span', { class: 'pm-dim' }, 'Squad'),
          select(squads.map((q, i) => [i, `${q.name} · ${q.formation} · ${q.rating || '-'}`]), s.activeSquad, (v) => {
            if (SQ.switchSquad(s, Number(v))) { enforceLock(s); persist(app); app.toast(`${s.squads[s.activeSquad].name} loaded.`, 'good'); app.refresh(); }
          }, { 'aria-label': 'Active squad' })),
        h('button', { class: 'pm-btn pm-btn--sm', disabled: squads.length >= SQ.MAX_SQUADS, title: squads.length >= SQ.MAX_SQUADS ? `Up to ${SQ.MAX_SQUADS} squads` : 'New squad (starts as a copy of this one)', onclick: () => {
          const inp = nameInput(`Squad ${squads.length + 1}`);
          modal(app.root, { title: 'New squad', body: h('div', null, h('p', { class: 'pm-dim' }, 'Starts as a copy of your current squad. Change it, then switch between squads any time.'), inp),
            actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: () => { if (SQ.addSquad(s, inp.value) >= 0) { enforceLock(s); persist(app); app.refresh(); } } }] });
        } }, '+ New'),
        h('button', { class: 'pm-btn pm-btn--sm', onclick: () => {
          const inp = nameInput(s.squads[s.activeSquad].name);
          modal(app.root, { title: 'Rename squad', body: inp, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => { SQ.renameSquad(s, s.activeSquad, inp.value); persist(app); app.refresh(); } }] });
        } }, 'Rename'),
        h('button', { class: 'pm-btn pm-btn--sm pm-btn--danger', disabled: squads.length <= 1, onclick: async () => {
          if (!(await confirmBox(app.root, 'Delete squad', `Delete "${s.squads[s.activeSquad].name}"? Your players stay in your club.`, 'Delete', true))) return;
          if (SQ.deleteSquad(s, s.activeSquad)) { persist(app); app.refresh(); }
        } }, 'Delete'));
      main.appendChild(squadBar);
      const autoBtn = h('button', { class: 'pm-btn pm-btn--accent', onclick: () => {
        const before = s.squad.formation;
        UT.autoSquad(s, ed.get().formation); enforceLock(s); persist(app);
        const o = UT.autoBuildSettings(s);
        if (s.squad.formation !== before) app.refresh(); else ed.set(s.squad);
        const short = s.autoBuildShort || 0;
        app.toast(`Best squad built (${{ rating: 'highest rating', balanced: 'rating + chemistry', chemistry: 'max chemistry' }[o.priority]}${o.formation === 'best' ? `, best formation: ${s.squad.formation}` : ''}).${short ? ` Only enough matching cards for ${11 - short} of 11: the rest came from your club.` : ''}`, short ? 'warn' : 'good');
      } }, 'Auto-build best squad');
      const autoSettingsBtn = h('button', { class: 'pm-btn', 'aria-label': 'Auto-build settings', title: 'Auto-build settings', onclick: () => autoBuildSettingsModal(app) }, 'Auto-build settings');
        const ed = squadEditor({
        formation: s.squad.formation, slots: s.squad.slots, bench: s.squad.bench,
        getPlayer, pool: () => UT.clubPlayers(s),
        decorate: (p) => p.id === HELL_CARD_ID && s.vinson?.phase === 'locked' ? h('span', { class: 'vinson-chain', 'aria-label': 'Cursed card locked in squad' }, '⛓') : null,
        onChange: (v) => {
          s.squad = v;
          app.vinson?.onSquadChange();
          if (enforceLock(s)) { ed.set(s.squad); app.toast('EVIL VINSON cannot be removed from this squad.', 'warn'); }
          OBJ.setFlag(s, 'squadEdited'); persist(app);
        },
        toolbar: [autoBtn, autoSettingsBtn], chemToggle: true,
        manager: { value: s.squad.manager || null, owned: () => s.managers || [], onChange: (m) => { UT.setManager(s, m); persist(app); } },
        chemStyle: { value: s.squad.chemStyle || 'classic', onChange: (v) => { s.squad.chemStyle = v; persist(app); } },
      });
      add(main, ed.el);
    },
  };
}

/** Auto-build filters (owner, Sep 29): card type / promo, tier, rarity, rating range, league, club, country.
 * Choices come from the cards actually in the club, so every option can match something. */
function filterBlock(s, o) {
  const club = UT.clubPlayers(s);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const specials = uniq(club.map((p) => p.special)).sort((a, b) => String(UT.SPECIAL_NAME[a] || a).localeCompare(String(UT.SPECIAL_NAME[b] || b)));
  const leagues = uniq(club.map((p) => p.league)).map((id) => [id, leagueName(id)]).sort((a, b) => a[1].localeCompare(b[1]));
  const clubs = uniq(club.map((p) => p.club)).map((id) => [id, (clubById(id) || { name: id }).name]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const nations = uniq(club.map((p) => p.nat)).map((id) => [id, (NATION_BY_CODE[id] || { name: id }).name]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const sel = (key, opts, label) => select(opts, o[key], (v) => { o[key] = v; }, { 'aria-label': label });
  const num = (key, label) => h('input', { class: 'pm-input pm-input--num', type: 'number', min: '0', max: '999', value: o[key] || '', placeholder: 'Any', 'aria-label': label, oninput: (e) => { o[key] = Number(e.target.value) || 0; } });
  const field = (label, control) => h('label', { class: 'pm-filterfield' }, h('span', { class: 'pm-dim' }, label), control);
  return h('div', { class: 'pm-autofilters' },
    h('div', { class: 'pm-autofilters-head' }, h('b', null, 'Filters'), h('small', { class: 'pm-dim' }, 'Only use cards that match. Gaps are filled from the rest of your club.')),
    h('div', { class: 'pm-filtergrid' },
      field('Card type', sel('cardType', [['any', 'Any'], ['base', 'Base cards only'], ['special', 'Special cards only'], ...specials.map((id) => [id, UT.SPECIAL_NAME[id] || id])], 'Card type')),
      field('Tier', sel('tier', [['any', 'Any'], ['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze'], ['icon', 'Icon']], 'Tier')),
      field('Rarity', sel('rarity', [['any', 'Any'], ['rare', 'Rare only'], ['common', 'Common only']], 'Rarity')),
      field('Min OVR', num('minOvr', 'Minimum overall')),
      field('Max OVR', num('maxOvr', 'Maximum overall')),
      field('League', sel('league', [['', 'Any league'], ...leagues], 'League')),
      field('Club', sel('club', [['', 'Any club'], ...clubs], 'Club')),
      field('Country', sel('nation', [['', 'Any country'], ...nations], 'Country'))));
}

/** Auto-build settings (owner request, Sep 29): what "Auto-build best squad" optimises for. */
function autoBuildSettingsModal(app) {
  const s = app.ut;
  const o = { ...UT.autoBuildSettings(s) };
  const row = (label, hint, control) => h('label', { class: 'pm-setrow' }, h('span', null, h('b', null, label), h('small', { class: 'pm-dim' }, hint)), control);
  const check = (key) => h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; } });
  const body = h('div', { class: 'pm-autobuild' },
    row('Priority', 'What matters most when picking players', select([['rating', 'Highest rating'], ['balanced', 'Balanced (rating + chemistry)'], ['chemistry', 'Max chemistry']], o.priority, (v) => { o.priority = v; }, { 'aria-label': 'Priority' })),
    row('Formation', 'Keep yours, or let it pick the strongest shape', select([['current', 'Keep my formation'], ['best', 'Pick the best formation']], o.formation, (v) => { o.formation = v; }, { 'aria-label': 'Formation' })),
    row('Use untradeable cards', 'Off leaves untradeable cards out of the squad', check('untradeables')),
    row('Only fill empty spots', 'Keeps the players already in your XI', check('fillOnly')),
    filterBlock(s, o));
  modal(app.root, {
    title: 'Auto-build settings', body,
    actions: [
      { label: 'Reset', onClick: () => { UT.setAutoBuildSettings(s, UT.AUTO_BUILD_DEFAULTS); persist(app); app.toast('Auto-build settings reset.', 'good'); } },
      { label: 'Cancel' },
      { label: 'Save', primary: true, onClick: () => { UT.setAutoBuildSettings(s, o); persist(app); app.toast('Auto-build settings saved.', 'good'); } }],
  });
}

// ---------- club collection ----------
function clubView() {
  const f = { q: '', group: 'ALL', tier: '', sort: 'ovr', league: '' };
  return {
    title: 'Club', kicker: 'Ultimate Team', coins: true, topRight: tokenChip, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const grid = h('div', { class: 'pm-cardgrid' });
      const count = h('span', { class: 'pm-dim' });
      const draw = () => {
        clear(grid);
        const q = f.q.trim().toLowerCase();
        let list = UT.clubPlayers(s).filter((p) => (!q || p.name.toLowerCase().includes(q))
          && (f.group === 'ALL' || POS_GROUP[p.pos] === f.group)
          && (!f.tier || (f.tier === 'special' ? !!p.special : f.tier === 'lotg' ? p.special === 'lotg' : f.tier === 'rare' ? p.rare : p.tier === f.tier && !p.special))
          && (!f.league || p.league === f.league));
        const sorters = { ovr: byDisplayRank, name: (a, b) => a.name.localeCompare(b.name), pos: (a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.ovr - a.ovr, value: (a, b) => utPrice(b) - utPrice(a), nation: (a, b) => a.nat.localeCompare(b.nat) || b.ovr - a.ovr, league: (a, b) => a.league.localeCompare(b.league) || b.ovr - a.ovr };
        list.sort((a, b) => secretFirst(a, b) || sorters[f.sort](a, b)); // Secret cards first whatever the sort
        count.textContent = `${list.length} of ${s.club.length} players`;
        const inSquad = new Set(s.squad.slots.concat(s.squad.bench).filter(Boolean));
        const xi = new Set(s.squad.slots.filter(Boolean)), untr = new Set(s.untradeable || []);
        // built a chunk at a time as you scroll (big clubs lagged when every card was built up front)
        lazyFill(grid, list, (p) => {
          const tag = inSquad.has(p.id) ? h('div', { class: 'pm-cardtag' }, xi.has(p.id) ? 'XI' : 'SUB') : untr.has(p.id) ? h('div', { class: 'pm-cardtag pm-cardtag--ut', title: 'Untradeable' }, 'UT') : null;
          const onTl = PM.onTransferList(s, p.id);
          return h('div', { class: 'pm-cardcell' },
            playerCard(p, { size: 'sm', extra: tag, onClick: () => clubPlayerModal(app, p, draw) }),
            cardMeta(p, onTl ? h('span', { class: 'pm-cardmeta-tl', title: 'On your transfer list' }, 'TL') : null));
        });
        if (!list.length) grid.appendChild(h('p', { class: 'pm-empty' }, 'No players match these filters.'));
        drawBulk(list, inSquad);
      };
      // bulk moves for the cards shown that are NOT in the XI or on the bench
      const bulk = h('div', { class: 'pm-clubbulk' });
      const drawBulk = (list, inSquad) => {
        clear(bulk);
        const spare = list.filter((p) => !inSquad.has(p.id));
        const utSet = new Set(s.untradeable || []);
        const untr = spare.filter((p) => utSet.has(p.id));
        const trade = spare.filter((p) => !utSet.has(p.id) && !PM.onTransferList(s, p.id));
        if (!untr.length && !trade.length) return;
        add(bulk, h('span', { class: 'pm-dim' }, `${spare.length} shown not in your squad`),
          untr.length ? h('button', { class: 'pm-btn pm-btn--sm', onclick: async () => {
            if (!(await confirmBox(app.root, 'Send to SBC storage', `Move ${untr.length} untradeable card${untr.length === 1 ? '' : 's'} (not in your squad) to SBC storage?`, 'Send all'))) return;
            for (const p of untr) { UT.removeFromClub(s, p.id); UT.sendToVault(s, p.id); }
            persist(app); app.toast(`${untr.length} card${untr.length === 1 ? '' : 's'} moved to SBC storage`, 'good'); draw();
          } }, `Send all untradeables to SBC storage (${untr.length})`) : null,
          trade.length ? h('button', { class: 'pm-btn pm-btn--sm', onclick: async () => {
            if (!(await confirmBox(app.root, 'Send to transfer list', `Put ${trade.length} tradeable card${trade.length === 1 ? '' : 's'} (not in your squad) on your transfer list?`, 'Send all'))) return;
            let n = 0, err = '';
            for (const p of trade) { const r = PM.sendToTransferList(s, p.id); if (r.ok) n++; else { err = r.error; break; } }
            persist(app); app.toast(err ? `${n} sent. ${err}` : `${n} card${n === 1 ? '' : 's'} sent to your transfer list`, err ? 'warn' : 'good'); draw();
          } }, `Send all to transfer list (${trade.length})`) : null);
      };
      const search = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search name…', value: f.q, 'aria-label': 'Search club' });
      const redrawSoon = debounce(draw, 150);
      search.addEventListener('input', () => { f.q = search.value; redrawSoon(); });
      app.onCleanup(() => { if (grid._lazyStop) grid._lazyStop(); });
      // Saved cards: duplicates left on a pack's Done and cards rescued from a pack left mid-opening (owner, Sep 29)
      const saved = Array.isArray(s.saved) ? s.saved : [];
      const savedSec = saved.length ? h('section', { class: 'pm-panel pm-saved' },
        h('h3', { class: 'pm-h' }, `Saved cards (${saved.length})`),
        h('p', { class: 'pm-dim' }, 'Cards from packs you did not send anywhere. Nothing here is ever sold unless you choose to.'),
        h('div', { class: 'pm-btnrow' },
          h('button', { class: 'pm-btn pm-btn--sm pm-btn--primary', onclick: () => {
            const n = UT.claimAllSaved(s); persist(app);
            app.toast(n ? `${n} card${n === 1 ? '' : 's'} added to your club${s.saved.length ? '. Duplicates stay here.' : ''}` : 'Nothing new to claim: these are all duplicates.', n ? 'good' : 'warn'); app.refresh();
          } }, 'Claim all'),
          h('button', { class: 'pm-btn pm-btn--sm pm-btn--ghost', onclick: async () => {
            const sell = saved.map(getPlayer).filter((p) => p && p.secret !== true);
            if (!sell.length) { app.toast('Nothing to sell (Secret cards are never bulk sold).', 'warn'); return; }
            const v = sell.reduce((t, p) => t + quickSellValue(p), 0);
            if (!(await confirmBox(app.root, 'Sell all', `Quick sell ${sell.length} saved card${sell.length === 1 ? '' : 's'} for ${fmtNum(v)} coins? Secret cards are kept.`, 'Sell all', true))) return;
            const r = UT.sellAllSaved(s); persist(app); app.toast(`+${fmtNum(r.coins)} coins`, 'good'); app.refresh();
          } }, 'Sell all')),
        h('div', { class: 'pm-admin-results' }, saved.map((pid, i) => {
          const p = getPlayer(pid); if (!p) return null;
          const inClub = s.club.includes(pid);
          const act = (fn, msg) => { if (UT.takeSaved(s, i) == null) return; fn(); persist(app); if (msg) app.toast(msg, 'good'); app.refresh(); };
          return h('div', { class: 'pm-mktrow' }, playerCard(p, { size: 'xs' }),
            h('div', { class: 'pm-mkt-info' }, h('b', null, p.name), h('span', { class: 'pm-dim' }, inClub ? 'Duplicate (already in your club)' : 'Not in your club')),
            h('div', { class: 'pm-btnrow' },
              inClub ? null : h('button', { class: 'pm-btn pm-btn--sm pm-btn--primary', onclick: () => act(() => UT.addToClub(s, pid), `${p.name} added to your club`) }, 'To club'),
              h('button', { class: 'pm-btn pm-btn--sm', onclick: () => act(() => UT.sendToVault(s, pid), `${p.name} moved to SBC storage`) }, 'To SBC storage'),
              h('button', { class: 'pm-btn pm-btn--sm pm-btn--ghost', onclick: async () => {
                const v = quickSellValue(p);
                if (!(await confirmBox(app.root, 'Quick sell', `Quick sell ${p.name} for ${fmtNum(v)} coins?`, 'Quick sell', true))) return;
                act(() => { s.coins += v; }, `+${fmtNum(v)} coins`);
              } }, 'Quick sell')));
        }))) : null;
      if (app._rescued) { app._rescued = false; setTimeout(() => app.toast('Cards from a pack you left mid-opening were saved to Saved cards.', 'good'), 0); }
      add(main, utTabs(app, 'club'), savedSec,
        h('div', { class: 'pm-filterbar' },
          search,
          select([['ALL', 'All positions'], ['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['ATT', 'Attackers']], f.group, (v) => { f.group = v; draw(); }, { 'aria-label': 'Position' }),
          select([['', 'All tiers'], ['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze'], ['rare', 'Rare'], ['special', 'Special'], ['lotg', 'Legends of the Game']], f.tier, (v) => { f.tier = v; draw(); }, { 'aria-label': 'Tier' }),
          select([['', 'All leagues'], ...LEAGUES.map((l) => [l.id, l.name]), ['ICN', 'Legends of the Game'], ['LEG', 'Classics'], ['HER', 'Heroes']], f.league, (v) => { f.league = v; draw(); }, { 'aria-label': 'League' }),
          select([['ovr', 'Sort: Rating'], ['name', 'Sort: Name'], ['pos', 'Sort: Position'], ['value', 'Sort: Value'], ['nation', 'Sort: Nation'], ['league', 'Sort: League']], f.sort, (v) => { f.sort = v; draw(); }, { 'aria-label': 'Sort' }),
          count),
        bulk, grid);
      draw();
    },
  };
}

function clubPlayerModal(app, p, redraw) {
  const s = app.ut;
  const qs = quickSellValue(p);
  const untradeable = (s.untradeable || []).includes(p.id);
  playerModal(app, p, {
    extra: [['Market price', `${fmtNum(utPrice(p))} coins`], ['Quick sell', `${fmtNum(qs)} coins`], ['Tradeable', untradeable ? 'No (untradeable)' : 'Yes']],
    actions: [
      untradeable
        ? { label: 'Send to SBC storage', onClick: () => { UT.removeFromClub(s, p.id); UT.sendToVault(s, p.id); persist(app); app.toast(`${p.name} moved to SBC storage`, 'good'); redraw(); } }
        : PM.onTransferList(s, p.id)
          ? { label: 'Remove from transfer list', onClick: () => { PM.removeFromTransferList(s, p.id); persist(app); app.toast(`${p.name} removed from your transfer list`); redraw(); } }
          : { label: 'Send to transfer list', onClick: () => { const r = PM.sendToTransferList(s, p.id); if (!r.ok) { app.toast(r.error, 'warn'); return; } persist(app); app.toast(`${p.name} sent to your transfer list`, 'good'); redraw(); } },
      { label: 'List on Player Market', disabled: untradeable, onClick: () => { setTimeout(() => playerMarketListModal(app, p, redraw), 0); } },
      { label: 'Sell to AI Market', disabled: untradeable, onClick: () => { setTimeout(() => sellModal(app, p, redraw), 0); } },
      { label: `Quick sell +${fmtNum(qs)}`, danger: true, onClick: () => {
        setTimeout(async () => {
          if (await confirmBox(app.root, 'Quick sell', `Quick sell ${p.name} for ${fmtNum(qs)} coins?`, 'Quick sell', true)) {
            UT.quickSell(s, p.id); persist(app); app.toast(`+${fmtNum(qs)} coins`, 'good'); app.renderTop(app.stack[app.stack.length - 1]); redraw();
          }
        }, 0);
      } },
    ],
  });
}

export function sellModal(app, p, redraw) {
  const s = app.ut;
  const fair = utPrice(p);
  const input = h('input', { class: 'pm-input', type: 'number', min: '100', step: '50', value: String(fair), 'aria-label': 'Asking price' });
  modal(app.root, {
    title: `AI Market: sell ${p.name}`,
    body: h('div', { class: 'pm-form' }, h('p', { class: 'pm-dim' }, 'The AI Market is simulated (computer traders) and separate from the online Player Market.'), h('p', null, `Estimated value: ${fmtNum(fair)} coins. A 5% tax applies. Higher prices are less likely to find an AI buyer.`), h('label', null, h('span', null, 'Price'), input)),
    actions: [{ label: 'Cancel' }, { label: 'List', primary: true, onClick: () => {
      const price = Math.max(100, Math.round(Number(input.value) || fair));
      const r = UT.sellOnMarket(s, p.id, price);
      if (r.sold) { persist(app); app.toast(`${p.name} sold! +${fmtNum(r.received)} coins`, 'good'); app.renderTop(app.stack[app.stack.length - 1]); redraw(); }
      else app.toast(`No buyer found at ${fmtNum(price)} coins. Try a lower price.`, 'warn');
    } }],
  });
}

// ---------- store & packs ----------
export function oddsModal(app, pack) {
  const cats = Object.keys(UT.CATEGORIES).filter((c) => pack.slots.some((sl) => sl.odds[c]));
  const pct = (v) => (v >= 0.1 ? `${(v * 100).toFixed(1)}%` : v >= 0.001 ? `${(v * 100).toFixed(2)}%` : `${(v * 100).toFixed(3)}%`);
  modal(app.root, {
    title: `${pack.name}: odds`, wide: true,
    body: h('div', null,
      h('p', { class: 'pm-dim' }, 'Every item is drawn independently using these published probabilities.'),
      h('div', { class: 'pm-tablewrap' }, h('table', { class: 'pm-table' },
        h('thead', null, h('tr', null, h('th', null, 'Category'), pack.slots.map((sl, i) => h('th', null, `Slot group ${i + 1} (${sl.n}×)`)), h('th', null, 'At least one'))),
        h('tbody', null, cats.map((c) => h('tr', null, h('td', null, UT.CATEGORIES[c].label), pack.slots.map((sl) => h('td', null, sl.odds[c] ? pct(sl.odds[c]) : '-')), h('td', null, h('b', null, pct(UT.packAtLeastOne(pack, c)))))))))),
    actions: [{ label: 'Close', primary: true }],
  });
}

export function openPackFlow(app, packType, onDone, count = 1) {
  if (typeof app.restricted === 'function' && app.restricted('packs')) { app.toast('The owner has restricted packs on your account.', 'warn'); return; }
  const s = app.ut;
  const pack = UT.PACK_BY_ID[packType];
  // count > 1 (admin "open up to 10 at once", owner Sep 29): every pack is rolled, then shown as one opening with
  // the best card leading; later packs see earlier pulls as owned so duplicates are flagged correctly.
  const n = Math.max(1, Math.min(10, Math.floor(count) || 1));
  const owned = UT.ownedSet(s), rng = new Rng();
  const curse = cursedPack(s) && !isOwner(app.online);
  let items = [];
  for (let k = 0; k < n; k++) {
    const got = UT.openPack(packType, owned, rng);
    // admin forced pull: this pack leads with the queued card (walkout) in place of its lead card
    const forced = curse ? null : UT.takeForcedPull(s);
    if (forced) got[0] = { pid: forced, cat: 'forced', dup: owned.has(forced) };
    for (const it of got) owned.add(it.pid);
    items = items.concat(got);
  }
  if (curse) {
    items = items.map((_, i) => ({ pid: HELL_CARD_ID, cat: `secret_${HELL_CARD_ID}`, dup: i > 0 || (s.club || []).includes(HELL_CARD_ID) }));
    app.toast("YOU'VE BEEN CURSED BY VINSON", 'bad');
  }
  if (n > 1) items.sort((a, b) => UT.itemScore(getPlayer(b.pid)) - UT.itemScore(getPlayer(a.pid)));
  s.stats.packsOpened += n;
  // until each card is resolved it sits in pendingPack, so closing the page mid-opening can't lose it
  s.pendingPack = (Array.isArray(s.pendingPack) ? s.pendingPack : []).concat(items.map((it) => it.pid));
  persist(app);
  const done = (pid) => UT.resolvePending(s, pid);
  let claimedVinson = false;
  const claim = (pid) => { if (pid === HELL_CARD_ID && !claimedVinson) { claimedVinson = true; void app.vinson?.onPull(); } };
  runPackOpening(app.root, {
    pack: n > 1 ? { ...pack, name: `${n}× ${pack.name}` } : pack, items, getPlayer,
    curse,
    // Rolling contents happens before the player taps Open. Start only after the reveal.
    onReveal: () => { if (items.some((it) => it.pid === HELL_CARD_ID)) claim(HELL_CARD_ID); },
    sellValue: (p) => curse ? 0 : quickSellValue(p),
    onSend: (pid) => { done(pid); UT.addToClub(s, pid); persist(app); claim(pid); },
    onVault: (pid) => { done(pid); UT.sendToVault(s, pid); persist(app); claim(pid); },
    onSave: (pid) => { done(pid); UT.saveCard(s, pid); persist(app); claim(pid); },
    // FC-style "Send all to transfer list": the card joins the club, then is flagged for sale (pmarket.js).
    canTransfer: (pid) => !(s.untradeable || []).includes(pid),
    onTransfer: (pid) => { done(pid); UT.addToClub(s, pid); const r = PM.sendToTransferList(s, pid); persist(app); claim(pid); return r; },
    onSell: (pid) => { claim(pid); done(pid); const v = curse ? 0 : quickSellValue(getPlayer(pid)); s.coins += v; persist(app); return v; },
    onCurseExit: () => { UT.rescuePendingPack(s); persist(app); app.popTo((v) => v.utHome); app.refresh(); },
    onDone: (sum) => { if (s.pendingPack?.includes(HELL_CARD_ID)) claim(HELL_CARD_ID); UT.rescuePendingPack(s); persist(app); app.refresh(); if (onDone) onDone(sum); },
  });
}

function storeView() {
  return {
    title: 'Store', kicker: 'Ultimate Team', coins: true, topRight: tokenChip, cls: 'pm-main--wide', liveConfig: true,
    render(main, app) {
      const s = app.ut;
      const mine = h('section', { class: 'pm-section' });
      if (s.packs.length) {
        add(mine, h('h3', { class: 'pm-h' }, `My packs (${s.packs.length})`),
          h('div', { class: 'pm-packrow' }, s.packs.map((pk, i) => {
            const pack = UT.PACK_BY_ID[pk.type];
            return h('div', { class: 'pm-packitem' }, packArt(pack, 'sm'),
              h('div', null, h('b', null, pack.name), h('small', { class: 'pm-dim' }, pk.from || '')),
              h('button', { class: 'pm-btn pm-btn--primary', onclick: () => { s.packs.splice(i, 1); openPackFlow(app, pk.type); } }, 'Open'));
          })));
      }
      const cfg = getConfig();
      const onSale = UT.storePacks();
      const promoPacks = onSale.filter((p) => p.promo);
      const normalPacks = onSale.filter((p) => !p.promo);
      // Store sections (owner, Sep 30): Normal packs · Promo packs · Managers; the chosen tab is remembered for the visit
      const tabs = [['normal', 'Normal packs', normalPacks.length], ['promo', 'Promo packs', promoPacks.length], ['managers', 'Managers', UT.REAL_MANAGERS.length]];
      if (!tabs.some(([k]) => k === app.storeTab)) app.storeTab = 'normal';
      const tabBar = h('div', { class: 'pm-storetabs', role: 'tablist', 'aria-label': 'Store sections' }, tabs.map(([k, label, n]) => h('button', {
        class: `pm-chip ${app.storeTab === k ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(app.storeTab === k),
        onclick: () => { app.storeTab = k; app.refresh(); },
      }, label, h('small', null, String(n)))));
      let sectionBody;
      if (app.storeTab === 'managers') sectionBody = managerShop(app);
      else if (!cfg.packsInShop) sectionBody = h('div', { class: 'pm-empty-state' }, h('p', null, 'Packs are temporarily disabled in the shop by the owner.'));
      else if (app.storeTab === 'promo') sectionBody = promoPacks.length ? h('div', { class: 'pm-storegrid pm-storegrid--promo' }, promoPacks.map((pack) => storeItem(pack))) : h('p', { class: 'pm-dim' }, 'No promo packs on sale right now.');
      else sectionBody = h('div', { class: 'pm-storegrid' }, normalPacks.map((pack) => storeItem(pack)));
      const store = h('section', { class: 'pm-section' }, tabBar, sectionBody);
      async function buyPack(pack) {
        const price = effPrice(pack.price);
        if (!(await confirmBox(app.root, 'Buy pack', `Buy ${pack.name} for ${fmtNum(price)} coins?`, 'Buy & open'))) return;
        if (s.coins < price) return;
        s.coins -= price; persist(app); app.renderTop(app.stack[app.stack.length - 1]);
        openPackFlow(app, pack.id);
      }
      function storeItem(pack) {
        const price = effPrice(pack.price);
        return h('div', { class: `pm-storeitem ${pack.promo ? `is-promo pm-promo--${pack.promo}` : ''}`, style: pack.promo ? { '--pa': PROMO_BY_ID[pack.promo].colors[0], '--pb': PROMO_BY_ID[pack.promo].colors[1], '--pc': PROMO_BY_ID[pack.promo].colors[2] } : null },
          packArt(pack, 'md'),
          h('div', { class: 'pm-storeinfo' }, h('h4', null, pack.name), h('p', { class: 'pm-dim' }, pack.desc),
            h('div', { class: 'pm-price' }, h('i', { class: 'pm-coin', 'aria-hidden': 'true' }), fmtNum(price), price !== pack.price ? h('small', { class: 'pm-dim' }, ` (base ${fmtNum(pack.price)})`) : null),
            h('div', { class: 'pm-btnrow' },
              h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => oddsModal(app, pack) }, 'View odds'),
              h('button', {
                class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: s.coins < price,
                onclick: () => buyPack(pack),
              }, 'Buy & open'))));
      }
      const show = cfg.packsInShop && onSale.length > 1 ? packShowcase(app, [...promoPacks, ...onSale.filter((p) => !p.promo)], buyPack) : null;
      add(main, utTabs(app, 'store'), M.picksRow(app), show, mine, store, h('p', { class: 'pm-hint' }, 'Coins are earned from matches, objectives, SBCs and selling players. There are no real-money purchases.'));
    },
  };
}

/** Store > Managers (owner, Sep 30): the Manager Pack (one real manager, duplicates refund coins) + the collection. */
function managerShop(app) {
  const s = app.ut;
  const owned = new Set(s.managers || []);
  const MP = UT.MANAGER_PACK;
  const price = effPrice(MP.price);
  const buy = async () => {
    if (!(await confirmBox(app.root, 'Buy Manager Pack', `Buy a Manager Pack for ${fmtNum(price)} coins?`, 'Buy & open'))) return;
    if (s.coins < price) return;
    s.coins -= price;
    const r = UT.openManagerPack(s);
    persist(app); app.renderTop(app.stack[app.stack.length - 1]);
    const m = UT.getManager(r.id);
    modal(app.root, {
      title: r.dup ? 'Duplicate manager' : 'New manager!',
      body: h('div', { class: 'pm-mgrreveal' }, managerCard(m),
        h('p', { class: 'pm-dim' }, r.dup ? `You already had ${m.name}: ${fmtNum(r.refund)} coins refunded.` : `${m.name} joined your club. Assign him on the Squad screen (Manager slot).`)),
      actions: [{ label: 'Great', primary: true }],
      onClose: () => app.refresh(),
    });
  };
  return h('div', { class: 'pm-mgrshop' },
    h('div', { class: 'pm-mgrshop-pack' },
      managerCard({ name: 'Manager Pack', nat: '', league: null }, { locked: true }),
      h('h4', null, MP.name), h('p', { class: 'pm-dim' }, MP.desc),
      h('div', { class: 'pm-price' }, h('i', { class: 'pm-coin', 'aria-hidden': 'true' }), fmtNum(price)),
      h('button', { class: 'pm-btn pm-btn--primary', disabled: s.coins < price, onclick: buy }, 'Buy & open')),
    h('div', null,
      h('h3', { class: 'pm-h' }, `Your managers (${owned.size}/${UT.REAL_MANAGERS.length})`),
      h('div', { class: 'pm-mgrgrid' }, UT.REAL_MANAGERS.map((m) => managerCard(m, { size: 'sm', locked: !owned.has(m.id) })))));
}

/** Home Store tile: three packs fanned like the Squad tile's cards; every 3 s the fan turns to the next pack
 * (the others slide round behind). Transform/opacity only; off under prefers-reduced-motion; timer cleaned up. */
function packFan(app, packs, onChange) {
  const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  const fan = h('div', { class: 'pm-packfan' });
  const els = packs.map((p) => { const el = h('div', { class: 'pm-packfan-item' }, packArt(p, 'md')); fan.appendChild(el); return el; });
  let i = 0;
  const layout = () => {
    const n = packs.length;
    els.forEach((el, k) => {
      let d = k - i;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      const a = Math.abs(d);
      el.hidden = a > 2;
      el.style.setProperty('--x', `${d * 52}%`);
      el.style.setProperty('--r', `${d * 9}deg`);
      el.style.setProperty('--y', `${a * 0.9}em`);
      el.style.setProperty('--s', String(d === 0 ? 1.12 : a === 1 ? 0.9 : 0.7));
      el.style.setProperty('--o', String(a > 1 ? 0 : 1));
      el.style.zIndex = String(10 - a);
    });
    onChange(packs[i]);
  };
  layout();
  if (!reduced && packs.length > 1) {
    const t = setInterval(() => { if (!document.hidden) { i = (i + 1) % packs.length; layout(); } }, 3000);
    app.onCleanup(() => clearInterval(t));
  }
  return fan;
}

// ---------- Store showcase ----------
// Owner request (Sep 29): with every pack on sale, a big stage at the top of the Store cycles through them
// carousel-style (neighbours peek in at the sides). Press and hold the front pack to zoom in on it; swipe, the
// arrows or the arrow keys switch. Auto-advances every 3.5 s, paused while hovered or held, off under
// prefers-reduced-motion. Only transform/opacity animate (Chromebook-cheap); the timer is cleared on leave.
function packShowcase(app, packs, buy) {
  const st = { i: 0, held: false, hover: false };
  const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  const stage = h('div', { class: 'pm-show-stage' });
  const info = h('div', { class: 'pm-show-info', 'aria-live': 'polite' });
  const count = h('span', { class: 'pm-show-count' });
  const bar = h('i', { class: 'pm-show-bar' });
  let zoomT = 0;
  const unzoom = () => { clearTimeout(zoomT); st.held = false; stage.classList.remove('is-zoom'); };
  const slots = packs.map((pack, k) => {
    const el = h('button', { class: 'pm-show-pack', type: 'button', 'aria-label': `${pack.name}${k === st.i ? '' : ': show'}` }, packArt(pack, 'lg'));
    el.addEventListener('click', () => { if (k !== st.i) go(k); });
    el.addEventListener('pointerdown', (e) => {
      if (k !== st.i) return;
      st.held = true;
      zoomT = setTimeout(() => stage.classList.add('is-zoom'), 160);
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, unzoom);
    stage.appendChild(el);
    return el;
  });
  // swipe anywhere on the stage (ignored while zoomed in)
  let sx = null;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 40 && !stage.classList.contains('is-zoom')) go(st.i + (dx < 0 ? 1 : -1));
  });
  function layout() {
    const n = packs.length;
    slots.forEach((el, k) => {
      let d = k - st.i;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      const a = Math.abs(d);
      el.hidden = a > 2;
      el.classList.toggle('is-on', d === 0);
      el.tabIndex = d === 0 ? 0 : -1;
      el.style.setProperty('--x', `${d * 58}%`);
      el.style.setProperty('--s', String(d === 0 ? 1 : a === 1 ? 0.74 : 0.56));
      el.style.setProperty('--r', `${d * -14}deg`);
      el.style.setProperty('--o', String(d === 0 ? 1 : a === 1 ? 0.62 : 0.28));
      el.style.zIndex = String(10 - a);
    });
    const pack = packs[st.i];
    const price = effPrice(pack.price);
    const pr = pack.promo ? PROMO_BY_ID[pack.promo] : null;
    wrap.style.setProperty('--glow', pr ? pr.colors[1] : 'var(--acc)'); // set on the section so the backdrop, pack ring and bar share it
    clear(info);
    add(info,
      h('small', { class: 'pm-kicker' }, pr ? `${pr.name} · promo pack` : 'Featured pack'),
      h('h3', null, pack.name),
      h('p', { class: 'pm-dim' }, pack.desc),
      h('div', { class: 'pm-price' }, h('i', { class: 'pm-coin', 'aria-hidden': 'true' }), fmtNum(price)),
      h('div', { class: 'pm-btnrow' },
        h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => oddsModal(app, pack) }, 'View odds'),
        h('button', { class: 'pm-btn pm-btn--primary', disabled: app.ut.coins < price, onclick: () => buy(pack) }, 'Buy & open')));
    count.textContent = `${st.i + 1} / ${n}`;
    st.t = 0; bar.style.transform = 'scaleX(0)';
  }
  function go(k) { unzoom(); st.i = (k + packs.length) % packs.length; layout(); }
  const paused = () => st.held || st.hover || document.hidden;
  const wrap = h('section', { class: 'pm-show', 'aria-label': 'Featured packs', 'aria-roledescription': 'carousel',
    onmouseenter: () => { st.hover = true; wrap.classList.add('is-paused'); }, onmouseleave: () => { st.hover = false; wrap.classList.remove('is-paused'); unzoom(); },
    onkeydown: (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); go(st.i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(st.i - 1); } },
  },
  h('div', { class: 'pm-show-main' },
    h('button', { class: 'pm-show-nav', type: 'button', 'aria-label': 'Previous pack', onclick: () => go(st.i - 1) }, '‹'),
    stage,
    h('button', { class: 'pm-show-nav', type: 'button', 'aria-label': 'Next pack', onclick: () => go(st.i + 1) }, '›')),
  h('div', { class: 'pm-show-side' }, info, h('div', { class: 'pm-show-foot' }, count, h('span', { class: 'pm-show-track' }, bar), h('small', { class: 'pm-dim' }, 'Hold a pack to zoom in'))));
  // countdown only runs while not paused, so a hover never cuts the next pack's time short
  const STEP = 100, HOLD = 3500;
  const timer = reduced ? 0 : setInterval(() => {
    if (paused()) return;
    st.t = (st.t || 0) + STEP;
    bar.style.transform = `scaleX(${Math.min(1, st.t / HOLD)})`;
    if (st.t >= HOLD) go(st.i + 1);
  }, STEP);
  app.onCleanup(() => { clearInterval(timer); clearTimeout(zoomT); });
  layout();
  return wrap;
}

// ---------- SBC ----------
function sbcRewardArt(r = {}) {
  const pid = r.player || (r.promoPlayer ? UT.promoRewardPid(r.promoPlayer) : null);
  const p = pid ? getPlayer(pid) : null;
  if (p) return playerCard(p, { size: 'xs' });
  const pack = UT.PACK_BY_ID[r.pack || (r.packs || [])[0]];
  if (pack) return packArt(pack, 'sm');
  if (r.coins) return h('div', { class: 'pm-sbc-coins' }, h('i', { class: 'pm-coin' }), fmtNum(r.coins));
  return null;
}
function sbcListView() {
  const ui = { tab: 'challenges' };
  return {
    title: 'Squad Building Challenges', kicker: 'Ultimate Team', coins: true, topRight: tokenChip, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      if (s.vinson?.phase === 'locked' && !isOwner(app.online)) { main.append(h('p', { class: 'pm-warnline' }, 'The Vinson curse blocks SBCs.')); return; }
      const vault = UT.vaultPlayers(s);
      add(main, utTabs(app, 'sbc'), h('div', { class: 'pm-subtabs', role: 'tablist' },
        [['challenges', 'Challenges'], ['storage', `SBC storage${vault.length ? ` (${vault.length})` : ''}`]].map(([id, label]) => h('button', {
          class: `pm-chip ${ui.tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': ui.tab === id ? 'true' : 'false', 'data-sbctab': id, onclick: () => { ui.tab = id; app.refresh(); },
        }, label))));
      if (ui.tab === 'storage') {
        add(main, h('p', { class: 'pm-hint' }, `Untradeable duplicates wait here (max ${UT.VAULT_CAP}). SBC Auto-fill uses them first, so your club copies stay put.`));
        if (!vault.length) { add(main, h('p', { class: 'pm-empty' }, 'SBC storage is empty. Untradeable duplicates from packs and rewards land here, or send one from your Club.')); return; }
        const inClub = new Set(s.club);
        add(main, h('div', { class: 'pm-cardgrid' }, vault.map((p) => h('div', { class: 'pm-cardcell' },
          playerCard(p, { size: 'sm', onClick: () => playerModal(app, p, {
            extra: [['Where', 'SBC storage (untradeable)']],
            actions: [{ label: inClub.has(p.id) ? 'Already in your club' : 'Move to club', disabled: inClub.has(p.id), onClick: () => {
              if (UT.takeFromVault(s, p.id)) {
                s.untradeable = s.untradeable || [];
                if (!s.untradeable.includes(p.id)) s.untradeable.push(p.id); // stays untradeable
                persist(app); app.toast(`${p.name} moved to your club`, 'good'); app.refresh();
              }
            } }],
          }) }),
          cardMeta(p)))));
        return;
      }
      const list = UT.SBCS.filter((x) => !x.promo || UT.sbcAvailable(s, x) || s.sbc[x.id]);
      const groups = [...new Set(list.map((x) => x.group))];
      for (const g of groups) {
        add(main, h('h3', { class: 'pm-h' }, g), h('div', { class: 'pm-sbcgrid' }, list.filter((x) => x.group === g).map((sbc) => {
          const done = s.sbc[sbc.id] || 0;
          const avail = UT.sbcAvailable(s, sbc);
          const rt = rewardText(sbc.reward);
          return h('button', { class: `pm-sbc ${avail ? '' : 'is-done'}`, disabled: !avail, onclick: () => app.push(sbcDetailView(sbc.id)) },
            h('h4', { title: sbc.name }, sbc.name),
            sbc.repeatable || done ? h('div', { class: 'pm-sbc-tags' },
              sbc.repeatable ? h('span', null, 'Repeatable') : null,
              done ? h('span', { class: 'is-done' }, avail ? `Completed ×${done}` : '✓ Completed') : null) : null,
            h('div', { class: 'pm-sbc-head' },
              h('div', { class: 'pm-sbc-headt' },
                h('p', null, sbc.desc),
                h('ul', { class: 'pm-reqmini' }, sbc.reqs.filter((r) => r.t !== 'count').map((r) => { const [l, v] = reqParts(r); return h('li', null, h('span', null, l), v ? h('b', null, v) : null); }))),
              h('div', { class: 'pm-sbc-art', 'aria-hidden': 'true' }, sbcRewardArt(sbc.reward))),
            h('div', { class: 'pm-sbc-reward' }, h('span', null, 'Reward'), h('b', { title: rt }, rt)));
        })));
      }
    },
  };
}
const rewardText = (r) => M.rewardText(r);
const cap = (t) => (typeof t === 'string' && t ? t[0].toUpperCase() + t.slice(1) : '');
/** SBC requirement as a compact [label, value] row ("Team rating" · "Min. 86"). */
function reqParts(r) {
  const v = r.v;
  switch (r.t) {
    case 'count': return ['Players', String(v)];
    case 'maxTier': return ['Quality', v === 'bronze' ? 'All Bronze' : `Max. ${cap(v)}`];
    case 'minTier': return [`${cap(r.tier)} players`, `Min. ${v}`];
    case 'rating': return ['Team rating', `Min. ${v}`];
    case 'chem': return ['Chemistry', `Min. ${v}`];
    case 'sameLeague': return ['Same league', `Min. ${v}`];
    case 'sameNation': return ['Same nation', `Min. ${v}`];
    case 'sameClub': return ['Same club', `Min. ${v}`];
    case 'maxSameClub': return ['Same club', `Max. ${v}`];
    case 'rare': return ['Rare players', `Min. ${v}`];
    case 'nations': return ['Nations', `Min. ${v}`];
    default: return [UT.reqLabel(r), ''];
  }
}

export function sbcDetailView(id) {
  const sbc = UT.SBC_BY_ID[id];
  const local = { formation: '4-4-2', slots: new Array(11).fill(null) };
  return {
    title: sbc.name, kicker: 'SBC', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      if (s.vinson?.phase === 'locked' && !isOwner(app.online)) { main.append(h('p', { class: 'pm-warnline' }, 'The Vinson curse blocks SBCs.')); return; }
      const checklist = h('ul', { class: 'pm-checklist', 'aria-live': 'polite' });
      const submit = h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', disabled: true, onclick: doSubmit }, 'Submit');
      const inSquad = () => new Set(s.squad.slots.concat(s.squad.bench).filter(Boolean));
      const update = () => {
        const slots = local.slots.map((x) => (x ? getPlayer(x) : null));
        const ev = UT.evaluateSbc(sbc, local.formation, slots);
        clear(checklist);
        for (const c of ev.checks) checklist.appendChild(h('li', { class: c.ok ? 'ok' : 'no' }, h('i', { 'aria-hidden': 'true' }, c.ok ? '✓' : '✕'), h('span', null, c.label), h('b', null, String(c.cur))));
        submit.disabled = !ev.ok;
      };
      const ed = squadEditor({
        formation: local.formation, slots: local.slots, bench: null, getPlayer,
        pool: () => UT.clubPlayers(s),
        rowInfo: (p) => (inSquad().has(p.id) ? 'In active squad' : `QS ${fmtNum(quickSellValue(p))}`),
        onChange: (v) => { local.formation = v.formation; local.slots = v.slots; update(); },
        toolbar: [
          h('button', { class: 'pm-btn pm-btn--accent', onclick: () => { local.slots = UT.sbcAutoFill(s, sbc, local.formation); ed.set({ formation: local.formation, slots: local.slots }); update(); } }, 'Auto-fill'),
          h('button', { class: 'pm-btn pm-btn--ghost', onclick: () => { local.slots = new Array(11).fill(null); ed.set({ slots: local.slots }); update(); } }, 'Clear'),
        ],
      });
      async function doSubmit() {
        const inSq = local.slots.filter((x) => x && inSquad().has(x)).length;
        const ok = await confirmBox(app.root, 'Submit SBC', `The ${local.slots.filter(Boolean).length} players in this challenge will be exchanged${inSq ? ` (${inSq} from your active squad)` : ''}. Reward: ${rewardText(sbc.reward)}.`, 'Submit');
        if (!ok) return;
        const ev = UT.evaluateSbc(sbc, local.formation, local.slots.map((x) => (x ? getPlayer(x) : null)));
        if (!ev.ok) { app.toast('Requirements not met', 'bad'); return; }
        const slots = local.slots.slice();
        local.slots = new Array(11).fill(null);
        app.pop();
        try { M.rewardFlow(app, () => UT.submitSbc(s, sbc.id, local.formation, slots), 'SBC complete!'); } catch (e) { app.toast(e.message, 'bad'); }
      }
      add(main, h('div', { class: 'pm-sbcdetail' },
        h('section', { class: 'pm-panel pm-sbcreq' },
          h('p', null, sbc.desc), h('h3', null, 'Requirements'), checklist,
          h('div', { class: 'pm-sbc-reward' }, h('span', { class: 'pm-dim' }, 'Reward'), h('b', null, rewardText(sbc.reward))),
          submit, h('p', { class: 'pm-hint' }, 'Submitted players are removed from your club.')),
        ed.el));
      update();
    },
  };
}

// ---------- squad battles ----------
function battlesView() {
  return {
    title: 'Squad Battles', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const b = s.battles;
      const rank = UT.rankFor(b.points);
      const nextPts = rank.next ? rank.next[1] : b.points;
      const prevPts = UT.RANKS[rank.index][1];
      const pct = rank.next ? ((b.points - prevPts) / (nextPts - prevPts)) * 100 : 100;
      const opps = UT.battleOpponents(b.week);
      const canClaim = b.played >= UT.WEEK_MATCHES;
      const rw = UT.weeklyReward(rank.index);
      add(main, 
        h('section', { class: 'pm-rankcard' },
          h('div', { class: `pm-rankbadge r${Math.floor(rank.index / 3)}` }, rank.name.split(' ')[0][0], h('small', null, rank.name.split(' ')[1] || '★')),
          h('div', { class: 'pm-rankinfo' },
            h('div', { class: 'pm-kicker' }, `Week ${b.week} · ${b.played}/${UT.WEEK_MATCHES} matches`),
            h('h2', null, rank.name), h('div', { class: 'pm-progress' }, h('i', { style: { width: `${Math.min(100, pct)}%` } })),
            h('small', { class: 'pm-dim' }, rank.next ? `${b.points} pts · ${nextPts - b.points} to ${rank.next[0]}` : `${b.points} pts · Top rank!`),
            h('small', { class: 'pm-dim' }, `Weekly reward at this rank: ${fmtNum(rw.coins)} coins + ${UT.PACK_BY_ID[rw.pack].name}`)),
          h('div', { class: 'pm-rankside' },
            h('label', { class: 'pm-inline' }, h('span', { class: 'pm-dim' }, 'Half length'),
              select([[2, '2 min'], [3, '3 min'], [4, '4 min'], [6, '6 min']], app.settings.halfMinutes, (v) => { app.settings.halfMinutes = Number(v); app.saveSettings(); }, { 'aria-label': 'Half length' })),
            canClaim ? h('button', { class: 'pm-btn pm-btn--accent', onclick: () => { const r = UT.claimWeek(s); if (r) { persist(app); app.toast(`Week complete (${r.rank}): ${r.rewards.join(', ')}`, 'good'); app.refresh(); } } }, 'Claim weekly rewards') : null)),
        canClaim ? h('p', { class: 'pm-hint' }, 'Week complete! Claim your rewards to start the next week.') : null,
        ...UT.DIFFICULTIES.map((d) => h('section', { class: 'pm-section' },
          h('h3', { class: 'pm-h' }, DIFF_LABEL[d], h('span', { class: `pm-diff d-${d}` }, d === 'amateur' ? '×0.8' : d === 'pro' ? '×1.0' : d === 'world' ? '×1.3' : '×1.7')),
          h('div', { class: 'pm-oppgrid' }, opps.filter((o) => o.difficulty === d).map((o) => h('button', {
            class: 'pm-opp', disabled: canClaim, onclick: () => startBattle(app, o),
          }, frag(crestSVG({ id: o.id, name: o.name, short: o.team.short, colors: o.colors }, 'pm-crest')),
          h('div', null, h('b', null, o.name), h('small', { class: 'pm-dim' }, `${o.team.formation} · Rating ${o.rating}`)),
          h('span', { class: 'pm-opp-go', 'aria-hidden': 'true' }, '▶')))))),
        b.history.length ? h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, 'Recent results'),
          h('div', { class: 'pm-history' }, b.history.slice(0, 8).map((r) => h('div', { class: `pm-hrow o-${r.outcome}` }, h('b', null, r.outcome), h('span', null, `${r.gf}–${r.ga} vs ${r.opp}`), h('small', { class: 'pm-dim' }, `+${r.points} pts · +${fmtNum(r.coins)}`))))) : null,
      );
    },
  };
}

async function startBattle(app, opp) {
  const s = app.ut;
  const team = UT.utTeam(s);
  if (!team) { app.toast('Your starting XI is incomplete. Fill every slot in Squad first.', 'warn'); app.push(squadView()); return; }
  const ok = await confirmBox(app.root, `vs ${opp.name}`, `${DIFF_LABEL[opp.difficulty]} · Rating ${opp.rating}. Kick off with ${app.settings.halfMinutes}-minute halves?`, 'Kick off');
  if (!ok) return;
  const away = structuredClone(opp.team);
  away.kit = resolveKitClash(team.kit, away.kit, opp.awayKit);
  away.gkKit = gkKitFor(team.kit, away.kit, team.gkKit);
  const result = await app.playMatch(team, away, { halfMinutes: app.settings.halfMinutes, difficulty: opp.difficulty, userSide: 'home', mode: 'ut' });
  if (!result) return;
  const r = UT.applyBattleResult(s, opp, result, 'home');
  persist(app);
  app.afterMatch({ team, result, side: 'home', mode: 'squadbattles' });
  M.showMatchRewards(app, { coins: r.coins });
  app.push(resultView({
    title: 'Squad Battles', kicker: DIFF_LABEL[opp.difficulty], home: team, away, result, userSide: 'home',
    extra: h('section', { class: 'pm-rewards' }, h('div', null, h('span', { class: 'pm-dim' }, 'Coins'), h('b', null, `+${fmtNum(r.coins)}`)), h('div', null, h('span', { class: 'pm-dim' }, 'Points'), h('b', null, `+${r.points}`)), h('div', null, h('span', { class: 'pm-dim' }, 'Rank'), h('b', null, UT.rankFor(s.battles.points).name))),
    onContinue: (a) => a.pop(),
  }));
}


// dependencies handed to the promo hub (avoids a circular import of this module's internals)
const PROMO_DEPS = { playerModal, oddsModal, openPackFlow, sbcDetailView, rewardText: (r) => M.rewardText(r), objectivesHubView: (sec) => M.objectivesHubView(sec) };
