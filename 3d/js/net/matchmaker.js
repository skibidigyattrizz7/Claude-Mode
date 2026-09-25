// Pitchside 3D — Quick Search client state machine. UI-free and dependency-injected so it can be
// unit-tested with a fake RPC + loopback transport.
//
//   idle -> opening (peer registers with the signalling server under a random id)
//        -> queued  (mm_enqueue, then mm_poll every pollMs; the server pairs players atomically)
//        -> matched (server says who hosts; the waiting/older entry hosts because its peer is listening)
//        -> linking (guest only: open a data connection to the host's peer id)
//        -> done | failed | cancelled | timeout
import { parseMmResponse, MODES } from './validate.js';

export const MM_DEFAULTS = { pollMs: 1500, timeoutMs: 90000, openTimeoutMs: 15000, connectTimeoutMs: 20000, maxErrors: 5 };

/** Random PeerJS-safe id (starts/ends alphanumeric), e.g. "psq-k3j9...". */
export function randomPeerId(randBytes) {
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randBytes ? randBytes(20) : (() => {
    const b = new Uint8Array(20);
    if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
    else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  })();
  let s = 'psq-';
  for (let i = 0; i < 20; i++) s += A[bytes[i] % A.length];
  return s;
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

/**
 * @param {object} deps
 *   rpc(fn, args) -> Promise<{ok:true, data}|{ok:false, error}>
 *   identity()    -> Promise<{id, secret}|null>
 *   createTransport() -> transport with listen(id), connectTo(id), close()
 *   now(), sleep(ms)   (optional, for tests)
 */
export function createMatchmaker(deps) {
  const cfg = { ...MM_DEFAULTS, ...(deps.config || {}) };
  const now = deps.now || (() => Date.now());
  let current = null; // active search

  async function search({ mode, onProgress } = {}) {
    if (!MODES.includes(mode)) return { ok: false, error: 'bad_mode' };
    if (current) current.cancel();
    const job = { cancelled: false, state: 'idle', wake: null, transport: null, queueId: null, ident: null };
    job.cancel = () => {
      job.cancelled = true;
      if (job.wake) job.wake();
    };
    current = job;
    const t0 = now();
    const emit = (state, extra = {}) => {
      job.state = state;
      if (onProgress) { try { onProgress({ state, elapsedMs: now() - t0, ...extra }); } catch (e) { console.error(e); } }
    };
    const sleep = (ms) => new Promise((res) => {
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); job.wake = null; res(); }
      job.wake = done;
      if (deps.sleep) deps.sleep(ms).then(done);
    });
    const closeT = () => { if (job.transport) { try { job.transport.close(); } catch { /* ignore */ } job.transport = null; } };
    const leaveQueue = async () => {
      if (!job.queueId || !job.ident) return null;
      const r = await deps.rpc('mm_cancel', { p_id: job.ident.id, p_secret: job.ident.secret, p_queue_id: job.queueId });
      const m = r.ok ? parseMmResponse(r.data) : null;
      return m && m.ok && m.matched ? m : null;
    };
    const finish = (res) => {
      if (current === job) current = null;
      if (!res.ok) closeT();
      emit(res.ok ? 'done' : res.cancelled ? 'cancelled' : res.error === 'timeout' ? 'timeout' : 'failed', res.ok ? {} : { error: res.error });
      return res;
    };
    const cancelled = async () => { await leaveQueue().catch(() => null); return finish({ ok: false, cancelled: true, error: 'cancelled' }); };

    try {
      emit('opening');
      job.ident = await deps.identity();
      if (job.cancelled) return cancelled();
      if (!job.ident) return finish({ ok: false, error: 'offline' });
      const peerId = randomPeerId(deps.randBytes);
      job.transport = deps.createTransport();
      await withTimeout(job.transport.listen(peerId), cfg.openTimeoutMs, 'Could not reach the connection server.');
      if (job.cancelled) return cancelled();

      let r = await deps.rpc('mm_enqueue', { p_id: job.ident.id, p_secret: job.ident.secret, p_mode: mode, p_peer_id: peerId });
      let m = r.ok ? parseMmResponse(r.data) : { ok: false, error: r.error };
      if (!m.ok) return finish({ ok: false, error: m.error });
      job.queueId = m.queueId;
      let errors = 0;
      while (!m.matched) {
        if (job.cancelled) return cancelled();
        if (now() - t0 > cfg.timeoutMs) {
          const late = await leaveQueue().catch(() => null); // may have been matched in the meantime
          if (late) { m = late; break; }
          return finish({ ok: false, error: 'timeout' });
        }
        emit('queued', { waitedMs: m.waitedMs || 0 });
        await sleep(cfg.pollMs);
        if (job.cancelled) return cancelled();
        r = await deps.rpc('mm_poll', { p_id: job.ident.id, p_secret: job.ident.secret, p_queue_id: job.queueId });
        const next = r.ok ? parseMmResponse(r.data) : { ok: false, error: r.error };
        if (next.ok) { m = next; errors = 0; continue; }
        if (next.error === 'not_queued') {
          // purged (e.g. tab was asleep) -> re-enter the queue with the same peer
          r = await deps.rpc('mm_enqueue', { p_id: job.ident.id, p_secret: job.ident.secret, p_mode: mode, p_peer_id: peerId });
          const again = r.ok ? parseMmResponse(r.data) : { ok: false, error: r.error };
          if (again.ok) { m = again; job.queueId = again.queueId; continue; }
        }
        if (++errors >= cfg.maxErrors) return finish({ ok: false, error: next.error || 'offline' });
      }
      emit('matched', { opponent: m.opponent, role: m.role });
      if (m.role === 'guest') {
        emit('linking', { opponent: m.opponent, role: m.role });
        try {
          await withTimeout(job.transport.connectTo(m.opponentPeerId), cfg.connectTimeoutMs, 'Could not connect to the opponent.');
        } catch (e) {
          return finish({ ok: false, error: 'connect_failed', message: e.message });
        }
        if (job.cancelled) return finish({ ok: false, cancelled: true, error: 'cancelled' });
      }
      const out = { ok: true, transport: job.transport, role: m.role, opponent: m.opponent, token: m.token, queueId: job.queueId };
      job.transport = null; // ownership passes to the caller
      return finish(out);
    } catch (e) {
      return finish({ ok: false, error: 'failed', message: String((e && e.message) || e) });
    }
  }

  return {
    search,
    cancel() { if (current) current.cancel(); },
    get state() { return current ? current.state : 'idle'; },
  };
}
