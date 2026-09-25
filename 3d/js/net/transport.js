// Pitchside 3D — network transports.
//
// Common interface (all transports):
//   await t.host()        -> room code (string, 5 chars). Starts listening for one guest.
//   await t.join(code)    -> resolves when the link to the host is open (rejects e.g. "Room not found").
//   t.send(obj, { rt })   -> send a JSON-able message. rt=true: realtime (unreliable/ordered channel if any).
//   t.onMessage = (obj) => {}     // already decoded + size-capped (see protocol.decode)
//   t.onStatus  = (status, detail) => {}  // 'connecting'|'waiting'|'open'|'down'|'closed'|'error'
//   t.reconnect()         -> guest only: try to re-establish a lost link (idempotent)
//   t.close()
//
// Implementations: PeerTransport (WebRTC via PeerJS cloud or a custom PeerServer),
// LoopbackTransport (same page, in-memory; for tests), BroadcastChannelTransport (two tabs, same origin; for tests).
import { encode, decode, makeRoomCode, normalizeRoomCode, PEER_PREFIX } from './protocol.js';

class BaseTransport {
  constructor() {
    this.onMessage = null;
    this.onStatus = null;
    this.code = null;
    this.role = null;
    this.status = 'idle';
    this.closed = false;
  }
  _emitRaw(raw) {
    if (this.closed) return;
    const m = decode(raw);
    if (m && this.onMessage) {
      try { this.onMessage(m); } catch (e) { console.error('[net] handler error', e); }
    }
  }
  _setStatus(s, detail) {
    if (this.closed && s !== 'closed') return;
    this.status = s;
    if (this.onStatus) {
      try { this.onStatus(s, detail); } catch (e) { console.error('[net] status handler error', e); }
    }
  }
  reconnect() {}
}

// ---------------------------------------------------------------- Loopback
const loopRooms = new Map(); // code -> host LoopbackTransport

/** In-memory transport for tests. `latency` in ms (default 5). */
export class LoopbackTransport extends BaseTransport {
  constructor({ latency = 5 } = {}) {
    super();
    this.latency = latency;
    this.peer = null;
  }
  async host() {
    this.role = 'host';
    let code;
    do code = makeRoomCode(); while (loopRooms.has(code));
    this.code = code;
    loopRooms.set(code, this);
    this._setStatus('waiting');
    return code;
  }
  async join(code) {
    this.role = 'guest';
    this.code = normalizeRoomCode(code);
    await new Promise((r) => setTimeout(r, this.latency));
    const h = loopRooms.get(this.code);
    if (!h || h.closed) throw new Error('Room not found');
    this._link(h);
  }
  _link(h) {
    if (h.peer && h.peer !== this) h.peer.peer = null;
    h.peer = this;
    this.peer = h;
    h._setStatus('open');
    this._setStatus('open');
  }
  send(obj) {
    const p = this.peer;
    if (!p || this.closed) return false;
    const raw = encode(obj);
    setTimeout(() => { if (p.peer === this) p._emitRaw(raw); }, this.latency);
    return true;
  }
  /** Test helper: cut the link as if the network dropped (no close message is delivered). */
  simulateDrop() {
    const p = this.peer;
    this.peer = null;
    if (p) { p.peer = null; p._setStatus('down'); }
    this._setStatus('down');
  }
  reconnect() {
    if (this.role !== 'guest' || this.peer || this.closed) return;
    const h = loopRooms.get(this.code);
    if (h && !h.closed) this._link(h);
  }
  close() {
    if (this.closed) return;
    const p = this.peer;
    this.peer = null;
    this.closed = true;
    if (this.role === 'host' && loopRooms.get(this.code) === this) loopRooms.delete(this.code);
    if (p) { p.peer = null; p._setStatus('down'); }
    this._setStatus('closed');
  }
}

