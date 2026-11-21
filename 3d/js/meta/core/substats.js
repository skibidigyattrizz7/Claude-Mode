// FC-style detailed attributes ("sub-stats") for the card details view (owner request, Sep 27: show ALL
// attributes). Game stats, not personal info: derived deterministically from the six face stats (+ position and
// physique) with a private per-player RNG, and re-centred so every group still averages to its face stat — the
// face stats themselves (and therefore OVR, chemistry, the sim) are untouched. DOM-free.
import { Rng, clamp } from './rng.js';

export const SUBSTAT_GROUPS = {
  pac: ['Pace', [['acc', 'Acceleration'], ['spr', 'Sprint Speed']]],
  sho: ['Shooting', [['att', 'Positioning'], ['fin', 'Finishing'], ['spw', 'Shot Power'], ['lsh', 'Long Shots'], ['vol', 'Volleys'], ['pen', 'Penalties']]],
  pas: ['Passing', [['vis', 'Vision'], ['cro', 'Crossing'], ['fka', 'FK Accuracy'], ['spa', 'Short Passing'], ['lpa', 'Long Passing'], ['cur', 'Curve']]],
  dri: ['Dribbling', [['agi', 'Agility'], ['bal', 'Balance'], ['rea', 'Reactions'], ['bct', 'Ball Control'], ['drb', 'Dribbling'], ['com', 'Composure']]],
  def: ['Defending', [['int', 'Interceptions'], ['hea', 'Heading Accuracy'], ['awr', 'Def. Awareness'], ['stt', 'Standing Tackle'], ['slt', 'Sliding Tackle']]],
  phy: ['Physical', [['jum', 'Jumping'], ['sta', 'Stamina'], ['str', 'Strength'], ['agg', 'Aggression']]],
};
export const GK_GROUPS = {
  div: ['Diving', [['gkd', 'GK Diving']]],
  han: ['Handling', [['gkh', 'GK Handling']]],
  kic: ['Kicking', [['gkk', 'GK Kicking'], ['lpa', 'Long Passing']]],
  ref: ['Reflexes', [['gkr', 'GK Reflexes'], ['rea', 'Reactions']]],
  spd: ['Speed', [['acc', 'Acceleration'], ['spr', 'Sprint Speed']]],
  pos: ['Positioning', [['gkp', 'GK Positioning'], ['com', 'Composure']]],
};

const ATT = new Set(['ST', 'CF', 'LW', 'RW', 'CAM', 'LM', 'RM']);
const DEFP = new Set(['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM']);

/** Systematic (non-random) leanings per sub-stat: physique and role. */
function bias(p, key) {
  const h = Number.isFinite(p.height) ? p.height : 180, w = Number.isFinite(p.weight) ? p.weight : 75;
  const tall = (h - 180) / 10, heavy = (w - 75) / 10;
  switch (key) {
    case 'acc': return -tall * 3;
    case 'spr': return tall * 2;
    case 'agi': case 'bal': return -tall * 4;
    case 'jum': case 'hea': return tall * 4;
    case 'str': return heavy * 4 + tall * 2;
    case 'sta': return DEFP.has(p.pos) || p.pos === 'CM' ? 3 : 0;
    case 'fin': case 'att': return ATT.has(p.pos) ? 3 : -3;
    case 'awr': case 'int': return DEFP.has(p.pos) ? 3 : -3;
    case 'cro': return ['LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW'].includes(p.pos) ? 4 : -2;
    case 'pen': case 'fka': return (p.playstyles || []).some((x) => x.id === 'deadball') ? 5 : 0;
    case 'cur': return (p.playstyles || []).some((x) => x.id === 'finesse') ? 4 : 0;
    case 'spw': return (p.playstyles || []).some((x) => x.id === 'power') ? 4 : 0;
    default: return 0;
  }
}

/**
 * Detailed attributes for a card, grouped under its six face stats:
 *   [{ key, label, value (face stat), subs: [{ key, label, value }] }]
 * Deterministic per base card (same numbers for every version/promo of the same base unless its face stats differ).
 */
export function subStats(p) {
  if (!p) return [];
  const isGK = p.pos === 'GK';
  const groups = isGK ? GK_GROUPS : SUBSTAT_GROUPS;
  const face = (isGK ? p.gk : p.stats) || {};
  const rng = new Rng(`sub-${p.baseId || p.person || p.id}`);
  return Object.entries(groups).map(([k, [label, subs]]) => {
    const v = clamp(Math.round(Number(face[k]) || 0), 1, 99 * 10);
    const raw = subs.map(([sk]) => bias(p, sk) + rng.int(-5, 5));
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const base = Math.min(v, 99);
    return {
      key: k, label, value: v,
      subs: subs.map(([sk, sl], i) => ({ key: sk, label: sl, value: subs.length === 1 ? base : clamp(Math.round(base + raw[i] - mean), 1, 99) })),
    };
  });
}
