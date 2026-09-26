// Formations: slot positions (index 0 = GK, then defence -> attack, left -> right),
// pitch coordinates for UI (x 0..100 left->right, y 0..100 own goal -> opposition goal),
// and adjacency links used for chemistry. DOM-free.

const S = (pos, x, y) => ({ pos, x, y });

export const FORMATIONS = {
  '4-3-3': {
    slots: [S('GK', 50, 7), S('LB', 13, 27), S('CB', 37, 22), S('CB', 63, 22), S('RB', 87, 27),
      S('CM', 27, 50), S('CDM', 50, 43), S('CM', 73, 50), S('LW', 16, 77), S('ST', 50, 85), S('RW', 84, 77)],
    links: [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [1, 5], [1, 8], [2, 6], [3, 6], [4, 7], [4, 10], [5, 6], [6, 7], [5, 8], [5, 9], [7, 9], [7, 10], [8, 9], [9, 10]],
  },
  '4-4-2': {
    slots: [S('GK', 50, 7), S('LB', 13, 27), S('CB', 37, 22), S('CB', 63, 22), S('RB', 87, 27),
      S('LM', 13, 55), S('CM', 37, 49), S('CM', 63, 49), S('RM', 87, 55), S('ST', 35, 83), S('ST', 65, 83)],
    links: [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [1, 5], [2, 6], [3, 7], [4, 8], [5, 6], [6, 7], [7, 8], [5, 9], [6, 9], [7, 10], [8, 10], [9, 10]],
  },
  '4-2-3-1': {
    slots: [S('GK', 50, 7), S('LB', 13, 27), S('CB', 37, 22), S('CB', 63, 22), S('RB', 87, 27),
      S('CDM', 35, 43), S('CDM', 65, 43), S('LM', 15, 64), S('CAM', 50, 64), S('RM', 85, 64), S('ST', 50, 86)],
    links: [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [1, 7], [2, 5], [3, 6], [4, 9], [5, 6], [5, 7], [5, 8], [6, 8], [6, 9], [7, 8], [8, 9], [7, 10], [8, 10], [9, 10]],
  },
  '3-5-2': {
    slots: [S('GK', 50, 7), S('CB', 25, 23), S('CB', 50, 20), S('CB', 75, 23),
      S('LM', 11, 54), S('CDM', 36, 44), S('CDM', 64, 44), S('RM', 89, 54), S('CAM', 50, 64), S('ST', 35, 85), S('ST', 65, 85)],
    links: [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [1, 4], [1, 5], [2, 5], [2, 6], [3, 6], [3, 7], [4, 5], [5, 6], [6, 7], [5, 8], [6, 8], [4, 9], [7, 10], [8, 9], [8, 10], [9, 10]],
  },
  '4-1-2-1-2': {
    slots: [S('GK', 50, 7), S('LB', 13, 27), S('CB', 37, 22), S('CB', 63, 22), S('RB', 87, 27),
      S('CDM', 50, 39), S('CM', 25, 53), S('CM', 75, 53), S('CAM', 50, 65), S('ST', 35, 85), S('ST', 65, 85)],
    links: [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [1, 6], [2, 5], [3, 5], [4, 7], [5, 6], [5, 7], [6, 8], [7, 8], [6, 9], [7, 10], [8, 9], [8, 10], [9, 10]],
  },
};

export const FORMATION_NAMES = Object.keys(FORMATIONS);

// Position equivalences (count as "preferred position")
const EQUIV = { LB: ['LWB'], LWB: ['LB'], RB: ['RWB'], RWB: ['RB'], ST: ['CF'], CF: ['ST'] };

/** 2 = natural position, 1 = listed alternative position (counts as in-position), 0 = out of position */
export function positionFit(player, slotPos) {
  if (!player) return 0;
  if (player.pos === slotPos || (EQUIV[player.pos] || []).includes(slotPos)) return 2;
  const alt = player.alt || [];
  if (alt.includes(slotPos) || (EQUIV[slotPos] || []).some((x) => alt.includes(x))) return 1;
  return 0;
}

const NEAR = {
  GK: [], CB: ['CDM', 'LB', 'RB'], LB: ['LWB', 'LM', 'CB'], RB: ['RWB', 'RM', 'CB'], LWB: ['LB', 'LM'], RWB: ['RB', 'RM'],
  CDM: ['CM', 'CB'], CM: ['CDM', 'CAM', 'LM', 'RM'], CAM: ['CM', 'CF', 'ST'], LM: ['LW', 'LB', 'CM'], RM: ['RW', 'RB', 'CM'],
  LW: ['LM', 'ST', 'CF'], RW: ['RM', 'ST', 'CF'], ST: ['CF', 'CAM', 'LW', 'RW'], CF: ['ST', 'CAM'],
};

/** Effective overall of a player when fielded at slotPos (used for AI lineups / best XI). */
export function effectiveOvr(player, slotPos) {
  const fit = positionFit(player, slotPos);
  if (fit >= 1) return player.ovr; // natural or alternate position: full rating (FC24+ style)
  if (player.pos === 'GK' || slotPos === 'GK') return player.ovr - 45;
  if ((NEAR[player.pos] || []).includes(slotPos)) return player.ovr - 6;
  return player.ovr - 15;
}

/** Sensible alternate positions per primary position (most natural first). */
export const ALT_OPTIONS = {
  GK: [], CB: ['CDM', 'RB', 'LB'], LB: ['LWB', 'LM', 'CB'], RB: ['RWB', 'RM', 'CB'], LWB: ['LB', 'LM'], RWB: ['RB', 'RM'],
  CDM: ['CM', 'CB'], CM: ['CDM', 'CAM', 'RM', 'LM'], CAM: ['CM', 'CF', 'LW', 'RW'], LM: ['LW', 'LB', 'CM', 'LWB'], RM: ['RW', 'RB', 'CM', 'RWB'],
  LW: ['LM', 'ST', 'RW'], RW: ['RM', 'ST', 'LW'], ST: ['CF', 'LW', 'RW'], CF: ['ST', 'CAM'],
};
/** All positions a player can play in-position (primary first). */
export function playerPositions(p) { return [p.pos, ...(p.alt || [])]; }
