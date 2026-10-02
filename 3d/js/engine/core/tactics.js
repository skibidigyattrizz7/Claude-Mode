// Team tactics (V2.2 contract): normalisation with defaults, live changes (quick tactics,
// mentality, formation, position swaps, substitutions) applied by the host sim. DOM-free.
import { clamp } from './mathx.js';
import { FORMATIONS, assignSlots, roleGroup } from './formations.js';

const ENUMS = {
  defensiveStyle: ['balanced', 'pressAfterLoss', 'constantPressure', 'dropBack'],
  buildUp: ['balanced', 'shortPassing', 'longBall', 'counter'],
  chanceCreation: ['balanced', 'possession', 'directPassing', 'forwardRuns'],
};
const RANGES = { width: [1, 10, 5], depth: [1, 10, 5], playersInBox: [1, 10, 5], corners: [1, 5, 3], freeKicks: [1, 5, 3] };
export const MENTALITY = ['ULTRA DEFENSIVE', 'DEFENSIVE', 'BALANCED', 'ATTACKING', 'ULTRA ATTACKING'];

export function normTactics(t) {
  const o = { defensiveStyle: 'balanced', buildUp: 'balanced', chanceCreation: 'balanced', width: 5, depth: 5, playersInBox: 5, corners: 3, freeKicks: 3, instructions: {}, quick: [], setPieceTakers: {}, mentality: 0 };
  if (!t || typeof t !== 'object') return o;
  for (const k in ENUMS) if (ENUMS[k].includes(t[k])) o[k] = t[k];
  for (const k in RANGES) if (Number.isFinite(+t[k])) o[k] = clamp(Math.round(+t[k]), RANGES[k][0], RANGES[k][1]);
  if (t.instructions && typeof t.instructions === 'object') {
    for (const id in t.instructions) {
      const ins = t.instructions[id];
      if (ins && typeof ins === 'object') o.instructions[id] = { attack: ins.attack || 'balanced', defend: ins.defend || 'balanced', support: ins.support || 'balanced' };
    }
  }
  if (Array.isArray(t.quick)) o.quick = t.quick.slice(0, 4).filter((q) => q && typeof q === 'object');
  if (t.setPieceTakers && typeof t.setPieceTakers === 'object') o.setPieceTakers = { ...t.setPieceTakers };
  if (Number.isFinite(+t.mentality)) o.mentality = clamp(Math.round(+t.mentality), -2, 2);
  return o;
}

// instruction of player p ('attack' | 'defend' | 'support')
export function instr(sim, p, key) {
  const t = sim.tac && sim.tac[p.team];
  const ins = t && t.instructions[p.data.id];
  return (ins && ins[key]) || 'balanced';
}

// Re-map every player to a (new) formation's slots.
export function setFormation(sim, team, formation) {
  if (!FORMATIONS[formation]) return false;
  const list = sim.players.slice(team * 11, team * 11 + 11);
  const slotOf = assignSlots(list.map((p) => ({ pos: p.data.pos || 'CM' })), formation);
  const form = FORMATIONS[formation];
  list.forEach((p, i) => {
    const slot = slotOf[i] ?? i;
    p.slot = slot; p.sd = form[slot]; p.role = p.sd.r; p.group = roleGroup(p.sd.r); p.isGK = slot === 0;
  });
  sim.formation[team] = formation;
  return true;
}

// Swap the formation slots of two outfield players (by slot index i within the team, 1..10).
export function swapPositions(sim, team, i, j) {
  const a = sim.players[team * 11 + i], b = sim.players[team * 11 + j];
  if (!a || !b || a.isGK || b.isGK || a === b) return false;
  for (const k of ['slot', 'sd', 'role', 'group']) { const v = a[k]; a[k] = b[k]; b[k] = v; }
  return true;
}

/**
 * Apply a tactics command from a local menu / hotkey or a remote side (net `tac` field).
 * cmd: {k:'quick', i} | {k:'ment', d:+1|-1} | {k:'set', tactics} | {k:'formation', f}
 *      | {k:'swap', i, j} | {k:'sub', i, bi} | {k:'takers', takers}
 * Returns a short label for a HUD toast, or null when nothing changed.
 */
export function applyTactic(sim, team, cmd) {
  if (!cmd || typeof cmd !== 'object') return null;
  const t = sim.tac[team];
  switch (cmd.k) {
    case 'quick': {
      const q = t.quick[cmd.i | 0];
      if (!q) return null;
      const keep = { quick: t.quick, setPieceTakers: t.setPieceTakers, instructions: t.instructions };
      sim.tac[team] = { ...normTactics({ ...t, ...q }), ...keep, mentality: t.mentality };
      if (q.formation) setFormation(sim, team, q.formation);
      return `QUICK TACTIC ${(cmd.i | 0) + 1}${q.name ? ': ' + String(q.name).slice(0, 24).toUpperCase() : ''}`;
    }
    case 'ment': {
      const m = clamp(t.mentality + (cmd.d > 0 ? 1 : -1), -2, 2);
      if (m === t.mentality) return MENTALITY[m + 2];
      t.mentality = m;
      return MENTALITY[m + 2];
    }
    case 'set': {
      const keep = t.mentality;
      sim.tac[team] = normTactics({ ...t, ...(cmd.tactics || {}) });
      sim.tac[team].mentality = keep;
      return 'TACTICS UPDATED';
    }
    case 'formation': return setFormation(sim, team, cmd.f) ? `FORMATION ${cmd.f}` : null;
    case 'swap': return swapPositions(sim, team, cmd.i | 0, cmd.j | 0) ? 'POSITIONS SWAPPED' : null;
    case 'sub': return sim.requestSub(team, cmd.i | 0, cmd.bi | 0) ? 'SUBSTITUTION READY' : null;
    case 'takers': t.setPieceTakers = { ...t.setPieceTakers, ...(cmd.takers || {}) }; return 'SET-PIECE TAKERS SET';
  }
  return null;
}
