// Pitchside 3D — cloud copy of the Ultimate Team save (localStorage 'pitchside.ut') for logged-in accounts,
// so the same club appears on every device. Policy:
//   * first sync of an account on a device: the server copy wins when it exists (the local club is kept as a
//     backup under 'pitchside.ut.backup'); otherwise the local club is uploaded (sign up / first login);
//   * afterwards local changes are uploaded (every minute, when the tab hides, and on demand) with an
//     optimistic revision; a conflict means another device saved newer data -> that copy is downloaded.
// DOM-free apart from the optional visibility hook. Never throws.

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };

export function createCloudSync(online, { storage = globalThis.localStorage, key = 'pitchside.ut', metaKey = 'pitchside.ut.cloud', intervalMs = 60000, onReplaced = null, log = () => {} } = {}) {
  const get = (k) => { try { return storage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { if (v == null) storage.removeItem(k); else storage.setItem(k, v); return true; } catch { return false; } };
  const readMeta = () => { try { const m = JSON.parse(get(metaKey) || 'null'); return m && typeof m.id === 'string' ? m : null; } catch { return null; } };
  const writeMeta = (m) => set(metaKey, m ? JSON.stringify(m) : null);
  let busy = null, timer = null, offAcc = null, lastAcc = null;

  function replaceLocal(data, rev, id) {
    const local = get(key);
    const next = JSON.stringify(data);
    if (local && local !== next) set(`${key}.backup`, local);
    set(key, next);
    writeMeta({ id, rev, hash: fnv(next) });
    if (onReplaced) { try { onReplaced(); } catch { /* ignore */ } }
    return 'downloaded';
  }

  async function run() {
    const acc = online.account.current();
    if (!acc || acc.state !== 'account' || !acc.id) return { ok: false, error: 'no_account' };
    const local = get(key);
    const meta = readMeta();
    const linked = meta && meta.id === acc.id;
    if (!linked || meta.rev === 0 || meta.fresh) {
      const r = await online.cloud.get();
      if (!r.ok) return r;
      if (r.exists && r.data) return { ok: true, action: replaceLocal(r.data, r.rev, acc.id) };
      if (!local) { writeMeta({ id: acc.id, rev: 0, hash: null }); return { ok: true, action: 'none' }; }
      return push(acc.id, local, 0);
    }
    const h = local ? fnv(local) : null;
    if (!local || h === meta.hash) return { ok: true, action: 'unchanged' };
    return push(acc.id, local, meta.rev);
  }
  async function push(id, local, rev) {
    let data;
    try { data = JSON.parse(local); } catch { return { ok: false, error: 'bad_value' }; }
    const r = await online.cloud.put(data, rev);
    if (r.ok) { writeMeta({ id, rev: r.rev, hash: fnv(local) }); return { ok: true, action: 'uploaded', rev: r.rev }; }
    if (r.error === 'conflict') {
      const g = await online.cloud.get();
      if (g.ok && g.exists && g.data) return { ok: true, action: replaceLocal(g.data, g.rev, id), conflict: true };
      return g.ok ? { ok: false, error: 'conflict' } : g;
    }
    if (r.error === 'too_large') log('[cloud] save too large to sync');
    return r;
  }
  /** One sync pass now (serialised). -> { ok, action: 'uploaded'|'downloaded'|'unchanged'|'none' } */
  function syncNow() {
    if (busy) return busy;
    busy = run().catch(() => ({ ok: false, error: 'offline' })).finally(() => { busy = null; });
    return busy;
  }
  return {
    syncNow,
    /** Start: sync on login / startup, every `intervalMs`, and when the tab hides. -> stop() */
    start() {
      lastAcc = online.account.current().id || null;
      offAcc = online.account.onChange((c) => {
        const id = c && c.state === 'account' ? c.id : null;
        if (id !== lastAcc) { lastAcc = id; if (id) { const m = readMeta(); if (m && m.id !== id) writeMeta(null); syncNow(); } }
      });
      timer = setInterval(syncNow, intervalMs);
      const onHide = () => { if (typeof document !== 'undefined' && document.hidden) syncNow(); };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
      syncNow();
      return () => { clearInterval(timer); if (offAcc) offAcc(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide); };
    },
  };
}
