// Pitchside 3D — account rules shared by the UI, the services layer, the mock backend and the tests.
// Pure functions, no DOM. The username / name-filter rules mirror supabase/migrations/002_accounts_moderation.sql
// (pitchside__username_error, pitchside__name_norm, pitchside__name_reserved) and the password rules mirror
// pitchside__password_error (migration 008) — keep them in sync.

export const USERNAME_MIN = 1;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt limit
// Owner, Sep 30: no username restrictions. Any characters, 1-16 long; only control / invisible characters are refused
// (they break how names render). No word filter. Uniqueness and the reserved owner name still apply.
// eslint-disable-next-line no-control-regex
const USERNAME_BAD_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;

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
  const n = [...u].length;
  if (n < USERNAME_MIN || n > USERNAME_MAX || USERNAME_BAD_RE.test(u)) return 'bad_username';
  return null;
}
// COMMON-PASSWORDS (same list, same order as pitchside__password_error in migration 008). Only entries of 8+
// characters that are not all digits: shorter / digit-only passwords are refused by the other rules anyway.
export const COMMON_PASSWORDS = [
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'qwertyuiop', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyui', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4',
  '1qaz2wsx', 'zaq12wsx', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'abc12345', 'abcd1234', 'abcdefgh',
  'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'superman', 'starwars', 'trustno1', 'letmein1',
  'welcome1', 'welcome123', 'whatever', 'football', 'football1', 'baseball', 'basketball', 'soccer123',
  'liverpool', 'chelsea1', 'arsenal1', 'barcelona', 'realmadrid', 'manchester', 'ronaldo7', 'cristiano',
  'messi123', 'pitchside'];
const COMMON_SET = new Set(COMMON_PASSWORDS);

/**
 * Password rules for NEW passwords (sign-up, claim, change password; login never checks them, so older
 * accounts with short passwords still log in). Same rules and codes as the server (migration 008):
 * 8-72 chars, no control characters, not the username, not one repeated character, not only digits,
 * not a very common password. -> null | 'weak_password' | 'bad_password' | 'password_mismatch'
 */
export function passwordError(pw, username = '', confirm) {
  if (typeof pw !== 'string' || [...pw].length < PASSWORD_MIN) return 'weak_password';
  // eslint-disable-next-line no-control-regex
  if (pw.length > PASSWORD_MAX || new TextEncoder().encode(pw).length > PASSWORD_MAX || /[\u0000-\u001f\u007f]/.test(pw)) return 'bad_password';
  const low = pw.toLowerCase();
  if (low === trimUsername(username).toLowerCase()) return 'weak_password';
  if (/^([\s\S])\1*$/u.test(pw) || /^[0-9]+$/.test(pw) || COMMON_SET.has(low)) return 'weak_password';
  if (confirm !== undefined && confirm !== pw) return 'password_mismatch';
  return null;
}

/**
 * Plain-language hint for the password field while typing (no network). -> { level: 0-3, text }
 * level 0 = will be refused, 1 = allowed but short, 2 = fine, 3 = strong.
 */
export function passwordHint(pw, username = '') {
  const s = typeof pw === 'string' ? pw : '';
  if (!s) return { level: 0, text: 'At least 8 characters. Avoid common passwords.' };
  const e = passwordError(s, username);
  if (e === 'bad_password') return { level: 0, text: 'Too long (max 72 characters).' };
  if (e) {
    const low = s.toLowerCase();
    const why = [...s].length < PASSWORD_MIN ? `${PASSWORD_MIN - [...s].length} more character${PASSWORD_MIN - [...s].length === 1 ? '' : 's'} needed.`
      : low === trimUsername(username).toLowerCase() ? 'Must not be your username.'
        : /^[0-9]+$/.test(s) ? 'Add letters, not only numbers.'
          : COMMON_SET.has(low) ? 'Too common. Pick something less obvious.'
            : 'Use different characters.';
    return { level: 0, text: `Too weak: ${why}` };
  }
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
  const n = [...s].length;
  if (n >= 14 || (n >= 10 && kinds >= 3)) return { level: 3, text: 'Strong password.' };
  if (n >= 10 || kinds >= 3) return { level: 2, text: 'Good password.' };
  return { level: 1, text: 'OK. A longer password is safer.' };
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
