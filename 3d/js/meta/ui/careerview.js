// Career Mode screens.
import { h, clear, frag, modal, confirmBox, fmtNum, select, add } from './dom.js';
import { playerCard } from './card.js';
import { crestSVG, flagSVG } from './art.js';
import { squadEditor } from './squad.js';
import { resultView } from './app.js';
import { playerModal } from './utview.js';
import * as C from '../core/career.js';
import { LEAGUES, CLUBS, NATION_BY_CODE, POSITIONS } from '../core/data.js';
import { getDB } from '../core/players.js';
import { bestLineup } from '../core/teams.js';
import { teamRating } from '../core/chemistry.js';
import { tacticsEditor } from './tacticsview.js';
import { FORMATIONS } from '../core/formations.js';
import { reseat } from '../core/teams.js';

const persist = (app) => C.saveCareer(app.career);
const DIFFS = [['amateur', 'Amateur'], ['pro', 'Professional'], ['world', 'World Class'], ['legendary', 'Legendary']];
const clubObj = (s, id) => s.clubs[id] || { id, name: C.clubNameOf(s, id), short: '???', colors: { primary: '#445', secondary: '#99a' } };
const crest = (s, id, cls = 'pm-crest') => frag(crestSVG(clubObj(s, id), cls));
const stars = (r) => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');

// ---------- career menu ----------
export function careerHomeView() {
  return {
    title: 'Career Mode', kicker: 'Pitchside',
    render(main, app) {
      const slots = C.listSlots();
      add(main, 
        h('p', { class: 'pm-lead' }, 'Take charge of a club. Win the league, conquer the cup, develop youth — or survive the drop.'),
        h('div', { class: 'pm-slots' }, slots.map((sl) => h('div', { class: `pm-slotcard ${sl.empty ? 'is-empty' : ''}` },
          h('div', { class: 'pm-kicker' }, `Save slot ${sl.slot}`),
          sl.empty ? h('div', { class: 'pm-slot-empty' }, h('b', null, 'Empty'), h('button', { class: 'pm-btn pm-btn--primary', onclick: () => app.push(newCareerView(sl.slot)) }, 'New career'))
            : h('div', { class: 'pm-slot-full' },
              frag(crestSVG(sl.clubId, 'pm-crest pm-crest--lg')),
              h('div', null, h('b', null, sl.club), h('small', { class: 'pm-dim' }, `${sl.manager} · Season ${sl.season} (${sl.year}/${String((sl.year + 1) % 100).padStart(2, '0')})`), sl.saved ? h('small', { class: 'pm-dim' }, `Saved ${new Date(sl.saved).toLocaleString()}`) : null),
              h('div', { class: 'pm-btnrow' },
                h('button', { class: 'pm-btn pm-btn--primary', onclick: () => { const st = C.loadCareer(sl.slot); if (!st) { app.toast('Save could not be loaded', 'bad'); return; } app.career = st; app.push(careerHubView()); } }, 'Continue'),
                h('button', { class: 'pm-btn pm-btn--ghost', onclick: async () => { if (await confirmBox(app.root, 'Delete save', `Delete the career in slot ${sl.slot}? This cannot be undone.`, 'Delete', true)) { C.deleteCareer(sl.slot); app.refresh(); } } }, 'Delete'),
                h('button', { class: 'pm-btn pm-btn--ghost', onclick: () => app.push(newCareerView(sl.slot)) }, 'Overwrite')))))),
      );
    },
  };
}

const PRO_POS = ['ST', 'CF', 'LW', 'RW', 'CAM', 'CM', 'CDM', 'LB', 'RB', 'CB', 'GK'];
function newCareerView(slot) {
  const st = { mode: null, league: null, club: null, manager: 'Alex Morgan-Reyes', custom: { name: 'Pitchside Athletic', short: 'PAT', primary: '#0E7C66', secondary: '#F5C542' }, pro: { first: 'Alex', last: 'Rookie', pos: 'ST', nat: 'ENG', foot: 'R' } };
  return {
    title: 'New Career', kicker: `Slot ${slot}`, cls: 'pm-main--wide',
    render(main, app) {
      const db = getDB();
      if (!st.mode) {
        const modeBtn = (id, title, sub) => h('button', { class: 'pm-tile pm-tile--wide pm-careermode', onclick: () => { st.mode = id; app.refresh(); } }, h('div', { class: 'pm-tile-body' }, h('h2', null, title), h('p', null, sub)));
        add(main, h('h3', { class: 'pm-h' }, 'Choose a career'), h('div', { class: 'pm-tiles' },
          modeBtn('manager', 'Manager Career', 'Take over an existing club: transfers, tactics, youth, scouting network.'),
          modeBtn('custom', 'Create-a-Club', 'Your own name, badge colours and identity — replaces a club in a league.'),
          modeBtn('player', 'Player Career', 'Create a 17-year-old pro. Train, earn caps, request moves to bigger clubs.')));
        return;
      }
      if (!st.league) {
        add(main, h('h3', { class: 'pm-h' }, '1 · Choose a league'),
          h('div', { class: 'pm-leaguegrid' }, LEAGUES.map((l) => h('button', { class: 'pm-league', style: { '--lc': l.color }, onclick: () => { st.league = l.id; app.refresh(); } },
            h('div', { class: 'pm-league-flag' }, frag(flagSVG(l.country, 'pm-flag'))),
            h('b', null, l.name), h('small', { class: 'pm-dim' }, `${l.clubs.length} clubs · 2 divisions`), h('small', { class: 'pm-dim' }, `Second tier: ${l.tier2Name}`)))));
        return;
      }
      const lg = LEAGUES.find((l) => l.id === st.league);
      const clubs = CLUBS.filter((c) => c.league === lg.id);
      const ratingOf = (c) => teamRating(bestLineup(db.players.filter((p) => p.club === c.id), '4-3-3', { benchSize: 0 }).slots);
      const clubBtn = (c) => h('button', { class: `pm-clubpick ${st.club === c.id ? 'on' : ''}`, 'aria-pressed': st.club === c.id ? 'true' : 'false', onclick: () => { st.club = c.id; app.refresh(); } },
        frag(crestSVG(c, 'pm-crest')), h('div', null, h('b', null, c.name), h('small', { class: 'pm-dim' }, `${stars(c.rep)} · Rating ${ratingOf(c)}`)));
      add(main, 
        h('div', { class: 'pm-btnrow' }, h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => { st.league = null; st.club = null; app.refresh(); } }, '‹ Change league'), h('b', null, lg.name)),
        h('h3', { class: 'pm-h' }, st.mode === 'custom' ? '2 · Choose the club your new club replaces' : st.mode === 'player' ? '2 · Choose the club you join' : '2 · Choose your club'),
        h('div', { class: 'pm-kicker' }, lg.name),
        h('div', { class: 'pm-clubgrid' }, clubs.filter((c) => c.tier === 1).map(clubBtn)),
        h('div', { class: 'pm-kicker' }, lg.tier2Name),
        h('div', { class: 'pm-clubgrid' }, clubs.filter((c) => c.tier === 2).map(clubBtn)));
      if (st.club) {
        const name = h('input', { class: 'pm-input', value: st.manager, maxlength: '28', 'aria-label': 'Manager name' });
        name.addEventListener('input', () => { st.manager = name.value; });
        const inp = (obj, key, label, attrs = {}) => { const i = h('input', { class: 'pm-input', value: obj[key], 'aria-label': label, ...attrs }); i.addEventListener('input', () => { obj[key] = i.value; }); return h('label', null, h('span', { class: 'pm-dim' }, label), i); };
        const extra = st.mode === 'custom' ? h('div', { class: 'pm-form pm-ccform' },
          inp(st.custom, 'name', 'Club name', { maxlength: '28' }), inp(st.custom, 'short', 'Short (3)', { maxlength: '3' }),
          inp(st.custom, 'primary', 'Primary colour', { type: 'color' }), inp(st.custom, 'secondary', 'Secondary colour', { type: 'color' }))
          : st.mode === 'player' ? h('div', { class: 'pm-form pm-ccform' },
            inp(st.pro, 'first', 'First name', { maxlength: '16' }), inp(st.pro, 'last', 'Last name', { maxlength: '20' }),
            h('label', null, h('span', { class: 'pm-dim' }, 'Position'), select(PRO_POS, st.pro.pos, (v) => { st.pro.pos = v; })),
            h('label', null, h('span', { class: 'pm-dim' }, 'Nation'), select(NATIONS_LIST(), st.pro.nat, (v) => { st.pro.nat = v; })),
            h('label', null, h('span', { class: 'pm-dim' }, 'Preferred foot'), select([['R', 'Right'], ['L', 'Left']], st.pro.foot, (v) => { st.pro.foot = v; }))) : null;
        add(main, extra, h('section', { class: 'pm-panel pm-startbar' },
          st.mode === 'player' ? h('span', { class: 'pm-dim' }, '3 · Your pro starts at 62 OVR with 90 potential.') : h('label', null, h('span', { class: 'pm-dim' }, '3 · Manager name'), name),
          h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', onclick: () => {
            app.career = C.newCareer({ clubId: st.club, manager: (st.mode === 'player' ? `${st.pro.first} ${st.pro.last}` : st.manager || 'Manager').trim(), slot, custom: st.mode === 'custom' ? st.custom : null, pro: st.mode === 'player' ? st.pro : null });
            app.career.settings = { halfMinutes: app.settings.halfMinutes, difficulty: app.settings.difficulty };
            persist(app);
            app.replace(careerHubView());
          } }, 'Start career')));
      }
    },
  };
}

