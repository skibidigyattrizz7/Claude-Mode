// Pitchside 3D — network session (handshake, heartbeat/ping, link-loss detection) and
// the in-match drivers that pump inputs (guest -> host) and snapshots (host -> guest).
// UI-free so it can be exercised over LoopbackTransport in tests.
import { PROTOCOL_VERSION, packInput, unpackInput, sanitizeInput } from './protocol.js';

const PING_MS = 1000;
const CHECK_MS = 250;

export class NetSession {
  /**
   * @param {object} transport  see transport.js
   * @param {{ dcDetectMs?: number, name?: string, matchToken?: string }} opts
   *   matchToken: quick-search pairing token from the server; the host only accepts a guest whose
   *   hello carries the same token (so only the matched opponent can take the seat).
   */
  constructor(transport, { dcDetectMs = 3500, name = 'Player', matchToken = null } = {}) {
    this.t = transport;
    this.matchToken = typeof matchToken === 'string' ? matchToken : null;
    this.dcDetectMs = dcDetectMs;
    this.name = String(name).slice(0, 24);
    this.token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.peerToken = null;
    this.peerName = 'Opponent';
    this.role = null;
    this.linked = false;
    this.everLinked = false;
    this.rtt = null;
    this.lastRecv = 0;
    this.closed = false;
    this.handlers = new Map();
    this.t.onMessage = (m) => this._onMessage(m);
    this.t.onStatus = (s, d) => this._onStatus(s, d);
    this._timers = [
      setInterval(() => this._ping(), PING_MS),
      setInterval(() => this._check(), CHECK_MS),
    ];
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  _emit(type, ...args) {
    const hs = this.handlers.get(type);
    if (!hs) return;
    for (const fn of [...hs]) {
      try { fn(...args); } catch (e) { console.error(`[net] ${type} handler failed`, e); }
    }
  }

  async host() {
    this.role = 'host';
    const code = await this.t.host();
    this.code = code;
    return code;
  }

  async join(code) {
    this.role = 'guest';
    await this.t.join(code);
    this.code = this.t.code;
    await this._awaitLink(10000, 'Host did not answer.');
  }

  /**
   * Use a transport that is already listening (host) or connected (guest), e.g. from quick search.
   * Guest: resolves once the host welcomed us. Host: resolves once the (token-checked) guest said hello.
   */
  async attach(role, timeoutMs = 25000) {
    this.role = role === 'host' ? 'host' : 'guest';
    this.code = this.t.code;
    await this._awaitLink(timeoutMs, this.role === 'host' ? 'Your opponent did not connect.' : 'The host did not answer.');
  }

  _awaitLink(timeoutMs, msg) {
    if (this.linked) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let iv = null;
      const stop = () => { off(); offF(); clearTimeout(to); if (iv) clearInterval(iv); };
      const off = this.on('link', (up) => { if (up) { stop(); resolve(); } });
      const offF = this.on('fatal', (why) => { stop(); reject(new Error(why)); });
      const to = setTimeout(() => { stop(); reject(new Error(msg)); }, timeoutMs);
      if (this.role === 'guest') {
        this._hello();
        // the host may not be listening to its transport yet: repeat until welcomed
        iv = setInterval(() => { if (!this.closed && !this.linked) this._hello(); }, 1000);
      }
    });
  }

  _hello() { this.t.send({ t: 'hello', v: PROTOCOL_VERSION, tok: this.token, name: this.name, ...(this.matchToken ? { mt: this.matchToken } : {}) }); }

  /** Send an application message. rt=true -> realtime channel. */
  send(t, payload = {}, rt = false) {
    if (this.closed) return false;
    return this.t.send({ ...payload, t }, { rt });
  }

  _setLinked(up) {
    if (this.linked === up) return;
    this.linked = up;
    if (up) this.everLinked = true;
    this._emit('link', up);
  }

  _onStatus(s, detail) {
    this._emit('status', s, detail);
    if (s === 'down' && this.linked) this._setLinked(false);
    if (s === 'open' && this.role === 'guest' && this.everLinked) this._hello();
  }

  _onMessage(m) {
    if (this.closed) return;
    this.lastRecv = performance.now();
    switch (m.t) {
      case 'hello': {
        if (this.role !== 'host') return;
        if (m.v !== PROTOCOL_VERSION) { this.t.send({ t: 'fatal', why: 'Game versions differ. Both players should reload.' }); return; }
        if (this.matchToken && m.mt !== this.matchToken) { this.t.send({ t: 'fatal', why: 'This match is reserved for another player.' }); return; }
        const tok = typeof m.tok === 'string' ? m.tok.slice(0, 64) : '';
        if (this.peerToken && tok !== this.peerToken && this.locked) {
          this.t.send({ t: 'fatal', why: 'That room is already in a match.' });
          return;
        }
        const resume = this.peerToken === tok;
        if (!resume && this.peerToken) this._emit('newpeer');
        this.peerToken = tok;
        this.peerName = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 24) : 'Opponent';
        this.t.send({ t: 'welcome', v: PROTOCOL_VERSION, tok: this.token, name: this.name, resume });
        this._setLinked(true);
        return;
      }
      case 'welcome':
        if (this.role !== 'guest') return;
        this.peerToken = typeof m.tok === 'string' ? m.tok.slice(0, 64) : '';
        this.peerName = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 24) : 'Host';
        this._setLinked(true);
        return;
      case 'fatal':
        this._emit('fatal', typeof m.why === 'string' ? m.why.slice(0, 120) : 'Connection refused.');
        return;
      case 'ping':
        this.t.send({ t: 'pong', ts: m.ts });
        break;
      case 'pong':
        if (typeof m.ts === 'number' && Number.isFinite(m.ts)) {
          const rtt = performance.now() - m.ts;
          if (rtt >= 0 && rtt < 60000) { this.rtt = this.rtt == null ? rtt : this.rtt * 0.7 + rtt * 0.3; this._emit('ping', Math.round(this.rtt)); }
        }
        break;
      case 'bye':
        this._emit('bye');
        return;
      default:
        break;
    }
    // Any traffic from the accepted peer means the link is alive again.
    if (!this.linked && this.peerToken) this._setLinked(true);
    if (m.t !== 'ping' && m.t !== 'pong') this._emit('msg', m);
  }

  _ping() {
    if (this.closed) return;
    if (this.linked) this.t.send({ t: 'ping', ts: performance.now() });
  }

  _check() {
    if (this.closed) return;
    const now = performance.now();
    if (this.linked && now - this.lastRecv > this.dcDetectMs) this._setLinked(false);
    if (!this.linked && this.everLinked && this.role === 'guest') {
      this.t.reconnect();
      if (!this._lastHello || now - this._lastHello > 1000) { this._lastHello = now; this._hello(); }
    }
  }

  /** Graceful shutdown: tells the peer we left on purpose. */
  close() {
    if (this.closed) return;
    try { this.t.send({ t: 'bye' }); } catch { /* ignore */ }
    this.closed = true;
    for (const id of this._timers) clearInterval(id);
    // give the bye a moment to flush before tearing the transport down
    setTimeout(() => { try { this.t.close(); } catch { /* ignore */ } }, 150);
  }
}

