// Pitchside 3D — online lobby + match controller (UI). Host = home side, guest = away side.
// Host runs the authoritative sim; guest streams inputs and renders host snapshots.
import { createTransport, loadPeerJS } from './transport.js';
import { NetSession, driveHost, driveGuest } from './session.js';
import { sanitizeTeam, sanitizeConfig, sanitizeResult, dedupeTeams, normalizeRoomCode, cleanStr } from './protocol.js';

const NET_KEY = 'pitchside.net';
const HALVES = [2, 3, 4, 6, 8];

function loadNetPrefs() {
  try { return { name: '', host: '', port: '', path: '/', secure: true, ...(JSON.parse(localStorage.getItem(NET_KEY) || '{}') || {}) }; } catch { return { name: '', host: '', port: '', path: '/', secure: true }; }
}
function saveNetPrefs(p) { try { localStorage.setItem(NET_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

/**
 * @param {HTMLElement} root
 * @param {object} ctx  helpers from main.js: h, nav, toast, getTeams, getSavedUT, openMatch, renderResult,
 *                      teamPicker, teamOvr, shirtSVG, loadSettings, transportKind, dcTimeoutMs, autoAction, setBack
 */
export function mountOnline(root, ctx) {
  const { h } = ctx;
  const prefs = loadNetPrefs();
  const st = {
    phase: 'home', session: null, role: null, code: null,
    teams: null, ut: null, myIdx: 1, myTeam: null, peerTeam: null, myReady: false, peerReady: false,
    cfg: { halfMinutes: ctx.loadSettings().halfMinutes, stadium: ctx.loadSettings().stadium },
    mid: 0, match: null, driver: null, matchTeams: null, dcTimer: null, lastResult: null,
    wantRematch: false, peerRematch: false, destroyed: false, ping: null, events: [],
  };
  window.__net = st; // debugging / tests

  if (ctx.transportKind === 'peer') loadPeerJS().catch(() => { /* surfaced on host/join */ });

  const view = (...kids) => { root.replaceChildren(h('div', { class: `online online--${st.phase}` }, ...kids)); };
  const setPhase = (p) => { st.phase = p; root.dataset.phase = p; };

  const transportBadge = () => (ctx.transportKind !== 'peer'
    ? h('div', { class: 'tag tag--warn' }, `Test transport: ${ctx.transportKind === 'bc' ? 'BroadcastChannel (same browser)' : 'Loopback'}`) : null);

  // ---------------------------------------------------------------- home
  function renderHome(err = '') {
    teardownSession();
    setPhase('home');
    const nameIn = h('input', { class: 'input', id: 'net-name', maxlength: '16', placeholder: 'Your name', value: prefs.name || '', autocomplete: 'nickname' });
    const codeIn = h('input', { class: 'input code-input', id: 'net-code', maxlength: '5', placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', inputmode: 'text', 'aria-label': 'Room code' });
    codeIn.addEventListener('input', () => { const v = normalizeRoomCode(codeIn.value); if (v !== codeIn.value) codeIn.value = v; });
    const adv = {
      host: h('input', { class: 'input', id: 'net-host', placeholder: '0.peerjs.com (default)', value: prefs.host || '' }),
      port: h('input', { class: 'input', id: 'net-port', placeholder: '443', inputmode: 'numeric', value: prefs.port || '' }),
      path: h('input', { class: 'input', id: 'net-path', placeholder: '/', value: prefs.path || '/' }),
      secure: h('input', { type: 'checkbox', id: 'net-secure', checked: prefs.secure !== false || null }),
    };
    const saveName = () => { prefs.name = cleanStr(nameIn.value, 16, ''); saveNetPrefs(prefs); };
    const saveAdv = () => {
      prefs.host = cleanStr(adv.host.value, 120, '');
      prefs.port = String(parseInt(adv.port.value, 10) || '');
      prefs.path = cleanStr(adv.path.value, 60, '/');
      prefs.secure = adv.secure.checked;
      saveNetPrefs(prefs);
    };
    const hostBtn = h('button', { class: 'btn btn--primary btn--xl', type: 'button', id: 'net-host-btn', 'data-autofocus': '1', onclick: () => { saveName(); saveAdv(); doHost(); } }, 'Host match');
    const joinBtn = h('button', { class: 'btn btn--xl', type: 'button', id: 'net-join-btn', onclick: () => { saveName(); saveAdv(); doJoin(codeIn.value); } }, 'Join');
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
    view(
      transportBadge(),
      err ? h('div', { class: 'alert', role: 'alert' }, err) : null,
      h('div', { class: 'online-cards' },
        h('section', { class: 'panel online-card' },
          h('div', { class: 'kicker' }, 'Step 1'),
          h('h2', null, 'Host a match'),
          h('p', { class: 'hint' }, 'Get a 5-letter room code and send it to your friend. You play as the home side.'),
          hostBtn),
        h('section', { class: 'panel online-card' },
          h('div', { class: 'kicker' }, 'or'),
          h('h2', null, 'Join a match'),
          h('p', { class: 'hint' }, 'Enter the code your friend sees. You play as the away side.'),
          h('div', { class: 'join-row' }, codeIn, joinBtn))),
      h('div', { class: 'panel online-extra' },
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'net-name' }, 'Display name'), nameIn),
        h('details', { class: 'adv' },
          h('summary', null, 'Advanced: custom PeerServer'),
          h('p', { class: 'hint' }, 'Leave empty to use the free public PeerJS broker. Both players must use the same server.'),
          h('div', { class: 'adv-grid' },
            h('label', null, 'Host', adv.host), h('label', null, 'Port', adv.port), h('label', null, 'Path', adv.path),
            h('label', { class: 'chk' }, adv.secure, ' Use TLS (wss/https)'))),
        h('p', { class: 'hint' }, 'Peer-to-peer over WebRTC. Some strict corporate or mobile networks block direct connections.')),
    );
    root.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
  }

  function peerCfg() {
    return prefs.host ? { host: prefs.host, port: prefs.port || undefined, path: prefs.path || '/', secure: prefs.secure !== false } : {};
  }

  function newSession() {
    const t = createTransport(ctx.transportKind, ctx.transportKind === 'peer' ? peerCfg() : undefined);
    const s = new NetSession(t, { name: prefs.name || (st.role === 'host' ? 'Host' : 'Guest') });
    st.session = s;
    s.on('ping', (ms) => { st.ping = ms; for (const e of root.querySelectorAll('.ping-val')) e.textContent = `${ms} ms`; });
    s.on('link', onLink);
    s.on('msg', onMsg);
    s.on('bye', onBye);
    s.on('fatal', (why) => { if (st.phase !== 'home') { teardownSession(); showEnded('Connection refused', why); } });
    s.on('newpeer', () => { st.peerTeam = null; st.peerReady = false; });
    return s;
  }

  async function doHost() {
    st.role = 'host';
    setPhase('hosting');
    view(h('div', { class: 'panel center-panel' }, h('div', { class: 'spinner' }), h('p', null, 'Creating room…')));
    const s = newSession();
    try {
      st.code = await s.host();
    } catch (e) {
      if (st.session === s) renderHome(`Could not create a room: ${e.message}`);
      return;
    }
    if (st.session !== s) return;
    renderWaiting();
  }

  function renderWaiting() {
    setPhase('hosting');
    const copy = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(st.code); ctx.toast('Code copied'); } catch { ctx.toast(`Code: ${st.code}`); }
    } }, 'Copy code');
    view(
      transportBadge(),
      h('div', { class: 'panel center-panel waiting' },
        h('div', { class: 'kicker' }, 'Room code'),
        h('div', { class: 'room-code', id: 'room-code', 'aria-live': 'polite' }, st.code.split('').map((c) => h('span', null, c))),
        h('p', null, h('span', { class: 'pulse-dot' }), ' Waiting for your opponent to join…'),
        h('div', { class: 'row center' }, copy, h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderHome() }, 'Cancel'))));
  }

  async function doJoin(raw) {
    const code = normalizeRoomCode(raw);
    if (code.length !== 5) { renderHome('Room codes are 5 characters.'); return; }
    st.role = 'guest';
    setPhase('joining');
    view(h('div', { class: 'panel center-panel' }, h('div', { class: 'spinner' }), h('p', null, `Joining room ${code}…`)));
    const s = newSession();
    try {
      await s.join(code);
    } catch (e) {
      if (st.session === s) renderHome(`Could not join ${code}: ${e.message}`);
      return;
    }
    if (st.session !== s) return;
    st.code = code;
    enterLobby();
  }

  // ---------------------------------------------------------------- lobby
  async function enterLobby() {
    setPhase('lobby');
    st.myReady = false;
    st.peerReady = false;
    st.wantRematch = false;
    st.peerRematch = false;
    if (!st.teams) {
      view(h('div', { class: 'panel center-panel' }, h('div', { class: 'spinner' }), h('p', null, 'Loading teams…')));
      try { st.teams = await ctx.getTeams(); } catch (e) {
        teardownSession();
        showEnded('Teams could not be loaded', e.message);
        return;
      }
      st.ut = await ctx.getSavedUT();
      if (st.destroyed || st.phase !== 'lobby') return;
    }
    if (!st.myTeam) {
      let last = {};
      try { last = JSON.parse(localStorage.getItem('pitchside.lastKickoff') || '{}') || {}; } catch { /* ignore */ }
      // host defaults to their last home team, guest to their last away team, so the sides differ
      const i = st.teams.findIndex((t) => t.id === (st.role === 'host' ? last.home : last.away));
      st.myIdx = (i >= 0 ? i : st.role === 'host' ? 0 : Math.min(1, st.teams.length - 1)) + 1;
      st.myTeam = st.teams[st.myIdx - 1];
    }
    announce();
    renderLobby();
  }

  /** Send our lobby state (idempotent; re-sent after reconnects). */
  function announce() {
    if (!st.session || !st.myTeam) return;
    st.session.send('team', { team: st.myTeam });
    st.session.send('ready', { r: st.myReady });
    if (st.role === 'host') st.session.send('cfg', st.cfg);
  }

  function statusBar() {
    const up = st.session && st.session.linked;
    return h('div', { class: `net-status ${up ? 'up' : 'down'}` },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
      h('span', { class: 'net-status-text' }, up ? `Connected to ${st.session.peerName}` : 'Reconnecting…'),
      h('span', { class: 'net-room' }, `Room ${st.code}`),
      h('span', { class: 'net-ping' }, 'Ping ', h('b', { class: 'ping-val' }, st.ping != null ? `${st.ping} ms` : '—')));
  }

  function renderLobby() {
    if (st.phase !== 'lobby') return;
    const utOpt = { team: st.ut || st.teams[0], label: 'My Ultimate Team', tag: 'UT', disabled: !st.ut, note: 'Build a squad in Ultimate Team first' };
    const options = [utOpt, ...st.teams.map((t) => ({ team: t }))];
    const picker = ctx.teamPicker({
      title: st.role === 'host' ? 'You · Home' : 'You · Away', options, index: st.myIdx, sideClass: st.role === 'host' ? 'home' : 'away',
      onChange: (team, i) => {
        st.myIdx = i;
        st.myTeam = team;
        st.myReady = false;
        st.session.send('team', { team });
        st.session.send('ready', { r: false });
        renderLobby();
      },
    });
    const peer = st.peerTeam;
    const peerCard = h('div', { class: `picker peer ${st.role === 'host' ? 'away' : 'home'}` },
      h('div', { class: 'picker-head' }, h('span', { class: 'picker-side' }, `${st.session ? st.session.peerName : 'Opponent'} · ${st.role === 'host' ? 'Away' : 'Home'}`),
        st.peerReady ? h('span', { class: 'tag tag--ok' }, 'READY') : h('span', { class: 'tag' }, 'Not ready')),
      peer ? h('div', { class: 'picker-main' }, h('div', { class: 'picker-card static', style: { '--kit1': peer.kit.primary, '--kit2': peer.kit.secondary } },
        h('div', { class: 'picker-shirt' }, ctx.shirtSVG(peer.kit, 10, 96)),
        h('div', { class: 'picker-name', id: 'peer-team-name' }, peer.name),
        h('div', { class: 'picker-meta' }, h('b', { class: 'ovr' }, ctx.teamOvr(peer)), h('span', null, 'OVR')),
        h('div', { class: 'picker-form' }, peer.formation)))
        : h('div', { class: 'picker-main' }, h('div', { class: 'picker-card static empty' }, h('div', { class: 'spinner' }), h('p', null, 'Opponent is choosing…'))));
    if (st.myReady) picker.el.classList.add('is-ready');
    const cfgEl = st.role === 'host'
      ? h('div', { class: 'opts' },
        seg('Half length', HALVES.map((m) => [m, `${m} min`]), st.cfg.halfMinutes, (v) => { st.cfg.halfMinutes = v; st.session.send('cfg', st.cfg); }),
        seg('Stadium', [['day', 'Day'], ['night', 'Night']], st.cfg.stadium, (v) => { st.cfg.stadium = v; st.session.send('cfg', st.cfg); }))
      : h('div', { class: 'cfg-read', id: 'cfg-read' }, `Host settings: ${st.cfg.halfMinutes} min halves · ${st.cfg.stadium === 'night' ? 'Night' : 'Day'} match`);
    const readyBtn = h('button', {
      class: `btn btn--xl ${st.myReady ? 'btn--ok' : 'btn--primary'}`, type: 'button', id: 'net-ready', 'data-autofocus': '1',
      disabled: !(st.session && st.session.linked) || null,
      onclick: () => {
        st.myReady = !st.myReady;
        st.session.send('ready', { r: st.myReady });
        renderLobby();
        maybeStart();
      },
    }, st.myReady ? 'Ready ✓ (tap to cancel)' : 'Ready up');
    const waitingFor = st.myReady && !st.peerReady ? 'Waiting for opponent to ready up…' : !st.myReady && st.peerReady ? 'Your opponent is ready!' : '';
    view(
      transportBadge(),
      statusBar(),
      h('div', { class: 'pickers' }, st.role === 'host' ? [picker.el, h('div', { class: 'pickers-vs' }, 'VS'), peerCard] : [peerCard, h('div', { class: 'pickers-vs' }, 'VS'), picker.el]),
      cfgEl,
      h('div', { class: 'row center' }, readyBtn),
      waitingFor ? h('p', { class: 'hint center' }, waitingFor) : null,
    );
  }

  function seg(label, options, value, onChange) {
    const wrap = h('div', { class: 'field' }, h('div', { class: 'field-label' }, label));
    const s = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const btns = options.map(([v, t]) => {
      const b = h('button', { type: 'button', role: 'radio', class: v === value ? 'on' : '', 'aria-checked': String(v === value), 'data-value': String(v) }, t);
      b.addEventListener('click', () => { for (const o of btns) { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', String(o === b)); } onChange(v); });
      return b;
    });
    s.append(...btns);
    wrap.append(s);
    return wrap;
  }

  function maybeStart() {
    if (st.role !== 'host' || st.phase !== 'lobby') return;
    if (!(st.myReady && st.peerReady && st.peerTeam && st.session.linked)) return;
    hostStart();
  }

  // ---------------------------------------------------------------- messages
  function onMsg(m) {
    switch (m.t) {
      case 'team': {
        try {
          st.peerTeam = sanitizeTeam(m.team, st.role === 'host' ? 'g' : 'h');
        } catch (e) {
          console.warn('[net] rejected peer team:', e.message);
          st.peerTeam = null;
          ctx.toast('Opponent sent an invalid team', 'bad');
        }
        st.peerReady = false;
        if (st.phase === 'lobby') renderLobby();
        break;
      }
      case 'ready':
        st.peerReady = m.r === true && !!st.peerTeam;
        if (st.phase === 'lobby') { renderLobby(); maybeStart(); }
        break;
      case 'cfg':
        if (st.role !== 'guest') return;
        st.cfg = sanitizeConfig(m);
        if (st.phase === 'lobby') renderLobby();
        break;
      case 'start':
        if (st.role !== 'guest') return;
        guestStart(m);
        break;
      case 'loaded':
        if (st.role === 'host' && st.pendingStart && m.mid === st.mid) st.pendingStart();
        break;
      case 'evt':
        if (st.role === 'guest' && st.phase === 'match' && m.e && typeof m.e === 'object' && st.events.length < 500) st.events.push(m.e);
        break;
      case 'end':
        if (st.role === 'guest' && m.mid === st.mid && (st.phase === 'match' || st.phase === 'awaitEnd')) {
          const { home, away } = st.matchTeams;
          finishMatch(sanitizeResult(m.result, home, away));
        }
        break;
      case 'quit':
        if (m.mid === st.mid && (st.phase === 'match' || st.phase === 'starting' || st.phase === 'awaitEnd')) {
          closeMatch();
          st.phase = 'ended';
          showEnded('Opponent left the match', 'Your opponent quit — you win by forfeit.', true);
        }
        break;
      case 'rematch':
        st.peerRematch = m.want === true;
        updateRematch();
        if (st.role === 'host' && st.phase === 'result' && st.wantRematch && st.peerRematch) hostStart();
        break;
      case 'lobby':
        if (st.phase === 'result' || st.phase === 'ended') enterLobby();
        break;
      default:
        break;
    }
  }

  function onLink(up) {
    if (st.destroyed) return;
    if (up) {
      clearDc();
      if (st.phase === 'match') {
        try { st.match.handle.resume(); } catch { /* ignore */ }
      }
      if (st.phase === 'lobby') { announce(); renderLobby(); }
      if (st.phase === 'hosting' && st.role === 'host') enterLobby();
      return;
    }
    // link down
    if (st.phase === 'match' || st.phase === 'starting' || st.phase === 'awaitEnd') {
      if (st.match) try { st.match.handle.pause(); } catch { /* ignore */ }
      startDc(st.match ? st.match.overlay : null, () => {
        closeMatch();
        st.phase = 'ended';
        if (st.role === 'host') showEnded('Opponent disconnected', 'They did not reconnect in time — you win by forfeit.', true);
        else showEnded('Connection lost', 'Could not reach the host again. The match was abandoned.');
        teardownSession();
      });
    } else if (st.phase === 'lobby' || st.phase === 'result') {
      if (st.phase === 'lobby') renderLobby();
      startDc(null, () => { teardownSession(); showEnded('Connection lost', 'Your opponent is no longer reachable.'); });
    }
  }

  function onBye() {
    if (st.phase === 'match' || st.phase === 'starting' || st.phase === 'awaitEnd') {
      closeMatch();
      st.phase = 'ended';
      showEnded('Opponent left', 'Your opponent left the match — you win by forfeit.', false);
    } else if (st.phase !== 'home' && st.phase !== 'ended') {
      showEnded('Opponent left', 'Your opponent left the room.');
    }
    teardownSession();
  }

  // ---------------------------------------------------------------- disconnect countdown
  function startDc(overlayHost, onTimeout) {
    if (st.dcTimer) return;
    const total = Math.round(ctx.dcTimeoutMs / 1000);
    let left = total;
    const el = h('div', { class: 'dc-overlay', role: 'alertdialog', 'aria-live': 'assertive', id: 'dc-overlay' },
      h('div', { class: 'dc-box' },
        h('div', { class: 'spinner' }),
        h('h2', null, st.role === 'host' ? 'Opponent disconnected' : 'Connection to host lost'),
        h('p', null, 'Waiting for them to reconnect… ', h('b', { class: 'dc-left' }, `${left}s`)),
        h('div', { class: 'dc-bar' }, h('i', { style: { animationDuration: `${total}s` } })),
        h('button', { class: 'btn', type: 'button', onclick: () => { stopDcNow(); onTimeout(); } }, st.role === 'host' ? 'Claim forfeit now' : 'Give up')));
    (overlayHost || document.body).append(el);
    const iv = setInterval(() => {
      left--;
      const l = el.querySelector('.dc-left');
      if (l) l.textContent = `${Math.max(0, left)}s`;
      if (left <= 0) { stopDcNow(); onTimeout(); }
    }, 1000);
    st.dcTimer = { iv, el };
    function stopDcNow() { clearDc(); }
  }
  function clearDc() {
    if (!st.dcTimer) return;
    clearInterval(st.dcTimer.iv);
    st.dcTimer.el.remove();
    st.dcTimer = null;
  }

  // ---------------------------------------------------------------- match flow
  function hostStart() {
    if (st.phase !== 'lobby' && st.phase !== 'result') return;
    st.mid++;
    const mid = st.mid;
    let home, away;
    try {
      home = sanitizeTeam(st.myTeam, 'h');
      away = dedupeTeams(home, st.peerTeam);
    } catch (e) {
      ctx.toast(`Cannot start: ${e.message}`, 'bad');
      return;
    }
    setPhase('starting');
    st.wantRematch = false;
    st.peerRematch = false;
    view(h('div', { class: 'panel center-panel' }, h('div', { class: 'spinner' }), h('p', null, 'Starting match…')));
    const cfg = { ...st.cfg };
    st.session.send('start', { mid, home, away, cfg });
    let started = false;
    const go = () => {
      if (started || st.mid !== mid || st.phase !== 'starting') return;
      started = true;
      st.pendingStart = null;
      launch('host', home, away, cfg);
    };
    st.pendingStart = go;
    setTimeout(go, 8000); // don't wait forever for a slow guest
  }

  function guestStart(m) {
    if (!['lobby', 'result', 'ended', 'starting'].includes(st.phase)) return;
    let home, away;
    try {
      home = sanitizeTeam(m.home, 'h');
      away = sanitizeTeam(m.away, 'g');
      away = dedupeTeams(home, away);
    } catch (e) {
      console.warn('[net] bad start message', e);
      return;
    }
    st.mid = Number.isInteger(m.mid) ? m.mid : st.mid + 1;
    st.cfg = sanitizeConfig(m.cfg);
    st.wantRematch = false;
    st.peerRematch = false;
    setPhase('starting');
    launch('guest', home, away, st.cfg);
  }

  async function launch(role, home, away, cfg) {
    st.matchTeams = { home, away };
    st.events = [];
    const mid = st.mid;
    let m;
    try {
      m = await ctx.openMatch({
        home, away, halfMinutes: cfg.halfMinutes, stadium: cfg.stadium, difficulty: 'pro',
        controllers: role === 'host' ? { home: 'p1', away: 'remote' } : { home: 'remote', away: 'p1' },
        netRole: role,
        onEvent: (e) => {
          if (role !== 'host') return;
          let plain = null;
          try { plain = JSON.parse(JSON.stringify(e)); } catch { /* ignore */ }
          if (plain) st.session.send('evt', { e: plain });
        },
      });
    } catch (e) {
      console.error('[net] could not start match', e);
      st.session.send('quit', { mid });
      setPhase('ended');
      showEnded('Match engine failed', String(e.message || e));
      return;
    }
    if (st.destroyed || st.mid !== mid || !st.session) { m.close(); return; }
    st.match = m;
    setPhase('match');
    if (role === 'host') {
      st.driver = driveHost(st.session, m.handle, { side: 'away' });
    } else {
      st.driver = driveGuest(st.session, m.handle, { side: 'away' });
      st.session.send('loaded', { mid });
    }
    if (st.session && !st.session.linked) onLink(false);
    m.done.then((result) => onLocalEnd(role, mid, result));
  }

  function onLocalEnd(role, mid, result) {
    if (st.mid !== mid || !st.match) return;
    if (result && result.abandoned) {
      st.session && st.session.send('quit', { mid });
      closeMatch();
      setPhase('ended');
      showEnded('You left the match', 'The match was abandoned.', true);
      return;
    }
    if (role === 'host') {
      if (st.driver && st.driver.flush) st.driver.flush();
      st.session.send('end', { mid, result });
      const { home, away } = st.matchTeams;
      finishMatch(sanitizeResult(result, home, away));
    } else {
      // Guest engine finished on its own (from snapshots); prefer the host's authoritative result.
      setPhase('awaitEnd');
      setTimeout(() => {
        if (st.phase === 'awaitEnd' && st.mid === mid) {
          const { home, away } = st.matchTeams;
          finishMatch(sanitizeResult(result, home, away));
        }
      }, 4000);
    }
  }

  function closeMatch() {
    clearDc();
    if (st.driver) { st.driver.stop(); st.driver = null; }
    if (st.match) { const m = st.match; st.match = null; m.close(); }
  }

  function finishMatch(result) {
    closeMatch();
    st.lastResult = result;
    setPhase('result');
    const { home, away } = st.matchTeams;
    const mine = st.role === 'host' ? 'home' : 'away';
    const gf = mine === 'home' ? result.homeGoals : result.awayGoals;
    const ga = mine === 'home' ? result.awayGoals : result.homeGoals;
    const el = ctx.renderResult({
      home, away, result, title: gf > ga ? 'Victory' : gf < ga ? 'Defeat' : 'Draw', kicker: `Online · Room ${st.code}`,
      actions: [
        { id: 'rematch', label: 'Rematch', primary: true, onClick: () => { st.wantRematch = !st.wantRematch; st.session && st.session.send('rematch', { want: st.wantRematch }); updateRematch(); if (st.role === 'host' && st.wantRematch && st.peerRematch) hostStart(); } },
        { id: 'teams', label: 'Change teams', onClick: () => { st.session && st.session.send('lobby', {}); enterLobby(); } },
        { id: 'leave', label: 'Leave', onClick: () => leave() },
      ],
    });
    view(statusBar(), el, h('p', { class: 'hint center rematch-note', id: 'rematch-note' }));
    updateRematch();
  }

  function updateRematch() {
    const b = root.querySelector('[data-action="rematch"]');
    const n = root.querySelector('#rematch-note');
    if (!b || !n) return;
    b.textContent = st.wantRematch ? 'Waiting… (cancel)' : 'Rematch';
    n.textContent = st.peerRematch && !st.wantRematch ? 'Your opponent wants a rematch!' : st.wantRematch ? 'Waiting for your opponent to accept the rematch…' : '';
  }

  function showEnded(title, text, canLobby = false) {
    setPhase('ended');
    const linked = st.session && st.session.linked && !st.session.closed;
    view(h('div', { class: 'panel center-panel ended' },
      h('h2', null, title),
      h('p', null, text),
      h('div', { class: 'row center' },
        canLobby && linked ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => { st.session.send('lobby', {}); enterLobby(); } }, 'Back to lobby') : null,
        h('button', { class: `btn ${canLobby && linked ? '' : 'btn--primary'}`, type: 'button', 'data-autofocus': '1', onclick: () => renderHome() }, 'Online menu'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => leave() }, 'Main menu'))));
  }

  function teardownSession() {
    clearDc();
    closeMatch();
    if (st.session) { const s = st.session; st.session = null; s.close(); }
    st.peerTeam = null;
    st.peerReady = false;
    st.myReady = false;
    st.ping = null;
    st.pendingStart = null;
  }

  function leave() {
    teardownSession();
    ctx.nav.back();
  }

  ctx.setBack(() => {
    if (st.phase === 'home') { ctx.nav.back(); return; }
    if ((st.phase === 'lobby' || st.phase === 'hosting' || st.phase === 'result') && st.session && !confirmLeave()) return;
    renderHome();
  });
  function confirmLeave() {
    try { return window.confirm('Leave this online room?'); } catch { return true; }
  }

  // closing the tab = leaving on purpose (tells the peer immediately instead of a 15 s timeout)
  const onPageHide = () => { if (st.session) st.session.close(); };
  window.addEventListener('pagehide', onPageHide);

  renderHome();
  if (ctx.autoAction === 'host') doHost();
  else if (ctx.autoAction && ctx.autoAction.startsWith('join:')) doJoin(ctx.autoAction.slice(5));

  return {
    destroy() {
      st.destroyed = true;
      window.removeEventListener('pagehide', onPageHide);
      teardownSession();
      if (window.__net === st) delete window.__net;
    },
  };
}