// ---------- hub ----------
const TABS = [['overview', 'Overview'], ['squad', 'Squad'], ['lineup', 'Lineup'], ['tactics', 'Tactics'], ['training', 'Training'], ['table', 'Table'], ['fixtures', 'Fixtures'], ['cup', 'Cup'], ['stats', 'Stats'], ['transfers', 'Transfers'], ['academy', 'Scouting'], ['club', 'Club']];
const PRO_TABS = [['pro', 'My Player'], ['overview', 'Overview'], ['table', 'Table'], ['fixtures', 'Fixtures'], ['cup', 'Cup'], ['stats', 'Stats'], ['club', 'Club']];
const NATIONS_LIST = () => getDB() && Object.values(NATION_BY_CODE).filter((n) => !n.extra).map((n) => [n.code, n.name]);

export function careerHubView() {
  const ui = { tab: 'overview', tier: null, md: null, search: null, filters: { pos: '', minOvr: 0, maxAge: 99, maxValue: 0, league: '', name: '' } };
  return {
    title: 'Career', kicker: 'Career Mode', cls: 'pm-main--wide',
    topRight: (app) => (app.career && app.career.mode !== 'player' ? h('div', { class: 'pm-budget' }, h('small', null, 'Budget'), h('b', null, C.money(app.career.budget))) : null),
    render(main, app) {
      const s = app.career;
      if (!s) { app.pop(); return; }
      this.title = s.clubs[s.userClub].name;
      this.kicker = `${s.mode === 'player' ? 'Player Career · ' : ''}${s.manager} · ${C.seasonLabel(s)}`;
      app.renderTop(this);
      const tabList = s.mode === 'player' ? PRO_TABS : TABS;
      if (!ui.init) { ui.init = true; ui.tab = tabList[0][0]; }
      if (!tabList.some((t) => t[0] === ui.tab)) ui.tab = tabList[0][0];
      add(main, nextCard(app, s));
      const tabs = h('div', { class: 'pm-tabs', role: 'tablist' }, tabList.map(([id, label]) => h('button', {
        class: `pm-tab ${ui.tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': ui.tab === id ? 'true' : 'false',
        onclick: () => { ui.tab = id; app.refresh(); },
      }, label, id === 'overview' && s.offers.length && s.mode !== 'player' ? h('span', { class: 'pm-dotbadge' }, s.offers.length) : null)));
      const body = h('div', { class: 'pm-tabbody', role: 'tabpanel' });
      add(main, tabs, body);
      ({ pro: tabPro, overview: tabOverview, squad: tabSquad, lineup: tabLineup, tactics: tabTactics, training: tabTraining, table: tabTable, fixtures: tabFixtures, cup: tabCup, stats: tabStats, transfers: tabTransfers, academy: tabAcademy, club: tabClub })[ui.tab](body, app, s, ui);
    },
  };
}

function nextCard(app, s) {
  if (s.phase === 'seasonEnd') {
    return h('section', { class: 'pm-next pm-next--end' },
      h('div', null, h('div', { class: 'pm-kicker' }, C.seasonLabel(s)), h('h2', null, 'Season complete'), h('p', { class: 'pm-dim' }, 'Review awards, objectives and promotion & relegation.')),
      h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', onclick: () => app.push(seasonEndView()) }, 'Season review'));
  }
  const ev = C.currentEvent(s);
  const uf = C.userFixture(s);
  const win = C.transferWindow(s);
  const label = ev.type === 'league' ? `${s.clubs[s.userClub].tier === 1 ? s.leagueName : s.tier2Name} · Matchday ${ev.md}` : `Cup · ${C.CUP_ROUNDS[ev.round]}`;
  const mdTotal = s.fixtures[s.clubs[s.userClub].tier].length;
  const leagueDone = ev.type === 'league' && ev.md > mdTotal;
  if (!uf) {
    return h('section', { class: 'pm-next' },
      h('div', null, h('div', { class: 'pm-kicker' }, label), h('h2', null, ev.type === 'cup' ? 'You are not involved in this round' : leagueDone ? 'Your league season is over' : 'No fixture'), win ? h('span', { class: 'pm-chip on' }, `${win} window open`) : null),
      h('div', { class: 'pm-btnrow' }, h('button', { class: 'pm-btn pm-btn--primary', 'data-autofocus': '1', onclick: () => { C.advance(s); persist(app); app.refresh(); } }, 'Continue'),
        h('button', { class: 'pm-btn', onclick: () => { C.simToNextUserMatch(s); persist(app); app.refresh(); } }, 'Sim to my next match')));
  }
  const f = uf.fixture;
  const oppId = uf.home ? f.a : f.h;
  const table = s.clubs[s.userClub].tier === s.clubs[oppId].tier ? C.leagueTable(s, s.clubs[s.userClub].tier) : null;
  const posOf = (id) => (table ? C.ordinal(table.findIndex((r) => r.club === id) + 1) : '');
  return h('section', { class: 'pm-next' },
    h('div', { class: 'pm-next-head' }, h('div', { class: 'pm-kicker' }, label), win ? h('span', { class: 'pm-chip on' }, `${win} window open`) : null),
    h('div', { class: 'pm-vs' },
      h('div', { class: 'pm-vs-team' }, crest(s, f.h, 'pm-crest pm-crest--lg'), h('b', null, s.clubs[f.h].name), h('small', { class: 'pm-dim' }, `${posOf(f.h)} · ${C.clubStrength(s, f.h)} OVR`)),
      h('div', { class: 'pm-vs-mid' }, 'VS', h('small', null, uf.home ? 'Home' : 'Away')),
      h('div', { class: 'pm-vs-team' }, crest(s, f.a, 'pm-crest pm-crest--lg'), h('b', null, s.clubs[f.a].name), h('small', { class: 'pm-dim' }, `${posOf(f.a)} · ${C.clubStrength(s, f.a)} OVR`))),
    h('div', { class: 'pm-btnrow pm-next-actions' },
      h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', 'data-autofocus': '1', onclick: () => playUserMatch(app, false) }, '▶ Play match'),
      h('button', { class: 'pm-btn pm-btn--lg', onclick: () => playUserMatch(app, true) }, 'Simulate'),
    ));
}

async function playUserMatch(app, simulate) {
  const s = app.career;
  const uf = C.userFixture(s);
  if (!uf) { C.advance(s); persist(app); app.refresh(); return; }
  const changes = C.ensureLineup(s);
  if (changes.length) app.toast(`Lineup adjusted: ${changes[0]}${changes.length > 1 ? ` (+${changes.length - 1})` : ''}`, 'warn');
  let summary;
  if (simulate) {
    summary = C.advance(s);
  } else {
    const { home, away } = C.matchTeams(s, uf.fixture.h, uf.fixture.a);
    const result = await app.playMatch(home, away, {
      halfMinutes: s.settings?.halfMinutes || app.settings.halfMinutes, difficulty: s.settings?.difficulty || app.settings.difficulty,
      userSide: uf.home ? 'home' : 'away', mode: 'career', knockout: uf.cup,
    });
    if (!result) return;
    summary = C.advance(s, result);
  }
  persist(app);
  const u = summary && summary.user;
  if (!u) { app.refresh(); return; }
  try { app.afterMatch({ team: uf.home ? u.home : u.away, result: u.result, side: uf.home ? 'home' : 'away', mode: 'career', ut: false }); } catch (e) { console.warn('[meta] career xp', e); }
  const f = u.fixture;
  const res = { ...u.result, homeGoals: f.hg, awayGoals: f.ag, pens: f.pens || null };
  app.push(resultView({
    title: u.ev.type === 'cup' ? `Cup · ${C.CUP_ROUNDS[u.ev.round]}` : `Matchday ${u.ev.md}`, kicker: C.seasonLabel(s),
    home: u.home, away: u.away, result: res, userSide: uf.home ? 'home' : 'away',
    extra: f.winner ? h('p', { class: 'pm-center' }, `${s.clubs[f.winner].name} advance${f.winner === s.userClub ? ' — into the next round!' : '.'}`) : null,
    onContinue: (a) => a.pop(),
  }));
}

// ---------- tabs ----------
function tabOverview(body, app, s, ui) {
  const club = s.clubs[s.userClub];
  const table = C.leagueTable(s, club.tier);
  const pos = table.findIndex((r) => r.club === s.userClub);
  const around = table.slice(Math.max(0, Math.min(pos - 2, table.length - 5)), Math.max(0, Math.min(pos - 2, table.length - 5)) + 5);
  const offers = s.offers.length && s.mode !== 'player' ? h('section', { class: 'pm-panel' }, h('h3', null, `Transfer offers (${s.offers.length})`),
    s.offers.map((o) => {
      const p = s.players[o.pid];
      if (!p) return null;
      return h('div', { class: 'pm-offer' },
        h('div', null, h('b', null, p.name), h('small', { class: 'pm-dim' }, `${p.pos} · ${p.ovr} OVR · value ${C.money(p.value)}`), h('small', null, `${o.from === 'ABROAD' ? 'A club abroad' : s.clubs[o.from].name} offer ${C.money(o.amount)}`)),
        h('div', { class: 'pm-btnrow' },
          h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: !C.transferWindow(s), onclick: () => { const r = C.respondOffer(s, o.id, true); persist(app); app.toast(r.message, 'good'); app.refresh(); } }, 'Accept'),
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => { const r = C.respondOffer(s, o.id, false); persist(app); app.toast(r.message); app.refresh(); } }, 'Reject')));
    }), C.transferWindow(s) ? null : h('p', { class: 'pm-hint' }, 'Offers can only be accepted while a transfer window is open.')) : null;
  add(body, h('div', { class: 'pm-two' },
    h('div', null,
      offers,
      s.mode === 'player' ? null : h('section', { class: 'pm-panel' }, h('h3', null, 'Board objectives'),
        h('ul', { class: 'pm-objs' }, s.objectives.map((o) => h('li', null, o.text))),
        h('div', { class: 'pm-conf' }, h('span', { class: 'pm-dim' }, 'Board confidence'), h('div', { class: 'pm-progress' }, h('i', { style: { width: `${s.boardConfidence}%` } })), h('b', null, `${Math.round(s.boardConfidence)}%`))),
      h('section', { class: 'pm-panel' }, h('h3', null, `${club.tier === 1 ? s.leagueName : s.tier2Name}`),
        miniTable(s, around, club.tier), h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => { ui.tab = 'table'; app.refresh(); } }, 'Full table ›'))),
    h('section', { class: 'pm-panel' }, h('h3', null, 'News'),
      h('ul', { class: 'pm-news' }, s.news.slice(0, 14).map((n) => h('li', { class: `k-${n.kind}` }, n.text))))));
}

function miniTable(s, rows, tier) {
  const full = C.leagueTable(s, tier);
  return h('table', { class: 'pm-table pm-table--compact' },
    h('thead', null, h('tr', null, h('th', null, '#'), h('th', { class: 'l' }, 'Club'), h('th', null, 'P'), h('th', null, 'GD'), h('th', null, 'Pts'))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.club === s.userClub ? 'me' : '' },
      h('td', null, full.findIndex((x) => x.club === r.club) + 1), h('td', { class: 'l' }, h('span', { class: 'pm-clubcell' }, crest(s, r.club, 'pm-crest pm-crest--xs'), s.clubs[r.club].name)), h('td', null, r.P), h('td', null, r.GD > 0 ? `+${r.GD}` : r.GD), h('td', null, h('b', null, r.Pts))))));
}

function careerPlayerModal(app, s, p) {
  const mine = p.club === s.userClub && s.mode !== 'player';
  const avg = C.avgRating(p);
  const extra = [
    ['Club', C.clubNameOf(s, p.club)], ['Value', C.money(p.value)], ['Wage', `${C.money(p.wage)}/wk`],
    ...(p.contract !== undefined ? [['Contract', `${p.contract} yr${p.contract === 1 ? '' : 's'} (to ${s.year + p.contract})`]] : []),
    ...(p.fitness !== undefined ? [['Fitness', `${Math.round(p.fitness)}%`], ['Sharpness', `${Math.round(p.sharp ?? 60)}%`], ['Morale', moraleLabel(p.morale)], ['Season', `${p.apps} apps · ${p.goals} goals · avg ${avg ? avg.toFixed(2) : '–'}`], ['Status', p.injury ? `Injured (${p.injury})` : p.listed ? 'Transfer listed' : 'Available']] : []),
  ];
  const actions = mine ? [
    { label: 'Renew contract', onClick: () => { const r = C.renewContract(s, p.id); persist(app); app.toast(r.message); app.refresh(); } },
    { label: p.listed ? 'Remove from list' : 'Transfer list', onClick: () => { if (p.listed) { p.listed = false; persist(app); app.toast(`${p.name} removed from the transfer list.`); } else { const r = C.listPlayer(s, p.id); persist(app); app.toast(r.message); } app.refresh(); } },
    { label: 'Release', danger: true, onClick: () => { setTimeout(async () => { if (await confirmBox(app.root, 'Release player', `Release ${p.name}? Severance will be paid from your budget.`, 'Release', true)) { const r = C.releasePlayer(s, p.id); persist(app); app.toast(r.message); app.refresh(); } }, 0); } },
  ] : s.mode === 'player' ? [] : [
    { label: 'Make bid', primary: true, disabled: !C.transferWindow(s), onClick: () => { setTimeout(() => bidModal(app, s, p), 0); } },
  ];
  playerModal(app, p, { extra, actions });
}
function moraleLabel(m) { return m >= 85 ? 'Very happy' : m >= 70 ? 'Happy' : m >= 50 ? 'Content' : m >= 35 ? 'Unhappy' : 'Very unhappy'; }

function bidModal(app, s, p, preset = null) {
  const ask = C.askingPrice(s, p);
  const input = h('input', { class: 'pm-input', type: 'number', min: '0', step: '50000', value: String(preset ?? Math.round(p.value / 50000) * 50000), 'aria-label': 'Bid amount' });
  modal(app.root, {
    title: `Bid for ${p.name}`,
    body: h('div', { class: 'pm-form' },
      h('p', null, `${p.age} · ${p.pos} · ${p.ovr} OVR (pot. ${p.pot}) · ${C.clubNameOf(s, p.club)}`),
      h('p', { class: 'pm-dim' }, `Estimated value ${C.money(p.value)}. Your budget: ${C.money(s.budget)}.`),
      h('label', null, h('span', null, 'Offer (€)'), input)),
    actions: [{ label: 'Cancel' }, { label: 'Submit bid', primary: true, onClick: () => {
      const amt = Math.max(0, Math.round(Number(input.value) || 0));
      const r = C.makeBid(s, p.id, amt);
      persist(app);
      if (r.status === 'counter') {
        setTimeout(() => modal(app.root, {
          title: 'Counter offer', body: h('p', null, r.message),
          actions: [{ label: 'Walk away' }, { label: `Pay ${C.money(r.counter)}`, primary: true, onClick: () => { const r2 = C.makeBid(s, p.id, r.counter); persist(app); app.toast(r2.message, r2.status === 'accepted' ? 'good' : 'warn'); app.refresh(); } }],
        }), 0);
      } else { app.toast(r.message, r.status === 'accepted' ? 'good' : r.status === 'error' ? 'bad' : 'warn'); if (r.status === 'accepted') app.refresh(); }
      void ask;
    } }],
  });
}

function tabSquad(body, app, s) {
  const ps = C.userPlayers(s).sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.ovr - a.ovr);
  const inXI = new Set(s.lineup.slots);
  add(body, 
    h('div', { class: 'pm-chiprow' },
      h('span', { class: 'pm-stat-chip' }, h('span', null, 'Players'), h('b', null, ps.length)),
      h('span', { class: 'pm-stat-chip' }, h('span', null, 'Wage bill'), h('b', null, `${C.money(C.wageBill(s))}/wk`)),
      h('span', { class: 'pm-stat-chip' }, h('span', null, 'Wage budget'), h('b', null, `${C.money(s.wageBudget)}/wk`))),
    h('div', { class: 'pm-tablewrap' }, h('table', { class: 'pm-table pm-table--squad' },
      h('thead', null, h('tr', null, ['#', 'Name', 'Pos', 'Age', 'OVR', 'POT', 'Fit', 'Morale', 'Form', 'Apps', 'G', 'Contract', 'Value'].map((c, i) => h('th', { class: `${i === 1 ? 'l' : ''} ${[5, 7, 8, 11, 12].includes(i) ? 'hide-sm' : ''}` }, c)))),
      h('tbody', null, ps.map((p) => {
        const formAvg = p.form.length ? p.form.reduce((a, b) => a + b, 0) / p.form.length : 0;
        return h('tr', { class: `${inXI.has(p.id) ? 'xi' : ''} ${p.injury ? 'inj' : ''}`, tabindex: '0', onclick: () => careerPlayerModal(app, s, p), onkeydown: (e) => { if (e.key === 'Enter') careerPlayerModal(app, s, p); } },
          h('td', null, p.number), h('td', { class: 'l' }, h('span', { class: 'pm-namecell' }, frag(flagSVG(p.nat, 'pm-flag pm-flag--xs')), p.name, p.injury ? h('span', { class: 'pm-inj', title: 'Injured' }, '✚') : null, p.listed ? h('span', { class: 'pm-tagmini' }, 'TL') : null, p.contract <= 1 ? h('span', { class: 'pm-tagmini warn', title: 'Contract expires this season' }, 'EXP') : null)),
          h('td', null, p.pos), h('td', null, p.age), h('td', null, h('b', { class: `ovr ${p.tier}` }, p.ovr)), h('td', { class: 'hide-sm' }, p.pot),
          h('td', null, h('span', { class: 'pm-fitbar' }, h('i', { style: { width: `${p.fitness}%`, background: p.fitness > 75 ? 'var(--good)' : p.fitness > 55 ? 'var(--warn)' : 'var(--bad)' } }))),
          h('td', { class: 'hide-sm' }, moraleLabel(p.morale)), h('td', { class: 'hide-sm' }, formAvg ? formAvg.toFixed(1) : '–'),
          h('td', null, p.apps), h('td', null, p.goals), h('td', { class: 'hide-sm' }, `${p.contract}y`), h('td', { class: 'hide-sm' }, C.money(p.value)));
      })))),
    h('p', { class: 'pm-hint' }, 'Select a player to renew, transfer list or release. EXP = contract ends this season.'));
}

function tabLineup(body, app, s) {
  const decorate = (p) => {
    const d = h('div', { class: 'pm-carddeco' }, h('span', { class: 'pm-fitbar' }, h('i', { style: { width: `${p.fitness}%`, background: p.fitness > 75 ? 'var(--good)' : p.fitness > 55 ? 'var(--warn)' : 'var(--bad)' } })));
    if (p.injury) d.appendChild(h('span', { class: 'pm-inj' }, '✚'));
    return d;
  };
  const ed = squadEditor({
    formation: s.lineup.formation, slots: s.lineup.slots, bench: s.lineup.bench,
    getPlayer: (id) => s.players[id], pool: () => C.userPlayers(s).filter((p) => !p.injury),
    onChange: (v) => { s.lineup = v; persist(app); },
    decorate, rowInfo: (p) => `Fit ${Math.round(p.fitness)}% · ${moraleLabel(p.morale)}`,
    toolbar: [h('button', { class: 'pm-btn pm-btn--accent', onclick: () => { C.autoLineup(s, ed.get().formation); persist(app); ed.set(s.lineup); app.toast('Best available XI selected.', 'good'); } }, 'Auto-pick XI')],
  });
  add(body, ed.el);
}

function tabTable(body, app, s, ui) {
  const tier = ui.tier || s.clubs[s.userClub].tier;
  const rows = C.leagueTable(s, tier);
  const n = rows.length;
  add(body, 
    h('div', { class: 'pm-chips' }, [[1, s.leagueName], [2, s.tier2Name]].map(([t, l]) => h('button', { class: `pm-chip ${tier === t ? 'on' : ''}`, onclick: () => { ui.tier = t; app.refresh(); } }, l))),
    h('div', { class: 'pm-tablewrap' }, h('table', { class: 'pm-table pm-table--league' },
      h('thead', null, h('tr', null, ['#', 'Club', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'Form'].map((c, i) => h('th', { class: `${i === 1 ? 'l' : ''} ${[6, 7].includes(i) ? 'hide-sm' : ''} ${i === 10 ? 'hide-xs' : ''}` }, c)))),
      h('tbody', null, rows.map((r, i) => h('tr', { class: `${r.club === s.userClub ? 'me' : ''} ${tier === 1 && i === 0 ? 'z-champ' : ''} ${tier === 1 && i >= n - 2 ? 'z-rel' : ''} ${tier === 2 && i < 2 ? 'z-pro' : ''}` },
        h('td', null, i + 1), h('td', { class: 'l' }, h('span', { class: 'pm-clubcell' }, crest(s, r.club, 'pm-crest pm-crest--xs'), s.clubs[r.club].name)),
        h('td', null, r.P), h('td', null, r.W), h('td', null, r.D), h('td', null, r.L), h('td', { class: 'hide-sm' }, r.GF), h('td', { class: 'hide-sm' }, r.GA), h('td', null, r.GD > 0 ? `+${r.GD}` : r.GD), h('td', null, h('b', null, r.Pts)),
        h('td', { class: 'hide-xs' }, h('span', { class: 'pm-formguide' }, r.form.map((x) => h('i', { class: `f-${x}` }, x))))))))),
    h('p', { class: 'pm-hint' }, tier === 1 ? 'Top: champions. Bottom two are relegated.' : 'Top two are promoted.'));
}

function tabFixtures(body, app, s, ui) {
  const tier = s.clubs[s.userClub].tier;
  const mds = s.fixtures[tier];
  const ev = C.currentEvent(s);
  const cur = ui.md || Math.min(mds.length, ev && ev.type === 'league' ? ev.md : (ev ? (s.calendar.slice(0, s.calIdx).filter((e) => e.type === 'league').pop()?.md || 1) : mds.length));
  const mine = [];
  mds.forEach((md) => md.forEach((f) => { if (f.h === s.userClub || f.a === s.userClub) mine.push(f); }));
  const fxRow = (f) => h('div', { class: `pm-fx ${f.h === s.userClub || f.a === s.userClub ? 'me' : ''}` },
    h('span', { class: 'pm-fx-t r' }, s.clubs[f.h].name, crest(s, f.h, 'pm-crest pm-crest--xs')),
    h('b', { class: 'pm-fx-s' }, f.played ? `${f.hg} – ${f.ag}` : 'vs'),
    h('span', { class: 'pm-fx-t' }, crest(s, f.a, 'pm-crest pm-crest--xs'), s.clubs[f.a].name));
  add(body, h('div', { class: 'pm-two' },
    h('section', { class: 'pm-panel' },
      h('div', { class: 'pm-mdnav' },
        h('button', { class: 'pm-btn pm-btn--sm', disabled: cur <= 1, 'aria-label': 'Previous matchday', onclick: () => { ui.md = cur - 1; app.refresh(); } }, '‹'),
        h('h3', null, `Matchday ${cur} / ${mds.length}`),
        h('button', { class: 'pm-btn pm-btn--sm', disabled: cur >= mds.length, 'aria-label': 'Next matchday', onclick: () => { ui.md = cur + 1; app.refresh(); } }, '›')),
      mds[cur - 1].map(fxRow)),
    h('section', { class: 'pm-panel' }, h('h3', null, 'My fixtures'),
      h('div', { class: 'pm-myfx' }, mine.map((f) => {
        const home = f.h === s.userClub;
        const opp = home ? f.a : f.h;
        const res = f.played ? ((home ? f.hg - f.ag : f.ag - f.hg) > 0 ? 'W' : (home ? f.hg - f.ag : f.ag - f.hg) < 0 ? 'L' : 'D') : '';
        return h('div', { class: `pm-myfx-row ${res ? 'o-' + res : ''}` }, h('small', { class: 'pm-dim' }, `MD${f.md}`), h('span', null, home ? 'H' : 'A'), h('span', { class: 'pm-clubcell' }, crest(s, opp, 'pm-crest pm-crest--xs'), s.clubs[opp].name), h('b', null, f.played ? `${home ? f.hg : f.ag}–${home ? f.ag : f.hg}` : '–'), res ? h('i', { class: `pm-res r-${res}` }, res) : h('i', null, ''));
      })))));
}

function tabCup(body, app, s) {
  const rounds = s.cup.rounds;
  add(body, 
    s.cup.winner ? h('section', { class: 'pm-panel pm-cupwin' }, crest(s, s.cup.winner, 'pm-crest pm-crest--lg'), h('div', null, h('div', { class: 'pm-kicker' }, 'Cup winners'), h('h2', null, s.clubs[s.cup.winner].name))) : null,
    h('div', { class: 'pm-bracket' }, C.CUP_ROUNDS.map((name, i) => h('section', { class: 'pm-panel pm-round' }, h('h3', null, name),
      rounds[i] ? rounds[i].map((f) => h('div', { class: `pm-tie ${f.h === s.userClub || f.a === s.userClub ? 'me' : ''}` },
        h('span', { class: f.winner === f.h ? 'w' : '' }, s.clubs[f.h].name), h('b', null, f.played ? `${f.hg}–${f.ag}${f.pens ? ` (${f.pens.home}–${f.pens.away}p)` : ''}` : 'vs'), h('span', { class: f.winner === f.a ? 'w' : '' }, s.clubs[f.a].name)))
        : h('p', { class: 'pm-dim' }, `Draw after matchday ${C.CUP_AFTER_MD[i - 1] || 0}`)))));
}

function tabStats(body, app, s) {
  const list = (title, ps, val) => h('section', { class: 'pm-panel' }, h('h3', null, title),
    ps.length ? h('ol', { class: 'pm-leaders' }, ps.map((p) => h('li', { class: p.club === s.userClub ? 'me' : '', onclick: () => careerPlayerModal(app, s, p) }, h('span', { class: 'pm-clubcell' }, crest(s, p.club, 'pm-crest pm-crest--xs'), p.name), h('small', { class: 'pm-dim' }, s.clubs[p.club]?.short || ''), h('b', null, val(p))))) : h('p', { class: 'pm-dim' }, 'No data yet.'));
  const all = Object.values(s.players).filter((p) => s.clubs[p.club]);
  const rated = (tier) => all.filter((p) => s.clubs[p.club].tier === tier && p.rN >= 3).sort((a, b) => C.avgRating(b) - C.avgRating(a)).slice(0, 10);
  add(body, h('div', { class: 'pm-grid3' },
    list(`Top scorers · ${s.leagueName}`, C.topScorers(s, 1), (p) => p.goals),
    list(`Top scorers · ${s.tier2Name}`, C.topScorers(s, 2), (p) => p.goals),
    list('Best average rating', rated(s.clubs[s.userClub].tier), (p) => C.avgRating(p).toFixed(2)),
    list('My squad · goals', C.userPlayers(s).filter((p) => p.goals).sort((a, b) => b.goals - a.goals).slice(0, 10), (p) => p.goals)));
}

function tabTransfers(body, app, s, ui) {
  const win = C.transferWindow(s);
  const f = ui.filters;
  const results = h('div', { class: 'pm-tablewrap' });
  const drawResults = () => {
    clear(results);
    if (!ui.search) { results.appendChild(h('p', { class: 'pm-empty' }, 'Use the scouting filters to find targets across every league.')); return; }
    if (!ui.search.length) { results.appendChild(h('p', { class: 'pm-empty' }, 'Your scouts found nobody matching those criteria.')); return; }
    results.appendChild(h('table', { class: 'pm-table pm-table--squad' },
      h('thead', null, h('tr', null, ['Name', 'Pos', 'Age', 'OVR', 'POT', 'Club', 'Value', ''].map((c, i) => h('th', { class: `${i === 0 || i === 5 ? 'l' : ''} ${[4, 5].includes(i) ? 'hide-sm' : ''}` }, c)))),
      h('tbody', null, ui.search.map((p) => h('tr', { tabindex: '0', onclick: () => careerPlayerModal(app, s, p) },
        h('td', { class: 'l' }, h('span', { class: 'pm-namecell' }, frag(flagSVG(p.nat, 'pm-flag pm-flag--xs')), p.name)),
        h('td', null, p.pos), h('td', null, p.age), h('td', null, h('b', { class: `ovr ${p.tier}` }, p.ovr)), h('td', { class: 'hide-sm' }, p.pot),
        h('td', { class: 'l hide-sm' }, C.clubNameOf(s, p.club)), h('td', null, C.money(p.value)),
        h('td', null, h('button', { class: 'pm-btn pm-btn--sm pm-btn--primary', disabled: !win, onclick: (e) => { e.stopPropagation(); bidModal(app, s, p); } }, 'Bid')))))));
  };
  const name = h('input', { class: 'pm-input', type: 'search', placeholder: 'Name', value: f.name, 'aria-label': 'Name' });
  name.addEventListener('input', () => { f.name = name.value; });
  const num = (key, label) => { const i = h('input', { class: 'pm-input pm-input--num', type: 'number', value: f[key] || '', placeholder: label, 'aria-label': label }); i.addEventListener('input', () => { f[key] = Number(i.value) || 0; }); return i; };
  const listed = C.userPlayers(s).filter((p) => p.listed);
  add(body, 
    h('section', { class: `pm-panel pm-window ${win ? 'open' : ''}` },
      h('div', null, h('div', { class: 'pm-kicker' }, 'Transfer window'), h('h3', null, win ? `${win} window OPEN` : 'Window closed'),
        h('small', { class: 'pm-dim' }, win ? 'Bids and sales are possible until the next matchday.' : `Winter window opens after matchday ${C.WINTER_AFTER_MD}; summer window opens at the start of each season.`)),
      h('div', { class: 'pm-chiprow' },
        h('span', { class: 'pm-stat-chip' }, h('span', null, 'Budget'), h('b', null, C.money(s.budget))),
        h('span', { class: 'pm-stat-chip' }, h('span', null, 'Wages'), h('b', null, `${C.money(C.wageBill(s))} / ${C.money(s.wageBudget)}`)))),
    listed.length ? h('p', { class: 'pm-hint' }, `Transfer listed: ${listed.map((p) => p.name).join(', ')}`) : null,
    h('form', { class: 'pm-filterbar', onsubmit: (e) => { e.preventDefault(); ui.search = C.searchPlayers(s, f); drawResults(); } },
      name,
      select([['', 'Any position'], ...POSITIONS.map((p) => [p, p])], f.pos, (v) => { f.pos = v; }, { 'aria-label': 'Position' }),
      select([['', 'Any league'], ...LEAGUES.map((l) => [l.id, l.name])], f.league, (v) => { f.league = v; }, { 'aria-label': 'League' }),
      num('minOvr', 'Min OVR'), num('maxAge', 'Max age'), num('maxValue', 'Max price €'),
      h('button', { class: 'pm-btn pm-btn--primary', type: 'submit' }, 'Scout')),
    results);
  drawResults();
}

function tabAcademy(body, app, s) {
  add(body,
    h('section', { class: 'pm-panel pm-window' },
      h('div', null, h('div', { class: 'pm-kicker' }, 'Youth academy'), h('h3', null, `${s.youth.length} prospect${s.youth.length === 1 ? '' : 's'} under observation`), h('small', { class: 'pm-dim' }, `Local academy scouting finds three prospects for ${C.money(C.YOUTH_SCOUT_COST)}. Budget: ${C.money(s.budget)}.`)),
      h('button', { class: 'pm-btn pm-btn--accent', disabled: s.budget < C.YOUTH_SCOUT_COST, onclick: () => { const r = C.scoutYouth(s); persist(app); app.toast(r.message, 'good'); app.refresh(); } }, 'Scout locally')),
    h('section', { class: 'pm-panel' }, h('h3', null, 'Scouting network'), h('p', { class: 'pm-dim' }, 'Send scouts abroad. Their reports give a potential range; pay for a full report to reveal the true ceiling.'),
      h('div', { class: 'pm-scoutgrid' }, C.SCOUT_REGIONS.map((r) => h('button', { class: 'pm-scoutreg', disabled: s.budget < r.cost, onclick: () => { const res = C.sendScouts(s, r.id); persist(app); app.toast(res.message, 'good'); app.refresh(); } },
        h('b', null, r.name), h('small', { class: 'pm-dim' }, C.money(r.cost)))))),
    s.youth.length ? h('div', { class: 'pm-youthgrid' }, s.youth.map((p) => {
      const [lo, hi] = p.potHidden && p.potRange ? p.potRange : p.potHidden === false ? [p.pot, p.pot] : [Math.max(p.ovr, p.pot - 4), Math.min(99, p.pot + 3)];
      return h('div', { class: 'pm-youth' }, playerCard(p, { size: 'sm', club: s.clubs[s.userClub] }),
        h('div', null, h('b', null, p.name), h('small', { class: 'pm-dim' }, `${p.age} · ${p.pos} · ${NATION_BY_CODE[p.nat]?.name}${p.scoutedIn ? ` · ${p.scoutedIn}` : ''}`), h('small', null, lo === hi ? `Potential ${lo} (full report)` : `Potential ${lo}–${hi}`),
          p.potHidden ? h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', disabled: s.budget < C.SCOUT_FURTHER_COST, onclick: () => { const r = C.scoutFurther(s, p.id); persist(app); app.toast(r.message, 'good'); app.refresh(); } }, `Full report · ${C.money(C.SCOUT_FURTHER_COST)}`) : null),
        h('div', { class: 'pm-btnrow' },
          h('button', { class: 'pm-btn pm-btn--primary pm-btn--sm', onclick: () => { const r = C.promoteYouth(s, p.id); persist(app); app.toast(r.message, 'good'); app.refresh(); } }, 'Promote'),
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => { C.releaseYouth(s, p.id); persist(app); app.refresh(); } }, 'Release')));
    })) : h('p', { class: 'pm-empty' }, 'No prospects yet.'));
}

function tabClub(body, app, s) {
  const club = s.clubs[s.userClub];
  const setg = s.settings || (s.settings = { halfMinutes: 3, difficulty: 'pro' });
  add(body, h('div', { class: 'pm-two' },
    h('section', { class: 'pm-panel' }, h('h3', null, 'Club'),
      h('div', { class: 'pm-clubhead' }, crest(s, s.userClub, 'pm-crest pm-crest--lg'), h('div', null, h('h2', null, club.name), h('small', { class: 'pm-dim' }, `${stars(club.rep)} reputation · ${club.tier === 1 ? s.leagueName : s.tier2Name}`))),
      h('h3', null, 'History'),
      s.history.length ? h('table', { class: 'pm-table pm-table--compact' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Season'), h('th', null, 'Division'), h('th', null, 'Pos'), h('th', null, 'Cup'), h('th', null, 'Objectives'))),
        h('tbody', null, s.history.map((x) => h('tr', null, h('td', { class: 'l' }, x.label), h('td', null, x.tier === 1 ? 'Tier 1' : 'Tier 2'), h('td', null, C.ordinal(x.pos)), h('td', null, x.cup ? '🏆' : '–'), h('td', null, `${x.objectivesMet}/3`))))) : h('p', { class: 'pm-dim' }, 'Your first season is under way.')),
    h('section', { class: 'pm-panel' }, h('h3', null, 'Match settings'),
      h('div', { class: 'pm-form' },
        h('label', null, h('span', null, 'Half length'), select([[2, '2 minutes'], [3, '3 minutes'], [4, '4 minutes'], [6, '6 minutes'], [10, '10 minutes']], setg.halfMinutes, (v) => { setg.halfMinutes = Number(v); persist(app); })),
        h('label', null, h('span', null, 'Difficulty'), select(DIFFS, setg.difficulty, (v) => { setg.difficulty = v; persist(app); }))),
      h('h3', null, 'Save'),
      h('p', { class: 'pm-dim' }, `Slot ${s.slot} · autosaves after every action.`),
      h('div', { class: 'pm-btnrow' },
        h('button', { class: 'pm-btn', onclick: () => { app.toast(persist(app) ? 'Career saved.' : 'Save failed (storage full?).', 'good'); } }, 'Save now'),
        h('button', { class: 'pm-btn pm-btn--ghost', onclick: () => { persist(app); app.career = null; app.pop(); } }, 'Exit to career menu')))));
}

function tabTactics(body, app, s) {
  C.ensureLineup(s);
  const ed = tacticsEditor({
    holder: s, root: app.root,
    xi: () => { const f = FORMATIONS[s.lineup.formation]; return s.lineup.slots.map((id, i) => { const p = s.players[id]; return p ? { id: p.id, name: p.name, pos: f.slots[i].pos, ovr: p.ovr } : null; }); },
    formation: () => s.lineup.formation,
    setFormation: (fm) => { const seats = reseat(s.lineup.slots.map((id) => s.players[id] || null), fm); s.lineup.formation = fm; s.lineup.slots = seats.map((p) => (p ? p.id : null)); C.ensureLineup(s); persist(app); },
    onSave: () => persist(app),
  });
  add(body, h('p', { class: 'pm-dim' }, 'The tactic marked “Used in matches” is sent with your team for played and simulated matches.'), ed.el);
}

function tabTraining(body, app, s) {
  const ps = C.userPlayers(s).sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.ovr - a.ovr);
  s.training = s.training || {};
  add(body, h('p', { class: 'pm-dim' }, 'Training plans apply after every matchday. Young players grow fastest; Sharpness boosts match form (up to +3% attributes), Recovery restores fitness.'),
    h('div', { class: 'pm-tablewrap' }, h('table', { class: 'pm-table' },
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Player'), h('th', null, 'Pos'), h('th', null, 'Age'), h('th', null, 'OVR'), h('th', null, 'POT'), h('th', null, 'Sharp'), h('th', { class: 'l' }, 'Plan'))),
      h('tbody', null, ps.map((p) => h('tr', null, h('td', { class: 'l' }, p.name), h('td', null, p.pos), h('td', null, p.age), h('td', null, h('b', { class: `ovr ${p.tier}` }, p.ovr)), h('td', null, p.pot),
        h('td', null, h('span', { class: 'pm-fitbar' }, h('i', { style: { width: `${p.sharp ?? 60}%`, background: 'var(--acc3)' } }))),
        h('td', { class: 'l' }, select(C.TRAINING_PLANS.map((x) => [x[0], x[1]]), s.training[p.id] || 'balanced', (v) => { C.setTraining(s, p.id, v); persist(app); }, { 'aria-label': `Training plan for ${p.name}` }))))))));
}

function tabPro(body, app, s) {
  const p = C.proPlayer(s);
  if (!p) { add(body, h('p', { class: 'pm-empty' }, 'Your player has left the game.')); return; }
  const ps = s.proStats || { caps: 0, intGoals: 0, ratings: [], transfers: [] };
  const avg = ps.ratings.length ? ps.ratings.reduce((a, b) => a + b, 0) / ps.ratings.length : 0;
  const plan = (s.training || {})[p.id] || 'balanced';
  add(body, h('div', { class: 'pm-two' },
    h('section', { class: 'pm-panel pm-pro' }, h('div', { class: 'pm-pdetail' }, playerCard(p, { size: 'md', club: s.clubs[p.club] }),
      h('div', null, h('h2', null, `${p.first} ${p.last}`), h('p', { class: 'pm-dim' }, `${p.age} · ${p.pos} · ${NATION_BY_CODE[p.nat]?.name} · #${p.number || '–'} at ${s.clubs[p.club].name}`),
        h('div', { class: 'pm-chiprow' },
          h('span', { class: 'pm-stat-chip' }, h('span', null, 'OVR'), h('b', null, p.ovr)), h('span', { class: 'pm-stat-chip' }, h('span', null, 'POT'), h('b', null, p.pot)),
          h('span', { class: 'pm-stat-chip' }, h('span', null, 'Apps'), h('b', null, p.apps)), h('span', { class: 'pm-stat-chip' }, h('span', null, 'Goals'), h('b', null, p.goals)),
          h('span', { class: 'pm-stat-chip' }, h('span', null, 'Avg'), h('b', null, avg ? avg.toFixed(2) : '–')), h('span', { class: 'pm-stat-chip' }, h('span', null, 'Caps'), h('b', null, `${ps.caps} (${ps.intGoals}g)`))),
        h('div', { class: 'pm-conf' }, h('span', { class: 'pm-dim' }, 'Sharpness'), h('div', { class: 'pm-progress' }, h('i', { style: { width: `${p.sharp ?? 60}%` } })), h('b', null, `${Math.round(p.sharp ?? 60)}%`)),
        h('div', { class: 'pm-conf' }, h('span', { class: 'pm-dim' }, 'Fitness'), h('div', { class: 'pm-progress' }, h('i', { style: { width: `${p.fitness}%` } })), h('b', null, `${Math.round(p.fitness)}%`)))),
      h('h3', null, 'Training focus'),
      h('div', { class: 'pm-chips' }, C.TRAINING_PLANS.map(([id, label, desc]) => h('button', { class: `pm-chip ${plan === id ? 'on' : ''}`, title: desc, onclick: () => { C.setTraining(s, p.id, id); persist(app); app.refresh(); } }, label))),
      h('h3', null, 'Career moves'),
      s.transferRequest ? h('p', null, `Transfer request accepted — joining ${s.clubs[s.transferRequest].name} when the window opens.`) : h('button', { class: 'pm-btn', onclick: () => { const r = C.requestTransfer(s); persist(app); app.toast(r.message); app.refresh(); } }, 'Request a transfer'),
      ps.transfers.length ? h('p', { class: 'pm-dim' }, `Moves: ${ps.transfers.map((t) => `${s.clubs[t.from]?.name || t.from} → ${s.clubs[t.to]?.name || t.to} (S${t.season})`).join(' · ')}`) : null),
    h('section', { class: 'pm-panel' }, h('h3', null, 'Recent match ratings'),
      ps.ratings.length ? h('div', { class: 'pm-formguide pm-proratings' }, ps.ratings.slice(-12).map((r) => h('i', { class: r >= 7.5 ? 'f-W' : r >= 6.3 ? 'f-D' : 'f-L', title: String(r) }, r.toFixed(1)))) : h('p', { class: 'pm-dim' }, 'Play your first match!'),
      h('h3', null, 'News'), h('ul', { class: 'pm-news' }, s.news.slice(0, 10).map((n) => h('li', { class: `k-${n.kind}` }, n.text))))));
}

// ---------- season end ----------
function seasonEndView() {
  return {
    title: 'Season Review', kicker: 'Career Mode', cls: 'pm-main--wide',
    render(main, app) {
      const s = app.career;
      const S = s.seasonSummary;
      if (!S) { app.pop(); return; }
      const award = (title, a, fmt) => h('div', { class: 'pm-award' }, h('div', { class: 'pm-kicker' }, title),
        a ? [crest(s, a.club, 'pm-crest'), h('b', null, a.name), h('small', { class: 'pm-dim' }, `${s.clubs[a.club]?.name || ''} · ${fmt(a)}`)] : h('p', { class: 'pm-dim' }, '—'));
      const nm = (id) => s.clubs[id]?.name || id;
      add(main, 
        h('section', { class: 'pm-seasonhero' },
          crest(s, S.champion, 'pm-crest pm-crest--xl'),
          h('div', null, h('div', { class: 'pm-kicker' }, `${S.label} · ${s.leagueName} champions`), h('h2', null, nm(S.champion)),
            h('p', null, `You finished ${C.ordinal(S.userPos)} in ${S.userTier === 1 ? s.leagueName : s.tier2Name}.`),
            S.cupWinner ? h('p', { class: 'pm-dim' }, `Cup winners: ${nm(S.cupWinner)}`) : null)),
        h('div', { class: 'pm-awards' },
          award('Top scorer', S.awards.topScorer, (a) => `${a.value} goals`),
          award('Player of the season', S.awards.pots, (a) => `avg ${a.rating}`),
          award('Young player', S.awards.young, (a) => `age ${a.age} · avg ${a.rating}`),
          award('Your best player', S.awards.userBest, (a) => `avg ${a.rating}`)),
        h('div', { class: 'pm-two' },
          s.mode === 'player' ? null : h('section', { class: 'pm-panel' }, h('h3', null, 'Board objectives'),
            h('ul', { class: 'pm-checklist' }, S.objectives.map((o) => h('li', { class: o.met ? 'ok' : 'no' }, h('i', null, o.met ? '✓' : '✕'), h('span', null, o.text), h('b', null, o.detail)))),
            h('div', { class: 'pm-conf' }, h('span', { class: 'pm-dim' }, 'Board confidence'), h('div', { class: 'pm-progress' }, h('i', { style: { width: `${S.boardConfidence}%` } })), h('b', null, `${Math.round(S.boardConfidence)}%`)),
            S.boardConfidence < 20 ? h('p', { class: 'pm-warn' }, 'The board is losing patience. Improve next season!') : null),
          h('section', { class: 'pm-panel' }, h('h3', null, 'Promotion & relegation'),
            h('p', null, h('b', null, 'Promoted: '), S.promoted.map(nm).join(', ')),
            h('p', null, h('b', null, 'Relegated: '), S.relegated.map(nm).join(', ')),
            S.promoted.includes(s.userClub) ? h('p', { class: 'pm-good' }, 'Congratulations — you have been promoted!') : null,
            S.relegated.includes(s.userClub) ? h('p', { class: 'pm-warn' }, 'Your club has been relegated.') : null,
            h('p', { class: 'pm-dim' }, 'Next season: players age, develop or decline, veterans may retire and regens appear. Expiring contracts will leave.'))),
        h('div', { class: 'pm-actions-row' }, h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', 'data-autofocus': '1', onclick: () => {
          C.startNewSeason(s); persist(app); app.pop(); app.toast(`Welcome to ${C.seasonLabel(s)}!`, 'good');
        } }, 'Start next season')));
    },
  };
}

