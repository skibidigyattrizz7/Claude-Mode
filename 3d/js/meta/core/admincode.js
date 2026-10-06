// "Admin Given Codes": owner / temporary admin access. DOM-free.
// Codes are never stored in the client: only PBKDF2-SHA256 parameters (salt, iterations, expected hash).
// Verification order: the online service (online.admin.verify) when reachable, otherwise the local Web Crypto check.
// Admin state: the code level lives in sessionStorage (this browser session only); an account role of
// 'owner' / 'mod' (online accounts) grants 'full' / 'mod' automatically. Wrong codes lock the field for
// 60 s after 5 attempts (localStorage).

// Code constants live in one place (shared with net + Settings): 'super' | 'full' | 'temp'.
// The SUPER code unlocks everything 'full' does (+ admin cards / 999 OVR). For compatibility with the UI's
// `level === 'full'` checks, getAdminLevel() reports a super session as 'full'; adminInfo().super / isSuperAdmin() tell them apart.
import { ADMIN_CODE_PARAMS as SHARED_PARAMS, verifyAdminCode as sharedVerifyAdminCode } from '../../shared/adminauth.js';
export const ADMIN_CODE_PARAMS = Object.fromEntries(Object.entries(SHARED_PARAMS).map(([k, v]) => [k, { ...v }])); // mutable copy (tests swap vectors)
export const TEMP_ADMIN_MS = 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 60 * 1000;
/** Coins a single grant may add, per level. */
export const COIN_CAP = { full: Infinity, mod: 1000000, temp: 1000000 };
/** What each level may do. */
export const ADMIN_PERMS = {
  full: ['coins', 'infinite', 'onlineCoins', 'packs', 'grant', 'sbc', 'objectives', 'career', 'reset', 'moderation'],
  mod: ['coins', 'packs', 'grant', 'moderation'],
  temp: ['coins', 'packs', 'grant'],
};
const RANK = { super: 4, full: 3, mod: 2, temp: 1 };
const SESSION_KEY = 'pitchside.admin.session';
const LOCK_KEY = 'pitchside.admin.lock';

// ---------- crypto ----------
const hexToBytes = (hex) => new Uint8Array(String(hex).match(/../g).map((b) => parseInt(b, 16)));
const bytesToHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

/** PBKDF2-SHA256(code, salt) as lowercase hex. Throws when Web Crypto is unavailable (e.g. insecure http origin). */
export async function pbkdf2Hex(code, saltHex, iterations, bytes = 32) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('Web Crypto unavailable');
  const key = await subtle.importKey('raw', new TextEncoder().encode(String(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations }, key, bytes * 8);
  return bytesToHex(new Uint8Array(bits));
}
/** Compare two hex strings without an early exit. */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  a = a.toLowerCase(); b = b.toLowerCase();
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function verifyCodeWith(code, params) {
  const hex = await pbkdf2Hex(code, params.salt, params.iterations, 32);
  return safeEqualHex(hex, params.hash);
}
/** Local check against every level. Returns 'full' | 'temp' | null. */
export async function verifyLocalCode(code, table = ADMIN_CODE_PARAMS) {
  const tries = [String(code)];
  const trimmed = String(code).trim();
  if (trimmed !== tries[0]) tries.push(trimmed);
  for (const c of tries) {
    if (!c) continue;
    const levels = Object.keys(table);
    const res = await Promise.all(levels.map((lv) => verifyCodeWith(c, table[lv])));
    const hit = levels.filter((lv, i) => res[i]).sort((x, y) => (RANK[y] || 0) - (RANK[x] || 0))[0];
    if (hit) return hit;
  }
  return null;
}

// ---------- storage helpers ----------
const ss = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const read = (st, k) => { try { return st ? st.getItem(k) : null; } catch { return null; } };
const write = (st, k, v) => { try { if (!st) return; if (v === null) st.removeItem(k); else st.setItem(k, v); } catch { /* ignore */ } };

