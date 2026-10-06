// PlayStyles (V2.1 contract): parse a player's list into {id: strength} where strength is 1 for a
// normal PlayStyle and 1.6 for a PlayStyle+. Effects are applied where the sim uses them
// (search for `ps(p, '<id>')`). Short labels are shown in the HUD for the controlled player. DOM-free.
export const PLAYSTYLES = {
  // attack
  finesse: 'FIN', power: 'PWR', chip: 'CHP', deadball: 'DBL', trivela: 'TRV', lowdriven: 'LOW', powerheader: 'PRH', acrobatic: 'ACR', gamechanger: 'GCH',
  // passing
  incisive: 'INC', tikitaka: 'TIK', pinged: 'PNG', longball: 'LBP', whipped: 'WHP', inventive: 'INV',
  // ball control
  firsttouch: '1ST', technical: 'TEC', rapid: 'RAP', flair: 'FLR', trickster: 'TRK', pressproven: 'PRS',
  // defending
  anticipate: 'ANT', intercept: 'INT', block: 'BLK', jockey: 'JKY', slidetackle: 'SLD', bruiser: 'BRU', aerial: 'AER',
  // physical
  quickstep: 'QST', relentless: 'REL', longthrow: 'LTH', enforcer: 'ENF',
  // goalkeeping
  farreach: 'FAR', footwork: 'FTW', rushout: 'RSH', crossclaimer: 'CRC', quickreflexes: 'QRF', deflector: 'DFL',
};
export const PS_PLUS = 1.6;
// FC 25/26 names for the two styles that kept their original ids (Precision Header / Aerial Fortress), plus
// spelled-out variants — so cards from any source resolve to the one id the sim reads.
export const PS_ALIASES = {
  precisionheader: 'powerheader', precision: 'powerheader', aerialfortress: 'aerial', fortress: 'aerial',
  powershot: 'power', finesseshot: 'finesse', chipshot: 'chip', lowdrivenshot: 'lowdriven', incisivepass: 'incisive',
  pingedpass: 'pinged', longballpass: 'longball', whippedpass: 'whipped', game_changer: 'gamechanger',
};
const canon = (id) => (PLAYSTYLES[id] ? id : PS_ALIASES[id] || null);

export function parsePlaystyles(list) {
  const o = {};
  if (!Array.isArray(list)) return o;
  for (const e of list) {
    const id = canon(typeof e === 'string' ? e : e && e.id);
    if (!id) continue;
    o[id] = Math.max(o[id] || 0, e && e.plus ? PS_PLUS : 1);
  }
  return o;
}

// strength of PlayStyle `id` for sim player p (0 if absent)
export const ps = (p, id) => (p.ps && p.ps[id]) || 0;

// Over-99 "power" of admin / Owner-Access cards (0 for every normal card, up to 1 for 300+ ratings)
// in area k: 'pac' | 'sho' | 'pas' | 'dri' | 'def' | 'phy' | 'gk'. Set by MatchSim._applyData.
export const bst = (p, k) => (p && p.boost && p.boost[k]) || 0;

// compact string for snapshots/HUD: "FIN+ PWR"
export function psLabel(map) {
  return Object.keys(map).map((k) => PLAYSTYLES[k] + (map[k] > 1 ? '+' : '')).join(' ');
}
