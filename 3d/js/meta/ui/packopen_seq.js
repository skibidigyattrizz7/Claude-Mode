// Pack opening (FUT-style "new" animation): pure, DOM-free logic — how big a pull is, which colours the
// stage uses and the timed beat list the runner (packopen_fut.js) plays. Kept pure so node tests can
// check it (see tests/meta.test.mjs). Times are milliseconds from the moment the pack is tapped.

export const PACK_ANIM_MODES = ['new', 'classic'];
/** Normalise a stored `packAnim` setting value: 'classic' | 'new' (default 'new'). */
export function normalizePackAnim(v) { return v === 'classic' ? 'classic' : 'new'; }

/** Card rating from which a pull gets the full walkout (banners, flag/rating/club beats, 3D figure). */
export const WALKOUT_OVR = 86;
const PRESTIGE = new Set(['lotg', 'legend']);

const TIER_COLORS = {
  bronze: ['#2a1608', '#c98a55', '#ffe2c4'],
  silver: ['#161c24', '#c9d3de', '#ffffff'],
  gold: ['#2a1d02', '#f2c440', '#fff3c4'],
};
const SPECIAL_COLORS = {
  inform: ['#1a1204', '#ffb300', '#ffe8a8'],
  hero: ['#0b1d2e', '#27e1c1', '#d4fff6'],
  legend: ['#2a2208', '#f4e3a6', '#fffaf0'],
  lotg: ['#141004', '#ffcc33', '#fff3c4'],
  objective: ['#062030', '#6ee7ff', '#e0fbff'],
};

/**
 * Classify the best card in a pack.
 * @param best player-like { ovr, tier, special, rare }
 * @param promoById map of promo id -> { colors:[dark, main, light], short, tag } (core/promos.js PROMO_BY_ID)
 * @returns { walkout, level 0..3, colors:[dark, main, light], promoId|null, prestige, key }
 *   level: 0 = bronze/silver (no sparks), 1 = gold, 2 = rare gold / 80+ / special (gold rain), 3 = walkout (fireworks)
 */
