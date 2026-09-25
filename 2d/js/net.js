// Touchline online mode — transports (WebRTC via PeerJS, plus in-memory/BroadcastChannel
// transports for tests) and wire-protocol validation. Everything that arrives from the peer
// goes through the sanitize* functions here — never trust the peer.
//
// Common transport interface:
//   await t.host()        -> room code (5 chars). Starts listening for one guest.
//   await t.join(code)    -> resolves when the link to the host is open (rejects e.g. "Room not found").
//   t.send(obj, { rt })   -> send a JSON-able message. rt=true: unreliable/unordered channel if available.
//   t.onMessage = (obj) => {}            // already decoded + size/shape-capped
//   t.onStatus  = (status, detail) => {} // 'connecting'|'waiting'|'open'|'down'|'closed'|'error'
//   t.reconnect()         -> guest only: try to re-establish a lost link (idempotent)
//   t.close()
// Messages that arrive before onMessage is assigned are buffered (max 64) and delivered then.

export const MAX_MSG_BYTES = 32 * 1024;
export const PEER_PREFIX = 'touchline2d-';

/** 5-char room code (no ambiguous chars: no 0/O/1/I). */
export function makeRoomCode(rand = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}
export function normalizeRoomCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export const encode = (m) => JSON.stringify(m);
/** Parse an incoming wire string with a size cap. Returns null for garbage. */
export function decode(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string' && m.t.length < 12 ? m : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- message validation
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : dflt);
const int = (v, lo, hi, dflt) => Math.round(num(v, lo, hi, dflt));
const bool = (v) => v === true || v === 1;

/** Boolean actions carried by an input packet (movement is separate: mx/my double as aim,
 *  exactly like the local touch-joystick control scheme already does). */
export const INPUT_BOOL = ['sprint', 'pass', 'through', 'lob', 'shoot', 'switch', 'tackle', 'slide', 'skill', 'jockey'];

/** Clamp a guest InputState from the peer. Unknown keys dropped, NaN -> 0, booleans strict. */
export function sanitizeInput(i) {
  const src = i && typeof i === 'object' ? i : {};
  let mx = num(src.mx, -1, 1, 0), my = num(src.my, -1, 1, 0);
  const mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; }
  const out = { mx, my };
  for (const k of INPUT_BOOL) out[k] = bool(src[k]);
  return out;
}
/** Compact wire encoding: [mx, my, bits]. */
export function packInput(i) {
  const s = sanitizeInput(i);
  let bits = 0;
  INPUT_BOOL.forEach((k, n) => { if (s[k]) bits |= 1 << n; });
  const r = (v) => Math.round(v * 100) / 100;
  return [r(s.mx), r(s.my), bits];
}
export function unpackInput(a) {
  if (!Array.isArray(a) || a.length !== 3) return sanitizeInput(null);
  const bits = int(a[2], 0, (1 << INPUT_BOOL.length) - 1, 0);
  const o = { mx: a[0], my: a[1] };
  INPUT_BOOL.forEach((k, n) => { o[k] = !!(bits & (1 << n)); });
  return sanitizeInput(o);
}

/** A team-pick message names a nation by its data.js team `code` (never trust raw team data
 *  from the peer — the host looks the code up in its own copy of TEAMS). */
export function sanitizeTeamPick(p, validCodes) {
  const src = p && typeof p === 'object' ? p : {};
  const code = typeof src.code === 'string' ? src.code.toUpperCase().slice(0, 4) : '';
  return { code: validCodes && !validCodes.includes(code) ? null : code };
}

/** The 14 outfield+GK player states a snapshot carries, matching match.js's STATE_CODES order. */
const r2 = (v) => Math.round(v * 100) / 100;

/** Build a compact snapshot from a live Match (host side). `myIdx` = index of the player
 *  currently controlled by the human whose viewpoint this snapshot is for, or -1. */
