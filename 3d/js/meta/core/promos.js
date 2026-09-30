// V3 promo campaigns (FC-style): definitions, the weekly promo calendar and the deterministic promo card builder.
// DOM-free and independent of players.js (helpers are injected, like realplayers.js) so players.js can build the
// cards inside getDB(). Promo cards are special versions of real players (Icons, Stars and regulars) plus a few
// generated youngsters (Future Stars). Ids: `pr_<promo>_<baseId>` — stable across weeks, so saved cards stay valid.
import { Rng, clamp, hashStr } from './rng.js';
import { weekNumber } from './calendar.js';
import { genPhysique } from './physique.js';

// colours: [dark, main, light/ink]. `theme` is a stable id for the UI agent's pack-opening background/rig
// per campaign (see docs/META_API.md). `releaseWeek` (absolute calendar week, from calendar.js) is the first
// week a campaign may ever appear anywhere — omitted/1 means "already released" (the original 7 campaigns).
export const PROMOS = [
  { id: 'toty', name: 'Team of the Year', short: 'TOTY', tag: 'TEAM OF THE YEAR', colors: ['#040a26', '#2f6bff', '#dfe9ff'], range: [96, 98], price: 180000, theme: 'toty',
    desc: 'The best XI of the year: real stars boosted to 96–98.' },
  { id: 'tots', name: 'Team of the Season', short: 'TOTS', tag: 'TEAM OF THE SEASON', colors: ['#061a5c', '#1f4fd6', '#ffd66b'], range: [92, 97], price: 120000, theme: 'tots',
    desc: 'Season standouts across every league, rated 92–96.' },
  { id: 'futurestars', name: 'Future Stars', short: 'FUTURE STARS', tag: 'FUTURE STARS', colors: ['#050a2e', '#3d5afe', '#8ff3ff'], range: [82, 93], price: 70000, theme: 'futurestars',
    desc: 'The brightest young talents, boosted +4 to +7.' },
  { id: 'flashback', name: 'Heroes Flashback', short: 'FLASHBACK', tag: 'FLASHBACK', colors: ['#2b1f14', '#c9975a', '#fff1dc'], range: [88, 99], price: 160000, theme: 'flashback',
    desc: 'Legends relive their most famous season.' },
  { id: 'birthday', name: 'Ultimate Birthday', short: 'BIRTHDAY', tag: 'ULTIMATE BIRTHDAY', colors: ['#3a0620', '#ff4f9a', '#ffe0ef'], range: [84, 96], price: 90000, theme: 'birthday',
    desc: 'Party cards: +2 to +4 overall, +1 skill moves and +1 weak foot.' },
  { id: 'rttk', name: 'Road to the Knockouts', short: 'RTTK', tag: 'ROAD TO THE KNOCKOUTS', colors: ['#040b22', '#19d3a4', '#e2fff6'], range: [83, 94], price: 80000, theme: 'rttk',
    desc: 'Upgradable cards: +1 overall for every knockout round reached (max +4).' },
  { id: 'moments', name: 'Moments', short: 'MOMENTS', tag: 'MOMENTS', colors: ['#1d1d1d', '#f2f2f2', '#ffffff'], range: [86, 99], price: 110000, theme: 'moments',
    desc: 'Iconic moments turned into boosted cards.' },
  // V4 (owner request Sep 26): new campaigns, each with a genuine future release date and its own pack theme.
  { id: 'showdown', name: 'Rivals Showdown', short: 'SHOWDOWN', tag: 'RIVALS SHOWDOWN', colors: ['#3a0a0a', '#ff3b3b', '#ffd9d9'], range: [87, 96], price: 130000, theme: 'showdown',
    releaseWeek: 41, desc: 'Head-to-head rivals get matching boosted cards, +3 to +6.' },
  { id: 'oty', name: 'One to Watch', short: 'OTW', tag: 'ONE TO WATCH', colors: ['#062017', '#12c48b', '#daffee'], range: [82, 91], price: 60000, theme: 'oty',
    releaseWeek: 44, desc: 'A dynamic card that grows with the real player’s current form.' },
  { id: 'centurions', name: 'Centurions', short: 'CENT', tag: 'CENTURIONS', colors: ['#241100', '#e8a33d', '#fff2da'], range: [90, 97], price: 150000, theme: 'centurions',
    releaseWeek: 47, desc: 'Career milestone cards for real players closing in on a big number.' },
  // V5 (promo cards job): the wider FC-style calendar, generic names. Each has its own card design (CSS class
  // `sp-<id>` in meta.css), pack theme and a unique launch week — a campaign headlines the week it launches.
  { id: 'storm', name: 'Storm Surge', short: 'STORM', tag: 'STORM SURGE', colors: ['#05070d', '#7fd7ff', '#ffffff'], range: [84, 94], price: 100000, theme: 'storm',
    releaseWeek: 39, desc: 'Lightning-charged dynamic cards: +3 to +5 for players on a hot streak.' },
  { id: 'rulebenders', name: 'Rule Benders', short: 'BENDERS', tag: 'RULE BENDERS', colors: ['#43050f', '#ff2447', '#ffffff'], range: [82, 93], price: 90000, theme: 'rulebenders',
    releaseWeek: 40, desc: 'Cards that break the mould: +2 to +4, extra pace and +1 skill moves.' },
  { id: 'potm', name: 'Player of the Month', short: 'POTM', tag: 'PLAYER OF THE MONTH', colors: ['#0e1a2b', '#4f8fd9', '#f2f7ff'], range: [84, 94], price: 80000, theme: 'potm',
    releaseWeek: 42, desc: 'The month’s standout in each league, +2 to +4.' },
  { id: 'fright', name: 'Fright Night', short: 'FRIGHT', tag: 'FRIGHT NIGHT', colors: ['#0a0604', '#ff7a00', '#ffe0b8'], range: [83, 94], price: 95000, theme: 'fright',
    releaseWeek: 43, desc: 'Halloween scares: +3 to +5 cards that haunt the opposition.' },
  { id: 'roleswap', name: 'Role Swap', short: 'SWAP', tag: 'ROLE SWAP', colors: ['#061c33', '#16c7c7', '#e0ffff'], range: [80, 93], price: 90000, theme: 'roleswap',
    releaseWeek: 45, desc: 'Players reinvented in a brand-new position, +2 to +4.' },
  { id: 'halo', name: 'Hall of Heroes', short: 'HEROES', tag: 'HALL OF HEROES', colors: ['#0c0a14', '#e8c35a', '#fff5d6'], range: [88, 96], price: 140000, theme: 'halo',
    releaseWeek: 46, desc: 'Cult legends crowned with a golden halo, +2 to +3.' },
  { id: 'blackout', name: 'Blackout', short: 'BLACKOUT', tag: 'BLACKOUT', colors: ['#050505', '#ff1e56', '#ffffff'], range: [80, 92], price: 60000, theme: 'blackout',
    releaseWeek: 48, desc: 'Flash-sale week: cheap packs and +2 to +4 cards in black and neon.' },
  { id: 'champions', name: 'Champions Night', short: 'CHAMPIONS', tag: 'CHAMPIONS NIGHT', colors: ['#1a0838', '#7a36ff', '#ffd76a'], range: [88, 96], price: 130000, theme: 'champions',
    releaseWeek: 49, desc: 'Continental club-cup heroes, +3 to +5.' },
  { id: 'frost', name: 'Frost Wildcards', short: 'FROST', tag: 'FROST WILDCARDS', colors: ['#0d2a4a', '#8fd4ff', '#ffffff'], range: [81, 93], price: 90000, theme: 'frost',
    releaseWeek: 50, desc: 'Winter wildcards: +3 to +5 and a new secondary position.' },
  { id: 'yuletide', name: 'Yuletide Stars', short: 'YULETIDE', tag: 'YULETIDE STARS', colors: ['#07301b', '#d6202f', '#fff4e6'], range: [84, 95], price: 100000, theme: 'yuletide',
    releaseWeek: 51, desc: 'Festive gifts under the tree: actives and Icons, +2 to +4.' },
  { id: 'fantasy', name: 'Fantasy XI', short: 'FANTASY', tag: 'FANTASY XI', colors: ['#0d1400', '#c8ff00', '#f4ffd0'], range: [82, 93], price: 85000, theme: 'fantasy',
    releaseWeek: 52, desc: 'Fantasy-league favourites in radioactive neon, +2 to +4.' },
  { id: 'wildfire', name: 'Wildfire', short: 'WILDFIRE', tag: 'WILDFIRE', colors: ['#2a0600', '#ff5a1f', '#ffd27a'], range: [81, 93], price: 85000, theme: 'wildfire',
    releaseWeek: 54, desc: 'Young players spreading like wildfire, +3 to +5.' },
  { id: 'finalchapter', name: 'Final Chapter', short: 'FINAL', tag: 'FINAL CHAPTER', colors: ['#141414', '#a8977a', '#f3e6c9'], range: [83, 95], price: 110000, theme: 'finalchapter',
    releaseWeek: 72, desc: 'A farewell to veterans writing the last pages of their careers, +3 to +5.' },
  { id: 'fiesta', name: 'Summer Fiesta', short: 'FIESTA', tag: 'SUMMER FIESTA', colors: ['#2a0a4a', '#ff2d95', '#ffd1ec'], range: [85, 99], price: 120000, theme: 'fiesta',
    releaseWeek: 75, desc: 'The end-of-season party: favourites and Icons, +2 to +4 and +1 weak foot.' },
  // V5 — the Global Cup: a World-Cup-like tournament set, one campaign a week (maroon player / red path /
  // teal star / gold hero / purple road / yellow stories / holographic phenoms / white-gold Icons).
  { id: 'cupplayer', name: 'Global Cup', short: 'GLOBAL CUP', tag: 'GLOBAL CUP', colors: ['#3a0716', '#9c1d3f', '#ffe3ea'], range: [80, 94], price: 70000, theme: 'cupplayer', set: 'cup',
    releaseWeek: 57, desc: 'The tournament kicks off: national-team favourites, +2 to +3.' },
  { id: 'roadtocup', name: 'Road to the Cup', short: 'ROAD TO CUP', tag: 'ROAD TO THE CUP', colors: ['#1d0845', '#7b2ff7', '#ffd76a'], range: [80, 93], price: 75000, theme: 'roadtocup', set: 'cup',
    releaseWeek: 58, desc: 'Players who carried their nation through qualifying, +2 to +4.' },
  { id: 'cupstories', name: 'Cup Stories', short: 'STORIES', tag: 'CUP STORIES', colors: ['#3a2a00', '#ffc21a', '#fff6d1'], range: [82, 94], price: 85000, theme: 'cupstories', set: 'cup',
    releaseWeek: 59, desc: 'Remarkable tournament tales retold, +2 to +4.' },
  { id: 'cupstar', name: 'Cup Stars', short: 'CUP STARS', tag: 'CUP STARS', colors: ['#032a2c', '#10b5a8', '#dcfffb'], range: [82, 94], price: 90000, theme: 'cupstar', set: 'cup',
    releaseWeek: 60, desc: 'The breakout stars of the group stage, +3 to +5.' },
  { id: 'gloryroad', name: 'Path of Glory', short: 'GLORY', tag: 'PATH OF GLORY', colors: ['#3a0508', '#e11d2e', '#ffe1e3'], range: [80, 94], price: 90000, theme: 'gloryroad', set: 'cup',
    releaseWeek: 61, desc: 'Upgradable: +1 overall for every round the nation survives (max +4).' },
  { id: 'cupicon', name: 'Global Cup Icons', short: 'CUP ICONS', tag: 'GLOBAL CUP ICON', colors: ['#5a4108', '#e9dcc0', '#fffaf0'], range: [87, 96], price: 170000, theme: 'cupicon', set: 'cup',
    releaseWeek: 62, desc: 'Icons in their tournament prime, +1 to +2.' },
  { id: 'cuphero', name: 'Global Cup Heroes', short: 'CUP HEROES', tag: 'GLOBAL CUP HERO', colors: ['#2e1a02', '#e0a526', '#fff1c9'], range: [86, 93], price: 120000, theme: 'cuphero', set: 'cup',
    releaseWeek: 63, desc: 'Cult tournament heroes in copper and gold, +2 to +3.' },
  { id: 'phenoms', name: 'Cup Phenoms', short: 'PHENOMS', tag: 'CUP PHENOMS', colors: ['#2a2350', '#9ea8ff', '#ffffff'], range: [80, 93], price: 80000, theme: 'phenoms', set: 'cup',
    releaseWeek: 64, desc: 'Holographic cards for the tournament’s teenage sensations, +4 to +6.' },
];
export const PROMO_BY_ID = Object.fromEntries(PROMOS.map((p) => [p.id, p]));
export const PROMO_IDS = PROMOS.map((p) => p.id);
export const isPromoSpecial = (sp) => !!PROMO_BY_ID[sp];
export const promoOf = (p) => (p && PROMO_BY_ID[p.special]) || null;
/** Has this campaign's release week arrived? (true for the original campaigns, which have none set). */
export function isPromoReleased(id, week = weekNumber()) {
  const pr = PROMO_BY_ID[id];
  return !!pr && week >= (pr.releaseWeek || 1);
}
/** True when a card is safe to show anywhere: not a promo special, or its campaign has released. */
export function isCardReleased(p, week = weekNumber()) { return !isPromoSpecial(p && p.special) || isPromoReleased(p.special, week); }

