// V2.1: player physique (height / weight) and PlayStyles. DOM-free, deterministic.
// Generated players derive these from their id with a private RNG, so the shared DB RNG sequence (and
// therefore every existing id/stat/save) is untouched. Real players carry hand-authored values.
import { Rng, clamp } from './rng.js';
import { ALT_OPTIONS } from './formations.js';

// id -> [name, category, short code, description]. The full FC 25/26 PlayStyles set (owner request, Sep 27).
// Two ids keep their original (pre-FC25) keys so every save / network card stays valid: `powerheader` is
// FC's "Precision Header" and `aerial` is "Aerial Fortress" — PS_ALIASES maps the FC-style ids onto them.
export const PLAYSTYLES = {
  finesse: ['Finesse Shot', 'attack', 'FS', 'Curled finesse shots are faster and more accurate.'],
  power: ['Power Shot', 'attack', 'PS', 'Power shots are struck harder and stay on target more often.'],
  chip: ['Chip Shot', 'attack', 'CS', 'Chip shots are more accurate and harder for keepers to read.'],
  deadball: ['Dead Ball', 'attack', 'DB', 'Free kicks, corners and penalties have more curve and accuracy.'],
  trivela: ['Trivela', 'attack', 'TV', 'Outside-of-the-foot passes and shots are more accurate.'],
  lowdriven: ['Low Driven Shot', 'attack', 'LD', 'Low driven shots are faster and more accurate.'],
  powerheader: ['Precision Header', 'attack', 'PH', 'Headers are more powerful and more accurate.'],
  acrobatic: ['Acrobatic', 'attack', 'AC', 'Volleys, bicycle and scissor kicks are more accurate.'],
  gamechanger: ['Gamechanger', 'attack', 'GC', 'Improvised finishes (chips, trivelas, flicks, curlers) are sharper.'],
  incisive: ['Incisive Pass', 'passing', 'IP', 'Through balls are faster and more accurate.'],
  tikitaka: ['Tiki Taka', 'passing', 'TT', 'Short first-time passes are more accurate.'],
  pinged: ['Pinged Pass', 'passing', 'PP', 'Driven passes travel faster and are more accurate.'],
  longball: ['Long Ball Pass', 'passing', 'LP', 'Long lofted passes are more accurate.'],
  whipped: ['Whipped Pass', 'passing', 'WP', 'Crosses are whipped in faster and more accurately.'],
  inventive: ['Inventive', 'passing', 'IV', 'Flair and no-look passes are more accurate.'],
  firsttouch: ['First Touch', 'control', 'FT', 'Receiving the ball is cleaner, even at speed.'],
  technical: ['Technical', 'control', 'TE', 'Tighter close control while dribbling at speed.'],
  rapid: ['Rapid', 'control', 'RA', 'Faster when sprinting with the ball.'],
  flair: ['Flair', 'control', 'FL', 'Flair passes and shots are more accurate.'],
  trickster: ['Trickster', 'control', 'TR', 'Skill moves are quicker and more effective.'],
  pressproven: ['Press Proven', 'control', 'PR', 'Keeps the ball better under pressure.'],
  anticipate: ['Anticipate', 'defending', 'AN', 'Standing tackles win the ball more often.'],
  intercept: ['Intercept', 'defending', 'IN', 'Reads and cuts out passes more often.'],
  block: ['Block', 'defending', 'BL', 'Reaches further to block shots and passes.'],
  jockey: ['Jockey', 'defending', 'JO', 'Moves faster and stays balanced while jockeying.'],
  slidetackle: ['Slide Tackle', 'defending', 'SL', 'Slide tackles reach further and win the ball more often.'],
  bruiser: ['Bruiser', 'defending', 'BR', 'Stronger in shoulder challenges and when shielding.'],
  aerial: ['Aerial Fortress', 'defending', 'AF', 'Jumps higher and wins more aerial duels.'],
  quickstep: ['Quick Step', 'physical', 'QS', 'Explosive acceleration when sprinting.'],
  relentless: ['Relentless', 'physical', 'RL', 'Tires less and recovers stamina faster.'],
  longthrow: ['Long Throw', 'physical', 'LT', 'Throw-ins travel much further.'],
  enforcer: ['Enforcer', 'physical', 'EN', 'Wins more physical duels; tackles knock carriers off the ball.'],
  farreach: ['Far Reach', 'gk', 'FR', 'Dives further to reach shots in the corners.'],
  footwork: ['Footwork', 'gk', 'FW', 'Better saves with the feet and cleaner distribution.'],
  rushout: ['Rush Out', 'gk', 'RO', 'Comes off the line quickly to close down attackers.'],
  crossclaimer: ['Cross Claimer', 'gk', 'CC', 'Claims crosses more reliably.'],
  quickreflexes: ['Quick Reflexes', 'gk', 'QR', 'Reacts faster to close-range shots.'],
  deflector: ['Deflector', 'gk', 'DF', 'Parries shots away from danger.'],
};
/** FC-style / legacy id -> canonical id (so 'precisionheader', 'aerialfortress', etc. keep working). */
export const PS_ALIASES = {
  precisionheader: 'powerheader', precision: 'powerheader', aerialfortress: 'aerial', fortress: 'aerial',
  powershot: 'power', finesseshot: 'finesse', chipshot: 'chip', lowdrivenshot: 'lowdriven', incisivepass: 'incisive',
  pingedpass: 'pinged', longballpass: 'longball', whippedpass: 'whipped', game_changer: 'gamechanger',
};
/** Canonical PlayStyle id for any known id or alias (null if unknown). */
export function canonStyle(id) {
  if (typeof id !== 'string') return null;
  const k = id.toLowerCase().replace(/[\s-]+/g, '');
  if (PLAYSTYLES[k]) return k;
  return PS_ALIASES[k] || PS_ALIASES[id] || null;
}
/** Normalise a [{id, plus}] list: aliases -> canonical ids, unknown ids dropped, duplicates merged (plus wins). */
export function normalizeStyles(list) {
  if (!Array.isArray(list)) return list;
  const out = [];
  for (const x of list) {
    const id = canonStyle(typeof x === 'string' ? x : x && x.id);
    if (!id) continue;
    const plus = !!(x && x.plus);
    const have = out.find((y) => y.id === id);
    if (have) have.plus = have.plus || plus; else out.push({ id, plus });
  }
  return out;
}
/** Owner tier list (scratchpad/promorefs/playstyles_tierlist.png) as a 0..5 priority used when picking which
 * of a player's PlayStyles become PlayStyle+ (higher = better +). */
