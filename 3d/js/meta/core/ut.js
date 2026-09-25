// Pitchside Ultimate Team — pure logic (packs, club, squad, SBCs, objectives, squad battles, market). DOM-free.
import { Rng, clamp, hashStr } from './rng.js';
import { getDB, getPlayer, utPrice, quickSellValue, registerCard, registerLocalCard } from './players.js';
import { FORMATIONS } from './formations.js';
import { calcChemistry, teamRating } from './chemistry.js';
import { buildTeam, gkKitFor, bestLineup, autoBuildSquad, contrastColor } from './teams.js';
import { LEAGUES } from './data.js';
import { load, save } from './storage.js';
import { ensureTacticSets, activeTactics } from './tactics.js';
import { totwCards } from './totw.js';
import { weekNumber } from './calendar.js';
import { PROMOS, PROMO_BY_ID, promoPack, promoSbcs, isPromoLive } from './promos.js';

export const UT_KEY = 'ut';

// ---------- pack categories ----------
export const CATEGORIES = {
  bronze: { label: 'Bronze', test: (p) => !p.special && p.ovr < 65 && !p.rare },
  bronzeRare: { label: 'Rare Bronze', test: (p) => !p.special && p.ovr < 65 && p.rare },
  silver: { label: 'Silver', test: (p) => !p.special && p.ovr >= 65 && p.ovr < 75 && !p.rare },
  silverRare: { label: 'Rare Silver', test: (p) => !p.special && p.ovr >= 65 && p.ovr < 75 && p.rare },
  gold: { label: 'Gold 75–82', test: (p) => !p.special && p.ovr >= 75 && p.ovr <= 82 && !p.rare },
  goldRare: { label: 'Rare Gold 75–82', test: (p) => !p.special && p.ovr >= 75 && p.ovr <= 82 && p.rare },
  gold83: { label: 'Gold 83–85', test: (p) => !p.special && p.ovr >= 83 && p.ovr <= 85 },
  gold86: { label: 'Gold 86+', test: (p) => !p.special && p.ovr >= 86 },
  inform: { label: 'In-Form', test: (p) => p.special === 'inform' },
  hero: { label: 'Hero', test: (p) => p.special === 'hero' },
  legend: { label: 'Legend', test: (p) => p.special === 'legend' },
  totw: { label: 'Team of the Week', test: () => false },
  lotg: { label: 'Legend of the Game', test: (p) => p.special === 'lotg' },
};
// V3 promo categories (one per campaign)
for (const pr of PROMOS) CATEGORIES[`promo_${pr.id}`] = { label: pr.name, test: (p) => p.special === pr.id };

let _pools = null;
export function categoryPools() {
  if (_pools) return _pools;
  const db = getDB();
  _pools = {};
  for (const [k, c] of Object.entries(CATEGORIES)) _pools[k] = db.all.filter(c.test);
  _pools.totw = totwCards(weekNumber());
  _pools._week = weekNumber();
  return _pools;
}

export const PACKS = [
  {
    id: 'bronze', name: 'Bronze Pack', price: 750, look: 'bronze', desc: '12 bronze players incl. 1 rare',
    slots: [{ n: 11, odds: { bronze: 0.9, bronzeRare: 0.1 } }, { n: 1, odds: { bronzeRare: 0.95, silver: 0.05 } }],
  },
  {
    id: 'silver', name: 'Silver Pack', price: 2500, look: 'silver', desc: '12 silver players incl. 1 rare',
    slots: [{ n: 11, odds: { silver: 0.88, silverRare: 0.1, gold: 0.02 } }, { n: 1, odds: { silverRare: 0.9, gold: 0.08, goldRare: 0.02 } }],
  },
  {
    id: 'gold', name: 'Gold Pack', price: 7500, look: 'gold', desc: '12 players, mostly gold, 1 rare',
    slots: [{ n: 11, odds: { silver: 0.25, gold: 0.62, goldRare: 0.1, gold83: 0.025, inform: 0.004, hero: 0.001 } },
      { n: 1, odds: { goldRare: 0.8595, gold83: 0.1, gold86: 0.03, inform: 0.008, hero: 0.002, lotg: 0.0005 } }],
  },
  {
    id: 'premium', name: 'Premium Gold Pack', price: 15000, look: 'premium', desc: '12 gold players incl. 3 rares',
    slots: [{ n: 9, odds: { gold: 0.75, goldRare: 0.2, gold83: 0.04, inform: 0.008, hero: 0.002 } },
      { n: 3, odds: { goldRare: 0.797, gold83: 0.14, gold86: 0.04, inform: 0.015, hero: 0.004, legend: 0.001, lotg: 0.003 } }],
  },
  {
    id: 'rare', name: 'Rare Players Pack', price: 30000, look: 'rare', desc: '12 rare gold players',
    slots: [{ n: 12, odds: { goldRare: 0.776, gold83: 0.15, gold86: 0.045, inform: 0.02, hero: 0.004, legend: 0.001, lotg: 0.004 } }],
  },
  {
    id: 'totw', name: 'TOTW Pack', price: 25000, look: 'totw', desc: '1 guaranteed Team of the Week card + 6 golds',
    slots: [{ n: 1, odds: { totw: 1 } }, { n: 6, odds: { gold: 0.62, goldRare: 0.3, gold83: 0.08 } }],
  },

  {
    id: 'legend', name: 'Legend Pack', price: 250000, look: 'legend', desc: '1 guaranteed Legend + 4 rare golds',
    slots: [{ n: 1, odds: { legend: 1 } }, { n: 4, odds: { goldRare: 0.7, gold83: 0.25, gold86: 0.05 } }],
  },
  {
    id: 'lotg', name: 'Legend of the Game Pack', price: 200000, look: 'lotg', desc: '1 guaranteed Legend of the Game (real player) + 4 rare golds',
    slots: [{ n: 1, odds: { lotg: 1 } }, { n: 4, odds: { goldRare: 0.62, gold83: 0.3, gold86: 0.08 } }],
  },
];
// V3: one pack per promo campaign (sold in the Store while the campaign is live; always valid as a reward)
for (const pr of PROMOS) PACKS.push(promoPack(pr));
export const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));
/** Packs on sale right now (promo packs only while their campaign is live). */
export function storePacks(week = weekNumber()) { return PACKS.filter((p) => !p.promo || isPromoLive(p.promo, week)); }