// ---------- calendar ----------
// Weeks before ROTATION_V5 keep the headline they historically had (saved weekly objectives stay valid): a
// seeded shuffle of the original 10 campaigns per cycle.
const LEGACY_IDS = ['toty', 'tots', 'futurestars', 'flashback', 'birthday', 'rttk', 'moments', 'showdown', 'oty', 'centurions'];
const ROTATION_V5 = 39;
const launchOf = (week) => { const p = PROMOS.find((x) => x.releaseWeek === week); return p ? p.id : null; };
/**
 * The headline promo of a week. A campaign always headlines the week it launches (its `releaseWeek`);
 * every other week rotates through the campaigns already released by then (seeded shuffle per cycle), so a
 * week is never left without a live, released campaign.
 */
export function promoOfWeek(week = weekNumber()) {
  if (week < ROTATION_V5) {
    const cycle = Math.floor((week - 1) / LEGACY_IDS.length);
    return new Rng(`promo-cycle-${cycle}`).shuffle(LEGACY_IDS.slice())[(week - 1) % LEGACY_IDS.length];
  }
  const launch = launchOf(week);
  if (launch) return launch;
  const pool = PROMO_IDS.filter((id) => isPromoReleased(id, week));
  const n = pool.length, cycle = Math.floor((week - 1) / n);
  const order = new Rng(`promo-cycle5-${n}-${cycle}`).shuffle(pool.slice());
  let id = order[(week - 1) % n];
  if (id === launchOf(week - 1) && n > 1) id = order[week % n]; // don't re-headline last week's launch
  return id;
}
/** Promos live this week: the new headline campaign plus last week's (each runs two weeks). Does not itself
 * account for `releaseWeek` — callers that must hide an unreleased campaign use `isPromoLive`/`isPromoReleased`. */
