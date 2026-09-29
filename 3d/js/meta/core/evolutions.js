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
    objectives: [], instant: true, // no matches needed (owner, Sep 29: matches don't run on Chromebooks yet)
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
    objectives: [], instant: true, // no matches needed (owner, Sep 29: matches don't run on Chromebooks yet)
    upgrade: { stats: { def: 5, phy: 3, pac: 1 }, styles: ['anticipate', 'bruiser', 'aerial'], label: '+5 DEF, +3 PHY, Anticipate / Bruiser' } },
  { id: 'safe-hands', name: 'Safe Hands', desc: 'A keeper the fans can trust.',
    req: { maxOvr: 80, pos: ['GK'] },
    objectives: [{ t: 'matches', v: 3, label: 'Play 3 matches in goal' }, { t: 'wins', v: 2, label: 'Win 2 matches' }],
    upgrade: { gk: 4, styles: ['quickreflexes', 'farreach'], label: '+4 all GK stats, Quick Reflexes' } },
  { id: 'rising', name: 'Rising Star', desc: 'Bronze and silver cards step up to gold.',
    req: { maxOvr: 74, noSpecial: true },
    objectives: [], instant: true, // no matches needed (owner, Sep 29: matches don't run on Chromebooks yet)
    upgrade: { all: 5, styles: [], addPos: true, label: '+5 to key stats, new position' } },
  // Elite evolutions (owner request, Sep 29): 15 more that take any card rated up to 98, promos included.
  { id: 'elite-pace', name: 'Lightning Legs', desc: 'Even the quickest can find another gear.',
    req: { maxOvr: 98, max: { pac: 97 }, notPos: ['GK'] },
    objectives: [{ t: 'matches', v: 4, label: 'Play 4 matches in the XI' }, { t: 'wins', v: 3, label: 'Win 3 matches' }],
    upgrade: { stats: { pac: 3, dri: 2 }, styles: ['rapid', 'quickstep'], label: '+3 PAC, +2 DRI, Rapid' } },
  { id: 'elite-finisher', name: 'Golden Boot', desc: 'Turn a top forward into the league\'s top scorer.',
    req: { maxOvr: 98, pos: ATT },
    objectives: [{ t: 'goals', v: 5, label: 'Score 5 goals with him' }, { t: 'wins', v: 3, label: 'Win 3 matches' }],
    upgrade: { stats: { sho: 3, phy: 1 }, styles: ['finesse', 'power'], wf: 1, label: '+3 SHO, +1 PHY, Finesse Shot, +1★ weak foot' } },
  { id: 'elite-playmaker', name: 'Orchestrator', desc: 'The midfielder every move goes through.',
    req: { maxOvr: 98, pos: ['CM', 'CAM', 'CDM', 'LM', 'RM'] },
    objectives: [{ t: 'matches', v: 4, label: 'Play 4 matches in the XI' }, { t: 'assists', v: 3, label: 'Assist 3 goals (or win 3)' }],
    upgrade: { stats: { pas: 3, dri: 2 }, styles: ['incisive', 'tikitaka'], label: '+3 PAS, +2 DRI, Incisive Pass' } },
  { id: 'elite-wall', name: 'Iron Curtain', desc: 'A defender nobody gets past.',
    req: { maxOvr: 98, pos: ['CB', 'LB', 'RB', 'LWB', 'RWB'] },
    objectives: [{ t: 'matches', v: 4, label: 'Play 4 matches in the XI' }, { t: 'cleanSheets', v: 2, label: 'Keep 2 clean sheets' }],
    upgrade: { stats: { def: 3, phy: 2 }, styles: ['intercept', 'block'], label: '+3 DEF, +2 PHY, Intercept' } },
  { id: 'elite-keeper', name: 'Last Line', desc: 'A keeper who wins you points on his own.',
    req: { maxOvr: 98, pos: ['GK'] },
    objectives: [], instant: true, // no matches needed (owner, Sep 29: matches don't run on Chromebooks yet)
    upgrade: { gk: 3, styles: ['farreach', 'quickreflexes'], label: '+3 all GK stats, Far Reach' } },
  { id: 'elite-dribbler', name: 'Street Magic', desc: 'Close control that leaves defenders on the floor.',
    req: { maxOvr: 98, max: { dri: 97 }, notPos: ['GK', 'CB'] },
    objectives: [], instant: true, // no matches needed (owner, Sep 29: matches don't run on Chromebooks yet)
    upgrade: { stats: { dri: 3, pac: 1 }, styles: ['technical', 'trickster'], label: '+3 DRI, +1 PAC, Technical' } },
  { id: 'elite-engine', name: 'Box to Box', desc: 'Up and down the pitch for ninety minutes.',
    req: { maxOvr: 98, pos: ['CM', 'CDM', 'CAM'] },
    objectives: [{ t: 'matches', v: 5, label: 'Play 5 matches in the XI' }, { t: 'wins', v: 3, label: 'Win 3 matches' }],
    upgrade: { all: 2, styles: ['relentless'], label: '+2 to key stats, Relentless' } },
  { id: 'elite-aerial', name: 'Sky High', desc: 'Wins every ball in the air, at both ends.',
    req: { maxOvr: 98, pos: ['CB', 'ST', 'CF'] },
    objectives: [{ t: 'matches', v: 4, label: 'Play 4 matches in the XI' }, { t: 'wins', v: 2, label: 'Win 2 matches' }],
    upgrade: { stats: { phy: 3, sho: 1, def: 1 }, styles: ['aerial', 'powerheader'], label: '+3 PHY, +1 SHO, +1 DEF, Aerial' } },
  { id: 'elite-fullback', name: 'Overlap', desc: 'A full-back who attacks like a winger.',
    req: { maxOvr: 98, pos: ['LB', 'RB', 'LWB', 'RWB'] },
    objectives: [{ t: 'matches', v: 4, label: 'Play 4 matches in the XI' }, { t: 'assists', v: 2, label: 'Assist 2 goals (or win 3)' }],
    upgrade: { stats: { pac: 2, pas: 2, def: 1 }, styles: ['whipped'], addPos: true, label: '+2 PAC, +2 PAS, +1 DEF, Whipped Pass, new position' } },
  { id: 'elite-winger', name: 'Touchline Terror', desc: 'Pace and tricks down the flank.',
    req: { maxOvr: 98, pos: ['LW', 'RW', 'LM', 'RM'] },
    objectives: [{ t: 'goals', v: 2, label: 'Score 2 goals with him' }, { t: 'wins', v: 2, label: 'Win 2 matches' }],
    upgrade: { stats: { pac: 2, dri: 2, sho: 1 }, styles: ['flair'], label: '+2 PAC, +2 DRI, +1 SHO, Flair' } },
  { id: 'elite-deadball', name: 'Set Piece Master', desc: 'Free kicks and corners become chances.',
    req: { maxOvr: 98, notPos: ['GK'] },
    objectives: [{ t: 'matches', v: 4, label: 'Play 4 matches in the XI' }, { t: 'goals', v: 2, label: 'Score 2 goals with him' }],
    upgrade: { stats: { sho: 2, pas: 2 }, styles: ['deadball'], wf: 1, label: '+2 SHO, +2 PAS, Dead Ball, +1★ weak foot' } },
  { id: 'elite-captain', name: 'Captain\'s Armband', desc: 'The leader your club builds around.',
    req: { maxOvr: 98 },
    objectives: [], instant: true, // no matches needed (owner, Sep 29: matches don't run on Chromebooks yet)
    upgrade: { all: 2, styles: ['pressproven'], label: '+2 to key stats, Press Proven' } },
  { id: 'elite-sweeper', name: 'Sweeper Keeper', desc: 'A keeper who plays like an extra defender.',
    req: { maxOvr: 98, pos: ['GK'] },
    objectives: [{ t: 'matches', v: 3, label: 'Play 3 matches in goal' }, { t: 'wins', v: 3, label: 'Win 3 matches' }],
    upgrade: { gk: 2, styles: ['rushout', 'footwork'], label: '+2 all GK stats, Rush Out' } },
  { id: 'elite-anchor', name: 'Midfield Anchor', desc: 'Sits in front of the back line and breaks up play.',
    req: { maxOvr: 98, pos: ['CDM', 'CM', 'CB'] },
    objectives: [{ t: 'matches', v: 4, label: 'Play 4 matches in the XI' }, { t: 'cleanSheets', v: 1, label: 'Keep a clean sheet' }],
    upgrade: { stats: { def: 3, phy: 2, pas: 1 }, styles: ['anticipate', 'enforcer'], label: '+3 DEF, +2 PHY, +1 PAS, Anticipate' } },
  { id: 'elite-prime', name: 'Peak Prime', desc: 'One last push to the very top.',
    req: { maxOvr: 98 },
    objectives: [{ t: 'matches', v: 6, label: 'Play 6 matches in the XI' }, { t: 'wins', v: 4, label: 'Win 4 matches' }],
    upgrade: { all: 3, styles: ['gamechanger'], addPos: true, label: '+3 to key stats, Game Changer, new position' } },
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
