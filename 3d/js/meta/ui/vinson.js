// EVIL VINSON presentation and lifecycle. This is global (not tied to a UT view), so a timer continues when
// the player changes screens. Server status is polled while active; the saved absolute deadline survives reload.
import { loadUT, saveUT } from '../core/ut.js';
import { beginDoom, release, advance, reconcileServer, squadChanged, enforceLock, isOwner, BAN_MESSAGE, MATCH_MESSAGE } from '../core/vinson.js';

const asset = (name) => new URL(`../../../assets/cards/${name}`, import.meta.url).href;
const warning = asset('vinson-warning.png');
const planet = asset('vinson-planet.png');
const stamp = (s) => `pitchside.vinson.shown.${s}`;
const seconds = (ms) => String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, '0');
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startVinsonExperience(online) {
  if (globalThis.__pitchsideVinson) return globalThis.__pitchsideVinson;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('../../../css/vinson.css', import.meta.url).href;
  document.head.appendChild(css);
  const host = document.createElement('div'); host.id = 'vinson-experience'; document.body.appendChild(host);
  let app = null, localState = loadUT(), boundId = online?.identityId?.() || null;
  let busy = false, current = '', cinematic = false, interval = null, remoteInterval = null;
  const state = () => app?.ut || localState;
  const persist = (s) => { if (app?.ut === s) app.saveUT(); else if (s) saveUT(s); };
  const remember = (key) => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const mark = (key) => { try { sessionStorage.setItem(key, '1'); } catch { /* private mode */ } };
  const make = (tag, cls, txt) => { const el = document.createElement(tag); el.className = cls; if (txt) el.textContent = txt; return el; };

  function draw() {
    const s = state(); if (!s || isOwner(online)) { host.replaceChildren(); current = ''; return; }
    const v = s.vinson; const phase = v?.phase || '';
    document.body.classList.toggle('vinson-infected', phase === 'doom');
    if (!phase || phase === 'freed' || phase === 'lifted') { host.replaceChildren(); current = phase; cinematic = false; return; }
    if (phase === 'banned') {
      const key = stamp(`${online?.identityId?.() || 'guest'}.${v.doomUntil}`);
      if (current !== 'banned') { host.replaceChildren(); current = 'banned'; cinematic = false; }
      if (!cinematic) {
        cinematic = true;
        if (remember(key) || reduce()) finalScene();
        else playCinematic(key);
      }
      return;
    }
    if (phase === 'locked') { host.replaceChildren(); current = phase; return; }
    if (current !== phase) {
      host.replaceChildren(); current = phase;
      const box = make('div', `vinson-notice vinson-${phase}`);
      box.setAttribute('role', 'alert');
      box.append(make('strong', 'vinson-notice-title', phase === 'doom' ? 'DOOM HAS BEEN BROUGHT UPON YOU'
        : phase === 'warn' ? "IT'S NOT WORTH IT" : phase === 'consequence' ? 'THIS ACTION WILL HAVE CONSEQUENCES' : "YOU'VE BEEN CURSED BY VINSON"));
      if (phase !== 'locked') box.append(make('span', 'vinson-timer'));
      host.append(box);
      if (phase === 'doom') host.append(make('div', 'vinson-whisper'));
    }
    const t = host.querySelector('.vinson-timer');
    if (t) {
      const left = phase === 'doom' ? v.doomUntil - Date.now() : v.phaseUntil - Date.now();
      t.textContent = phase === 'doom' ? `${Math.floor(Math.max(0, left) / 60000)}:${seconds(left % 60000)}` : `${seconds(left)} seconds`;
    }
    const whisper = host.querySelector('.vinson-whisper');
    if (whisper) whisper.textContent = ["DON'T DO IT", "IT'S OVER", "YOU'RE DONE", "SHE'S COMING", 'LOOK BEHIND YOU'][Math.floor(Date.now() / 2300) % 5];
  }

  function finalScene() {
    host.replaceChildren();
    const screen = make('div', 'vinson-screen vinson-final'); screen.setAttribute('role', 'alertdialog');
    screen.setAttribute('aria-label', BAN_MESSAGE);
    const art = make('div', 'vinson-planet-art');
    const bg = document.createElement('img'); bg.src = planet; bg.alt = 'Vinson holding the Earth';
    const orb = make('div', 'vinson-spinning-earth'); const crop = document.createElement('img'); crop.src = planet; crop.alt = '';
    orb.append(crop); art.append(bg, orb); screen.append(art, make('strong', 'vinson-final-title', BAN_MESSAGE));
    const check = make('button', 'vinson-check', 'Check if the owner unbanned me'); check.onclick = () => void poll(); screen.append(check);
    host.append(screen);
  }

  function playCinematic(key) {
    host.replaceChildren();
    const screen = make('div', 'vinson-screen vinson-cinematic'); screen.setAttribute('role', 'alertdialog');
    screen.setAttribute('aria-label', "IT'S NOT WORTH IT");
    const tile = make('div', 'vinson-tiles'); screen.append(tile); host.append(screen);
    let count = 0;
    const addTile = (i) => {
      const cell = make('div', 'vinson-tile');
      const image = document.createElement('img'); image.src = warning; image.alt = '';
      cell.append(image, make('span', '', "IT'S NOT WORTH IT"));
      if (i < 4) cell.classList.add(`corner-${i}`);
      else {
        // Seeded placement makes this event stable across a repaint, without a rigid grid.
        const rand = (n) => ((Math.sin((i + 1) * n * 93.17) * 43758.5453) % 1 + 1) % 1;
        cell.style.left = `${rand(13) * 88}%`; cell.style.top = `${rand(29) * 80}%`;
        cell.style.width = `${12 + rand(31) * 19}%`; cell.style.transform = `rotate(${(rand(7) - .5) * 15}deg)`;
      }
      tile.append(cell);
    };
    const batch = () => {
      if (current !== 'banned' || !host.contains(screen)) return;
      addTile(count++);
      if (count < 65) setTimeout(batch, Math.max(55, 850 - count * 17));
      else setTimeout(() => { screen.classList.add('vinson-blackout'); setTimeout(() => { if (current === 'banned') finalScene(); }, 1000); }, 1700);
    };
    mark(key); for (let i = 0; i < 4; i++) addTile(count++); setTimeout(batch, 1400);
  }

  async function poll() {
    if (busy || !online?.vinson || isOwner(online)) return;
    const s = state(); if (!s) return;
    busy = true;
    try {
      let remote = await online.vinson.status();
      // A pull made while offline still has a local deadline. Register it with the server when connectivity
      // returns; the server then owns the deadline and ban across devices.
      if (remote.ok && !remote.phase && ['doom', 'banned'].includes(s.vinson?.phase)) {
        const pulled = await online.vinson.pull();
        if (pulled.ok) remote = pulled;
      }
      if (remote.ok && remote.phase === 'released' && s.vinson?.phase === 'locked') {
        const locked = await online.vinson.lock();
        if (locked.ok) remote = { ...remote, phase: 'locked' };
      }
      if (remote.ok) {
        const old = s.vinson?.phase;
        reconcileServer(s, remote);
        if (old === 'banned' && remote.phase === 'released') squadChanged(s);
        if (s.vinson?.phase !== old) { persist(s); if (app && !app.destroyed) app.refresh(); }
        if (s.vinson?.phase === 'locked') app?.applyRestrictions?.(remote.restrictions || { admin: true, codes: true });
        draw();
      }
    } finally { busy = false; }
  }

  function tick() {
    const s = state(); if (!s || isOwner(online)) { draw(); return; }
    const old = s.vinson?.phase;
    advance(s);
    const repaired = s.vinson?.phase === 'locked' && enforceLock(s);
    if (old !== s.vinson?.phase || repaired) {
      persist(s);
      if (s.vinson?.phase === 'locked') { void online?.vinson?.lock?.(); app?.applyRestrictions?.({ admin: true, codes: true }); }
      if (s.vinson?.phase === 'banned') void poll();
      if (app && !app.destroyed) app.refresh();
    }
    draw();
  }

  const controller = {
    attach(next) { app = next; localState = next.ut; tick(); void poll(); },
    detach(next) { if (app === next) { localState = next.ut; app = null; } },
    reload() { if (!app) { boundId = online?.identityId?.() || null; localState = loadUT(); tick(); void poll(); } },
    onSquadChange() {
      const s = state(); if (!s || isOwner(online)) return;
      const before = s.vinson?.phase;
      squadChanged(s);
      if (s.vinson?.phase !== before) persist(s);
      draw();
    },
    async onPull() {
      const s = state(); if (!s || isOwner(online)) return;
      if (s.vinson?.phase === 'locked' || s.vinson?.phase === 'lifted') return;
      beginDoom(s); persist(s); draw();
      const remote = await online?.vinson?.pull?.();
      if (remote?.exempt) { release(s); persist(s); draw(); return; }
      if (remote?.ok && remote.deadline) { reconcileServer(s, remote); persist(s); draw(); }
    },
    async matchSabotage(layer) {
      if (!layer) return;
      const screen = make('div', 'vinson-match-screen');
      screen.setAttribute('role', 'alert');
      screen.append(make('strong', '', MATCH_MESSAGE));
      layer.append(screen);
      await new Promise((resolve) => setTimeout(resolve, reduce() ? 1800 : 2800));
      screen.remove();
    },
    tick, poll,
    destroy() { clearInterval(interval); clearInterval(remoteInterval); document.body.classList.remove('vinson-infected'); host.remove(); css.remove(); if (globalThis.__pitchsideVinson === controller) globalThis.__pitchsideVinson = null; },
  };
  globalThis.__pitchsideVinson = controller;
  interval = setInterval(tick, 250);
  remoteInterval = setInterval(() => { const phase = state()?.vinson?.phase; if (phase && phase !== 'freed' && phase !== 'lifted') void poll(); }, 12000);
  online?.account?.onChange?.(() => {
    const id = online?.identityId?.() || null;
    if (id !== boundId) { boundId = id; if (!app) { localState = null; host.replaceChildren(); current = ''; } }
    void poll();
  });
  tick(); void poll();
  return controller;
}
