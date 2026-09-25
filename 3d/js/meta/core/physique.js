// V2.1: player physique (height / weight) and PlayStyles. DOM-free, deterministic.
// Generated players derive these from their id with a private RNG, so the shared DB RNG sequence (and
// therefore every existing id/stat/save) is untouched. Real players carry hand-authored values.
import { Rng, clamp } from './rng.js';

// id -> [name, category, short code, description]
export const PLAYSTYLES = {
  finesse: ['Finesse Shot', 'attack', 'FS', 'Curled finesse shots are faster and more accurate.'],
  power: ['Power Shot', 'attack', 'PS', 'Power shots are faster and more accurate.'],
  chip: ['Chip Shot', 'attack', 'CS', 'Chip shots are more accurate and harder to read.'],
  deadball: ['Dead Ball', 'attack', 'DB', 'Free kicks and corners have more curve and accuracy.'],
  trivela: ['Trivela', 'attack', 'TV', 'Outside-of-the-foot passes and shots are more accurate.'],
  lowdriven: ['Low Driven Shot', 'attack', 'LD', 'Low driven shots are faster and more accurate.'],
  powerheader: ['Power Header', 'attack', 'PH', 'Headers are more powerful and accurate.'],
  acrobatic: ['Acrobatic', 'attack', 'AC', 'Volleys and bicycle kicks are more accurate.'],
  incisive: ['Incisive Pass', 'passing', 'IP', 'Through balls are faster and more accurate.'],
  tikitaka: ['Tiki Taka', 'passing', 'TT', 'Short first-time passes are more accurate.'],
  pinged: ['Pinged Pass', 'passing', 'PP', 'Driven passes travel faster and are more accurate.'],
  longball: ['Long Ball Pass', 'passing', 'LB', 'Long passes are more accurate.'],
  whipped: ['Whipped Pass', 'passing', 'WP', 'Crosses are faster and more accurate.'],
  firsttouch: ['First Touch', 'control', 'FT', 'Receiving the ball is cleaner, even at speed.'],
  technical: ['Technical', 'control', 'TE', 'Close control while dribbling at speed.'],
  rapid: ['Rapid', 'control', 'RA', 'Faster when sprinting with the ball.'],
  flair: ['Flair', 'control', 'FL', 'Flair passes and shots are more accurate.'],
  trickster: ['Trickster', 'control', 'TR', 'Skill moves are quicker and more effective.'],
  pressproven: ['Press Proven', 'control', 'PR', 'Keeps the ball better under pressure.'],
  anticipate: ['Anticipate', 'defending', 'AN', 'Standing tackles win the ball more often.'],
  intercept: ['Intercept', 'defending', 'IN', 'Reads and cuts out passes more often.'],
  block: ['Block', 'defending', 'BL', 'Blocks more shots and passes.'],
  jockey: ['Jockey', 'defending', 'JO', 'Moves faster while jockeying.'],
  slidetackle: ['Slide Tackle', 'defending', 'ST', 'Slide tackles win the ball more often.'],
  bruiser: ['Bruiser', 'defending', 'BR', 'Stronger in shoulder challenges and shielding.'],
  aerial: ['Aerial', 'defending', 'AE', 'Wins more aerial duels.'],
  quickstep: ['Quick Step', 'physical', 'QS', 'Faster acceleration when sprinting.'],
  relentless: ['Relentless', 'physical', 'RL', 'Recovers stamina faster.'],
  longthrow: ['Long Throw', 'physical', 'LT', 'Throw-ins travel much further.'],
  farreach: ['Far Reach', 'gk', 'FR', 'Wider diving reach.'],
  footwork: ['Footwork', 'gk', 'FW', 'Better saves with the feet and passing.'],
  rushout: ['Rush Out', 'gk', 'RO', 'Comes off the line quickly to close down.'],
  crossclaimer: ['Cross Claimer', 'gk', 'CC', 'Claims crosses more reliably.'],
  quickreflexes: ['Quick Reflexes', 'gk', 'QR', 'Reacts faster to close-range shots.'],
  deflector: ['Deflector', 'gk', 'DF', 'Parries shots away from danger.'],
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
  }
  if (['ST', 'CF'].includes(pos)) add('powerheader', height >= 186 ? 3 : height >= 181 ? 1 : 0.2);
  if (mid || att) {
    add('incisive', s.pas >= 80 ? 2 : 0.6); add('tikitaka', s.pas >= 78 ? 1.6 : 0.5); add('pinged', s.pas >= 75 ? 1.2 : 0.4);
    add('longball', ['CM', 'CDM'].includes(pos) ? 1.3 : 0.3); add('firsttouch', s.dri >= 78 ? 1.8 : 0.7); add('technical', s.dri >= 80 ? 2.2 : 0.6);
    add('flair', s.dri >= 82 ? 1 : 0.2); add('trickster', p.sm >= 4 ? 1.6 : 0.2); add('pressproven', s.dri >= 76 ? 1.2 : 0.5);
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
  if (Number.isFinite(p.height) && Number.isFinite(p.weight) && Array.isArray(p.playstyles)) return p;
  const g = genPhysique(p);
  if (!Number.isFinite(p.height)) p.height = g.height;
  if (!Number.isFinite(p.weight)) p.weight = g.weight;
  if (!Array.isArray(p.playstyles)) p.playstyles = g.playstyles;
  return p;
}

/** Parse authored style strings like 'finesse+' into [{id, plus}]. */
export function parseStyles(list) {
  return (list || []).map((s) => ({ id: s.replace(/\+$/, ''), plus: s.endsWith('+') }));
}

/** Contract-shaped physique for a Team player. */
export function matchPhysique(p) {
  ensurePhysique(p);
  return {
    height: Math.round(clamp(p.height / 100, 1.62, 2.02) * 100) / 100,
    weight: clamp(Math.round(p.weight), 58, 100),
    playstyles: p.playstyles.filter((x) => PLAYSTYLES[x.id]).slice(0, 4).map((x) => ({ id: x.id, plus: !!x.plus })),
  };
}

