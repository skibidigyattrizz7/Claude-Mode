// Pitchside Ultimate Team screens.
import { h, clear, frag, modal, confirmBox, fmtNum, select, add } from './dom.js';
import { playerCard, psBadgeHtml } from './card.js';
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
import { tileIcon } from './icons.js';
import { giftsButton } from './giftsview.js';
import { swapsView } from './swapsview.js';
import { getConfig, effPrice } from './config.js';
import { promoHubView, promoTileSub } from './promoview.js';
import { PROMO_BY_ID } from '../core/promos.js';
import * as PM from '../core/pmarket.js';
import { mountStadium } from '../../ui/stadium.js';

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
          h('p', { class: 'pm-dim' }, 'You start with 10,000 coins, a starter squad and two welcome packs. All coins are earned by playing — no real money, ever.'),
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
      app.popTo((v) => v.utHome);
      if (id !== 'home') app.push(open[id]());
    },
  }, label, badge[id] ? h('span', { class: 'pm-dotbadge' }, badge[id]) : null)));
}

/** Swap-token balance chip, shown next to the coin chip on every UT section (view `topRight` hook). */
export function tokenChip(app) {
  const s = app.ut;
  if (!s) return null;
  return h('div', { class: 'pm-coins is-tokens', title: 'Swap tokens — spend them in the Token Store (Swaps)' },
    h('i', { class: 'pm-token', 'aria-hidden': 'true' }), h('span', { class: 'pm-coins-n' }, fmtNum(s.tokens || 0)), h('small', { class: 'pm-coins-src' }, 'Tokens'));
}

/** PlayStyle icons (PlayStyle+ ringed) + alternate positions, shown under cards in lists. */
export function cardMeta(p, extra = null) {
  const ps = (p.playstyles || []).slice().sort((a, b) => (b.plus ? 1 : 0) - (a.plus ? 1 : 0));
  return h('div', { class: 'pm-cardmeta' },
    h('span', { class: 'pm-cardmeta-pos', title: 'Positions' }, h('b', null, p.pos), (p.alt || []).length ? ` ${p.alt.join(' ')}` : ''),
    ps.length ? h('span', { class: 'pm-cardmeta-ps' }, frag(ps.map(psBadgeHtml).join(''))) : null,
    extra);
}