/** Probability that a pack contains at least one item of the category (for the odds table). */
export function packAtLeastOne(pack, cat) {
  let none = 1;
  for (const s of pack.slots) none *= Math.pow(1 - (s.odds[cat] || 0), s.n);
  return 1 - none;
}

export function openPack(packId, ownedSet = new Set(), rng = new Rng()) {
  const pack = PACK_BY_ID[packId];
  const pools = categoryPools();
  if (pools._week !== weekNumber()) { pools.totw = totwCards(weekNumber()); pools._week = weekNumber(); }
  const items = [];
  const seen = new Set();
  for (const slot of pack.slots) {
    for (let i = 0; i < slot.n; i++) {
      const cat = rng.weighted(Object.entries(slot.odds));
      const pool = pools[cat].length ? pools[cat] : pools.gold;
      let p = rng.pick(pool);
      for (let t = 0; t < 4 && seen.has(p.id); t++) p = rng.pick(pool);
      items.push({ pid: p.id, cat, dup: ownedSet.has(p.id) || seen.has(p.id) });
      seen.add(p.id);
    }
  }
  items.sort((a, b) => itemScore(getPlayer(b.pid)) - itemScore(getPlayer(a.pid)));
  return items;
}
export function itemScore(p) {
  return p.ovr + ({ lotg: 45, legend: 30, hero: 20, objective: 15, inform: 10 }[p.special] || (PROMO_BY_ID[p.special] ? 35 : 0)) + (p.rare ? 0.5 : 0) + (p.evo ? 1 : 0);
}
/** 'bronze' | 'silver' | 'gold' | 'walkout' */
export function packFlare(items) {
  const best = getPlayer(items[0].pid);
  if (best.special || best.ovr >= 84) return 'walkout';
  return best.tier;
}
export function isWalkout(p) { return !!p.special || p.ovr >= 84; }

// ---------- state ----------
export function defaultSquad() {
  return { formation: '4-3-3', slots: new Array(11).fill(null), bench: new Array(7).fill(null) };
}

export function createUTState({ clubName = 'Pitchside FC', short = 'PFC', primary = '#19F5A4', secondary = '#0B0F1A' } = {}, rng = new Rng()) {
  const db = getDB();
  const lg = rng.pick(LEAGUES);
  const pickSome = (filter, n) => {
    const pool = db.players.filter(filter);
    const out = [];
    if (!pool.length) return out;
    for (let i = 0; i < n * 4 && out.length < n; i++) {
      const p = rng.pick(pool);
      if (!out.includes(p.id)) out.push(p.id);
    }
    return out;
  };
  const inLg = (p) => p.league === lg.id && !p.real;
  const band = (lo, hi) => (p) => p.ovr >= lo && p.ovr <= hi;
  const club = [
    ...pickSome((p) => p.pos === 'GK' && band(62, 70)(p) && inLg(p), 1),
    ...pickSome((p) => p.pos === 'GK' && band(55, 66)(p), 1),
    ...pickSome((p) => ['CB'].includes(p.pos) && band(63, 72)(p) && inLg(p), 3),
    ...pickSome((p) => ['LB', 'RB'].includes(p.pos) && band(62, 71)(p) && inLg(p), 3),
    ...pickSome((p) => ['CDM', 'CM'].includes(p.pos) && band(63, 72)(p) && inLg(p), 4),
    ...pickSome((p) => ['CAM', 'LM', 'RM'].includes(p.pos) && band(62, 71)(p), 3),
    ...pickSome((p) => ['LW', 'RW'].includes(p.pos) && band(62, 72)(p) && inLg(p), 2),
    ...pickSome((p) => ['ST'].includes(p.pos) && band(64, 72)(p) && inLg(p), 2),
    ...pickSome((p) => band(50, 64)(p), 4),
    ...pickSome((p) => ['ST', 'CM', 'CB'].includes(p.pos) && band(75, 78)(p) && inLg(p), 1),
  ];
  const state = {
    v: UT_VERSION, listed: [], untradeable: [], foreign: {}, admin: {}, clubName, short: short.slice(0, 3).toUpperCase(), kit: { primary, secondary },
    coins: 10000, club: [...new Set(club)], squad: defaultSquad(),
    packs: [{ type: 'premium', from: 'Welcome gift' }, { type: 'gold', from: 'Welcome gift' }],
    sbc: {}, obj: {},
    stats: { matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, packsOpened: 0, sbcDone: 0 },
    battles: { week: 1, points: 0, played: 0, wins: 0, history: [] },
    log: [],
  };
  autoSquad(state, '4-3-3');
  return state;
}

