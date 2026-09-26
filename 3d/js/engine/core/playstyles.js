// PlayStyles (V2.1 contract): parse a player's list into {id: strength} where strength is 1 for a
// normal PlayStyle and 1.6 for a PlayStyle+. Effects are applied where the sim uses them
// (search for `ps(p, '<id>')`). Short labels are shown in the HUD for the controlled player. DOM-free.
export const PLAYSTYLES = {
  // attack
  finesse: 'FIN', power: 'PWR', chip: 'CHP', deadball: 'DBL', trivela: 'TRV', lowdriven: 'LOW', powerheader: 'PHD', acrobatic: 'ACR',
  // passing
  incisive: 'INC', tikitaka: 'TIK', pinged: 'PNG', longball: 'LBP', whipped: 'WHP',
  // ball control
  firsttouch: '1ST', technical: 'TEC', rapid: 'RAP', flair: 'FLR', trickster: 'TRK', pressproven: 'PRS',
  // defending
  anticipate: 'ANT', intercept: 'INT', block: 'BLK', jockey: 'JKY', slidetackle: 'SLD', bruiser: 'BRU', aerial: 'AER',
  // physical
  quickstep: 'QST', relentless: 'REL', longthrow: 'LTH',
  // goalkeeping
  farreach: 'FAR', footwork: 'FTW', rushout: 'RSH', crossclaimer: 'CRC', quickreflexes: 'QRF', deflector: 'DFL',
};
export const PS_PLUS = 1.6;

export function parsePlaystyles(list) {
  const o = {};
  if (!Array.isArray(list)) return o;
  for (const e of list) {
    const id = typeof e === 'string' ? e : e && e.id;
    if (!id || !PLAYSTYLES[id]) continue;
    o[id] = Math.max(o[id] || 0, e && e.plus ? PS_PLUS : 1);
  }
  return o;
}

// strength of PlayStyle `id` for sim player p (0 if absent)
export const ps = (p, id) => (p.ps && p.ps[id]) || 0;

// compact string for snapshots/HUD: "FIN+ PWR"
export function psLabel(map) {
  return Object.keys(map).map((k) => PLAYSTYLES[k] + (map[k] > 1 ? '+' : '')).join(' ');
}
