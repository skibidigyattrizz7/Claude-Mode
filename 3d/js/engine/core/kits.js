// Kit colours, procedural shirt patterns and clash resolution shared by the 3D renderer's
// kit materials/textures and (via engine/index.js) the HUD scoreboard. Pure JS, no THREE
// dependency, so it is trivial to unit test.

function hexToRgb(hex) {
  const h = String(hex || '#888888').replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padStart(6, '0').slice(0, 6);
  const n = parseInt(s, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return '#' + c(A.r, B.r) + c(A.g, B.g) + c(A.b, B.b);
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Perceptual-ish colour distance (redmean) — cheap, no colour-space conversion needed. */
export function colorDist(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const rm = (A.r + B.r) / 2;
  const dr = A.r - B.r, dg = A.g - B.g, db = A.b - B.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export const CLASH_THRESHOLD = 170;

function hashStr(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Shirt patterns the procedural texture (render/textures.js shirtTexture) knows how to draw.
export const PATTERNS = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'pinstripes', 'fade', 'chevron'];

/** Normalise a kit's `pattern` field (string name, legacy numeric index, or absent) to one of
 *  PATTERNS. Absent/0 -> 'plain' so every kit that predates patterns keeps its old plain look. */
export function pickPattern(kit) {
  const p = kit && kit.pattern;
  if (p == null || p === 0) return 'plain';
  if (typeof p === 'number') return PATTERNS[p] || 'plain';
  return PATTERNS.includes(p) ? p : 'plain';
}

/** The colour a kit "reads as" on the pitch from a distance (patterns blend primary/secondary). */
export function kitTone(kit) {
  if (!kit) return '#888888';
  const pattern = pickPattern(kit);
  if (pattern === 'plain' || !kit.secondary) return kit.primary || '#888888';
  const mix = pattern === 'fade' ? 0.5 : (pattern === 'sash' || pattern === 'chevron' ? 0.22 : 0.35);
  return mixHex(kit.primary || '#888888', kit.secondary, mix);
}

export function kitsClash(a, b) {
  return colorDist(kitTone(a), kitTone(b)) < CLASH_THRESHOLD;
}

function normalizeKit(kit) {
  const primary = (kit && kit.primary) || '#888888';
  const secondary = (kit && kit.secondary) || (luminance(primary) > 0.5 ? '#111111' : '#ffffff');
  return {
    primary,
    secondary,
    shorts: (kit && kit.shorts) || primary,
    socks: (kit && kit.socks) || primary,
    number: (kit && kit.number) || (luminance(primary) > 0.55 ? '#111111' : '#ffffff'),
    pattern: kit && kit.pattern,
  };
}

// Palette + pattern pool used only for kits generated on the fly (last-resort clash fallback,
// or a goalkeeper kit that needs to move out of the way of both outfield kits).
const GEN_PALETTE = ['#101214', '#f4f4f4', '#00c2a8', '#ff6b00', '#6a1b9a', '#0057b8', '#c9a227', '#e8112d', '#2e7d32', '#f2d200'];
const GEN_PATTERNS = ['stripes', 'hoops', 'halves', 'sash', 'pinstripes', 'chevron'];
const GK_PALETTE = ['#1db954', '#f5e100', '#ff7a00', '#8e44ad', '#111111', '#00b7c3', '#e91e63', '#9e9e9e'];

function bestContrast(avoidTones, pool) {
  let best = pool[0], bestScore = -1;
  for (const c of pool) {
    let score = Infinity;
    for (const t of avoidTones) score = Math.min(score, colorDist(c, t));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** A brand-new kit that contrasts with every colour in avoidTones — the last-resort fallback
 *  when none of the kits a team actually owns clears the clash threshold. */
function generateContrastKit(seed, avoidTones) {
  const primary = bestContrast(avoidTones, GEN_PALETTE);
  const secPool = GEN_PALETTE.filter((c) => c !== primary);
  const secondary = bestContrast([primary, ...avoidTones], secPool) || (luminance(primary) > 0.5 ? '#111111' : '#ffffff');
  const number = luminance(primary) > 0.55 ? '#111111' : '#ffffff';
  const pattern = GEN_PATTERNS[hashStr(seed) % GEN_PATTERNS.length];
  return { primary, secondary, shorts: primary, socks: primary, number, pattern };
}

/** Resolve a goalkeeper kit that stays distinct (perceptually) from every colour in
 *  avoidTones; keeps the team-supplied GK kit untouched when it already clears the bar. */
function resolveGkKit(base, avoidTones) {
  const b = normalizeKit(base && base.primary ? base : { primary: '#9e9e9e', secondary: '#222222' });
  const tone = kitTone({ primary: b.primary, secondary: b.secondary, pattern: 'plain' });
  if (base && base.primary && !avoidTones.some((t) => colorDist(tone, t) < CLASH_THRESHOLD)) {
    return { ...b, pattern: 'plain' };
  }
  const primary = bestContrast(avoidTones, GK_PALETTE);
  const number = luminance(primary) > 0.55 ? '#111111' : '#ffffff';
  return { primary, secondary: '#222222', shorts: '#222222', socks: primary, number, pattern: 'plain' };
}

/**
 * Resolve the four kits actually worn on the pitch for a fixture. Home always keeps its own
 * kit; away tries its own kit, then an alternate/third kit if the team data supplies one
 * (`away.altKit` / `away.thirdKit`), and takes the first that doesn't clash with home under a
 * perceptual (redmean) colour distance — not an exact-match check. If every option supplied
 * still clashes, a fresh contrasting kit is generated instead of forcing a near-identical
 * match onto the pitch. Both goalkeeper kits are then checked against both outfield kits (and
 * each other) and regenerated from a GK palette if they don't stand out enough.
 */
export function resolveMatchKits(home = {}, away = {}) {
  const hk = normalizeKit(home.kit || { primary: '#d00', secondary: '#fff' });
  const candidates = [
    { kit: away.kit, tag: 'own' },
    { kit: away.altKit, tag: 'alt' },
    { kit: away.thirdKit, tag: 'third' },
  ].filter((c) => c.kit);
  if (!candidates.length) candidates.push({ kit: { primary: '#00d', secondary: '#fff' }, tag: 'own' });
  const fit = candidates.find((c) => !kitsClash(hk, c.kit));
  let ak, tag;
  if (fit) { ak = normalizeKit(fit.kit); tag = fit.tag; }
  else { ak = generateContrastKit(`away|${hk.primary}|${candidates[0].kit.primary}`, [kitTone(hk)]); tag = 'generated'; }
  const homeTone = kitTone(hk), awayTone = kitTone(ak);
  const homeGk = resolveGkKit(home.gkKit, [homeTone, awayTone]);
  const awayGk = resolveGkKit(away.gkKit, [homeTone, awayTone, kitTone(homeGk)]);
  return { home: hk, away: ak, homeGk, awayGk, awayKitTag: tag };
}
