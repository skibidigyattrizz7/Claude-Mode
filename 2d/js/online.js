// Touchline online 1v1: host/join with a 6-character room code (PeerJS / WebRTC). The host runs
// the authoritative match and streams compact snapshots (~20/s); the guest sends its inputs
// (~30/s) and interpolates between snapshots. The lobby renders into #ui with the existing
// style.css classes (panel / menu-buttons / hint / note), so it follows the menu styling.
import { Match, STATE_CODES } from './match.js';
import { TEAMS, teamByCode } from './data.js';
import { makeCamera, updateCamera, drawMatch, drawHUD, s2w } from './render.js';
import { input, mouseAimActive, releaseAll } from './input.js';
import { setTouchMode } from './touch.js';
import { initAudio, sfx, setMuted, crowdAmbience } from './audio.js';
import { settings, sanitizeGameplay } from './settings.js';
import { angDiff, lerp as lerpNum } from './util.js';
import * as UI from './ui.js';
import {
  createTransport, packInput, unpackInput, INPUT_BOOL, sanitizeTeamPick, packSnapshot, sanitizeSnapshot,
  sanitizeEvent, normalizeRoomCode, packEnd, sanitizeEnd, ROOM_CODE_LEN,
} from './net.js';

const SNAP_HZ = 20, INPUT_HZ = 30;
const SNAP_DT = 1 / SNAP_HZ, INPUT_DT = 1 / INPUT_HZ;
const SILENCE_DOWN = 4;     // s without any traffic from the peer: treat the link as down
const GIVE_UP = 20;         // s of a down link before the match is abandoned

// ---------------------------------------------------------------- lobby plumbing (#ui)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function lobby(html) {
  const r = document.getElementById('ui');
  r.className = 'screen overlay';
  r.innerHTML = `<div class="panel small online-lobby">${html}</div>`;
  r.scrollTop = 0;
  return r;
}
const on = (r, sel, fn) => r.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => { sfx('click'); fn(e, el); }));
const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
// the big room code reuses the display face + tokens from style.css / tokens.css
const CODE_STYLE = 'font:700 44px/1.1 var(--font-display);letter-spacing:.2em;color:var(--acc);margin:6px 0 2px;user-select:all;-webkit-user-select:all';
const INPUT_STYLE = 'width:100%;min-height:48px;font:700 28px var(--font-display);letter-spacing:.2em;text-align:center;text-transform:uppercase;background:#15181d;color:var(--txt);border:1px solid var(--line);border-radius:var(--radius-sm);margin:6px 0';

function transportKind() {
  try {
    const q = new URLSearchParams(location.search).get('net');
    if (q === 'bc' || q === 'loopback') return q;
  } catch { /* ignore */ }
  return 'peer';
}

function statusLine(s) {
  return { idle: '', connecting: 'Connecting…', waiting: 'Waiting for your friend to join…', open: 'Connected.', down: 'Connection lost.', closed: 'Closed.', error: 'Connection error.' }[s] || s;
}

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
export function openOnlineMenu(app) { showHostJoin(app); }

function showHostJoin(app) {
  const r = lobby(`
    <h2>Online</h2>
    <p class="hint">Play a friend 1v1 over the internet. One of you hosts and gets a ${ROOM_CODE_LEN}-character room code; the other joins with it.</p>
    <div class="menu-buttons">
      <button data-act="host" class="primary">Host a game</button>
      <button data-act="join">Join with a code</button>
      <button data-act="back">Back</button>
    </div>`);
  on(r, '[data-act=host]', () => UI.showTeamSelect('online', ({ home }) => startHosting(app, home), () => showHostJoin(app)));
  on(r, '[data-act=join]', () => showJoinCode(app));
  on(r, '[data-act=back]', () => app.toMenu());
}