// ---------- lockout ----------
function lockState() {
  try { const o = JSON.parse(read(ls(), LOCK_KEY) || 'null'); return o && typeof o === 'object' ? { fails: Number(o.fails) || 0, until: Number(o.until) || 0 } : { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; }
}
export function lockRemainingMs(now = Date.now()) { return Math.max(0, lockState().until - now); }
export function failedAttempts() { return lockState().fails; }
/** Record a wrong code. Returns the lock time in ms (0 when not locked yet). */
export function registerFailure(now = Date.now()) {
  const st = lockState();
  st.fails++;
  if (st.fails >= MAX_ATTEMPTS) { st.fails = 0; st.until = now + LOCK_MS; }
  write(ls(), LOCK_KEY, JSON.stringify(st));
  return Math.max(0, st.until - now);
}
export function clearFailures() { write(ls(), LOCK_KEY, null); }

// ---------- session level ----------
function sessionLevel(now = Date.now()) {
  const raw = read(ss(), SESSION_KEY);
  if (!raw) return null;
  if (raw === '1') return { level: 'full' }; // pre-V3 sessions
  try {
    const o = JSON.parse(raw);
    if (o && (o.level === 'full' || o.level === 'super')) return { level: o.level };
    if (o && o.level === 'temp' && Number(o.until) > now) return { level: 'temp', until: Number(o.until) };
  } catch { /* ignore */ }
  write(ss(), SESSION_KEY, null); // expired or corrupt
  return null;
}
export function setSessionLevel(level, now = Date.now()) {
  if (level === 'full' || level === 'super') write(ss(), SESSION_KEY, JSON.stringify({ level }));
  else if (level === 'temp') write(ss(), SESSION_KEY, JSON.stringify({ level: 'temp', until: now + TEMP_ADMIN_MS }));
  else write(ss(), SESSION_KEY, null);
}
export function clearAdminSession() { write(ss(), SESSION_KEY, null); }

// ---------- account role (online accounts) ----------
let _role = null;
/** 'owner' | 'mod' | 'player' | null — set from online.account.current() / online.profile(). */
export function setAccountRole(role) { _role = ['owner', 'mod', 'player'].includes(role) ? role : null; return _role; }
export function accountRole() { return _role; }
const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(null), ms))]);
async function tryCall(fn, ms = 4000) { try { return await withTimeout(fn(), ms); } catch { return null; } }
/** Read the logged-in account's role (never throws). Returns true when it changed. */
export async function refreshAccountRole(online) {
  const before = _role;
  let role = null;
  if (online && typeof online === 'object') {
    const acc = online.account && typeof online.account.current === 'function' ? await tryCall(() => online.account.current()) : null;
    role = pickRole(acc);
    if (!role && typeof online.profile === 'function') role = pickRole(await tryCall(() => online.profile()));
  }
  setAccountRole(role);
  return before !== _role;
}
function pickRole(r) {
  if (!r || typeof r !== 'object') return null;
  const v = r.role ?? (r.account && r.account.role) ?? (r.profile && r.profile.role);
  return typeof v === 'string' ? v : null;
}

/** Current admin level: 'full' | 'mod' | 'temp' | null (highest of the code session and the account role). */
export function getAdminLevel(now = Date.now()) {
  const s = sessionLevel(now);
  const cands = [s && s.level, _role === 'owner' ? 'full' : _role === 'mod' ? 'mod' : null].filter(Boolean);
  const top = cands.sort((a, b) => RANK[b] - RANK[a])[0] || null;
  return top === 'super' ? 'full' : top;
}
/** True when this session was unlocked with the SUPER code. */
export function isSuperAdmin(now = Date.now()) { const s = sessionLevel(now); return !!s && s.level === 'super'; }
/** Details for the UI badge. */
export function adminInfo(now = Date.now()) {
  const s = sessionLevel(now);
  const level = getAdminLevel(now);
  return { level, super: isSuperAdmin(now), role: _role, fromAccount: !!level && (!s || RANK[s.level] < RANK[level]), tempRemainingMs: level === 'temp' && s ? Math.max(0, s.until - now) : 0 };
}
export function adminCan(action, level = getAdminLevel()) { return !!level && (ADMIN_PERMS[level] || []).includes(action); }
/** The level handed to the match engine (in-match admin menu): 'owner' | 'mod' | null. */
export function matchAdminLevel(level = getAdminLevel()) { return level === 'full' ? 'owner' : level === 'mod' ? 'mod' : null; }

// ---------- redeem ----------
/**
 * Check a code: online service first (when reachable), else locally. Never throws.
 * Returns { ok:true, level } | { ok:false, error, locked?: ms }.
 */
export async function redeemAdminCode(code, online = null) {
  // One verifier for every entry point (shared/adminauth.js): server bcrypt first (returns 'super' | 'full' and
  // stores the admin token for owner RPCs), else the local PBKDF2 table (super / full / temp). Same lockout.
  const srv = online && online.admin && typeof online.admin.verifyLevel === 'function' ? online : null;
  if (!srv && online && online.admin && typeof online.admin.verify === 'function' && String(code ?? '').trim() && lockRemainingMs() <= 0) {
    // older online layers: boolean verify only
    const up = typeof online.available === 'function' ? await tryCall(() => online.available()) : true;
    const v = up ? await tryCall(() => online.admin.verify(String(code)), 8000) : null;
    if (v === true || (v && typeof v === 'object' && (v.valid === true || v.admin === true))) {
      const level = v && ['super', 'full', 'temp'].includes(v.level) ? v.level : 'full';
      clearFailures(); setSessionLevel(level);
      return { ok: true, level };
    }
  }
  const r = await sharedVerifyAdminCode(code, srv, { table: ADMIN_CODE_PARAMS });
  if (!r.ok) return r;
  setSessionLevel(r.level);
  return r.server ? { ok: true, level: r.level, server: true } : { ok: true, level: r.level };
}