export function classifyPull(best, promoById = {}) {
  const ovr = Number(best && best.ovr) || 0;
  const special = best && best.special;
  const promo = special && promoById[special] ? promoById[special] : null;
  const walkout = ovr >= WALKOUT_OVR || !!promo || PRESTIGE.has(special);
  const tier = (best && best.tier) || (ovr >= 75 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze');
  let level = 0;
  if (walkout) level = 3;
  else if (special || ovr >= 80 || (tier === 'gold' && best.rare)) level = 2;
  else if (tier === 'gold') level = 1;
  const colors = promo && Array.isArray(promo.colors) && promo.colors.length >= 3 ? promo.colors.slice(0, 3)
    : special && SPECIAL_COLORS[special] ? SPECIAL_COLORS[special]
      : TIER_COLORS[tier] || TIER_COLORS.gold;
  return { walkout, level, colors, promoId: promo ? special : null, prestige: PRESTIGE.has(special), key: promo ? `promo-${special}` : special || tier };
}

/**
 * Timed beat list for one opening. Each step: { kind, at, dur }. Kinds, in play order:
 *   rise, tension, rip, burst, card, [banners, (promo), flag, rating, club, fireworks], [flag (quick)], flip, [figure], done
 * @param pull result of classifyPull
 * @param opts { reduce: prefers-reduced-motion, figure: try the 3D player at the end (walkouts only) }
 */
export function buildPackSequence(pull, opts = {}) {
  const k = opts.reduce ? 0.45 : 1;
  const steps = [];
  let t = 0;
  const add = (kind, dur, gapAfter = dur) => { steps.push({ kind, at: Math.round(t), dur: Math.round(dur * k) }); t += gapAfter * k; };
  const big = pull.level >= 2;
  add('rise', 650);
  add('tension', big ? 700 : 420);
  add('rip', 520);
  add('burst', 350, big ? 350 : 250);
  add('card', 700, pull.walkout ? 750 : 650);
  if (pull.walkout) {
    add('banners', 650, 800);
    if (pull.promoId || pull.prestige) add('promo', 1300);
    add('flag', 1450);
    add('rating', 1450);
    add('club', 1900);
    add('fireworks', 500);
    add('flip', 700, 650);
    if (opts.figure) add('figure', 3200, 0);
  } else {
    add('flag', 850);
    add('flip', 650, 450);
  }
  add('done', 0, 0);
  return steps;
}

/** Duration (ms) until the given beat kind starts, or -1. */
export function beatAt(steps, kind) {
  const s = steps.find((x) => x.kind === kind);
  return s ? s.at : -1;
}

// ---------------------------------------------------------------- safety nets (laptop / Chromebook fix)
// The cinematic must never hang: every optional piece (packs.css, WebGL, the 3D walkout) is time-boxed and a
// watchdog forces the reveal if the timed beats stop advancing. Kept pure so node tests can check them.

/** How long packs.css may take to load before the overlay falls back to the self-styled 2D reveal. */
export const CSS_WAIT_MS = 1500;
/** Extra slack on top of the longest beat gap before the watchdog forces the reveal. */
export const WATCHDOG_GRACE_MS = 1500;

/** Longest wait between two consecutive beats of a sequence, plus `grace` — the watchdog's stall limit (ms). */
export function watchdogLimit(steps, grace = WATCHDOG_GRACE_MS) {
  let gap = 0;
  for (let i = 1; i < (steps || []).length; i++) gap = Math.max(gap, steps[i].at - steps[i - 1].at);
  return gap + grace;
}

/**
 * Watchdog decision: true when an animation that is actively playing has not advanced for longer than `limit`.
 * Waiting phases (the "tap to open" pack, the final reveal, the item grid) never trip it.
 * @param st { phase, lastProgress, now, limit, active?: string[] } — `active` lists the phases that must keep moving.
 */
export function watchdogTripped({ phase, lastProgress, now, limit, active = ['playing'] }) {
  if (!active.includes(phase)) return false;
  return now - lastProgress > limit;
}

/**
 * Time-box an optional promise (3D scene, stylesheet, lazy module). Resolves { ok:true, value } if it settles in
 * time, { ok:false, timedOut:true } after `ms`, or { ok:false, error } if it rejects. Never rejects, never hangs.
 * `timers` is injectable for tests ({ setTimeout, clearTimeout }).
 */
export function timeBox(promise, ms, timers = globalThis) {
  return new Promise((resolve) => {
    let done = false;
    const id = timers.setTimeout(() => { if (!done) { done = true; resolve({ ok: false, timedOut: true }); } }, Math.max(0, ms));
    Promise.resolve(promise).then(
      (value) => { if (!done) { done = true; timers.clearTimeout(id); resolve({ ok: true, value }); } },
      (error) => { if (!done) { done = true; timers.clearTimeout(id); resolve({ ok: false, error }); } },
    );
  });
}

/**
 * Pack summary bulk actions (FC-style). Returns the pending items an action applies to:
 *   'club'     new (non-duplicate) items          -> club
 *   'vault'    every pending item                 -> SBC storage (duplicates included; storage allows repeats)
 *   'transfer' new items that are tradeable       -> club + transfer list (a duplicate has no second slot in the club)
 *   'sellDups' pending duplicates                 -> quick sell
 *   'sellAll'  every pending item                 -> quick sell
 * @param players [{ pid, dup, state, p }] — the summary's items (state 'new' = still pending)
 * @param isTradeable optional (pid) => boolean for 'transfer'
 */
export function bulkTargets(players, action, isTradeable = () => true) {
  const pending = (players || []).filter((x) => x.state === 'new');
  switch (action) {
    case 'club': return pending.filter((x) => !x.dup);
    case 'vault': return pending;
    case 'transfer': return pending.filter((x) => !x.dup && isTradeable(x.pid));
    case 'sellDups': return pending.filter((x) => x.dup);
    case 'sellAll': return pending;
    default: return [];
  }
}