export const UT_VERSION = 2;
/** Upgrade older saves in place (v1 -> v2: player market, untradeables, foreign cards, admin flags). */
export function migrateUT(state) {
  if (!state || typeof state !== 'object') return null;
  if (!Array.isArray(state.club)) return null;
  state.listed = Array.isArray(state.listed) ? state.listed : [];
  state.untradeable = Array.isArray(state.untradeable) ? state.untradeable : [];
  state.foreign = state.foreign && typeof state.foreign === 'object' ? state.foreign : {};
  state.admin = state.admin && typeof state.admin === 'object' ? state.admin : {};
  state.packs = Array.isArray(state.packs) ? state.packs.filter((pk) => pk && PACK_BY_ID[pk.type]) : [];
  state.sbc = state.sbc || {}; state.obj = state.obj || {};
  state.picks = Array.isArray(state.picks) ? state.picks : [];
  state.items = state.items && typeof state.items === 'object' ? state.items : {};
  state.evolved = state.evolved && typeof state.evolved === 'object' ? state.evolved : {};
  for (const card of Object.values(state.evolved)) registerLocalCard(card);
  ensureTacticSets(state);
  for (const card of Object.values(state.foreign)) registerCard(card);
  state.club = state.club.filter((id) => getPlayer(id));
  if (!state.squad || !FORMATIONS[state.squad.formation]) state.squad = defaultSquad();
  const valid = (id) => (id && state.club.includes(id) ? id : null);
  state.squad.slots = Array.from({ length: 11 }, (_, i) => valid((state.squad.slots || [])[i]));
  state.squad.bench = Array.from({ length: 7 }, (_, i) => valid((state.squad.bench || [])[i]));
  state.v = UT_VERSION;
  return state;
}
export function loadUT() { try { return migrateUT(load(UT_KEY, null)); } catch { return null; } }
export function saveUT(state) { return save(UT_KEY, state); }

export function clubPlayers(state) { return state.club.map(getPlayer).filter(Boolean); }
export function ownedSet(state) { return new Set(state.club); }

export function autoSquad(state, formation = state.squad.formation) {
  const pool = clubPlayers(state);
  const res = autoBuildSquad(pool, formation);
  state.squad = {
    formation,
    slots: res.slots.map((p) => (p ? p.id : null)),
    bench: Array.from({ length: 7 }, (_, i) => (res.bench[i] ? res.bench[i].id : null)),
  };
  return state.squad;
}

export function squadSlots(state) { return state.squad.slots.map((id) => (id ? getPlayer(id) : null)); }
export function squadInfo(state) {
  const slots = squadSlots(state);
  const chem = calcChemistry(state.squad.formation, slots);
  return { slots, chem, rating: teamRating(slots), complete: slots.every(Boolean) };
}

export function removeFromClub(state, pid) {
  state.club = state.club.filter((x) => x !== pid);
  if (state.untradeable) state.untradeable = state.untradeable.filter((x) => x !== pid);
  state.squad.slots = state.squad.slots.map((x) => (x === pid ? null : x));
  state.squad.bench = state.squad.bench.map((x) => (x === pid ? null : x));
}
export function addToClub(state, pid) {
  if (!state.club.includes(pid)) state.club.push(pid);
}
export function quickSell(state, pid) {
  const p = getPlayer(pid);
  const v = quickSellValue(p);
  removeFromClub(state, pid);
  state.coins += v;
  return v;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
function fullKit(k, fb) {
  const c = (v, d) => (HEX.test(v || '') ? v.toUpperCase() : d);
  const primary = c(k && k.primary, fb.primary), secondary = c(k && k.secondary, fb.secondary);
  return { primary, secondary, number: c(k && k.number, contrastColor(primary, '#FFFFFF', '#111111')), shorts: c(k && k.shorts, fb.shorts), socks: c(k && k.socks, fb.socks) };
}
/** Home kit: custom kit editor values when set, otherwise derived from the club colours. */
export function utKit(state) {
  const { primary, secondary } = state.kit;
  const def = { primary, secondary, number: contrastColor(primary, '#FFFFFF', '#111111'), shorts: secondary, socks: primary };
  return state.kits && state.kits.home ? fullKit(state.kits.home, def) : def;
}
export function utAwayKit(state) {
  const { primary, secondary } = state.kit;
  const def = { primary: secondary, secondary: primary, number: contrastColor(secondary, '#FFFFFF', '#111111'), shorts: secondary, socks: secondary };
  return state.kits && state.kits.away ? fullKit(state.kits.away, def) : def;
}
export const BADGE_SHAPES = ['shield', 'round', 'diamond', 'hex', 'classic'];
/** Save club identity edits (name, short name, badge, kits). */
export function customiseClub(state, { clubName, short, badge, kits } = {}) {
  if (clubName && String(clubName).trim()) state.clubName = String(clubName).trim().slice(0, 24);
  if (short) state.short = (String(short).toUpperCase().replace(/[^A-Z]/g, '') + 'XXX').slice(0, 3);
  if (badge) {
    const c = (v, d) => (HEX.test(v || '') ? v : d);
    state.badge = { shape: BADGE_SHAPES.includes(badge.shape) ? badge.shape : 'shield', c1: c(badge.c1, state.kit.primary), c2: c(badge.c2, state.kit.secondary), c3: c(badge.c3, '#FFFFFF'), text: String(badge.text || state.short).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3), stripe: !!badge.stripe };
    state.kit = { primary: state.badge.c1, secondary: state.badge.c2 };
  }
  if (kits) state.kits = { home: fullKit(kits.home, utKit(state)), away: fullKit(kits.away, utAwayKit(state)) };
  return state;
}

