// Evolutions: upgrade an eligible club card by completing match objectives with him in the XI.
// The evolved card is a new, untradeable card instance (`ev<n>_<rootId>`) stored in the UT save. DOM-free.
import { getPlayer, computeOvr, POS_WEIGHTS, FACE, GKFACE, tierOf, marketValue, registerLocalCard } from './players.js';
import { maxPlus } from './physique.js';
import { ALT_OPTIONS } from './formations.js';
import { clamp } from './rng.js';

const ATT = ['ST', 'CF', 'LW', 'RW', 'CAM'];
export const EVOLUTIONS = [
  { id: 'pace-merchant', name: 'Pace Merchant', desc: 'Turn a steady wide man into a sprinter.',
    req: { maxOvr: 82, max: { pac: 85 }, notPos: ['GK', 'CB'], noLotg: true },
    objectives: [{ t: 'matches', v: 3, label: 'Play 3 matches in the XI' }, { t: 'wins', v: 2, label: 'Win 2 matches' }],
    upgrade: { stats: { pac: 6, dri: 2 }, styles: ['rapid', 'quickstep'], label: '+6 PAC, +2 DRI, Rapid / Quick Step' } },
  { id: 'clinical', name: 'Clinical Finisher', desc: 'Sharpen an attacker in front of goal.',
    req: { maxOvr: 81, max: { sho: 82 }, pos: ATT, noLotg: true },
    objectives: [{ t: 'goals', v: 3, label: 'Score 3 goals with him' }, { t: 'wins', v: 2, label: 'Win 2 matches' }],
    upgrade: { stats: { sho: 5, phy: 2, dri: 1 }, styles: ['finesse', 'lowdriven'], wf: 1, label: '+5 SHO, +2 PHY, Finesse Shot, +1★ weak foot' } },
  { id: 'maestro', name: 'Midfield Maestro', desc: 'Pass-first midfielders become playmakers.',
    req: { maxOvr: 81, max: { pas: 84 }, pos: ['CM', 'CAM', 'CDM', 'LM', 'RM'], noLotg: true },
    objectives: [{ t: 'matches', v: 3, label: 'Play 3 matches in the XI' }, { t: 'assists', v: 2, label: 'Assist 2 goals (or win 3)' }],
    upgrade: { stats: { pas: 5, dri: 3 }, styles: ['tikitaka', 'incisive'], addPos: true, label: '+5 PAS, +3 DRI, Tiki Taka, new position' } },
  { id: 'the-wall', name: 'The Wall', desc: 'Build an unbeatable defender.',
    req: { maxOvr: 80, max: { def: 82 }, pos: ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM'], noLotg: true },
    objectives: [{ t: 'matches', v: 3, label: 'Play 3 matches in the XI' }, { t: 'cleanSheets', v: 1, label: 'Keep a clean sheet' }],
    upgrade: { stats: { def: 5, phy: 3, pac: 1 }, styles: ['anticipate', 'bruiser', 'aerial'], label: '+5 DEF, +3 PHY, Anticipate / Bruiser' } },
  { id: 'safe-hands', name: 'Safe Hands', desc: 'A keeper the fans can trust.',
    req: { maxOvr: 80, pos: ['GK'] },
    objectives: [{ t: 'matches', v: 3, label: 'Play 3 matches in goal' }, { t: 'wins', v: 2, label: 'Win 2 matches' }],
    upgrade: { gk: 4, styles: ['quickreflexes', 'farreach'], label: '+4 all GK stats, Quick Reflexes' } },
  { id: 'rising', name: 'Rising Star', desc: 'Bronze and silver cards step up to gold.',
    req: { maxOvr: 74, noSpecial: true },
    objectives: [{ t: 'matches', v: 2, label: 'Play 2 matches in the XI' }, { t: 'wins', v: 1, label: 'Win a match' }],
    upgrade: { all: 5, styles: [], addPos: true, label: '+5 to key stats, new position' } },
];
export const EVO_BY_ID = Object.fromEntries(EVOLUTIONS.map((e) => [e.id, e]));
export const MAX_ACTIVE = 3;

export function ensureEvo(state) {
  if (!state.evo || typeof state.evo !== 'object') state.evo = { active: [], used: {}, n: 0 };
  state.evolved = state.evolved || {};
  return state.evo;
}

/** [ok, reasons[]] */
export function eligibility(p, evo) {
  const r = evo.req, why = [];
  if (!p) return [false, ['Unknown player']];
  if (r.maxOvr && p.ovr > r.maxOvr) why.push(`OVR ≤ ${r.maxOvr}`);
  for (const [k, v] of Object.entries(r.max || {})) if (p.stats[k] > v) why.push(`${k.toUpperCase()} ≤ ${v}`);
  if (r.pos && !r.pos.includes(p.pos)) why.push(`Position: ${r.pos.join('/')}`);
  if (r.notPos && r.notPos.includes(p.pos)) why.push(`Not ${r.notPos.join('/')}`);
  if (r.noLotg && p.special === 'lotg') why.push('No Legends of the Game');
  if (r.noSpecial && p.special) why.push('No special cards');
  if ((p.evo || 0) >= 3) why.push('Max 3 evolutions per card');
  return [!why.length, why];
}

export function startEvolution(state, evoId, pid) {
  const ev = ensureEvo(state);
  const evo = EVO_BY_ID[evoId];
  if (!evo) return { ok: false, error: 'Unknown evolution' };
  if (!state.club.includes(pid)) return { ok: false, error: 'Player not in your club' };
  if (ev.used[evoId]) return { ok: false, error: 'Evolution already used' };
  if (ev.active.length >= MAX_ACTIVE) return { ok: false, error: `Max ${MAX_ACTIVE} active evolutions` };
  if (ev.active.some((a) => a.pid === pid)) return { ok: false, error: 'Player already evolving' };
  const [ok, why] = eligibility(getPlayer(pid), evo);
  if (!ok) return { ok: false, error: `Not eligible: ${why.join(', ')}` };
  ev.active.push({ evoId, pid, prog: {} });
  ev.used[evoId] = true;
  return { ok: true };
}

export function evoProgress(a, o) { return Math.min(o.v, a.prog[o.t] || 0); }
export function evoComplete(a) {
  const evo = EVO_BY_ID[a.evoId];
  return evo.objectives.every((o) => evoProgress(a, o) >= o.v || (o.t === 'assists' && (a.prog.wins || 0) >= 3));
}

/** Feed a UT match (userMatchStats output) into active evolutions. */
export function recordEvoMatch(state, m) {
  const ev = ensureEvo(state);
  for (const a of ev.active) {
    if (!m.starters.includes(a.pid)) continue;
    const s = m.stats[a.pid] || {};
    a.prog.matches = (a.prog.matches || 0) + 1;
    if (m.outcome === 'W') a.prog.wins = (a.prog.wins || 0) + 1;
    if (m.cleanSheet) a.prog.cleanSheets = (a.prog.cleanSheets || 0) + 1;
    a.prog.goals = (a.prog.goals || 0) + (s.goals || 0);
    a.prog.assists = (a.prog.assists || 0) + (s.assists || 0);
  }
}

/** Build an upgraded copy of `base` (shared by evolutions and position modifiers). */
export function evolveCard(state, base, { stats = {}, gk = 0, all = 0, styles = [], wf = 0, addPos = null, name = 'Evolution' }) {
  const ev = ensureEvo(state);
  const root = base.evoRoot || base.id;
  ev.n = (ev.n || 0) + 1;
  const p = structuredClone(base);
  p.id = `ev${ev.n}_${root}`.slice(0, 60);
  p.evoRoot = root;
  p.baseId = base.baseId || base.id;
  if (p.pos === 'GK') { const d = gk || all; if (d) for (const k of GKFACE) p.gk[k] = clamp(p.gk[k] + d, 1, 99); }
  else {
    for (const [k, v] of Object.entries(stats)) p.stats[k] = clamp(p.stats[k] + v, 1, 99);
    if (all) FACE.forEach((k, i) => { if (POS_WEIGHTS[p.pos][i] > 0.04) p.stats[k] = clamp(p.stats[k] + all, 1, 99); });
    if (!gk) p.gk.spd = p.stats.pac;
  }
  p.ovr = computeOvr(p.pos, p);
  p.pot = Math.max(p.pot, p.ovr);
  if (!p.special) p.tier = tierOf(p.ovr);
  p.rare = true;
  p.wf = clamp((p.wf || 3) + wf, 1, 5);
  p.playstyles = (p.playstyles || []).map((x) => ({ ...x }));
  for (const sid of styles) {
    const have = p.playstyles.find((x) => x.id === sid);
    if (have) {
      if (!have.plus && p.playstyles.filter((x) => x.plus).length < maxPlus(p.ovr)) { have.plus = true; break; }
      continue;
    }
    if (p.playstyles.length < 4) { p.playstyles.push({ id: sid, plus: false }); break; }
  }
  if (addPos) {
    const opts = addPos === true ? (ALT_OPTIONS[p.pos] || []).filter((x) => !(p.alt || []).includes(x)) : [addPos];
    if (opts[0] && (p.alt || []).length < 3 && !p.alt.includes(opts[0]) && opts[0] !== p.pos) p.alt = (p.alt || []).concat(opts[0]);
  }
  p.evo = (base.evo || 0) + 1;
  p.evoNames = (base.evoNames || []).concat(name);
  p.value = marketValue(p);
  return p;
}

/** Swap `oldId` for the new card everywhere in the club/squad. */
export function replaceCard(state, oldId, card) {
  registerLocalCard(card);
  state.evolved[card.id] = card;
  if (state.evolved[oldId]) delete state.evolved[oldId];
  state.club = state.club.map((x) => (x === oldId ? card.id : x));
  state.squad.slots = state.squad.slots.map((x) => (x === oldId ? card.id : x));
  state.squad.bench = state.squad.bench.map((x) => (x === oldId ? card.id : x));
  state.untradeable = (state.untradeable || []).filter((x) => x !== oldId);
  state.untradeable.push(card.id);
}

/** Apply a completed evolution. Returns the new card. */
export function claimEvolution(state, idx) {
  const ev = ensureEvo(state);
  const a = ev.active[idx];
  if (!a || !evoComplete(a)) return null;
  const base = getPlayer(a.pid);
  if (!base || !state.club.includes(a.pid)) { ev.active.splice(idx, 1); return null; }
  const evo = EVO_BY_ID[a.evoId];
  const card = evolveCard(state, base, { ...evo.upgrade, name: evo.name });
  replaceCard(state, a.pid, card);
  ev.active.splice(idx, 1);
  return card;
}

export function cancelEvolution(state, idx) {
  const ev = ensureEvo(state);
  const a = ev.active[idx];
  if (!a) return false;
  ev.active.splice(idx, 1);
  delete ev.used[a.evoId];
  return true;
}

/** Position Modifier consumable: add an alternate position (new untradeable card). */
export function applyPositionModifier(state, pid, pos) {
  state.items = state.items || {};
  if (!(state.items.posmod > 0)) return { ok: false, error: 'No Position Modifiers left' };
  const base = getPlayer(pid);
  if (!base || !state.club.includes(pid)) return { ok: false, error: 'Player not in your club' };
  if (base.pos === 'GK' || pos === 'GK') return { ok: false, error: 'Goalkeepers cannot change position' };
  if (base.pos === pos || (base.alt || []).includes(pos)) return { ok: false, error: 'Already plays there' };
  if ((base.alt || []).length >= 3) return { ok: false, error: 'Max 3 alternate positions' };
  const card = evolveCard(state, base, { addPos: pos, name: `Position: ${pos}` });
  card.evo = base.evo || 0; // a modifier is not an evolution level
  card.evoNames = base.evoNames || [];
  replaceCard(state, pid, card);
  state.items.posmod--;
  return { ok: true, card };
}
