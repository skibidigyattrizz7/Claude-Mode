// Pitchside 3D — online protocol: message constants + defensive sanitisers.
// Everything that arrives from the peer goes through here. Never trust the peer.

export const PROTOCOL_VERSION = 1;
export const MAX_MSG_BYTES = 256 * 1024; // hard cap on a single incoming message

const FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-1-2-1-2'];
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];
const ATTRS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy', 'div', 'han', 'kic', 'ref', 'spd', 'pos'];
const KIT_KEYS = ['primary', 'secondary', 'number', 'shorts', 'socks'];
const DEFAULT_KIT = { primary: '#dddddd', secondary: '#333333', number: '#111111', shorts: '#222222', socks: '#dddddd' };
const DEFAULT_GK = { primary: '#1a1a1a', secondary: '#444444', number: '#ffffff', shorts: '#1a1a1a', socks: '#1a1a1a' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : dflt);
const int = (v, lo, hi, dflt) => Math.round(num(v, lo, hi, dflt));

/** Strip control chars, collapse whitespace, cap length. Non-strings -> fallback. */
export function cleanStr(v, max, fallback = '') {
  if (typeof v !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
}
const cleanId = (v, max, fallback) => {
  const s = typeof v === 'string' ? v.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, max) : '';
  return s || fallback;
};
const cleanColor = (v, fallback) => {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return fallback;
};
function cleanKit(k, dflt) {
  const src = k && typeof k === 'object' ? k : {};
  const out = {};
  for (const key of KIT_KEYS) out[key] = cleanColor(src[key], dflt[key]);
  return out;
}

function cleanPlayer(p, idx, prefix, usedIds, usedNums, forceGK) {
  if (!p || typeof p !== 'object') throw new Error(`player ${idx} is not an object`);
  let id = cleanId(p.id, 40, `${prefix}p${idx}`);
  while (usedIds.has(id)) id = `${id}_${idx}`;
  usedIds.add(id);
  let number = int(p.number, 1, 99, idx + 1);
  while (usedNums.has(number)) number = (number % 99) + 1;
  usedNums.add(number);
  let pos = POSITIONS.includes(p.pos) ? p.pos : 'CM';
  if (forceGK === true) pos = 'GK';
  else if (forceGK === false && pos === 'GK') pos = 'CM';
  const a = p.attrs && typeof p.attrs === 'object' ? p.attrs : {};
  const attrs = {};
  for (const k of ATTRS) attrs[k] = int(a[k], 1, 99, 50);
  return { id, name: cleanStr(p.name, 24, `Player ${number}`), number, pos, ovr: int(p.ovr, 1, 99, 60), attrs };
}

/**
 * Validate + normalise a Team received from the peer. Throws on structurally unusable data
 * (e.g. not exactly 11 starters); otherwise clamps/caps everything into contract shape.
 * @param {any} t  raw object
 * @param {string} prefix  id prefix used for fallback ids
 */
export function sanitizeTeam(t, prefix = 'r') {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('team is not an object');
  if (!Array.isArray(t.players) || t.players.length !== 11) throw new Error('team must have exactly 11 starters');
  const bench = Array.isArray(t.bench) ? t.bench.slice(0, 7) : [];
  const usedIds = new Set();
  const usedNums = new Set();
  const players = t.players.map((p, i) => cleanPlayer(p, i, prefix, usedIds, usedNums, i === 0));
  const benchOut = bench.map((p, i) => cleanPlayer(p, 11 + i, prefix, usedIds, usedNums, null));
  const name = cleanStr(t.name, 32, 'Opponent');
  const out = {
    id: cleanId(t.id, 32, `${prefix}team`),
    name,
    short: cleanStr(t.short, 4, name.slice(0, 3)).toUpperCase(),
    kit: cleanKit(t.kit, DEFAULT_KIT),
    gkKit: cleanKit(t.gkKit, DEFAULT_GK),
    formation: FORMATIONS.includes(t.formation) ? t.formation : '4-4-2',
    players,
    bench: benchOut,
  };
  if (t.chemistry !== undefined) out.chemistry = int(t.chemistry, 0, 100, 50);
  return out;
}

/** Make `b` safe to play against `a` (distinct team id and player ids). Returns a new object. */
export function dedupeTeams(a, b) {
  const aIds = new Set(a.players.concat(a.bench || []).map((p) => p.id));
  const clash = b.id === a.id || b.players.concat(b.bench || []).some((p) => aIds.has(p.id));
  if (!clash) return b;
  const fix = (p) => ({ ...p, id: `${p.id}~2` });
  return { ...b, id: `${b.id}~2`, players: b.players.map(fix), bench: (b.bench || []).map(fix) };
}