const NEUTRAL = sanitizeInput(null);

/**
 * Host side of a running match: applies the guest's inputs to the away side and streams
 * snapshots at ~20 Hz. Returns stop().
 */
export function driveHost(session, handle, { side = 'away', snapHz = 20 } = {}) {
  let lastIn = -1;
  let snapSeq = 0;
  let budget = 90; // simple flood guard: max ~90 input msgs per second
  const refill = setInterval(() => { budget = 90; }, 1000);
  const offMsg = session.on('msg', (m) => {
    if (m.t !== 'in') return;
    if (budget-- <= 0) return;
    const s = Number(m.s);
    if (!Number.isInteger(s) || s <= lastIn) return;
    lastIn = s;
    try { handle.setRemoteInput(side, unpackInput(m.i)); } catch (e) { console.warn('[net] setRemoteInput failed', e); }
  });
  const offLink = session.on('link', (up) => {
    if (!up) { try { handle.setRemoteInput(side, NEUTRAL); } catch { /* ignore */ } }
  });
  // A reconnecting guest restarts its sequence numbers.
  const offNew = session.on('msg', (m) => { if (m.t === 'loaded') lastIn = -1; });
  const snapTimer = setInterval(() => {
    if (!session.linked) return;
    let snap;
    try { snap = handle.getSnapshot(); } catch (e) { console.warn('[net] getSnapshot failed', e); return; }
    session.send('snap', { s: ++snapSeq, d: snap }, true);
  }, Math.round(1000 / snapHz));
  return {
    stop() { clearInterval(snapTimer); clearInterval(refill); offMsg(); offLink(); offNew(); },
    /** push one last snapshot immediately (e.g. at full time) */
    flush() {
      try { session.send('snap', { s: ++snapSeq, d: handle.getSnapshot() }, true); } catch { /* ignore */ }
    },
  };
}

/**
 * Guest side of a running match: samples local input for `side` at ~30 Hz and sends changes
 * (+ a heartbeat every 250 ms); applies incoming snapshots in order. Returns stop().
 */
export function driveGuest(session, handle, { side = 'away', inputHz = 30 } = {}) {
  let lastSnap = -1;
  let seq = 0;
  let lastKey = '';
  let lastSent = 0;
  const offMsg = session.on('msg', (m) => {
    if (m.t !== 'snap') return;
    const s = Number(m.s);
    if (!Number.isInteger(s) || s <= lastSnap) return;
    if (!m.d || typeof m.d !== 'object') return;
    lastSnap = s;
    try { handle.applySnapshot(m.d); } catch (e) { console.warn('[net] applySnapshot failed', e); }
  });
  // host restarts snapshot numbering for every new match
  const offStart = session.on('msg', (m) => { if (m.t === 'start') lastSnap = -1; });
  const timer = setInterval(() => {
    if (!session.linked) return;
    let raw;
    try { raw = handle.getLocalInput(side); } catch { return; }
    const packed = packInput(raw);
    const key = packed.join(',');
    const now = performance.now();
    if (key !== lastKey || now - lastSent > 250) {
      lastKey = key;
      lastSent = now;
      session.send('in', { s: ++seq, i: packed }, true);
    }
  }, Math.round(1000 / inputHz));
  return { stop() { clearInterval(timer); offMsg(); offStart(); } };
}