export const PS_TIER = {
  finesse: 5, power: 5, anticipate: 5, incisive: 5, rapid: 5, quickstep: 5, technical: 5, bruiser: 5, acrobatic: 5,
  pressproven: 5, tikitaka: 5, longball: 5, pinged: 5, trickster: 5, relentless: 5, farreach: 5, gamechanger: 5,
  intercept: 4, block: 4, slidetackle: 4, firsttouch: 4, lowdriven: 4, jockey: 4, quickreflexes: 4, enforcer: 4,
  aerial: 3, whipped: 3, powerheader: 3, footwork: 3, deflector: 3, inventive: 3, deadball: 3,
  chip: 2, trivela: 2, flair: 2, rushout: 2, crossclaimer: 2,
  longthrow: 0,
};
export const PLAYSTYLE_IDS = Object.keys(PLAYSTYLES);

/** Allowed PlayStyle count for an overall: [min, max]. */
export function styleCountRange(ovr) {
  if (ovr >= 87) return [3, 4];
  if (ovr >= 80) return [2, 3];
  if (ovr >= 70) return [1, 2];
  return [0, 1];
}
/** Max PlayStyle+ allowed for an overall (only 85+ may have any). */
export function maxPlus(ovr) { return ovr >= 90 ? 2 : ovr >= 85 ? 1 : 0; }

