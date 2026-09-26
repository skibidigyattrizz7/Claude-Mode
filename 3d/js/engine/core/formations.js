// Formation layouts. d = depth as fraction of the pitch from own goal line (0..1),
// l = lateral -1 (left) .. +1 (right) from the team's point of view. DOM-free.
const S = (r, d, l) => ({ r, d, l });
export const FORMATIONS = {
  '4-3-3': [S('GK', 0.02, 0), S('LB', 0.22, -0.78), S('CB', 0.19, -0.27), S('CB', 0.19, 0.27), S('RB', 0.22, 0.78),
    S('CM', 0.4, -0.42), S('CDM', 0.34, 0), S('CM', 0.4, 0.42), S('LW', 0.64, -0.72), S('ST', 0.7, 0), S('RW', 0.64, 0.72)],
  '4-4-2': [S('GK', 0.02, 0), S('LB', 0.22, -0.78), S('CB', 0.19, -0.27), S('CB', 0.19, 0.27), S('RB', 0.22, 0.78),
    S('LM', 0.44, -0.74), S('CM', 0.39, -0.22), S('CM', 0.39, 0.22), S('RM', 0.44, 0.74), S('ST', 0.68, -0.2), S('ST', 0.68, 0.2)],
  '4-2-3-1': [S('GK', 0.02, 0), S('LB', 0.22, -0.78), S('CB', 0.19, -0.27), S('CB', 0.19, 0.27), S('RB', 0.22, 0.78),
    S('CDM', 0.34, -0.22), S('CDM', 0.34, 0.22), S('LM', 0.54, -0.7), S('CAM', 0.53, 0), S('RM', 0.54, 0.7), S('ST', 0.7, 0)],
  '3-5-2': [S('GK', 0.02, 0), S('CB', 0.2, -0.42), S('CB', 0.18, 0), S('CB', 0.2, 0.42),
    S('LWB', 0.42, -0.82), S('CM', 0.4, -0.3), S('CDM', 0.34, 0), S('CM', 0.4, 0.3), S('RWB', 0.42, 0.82), S('ST', 0.68, -0.2), S('ST', 0.68, 0.2)],
  '4-1-2-1-2': [S('GK', 0.02, 0), S('LB', 0.22, -0.78), S('CB', 0.19, -0.27), S('CB', 0.19, 0.27), S('RB', 0.22, 0.78),
    S('CDM', 0.33, 0), S('CM', 0.42, -0.36), S('CM', 0.42, 0.36), S('CAM', 0.54, 0), S('ST', 0.68, -0.2), S('ST', 0.68, 0.2)],
};

const COMPAT = {
  GK: ['GK'], CB: ['CB', 'CDM'], LB: ['LB', 'LWB', 'LM', 'CB'], RB: ['RB', 'RWB', 'RM', 'CB'],
  LWB: ['LWB', 'LB', 'LM'], RWB: ['RWB', 'RB', 'RM'], CDM: ['CDM', 'CM', 'CB'], CM: ['CM', 'CDM', 'CAM'],
  CAM: ['CAM', 'CM', 'CF'], LM: ['LM', 'LW', 'LWB'], RM: ['RM', 'RW', 'RWB'], LW: ['LW', 'LM', 'CF', 'ST'],
  RW: ['RW', 'RM', 'CF', 'ST'], ST: ['ST', 'CF'], CF: ['CF', 'ST', 'CAM'],
};

export function roleGroup(r) {
  if (r === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(r)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(r)) return 'MID';
  return 'FWD';
}

/**
 * Map each of the 11 players to a formation slot. Index 0 is always the GK.
 * Returns array slotOf[playerIndex] = slotIndex.
 */
export function assignSlots(players, formation) {
  const slots = FORMATIONS[formation] || FORMATIONS['4-3-3'];
  const n = Math.min(players.length, 11);
  const slotOf = new Array(n).fill(-1);
  const taken = new Array(11).fill(false);
  slotOf[0] = 0; taken[0] = true;
  // pass 1: exact matches in order; pass 2: compatible; pass 3: anything in listed order
  for (const pass of [0, 1, 2]) {
    for (let s = 1; s < 11; s++) {
      if (taken[s]) continue;
      const role = slots[s].r;
      for (let i = 1; i < n; i++) {
        if (slotOf[i] >= 0) continue;
        const pos = players[i].pos;
        const ok = pass === 0 ? pos === role : pass === 1 ? (COMPAT[role] || []).includes(pos) : true;
        if (ok) { slotOf[i] = s; taken[s] = true; break; }
      }
    }
  }
  return slotOf;
}