export function packSnapshot(m, stateCodes, myIdx = -1) {
  const b = m.ball;
  const players = m.players.map((p) => [r2(p.x), r2(p.y), r2(p.facing), Math.round(p.anim || 0),
    Math.max(0, stateCodes.indexOf(p.state)), p.sentOff ? 1 : 0, p.team]);
  return {
    t: 'snap', seq: m._netSeq || 0,
    sc: m.score.slice(), cl: Math.round(m.clock), hf: m.half, st: m.state, mi: myIdx,
    b: [r2(b.x), r2(b.y), r2(b.z), r2(b.rot || 0)],
    p: players,
  };
}
/** Validate + clamp a snapshot from the peer (guest side only ever receives these). */
export function sanitizeSnapshot(s, playerCount, stateCodes) {
  if (!s || typeof s !== 'object') return null;
  const b = Array.isArray(s.b) && s.b.length === 4 ? s.b : [0, 0, 0, 0];
  const players = Array.isArray(s.p) ? s.p.slice(0, playerCount).map((row) => {
    const a = Array.isArray(row) && row.length === 7 ? row : [0, 0, 0, 0, 0, 0, 0];
    return {
      x: num(a[0], -20, 200, 0), y: num(a[1], -20, 200, 0), facing: num(a[2], -10, 10, 0),
      anim: num(a[3], 0, 999, 0), state: stateCodes[int(a[4], 0, stateCodes.length - 1, 0)] || 'run',
      sentOff: bool(a[5]), team: int(a[6], 0, 1, 0),
    };
  }) : [];
  return {
    seq: int(s.seq, 0, 1e9, 0),
    score: Array.isArray(s.sc) && s.sc.length === 2 ? [int(s.sc[0], 0, 99, 0), int(s.sc[1], 0, 99, 0)] : [0, 0],
    clock: int(s.cl, 0, 20000, 0),
    half: s.hf === 2 ? 2 : 1,
    state: typeof s.st === 'string' ? s.st.slice(0, 16) : 'play',
    myIdx: int(s.mi, -1, playerCount - 1, -1),
    ball: { x: num(b[0], -20, 200, 0), y: num(b[1], -20, 200, 0), z: num(b[2], 0, 30, 0), rot: num(b[3], -100, 100, 0) },
    players,
  };
}

/** A small discrete event forwarded for sound/UI (host -> guest), stripped to a safe subset. */
export function sanitizeEvent(e) {
  if (!e || typeof e !== 'object' || typeof e.type !== 'string') return null;
  const out = { type: e.type.slice(0, 24) };
  if (typeof e.strength === 'number') out.strength = num(e.strength, 0, 1, 0.5);
  return out;
}

// ---------------------------------------------------------------- transports
class BaseTransport {
  constructor() {
    this._pending = [];
    this._onMessage = null;
    this.onStatus = null;
    this.code = null;
    this.role = null;
    this.status = 'idle';
    this.closed = false;
    this.blackhole = false; // test hook: silently drop all traffic both ways (simulated outage)
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
    try { this._onMessage(m); } catch (e) { console.error('[2d net] handler error', e); }
  }
  _emitRaw(raw) {
    if (this.closed || this.blackhole) return;
    const m = decode(raw);
    if (m) this._deliver(m);
  }
  _setStatus(s, detail) {
    if (this.closed && s !== 'closed') return;
    this.status = s;
    if (this.onStatus) { try { this.onStatus(s, detail); } catch (e) { console.error('[2d net] status handler error', e); } }
  }
  reconnect() {}
}

// ---------------------------------------------------------------- Loopback (same process; tests)
const loopRooms = new Map(); // code -> host LoopbackTransport

/** In-memory transport for unit tests. `latency` in ms (default 5). */
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
    await new Promise((res) => setTimeout(res, this.latency));
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
    if (raw.length > MAX_MSG_BYTES) return false;
    setTimeout(() => { if (p.peer === this) p._emitRaw(raw); }, this.latency);
    return true;
  }
  /** Test helper: cut the link as if the network dropped (no close message delivered). */
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

