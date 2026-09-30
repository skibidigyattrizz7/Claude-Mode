// Display order for card lists (owner, Sep 30): Secret cards always come first, whatever the number says, and the
// "infinite" god cards (∞, |∞|, ???^∞) always outrank Admin Cards' 999. Cursed secret cards (-∞) still sit above
// every normal card (they are secret cards) but below the god cards. Numbers only decide order inside each group.
// DOM-free.

/** Sort key: bigger comes first. */
export function displayRank(p) {
  if (!p) return -Infinity;
  const ovr = Number(p.ovr) || 0;
  if (p.secret === true) return (p.cursed === true ? 2e6 : 3e6) + ovr;
  return ovr;
}
/** Comparator that only floats Secret cards to the top (0 for two normal cards); chain it before any other sort. */
export const secretFirst = (a, b) => (displayRank(b) >= 1e6) - (displayRank(a) >= 1e6) || (displayRank(b) >= 1e6 && displayRank(a) >= 1e6 ? displayRank(b) - displayRank(a) : 0);
/** Comparator for Array#sort: best first (Secret cards on top). */
export const byDisplayRank = (a, b) => displayRank(b) - displayRank(a);
