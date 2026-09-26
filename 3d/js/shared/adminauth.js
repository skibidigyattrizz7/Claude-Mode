// Pitchside 3D — shared admin-code verification + admin level (used by the meta Admin panel, Settings and net).
// DOM-free, no imports. Codes are never stored anywhere in the client:
//   * offline / local check: PBKDF2-SHA256 (600 000 iterations, 32 bytes) against the constants below;
//   * online: online.admin.verifyLevel(code) — bcrypt on the server, which hands back a 12 h signed admin
//     token (kept in sessionStorage by the net layer) so owner RPCs work without re-entering the code.
// Levels: 'super' (everything 'full' does + admin cards up to 999 OVR + strongest powers) > 'full' > 'mod'
// (account role) > 'temp' (60 min, limited, local only).

export const ADMIN_CODE_PARAMS = Object.freeze({
  super: Object.freeze({ salt: '938b07f70b26296320e9c3c74bf7502d', iterations: 600000, hash: 'a349d13834dae42238770ae528fb16b4ee02c03a7686dea04a741d6d53b41b47' }),
  full: Object.freeze({ salt: 'cd856bbe3c942763c4a331b0ede5e17c', iterations: 600000, hash: 'fc34467189b291198c5aeef3837e2d87292e3a4fd7838ba889d38c32b81c4c55' }),
  temp: Object.freeze({ salt: 'eccf54d6330ab472f5dfd2903504deb6', iterations: 600000, hash: 'b5245fee52cc48f15b52624b91750fb2bb7bdcc6087411305fad4f1c25dd2723' }),
});
export const TEMP_ADMIN_MS = 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 60 * 1000;
export const ADMIN_RANK = Object.freeze({ super: 4, full: 3, mod: 2, temp: 1 });
const SESSION_KEY = 'pitchside.admin.session'; // same key/format as meta/core/admincode.js
const LOCK_KEY = 'pitchside.admin.lock';

// ---------- crypto ----------
const hexToBytes = (hex) => new Uint8Array(String(hex).match(/../g).map((b) => parseInt(b, 16)));
const bytesToHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
/** PBKDF2-SHA256(code, salt) as lowercase hex. Throws when Web Crypto is unavailable (insecure http origin). */
export async function pbkdf2Hex(code, saltHex, iterations, bytes = 32) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('Web Crypto unavailable');
  const key = await subtle.importKey('raw', new TextEncoder().encode(String(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations }, key, bytes * 8);
  return bytesToHex(new Uint8Array(bits));
}
/** Constant-time-ish hex compare. */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  a = a.toLowerCase(); b = b.toLowerCase();
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Local (offline) check. -> 'super' | 'full' | 'temp' | null. Tries the code as typed and trimmed.
 * Throws only when Web Crypto is missing (callers show "needs https").
 */
export async function verifyAdminCodeLocal(code, table = ADMIN_CODE_PARAMS) {
  const raw = String(code ?? '');
  if (!raw || raw.length > 128) return null;
  const tries = [raw];
  if (raw.trim() && raw.trim() !== raw) tries.push(raw.trim());
  const levels = Object.keys(table);
  for (const c of tries) {
    const res = await Promise.all(levels.map(async (lv) => safeEqualHex(await pbkdf2Hex(c, table[lv].salt, table[lv].iterations, 32), table[lv].hash)));
    const hit = levels.filter((lv, i) => res[i]).sort((x, y) => (ADMIN_RANK[y] || 0) - (ADMIN_RANK[x] || 0))[0];
    if (hit) return hit;
  }
  return null;
}

// ---------- storage ----------
const ss = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const read = (st, k) => { try { return st ? st.getItem(k) : null; } catch { return null; } };
const write = (st, k, v) => { try { if (!st) return; if (v === null) st.removeItem(k); else st.setItem(k, v); } catch { /* ignore */ } };

/** Code level of this browser session ('super' | 'full' | 'temp' | null); temp expires after 60 min. */
export function adminSessionLevel(now = Date.now()) {
  try {
    const o = JSON.parse(read(ss(), SESSION_KEY) || 'null');
    if (!o || typeof o !== 'object') return null;
    if (o.level === 'super' || o.level === 'full') return o.level;
    if (o.level === 'temp' && Number(o.until) > now) return 'temp';
  } catch { /* ignore */ }
  return null;
}
export function setAdminSessionLevel(level, now = Date.now()) {
  if (level === 'super' || level === 'full') write(ss(), SESSION_KEY, JSON.stringify({ level }));
  else if (level === 'temp') write(ss(), SESSION_KEY, JSON.stringify({ level: 'temp', until: now + TEMP_ADMIN_MS }));
  else write(ss(), SESSION_KEY, null);
}
export function clearAdminSession() { write(ss(), SESSION_KEY, null); }
export function tempRemainingMs(now = Date.now()) {
  try { const o = JSON.parse(read(ss(), SESSION_KEY) || 'null'); return o && o.level === 'temp' ? Math.max(0, Number(o.until) - now) : 0; } catch { return 0; }
}