export function livePromos(week = weekNumber()) {
  const a = promoOfWeek(week), b = promoOfWeek(Math.max(1, week - 1));
  return a === b ? [a] : [a, b];
}
/** Live this week AND released — what stores/rewards/objectives should actually offer. */
export function releasedLivePromos(week = weekNumber()) { return livePromos(week).filter((id) => isPromoReleased(id, week)); }
/** Upcoming calendar: [{ week, promo }] for this and the next n-1 weeks. */
export function promoSchedule(week = weekNumber(), n = 6) {
  return Array.from({ length: n }, (_, i) => ({ week: week + i, promo: promoOfWeek(week + i) }));
}
export const isPromoLive = (id, week = weekNumber()) => livePromos(week).includes(id) && isPromoReleased(id, week);
/** Owner release (Sep 29, week 39): from this week on every campaign's pack is on sale in the Store, whatever the
 * calendar says. Only the Store uses this; rotation, objectives, SBCs and the market still follow the calendar. */
export const ALL_PACKS_ON_SALE_FROM = 39;
export const isPromoPackOnSale = (id, week = weekNumber()) => !!PROMO_BY_ID[id] && (week >= ALL_PACKS_ON_SALE_FROM || isPromoLive(id, week));

// ---------- boosts ----------
/** In-Form / TOTW boost scaled to the base card: +3 (low 70s) … +8 (90+). */
export function informBoost(ovr) { return clamp(Math.round(3 + (ovr - 70) / 4), 3, 8); }
const scaled = (ovr, lo, hi) => clamp(Math.round(lo + ((ovr - 75) / 15) * (hi - lo)), lo, hi);