const DEF = new Set(['CB', 'LB', 'RB', 'LWB', 'RWB']);
const WIDE = new Set(['LW', 'RW', 'LM', 'RM']);

// Owner reference ("best PlayStyles+ per position" chart, scratchpad/promorefs/playstyles_plus_by_position.jpg):
// which PlayStyles a position's '+' upgrades should land on first. Never changes which styles a player draws
// or the OVR-band count/plus rules (styleCountRange/maxPlus) — only which of the drawn styles gets the '+'.
const BEST_BY_POS = {
  ST: ['finesse', 'power', 'lowdriven'], CF: ['finesse', 'power', 'technical'],
  LW: ['finesse', 'rapid', 'quickstep'], RW: ['finesse', 'rapid', 'quickstep'],
  LM: ['finesse', 'rapid', 'quickstep'], RM: ['finesse', 'rapid', 'quickstep'],
  CAM: ['technical', 'incisive', 'finesse', 'power'],
  CM: ['pinged', 'tikitaka', 'incisive'],
  CDM: ['longball', 'intercept', 'pinged'],
  CB: ['intercept', 'anticipate', 'bruiser'],
  LB: ['intercept', 'bruiser', 'anticipate'], RB: ['intercept', 'bruiser', 'anticipate'],
  LWB: ['intercept', 'bruiser', 'anticipate'], RWB: ['intercept', 'bruiser', 'anticipate'],
  GK: ['farreach', 'quickreflexes'],
};
/** The PlayStyles that best suit a position (owner's reference chart), best first. Card creator (and
 * anything else offering a manual PlayStyle+ pick) should default to these. */
export function bestPlaystylesFor(pos) { return (BEST_BY_POS[pos] || BEST_BY_POS.CM).slice(); }

function candidates(p, height) {
  const s = p.stats, g = p.gk, pos = p.pos;
  const c = [];
  const add = (id, w) => { if (w > 0) c.push([id, w]); };
  if (pos === 'GK') {
    add('farreach', height >= 192 ? 3 : 1.2); add('footwork', g.kic >= 75 ? 2.5 : 0.8); add('rushout', g.spd >= 55 ? 2 : 0.8);
    add('crossclaimer', height >= 190 ? 2 : 1); add('quickreflexes', g.ref >= 82 ? 3 : 1); add('deflector', 1.4);
    return c;
  }
  const att = ['ST', 'CF', 'LW', 'RW', 'CAM'].includes(pos);
  const mid = ['CM', 'CDM', 'CAM', 'LM', 'RM'].includes(pos);
  if (att || mid) {
    add('finesse', s.sho >= 78 ? 2.4 : att ? 1 : 0.3); add('power', s.sho >= 80 && s.phy >= 72 ? 2.2 : att ? 0.8 : 0.3);
    add('chip', att ? 0.8 : 0.2); add('lowdriven', att ? 1 : 0.3); add('trivela', s.dri >= 80 ? 0.6 : 0.1); add('deadball', s.pas >= 80 ? 0.9 : 0.2);
    add('acrobatic', att && s.dri >= 75 ? 0.9 : 0.1);
    add('gamechanger', att && s.sho >= 82 && s.dri >= 82 ? 1.1 : att ? 0.25 : 0.05);
  }
  if (['ST', 'CF'].includes(pos)) add('powerheader', height >= 186 ? 3 : height >= 181 ? 1 : 0.2);
  if (mid || att) {
    add('incisive', s.pas >= 80 ? 2 : 0.6); add('tikitaka', s.pas >= 78 ? 1.6 : 0.5); add('pinged', s.pas >= 75 ? 1.2 : 0.4);
    add('longball', ['CM', 'CDM'].includes(pos) ? 1.3 : 0.3); add('firsttouch', s.dri >= 78 ? 1.8 : 0.7); add('technical', s.dri >= 80 ? 2.2 : 0.6);
    add('flair', s.dri >= 82 ? 1 : 0.2); add('trickster', p.sm >= 4 ? 1.6 : 0.2); add('pressproven', s.dri >= 76 ? 1.2 : 0.5);
    add('inventive', s.pas >= 82 && s.dri >= 80 ? 0.9 : 0.15);
  }
  if (WIDE.has(pos) || ['LB', 'RB', 'LWB', 'RWB'].includes(pos)) add('whipped', s.pas >= 70 ? 2 : 0.8);
  add('rapid', s.pac >= 88 ? 3 : s.pac >= 82 ? 1.4 : s.pac >= 75 ? 0.4 : 0);
  add('quickstep', s.pac >= 86 ? 2.2 : s.pac >= 80 ? 1 : 0.1);
  add('relentless', ['CM', 'CDM', 'LB', 'RB', 'LWB', 'RWB', 'LM', 'RM'].includes(pos) ? 1.4 : 0.4);
  if (DEF.has(pos) || pos === 'CDM') {
    add('anticipate', s.def >= 78 ? 2.2 : 1); add('intercept', s.def >= 75 ? 2 : 1); add('block', pos === 'CB' ? 1.6 : 0.8);
    add('jockey', DEF.has(pos) && pos !== 'CB' ? 1.6 : 0.8); add('slidetackle', 1.2);
    add('bruiser', s.phy >= 80 ? 2.2 : s.phy >= 72 ? 0.8 : 0.2);
    add('aerial', pos === 'CB' && height >= 187 ? 3 : height >= 184 ? 1 : 0.1);
    add('longball', pos === 'CB' && s.pas >= 70 ? 0.8 : 0);
  }
  if (['LB', 'RB', 'LWB', 'RWB'].includes(pos)) add('longthrow', 0.35);
  if (DEF.has(pos) || ['CDM', 'CM', 'ST'].includes(pos)) add('enforcer', s.phy >= 80 ? 1 : 0.2);
  if (pos === 'CM' || pos === 'CDM') add('intercept', 1);
  return c;
}