const INPUT_NUM = { mx: [-1, 1], my: [-1, 1], aimX: [-1, 1], aimY: [-1, 1], shootPower: [0, 1] };
const INPUT_BOOL = ['sprint', 'pass', 'through', 'lob', 'shoot', 'switchP', 'tackle', 'skill', 'finesse'];

/** Clamp an InputState from the peer. Unknown keys dropped, NaN -> 0, booleans strict. */
export function sanitizeInput(i) {
  const src = i && typeof i === 'object' ? i : {};
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(INPUT_NUM)) out[k] = num(src[k], lo, hi, 0);
  // normalise move vector to length <= 1
  const m = Math.hypot(out.mx, out.my);
  if (m > 1) { out.mx /= m; out.my /= m; }
  for (const k of INPUT_BOOL) out[k] = src[k] === true || src[k] === 1;
  return out;
}

/** Compact encoding of an InputState (numbers rounded to 2dp, booleans as bitmask). */
export function packInput(i) {
  const s = sanitizeInput(i);
  let bits = 0;
  INPUT_BOOL.forEach((k, n) => { if (s[k]) bits |= 1 << n; });
  const r = (v) => Math.round(v * 100) / 100;
  return [r(s.mx), r(s.my), r(s.aimX), r(s.aimY), r(s.shootPower), bits];
}
export function unpackInput(a) {
  if (!Array.isArray(a) || a.length !== 6) return sanitizeInput(null);
  const bits = int(a[5], 0, 0x1ff, 0);
  const o = { mx: a[0], my: a[1], aimX: a[2], aimY: a[3], shootPower: a[4] };
  INPUT_BOOL.forEach((k, n) => { o[k] = !!(bits & (1 << n)); });
  return sanitizeInput(o);
}

/** Validate a match config chosen by the host. */
export function sanitizeConfig(c) {
  const src = c && typeof c === 'object' ? c : {};
  return {
    halfMinutes: int(src.halfMinutes, 1, 10, 3),
    stadium: src.stadium === 'night' ? 'night' : 'day',
  };
}

const arr2 = (v, lo, hi) => (Array.isArray(v) && v.length === 2 ? [num(v[0], lo, hi, 0), num(v[1], lo, hi, 0)].map(Math.round) : [0, 0]);

/** Validate a match result relayed by the host (it only drives the result screen). */
export function sanitizeResult(r, home, away) {
  const src = r && typeof r === 'object' ? r : {};
  const ids = new Set(home.players.concat(home.bench || [], away.players, away.bench || []).map((p) => p.id));
  const st = src.stats && typeof src.stats === 'object' ? src.stats : {};
  const scorers = Array.isArray(src.scorers) ? src.scorers.slice(0, 60)
    .filter((s) => s && typeof s === 'object' && (s.team === 'home' || s.team === 'away'))
    .map((s) => ({ playerId: ids.has(s.playerId) ? s.playerId : null, team: s.team, minute: int(s.minute, 0, 130, 0), ...(s.ownGoal ? { ownGoal: true } : {}) })) : [];
  const playerRatings = {};
  if (src.playerRatings && typeof src.playerRatings === 'object') {
    for (const id of ids) if (typeof src.playerRatings[id] === 'number') playerRatings[id] = num(src.playerRatings[id], 0, 10, 6);
  }
  const out = {
    homeGoals: int(src.homeGoals, 0, 99, 0),
    awayGoals: int(src.awayGoals, 0, 99, 0),
    scorers,
    stats: {
      possession: arr2(st.possession, 0, 100),
      shots: arr2(st.shots, 0, 999),
      shotsOnTarget: arr2(st.shotsOnTarget, 0, 999),
      passes: arr2(st.passes, 0, 9999),
    },
    playerRatings,
  };
  if (src.abandoned) out.abandoned = true;
  if (src.forfeit === 'home' || src.forfeit === 'away') out.forfeit = src.forfeit;
  return out;
}

/** Parse an incoming wire string with a size cap. Returns null for garbage. */
export function decode(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string' && m.t.length < 16 ? m : null;
  } catch { return null; }
}
export const encode = (m) => JSON.stringify(m);

/** 5-char room code (no ambiguous chars). */
export function makeRoomCode(rand = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}
export function normalizeRoomCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}
export const PEER_PREFIX = 'pitchside-';
