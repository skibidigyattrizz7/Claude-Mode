// Touchline online mode: host/join with a short room code (PeerJS/WebRTC), the host
// simulates the match, the guest sends inputs and interpolates the host's snapshots.
// Owns its own overlay (JS-created DOM, styled by online.css) so it never touches
// index.html or style.css, which are being restyled concurrently.
import { Match, STATE_CODES } from './match.js';
import { TEAMS, teamByCode } from './data.js';
import { makeCamera, updateCamera, drawMatch, drawHUD, s2w } from './render.js';
import { input, mouseAimActive } from './input.js';
import { setTouchMode } from './touch.js';
import { initAudio, sfx, setMuted, crowdAmbience } from './audio.js';
import { settings } from './settings.js';
import { angDiff, lerp as lerpNum } from './util.js';
import * as UI from './ui.js';
import {
  createTransport,
  packInput, unpackInput, INPUT_BOOL, sanitizeTeamPick, packSnapshot, sanitizeSnapshot, sanitizeEvent,
  normalizeRoomCode,
} from './net.js';

const SNAP_HZ = 20, INPUT_HZ = 30;
const SNAP_DT = 1 / SNAP_HZ, INPUT_DT = 1 / INPUT_HZ;

// ---------------------------------------------------------------- overlay plumbing
let cssLinked = false;
function ensureCss() {
  if (cssLinked || document.getElementById('online-css')) { cssLinked = true; return; }
  const link = document.createElement('link');
  link.id = 'online-css';
  link.rel = 'stylesheet';
  link.href = new URL('../online.css', import.meta.url).href;
  document.head.appendChild(link);
  cssLinked = true;
}
function overlay() {
  let el = document.getElementById('online-ui');
  if (!el) {
    el = document.createElement('div');
    el.id = 'online-ui';
    el.className = 'online-ui hidden';
    document.getElementById('app').appendChild(el);
  }
  return el;
}
function showOverlay(html) {
  ensureCss();
  const el = overlay();
  el.className = 'online-ui';
  el.innerHTML = html;
  return el;
}
function hideOverlay() { const el = document.getElementById('online-ui'); if (el) { el.className = 'online-ui hidden'; el.innerHTML = ''; } }
const on = (r, sel, fn) => r.querySelectorAll(sel).forEach((elm) => elm.addEventListener('click', (e) => { sfx('click'); fn(e, elm); }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function transportKind() {
  try {
    const q = new URLSearchParams(location.search).get('net');
    if (q === 'bc' || q === 'loopback') return q;
  } catch { /* ignore */ }
  return 'peer';
}

// ---------------------------------------------------------------- sound (mirrors main.js's handleSound)
function handleSound(e) {
  switch (e.type) {
    case 'kick': sfx('kick', e.strength); break;
    case 'whistle': sfx('whistle'); break;
    case 'whistleLong': sfx('whistleLong'); break;
    case 'whistleEnd': sfx('whistleEnd'); break;
    case 'goal': sfx('net'); sfx('roar'); break;
    case 'post': case 'bar': sfx('post'); break;
    case 'save': sfx('save'); break;
    case 'saveConfirmed': case 'miss': sfx('ooh'); break;
    case 'tackleWon': case 'foul': case 'deflect': sfx('tackle'); break;
    default: break;
  }
}

// ---------------------------------------------------------------- entry point
/** `app` is the scene controller from main.js ({setScene, toMenu, ...}). */
export function openOnlineMenu(app) {
  showHostJoin(app);
}

function showHostJoin(app) {
  const r = showOverlay(`
    <div class="online-panel">
      <h2>Online</h2>
      <p class="online-sub">Play a friend over the internet with a 5-character room code.</p>
      <div class="online-buttons">
        <button data-act="host" class="primary">Host a game</button>
        <button data-act="join">Join a game</button>
        <button data-act="back">Back</button>
      </div>
    </div>`);
  on(r, '[data-act=host]', () => pickTeamThenHost(app));
  on(r, '[data-act=join]', () => showJoinCode(app));
  on(r, '[data-act=back]', () => { hideOverlay(); app.toMenu(); });
}

function pickTeamThenHost(app) {
  hideOverlay();
  UI.showTeamSelect('online', ({ home }) => startHosting(app, home), () => showHostJoin(app));
}

function statusLine(s) {
  return { idle: '', connecting: 'Connecting…', waiting: 'Waiting for a player to join…', open: 'Connected!', down: 'Connection lost.', closed: 'Closed.', error: 'Connection error.' }[s] || s;
}

function startHosting(app, homeTeam) {
  ensureCss();
  const t = createTransport(transportKind());
  const r = showOverlay(`
    <div class="online-panel">
      <h2>Hosting</h2>
      <p class="online-sub">Give this code to your friend:</p>
      <div class="online-code" id="online-code">·····</div>
      <p class="online-status" id="online-status">Creating a room…</p>
      <div class="online-buttons"><button data-act="cancel">Cancel</button></div>
    </div>`);
  on(r, '[data-act=cancel]', () => { t.close(); showHostJoin(app); });
  const setStatus = (s) => { const el = document.getElementById('online-status'); if (el) el.textContent = statusLine(s); };
  t.onStatus = (s) => setStatus(s);
  t.onMessage = (msg) => {
    if (msg.t !== 'pick') return;
    const pick = sanitizeTeamPick(msg, TEAMS.map((x) => x.code));
    const away = pick.code ? teamByCode(pick.code) : TEAMS.find((x) => x !== homeTeam) || TEAMS[1];
    t.send({ t: 'start', home: homeTeam.code, away: away.code });
    hideOverlay();
    app.setScene(new OnlineHostScene({ transport: t, home: homeTeam, away }));
    setTouchMode('match');
  };
  t.host().then((code) => {
    const el = document.getElementById('online-code');
    if (el) el.textContent = code;
  }).catch((e) => {
    setStatus('error');
    const el = document.getElementById('online-status'); if (el) el.textContent = e.message || 'Could not host a room.';
  });
}

function showJoinCode(app) {
  const r = showOverlay(`
    <div class="online-panel">
      <h2>Join</h2>
      <p class="online-sub">Enter your friend's room code.</p>
      <input id="online-input" class="online-input" maxlength="5" autocapitalize="characters" autocomplete="off" placeholder="ABCDE">
      <p class="online-status" id="online-status"></p>
      <div class="online-buttons">
        <button data-act="connect" class="primary">Connect</button>
        <button data-act="back">Back</button>
      </div>
    </div>`);
  const inputEl = r.querySelector('#online-input');
  inputEl.addEventListener('input', () => { inputEl.value = normalizeRoomCode(inputEl.value); });
  inputEl.focus();
  on(r, '[data-act=back]', () => showHostJoin(app));
  on(r, '[data-act=connect]', () => joinRoom(app, inputEl.value));
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(app, inputEl.value); });
}

