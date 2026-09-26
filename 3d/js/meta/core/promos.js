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
  { id: 'toty', name: 'Team of the Year', short: 'TOTY', tag: 'TEAM OF THE YEAR', colors: ['#06123a', '#2f6bff', '#dfe9ff'], range: [97, 99], price: 180000, theme: 'toty',
    desc: 'The best XI of the year: real stars boosted to 97–99.' },
  { id: 'tots', name: 'Team of the Season', short: 'TOTS', tag: 'TEAM OF THE SEASON', colors: ['#032b3a', '#19c3e6', '#d9fbff'], range: [93, 97], price: 120000, theme: 'tots',
    desc: 'Season standouts across every league, rated 93–97.' },
  { id: 'futurestars', name: 'Future Stars', short: 'FUTURE STARS', tag: 'FUTURE STARS', colors: ['#1c0636', '#b44dff', '#ffd9fb'], range: [83, 95], price: 70000, theme: 'futurestars',
    desc: 'The brightest young talents, boosted +5 to +8.' },
  { id: 'flashback', name: 'Heroes Flashback', short: 'FLASHBACK', tag: 'FLASHBACK', colors: ['#2a1405', '#e0892b', '#ffe8c7'], range: [90, 99], price: 160000, theme: 'flashback',
    desc: 'Legends relive their most famous season.' },
  { id: 'birthday', name: 'Ultimate Birthday', short: 'BIRTHDAY', tag: 'ULTIMATE BIRTHDAY', colors: ['#3a0620', '#ff4f9a', '#ffe0ef'], range: [84, 97], price: 90000, theme: 'birthday',
    desc: 'Party cards: +3 to +5 overall, +1 skill moves and +1 weak foot.' },
  { id: 'rttk', name: 'Road to the Knockouts', short: 'RTTK', tag: 'ROAD TO THE KNOCKOUTS', colors: ['#021a12', '#18d17b', '#d7ffe9'], range: [83, 95], price: 80000, theme: 'rttk',
    desc: 'Upgradable cards: +1 overall for every knockout round reached (max +4).' },
  { id: 'moments', name: 'Moments', short: 'MOMENTS', tag: 'MOMENTS', colors: ['#1d1d1d', '#f2f2f2', '#ffffff'], range: [86, 96], price: 110000, theme: 'moments',
    desc: 'Iconic moments turned into boosted cards.' },
  // V4 (owner request Sep 26): new campaigns, each with a genuine future release date and its own pack theme.
  { id: 'showdown', name: 'Rivals Showdown', short: 'SHOWDOWN', tag: 'RIVALS SHOWDOWN', colors: ['#3a0a0a', '#ff3b3b', '#ffd9d9'], range: [88, 97], price: 130000, theme: 'showdown',
    releaseWeek: 41, desc: 'Head-to-head rivals get matching boosted cards, +4 to +7.' },
  { id: 'oty', name: "One to Watch", short: 'OTW', tag: 'ONE TO WATCH', colors: ['#062017', '#12c48b', '#daffee'], range: [82, 92], price: 60000, theme: 'oty',
    releaseWeek: 44, desc: 'A dynamic card that grows with the real player’s current form.' },
  { id: 'centurions', name: 'Centurions', short: 'CENT', tag: 'CENTURIONS', colors: ['#241100', '#e8a33d', '#fff2da'], range: [91, 98], price: 150000, theme: 'centurions',
    releaseWeek: 47, desc: 'Career milestone cards for real players closing in on a big number.' },
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
/** The headline promo of a week: a seeded shuffle of all campaigns per cycle (cycle length = campaign count). */
export function promoOfWeek(week = weekNumber()) {
  const cycle = Math.floor((week - 1) / PROMOS.length);
  const order = new Rng(`promo-cycle-${cycle}`).shuffle(PROMO_IDS.slice());
  return order[(week - 1) % PROMOS.length];
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
export function rttkLevel(baseId, week = weekNumber()) {
  let lv = 0;
  for (let w = Math.max(1, week - 7); w <= week; w++) if (hashStr(`rttk-${baseId}-${w}`) % 10 < 4) lv++;
  return Math.min(4, lv);
}

/**
 * Build every promo card. src = { stars, icons, regulars, generated }, helpers = { adjustOvr, computeOvr, tierOf, marketValue }.
 * Never consumes a shared RNG (the generated database is unaffected).
 */
export function buildPromoCards(src, helpers, week = weekNumber()) {
  const { marketValue } = helpers;
  const actives = src.stars.concat(src.regulars).slice().sort(byOvr);
  const icons = src.icons.slice().sort(byOvr);
  const out = [];
  const make = (base, promo, target, extra = {}) => {
    const p = structuredClone(base);
    p.id = `pr_${promo}_${base.id}`;
    p.baseId = base.id;
    delete p.intended; delete p.era; delete p.totw;
    setOvr(p, clamp(target, 1, 99), helpers);
    p.special = promo; p.promo = promo; p.rare = true; p.tier = 'gold';
    p.pot = Math.max(p.pot || p.ovr, p.ovr);
    if (base.special === 'lotg' || base.club === 'ICN') p.linkAll = true; // keeps the LOTG chemistry perks
    upgradeStyles(p, 1);
    Object.assign(p, extra);
    p.value = marketValue({ ...p, age: Math.min(p.age, 30) }) * 2;
    out.push(p);
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

  // Team of the Year: best real actives, 1-2-2-3-3
  const toty = take(actives, { GK: 1, CB: 2, FB: 2, MID: 3, ATT: 3 }, new Set()).sort(byOvr);
  toty.forEach((b, i) => make(b, 'toty', i < 4 ? 99 : i < 8 ? 98 : 97));

  // Team of the Season: 15 from the top 60 actives (seeded), 93–97
  const trng = new Rng('promo-tots');
  const totsPool = trng.shuffle(actives.slice(0, 60)).sort((a, b) => (GROUP(a.pos) < GROUP(b.pos) ? -1 : 1));
  for (const b of take(totsPool, { GK: 1, CB: 3, FB: 2, MID: 5, ATT: 4 }, new Set())) make(b, 'tots', clamp(93 + Math.round((b.ovr - 83) / 2), 93, 97));

  // Future Stars: youngest standouts (real first), +5..+8
  const young = src.regulars.filter((p) => p.age <= 22 && p.ovr >= 80).sort(byOvr)
    .concat(src.generated.filter((p) => p.age <= 21 && p.ovr >= 76 && !p.special).sort(byOvr).slice(0, 6));
  for (const b of young.slice(0, 14)) make(b, 'futurestars', Math.min(95, b.ovr + scaled(b.ovr, 5, 8)), { pot: Math.min(99, b.ovr + 12) });

  // Heroes Flashback: a legend's famous season (+2, max 99)
  for (const b of icons.filter((p) => FLASHBACK[p.id.replace(/^ic_/, '')] || FLASHBACK[`${p.person}_icon`])) {
    const key = FLASHBACK[`${b.person}_icon`] ? `${b.person}_icon` : b.person;
    make(b, 'flashback', Math.min(99, b.ovr + 2), { moment: FLASHBACK[key] });
  }

  // Ultimate Birthday: 6 Icons + 8 actives, +3..+5 with +1 SM / +1 WF
  const brng = new Rng('promo-birthday');
  const bday = brng.shuffle(icons.slice()).slice(0, 6).concat(brng.shuffle(actives.slice(0, 80)).slice(0, 8));
  for (const b of bday) {
    make(b, 'birthday', Math.min(97, b.ovr + scaled(b.ovr, 3, 5)), { sm: b.pos === 'GK' ? 1 : Math.min(5, b.sm + 1), wf: Math.min(5, b.wf + 1) });
  }

  // Road to the Knockouts: 12 regulars rated 80–87, +3 base, +1 per knockout round reached (max +4)
  const rrng = new Rng('promo-rttk');
  for (const b of rrng.shuffle(src.regulars.filter((p) => p.ovr >= 80 && p.ovr <= 87)).slice(0, 12)) {
    const lv = rttkLevel(b.id, week);
    make(b, 'rttk', Math.min(95, b.ovr + 3 + lv), { upg: { level: lv, max: 4 } });
  }

  // Moments: 8 actives + 3 Icons, +4..+6 (max 96)
  const mrng = new Rng('promo-moments');
  const mom = mrng.shuffle(actives.slice(0, 50)).slice(0, 8).concat(mrng.shuffle(icons.filter((p) => p.ovr <= 92)).slice(0, 3));
  mom.forEach((b, i) => make(b, 'moments', Math.min(96, b.ovr + scaled(b.ovr, 4, 6)), { moment: MOMENTS[i % MOMENTS.length] }));

  // V4 — Rivals Showdown: 10 actives from famous rivalries, +4..+7
  const srng = new Rng('promo-showdown');
  for (const b of srng.shuffle(actives.slice(0, 70)).slice(0, 10)) make(b, 'showdown', Math.min(97, b.ovr + scaled(b.ovr, 4, 7)));

  // V4 — One to Watch: 10 in-form actives aged <= 27, +3..+6 (dynamic-flavoured, but a normal static card here)
  const orng = new Rng('promo-oty');
  const otyPool = src.regulars.filter((p) => p.age <= 27 && p.ovr >= 78).concat(src.stars.filter((p) => p.age <= 27));
  for (const b of orng.shuffle(otyPool).slice(0, 10)) make(b, 'oty', Math.min(92, b.ovr + scaled(b.ovr, 3, 6)));

  // V4 — Centurions: 8 veteran actives/Icons closing in on a milestone, +3..+6 (max 98)
  const crng = new Rng('promo-centurions');
  const centPool = actives.filter((p) => p.age >= 28).concat(icons.filter((p) => p.ovr <= 95)).sort(byOvr);
  for (const b of crng.shuffle(centPool.slice(0, 40)).slice(0, 8)) make(b, 'centurions', Math.min(98, b.ovr + scaled(b.ovr, 3, 6)), { milestone: '100 club/international caps' });

  for (const p of out) p.tier = 'gold';
  return out;
}

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