function startHosting(app, homeTeam) {
  const t = createTransport(transportKind());
  const r = lobby(`
    <h2>Hosting</h2>
    <p class="hint">Give this code to your friend:</p>
    <div id="online-code" style="${CODE_STYLE}" aria-live="polite">······</div>
    <p class="note" id="online-status">Creating a room…</p>
    <p class="hint">You play as ${esc(homeTeam.name)}.</p>
    <div class="menu-buttons">
      <button data-act="copy">Copy code</button>
      <button data-act="cancel">Cancel</button>
    </div>`);
  let code = '';
  on(r, '[data-act=copy]', () => { if (code && navigator.clipboard) navigator.clipboard.writeText(code).then(() => setText('online-status', 'Code copied.'), () => {}); });
  on(r, '[data-act=cancel]', () => { t.close(); showHostJoin(app); });
  t.onStatus = (s) => setText('online-status', s === 'open' ? 'Your friend joined. They are picking their nation…'
    : s === 'down' ? 'Your friend disconnected. Waiting for someone to join…' : statusLine(s));
  t.onMessage = (msg) => {
    if (msg.t !== 'pick') return;
    const pick = sanitizeTeamPick(msg, TEAMS.map((x) => x.code));
    const away = (pick.code && teamByCode(pick.code)) || TEAMS.find((x) => x !== homeTeam) || TEAMS[1];
    const guestGp = sanitizeGameplay({ p1: msg.gp }).p1;
    t.send({ t: 'start', home: homeTeam.code, away: away.code, min: settings.matchMinutes });
    UI.hideUI();
    initAudio(); setMuted(!settings.sound); crowdAmbience(true);
    app.setScene(new OnlineHostScene({ app, transport: t, home: homeTeam, away, guestGp }));
    setTouchMode('match');
  };
  t.host().then((c) => { code = c; setText('online-code', c); }).catch((e) => setText('online-status', e.message || 'Could not create a room.'));
}

function showJoinCode(app) {
  const r = lobby(`
    <h2>Join a game</h2>
    <p class="hint">Enter your friend's room code.</p>
    <input id="online-input" style="${INPUT_STYLE}" maxlength="${ROOM_CODE_LEN + 2}" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC234" aria-label="Room code">
    <p class="note" id="online-status"></p>
    <div class="menu-buttons">
      <button data-act="connect" class="primary">Connect</button>
      <button data-act="back">Back</button>
    </div>`);
  const inputEl = r.querySelector('#online-input');
  inputEl.addEventListener('input', () => { inputEl.value = normalizeRoomCode(inputEl.value); });
  inputEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') joinRoom(app, inputEl.value); });
  inputEl.focus();
  on(r, '[data-act=back]', () => showHostJoin(app));
  on(r, '[data-act=connect]', () => joinRoom(app, inputEl.value));
}

let joining = false;
function joinRoom(app, raw) {
  const code = normalizeRoomCode(raw);
  if (code.length !== ROOM_CODE_LEN) { setText('online-status', `Room codes are ${ROOM_CODE_LEN} characters.`); return; }
  if (joining) return;
  joining = true;
  setText('online-status', 'Connecting…');
  const t = createTransport(transportKind());
  t.onStatus = (s) => setText('online-status', statusLine(s));
  t.join(code).then(() => {
    joining = false;
    t.onStatus = (s) => { if (s === 'down' || s === 'closed') { t.close(); lostInLobby(app, 'The host left before the match started.'); } };
    UI.showTeamSelect('online', ({ home }) => {
      showWaitingForHost(app, t, home);
      t.send({ t: 'pick', code: home.code, gp: settings.gameplay && settings.gameplay.p1 });
    }, () => { t.send({ t: 'bye' }); t.close(); showJoinCode(app); });
  }).catch((e) => { joining = false; t.close(); setText('online-status', e.message || 'Could not connect.'); });
}

function lostInLobby(app, text) {
  UI.showMessage('Disconnected', text, [{ label: 'Online menu', fn: () => showHostJoin(app) }, { label: 'Main menu', fn: () => app.toMenu() }]);
}