function pickStyles(p, rng, height) {
  const [lo, hi] = styleCountRange(p.ovr);
  const n = rng.int(lo, hi);
  const pool = candidates(p, height);
  const merged = new Map();
  for (const [id, w] of pool) merged.set(id, (merged.get(id) || 0) + w);
  const entries = [...merged.entries()];
  const out = [];
  while (out.length < n && entries.length) {
    const id = rng.weighted(entries);
    out.push(id);
    entries.splice(entries.findIndex((e) => e[0] === id), 1);
  }
  const best = new Set(bestPlaystylesFor(p.pos));
  out.sort((a, b) => (best.has(b) ? 1 : 0) - (best.has(a) ? 1 : 0)); // position-best styles claim the '+' first
  const mp = maxPlus(p.ovr);
  const plusN = mp === 0 ? 0 : mp === 1 ? (rng.chance(0.65) ? 1 : 0) : (rng.chance(0.5) ? 2 : 1);
  return out.map((id, i) => ({ id, plus: i < Math.min(plusN, out.length) }));
}

/** Deterministic height (cm) / weight (kg) / playstyles for a generated player (keyed on base id). */
export function genPhysique(p) {
  const key = p.baseId || p.id;
  const rng = new Rng(`phys-${key}`);
  let height;
  if (p.pos === 'GK') height = clamp(Math.round(rng.normal(192, 3.6)), 184, 201);
  else {
    const base = p.pos === 'CB' ? 188 : ['ST', 'CF'].includes(p.pos) ? 183 : ['LW', 'RW', 'CAM', 'LM', 'RM'].includes(p.pos) ? 176 : p.pos === 'CDM' ? 182 : 179;
    height = rng.chance(0.03) ? rng.int(196, 201) : Math.round(rng.normal(base, 6.2));
    height = clamp(height, 162, 201);
  }
  const bmi = clamp(rng.normal(23.2, 1.1) + ((p.stats?.phy ?? 70) - 70) * 0.045, 20.2, 27);
  const weight = clamp(Math.round(bmi * (height / 100) ** 2), 58, 100);
  const playstyles = pickStyles(p, new Rng(`ps-${p.id}`), height);
  return { height, weight, playstyles };
}