/** Better PlayStyles for boosted cards: one extra style (max 4) and one more PlayStyle+ (max 3). Mutates p. */
export function upgradeStyles(p, extraPlus = 1) {
  const list = (p.playstyles || []).map((x) => ({ id: x.id, plus: !!x.plus }));
  if (list.length < 4) {
    const cand = genPhysique({ ...p, id: `${p.id}-x`, ovr: 90 }).playstyles.find((x) => !list.some((y) => y.id === x.id));
    if (cand) list.push({ id: cand.id, plus: false });
  }
  let add = extraPlus;
  for (const x of list) { if (add <= 0) break; if (!x.plus && list.filter((y) => y.plus).length < 3) { x.plus = true; add--; } }
  p.playstyles = list;
  return p;
}

/** Raise/lower the relevant face stats until the overall equals `target` (as close as the 99 cap allows). */
export function setOvr(p, target, { adjustOvr, computeOvr }) {
  for (let i = 0; i < 80 && p.ovr !== target; i++) {
    const before = p.ovr;
    adjustOvr(p, target > p.ovr ? 1 : -1);
    if (p.ovr === before) {
      // every weighted stat is capped: lift the rest of the face stats
      const src = p.pos === 'GK' ? p.gk : p.stats;
      let moved = false;
      for (const k of Object.keys(src)) if (target > p.ovr && src[k] < 99) { src[k]++; moved = true; }
      p.ovr = computeOvr(p.pos, p);
      if (!moved) break;
    }
  }
  if (p.pot !== undefined && p.pot < p.ovr) p.pot = p.ovr;
  return p;
}

const FLASHBACK = {
  ronaldinho: '2005 Ballon d\'Or season', henry: '2003/04 Invincibles', kaka: '2007 Ballon d\'Or season', zidane: '1998 World Cup',
  nazario: '1996/97 season', ronaldo_icon: '2007/08 treble chase', messi_icon: '2011/12 91-goal year', maldini: '1993/94 season',
  buffon: '2006 World Cup', cannavaro: '2006 World Cup', baggio: '1993 Ballon d\'Or season', pele: '1970 World Cup',
  maradona: '1986 World Cup', cruyff: '1974 World Cup', vanbasten: '1988 Euros', eusebio: '1966 World Cup',
};
const MOMENTS = ['Last-minute winner', 'Hat-trick hero', 'Derby-day masterclass', 'Cup final brace', 'Record-breaking night', 'Solo wonder goal', 'Captain\'s performance', 'Comeback king'];

const GROUP = (pos) => (pos === 'GK' ? 'GK' : ['CB'].includes(pos) ? 'CB' : ['LB', 'RB', 'LWB', 'RWB'].includes(pos) ? 'FB' : ['CDM', 'CM', 'CAM'].includes(pos) ? 'MID' : 'ATT');
const byOvr = (a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1);