// ---------------------------------------------------------------- BroadcastChannel
/** Two tabs/pages of the same origin. Used by the automated tests (`?net=bc`). */
export class BroadcastChannelTransport extends BaseTransport {
  constructor() {
    super();
    this.me = Math.random().toString(36).slice(2, 10);
    this.other = null;
    this.ch = null;
  }
  _open(code) {
    this.ch = new BroadcastChannel(`pitchside-bc-${code}`);
    this.ch.onmessage = (ev) => this._onBc(ev.data);
  }
  _onBc(d) {
    if (!d || typeof d !== 'object' || d.from === this.me) return;
    if (d.k === 'hello' && this.role === 'host') {
      this.other = d.from; // accept (re)joins; the session layer checks the token
      this.ch.postMessage({ k: 'welcome', from: this.me, to: d.from });
      this._setStatus('open');
    } else if (d.k === 'welcome' && this.role === 'guest' && d.to === this.me) {
      this.other = d.from;
      if (this._joinResolve) { this._joinResolve(); this._joinResolve = null; }
      this._setStatus('open');
    } else if (d.k === 'probe' && this.role === 'host') {
      this.ch.postMessage({ k: 'taken', from: this.me });
    } else if (d.k === 'taken' && this._probe) {
      this._probe();
    } else if (d.k === 'm' && d.from === this.other && d.to === this.me) {
      this._emitRaw(d.d);
    } else if (d.k === 'bye' && d.from === this.other) {
      this._setStatus('down');
    }
  }
  async host() {
    this.role = 'host';
    for (let tries = 0; tries < 5; tries++) {
      const code = makeRoomCode();
      this._open(code);
      // make sure nobody else hosts this code
      const taken = await new Promise((res) => {
        this._probe = () => res(true);
        this.ch.postMessage({ k: 'probe', from: this.me });
        setTimeout(() => res(false), 150);
      });
      this._probe = null;
      if (!taken) { this.code = code; this._setStatus('waiting'); return code; }
      this.ch.close();
    }
    throw new Error('Could not allocate a room');
  }
  async join(code) {
    this.role = 'guest';
    this.code = normalizeRoomCode(code);
    this._open(this.code);
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      this._joinResolve = resolve;
      this.ch.postMessage({ k: 'hello', from: this.me });
      setTimeout(() => { if (this._joinResolve) { this._joinResolve = null; reject(new Error('Room not found')); } }, 2000);
    });
  }
  reconnect() {
    if (this.role === 'guest' && this.ch && !this.closed) this.ch.postMessage({ k: 'hello', from: this.me });
  }
  send(obj) {
    if (!this.ch || !this.other || this.closed) return false;
    this.ch.postMessage({ k: 'm', from: this.me, to: this.other, d: encode(obj) });
    return true;
  }
  close() {
    if (this.closed) return;
    try { if (this.ch) { this.ch.postMessage({ k: 'bye', from: this.me }); this.ch.close(); } } catch { /* ignore */ }
    this.closed = true;
    this._setStatus('closed');
  }
}

// ---------------------------------------------------------------- PeerJS
let peerLoad = null;
/** Lazily load the vendored PeerJS classic script (window.Peer). */
export function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLoad) return peerLoad;
  peerLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
    s.async = true;
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS did not initialise')));
    s.onerror = () => { peerLoad = null; reject(new Error('Could not load PeerJS')); };
    document.head.appendChild(s);
  });
  return peerLoad;
}

const PEER_ERRORS = {
  'browser-incompatible': 'This browser does not support WebRTC.',
  network: 'Cannot reach the matchmaking server.',
  'server-error': 'Matchmaking server error.',
  'socket-error': 'Matchmaking server connection failed.',
  'socket-closed': 'Matchmaking server closed the connection.',
  'ssl-unavailable': 'Secure connection to the server is unavailable.',
  'peer-unavailable': 'Room not found.',
  'unavailable-id': 'That room code is already in use.',
  webrtc: 'WebRTC connection failed.',
};

/**
 * WebRTC transport via PeerJS. `cfg` = { host, port, path, secure, key } for a custom PeerServer,
 * or {} for the default PeerJS cloud broker.
 */
