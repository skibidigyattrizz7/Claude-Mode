// Pitchside 3D — account rules shared by the UI, the services layer, the mock backend and the tests.
// Pure functions, no DOM. The username / name-filter rules mirror supabase/migrations/002_accounts_moderation.sql
// (pitchside__username_error, pitchside__name_norm, pitchside__name_reserved) — keep them in sync.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt limit
const USERNAME_RE = /^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$/;

// BLOCKLIST (same words, same order as the SQL regex between BLOCKLIST-BEGIN / BLOCKLIST-END)
export const BLOCKED_WORDS = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fagg', 'whore', 'slut', 'pussy', 'wank', 'twat', 'retard',
  'nazi', 'hitler', 'porn', 'penis', 'vagina', 'dildo', 'jizz', 'asshole', 'bastard', 'admin', 'moderator', 'pitchside', 'official'];
export const RESERVED_OWNER_NAME = 'shawkyfc';

/** Lower-case, map 0134578 -> oieastb, keep only a-z (for the word filter / reserved names). */
export function nameNorm(s) {
  const map = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
  return String(s || '').toLowerCase().replace(/[0134578]/g, (d) => map[d]).replace(/[^a-z]/g, '');
}
/** Uniqueness key used by the server: lower-case, spaces and underscores removed. */
export const usernameKey = (s) => String(s || '').toLowerCase().replace(/[ _]/g, '');
export const isReservedName = (s) => nameNorm(s).includes(RESERVED_OWNER_NAME);
export const isBlockedName = (s) => { const n = nameNorm(s); return BLOCKED_WORDS.some((w) => n.includes(w)); };
export const trimUsername = (s) => String(s == null ? '' : s).trim();

/** -> null when OK, else an error code (same codes as the server). Reserved names are OK here. */
export function usernameError(raw) {
  const u = trimUsername(raw);
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX || !USERNAME_RE.test(u)) return 'bad_username';
  if (isBlockedName(u)) return 'username_not_allowed';
  return null;
}
export function passwordError(pw, username = '', confirm) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return 'weak_password';
  // eslint-disable-next-line no-control-regex
  if (pw.length > PASSWORD_MAX || new TextEncoder().encode(pw).length > PASSWORD_MAX || /[\u0000-\u001f\u007f]/.test(pw)) return 'bad_password';
  if (pw.toLowerCase() === trimUsername(username).toLowerCase()) return 'weak_password';
  if (confirm !== undefined && confirm !== pw) return 'password_mismatch';
  return null;
}

/** Ban details from the server ({reason, until} object or its JSON text) -> { reason, until:ISO|null } */
export function parseBan(x) {
  let b = x;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== 'object') b = {};
  const reason = typeof b.reason === 'string' ? b.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : ''; // eslint-disable-line no-control-regex
  const t = typeof b.until === 'string' ? Date.parse(b.until) : NaN;
  return { reason: reason || 'No reason given', until: Number.isFinite(t) ? new Date(t).toISOString() : null };
}
/** A cached ban still applies (permanent, or until a future time). */
export const banActive = (ban, now = Date.now()) => !!ban && (!ban.until || Date.parse(ban.until) > now);
export function banText(ban) {
  if (!ban) return '';
  const until = ban.until ? ` (until ${new Date(ban.until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})` : ' (permanent)';
  return `Your account is banned: ${ban.reason}${until}`;
}
