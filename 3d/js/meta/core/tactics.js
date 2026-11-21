// V2.2 Custom Tactics (docs/3D_CONTRACT.md "V2.2 tactics"). DOM-free.
// Every Team built by the meta layer carries a sanitised `tactics` object; AI sides get one by style.
import { hashStr, clamp } from './rng.js';

export const DEFENSIVE_STYLES = [['balanced', 'Balanced'], ['pressAfterLoss', 'Press after possession loss'], ['constantPressure', 'Constant pressure'], ['dropBack', 'Drop back']];
export const BUILD_UPS = [['balanced', 'Balanced'], ['shortPassing', 'Short passing'], ['longBall', 'Long ball'], ['counter', 'Fast build-up (counter)']];
export const CHANCE_CREATION = [['balanced', 'Balanced'], ['possession', 'Possession'], ['directPassing', 'Direct passing'], ['forwardRuns', 'Forward runs']];
export const INSTRUCTIONS = {
  attack: [['balanced', 'Balanced'], ['stayForward', 'Stay forward'], ['getInBehind', 'Get in behind'], ['comeShort', 'Come short']],
  defend: [['balanced', 'Balanced'], ['stayBack', 'Stay back'], ['cutPasses', 'Cut passing lanes'], ['markPlayer', 'Man-mark']],
  support: [['balanced', 'Balanced'], ['stayWide', 'Stay wide'], ['cutInside', 'Cut inside'], ['overlap', 'Overlap'], ['stayBack', 'Stay back while attacking']],
};
/** Which instruction groups make sense for a position. */
export function instructionGroups(pos) {
  if (pos === 'GK') return [];
  if (['CB'].includes(pos)) return ['attack', 'defend'];
  if (['LB', 'RB', 'LWB', 'RWB'].includes(pos)) return ['support', 'defend'];
  if (['LM', 'RM', 'LW', 'RW'].includes(pos)) return ['attack', 'support', 'defend'];
  if (['ST', 'CF'].includes(pos)) return ['attack', 'defend'];
  return ['attack', 'support', 'defend'];
}

const ONE = (list, v, d) => (list.some((x) => x[0] === v) ? v : d);
const INT = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : d);

const BASE = { defensiveStyle: 'balanced', width: 5, depth: 5, buildUp: 'balanced', chanceCreation: 'balanced', playersInBox: 5, corners: 3, freeKicks: 3 };

/** Premade presets (name, short description, fields). */
export const PRESETS = {
  balanced: { name: 'Balanced', desc: 'Sensible defaults for any squad.', t: { ...BASE } },
  gegenpress: { name: 'Gegenpress', desc: 'Win it back high and fast after losing the ball.', t: { defensiveStyle: 'pressAfterLoss', width: 6, depth: 8, buildUp: 'counter', chanceCreation: 'forwardRuns', playersInBox: 6, corners: 3, freeKicks: 3 } },
  tikitaka: { name: 'Tiki-Taka', desc: 'Short passing, patient possession, compact shape.', t: { defensiveStyle: 'constantPressure', width: 4, depth: 7, buildUp: 'shortPassing', chanceCreation: 'possession', playersInBox: 4, corners: 2, freeKicks: 2 } },
  parkthebus: { name: 'Park the Bus', desc: 'Deep, narrow block. Hit long when you win it.', t: { defensiveStyle: 'dropBack', width: 3, depth: 2, buildUp: 'longBall', chanceCreation: 'directPassing', playersInBox: 3, corners: 2, freeKicks: 2 } },
  counter: { name: 'Counter Attack', desc: 'Sit in a mid block, break with pace.', t: { defensiveStyle: 'dropBack', width: 5, depth: 4, buildUp: 'counter', chanceCreation: 'forwardRuns', playersInBox: 5, corners: 3, freeKicks: 3 } },
  wingplay: { name: 'Wing Play', desc: 'Stretch the pitch and cross early.', t: { defensiveStyle: 'balanced', width: 8, depth: 5, buildUp: 'balanced', chanceCreation: 'directPassing', playersInBox: 7, corners: 4, freeKicks: 3 } },
  allout: { name: 'All-Out Attack', desc: 'Chasing a goal: bodies forward, press everywhere.', t: { defensiveStyle: 'constantPressure', width: 7, depth: 9, buildUp: 'shortPassing', chanceCreation: 'forwardRuns', playersInBox: 9, corners: 5, freeKicks: 5 } },
};
export const PRESET_IDS = Object.keys(PRESETS);

export function defaultTactics() { return { ...BASE, instructions: {}, quick: [], setPieceTakers: {} }; }

/** Core fields only (used for quick-tactic presets). */
function coreFields(t) {
  const x = t || {};
  return {
    defensiveStyle: ONE(DEFENSIVE_STYLES, x.defensiveStyle, BASE.defensiveStyle),
    width: INT(x.width, 1, 10, BASE.width), depth: INT(x.depth, 1, 10, BASE.depth),
    buildUp: ONE(BUILD_UPS, x.buildUp, BASE.buildUp), chanceCreation: ONE(CHANCE_CREATION, x.chanceCreation, BASE.chanceCreation),
    playersInBox: INT(x.playersInBox, 1, 10, BASE.playersInBox), corners: INT(x.corners, 1, 5, BASE.corners), freeKicks: INT(x.freeKicks, 1, 5, BASE.freeKicks),
  };
}

/**
 * Validate a tactics object against the contract. `ids` (optional) = player ids on the team:
 * instructions / set-piece takers for other players are dropped.
 */