export class PeerTransport extends BaseTransport {
  constructor(cfg = {}) {
    super();
    this.cfg = cfg || {};
    this.peer = null;
    this.ctl = null;
    this.rt = null;
    this._retry = null;
  }
  _peerOptions() {
    const o = { debug: 1 };
    const c = this.cfg;
    if (c.host) {
      o.host = String(c.host);
      if (c.port) o.port = Number(c.port);
      if (c.path) o.path = String(c.path);
      o.secure = c.secure !== undefined ? !!c.secure : location.protocol === 'https:';
      if (c.key) o.key = String(c.key);
    }
    return o;
  }
  _wireConn(conn) {
    conn.on('data', (d) => {
      if (typeof d === 'string') this._emitRaw(d);
    });
    conn.on('close', () => {
      if (conn === this.ctl) { this.ctl = null; this._setStatus('down'); }
      if (conn === this.rt) this.rt = null;
    });
    conn.on('error', (e) => console.warn('[net] data connection error', e && e.type));
  }
  async host() {
    this.role = 'host';
    const Peer = await loadPeerJS();
    this._setStatus('connecting');
    for (let tries = 0; tries < 4; tries++) {
      const code = makeRoomCode();
      try {
        await new Promise((resolve, reject) => {
          const peer = new Peer(PEER_PREFIX + code, this._peerOptions());
          this.peer = peer;
          let opened = false;
          const t = setTimeout(() => { if (!opened) reject(new Error(PEER_ERRORS.network)); }, 15000);
          peer.on('open', () => { opened = true; clearTimeout(t); resolve(); });
          peer.on('error', (e) => {
            const msg = PEER_ERRORS[e && e.type] || (e && e.message) || 'Connection error';
            if (!opened) { clearTimeout(t); reject(Object.assign(new Error(msg), { type: e && e.type })); }
            else this._setStatus('error', msg);
          });
          peer.on('disconnected', () => {
            // lost the broker (not the peer): keep data connections, try to re-register
            if (!this.closed) setTimeout(() => { try { if (peer.disconnected && !peer.destroyed) peer.reconnect(); } catch { /* ignore */ } }, 1500);
          });
          peer.on('connection', (conn) => {
            if (this.closed) { conn.close(); return; }
            this._wireConn(conn);
            conn.on('open', () => {
              if (conn.label === 'rt') {
                if (this.rt && this.rt !== conn) try { this.rt.close(); } catch { /* ignore */ }
                this.rt = conn;
              } else {
                if (this.ctl && this.ctl !== conn) { const old = this.ctl; this.ctl = null; try { old.close(); } catch { /* ignore */ } }
                this.ctl = conn;
                this._setStatus('open');
              }
            });
          });
        });
        this.code = code;
        this._setStatus('waiting');
        return code;
      } catch (e) {
        try { this.peer.destroy(); } catch { /* ignore */ }
        this.peer = null;
        if (e.type !== 'unavailable-id') { this._setStatus('error', e.message); throw e; }
      }
    }
    throw new Error('Could not allocate a room code.');
  }
  async join(code) {
    this.role = 'guest';
    this.code = normalizeRoomCode(code);
    if (this.code.length !== 5) throw new Error('Room codes are 5 characters.');
    const Peer = await loadPeerJS();
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      const peer = new Peer(this._peerOptions());
      this.peer = peer;
      let done = false;
      const fail = (msg) => { if (!done) { done = true; clearTimeout(t); reject(new Error(msg)); } };
      const t = setTimeout(() => fail('Timed out connecting to the room.'), 20000);
      peer.on('open', () => this._connect(() => { if (!done) { done = true; clearTimeout(t); resolve(); } }));
      peer.on('error', (e) => {
        const msg = PEER_ERRORS[e && e.type] || (e && e.message) || 'Connection error';
        if (!done) fail(msg);
        else if (e && e.type !== 'peer-unavailable') this._setStatus('error', msg);
      });
      peer.on('disconnected', () => {
        if (!this.closed) setTimeout(() => { try { if (peer.disconnected && !peer.destroyed) peer.reconnect(); } catch { /* ignore */ } }, 1500);
      });
    });
  }
  _connect(onOpen) {
    const target = PEER_PREFIX + this.code;
    const ctl = this.peer.connect(target, { label: 'ctl', reliable: true, serialization: 'raw' });
    const rt = this.peer.connect(target, { label: 'rt', reliable: false, serialization: 'raw' });
    this._wireConn(ctl);
    this._wireConn(rt);
    ctl.on('open', () => {
      if (this.ctl && this.ctl !== ctl) try { this.ctl.close(); } catch { /* ignore */ }
      this.ctl = ctl;
      this._setStatus('open');
      if (onOpen) onOpen();
    });
    rt.on('open', () => { this.rt = rt; });
  }
  reconnect() {
    if (this.role !== 'guest' || this.closed || !this.peer) return;
    if (this.ctl && this.ctl.open) return;
    const now = Date.now();
    if (this._lastRetry && now - this._lastRetry < 2500) return;
    this._lastRetry = now;
    try {
      if (this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
      else if (!this.peer.destroyed) this._connect(null);
    } catch (e) { console.warn('[net] reconnect failed', e); }
  }
  send(obj, { rt = false } = {}) {
    const raw = encode(obj);
    const c = rt && this.rt && this.rt.open ? this.rt : this.ctl;
    if (!c || !c.open || this.closed) return false;
    try { c.send(raw); return true; } catch { return false; }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ }
    this.peer = null; this.ctl = null; this.rt = null;
    this._setStatus('closed');
  }
}

/** Factory: kind = 'peer' | 'bc' | 'loopback'. */
export function createTransport(kind, cfg) {
  if (kind === 'loopback') return new LoopbackTransport(cfg);
  if (kind === 'bc') return new BroadcastChannelTransport();
  return new PeerTransport(cfg);
}