// ---------------------------------------------------------------- BroadcastChannel (two tabs; smoke test)
export class BroadcastChannelTransport extends BaseTransport {
  constructor() {
    super();
    this.me = Math.random().toString(36).slice(2, 10);
    this.other = null;
    this.ch = null;
  }
  _open(code) {
    this.ch = new BroadcastChannel(`touchline2d-bc-${code}`);
    this.ch.onmessage = (ev) => this._onBc(ev.data);
  }
  _onBc(d) {
    if (!d || typeof d !== 'object' || d.from === this.me) return;
    if (d.k === 'hello' && this.role === 'host') {
      this.other = d.from;
      this.ch.postMessage({ k: 'welcome', from: this.me, to: d.from });
      this._setStatus('open');
    } else if (d.k === 'welcome' && this.role === 'guest' && d.to === this.me) {
      this.other = d.from;
      if (this._joinResolve) { this._joinResolve(); this._joinResolve = null; }
      this._setStatus('open');
    } else if (d.k === 'm' && d.from === this.other && d.to === this.me) {
      this._emitRaw(d.d);
    } else if (d.k === 'bye' && d.from === this.other) {
      this._setStatus('down');
    }
  }
  async host() {
    this.role = 'host';
    const code = makeRoomCode();
    this.code = code;
    this._open(code);
    this._setStatus('waiting');
    return code;
  }
  async join(code) {
    this.role = 'guest';
    this.other = null;
    this.code = normalizeRoomCode(code);
    this._open(this.code);
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      this._joinResolve = resolve;
      this.ch.postMessage({ k: 'hello', from: this.me });
      setTimeout(() => { if (this._joinResolve) { this._joinResolve = null; reject(new Error('Room not found')); } }, 2500);
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

// ---------------------------------------------------------------- PeerJS (WebRTC)
let peerLoad = null;
/** Lazily load the vendored PeerJS classic script (window.Peer), same file the 3D game
 *  vendors, then fall back to the jsDelivr / cdnjs CDN copies if it isn't reachable. */
export function loadPeerJS() {
  const found = () => window.Peer || (window.peerjs && window.peerjs.Peer) || null;
  if (found()) return Promise.resolve(found());
  if (peerLoad) return peerLoad;
  const sources = [
    new URL('../../3d/vendor/p2p-net.min.js', import.meta.url).href,
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js',
  ];
  const tryLoad = (i) => new Promise((resolve, reject) => {
    if (i >= sources.length) { reject(new Error('Could not load the online-play library (it may be blocked on this network).')); return; }
    const s = document.createElement('script');
    s.src = sources[i]; s.async = true;
    s.onload = () => (found() ? resolve(found()) : (s.remove(), tryLoad(i + 1).then(resolve, reject)));
    s.onerror = () => { s.remove(); tryLoad(i + 1).then(resolve, reject); };
    document.head.appendChild(s);
  });
  peerLoad = tryLoad(0).catch((e) => { peerLoad = null; throw e; });
  return peerLoad;
}

export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
export const P2P_FAIL_MSG = 'A direct connection could not be opened — one of your networks blocks peer-to-peer play (common on mobile data, school or office Wi-Fi). Try another network, or retry.';
const PEER_ERRORS = {
  'browser-incompatible': 'This browser does not support WebRTC.',
  network: 'Cannot reach the matchmaking server.',
  'peer-unavailable': 'Room not found.',
  'unavailable-id': 'That room code is already in use.',
  'invalid-id': 'Invalid room code.',
  disconnected: 'Lost the connection to the matchmaking server.',
  'negotiation-failed': P2P_FAIL_MSG,
  webrtc: P2P_FAIL_MSG,
};

/** WebRTC transport via PeerJS's public cloud broker. One reliable channel (team pick,
 *  discrete events) + one unreliable/unordered one (frequent input / snapshots). */
export class PeerTransport extends BaseTransport {
  constructor() {
    super();
    this.peer = null; this.ctl = null; this.rt = null;
  }
  _wireConn(conn) {
    conn.on('data', (d) => { if (typeof d === 'string') this._emitRaw(d); });
    conn.on('close', () => {
      if (conn === this.ctl) { this.ctl = null; this._setStatus('down'); }
      if (conn === this.rt) this.rt = null;
    });
    conn.on('error', (e) => { if (this._connectFail) this._connectFail(PEER_ERRORS[e && e.type] || P2P_FAIL_MSG); });
  }
  async _openPeer(id) {
    const Peer = await loadPeerJS();
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      const opts = { debug: 0, config: { iceServers: ICE_SERVERS } };
      const peer = id ? new Peer(id, opts) : new Peer(opts);
      this.peer = peer;
      let opened = false;
      const t = setTimeout(() => { if (!opened) reject(new Error(PEER_ERRORS.network)); }, 15000);
      peer.on('open', () => { opened = true; clearTimeout(t); resolve(); });
      peer.on('error', (e) => {
        const msg = PEER_ERRORS[e && e.type] || (e && e.message) || 'Connection error';
        if (!opened) { clearTimeout(t); reject(Object.assign(new Error(msg), { type: e && e.type })); return; }
        if (this._connectFail) { this._connectFail(msg); return; }
        if (e && e.type !== 'peer-unavailable') this._setStatus('error', msg);
      });
      peer.on('disconnected', () => {
        if (this.closed || peer.destroyed) return;
        setTimeout(() => { if (!this.closed && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch { /* ignore */ } } }, 1500);
      });
      peer.on('connection', (conn) => {
        if (this.closed || this.role !== 'host') { try { conn.close(); } catch { /* ignore */ } return; }
        this._wireConn(conn);
        conn.on('open', () => {
          if (conn.label === 'rt') { if (this.rt && this.rt !== conn) try { this.rt.close(); } catch { /* ignore */ } this.rt = conn; }
          else { if (this.ctl && this.ctl !== conn) { const old = this.ctl; this.ctl = null; try { old.close(); } catch { /* ignore */ } } this.ctl = conn; this._setStatus('open'); }
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
        try { this.peer && this.peer.destroy(); } catch { /* ignore */ }
        this.peer = null;
        if (e.type !== 'unavailable-id') { this._setStatus('error', e.message); throw e; }
      }
    }
    throw new Error('Could not allocate a room code.');
  }
  async join(code) {
    const c = normalizeRoomCode(code);
    if (c.length !== 5) throw new Error('Room codes are 5 characters.');
    this.role = 'guest'; this.code = c; this.target = PEER_PREFIX + c;
    if (!this.peer || this.peer.destroyed) await this._openPeer();
    this._setStatus('connecting');
    await new Promise((resolve, reject) => {
      let done = false;
      const fin = (err) => { if (done) return; done = true; clearTimeout(t); this._connectFail = null; if (err) reject(new Error(err)); else resolve(); };
      const t = setTimeout(() => fin(`Timed out connecting. ${P2P_FAIL_MSG}`), 20000);
      this._connectFail = (msg) => fin(msg);
      this._connect(() => fin(null));
    });
  }
  _connect(onOpen) {
    const ctl = this.peer.connect(this.target, { label: 'ctl', reliable: true, serialization: 'raw' });
    const rt = this.peer.connect(this.target, { label: 'rt', reliable: false, serialization: 'raw' });
    this._wireConn(ctl); this._wireConn(rt);
    ctl.on('open', () => { this.ctl = ctl; this._setStatus('open'); if (onOpen) onOpen(); });
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
    } catch (e) { console.warn('[2d net] reconnect failed', e); }
  }
  send(obj, { rt = false } = {}) {
    if (this.blackhole) return false;
    const raw = encode(obj);
    if (raw.length > MAX_MSG_BYTES) return false;
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
export function createTransport(kind) {
  if (kind === 'loopback') return new LoopbackTransport();
  if (kind === 'bc') return new BroadcastChannelTransport();
  return new PeerTransport();
}