// ---------- lockout (shared with meta: 5 wrong codes -> 60 s) ----------
function lockState() {
  try { const o = JSON.parse(read(ls(), LOCK_KEY) || 'null'); return o && typeof o === 'object' ? { fails: Number(o.fails) || 0, until: Number(o.until) || 0 } : { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; }
}
export function lockRemainingMs(now = Date.now()) { return Math.max(0, lockState().until - now); }
function registerFailure(now = Date.now()) {
  const s = lockState();
  const fails = s.until && s.until <= now ? 1 : s.fails + 1;
  const until = fails >= MAX_ATTEMPTS ? now + LOCK_MS : 0;
  write(ls(), LOCK_KEY, JSON.stringify({ fails: until ? 0 : fails, until }));
  return until ? LOCK_MS : 0;
}
const clearFailures = () => write(ls(), LOCK_KEY, null);

// ---------- account role ----------
let boundOnline = null;
/** main.js binds the online services once, so getAdminLevel() can see the account role. */
export function bindOnline(online) { boundOnline = online && typeof online === 'object' ? online : null; }
function accountRole(online = boundOnline) {
  try {
    const c = online && online.account && typeof online.account.current === 'function' ? online.account.current() : null;
    return c && c.state === 'account' ? c.role : null;
  } catch { return null; }
}

/**
 * Effective admin level: highest of the code session, the server-verified code level and the account
 * role (owner -> 'full', mod -> 'mod'). -> 'super' | 'full' | 'mod' | 'temp' | null
 */
export function getAdminLevel(now = Date.now(), online = boundOnline) {
  const cands = [adminSessionLevel(now)];
  const role = accountRole(online);
  if (role === 'owner') cands.push('full');
  else if (role === 'mod') cands.push('mod');
  try { const lv = online && online.admin ? online.admin.codeLevel : null; if (lv === 'super' || lv === 'full') cands.push(lv); } catch { /* ignore */ }
  return cands.filter(Boolean).sort((a, b) => ADMIN_RANK[b] - ADMIN_RANK[a])[0] || null;
}

/** What a level may do (UI hints; the server enforces its own rules). */
export function adminCaps(level = getAdminLevel()) {
  const r = ADMIN_RANK[level] || 0;
  return {
    level: level || null,
    any: r > 0,
    adminCards: level === 'super', // OP admin cards / OVR above 99
    maxOvr: level === 'super' ? 999 : 99,
    ownerPowers: r >= 3, // giveaways, resets, broadcasts, config, infinite coins (online: server-verified code or owner account)
    moderation: r >= 2, // ban / unban
    coinCap: r >= 3 ? Infinity : 1000000,
    temp: level === 'temp',
  };
}

/**
 * Redeem a code: the server first (when reachable; also stores the admin token for owner RPCs), else locally.
 * Never throws. -> { ok:true, level, server } | { ok:false, error, locked? }
 */
export async function verifyAdminCode(code, online = boundOnline, { table = ADMIN_CODE_PARAMS } = {}) {
  code = String(code ?? '');
  if (!code.trim()) return { ok: false, error: 'Enter a code' };
  const locked = lockRemainingMs();
  if (locked > 0) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(locked / 1000)} s.`, locked };
  let level = null, server = false;
  if (online && online.admin && typeof online.admin.verifyLevel === 'function') {
    try {
      const r = await Promise.race([online.admin.verifyLevel(code), new Promise((res) => setTimeout(() => res(null), 9000))]);
      if (r && r.ok && (r.level === 'super' || r.level === 'full')) { level = r.level; server = true; }
    } catch { /* fall back to local */ }
  }
  if (!level) {
    try { level = await verifyAdminCodeLocal(code, table); } catch { return { ok: false, error: 'Code check needs a secure (https) connection in this browser.' }; }
  }
  if (!level) {
    const lk = registerFailure();
    return lk ? { ok: false, error: 'Invalid code', locked: lk } : { ok: false, error: 'Invalid code' };
  }
  clearFailures();
  if ((ADMIN_RANK[level] || 0) >= (ADMIN_RANK[adminSessionLevel()] || 0)) setAdminSessionLevel(level);
  return { ok: true, level, server };
}
