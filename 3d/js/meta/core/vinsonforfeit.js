// Vinson match consequence: only the active XI and bench, never the entire club.
export function forfeitVinsonSquad(state, vinsonId, { owner = false } = {}) {
  if (owner || !state?.squad || state.vinson?.phase !== 'locked' || state.vinson?.immune) return [];
  const active = [...(state.squad.slots || []), ...(state.squad.bench || [])];
  if (!active.includes(vinsonId)) return [];
  const removed = new Set(active.filter(id => id && id !== vinsonId));
  state.club = (state.club || []).filter(id => !removed.has(id));
  for (const key of ['untradeable', 'untradable', 'transferList'])
    if (Array.isArray(state[key])) state[key] = state[key].filter(id => !removed.has(id));
  const clean = sq => {
    if (!sq) return;
    for (const key of ['slots', 'bench'])
      if (Array.isArray(sq[key])) sq[key] = sq[key].map(id => removed.has(id) ? null : id);
  };
  clean(state.squad);
  for (const entry of state.squads || []) clean(entry.squad);
  // No quickSell/addCoins call: this consequence pays exactly zero.
  return [...removed];
}