function joinRoom(app, code) {
  code = normalizeRoomCode(code);
  const setStatus = (s) => { const el = document.getElementById('online-status'); if (el) el.textContent = statusLine(s); };
  if (code.length !== 5) { setStatus('error'); const el = document.getElementById('online-status'); if (el) el.textContent = 'Room codes are 5 characters.'; return; }
  setStatus('connecting');
  const t = createTransport(transportKind());
  t.onStatus = (s) => setStatus(s);
  t.join(code).then(() => {
    hideOverlay();
    UI.showTeamSelect('online', ({ home }) => {
      hideOverlay();
      showWaitingForHost(app, t, home);
      t.send({ t: 'pick', code: home.code });
    }, () => { t.close(); showJoinCode(app); });
  }).catch((e) => { setStatus('error'); const el = document.getElementById('online-status'); if (el) el.textContent = e.message || 'Could not connect.'; });
}

function showWaitingForHost(app, t, myTeam) {
  const r = showOverlay(`
    <div class="online-panel">
      <h2>Connected</h2>
      <p class="online-sub" id="online-status">Waiting for the host to start the match…</p>
      <div class="online-buttons"><button data-act="cancel">Cancel</button></div>
    </div>`);
  on(r, '[data-act=cancel]', () => { t.close(); showHostJoin(app); });
  t.onMessage = (msg) => {
    if (msg.t !== 'start') return;
    const home = teamByCode(msg.home);
    hideOverlay();
    app.setScene(new OnlineGuestScene({ transport: t, home, away: myTeam }));
    setTouchMode('match');
  };
  t.onStatus = (s) => { const el = document.getElementById('online-status'); if (el) el.textContent = statusLine(s); };
}

