// Pitchside 3D — online lobby + match controller (UI). Host = home side, guest = away side.
// Host runs the authoritative sim; guest streams inputs and renders host snapshots.
// Two ways in: Quick Search (server matchmaking, see services.js/matchmaker.js) and 5-letter code rooms.
// Each side sends its own gameplay settings ('gp'); the host applies them per side.
import { createTransport, loadPeerJS } from './transport.js';
import { NetSession, driveHost, driveGuest } from './session.js';
import { sanitizeTeam, sanitizeConfig, sanitizeResult, dedupeTeams, normalizeRoomCode, cleanStr } from './protocol.js';
import { loadGameplay } from '../shared/gameplay.js';
import { sanitizeGameplay } from './gameplaymeta.js';
import { normalizeFriendCode } from './validate.js';

const NET_KEY = 'pitchside.net';
const HALVES = [2, 3, 4, 6, 8];
const QUICK_KEY = 'pitchside.quick';
const MODE_LABEL = { friendly: 'Friendly', ut: 'Ultimate Team', rivals: 'Rivals' };
const divName = (d) => (d === 0 ? 'Elite' : `Division ${d}`);
const fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
function loadQuickPrefs() { try { return { mode: 'friendly', teamId: '', ...(JSON.parse(localStorage.getItem(QUICK_KEY) || '{}') || {}) }; } catch { return { mode: 'friendly', teamId: '' }; } }
function saveQuickPrefs(p) { try { localStorage.setItem(QUICK_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

function loadNetPrefs() {
  try { return { name: '', host: '', port: '', path: '/', secure: true, ...(JSON.parse(localStorage.getItem(NET_KEY) || '{}') || {}) }; } catch { return { name: '', host: '', port: '', path: '/', secure: true }; }
}
function saveNetPrefs(p) { try { localStorage.setItem(NET_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

/**
 * @param {HTMLElement} root
 * @param {object} ctx  helpers from main.js: h, nav, toast, getTeams, getSavedUT, openMatch, renderResult,
 *                      teamPicker, teamOvr, shirtSVG, loadSettings, transportKind, dcTimeoutMs, autoAction, setBack,
 *                      online (services.js), autoQuick ({mode, team} -> start searching at once), onResult(result, info),
 *                      onAutoEnd(res) (autoQuick search failed/cancelled), autoInvite (accepted friend invite, see acceptPreconnected)
 * @returns {{ destroy(), isBusy(): boolean, acceptPreconnected(res) }}
 */
export function mountOnline(root, ctx) {
  const { h } = ctx;
  const prefs = loadNetPrefs();
  const qprefs = loadQuickPrefs();
  const services = ctx.online;
  const st = {
    quick: null, qmode: ['ut', 'rivals'].includes(qprefs.mode) ? qprefs.mode : 'friendly', qTeam: null, searchTimer: null,
    friendMatch: null, challengeMode: 'friendly', friends: null, rivals: null,
    myGp: sanitizeGameplay(loadGameplay()), peerGp: null, reported: new Set(), status: null,
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
  function renderHome(err = '', retry = null) {
    teardownSession();
    stopSearchClock();
    st.quick = null;
    st.friendMatch = null;
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
    const saveName = () => {
      const before = prefs.name;
      prefs.name = cleanStr(nameIn.value, 16, '');
      saveNetPrefs(prefs);
      if (prefs.name && prefs.name !== before && services && st.status && st.status.online) services.setName(prefs.name).catch(() => {});
    };
    nameIn.addEventListener('change', saveName);
    const saveAdv = () => {
      prefs.host = cleanStr(adv.host.value, 120, '');
      prefs.port = String(parseInt(adv.port.value, 10) || '');
      prefs.path = cleanStr(adv.path.value, 60, '/');
      prefs.secure = adv.secure.checked;
      saveNetPrefs(prefs);
    };
    st.saveHomePrefs = () => { saveName(); saveAdv(); };
    const hostBtn = h('button', { class: 'btn btn--xl', type: 'button', id: 'net-host-btn', onclick: () => { saveName(); saveAdv(); doHost(); } }, 'Host match');
    const joinBtn = h('button', { class: 'btn btn--xl', type: 'button', id: 'net-join-btn', onclick: () => { saveName(); saveAdv(); doJoin(codeIn.value); } }, 'Join');
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });

    // Quick Search card
    const teamSlot = h('div', { class: 'quick-team', id: 'quick-team' }, h('div', { class: 'loading loading--sm' }, h('div', { class: 'spinner' }), 'Loading teams…'));
    const quickNote = h('p', { class: 'hint quick-note', id: 'quick-note' });
    const findBtn = h('button', { class: 'btn btn--primary btn--xl', type: 'button', id: 'quick-find', 'data-autofocus': '1', disabled: true, onclick: () => {
      saveName(); saveAdv();
      const team = st.qmode === 'friendly' ? st.qTeam : st.ut;
      if (team) doQuickSearch(st.qmode, team);
    } }, 'Find opponent');
    const modeSeg = seg('Mode', [['friendly', 'Friendly'], ['ut', 'Ultimate Team'], ['rivals', 'Rivals']], st.qmode, (v) => {
      st.qmode = v; qprefs.mode = v; saveQuickPrefs(qprefs); renderTeamSlot();
    });
    modeSeg.querySelector('.seg').dataset.name = 'quick-mode';
    const quickCard = h('section', { class: 'panel online-card quick-card', id: 'quick-card' },
      h('div', { class: 'kicker' }, 'Option 1 · Matchmaking'),
      h('h2', null, 'Quick Search'),
      h('p', { class: 'hint' }, 'Get paired with a random opponent of similar rating. Every finished match earns coins.'),
      modeSeg, teamSlot, quickNote, findBtn);
    const codeCard = h('section', { class: 'panel online-card code-card', id: 'code-card' },
      h('div', { class: 'kicker' }, 'Option 2 · Friends'),
      h('h2', null, 'Play with a Code'),
      h('p', { class: 'hint' }, 'Host to get a 5-letter room code and send it to a friend — or enter the code your friend sees.'),
      hostBtn,
      h('div', { class: 'or-line', 'aria-hidden': 'true' }, h('span', null, 'or join')),
      h('div', { class: 'join-row' }, codeIn, joinBtn));

    function updateFind() {
      const online = st.status && st.status.online;
      const team = st.qmode === 'friendly' ? st.qTeam : st.ut;
      findBtn.disabled = !(online && team);
      quickNote.textContent = !st.status ? 'Checking matchmaking…'
        : !online ? 'Matchmaking is offline right now — you can still play a friend with a code.'
          : st.qmode !== 'friendly' && !st.ut ? 'Build a complete squad in Ultimate Team first.'
            : st.qmode === 'rivals' ? 'Ranked: wins earn 3 Rivals points, draws 1. Weekly rewards by peak division.' : '';
      quickNote.classList.toggle('warn', !!(st.status && !online));
    }
    function renderTeamSlot() {
      if (!st.teams) { updateFind(); return; }
      if (st.qmode !== 'friendly') {
        const t = st.ut;
        const rv = st.qmode === 'rivals' && st.rivals && st.rivals.ok ? st.rivals : null;
        teamSlot.replaceChildren(t
          ? h('div', { class: 'quick-ut', style: { '--kit1': t.kit.primary, '--kit2': t.kit.secondary } },
            ctx.shirtSVG(t.kit, 10, 56), h('div', null, h('b', { class: 'quick-ut-name' }, t.name), h('div', { class: 'hint' }, `${ctx.teamOvr(t)} OVR · ${t.formation}`)),
            rv ? h('div', { class: 'rivals-chip', id: 'rivals-chip' }, h('b', null, divName(rv.division)), h('small', null, rv.threshold ? `${rv.points}/${rv.threshold} pts` : `${rv.points} pts`)) : null)
          : h('div', { class: 'quick-ut empty' }, h('b', null, 'No Ultimate Team squad'), h('div', { class: 'hint' }, 'Open Ultimate Team from the main menu to build one.')));
      } else {
        const idx = Math.max(0, st.teams.findIndex((t) => t.id === qprefs.teamId));
        st.qTeam = st.teams[idx];
        const picker = ctx.teamPicker({
          title: 'Your team', options: st.teams.map((t) => ({ team: t })), index: idx, sideClass: 'home quick-picker',
          onChange: (team) => { st.qTeam = team; qprefs.teamId = team.id; saveQuickPrefs(qprefs); },
        });
        teamSlot.replaceChildren(picker.el);
      }
      updateFind();
    }

    const friendsPanel = h('section', { class: 'panel friends', id: 'friends-panel' },
      h('div', { class: 'friends-top' }, h('div', null, h('div', { class: 'kicker' }, 'Option 3'), h('h2', null, 'Friends')), h('div', { class: 'friends-code', id: 'friends-code' }),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'open-social', onclick: () => { import('./social.js').then((m) => m.openSocial(ctx.online)).catch((e) => console.error('[online] social UI failed', e)); } }, 'Messages & squads')),
      h('div', { class: 'friends-body', id: 'friends-body' }, h('p', { class: 'hint' }, 'Checking online services…')));
    const profileBar = h('div', { class: 'net-profile', id: 'net-profile', role: 'status' }, h('span', { class: 'pill pill--wait' }, h('i', { class: 'dot' }), 'Checking online services…'));
    function renderStatus() {
      const s2 = st.status;
      if (!s2) return;
      if (!s2.online) {
        profileBar.replaceChildren(h('span', { class: 'pill pill--off', id: 'net-pill' }, h('i', { class: 'dot' }), 'Online services offline'),
          h('span', { class: 'hint', id: 'net-offline-reason' }, `${s2.message || 'The online server is unreachable.'} Quick Search, friends and coins are unavailable — Play with a Code still works.`));
      } else {
        const p = s2.profile;
        profileBar.replaceChildren(...[h('span', { class: 'pill pill--on', id: 'net-pill' }, h('i', { class: 'dot' }), 'Online'),
          p ? h('span', { class: 'np-name' }, p.name) : null,
          p ? h('span', { class: 'np-stat', id: 'np-coins' }, h('small', null, 'Coins'), h('b', null, fmtNum(p.coins))) : null,
          p ? h('span', { class: 'np-stat' }, h('small', null, 'Rating'), h('b', null, p.rating)) : null,
          p ? h('span', { class: 'np-stat' }, h('small', null, 'Division'), h('b', null, p.division)) : null,
          p ? h('span', { class: 'np-stat np-record' }, h('small', null, 'W-D-L'), h('b', null, `${p.wins}-${p.draws}-${p.losses}`)) : null].filter(Boolean));
      }
      updateFind();
    }

    view(
      transportBadge(),
      err ? h('div', { class: 'alert', role: 'alert', id: 'net-error' }, h('span', null, err),
        retry ? h('button', { class: 'btn btn--sm', type: 'button', id: 'net-retry', onclick: () => retry() }, 'Retry') : null) : null,
      profileBar,
      h('div', { class: 'online-cards' }, quickCard, codeCard),
      friendsPanel,
      h('div', { class: 'panel online-extra' },
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'net-name' }, 'Display name'), nameIn),
        h('details', { class: 'adv' },
          h('summary', null, 'Advanced: custom PeerServer'),
          h('p', { class: 'hint' }, 'Leave empty to use the free public PeerJS broker. Both players must use the same server.'),
          h('div', { class: 'adv-grid' },
            h('label', null, 'Host', adv.host), h('label', null, 'Port', adv.port), h('label', null, 'Path', adv.path),
            h('label', { class: 'chk' }, adv.secure, ' Use TLS (wss/https)'))),
        h('p', { class: 'hint' }, 'Matches are peer-to-peer over WebRTC. Some strict corporate or mobile networks block direct connections.')),
    );
    renderStatus();
    updateFind();
    root.querySelector('[data-autofocus]')?.focus({ preventScroll: true });

    const token = (st.homeToken = (st.homeToken || 0) + 1);
    (async () => {
      if (!st.teams) {
        try { st.teams = await ctx.getTeams(); } catch (e) { teamSlot.replaceChildren(h('p', { class: 'hint warn' }, `Teams could not be loaded: ${e.message}`)); }
        st.ut = await ctx.getSavedUT();
      }
      if (st.homeToken === token && st.phase === 'home') renderTeamSlot();
    })();
    (async () => {
      const sv = services ? await services.status() : { online: false, message: '' };
      const profile = sv.online ? await services.profile() : null;
      if (st.destroyed) return;
      st.status = {
        online: sv.online && !!(profile && profile.ok), profile: profile && profile.ok ? profile : null,
        message: sv.online && !(profile && profile.ok) ? 'Your online profile could not be loaded.' : sv.message,
      };
      if (st.homeToken === token && st.phase === 'home') { renderStatus(); loadFriends(token); }
      if (st.status.online) {
        st.rivals = await services.rivals.status();
        if (st.homeToken === token && st.phase === 'home' && st.qmode === 'rivals') renderTeamSlot();
      }
    })();
  }

  // ---------------------------------------------------------------- friends
  async function loadFriends(token = st.homeToken) {
    const body = root.querySelector('#friends-body');
    if (!body) return;
    if (!st.status || !st.status.online) {
      body.replaceChildren(h('p', { class: 'hint' }, 'Friends, challenges and presence need the online service.'));
      return;
    }
    const r = await services.friends.list();
    if (st.homeToken !== token || st.phase !== 'home') return;
    st.friends = r.ok ? r : null;
    renderFriends(r);
  }

  function renderFriends(r) {
    const body = root.querySelector('#friends-body');
    const codeEl = root.querySelector('#friends-code');
    if (!body || !codeEl) return;
    if (!r.ok) { body.replaceChildren(h('p', { class: 'hint warn' }, 'Friends could not be loaded.')); return; }
    const code = r.code || (st.status && st.status.profile && st.status.profile.friendCode) || '—';
    codeEl.replaceChildren(h('small', null, 'Your friend code'), h('b', { id: 'my-friend-code' }, code),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'copy-friend-code', onclick: async () => {
        try { await navigator.clipboard.writeText(code); ctx.toast('Friend code copied'); } catch { ctx.toast(`Your code: ${code}`); }
      } }, 'Copy'));
    const addIn = h('input', { class: 'input', id: 'friend-code-input', maxlength: '9', placeholder: 'FRIEND CODE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Friend code' });
    addIn.addEventListener('input', () => { const v = normalizeFriendCode(addIn.value); if (v !== addIn.value) addIn.value = v; });
    const addBtn = h('button', { class: 'btn', type: 'button', id: 'friend-add', onclick: async () => {
      addBtn.disabled = true;
      const res = await services.friends.add(addIn.value);
      addBtn.disabled = false;
      if (res.ok) { ctx.toast(res.status === 'friend' ? `You and ${res.name} are now friends` : `Friend request sent to ${res.name}`); loadFriends(); }
      else ctx.toast(res.message || 'Could not add friend', 'bad');
    } }, 'Add');
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
    const act = (f, action, label, cls = 'btn--ghost') => h('button', { class: `btn btn--sm ${cls}`, type: 'button', 'data-friend-action': action, onclick: async (e) => {
      if ((action === 'block' || action === 'remove') && !confirmAction(`${action === 'block' ? 'Block' : 'Remove'} ${f.name}?`)) return;
      e.currentTarget.disabled = true;
      const res = await services.friends.respond(f.id, action);
      if (!res.ok) ctx.toast(res.message || 'Something went wrong', 'bad');
      loadFriends();
    } }, label);
    const groups = { incoming: [], friend: [], outgoing: [], blocked: [] };
    for (const f of r.items) groups[f.status].push(f);
    const row = (f, ...kids) => h('li', { class: `friend friend--${f.status} ${f.online ? 'is-online' : ''}`, 'data-friend-id': f.id },
      h('span', { class: 'friend-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'friend-name' }, f.name,
        f.status === 'friend' ? h('small', null, f.online ? 'Online' : 'Offline', f.rating != null ? ` · ${f.rating}` : '', f.rivalsDivision != null ? ` · Rivals ${f.rivalsDivision === 0 ? 'Elite' : `D${f.rivalsDivision}`}` : '') : null),
      h('span', { class: 'friend-actions' }, ...kids));
    const modeSeg = seg('Challenge mode', [['friendly', 'Friendly'], ['ut', 'Ultimate Team']], st.challengeMode, (v) => { st.challengeMode = v; });
    modeSeg.classList.add('challenge-mode');
    body.replaceChildren(...[
      h('div', { class: 'friend-add' }, addIn, addBtn),
      groups.incoming.length ? h('div', { class: 'friend-group' }, h('h3', null, `Requests (${groups.incoming.length})`),
        h('ul', { class: 'friend-list' }, groups.incoming.map((f) => row(f, act(f, 'accept', 'Accept', 'btn--primary'), act(f, 'decline', 'Decline'))))) : null,
      h('div', { class: 'friend-group' }, h('h3', null, `Friends (${groups.friend.length})`),
        groups.friend.length ? [modeSeg, h('ul', { class: 'friend-list' }, groups.friend.map((f) => row(f,
          h('button', { class: 'btn btn--sm btn--primary', type: 'button', 'data-friend-action': 'challenge', disabled: !f.online || null, title: f.online ? null : 'Your friend is offline', onclick: () => doChallenge(f, st.challengeMode) }, 'Challenge'),
          act(f, 'remove', 'Remove'), act(f, 'block', 'Block', 'btn--ghost btn--danger'))))]
          : h('p', { class: 'hint' }, 'No friends yet — share your friend code or add theirs above.')),
      groups.outgoing.length ? h('div', { class: 'friend-group' }, h('h3', null, 'Sent requests'),
        h('ul', { class: 'friend-list' }, groups.outgoing.map((f) => row(f, h('span', { class: 'hint' }, 'Pending'), act(f, 'remove', 'Cancel'))))) : null,
      groups.blocked.length ? h('details', { class: 'friend-group' }, h('summary', null, `Blocked (${groups.blocked.length})`),
        h('ul', { class: 'friend-list' }, groups.blocked.map((f) => row(f, act(f, 'unblock', 'Unblock'))))) : null,
    ].flat().filter(Boolean));
  }
  function confirmAction(msg) { try { return window.confirm(msg); } catch { return true; } }

  /** Challenge a friend: we host (our peer id travels in the invite), they join on accept. */
  async function doChallenge(friend, mode) {
    teardownSession();
    setPhase('inviting');
    const t0 = Date.now();
    const left = h('b', { class: 'search-time', id: 'invite-left' }, '60');
    const cancel = h('button', { class: 'btn btn--lg', type: 'button', id: 'invite-cancel', 'data-autofocus': '1', onclick: () => { services.friends.cancelChallenge(); } }, 'Cancel challenge');
    view(h('div', { class: 'panel center-panel searching', id: 'inviting' },
      h('div', { class: 'radar', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('div', { class: 'kicker' }, `Friend challenge · ${MODE_LABEL[mode]}`),
      h('h2', null, `Waiting for ${friend.name}`),
      h('div', { class: 'search-clock' }, h('small', null, 'Invite expires in'), left),
      h('p', { class: 'search-status' }, 'They will see your challenge in Pitchside while the game is open.'),
      h('div', { class: 'row center' }, cancel)));
    cancel.focus({ preventScroll: true });
    stopSearchClock();
    st.searchTimer = setInterval(() => { left.textContent = String(Math.max(0, 60 - Math.floor((Date.now() - t0) / 1000))); }, 250);
    const res = await services.friends.challenge(friend.id, mode);
    stopSearchClock();
    if (st.destroyed || st.phase !== 'inviting') { if (res.ok) try { res.transport.close(); } catch { /* ignore */ } return; }
    if (!res.ok) { renderHome(res.error === 'cancelled' ? '' : res.message || 'The challenge failed.'); return; }
    acceptPreconnected({ ...res, opponent: { name: friend.name, rating: friend.rating } });
  }

  /** Enter the code-room lobby over a transport that is already paired (friend challenge / accepted invite). */
  async function acceptPreconnected(res) {
    if (!res || !res.ok || !res.transport) return;
    teardownSession();
    st.quick = null;
    st.friendMatch = { mode: res.mode === 'ut' ? 'ut' : 'friendly', opponent: res.opponent || { name: 'Friend' } };
    st.role = res.role === 'host' ? 'host' : 'guest';
    st.code = null;
    setPhase('joining');
    view(h('div', { class: 'panel center-panel' }, h('div', { class: 'spinner' }), h('p', null, `Connecting to ${st.friendMatch.opponent.name}…`)));
    if (!st.teams) {
      try { st.teams = await ctx.getTeams(); } catch { /* lobby shows the error */ }
      st.ut = await ctx.getSavedUT();
    }
    if (st.friendMatch.mode === 'ut' && st.ut) { st.myIdx = 0; st.myTeam = st.ut; }
    const s = newSession(res.transport, { matchToken: res.token });
    try {
      await s.attach(st.role, 25000); // same tick as newSession (buffered hello)
    } catch (e) {
      if (st.session === s) renderHome(`Could not connect: ${e.message}`);
      return;
    }
    if (st.session !== s) return;
    enterLobby();
  }

  // ---------------------------------------------------------------- quick search
  function stopSearchClock() { if (st.searchTimer) { clearInterval(st.searchTimer); st.searchTimer = null; } }

  function progressText(p, opp) {
    switch (p.state) {
      case 'opening': return 'Connecting to the matchmaking service…';
      case 'queued': return p.elapsedMs > 20000 ? 'Still looking — widening the search to more players…' : 'In the queue, looking for a player of similar rating…';
      case 'matched': case 'linking': return `Opponent found: ${opp ? `${opp.name} (${opp.rating})` : ''} — connecting…`;
      default: return '';
    }
  }

  async function doQuickSearch(mode, team) {
    if (!services) { renderHome('Online services are not available.'); return; }
    let clean;
    try { clean = sanitizeTeam(team, 'h'); } catch (e) { renderHome(`That team cannot be used online: ${e.message}`); return; }
    teardownSession();
    st.quick = { mode, team: clean, opponent: null };
    st.myTeam = clean;
    st.code = null;
    setPhase('searching');
    const t0 = Date.now();
    const clock = h('b', { class: 'search-time', id: 'search-time', 'aria-live': 'off' }, '0:00');
    const status = h('p', { class: 'search-status', id: 'search-status', 'aria-live': 'polite' }, 'Connecting to the matchmaking service…');
    const cancelBtn = h('button', { class: 'btn btn--lg', type: 'button', id: 'search-cancel', 'data-autofocus': '1', onclick: () => cancelSearch() }, 'Cancel search');
    view(h('div', { class: 'panel center-panel searching', id: 'searching' },
      h('div', { class: 'radar', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), ctx.shirtSVG(clean.kit, '', 44)),
      h('div', { class: 'kicker' }, `Quick Search · ${MODE_LABEL[mode]}`),
      h('h2', null, 'Finding an opponent'),
      h('p', { class: 'search-team' }, clean.name, ' · ', h('b', null, ctx.teamOvr(clean)), ' OVR'),
      h('div', { class: 'search-clock' }, h('small', null, 'Time searching'), clock),
      status,
      h('div', { class: 'row center' }, cancelBtn)));
    cancelBtn.focus({ preventScroll: true });
    stopSearchClock();
    st.searchTimer = setInterval(() => { clock.textContent = fmtClock(Date.now() - t0); }, 250);
    let opp = null;
    const res = await services.matchmaking.quickSearch({
      mode, team: clean,
      onProgress: (p) => { if (p.opponent) opp = p.opponent; if (st.phase === 'searching') { const t = progressText(p, opp); if (t) status.textContent = t; } },
    });
    stopSearchClock();
    if (st.destroyed || st.phase !== 'searching' || !st.quick) { if (res.ok) try { res.transport.close(); } catch { /* ignore */ } return; }
    if (!res.ok) {
      if (ctx.autoQuick && ctx.onAutoEnd) { renderHome(res.cancelled ? '' : res.message || ''); ctx.onAutoEnd(res); return; }
      if (res.cancelled) renderHome();
      else renderHome(res.message || 'Quick search failed.', () => doQuickSearch(mode, clean));
      return;
    }
    st.quick.opponent = res.opponent;
    st.role = res.role;
    cancelBtn.textContent = 'Cancel';
    status.textContent = `Opponent found: ${res.opponent.name} (${res.opponent.rating}) — connecting…`;
    const s = newSession(res.transport, { matchToken: res.token });
    try {
      await s.attach(res.role, 25000); // must follow newSession in the same tick (buffered hello)
    } catch (e) {
      if (st.session === s) renderHome(`Could not connect to ${res.opponent.name}: ${e.message}`);
      return;
    }
    if (st.session !== s || st.phase !== 'searching') return;
    enterLobby();
  }

  function cancelSearch() {
    if (services) services.matchmaking.cancelSearch();
    stopSearchClock();
    if (st.phase === 'searching') {
      renderHome();
      if (ctx.autoQuick && ctx.onAutoEnd) ctx.onAutoEnd({ ok: false, cancelled: true, reason: 'cancelled' });
    }
  }

  function peerCfg() {
    return prefs.host ? { host: prefs.host, port: prefs.port || undefined, path: prefs.path || '/', secure: prefs.secure !== false } : {};
  }

  function newSession(transport = null, { matchToken = null } = {}) {
    const t = transport || createTransport(ctx.transportKind, ctx.transportKind === 'peer' ? peerCfg() : undefined);
    const s = new NetSession(t, { name: prefs.name || (st.role === 'host' ? 'Host' : 'Guest'), matchToken });
    st.session = s;
    s.on('ping', (ms) => { st.ping = ms; for (const e of root.querySelectorAll('.ping-val')) e.textContent = `${ms} ms`; });
    s.on('link', onLink);
    s.on('msg', onMsg);
    s.on('bye', onBye);
    s.on('fatal', (why) => { if (st.phase !== 'home') { teardownSession(); showEnded('Connection refused', why); } });
    // broker / network problems after connecting: never fail silently
    s.on('status', (state, detail) => {
      if (state !== 'error' || !detail || st.session !== s) return;
      if (!s.code) return; // failures while creating/joining are reported by doHost/doJoin
      if (st.phase === 'hosting') renderHome(`Your room stopped working: ${detail}`, () => doHost());
      else ctx.toast(detail, 'bad');
    });
    s.on('newpeer', () => { st.peerTeam = null; st.peerReady = false; st.peerGp = null; });
    return s;
  }

  async function doHost() {
    st.quick = null;
    st.role = 'host';
    setPhase('hosting');
    view(h('div', { class: 'panel center-panel' }, h('div', { class: 'spinner' }), h('p', null, 'Creating room…')));
    const s = newSession();
    try {
      st.code = await s.host();
    } catch (e) {
      if (st.session === s) renderHome(`Could not create a room: ${e.message}`, () => doHost());
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
    st.quick = null;
    st.role = 'guest';
    setPhase('joining');
    view(h('div', { class: 'panel center-panel' }, h('div', { class: 'spinner' }), h('p', null, `Joining room ${code}…`)));
    const s = newSession();
    try {
      await s.join(code);
    } catch (e) {
      if (st.session === s) renderHome(`Could not join room ${code}: ${e.message}`, () => doJoin(code));
      return;
    }
    if (st.session !== s) return;
    st.code = code;
    enterLobby();
  }

  // ---------------------------------------------------------------- lobby
  async function enterLobby() {
    setPhase('lobby');
    st.myReady = !!st.quick; // quick matches ready up automatically with the team chosen before searching
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
    st.session.send('gp', { g: st.myGp });
    st.session.send('ready', { r: st.myReady });
    if (st.role === 'host') st.session.send('cfg', st.cfg);
  }

  function statusBar() {
    const up = st.session && st.session.linked;
    return h('div', { class: `net-status ${up ? 'up' : 'down'}` },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
      h('span', { class: 'net-status-text' }, up ? `Connected to ${st.session.peerName}` : 'Reconnecting…'),
      h('span', { class: 'net-room' }, st.quick ? `Quick match · ${MODE_LABEL[st.quick.mode]}` : st.friendMatch ? `Friend match · ${MODE_LABEL[st.friendMatch.mode]}` : `Room ${st.code}`),
      h('span', { class: 'net-ping' }, 'Ping ', h('b', { class: 'ping-val' }, st.ping != null ? `${st.ping} ms` : '—')));
  }

  function staticTeamCard(team, title, ready, side, id) {
    return h('div', { class: `picker peer ${side}`, id },
      h('div', { class: 'picker-head' }, h('span', { class: 'picker-side' }, title),
        ready ? h('span', { class: 'tag tag--ok' }, 'READY') : h('span', { class: 'tag' }, 'Not ready')),
      team ? h('div', { class: 'picker-main' }, h('div', { class: 'picker-card static', style: { '--kit1': team.kit.primary, '--kit2': team.kit.secondary } },
        h('div', { class: 'picker-shirt' }, ctx.shirtSVG(team.kit, 10, 96)),
        h('div', { class: 'picker-name' }, team.name),
        h('div', { class: 'picker-meta' }, h('b', { class: 'ovr' }, ctx.teamOvr(team)), h('span', null, 'OVR')),
        h('div', { class: 'picker-form' }, team.formation)))
        : h('div', { class: 'picker-main' }, h('div', { class: 'picker-card static empty' }, h('div', { class: 'spinner' }), h('p', null, 'Receiving team…'))));
  }

  function renderQuickLobby() {
    const hostSide = st.role === 'host';
    const opp = st.quick.opponent || { name: st.session ? st.session.peerName : 'Opponent', rating: '' };
    const mine = staticTeamCard(st.myTeam, `You · ${hostSide ? 'Home' : 'Away'}`, true, hostSide ? 'home' : 'away', 'quick-mine');
    const theirs = staticTeamCard(st.peerTeam, `${opp.name}${opp.rating ? ` (${opp.rating})` : ''} · ${hostSide ? 'Away' : 'Home'}`, st.peerReady, hostSide ? 'away' : 'home', 'quick-peer');
    view(
      transportBadge(),
      statusBar(),
      h('div', { class: 'pickers' }, hostSide ? [mine, h('div', { class: 'pickers-vs' }, 'VS'), theirs] : [theirs, h('div', { class: 'pickers-vs' }, 'VS'), mine]),
      h('p', { class: 'hint center', id: 'quick-lobby-note' }, st.peerTeam ? 'Match found — kick-off in a moment…' : 'Waiting for your opponent’s team…'),
      h('div', { class: 'cfg-read' }, `${st.cfg.halfMinutes} min halves · ${st.cfg.stadium === 'night' ? 'Night' : 'Day'} match · your own gameplay assists apply to your side`),
      h('div', { class: 'row center' }, h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderHome() }, 'Leave')));
  }

  function renderLobby() {
    if (st.phase !== 'lobby') return;
    if (st.quick) { renderQuickLobby(); return; }
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
      case 'gp':
        st.peerGp = sanitizeGameplay(m.g);
        break;
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
          const started = st.phase !== 'starting';
          closeMatch();
          st.phase = 'ended';
          showEnded('Opponent left the match', 'Your opponent quit — you win by forfeit.', true);
          if (started) reportForfeitWin();
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
        if (st.role === 'host') { showEnded('Opponent disconnected', 'They did not reconnect in time — you win by forfeit.', true); reportForfeitWin(); }
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
      const started = st.phase !== 'starting';
      closeMatch();
      st.phase = 'ended';
      showEnded('Opponent left', 'Your opponent left the match — you win by forfeit.', false);
      if (started) reportForfeitWin();
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
    // each human keeps their own assists: host = home, guest = away
    const gp = { home: st.myGp, away: st.peerGp || sanitizeGameplay(null) };
    st.session.send('start', { mid, home, away, cfg, gp });
    let started = false;
    const go = () => {
      if (started || st.mid !== mid || st.phase !== 'starting') return;
      started = true;
      st.pendingStart = null;
      launch('host', home, away, cfg, gp);
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
    const gp = { home: sanitizeGameplay(m.gp && m.gp.home), away: st.myGp };
    launch('guest', home, away, st.cfg, gp);
  }

  async function launch(role, home, away, cfg, gameplay) {
    st.matchTeams = { home, away };
    st.events = [];
    const mid = st.mid;
    let m;
    try {
      m = await ctx.openMatch({
        home, away, halfMinutes: cfg.halfMinutes, stadium: cfg.stadium, difficulty: 'pro',
        controllers: role === 'host' ? { home: 'p1', away: 'remote' } : { home: 'remote', away: 'p1' },
        netRole: role,
        gameplay,
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
    const quick = st.quick;
    const el = ctx.renderResult({
      home, away, result, title: gf > ga ? 'Victory' : gf < ga ? 'Defeat' : 'Draw',
      kicker: quick ? `Online · Quick Search · ${MODE_LABEL[quick.mode]}` : st.friendMatch ? `Online · Friend match · ${MODE_LABEL[st.friendMatch.mode]}` : `Online · Room ${st.code}`,
      actions: [
        { id: 'rematch', label: 'Rematch', primary: true, onClick: () => { st.wantRematch = !st.wantRematch; st.session && st.session.send('rematch', { want: st.wantRematch }); updateRematch(); if (st.role === 'host' && st.wantRematch && st.peerRematch) hostStart(); } },
        quick ? { id: 'again', label: 'New opponent', onClick: () => { const q = st.quick; teardownSession(); doQuickSearch(q.mode, q.team); } }
          : { id: 'teams', label: 'Change teams', onClick: () => { st.session && st.session.send('lobby', {}); enterLobby(); } },
        { id: 'leave', label: 'Leave', onClick: () => leave() },
      ],
    });
    const reward = h('div', { class: 'reward', id: 'reward-line', role: 'status' });
    view(statusBar(), reward, el, h('p', { class: 'hint center rematch-note', id: 'rematch-note' }));
    updateRematch();
    if (ctx.onResult) { try { ctx.onResult(result, { userSide: mine, mode: quick ? quick.mode : st.friendMatch ? st.friendMatch.mode : 'friendly', online: true }); } catch (e) { console.error(e); } }
    reportOnce({ won: gf > ga, drawn: gf === ga, goalsFor: gf, goalsAgainst: ga }, reward);
  }

  /** Report a finished online match once per match id and show the coin/rating change. */
  async function reportOnce(r, el) {
    const key = `${st.session ? st.session.token : 'x'}:${st.mid}`;
    if (!services || st.reported.has(key)) return;
    st.reported.add(key);
    if (el) el.replaceChildren(h('span', { class: 'hint' }, 'Updating coins & rating…'));
    const res = await services.reportResult({ mode: st.quick ? st.quick.mode : st.friendMatch ? st.friendMatch.mode : 'friendly', ...r });
    if (!el || !el.isConnected) return;
    if (!res.ok) { el.replaceChildren(h('span', { class: 'hint' }, res.error === 'not_configured' || res.error === 'offline' ? 'Offline — this match did not earn coins.' : 'Coins could not be updated for this match.')); return; }
    if (res.capped) { el.replaceChildren(h('span', { class: 'hint' }, `Reward limit reached for now — no coins for this match. Rating ${res.rating}.`)); return; }
    const d = res.ratingDelta;
    el.replaceChildren(
      h('span', { class: 'reward-coins' }, h('b', null, `+${fmtNum(res.coinsAwarded)}`), ' coins'),
      h('span', { class: `reward-rating ${d > 0 ? 'up' : d < 0 ? 'down' : ''}` }, 'Rating ', h('b', null, res.rating), d ? ` (${d > 0 ? '+' : ''}${d})` : ''),
      res.rivals
        ? h('span', { class: `reward-rivals ${res.rivals.promoted ? 'up' : ''}`, id: 'reward-rivals' }, res.rivals.promoted ? 'Promoted! ' : 'Rivals ',
          h('b', null, divName(res.rivals.division)), res.rivals.threshold ? ` · ${res.rivals.points}/${res.rivals.threshold} pts` : ` · ${res.rivals.points} pts`)
        : h('span', { class: 'reward-div' }, `Division ${res.division}`),
      h('span', { class: 'reward-bal' }, `Balance ${fmtNum(res.coins)}`));
  }
  function reportForfeitWin() {
    const el = root.querySelector('.ended');
    const line = el ? h('div', { class: 'reward', id: 'reward-line', role: 'status' }) : null;
    if (line) el.append(line);
    reportOnce({ won: true, drawn: false, goalsFor: 0, goalsAgainst: 0 }, line);
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
    if (st.phase === 'searching' && services) services.matchmaking.cancelSearch();
    clearDc();
    closeMatch();
    if (st.session) { const s = st.session; st.session = null; s.close(); }
    st.peerTeam = null;
    st.peerReady = false;
    st.myReady = false;
    st.ping = null;
    st.pendingStart = null;
    st.peerGp = null;
  }

  function leave() {
    teardownSession();
    ctx.nav.back();
  }

  ctx.setBack(() => {
    if (st.phase === 'home') { ctx.nav.back(); return; }
    if (st.phase === 'searching') { cancelSearch(); return; }
    if (st.phase === 'inviting') { services.friends.cancelChallenge(); return; }
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
  if (ctx.autoInvite) acceptPreconnected(ctx.autoInvite);
  else if (ctx.autoQuick && ctx.autoQuick.team) doQuickSearch(['ut', 'rivals'].includes(ctx.autoQuick.mode) ? ctx.autoQuick.mode : 'friendly', ctx.autoQuick.team);
  else if (ctx.autoAction === 'host') doHost();
  else if (ctx.autoAction && ctx.autoAction.startsWith('join:')) doJoin(ctx.autoAction.slice(5));

  return {
    isBusy: () => !['home', 'ended'].includes(st.phase),
    acceptPreconnected,
    destroy() {
      if (st.phase === 'inviting' && services) services.friends.cancelChallenge();
      if (st.phase === 'searching' && services) services.matchmaking.cancelSearch();
      stopSearchClock();
      st.destroyed = true;
      window.removeEventListener('pagehide', onPageHide);
      teardownSession();
      if (window.__net === st) delete window.__net;
    },
  };
}