function showWaitingForHost(app, t, myTeam) {
  const r = lobby(`
    <h2>Connected</h2>
    <p class="note" id="online-status">Waiting for the host to start the match…</p>
    <div class="menu-buttons"><button data-act="cancel">Leave</button></div>`);
  on(r, '[data-act=cancel]', () => { t.send({ t: 'bye' }); t.close(); showHostJoin(app); });
  t.onMessage = (msg) => {
    if (msg.t === 'bye') { t.close(); lostInLobby(app, 'The host left before the match started.'); return; }
    if (msg.t !== 'start') return;
    const home = teamByCode(msg.home) || TEAMS[0];
    UI.hideUI();
    initAudio(); setMuted(!settings.sound); crowdAmbience(true);
    app.setScene(new OnlineGuestScene({ app, transport: t, home, away: myTeam, minutes: msg.min }));
    setTouchMode('match');
  };
}

// ---------------------------------------------------------------- remote-controlled ctrl (host side)
/** Implements the local Ctrl interface (input.js): isHeld / wasPressed / wasReleased / move().
 *  Movement direction doubles as the aim direction, exactly like the touch joystick does. */
class RemoteCtrl {
  constructor() {
    this.mv = { x: 0, y: 0 };
    this.held = new Set(); this.pending = new Set();
    this._pressed = new Set(); this._released = new Set();
  }
  applyInput(i) { this.mv = { x: i.mx, y: i.my }; this.pending = new Set(INPUT_BOOL.filter((a) => i[a])); }
  neutral() { this.mv = { x: 0, y: 0 }; this.pending = new Set(); }
  /** Advance edge detection by one physics tick (mirrors input.js's clearEdges cadence). */
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

/** Shared link bookkeeping: silence detection, give-up timer, clean end screens. */
class LinkScene {
  constructor(app, transport) {
    this.app = app; this.t = transport;
    this.status = 'open'; this.quiet = 0; this.downFor = 0; this.ended = false; this.paused = false;
    this.cam = makeCamera(); this.firstRender = true;
    this.t.onMessage = (msg) => { this.quiet = 0; if (this.status === 'down' && this.t.status === 'open') this.status = 'open'; this.onMessage(msg); };
    this.t.onStatus = (s) => { if (s === 'open') { this.status = 'open'; this.quiet = 0; } else if (s === 'down' || s === 'error') this.status = 'down'; else if (s === 'closed') this.status = 'closed'; };
  }
  /** Returns true while the link is healthy enough to keep playing. */
  tickLink(dt) {
    if (this.ended) return false;
    this.quiet += dt;
    if (this.status === 'open' && this.quiet > SILENCE_DOWN) this.status = 'down';
    if (this.status === 'down') {
      this.downFor += dt;
      if (this.downFor > GIVE_UP) { this.finish('Connection lost', this.lostText); return false; }
    } else this.downFor = 0;
    return this.status === 'open';
  }
  /** End the online match and show a message (idempotent). */
  finish(title, text) {
    if (this.ended) return;
    this.ended = true;
    try { this.t.close(); } catch { /* ignore */ }
    crowdAmbience(false); releaseAll(); input.gameActive = false;
    UI.showMessage(title, text, [{ label: 'Main menu', fn: () => this.app.toMenu() }, { label: 'Play online again', fn: () => { this.app.toMenu(); openOnlineMenu(this.app); } }]);
  }
  render(ctx, w, h, dt) {
    const m = this.m;
    const target = { x: m.ball.x + (m.ball.vx || 0) * 0.3, y: m.ball.y + (m.ball.vy || 0) * 0.3 };
    updateCamera(this.cam, target, dt, w, h, settings.zoom * (input.touchMode ? 0.85 : 1), this.firstRender);
    this.firstRender = false;
    drawHUD.binds = input.binds;
    drawMatch(ctx, m, this.cam, settings);
    if (!this.ended) drawConnBanner(ctx, w, h, this.status === 'down' ? `${this.downText} (${Math.max(0, Math.ceil(GIVE_UP - this.downFor))} s)` : null);
  }
  destroy() {
    if (!this.ended) { this.ended = true; this.t.send({ t: 'bye' }); setTimeout(() => this.t.close(), 150); }
    crowdAmbience(false);
  }
}

// ---------------------------------------------------------------- host scene (authoritative)
export class OnlineHostScene extends LinkScene {
  constructor({ app, transport, home, away, guestGp }) {
    super(app, transport);
    this.remote = new RemoteCtrl();
    const gameplay = { ...(settings.gameplay || {}), p2: guestGp || (settings.gameplay && settings.gameplay.p2) };
    this.m = new Match({
      home, away, humans: [{ ctrl: 0, team: 0 }, { ctrl: 1, team: 1 }], ctrls: [input.ctrls[0], this.remote],
      settings: { ...settings, gameplay }, minutes: settings.matchMinutes, difficulty: settings.difficulty,
      mode: 'online', autoKicks: true,        // penalties / direct free kicks resolve in the top-down sim
    });
    this.m._netSeq = 0;
    this.snapAcc = 0;
    this.ftSent = false;
    this.downText = 'Opponent disconnected, waiting';
    this.lostText = 'Your opponent\'s connection dropped and did not come back.';
  }
  onMessage(msg) {
    if (msg.t === 'in') this.remote.applyInput(unpackInput(msg.i));
    else if (msg.t === 'bye') this.finish('Opponent left', 'Your opponent left the match.');
  }
  update(dt) {
    // online matches keep running while the pause menu is open (the peer is still playing);
    // they freeze only while the opponent's link is down
    if (!this.tickLink(dt)) { this.remote.neutral(); return; }
    const m = this.m;
    m.aimWorld[0] = mouseAimActive() && !this.paused ? s2w(this.cam, input.mouse.x, input.mouse.y) : null;
    m.mouseClick = input.mouse.pressed && !input.touchMode && !this.paused;
    m.mouseDown = input.mouse.down && !input.touchMode && !this.paused;
    this.remote.tick();
    m.update(dt);
    for (const e of m.events) {
      handleSound(e);
      const se = sanitizeEvent(e);
      if (se && e.type !== 'kick') this.t.send({ t: 'ev', e: se });
      else if (se) this.t.send({ t: 'ev', e: se }, { rt: true });
    }
    m.events.length = 0;
    m._netSeq++;
    this.snapAcc += dt;
    if (this.snapAcc >= SNAP_DT) {
      this.snapAcc -= SNAP_DT;
      if (this.snapAcc > SNAP_DT) this.snapAcc = 0;
      const gp = m.humans[1] && m.humans[1].player;
      this.t.send(packSnapshot(m, STATE_CODES, gp ? m.players.indexOf(gp) : -1), { rt: true });
    }
    if (m.state === 'fulltime' && !this.ftSent && m.stateT > 2.2) {
      this.ftSent = true;
      this.t.send(packEnd(m));
      this.ended = true;
      setTimeout(() => this.t.close(), 400);
      crowdAmbience(false); input.gameActive = false;
      UI.showFulltime(m, { menu: () => this.app.toMenu(), extra: 'Online match' });
    }
  }
}

// ---------------------------------------------------------------- guest scene (interpolated view)
export class OnlineGuestScene extends LinkScene {
  constructor({ app, transport, home, away, minutes }) {
    super(app, transport);
    // render-only: never update()d, so its clock only moves with the host's snapshots
    this.m = new Match({ home, away, humans: [], ctrls: [], minutes: minutes || settings.matchMinutes });
    this.sendAcc = 0; this.reconnAcc = 0;
    this.prev = null; this.cur = null; this.lerpT = 1;
    this.downText = 'Connection to the host lost, reconnecting';
    this.lostText = 'The connection to the host dropped and did not come back.';
  }
  onMessage(msg) {
    if (msg.t === 'snap') {
      const s = sanitizeSnapshot(msg, this.m.players.length, STATE_CODES);
      if (s && (!this.cur || s.seq >= this.cur.seq)) { this.prev = this.cur || s; this.cur = s; this.lerpT = 0; }
    } else if (msg.t === 'ev') {
      const e = sanitizeEvent(msg.e);
      if (!e) return;
      handleSound(e);
      if (e.type === 'goal') this.m.banner('GOAL!', '', '#ffd166', 2.2);
    } else if (msg.t === 'end') {
      const r = sanitizeEnd(msg);
      const m = this.m;
      m.score = r.score; m.stats = r.stats; m.goals = r.goals;
      this.ended = true;
      try { this.t.close(); } catch { /* ignore */ }
      crowdAmbience(false); input.gameActive = false;
      UI.showFulltime(m, { menu: () => this.app.toMenu(), extra: 'Online match' });
    } else if (msg.t === 'bye') this.finish('Host left', 'The host left the match.');
  }
  update(dt) {
    const ok = this.tickLink(dt);
    if (this.ended) return;
    if (this.status === 'down') {
      this.reconnAcc += dt;
      if (this.reconnAcc > 2) { this.reconnAcc = 0; this.t.reconnect(); }
    }
    if (ok) {
      const c = input.ctrls[0];
      this.sendAcc += dt;
      if (this.sendAcc >= INPUT_DT) {
        this.sendAcc = 0;
        const mv = this.paused ? { x: 0, y: 0 } : c.move();
        const i = { mx: mv.x, my: mv.y };
        for (const a of INPUT_BOOL) i[a] = !this.paused && c.isHeld(a);
        this.t.send({ t: 'in', i: packInput(i) }, { rt: true });
      }
    }
    for (const b of this.m.banners) b.t += dt;
    this.m.banners = this.m.banners.filter((b) => b.t < b.dur);
    if (this.cur) {
      this.lerpT = Math.min(1, this.lerpT + dt / SNAP_DT);
      applySnapshot(this.m, this.prev || this.cur, this.cur, this.lerpT);
      // run the stride animation locally from the snapshot velocity (smooth at 60 fps)
      for (const p of this.m.players) p.anim = (p.anim || 0) + Math.hypot(p.vx, p.vy) * dt * 2.3;
    }
  }
}

/** Blend two sanitized snapshots (a -> b) at t in [0,1] onto the render-only Match `m`. */
export function applySnapshot(m, a, b, t) {
  const ball = m.ball;
  ball.x = lerpNum(a.ball.x, b.ball.x, t); ball.y = lerpNum(a.ball.y, b.ball.y, t);
  ball.z = lerpNum(a.ball.z, b.ball.z, t); ball.rot = lerpNum(a.ball.rot, b.ball.rot, t);
  ball.vx = (b.ball.x - a.ball.x) * SNAP_HZ; ball.vy = (b.ball.y - a.ball.y) * SNAP_HZ;
  const n = Math.min(m.players.length, b.players.length);
  for (let i = 0; i < n; i++) {
    const pa = a.players[i] || b.players[i], pb = b.players[i], p = m.players[i];
    p.x = lerpNum(pa.x, pb.x, t); p.y = lerpNum(pa.y, pb.y, t);
    p.facing = pa.facing + angDiff(pa.facing, pb.facing) * t;
    p.vx = (pb.x - pa.x) * SNAP_HZ; p.vy = (pb.y - pa.y) * SNAP_HZ;
    p.state = pb.state; p.sentOff = pb.sentOff; p.team = pb.team;
  }
  m.score = b.score; m.clock = b.clock; m.half = b.half; m.state = b.state;
  const me = b.myIdx >= 0 ? m.players[b.myIdx] : null;
  const h = m.humans[0];
  if (me && (!h || h.player !== me)) {
    for (const p of m.players) p.human = -1;
    me.human = 0;
    m.humans = [{ ctrl: 0, team: me.team, player: me, lastSwitch: -9 }];
  }
}

function drawConnBanner(ctx, w, hgt, text) {
  if (!text) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dpr = ctx.canvas.width / Math.max(1, w);
  ctx.scale(dpr, dpr);
  ctx.font = '600 15px Inter, system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 32, bh = 32, bx = w / 2 - bw / 2, by = 64;
  ctx.fillStyle = 'rgba(11,13,16,0.88)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#ffb020';
  ctx.fillRect(bx, by, 3, bh);
  ctx.fillStyle = '#f2f4f7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, by + bh / 2 + 1);
  ctx.restore();
}