// ---------------------------------------------------------------- remote-controlled ctrl (host side)
/** Implements the same interface as a local Ctrl (input.js): isHeld / wasPressed / wasReleased /
 *  move(). Movement direction doubles as the aim direction, exactly like the touch joystick does. */
class RemoteCtrl {
  constructor() {
    this.mv = { x: 0, y: 0 };
    this.held = new Set();
    this.pending = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this.lastSeen = 0;
  }
  applyInput(i) {
    this.mv = { x: i.mx, y: i.my };
    this.pending = new Set(INPUT_BOOL.filter((a) => i[a]));
    this.lastSeen = performance.now();
  }
  neutral() { this.mv = { x: 0, y: 0 }; this.pending = new Set(); }
  /** Advance edge-detection by one physics tick (mirrors input.js's clearEdges cadence). */
  tick() {
    this._pressed = new Set(); this._released = new Set();
    for (const a of this.pending) if (!this.held.has(a)) this._pressed.add(a);
    for (const a of this.held) if (!this.pending.has(a)) this._released.add(a);
    this.held = this.pending;
  }
  isHeld(a) { return this.held.has(a); }
  wasPressed(a) { return this._pressed.has(a); }
  wasReleased(a) { return this._released.has(a); }
  move() { return this.mv; }
}

// ---------------------------------------------------------------- host scene (authoritative)
export class OnlineHostScene {
  constructor({ transport, home, away }) {
    this.t = transport;
    this.remote = new RemoteCtrl();
    this.m = new Match({
      home, away, humans: [{ ctrl: 0, team: 0 }, { ctrl: 1, team: 1 }],
      ctrls: [input.ctrls[0], this.remote], settings, minutes: settings.matchMinutes, difficulty: settings.difficulty,
    });
    this.m._netSeq = 0;
    this.cam = makeCamera();
    this.snapAcc = 0;
    this.status = 'open';
    this.paused = false;
    this.firstRender = true;
    this.ftSent = false;
    this.t.onMessage = (msg) => this.onMessage(msg);
    this.t.onStatus = (s) => this.onStatus(s);
    initAudio(); setMuted(!settings.sound); crowdAmbience(true);
  }
  onMessage(msg) { if (msg.t === 'in') this.remote.applyInput(unpackInput(msg.i)); }
  onStatus(s) {
    this.status = s;
    if (s === 'down' || s === 'closed') this.remote.neutral();
  }
  update(dt) {
    if (this.paused) return;
    const m = this.m;
    m.aimWorld[0] = mouseAimActive() ? s2w(this.cam, input.mouse.x, input.mouse.y) : null;
    m.mouseClick = input.mouse.pressed && !input.touchMode;
    m.mouseDown = input.mouse.down && !input.touchMode;
    this.remote.tick();
    m.update(dt);
    for (const e of m.events) {
      handleSound(e);
      const se = sanitizeEvent(e);
      if (se) this.t.send({ t: 'ev', e: se });
    }
    m.events.length = 0;
    m._netSeq++;
    this.snapAcc += dt;
    if (this.snapAcc >= SNAP_DT) {
      this.snapAcc = 0;
      const guestP = m.humans[1] && m.humans[1].player;
      const guestIdx = guestP ? m.players.indexOf(guestP) : -1;
      this.t.send(packSnapshot(m, STATE_CODES, guestIdx), { rt: true });
    }
    if (m.state === 'fulltime' && !this.ftSent && m.stateT > 0.5) { this.ftSent = true; this.t.send({ t: 'end' }); }
  }
  render(ctx, w, h, dt) {
    const m = this.m;
    const target = { x: m.ball.x + m.ball.vx * 0.3, y: m.ball.y + m.ball.vy * 0.3 };
    updateCamera(this.cam, target, dt, w, h, settings.zoom, this.firstRender);
    this.firstRender = false;
    drawHUD.binds = input.binds;
    drawMatch(ctx, m, this.cam, settings);
    drawConnBanner(ctx, w, h, this.status);
  }
  destroy() { this.t.close(); crowdAmbience(false); }
}