// ---------- home ----------
export function utHomeView() {
  return {
    title: 'Ultimate Team', kicker: 'Pitchside', coins: true, utHome: true, topRight: tokenChip, cls: 'pm-main--wide',
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
      const storeArt = h('div', { class: 'pm-art-store', style: { position: 'absolute', inset: '0' } }, (waiting.length ? waiting : [featured]).filter(Boolean).map((p) => packArt(p, 'md')));
      const nPacks = s.packs.length + (s.picks || []).length;
      const storeTile = hx('pm-hx--store', 'Store', nPacks ? `${nPacks} pack${nPacks > 1 ? 's' : ''} to open` : featured ? `${featured.name} · ${fmtNum(effPrice(featured.price))} coins` : 'Packs & Player Picks', () => app.push(storeView()), storeArt, nPacks ? String(nPacks) : null);

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
          h('div', { class: 'pm-clubhead-btns' }, giftsButton(app), adminBadge(app))),
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
const STAT_NAMES = [['pac', 'Pace'], ['sho', 'Shooting'], ['pas', 'Passing'], ['dri', 'Dribbling'], ['def', 'Defending'], ['phy', 'Physical']];
const GK_NAMES = [['div', 'Diving'], ['han', 'Handling'], ['kic', 'Kicking'], ['ref', 'Reflexes'], ['spd', 'Speed'], ['pos', 'Positioning']];
const stars = (n) => h('span', { class: 'pm-stars', 'aria-label': `${n} of 5` }, Array.from({ length: 5 }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
export function playerModal(app, p, { actions = [], extra = null } = {}) {
  const n = NATION_BY_CODE[p.nat];
  const c = clubById(p.club);
  const bornYear = new Date().getFullYear() - (Number(p.age) || 0);
  const bio = [
    ['Age', p.age], p.dob ? ['Date of birth', p.dob] : ['Born', `${bornYear}`],
    ['Nation', h('span', { class: 'pm-factrow' }, frag(flagSVG(p.nat, 'pm-flag pm-flag--xs')), n ? n.name : p.nat)],
    ['Club', h('span', { class: 'pm-factrow' }, frag(crestSVG(c || p.club, 'pm-crest pm-crest--xs')), c ? c.name : p.club)],
    ['League', leagueName(p.league)],
    ['Height', `${p.height} cm`], ['Weight', `${p.weight || 75} kg`], ['Preferred foot', p.foot === 'L' ? 'Left' : 'Right'],
    ['Weak foot', stars(p.wf)], ['Skill moves', stars(p.sm)], ['Work rates', `${p.wr[0]} / ${p.wr[1]}`],
    ['Card', p.special ? `${UT.SPECIAL_NAME[p.special] || p.special}${p.real ? ' · real player' : ''}` : `${p.tier[0].toUpperCase() + p.tier.slice(1)}${p.rare ? ' rare' : ''}`],
    ['Potential', p.pot],
  ];
  if (p.moment) bio.push(['Moment', p.moment]);
  if (p.upg) bio.push(['Upgrades', `${p.upg.level}/${p.upg.max} knockout rounds reached`]);
  if (extra) bio.push(...extra);
  const statRows = (names, obj) => names.map(([k, label]) => {
    const v = Number(obj[k]) || 0;
    return h('div', { class: 'pm-attr' }, h('span', null, label), h('b', { class: v >= 85 ? 'hi' : v >= 70 ? 'mid' : v < 50 ? 'lo' : '' }, v), h('i', { style: { '--v': `${v}%` } }));
  });
  const isGk = p.pos === 'GK';
  return modal(app.root, {
    title: p.name, wide: true, className: 'pm-pmodal',
    body: h('div', { class: 'pm-pdetail' },
      h('div', { class: 'pm-pdetail-card' }, playerCard(p, { size: 'md' }),
        h('div', { class: 'pm-posrow', 'aria-label': 'Positions' }, h('span', { class: 'on' }, p.pos), (p.alt || []).map((x) => h('span', null, x)))),
      h('div', { class: 'pm-pdetail-info' },
        h('section', null, h('h4', null, 'Attributes'), h('div', { class: 'pm-attrs' }, statRows(isGk ? GK_NAMES : STAT_NAMES, isGk ? p.gk : p.stats))),
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
      const autoBtn = h('button', { class: 'pm-btn pm-btn--accent', onclick: () => { UT.autoSquad(s, ed.get().formation); persist(app); ed.set(s.squad); app.toast('Best squad selected (rating + chemistry).', 'good'); } }, 'Auto-build best squad');
      const ed = squadEditor({
        formation: s.squad.formation, slots: s.squad.slots, bench: s.squad.bench,
        getPlayer, pool: () => UT.clubPlayers(s),
        onChange: (v) => { s.squad = v; OBJ.setFlag(s, 'squadEdited'); persist(app); },
        toolbar: [autoBtn], chemToggle: true,
        manager: { value: s.squad.manager || null, onChange: (m) => { s.squad.manager = m; persist(app); } },
        chemStyle: { value: s.squad.chemStyle || 'classic', onChange: (v) => { s.squad.chemStyle = v; persist(app); } },
      });
      add(main, ed.el);
    },
  };
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
        const sorters = { ovr: (a, b) => b.ovr - a.ovr, name: (a, b) => a.name.localeCompare(b.name), pos: (a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.ovr - a.ovr, value: (a, b) => utPrice(b) - utPrice(a), nation: (a, b) => a.nat.localeCompare(b.nat) || b.ovr - a.ovr, league: (a, b) => a.league.localeCompare(b.league) || b.ovr - a.ovr };
        list.sort(sorters[f.sort]);
        count.textContent = `${list.length} of ${s.club.length} players`;
        const inSquad = new Set(s.squad.slots.concat(s.squad.bench).filter(Boolean));
        for (const p of list) {
          const tag = inSquad.has(p.id) ? h('div', { class: 'pm-cardtag' }, s.squad.slots.includes(p.id) ? 'XI' : 'SUB') : (s.untradeable || []).includes(p.id) ? h('div', { class: 'pm-cardtag pm-cardtag--ut', title: 'Untradeable' }, 'UT') : null;
          const onTl = PM.onTransferList(s, p.id);
          grid.appendChild(h('div', { class: 'pm-cardcell' },
            playerCard(p, { size: 'sm', extra: tag, onClick: () => clubPlayerModal(app, p, draw) }),
            cardMeta(p, onTl ? h('span', { class: 'pm-cardmeta-tl', title: 'On your transfer list' }, 'TL') : null)));
        }
        if (!list.length) grid.appendChild(h('p', { class: 'pm-empty' }, 'No players match these filters.'));
      };
      const search = h('input', { class: 'pm-input', type: 'search', placeholder: 'Search name…', value: f.q, 'aria-label': 'Search club' });
      search.addEventListener('input', () => { f.q = search.value; draw(); });
      add(main, utTabs(app, 'club'),
        h('div', { class: 'pm-filterbar' },
          search,
          select([['ALL', 'All positions'], ['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['ATT', 'Attackers']], f.group, (v) => { f.group = v; draw(); }, { 'aria-label': 'Position' }),
          select([['', 'All tiers'], ['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze'], ['rare', 'Rare'], ['special', 'Special'], ['lotg', 'Legends of the Game']], f.tier, (v) => { f.tier = v; draw(); }, { 'aria-label': 'Tier' }),
          select([['', 'All leagues'], ...LEAGUES.map((l) => [l.id, l.name]), ['ICN', 'Legends of the Game'], ['LEG', 'Classics'], ['HER', 'Heroes']], f.league, (v) => { f.league = v; draw(); }, { 'aria-label': 'League' }),
          select([['ovr', 'Sort: Rating'], ['name', 'Sort: Name'], ['pos', 'Sort: Position'], ['value', 'Sort: Value'], ['nation', 'Sort: Nation'], ['league', 'Sort: League']], f.sort, (v) => { f.sort = v; draw(); }, { 'aria-label': 'Sort' }),
          count),
        grid);
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
    title: `AI Market — sell ${p.name}`,
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
    title: `${pack.name} — odds`, wide: true,
    body: h('div', null,
      h('p', { class: 'pm-dim' }, 'Every item is drawn independently using these published probabilities.'),
      h('div', { class: 'pm-tablewrap' }, h('table', { class: 'pm-table' },
        h('thead', null, h('tr', null, h('th', null, 'Category'), pack.slots.map((sl, i) => h('th', null, `Slot group ${i + 1} (${sl.n}×)`)), h('th', null, 'At least one'))),
        h('tbody', null, cats.map((c) => h('tr', null, h('td', null, UT.CATEGORIES[c].label), pack.slots.map((sl) => h('td', null, sl.odds[c] ? pct(sl.odds[c]) : '—')), h('td', null, h('b', null, pct(UT.packAtLeastOne(pack, c)))))))))),
    actions: [{ label: 'Close', primary: true }],
  });
}

export function openPackFlow(app, packType, onDone) {
  const s = app.ut;
  const pack = UT.PACK_BY_ID[packType];
  const items = UT.openPack(packType, UT.ownedSet(s), new Rng());
  s.stats.packsOpened++;
  persist(app);
  runPackOpening(app.root, {
    pack, items, getPlayer,
    sellValue: (p) => quickSellValue(p),
    onSend: (pid) => { UT.addToClub(s, pid); persist(app); },
    onVault: (pid) => { UT.sendToVault(s, pid); persist(app); },
    onSell: (pid) => { const v = quickSellValue(getPlayer(pid)); s.coins += v; persist(app); return v; },
    onDone: (sum) => { persist(app); app.refresh(); if (onDone) onDone(sum); },
  });
}

function storeView() {
  return {
    title: 'Store', kicker: 'Ultimate Team', coins: true, topRight: tokenChip, cls: 'pm-main--wide',
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
      const store = !cfg.packsInShop ? h('section', { class: 'pm-section' }, h('div', { class: 'pm-empty-state' }, h('p', null, 'Packs are temporarily disabled in the shop by the owner.'))) : h('section', { class: 'pm-section' },
        promoPacks.length ? h('h3', { class: 'pm-h' }, 'Promo packs', h('span', { class: 'pm-chip on' }, 'Live')) : null,
        promoPacks.length ? h('div', { class: 'pm-storegrid pm-storegrid--promo' }, promoPacks.map((pack) => storeItem(pack))) : null,
        h('h3', { class: 'pm-h' }, 'Buy packs'),
        h('div', { class: 'pm-storegrid' }, onSale.filter((p) => !p.promo).map((pack) => storeItem(pack))));
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
                onclick: async () => {
                  if (!(await confirmBox(app.root, 'Buy pack', `Buy ${pack.name} for ${fmtNum(price)} coins?`, 'Buy & open'))) return;
                  if (s.coins < price) return;
                  s.coins -= price; persist(app); app.renderTop(app.stack[app.stack.length - 1]);
                  openPackFlow(app, pack.id);
                },
              }, 'Buy & open'))));
      }
      add(main, utTabs(app, 'store'), M.picksRow(app), mine, store, h('p', { class: 'pm-hint' }, 'Coins are earned from matches, objectives, SBCs and selling players. There are no real-money purchases.'));
    },
  };
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
          return h('button', { class: `pm-sbc ${avail ? '' : 'is-done'}`, disabled: !avail, onclick: () => app.push(sbcDetailView(sbc.id)) },
            h('div', { class: 'pm-sbc-art', 'aria-hidden': 'true' }, sbcRewardArt(sbc.reward)),
            h('div', { class: 'pm-sbc-top' }, h('h4', null, sbc.name), sbc.repeatable ? h('span', { class: 'pm-tagmini' }, 'Repeatable') : null),
            h('p', null, sbc.desc),
            h('ul', { class: 'pm-reqmini' }, sbc.reqs.filter((r) => r.t !== 'count').map((r) => h('li', null, UT.reqLabel(r)))),
            h('div', { class: 'pm-sbc-reward' }, h('span', { class: 'pm-dim' }, 'Reward'), h('b', null, rewardText(sbc.reward))),
            done ? h('div', { class: 'pm-sbc-done' }, avail ? `Completed ×${done}` : '✓ Completed') : null);
        })));
      }
    },
  };
}
const rewardText = (r) => M.rewardText(r);

export function sbcDetailView(id) {
  const sbc = UT.SBC_BY_ID[id];
  const local = { formation: '4-4-2', slots: new Array(11).fill(null) };
  return {
    title: sbc.name, kicker: 'SBC', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
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
