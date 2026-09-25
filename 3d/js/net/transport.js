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
//   await t.listen(id)    -> quick search: register under an arbitrary id and accept one guest
//   await t.connectTo(id) -> quick search: become the guest of a peer that is listen()ing on id
// Messages that arrive before anyone set onMessage are buffered (max 64) and delivered on assignment.
//
// Implementations: PeerTransport (WebRTC via PeerJS cloud or a custom PeerServer),
// LoopbackTransport (same page, in-memory; for tests), BroadcastChannelTransport (two tabs, same origin; for tests).
import { encode, decode, makeRoomCode, normalizeRoomCode, PEER_PREFIX } from './protocol.js';

class BaseTransport {
  constructor() {
    this._pending = [];
    this._onMessage = null;
    this.onStatus = null;
    this.code = null;
    this.role = null;
    this.status = 'idle';
    this.closed = false;
    this.blackhole = false; // test hook: silently drop all traffic both ways (simulated network outage)
  }
  get onMessage() { return this._onMessage; }
  set onMessage(fn) {
    this._onMessage = fn;
    if (fn && this._pending.length) {
      const q = this._pending.splice(0);
      setTimeout(() => { for (const m of q) this._deliver(m); }, 0);
    }
  }
  _deliver(m) {
    if (this.closed) return;
    if (!this._onMessage) { if (this._pending.length < 64) this._pending.push(m); return; }
    try { this._onMessage(m); } catch (e) { console.error('[net] handler error', e); }
  }
  _emitRaw(raw) {
    if (this.closed || this.blackhole) return;
    const m = decode(raw);
    if (m) this._deliver(m);
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
  async listen(id) {
    this.role = 'host';
    if (loopRooms.has(id)) throw new Error('That id is already in use.');
    this.code = id;
    loopRooms.set(id, this);
    this._setStatus('waiting');
  }
  async join(code) { return this.connectTo(normalizeRoomCode(code)); }
  async connectTo(id) {
    if (this.role === 'host' && loopRooms.get(this.code) === this) loopRooms.delete(this.code);
    this.role = 'guest';
    this.code = id;
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
    if (!p || this.closed || this.blackhole) return false;
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
  async listen(id) {
    this.role = 'host';
    this.code = id;
    this._open(id);
    this._setStatus('waiting');
  }
  async join(code) { return this.connectTo(normalizeRoomCode(code)); }
  async connectTo(id) {
    if (this.ch) { try { this.ch.close(); } catch { /* ignore */ } this.ch = null; }
    this.role = 'guest';
    this.other = null;
    this.code = id;
    this._open(this.code);
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      this._joinResolve = resolve;
      this.ch.postMessage({ k: 'hello', from: this.me });
      setTimeout(() => { if (this._joinResolve) { this._joinResolve = null; reject(new Error('Room not found')); } }, 2000);
    });
  }
  reconnect() {
    if (this.role === 'guest' && this.ch && !this.closed && !this.blackhole) this.ch.postMessage({ k: 'hello', from: this.me });
  }
  send(obj) {
    if (!this.ch || !this.other || this.closed || this.blackhole) return false;
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

// ICE: several public STUN servers + PeerJS's own (best-effort, shared) TURN relays, which PeerJS
// would otherwise use by default. Without a dedicated TURN server, players behind symmetric NAT /
// strict firewalls (some mobile carriers, corporate/school networks) can still fail to connect.
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
export const P2P_FAIL_MSG = 'A direct connection could not be opened — one of your networks blocks peer-to-peer play (common on mobile data, school or office Wi-Fi). Try another network, or retry.';

const PEER_ERRORS = {
  'browser-incompatible': 'This browser does not support WebRTC.',
  network: 'Cannot reach the matchmaking server.',
  'server-error': 'Matchmaking server error.',
  'socket-error': 'Matchmaking server connection failed.',
  'socket-closed': 'Matchmaking server closed the connection.',
  'ssl-unavailable': 'Secure connection to the server is unavailable.',
  'peer-unavailable': 'Room not found.',
  'unavailable-id': 'That room code is already in use.',
  'invalid-id': 'Invalid room id.',
  'invalid-key': 'The connection server rejected this game (invalid key).',
  disconnected: 'Lost the connection to the matchmaking server.',
  'negotiation-failed': P2P_FAIL_MSG,
  webrtc: P2P_FAIL_MSG,
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
    const o = { debug: 0, config: { iceServers: ICE_SERVERS, sdpSemantics: 'unified-plan' } };
    const c = this.cfg;
    if (!c.host) {
      // PeerJS public cloud broker, spelled out so it never depends on page protocol/port
      o.host = '0.peerjs.com'; o.port = 443; o.path = '/'; o.secure = true;
    } else {
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
    conn.on('error', (e) => {
      console.warn('[net] data connection error', e && e.type, e && e.message);
      if (conn.label !== 'rt' && this._connectFail) this._connectFail(PEER_ERRORS[e && e.type] || P2P_FAIL_MSG);
    });
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed' && conn.label !== 'rt' && this._connectFail) this._connectFail(P2P_FAIL_MSG);
    });
  }
  /** Register a Peer (with `id`, or a random one) with the signalling server. Resolves on 'open'. */
  async _openPeer(id) {
    const Peer = await loadPeerJS();
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, this._peerOptions()) : new Peer(this._peerOptions());
      this.peer = peer;
      let opened = false;
      const t = setTimeout(() => { if (!opened) reject(new Error(PEER_ERRORS.network)); }, 15000);
      peer.on('open', () => { opened = true; clearTimeout(t); resolve(); });
      peer.on('error', (e) => {
        const msg = PEER_ERRORS[e && e.type] || (e && e.message) || 'Connection error';
        console.warn('[net] peer error:', e && e.type, e && e.message);
        if (!opened) { clearTimeout(t); reject(Object.assign(new Error(msg), { type: e && e.type })); return; }
        if (this._connectFail) { this._connectFail(msg); return; }
        if (e && e.type !== 'peer-unavailable') this._setStatus('error', msg);
      });
      let reTries = 0;
      peer.on('disconnected', () => {
        // lost the broker (not the peer): keep data connections, try to re-register (host code stays reserved ~a minute)
        if (this.closed || peer.destroyed) return;
        const retry = () => {
          if (this.closed || peer.destroyed || !peer.disconnected) return;
          if (++reTries > 5) { this._setStatus('error', PEER_ERRORS.disconnected); return; }
          try { peer.reconnect(); } catch { /* ignore */ }
          setTimeout(retry, 3000 * reTries);
        };
        setTimeout(retry, 1500);
      });
      peer.on('open', () => { reTries = 0; });
      peer.on('connection', (conn) => {
        if (this.closed || this.role !== 'host') { try { conn.close(); } catch { /* ignore */ } return; }
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
  }
  async host() {
    this.role = 'host';
    for (let tries = 0; tries < 4; tries++) {
      const code = makeRoomCode();
      try {
        await this._openPeer(PEER_PREFIX + code);
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
  async listen(id) {
    this.role = 'host';
    try {
      await this._openPeer(id);
    } catch (e) {
      try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ }
      this.peer = null;
      this._setStatus('error', e.message);
      throw e;
    }
    this.code = id;
    this._setStatus('waiting');
  }
  async join(code) {
    const c = normalizeRoomCode(code);
    if (c.length !== 5) throw new Error('Room codes are 5 characters.');
    this.code = c;
    return this.connectTo(PEER_PREFIX + c);
  }
  async connectTo(targetId) {
    this.role = 'guest';
    this.target = targetId;
    if (this.ctl) { try { this.ctl.close(); } catch { /* ignore */ } this.ctl = null; }
    if (!this.peer || this.peer.destroyed) await this._openPeer();
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      let done = false;
      const fin = (err) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        this._connectFail = null;
        if (err) reject(new Error(err)); else resolve();
      };
      const t = setTimeout(() => fin(`Timed out connecting. ${P2P_FAIL_MSG}`), 20000);
      this._connectFail = (msg) => fin(msg);
      this._connect(() => fin(null));
    });
  }
  _connect(onOpen) {
    const target = this.target || PEER_PREFIX + this.code;
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
    if (this.blackhole) return false;
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