/** Fill missing physique fields (old career saves, network cards). Mutates and returns p. */
export function ensurePhysique(p) {
  if (!p) return p;
  if (Array.isArray(p.playstyles) && p.playstyles.some((x) => !x || !PLAYSTYLES[x.id])) p.playstyles = normalizeStyles(p.playstyles);
  if (Number.isFinite(p.height) && Number.isFinite(p.weight) && Array.isArray(p.playstyles)) return p;
  const g = genPhysique(p);
  if (!Number.isFinite(p.height)) p.height = g.height;
  if (!Number.isFinite(p.weight)) p.weight = g.weight;
  if (!Array.isArray(p.playstyles)) p.playstyles = g.playstyles;
  return p;
}

/** Parse authored style strings like 'finesse+' into [{id, plus}]. */
export function parseStyles(list) {
  return normalizeStyles((list || []).map((s) => ({ id: s.replace(/\+$/, ''), plus: s.endsWith('+') })));
}

/**
 * Re-pick which of a player's PlayStyles carry the '+' (owner tier list + per-position chart): the number of
 * PlayStyle+ stays what the player had (capped by maxPlus(ovr); `fill` tops it up to maxPlus), but they go to the styles
 * that matter most for the position — chart styles first, then tier-list priority, with the player's own
 * authored '+' as a tie-breaker so signature styles survive when they rank close. Returns a new list.
 */
export function assignPlus(p, list, { fill = false } = {}) {
  const styles = normalizeStyles(list || []);
  const had = styles.filter((x) => x.plus).length;
  const want = Math.min(fill ? Math.max(had, maxPlus(p.ovr)) : had, maxPlus(p.ovr), styles.length);
  const best = bestPlaystylesFor(p.pos);
  const score = (x) => (best.includes(x.id) ? 10 - best.indexOf(x.id) * 1.5 : 0) + (PS_TIER[x.id] ?? 1) + (x.plus ? 1.5 : 0);
  const ranked = styles.map((x, i) => [x, score(x), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  const plusIds = new Set(ranked.slice(0, want).map((r) => r[0].id));
  const out = styles.map((x) => ({ id: x.id, plus: plusIds.has(x.id) }));
  return out.sort((a, b) => (b.plus ? 1 : 0) - (a.plus ? 1 : 0)); // PlayStyles+ first, like FC
}

/** Contract-shaped physique for a Team player. */
export function matchPhysique(p) {
  ensurePhysique(p);
  return {
    height: Math.round(clamp(p.height / 100, 1.62, 2.02) * 100) / 100,
    weight: clamp(Math.round(p.weight), 58, 100),
    playstyles: normalizeStyles(p.playstyles).slice(0, 4).map((x) => ({ id: x.id, plus: !!x.plus })),
  };
}


/** Top up alternate positions to a sensible 0–3 (deterministic per base id; existing alts are kept). */
export function ensureAlts(p) {
  if (p.pos === 'GK') { p.alt = []; return p; }
  const rng = new Rng(`alt-${p.baseId || p.id}`);
  const want = rng.weighted([[0, 15], [1, 40], [2, 33], [3, 12]]);
  const opts = (ALT_OPTIONS[p.pos] || []).slice();
  // footedness: left-footed centre-backs lean to LB, right-footed to RB
  if (p.pos === 'CB') opts.sort((a, b) => (b === (p.foot === 'L' ? 'LB' : 'RB')) - (a === (p.foot === 'L' ? 'LB' : 'RB')));
  const alt = (p.alt || []).filter((x) => x !== p.pos && opts.includes(x));
  for (const o of opts) {
    if (alt.length >= Math.max(want, alt.length) || alt.length >= 3) break;
    if (!alt.includes(o) && rng.chance(0.8)) alt.push(o);
  }
  p.alt = alt.slice(0, 3);
  return p;
}
