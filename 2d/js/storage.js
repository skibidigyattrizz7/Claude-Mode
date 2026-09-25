// Safe localStorage wrapper: every access is guarded (private mode / blocked storage / node).

function ls() {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export const store = {
  get(key, fallback) {
    try {
      const s = ls() && ls().getItem(key);
      return s == null ? fallback : JSON.parse(s);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { const l = ls(); if (!l) return false; l.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
  del(key) {
    try { const l = ls(); if (l) l.removeItem(key); } catch (e) { /* ignore */ }
  },
};

/** A storage-like adapter (getItem/setItem) usable by pure modules; defaults to localStorage. */
export function defaultStorage() {
  return {
    getItem(k) { try { const l = ls(); return l ? l.getItem(k) : null; } catch (e) { return null; } },
    setItem(k, v) { try { const l = ls(); if (l) l.setItem(k, v); } catch (e) { /* ignore */ } },
  };
}