/** Contract Team for the user's UT squad, or null when the XI is incomplete. */
export function utTeam(state) {
  if (!state) return null;
  const { slots, chem, complete } = squadInfo(state);
  if (!complete) return null;
  const bench = state.squad.bench.filter(Boolean).map(getPlayer).filter(Boolean);
  const kit = utKit(state);
  return buildTeam({
    id: 'UT-' + (hashStr(state.clubName) % 100000), name: state.clubName, short: state.short,
    kit, gkKit: gkKitFor(kit, utAwayKit(state)), formation: state.squad.formation,
    starters: slots, bench, chemistry: chem.scaled, tactics: activeTactics(state),
  });
}

// ---------- SBCs ----------
const TIER_RANK = { bronze: 0, silver: 1, gold: 2 };
export const SBCS = [
  { id: 'bronze-up', name: 'Bronze Upgrade', group: 'Upgrades', repeatable: true, desc: 'Trade 11 bronze players for a Silver pack.',
    reqs: [{ t: 'count', v: 11 }, { t: 'maxTier', v: 'bronze' }], reward: { pack: 'silver' } },
  { id: 'silver-up', name: 'Silver Upgrade', group: 'Upgrades', repeatable: true, desc: 'Trade 11 silver players for a Gold pack.',
    reqs: [{ t: 'count', v: 11 }, { t: 'minTier', tier: 'silver', v: 11 }, { t: 'maxTier', v: 'silver' }], reward: { pack: 'gold' } },
  { id: 'gold-up', name: 'Gold Upgrade', group: 'Upgrades', repeatable: true, desc: 'Eleven golds rated 75+ for a Premium Gold pack.',
    reqs: [{ t: 'count', v: 11 }, { t: 'minTier', tier: 'gold', v: 11 }, { t: 'rating', v: 76 }], reward: { pack: 'premium' } },
  { id: 'first-xi', name: 'The First XI', group: 'Foundations', desc: 'Show you can build a balanced team.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 64 }, { t: 'chem', v: 50 }], reward: { coins: 5000, pack: 'gold' } },
  { id: 'league-loyal', name: 'League Loyalty', group: 'Foundations', desc: 'Build around a single league.',
    reqs: [{ t: 'count', v: 11 }, { t: 'sameLeague', v: 7 }, { t: 'chem', v: 60 }], reward: { pack: 'premium' } },
  { id: 'nation-pride', name: 'Nation Pride', group: 'Foundations', desc: 'Six or more from one nation.',
    reqs: [{ t: 'count', v: 11 }, { t: 'sameNation', v: 6 }, { t: 'rating', v: 68 }], reward: { pack: 'rare' } },
  { id: 'hybrid-nations', name: 'Hybrid Nations', group: 'Advanced', desc: 'A cosmopolitan squad that still gels.',
    reqs: [{ t: 'count', v: 11 }, { t: 'nations', v: 6 }, { t: 'chem', v: 40 }, { t: 'rating', v: 72 }], reward: { pack: 'rare' } },
  { id: 'rare-collector', name: 'Rare Collector', group: 'Advanced', desc: 'Show off your shiny cards.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rare', v: 5 }, { t: 'rating', v: 72 }], reward: { coins: 15000 } },
  { id: 'club-spread', name: 'Club Spread', group: 'Advanced', desc: 'No more than 2 players per club.',
    reqs: [{ t: 'count', v: 11 }, { t: 'maxSameClub', v: 2 }, { t: 'rating', v: 74 }, { t: 'chem', v: 35 }], reward: { coins: 12000, pack: 'gold' } },
  { id: 'hero-call', name: 'Hero Call-Up', group: 'Player SBC', desc: 'Unlock a Hero card for your club.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 78 }, { t: 'chem', v: 65 }, { t: 'rare', v: 3 }], reward: { player: 'hr4' } },
  { id: 'legend-trial', name: 'Legendary Trial', group: 'Player SBC', desc: 'The ultimate test. Earn a Legend pack.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 83 }, { t: 'chem', v: 80 }], reward: { pack: 'legend' } },
  { id: 'pick-83', name: 'Player Pick: 83+', group: 'Player Picks', repeatable: true, desc: 'Choose 1 of 3 gold players rated 83+.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 79 }, { t: 'rare', v: 3 }], reward: { pick: { pool: 'gold83', n: 3, label: '83+ Player Pick' } } },
  { id: 'pick-lotg', name: 'Player Pick: Legend of the Game', group: 'Player Picks', desc: 'Choose 1 of 3 Legends of the Game.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 84 }, { t: 'chem', v: 75 }], reward: { pick: { pool: 'lotg', n: 3, label: 'LOTG Player Pick' } } },
  { id: 'posmod-sbc', name: 'Position Modifier', group: 'Upgrades', repeatable: true, desc: 'Earn a Position Modifier: add a new alternate position to a player.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 70 }], reward: { item: 'posmod', n: 1 } },
  { id: 'lotg-trial', name: 'Legend Trial', group: 'Legends of the Game', repeatable: true, desc: 'An elite squad earns a guaranteed Legend of the Game pack.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 83 }, { t: 'chem', v: 75 }, { t: 'rare', v: 6 }], reward: { pack: 'lotg' } },
  { id: 'lotg-salah', name: 'Legend: Mohamed Salah', group: 'Legends of the Game', desc: 'Bring the Egyptian King to your club.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 80 }, { t: 'chem', v: 70 }], reward: { player: 'rs_salah' } },
  { id: 'lotg-maldini', name: 'Legend: Paolo Maldini', group: 'Legends of the Game', desc: 'The complete defender. Build a rock-solid squad.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 85 }, { t: 'chem', v: 80 }], reward: { player: 'ic_maldini' } },
  { id: 'lotg-zidane', name: 'Legend: Zinedine Zidane', group: 'Legends of the Game', desc: 'Elegance on the ball. A world-class midfield is required.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 86 }, { t: 'chem', v: 85 }, { t: 'sameNation', v: 3 }], reward: { player: 'ic_zidane' } },
  { id: 'lotg-pele', name: 'Legend: Pelé', group: 'Legends of the Game', desc: 'The King. The hardest challenge in Pitchside.',
    reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 88 }, { t: 'chem', v: 90 }], reward: { player: 'ic_pele' } },
];
// V3 promo SBCs (available while the campaign is live)
for (const pr of PROMOS) SBCS.push(...promoSbcs(pr));
export const ITEM_NAMES = { posmod: 'Position Modifier' };
export const SPECIAL_NAME = { lotg: 'Legend of the Game', legend: 'Classic', hero: 'Hero', inform: 'In-Form', objective: 'Pathfinder' };
for (const pr of PROMOS) SPECIAL_NAME[pr.id] = pr.name;
export const SBC_BY_ID = Object.fromEntries(SBCS.map((s) => [s.id, s]));

export function reqLabel(r) {
  switch (r.t) {
    case 'count': return `Exactly ${r.v} players`;
    case 'maxTier': return r.v === 'bronze' ? 'All players Bronze' : `No player above ${r.v[0].toUpperCase() + r.v.slice(1)}`;
    case 'minTier': return `Min. ${r.v} ${r.tier[0].toUpperCase() + r.tier.slice(1)} players`;
    case 'rating': return `Team rating min. ${r.v}`;
    case 'chem': return `Team chemistry min. ${r.v}`;
    case 'sameLeague': return `Min. ${r.v} players from same league`;
    case 'sameNation': return `Min. ${r.v} players from same nation`;
    case 'sameClub': return `Min. ${r.v} players from same club`;
    case 'maxSameClub': return `Max. ${r.v} players from same club`;
    case 'rare': return `Min. ${r.v} rare players`;
    case 'nations': return `Min. ${r.v} different nations`;
    default: return r.t;
  }
}

function maxShared(players, key) {
  const m = new Map();
  for (const p of players) m.set(p[key], (m.get(p[key]) || 0) + 1);
  return Math.max(0, ...m.values());
}

/** @param slots array[11] of player objects or null */
export function evaluateSbc(sbc, formation, slots) {
  const players = slots.filter(Boolean);
  const chem = calcChemistry(formation, slots).scaled;
  const rating = teamRating(slots);
  const checks = sbc.reqs.map((r) => {
    let cur, ok;
    switch (r.t) {
      case 'count': cur = players.length; ok = cur === r.v; break;
      case 'maxTier': cur = players.filter((p) => TIER_RANK[p.tier] > TIER_RANK[r.v] || p.special).length; ok = cur === 0 && players.length > 0; cur = `${players.length - cur}/${players.length}`; break;
      case 'minTier': cur = players.filter((p) => TIER_RANK[p.tier] >= TIER_RANK[r.tier]).length; ok = cur >= r.v; break;
      case 'rating': cur = rating; ok = cur >= r.v; break;
      case 'chem': cur = chem; ok = cur >= r.v; break;
      case 'sameLeague': cur = maxShared(players, 'league'); ok = cur >= r.v; break;
      case 'sameNation': cur = maxShared(players, 'nat'); ok = cur >= r.v; break;
      case 'sameClub': cur = maxShared(players, 'club'); ok = cur >= r.v; break;
      case 'maxSameClub': cur = maxShared(players, 'club'); ok = cur <= r.v && players.length > 0; break;
      case 'rare': cur = players.filter((p) => p.rare).length; ok = cur >= r.v; break;
      case 'nations': cur = new Set(players.map((p) => p.nat)).size; ok = cur >= r.v; break;
      default: cur = '?'; ok = false;
    }
    return { label: reqLabel(r), ok, cur };
  });
  return { checks, ok: checks.every((c) => c.ok), rating, chem };
}

export function sbcAvailable(state, sbc) {
  if (sbc.promo && !isPromoLive(sbc.promo)) return false;
  return sbc.repeatable || !(state.sbc[sbc.id] > 0);
}
/** Promo SBC / objective reward -> card id (the campaign's featured cards). */
export function promoRewardPid(r) {
  const list = (getDB().promos || []).filter((p) => p.special === r.promo).sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1));
  if (!list.length) return null;
  return r.slot === 'sbc' ? list[Math.min(1, list.length - 1)].id : list[Math.floor(list.length / 2)].id;
}

/** Consume players and grant reward. Returns reward description or throws. */
export function submitSbc(state, sbcId, formation, slotIds) {
  const sbc = SBC_BY_ID[sbcId];
  if (!sbc || !sbcAvailable(state, sbc)) throw new Error('SBC not available');
  const slots = slotIds.map((id) => (id ? getPlayer(id) : null));
  if (slotIds.some((id) => id && !state.club.includes(id))) throw new Error('Player not in club');
  const ev = evaluateSbc(sbc, formation, slots);
  if (!ev.ok) throw new Error('Requirements not met');
  for (const id of slotIds) if (id) removeFromClub(state, id);
  state.sbc[sbcId] = (state.sbc[sbcId] || 0) + 1;
  state.stats.sbcDone++;
  return grantReward(state, sbc.reward, `SBC: ${sbc.name}`);
}

// ---------- player picks ----------
const PICK_POOLS = {
  gold83: { label: '83+ Gold', test: (p) => !p.special && p.ovr >= 83 },
  gold80: { label: '80+ Gold', test: (p) => !p.special && p.ovr >= 80 },
  lotg: { label: 'Legend of the Game', test: (p) => p.special === 'lotg' },
  lotg90: { label: '90+ Legend of the Game', test: (p) => p.special === 'lotg' && p.ovr >= 90 },
  inform: { label: 'In-Form', test: (p) => p.special === 'inform' && !p.totw },
};
for (const pr of PROMOS) PICK_POOLS[`promo_${pr.id}`] = { label: pr.name, test: (p) => p.special === pr.id };
/** Draw pick options (avoids owned cards where possible). */
export function drawPick(state, pool, n = 3, rng = new Rng()) {
  const all = pool === 'totw' ? totwCards(weekNumber()) : getDB().all.filter((PICK_POOLS[pool] || PICK_POOLS.gold83).test);
  const fresh = all.filter((p) => !state.club.includes(p.id));
  const src = fresh.length >= n ? fresh : all;
  const out = [];
  for (let i = 0; i < n * 8 && out.length < n; i++) { const p = rng.pick(src); if (p && !out.includes(p.id)) out.push(p.id); }
  return out;
}
export function addPick(state, pick, from = '', rng = new Rng()) {
  state.picks = state.picks || [];
  const id = `pk${Date.now().toString(36)}${Math.floor(rng.next() * 1e6).toString(36)}`;
  state.picks.push({ id, pool: pick.pool, label: pick.label || `${(PICK_POOLS[pick.pool] || {}).label || 'Player'} Pick`, from, options: drawPick(state, pick.pool, pick.n || 3, rng) });
  return id;
}
/** Choose one card of a pick. Duplicates are converted to coins. */
export function choosePick(state, pickId, pid) {
  const i = (state.picks || []).findIndex((x) => x.id === pickId);
  if (i < 0) throw new Error('Pick not found');
  const pk = state.picks[i];
  if (!pk.options.includes(pid)) throw new Error('Not an option');
  state.picks.splice(i, 1);
  if (state.club.includes(pid)) { const v = quickSellValue(getPlayer(pid)); state.coins += v; return { dup: true, coins: v }; }
  state.club.push(pid);
  if (!state.untradeable.includes(pid)) state.untradeable.push(pid);
  return { dup: false, pid };
}

export function grantReward(state, reward, from = '') {
  const out = [];
  if (reward.promoPlayer) { const pid = promoRewardPid(reward.promoPlayer); reward = { ...reward, promoPlayer: undefined, ...(pid ? { player: pid } : { pack: `promo_${reward.promoPlayer.promo}` }) }; }
  if (reward.pick) { addPick(state, reward.pick, from); out.push(reward.pick.label || 'Player Pick'); }
  if (reward.item) { state.items = state.items || {}; state.items[reward.item] = (state.items[reward.item] || 0) + (reward.n || 1); out.push(`${reward.n || 1}× ${ITEM_NAMES[reward.item] || reward.item}`); }
  if (reward.coins) { state.coins += reward.coins; out.push(`${reward.coins.toLocaleString()} coins`); }
  if (reward.pack) { state.packs.push({ type: reward.pack, from }); out.push(PACK_BY_ID[reward.pack].name); }
  if (reward.player) {
    const p = getPlayer(reward.player);
    if (state.club.includes(reward.player)) { state.coins += 20000; out.push('20,000 coins (duplicate reward)'); }
    else {
      state.club.push(reward.player);
      if (state.untradeable && !state.untradeable.includes(reward.player)) state.untradeable.push(reward.player);
      out.push(`${p.name} (${p.ovr} ${SPECIAL_NAME[p.special] || ''})`.trim());
    }
  }
  return out;
}

/** Fill an SBC from the club, preferring players outside the active squad, trying to satisfy every requirement. */
export function sbcAutoFill(state, sbc, formation) {
  const inSquad = new Set(state.squad.slots.concat(state.squad.bench).filter(Boolean));
  const maxTier = sbc.reqs.find((r) => r.t === 'maxTier');
  const minTier = sbc.reqs.find((r) => r.t === 'minTier');
  const tierOk = (p) => (!maxTier || (!p.special && TIER_RANK[p.tier] <= TIER_RANK[maxTier.v])) && (!minTier || TIER_RANK[p.tier] >= TIER_RANK[minTier.tier]);
  const all = clubPlayers(state).filter(tierOk);
  const reserves = all.filter((p) => !inSquad.has(p.id));
  const needsQuality = sbc.reqs.some((r) => ['rating', 'chem', 'sameLeague', 'sameNation', 'sameClub', 'rare', 'nations'].includes(r.t));
  let best = null;
  for (const pool of [reserves, all]) {
    if (pool.length < 11) continue;
    const tries = needsQuality
      ? [0.15, 0.5, 1.5].map((w) => autoBuildSquad(pool, formation, { chemWeight: w }).slots)
      : [bestLineup(pool.slice().sort((a, b) => a.ovr - b.ovr).slice(0, 30), formation, { benchSize: 0 }).slots];
    for (const slots of tries) {
      const ev = evaluateSbc(sbc, formation, slots);
      const met = ev.checks.filter((c) => c.ok).length;
      if (!best || met > best.met) best = { slots, met };
      if (ev.ok) return slots.map((p) => (p ? p.id : null));
    }
  }
  return best ? best.slots.map((p) => (p ? p.id : null)) : new Array(11).fill(null);
}

// ---------- objectives ----------
export const OBJECTIVES = [
  { id: 'play1', label: 'Play a Squad Battles match', stat: 'matches', target: 1, reward: { coins: 1000 } },
  { id: 'win1', label: 'Win a Squad Battles match', stat: 'wins', target: 1, reward: { coins: 1500 } },
  { id: 'play3', label: 'Play 3 matches', stat: 'matches', target: 3, reward: { pack: 'silver' } },
  { id: 'packs3', label: 'Open 3 packs', stat: 'packsOpened', target: 3, reward: { coins: 1500 } },
  { id: 'sbc1', label: 'Complete a Squad Building Challenge', stat: 'sbcDone', target: 1, reward: { coins: 2000 } },
  { id: 'goals10', label: 'Score 10 goals', stat: 'goals', target: 10, reward: { coins: 2500 } },
  { id: 'win5', label: 'Win 5 matches', stat: 'wins', target: 5, reward: { pack: 'gold' } },
  { id: 'sbc5', label: 'Complete 5 SBCs', stat: 'sbcDone', target: 5, reward: { pack: 'premium' } },
  { id: 'win15', label: 'Win 15 matches', stat: 'wins', target: 15, reward: { pack: 'rare' } },
  { id: 'goals50', label: 'Score 50 goals', stat: 'goals', target: 50, reward: { coins: 20000 } },
  { id: 'win10', label: 'Win 10 matches', stat: 'wins', target: 10, reward: { pick: { pool: 'gold83', n: 3, label: '83+ Player Pick' } } },
  { id: 'packs10', label: 'Open 10 packs', stat: 'packsOpened', target: 10, reward: { item: 'posmod', n: 1 } },
  { id: 'sbc10', label: 'Complete 10 SBCs', stat: 'sbcDone', target: 10, reward: { pick: { pool: 'lotg', n: 3, label: 'LOTG Player Pick' } } },
];
export function objectiveProgress(state, o) { return Math.min(o.target, state.stats[o.stat] || 0); }
export function claimObjective(state, id) {
  const o = OBJECTIVES.find((x) => x.id === id);
  if (!o || state.obj[id] || objectiveProgress(state, o) < o.target) return null;
  state.obj[id] = true;
  return grantReward(state, o.reward, `Objective: ${o.label}`);
}

// ---------- squad battles ----------
export const DIFFICULTIES = ['amateur', 'pro', 'world', 'legendary'];
const DIFF_TARGET = { amateur: 64, pro: 72, world: 79, legendary: 85 };
const DIFF_MULT = { amateur: 0.8, pro: 1, world: 1.3, legendary: 1.7 };
const DIFF_PTS = { amateur: 20, pro: 45, world: 75, legendary: 110 };
export const RANKS = [['Bronze 3', 0], ['Bronze 2', 80], ['Bronze 1', 160], ['Silver 3', 260], ['Silver 2', 360], ['Silver 1', 480], ['Gold 3', 620], ['Gold 2', 780], ['Gold 1', 960], ['Elite 3', 1160], ['Elite 2', 1380], ['Elite 1', 1620], ['Champion', 1900]];
export const WEEK_MATCHES = 10;
export function rankFor(points) {
  let r = RANKS[0], i = 0;
  RANKS.forEach((x, k) => { if (points >= x[1]) { r = x; i = k; } });
  return { name: r[0], index: i, next: RANKS[i + 1] || null };
}
export function weeklyReward(rankIndex) {
  const coins = 1500 + rankIndex * 1500;
  const pack = rankIndex >= 12 ? 'rare' : rankIndex >= 9 ? 'premium' : rankIndex >= 6 ? 'gold' : rankIndex >= 3 ? 'silver' : 'bronze';
  return { coins, pack };
}

const ADJ = ['Neon', 'Midnight', 'Crimson', 'Golden', 'Iron', 'Velvet', 'Thunder', 'Silver', 'Electric', 'Rapid', 'Cosmic', 'Phantom', 'Arctic', 'Solar', 'Jade', 'Obsidian'];
const NOUN = ['Strikers', 'Wolves', 'Falcons', 'Titans', 'Comets', 'Vipers', 'Dynamo', 'Rangers', 'Knights', 'Rebels', 'Sharks', 'Owls', 'Foxes', 'Hornets', 'Pilots', 'Lynx'];
const KIT_COLS = ['#E63946', '#1D3557', '#2A9D8F', '#F4A261', '#8338EC', '#FFBE0B', '#3A86FF', '#FB5607', '#06D6A0', '#EF476F', '#118AB2', '#073B4C', '#FFFFFF', '#111111', '#7B2CBF', '#80B918'];

/** Deterministic opponent list for a squad-battles week. */
export function battleOpponents(week) {
  const rng = new Rng(`sb-week-${week}`);
  const db = getDB();
  const out = [];
  const forms = Object.keys(FORMATIONS);
  DIFFICULTIES.forEach((diff) => {
    for (let k = 0; k < 3; k++) {
      const target = DIFF_TARGET[diff] + rng.int(-2, 2) + k;
      const pool = db.all.filter((p) => Math.abs(p.ovr - target) <= 4 && (!p.special || diff === 'legendary'));
      const picked = [];
      const want = { GK: 2, DEF: 7, MID: 7, ATT: 5 };
      const grp = (p) => (p.pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p.pos) ? 'DEF' : ['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(p.pos) ? 'MID' : 'ATT');
      for (const g of Object.keys(want)) {
        const gp = pool.filter((p) => grp(p) === g);
        for (let i = 0; i < want[g]; i++) picked.push(rng.pick(gp));
      }
      const uniq = [...new Map(picked.map((p) => [p.id, p])).values()];
      const formation = rng.pick(forms);
      const { slots, bench } = bestLineup(uniq, formation);
      const c1 = rng.pick(KIT_COLS);
      let c2 = rng.pick(KIT_COLS); while (c2 === c1) c2 = rng.pick(KIT_COLS);
      const name = `${rng.pick(ADJ)} ${rng.pick(NOUN)}`;
      const kit = { primary: c1, secondary: c2, number: contrastColor(c1), shorts: c2, socks: c1 };
      const away = { primary: c2, secondary: c1, number: contrastColor(c2), shorts: c1, socks: c2 };
      const id = `SB${week}-${out.length}`;
      const team = buildTeam({ id, name, short: name.split(' ').map((w) => w[0]).join('') + 'F', kit, gkKit: gkKitFor(kit, away), formation, starters: slots, bench, chemistry: rng.int(55, 100) });
      out.push({ id, name, difficulty: diff, rating: teamRating(slots), team, awayKit: away, colors: { primary: c1, secondary: c2 } });
    }
  });
  return out;
}

/** Apply a squad battles result. result = contract match result, userSide 'home'|'away'. */
export function applyBattleResult(state, opp, result, userSide = 'home') {
  const gf = userSide === 'home' ? result.homeGoals : result.awayGoals;
  const ga = userSide === 'home' ? result.awayGoals : result.homeGoals;
  const outcome = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
  const mult = DIFF_MULT[opp.difficulty] || 1;
  const coins = Math.round((300 + (outcome === 'W' ? 500 : outcome === 'D' ? 200 : 0) + gf * 40) * mult / 10) * 10;
  const base = DIFF_PTS[opp.difficulty] || 30;
  const points = Math.max(5, Math.round(base * (outcome === 'W' ? 1 : outcome === 'D' ? 0.4 : 0.15) + Math.max(0, gf - ga) * 5 + gf * 2));
  state.coins += coins;
  state.stats.matches++;
  state.stats.goals += gf;
  if (outcome === 'W') state.stats.wins++; else if (outcome === 'D') state.stats.draws++; else state.stats.losses++;
  const b = state.battles;
  b.points += points; b.played++; if (outcome === 'W') b.wins++;
  b.history.unshift({ opp: opp.name, diff: opp.difficulty, gf, ga, outcome, points, coins });
  b.history = b.history.slice(0, 20);
  return { outcome, gf, ga, coins, points };
}

export function claimWeek(state) {
  const b = state.battles;
  if (b.played < WEEK_MATCHES) return null;
  const r = rankFor(b.points);
  const rw = weeklyReward(r.index);
  const got = grantReward(state, rw, `Squad Battles week ${b.week} (${r.name})`);
  state.battles = { week: b.week + 1, points: 0, played: 0, wins: 0, history: [] };
  return { rank: r.name, rewards: got };
}

// ---------- transfer market (simulated) ----------
export function marketSearch({ pos = '', minOvr = 0, maxOvr = 99, tier = '', nat = '', league = '', name = '', maxPrice = 0 } = {}, seed = 0) {
  const db = getDB();
  const rng = new Rng(`mkt-${seed}-${pos}-${minOvr}-${maxOvr}-${tier}-${nat}-${league}-${name}-${maxPrice}`);
  const q = name.trim().toLowerCase();
  let pool = db.all.filter((p) => p.ovr >= minOvr && p.ovr <= maxOvr
    && (!pos || p.pos === pos) && (!nat || p.nat === nat) && (!league || p.league === league)
    && (!q || p.name.toLowerCase().includes(q) || p.last.toLowerCase().includes(q))
    && (!tier || (tier === 'special' ? !!p.special : tier === 'lotg' ? p.special === 'lotg' : tier === 'rare' ? p.rare && !p.special : p.tier === tier && !p.special)));
  // specials rarely listed
  pool = pool.filter((p) => p.special !== 'objective' && (!p.special || (tier && tier === p.special) || rng.chance(p.special === 'lotg' ? 0.2 : 0.35)));
  rng.shuffle(pool);
  const out = [];
  for (const p of pool) {
    const price = Math.round((utPrice(p) * rng.range(0.9, 1.3)) / 50) * 50;
    if (maxPrice && price > maxPrice) continue;
    out.push({ pid: p.id, price, mins: rng.int(1, 59) });
    if (out.length >= 24) break;
  }
  return out.sort((a, b) => a.price - b.price);
}

export function buyListing(state, listing) {
  if (state.club.includes(listing.pid)) throw new Error('You already own this player');
  if (state.coins < listing.price) throw new Error('Not enough coins');
  state.coins -= listing.price;
  state.club.push(listing.pid);
}

/** Try to sell a player on the simulated market. */
export function sellOnMarket(state, pid, price, rng = new Rng()) {
  const p = getPlayer(pid);
  const fair = utPrice(p);
  const chance = clamp(1.6 - price / fair, 0, 0.98);
  if (!rng.chance(chance)) return { sold: false };
  const received = Math.floor(price * 0.95);
  removeFromClub(state, pid);
  state.coins += received;
  return { sold: true, received };
}