/** Road to the Knockouts upgrade level (0..4) for a card this week — deterministic "results" per week. */
export function rttkLevel(baseId, week = weekNumber(), key = 'rttk') {
  let lv = 0;
  for (let w = Math.max(1, week - 7); w <= week; w++) if (hashStr(`${key}-${baseId}-${w}`) % 10 < 4) lv++;
  return Math.min(4, lv);
}

/**
 * Build every promo card. src = { stars, icons, regulars, generated }, helpers = { adjustOvr, computeOvr, tierOf, marketValue }.
 * Never consumes a shared RNG (the generated database is unaffected).
 */
export function buildPromoCards(src, helpers, week = weekNumber(), { diverse = true } = {}) {
  const { marketValue } = helpers;
  // Owner (Sep 30): "I shouldn't be seeing the same player in every promo". Every card made counts against that
  // person; the seeded campaigns below then prefer people with the fewest promo cards so far (`diverse`). The old
  // selection (`diverse: false`) is still built on demand so cards players already own keep resolving
  // (players.js legacy promo resolver).
  const usage = new Map();
  const used = (b) => usage.get(b.person || b.id) || 0;
  const actives = src.stars.concat(src.regulars).slice().sort(byOvr);
  const icons = src.icons.slice().sort(byOvr);
  const out = [];
  const make = (base, promo, target, extra = {}, pre = null) => {
    const p = structuredClone(base);
    p.id = `pr_${promo}_${base.id}`;
    p.baseId = base.id;
    delete p.intended; delete p.era; delete p.totw;
    if (pre) pre(p);
    p.ovr = helpers.computeOvr(p.pos, p);
    setOvr(p, clamp(target, 1, 99), helpers);
    p.special = promo; p.promo = promo; p.rare = true; p.tier = 'gold';
    p.pot = Math.max(p.pot || p.ovr, p.ovr);
    if (base.special === 'lotg' || base.club === 'ICN') p.linkAll = true; // keeps the LOTG chemistry perks
    upgradeStyles(p, 1);
    Object.assign(p, extra);
    p.value = marketValue({ ...p, age: Math.min(p.age, 30) }) * 2;
    out.push(p);
    usage.set(base.person || base.id, used(base) + 1);
    return p;
  };
  const take = (list, want, used) => {
    const res = [];
    for (const [g, n] of Object.entries(want)) {
      let k = 0;
      for (const p of list) { if (k >= n) break; if (GROUP(p.pos) === g && !used.has(p.person || p.id)) { res.push(p); used.add(p.person || p.id); k++; } }
    }
    return res;
  };
  /** Target overall for a +lo..+hi boost, capped by the campaign's range; null when it can't be a real boost. */
  const boostTo = (id, b, lo, hi) => {
    const [rmin, rmax] = PROMO_BY_ID[id].range;
    const t = Math.min(rmax, b.ovr + scaled(b.ovr, lo, hi));
    return t > b.ovr && t >= rmin ? t : null;
  };
  /** Generic campaign: n distinct people from `pool` (seeded per campaign), boosted +lo..+hi. */
  const campaign = (id, pool, n, lo, hi, extra = null, pre = null) => {
    const rng = new Rng(`promo-${id}`);
    const seen = new Set();
    let picks = rng.shuffle(pool.filter((b) => boostTo(id, b, lo, hi) !== null)).filter((b) => {
      const k = b.person || b.id;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    // least-used people first (stable, so the seeded shuffle still decides between equals)
    if (diverse) picks = picks.map((b, i) => [b, i]).sort((x, y) => used(x[0]) - used(y[0]) || x[1] - y[1]).map((x) => x[0]);
    picks = picks.slice(0, n);
    picks.forEach((b, i) => make(b, id, boostTo(id, b, lo, hi), typeof extra === 'function' ? extra(b, i) : extra || {}, pre));
  };

  // Team of the Year: best real actives, 1-2-2-3-3 (nerfed: 98 / 97 / 96)
  const toty = take(actives, { GK: 1, CB: 2, FB: 2, MID: 3, ATT: 3 }, new Set()).sort(byOvr);
  toty.forEach((b, i) => make(b, 'toty', Math.max(b.ovr + 1, i < 4 ? 98 : i < 8 ? 97 : 96)));

  // Team of the Season: 15 from the top 60 actives (seeded), 92–96
  const trng = new Rng('promo-tots');
  const totsPool = trng.shuffle(actives.slice(0, 60)).sort((a, b) => (GROUP(a.pos) < GROUP(b.pos) ? -1 : 1));
  for (const b of take(totsPool.filter((x) => x.ovr < 96), { GK: 1, CB: 3, FB: 2, MID: 5, ATT: 4 }, new Set())) make(b, 'tots', clamp(92 + Math.round((b.ovr - 83) / 2), Math.max(92, b.ovr + 1), 96));

  // Future Stars: youngest standouts (real first), +4..+7
  const young = src.regulars.filter((p) => p.age <= 22 && p.ovr >= 80).sort(byOvr)
    .concat(src.generated.filter((p) => p.age <= 21 && p.ovr >= 78 && !p.special).sort(byOvr).slice(0, 6));
  for (const b of young.filter((x) => boostTo('futurestars', x, 4, 7)).slice(0, 14)) make(b, 'futurestars', boostTo('futurestars', b, 4, 7), { pot: Math.min(99, b.ovr + 12) });

  // Heroes Flashback: a legend's famous season (+2, max 98 — +1 for the very top)
  for (const b of icons.filter((p) => (FLASHBACK[p.id.replace(/^ic_/, '')] || FLASHBACK[`${p.person}_icon`]) && (p.ovr < 99 || !diverse))) { // the legacy build keeps Pelé / Maradona (99 since Sep 30) so owned Flashbacks resolve
    const key = FLASHBACK[`${b.person}_icon`] ? `${b.person}_icon` : b.person;
    make(b, 'flashback', Math.max(b.ovr + 1, Math.min(98, b.ovr + 2)), { moment: FLASHBACK[key] });
  }

  // Ultimate Birthday: 6 Icons + 8 actives, +2..+4 with +1 SM / +1 WF
  const brng = new Rng('promo-birthday');
  const bday = brng.shuffle(icons.filter((p) => boostTo('birthday', p, 2, 4))).slice(0, 6).concat(brng.shuffle(actives.slice(0, 80).filter((p) => boostTo('birthday', p, 2, 4))).slice(0, 8));
  for (const b of bday) {
    make(b, 'birthday', boostTo('birthday', b, 2, 4), { sm: b.pos === 'GK' ? 1 : Math.min(5, b.sm + 1), wf: Math.min(5, b.wf + 1) });
  }

  // Road to the Knockouts: 12 regulars rated 80–87, +2 base, +1 per knockout round reached (max +4)
  const rrng = new Rng('promo-rttk');
  for (const b of rrng.shuffle(src.regulars.filter((p) => p.ovr >= 80 && p.ovr <= 87)).slice(0, 12)) {
    const lv = rttkLevel(b.id, week);
    make(b, 'rttk', Math.min(94, b.ovr + 2 + lv), { upg: { level: lv, max: 4 } });
  }

  // Moments: 8 actives + 3 Icons, +3..+5 (max 95)
  const mrng = new Rng('promo-moments');
  const mom = mrng.shuffle(actives.slice(0, 50).filter((p) => boostTo('moments', p, 3, 5))).slice(0, 8)
    .concat(mrng.shuffle(icons.filter((p) => p.ovr <= 91 && boostTo('moments', p, 3, 5))).slice(0, 3));
  mom.forEach((b, i) => make(b, 'moments', boostTo('moments', b, 3, 5), { moment: MOMENTS[i % MOMENTS.length] }));

  // V4 — Rivals Showdown: 10 actives from famous rivalries, +3..+6
  campaign('showdown', actives.slice(0, 70), 10, 3, 6);
  // V4 — One to Watch: 10 in-form actives aged <= 27, +3..+6 (dynamic-flavoured, but a normal static card here)
  campaign('oty', src.regulars.filter((p) => p.age <= 27 && p.ovr >= 78).concat(src.stars.filter((p) => p.age <= 27)), 10, 3, 6);
  // V4 — Centurions: 8 veteran actives/Icons closing in on a milestone, +3..+5
  campaign('centurions', actives.filter((p) => p.age >= 28).concat(icons.filter((p) => p.ovr <= 95)).sort(byOvr).slice(0, 40), 8, 3, 5, { milestone: '100 club/international caps' });

  // V5 — the wider calendar (see PROMOS). All seeded per campaign, never touching a shared RNG.
  const outfield = actives.filter((p) => p.pos !== 'GK');
  campaign('storm', actives.slice(0, 90), 10, 3, 5);
  campaign('rulebenders', outfield.slice(0, 100), 10, 2, 4, (b) => ({ sm: Math.min(5, (b.sm || 2) + 1) }),
    (p) => { p.stats.pac = Math.min(99, p.stats.pac + 6); p.stats.dri = Math.min(99, p.stats.dri + 3); });
  const leagueBest = []; const lgSeen = new Set();
  for (const b of actives) { const lg = b.league || b.club; if (!lgSeen.has(lg)) { lgSeen.add(lg); leagueBest.push(b); } }
  campaign('potm', leagueBest.concat(actives.slice(0, 40)), 10, 2, 4);
  campaign('fright', actives.slice(0, 100), 10, 3, 5);
  campaign('roleswap', outfield.filter((p) => ROLE_SWAP[p.pos]).slice(0, 100), 10, 2, 4, null, (p) => {
    const from = p.pos;
    p.pos = ROLE_SWAP[from];
    p.alt = [from].concat((p.alt || []).filter((x) => x !== p.pos && x !== from)).slice(0, 3);
  });
  campaign('halo', icons.filter((p) => p.ovr <= 93), 8, 2, 3);
  campaign('blackout', actives.slice(0, 140), 12, 2, 4);
  campaign('champions', actives.slice(0, 45), 10, 3, 5);
  campaign('frost', actives.slice(0, 110), 10, 3, 5, (b) => ({ alt: [...new Set([...(b.alt || []), FROST_ALT[b.pos] || b.pos])].filter((x) => x !== b.pos).slice(0, 3) }));
  campaign('yuletide', actives.slice(0, 80).concat(icons.filter((p) => p.ovr <= 92).slice(-12)), 10, 2, 4);
  campaign('fantasy', outfield.slice(0, 110), 10, 2, 4);
  campaign('wildfire', src.regulars.filter((p) => p.age <= 25 && p.ovr >= 78).concat(src.stars.filter((p) => p.age <= 25)), 10, 3, 5);
  const vets = actives.filter((p) => p.age >= 33);
  campaign('finalchapter', vets.length >= 8 ? vets : actives.filter((p) => p.age >= 31), 8, 3, 5);
  campaign('fiesta', actives.slice(0, 70).concat(icons.filter((p) => p.ovr <= 93)), 12, 2, 4, (b) => ({ wf: Math.min(5, (b.wf || 3) + 1) }));

  // V5 — Global Cup tournament set
  campaign('cupplayer', actives.slice(0, 120), 14, 2, 3);
  campaign('roadtocup', actives.slice(0, 120), 10, 2, 4);
  campaign('cupstories', actives.slice(0, 90), 10, 2, 4);
  campaign('cupstar', actives.filter((p) => p.age <= 26).slice(0, 80), 10, 3, 5);
  campaign('gloryroad', src.regulars.filter((p) => p.ovr >= 78 && p.ovr <= 88), 10, 2, 2, (b) => {
    const lv = rttkLevel(b.id, week, 'glory');
    return { upg: { level: lv, max: 4 } };
  });
  for (const p of out) if (p.special === 'gloryroad' && p.upg.level) setOvr(p, Math.min(PROMO_BY_ID.gloryroad.range[1], p.ovr + p.upg.level), helpers);
  campaign('cupicon', icons.filter((p) => p.ovr <= 94), 8, 1, 2);
  campaign('cuphero', icons.filter((p) => p.ovr <= 90), 8, 2, 3);
  campaign('phenoms', src.regulars.filter((p) => p.age <= 23 && p.ovr >= 76).concat(src.generated.filter((p) => p.age <= 21 && p.ovr >= 76 && !p.special)), 10, 4, 6);

  // Owner request (Sep 27): several guaranteed Neymar promo versions on top of his boosted base card
  // (realplayers.js STAR_ROWS, now 91), reaching up to 99 for at least one already-released campaign —
  // picked from ids that already exist above rather than inventing new ones, with a safe fallback per slot
  // in case a future edit ever renames/removes one. Placed directly (not through the seeded `campaign()`
  // pools) so they are guaranteed regardless of who else qualifies that week.
  const neymarBase = actives.find((p) => p.person === 'neymar');
  if (neymarBase) {
    const firstOf = (...ids) => ids.find((id) => PROMO_BY_ID[id]);
    const pick = (ids, lo, hi, extra) => {
      const id = firstOf(...ids);
      if (!id || out.some((p) => p.special === id && p.baseId === neymarBase.id)) return;
      const rmax = PROMO_BY_ID[id].range[1];
      const target = Math.min(rmax, Math.max(neymarBase.ovr + lo, neymarBase.ovr + hi));
      if (target > neymarBase.ovr) make(neymarBase, id, target, extra);
    };
    pick(['tots'], 5, 6); // season-best, ~97
    pick(['moments', 'cupstories', 'showdown'], 8, 8, { moment: 'Barcelona treble masterclass' }); // always-released, guaranteed 99
    pick(['fiesta', 'yuletide', 'birthday'], 8, 8); // summer-party style, 99 (future release)
    pick(['flashback'], 8, 8, { moment: '2015 treble season' }); // legend/icon-style prime, guaranteed 99
    pick(['halo', 'cupicon'], 6, 6); // extra "hall of heroes" style 99
  }

  // Owner request (Sep 27): Salah also gets a guaranteed legend-level promo version (Egypt's greatest active
  // player). Placed directly like Neymar's picks above, so it's guaranteed regardless of the seeded pools.
  const salahBase = actives.find((p) => p.person === 'salah');
  if (salahBase) {
    const id = ['centurions', 'halo', 'moments'].find((x) => PROMO_BY_ID[x]);
    if (id && !out.some((p) => p.special === id && p.baseId === salahBase.id)) {
      const rmax = PROMO_BY_ID[id].range[1];
      const target = Math.min(rmax, salahBase.ovr + 8);
      if (target > salahBase.ovr) make(salahBase, id, target, { milestone: 'Egypt caps & goals record' });
    }
  }

  // Owner request (Sep 29): Neuer gets three 99 versions, one in each campaign whose range reaches 99.
  const neuerBase = actives.find((p) => p.person === 'neuer') || icons.find((p) => p.person === 'neuer');
  if (neuerBase) {
    const moments = { flashback: '2014 World Cup sweeper-keeper', moments: '2013 treble wall' };
    for (const id of ['flashback', 'moments', 'fiesta']) {
      if (!PROMO_BY_ID[id] || out.some((p) => p.special === id && p.baseId === neuerBase.id)) continue;
      make(neuerBase, id, 99, moments[id] ? { moment: moments[id] } : {});
    }
  }

  // Owner request (Sep 29): Klose (late Icon, realplayers.js LATE_ICON_ROWS) and Müller get 5 cards each, two of
  // them 99. Appended after every seeded campaign, so no other promo card changes.
  const owned = (b, id) => out.some((p) => p.special === id && p.baseId === b.id);
  const ownerPick = (b, id, target, extra = {}) => { if (b && PROMO_BY_ID[id] && !owned(b, id)) make(b, id, Math.min(99, Math.max(target, b.ovr + 1)), extra); };
  const klose = (src.lateIcons || []).find((p) => p.person === 'klose');
  if (klose) { // base Icon + 4 promos
    ownerPick(klose, 'flashback', 99, { moment: '16 World Cup goals, the all-time record' });
    ownerPick(klose, 'moments', 99, { moment: '2014 World Cup record-breaker' });
    ownerPick(klose, 'halo', 94);
    ownerPick(klose, 'cupicon', 93);
  }
  const muller = actives.find((p) => p.person === 'muller') || src.regulars.find((p) => p.person === 'muller');
  if (muller) { // base + the seeded Role Swap card + 3 here
    ownerPick(muller, 'moments', 99, { moment: '2014 World Cup Golden Boot run' });
    ownerPick(muller, 'fiesta', 99);
    ownerPick(muller, 'tots', 95);
  }

  for (const p of out) p.tier = 'gold';
  return out;
}
const ROLE_SWAP = { CB: 'CDM', CDM: 'CB', CM: 'CAM', CAM: 'ST', ST: 'CAM', CF: 'CAM', LW: 'ST', RW: 'ST', LM: 'LW', RM: 'RW', LB: 'LM', RB: 'RM', LWB: 'LM', RWB: 'RM' };
const FROST_ALT = { CB: 'CDM', CDM: 'CM', CM: 'CAM', CAM: 'CF', ST: 'CF', CF: 'ST', LW: 'LM', RW: 'RM', LM: 'LW', RM: 'RW', LB: 'LWB', RB: 'RWB', GK: 'GK' };

// ---------- store packs, SBCs and objectives per promo ----------
/** Pack definition for a promo (1 guaranteed promo card + rare golds). */
export function promoPack(promo) {
  return {
    id: `promo_${promo.id}`, name: `${promo.name} Pack`, price: promo.price, look: `promo-${promo.id}`, promo: promo.id,
    desc: `1 guaranteed ${promo.name} player + 5 rare golds`,
    slots: [{ n: 1, odds: { [`promo_${promo.id}`]: 1 } }, { n: 5, odds: { goldRare: 0.72, gold83: 0.22, gold86: 0.06 } }],
  };
}
/** Two SBCs per promo: a named promo player and a repeatable promo-pack upgrade. */
export function promoSbcs(promo) {
  const hi = promo.range[1];
  return [
    { id: `promo-${promo.id}-player`, name: `${promo.short}: Featured Player`, group: promo.name, promo: promo.id,
      desc: `Earn this campaign's featured ${promo.name} card.`,
      reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: hi >= 97 ? 86 : hi >= 95 ? 84 : 82 }, { t: 'chem', v: 70 }], reward: { promoPlayer: { promo: promo.id, slot: 'sbc' } } },
    { id: `promo-${promo.id}-upgrade`, name: `${promo.short}: Pack Upgrade`, group: promo.name, promo: promo.id, repeatable: true,
      desc: `Trade a strong squad for a ${promo.name} Pack.`,
      reqs: [{ t: 'count', v: 11 }, { t: 'rating', v: 81 }, { t: 'rare', v: 4 }], reward: { pack: `promo_${promo.id}` } },
  ];
}
/** Objectives of a live promo (bucketed per week and promo). */
export function promoObjectives(promo) {
  return [
    { id: `po-${promo.id}-play`, label: `${promo.short}: Play 3 matches`, metric: { type: 'play' }, target: 3, reward: { coins: 5000 } },
    { id: `po-${promo.id}-with`, label: `${promo.short}: Win 2 with a ${promo.name} card in your XI`, metric: { type: 'winWith', f: { special: promo.id } }, target: 2, reward: { pack: `promo_${promo.id}` } },
    { id: `po-${promo.id}-win`, label: `${promo.short}: Win 6 matches`, metric: { type: 'win' }, target: 6, reward: { promoPlayer: { promo: promo.id, slot: 'objective' } } },
  ];
}