export function sanitizeTactics(t, ids = null) {
  const x = t && typeof t === 'object' ? t : {};
  const out = coreFields(x);
  const ok = (id) => typeof id === 'string' && (!ids || ids.includes(id));
  out.instructions = {};
  for (const [id, ins] of Object.entries(x.instructions || {})) {
    if (!ok(id) || !ins || typeof ins !== 'object') continue;
    const o = {};
    for (const g of ['attack', 'defend', 'support']) if (ins[g] && INSTRUCTIONS[g].some((e) => e[0] === ins[g]) && ins[g] !== 'balanced') o[g] = ins[g];
    if (Object.keys(o).length) out.instructions[id] = o;
  }
  out.quick = (Array.isArray(x.quick) ? x.quick : []).filter(Boolean).slice(0, 4).map(coreFields);
  out.setPieceTakers = {};
  for (const k of ['fk', 'pen', 'cornerL', 'cornerR', 'captain']) { const v = x.setPieceTakers && x.setPieceTakers[k]; if (ok(v)) out.setPieceTakers[k] = v; }
  return out;
}

export function presetTactics(id) {
  const p = PRESETS[id] || PRESETS.balanced;
  return { ...defaultTactics(), ...p.t };
}

/** Default quick tactics: attacking / balanced / defensive / all-out (bound to in-match quick keys). */
export function defaultQuick() { return ['allout', 'gegenpress', 'balanced', 'parkthebus'].map((id) => ({ ...PRESETS[id].t })); }

/** Pick set-piece takers and a captain from contract match players (or DB players). */
export function autoSetPieceTakers(players) {
  const list = (players || []).filter((p) => p && p.pos !== 'GK');
  const A = (p, k) => (p.attrs ? p.attrs[k] : p.stats ? p.stats[k] : 50) || 50;
  const has = (p, id) => (p.playstyles || []).some((x) => x.id === id);
  const best = (score) => { let b = null, bs = -Infinity; for (const p of list) { const s = score(p); if (s > bs) { bs = s; b = p; } } return b ? b.id : undefined; };
  const fk = best((p) => A(p, 'sho') * 0.5 + A(p, 'pas') * 0.5 + (has(p, 'deadball') ? 12 : 0));
  const pen = best((p) => A(p, 'sho') + (has(p, 'finesse') || has(p, 'power') ? 4 : 0));
  const corner = best((p) => A(p, 'pas') + (has(p, 'whipped') ? 8 : 0) + (has(p, 'deadball') ? 6 : 0));
  const all = (players || []).filter(Boolean);
  const cap = all.slice().sort((a, b) => (b.ovr || 0) - (a.ovr || 0))[0];
  const out = {};
  if (fk) out.fk = fk; if (pen) out.pen = pen; if (corner) { out.cornerL = corner; out.cornerR = corner; }
  if (cap) out.captain = cap.id;
  return out;
}

/** Sensible AI tactics by team identity + strength (deterministic). */
export function aiTactics(teamId, formation, rating = 75) {
  const h = hashStr(`tac-${teamId}`);
  let pool;
  if (rating >= 84) pool = ['tikitaka', 'gegenpress', 'balanced', 'wingplay'];
  else if (rating >= 76) pool = ['balanced', 'gegenpress', 'wingplay', 'counter', 'tikitaka'];
  else pool = ['counter', 'parkthebus', 'balanced', 'wingplay'];
  if (formation === '3-5-2') pool = pool.concat(['wingplay']);
  if (formation === '4-1-2-1-2') pool = pool.concat(['tikitaka']);
  const id = pool[h % pool.length];
  const t = presetTactics(id);
  // small per-team variation so AI sides don't feel identical
  t.width = clamp(t.width + ((h >> 4) % 3) - 1, 1, 10);
  t.depth = clamp(t.depth + ((h >> 7) % 3) - 1, 1, 10);
  t.quick = defaultQuick();
  t.style = id;
  return t;
}

// ---------- saved tactic sets (UT club / career save) ----------
export const MAX_TACTIC_SETS = 8;
/** Make sure `holder.tacticSets` / `holder.activeTactic` exist. */
export function ensureTacticSets(holder) {
  if (!Array.isArray(holder.tacticSets) || !holder.tacticSets.length) {
    holder.tacticSets = [{ id: 't1', name: 'Balanced', t: { ...presetTactics('balanced'), quick: defaultQuick() } }];
    holder.activeTactic = 't1';
  }
  if (!holder.tacticSets.some((x) => x.id === holder.activeTactic)) holder.activeTactic = holder.tacticSets[0].id;
  return holder.tacticSets;
}
export function activeTactics(holder) {
  ensureTacticSets(holder);
  return holder.tacticSets.find((x) => x.id === holder.activeTactic).t;
}
export function addTacticSet(holder, name, t) {
  ensureTacticSets(holder);
  if (holder.tacticSets.length >= MAX_TACTIC_SETS) return null;
  let n = holder.tacticSets.length + 1;
  while (holder.tacticSets.some((x) => x.id === `t${n}`)) n++;
  const id = `t${n}`;
  holder.tacticSets.push({ id, name: String(name || `Tactic ${n}`).slice(0, 24), t: sanitizeTactics(t) });
  holder.activeTactic = id;
  return id;
}
export function removeTacticSet(holder, id) {
  ensureTacticSets(holder);
  if (holder.tacticSets.length <= 1) return false;
  holder.tacticSets = holder.tacticSets.filter((x) => x.id !== id);
  ensureTacticSets(holder);
  return true;
}
