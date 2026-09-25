// localStorage wrapper; every key is prefixed with `pitchside.` and every access is guarded.
export const PREFIX = 'pitchside.';

export function load(key, fallback = null) {
  try {
    const s = globalThis.localStorage.getItem(PREFIX + key);
    return s ? JSON.parse(s) : fallback;
  } catch { return fallback; }
}
export function save(key, val) {
  try { globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(val)); return true; } catch { return false; }
}
export function remove(key) {
  try { globalThis.localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}