// ---------------------------------------------------------------- guest scene (interpolated view)
export class OnlineGuestScene {
  constructor({ transport, home, away }) {
    this.t = transport;
    this.m = new Match({ home, away, humans: [], ctrls: [], noClock: true, minutes: settings.matchMinutes });
    this.cam = makeCamera();
    this.sendAcc = 0;
    this.reconnAcc = 0;
    this.prev = null; this.cur = null; this.lerpT = 1;
    this.status = 'open';
    this.paused = false;
    this.firstRender = true;
    this.ended = false;
    this.t.onMessage = (msg) => this.onMessage(msg);
    this.t.onStatus = (s) => this.onStatus(s);
    initAudio(); setMuted(!settings.sound); crowdAmbience(true);
  }
  onMessage(msg) {
    if (msg.t === 'snap') {
      const s = sanitizeSnapshot(msg, this.m.players.length, STATE_CODES);
      if (s && (!this.cur || s.seq >= this.cur.seq)) { this.prev = this.cur || s; this.cur = s; this.lerpT = 0; }
    } else if (msg.t === 'ev') {
      const e = sanitizeEvent(msg.e);
      if (e) handleSound(e);
    } else if (msg.t === 'end') {
      this.ended = true;
    }
  }
  onStatus(s) { this.status = s; if (s === 'down') this.reconnAcc = 0; }
  update(dt) {
    if (this.paused) return;
    const c = input.ctrls[0];
    this.sendAcc += dt;
    if (this.sendAcc >= INPUT_DT) {
      this.sendAcc = 0;
      const mv = c.move();
      const i = { mx: mv.x, my: mv.y };
      for (const a of INPUT_BOOL) i[a] = c.isHeld(a);
      this.t.send({ t: 'in', i: packInput(i) }, { rt: true });
    }
    if (this.status === 'down') {
      this.reconnAcc += dt;
      if (this.reconnAcc > 2) { this.reconnAcc = 0; this.t.reconnect(); }
    }
    if (this.cur) {
      this.lerpT = Math.min(1, this.lerpT + dt / SNAP_DT);
      applySnapshot(this.m, this.prev || this.cur, this.cur, this.lerpT);
    }
  }
  render(ctx, w, h, dt) {
    const m = this.m;
    const target = { x: m.ball.x, y: m.ball.y };
    updateCamera(this.cam, target, dt, w, h, settings.zoom, this.firstRender);
    this.firstRender = false;
    drawHUD.binds = input.binds;
    drawMatch(ctx, m, this.cam, settings);
    drawConnBanner(ctx, w, h, this.status);
  }
  destroy() { this.t.close(); crowdAmbience(false); }
}

/** Blend two sanitized snapshots (a -> b) at t in [0,1] onto the render-only Match `m`. */
function applySnapshot(m, a, b, t) {
  const ball = m.ball;
  ball.x = lerpNum(a.ball.x, b.ball.x, t); ball.y = lerpNum(a.ball.y, b.ball.y, t);
  ball.z = lerpNum(a.ball.z, b.ball.z, t); ball.rot = lerpNum(a.ball.rot, b.ball.rot, t);
  const n = Math.min(m.players.length, b.players.length, a.players.length || b.players.length);
  for (let i = 0; i < n; i++) {
    const pa = a.players[i] || b.players[i], pb = b.players[i], p = m.players[i];
    p.x = lerpNum(pa.x, pb.x, t); p.y = lerpNum(pa.y, pb.y, t);
    p.facing = pa.facing + angDiff(pa.facing, pb.facing) * t;
    p.anim = pb.anim; p.state = pb.state; p.sentOff = pb.sentOff; p.team = pb.team;
  }
  m.score = b.score; m.clock = b.clock; m.half = b.half; m.state = b.state;
  if (b.myIdx >= 0 && m.players[b.myIdx]) m.humans = [{ ctrl: 0, team: m.players[b.myIdx].team, player: m.players[b.myIdx], lastSwitch: -9 }];
}

function drawConnBanner(ctx, w, hgt, status) {
  if (status === 'open' || status === 'idle') return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const text = status === 'connecting' || status === 'waiting' ? 'Connecting…' : status === 'down' ? 'Connection lost — reconnecting…' : status === 'closed' ? 'Disconnected' : 'Connection error';
  ctx.font = 'bold 14px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const bx = w / 2 - tw / 2 - 14, by = 10, bw = tw + 28, bh = 28;
  ctx.fillStyle = 'rgba(20,10,10,0.82)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#e0524f'; ctx.lineWidth = 1.5; ctx.strokeRect(bx + 0.75, by + 0.75, bw - 1.5, bh - 1.5);
  ctx.fillStyle = '#ffd7d5'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, by + bh / 2 + 1);
  ctx.restore();
}
