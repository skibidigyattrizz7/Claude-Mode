// Pitchside 3D — cloud copy of the Ultimate Team save (localStorage 'pitchside.ut') for logged-in accounts,
// so the same club appears on every device. Policy:
//   * first sync of an account on a device: the server copy wins when it exists (the local club is kept as a
//     backup under 'pitchside.ut.backup'); otherwise the local club is uploaded (sign up / first login);
//   * afterwards local changes are uploaded (every minute, when the tab hides, and on demand) with an
//     optimistic revision; a conflict means another device saved newer data -> that copy is downloaded.
//   * `beforeSync` runs before every pass (main.js: apply server-side resets / owner patches to the local club first),
//     so nothing stale is ever uploaded over an owner edit; the owner's club reset also deletes the server copy, and
//     a conflict against a deleted copy re-runs `beforeSync` and then uploads (never blindly). `afterSync(result)` runs
//     after every pass (main.js: acknowledge owner patches once the patched club is on the server).
// DOM-free apart from the optional visibility hook. Never throws.

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };

export function createCloudSync(online, { storage = globalThis.localStorage, key = 'pitchside.ut', metaKey = 'pitchside.ut.cloud', intervalMs = 60000, onReplaced = null, beforeSync = null, afterSync = null, log = () => {} } = {}) {
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

  // Device guests (migration 007) keep a server copy too, so the owner can see / edit every club; their
  // local club always wins (owner edits arrive as owner patches, never as a server download).
  function identity() {
    const acc = online.account.current();
    if (acc && acc.state === 'account' && acc.id) return { id: acc.id, guest: false };
    const gid = typeof online.identityId === 'function' && typeof online.hasIdentity === 'function' && online.hasIdentity() ? online.identityId() : null;
    return gid && !(acc && acc.state === 'banned') ? { id: gid, guest: true } : null;
  }
  const pre = async () => { if (beforeSync) { try { await beforeSync(); } catch { /* never blocks a sync */ } } };
  async function run() {
    await pre();
    const who = identity();
    if (!who) return { ok: false, error: 'no_account' };
    const acc = { id: who.id };
    const local = get(key);
    const meta = readMeta();
    const linked = meta && meta.id === acc.id;
    if (who.guest) {
      if (!local) return { ok: true, action: 'none' };
      if (linked && meta.hash === fnv(local)) return { ok: true, action: 'unchanged' };
      let rev = linked ? meta.rev : null;
      if (rev == null) { const g = await online.cloud.get(); if (!g.ok) return g; rev = g.rev; }
      let data;
      try { data = JSON.parse(local); } catch { return { ok: false, error: 'bad_value' }; }
      let r = await online.cloud.put(data, rev);
      if (!r.ok && r.error === 'conflict' && Number.isInteger(r.rev)) {
        // the server copy changed (or was deleted by an owner club reset): apply server-side changes to the local
        // club first, then upload what is local NOW
        await pre();
        const cur = get(key);
        if (!cur) return { ok: true, action: 'none' };
        try { data = JSON.parse(cur); } catch { return { ok: false, error: 'bad_value' }; }
        r = await online.cloud.put(data, r.rev);
        if (r.ok) { writeMeta({ id: acc.id, rev: r.rev, hash: fnv(cur), guest: true }); return { ok: true, action: 'uploaded', rev: r.rev }; }
      }
      if (r.ok) { writeMeta({ id: acc.id, rev: r.rev, hash: fnv(local), guest: true }); return { ok: true, action: 'uploaded', rev: r.rev }; }
      return r;
    }
    if (!linked || meta.rev === 0 || meta.fresh || meta.guest) {
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
      if (g.ok && !g.exists) {
        // no server copy any more (the owner reset this club): apply the pending reset locally FIRST, then upload
        await pre();
        const cur = get(key);
        if (!cur) return { ok: true, action: 'none' };
        let d2;
        try { d2 = JSON.parse(cur); } catch { return { ok: false, error: 'bad_value' }; }
        const r2 = await online.cloud.put(d2, g.rev || 0);
        if (r2.ok) { writeMeta({ id, rev: r2.rev, hash: fnv(cur) }); return { ok: true, action: 'uploaded', rev: r2.rev }; }
        return r2;
      }
      return g.ok ? { ok: false, error: 'conflict' } : g;
    }
    if (r.error === 'too_large') log('[cloud] save too large to sync');
    return r;
  }
  /** One sync pass now (serialised). -> { ok, action: 'uploaded'|'downloaded'|'unchanged'|'none' } */
  function syncNow() {
    if (busy) return busy;
    busy = run().catch(() => ({ ok: false, error: 'offline' }))
      .then(async (res) => { if (afterSync) { try { await afterSync(res); } catch { /* ignore */ } } return res; })
      .finally(() => { busy = null; });
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
